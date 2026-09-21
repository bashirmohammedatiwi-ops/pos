using System.Net.Http.Json;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.HostedServices;

public interface ISellerHubSync
{
    Task<bool> PushNowAsync(CancellationToken ct);
}

public sealed class SellerHubSyncService(
    IHttpClientFactory http,
    IServiceScopeFactory scopes,
    IConfiguration config,
    ILogger<SellerHubSyncService> logger) : BackgroundService, ISellerHubSync
{
    public const string ClientName = "SellerHubSync";
    private readonly SemaphoreSlim _gate = new(1, 1);

    private bool Enabled => config.GetValue("SellerWeb:Enabled", true);
    private string SyncUrl => (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
    private string SyncKey => config["SellerWeb:SyncKey"] ?? "fot-hub-sync-e7Kq9mN2pL4xW8vR";
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
        if (!Enabled) return false;
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

            var payload = new SellerHubSyncRequest(DateTime.UtcNow, rows, snapshots, managers, managerSnapshot);
            var client = http.CreateClient(ClientName);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}/api/sync");
            req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", SyncKey);
            req.Content = JsonContent.Create(payload);
            using var res = await client.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct);
                logger.LogWarning("Seller hub sync rejected {Status}: {Body}", (int)res.StatusCode, body);
                return false;
            }

            logger.LogInformation("Seller hub sync uploaded {Sellers} seller(s) and {Managers} manager(s)", snapshots.Count, managers.Count);
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
