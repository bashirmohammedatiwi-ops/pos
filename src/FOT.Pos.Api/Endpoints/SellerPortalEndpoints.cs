using FOT.Pos.Api.Auth;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

public static class SellerPortalEndpoints
{
    public static void MapSellerAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/auth/seller-lookup", async (long id, SellerPortalRepository sellers) =>
        {
            var row = await sellers.LookupAsync(id, default);
            return row is null ? Results.NotFound() : Results.Ok(row);
        }).AllowAnonymous().Produces<SellerLookupDto>(200).Produces(404);

        app.MapPost("/auth/seller-login", async (
            SellerLoginRequest req, SellerPortalRepository sellers, IConfiguration config) =>
        {
            if (req.SalesmanId <= 0)
                return Results.BadRequest(new { error = "أدخل رقم البائع" });
            var pin = (req.Pin ?? "").Trim();
            if (pin.Length < 4)
                return Results.BadRequest(new { error = "الرقم السري 4 أرقام على الأقل" });

            var (seller, hash, active) = await sellers.GetAccountAsync(req.SalesmanId, default);
            if (seller is null)
                return Results.Unauthorized();
            if (!active)
                return Results.Json(new { error = "الحساب متوقف — راجع الإدارة" }, statusCode: 403);

            if (string.IsNullOrEmpty(hash))
                return Results.Json(new { error = "اطلب من الإدارة توليد حسابك من لوحة التحكم" }, statusCode: 403);
            if (!BCrypt.Net.BCrypt.Verify(pin, hash))
                return Results.Unauthorized();
            else
            {
                await sellers.TouchLoginAsync(req.SalesmanId, default);
            }

            var me = await sellers.GetMeAsync(req.SalesmanId, default) ?? new SellerMeDto(seller.Id, seller.Name, false);
            var token = JwtTokenIssuer.Issue(config, seller.Id, seller.Id.ToString(), seller.Name, "seller");
            return Results.Ok(new SellerLoginResponse(token, me));
        }).AllowAnonymous().Produces<SellerLoginResponse>(200).Produces(400).Produces(401);
    }

    public static void MapSellerPortalEndpoints(this RouteGroupBuilder api)
    {
        var seller = api.MapGroup("/seller").RequireAuthorization("SellerOnly");

        seller.MapGet("/me", async (HttpContext http, SellerPortalRepository sellers) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            var me = await sellers.GetMeAsync(id.Value, default);
            return me is null ? Results.NotFound() : Results.Ok(me);
        });

        seller.MapGet("/dashboard", async (HttpContext http, SellerPortalRepository sellers, DateTime? weekStart) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            return Results.Ok(await sellers.GetDashboardAsync(id.Value, weekStart, default));
        });

        seller.MapGet("/weeks", async (HttpContext http, SellerPortalRepository sellers, int count = 12) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            return Results.Ok(await sellers.ListWeeksAsync(id.Value, count, default));
        });

        seller.MapGet("/malls", async (HttpContext http, SellerPortalRepository sellers, DateTime? weekStart) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            var (start, end) = await sellers.ResolveWeekAsync(weekStart, default);
            return Results.Ok(await sellers.ListMallsAsync(id.Value, start, end, default));
        });

        seller.MapGet("/goals", async (HttpContext http, SellerPortalRepository sellers, DateTime? weekStart) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            var (start, end) = await sellers.ResolveWeekAsync(weekStart, default);
            return Results.Ok(await sellers.ListGoalsAsync(id.Value, start, end, default));
        });

        seller.MapGet("/commission-groups", async (HttpContext http, SellerPortalRepository sellers) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            return Results.Ok(await sellers.ListCommissionGroupsAsync(id.Value, default));
        });

        seller.MapGet("/commission-products", async (HttpContext http, SellerPortalRepository sellers) =>
        {
            var id = SellerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            return Results.Ok(await sellers.ListCommissionProductsAsync(id.Value, default));
        });
    }
}
