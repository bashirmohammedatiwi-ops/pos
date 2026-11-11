using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// مفتاح الرفع إلى متجر الزبائن (deemaalhayat.com). سري ولا يُحفظ في git:
///  1) StoreSite:Key في appsettings أو متغير البيئة StoreSite__Key إن ضُبط؛
///  2) وإلا الملف %ProgramData%\FOT.Pos\store-site.key — يُكتب من لوحة التحكم ويبقى بعد تحديث المثبّت.
/// بلا مفتاح لا يُرفع شيء.
/// </summary>
public static class StoreSiteKeyStore
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "store-site.key");

    public static string? Read(IConfiguration config)
    {
        var configured = config["StoreSite:Key"]?.Trim();
        if (!string.IsNullOrEmpty(configured) && configured.Length >= 24) return configured;
        try
        {
            if (File.Exists(FilePath))
            {
                var stored = File.ReadAllText(FilePath).Trim();
                if (stored.Length >= 24) return stored;
            }
        }
        catch
        {
            /* غير متاح: الرفع متوقف حتى يُضبط */
        }
        return null;
    }

    public static string Source(IConfiguration config)
    {
        var configured = config["StoreSite:Key"]?.Trim();
        if (!string.IsNullOrEmpty(configured) && configured.Length >= 24) return "settings";
        return Read(config) is null ? "none" : "file";
    }

    public static void Save(string key)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, key.Trim());
    }
}

/// <summary>منتج كما يستقبله POST /sync/inventory/bulk في متجر الزبائن — نفس شكل برنامج pos-sync-desktop القديم.</summary>
public sealed record StoreSiteItem(
    string Barcode,
    string ProductCode,
    string ProductNum,
    string? Name,
    decimal Price,
    decimal OriginalPrice,
    int DiscountPercent,
    long Stock,
    string? OfferName);

/// <summary>
/// تحويل منتجات الكتالوج إلى صيغة المتجر. اختيار الباركود ومعالجة التكرار منقولان حرفياً من
/// pos-sync-desktop (barcode.ts / syncState.ts) حتى تطابق المنتجات المرفوعة سابقاً على المتجر.
/// الأسعار من الكتالوج نفسه: نفس سعر الكاشير، مقرّباً لأقرب 250.
/// </summary>
public static partial class StoreSiteItems
{
    [GeneratedRegex(@"[ً-ٰٟۖ-ۭ‎‏‪-‮﻿]")]
    private static partial Regex BidiAndTashkeel();

    [GeneratedRegex(@"[^\x21-\x7E]")]
    private static partial Regex NonPrintableAscii();

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9_\-./+]*$")]
    private static partial Regex BarcodePattern();

    [GeneratedRegex(@"[|\t\r\n]")]
    private static partial Regex NameBreaks();

    public static string NormalizeBarcode(string? raw)
    {
        if (raw is null) return "";
        var s = raw.Replace(' ', ' ');
        s = BidiAndTashkeel().Replace(s, "");
        s = NonPrintableAscii().Replace(s, "");
        return s.Trim();
    }

    private static bool IsLikelyBarcode(string code) => code.Length >= 2 && BarcodePattern().IsMatch(code);

    public static string ResolveBarcode(string? barcode, string? num, long seq)
    {
        var b = NormalizeBarcode(barcode);
        var n = NormalizeBarcode(num);
        if (b.Length > 0 && IsLikelyBarcode(b)) return b;
        if (n.Length > 0 && IsLikelyBarcode(n)) return n;
        if (b.Length > 0) return b;
        if (n.Length > 0) return n;
        return seq.ToString();
    }

    /// <summary>
    /// owners: الباركود ← Seq صاحبه. أول منتج (بترتيب Seq) يملك الباركود؛ أي منتج آخر يحمل نفس الباركود
    /// يُرفع بـ «POS:Seq» كما كان البرنامج القديم يفعل، حتى لا يكتب منتجٌ فوق آخر.
    /// </summary>
    public static StoreSiteItem ToItem(StorePushRow row, IDictionary<string, long> owners)
    {
        var p = row.Product;
        var barcode = ResolveBarcode(p.Barcode, p.Sku, row.Seq);
        var key = NormalizeBarcode(barcode);
        if (!owners.TryGetValue(key, out var owner))
            owners[key] = row.Seq;
        else if (owner != row.Seq)
            barcode = $"POS:{row.Seq}";

        var name = string.IsNullOrWhiteSpace(p.Name) ? null : NameBreaks().Replace(p.Name, " ").Trim();
        return new StoreSiteItem(
            barcode,
            row.Seq.ToString(),
            string.IsNullOrWhiteSpace(p.Sku) ? barcode : p.Sku.Trim(),
            name,
            p.SalePrice,
            p.ListPrice,
            p.OnOffer ? p.ListedOfferPercent ?? p.OfferPercent : 0,
            (long)Math.Max(0, Math.Round(p.Quantity, MidpointRounding.AwayFromZero)),
            p.OnOffer ? p.OfferName : null);
    }

    public static string Signature(StoreSiteItem i) =>
        $"{i.Barcode}|{i.Price}|{i.OriginalPrice}|{i.DiscountPercent}|{i.Stock}|{i.Name}|{i.OfferName}";

    /// <summary>توقيع الطلب: HMAC-SHA256 بالمفتاح على «الطابع الزمني.الجسم» — يحمي من تزوير الأسعار ومن إعادة الإرسال.</summary>
    public static string Sign(string key, string timestamp, string body)
    {
        var hash = HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes($"{timestamp}.{body}"));
        return "sha256=" + Convert.ToHexString(hash).ToLowerInvariant();
    }
}

