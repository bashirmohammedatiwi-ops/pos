using System.Net.Http.Json;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.HostedServices;

public interface ISellerHubSync
{
    Task<bool> PushNowAsync(CancellationToken ct);

    /// <summary>إعادة بناء حزم مبيعات البراندات في الرفع القادم (بعد تعديل الربط).</summary>
    void RequestBrandRefresh();

    /// <summary>
    /// رفع فوري خفيف (≈ ثانية): الحسابات وأوقات الفتح والإيقاف وروابط البراندات والمدراء.
    /// لا ينتظر المزامنة الكاملة الثقيلة — الويب يبلّغ الهاتف فوراً عبر القناة الحية.
    /// </summary>
    Task<bool> PushAccountsNowAsync(CancellationToken ct);

    /// <summary>بناء حزم براندات بائع محدد ورفعها فوراً (بعد ربط شجرة جديدة).</summary>
    Task<bool> PushBrandPacksForAsync(long salesmanId, CancellationToken ct);
}

public sealed class SellerHubSyncService(
    IHttpClientFactory http,
    IServiceScopeFactory scopes,
    IConfiguration config,
    ILogger<SellerHubSyncService> logger) : BackgroundService, ISellerHubSync
{
    public const string ClientName = "SellerHubSync";
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTime _brandsBuiltAt = DateTime.MinValue;
    private volatile bool _brandsForced = true;

    /// <summary>حزم البراندات ثقيلة نسبياً — تُبنى كل 10 دقائق أو فوراً عند تغيير الربط.</summary>
    private int BrandIntervalMinutes => Math.Clamp(config.GetValue("SellerWeb:BrandIntervalMinutes", 10), 2, 240);
    private int BrandHistoryDays => Math.Clamp(config.GetValue("SellerWeb:BrandHistoryDays", 400), 31, 1500);

    public void RequestBrandRefresh() => _brandsForced = true;

    private readonly SemaphoreSlim _quickGate = new(1, 1);

    public async Task<bool> PushAccountsNowAsync(CancellationToken ct)
    {
        if (!Ready) return false;
        await _quickGate.WaitAsync(ct);
        try
        {
            using var scope = scopes.CreateScope();
            var accounts = scope.ServiceProvider.GetRequiredService<PortalAccountRepository>();
            var brandRepo = scope.ServiceProvider.GetRequiredService<SellerBrandRepository>();
            var rows = await accounts.ListSyncAccountsAsync(ct);
            var activeIds = rows.Select(r => r.Id).ToHashSet();
            var links = (await brandRepo.ListLinksAsync(null, ct)).Where(l => activeIds.Contains(l.SalesmanId)).ToList();
            var managers = await accounts.ListSyncManagersAsync(ct);
            // موظفو تطبيق الفريق (كل الأنواع) — يحملون الرمز المشفّر فقط
            var staffRepo = scope.ServiceProvider.GetRequiredService<StaffRepository>();
            IReadOnlyList<StaffSyncDto> staff = [];
            try
            {
                staff = await staffRepo.ListSyncAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Team staff list failed");
            }
            var client = http.CreateClient(ClientName);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}/api/sync/accounts");
            req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", SyncKey);
            req.Content = JsonContent.Create(new { accounts = rows, brandLinks = links, managers, staff });
            using var res = await client.SendAsync(req, ct);
            if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // ويب أقدم بلا المسار السريع — مزامنة كاملة
                return await PushNowAsync(ct);
            }
            if (!res.IsSuccessStatusCode)
            {
                logger.LogWarning("Seller hub quick sync rejected {Status}", (int)res.StatusCode);
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Seller hub quick sync failed");
            return false;
        }
        finally
        {
            _quickGate.Release();
        }
    }

    public async Task<bool> PushBrandPacksForAsync(long salesmanId, CancellationToken ct)
    {
        if (!Ready) return false;
        try
        {
            using var scope = scopes.CreateScope();
            var brandRepo = scope.ServiceProvider.GetRequiredService<SellerBrandRepository>();
            var links = await brandRepo.ListLinksAsync(salesmanId, ct);
            if (links.Count == 0) return true;
            var from = DateTime.Today.AddDays(-BrandHistoryDays);
            var packs = new List<SellerBrandPackDto>();
            foreach (var l in links)
                packs.Add(await brandRepo.BuildPackAsync(l.TreeSeq, l.TreeName ?? $"#{l.TreeSeq}", from, ct));
            var client = http.CreateClient(ClientName);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}/api/sync/brand-packs");
            req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", SyncKey);
            req.Content = JsonContent.Create(new { brands = packs });
            using var res = await client.SendAsync(req, ct);
            if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                RequestBrandRefresh();
                return await PushNowAsync(ct);
            }
            return res.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Seller brand quick push failed for {Id}", salesmanId);
            RequestBrandRefresh();
            return false;
        }
    }

    /// <summary>
    /// مفتاح المزامنة مع خادم الفريق — سري، يُضبط في appsettings.json المثبّت على سيرفر المحل
    /// (أو متغير البيئة SellerWeb__SyncKey) أو من لوحة التحكم (HubSyncKeyStore) — وليس في git. فارغ = المزامنة متوقفة حتى يُضبط.
    /// </summary>
    public static string? ReadSyncKey(IConfiguration config) => HubSyncKeyStore.Read(config);

    private bool Enabled => config.GetValue("SellerWeb:Enabled", true);
    /// <summary>الإعدادات تُقرأ في كل مرة: ضبط المفتاح يسري دون إعادة تشغيل السيرفر.</summary>
    private bool Ready => Enabled && ReadSyncKey(config) is not null;
    private string SyncUrl => (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
    private string SyncKey => ReadSyncKey(config) ?? "";
    private int IntervalSeconds => Math.Clamp(config.GetValue("SellerWeb:IntervalSeconds", 60), 20, 3600);
    private int WeekCount => Math.Clamp(config.GetValue("SellerWeb:WeekCount", 8), 1, 12);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled)
        {
            logger.LogInformation("Seller hub sync is disabled");
            return;
        }

        logger.LogInformation("Seller hub sync started -> {Url} every {Seconds}s", SyncUrl, IntervalSeconds);
        if (HubSyncKeyStore.ReadConfigured(config) is null)
            logger.LogWarning("Hub sync key is not set — using the legacy key until it is entered in the control panel (Team app → Updates)");
        await Task.Delay(TimeSpan.FromSeconds(8), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PushNowAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Seller hub sync tick failed");
            }

            await Task.Delay(TimeSpan.FromSeconds(IntervalSeconds), stoppingToken);
        }
    }

    public async Task<bool> PushNowAsync(CancellationToken ct)
    {
        if (!Ready) return false;
        await _gate.WaitAsync(ct);
        try
        {
            using var scope = scopes.CreateScope();
            var accounts = scope.ServiceProvider.GetRequiredService<PortalAccountRepository>();
            var sellers = scope.ServiceProvider.GetRequiredService<SellerPortalRepository>();
            var managersRepo = scope.ServiceProvider.GetRequiredService<ManagerPortalRepository>();
            var rows = await accounts.ListSyncAccountsAsync(ct);
            var snapshots = new List<SellerHubSnapshotDto>();
            foreach (var row in rows)
            {
                try
                {
                    snapshots.Add(await BuildSnapshotAsync(sellers, row, ct));
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Seller hub snapshot failed for {Id}", row.Id);
                }
            }

            var managers = await accounts.ListSyncManagersAsync(ct);
            ManagerHubSnapshotDto? managerSnapshot = null;
            try
            {
                managerSnapshot = await managersRepo.BuildSnapshotAsync(WeekCount, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Manager hub snapshot failed");
            }

            var brandRepo = scope.ServiceProvider.GetRequiredService<SellerBrandRepository>();
            IReadOnlyList<SellerBrandLinkDto>? brandLinks = null;
            List<SellerBrandPackDto>? brandPacks = null;
            var brandsBuilt = false;
            try
            {
                var activeIds = rows.Select(r => r.Id).ToHashSet();
                brandLinks = (await brandRepo.ListLinksAsync(null, ct)).Where(l => activeIds.Contains(l.SalesmanId)).ToList();
                var forced = _brandsForced;
                if (forced || DateTime.UtcNow - _brandsBuiltAt > TimeSpan.FromMinutes(BrandIntervalMinutes))
                {
                    // نصفّر الطلب قبل البناء: أي طلب يصل أثناء البناء يبقى قائماً للدورة التالية
                    _brandsForced = false;
                    brandPacks = [];
                    var from = DateTime.Today.AddDays(-BrandHistoryDays);
                    foreach (var tree in brandLinks.GroupBy(l => l.TreeSeq))
                    {
                        try
                        {
                            brandPacks.Add(await brandRepo.BuildPackAsync(tree.Key, tree.First().TreeName ?? $"#{tree.Key}", from, ct));
                        }
                        catch (Exception ex)
                        {
                            // الويب يحتفظ بحزمة هذه الشجرة السابقة؛ نعيد المحاولة في الدورة القادمة
                            _brandsForced = true;
                            logger.LogWarning(ex, "Seller brand pack failed for tree {Tree}", tree.Key);
                        }
                    }
                    brandsBuilt = true;
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Seller brand links failed");
            }

            var payload = new SellerHubSyncRequest(DateTime.UtcNow, rows, snapshots, managers, managerSnapshot, brandLinks, brandPacks);
            var client = http.CreateClient(ClientName);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}/api/sync");
            req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", SyncKey);
            req.Content = JsonContent.Create(payload);
            using var res = await client.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode)
            {
                if (brandsBuilt) _brandsForced = true;
                var body = await res.Content.ReadAsStringAsync(ct);
                logger.LogWarning("Seller hub sync rejected {Status}: {Body}", (int)res.StatusCode, body);
                return false;
            }

            if (brandsBuilt) _brandsBuiltAt = DateTime.UtcNow;
            logger.LogInformation("Seller hub sync uploaded {Sellers} seller(s), {Managers} manager(s), {Brands} brand pack(s)",
                snapshots.Count, managers.Count, brandPacks?.Count ?? -1);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Seller hub sync upload failed");
            return false;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<SellerHubSnapshotDto> BuildSnapshotAsync(
        SellerPortalRepository sellers, SellerHubAccountDto row, CancellationToken ct)
    {
        var me = await sellers.GetMeAsync(row.Id, ct) ?? new SellerMeDto(row.Id, row.Name, row.MustChangePin);
        var weeks = await sellers.ListWeeksAsync(row.Id, WeekCount, ct);
        var groups = await sellers.ListCommissionGroupsAsync(row.Id, ct);
        var products = await sellers.ListCommissionProductsAsync(row.Id, ct);
        var dash = await sellers.GetDashboardAsync(row.Id, null, ct);
        var packs = new List<SellerHubWeekPackDto>();
        foreach (var week in weeks)
        {
            var malls = await sellers.ListMallsAsync(row.Id, week.WeekStart, week.WeekEnd, ct, hideSales: false);
            var goals = await sellers.ListGoalsAsync(row.Id, week.WeekStart, week.WeekEnd, ct);
            var commission = await sellers.ListCommissionLinesAsync(row.Id, week.WeekStart, week.WeekEnd, null, ct);
            var details = new List<SellerGoalDetailDto>();
            foreach (var goal in goals)
            {
                var detail = await sellers.GetGoalDetailAsync(row.Id, goal.RuleId, week.WeekStart, week.WeekEnd, ct);
                if (detail is not null) details.Add(detail);
            }
            packs.Add(new SellerHubWeekPackDto(week.WeekStart, week, malls, goals, commission, details));
        }

        return new SellerHubSnapshotDto(me, dash.BalanceDue, weeks, groups, products, packs);
    }
}
