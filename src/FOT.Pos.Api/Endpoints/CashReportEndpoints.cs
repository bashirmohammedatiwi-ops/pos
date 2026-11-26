using System.Globalization;
using System.Security.Claims;
using FOT.Pos.Infrastructure.Edari;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// تقرير الصناديق في لوحة التحكم (قراءة فقط من «إداري»):
///  · GET /api/reports/cash/boxes               — كل الصناديق بأرصدتها الآن وحركة آخر الأيام.
///  · GET /api/reports/cash/statement           — كشف صندوق لفترة (account=seq، from، to).
///  · GET/PUT /api/reports/cash/settings        — حساب الصناديق والصناديق البارزة في تطبيق المدراء.
/// </summary>
public static class CashReportEndpoints
{
    public static void MapCashReportEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/reports/cash");

        g.MapGet("/boxes", async (HttpContext http, EdariCashReportService cash, bool? fresh, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            try
            {
                return Results.Ok(await cash.GetBoxesAsync(fresh == true, ct));
            }
            catch (InvalidOperationException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: 502);
            }
        });

        g.MapGet("/statement", async (HttpContext http, EdariCashReportService cash, long account, string? from, string? to, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var today = DateTime.Today;
            var f = ParseDay(from) ?? today;
            var t = ParseDay(to) ?? f;
            try
            {
                return Results.Ok(await cash.GetStatementAsync(account, f, t, ct));
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: 502);
            }
        });

        g.MapGet("/settings", (HttpContext http) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(EdariCashReportService.LoadSettings()));

        g.MapPut("/settings", (HttpContext http, CashReportSettings body) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(EdariCashReportService.SaveSettings(body)));
    }

    internal static DateTime? ParseDay(string? v) =>
        DateTime.TryParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
