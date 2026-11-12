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
///  · /api/online-orders/product {barcode} صنف من كتالوج المحل قبل إضافته للطلب.
///  · /api/online-orders/edit {code, op}  إضافة صنف بالباركود أو تغيير كمية سطر قبل الفوترة.
///  · /api/online-orders/label {code}    ملصق هاي إكسبريس نفسه (PDF) لطابعة الملصقات.
///  · /api/online-orders/held | /post     فواتير بانتظار الترحيل اليدوي إلى الإداري، وترحيلها.
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
                    settings.LabelHideCustomer,
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

        g.MapPost("/product", (HttpContext http, OnlineOrderProductRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Barcode) ?? throw new OnlineOrdersRefusal("امسح باركود الصنف", 400);
                return Results.Ok(await svc.ProductAsync(code, ct));
            }));

        g.MapPost("/edit", (HttpContext http, OnlineOrderEditRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.EditAsync(CashierId(http), req with { Code = code }, ct));
            }));

        // ملصق هاي إكسبريس نفسه (PDF) — يُطبع على طابعة الملصقات.
        g.MapPost("/label", (HttpContext http, OnlineOrderCodeRequest req, CashierRepository cashiers, OnlineOrdersBridge bridge, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await bridge.LabelAsync(code, ct));
            }));

        // خيارات التوصيل (قابل للكسر، مبرد...، الطرود، ملاحظة للمندوب، هاتف ثانٍ).
        g.MapPost("/courier-options", (HttpContext http, OnlineOrderCourierOptionsRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var code = CleanCode(req.Code) ?? throw new OnlineOrdersRefusal("امسح رمز الطلب (QR)", 400);
                return Results.Ok(await svc.CourierOptionsAsync(CashierId(http), req with { Code = code }, ct));
            }));

        // بائع فاتورة الطلب بعد الفوترة (قبل الترحيل) — كالكاشير الأصلي.
        g.MapPost("/salesman", (HttpContext http, OnlineOrderSalesmanRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () => Results.Ok(await svc.SetSalesmanAsync(req, ct))));

        // الترحيل اليدوي إلى الإداري: القائمة والترحيل (صلاحية كاشير الطلبات).
        g.MapPost("/held", (HttpContext http, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () => Results.Ok(await svc.HeldAsync(ct))));

        g.MapPost("/post", (HttpContext http, OnlineOrdersPostRequest req, CashierRepository cashiers, OnlineOrdersService svc, CancellationToken ct) =>
            RunAsync(http, cashiers, false, ct, async () =>
            {
                var id = CashierId(http);
                var c = await cashiers.GetByIdAsync(id, ct);
                var name = string.IsNullOrWhiteSpace(c?.AccountName) ? c?.Username : c!.AccountName;
                return Results.Ok(await svc.PostAsync(id, name, req, ct));
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

        // لوحة التحكم: فواتير طلبات التطبيق بانتظار الترحيل، وترحيلها.
        g.MapGet("/admin/held", async (HttpContext http, OnlineOrdersService svc, CancellationToken ct) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(await svc.HeldAsync(ct)));

        g.MapPost("/admin/post", async (HttpContext http, OnlineOrdersPostRequest req, OnlineOrdersService svc, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            try
            {
                var who = http.User.FindFirstValue(ClaimTypes.Name) ?? http.User.FindFirstValue("name") ?? "لوحة التحكم";
                return Results.Ok(await svc.PostAsync(0, who, req, ct));
            }
            catch (OnlineOrdersRefusal ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: ex.Status);
            }
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
