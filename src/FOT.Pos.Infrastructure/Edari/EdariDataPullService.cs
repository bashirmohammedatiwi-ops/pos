using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariDataPullService(
    EdariSettingsService settings,
    EdariNexusClient nexus,
    EdariSalesmenSyncService salesmenSync,
    EdariArticlesSyncService articlesSync,
    EdariBranchesSyncService branchesSync,
    EdariAccountsSyncService accountsSync,
    EdariCatalogSyncService catalogSync,
    EdariReceiptSyncService receiptSync,
    EdariDashboardCache dashboardCache,
    EdariSettingsRepository settingsRepo,
    EdariSyncRepository syncRepo,
    EdariSyncGate gate,
    IEdariRealtimeNotifier notifier,
    TreeMembershipRefresher treeMembership,
    IMemoryCache memoryCache)
{
    public async Task<EdariFullSyncResult> FullSyncAsync(
        bool includeCatalog, bool pushReceipts, int receiptBatchSize, CancellationToken ct)
    {
        var pull = await PullAsync(includeCatalog, ct);
        var receiptsSynced = 0;
        var receiptsFailed = 0;

        if (pushReceipts && pull.Ok)
        {
            var receiptResult = await receiptSync.SyncBatchAsync(Math.Clamp(receiptBatchSize, 1, 200), ct);
            receiptsSynced = receiptResult.ReceiptsSynced;
            receiptsFailed = receiptResult.ReceiptsFailed;
        }

        var ok = pull.Ok && receiptsFailed == 0;
        var message = pull.Message;
        if (pushReceipts && pull.Ok)
        {
            message += receiptsSynced > 0 || receiptsFailed > 0
                ? $" · فواتير: {receiptsSynced} متزامنة"
                : " · لا فواتير معلّقة";
            if (receiptsFailed > 0)
                message += $" · {receiptsFailed} فشل";
        }

        return new EdariFullSyncResult(
            ok,
            message,
            pull.SalesmenTotal,
            pull.ArticlesAdded,
            pull.ArticlesUpdated,
            pull.ArticlesTotal,
            pull.SectionsCreated,
            receiptsSynced,
            receiptsFailed,
            pull.OffersImported,
            DateTime.UtcNow,
            pull.ArticlesDeleted);
    }

    public async Task<EdariDataPullResult> PullAsync(bool includeCatalog, CancellationToken ct)
    {
        if (!await gate.WaitAsync(TimeSpan.FromMinutes(3), ct))
        {
            return new EdariDataPullResult(
                false, "مزامنة أخرى من الإداري قيد التنفيذ — أعد المحاولة بعد لحظات",
                0, 0, 0, 0, 0, 0, 0, 0, null, null, null, DateTime.UtcNow);
        }

        try
        {
            return await PullCoreAsync(includeCatalog, ct);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<EdariDataPullResult> PullCoreAsync(bool includeCatalog, CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
        {
            return new EdariDataPullResult(
                false, "تكامل الإداري معطّل", 0, 0, 0, 0, 0, 0, 0, 0, null, null, null, DateTime.UtcNow);
        }

        if (!EdariConnectionFactory.DataFolderExists(opts))
        {
            var folderMsg = $"مجلد النسخة غير موجود: {opts.YearFolder}";
            await settingsRepo.UpdateConnectionTestAsync(false, folderMsg, ct);
            await syncRepo.LogOperationAsync("data_pull", "failed", folderMsg, ct);
            return new EdariDataPullResult(
                false, folderMsg, 0, 0, 0, 0, 0, 0, 0, 0, null, null, null, DateTime.UtcNow);
        }

        var test = await nexus.TestConnectionAsync(ct);
        await settingsRepo.UpdateConnectionTestAsync(test.Ok, test.Message, ct);
        if (!test.Ok)
        {
            await syncRepo.LogOperationAsync("data_pull", "failed", test.Message, ct);
            return new EdariDataPullResult(
                false, test.Message, 0, 0, 0, 0, 0, 0, 0, 0, test.MaterialTreeCount, test.OfferCount, null, DateTime.UtcNow);
        }

        dashboardCache.Invalidate();

        // Branches first — authoritative section names from Edari FileBrch
        var branches = await branchesSync.SyncAsync(ct);
        // Chart of accounts: cash boxes added in Edari must be linkable to a section right away.
        var accounts = await SyncAccountsSafeAsync(ct);
        var salesmen = await salesmenSync.SyncAsync(ct);
        var articles = await articlesSync.SyncAsync(ct);

        var catalogImported = 0;
        if (includeCatalog && opts.CatalogSyncEnabled)
            catalogImported = await catalogSync.ImportOffersAsync(ct);

        await settingsRepo.UpdateLastDataPullAsync(ct);

        var stats = await nexus.GetDashboardStatsAsync(ct);
        var msg = BuildMessage(salesmen, articles, branches, accounts, catalogImported, stats);
        var ok = salesmen.Success && articles.Success && branches.Success;
        await syncRepo.LogOperationAsync("data_pull", ok ? "success" : "failed", msg, ct);

        if (ok)
        {
            try
            {
                var fp = await nexus.GetCatalogFingerprintAsync(ct);
                await settingsRepo.SaveFingerprintAsync(fp.Token, ct);
            }
            catch
            {
                await settingsRepo.TouchHeartbeatAsync(ct);
            }

            var dataChanged = articles.Added + articles.Updated + articles.Deleted + salesmen.Added + salesmen.Updated
                + branches.SectionsCreated + catalogImported + accounts.Added + accounts.Removed > 0;

            // Products/trees just changed on the Edari side — drop every derived in-memory cache
            // (salesman-attribution rules, target-tree product membership, etc.) so nothing in the
            // control panel keeps answering from a snapshot that no longer matches Edari.
            if (dataChanged && memoryCache is MemoryCache concreteCache)
                concreteCache.Compact(1.0);

            // Dynamic tree membership: articles changed → products may have joined/left
            // registered trees in Edari; pull the new members into offers & commission
            // groups so whatever the tree carries applies to them automatically.
            if (articles.Added + articles.Updated > 0)
            {
                try
                {
                    var membership = await treeMembership.RefreshAllAsync(ct);
                    if (membership.OffersItemsAdded + membership.GroupItemsAdded > 0)
                        msg += $" · انضم {membership.OffersItemsAdded + membership.GroupItemsAdded} صنف جديد إلى أشجار العروض والمجاميع";
                }
                catch
                {
                    /* membership refresh is best-effort — never fails the pull */
                }
            }

            await notifier.NotifyEdariAsync(msg, dataChanged, ct);
        }

        return new EdariDataPullResult(
            ok,
            msg,
            salesmen.Added,
            salesmen.Updated,
            salesmen.Total,
            catalogImported,
            articles.Added,
            articles.Updated,
            articles.Total,
            branches.SectionsCreated,
            stats.Materials,
            stats.TreeFolders,
            stats.Branches,
            DateTime.UtcNow,
            articles.Deleted);
    }

    /// <summary>
    /// Accounts are a convenience mirror: a failure here must never abort a pull that still
    /// brought products, sections and salesmen across.
    /// </summary>
    private async Task<EdariAccountsSyncResult> SyncAccountsSafeAsync(CancellationToken ct)
    {
        try
        {
            return await accountsSync.SyncAsync(ct);
        }
        catch (Exception ex)
        {
            return new EdariAccountsSyncResult(false, ex.Message, 0, 0, 0, 0, DateTime.UtcNow);
        }
    }

    private static string BuildMessage(
        EdariSalesmenSyncResult salesmen,
        EdariArticlesSyncResult articles,
        EdariBranchesSyncResult branches,
        EdariAccountsSyncResult accounts,
        int catalogImported,
        EdariDashboardStatsDto stats)
    {
        var parts = new List<string>
        {
            $"{stats.Branches} فرع",
            $"{stats.Materials:N0} مادة Edari",
            $"{articles.Total:N0} مادة محلية",
            salesmen.Total > 0 ? $"{salesmen.Total} بائع" : "لا أسماء بائعين في سجل الإداري",
        };
        if (branches.BranchCount > 0)
            parts.Add($"{branches.BranchCount} فرع متزامن");
        if (branches.SectionsCreated > 0)
            parts.Add($"{branches.SectionsCreated} قسم جديد");
        if (accounts.Success && accounts.CashBoxes > 0)
        {
            var accountParts = $"{accounts.CashBoxes} صندوق";
            if (accounts.Added > 0) accountParts += $" (+{accounts.Added})";
            parts.Add(accountParts);
        }
        if (salesmen.Added > 0 || salesmen.Updated > 0)
            parts.Add($"بائعون: +{salesmen.Added} / ~{salesmen.Updated}");
        if (articles.Added > 0 || articles.Updated > 0 || articles.Deleted > 0)
        {
            var articleParts = $"+{articles.Added:N0} / ~{articles.Updated:N0}";
            if (articles.Deleted > 0)
                articleParts += $" / -{articles.Deleted:N0}";
            parts.Add($"منتجات: {articleParts}");
        }
        if (catalogImported > 0)
            parts.Add($"{catalogImported} عرض");
        return "تم جلب البيانات — " + string.Join(" · ", parts);
    }
}

public sealed record EdariDataPullResult(
    bool Ok,
    string Message,
    int SalesmenAdded,
    int SalesmenUpdated,
    int SalesmenTotal,
    int OffersImported,
    int ArticlesAdded,
    int ArticlesUpdated,
    int ArticlesTotal,
    int SectionsCreated,
    int? MaterialCount,
    int? TreeFolderCount,
    int? BranchCount,
    DateTime FinishedAt,
    int ArticlesDeleted = 0);
