using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api;

public sealed class SellerWebPublisher(IHttpClientFactory http, IConfiguration config)
{
    public const string ClientName = "SellerWeb";

    public string PublicUrl => (config["SellerWeb:PublicUrl"] ?? "http://187.124.23.65:4701").TrimEnd('/');

    public async Task<PortalWebProbeDto> ProbeAsync(long salesmanId, CancellationToken ct)
    {
        var url = $"{PublicUrl}/auth/seller-lookup?id={salesmanId}";
        try
        {
            var client = http.CreateClient(ClientName);
            using var res = await client.GetAsync(url, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            var code = (int)res.StatusCode;
            if (code is 502 or 503 or 504)
                return new PortalWebProbeDto(false, "النفق غير متصل — ويب البائعين لا يصل للمحل", url, code);
            if (!res.IsSuccessStatusCode)
                return new PortalWebProbeDto(false, $"الويب رد {code} — حدّث السيرفر وشغّل نفق المحل", url, code);
            if (string.IsNullOrWhiteSpace(body) || body.TrimStart().StartsWith('<'))
                return new PortalWebProbeDto(false, "الويب لا يمرّر طلب البائع إلى نقطة البيع", url, code);
            return new PortalWebProbeDto(true, "الحساب ظاهر على ويب البائعين", url, code);
        }
        catch (TaskCanceledException)
        {
            return new PortalWebProbeDto(false, "انتهت مهلة الاتصال بويب البائعين", url, null);
        }
        catch
        {
            return new PortalWebProbeDto(false, "تعذر الوصول لويب البائعين من المحل", url, null);
        }
    }
}
