using System.Net.Http.Json;
using System.Text.Json;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// نقل الفواتير الكاملة إلى خادم الفريق ليعرضها المدير في التطبيق:
///  • الفواتير الجديدة تُرفع خلال ثوانٍ من البيع (أو كل 45 ثانية على الأقل).
///  • كل 5 دقائق تُقارن بصمة كل يوم بما على الخادم، ويُعاد رفع اليوم الناقص أو المتغيّر فقط
///    (أول تشغيل، بيع دون اتصال، تعديل فاتورة). الأحدث أولاً و8 أيام في الدورة حتى لا يثقل السيرفر.
/// </summary>
public sealed class InvoiceSyncService(
    IHttpClientFactory http,
    IServiceScopeFactory scopes,
    IConfiguration config,
    NetworkEventBus bus,
    ILogger<InvoiceSyncService> logger) : BackgroundService
{
    private const int DaysPerCycle = 8;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private volatile bool _dirty = true;
    private long? _cursor;
    private DateTime _lastFresh = DateTime.MinValue;
    private DateTime _nextReconcile = DateTime.MinValue;
    private DateTime _hubMissingUntil = DateTime.MinValue;

    private bool Ready => config.GetValue("SellerWeb:Enabled", true) && HubSyncKeyStore.ReadConfigured(config) is not null;
    private string SyncUrl => (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
    private int KeepDays => Math.Clamp(config.GetValue("SellerWeb:InvoiceDays", 1100), 7, 3700);

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
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var now = DateTime.Now;
                    if (Ready && now >= _hubMissingUntil)
                    {
                        if (now >= _nextReconcile)
                        {
                            var backlog = await ReconcileAsync(stoppingToken);
                            _nextReconcile = DateTime.Now.AddSeconds(backlog ? 20 : 300);
                        }
                        if (_cursor is not null &&
                            ((_dirty && now - _lastFresh >= TimeSpan.FromSeconds(3)) || now - _lastFresh >= TimeSpan.FromSeconds(45)))
                        {
                            _dirty = false;
                            _lastFresh = now;
                            await PushFreshAsync(stoppingToken);
                        }
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Invoice sync failed");
                    _nextReconcile = DateTime.Now.AddMinutes(2);
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

    /// <summary>ما بعد آخر فاتورة مرفوعة — أي تاريخ كانت، فالفاتورة المتأخرة تأخذ رقماً أحدث.</summary>
    private async Task PushFreshAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<InvoiceSyncRepository>();
        var rows = await repo.AfterAsync(_cursor ?? 0, 300, ct);
        if (rows.Count == 0) return;
        if (await PostAsync(new { rows }, ct)) _cursor = rows.Max(r => r.Id);
    }

    /// <summary>يرفع الأيام الناقصة أو المتغيّرة. يعيد true إن بقي منها شيء.</summary>
    private async Task<bool> ReconcileAsync(CancellationToken ct)
    {
        var state = await FetchStateAsync(ct);
        if (state is null) return false;
        using var scope = scopes.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<InvoiceSyncRepository>();
        var from = DateTime.Today.AddDays(-KeepDays);
        var local = await repo.DaySignaturesAsync(from, ct);
        var localDays = local.ToDictionary(d => d.Day);
        var remoteDays = (state.Days ?? []).ToDictionary(d => d.Day);
        var fromKey = from.ToString("yyyy-MM-dd");

        var changed = local.Where(d => !remoteDays.TryGetValue(d.Day, out var r) || !Same(d, r)).Select(d => d.Day)
            // يوم على الخادم لم يعد في المحل
            .Concat(remoteDays.Keys.Where(k => !localDays.ContainsKey(k) && string.CompareOrdinal(k, fromKey) >= 0))
            .OrderByDescending(k => k, StringComparer.Ordinal)
            .ToList();

        var maxId = state.MaxId;
        var done = 0;
        foreach (var key in changed.Take(DaysPerCycle))
        {
            var rows = await repo.ByDayAsync(DateTime.ParseExact(key, "yyyy-MM-dd", null), ct);
            if (!await PostAsync(new { day = key, rows }, ct)) break;
            if (rows.Count > 0) maxId = Math.Max(maxId, rows.Max(r => r.Id));
            done++;
        }
        _cursor = Math.Max(_cursor ?? 0, maxId);
        var pending = changed.Count - done;
        await PostAsync(new { status = new { shopCount = local.Sum(d => d.N), pendingDays = pending, at = DateTime.Now } }, ct);
        return pending > 0;
    }

    private static bool Same(InvoiceDaySignature a, InvoiceDaySignature b) =>
        a.N == b.N && a.MaxId == b.MaxId && a.Edits == b.Edits && a.Printed == b.Printed && Math.Abs(a.Sum - b.Sum) < 1;

    private async Task<StateResponse?> FetchStateAsync(CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{SyncUrl}/api/sync/sales/invoices/state");
        req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", HubSyncKeyStore.Read(config));
        using var res = await http.CreateClient(SellerHubSyncService.ClientName).SendAsync(req, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            HubMissing();
            return null;
        }
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<StateResponse>(Json, ct);
    }

    private async Task<bool> PostAsync(object payload, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}/api/sync/sales/invoices");
        req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", HubSyncKeyStore.Read(config));
        req.Content = JsonContent.Create(payload, options: Json);
        using var res = await http.CreateClient(SellerHubSyncService.ClientName).SendAsync(req, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            HubMissing();
            return false;
        }
        if (!res.IsSuccessStatusCode)
        {
            logger.LogWarning("Invoice push rejected {Status}", (int)res.StatusCode);
            return false;
        }
        return true;
    }

    /// <summary>خادم فريق أقدم بلا مسار الفواتير: نعيد المحاولة بعد 10 دقائق.</summary>
    private void HubMissing()
    {
        _hubMissingUntil = DateTime.Now.AddMinutes(10);
        _cursor = null;
        _nextReconcile = DateTime.MinValue;
    }

    private sealed class StateResponse
    {
        public long MaxId { get; set; }
        public List<InvoiceDaySignature>? Days { get; set; }
    }
}
