using Dapper;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// Durable catalog-version persistence: every broadcast bump is recorded in
/// <c>ext_catalog_version</c> (fire-and-forget through a bounded channel) and the
/// in-memory counter is seeded from the table at startup so restarts no longer
/// reset it — clients that compare versions keep working across deployments.
/// </summary>
public sealed class CatalogVersionRepository(ISqlConnectionFactory db)
{
    private static readonly System.Threading.Channels.Channel<(long Version, string Scope)> Queue =
        System.Threading.Channels.Channel.CreateBounded<(long, string)>(
            new System.Threading.Channels.BoundedChannelOptions(500)
            {
                FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest,
            });

    /// <summary>Latest recorded version (0 when the table is empty).</summary>
    public async Task<long> GetLatestAsync(CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            return await conn.ExecuteScalarAsync<long>(
                new CommandDefinition("SELECT COALESCE(MAX(id), 0) FROM ext_catalog_version", cancellationToken: ct));
        }
        catch
        {
            return 0; // table not migrated yet — fall back to in-memory counting
        }
    }

    /// <summary>Queue a version record; never blocks the broadcasting endpoint.</summary>
    public void Record(long version, string scope) =>
        Queue.Writer.TryWrite((version, scope));

    /// <summary>Drains queued version records; called by the background flusher.</summary>
    public async Task<int> FlushAsync(CancellationToken ct)
    {
        var written = 0;
        while (Queue.Reader.TryRead(out var item) && written < 100)
        {
            try
            {
                await using var conn = await db.CreateOpenConnectionAsync(ct);
                await conn.ExecuteAsync(new CommandDefinition(
                    "SET IDENTITY_INSERT ext_catalog_version ON; " +
                    "INSERT INTO ext_catalog_version (id, scope) VALUES (@version, @scope); " +
                    "SET IDENTITY_INSERT ext_catalog_version OFF;",
                    new { version = item.Version, scope = item.Scope }, cancellationToken: ct));
                written++;
            }
            catch
            {
                break; // table missing or contention — retry on the next flush
            }
        }
        return written;
    }

    /// <summary>Per-terminal watermark from delta sync (catalog/sync).</summary>
    public async Task TouchTerminalSeqAsync(long terminalId, long seq, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE point_of_sales SET catalog_seq = @seq WHERE id = @id",
                new { seq, id = terminalId }, cancellationToken: ct));
        }
        catch { /* watermark tracking is best-effort */ }
    }

    /// <summary>Per-terminal acknowledged version from heartbeat.</summary>
    public async Task TouchTerminalVersionAsync(long terminalId, long version, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE point_of_sales SET catalog_version = @version WHERE id = @id",
                new { version, id = terminalId }, cancellationToken: ct));
        }
        catch { /* best-effort */ }
    }
}
