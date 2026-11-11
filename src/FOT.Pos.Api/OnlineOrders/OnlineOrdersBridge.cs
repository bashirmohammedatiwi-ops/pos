using System.Net;
using System.Text;
using System.Text.Json;
using FOT.Pos.Api.HostedServices;

namespace FOT.Pos.Api.OnlineOrders;

/// <summary>
/// مفتاح ربط «كاشير الطلبات» مع موقع ديما الحياة. منفصل عن مفتاح رفع المخزون لأنه يقرأ أسماء الزبائن
/// وهواتفهم. سري ولا يُحفظ في git ولا يُطبع في السجلات:
///  1) OnlineOrders:Key في appsettings أو متغير البيئة OnlineOrders__Key إن ضُبط؛
///  2) وإلا الملف %ProgramData%\FOT.Pos\online-orders.key (64 حرفاً سداسياً عشرياً).
/// </summary>
public static class OnlineOrdersKeyStore
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "online-orders.key");

    public static string? Read(IConfiguration config)
    {
        var configured = config["OnlineOrders:Key"]?.Trim();
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
            /* غير متاح: الربط متوقف حتى يُضبط */
        }
        return null;
    }

    public static string Source(IConfiguration config)
    {
        var configured = config["OnlineOrders:Key"]?.Trim();
        if (!string.IsNullOrEmpty(configured) && configured.Length >= 24) return "settings";
        return Read(config) is null ? "none" : "file";
    }
}

/// <summary>رفض من الموقع أو تعذر الوصول إليه. Message عربي جاهز للعرض.</summary>
public sealed class OnlineOrdersException(int status, string? code, string message, bool unreachable = false)
    : Exception(message)
{
    /// <summary>حالة HTTP من الموقع؛ 0 = لم نصل إليه.</summary>
    public int Status { get; } = status;
    public string? Code { get; } = code;
    public bool Unreachable { get; } = unreachable;
}

/// <summary>
/// كل ما يحتاجه الكاشير من الموقع عبر POST /pos-link/* الموقّع (HMAC-SHA256 على «الطابع.الجسم»،
/// نفس صيغة StoreSitePushService بمفتاح آخر). الردود ملفوفة بـ {data: …} فنعيد data.
/// </summary>
public sealed class OnlineOrdersBridge(IHttpClientFactory http, IConfiguration config, ILogger<OnlineOrdersBridge> logger)
{
    public const string ClientName = "OnlineOrders";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public string Url => (config["StoreSite:Url"] ?? "https://deemaalhayat.com/api/v1").TrimEnd('/');

    public bool KeyConfigured => OnlineOrdersKeyStore.Read(config) is not null;

    public string KeySource => OnlineOrdersKeyStore.Source(config);

    public Task<JsonElement> PingAsync(CancellationToken ct) => PostAsync("/pos-link/ping", new { }, ct);

    public Task<JsonElement> QueueAsync(CancellationToken ct) => PostAsync("/pos-link/orders/queue", new { }, ct);

    public Task<JsonElement> LookupAsync(string code, CancellationToken ct) =>
        PostAsync("/pos-link/orders/lookup", new { code }, ct);

    public Task<JsonElement> PrintDataAsync(string code, CancellationToken ct) =>
        PostAsync("/pos-link/orders/print-data", new { code }, ct);

    public Task<JsonElement> InvoiceAsync(object body, CancellationToken ct) =>
        PostAsync("/pos-link/orders/invoice", body, ct);

    public Task<JsonElement> PickupHandoverAsync(object body, CancellationToken ct) =>
        PostAsync("/pos-link/orders/pickup-handover", body, ct);

    public Task<JsonElement> ReturnAsync(object body, CancellationToken ct) =>
        PostAsync("/pos-link/orders/return", body, ct);

    public async Task<JsonElement> PostAsync(string path, object body, CancellationToken ct)
    {
        var key = OnlineOrdersKeyStore.Read(config)
            ?? throw new OnlineOrdersException(503, "KEY_MISSING",
                "مفتاح ربط الطلبات غير مضبوط على سيرفر المحل (online-orders.key) — راجع الإدارة");
        var json = JsonSerializer.Serialize(body, Json);
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        using var req = new HttpRequestMessage(HttpMethod.Post, Url + path)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        req.Headers.TryAddWithoutValidation("X-FOT-Timestamp", ts);
        req.Headers.TryAddWithoutValidation("X-FOT-Signature", StoreSiteItems.Sign(key, ts, json));

        HttpResponseMessage res;
        string text;
        try
        {
            res = await http.CreateClient(ClientName).SendAsync(req, ct);
            text = await res.Content.ReadAsStringAsync(ct);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new OnlineOrdersException(0, "TIMEOUT", "موقع الطلبات لم يرد خلال 15 ثانية — تحقق من الإنترنت ثم أعد المحاولة", unreachable: true);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning("Online orders link {Path} unreachable: {Message}", path, ex.Message);
            throw new OnlineOrdersException(0, "UNREACHABLE", "تعذر الوصول إلى موقع الطلبات — تحقق من الإنترنت ثم أعد المحاولة", unreachable: true);
        }

        using (res)
        {
            if (res.IsSuccessStatusCode)
            {
                try
                {
                    using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
                    var root = doc.RootElement;
                    return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data)
                        ? data.Clone()
                        : root.Clone();
                }
                catch (JsonException)
                {
                    throw new OnlineOrdersException(502, "BAD_RESPONSE", "رد غير مفهوم من موقع الطلبات");
                }
            }

            var status = (int)res.StatusCode;
            var (code, message) = ReadError(text);
            if (status is 401 or 403)
            {
                logger.LogWarning("Online orders link {Path} rejected the signature ({Status})", path, status);
                message = "الموقع رفض توقيع سيرفر المحل — تأكد أن مفتاح الربط هو نفسه على الموقع وأن ساعة الجهاز مضبوطة";
            }
            else if (status == 503 && string.IsNullOrWhiteSpace(message))
            {
                message = "ربط كاشير الطلبات غير مضبوط على الموقع";
            }
            else if (status >= 500 || status == (int)HttpStatusCode.BadGateway)
            {
                logger.LogWarning("Online orders link {Path} failed with HTTP {Status}", path, status);
                if (!HasArabic(message)) message = $"خطأ في موقع الطلبات (HTTP {status}) — أعد المحاولة بعد قليل";
            }
            else if (status == 404 && !HasArabic(message))
            {
                message = "الطلب غير موجود على الموقع";
            }
            throw new OnlineOrdersException(status, code, HasArabic(message) ? message! : $"رفض الموقع الطلب (HTTP {status}){(string.IsNullOrWhiteSpace(message) ? "" : $": {message}")}");
        }
    }

    private static bool HasArabic(string? s) =>
        !string.IsNullOrEmpty(s) && s.Any(ch => ch >= '؀' && ch <= 'ۿ');

    /// <summary>أخطاء الموقع: {success:false, error:{code, status, message}} حيث message عربي (نص أو قائمة).</summary>
    private static (string? Code, string? Message) ReadError(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return (null, null);
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return (null, null);
            var err = root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.Object ? e : root;
            string? code = err.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
            string? message = null;
            if (err.TryGetProperty("message", out var m))
            {
                message = m.ValueKind switch
                {
                    JsonValueKind.String => m.GetString(),
                    JsonValueKind.Array => string.Join(" — ", m.EnumerateArray().Select(x => x.ToString())),
                    JsonValueKind.Object when m.TryGetProperty("message", out var inner) => inner.ToString(),
                    _ => null,
                };
            }
            return (code, string.IsNullOrWhiteSpace(message) ? null : message);
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }
}
