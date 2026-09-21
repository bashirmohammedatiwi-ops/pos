using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Configuration;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class EdariSettingsRepository(ISqlConnectionFactory db)
{
    private static int _liveColumnsReady;

    public async Task EnsureLiveColumnsAsync(CancellationToken ct)
    {
        if (Interlocked.CompareExchange(ref _liveColumnsReady, 1, 0) != 0) return;
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition("""
                IF COL_LENGTH('ext_edari_settings', 'last_edari_fingerprint') IS NULL
                    ALTER TABLE ext_edari_settings ADD last_edari_fingerprint NVARCHAR(240) NULL;
                IF COL_LENGTH('ext_edari_settings', 'last_heartbeat_at') IS NULL
                    ALTER TABLE ext_edari_settings ADD last_heartbeat_at DATETIME2 NULL;
                IF COL_LENGTH('ext_edari_settings', 'last_change_detected_at') IS NULL
                    ALTER TABLE ext_edari_settings ADD last_change_detected_at DATETIME2 NULL;
                IF COL_LENGTH('ext_edari_settings', 'data_pull_interval_seconds') IS NULL
                    ALTER TABLE ext_edari_settings ADD data_pull_interval_seconds INT NULL;
                """, cancellationToken: ct));
        }
        catch
        {
            Interlocked.Exchange(ref _liveColumnsReady, 0);
            throw;
        }
    }

    /// <summary>
    /// Loads the persisted settings row, or null when it doesn't exist yet (fresh install, before
    /// the Settings page has ever been saved). The distinction matters: once a row exists it is the
    /// single source of truth (edited from the Edari Settings page), and appsettings.json must never
    /// silently override it — see <see cref="EdariSettingsMerger.Merge"/>.
    /// </summary>
    public async Task<EdariOptions?> LoadAsync(CancellationToken ct)
    {
        await EnsureLiveColumnsAsync(ct);
        const string sql = """
            SELECT data_root AS DataRoot, database_alias AS DatabaseAlias, server AS Server, port AS Port,
                   connection_mode AS ConnectionMode, odbc_driver AS OdbcDriver,
                   ado_provider_path AS AdoProviderPath, ado_connector_directory AS AdoConnectorDirectory,
                   enabled AS Enabled, auto_sync_enabled AS AutoSyncEnabled,
                   auto_sync_interval_seconds AS AutoSyncIntervalSeconds, catalog_sync_enabled AS CatalogSyncEnabled,
                   last_receipt_sync_at AS LastReceiptSyncAt, last_catalog_sync_at AS LastCatalogSyncAt,
                   last_data_pull_at AS LastDataPullAt,
                   last_connection_test_at AS LastConnectionTestAt, last_connection_ok AS LastConnectionOk,
                   last_connection_message AS LastConnectionMessage,
                   detect_seconds AS DetectSeconds,
                   data_pull_interval_seconds AS DataPullIntervalSeconds
            FROM ext_edari_settings WHERE id = 1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<EdariOptionsRow>(
            new CommandDefinition(sql, cancellationToken: ct));
        return row?.ToOptions();
    }

    public async Task SaveAsync(UpdateEdariSettingsRequest req, CancellationToken ct)
    {
        var normalized = req with
        {
            AutoSyncIntervalSeconds = Math.Clamp(req.AutoSyncIntervalSeconds, 15, 3600),
            DataPullIntervalSeconds = Math.Clamp(req.DataPullIntervalSeconds is <= 0 ? 240 : req.DataPullIntervalSeconds, 60, 3600)
        };
        await EnsureLiveColumnsAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_edari_settings SET
                data_root = @DataRoot, database_alias = @DatabaseAlias, server = @Server, port = @Port,
                connection_mode = @ConnectionMode, odbc_driver = @OdbcDriver,
                ado_provider_path = @AdoProviderPath, ado_connector_directory = @AdoConnectorDirectory,
                enabled = @Enabled, auto_sync_enabled = @AutoSyncEnabled,
                auto_sync_interval_seconds = @AutoSyncIntervalSeconds, catalog_sync_enabled = @CatalogSyncEnabled,
                data_pull_interval_seconds = @DataPullIntervalSeconds,
                updated_at = GETDATE()
            WHERE id = 1
            """, normalized, cancellationToken: ct));
    }

    public async Task UpdateConnectionTestAsync(bool ok, string message, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_edari_settings SET
                last_connection_test_at = GETDATE(), last_connection_ok = @ok, last_connection_message = @message
            WHERE id = 1
            """, new { ok, message }, cancellationToken: ct));
    }

    public async Task UpdateLastReceiptSyncAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_edari_settings SET last_receipt_sync_at = GETDATE() WHERE id = 1",
            cancellationToken: ct));
    }

    public async Task UpdateLastDataPullAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_edari_settings SET last_data_pull_at = GETDATE() WHERE id = 1",
            cancellationToken: ct));
    }

    public async Task UpdateLastCatalogSyncAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_edari_settings SET last_catalog_sync_at = GETDATE() WHERE id = 1",
            cancellationToken: ct));
    }

    public async Task<EdariSettingsDto> GetDtoAsync(CancellationToken ct)
    {
        await EnsureLiveColumnsAsync(ct);
        var opts = await LoadAsync(ct) ?? new EdariOptions();
        var years = DiscoverYears(opts.DataRoot);
        var live = await GetLiveLinkAsync(ct);
        return new EdariSettingsDto(
            opts.DataRoot, opts.DatabaseAlias, opts.Server, opts.Port,
            opts.ConnectionMode.ToString(), opts.OdbcDriver, opts.AdoProviderPath, opts.AdoConnectorDirectory,
            opts.Enabled, opts.AutoSyncEnabled, opts.AutoSyncIntervalSeconds, opts.CatalogSyncEnabled,
            await GetTimestampAsync("last_receipt_sync_at", ct),
            await GetTimestampAsync("last_catalog_sync_at", ct),
            live.LastDataPullAt,
            await GetTimestampAsync("last_connection_test_at", ct),
            await GetBoolAsync("last_connection_ok", ct),
            await GetStringAsync("last_connection_message", ct),
            years,
            live.LastHeartbeatAt,
            live.LastChangeDetectedAt,
            LiveWatching: false,
            DataPullIntervalSeconds: opts.EffectiveDataPullIntervalSeconds);
    }

    public async Task<EdariLiveLinkDto> GetLiveLinkAsync(CancellationToken ct)
    {
        await EnsureLiveColumnsAsync(ct);
        const string sql = """
            SELECT last_data_pull_at AS LastDataPullAt,
                   last_heartbeat_at AS LastHeartbeatAt,
                   last_change_detected_at AS LastChangeDetectedAt,
                   last_edari_fingerprint AS Fingerprint,
                   auto_sync_enabled AS AutoSyncEnabled,
                   enabled AS Enabled
            FROM ext_edari_settings WHERE id = 1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<LiveRow>(
            new CommandDefinition(sql, cancellationToken: ct));
        return row is null
            ? new EdariLiveLinkDto(null, null, null, null, false, false)
            : new EdariLiveLinkDto(row.LastDataPullAt, row.LastHeartbeatAt, row.LastChangeDetectedAt,
                row.Fingerprint, row.AutoSyncEnabled, row.Enabled);
    }

    public async Task TouchHeartbeatAsync(CancellationToken ct)
    {
        await EnsureLiveColumnsAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_edari_settings SET last_heartbeat_at = GETDATE() WHERE id = 1",
            cancellationToken: ct));
    }

    public async Task MarkChangeDetectedAsync(CancellationToken ct)
    {
        await EnsureLiveColumnsAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_edari_settings SET
                last_heartbeat_at = GETDATE(),
                last_change_detected_at = GETDATE()
            WHERE id = 1
            """, cancellationToken: ct));
    }

    public async Task SaveFingerprintAsync(string fingerprint, CancellationToken ct)
    {
        await EnsureLiveColumnsAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_edari_settings SET
                last_edari_fingerprint = @fingerprint,
                last_heartbeat_at = GETDATE()
            WHERE id = 1
            """, new { fingerprint }, cancellationToken: ct));
    }

    private sealed class LiveRow
    {
        public DateTime? LastDataPullAt { get; set; }
        public DateTime? LastHeartbeatAt { get; set; }
        public DateTime? LastChangeDetectedAt { get; set; }
        public string? Fingerprint { get; set; }
        public bool AutoSyncEnabled { get; set; }
        public bool Enabled { get; set; }
    }

    private async Task<DateTime?> GetTimestampAsync(string column, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<DateTime?>(
            new CommandDefinition($"SELECT {column} FROM ext_edari_settings WHERE id = 1", cancellationToken: ct));
    }

    private async Task<bool?> GetBoolAsync(string column, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<bool?>(
            new CommandDefinition($"SELECT {column} FROM ext_edari_settings WHERE id = 1", cancellationToken: ct));
    }

    private async Task<string?> GetStringAsync(string column, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<string?>(
            new CommandDefinition($"SELECT {column} FROM ext_edari_settings WHERE id = 1", cancellationToken: ct));
    }

    public static IReadOnlyList<string> DiscoverYears(string dataRoot)
    {
        if (!Directory.Exists(dataRoot)) return [];
        return Directory.GetDirectories(dataRoot)
            .Select(Path.GetFileName)
            .Where(n => n is not null && (n!.Length == 4 && int.TryParse(n, out _)) || n!.EndsWith("nx", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(n => n)
            .Cast<string>()
            .ToList();
    }

    private sealed class EdariOptionsRow
    {
        public string DataRoot { get; set; } = "";
        public string DatabaseAlias { get; set; } = "2025";
        public string Server { get; set; } = "127.0.0.1";
        public int Port { get; set; } = 16000;
        public string ConnectionMode { get; set; } = "Ado";
        public string OdbcDriver { get; set; } = "Devart ODBC Driver for NexusDB";
        public string? AdoProviderPath { get; set; }
        public string? AdoConnectorDirectory { get; set; }
        public bool Enabled { get; set; } = true;
        public bool AutoSyncEnabled { get; set; } = true;
        public int AutoSyncIntervalSeconds { get; set; } = 120;
        public bool CatalogSyncEnabled { get; set; } = false;
        public int? DetectSeconds { get; set; }
        public int? DataPullIntervalSeconds { get; set; }

        public EdariOptions ToOptions() => new()
        {
            DataRoot = DataRoot,
            DatabaseAlias = DatabaseAlias,
            Server = Server,
            Port = Port,
            ConnectionMode = ParseConnectionMode(ConnectionMode),
            OdbcDriver = OdbcDriver,
            AdoProviderPath = AdoProviderPath,
            AdoConnectorDirectory = AdoConnectorDirectory,
            Enabled = Enabled,
            AutoSyncEnabled = AutoSyncEnabled,
            AutoSyncIntervalSeconds = AutoSyncIntervalSeconds,
            CatalogSyncEnabled = CatalogSyncEnabled,
            DetectSeconds = DetectSeconds,
            DataPullIntervalSeconds = DataPullIntervalSeconds is > 0 ? DataPullIntervalSeconds.Value : 240
        };

        private static EdariConnectionMode ParseConnectionMode(string? value) =>
            Enum.TryParse<EdariConnectionMode>(value, true, out var mode) ? mode : EdariConnectionMode.Ado;
    }
}

public static class EdariSettingsMerger
{
    /// <summary>
    /// The Edari Settings page persists every field to ext_edari_settings — once that row exists it
    /// is the single source of truth. appsettings.json's "Edari" section is a bootstrap default ONLY,
    /// used to seed the very first run before anyone has saved settings from the UI.
    ///
    /// Previously this always let appsettings.json win for any key present there, which meant a
    /// leftover/default value baked into the deployed appsettings.json (e.g. an old fiscal-year
    /// DatabaseAlias) silently overrode whatever the admin configured — the live sync kept reading a
    /// completely different Edari dataset than the one shown/edited in the control panel, with no
    /// visible error. Do not revert this precedence without re-reading that history.
    /// </summary>
    public static EdariOptions Merge(IConfiguration config, EdariOptions? db)
    {
        if (db is not null) return db;

        var section = config.GetSection(EdariOptions.SectionName);
        var defaults = new EdariOptions();
        if (!section.Exists()) return defaults;

        return new EdariOptions
        {
            DataRoot = section["DataRoot"] ?? defaults.DataRoot,
            DatabaseAlias = section["DatabaseAlias"] ?? defaults.DatabaseAlias,
            Server = section["Server"] ?? defaults.Server,
            Port = int.TryParse(section["Port"], out var p) ? p : defaults.Port,
            ConnectionMode = ParseConnectionMode(section["ConnectionMode"]) ?? defaults.ConnectionMode,
            OdbcDriver = section["OdbcDriver"] ?? defaults.OdbcDriver,
            AdoProviderPath = section["AdoProviderPath"] ?? defaults.AdoProviderPath,
            AdoConnectorDirectory = section["AdoConnectorDirectory"] ?? defaults.AdoConnectorDirectory,
            Enabled = bool.TryParse(section["Enabled"], out var en) ? en : defaults.Enabled,
            AutoSyncEnabled = bool.TryParse(section["AutoSyncEnabled"], out var asn) ? asn : defaults.AutoSyncEnabled,
            AutoSyncIntervalSeconds = int.TryParse(section["AutoSyncIntervalSeconds"], out var iv) ? iv : defaults.AutoSyncIntervalSeconds,
            CatalogSyncEnabled = bool.TryParse(section["CatalogSyncEnabled"], out var cs) ? cs : defaults.CatalogSyncEnabled,
            DetectSeconds = int.TryParse(section["DetectSeconds"], out var ds) ? ds : defaults.DetectSeconds,
            DataPullIntervalSeconds = int.TryParse(section["DataPullIntervalSeconds"], out var dp) ? dp : defaults.DataPullIntervalSeconds
        };
    }

    private static EdariConnectionMode? ParseConnectionMode(string? value) =>
        Enum.TryParse<EdariConnectionMode>(value, true, out var mode) ? mode : null;
}
