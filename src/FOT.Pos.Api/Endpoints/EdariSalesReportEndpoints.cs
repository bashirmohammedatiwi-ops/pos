using System.Security.Claims;
using FOT.Pos.Infrastructure.Edari;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// تقرير مبيعات «إداري» في لوحة التحكم (قراءة فقط):
///  GET /api/reports/edari-sales?from=&amp;to=&amp;branches=136,138&amp;node=&lt;seq&gt;&amp;q=&amp;lines=true
///  · بلا node: إجمالي النظام وأشجار المواد الرئيسية. مع node: ما تحت تلك الشجرة (أو حركات المادة مع lines).
/// </summary>
public static class EdariSalesReportEndpoints
{
    public static void MapEdariSalesReportEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/reports/edari-sales", async (
            HttpContext http, EdariSalesReportService sales,
            string? from, string? to, string? branches, long? node, string? q, bool? lines, int? maxLines, bool? fresh, bool? compare,
            CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            try
            {
                return Results.Ok(await sales.GetAsync(BuildQuery(from, to, branches, node, q, lines == true, maxLines, fresh == true, compare == true), ct));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
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
    }

    internal static EdariSalesQuery BuildQuery(string? from, string? to, string? branches, long? node, string? search, bool lines, int? maxLines, bool fresh, bool compare = false)
    {
        var f = CashReportEndpoints.ParseDay(from) ?? DateTime.Today;
        var t = CashReportEndpoints.ParseDay(to) ?? f;
        var list = (branches ?? "")
            .Split([',', '،', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(60)
            .ToList();
        var term = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        if (term is { Length: > 80 }) term = term[..80];
        return new EdariSalesQuery(f, t, list, node is > 0 ? node : null, term, lines, maxLines ?? 3000, fresh, compare);
    }

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
