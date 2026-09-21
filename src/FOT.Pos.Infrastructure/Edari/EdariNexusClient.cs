using System.Data.Common;
using Dapper;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Edari;

public sealed partial class EdariNexusClient(
    EdariConnectionFactory connections,
    EdariSettingsService settings,
    EdariTextQueryService textQuery,
    HayatLegacyNameService hayatNames)
{
    public async Task<EdariConnectionTestResult> TestConnectionAsync(CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!EdariConnectionFactory.DataFolderExists(opts))
        {
            return new EdariConnectionTestResult(
                false,
                $"مجلد النسخة غير موجود: {opts.YearFolder}",
                null, null, DateTime.UtcNow);
        }

        try
        {
            // User-initiated probe: bypass the circuit breaker so «اختبار الاتصال» always
            // reflects the real server state; a success here also resets the breaker.
            await using var conn = await connections.CreateOpenConnectionAsync(breakerBypass: true, ct);
            var matCount = await ScalarIntAsync(conn, "SELECT COUNT(*) FROM File13n", ct);
            int? offerCount = null;
            try { offerCount = await ScalarIntAsync(conn, "SELECT COUNT(*) FROM FilePosO", ct); }
            catch { /* table may be empty or named differently */ }

            return new EdariConnectionTestResult(
                true,
                $"متصل بنجاح — نسخة {opts.DatabaseAlias} ({matCount:N0} مادة في شجرة File13n)",
                matCount, offerCount, DateTime.UtcNow);
        }
        catch (Exception ex)
        {
            return new EdariConnectionTestResult(
                false,
                FormatConnectionError(ex),
                null, null, DateTime.UtcNow);
        }
    }

    public async Task<IReadOnlyList<EdariTreeNodeDto>> GetMaterialTreeAsync(long? parentSeq, string? search, int limit, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        var top = Math.Clamp(limit, 1, 2000);
        const string selectCols = """
            f.Seq, f.Father, f.Name1 AS Name, f.Num, f.Barcode,
            CASE WHEN EXISTS(SELECT 1 FROM File13n c WHERE c.Father = f.Seq) THEN 1 ELSE 0 END AS IsFolder,
            CASE WHEN EXISTS(SELECT 1 FROM File13n c WHERE c.Father = f.Seq) THEN 1 ELSE 0 END AS HasChildren,
            COALESCE(f.SellPr4, 0) AS Price
            """;

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = SqlLike($"%{search.Trim()}%");
            var sql = $"""
                SELECT TOP {top} {selectCols}
                FROM File13n f
                WHERE f.Name1 LIKE {pattern} OR f.Num LIKE {pattern} OR f.Barcode LIKE {pattern}
                ORDER BY IsFolder DESC, f.Name1
                """;
            var rows = await QueryTreeRowsAsync(conn, sql, ct);
            await ApplyEdariTreeNamesAsync(rows, ct);
            return rows.Select(r => r.ToDto()).ToList();
        }

        if (parentSeq is null)
        {
            var sql = $"""
                SELECT TOP {top} {selectCols}
                FROM File13n f
                WHERE f.Father = 0 OR f.Father IS NULL
                ORDER BY IsFolder DESC, f.Name1
                """;
            var rows = await QueryTreeRowsAsync(conn, sql, ct);
            await ApplyEdariTreeNamesAsync(rows, ct);
            return rows.Select(r => r.ToDto()).ToList();
        }

        var childSql = $"""
            SELECT TOP {top} {selectCols}
            FROM File13n f
            WHERE f.Father = {parentSeq.Value}
            ORDER BY IsFolder DESC, f.Name1
            """;
        var items = await QueryTreeRowsAsync(conn, childSql, ct);
        await ApplyEdariTreeNamesAsync(items, ct);
        return items.Select(r => r.ToDto()).ToList();
    }

    public async Task<string?> GetNodeNameAsync(long seq, CancellationToken ct)
    {
        var map = await LoadEdariNameMapAsync($"SELECT Seq, Name1 FROM File13n WHERE Seq = {seq}", ct);
        if (map.TryGetValue(seq, out var arabic) && EdariStringHelper.IsReadableName(arabic))
            return arabic;
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        var edari = await ScalarStringAsync(conn, $"SELECT Name1 FROM File13n WHERE Seq = {seq}", ct);
        return EdariStringHelper.PreferEdariProductName(edari) ?? EdariStringHelper.Normalize(edari);
    }

    public async Task<IReadOnlyList<long>> GetDescendantProductSeqsAsync(long treeSeq, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        return await GetDescendantProductSeqsIterativeAsync(conn, treeSeq, ct);
    }

    public async Task<int> CountDescendantProductsAsync(long treeSeq, CancellationToken ct)
    {
        var seqs = await GetDescendantProductSeqsAsync(treeSeq, ct);
        return seqs.Count;
    }

    private static async Task<IReadOnlyList<long>> GetDescendantProductSeqsIterativeAsync(
        DbConnection conn, long treeSeq, CancellationToken ct)
    {
        var products = new List<long>();
        var frontier = new Queue<long>();
        frontier.Enqueue(treeSeq);

        while (frontier.Count > 0)
        {
            var parent = frontier.Dequeue();
            var children = await QueryInt64ListAsync(conn,
                $"SELECT Seq FROM File13n WHERE Father = {parent}", ct);

            if (children.Count == 0)
            {
                if (parent != treeSeq)
                    products.Add(parent);
                continue;
            }

            foreach (var child in children)
                frontier.Enqueue(child);
        }

        return products;
    }

    public async Task<IReadOnlyList<EdariBranchRow>> GetBranchesAsync(CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = """
            SELECT Seq, Name, Symbol
            FROM FileBrch
            ORDER BY Seq
            """;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var arabic = await LoadEdariNameMapAsync("SELECT Seq, Name FROM FileBrch", ct);
        var list = new List<EdariBranchRow>();
        while (await reader.ReadAsync(ct))
        {
            var seq = Convert.ToInt64(reader.GetValue(0));
            var edariRawName = EdariStringHelper.ReadString(reader.GetValue(1));
            var symbol = EdariStringHelper.ReadString(reader.GetValue(2));
            arabic.TryGetValue(seq, out var fromEdari);
            var name = EdariStringHelper.IsReadableName(fromEdari)
                ? fromEdari
                : EdariStringHelper.PreferEdariProductName(edariRawName) ?? edariRawName;
            list.Add(new EdariBranchRow
            {
                Seq = seq,
                EdariName = edariRawName,
                Name = name,
                Symbol = symbol,
            });
        }
        return list;
    }

    public async Task<IReadOnlyList<EdariMaterialRow>> GetMaterialsBatchAsync(long afterSeq, int limit, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        var top = Math.Clamp(limit, 1, 2000);
        var sql = $"""
            SELECT TOP {top}
                Seq, Num, Name1, Barcode, Father, Sub, SellPr4, SellPr5, CurTot1
            FROM File13n
            WHERE Seq > {afterSeq}
            ORDER BY Seq
            """;
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<EdariMaterialRow>();
        while (await reader.ReadAsync(ct))
        {
            list.Add(new EdariMaterialRow
            {
                Seq = reader.IsDBNull(0) ? 0 : Convert.ToInt64(reader.GetValue(0) ?? 0),
                Num = EdariStringHelper.ReadString(reader.GetValue(1)),
                Name1 = EdariStringHelper.ReadString(reader.GetValue(2)),
                Barcode = EdariStringHelper.ReadString(reader.GetValue(3)),
                Father = ToInt32(reader, 4),
                Sub = ToInt32(reader, 5),
                SellPr4 = ToDouble(reader, 6),
                SellPr5 = ToDouble(reader, 7),
                CurTot1 = ToDouble(reader, 8),
            });
        }

        await ApplyEdariMaterialNamesAsync(list, ct);
        return list;
    }

    public async Task<IReadOnlyList<EdariSellerRow>> GetSalesmenAsync(CancellationToken ct)
    {
        foreach (var sql in new[]
        {
            "SELECT Seq, Name1, Num FROM SaleMan ORDER BY Seq",
            "SELECT Seq, Name, Num FROM SaleMan ORDER BY Seq",
            "SELECT Seq, Name1, Num FROM FileSaleMan ORDER BY Seq",
            "SELECT Seq, Name1, Num FROM SalesMan ORDER BY Seq",
        })
        {
            var rows = await textQuery.QueryAsync(sql, ct);
            var sellers = MapSellerRows(rows);
            if (sellers.Count > 0) return sellers;
        }

        // Edari 2026 has no SaleMan Nexus table. FilePOS5.SaleMan is an id only.
        // FileCash is cashiers. File11n Cod=2 is chart folders.
        // The Edari screen «أسماء البائعين» writes the 1..250 register that those ids use.
        var register = await hayatNames.GetEdariSalesmenAsync(ct);
        return register.Count > 0 ? register : [];
    }

    public async Task<EdariCatalogFingerprint> GetCatalogFingerprintAsync(CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);

        // Single round-trip: this runs every detect cycle against the production
        // accounting DB, so ~10 separate aggregate queries became one statement.
        long materials = 0, maxSeq = 0, priceKey = 0, qtyKey = 0, nameLen = 0;
        long branches = 0, branchMax = 0;
        string? nameBound = null;
        await using (var cmd = conn.CreateEdariCommand())
        {
            cmd.CommandText = """
                SELECT
                  (SELECT COUNT(*) FROM File13n),
                  (SELECT COALESCE(MAX(Seq), 0) FROM File13n),
                  (SELECT COALESCE(SUM(SellPr4), 0) FROM File13n),
                  (SELECT COALESCE(SUM(CurTot1), 0) FROM File13n),
                  (SELECT COALESCE(SUM(LEN(Name1)), 0) FROM File13n),
                  (SELECT COUNT(*) FROM FileBrch),
                  (SELECT COALESCE(MAX(Seq), 0) FROM FileBrch)
                """;
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                materials = ToLong(reader.GetValue(0));
                maxSeq = ToLong(reader.GetValue(1));
                priceKey = ToLong(reader.GetValue(2));
                qtyKey = ToLong(reader.GetValue(3));
                nameLen = ToLong(reader.GetValue(4));
                branches = ToLong(reader.GetValue(5));
                branchMax = ToLong(reader.GetValue(6));
            }
        }

        try
        {
            await using var namesCmd = conn.CreateEdariCommand();
            namesCmd.CommandText = "SELECT MAX(Name1), MIN(Name1) FROM File13n";
            await using var namesReader = await namesCmd.ExecuteReaderAsync(ct);
            if (await namesReader.ReadAsync(ct))
            {
                nameBound = string.Concat(
                    EdariStringHelper.ReadString(namesReader.GetValue(0)),
                    "\u001f",
                    EdariStringHelper.ReadString(namesReader.GetValue(1)));
            }
        }
        catch
        {
            /* Nexus may refuse MIN/MAX on Name1 — length token still detects most edits */
        }

        var edariSellers = await GetSalesmenAsync(ct);
        long sellers = edariSellers.Count;
        long sellerMax = edariSellers.Count == 0 ? 0 : edariSellers.Max(s => s.Seq);
        long sellerLen = edariSellers.Sum(s => (s.Name ?? "").Length);

        return EdariCatalogFingerprint.FromParts(
            materials, maxSeq, priceKey, qtyKey, nameLen,
            sellers, sellerMax, sellerLen,
            branches, branchMax,
            nameBound);
    }

    public async Task<EdariDashboardStatsDto> GetDashboardStatsAsync(CancellationToken ct)
    {
        var materialsTask = ScalarOnConnectionAsync("SELECT COUNT(*) FROM File13n", ct);
        var treeFoldersTask = ScalarOnConnectionAsync("""
            SELECT COUNT(*) FROM File13n f
            WHERE EXISTS (SELECT 1 FROM File13n c WHERE c.Father = f.Seq)
            """, ct);
        var sellersTask = GetSalesmenAsync(ct);
        var branchesTask = ScalarOnConnectionAsync("SELECT COUNT(*) FROM FileBrch", ct);

        await Task.WhenAll(materialsTask, treeFoldersTask, sellersTask, branchesTask);
        return new EdariDashboardStatsDto(
            await materialsTask,
            await treeFoldersTask,
            (await sellersTask).Count,
            await branchesTask);
    }

    private async Task<int> ScalarOnConnectionAsync(string sql, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        return await ScalarIntAsync(conn, sql, ct);
    }

    public async Task<bool> MaterialExistsAsync(long seq, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        var count = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Seq = {seq}", ct);
        return count > 0;
    }

    public async Task<IReadOnlyList<EdariOfferRow>> GetOffersAsync(CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<EdariOfferRow>(new CommandDefinition(
                "SELECT Seq, Name, Kind, Branch, FromDate, ToDate FROM FilePosO ORDER BY Seq",
                cancellationToken: ct));
            return rows.ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<IReadOnlyList<EdariOfferMaterialRow>> GetOfferMaterialsAsync(CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<EdariOfferMaterialRow>(new CommandDefinition(
                """
                SELECT om.Seq, om.MasterSeq, om.MatSeq, om.Discount, om.DiscountType,
                       f.Name1 AS MatName, f.Num AS MatNum
                FROM FilePosO_Mats om
                LEFT JOIN File13n f ON f.Seq = om.MatSeq
                ORDER BY om.Seq
                """,
                cancellationToken: ct));
            return rows.ToList();
        }
        catch
        {
            // Fallback: offer lines may be embedded — caller handles empty list
            return [];
        }
    }

    internal static string FormatConnectionError(Exception ex)
    {
        var msg = ex.Message;
        if (msg.Contains("Trial period has expired", StringComparison.OrdinalIgnoreCase))
            return "انتهت فترة تجربة Devart ODBC — غيّر وضع الاتصال إلى ADO (الموصى) من إعدادات الإداري.";
        if (msg.Contains("AdoServerConnector", StringComparison.OrdinalIgnoreCase))
            return "موفر ADO يحتاج AdoServerConnectorV4_64.dll — تأكد من وجود ملفات Native بجانب الـ API أو حدّد مسار الموصل.";
        if (msg.Contains("NexusDB.ADOProvider", StringComparison.OrdinalIgnoreCase)
            && msg.Contains("not found", StringComparison.OrdinalIgnoreCase))
            return "تعذر تحميل NexusDB.ADOProvider.dll — انسخ الملف من FOT POS القديم أو ثبّت موفر ADO من NexusDB.";
        if (msg.Contains("GetLastError", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("External component has thrown an exception", StringComparison.OrdinalIgnoreCase))
            return "تعذر الاتصال بخادم NexusDB — تأكد أن EdariNX يعمل وأن المنفذ 16000 مفتوح على 127.0.0.1.";
        if (msg.Contains("Data source name not found", StringComparison.OrdinalIgnoreCase))
            return "تعذر العثور على ODBC Driver — استخدم وضع ADO أو ثبّت Devart ODBC Driver for NexusDB.";
        return msg;
    }

    private async Task ApplyEdariTreeNamesAsync(List<TreeRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return;
        var map = await LoadEdariNameMapAsync(
            $"SELECT Seq, Name1 FROM File13n WHERE Seq IN ({string.Join(",", rows.Select(r => r.Seq))})", ct);
        foreach (var row in rows)
            row.Name = map.GetValueOrDefault(row.Seq)
                ?? EdariStringHelper.PreferEdariProductName(row.Name)
                ?? row.Name;
    }

    private async Task ApplyEdariMaterialNamesAsync(List<EdariMaterialRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return;
        var map = await LoadEdariNameMapAsync(
            $"SELECT Seq, Name1 FROM File13n WHERE Seq IN ({string.Join(",", rows.Select(r => r.Seq))})", ct);
        foreach (var row in rows)
        {
            if (map.TryGetValue(row.Seq, out var arabic))
                row.Name1 = arabic;
            else
                row.Name1 = EdariStringHelper.PreferEdariProductName(row.Name1) ?? row.Name1;
        }
    }

    internal async Task<Dictionary<long, string>> LoadEdariNameMapAsync(string sql, CancellationToken ct)
    {
        var map = new Dictionary<long, string>();
        try
        {
            var rows = await textQuery.QueryAsync(sql, ct);
            foreach (var row in rows)
            {
                if (row.Length < 2) continue;
                if (!long.TryParse(row[0], out var seq)) continue;
                var name = EdariStringHelper.Normalize(row[1]);
                if (EdariStringHelper.IsReadableName(name))
                    map[seq] = name!;
            }
        }
        catch
        {
            /* Arabic channel unavailable — caller keeps the ADO name */
        }
        return map;
    }

    private static List<EdariSellerRow> MapSellerRows(IReadOnlyList<string?[]> rows)
    {
        var list = new List<EdariSellerRow>();
        foreach (var row in rows)
        {
            if (row.Length < 2 || !long.TryParse(row[0], out var seq) || seq <= 0) continue;
            var name = EdariStringHelper.Normalize(row[1]);
            if (!EdariStringHelper.IsReadableName(name)) continue;
            list.Add(new EdariSellerRow
            {
                Seq = seq,
                Name = name,
                Num = row.Length > 2 ? EdariStringHelper.Normalize(row[2]) : null,
            });
        }
        return list;
    }

    private static async Task<List<TreeRow>> QueryTreeRowsAsync(
        DbConnection conn, string sql, CancellationToken ct, params object[] parameters)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        AddParameters(cmd, parameters);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<TreeRow>();
        while (await reader.ReadAsync(ct))
        {
            list.Add(new TreeRow
            {
                Seq = Convert.ToInt64(reader.GetValue(0)),
                Father = reader.IsDBNull(1) ? null : Convert.ToInt64(reader.GetValue(1)),
                Name = EdariStringHelper.ReadString(reader.GetValue(2)),
                Num = EdariStringHelper.ReadString(reader.GetValue(3)),
                Barcode = EdariStringHelper.ReadString(reader.GetValue(4)),
                IsFolder = reader.IsDBNull(5) ? 0 : Convert.ToInt32(reader.GetValue(5)),
                HasChildren = reader.IsDBNull(6) ? 0 : Convert.ToInt32(reader.GetValue(6)),
                Price = reader.FieldCount > 7 && !reader.IsDBNull(7) ? Convert.ToDecimal(reader.GetValue(7)) : 0,
            });
        }
        return list;
    }

    private static async Task<List<long>> QueryInt64ListAsync(
        DbConnection conn, string sql, CancellationToken ct, params object[] parameters)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        AddParameters(cmd, parameters);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<long>();
        while (await reader.ReadAsync(ct))
            list.Add(Convert.ToInt64(reader.GetValue(0)));
        return list;
    }

    private static async Task<string?> ScalarStringAsync(
        DbConnection conn, string sql, CancellationToken ct, params object[] parameters)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        AddParameters(cmd, parameters);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is null or DBNull ? null : EdariStringHelper.ReadString(result);
    }

    private static int ToInt32(System.Data.Common.DbDataReader reader, int ordinal)
    {
        var v = ReadScalar(reader, ordinal);
        return v is null ? 0 : Convert.ToInt32(v);
    }

    private static double ToDouble(System.Data.Common.DbDataReader reader, int ordinal)
    {
        var v = ReadScalar(reader, ordinal);
        return v is null ? 0 : Convert.ToDouble(v);
    }

    private static object? ReadScalar(System.Data.Common.DbDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal)) return null;
        var v = reader.GetValue(ordinal);
        if (v is null) return null;
        if (v is byte[] bytes)
            return bytes.Length == 0 ? null : bytes[0];
        return v;
    }

    private static string SqlLike(string pattern) => SqlLikePublic(pattern);

    private static void AddParameters(DbCommand cmd, object[] parameters)
    {
        foreach (var val in parameters)
        {
            var p = cmd.CreateParameter()
                ?? throw new InvalidOperationException("NexusDB ADO CreateParameter returned null — use literal SQL for this query.");
            p.Value = val ?? DBNull.Value;
            cmd.Parameters.Add(p);
        }
    }

    private static async Task<int> ScalarIntAsync(DbConnection conn, string sql, CancellationToken ct, params object[] parameters)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        AddParameters(cmd, parameters);
        var result = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt32(result ?? 0);
    }

    private static async Task<long> ScalarLongAsync(DbConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        var result = await cmd.ExecuteScalarAsync(ct);
        return ToLong(result);
    }

    private static async Task<long> TryScalarLongAsync(DbConnection conn, string sql, CancellationToken ct)
    {
        try { return await ScalarLongAsync(conn, sql, ct); }
        catch { return 0; }
    }

    private static long ToLong(object? result)
    {
        if (result is null or DBNull) return 0;
        try { return Convert.ToInt64(Convert.ToDecimal(result)); }
        catch
        {
            try { return Convert.ToInt64(Math.Round(Convert.ToDouble(result))); }
            catch { return 0; }
        }
    }

    private sealed class TreeRow
    {
        public long Seq { get; set; }
        public long? Father { get; set; }
        public string? Name { get; set; }
        public string? Num { get; set; }
        public string? Barcode { get; set; }
        public int IsFolder { get; set; }
        public int HasChildren { get; set; }
        public decimal Price { get; set; }
        public EdariTreeNodeDto ToDto() => new(Seq, Father, Name, Num, Barcode, IsFolder == 1, HasChildren == 1, Price);
    }
}

