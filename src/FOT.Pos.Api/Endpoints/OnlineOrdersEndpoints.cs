using System.Security.Claims;
using System.Text.Json;
using FOT.Pos.Api.Auth;
using FOT.Pos.Api.OnlineOrders;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// «كاشير الطلبات» — طلبات تطبيق ديما الحياة تُفوتر من نقطة البيع (كلها POST، الموقع خلف OnlineOrdersBridge):
///  · /api/online-orders/status          حالة الربط (المفتاح، الاتصال بالموقع) وإعدادات الطباعة.
///  · /api/online-orders/queue           الطابور: جاهزة، استلام من المحل، بانتظار شركة التوصيل، قيد التجهيز، مرتجعات.
///  · /api/online-orders/lookup {code}   الطلب بالـQR + مطابقته مع كتالوج المحل.
///  · /api/online-orders/finalize {code} إيصال بيع آجل + فوترة الموقع (ثم شحنة هاي إكسبريس).
///  · /api/online-orders/pickup {code}   طلب «استلام من المحل»: إيصال + تسليم للزبونة.
///  · /api/online-orders/print-data      إعادة طباعة — لا تنشئ شيئاً.
///  · /api/online-orders/return          إيصال إرجاع مربوط بالبيع + تسجيله في الموقع (صلاحية onlineOrdersReturns).
/// الكاشير يحتاج صلاحية onlineOrders. الإعدادات (GET/PUT /settings، POST /ping) للإدارة فقط.
/// </summary>
public static class OnlineOrdersEndpoints
{
    public static void MapOnlineOrdersEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/online-orders");

        g.MapPost("/status", async (HttpContext http, CashierRepository cashiers, OnlineOrdersBridge bridge, OnlineOrdersRepository repo, CancellationToken ct) =>
        {
            if (await RequireCashierAsync(http, cashiers, returns: false, ct) is { } deny) return deny;
            var settings = await repo.GetSettingsAsync(ct);
            var ping = await PingAsync(bridge, ct);
            return Results.Ok(new
            {
                settings.Enabled,
                bridge.KeyConfigured,
                ping.Reachable,
                ping.ServerTime,
                ping.Error,
                print = new
                {
                    settings.ReceiptCopies,
                    settings.InvoiceCopies,
                    settings.LabelCopies,
                    settings.LabelPrinterName,
                    settings.AutoPrintNewSlips,
                    settings.DoubleCheck,
                },
            });
        });

        g.MapPost("/queue", (HttpContext http, CashierRepository cashiers, OnlineOrdersBridge bridge, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () => Results.Ok(await bridge.QueueAsync(ct))));

        g.MapPost("/lookup", (HttpContext http, OnlineOrderCodeRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.LookupAsync(code, ct));
            }));

        g.MapPost("/finalize", (HttpContext http, OnlineOrderFinalizeRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.FinalizeAsync(CashierId(http), req with { Code = code }, pickup: false, ct));
            }));

        g.MapPost("/pickup", (HttpContext http, OnlineOrderFinalizeRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.FinalizeAsync(CashierId(http), req with { Code = code }, pickup: true, ct));
            }));

        g.MapPost("/print-data", (HttpContext http, OnlineOrderCodeRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.PrintDataAsync(code, ct));
            }));

        g.MapPost("/return", (HttpContext http, OnlineOrderReturnRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, true, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.ReturnAsync(CashierId(http), req with { Code = code }, ct));
            }));

        // ── الإدارة ──
        g.MapGet("/settings", async (HttpContext http, OnlineOrdersRepository repo, OnlineOrdersBridge bridge, CancellationToken ct) =>
            !IsAdmin(http)
                ? Results.Forbid()
                : Results.Ok(new { settings = await repo.GetSettingsAsync(ct), bridge.KeyConfigured, bridge.KeySource, bridge.Url }));

        g.MapPut("/settings", async (HttpContext http, UpdateOnlineOrdersSettingsRequest req, OnlineOrdersRepository repo, OnlineOrdersBridge bridge, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var saved = await repo.SaveSettingsAsync(req, ct);
            return Results.Ok(new { settings = saved, bridge.KeyConfigured, bridge.KeySource, bridge.Url });
        });

        g.MapPost("/ping", async (HttpContext http, OnlineOrdersBridge bridge, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var ping = await PingAsync(bridge, ct);
            return Results.Ok(new { ok = ping.Reachable, ping.ServerTime, ping.Error, bridge.KeyConfigured, bridge.KeySource, bridge.Url });
        });
    }

    private sealed record PingResult(bool Reachable, string? ServerTime, string? Error);

    private static async Task<PingResult> PingAsync(OnlineOrdersBridge bridge, CancellationToken ct)
    {
        if (!bridge.KeyConfigured)
            return new PingResult(false, null, "مفتاح ربط الطلبات غير مضبوط على سيرفر المحل (online-orders.key)");
        try
        {
            var res = await bridge.PingAsync(ct);
            var time = res.ValueKind == JsonValueKind.Object && res.TryGetProperty("serverTime", out var t) ? t.ToString() : null;
            return new PingResult(true, time, null);
        }
        catch (OnlineOrdersException ex)
        {
            return new PingResult(false, null, ex.Message);
        }
    }

    /// <summary>
    /// يحوّل الأخطاء إلى ردود يفهمها الكاشير. لا نرد بـ 401 ولا 502–504 أبداً على مشاكل الموقع:
    /// الكاشير يفسّر 401 كجلسة منتهية و502–504 كخادم محل مقطوع. تعذر الموقع = 424.
    /// </summary>
    private static async Task<IResult> RunAsync(HttpContext http, CashierRepository cashiers, bool returns, CancellationToken ct, Func<Task<IResult>> action)
    {
        if (await RequireCashierAsync(http, cashiers, returns, ct) is { } deny) return deny;
        try
        {
            return await action();
        }
        catch (OnlineOrdersRefusal ex)
        {
            return Results.Json(new { error = ex.Message, extra = ex.Extra }, statusCode: ex.Status);
        }
        catch (OnlineOrdersException ex)
        {
            var status = ex.Unreachable || ex.Status is 0 or 401 or 403 || ex.Status >= 500 ? 424 : ex.Status;
            return Results.Json(new { error = ex.Message, code = ex.Code, unreachable = ex.Unreachable || status == 424 }, statusCode: status);
        }
    }

    private static async Task<IResult?> RequireCashierAsync(HttpContext http, CashierRepository cashiers, bool returns, CancellationToken ct)
    {
        if (CashierContext.Id(http) is not long id)
            return Results.Json(new { error = "سجّل الدخول بحساب كاشير" }, statusCode: 403);
        var perms = await cashiers.GetPermissionsForCashierAsync(id, ct);
        if (perms?.OnlineOrders != true)
            return Results.Json(new { error = "ليست لديك صلاحية «كاشير الطلبات» — راجع الإدارة" }, statusCode: 403);
        if (returns && perms.OnlineOrdersReturns != true)
            return Results.Json(new { error = "ليست لديك صلاحية «مرتجعات الطلبات» — راجع الإدارة" }, statusCode: 403);
        return null;
    }

    private static long CashierId(HttpContext http) => CashierContext.Id(http) ?? 0;

    private static string? CleanCode(string? raw)
    {
        var code = (raw ?? "").Trim();
        return code.Length is 0 or > 80 ? null : code;
    }

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
