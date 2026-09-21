namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariOptions
{
    public const string SectionName = "Edari";

    public string DataRoot { get; set; } = @"D:\Future of Technology\EdariNX\Data";
    public string DatabaseAlias { get; set; } = "2025";
    public string Server { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 16000;
    public EdariConnectionMode ConnectionMode { get; set; } = EdariConnectionMode.Ado;
    public string OdbcDriver { get; set; } = "Devart ODBC Driver for NexusDB";
    public string? AdoProviderPath { get; set; }
    public string? AdoConnectorDirectory { get; set; }
    public bool Enabled { get; set; } = true;
    public bool AutoSyncEnabled { get; set; } = true;
    public int AutoSyncIntervalSeconds { get; set; } = 120;
    public bool CatalogSyncEnabled { get; set; } = false;

    /// <summary>How often to pull Edari catalog (salesmen, articles, branches) when auto-sync is on. Default 4 minutes.</summary>
    public int DataPullIntervalSeconds { get; set; } = 240;

    /// <summary>Periodic fingerprint interval in seconds (NULL = default 30). Folder watcher stays the primary trigger.</summary>
    public int? DetectSeconds { get; set; }

    public int EffectiveDetectSeconds => Math.Clamp(DetectSeconds ?? 30, 5, 600);

    public int EffectiveDataPullIntervalSeconds => Math.Clamp(DataPullIntervalSeconds is <= 0 ? 240 : DataPullIntervalSeconds, 60, 3600);

    public string YearFolder => Path.Combine(DataRoot, DatabaseAlias);

    public string BuildOdbcConnectionString() =>
        $"Driver={{{OdbcDriver}}};Server={Server};Database={DatabaseAlias};Port={Port};";

    public string BuildAdoConnectionString() =>
        $"server={Server};database={DatabaseAlias};port={Port};Native=true";
}
