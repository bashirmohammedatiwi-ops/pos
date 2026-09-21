using System.Data.Common;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariCreditAccountRow
{
    public long Seq { get; set; }
    public string? Name { get; set; }
    public string? Num { get; set; }
    public decimal Balance { get; set; }
    public int CloseAcc { get; set; }
}

public sealed class EdariChartAccountRow
{
    public long Seq { get; set; }
    public string? Num { get; set; }
    public string? Name { get; set; }
    public decimal Balance { get; set; }
    public bool Closed { get; set; }
    public long Master { get; set; }
    public string? GroupNum { get; set; }
    public string? GroupName { get; set; }
}

public sealed partial class EdariNexusClient
{
    internal static string SqlLikePublic(string pattern) => $"'{pattern.Replace("'", "''")}'";

    public async Task<IReadOnlyList<EdariCreditAccountRow>> GetCreditAccountsAsync(string? search, int limit, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(search) && EdariStringHelper.HasArabic(search))
        {
            var topArabic = Math.Clamp(limit, 1, 2000);
            var pattern = search.Trim().Replace("'", "''");
            var arabicRows = await textQuery.QueryAsync($"""
                SELECT TOP {topArabic} Seq, Name1, Num, Bal, CloseAcc
                FROM File11n
                WHERE Cod = 1 AND CloseAcc = 0 AND Name1 LIKE '%{pattern}%'
                ORDER BY Name1
                """, ct);
            var fromEdari = MapCreditRowsFromText(arabicRows);
            if (fromEdari.Count > 0) return fromEdari;
        }

        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        var top = Math.Clamp(limit, 1, 2000);
        var rows = new List<EdariCreditAccountRow>();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = EdariNexusClient.SqlLikePublic($"%{search.Trim()}%");
            var sql = $"""
                SELECT TOP {top} Seq, Name1, Num, Bal, CloseAcc
                FROM File11n
                WHERE Cod = 1 AND CloseAcc = 0
                  AND (Name1 LIKE {pattern} OR Num LIKE {pattern})
                ORDER BY Name1
                """;
            rows = await QueryCreditAccountsAsync(conn, sql, ct);
        }
        else
        {
            var sql = $"""
                SELECT TOP {top} Seq, Name1, Num, Bal, CloseAcc
                FROM File11n
                WHERE Cod = 1 AND CloseAcc = 0
                ORDER BY Name1
                """;
            rows = await QueryCreditAccountsAsync(conn, sql, ct);
        }

        await EnrichCreditAccountRowsAsync(rows, ct);
        return rows;
    }

    public async Task<IReadOnlyList<EdariCreditAccountRow>> GetCreditAccountsBySeqsAsync(
        IReadOnlyList<long> seqs, CancellationToken ct)
    {
        if (seqs.Count == 0) return [];

        var distinct = seqs.Distinct().ToList();
        var orderMap = seqs.Select((s, i) => (s, i)).ToDictionary(x => x.s, x => x.i);
        var bySeq = new Dictionary<long, EdariCreditAccountRow>();

        try
        {
            await using var conn = await connections.CreateOpenConnectionAsync(ct);
            var inList = string.Join(", ", distinct.Select(EdariSql.Long));
            var sql = $"""
                SELECT Seq, Name1, Num, Bal, CloseAcc
                FROM File11n
                WHERE Cod = 1 AND Seq IN ({inList})
                """;
            var edariRows = await QueryCreditAccountsAsync(conn, sql, ct);
            await EnrichCreditAccountRowsAsync(edariRows, ct);
            foreach (var row in edariRows)
                bySeq[row.Seq] = row;
        }
        catch
        {
            /* keep whatever File11n already returned */
        }

        return seqs
            .Where(bySeq.ContainsKey)
            .Select(s => bySeq[s])
            .OrderBy(a => orderMap[a.Seq])
            .ToList();
    }

    private static async Task<List<EdariCreditAccountRow>> QueryCreditAccountsAsync(
        DbConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<EdariCreditAccountRow>();
        while (await reader.ReadAsync(ct))
        {
            list.Add(new EdariCreditAccountRow
            {
                Seq = Convert.ToInt64(reader.GetValue(0)),
                Name = EdariStringHelper.ReadString(reader.GetValue(1)),
                Num = EdariStringHelper.ReadString(reader.GetValue(2)),
                Balance = reader.IsDBNull(3) ? 0 : Convert.ToDecimal(reader.GetValue(3)),
                CloseAcc = reader.IsDBNull(4) ? 0 : Convert.ToInt32(reader.GetValue(4)),
            });
        }
        return list;
    }

    private async Task EnrichCreditAccountRowsAsync(List<EdariCreditAccountRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return;
        var map = await LoadEdariNameMapAsync(
            $"SELECT Seq, Name1 FROM File11n WHERE Seq IN ({string.Join(",", rows.Select(r => r.Seq))})", ct);
        foreach (var row in rows)
        {
            if (map.TryGetValue(row.Seq, out var name))
                row.Name = name;
        }
    }

    private static List<EdariCreditAccountRow> MapCreditRowsFromText(IReadOnlyList<string?[]> rows)
    {
        var list = new List<EdariCreditAccountRow>();
        foreach (var row in rows)
        {
            if (row.Length < 2 || !long.TryParse(row[0], out var seq)) continue;
            list.Add(new EdariCreditAccountRow
            {
                Seq = seq,
                Name = EdariStringHelper.Normalize(row[1]),
                Num = row.Length > 2 ? EdariStringHelper.Normalize(row[2]) : null,
                Balance = row.Length > 3 && decimal.TryParse(row[3], out var bal) ? bal : 0,
                CloseAcc = row.Length > 4 && int.TryParse(row[4], out var closed) ? closed : 0,
            });
        }
        return list;
    }

    public async Task<IReadOnlyList<EdariCreditAccountRow>> GetCashBoxAccountsAsync(string? search, int limit, CancellationToken ct)
    {
        var top = Math.Clamp(limit, 1, 2000);
        var searching = !string.IsNullOrWhiteSpace(search);

        try
        {
            await using var conn = await connections.CreateOpenConnectionAsync(ct);

            if (searching)
            {
                var term = search.Trim();
                var rows = new List<EdariCreditAccountRow>();

                // 1) Exact account number first — "301" → QiCard, "3133" → هدايا.
                if (term.Length > 0 && char.IsDigit(term[0]))
                {
                    var exact = $"""
                        SELECT TOP {top} c.Seq, c.Name1, c.Num, c.Bal, c.CloseAcc
                        FROM File11n c
                        WHERE c.CloseAcc = 0 AND c.Cod = 1 AND c.Num = {SqlLikePublic(term)}
                        ORDER BY c.Num, c.Name1
                        """;
                    rows = await QueryCreditAccountsAsync(conn, exact, ct);
                }

                // 2) Whole-chart partial match (num / seq / latin name). NOTE: File11n has no
                //    Father column on this alias — keep to Master-free flat search here.
                if (rows.Count == 0)
                {
                    var pattern = SqlLikePublic($"%{term}%");
                    var partial = $"""
                        SELECT TOP {top} c.Seq, c.Name1, c.Num, c.Bal, c.CloseAcc
                        FROM File11n c
                        WHERE c.CloseAcc = 0 AND c.Cod = 1
                          AND (c.Num LIKE {pattern}
                               OR CAST(c.Seq AS VARCHAR(20)) LIKE {pattern}
                               OR c.Name1 LIKE {pattern})
                        ORDER BY c.Num, c.Name1
                        """;
                    rows = await QueryCreditAccountsAsync(conn, partial, ct);
                }

                if (rows.Count == 0 && EdariStringHelper.HasArabic(term))
                {
                    var pattern = term.Replace("'", "''");
                    var arabicRows = await textQuery.QueryAsync($"""
                        SELECT TOP {top} Seq, Name1, Num, Bal, CloseAcc
                        FROM File11n
                        WHERE Cod = 1 AND CloseAcc = 0 AND Name1 LIKE '%{pattern}%'
                        ORDER BY Name1
                        """, ct);
                    var fromEdari = MapCreditRowsFromText(arabicRows);
                    if (fromEdari.Count > 0) return fromEdari;
                }

                await EnrichCreditAccountRowsAsync(rows, ct);
                return rows;
            }

            // Browsing without a query: the curated cash-box roots (Master hierarchy only).
            var rootsInList = string.Join(", ", SectionPostingAccountRoots.RootNums.Select(n => $"'{n.Replace("'", "''")}'"));
            var sql = $"""
                SELECT TOP {top} c.Seq, c.Name1, c.Num, c.Bal, c.CloseAcc
                FROM File11n c
                INNER JOIN File11n p ON c.Master = p.Seq AND p.Num IN ({rootsInList})
                WHERE c.CloseAcc = 0 AND c.Cod = 1
                ORDER BY p.Num, c.Num, c.Name1
                """;
            var browseRows = await QueryCreditAccountsAsync(conn, sql, ct);
            await EnrichCreditAccountRowsAsync(browseRows, ct);
            return browseRows;
        }
        catch
        {
            return [];
        }
    }

    /// <summary>
    /// Every posting account (Cod=1) with its chart parent, for the local account cache.
    /// Name1 comes back unusable for Arabic on the ADO provider — the caller repairs it from
    /// <see cref="EdariTextQueryService"/> before storing.
    /// </summary>
    public async Task<IReadOnlyList<EdariChartAccountRow>> GetPostingAccountsAsync(CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = """
            SELECT c.Seq, c.Num, c.Name1, c.Bal, c.CloseAcc, c.Master, p.Num AS GroupNum, p.Name1 AS GroupName
            FROM File11n c
            LEFT JOIN File11n p ON c.Master = p.Seq
            WHERE c.Cod = 1
            ORDER BY c.Num
            """;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<EdariChartAccountRow>();
        while (await reader.ReadAsync(ct))
        {
            list.Add(new EdariChartAccountRow
            {
                Seq = Convert.ToInt64(reader.GetValue(0)),
                Num = EdariStringHelper.ReadString(reader.GetValue(1)),
                Name = EdariStringHelper.ReadString(reader.GetValue(2)),
                Balance = reader.IsDBNull(3) ? 0 : Convert.ToDecimal(reader.GetValue(3)),
                Closed = !reader.IsDBNull(4) && Convert.ToInt32(reader.GetValue(4)) != 0,
                Master = reader.IsDBNull(5) ? 0 : Convert.ToInt64(reader.GetValue(5)),
                GroupNum = EdariStringHelper.ReadString(reader.GetValue(6)),
                GroupName = EdariStringHelper.ReadString(reader.GetValue(7)),
            });
        }
        return list;
    }

    public async Task<IReadOnlyList<EdariCreditAccountRow>> GetCashBoxAccountsBySeqsAsync(
        IReadOnlyList<long> seqs, CancellationToken ct)
    {
        if (seqs.Count == 0) return [];

        var distinct = seqs.Where(s => s > 0).Distinct().ToList();
        if (distinct.Count == 0) return [];

        var orderMap = seqs.Select((s, i) => (s, i)).ToDictionary(x => x.s, x => x.i);
        var bySeq = new Dictionary<long, EdariCreditAccountRow>();

        try
        {
            await using var conn = await connections.CreateOpenConnectionAsync(ct);
            var inList = string.Join(", ", distinct.Select(EdariSql.Long));
            var sql = $"""
                SELECT Seq, Name1, Num, Bal, CloseAcc
                FROM File11n
                WHERE Seq IN ({inList})
                """;
            var edariRows = await QueryCreditAccountsAsync(conn, sql, ct);
            await EnrichCreditAccountRowsAsync(edariRows, ct);
            foreach (var row in edariRows)
                bySeq[row.Seq] = row;
        }
        catch
        {
            /* fall back to cached labels only */
        }

        return seqs
            .Where(s => s > 0 && bySeq.ContainsKey(s))
            .Select(s => bySeq[s])
            .OrderBy(a => orderMap[a.Seq])
            .ToList();
    }
}
