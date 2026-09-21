using System.Data.Common;
using System.Data.Odbc;
using FOT.Pos.Infrastructure.Services;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Hard ceiling for a single NexusDB statement — a hung Edari server must never
/// hold a request or a background cycle hostage.
/// </summary>
public static class EdariCommandDefaults
{
    public const int CommandTimeoutSeconds = 20;
}

public sealed class EdariConnectionFactory(EdariSettingsService settings, EdariSyncGate gate)
{
    /// <summary>Applies the unified command timeout to every command created on a connection.</summary>
    public static DbCommand Configure(DbCommand cmd)
    {
        cmd.CommandTimeout = EdariCommandDefaults.CommandTimeoutSeconds;
        return cmd;
    }

    public async Task<DbConnection> CreateOpenConnectionAsync(CancellationToken ct) =>
        await CreateOpenConnectionAsync(breakerBypass: false, ct);

    /// <param name="breakerBypass">
    /// User-initiated connection tests probe the real server even while the breaker is open,
    /// so the «اختبار الاتصال» button always reflects reality.
    /// </param>
    public async Task<DbConnection> CreateOpenConnectionAsync(bool breakerBypass, CancellationToken ct)
    {
        if (!breakerBypass && gate.CircuitOpen)
            throw new EdariCircuitOpenException(gate.CircuitRetryIn);

        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
            throw new InvalidOperationException("Edari integration is disabled in settings.");

        var mode = opts.ConnectionMode;
        if (mode == EdariConnectionMode.Auto)
            mode = NexusDbAdoBootstrap.ProviderAvailable(opts)
                ? EdariConnectionMode.Ado
                : EdariConnectionMode.Odbc;

        DbConnection conn = mode switch
        {
            EdariConnectionMode.Ado => NexusDbAdoBootstrap.CreateConnection(opts),
            _ => new OdbcConnection(opts.BuildOdbcConnectionString())
        };

        try
        {
            await conn.OpenAsync(ct);
        }
        catch
        {
            if (!breakerBypass) gate.RecordConnectionFailure();
            conn.Dispose();
            throw;
        }

        if (!breakerBypass) gate.RecordConnectionSuccess();
        return conn;
    }

    public static bool DataFolderExists(EdariOptions opts) =>
        Directory.Exists(opts.YearFolder) &&
        File.Exists(Path.Combine(opts.YearFolder, "File13n.nx1"));
}
