using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Services;

/// <summary>
/// One-time startup maintenance: migrations, data repair, and commission backfill.
/// </summary>
public sealed class PosStartupService(
    SchemaMigrationRunner migrations,
    ISqlConnectionFactory db,
    SalePostProcessor commissions,
    OfferRepository offers,
    ILogger<PosStartupService> logger)
{
    private const int CommissionBackfillDays = 14;
    private const int CommissionBackfillCap = 400;

    public async Task RunAsync(CancellationToken ct = default)
    {
        var applied = await migrations.ApplyPendingAsync(ct);
        if (applied > 0)
            SalesmanQueries.ResetSchemaCache();

        // Salesmen repair talks to Edari. Doing it here blocks the API from listening
        // while NexusDB is still starting with Windows, so the control panel sits and waits.
        // The background sync repairs the registry once Edari answers.

        var expired = await offers.ExpireElapsedAsync(ct);
        if (expired > 0)
            logger.LogInformation("Stopped {Count} offer(s) whose end date has passed", expired);

        var repaired = await RepairReceiptFlagsAsync(ct);
        if (repaired > 0)
            logger.LogWarning("Repaired {Count} receipt(s) with inconsistent pending flag", repaired);

        if (applied > 0 || repaired > 0)
            await BackfillCommissionsAsync(ct);
    }

    private async Task<int> RepairReceiptFlagsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts
            SET is_pending = 0
            WHERE is_pending = 1 AND number > 0
            """, cancellationToken: ct));
    }

    private async Task BackfillCommissionsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var from = DateTime.Today.AddDays(-CommissionBackfillDays);
        var ids = (await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT TOP (@cap) r.id
            FROM reciepts r
            WHERE r.creation_date >= @from
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND r.number > 0
            ORDER BY r.id DESC
            """, new { from, cap = CommissionBackfillCap }, cancellationToken: ct))).ToList();

        if (ids.Count == 0) return;

        var written = 0;
        foreach (var id in ids)
        {
            ct.ThrowIfCancellationRequested();
            written += await commissions.ProcessAsync(id, 0, ct);
        }

        logger.LogInformation(
            "Commission backfill checked {Receipts} recent receipt(s), wrote {Lines} line(s)",
            ids.Count, written);
    }
}
