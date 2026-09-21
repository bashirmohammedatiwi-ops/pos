using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace FOT.Pos.Api.Auth;

public static class CashierContext
{
    public static long? Id(HttpContext http)
    {
        var user = http.User;
        if (user?.Identity?.IsAuthenticated != true) return null;
        if (!IsCashier(user)) return null;
        foreach (var type in new[]
        {
            ClaimTypes.NameIdentifier,
            JwtRegisteredClaimNames.Sub,
            "nameid",
            "sub",
        })
        {
            var raw = user.FindFirstValue(type);
            if (long.TryParse(raw, out var id) && id > 0) return id;
        }

        return null;
    }

    private static bool IsCashier(ClaimsPrincipal user) =>
        user.IsInRole("cashier")
        || user.HasClaim(ClaimTypes.Role, "cashier")
        || user.HasClaim("role", "cashier");
}
