using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Api.HostedServices;

public sealed class EdariSyncBackgroundService(
    IServiceScopeFactory scopeFactory,
    EdariSyncGate gate,
    ILogger<EdariSyncBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Edari live-link sync started");

        var lastDetect = DateTime.MinValue;
        var lastReceiptSync = DateTime.MinValue;
        var lastDetectSeconds = -1;
        var receiptInterval = TimeSpan.FromSeconds(120);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // detect interval is configurable from ext_edari_settings — re-read when it changes
                if (lastDetectSeconds != EdariSyncGate.DetectSeconds)
                {
                    lastDetectSeconds = EdariSyncGate.DetectSeconds;
                    logger.LogInformation("Edari detect interval: {Detect}s", lastDetectSeconds);
                }

                if (gate.CircuitOpen)
                {
                    // Breaker open: skip the whole tick — no fingerprint, no pull, no receipt push.
                    // File signals are kept so the first probe after the window closes reacts instantly.
                    if (gate.ConsumeFileSignal()) gate.SignalFileChange();
                }
                else
                {
                    var fileHit = gate.ConsumeFileSignal();
                    var dueDetect = DateTime.UtcNow - lastDetect >= TimeSpan.FromSeconds(EdariSyncGate.DetectSeconds);
                    if (fileHit || dueDetect)
                    {
                        lastDetect = DateTime.UtcNow;
                        // Pull path; also refreshes the receipt-push interval from effective settings.
                        (lastReceiptSync, receiptInterval) = await TickAsync(fileHit, lastReceiptSync, stoppingToken);
                    }

                    // Receipt posting runs on its own cadence, decoupled from pull/fingerprint ticks,
                    // so a backlog drains even when the Edari catalog is completely idle.
                    lastReceiptSync = await SyncReceiptsIfDueAsync(
                        scopeFactory, lastReceiptSync, receiptInterval, force: false, stoppingToken);
                }
            }
            catch (EdariCircuitOpenException)
            {
                // A sub-call hit the just-opened breaker — the next loop iteration will observe CircuitOpen.
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Edari live-link tick failed");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task<(DateTime LastReceiptSync, TimeSpan ReceiptInterval)> TickAsync(
        bool fileHit, DateTime lastReceiptSync, CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<EdariSettingsService>();
        var settingsRepo = scope.ServiceProvider.GetRequiredService<EdariSettingsRepository>();
        var opts = await settings.GetEffectiveAsync(ct);
        var interval = TimeSpan.FromSeconds(Math.Clamp(opts.AutoSyncIntervalSeconds, 15, 3600));
        if (!opts.Enabled || !opts.AutoSyncEnabled)
        {
            await settingsRepo.TouchHeartbeatAsync(ct);
            return (lastReceiptSync, interval);
        }

        var live = await settingsRepo.GetLiveLinkAsync(ct);
        var nexus = scope.ServiceProvider.GetRequiredService<EdariNexusClient>();

        EdariCatalogFingerprint? fp = null;
        try
        {
            fp = await nexus.GetCatalogFingerprintAsync(ct);
            await settingsRepo.TouchHeartbeatAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Edari fingerprint failed");
            return (lastReceiptSync, interval);
        }

        var fingerprintChanged = !string.Equals(fp.Token, live.Fingerprint, StringComparison.Ordinal);
        var neverPulled = live.LastDataPullAt is null;
        var pullEvery = TimeSpan.FromSeconds(opts.EffectiveDataPullIntervalSeconds);
        var safetyDue = live.LastDataPullAt is null
            || DateTime.UtcNow - ToUtc(live.LastDataPullAt.Value) >= pullEvery;

        if (fingerprintChanged || neverPulled || safetyDue)
        {
            if (fingerprintChanged)
                await settingsRepo.MarkChangeDetectedAsync(ct);

            var includeCatalog = opts.CatalogSyncEnabled && (fingerprintChanged || await ShouldRunCatalogSyncAsync(settingsRepo, ct));
            var pull = scope.ServiceProvider.GetRequiredService<EdariDataPullService>();
            var pullResult = await pull.PullAsync(includeCatalog, ct);
            if (pullResult.Ok)
            {
                if (fingerprintChanged || pullResult.ArticlesAdded + pullResult.ArticlesUpdated + pullResult.ArticlesDeleted > 0)
                    logger.LogInformation("Edari live pull: {Message}", pullResult.Message);
            }
            else
                logger.LogWarning("Edari live pull failed: {Message}", pullResult.Message);

            if (pullResult.Ok)
                lastReceiptSync = await SyncReceiptsIfDueAsync(scopeFactory, lastReceiptSync, interval, force: true, ct);

            return (lastReceiptSync, interval);
        }

        if (fileHit)
            logger.LogDebug("Edari folder activity with unchanged fingerprint");

        return (lastReceiptSync, interval);
    }

    /// <summary>
    /// Receipt push lane. Full cadence comes from AutoSyncIntervalSeconds (retry pacing), but a
    /// receipt that arrived after the last completed push jumps the queue after this minimum gap —
    /// cashiers see their invoices in Edari within seconds instead of waiting out the whole interval.
    /// </summary>
    private const int FastLaneMinGapSeconds = 10;

    private static async Task<DateTime> SyncReceiptsIfDueAsync(
        IServiceScopeFactory scopeFactory, DateTime lastReceiptSync, TimeSpan interval, bool force, CancellationToken ct)
    {
        if (!force && DateTime.Now - lastReceiptSync < interval)
        {
            // Not due by the retry interval — check the fast lane only when enough time passed
            // since the last push so we don't hammer Edari during a busy shift.
            if (DateTime.Now - lastReceiptSync < TimeSpan.FromSeconds(FastLaneMinGapSeconds))
                return lastReceiptSync;

            using (var probe = scopeFactory.CreateScope())
            {
                var repo = probe.ServiceProvider.GetRequiredService<EdariSyncRepository>();
                // creation_date comes from the SQL Server clock — compare on the local clock.
                var newest = await repo.GetNewestUnsyncedCreatedAtAsync(ct);
                if (newest is null || newest <= lastReceiptSync)
                    return lastReceiptSync;
            }
        }

        using var scope = scopeFactory.CreateScope();
        var receipts = scope.ServiceProvider.GetRequiredService<EdariReceiptSyncService>();
        // Drains the whole queue in one go (not just one 50-row batch) — after any downtime or a
        // busy shift the backlog used to trickle out 50 at a time, re-gated by the fast lane
        // between every tick, so cashiers waited minutes to see invoices land in Edari.
        var result = await receipts.SyncAllAsync(50, ct);
        if (result.ReceiptsSynced > 0 || result.ReceiptsFailed > 0)
        {
            var logger = scope.ServiceProvider.GetRequiredService<ILogger<EdariSyncBackgroundService>>();
            logger.LogInformation("Edari receipt sync: {Message}", result.Message);
            var notifier = scope.ServiceProvider.GetRequiredService<IEdariRealtimeNotifier>();
            await notifier.NotifyEdariAsync(result.Message, false, ct);
        }

        return DateTime.Now;
    }

    private static async Task<bool> ShouldRunCatalogSyncAsync(EdariSettingsRepository repo, CancellationToken ct)
    {
        var dto = await repo.GetDtoAsync(ct);
        if (!dto.CatalogSyncEnabled) return false;
        if (dto.LastCatalogSyncAt is null) return true;
        return DateTime.UtcNow - dto.LastCatalogSyncAt.Value > TimeSpan.FromMinutes(30);
    }

    private static DateTime ToUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Local).ToUniversalTime();
}
