using System.Data;
using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Services;

public sealed class SystemBackupService
{
    private readonly ISqlConnectionFactory _db;
    private readonly ILogger<SystemBackupService> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _backupDir;
    private readonly string _settingsPath;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };

    private static readonly HashSet<string> SkippedTables = new(StringComparer.OrdinalIgnoreCase)
    {
        "schema_migrations",
        "sysdiagrams",
        "ext_client_errors",
    };

    private static readonly Dictionary<string, string> SectionLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["offers"] = "العروض والتخفيضات والمجلدات",
        ["commissions"] = "العمولات والأهداف وكشوف التسليم",
        ["people_settings"] = "الكاشير والبائعون والأقسام والإعدادات",
        ["receipts"] = "الفواتير وحركات البيع والصندوق",
        ["catalog"] = "كتالوج المواد والحسابات (الإداري)",
    };

    public SystemBackupService(ISqlConnectionFactory db, ILogger<SystemBackupService> log)
    {
        _db = db;
        _log = log;
        _backupDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "FOT.Pos",
            "backups");
        Directory.CreateDirectory(_backupDir);
        _settingsPath = Path.Combine(_backupDir, "backup-settings.json");
    }

    public string BackupFolder => _backupDir;

    public static string ClassifyTable(string tableName)
    {
        var n = tableName.ToLowerInvariant();
        if (n is "articles" or "edari_branches" or "ext_edari_accounts" or "ext_catalog_version"
            || n.StartsWith("edari_"))
            return "catalog";
        if (n.StartsWith("offer") || n.StartsWith("ext_offer") || n.Contains("_offer_"))
            return "offers";
        if (n.Contains("commission") || n.Contains("target") || n.Contains("settlement"))
            return "commissions";
        if (n.StartsWith("reciept") || n.StartsWith("receipt") || n.Contains("_receipt")
            || n is "sales" or "pos_logs" or "ext_cashier_voids")
            return "receipts";
        return "people_settings";
    }

    public BackupSettingsDto GetSettings()
    {
        var stored = ReadStoredSettings();
        var files = ListBackupFilesInternal();
        var lastBackup = files.FirstOrDefault()?.CreatedAt;
        var totalBytes = files.Sum(f => f.SizeBytes);
        return new BackupSettingsDto(
            stored.AutoBackupEnabled,
            Math.Clamp(stored.IntervalHours, 1, 168),
            Math.Clamp(stored.RetainCount, 2, 100),
            stored.IncludeCatalogInAuto,
            _backupDir,
            stored.LastAutoBackupAt,
            lastBackup,
            files.Count,
            totalBytes);
    }

    public BackupSettingsDto SaveSettings(UpdateBackupSettingsRequest req)
    {
        var cur = ReadStoredSettings();
        var next = cur with
        {
            AutoBackupEnabled = req.AutoBackupEnabled,
            IntervalHours = Math.Clamp(req.IntervalHours, 1, 168),
            RetainCount = Math.Clamp(req.RetainCount, 2, 100),
            IncludeCatalogInAuto = req.IncludeCatalogInAuto,
        };
        WriteStoredSettings(next);
        return GetSettings();
    }

    public IReadOnlyList<BackupFileItemDto> ListBackups() => ListBackupFilesInternal();

    public string? ResolveBackupFilePath(string fileName)
    {
        var safe = Path.GetFileName(fileName);
        if (string.IsNullOrWhiteSpace(safe) || !safe.EndsWith(".fotbackup", StringComparison.OrdinalIgnoreCase))
            return null;
        var full = Path.Combine(_backupDir, safe);
        return File.Exists(full) ? full : null;
    }

    public bool DeleteBackup(string fileName)
    {
        var path = ResolveBackupFilePath(fileName);
        if (path is null) return false;
        File.Delete(path);
        return true;
    }

    public async Task<BackupFileItemDto> CreateBackupAsync(
        string? label,
        bool includeCatalog,
        bool isAuto,
        CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return await CreateBackupInternalAsync(label, includeCatalog, isAuto, ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<BackupFileItemDto> CreateBackupInternalAsync(
        string? label,
        bool includeCatalog,
        bool isAuto,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var localNow = now.ToLocalTime();
        var cleanLabel = string.IsNullOrWhiteSpace(label)
            ? (isAuto ? "نسخة تلقائية" : "نسخة احتياطية يدوية")
            : label.Trim();
        var prefix = isAuto ? "auto" : "backup";
        var fileName = $"{prefix}-{localNow:yyyyMMdd-HHmmss}.fotbackup";
        var fullPath = Path.Combine(_backupDir, fileName);

        await using var conn = (SqlConnection)await _db.CreateOpenConnectionAsync(ct);
        var tablesMeta = await LoadDatabaseTablesAsync(conn, includeCatalog, ct);

        var tableEntries = new List<BackupTableInfoDto>(tablesMeta.Count);
        var rowCounts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);

        await using (var fs = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None))
        using (var zip = new ZipArchive(fs, ZipArchiveMode.Create, leaveOpen: false))
        {
            foreach (var table in tablesMeta)
            {
                var dump = await DumpTableAsync(conn, table, ct);
                rowCounts[table.Name] = dump.Rows.Count;
                tableEntries.Add(new BackupTableInfoDto(table.Name, table.Section, dump.Rows.Count, table.HasIdentity));

                var entry = zip.CreateEntry($"tables/{table.Name}.json", CompressionLevel.Optimal);
                await using var es = entry.Open();
                await JsonSerializer.SerializeAsync(es, dump, JsonOpts, ct);
            }

            var summary = new BackupSummaryCountsDto(
                OffersCount: (int)rowCounts.GetValueOrDefault("offers"),
                CommissionGroupsCount: (int)rowCounts.GetValueOrDefault("ext_commission_groups"),
                TargetsCount: (int)rowCounts.GetValueOrDefault("ext_target_rules"),
                CashiersCount: (int)rowCounts.GetValueOrDefault("cashiers"),
                SalesmenCount: (int)rowCounts.GetValueOrDefault("salesmen"),
                SectionsCount: (int)rowCounts.GetValueOrDefault("sections"),
                ReceiptsCount: (int)rowCounts.GetValueOrDefault("reciepts"),
                ArticlesCount: (int)rowCounts.GetValueOrDefault("articles"),
                TablesCount: tableEntries.Count,
                TotalRows: tableEntries.Sum(t => t.RowCount));

            var sections = SectionLabels.Select(kv =>
            {
                var matching = tableEntries.Where(t => string.Equals(t.Section, kv.Key, StringComparison.OrdinalIgnoreCase)).ToList();
                return new BackupSectionInfoDto(kv.Key, kv.Value, matching.Count, matching.Sum(x => x.RowCount));
            }).Where(s => s.TableCount > 0).ToList();

            var appVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "2.3.2";
            var manifest = new BackupManifestDto(
                FormatVersion: 1,
                CreatedAt: now,
                AppVersion: appVersion,
                Label: cleanLabel,
                IncludeCatalog: includeCatalog,
                Summary: summary,
                Sections: sections,
                Tables: tableEntries);

            var mfEntry = zip.CreateEntry("manifest.json", CompressionLevel.Optimal);
            await using (var ms = mfEntry.Open())
            {
                await JsonSerializer.SerializeAsync(ms, manifest, JsonOpts, ct);
            }
        }

        if (isAuto)
        {
            var st = ReadStoredSettings() with { LastAutoBackupAt = now };
            WriteStoredSettings(st);
            PruneOldBackups(st.RetainCount);
        }

        var fi = new FileInfo(fullPath);
        _log.LogInformation("Created backup {File} ({Size} bytes, catalog={Catalog})", fileName, fi.Length, includeCatalog);
        var mf = ReadManifestFromZip(fullPath);
        return new BackupFileItemDto(
            fileName,
            cleanLabel,
            now,
            fi.Length,
            includeCatalog,
            isAuto,
            mf?.Summary);
    }

    public BackupManifestDto InspectBackupStream(Stream zipStream)
    {
        using var zip = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true);
        var entry = zip.GetEntry("manifest.json")
            ?? throw new InvalidOperationException("ملف النسخة الاحتياطية غير صالح (لا يحتوي manifest.json).");
        using var s = entry.Open();
        return JsonSerializer.Deserialize<BackupManifestDto>(s, JsonOpts)
            ?? throw new InvalidOperationException("تعذر قراءة بيانات النسخة الاحتياطية.");
    }

    public BackupManifestDto InspectStoredBackup(string fileName)
    {
        var path = ResolveBackupFilePath(fileName)
            ?? throw new FileNotFoundException("ملف النسخة الاحتياطية غير موجود.");
        using var fs = File.OpenRead(path);
        return InspectBackupStream(fs);
    }

    public async Task<RestoreBackupResultDto> RestoreFromStoredAsync(
        string fileName,
        RestoreBackupRequest req,
        CancellationToken ct)
    {
        var path = ResolveBackupFilePath(fileName)
            ?? throw new FileNotFoundException("ملف النسخة الاحتياطية غير موجود.");
        await using var fs = File.OpenRead(path);
        return await RestoreFromStreamAsync(fs, req, ct);
    }

    public async Task<RestoreBackupResultDto> RestoreFromStreamAsync(
        Stream zipStream,
        RestoreBackupRequest req,
        CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            // Verify archive first
            var manifest = InspectBackupStream(zipStream);
            zipStream.Position = 0;

            string? safetyFile = null;
            if (req.CreateSafetyBackup)
            {
                try
                {
                    var safety = await CreateBackupInternalAsync("نسخة أمان تلقائية قبل الاستعادة", includeCatalog: false, isAuto: false, ct);
                    safetyFile = safety.FileName;
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Safety backup before restore failed");
                }
            }

            var selectedSections = req.Sections is { Count: > 0 }
                ? new HashSet<string>(req.Sections, StringComparer.OrdinalIgnoreCase)
                : null;

            using var zip = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true);
            await using var conn = (SqlConnection)await _db.CreateOpenConnectionAsync(ct);
            var liveTables = (await LoadDatabaseTablesAsync(conn, includeCatalog: true, ct))
                .ToDictionary(t => t.Name, StringComparer.OrdinalIgnoreCase);

            var targetTables = manifest.Tables
                .Where(t => selectedSections is null || selectedSections.Contains(t.Section))
                .Where(t => liveTables.ContainsKey(t.Name))
                .ToList();

            if (targetTables.Count == 0)
            {
                return new RestoreBackupResultDto(false, "لا توجد جداول مطابقة للاستعادة في الأقسام المحددة.", 0, 0, safetyFile);
            }

            await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
            try
            {
                // 1. Disable constraints on target tables
                foreach (var t in targetTables)
                {
                    await ExecuteRawAsync(conn, tx, $"ALTER TABLE [dbo].[{EscapeId(t.Name)}] NOCHECK CONSTRAINT ALL;", ct);
                }

                // 2. Delete existing rows from target tables
                foreach (var t in targetTables)
                {
                    await ExecuteRawAsync(conn, tx, $"DELETE FROM [dbo].[{EscapeId(t.Name)}];", ct);
                }

                // 3. Bulk insert rows from backup
                var restoredTables = 0;
                long restoredRows = 0;
                foreach (var t in targetTables)
                {
                    var entry = zip.GetEntry($"tables/{t.Name}.json");
                    if (entry is null) continue;

                    TableDumpPayload? dump;
                    await using (var es = entry.Open())
                    {
                        dump = await JsonSerializer.DeserializeAsync<TableDumpPayload>(es, JsonOpts, ct);
                    }
                    if (dump is null || dump.Rows.Count == 0)
                    {
                        restoredTables++;
                        continue;
                    }

                    var liveMeta = liveTables[t.Name];
                    var count = await RestoreTableRowsAsync(conn, tx, liveMeta, dump, ct);
                    restoredTables++;
                    restoredRows += count;
                }

                // 4. Re-enable constraints
                foreach (var t in targetTables)
                {
                    await ExecuteRawAsync(conn, tx, $"ALTER TABLE [dbo].[{EscapeId(t.Name)}] WITH CHECK CHECK CONSTRAINT ALL;", ct);
                }

                await tx.CommitAsync(ct);
                _log.LogInformation("Restored {Tables} tables ({Rows} rows) from backup", restoredTables, restoredRows);
                return new RestoreBackupResultDto(
                    true,
                    $"تمت استعادة {restoredTables} جدول ({restoredRows:N0} سجل) بنجاح.",
                    restoredTables,
                    restoredRows,
                    safetyFile);
            }
            catch (Exception ex)
            {
                try { await tx.RollbackAsync(ct); } catch { /* ignore */ }
                _log.LogError(ex, "Backup restore failed and was rolled back");
                throw new InvalidOperationException($"فشلت الاستعادة وتم التراجع الكامل دون فقدان بياناتك: {ex.Message}");
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task<long> RestoreTableRowsAsync(
        SqlConnection conn,
        SqlTransaction tx,
        DbTableMeta liveMeta,
        TableDumpPayload dump,
        CancellationToken ct)
    {
        var liveColsByName = liveMeta.Columns.ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
        var mappedCols = new List<(int DumpIndex, DbColumnMeta LiveCol)>();
        for (var i = 0; i < dump.Columns.Count; i++)
        {
            if (liveColsByName.TryGetValue(dump.Columns[i].Name, out var liveCol))
                mappedCols.Add((i, liveCol));
        }
        if (mappedCols.Count == 0) return 0;

        using var dt = new DataTable(liveMeta.Name);
        foreach (var (_, col) in mappedCols)
        {
            dt.Columns.Add(col.Name, GetClrType(col.SqlType));
        }

        foreach (var row in dump.Rows)
        {
            var dr = dt.NewRow();
            foreach (var (dumpIdx, col) in mappedCols)
            {
                if (dumpIdx >= row.Count)
                {
                    dr[col.Name] = DBNull.Value;
                    continue;
                }
                dr[col.Name] = ConvertJsonCell(row[dumpIdx], col.SqlType);
            }
            dt.Rows.Add(dr);
        }

        var options = SqlBulkCopyOptions.KeepNulls | SqlBulkCopyOptions.TableLock;
        if (liveMeta.HasIdentity) options |= SqlBulkCopyOptions.KeepIdentity;

        using (var bulk = new SqlBulkCopy(conn, options, tx))
        {
            bulk.DestinationTableName = $"[dbo].[{EscapeId(liveMeta.Name)}]";
            bulk.BatchSize = 2000;
            bulk.BulkCopyTimeout = 600;
            foreach (var (_, col) in mappedCols)
            {
                bulk.ColumnMappings.Add(col.Name, col.Name);
            }
            await bulk.WriteToServerAsync(dt, ct);
        }

        if (liveMeta.HasIdentity)
        {
            try
            {
                await ExecuteRawAsync(conn, tx, $"DBCC CHECKIDENT ('[dbo].[{EscapeId(liveMeta.Name)}]', RESEED);", ct);
            }
            catch
            {
                /* non-fatal */
            }
        }

        return dt.Rows.Count;
    }

    private static Type GetClrType(string sqlType) => sqlType.ToLowerInvariant() switch
    {
        "bigint" => typeof(long),
        "int" => typeof(int),
        "smallint" => typeof(short),
        "tinyint" => typeof(byte),
        "bit" => typeof(bool),
        "decimal" or "numeric" or "money" or "smallmoney" => typeof(decimal),
        "float" => typeof(double),
        "real" => typeof(float),
        "date" or "datetime" or "datetime2" or "smalldatetime" => typeof(DateTime),
        "datetimeoffset" => typeof(DateTimeOffset),
        "time" => typeof(TimeSpan),
        "uniqueidentifier" => typeof(Guid),
        "varbinary" or "binary" or "image" => typeof(byte[]),
        _ => typeof(string),
    };

    private static object ConvertJsonCell(object? cellObj, string sqlType)
    {
        if (cellObj is null) return DBNull.Value;
        if (cellObj is not JsonElement el) return cellObj;
        if (el.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return DBNull.Value;

        var t = sqlType.ToLowerInvariant();
        try
        {
            return t switch
            {
                "bigint" => el.ValueKind == JsonValueKind.Number ? el.GetInt64() : long.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "int" => el.ValueKind == JsonValueKind.Number ? el.GetInt32() : int.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "smallint" => el.ValueKind == JsonValueKind.Number ? el.GetInt16() : short.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "tinyint" => el.ValueKind == JsonValueKind.Number ? el.GetByte() : byte.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "bit" => el.ValueKind switch
                {
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.Number => el.GetInt32() != 0,
                    _ => bool.TryParse(el.GetString(), out var b) ? b : el.GetString() == "1",
                },
                "decimal" or "numeric" or "money" or "smallmoney" =>
                    el.ValueKind == JsonValueKind.Number ? el.GetDecimal() : decimal.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "float" => el.ValueKind == JsonValueKind.Number ? el.GetDouble() : double.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "real" => el.ValueKind == JsonValueKind.Number ? el.GetSingle() : float.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "date" or "datetime" or "datetime2" or "smalldatetime" =>
                    DateTime.Parse(el.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
                "datetimeoffset" =>
                    DateTimeOffset.Parse(el.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
                "time" => TimeSpan.Parse(el.GetString()!, CultureInfo.InvariantCulture),
                "uniqueidentifier" => Guid.Parse(el.GetString()!),
                "varbinary" or "binary" or "image" => Convert.FromBase64String(el.GetString()!),
                _ => el.ValueKind == JsonValueKind.String ? el.GetString()! : el.GetRawText(),
            };
        }
        catch
        {
            return DBNull.Value;
        }
    }

    private static async Task<TableDumpPayload> DumpTableAsync(
        SqlConnection conn,
        DbTableMeta table,
        CancellationToken ct)
    {
        var colList = string.Join(", ", table.Columns.Select(c => $"[{EscapeId(c.Name)}]"));
        var sql = $"SELECT {colList} FROM [dbo].[{EscapeId(table.Name)}];";
        var rows = new List<List<object?>>();

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 600 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var fieldCount = table.Columns.Count;
        while (await reader.ReadAsync(ct))
        {
            var row = new List<object?>(fieldCount);
            for (var i = 0; i < fieldCount; i++)
            {
                if (await reader.IsDBNullAsync(i, ct))
                {
                    row.Add(null);
                    continue;
                }
                var val = reader.GetValue(i);
                row.Add(val switch
                {
                    byte[] bytes => Convert.ToBase64String(bytes),
                    DateTime dt => dt.ToString("O", CultureInfo.InvariantCulture),
                    DateTimeOffset dto => dto.ToString("O", CultureInfo.InvariantCulture),
                    TimeSpan ts => ts.ToString("c", CultureInfo.InvariantCulture),
                    _ => val,
                });
            }
            rows.Add(row);
        }

        return new TableDumpPayload(
            table.Name,
            table.HasIdentity,
            table.Columns.Select(c => new DumpColDto(c.Name, c.SqlType)).ToList(),
            rows);
    }

    private static async Task<List<DbTableMeta>> LoadDatabaseTablesAsync(
        SqlConnection conn,
        bool includeCatalog,
        CancellationToken ct)
    {
        const string sql = """
            SELECT t.name AS TableName,
                   c.name AS ColumnName,
                   ty.name AS SqlType,
                   CAST(c.is_identity AS bit) AS IsIdentity
            FROM sys.tables t
            INNER JOIN sys.columns c ON c.object_id = t.object_id
            INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
            WHERE t.is_ms_shipped = 0
              AND SCHEMA_NAME(t.schema_id) = 'dbo'
              AND c.is_computed = 0
              AND ty.name NOT IN ('timestamp', 'rowversion')
            ORDER BY t.name, c.column_id;
            """;

        var raw = await conn.QueryAsync<(string TableName, string ColumnName, string SqlType, bool IsIdentity)>(
            new CommandDefinition(sql, cancellationToken: ct));

        var list = new List<DbTableMeta>();
        foreach (var g in raw.GroupBy(r => r.TableName, StringComparer.OrdinalIgnoreCase))
        {
            if (SkippedTables.Contains(g.Key)) continue;
            var section = ClassifyTable(g.Key);
            if (!includeCatalog && section == "catalog") continue;
            var cols = g.Select(x => new DbColumnMeta(x.ColumnName, x.SqlType, x.IsIdentity)).ToList();
            if (cols.Count == 0) continue;
            list.Add(new DbTableMeta(g.Key, section, cols.Any(c => c.IsIdentity), cols));
        }
        return list;
    }

    private static async Task ExecuteRawAsync(SqlConnection conn, SqlTransaction tx, string sql, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(sql, conn, tx) { CommandTimeout = 300 };
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string EscapeId(string identifier) => identifier.Replace("]", "]]");

    private List<BackupFileItemDto> ListBackupFilesInternal()
    {
        if (!Directory.Exists(_backupDir)) return [];
        var list = new List<BackupFileItemDto>();
        foreach (var file in Directory.EnumerateFiles(_backupDir, "*.fotbackup"))
        {
            try
            {
                var fi = new FileInfo(file);
                var mf = ReadManifestFromZip(file);
                var isAuto = fi.Name.StartsWith("auto-", StringComparison.OrdinalIgnoreCase);
                list.Add(new BackupFileItemDto(
                    fi.Name,
                    mf?.Label ?? (isAuto ? "نسخة تلقائية" : "نسخة احتياطية"),
                    mf?.CreatedAt ?? fi.CreationTimeUtc,
                    fi.Length,
                    mf?.IncludeCatalog ?? true,
                    isAuto,
                    mf?.Summary));
            }
            catch
            {
                /* skip corrupted file */
            }
        }
        return list.OrderByDescending(x => x.CreatedAt).ToList();
    }

    private static BackupManifestDto? ReadManifestFromZip(string path)
    {
        try
        {
            using var fs = File.OpenRead(path);
            using var zip = new ZipArchive(fs, ZipArchiveMode.Read, leaveOpen: false);
            var entry = zip.GetEntry("manifest.json");
            if (entry is null) return null;
            using var s = entry.Open();
            return JsonSerializer.Deserialize<BackupManifestDto>(s, JsonOpts);
        }
        catch
        {
            return null;
        }
    }

    public void PruneOldBackups(int retainCount)
    {
        try
        {
            var autoFiles = Directory.EnumerateFiles(_backupDir, "auto-*.fotbackup")
                .Select(p => new FileInfo(p))
                .OrderByDescending(f => f.CreationTimeUtc)
                .Skip(Math.Max(2, retainCount))
                .ToList();
            foreach (var f in autoFiles)
            {
                try { f.Delete(); } catch { /* ignore */ }
            }
        }
        catch
        {
            /* ignore */
        }
    }

    private StoredBackupSettings ReadStoredSettings()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                var raw = File.ReadAllText(_settingsPath, Encoding.UTF8);
                var parsed = JsonSerializer.Deserialize<StoredBackupSettings>(raw, JsonOpts);
                if (parsed is not null) return parsed;
            }
        }
        catch
        {
            /* fallback */
        }
        return new StoredBackupSettings(true, 12, 14, false, null);
    }

    private void WriteStoredSettings(StoredBackupSettings s)
    {
        try
        {
            var json = JsonSerializer.Serialize(s, new JsonSerializerOptions(JsonOpts) { WriteIndented = true });
            File.WriteAllText(_settingsPath, json, Encoding.UTF8);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to save backup settings");
        }
    }

    private sealed record StoredBackupSettings(
        bool AutoBackupEnabled,
        int IntervalHours,
        int RetainCount,
        bool IncludeCatalogInAuto,
        DateTime? LastAutoBackupAt);

    private sealed record DbColumnMeta(string Name, string SqlType, bool IsIdentity);
    private sealed record DbTableMeta(string Name, string Section, bool HasIdentity, List<DbColumnMeta> Columns);
    private sealed record DumpColDto(string Name, string SqlType);
    private sealed record TableDumpPayload(
        string Table,
        bool HasIdentity,
        List<DumpColDto> Columns,
        List<List<object?>> Rows);
}
