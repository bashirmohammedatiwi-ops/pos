using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Api.HostedServices;

/// <summary>Watches the Edari year folder so a save in الإداري wakes the live-link immediately.</summary>
public sealed class EdariDataFolderWatcher(
    IServiceScopeFactory scopeFactory,
    EdariSyncGate gate,
    ILogger<EdariDataFolderWatcher> logger) : BackgroundService
{
    private FileSystemWatcher? _watcher;
    private string? _path;
    private CancellationTokenSource? _debounce;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await AlignWatcherAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Edari folder watcher align failed");
                gate.IsWatching = false;
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }

        DisposeWatcher();
        gate.IsWatching = false;
    }

    private async Task AlignWatcherAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<EdariSettingsService>();
        var opts = await settings.GetEffectiveAsync(ct);
        var folder = opts.Enabled ? opts.YearFolder : null;
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
        {
            DisposeWatcher();
            gate.IsWatching = false;
            gate.WatchPath = folder;
            return;
        }

        if (_watcher is not null && string.Equals(_path, folder, StringComparison.OrdinalIgnoreCase))
        {
            gate.IsWatching = true;
            gate.WatchPath = folder;
            return;
        }

        DisposeWatcher();
        _path = folder;
        var watcher = new FileSystemWatcher(folder)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName | NotifyFilters.CreationTime,
            InternalBufferSize = 64 * 1024,
            EnableRaisingEvents = true,
        };
        watcher.Changed += OnChanged;
        watcher.Created += OnChanged;
        watcher.Deleted += OnChanged;
        watcher.Renamed += OnRenamed;
        watcher.Error += (_, e) => logger.LogWarning(e.GetException(), "Edari folder watcher error");
        _watcher = watcher;
        gate.IsWatching = true;
        gate.WatchPath = folder;
        logger.LogInformation("Edari folder watch: {Path}", folder);
    }

    private void OnRenamed(object sender, RenamedEventArgs e) => ScheduleSignal();

    private void OnChanged(object sender, FileSystemEventArgs e) => ScheduleSignal();

    private void ScheduleSignal()
    {
        var prev = Interlocked.Exchange(ref _debounce, new CancellationTokenSource());
        try { prev?.Cancel(); }
        catch { /* ignore */ }
        prev?.Dispose();

        var cts = _debounce;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(1200, cts!.Token);
                gate.SignalFileChange();
            }
            catch (OperationCanceledException)
            {
                /* coalesced */
            }
        });
    }

    private void DisposeWatcher()
    {
        if (_watcher is null) return;
        try
        {
            _watcher.EnableRaisingEvents = false;
            _watcher.Changed -= OnChanged;
            _watcher.Created -= OnChanged;
            _watcher.Deleted -= OnChanged;
            _watcher.Renamed -= OnRenamed;
            _watcher.Dispose();
        }
        catch
        {
            /* ignore */
        }
        _watcher = null;
        _path = null;
    }
}
