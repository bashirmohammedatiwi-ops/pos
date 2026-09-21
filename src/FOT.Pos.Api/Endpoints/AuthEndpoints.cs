using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FOT.Pos.Api.Auth;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using Microsoft.IdentityModel.Tokens;

namespace FOT.Pos.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/login", async (LoginRequest req, AuthRepository auth, IConfiguration config) =>
        {
            var user = await auth.ValidateAsync(req.Username, req.Password, default);
            if (user is null) return Results.Unauthorized();
            return Results.Ok(new LoginResponse(JwtTokenIssuer.Issue(config, user.Id, user.Username, user.DisplayName, user.Role), user));
        }).AllowAnonymous().Produces<LoginResponse>(200).Produces(401);

        app.MapPost("/auth/cashier-login", async (
            CashierLoginRequest req, CashierRepository cashiers,
            PermissionsRepository perms, TerminalRepository terminals, SectionRepository sections,
            IConfiguration config) =>
        {
            try
            {
                var cashier = !string.IsNullOrWhiteSpace(req.Username)
                    ? await cashiers.ValidateAsync(req.Username, req.Password, default)
                    : await cashiers.ValidateByPinAsync(req.Password, default);
                if (cashier is null) return Results.Unauthorized();
                if (cashier.SectionId <= 0)
                    return Results.BadRequest(new { error = "الكاشير غير مربوط بقسم — راجع الإدارة" });

                var cashBoxes = await sections.GetCashBoxesAsync(cashier.SectionId, default);
                if (cashBoxes.Count == 0)
                {
                    var sectionLabel = string.IsNullOrWhiteSpace(cashier.SectionName)
                        ? $"#{cashier.SectionId}"
                        : cashier.SectionName;
                    return Results.BadRequest(new
                    {
                        error = $"لا توجد صناديق مرتبطة بقسم «{sectionLabel}» — اربط صندوقاً من الإدارة ← الأقسام ثم أعد الدخول"
                    });
                }

                var permissions = await perms.GetByIdAsync(cashier.PermissionsId, default);
                long? posId = null;
                if (!string.IsNullOrWhiteSpace(req.HwId))
                    posId = await terminals.RegisterAsync(new RegisterTerminalRequest(req.HwId, req.HwId), default);

                // Only a cashier restricted to a single salesman gets one pre-selected. Picking the
                // first name off the list used to stamp every receipt — including ones nobody was
                // credited for — with that salesman.
                var allowedSalesmen = await cashiers.GetAllowedSalesmenAsync(cashier.Id, default);
                var salesman = allowedSalesmen.Count == 1
                    ? allowedSalesmen[0]
                    : new SalesmanDto(0, "بدون بائع");
                var token = JwtTokenIssuer.Issue(config, cashier.Id, cashier.Username, cashier.Username, "cashier");
                var active = cashBoxes.FirstOrDefault(b => b.IsDefault) ?? cashBoxes[0];

                CardTerminalConfig? card = null;
                if (posId.HasValue)
                {
                    try { card = await terminals.EnsureDefaultCardTerminalAsync(posId.Value, default); }
                    catch { card = new CardTerminalConfig { Service = "localhost:9092" }; }
                }
                var mpos = string.IsNullOrWhiteSpace(card?.Service) ? "localhost:9092" : card!.Service;
                var allowOffline = true;
                if (posId.HasValue)
                {
                    try { allowOffline = await terminals.GetAllowOfflineModeAsync(posId.Value, default); }
                    catch { allowOffline = true; }
                }

                var receiptYear = DateTime.Now.Year;
                var receiptSeq = await cashiers.GetCurrentReceiptSeqAsync(cashier.Id, receiptYear, default);

                return Results.Ok(new PosSessionDto(
                    cashier.Id, cashier.Username, salesman.Id, salesman.Name, token, permissions, posId,
                    cashier.SectionId, cashier.SectionName, cashBoxes,
                    active.MasterAccount, active.MasterAccountBank,
                    mpos, card?.ComPort, true, allowOffline,
                    cashier.ApplyCommissions, cashier.ApplyTargets, cashier.ReceiptNum,
                    receiptYear, receiptSeq));
            }
            catch (Exception ex)
            {
                var detail = ex.InnerException?.Message ?? ex.Message;
                if (detail.Contains("Invalid column", StringComparison.OrdinalIgnoreCase)
                    || detail.Contains("Invalid object", StringComparison.OrdinalIgnoreCase))
                {
                    return Results.Json(new { error = "قاعدة البيانات تحتاج تحديث — أعد تشغيل خدمة FOT POS Server بعد تثبيت أحدث نسخة" },
                        statusCode: 500);
                }
                return Results.Json(new { error = "تعذر تسجيل الدخول. تحقق من ربط الكاشير بقسم وصندوق في لوحة التحكم." },
                    statusCode: 500);
            }
        }).AllowAnonymous().Produces<PosSessionDto>(200).Produces(400).Produces(401);

        // POS keeps a cached token for offline login. When the cashier comes back online the
        // access token may already be expired — this re-issues one from the old signed JWT
        // so they never have to log out just to keep talking to the server.
        app.MapPost("/auth/cashier-refresh", async (
            CashierRefreshRequest req, CashierRepository cashiers, IConfiguration config) =>
        {
            if (string.IsNullOrWhiteSpace(req.Token)) return Results.Unauthorized();
            var key = config["Jwt:Key"];
            if (string.IsNullOrWhiteSpace(key)) return Results.Unauthorized();

            try
            {
                var handler = new JwtSecurityTokenHandler();
                var principal = handler.ValidateToken(req.Token, new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = false,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = config["Jwt:Issuer"],
                    ValidAudience = config["Jwt:Audience"],
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                    ClockSkew = TimeSpan.FromMinutes(15),
                    RoleClaimType = ClaimTypes.Role,
                    NameClaimType = ClaimTypes.Name,
                }, out var validated);

                var role = principal.FindFirstValue(ClaimTypes.Role) ?? principal.FindFirstValue("role");
                if (!string.Equals(role, "cashier", StringComparison.OrdinalIgnoreCase))
                    return Results.Unauthorized();

                string? idRaw = principal.FindFirstValue(ClaimTypes.NameIdentifier)
                    ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
                    ?? principal.FindFirstValue("sub")
                    ?? principal.FindFirstValue("nameid");
                if (!long.TryParse(idRaw, out var cashierId) || cashierId <= 0)
                    return Results.Unauthorized();

                if (validated is JwtSecurityToken jwt && jwt.ValidTo < DateTime.UtcNow.AddDays(-30))
                    return Results.Unauthorized();

                var cashier = await cashiers.GetByIdAsync(cashierId, default);
                if (cashier is null || !cashier.Active)
                    return Results.Unauthorized();

                var token = JwtTokenIssuer.Issue(config, cashier.Id, cashier.Username, cashier.Username, "cashier");
                return Results.Ok(new CashierRefreshResponse(token));
            }
            catch
            {
                return Results.Unauthorized();
            }
        }).AllowAnonymous().Produces<CashierRefreshResponse>(200).Produces(401);
    }
}
