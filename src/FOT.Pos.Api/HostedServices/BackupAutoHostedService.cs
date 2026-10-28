using FOT.Pos.Infrastructure.Services;

namespace FOT.Pos.Api.HostedServices;

public sealed class BackupAutoHostedService(
    SystemBackupService backups,
    ILogger<BackupAutoHostedService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Wait briefly after startup before first check
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var settings = backups.GetSettings();
                if (settings.AutoBackupEnabled)
                {
                    var due = settings.LastAutoBackupAt is null
                        || (DateTime.UtcNow - settings.LastAutoBackupAt.Value).TotalHours >= settings.IntervalHours;
                    if (due)
                    {
                        await backups.CreateBackupAsync(
                            label: "نسخة تلقائية مجدولة",
                            includeCatalog: settings.IncludeCatalogInAuto,
                            isAuto: true,
                            ct: stoppingToken);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Scheduled auto-backup iteration failed");
            }

            await Task.Delay(TimeSpan.FromMinutes(15), stoppingToken);
        }
    }
}
