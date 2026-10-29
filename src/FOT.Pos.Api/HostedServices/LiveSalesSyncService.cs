using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// مبيعات المحل المباشرة لتطبيق المدراء على خادم الفريق:
///  • «اليوم» يُرفع خلال ثوانٍ من كل فاتورة (حدث receipt.created) وكل 45 ثانية على الأقل (حالة نقاط البيع).
///  • الأيام السابقة: حزمة مفصّلة لكل يوم (آخر SalesHistoryDays يوماً) — تُرفع الأيام الجديدة أو المتغيّرة فقط
///    (البيع دون اتصال قد يُسجَّل بتاريخ سابق)، مع إجماليات يومية لسنة كاملة.
/// </summary>
public sealed class LiveSalesSyncService(
    IHttpClientFactory http,
    IServiceScopeFactory scopes,
    IConfiguration config,
    NetworkEventBus bus,
    ILogger<LiveSalesSyncService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private volatile bool _dirty = true;
    private DateTime _lastLive = DateTime.MinValue;
    private DateTime _nextHistory = DateTime.MinValue;
    private DateTime _hubMissingUntil = DateTime.MinValue;
    /// <summary>بصمة كل يوم كما هو على خادم الفريق (تُقرأ منه مرة ثم تُحدَّث محلياً).</summary>
    private Dictionary<string, string>? _remote;

    private bool Ready => config.GetValue("SellerWeb:Enabled", true) && HubSyncKeyStore.ReadConfigured(config) is not null;
    private string SyncUrl => (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
    private int HistoryDays => Math.Clamp(config.GetValue("SellerWeb:SalesHistoryDays", 120), 7, 400);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var (subId, reader) = bus.Subscribe();
        _ = Task.Run(async () =>
        {
            try
            {
                await foreach (var e in reader.ReadAllAsync(stoppingToken))
                    if (e.EventType == "receipt.created") _dirty = true;
            }
            catch (OperationCanceledException)
            {
                /* إيقاف */
            }
        }, stoppingToken);
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(12), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var now = DateTime.Now;
                    if (Ready && now >= _hubMissingUntil)
                    {
                        if ((_dirty && now - _lastLive >= TimeSpan.FromSeconds(3)) || now - _lastLive >= TimeSpan.FromSeconds(45))
                        {
                            _dirty = false;
                            _lastLive = now;
                            await PushLiveAsync(stoppingToken);
                        }
                        if (now >= _nextHistory)
                        {
                            var backlog = await PushHistoryAsync(stoppingToken);
                            // بقيت أيام لم تُرفع بعد (أول تشغيل): نكمل قريباً دون إثقال السيرفر
                            _nextHistory = DateTime.Now.AddSeconds(backlog ? 20 : 600);
                        }
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Live sales sync failed");
                    _nextHistory = DateTime.Now.AddMinutes(2);
                    await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                }
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            /* إيقاف */
        }
        finally
        {
            bus.Unsubscribe(subId);
        }
    }

    private async Task PushLiveAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<LiveSalesRepository>();
        var today = DateTime.Today;
        var pack = await repo.BuildDayAsync(today, 60, ct);
        var recent = await repo.RecentAsync(today, 40, ct);
        var terminals = await repo.TerminalsAsync(today, ct);
        await PostAsync(new { live = new { pack, recent, terminals, at = DateTime.Now } }, ct);
    }

    /// <summary>يرفع الأيام الناقصة أو المتغيّرة (حتى 12 يوماً في الدورة). يعيد true إن بقيت أيام.</summary>
    private async Task<bool> PushHistoryAsync(CancellationToken ct)
    {
        _remote ??= await FetchHashesAsync(ct);
        if (_remote is null) return false;
        using var scope = scopes.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<LiveSalesRepository>();
        var today = DateTime.Today;

        var totals = await repo.DailyAsync(today.AddDays(-400), today, ct);
        var hasSales = totals.Select(t => t.Day).ToHashSet();
        var batch = new List<object>();
        var built = 0;
        var backlog = false;
        for (var i = 1; i <= HistoryDays; i++)
        {
            var day = today.AddDays(-i);
            var key = day.ToString("yyyy-MM-dd");
            // آخر 3 أيام تُعاد دائماً (بيع متأخر)؛ الأقدم يُرفع مرة فقط. يوم بلا مبيعات لا يحتاج حزمة
            var recentDay = i <= 3;
            if (!hasSales.Contains(key) && !_remote.ContainsKey(key)) continue;
            if (!recentDay && _remote.ContainsKey(key)) continue;
            if (built >= 12)
            {
                backlog = true;
                break;
            }
            built++;
            var pack = await repo.BuildDayAsync(day, 40, ct);
            var hash = Hash(pack);
            if (_remote.TryGetValue(key, out var old) && old == hash) continue;
            batch.Add(new { day = key, hash, pack });
            _remote[key] = hash;
        }
        await PostAsync(new { days = batch, totals }, ct);
        return backlog;
    }

    private async Task<Dictionary<string, string>?> FetchHashesAsync(CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{SyncUrl}/api/sync/sales/hashes");
        req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", HubSyncKeyStore.Read(config));
        using var res = await http.CreateClient(SellerHubSyncService.ClientName).SendAsync(req, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            HubMissing();
            return null;
        }
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<HashesResponse>(Json, ct);
        return body?.Days ?? [];
    }

    private async Task PostAsync(object payload, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}/api/sync/sales");
        req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", HubSyncKeyStore.Read(config));
        req.Content = JsonContent.Create(payload, options: Json);
        using var res = await http.CreateClient(SellerHubSyncService.ClientName).SendAsync(req, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            HubMissing();
            return;
        }
        if (!res.IsSuccessStatusCode) logger.LogWarning("Live sales push rejected {Status}", (int)res.StatusCode);
    }

    /// <summary>خادم فريق أقدم بلا مسار المبيعات: نعيد المحاولة بعد 10 دقائق (ونقرأ البصمات من جديد).</summary>
    private void HubMissing()
    {
        _hubMissingUntil = DateTime.Now.AddMinutes(10);
        _remote = null;
    }

    private static string Hash(SalesDayPack pack) =>
        Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(pack, Json))))[..16];

    private sealed class HashesResponse
    {
        public Dictionary<string, string>? Days { get; set; }
    }
}
