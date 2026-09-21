using System.Text.Json;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public sealed class CatalogSyncService(ApiService api, LocalCatalogStore store)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private const int MaxReceiptRetries = 12;

    public event Action<int, int>? ProgressChanged;
    public event Action? SyncCompleted;

    public string? LastReceiptSyncError { get; private set; }

    public bool IsSyncing { get; private set; }

    public async Task SyncCatalogAsync(bool fullRefresh = false, CancellationToken ct = default)
    {
        if (IsSyncing) return;
        if (!await api.IsOnlineAsync()) return;

        IsSyncing = true;
        try
        {
            if (fullRefresh || store.NeedsSchemaRefresh()) store.ClearProducts();

            var info = await api.GetCatalogInfoAsync();
            if (info is null) return;

            var sinceSeq = store.LastSyncedSeq;
            var total = info.TotalProducts;
            var synced = store.ProductCount;

            while (!ct.IsCancellationRequested)
            {
                var batch = await api.SyncCatalogBatchAsync(sinceSeq);
                if (batch is null || batch.Count == 0) break;

                store.UpsertProducts(batch);
                sinceSeq = batch.Max(p => p.Seq);
                store.LastSyncedSeq = sinceSeq;
                synced = store.ProductCount;
                ProgressChanged?.Invoke(synced, total);

                if (batch.Count < 500) break;
            }

            await ReconcileDeletedAsync(total);
            store.MarkSchemaCurrent();
            SyncCompleted?.Invoke();
        }
        finally
        {
            IsSyncing = false;
        }
    }

    /// <summary>
    /// The delta feed only adds and updates, so a product deleted in Edari stays here forever.
    /// When the local count exceeds the server's, the authoritative id list decides what to drop.
    /// </summary>
    private async Task ReconcileDeletedAsync(int serverTotal)
    {
        if (serverTotal <= 0 || store.ProductCount <= serverTotal) return;
        try
        {
            var live = await api.GetCatalogIdsAsync();
            if (live?.Ids is { Count: > 0 }) store.PruneProducts(live.Ids);
        }
        catch
        {
            /* best-effort — the next sync retries */
        }
    }

    public async Task<(int Synced, string? Error)> SyncPendingReceiptsAsync(CancellationToken ct = default)
    {
        LastReceiptSyncError = null;
        if (!await api.IsOnlineAsync())
        {
            LastReceiptSyncError = "غير متصل بالخادم";
            return (0, LastReceiptSyncError);
        }

        var pending = store.GetPendingReceipts();
        var synced = 0;
        foreach (var entry in pending)
        {
            if (ct.IsCancellationRequested) break;
            if (entry.RetryCount >= MaxReceiptRetries)
            {
                LastReceiptSyncError = $"توقف رفع فاتورة محلية #{entry.LocalNumber} بعد عدة محاولات";
                continue;
            }

            var req = JsonSerializer.Deserialize<CreateReceiptRequest>(entry.Payload, Json);
            if (req is null)
            {
                LastReceiptSyncError = "تعذّر قراءة فاتورة محلية — راجع الدعم الفني";
                store.RecordReceiptSyncError(entry.Id, LastReceiptSyncError);
                break;
            }

            if (req.ClientReceiptId is null && entry.ClientReceiptId != Guid.Empty)
                req = req with { ClientReceiptId = entry.ClientReceiptId };

            var (result, error) = await api.TryCreateReceiptAsync(req, replayingPending: true);
            if (result is null || result.ReceiptId <= 0)
            {
                LastReceiptSyncError = error ?? "تعذّر رفع الفاتورة للخادم";
                store.RecordReceiptSyncError(entry.Id, LastReceiptSyncError);
                break;
            }

            store.MarkReceiptSynced(entry.Id);
            synced++;
        }

        return (synced, LastReceiptSyncError);
    }
}
