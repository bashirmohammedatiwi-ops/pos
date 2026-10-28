using System.Security.Claims;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Api.Auth;

public sealed class ApiKeyAuthenticationMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, ApiPlatformRepository repo)
    {
        if (ctx.Request.Path.StartsWithSegments("/api/v1", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Response.OnStarting(() =>
            {
                ctx.Response.Headers["X-API-Version"] = "1.0";
                ctx.Response.Headers["X-Catalog-Revision"] = CatalogVersionHolder.State.Current.ToString();
                return Task.CompletedTask;
            });
        }

        var rawKey = ExtractApiKey(ctx.Request);
        if (!string.IsNullOrWhiteSpace(rawKey))
        {
            var remoteIp = ctx.Connection.RemoteIpAddress?.ToString();
            var validated = await repo.ValidateKeyAsync(rawKey, remoteIp, ctx.RequestAborted);
            if (validated is not null)
            {
                var claims = new List<Claim>
                {
                    new(ClaimTypes.NameIdentifier, validated.Id.ToString()),
                    new(ClaimTypes.Name, $"apikey:{validated.Name}"),
                    new("api_key_id", validated.Id.ToString()),
                    new("api_key_name", validated.Name),
                };

                var role = validated.Scopes.Contains("*") ? validated.RoleName : "api-client";
                claims.Add(new Claim(ClaimTypes.Role, role));
                claims.Add(new Claim("role", role));

                foreach (var scope in validated.Scopes)
                    claims.Add(new Claim("scope", scope));

                var identity = new ClaimsIdentity(claims, "ApiKey");
                ctx.User = new ClaimsPrincipal(identity);
            }
        }

        await next(ctx);
    }

    private static string? ExtractApiKey(HttpRequest req)
    {
        if (req.Headers.TryGetValue("X-API-Key", out var xKey) && !string.IsNullOrWhiteSpace(xKey))
            return xKey.ToString().Trim();

        var auth = req.Headers.Authorization.ToString();
        if (!string.IsNullOrWhiteSpace(auth))
        {
            if (auth.StartsWith("ApiKey ", StringComparison.OrdinalIgnoreCase))
                return auth["ApiKey ".Length..].Trim();
            if (auth.StartsWith("Bearer fot_k_", StringComparison.OrdinalIgnoreCase))
                return auth["Bearer ".Length..].Trim();
        }

        if (req.Query.TryGetValue("api_key", out var qKey) && !string.IsNullOrWhiteSpace(qKey))
            return qKey.ToString().Trim();

        return null;
    }
}

public static class ApiScope
{
    public static bool HasScope(HttpContext ctx, string requiredScope)
    {
        var user = ctx.User;
        if (user?.Identity?.IsAuthenticated != true)
            return false;

        if (user.IsInRole("admin")
            || user.HasClaim("role", "admin")
            || string.Equals(user.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var scopes = user.FindAll("scope").Select(c => c.Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (scopes.Contains("*") || scopes.Contains(requiredScope))
            return true;

        var colon = requiredScope.IndexOf(':');
        if (colon > 0)
        {
            var prefix = requiredScope[..colon];
            if (scopes.Contains($"{prefix}:*") || scopes.Contains($"{prefix}:write"))
                return true;
        }

        return false;
    }

    public static IResult? Enforce(HttpContext ctx, string requiredScope)
    {
        if (ctx.User?.Identity?.IsAuthenticated != true)
        {
            return Results.Json(new
            {
                error = "مطلوب مفتاح API (X-API-Key) أو رمز دخول Bearer صالح للوصول إلى هذه النقطة",
                requiredScope
            }, statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!HasScope(ctx, requiredScope))
        {
            return Results.Json(new
            {
                error = $"مفتاح الـ API الحالي لا يملك صلاحية ({requiredScope})",
                requiredScope
            }, statusCode: StatusCodes.Status403Forbidden);
        }

        return null;
    }
}
