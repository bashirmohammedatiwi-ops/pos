using System.Security.Claims;
using System.Security.Cryptography;
using FOT.Pos.Api.HostedServices;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// الرفع إلى متجر الزبائن (deemaalhayat.com) — من لوحة التحكم:
///  · GET  /api/store-site/status        حالة الرفع وآخر خطأ.
///  · POST /api/store-site/push-full     رفع كامل الآن.
///  · PUT  /api/store-site/key           حفظ المفتاح المشترك مع سيرفر المتجر.
///  · POST /api/store-site/key/generate  توليد مفتاح جديد وحفظه؛ يُعرض مرة واحدة ليُلصق في إعدادات سيرفر المتجر.
/// </summary>
public static class StoreSiteEndpoints
{
    public static void MapStoreSiteEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/store-site");

        g.MapGet("/status", (HttpContext http, StoreSitePushService push) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(push.Status()));

        g.MapPost("/push-full", (HttpContext http, StoreSitePushService push) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            push.RequestFull();
            return Results.Accepted(value: push.Status());
        });

        g.MapPut("/key", (HttpContext http, SyncKeyRequest req, IConfiguration config, StoreSitePushService push) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var key = (req.Key ?? "").Trim();
            if (key.Length < 24) return Results.BadRequest(new { error = "المفتاح قصير — 24 حرفاً على الأقل" });
            if (StoreSiteKeyStore.Source(config) == "settings")
                return Results.BadRequest(new { error = "المفتاح مضبوط في appsettings.json على سيرفر المحل — عدّله هناك" });
            StoreSiteKeyStore.Save(key);
            push.Wake();
            return Results.Ok(push.Status());
        });

        g.MapPost("/key/generate", (HttpContext http, IConfiguration config, StoreSitePushService push) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            if (StoreSiteKeyStore.Source(config) == "settings")
                return Results.BadRequest(new { error = "المفتاح مضبوط في appsettings.json على سيرفر المحل — عدّله هناك" });
            var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            StoreSiteKeyStore.Save(key);
            push.Wake();
            return Results.Ok(new { key, status = push.Status() });
        });
    }

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
