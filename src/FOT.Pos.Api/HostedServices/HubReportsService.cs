using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FOT.Pos.Api.Endpoints;
using FOT.Pos.Infrastructure.Edari;

namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// تقارير «إداري» لتطبيق المدراء على خادم الفريق — سيرفر المحل هو من يتصل دائماً (لا نفق):
///  • أرصدة الصناديق تُرفع كل نصف دقيقة (وعند تغيّرها فقط، مع نبضة كل بضع دقائق).
///  • طلبات المدراء (كشف صندوق لفترة…) يضعها خادم الفريق في طابور؛ هذا السيرفر ينتظرها بطلب معلّق
///    (long-poll) فيصله الطلب خلال لحظة، ينفّذه على الإداري ويعيد النتيجة.
/// </summary>
public sealed class HubReportsService(
    IHttpClientFactory http,
    IServiceScopeFactory scopes,
    IConfiguration config,
    ILogger<HubReportsService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private string? _lastHash;
    private DateTime _lastPush = DateTime.MinValue;
    private DateTime _hubMissingUntil = DateTime.MinValue;

    private bool Ready => config.GetValue("SellerWeb:Enabled", true) && HubSyncKeyStore.ReadConfigured(config) is not null;
    private string SyncUrl => (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
            await Task.WhenAll(PushLoopAsync(stoppingToken), JobsLoopAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            /* إيقاف */
        }
    }

    /* ── أرصدة الصناديق ── */
    private async Task PushLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (Ready && DateTime.Now >= _hubMissingUntil)
                {
                    await PushBoxesAsync(false, ct);
                    // شجرة المواد جاهزة دائماً لتقرير المبيعات المطلوب من التطبيق
                    using var scope = scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<EdariSalesReportService>().WarmAsync(ct);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Cash boxes push failed");
            }
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
        }
    }

    private async Task PushBoxesAsync(bool force, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var cash = scope.ServiceProvider.GetRequiredService<EdariCashReportService>();
        CashBoxesDto boxes;
        try
        {
            boxes = await cash.GetBoxesAsync(true, ct);
        }
        catch (InvalidOperationException ex)
        {
            // الإداري مطفأ: نُعلم خادم الفريق كي يظهر «غير متصل» بدل أرقام قديمة بلا تنبيه
            await PostAsync("/api/sync/cash", new { error = ex.Message, at = DateTime.Now }, ct);
            return;
        }
        // الأرقام نفسها لا تُرفع من جديد، مع نبضة كل 3 دقائق تثبت أن الاتصال حي
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(boxes.Boxes, Json))))[..16];
        if (!force && hash == _lastHash && DateTime.Now - _lastPush < TimeSpan.FromMinutes(3)) return;
        if (await PostAsync("/api/sync/cash", new { boxes }, ct))
        {
            _lastHash = hash;
            _lastPush = DateTime.Now;
        }
    }

    /* ── طابور طلبات التقارير ── */
    private async Task JobsLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!Ready || DateTime.Now < _hubMissingUntil)
                {
                    await Task.Delay(TimeSpan.FromSeconds(20), ct);
                    continue;
                }
                var jobs = await FetchJobsAsync(ct);
                if (jobs is null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(8), ct);
                    continue;
                }
                foreach (var job in jobs) await RunJobAsync(job, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Report jobs poll failed");
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
            }
        }
    }

    private async Task<List<ReportJob>?> FetchJobsAsync(CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{SyncUrl}/api/sync/jobs?wait=25");
        req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", HubSyncKeyStore.Read(config));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        using var res = await http.CreateClient(SellerHubSyncService.ClientName).SendAsync(req, timeout.Token);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // خادم فريق أقدم بلا طابور التقارير
            _hubMissingUntil = DateTime.Now.AddMinutes(10);
            return null;
        }
        if (!res.IsSuccessStatusCode) return null;
        var body = await res.Content.ReadFromJsonAsync<JobsResponse>(Json, ct);
        return body?.Jobs ?? [];
    }

    private async Task RunJobAsync(ReportJob job, CancellationToken ct)
    {
        object payload;
        try
        {
            using var scope = scopes.CreateScope();
            var cash = scope.ServiceProvider.GetRequiredService<EdariCashReportService>();
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
            limit.CancelAfter(TimeSpan.FromSeconds(50));
            object result = job.Kind switch
            {
                "cash.statement" => await cash.GetStatementAsync(
                    job.Long("seq"),
                    CashReportEndpoints.ParseDay(job.Text("from")) ?? DateTime.Today,
                    CashReportEndpoints.ParseDay(job.Text("to")) ?? CashReportEndpoints.ParseDay(job.Text("from")) ?? DateTime.Today,
                    limit.Token),
                "cash.boxes" => await cash.GetBoxesAsync(true, limit.Token),
                "cash.flow" => await cash.GetFlowAsync(
                    CashReportEndpoints.ParseDay(job.Text("from")) ?? DateTime.Today,
                    CashReportEndpoints.ParseDay(job.Text("to")) ?? CashReportEndpoints.ParseDay(job.Text("from")) ?? DateTime.Today,
                    job.Long("seq") is > 0 and var flowSeq ? flowSeq : null,
                    limit.Token),
                "sales.report" => await scope.ServiceProvider.GetRequiredService<EdariSalesReportService>().GetAsync(
                    EdariSalesReportEndpoints.BuildQuery(
                        job.Text("from"), job.Text("to"), job.Text("branches"),
                        job.Long("node"), job.Text("q"), job.Text("lines") is "true" or "True" or "1",
                        (int)Math.Clamp(job.Long("maxLines"), 0, 6000) is > 0 and var max ? max : 800,
                        job.Text("fresh") is "true" or "True" or "1",
                        job.Text("compare") is "true" or "True" or "1"),
                    limit.Token),
                _ => throw new NotSupportedException("سيرفر المحل لا يعرف هذا التقرير بعد — حدّث سيرفر المحل"),
            };
            payload = new { ok = true, result };
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            payload = new { ok = false, error = "تأخر الإداري في الرد — حاول مرة أخرى" };
        }
        catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException or NotSupportedException or ArgumentException)
        {
            payload = new { ok = false, error = ex.Message };
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Report job {Kind} failed", job.Kind);
            payload = new { ok = false, error = "تعذر تنفيذ التقرير على سيرفر المحل" };
        }
        await PostAsync($"/api/sync/jobs/{job.Id}", payload, ct);
    }

    private async Task<bool> PostAsync(string path, object payload, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{SyncUrl}{path}");
        req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", HubSyncKeyStore.Read(config));
        req.Content = JsonContent.Create(payload, options: Json);
        using var res = await http.CreateClient(SellerHubSyncService.ClientName).SendAsync(req, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound) _hubMissingUntil = DateTime.Now.AddMinutes(10);
        return res.IsSuccessStatusCode;
    }

    private sealed class JobsResponse
    {
        public List<ReportJob>? Jobs { get; set; }
    }

    private sealed class ReportJob
    {
        public long Id { get; set; }
        public string Kind { get; set; } = "";
        public Dictionary<string, JsonElement>? Params { get; set; }

        public string? Text(string key) =>
            Params is not null && Params.TryGetValue(key, out var v)
                ? v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString()
                : null;

        public long Long(string key) => long.TryParse(Text(key), out var n) ? n : 0;
    }
}
