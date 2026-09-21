using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// Cash box accounts are served from the local Edari account mirror (ext_edari_accounts) so the
/// picker lists boxes instantly, searches Arabic names, and shows boxes created in Edari moments
/// ago. Live NexusDB is the fallback for the window before the first accounts sync completes.
/// </summary>
public sealed class CashBoxAccountRepository(ISqlConnectionFactory db, EdariNexusClient edari)
{
    public async Task<IReadOnlyList<AccountSummaryDto>> SearchAsync(string? search, CancellationToken ct)
    {
        var cached = await SearchCacheAsync(search, ct);
        if (cached.Count > 0) return cached;

        // An empty result for a real search term is a legitimate answer once the mirror is
        // populated — only fall back to live Edari while the mirror is still empty.
        if (await CacheCountAsync(ct) > 0) return [];

        var rows = await edari.GetCashBoxAccountsAsync(search, 500, ct);
        return rows.Select(a => new AccountSummaryDto(a.Seq, a.Num, a.Name, a.Balance)).ToList();
    }

    public async Task<IReadOnlyList<EdariCreditAccountRow>> LookupBySeqsAsync(
        IReadOnlyList<long> seqs, CancellationToken ct)
    {
        var wanted = seqs.Where(s => s > 0).Distinct().ToList();
        if (wanted.Count == 0) return [];

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var cached = (await conn.QueryAsync<CachedAccount>(new CommandDefinition("""
            SELECT edari_seq AS Seq, account_num AS Num, account_name AS Name,
                   balance AS Balance, group_name AS GroupName
            FROM ext_edari_accounts
            WHERE edari_seq IN @seqs
            """, new { seqs = wanted }, cancellationToken: ct))).ToList();

        var bySeq = cached.ToDictionary(
            c => c.Seq,
            c => new EdariCreditAccountRow { Seq = c.Seq, Num = c.Num, Name = c.Name, Balance = c.Balance });

        var missing = wanted.Where(s => !bySeq.ContainsKey(s)).ToList();
        if (missing.Count > 0)
        {
            foreach (var live in await edari.GetCashBoxAccountsBySeqsAsync(missing, ct))
                bySeq[live.Seq] = live;
        }

        return seqs
            .Where(s => s > 0 && bySeq.ContainsKey(s))
            .Select(s => bySeq[s])
            .ToList();
    }

    private async Task<IReadOnlyList<AccountSummaryDto>> SearchCacheAsync(string? search, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var term = search?.Trim();
        const string cols = """
            edari_seq AS Seq, account_num AS Num, account_name AS Name,
            balance AS Balance, group_name AS GroupName
            """;
        var sql = string.IsNullOrWhiteSpace(term)
            ? $"""
              SELECT TOP (500) {cols}
              FROM ext_edari_accounts
              WHERE is_cashbox = 1 AND closed = 0
              ORDER BY sort_order, account_num
              """
            : $"""
              SELECT TOP (500) {cols}
              FROM ext_edari_accounts
              WHERE closed = 0
                AND (account_num = @exact
                     OR account_num LIKE @like
                     OR account_name LIKE @like
                     OR CAST(edari_seq AS NVARCHAR(20)) LIKE @like)
              ORDER BY is_cashbox DESC,
                       CASE WHEN account_num = @exact THEN 0 ELSE 1 END,
                       sort_order, account_num
              """;

        var rows = await conn.QueryAsync<CachedAccount>(new CommandDefinition(
            sql, new { exact = term, like = $"%{term}%" }, cancellationToken: ct));
        return rows.Select(r => new AccountSummaryDto(r.Seq, r.Num, r.Name, r.Balance, r.GroupName)).ToList();
    }

    private async Task<int> CacheCountAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<int>(
            new CommandDefinition("SELECT COUNT(*) FROM ext_edari_accounts", cancellationToken: ct));
    }

    private sealed record CachedAccount(long Seq, string? Num, string? Name, decimal Balance, string? GroupName = null);
}
