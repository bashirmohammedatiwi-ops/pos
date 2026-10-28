using System.Security.Claims;
using FOT.Pos.Api.HostedServices;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// تطبيق الفريق — من لوحة التحكم:
///  · /api/team/staff …  إدارة الموظفين محلياً (المصدر في SQL Server) ثم رفع فوري لخادم الفريق.
///  · /api/team/hub/**   وكيل عام لكل ما يُدار على خادم الفريق (الإجازات، الحضور، الإعلانات، المحادثات…)
///                       بمفتاح المزامنة — لوحة التحكم لا تتصل بالإنترنت مباشرة ولا تحمل المفتاح.
/// </summary>
public static class TeamEndpoints
{
    public const string HubClientName = "TeamHub";

    public static void MapTeamEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/team");

        g.MapGet("/staff", async (HttpContext http, StaffRepository repo, CancellationToken ct) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(await repo.ListAsync(ct)));

        g.MapPost("/staff", async (HttpContext http, StaffSaveRequest req, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var (row, error) = await repo.SaveAsync(null, req, ct);
            if (row is null) return Results.BadRequest(new { error });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPut("/staff/{id:long}", async (HttpContext http, long id, StaffSaveRequest req, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var (row, error) = await repo.SaveAsync(id, req, ct);
            if (row is null) return Results.BadRequest(new { error });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPost("/staff/{id:long}/pin", async (HttpContext http, long id, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.IssuePinAsync(id, ct);
            if (row is null) return Results.NotFound(new { error = "الموظف غير موجود" });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPost("/staff/{id:long}/active", async (HttpContext http, long id, bool active, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.SetActiveAsync(id, active, ct);
            if (row is null) return Results.NotFound(new { error = "الموظف غير موجود" });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPost("/staff/import-cashiers", async (HttpContext http, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var added = await repo.ImportCashiersAsync(ct);
            if (added > 0) Push(sync);
            return Results.Ok(new { added, staff = await repo.ListAsync(ct) });
        });

        // وكيل خادم الفريق: GET/POST/PUT/DELETE /api/team/hub/<path> → {hub}/api/admin/team/<path>
        g.Map("/hub/{**path}", async (HttpContext http, string? path, IHttpClientFactory factory, IConfiguration config, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var baseUrl = (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
            var key = config["SellerWeb:SyncKey"] ?? "fot-hub-sync-e7Kq9mN2pL4xW8vR";
            var target = $"{baseUrl}/api/admin/team/{path}{http.Request.QueryString}";
            using var req = new HttpRequestMessage(new HttpMethod(http.Request.Method), target);
            req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", key);
            // اسم المستخدم الإداري لسجل التدقيق على خادم الفريق
            var actor = http.User.FindFirstValue(ClaimTypes.Name) ?? http.User.FindFirstValue("name") ?? "admin";
            req.Headers.TryAddWithoutValidation("X-Fot-Actor", Uri.EscapeDataString(actor));
            if (http.Request.ContentLength > 0 || http.Request.Headers.ContainsKey("Transfer-Encoding"))
            {
                req.Content = new StreamContent(http.Request.Body);
                if (http.Request.ContentType is { } ctype)
                    req.Content.Headers.TryAddWithoutValidation("Content-Type", ctype);
            }
            try
            {
                using var res = await factory.CreateClient(HubClientName).SendAsync(req, ct);
                var bytes = await res.Content.ReadAsByteArrayAsync(ct);
                var type = res.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";
                if (res.StatusCode == System.Net.HttpStatusCode.NotFound && bytes.Length == 0)
                    return Results.Json(new { error = "خادم الفريق لا يدعم هذه الميزة بعد — حدّث الـ VPS" }, statusCode: 502);
                http.Response.StatusCode = (int)res.StatusCode;
                http.Response.ContentType = type;
                await http.Response.Body.WriteAsync(bytes, ct);
                return Results.Empty;
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "انتهت مهلة الاتصال بخادم الفريق" }, statusCode: 504);
            }
            catch
            {
                return Results.Json(new { error = "تعذر الوصول لخادم الفريق — تحقق من الإنترنت" }, statusCode: 502);
            }
        }).DisableAntiforgery();
    }

    private static void Push(ISellerHubSync sync) =>
        _ = sync.PushAccountsNowAsync(CancellationToken.None);

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
