using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using FOT.Pos.Api.Auth;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

public static class ManagerPortalEndpoints
{
    public static void MapManagerAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/auth/manager-lookup", async (string username, PortalAccountRepository accounts) =>
        {
            var row = await accounts.GetSyncManagerByUsernameAsync(username, default);
            return row is null
                ? Results.NotFound(new { error = "لا مدير بهذا الاسم" })
                : Results.Ok(new ManagerMeDto(row.Id, row.Username, row.DisplayName));
        }).AllowAnonymous();

        app.MapPost("/auth/manager-login", async (
            ManagerLoginRequest req, PortalAccountRepository accounts, IConfiguration config) =>
        {
            var username = (req.Username ?? "").Trim();
            var password = (req.Password ?? "").Trim();
            if (username.Length < 2 || password.Length < 4)
                return Results.BadRequest(new { error = "أدخل اسم الدخول وكلمة المرور" });

            var acc = await accounts.GetSyncManagerByUsernameAsync(username, default);
            if (acc is null)
                return Results.Unauthorized();
            if (!acc.IsActive)
                return Results.Json(new { error = "الحساب متوقف — راجع الإدارة" }, statusCode: 403);
            if (string.IsNullOrEmpty(acc.PasswordHash))
                return Results.Json(new { error = "اطلب من الإدارة توليد حسابك من لوحة التحكم" }, statusCode: 403);
            if (!BCrypt.Net.BCrypt.Verify(password, acc.PasswordHash))
                return Results.Unauthorized();

            var me = new ManagerMeDto(acc.Id, acc.Username, acc.DisplayName);
            var token = JwtTokenIssuer.Issue(config, acc.Id, acc.Username, acc.DisplayName, "manager");
            return Results.Ok(new ManagerLoginResponse(token, me));
        }).AllowAnonymous();

        app.MapPost("/auth/manager-refresh", async (HttpContext http, PortalAccountRepository accounts, IConfiguration config) =>
        {
            var principal = JwtTokenIssuer.Read(config, JwtTokenIssuer.Bearer(http.Request), ignoreLifetime: true);
            if (principal is null || !principal.IsInRole("manager"))
                return Results.Unauthorized();
            if (!long.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id))
                return Results.Unauthorized();
            var acc = (await accounts.ListSyncManagersAsync(default)).FirstOrDefault(m => m.Id == id);
            if (acc is null || !acc.IsActive)
                return Results.Unauthorized();
            var me = new ManagerMeDto(acc.Id, acc.Username, acc.DisplayName);
            var token = JwtTokenIssuer.Issue(config, acc.Id, acc.Username, acc.DisplayName, "manager");
            return Results.Ok(new ManagerLoginResponse(token, me));
        }).AllowAnonymous();
    }

    public static void MapManagerPortalEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/manager").RequireAuthorization("ManagerOnly");

        g.MapGet("/me", async (HttpContext http, PortalAccountRepository accounts) =>
        {
            var id = ManagerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            var rows = await accounts.ListSyncManagersAsync(default);
            var acc = rows.FirstOrDefault(m => m.Id == id.Value);
            return acc is null
                ? Results.NotFound()
                : Results.Ok(new ManagerMeDto(acc.Id, acc.Username, acc.DisplayName));
        });

        g.MapGet("/weeks", async (HttpContext http, ManagerPortalRepository managers, int count = 12) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok(await managers.ListWeeksAsync(count, default));
        });

        g.MapGet("/dashboard", async (HttpContext http, ManagerPortalRepository managers, PortalAccountRepository accounts, DateTime? weekStart) =>
        {
            var id = ManagerHttp.Id(http);
            if (id is null) return Results.Unauthorized();
            var acc = (await accounts.ListSyncManagersAsync(default)).FirstOrDefault(m => m.Id == id.Value);
            if (acc is null) return Results.Unauthorized();
            var pack = await managers.GetWeekPackAsync(weekStart, default);
            return Results.Ok(new ManagerDashboardDto(
                new ManagerMeDto(acc.Id, acc.Username, acc.DisplayName),
                pack.Week, pack.Sellers, pack.Cashiers, pack.Malls, pack.Goals,
                pack.Products.Take(40).ToList(),
                null,
                pack.Days,
                await managers.ListCashierDaysAsync(pack.Week.WeekStart, pack.Week.WeekEnd, default)));
        });

        g.MapGet("/sellers", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok((await managers.GetWeekPackAsync(weekStart, default)).Sellers);
        });

        g.MapGet("/sellers/{salesmanId:long}", async (HttpContext http, ManagerPortalRepository managers, long salesmanId, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            var pack = await managers.GetWeekPackAsync(weekStart, default);
            var seller = pack.Sellers.FirstOrDefault(s => s.SalesmanId == salesmanId);
            if (seller is null) return Results.NotFound(new { error = "لا بائع في هذا الأسبوع" });
            return Results.Ok(new ManagerSellerDetailDto(
                seller,
                pack.Goals.Where(g => g.SalesmanId == salesmanId).ToList(),
                pack.Lines.Where(l => l.SalesmanId == salesmanId).ToList()));
        });

        g.MapGet("/cashiers", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok((await managers.GetWeekPackAsync(weekStart, default)).Cashiers);
        });

        g.MapGet("/malls", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok((await managers.GetWeekPackAsync(weekStart, default)).Malls);
        });

        g.MapGet("/goals", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok((await managers.GetWeekPackAsync(weekStart, default)).Goals);
        });

        g.MapGet("/days", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok((await managers.GetWeekPackAsync(weekStart, default)).Days);
        });

        g.MapGet("/lines", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            var lines = (await managers.GetWeekPackAsync(weekStart, default)).Lines;
            return Results.Ok(new { totalCommission = lines.Sum(l => l.CommissionAmount), lineCount = lines.Count, lines });
        });

        g.MapGet("/products", async (HttpContext http, ManagerPortalRepository managers, DateTime? weekStart) =>
        {
            if (ManagerHttp.Id(http) is null) return Results.Unauthorized();
            return Results.Ok((await managers.GetWeekPackAsync(weekStart, default)).Products);
        });
    }
}
