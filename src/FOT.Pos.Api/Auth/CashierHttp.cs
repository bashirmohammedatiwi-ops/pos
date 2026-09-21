using System.Security.Claims;

namespace FOT.Pos.Api.Auth;

public static class CashierHttp
{
    public static long? Id(HttpContext http)
    {
        if (http.User?.Identity?.IsAuthenticated != true) return null;
        if (!http.User.IsInRole("cashier")) return null;
        return long.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) && id > 0
            ? id
            : null;
    }
}
