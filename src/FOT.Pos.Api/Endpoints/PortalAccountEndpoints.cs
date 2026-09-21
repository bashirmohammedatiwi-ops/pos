using System.Security.Claims;
using FOT.Pos.Api;
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

        g.MapGet("/web-status", async (HttpContext http, PortalAccountRepository repo, SellerWebPublisher web) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var sellers = await repo.ListSellersAsync(default);
            var withAccount = sellers.Count(s => s.HasAccount);
            var active = sellers.Count(s => s.HasAccount && s.IsActive);
            var probeId = sellers.FirstOrDefault(s => s.HasAccount)?.SalesmanId
                ?? sellers.FirstOrDefault()?.SalesmanId;
            var probe = probeId is null
                ? new PortalWebProbeDto(false, "لا يوجد بائعون في نقطة البيع", web.PublicUrl, null)
                : await web.ProbeAsync(probeId.Value, default);
            return Results.Ok(new PortalWebStatusDto(
                withAccount, active, true, probe.VisibleOnWeb, probe.Message, web.PublicUrl, probe.StatusCode));
        });

        g.MapPost("/sellers/{id:long}/publish", async (HttpContext http, long id, PortalAccountRepository repo, SellerWebPublisher web) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var current = (await repo.ListSellersAsync(default)).FirstOrDefault(s => s.SalesmanId == id);
            if (current is null) return Results.NotFound(new { error = "البائع غير موجود" });
            var row = current.HasAccount ? current : await repo.IssueSellerPinAsync(id, default);
            if (row is null) return Results.NotFound(new { error = "البائع غير موجود" });
            var probe = await web.ProbeAsync(id, default);
            return Results.Ok(new PortalPublishResult(row, true, probe.VisibleOnWeb, probe.Message, web.PublicUrl));
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
