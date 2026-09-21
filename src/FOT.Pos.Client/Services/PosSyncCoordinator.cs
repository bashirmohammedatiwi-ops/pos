namespace FOT.Pos.Client.Services;

/// <summary>مزامنة خلفية: فواتير معلّقة ثم كتالوج ثم بيانات مرجعية.</summary>
public sealed class PosSyncCoordinator(ApiService api, CatalogSyncService sync, LocalCatalogStore catalog)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTime _lastRun = DateTime.MinValue;
    private bool _wasOnline;

    public bool IsRunning { get; private set; }

    public event Action<int>? ReceiptsUploaded;
    public event Action<bool>? OnlineStateChanged;

    public async Task RunAsync(bool force = false, CancellationToken ct = default)
    {
        if (!force && DateTime.UtcNow - _lastRun < TimeSpan.FromSeconds(8))
            return;

        if (!await _gate.WaitAsync(0, ct))
            return;

        IsRunning = true;
        try
        {
            _lastRun = DateTime.UtcNow;
            var online = await api.IsOnlineAsync();
            if (online != _wasOnline)
            {
                _wasOnline = online;
                OnlineStateChanged?.Invoke(online);
            }

            if (!online) return;

            try { await api.HeartbeatAsync(); } catch { /* ignore */ }

            if (catalog.PendingReceiptCount > 0)
            {
                var (synced, _) = await sync.SyncPendingReceiptsAsync(ct);
                if (synced > 0) ReceiptsUploaded?.Invoke(synced);
            }

            await sync.SyncCatalogAsync(ct: ct);
            await api.CacheReferenceDataAsync(ct);
        }
        finally
        {
            IsRunning = false;
            _gate.Release();
        }
    }
}
