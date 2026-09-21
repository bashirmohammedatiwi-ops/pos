using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class CreditAccountRepository(ISqlConnectionFactory db, EdariNexusClient edari)
{
    public async Task<IReadOnlyList<AccountSummaryDto>> ListForPosAsync(CancellationToken ct, long? cashierId = null)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        IReadOnlyList<StoredRow> rows;
        if (cashierId is long cid && cid > 0)
        {
            rows = await LoadCashierRowsAsync(conn, cid, ct);
            if (rows.Count > 0)
                return await HydrateSummariesAsync(rows, ct);
        }

        var seqs = (await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT edari_seq FROM ext_pos_credit_accounts ORDER BY sort_order, account_name",
            cancellationToken: ct))).ToList();
        if (seqs.Count == 0) return [];

        var live = await edari.GetCreditAccountsBySeqsAsync(seqs, ct);
        return live.Select(a => new AccountSummaryDto(a.Seq, a.Num, a.Name, a.Balance)).ToList();
    }

    public async Task<IReadOnlyList<CashierCreditAccountDto>> ListForCashierAsync(long cashierId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await LoadCashierRowsAsync(conn, cashierId, ct);
        if (rows.Count == 0) return [];

        var live = await edari.GetCreditAccountsBySeqsAsync(rows.Select(r => r.EdariSeq).ToList(), ct);
        var liveMap = live.ToDictionary(a => a.Seq);
        return rows.Select(r =>
        {
            if (liveMap.TryGetValue(r.EdariSeq, out var a))
                return new CashierCreditAccountDto(a.Seq, a.Num, a.Name, a.Balance);
            return new CashierCreditAccountDto(r.EdariSeq, r.Num, r.Name, 0);
        }).ToList();
    }

    public async Task ReplaceForCashierAsync(long cashierId, IReadOnlyList<CashierCreditAccountDto>? accounts, CancellationToken ct)
    {
        if (accounts is null) return;
        var distinct = accounts.Where(a => a.EdariSeq > 0)
            .GroupBy(a => a.EdariSeq)
            .Select(g => g.First())
            .ToList();
        var live = distinct.Count > 0
            ? await edari.GetCreditAccountsBySeqsAsync(distinct.Select(a => a.EdariSeq).ToList(), ct)
            : [];
        var liveMap = live.ToDictionary(a => a.Seq);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM cashier_credit_accounts WHERE cashier_id = @cashierId",
            new { cashierId }, cancellationToken: ct));

        var order = 0;
        foreach (var acc in distinct)
        {
            liveMap.TryGetValue(acc.EdariSeq, out var liveAcc);
            var name = FirstNonEmpty(liveAcc?.Name, acc.Name, liveAcc?.Num, acc.Num, $"#{acc.EdariSeq}");
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO cashier_credit_accounts (cashier_id, edari_seq, account_num, account_name, sort_order)
                VALUES (@cashierId, @seq, @num, @name, @sortOrder)
                """, new
            {
                cashierId,
                seq = acc.EdariSeq,
                num = liveAcc?.Num ?? acc.Num,
                name,
                sortOrder = order++,
            }, cancellationToken: ct));
        }
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var v in values)
            if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
        return "#0";
    }

    private static async Task<IReadOnlyList<StoredRow>> LoadCashierRowsAsync(
        System.Data.Common.DbConnection conn, long cashierId, CancellationToken ct)
    {
        try
        {
            return (await conn.QueryAsync<StoredRow>(new CommandDefinition("""
                SELECT edari_seq AS EdariSeq, account_num AS Num, account_name AS Name, sort_order AS SortOrder
                FROM cashier_credit_accounts
                WHERE cashier_id = @cashierId
                ORDER BY sort_order, account_name
                """, new { cashierId }, cancellationToken: ct))).ToList();
        }
        catch
        {
            return [];
        }
    }

    private async Task<IReadOnlyList<AccountSummaryDto>> HydrateSummariesAsync(
        IReadOnlyList<StoredRow> rows, CancellationToken ct)
    {
        var live = await edari.GetCreditAccountsBySeqsAsync(rows.Select(r => r.EdariSeq).ToList(), ct);
        var liveMap = live.ToDictionary(a => a.Seq);
        return rows.Select(r =>
        {
            if (liveMap.TryGetValue(r.EdariSeq, out var a))
                return new AccountSummaryDto(a.Seq, a.Num, a.Name, a.Balance);
            return new AccountSummaryDto(r.EdariSeq, r.Num, r.Name, 0);
        }).ToList();
    }

    public async Task<IReadOnlyList<PosCreditAccountDto>> GetAdminViewAsync(string? search, CancellationToken ct)
    {
        var edariAccounts = await edari.GetCreditAccountsAsync(search, 500, ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var selected = (await conn.QueryAsync<SelectionRow>(new CommandDefinition(
            "SELECT edari_seq AS EdariSeq, sort_order AS SortOrder FROM ext_pos_credit_accounts",
            cancellationToken: ct))).ToDictionary(r => r.EdariSeq);

        return edariAccounts.Select(a => new PosCreditAccountDto(
            a.Seq,
            a.Num,
            a.Name,
            a.Balance,
            selected.ContainsKey(a.Seq),
            selected.GetValueOrDefault(a.Seq)?.SortOrder ?? 0
        )).ToList();
    }

    public async Task<IReadOnlyList<PosCreditAccountDto>> GetSelectedAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<StoredRow>(new CommandDefinition("""
            SELECT edari_seq AS EdariSeq, account_num AS Num, account_name AS Name, sort_order AS SortOrder
            FROM ext_pos_credit_accounts ORDER BY sort_order, account_name
            """, cancellationToken: ct))).ToList();
        if (rows.Count == 0) return [];

        var live = await edari.GetCreditAccountsBySeqsAsync(rows.Select(r => r.EdariSeq).ToList(), ct);
        var liveMap = live.ToDictionary(a => a.Seq);

        return rows.Select(r =>
        {
            if (liveMap.TryGetValue(r.EdariSeq, out var a))
                return new PosCreditAccountDto(a.Seq, a.Num, a.Name, a.Balance, true, r.SortOrder);
            return new PosCreditAccountDto(r.EdariSeq, r.Num, r.Name, 0, true, r.SortOrder);
        }).ToList();
    }

    public async Task SaveSelectionAsync(IReadOnlyList<long> edariSeqs, CancellationToken ct)
    {
        var distinct = edariSeqs.Where(s => s > 0).Distinct().ToList();
        var live = distinct.Count > 0
            ? await edari.GetCreditAccountsBySeqsAsync(distinct, ct)
            : [];
        var liveMap = live.ToDictionary(a => a.Seq);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("DELETE FROM ext_pos_credit_accounts", cancellationToken: ct));

        var order = 0;
        foreach (var seq in distinct)
        {
            liveMap.TryGetValue(seq, out var acc);
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_pos_credit_accounts (edari_seq, account_num, account_name, sort_order)
                VALUES (@seq, @num, @name, @sortOrder)
                """, new
            {
                seq,
                num = acc?.Num,
                name = acc?.Name ?? acc?.Num ?? $"#{seq}",
                sortOrder = order++,
            }, cancellationToken: ct));
        }
    }

    public async Task<int> CountSelectedAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_pos_credit_accounts", cancellationToken: ct));
    }

    private sealed class SelectionRow
    {
        public long EdariSeq { get; set; }
        public int SortOrder { get; set; }
    }

    private sealed class StoredRow
    {
        public long EdariSeq { get; set; }
        public string? Num { get; set; }
        public string? Name { get; set; }
        public int SortOrder { get; set; }
    }
}