public sealed record StoreSiteStatusDto(
    bool Enabled,
    bool KeyConfigured,
    string KeySource,
    string Url,
    long Cursor,
    DateTime? LastPushAt,
    int LastPushItems,
    DateTime? LastFullAt,
    int LastFullItems,
    int LastFullFailed,
    string? LastError,
    DateTime? LastErrorAt);

/// <summary>
/// يرفع أسعار ومخزون وتخفيضات المنتجات من سيرفر المحل إلى متجر الزبائن (deemaalhayat.com)،
/// بدل برنامج pos-sync-desktop القديم الذي كان يقرأ قاعدة HAYAT2025 كل 5 دقائق.
///  · بعد ثوانٍ من كل تغيير: يستيقظ على أحداث الكتالوج والأداري، ويرفع فقط ما تغيّر منذ آخر رفع (ext_row_version).
///  · كل 30 ثانية فحص احتياطي، لأن بعض التغييرات لا تبث حدثاً.
///  · رفع كامل عند أول تشغيل وكل يوم بعد 00:10، ثم POST /sync/inventory/runs بـ manual=true
///    فيُصفّر المتجر مخزون ما لم يعد منشوراً (منتج حُذف أو صُفّر سعره) ويلتقط عروض بدأت بتاريخها.
/// </summary>
public sealed class StoreSitePushService(
    IHttpClientFactory http,
    IServiceScopeFactory scopes,
    NetworkEventBus bus,
    IConfiguration config,
    ILogger<StoreSitePushService> logger) : BackgroundService
{
    public const string ClientName = "StoreSitePush";

    private static readonly string StatePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "store-site-state.json");

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly TimeSpan FullAfter = new(0, 10, 0);

    private readonly SemaphoreSlim _wake = new(0);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, long> _owners = new(StringComparer.Ordinal);
    private readonly Dictionary<long, string> _sent = [];
    private volatile bool _fullRequested;
    private bool _ownersReady;
    private long _cursor;
    private DateOnly? _lastFullDay;
    private string? _stateUrl;
    private DateTime _retryAfter = DateTime.MinValue;

    private DateTime? _lastPushAt, _lastFullAt, _lastErrorAt;
    private int _lastPushItems, _lastFullItems, _lastFullFailed;
    private string? _lastError;

    private bool Enabled => config.GetValue("StoreSite:Enabled", true);
    private string Url => (config["StoreSite:Url"] ?? "https://deemaalhayat.com/api/v1").TrimEnd('/');
    private int BatchSize => Math.Clamp(config.GetValue("StoreSite:BatchSize", 250), 20, 1000);
    private int IntervalSeconds => Math.Clamp(config.GetValue("StoreSite:IntervalSeconds", 30), 10, 600);
    private bool Ready => Enabled && StoreSiteKeyStore.Read(config) is not null;

    public StoreSiteStatusDto Status() => new(
        Enabled, StoreSiteKeyStore.Read(config) is not null, StoreSiteKeyStore.Source(config), Url, _cursor,
        _lastPushAt, _lastPushItems, _lastFullAt, _lastFullItems, _lastFullFailed, _lastError, _lastErrorAt);

    public void RequestFull()
    {
        _fullRequested = true;
        _retryAfter = DateTime.MinValue;
        _wake.Release();
    }

    public void Wake() => _wake.Release();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(40), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        LoadState();
        _ = ListenAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (Ready && DateTime.UtcNow >= _retryAfter)
                    await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                _lastErrorAt = DateTime.Now;
                _retryAfter = DateTime.UtcNow.AddMinutes(2);
                logger.LogWarning(ex, "Store site push failed");
            }

            try
            {
                await _wake.WaitAsync(TimeSpan.FromSeconds(IntervalSeconds), stoppingToken);
                // أحداث متقاربة (عرض واحد يرسل أكثر من حدث) = رفع واحد
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
                while (_wake.CurrentCount > 0) _wake.Wait(0, CancellationToken.None);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task ListenAsync(CancellationToken ct)
    {
        var (id, reader) = bus.Subscribe();
        try
        {
            await foreach (var evt in reader.ReadAllAsync(ct))
            {
                // receipt.created: a sale lowers the live stock at once (pending, not merged yet).
                if (evt.EventType is "catalog.updated" or "receipt.created"
                    || (evt.EventType == "edari.synced" && DataChanged(evt.Data)))
                    _wake.Release();
            }
        }
        catch (OperationCanceledException)
        {
            /* إيقاف السيرفر */
        }
        finally
        {
            bus.Unsubscribe(id);
        }
    }

    private static bool DataChanged(object? data)
    {
        if (data is null) return false;
        var el = JsonSerializer.SerializeToElement(data, Json);
        return el.TryGetProperty("dataChanged", out var v) && v.ValueKind == JsonValueKind.True;
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var now = DateTime.Now;
            var today = DateOnly.FromDateTime(now);
            var fullDue = _fullRequested
                || _lastFullDay is null
                || _stateUrl != Url
                || (_lastFullDay < today && now.TimeOfDay >= FullAfter);
            if (fullDue)
                await FullAsync(ct);
            else
                await DeltaAsync(ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<(List<StorePushRow> Rows, long NextSince)> ReadSinceAsync(long since, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<StoreCatalogRepository>();
        var rows = new List<StorePushRow>();
        var cursor = since;
        for (;;)
        {
            var page = await repo.PushChangesAsync(cursor, 5000, ct);
            rows.AddRange(page.Rows);
            cursor = page.NextSince;
            if (!page.HasMore) return (rows, cursor);
        }
    }

    private async Task FullAsync(CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var (rows, next) = await ReadSinceAsync(0, ct);
        if (rows.Count == 0) throw new InvalidOperationException("الكتالوج فارغ — لم يُرفع شيء");

        _owners.Clear();
        var items = rows.OrderBy(r => r.Seq).Select(r => (r.Seq, Item: StoreSiteItems.ToItem(r, _owners))).ToList();
        _ownersReady = true;

        var synced = 0;
        var failed = 0;
        string? error = null;
        foreach (var batch in items.Chunk(BatchSize))
        {
            try
            {
                var bad = await PostBatchAsync(batch.Select(b => b.Item).ToList(), ct);
                failed += bad;
                synced += batch.Length - bad;
                foreach (var (seq, item) in batch) _sent[seq] = StoreSiteItems.Signature(item);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                failed += batch.Length;
                error ??= ex.Message;
            }
        }
        sw.Stop();

        var ok = failed == 0;
        await ReportRunAsync(true, ok, items.Count, synced, failed, sw.ElapsedMilliseconds, error, ct);
        _lastFullItems = items.Count;
        _lastFullFailed = failed;
        _lastPushItems = synced;
        _lastPushAt = DateTime.Now;
        if (!ok)
        {
            // يُعاد الرفع الكامل بعد 10 دقائق؛ لا نتقدّم بالمؤشر حتى ينجح
            _retryAfter = DateTime.UtcNow.AddMinutes(10);
            throw new InvalidOperationException($"رفع كامل ناقص: {failed} من {items.Count} لم يُقبل — {error}");
        }

        _cursor = next;
        _lastFullDay = DateOnly.FromDateTime(DateTime.Now);
        _lastFullAt = DateTime.Now;
        _fullRequested = false;
        _stateUrl = Url;
        _lastError = null;
        SaveState();
        logger.LogInformation("Store site full push: {Count} products in {Ms} ms", items.Count, sw.ElapsedMilliseconds);
    }

    private async Task DeltaAsync(CancellationToken ct)
    {
        if (!_ownersReady)
        {
            // بعد إعادة التشغيل: نبني جدول أصحاب الباركود دون رفع، ثم نرفع ما تغيّر منذ آخر مؤشر محفوظ
            var (all, _) = await ReadSinceAsync(0, ct);
            _owners.Clear();
            foreach (var r in all.OrderBy(r => r.Seq)) StoreSiteItems.ToItem(r, _owners);
            _ownersReady = true;
        }

        var (rows, next) = await ReadSinceAsync(_cursor, ct);
        if (rows.Count == 0) return;

        var changed = new List<(long Seq, StoreSiteItem Item)>();
        foreach (var r in rows)
        {
            var item = StoreSiteItems.ToItem(r, _owners);
            if (_sent.TryGetValue(r.Seq, out var sig) && sig == StoreSiteItems.Signature(item)) continue;
            changed.Add((r.Seq, item));
        }

        var sw = Stopwatch.StartNew();
        var failed = 0;
        foreach (var batch in changed.Chunk(BatchSize))
        {
            failed += await PostBatchAsync(batch.Select(b => b.Item).ToList(), ct);
            foreach (var (seq, item) in batch) _sent[seq] = StoreSiteItems.Signature(item);
        }
        sw.Stop();

        _cursor = next;
        SaveState();
        if (changed.Count == 0) return;

        await ReportRunAsync(false, failed == 0, changed.Count, changed.Count - failed, failed, sw.ElapsedMilliseconds, null, ct);
        _lastPushAt = DateTime.Now;
        _lastPushItems = changed.Count;
        if (failed == 0) _lastError = null;
        logger.LogInformation("Store site push: {Count} changed products", changed.Count);
    }

    /// <summary>يرسل دفعة ويعيد عدد المنتجات التي رفضها المتجر. خطأ الشبكة أو 5xx يُعاد مرتين ثم يرمي.</summary>
    private async Task<int> PostBatchAsync(IReadOnlyList<StoreSiteItem> items, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new { items }, Json);
        using var doc = await SendSignedAsync("/sync/inventory/bulk", body, ct);
        return doc.RootElement.TryGetProperty("failed", out var f) && f.TryGetInt32(out var n) ? n : 0;
    }

    private async Task ReportRunAsync(
        bool manual, bool ok, int total, int synced, int failed, long ms, string? error, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new
        {
            manual,
            ok,
            totalItems = total,
            changedItems = total,
            syncedItems = synced,
            failedItems = failed,
            skippedItems = 0,
            durationMs = ms,
            errorMessage = error,
            sourceHost = $"FOT POS · {Environment.MachineName}",
        }, Json);
        try
        {
            using var _ = await SendSignedAsync("/sync/inventory/runs", body, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Store site run report failed");
        }
    }

    private async Task<JsonDocument> SendSignedAsync(string path, string body, CancellationToken ct)
    {
        var key = StoreSiteKeyStore.Read(config) ?? throw new InvalidOperationException("مفتاح المتجر غير مضبوط");
        var client = http.CreateClient(ClientName);
        for (var attempt = 1; ; attempt++)
        {
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            using var req = new HttpRequestMessage(HttpMethod.Post, Url + path)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            req.Headers.TryAddWithoutValidation("X-FOT-Timestamp", ts);
            req.Headers.TryAddWithoutValidation("X-FOT-Signature", StoreSiteItems.Sign(key, ts, body));
            try
            {
                using var res = await client.SendAsync(req, ct);
                var text = await res.Content.ReadAsStringAsync(ct);
                if (res.IsSuccessStatusCode)
                    return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
                var retryable = (int)res.StatusCode >= 500 || (int)res.StatusCode == 429;
                if (!retryable || attempt >= 3)
                    throw new HttpRequestException($"المتجر رد بـ HTTP {(int)res.StatusCode} على {path}");
            }
            catch (HttpRequestException) when (attempt < 3)
            {
                /* شبكة: نعيد */
            }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested && attempt < 3)
            {
                /* مهلة: نعيد */
            }
            await Task.Delay(TimeSpan.FromSeconds(2 * attempt), ct);
        }
    }

    private sealed record State(long Cursor, DateOnly? LastFullDay, string? Url);

    private void LoadState()
    {
        try
        {
            if (!File.Exists(StatePath)) return;
            var s = JsonSerializer.Deserialize<State>(File.ReadAllText(StatePath), Json);
            if (s is null) return;
            _cursor = s.Cursor;
            _lastFullDay = s.LastFullDay;
            _stateUrl = s.Url;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Store site state unreadable — a full push will run");
        }
    }

    private void SaveState()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
            File.WriteAllText(StatePath, JsonSerializer.Serialize(new State(_cursor, _lastFullDay, _stateUrl), Json));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Store site state not saved");
        }
    }
}
