using System.Collections.Frozen;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// NexusDB ADO corrupts Arabic text; HAYAT2025 (legacy SQL POS) stores correct NVARCHAR names keyed by Seq.
/// </summary>
public sealed class HayatLegacyNameService(IConfiguration config)
{
    private readonly string? _connectionString = config.GetConnectionString("HayatLegacy");
    private FrozenDictionary<long, string>? _branchCache;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_connectionString);

    public async Task<IReadOnlyDictionary<long, string>> LookupArticleNamesAsync(
        IReadOnlyList<long> seqs, CancellationToken ct)
    {
        if (!IsConfigured || seqs.Count == 0)
            return FrozenDictionary<long, string>.Empty;

        var distinct = seqs.Distinct().ToArray();
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var rows = await conn.QueryAsync<(long Seq, string Name1)>(new CommandDefinition("""
            SELECT Seq, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) AS Name1
            FROM articles
            WHERE Seq IN @seqs AND Name1 IS NOT NULL
            """, new { seqs = distinct }, cancellationToken: ct));

        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Name1))
            .ToDictionary(r => r.Seq, r => r.Name1.Trim());
    }

    public async Task<string?> LookupArticleNameAsync(long seq, CancellationToken ct)
    {
        var map = await LookupArticleNamesAsync([seq], ct);
        return map.TryGetValue(seq, out var name) ? name : null;
    }

    public async Task<IReadOnlyDictionary<long, string>> GetBranchNamesAsync(CancellationToken ct)
    {
        if (!IsConfigured)
            return FrozenDictionary<long, string>.Empty;

        if (_branchCache is not null)
            return _branchCache;

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var rows = await conn.QueryAsync<(long ErpSeq, string Name)>(new CommandDefinition("""
            SELECT erp_seq AS ErpSeq, LTRIM(RTRIM(CONVERT(NVARCHAR(200), name))) AS Name
            FROM edari_branches
            WHERE name IS NOT NULL
            """, cancellationToken: ct));

        _branchCache = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Name))
            .ToFrozenDictionary(r => r.ErpSeq, r => r.Name.Trim());
        return _branchCache;
    }

    public async Task<string?> LookupBranchNameAsync(long erpSeq, CancellationToken ct)
    {
        var map = await GetBranchNamesAsync(ct);
        return map.TryGetValue(erpSeq, out var name) ? name : null;
    }

    public void InvalidateBranchCache() => _branchCache = null;

    /// <summary>Keep HAYAT2025.edari_branches aligned when POS pushes branch renames to Edari.</summary>
    public async Task UpsertBranchNameAsync(long erpSeq, string name, CancellationToken ct)
    {
        if (!IsConfigured || erpSeq <= 0 || string.IsNullOrWhiteSpace(name))
            return;

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var existingId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT id FROM edari_branches WHERE erp_seq = @seq",
            new { seq = erpSeq }, cancellationToken: ct));

        if (existingId.HasValue)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE edari_branches SET name = @name WHERE id = @id",
                new { id = existingId.Value, name = name.Trim() }, cancellationToken: ct));
        }
        else
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO edari_branches (erp_seq, name) VALUES (@seq, @name)",
                new { seq = erpSeq, name = name.Trim() }, cancellationToken: ct));
        }

        InvalidateBranchCache();
    }

    public async Task<IReadOnlyDictionary<long, string>> LookupSalesmanNamesAsync(
        IReadOnlyList<long> ids, CancellationToken ct)
    {
        if (!IsConfigured || ids.Count == 0)
            return FrozenDictionary<long, string>.Empty;

        var distinct = ids.Distinct().ToArray();
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var rows = await conn.QueryAsync<(long Id, string Name)>(new CommandDefinition("""
            SELECT id AS Id, LTRIM(RTRIM(CONVERT(NVARCHAR(200), name))) AS Name
            FROM salesmen
            WHERE id IN @ids AND name IS NOT NULL
            """, new { ids = distinct }, cancellationToken: ct));

        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Name))
            .ToDictionary(r => r.Id, r => r.Name.Trim());
    }

    public async Task<string?> LookupSalesmanNameAsync(long id, CancellationToken ct)
    {
        var map = await LookupSalesmanNamesAsync([id], ct);
        return map.TryGetValue(id, out var name) ? name : null;
    }

    /// <summary>
    /// Edari «أسماء البائعين»: the 1..250 register FilePOS5.SaleMan uses.
    /// File11n Cod=2 are chart folders. FileCash is cashiers.
    /// </summary>
    public async Task<IReadOnlyList<EdariSellerRow>> GetEdariSalesmenAsync(CancellationToken ct)
    {
        if (!IsConfigured)
            return [];

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var rows = await conn.QueryAsync<(long Id, string Name)>(new CommandDefinition("""
            SELECT id AS Id, LTRIM(RTRIM(CONVERT(NVARCHAR(200), ISNULL(name, N'')))) AS Name
            FROM salesmen
            WHERE id BETWEEN @minId AND @maxId
            ORDER BY id
            """, new
        {
            minId = EdariSalesmenConstants.MinId,
            maxId = EdariSalesmenConstants.MaxId,
        }, cancellationToken: ct));

        return rows
            .Select(r => new EdariSellerRow
            {
                Seq = r.Id,
                Name = r.Name,
            })
            .ToList();
    }

    public async Task<int> CountEdariSalesmenAsync(CancellationToken ct)
    {
        if (!IsConfigured)
            return 0;

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(*)
            FROM salesmen
            WHERE id BETWEEN @minId AND @maxId
            """, new
        {
            minId = EdariSalesmenConstants.MinId,
            maxId = EdariSalesmenConstants.MaxId,
        }, cancellationToken: ct));
    }

    /// <summary>Changes when any salesman name in the Edari 1..250 range is edited.</summary>
    public async Task<long> GetSalesmenNameTokenAsync(CancellationToken ct)
    {
        if (!IsConfigured)
            return 0;

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var token = await conn.ExecuteScalarAsync<int?>(new CommandDefinition("""
            SELECT CHECKSUM_AGG(CHECKSUM(id, ISNULL(CONVERT(NVARCHAR(200), name), N'')))
            FROM salesmen
            WHERE id BETWEEN @minId AND @maxId
            """, new
        {
            minId = EdariSalesmenConstants.MinId,
            maxId = EdariSalesmenConstants.MaxId,
        }, cancellationToken: ct));
        return token ?? 0;
    }

    public async Task<IReadOnlyDictionary<long, HayatCreditAccountRow>> LookupCreditAccountsAsync(
        IReadOnlyList<long> seqs, CancellationToken ct)
    {
        if (!IsConfigured || seqs.Count == 0)
            return FrozenDictionary<long, HayatCreditAccountRow>.Empty;

        var distinct = seqs.Distinct().ToArray();
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var rows = await conn.QueryAsync<(long Seq, string Name, string? Num, double Balance)>(new CommandDefinition("""
            SELECT Seq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) AS Name,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(100), Num))) AS Num,
                   ISNULL(Bal, 0) AS Balance
            FROM accounts
            WHERE Cod = 1 AND Seq IN @seqs AND Name1 IS NOT NULL
            """, new { seqs = distinct }, cancellationToken: ct));

        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Name))
            .ToDictionary(
                r => r.Seq,
                r => new HayatCreditAccountRow(r.Seq, r.Name.Trim(), r.Num?.Trim(), (decimal)r.Balance));
    }

    public async Task<IReadOnlyList<HayatCreditAccountRow>> SearchCreditAccountsAsync(
        string search, int limit, CancellationToken ct)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(search))
            return [];

        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var rows = await conn.QueryAsync<(long Seq, string Name, string? Num, double Balance)>(new CommandDefinition("""
            SELECT TOP (@limit)
                   Seq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) AS Name,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(100), Num))) AS Num,
                   ISNULL(Bal, 0) AS Balance
            FROM accounts
            WHERE Cod = 1 AND CloseAcc = 0
              AND (Name1 LIKE @s OR Num LIKE @s)
            ORDER BY Name1
            """, new { limit, s = $"%{search.Trim()}%" }, cancellationToken: ct));

        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Name))
            .Select(r => new HayatCreditAccountRow(r.Seq, r.Name.Trim(), r.Num?.Trim(), (decimal)r.Balance))
            .ToList();
    }

    /// <summary>Leaf posting accounts under POS chart folders (cash boxes, delivery, etc.).</summary>
    public async Task<IReadOnlyList<HayatCreditAccountRow>> SearchSectionPostingAccountsAsync(
        string? search, int limit, CancellationToken ct = default)
    {
        if (!IsConfigured)
            return [];

        var roots = SectionPostingAccountRoots.RootNums;
        await using var conn = new SqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        var searchClause = string.IsNullOrWhiteSpace(search)
            ? ""
            : " AND (a.Name1 LIKE @s OR a.Num LIKE @s OR CAST(a.Seq AS NVARCHAR(20)) LIKE @s)";

        var rows = await conn.QueryAsync<(long Seq, string Name, string? Num, double Balance, string? GroupNum)>(
            new CommandDefinition($"""
            SELECT TOP (@limit)
                   a.Seq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(100), a.Num))) AS Num,
                   ISNULL(a.Bal, 0) AS Balance,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(100), p.Num))) AS GroupNum
            FROM accounts a
            INNER JOIN accounts p ON a.Master = p.Seq
            WHERE a.CloseAcc = 0 AND a.Cod = 1
              AND LTRIM(RTRIM(CONVERT(NVARCHAR(100), p.Num))) IN @roots
            {searchClause}
            ORDER BY p.Num, a.Num, a.Name1
            """, new
        {
            limit = Math.Clamp(limit, 1, 2000),
            roots,
            s = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%",
        }, cancellationToken: ct));

        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Name))
            .Select(r => new HayatCreditAccountRow(r.Seq, r.Name.Trim(), r.Num?.Trim(), (decimal)r.Balance))
            .ToList();
    }

    /// <summary>Leaf cash boxes under chart node Num (default 100 = صناديق المحل).</summary>
    [Obsolete("Use SearchSectionPostingAccountsAsync")]
    public Task<IReadOnlyList<HayatCreditAccountRow>> SearchCashBoxAccountsAsync(
        string? search, int limit, string rootNum = "100", CancellationToken ct = default) =>
        SearchSectionPostingAccountsAsync(search, limit, ct);
}

public sealed record HayatCreditAccountRow(long Seq, string Name, string? Num, decimal Balance);
