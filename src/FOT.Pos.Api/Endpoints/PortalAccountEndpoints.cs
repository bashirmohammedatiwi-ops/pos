using System.Security.Claims;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

public static class PortalAccountEndpoints
{
    public static void MapPortalAccountEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/portal-accounts").RequireAuthorization();

        g.MapGet("/sellers", async (HttpContext http, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            return Results.Ok(await repo.ListSellersAsync(default));
        });

        g.MapPost("/sellers/{id:long}/issue", async (HttpContext http, long id, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.IssueSellerPinAsync(id, default);
            return row is null ? Results.NotFound(new { error = "البائع غير موجود" }) : Results.Ok(row);
        });

        g.MapPost("/sellers/issue-missing", async (HttpContext http, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            return Results.Ok(await repo.IssueMissingSellerPinsAsync(default));
        });

        g.MapPost("/sellers/{id:long}/active", async (HttpContext http, long id, bool active, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.SetSellerActiveAsync(id, active, default);
            return row is null ? Results.NotFound(new { error = "لا يوجد حساب لهذا البائع" }) : Results.Ok(row);
        });

        g.MapGet("/managers", async (HttpContext http, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            return Results.Ok(await repo.ListManagersAsync(default));
        });

        g.MapPost("/managers", async (HttpContext http, CreateManagerAccountRequest req, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var (row, error) = await repo.CreateManagerAsync(req.Username, req.DisplayName, default);
            if (error is not null) return Results.BadRequest(new { error });
            return Results.Ok(row);
        });

        g.MapPost("/managers/{id:long}/reset", async (HttpContext http, long id, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.ResetManagerPasswordAsync(id, default);
            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        g.MapPut("/managers/{id:long}", async (HttpContext http, long id, UpdateManagerAccountRequest req, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.UpdateManagerNameAsync(id, req.DisplayName, default);
            return row is null ? Results.BadRequest(new { error = "تعذر تحديث الاسم" }) : Results.Ok(row);
        });

        g.MapPost("/managers/{id:long}/active", async (HttpContext http, long id, bool active, PortalAccountRepository repo) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.SetManagerActiveAsync(id, active, default);
            return row is null ? Results.NotFound() : Results.Ok(row);
        });
    }

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
