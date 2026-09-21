using FOT.Pos.Infrastructure.Repositories;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// Drains the client-error channel into SQL every few seconds and purges rows
/// older than 14 days once a day — keeps the diagnostics table small.
/// </summary>
public sealed class ClientTelemetryFlushService(
    IServiceScopeFactory scopeFactory,
    ILogger<ClientTelemetryFlushService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastPurge = DateTime.UtcNow.AddDays(-1); // run purge shortly after boot
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var repo = scope.ServiceProvider.GetRequiredService<ClientErrorRepository>();
                    await repo.FlushAsync(stoppingToken);

                    // Same cadence: drain queued catalog-version records.
                    var catalogVersions = scope.ServiceProvider.GetRequiredService<CatalogVersionRepository>();
                    await catalogVersions.FlushAsync(stoppingToken);

                    if (DateTime.UtcNow - lastPurge > TimeSpan.FromHours(24))
                    {
                        lastPurge = DateTime.UtcNow;
                        var purged = await repo.PurgeOlderThanAsync(14, stoppingToken);
                        if (purged > 0)
                            logger.LogInformation("Purged {Count} client error rows older than 14 days", purged);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Client telemetry flush failed");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // shutdown
        }
    }
}