public sealed record EdariDashboardStatsDto(
    int Materials,
    int TreeFolders,
    int Salesmen,
    int Branches);

public sealed class EdariOfferRow
{
    public long Seq { get; set; }
    public string? Name { get; set; }
    public int Kind { get; set; }
    public int Branch { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
}

public sealed class EdariBranchRow
{
    public long Seq { get; set; }
    /// <summary>Name read directly from Edari FileBrch (ADO; may be repaired via text query).</summary>
    public string? EdariName { get; set; }
    public string? Name { get; set; }
    public string? Symbol { get; set; }
    public string DisplayName => EdariStringHelper.FormatLabel(Name, Symbol, Seq);
    public string SyncName => EdariStringHelper.ResolveBranchSyncName(EdariName, Name, Symbol, Seq);
}

public sealed class EdariMaterialRow
{
    public long Seq { get; set; }
    public string? Num { get; set; }
    public string? Name1 { get; set; }
    public string? Barcode { get; set; }
    public int Father { get; set; }
    public int Sub { get; set; }
    public double SellPr4 { get; set; }
    public double SellPr5 { get; set; }
    public double CurTot1 { get; set; }
}

public sealed class EdariOfferMaterialRow
{
    public long Seq { get; set; }
    public long MasterSeq { get; set; }
    public long MatSeq { get; set; }
    public decimal Discount { get; set; }
    public int DiscountType { get; set; }
    public string? MatName { get; set; }
    public string? MatNum { get; set; }
}
