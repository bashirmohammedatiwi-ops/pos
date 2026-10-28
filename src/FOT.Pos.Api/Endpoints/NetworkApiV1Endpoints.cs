using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using FOT.Pos.Api.Auth;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Api.Lan;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;

namespace FOT.Pos.Api.Endpoints;

public static class NetworkApiV1Endpoints
{
    private static readonly DateTime ServerStartedAtUtc = DateTime.UtcNow;

    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static readonly IReadOnlyList<ApiEndpointDescriptorDto> EndpointCatalog =
    [
        // System & Discovery
        new("النظام والاكتشاف", "GET", "/api/v1", "دليل الـ API الشامل وعناوين الشبكة المحلية والوحدات المتاحة", "*", true),
        new("النظام والاكتشاف", "GET", "/api/v1/system/status", "حالة الخادم وقاعدة البيانات والأداري ونقاط البيع والكتالوج", "*", true),

        // Catalog & Pricing
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/version", "رقم إصدار الكتالوج الحالي وعدد المواد المسعّرة", "catalog:read", true),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/products", "قائمة المواد مع السعر الأصلي وسعر العرض والمخزون", "catalog:read", true, "?page=1&pageSize=25&offersOnly=false&inStock=true"),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/search", "بحث فوري بالاسم أو الباركود أو الرمز مع الأسعار والعروض", "catalog:read", true, "?q=ordinary&limit=20"),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/lookup", "فحص مادة واحدة بالباركود أو رقم المادة", "catalog:read", true, "?code=769915195606"),
        new("الكتالوج والتسعير", "POST", "/api/v1/catalog/lookup", "فحص دفعة باركودات (حتى 100 باركود في طلب واحد)", "catalog:read", true, "{\"codes\":[\"769915195606\"]}"),
        new("الكتالوج والتسعير", "POST", "/api/v1/catalog/quote", "محرك تسعير السلة الذكي: يحسب العروض الفعّالة والخصومات ورموز QR والإجمالي", "catalog:read", true, "{\"items\":[{\"code\":\"769915195606\",\"quantity\":2}]}"),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/offers", "العروض الفعّالة حالياً وعدد مواد كل عرض", "catalog:read", true),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/bundles", "العروض المشروطة (الباقات) الفعّالة وشروط تفعيلها", "catalog:read", true),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/categories", "مجموعات الأزرار والأقسام السريعة في الكاشير", "catalog:read", true),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/trees", "شجرة المواد والمجلدات من الأداري", "catalog:read", true, "?limit=50"),
        new("الكتالوج والتسعير", "GET", "/api/v1/catalog/changes", "المزامنة التفاضلية للمواد المتغيّرة منذ رقم مراجعة معيّن", "catalog:read", true, "?since=0&limit=100"),

        // Sales & Receipts
        new("المبيعات والفواتير", "GET", "/api/v1/sales/today", "ملخص مبيعات اليوم اللحظي (الصافي، النقدي، البطاقة، بالساعة، بالأقسام، أحدث الفواتير)", "sales:read", false),
        new("المبيعات والفواتير", "GET", "/api/v1/sales/summary", "تقرير المبيعات والصندوق والتوزيع لأي فترة زمنية", "sales:read", false, "?from=2026-10-01&to=2026-10-16"),
        new("المبيعات والفواتير", "GET", "/api/v1/sales/top-products", "أكثر المواد مبيعاً بالكمية والقيمة خلال فترة", "sales:read", false, "?limit=30"),
        new("المبيعات والفواتير", "GET", "/api/v1/receipts", "بحث واستعراض الفواتير مع فلاتر القسم والكاشير والترحيل", "sales:read", false, "?page=1&pageSize=25"),
        new("المبيعات والفواتير", "GET", "/api/v1/receipts/{id}", "تفاصيل فاتورة كاملة مع كافة الأسطر والعروض والبائع", "sales:read", false),
        new("المبيعات والفواتير", "GET", "/api/v1/receipts/by-number/{number}", "البحث عن فاتورة برقمها المطبوع/الرسمي", "sales:read", false),
        new("المبيعات والفواتير", "POST", "/api/v1/receipts", "إنشاء فاتورة بيع أو مرتجع أو تعليق من تطبيق شبكي خارجي", "sales:write", false),

        // Inventory
        new("المخزون والنواقص", "GET", "/api/v1/inventory/stock", "فحص أرصدة المخزون والأسعار لمجموعة باركودات", "inventory:read", false, "?codes=769915195606"),
        new("المخزون والنواقص", "GET", "/api/v1/inventory/reorder", "توقعات النواقص والمواد المقترح طلبها حسب سرعة السحب", "inventory:read", false, "?days=30&coverDays=14"),
        new("المخزون والنواقص", "GET", "/api/v1/inventory/slow-movers", "المواد الراكدة التي لم تُبَع منذ فترة مع رصيدها", "inventory:read", false, "?days=60&minStock=1"),

        // Team & Terminals
        new("الفريق والأقسام", "GET", "/api/v1/team/salesmen", "قائمة البائعين مع إحصاءات مبيعاتهم وعمولاتهم للفترة", "team:read", false),
        new("الفريق والأقسام", "GET", "/api/v1/team/cashiers", "قائمة الكاشير والأقسام المربوطة وأداء اليوم", "team:read", false),
        new("الفريق والأقسام", "GET", "/api/v1/team/sections", "الأقسام والصناديق وحسابات الأداري المرتبطة", "team:read", false),
        new("الفريق والأقسام", "GET", "/api/v1/team/terminals", "أجهزة الكاشير المتصلة على الشبكة وحالة مزامنتها", "team:read", false),

        // Customers & QR
        new("الحسابات ورموز الخصم", "GET", "/api/v1/customers/accounts", "حسابات البيع الآجل وأرصدتها الحالية", "customers:read", false),
        new("الحسابات ورموز الخصم", "GET", "/api/v1/customers/discount-qr", "قائمة حاملي رموز QR للخصم والهدايا الفعّالة", "customers:read", false),
        new("الحسابات ورموز الخصم", "GET", "/api/v1/customers/discount-qr/verify", "التحقق الفوري من صلاحية رمز QR للخصم", "customers:read", false, "?code=FOTDQ..."),

        // Real-time Events
        new("الأحداث والبث اللحظي", "GET", "/api/v1/events/stream", "بث مباشر (SSE) لأحداث الفواتير والكتالوج والأداري بدون مكتبات", "*", true),
        new("الأحداث والبث اللحظي", "GET", "/api/v1/events/recent", "آخر الأحداث المسجّلة على الشبكة (JSON)", "*", true, "?limit=30"),
        new("الأحداث والبث اللحظي", "POST", "/api/v1/events/publish", "بث حدث مخصّص لجميع الأجهزة المشتركة والويب هوك على الشبكة", "events:publish", false, "{\"eventType\":\"custom.ping\",\"data\":{\"msg\":\"مرحبا\"}}")
    ];

    public static void MapNetworkApiV1Endpoints(this WebApplication app)
    {
        var v1 = app.MapGroup("/api/v1").AllowAnonymous().WithTags("Network API v1");

        // ── 1. Root Discovery & System Status ────────────────────────────────

        v1.MapGet("/", async (StoreCatalogRepository catalogRepo) =>
        {
            var ips = LanNetwork.ListIpv4Addresses();
            var baseUrls = LanNetwork.ApiUrls(ips);
            var primaryUrl = baseUrls.FirstOrDefault() ?? $"http://localhost:{LanNetwork.ApiPort}";
            var catVer = await catalogRepo.VersionAsync(default);

            return Results.Ok(new
            {
                name = "FOT POS Network API Platform",
                version = "1.0",
                serverName = Environment.MachineName,
                port = LanNetwork.ApiPort,
                lanIps = ips,
                baseUrls,
                documentation = new
                {
                    swaggerUi = $"{primaryUrl}/swagger",
                    openApiJson = $"{primaryUrl}/swagger/v1/swagger.json",
                    adminPortal = $"{primaryUrl}/developer"
                },
                realtime = new
                {
                    sseStream = $"{primaryUrl}/api/v1/events/stream",
                    recentEvents = $"{primaryUrl}/api/v1/events/recent",
                    signalRHub = $"{primaryUrl}/hubs/pos",
                    udpDiscoveryPort = LanNetwork.DiscoveryPort,
                    udpProbePayload = LanNetwork.ProbeMagic
                },
                authentication = new
                {
                    headerApiKey = "X-API-Key: fot_k_...",
                    headerBearer = "Authorization: Bearer <token-or-api-key>",
                    queryParam = "?api_key=fot_k_...",
                    availableScopes = ApiPlatformRepository.AllScopes
                },
                catalog = new
                {
                    revision = catVer.Revision,
                    productCount = catVer.ProductCount,
                    currency = catVer.Currency
                },
                modules = new
                {
                    system = "/api/v1/system/status",
                    catalog = "/api/v1/catalog",
                    sales = "/api/v1/sales/today",
                    receipts = "/api/v1/receipts",
                    inventory = "/api/v1/inventory/stock",
                    team = "/api/v1/team/salesmen",
                    customers = "/api/v1/customers/accounts",
                    events = "/api/v1/events/recent"
                },
                endpoints = EndpointCatalog
            });
        });

        v1.MapGet("/system/status", async (
            DashboardRepository dashboardRepo,
            StoreCatalogRepository catalogRepo,
            EdariSyncRepository edariSyncRepo,
            TerminalRepository terminalRepo,
            BusinessPeriodSettingsRepository periodRepo) =>
        {
            var catTask = catalogRepo.VersionAsync(default);
            var dashTask = dashboardRepo.GetStatsAsync(default);
            var edariTask = edariSyncRepo.GetStatusAsync(default);
            var termTask = terminalRepo.MonitorGroupsAsync(default);
            var periodTask = periodRepo.GetAsync(default);

            await Task.WhenAll(catTask, dashTask, edariTask, termTask, periodTask);
            var terminals = termTask.Result.SelectMany(g => g.Terminals).ToList();

            return Results.Ok(new
            {
                status = "ok",
                serverName = Environment.MachineName,
                serverTimeUtc = DateTime.UtcNow,
                serverTimeLocal = DateTime.Now,
                uptimeSeconds = (long)(DateTime.UtcNow - ServerStartedAtUtc).TotalSeconds,
                lanIps = LanNetwork.ListIpv4Addresses(),
                port = LanNetwork.ApiPort,
                catalog = catTask.Result,
                dashboard = dashTask.Result,
                edari = edariTask.Result,
                terminals = new
                {
                    total = terminals.Count,
                    online = terminals.Count(t => t.IsOnline),
                    items = terminals
                },
                businessPeriod = periodTask.Result
            });
        });

        // ── 2. Sales & Receipts (/api/v1/sales & /api/v1/receipts) ───────────

        var sales = v1.MapGroup("/sales").WithTags("Network API v1 - Sales");

        sales.MapGet("/today", async (
            HttpContext http,
            ReportRepository reportRepo,
            DashboardRepository dashRepo) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            var today = DateTime.Today;
            var cashTask = reportRepo.CashReportAsync(today, today, default);
            var breakdownTask = reportRepo.DayBreakdownAsync(today, default);
            var recentTask = dashRepo.RecentReceiptsAsync(15, default);

            await Task.WhenAll(cashTask, breakdownTask, recentTask);
            var cash = cashTask.Result;
            var bd = breakdownTask.Result;

            return Results.Ok(new
            {
                date = today.ToString("yyyy-MM-dd"),
                currency = "IQD",
                summary = cash,
                cardTotal = bd.CardTotal,
                cardCount = bd.CardCount,
                cashNet = Math.Max(0, cash.TotalSales - bd.CardTotal),
                hourly = bd.Hourly,
                bySection = bd.BySection,
                byPos = bd.ByPos,
                byCashier = bd.ByCashier,
                recentReceipts = recentTask.Result
            });
        });

        sales.MapGet("/summary", async (
            HttpContext http,
            ReportRepository reportRepo,
            DateTime? from = null,
            DateTime? to = null) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            var start = (from ?? DateTime.Today).Date;
            var end = (to ?? start).Date;
            if (end < start) (start, end) = (end, start);

            var cashTask = reportRepo.CashReportAsync(start, end, default);
            var dailyTask = reportRepo.DailySalesAsync(start, end, default);
            var salesmenTask = reportRepo.SalesBySalesmanAsync(start, end, default);
            var cashiersTask = reportRepo.CashierPerformanceAsync(start, end, default);

            await Task.WhenAll(cashTask, dailyTask, salesmenTask, cashiersTask);

            return Results.Ok(new
            {
                from = start.ToString("yyyy-MM-dd"),
                to = end.ToString("yyyy-MM-dd"),
                currency = "IQD",
                cash = cashTask.Result,
                daily = dailyTask.Result,
                bySalesman = salesmenTask.Result,
                byCashier = cashiersTask.Result
            });
        });

        sales.MapGet("/top-products", async (
            HttpContext http,
            ReportRepository reportRepo,
            DateTime? from = null,
            DateTime? to = null,
            string? search = null,
            int limit = 50) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            var start = (from ?? DateTime.Today.AddDays(-7)).Date;
            var end = (to ?? DateTime.Today).Date;
            if (end < start) (start, end) = (end, start);
            var rows = await reportRepo.ArticleMovementAsync(start, end, search, default);
            return Results.Ok(rows.Take(Math.Clamp(limit, 1, 500)).ToList());
        });

        var receipts = v1.MapGroup("/receipts").WithTags("Network API v1 - Receipts");

        receipts.MapGet("/", async (
            HttpContext http,
            ReceiptRepository repo,
            int page = 1,
            int pageSize = 50,
            string? search = null,
            long? sectionId = null,
            long? posId = null,
            long? cashierId = null,
            int? kind = null,
            bool? synced = null,
            DateTime? from = null,
            DateTime? to = null,
            bool? hold = null) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            var result = await repo.SearchAsync(
                page, Math.Clamp(pageSize, 1, 200), search, sectionId, posId, cashierId, kind,
                synced == true ? true : null, synced == false ? true : null, from, to, hold, default);
            return Results.Ok(result);
        });

        receipts.MapGet("/holds", async (HttpContext http, ReceiptRepository repo, long? sectionId = null, long? posId = null) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            return Results.Ok(await repo.ListAllHoldAsync(sectionId, posId, default));
        });

        receipts.MapGet("/{id:long}", async (HttpContext http, ReceiptRepository repo, long id) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            return await repo.GetByIdAsync(id, default) is { } r
                ? Results.Ok(r)
                : Results.NotFound(new { error = "الفاتورة غير موجودة" });
        });

        receipts.MapGet("/by-number/{number:long}", async (HttpContext http, ReceiptRepository repo, long number) =>
        {
            if (ApiScope.Enforce(http, "sales:read") is { } denied) return denied;
            var items = await repo.GetReturnSourcesByNumberAsync(number, default);
            return items.Count == 0
                ? Results.NotFound(new { error = "لا توجد فاتورة بهذا الرقم" })
                : Results.Ok(new ReceiptReturnMatchesDto(items));
        });

        receipts.MapPost("/", async (
            HttpContext http,
            ReceiptRepository repo,
            CreateReceiptRequest req,
            IHubContext<PosHub> hub) =>
        {
            if (ApiScope.Enforce(http, "sales:write") is { } denied) return denied;
            try
            {
                var result = await repo.CreateAsync(req, default);
                try
                {
                    if (!req.IsPending && result.Number > 0)
                        await PosHubEvents.NotifyReceiptCreated(hub, result.ReceiptId, result.Number);
                }
                catch { /* non-blocking */ }
                return Results.Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (SqlException ex)
            {
                return Results.Json(new { error = ReceiptErrors.ToUserMessage(ex) }, statusCode: 400);
            }
            catch (Exception ex)
            {
                return Results.Json(new { error = ReceiptErrors.ToUserMessage(ex) }, statusCode: 500);
            }
        });

        // ── 3. Inventory & Stock Intelligence (/api/v1/inventory) ────────────

        var inventory = v1.MapGroup("/inventory").WithTags("Network API v1 - Inventory");

        inventory.MapGet("/stock", async (
            HttpContext http,
            StoreCatalogRepository catalogRepo,
            string? codes = null) =>
        {
            if (ApiScope.Enforce(http, "inventory:read") is { } denied) return denied;
            var list = (codes ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList();
            if (list.Count == 0)
                return Results.BadRequest(new { error = "أرسل الباركودات مفصولة بفواصل في ?codes=" });
            return Results.Ok(await catalogRepo.LookupManyAsync(list, default));
        });

        inventory.MapPost("/stock", async (
            HttpContext http,
            StoreCatalogRepository catalogRepo,
            StoreLookupRequest? body) =>
        {
            if (ApiScope.Enforce(http, "inventory:read") is { } denied) return denied;
            if (body?.Codes is not { Count: > 0 })
                return Results.BadRequest(new { error = "أرسل قائمة الباركودات في codes" });
            return Results.Ok(await catalogRepo.LookupManyAsync(body.Codes, default));
        });

        inventory.MapGet("/reorder", async (
            HttpContext http,
            ReportRepository reportRepo,
            int days = 30,
            int coverDays = 14,
            string? search = null) =>
        {
            if (ApiScope.Enforce(http, "inventory:read") is { } denied) return denied;
            return Results.Ok(await reportRepo.ReorderAsync(Math.Clamp(days, 1, 365), Math.Clamp(coverDays, 1, 180), search, default));
        });

        inventory.MapGet("/slow-movers", async (
            HttpContext http,
            ReportRepository reportRepo,
            int days = 60,
            decimal minStock = 1,
            string? search = null,
            int limit = 100,
            bool neverSoldOnly = false) =>
        {
            if (ApiScope.Enforce(http, "inventory:read") is { } denied) return denied;
            return Results.Ok(await reportRepo.SlowMoversAsync(
                Math.Clamp(days, 1, 730), Math.Max(0, minStock), search, Math.Clamp(limit, 1, 500), default, neverSoldOnly));
        });

        // ── 4. Team, Sections & Terminals (/api/v1/team) ─────────────────────

        var team = v1.MapGroup("/team").WithTags("Network API v1 - Team");

        team.MapGet("/salesmen", async (
            HttpContext http,
            DashboardRepository dashRepo,
            ReportRepository reportRepo,
            CommissionRepository commRepo,
            DateTime? from = null,
            DateTime? to = null,
            bool activeOnly = true) =>
        {
            if (ApiScope.Enforce(http, "team:read") is { } denied) return denied;
            var start = (from ?? DateTime.Today).Date;
            var end = (to ?? start).Date;
            if (end < start) (start, end) = (end, start);

            var salesmenTask = dashRepo.SalesmenAsync(1, 500, activeOnly, !activeOnly, default);
            var salesTask = reportRepo.SalesBySalesmanAsync(start, end, default);
            var commTask = commRepo.SalesmanSummaryAsync(start, end, true, false, default);

            await Task.WhenAll(salesmenTask, salesTask, commTask);
            var salesById = salesTask.Result.ToDictionary(s => s.SalesmanId);
            var commById = commTask.Result.ToDictionary(c => c.SalesmanId);

            var items = salesmenTask.Result.Items.Select(s =>
            {
                salesById.TryGetValue(s.Id, out var sr);
                commById.TryGetValue(s.Id, out var cr);
                return new
                {
                    s.Id,
                    s.Name,
                    salesCount = sr?.Count ?? 0,
                    salesTotal = sr?.Total ?? 0m,
                    commissionTotal = cr?.TotalCommission ?? 0m,
                    commissionPaid = cr?.PaidOutTotal ?? 0m,
                    commissionRemaining = cr?.BalanceDue ?? 0m
                };
            }).ToList();

            return Results.Ok(new
            {
                from = start.ToString("yyyy-MM-dd"),
                to = end.ToString("yyyy-MM-dd"),
                total = items.Count,
                items
            });
        });

        team.MapGet("/cashiers", async (
            HttpContext http,
            CashierRepository cashierRepo,
            ReportRepository reportRepo) =>
        {
            if (ApiScope.Enforce(http, "team:read") is { } denied) return denied;
            var today = DateTime.Today;
            var listTask = cashierRepo.ListAsync(1, 500, null, default);
            var perfTask = reportRepo.CashierPerformanceAsync(today, today, default);
            await Task.WhenAll(listTask, perfTask);

            var perfById = perfTask.Result.ToDictionary(p => p.CashierId);
            var items = listTask.Result.Items.Select(c =>
            {
                perfById.TryGetValue(c.Id, out var p);
                return new
                {
                    c.Id,
                    c.Username,
                    c.Active,
                    c.SectionId,
                    c.SectionName,
                    c.PermissionsId,
                    c.PermissionsName,
                    todayReceipts = p?.ReceiptCount ?? 0,
                    todayNetSales = p?.NetSales ?? 0m,
                    todayReturns = p?.ReturnsCount ?? 0
                };
            }).ToList();

            return Results.Ok(items);
        });

        team.MapGet("/sections", async (HttpContext http, SectionRepository sectionRepo) =>
        {
            if (ApiScope.Enforce(http, "team:read") is { } denied) return denied;
            return Results.Ok(await sectionRepo.ListSummariesAsync(default));
        });

        team.MapGet("/terminals", async (HttpContext http, TerminalRepository terminalRepo) =>
        {
            if (ApiScope.Enforce(http, "team:read") is { } denied) return denied;
            return Results.Ok(await terminalRepo.MonitorGroupsAsync(default));
        });

        // ── 5. Customers, Credit Accounts & Discount QR (/api/v1/customers) ──

        var customers = v1.MapGroup("/customers").WithTags("Network API v1 - Customers");

        customers.MapGet("/accounts", async (HttpContext http, CreditAccountRepository repo, string? search = null, bool selectedOnly = true) =>
        {
            if (ApiScope.Enforce(http, "customers:read") is { } denied) return denied;
            if (selectedOnly && string.IsNullOrWhiteSpace(search))
                return Results.Ok(await repo.GetSelectedAsync(default));
            return Results.Ok(await repo.GetAdminViewAsync(search, default));
        });

        customers.MapGet("/discount-qr", async (HttpContext http, DiscountQrRepository repo, bool activeOnly = true) =>
        {
            if (ApiScope.Enforce(http, "customers:read") is { } denied) return denied;
            return Results.Ok(activeOnly ? await repo.ListActiveAsync(default) : await repo.ListAsync(default));
        });

        customers.MapGet("/discount-qr/verify", async (HttpContext http, DiscountQrRepository repo, string? code) =>
        {
            if (ApiScope.Enforce(http, "customers:read") is { } denied) return denied;
            if (string.IsNullOrWhiteSpace(code))
                return Results.BadRequest(new { error = "أرسل الرمز في ?code=" });
            var person = await repo.FindByCodeAsync(code.Trim(), default);
            return person is null
                ? Results.Ok(new { valid = false, person = (DiscountQrPersonDto?)null })
                : Results.Ok(new { valid = true, person });
        });

        // ── 6. Real-Time Events (SSE Stream + History + Custom Broadcast) ────

        var events = v1.MapGroup("/events").WithTags("Network API v1 - Realtime Events");

        events.MapGet("/recent", (NetworkEventBus bus, int limit = 50, long sinceId = 0) =>
            Results.Ok(bus.Recent(limit, sinceId)));

        events.MapGet("/stream", async (HttpContext http, NetworkEventBus bus, long sinceId = 0) =>
        {
            http.Response.Headers.ContentType = "text/event-stream; charset=utf-8";
            http.Response.Headers.CacheControl = "no-cache, no-store";
            http.Response.Headers.Connection = "keep-alive";
            http.Response.Headers["X-Accel-Buffering"] = "no";

            if (sinceId <= 0 && http.Request.Headers.TryGetValue("Last-Event-ID", out var lastHeader))
                _ = long.TryParse(lastHeader.ToString(), out sinceId);

            await http.Response.WriteAsync($"retry: 3000\n: connected to FOT POS Network Event Stream at {DateTime.UtcNow:O}\n\n", http.RequestAborted);
            await http.Response.Body.FlushAsync(http.RequestAborted);

            var (subId, reader) = bus.Subscribe(sinceId);
            try
            {
                while (!http.RequestAborted.IsCancellationRequested)
                {
                    using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
                    timeoutCts.CancelAfter(TimeSpan.FromSeconds(15));
                    try
                    {
                        var evt = await reader.ReadAsync(timeoutCts.Token);
                        var json = JsonSerializer.Serialize(evt, SseJsonOptions);
                        await http.Response.WriteAsync($"id: {evt.Id}\nevent: {evt.EventType}\ndata: {json}\n\n", http.RequestAborted);
                        await http.Response.Body.FlushAsync(http.RequestAborted);
                    }
                    catch (OperationCanceledException) when (!http.RequestAborted.IsCancellationRequested)
                    {
                        await http.Response.WriteAsync($": keepalive {DateTime.UtcNow:O}\n\n", http.RequestAborted);
                        await http.Response.Body.FlushAsync(http.RequestAborted);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                /* client disconnected */
            }
            finally
            {
                bus.Unsubscribe(subId);
            }
        });

        events.MapPost("/publish", (HttpContext http, NetworkEventBus bus, PublishNetworkEventRequest req) =>
        {
            if (ApiScope.Enforce(http, "events:publish") is { } denied) return denied;
            var type = (req.EventType ?? "").Trim();
            if (type.Length == 0)
                return Results.BadRequest(new { error = "أدخل اسم الحدث في eventType" });
            var published = bus.Publish(type, req.Data);
            return Results.Ok(published);
        });
    }

    // ── Admin Control Panel Management Endpoints (/api/platform/*) ───────────

    public static void MapApiPlatformAdminEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/platform").RequireAuthorization().WithTags("Admin - API Platform");

        g.MapGet("/overview", async (
            HttpContext http,
            ApiPlatformRepository repo,
            StoreCatalogRepository catalogRepo,
            NetworkEventBus bus) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var keysTask = repo.ListKeysAsync(default);
            var hooksTask = repo.ListWebhooksAsync(default);
            var catTask = catalogRepo.VersionAsync(default);
            await Task.WhenAll(keysTask, hooksTask, catTask);

            var ips = LanNetwork.ListIpv4Addresses();
            var baseUrls = LanNetwork.ApiUrls(ips);
            var primary = baseUrls.FirstOrDefault() ?? $"http://localhost:{LanNetwork.ApiPort}";
            var keys = keysTask.Result;
            var hooks = hooksTask.Result;

            return Results.Ok(new ApiPlatformOverviewDto(
                Environment.MachineName,
                LanNetwork.ApiPort,
                ips,
                baseUrls,
                $"{primary}/swagger",
                $"{primary}/swagger/v1/swagger.json",
                $"{primary}/api/v1/events/stream",
                $"{primary}/hubs/pos",
                catTask.Result.Revision,
                keys.Count(k => k.IsActive),
                keys.Sum(k => k.RequestCount),
                hooks.Count(w => w.IsActive),
                ApiPlatformRepository.AllScopes,
                EndpointCatalog,
                bus.Recent(25)));
        });

        g.MapGet("/keys", async (HttpContext http, ApiPlatformRepository repo) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(await repo.ListKeysAsync(default)));

        g.MapPost("/keys", async (HttpContext http, ApiPlatformRepository repo, CreateApiKeyRequest req) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            try
            {
                return Results.Ok(await repo.CreateKeyAsync(req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        g.MapPatch("/keys/{id:long}", async (HttpContext http, ApiPlatformRepository repo, long id, UpdateApiKeyRequest req) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var updated = await repo.UpdateKeyAsync(id, req, default);
            return updated is null ? Results.NotFound() : Results.Ok(updated);
        });

        g.MapDelete("/keys/{id:long}", async (HttpContext http, ApiPlatformRepository repo, long id) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            return await repo.DeleteKeyAsync(id, default) ? Results.NoContent() : Results.NotFound();
        });

        g.MapGet("/webhooks", async (HttpContext http, ApiPlatformRepository repo) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(await repo.ListWebhooksAsync(default)));

        g.MapPost("/webhooks", async (HttpContext http, ApiPlatformRepository repo, CreateApiWebhookRequest req) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            try
            {
                return Results.Ok(await repo.CreateWebhookAsync(req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        g.MapPatch("/webhooks/{id:long}", async (HttpContext http, ApiPlatformRepository repo, long id, UpdateApiWebhookRequest req) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            try
            {
                var updated = await repo.UpdateWebhookAsync(id, req, default);
                return updated is null ? Results.NotFound() : Results.Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        g.MapDelete("/webhooks/{id:long}", async (HttpContext http, ApiPlatformRepository repo, long id) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            return await repo.DeleteWebhookAsync(id, default) ? Results.NoContent() : Results.NotFound();
        });

        g.MapPost("/webhooks/{id:long}/test", async (HttpContext http, ApiPlatformRepository repo, NetworkEventBus bus, long id) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var target = await repo.GetWebhookTargetByIdAsync(id, default);
            if (target is null) return Results.NotFound(new { error = "الويب هوك غير موجود" });
            var sampleEvt = new NetworkEventDto(
                DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                "webhook.test",
                DateTime.UtcNow,
                new { server = Environment.MachineName, webhookName = target.Name, message = "اختبار اتصال مباشر من FOT POS API" });
            var result = await bus.SendSingleWebhookAsync(target, sampleEvt, default);
            return Results.Ok(result);
        });
    }

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin")
        || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}
