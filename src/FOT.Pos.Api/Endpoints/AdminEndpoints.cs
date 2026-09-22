using FOT.Pos.Api.Auth;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.Endpoints;

public static class AdminEndpoints
{
    /// <summary>
    /// An offer change alters the price terminals have cached for every product it covers, so the
    /// affected articles go back on the delta feed and the broadcast uses the products scope —
    /// the offers scope only refreshes reference data and would leave the old prices in place.
    /// </summary>
    private static async Task NotifyAttributionChangedAsync(
        ProductAttributionRepository attr, IHubContext<PosHub> hub)
    {
        attr.InvalidateArticlesCache();
        await PosHubEvents.NotifyCatalogUpdated(hub);
    }

    private static async Task NotifyOfferPricesChangedAsync(
        OfferRepository repo, IHubContext<PosHub> hub, long offerId)
    {
        if (offerId > 0) await repo.TouchOfferArticlesAsync(offerId, default);
        await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
    }

    public static void MapAdminEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/dashboard/stats", async (DashboardRepository repo) => await repo.GetStatsAsync(default));
        api.MapGet("/dashboard/recent-receipts", async (DashboardRepository repo, int limit = 10) =>
            await repo.RecentReceiptsAsync(limit, default));
        api.MapGet("/dashboard/terminals", async (DashboardRepository repo) => await repo.TerminalsAsync(default));

        api.MapGet("/offers", async (OfferRepository repo, int page = 1, int pageSize = 50) =>
            await repo.ListAsync(page, pageSize, default));
        api.MapGet("/offers/stats", async (OfferRepository repo) =>
            await repo.GetStatsAsync(default));
        api.MapGet("/offers/lookup", async (ProductRepository products, OfferRepository offers, string q, int limit = 20) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                return Results.Ok(Array.Empty<ProductOfferLookupDto>());
            var found = await products.SearchLocalAsync(q.Trim(), Math.Clamp(limit, 1, 40), default);
            var memberships = await offers.GetMembershipsByItemIdsAsync(found.Select(p => p.Seq).ToList(), default);
            return Results.Ok(found.Select(p =>
            {
                var list = memberships.GetValueOrDefault(p.Seq) ?? [];
                var winningName = p.OfferName;
                var marked = list.Select(m => m with
                {
                    IsWinning = winningName != null && m.Enabled && !m.Excluded &&
                                string.Equals(m.OfferName, winningName, StringComparison.Ordinal),
                }).ToList();
                if (marked.Count(m => m.IsWinning) > 1)
                {
                    var winId = marked.Where(m => m.IsWinning)
                        .OrderByDescending(m => m.Priority)
                        .ThenBy(m => m.OfferId)
                        .First().OfferId;
                    marked = marked.Select(m => m with { IsWinning = m.OfferId == winId }).ToList();
                }
                return new ProductOfferLookupDto(
                    p.Id, p.Seq, p.Name, p.Barcode, p.Num,
                    p.OriginalPrice, p.Price, p.DiscountPercent, p.OfferName, marked);
            }).ToList());
        });
        api.MapGet("/offers/memberships", async (OfferRepository offers, string? ids) =>
        {
            var itemIds = (ids ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => long.TryParse(s, out var n) ? n : 0)
                .Where(n => n > 0)
                .Distinct()
                .Take(200)
                .ToList();
            var map = await offers.GetMembershipsByItemIdsAsync(itemIds, default);
            return Results.Ok(itemIds.Select(id => new ProductOfferMembershipsDto(
                id, map.GetValueOrDefault(id) ?? [])).ToList());
        });
        api.MapGet("/offers/{id:long}/details", async (OfferRepository repo, long id, int? role) =>
            await repo.GetDetailsAsync(id, role, default));
        api.MapGet("/offers/{id:long}/scope", async (OfferRepository repo, long id) =>
            await repo.GetScopeAsync(id, default));
        api.MapGet("/articles/tree", async (ArticleTreeRepository repo, long? parent, string? search, int limit = 200) =>
            Results.Ok(await repo.GetNodesAsync(parent, search, limit, default)));
        api.MapGet("/articles/tree/{seq:long}/product-count", async (ArticleTreeRepository repo, long seq) =>
            Results.Ok(new { count = await repo.CountDescendantProductsAsync(seq, default) }));
        api.MapGet("/articles/tree/{seq:long}/products", async (ArticleTreeRepository repo, long seq) =>
            Results.Ok(await repo.ListDescendantProductsAsync(seq, default)));
        api.MapGet("/articles/tree/{seq:long}/path", async (ArticleTreeRepository repo, long seq) =>
            Results.Ok(await repo.GetAncestorPathAsync(seq, default)));
        api.MapPost("/offers", async (OfferRepository repo, CreateOfferRequest req, IHubContext<PosHub> hub) =>
        {
            var id = await repo.CreateAsync(req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Offers);
            return Results.Ok(new { id });
        });
        api.MapPatch("/offers/{id:long}/enabled", async (OfferRepository repo, long id, bool enabled, IHubContext<PosHub> hub) =>
        {
            await repo.SetEnabledAsync(id, enabled, default);
            await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.NoContent();
        });
        api.MapPatch("/offers/{id:long}", async (OfferRepository repo, long id, UpdateOfferRequest req, IHubContext<PosHub> hub) =>
        {
            if (!await repo.UpdateAsync(id, req, default)) return Results.NotFound();
            await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.NoContent();
        });
        api.MapPost("/offers/{id:long}/details", async (OfferRepository repo, long id, UpsertOfferDetailRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var detailId = await repo.AddDetailAsync(id, req, default);
                await NotifyOfferPricesChangedAsync(repo, hub, id);
                return Results.Ok(new { id = detailId });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { message = ex.Message });
            }
        });
        api.MapDelete("/offers/details/{detailId:long}", async (OfferRepository repo, long detailId, IHubContext<PosHub> hub) =>
        {
            // Read the offer before the row is gone — the article still needs a price refresh.
            var offerId = await repo.GetDetailOfferIdAsync(detailId, default) ?? 0;
            await repo.DeleteDetailAsync(detailId, default);
            await NotifyOfferPricesChangedAsync(repo, hub, offerId);
            return Results.NoContent();
        });
        api.MapPatch("/offers/details/{detailId:long}", async (OfferRepository repo, long detailId, UpdateOfferDetailRequest req, IHubContext<PosHub> hub) =>
        {
            if (!await repo.UpdateDetailAsync(detailId, req, default))
                return Results.NotFound();
            var offerId = await repo.GetDetailOfferIdAsync(detailId, default) ?? 0;
            await NotifyOfferPricesChangedAsync(repo, hub, offerId);
            return Results.NoContent();
        });
        api.MapPatch("/offers/{id:long}/tree/{treeSeq:long}/discount", async (OfferRepository repo, long id, long treeSeq, UpdateOfferTreeDiscountRequest req, IHubContext<PosHub> hub) =>
        {
            var updated = await repo.UpdateTreeDiscountAsync(id, treeSeq, req, default);
            if (updated == 0) return Results.NotFound();
            await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.Ok(new { updated });
        });
        api.MapPatch("/offers/{id:long}/discount-all", async (OfferRepository repo, long id, decimal percent, IHubContext<PosHub> hub, int detailRole = 0) =>
        {
            var updated = await repo.UpdateAllDiscountAsync(id, percent, detailRole, default);
            if (updated == 0) return Results.NotFound();
            await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.Ok(new { updated });
        });
        api.MapPost("/offers/{id:long}/details/tree", async (OfferRepository repo, long id, AddOfferTreeRequest req, IHubContext<PosHub> hub) =>
        {
            var result = await repo.AddTreeAsync(id, req, default);
            await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.Ok(result);
        });
        api.MapPost("/offers/{id:long}/details/bulk", async (OfferRepository repo, long id, AddOfferBulkRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var count = await repo.AddBulkAsync(id, req, default);
                await NotifyOfferPricesChangedAsync(repo, hub, id);
                return Results.Ok(new { added = count });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { message = ex.Message });
            }
        });
        api.MapDelete("/offers/{id:long}/tree/{treeSeq:long}", async (OfferRepository repo, long id, long treeSeq, IHubContext<PosHub> hub) =>
        {
            // Refresh prices while the rows still name the products, then remove them.
            await repo.TouchOfferArticlesAsync(id, default);
            var count = await repo.DeleteTreeBatchAsync(id, treeSeq, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.Ok(new { removed = count });
        });
        api.MapDelete("/offers/{id:long}", async (OfferRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            await repo.TouchOfferArticlesAsync(id, default);
            await repo.DeleteAsync(id, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.NoContent();
        });

        // ── Dynamic tree membership (offers) ──────────────────────────────────
        api.MapGet("/offers/{id:long}/trees/{treeSeq:long}/products", async (OfferRepository repo, long id, long treeSeq) =>
            await repo.GetOfferTreeProductsAsync(id, treeSeq, default));
        api.MapGet("/offers/{id:long}/trees/{treeSeq:long}/state", async (OfferRepository repo, long id, long treeSeq) =>
            await repo.GetTreeStateAsync(id, treeSeq, default) is { } s
                ? Results.Ok(s)
                : Results.NotFound(new { message = "لا توجد دفعة شجرة بهذا الرقم في العرض" }));
        api.MapPost("/offers/{id:long}/trees/{treeSeq:long}/refresh", async (
            OfferRepository repo, FOT.Pos.Infrastructure.Services.TreeMembershipRefresher refresher,
            long id, long treeSeq, IHubContext<PosHub> hub) =>
        {
            var (current, added) = await refresher.RefreshOfferTreeAsync(id, treeSeq, default);
            if (added > 0) await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.Ok(new { currentCount = current, added, message = added > 0 ? $"انضم {added} صنف جديد من الشجرة إلى العرض" : "عضوية الشجرة محدّثة — لا جديد" });
        });
        api.MapPost("/offers/details/{detailId:long}/excluded", async (
            OfferRepository repo, long detailId, bool excluded, IHubContext<PosHub> hub) =>
        {
            var ok = await repo.SetDetailExcludedAsync(detailId, excluded, default);
            if (ok)
            {
                var offerId = await repo.GetDetailOfferIdAsync(detailId, default) ?? 0;
                await NotifyOfferPricesChangedAsync(repo, hub, offerId);
            }
            return ok ? Results.NoContent() : Results.NotFound();
        });
        api.MapPost("/offers/{id:long}/articles/{itemId:long}/excluded", async (
            OfferRepository repo, long id, long itemId, bool excluded, IHubContext<PosHub> hub) =>
        {
            await repo.SetArticleExcludedAsync(id, itemId, excluded, default);
            await NotifyOfferPricesChangedAsync(repo, hub, id);
            return Results.NoContent();
        });

        api.MapGet("/terminals/monitor", async (TerminalRepository repo) =>
            await repo.MonitorGroupsAsync(default));
        api.MapGet("/activity/cashier", async (PosLogRepository repo, DateTime? from, DateTime? to,
            long? cashierId = null, string? search = null, int limit = 200) =>
            await repo.ListAsync(from ?? DateTime.Today, to ?? DateTime.Today, cashierId, search, limit, default));

        api.MapPost("/terminals/register", async (TerminalRepository repo, RegisterTerminalRequest req) =>
            Results.Ok(new { id = await repo.RegisterAsync(req, default) }));
        api.MapPost("/terminals/{id:long}/heartbeat", async (
            TerminalRepository repo, CatalogVersionRepository versions, long id, TerminalHeartbeatRequest req) =>
        {
            await repo.HeartbeatAsync(id, req.ExeVersion, req.PendingOffline, req.DeadOffline, req.DeferredOffline, default);
            if (req.CatalogVersion is { } v)
                await versions.TouchTerminalVersionAsync(id, v, default);
            return Results.NoContent();
        });

        api.MapGet("/permissions", async (PermissionsRepository repo) => await repo.ListAsync(default));
        api.MapGet("/permissions/{id:long}", async (PermissionsRepository repo, long id) =>
            await repo.GetByIdAsync(id, default) is { } p ? Results.Ok(p) : Results.NotFound());
        api.MapPut("/permissions/{id:long}", async (PermissionsRepository repo, long id, UpdatePermissionsRequest req, IHubContext<PosHub> hub) =>
        {
            await repo.UpdateAsync(id, req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });

        api.MapGet("/commissions/rules", async (CommissionRepository repo) => await repo.ListRulesAsync(default));
        api.MapGet("/commissions/rules/{id:long}", async (CommissionRepository repo, long id) =>
        {
            var rule = await repo.GetRuleAsync(id, default);
            return rule is null ? Results.NotFound() : Results.Ok(rule);
        });
        api.MapPost("/commissions/rules", async (CommissionRepository repo, ProductAttributionRepository attr, CreateCommissionRuleRequest req, IHubContext<PosHub> hub) =>
        {
            var id = await repo.CreateAsync(req, default);
            await NotifyAttributionChangedAsync(attr, hub);
            return Results.Ok(new { id });
        });
        api.MapPut("/commissions/rules/{id:long}", async (CommissionRepository repo, long id, UpdateCommissionRuleRequest req, IHubContext<PosHub> hub) =>
        {
            if (!await repo.UpdateAsync(id, req, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapDelete("/commissions/rules/{id:long}", async (CommissionRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            if (!await repo.DeleteAsync(id, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapPatch("/commissions/rules/{id:long}/active", async (CommissionRepository repo, long id, bool active, IHubContext<PosHub> hub) =>
        {
            await repo.SetActiveAsync(id, active, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapGet("/commissions/calculations", async (CommissionRepository repo, DateTime? from, DateTime? to, long? salesmanId, int limit = 100) =>
            await repo.ListCalculationsAsync(from, to, salesmanId, limit, default));
        api.MapGet("/commissions/summary", async (CommissionRepository repo, DateTime? from, DateTime? to, bool activeOnly = false, bool includeAll = false) =>
            await repo.SalesmanSummaryAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, activeOnly, includeAll, default));
        api.MapGet("/commissions/reports/daily", async (CommissionRepository repo, DateTime? from, DateTime? to, long? salesmanId) =>
            await repo.DailyReportAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, salesmanId, default));
        api.MapGet("/commissions/reports/groups", async (CommissionRepository repo, DateTime? from, DateTime? to, long? salesmanId) =>
            await repo.GroupReportAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, salesmanId, default));
        api.MapGet("/commissions/reports/products", async (CommissionRepository repo, DateTime? from, DateTime? to, long? salesmanId, int limit = 100) =>
            await repo.ProductReportAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, salesmanId, limit, default));
        api.MapGet("/commissions/reports/receipts", async (CommissionRepository repo, DateTime? from, DateTime? to, long? salesmanId, int limit = 200) =>
            await repo.ReceiptReportAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, salesmanId, limit, default));
        api.MapGet("/commissions/health", async (CommissionRepository repo, DateTime? from, DateTime? to) =>
            await repo.GetHealthAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, default));
        api.MapGet("/commissions/diagnose/{receiptId:long}", async (SalePostProcessor post, long receiptId) =>
        {
            var dto = await post.DiagnoseReceiptAsync(receiptId, default);
            return dto is null ? Results.NotFound() : Results.Ok(dto);
        });
        api.MapPost("/commissions/recalculate", async (SalePostProcessor post, RecalculateCommissionsRequest? req) =>
            Results.Ok(await post.RecalculateAsync(req ?? new RecalculateCommissionsRequest(), default)));
        api.MapPost("/commissions/preview", async (SalePostProcessor post, CommissionPreviewRequest req) =>
            Results.Ok(await post.PreviewAsync(req, default)));
        api.MapGet("/commissions/payouts", async (CommissionRepository repo, DateTime? from, DateTime? to, long? salesmanId, int limit = 200) =>
            await repo.ListPayoutsAsync(from, to, salesmanId, limit, default));
        api.MapPost("/commissions/payouts/{salesmanId:long}", async (CommissionRepository repo, long salesmanId, RecordCommissionPayoutRequest req) =>
        {
            try
            {
                return Results.Ok(await repo.RecordPayoutAsync(salesmanId, req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { message = ex.Message });
            }
        });
        api.MapPost("/commissions/payouts/{payoutId:long}/void", async (CommissionRepository repo, long payoutId) =>
            await repo.VoidPayoutAsync(payoutId, default) ? Results.NoContent() : Results.NotFound());
        api.MapGet("/commissions/profiles", async (CommissionRepository repo) => await repo.ListProfilesAsync(default));
        api.MapPut("/commissions/profiles/{salesmanId:long}", async (CommissionRepository repo, long salesmanId, UpdateSalesmanCommissionProfileRequest req, IHubContext<PosHub> hub) =>
        {
            await repo.UpsertProfileAsync(salesmanId, req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });

        api.MapGet("/commissions/lookup", async (CommissionGroupRepository repo, string q, int limit = 20) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
                return Results.Ok(Array.Empty<ProductCommissionLookupDto>());
            return Results.Ok(await repo.LookupAsync(q.Trim(), limit, default));
        });
        api.MapGet("/commissions/memberships", async (CommissionGroupRepository repo, string? ids) =>
        {
            var itemIds = (ids ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => long.TryParse(s, out var n) ? n : 0)
                .Where(n => n > 0)
                .Distinct()
                .Take(200)
                .ToList();
            var map = await repo.GetMembershipsByArticleIdsAsync(itemIds, default);
            return Results.Ok(itemIds.Select(id => new ProductCommissionMembershipsDto(
                id, map.GetValueOrDefault(id) ?? [])).ToList());
        });
        api.MapGet("/commissions/groups/overlaps", async (CommissionGroupRepository repo) =>
            Results.Ok(await repo.ListOverlapsAsync(default)));
        api.MapGet("/commissions/groups", async (CommissionGroupRepository repo) => await repo.ListAsync(default));
        api.MapGet("/commissions/groups/{id:long}", async (CommissionGroupRepository repo, long id) =>
        {
            var g = await repo.GetDetailAsync(id, default);
            return g is null ? Results.NotFound() : Results.Ok(g);
        });
        api.MapPost("/commissions/groups", async (CommissionGroupRepository repo, CreateCommissionGroupRequest req, IHubContext<PosHub> hub) =>
        {
            var id = await repo.CreateAsync(req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(new { id });
        });
        api.MapPut("/commissions/groups/{id:long}", async (CommissionGroupRepository repo, long id, UpdateCommissionGroupRequest req, IHubContext<PosHub> hub) =>
        {
            if (!await repo.UpdateAsync(id, req, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapDelete("/commissions/groups/{id:long}", async (CommissionGroupRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            if (!await repo.DeleteAsync(id, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapPatch("/commissions/groups/{id:long}/active", async (CommissionGroupRepository repo, long id, bool active, IHubContext<PosHub> hub) =>
        {
            await repo.SetActiveAsync(id, active, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapPost("/commissions/groups/{id:long}/trees", async (CommissionGroupRepository repo, ProductAttributionRepository attr, long id, AddCommissionGroupTreeRequest req, IHubContext<PosHub> hub) =>
        {
            var result = await repo.AddTreeAsync(id, req, default);
            await NotifyAttributionChangedAsync(attr, hub);
            return Results.Ok(result);
        });
        api.MapPost("/commissions/groups/{id:long}/trees/partial", async (CommissionGroupRepository repo, ProductAttributionRepository attr, long id, AddCommissionGroupPartialTreeRequest req, IHubContext<PosHub> hub) =>
        {
            var result = await repo.AddPartialTreeAsync(id, req, default);
            await NotifyAttributionChangedAsync(attr, hub);
            return Results.Ok(result);
        });
        api.MapDelete("/commissions/groups/{id:long}/trees/{treeSeq:long}", async (CommissionGroupRepository repo, long id, long treeSeq, IHubContext<PosHub> hub) =>
        {
            var deleted = await repo.DeleteTreeAsync(id, treeSeq, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(new { deleted });
        });
        api.MapPost("/commissions/groups/{id:long}/products", async (CommissionGroupRepository repo, ProductAttributionRepository attr, long id, AddCommissionGroupProductRequest req, IHubContext<PosHub> hub) =>
        {
            var item = await repo.AddProductAsync(id, req, default);
            if (item is null) return Results.BadRequest(new { message = "المنتج غير موجود" });
            await NotifyAttributionChangedAsync(attr, hub);
            return Results.Ok(item);
        });
        api.MapDelete("/commissions/groups/{id:long}/items/{itemId:long}", async (CommissionGroupRepository repo, long id, long itemId, IHubContext<PosHub> hub) =>
        {
            if (!await repo.DeleteItemAsync(id, itemId, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapPost("/commissions/groups/move-items", async (CommissionGroupRepository repo, MoveCommissionGroupItemsRequest req, IHubContext<PosHub> hub) =>
        {
            var moved = await repo.MoveItemsAsync(req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(new { moved });
        });
        api.MapPost("/commissions/groups/move-tree", async (CommissionGroupRepository repo, MoveCommissionGroupTreeRequest req, IHubContext<PosHub> hub) =>
        {
            var moved = await repo.MoveTreeAsync(req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(new { moved });
        });
        api.MapGet("/commissions/groups/{id:long}/trees/{treeSeq:long}/products", async (CommissionGroupRepository repo, long id, long treeSeq) =>
            Results.Ok(await repo.ListTreeProductsAsync(id, treeSeq, default)));

        // ── Dynamic tree membership (commission groups) ───────────────────────
        api.MapPost("/commissions/groups/{id:long}/trees/{treeSeq:long}/refresh", async (
            CommissionGroupRepository repo,
            FOT.Pos.Infrastructure.Services.TreeMembershipRefresher refresher,
            long id, long treeSeq, IHubContext<PosHub> hub) =>
        {
            var (current, added) = await refresher.RefreshGroupTreeAsync(id, treeSeq, default);
            if (added > 0) await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(new { currentCount = current, added, message = added > 0 ? $"انضم {added} صنف جديد من الشجرة إلى المجموعة" : "عضوية الشجرة محدّثة — لا جديد" });
        });
        api.MapPost("/commissions/groups/items/{itemId:long}/excluded", async (
            CommissionGroupRepository repo, long itemId, bool excluded, IHubContext<PosHub> hub) =>
        {
            var ok = await repo.SetItemExcludedAsync(itemId, excluded, default);
            if (ok) await PosHubEvents.NotifyCatalogUpdated(hub);
            return ok ? Results.NoContent() : Results.NotFound();
        });
        api.MapPost("/commissions/groups/{id:long}/articles/{articleId:long}/excluded", async (
            CommissionGroupRepository repo, long id, long articleId, bool excluded, IHubContext<PosHub> hub) =>
        {
            await repo.SetArticleExcludedAsync(id, articleId, excluded, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });

        api.MapPost("/targets/rules", async (TargetRepository repo, ProductAttributionRepository attr, CreateTargetRuleRequest req, IHubContext<PosHub> hub) =>
        {
            var id = await repo.CreateAsync(req, default);
            await NotifyAttributionChangedAsync(attr, hub);
            return Results.Ok(new { id });
        });
        api.MapPut("/targets/rules/{id:long}", async (TargetRepository repo, ProductAttributionRepository attr, long id, UpdateTargetRuleRequest req, IHubContext<PosHub> hub) =>
        {
            await repo.UpdateAsync(id, req, default);
            await NotifyAttributionChangedAsync(attr, hub);
            return Results.NoContent();
        });
        api.MapDelete("/targets/rules/{id:long}", async (TargetRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            await repo.DeleteAsync(id, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapPatch("/targets/rules/{id:long}/active", async (TargetRepository repo, long id, bool active, IHubContext<PosHub> hub) =>
        {
            await repo.SetActiveAsync(id, active, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });
        api.MapPost("/targets/rules/{id:long}/articles/{articleId:long}/excluded", async (
            TargetRepository repo, long id, long articleId, bool excluded, IHubContext<PosHub> hub) =>
        {
            await repo.SetArticleExcludedAsync(id, articleId, excluded, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });

        api.MapGet("/reports/daily-sales", async (ReportRepository repo, DateTime? from, DateTime? to) =>
            await repo.DailySalesAsync(from ?? DateTime.Today.AddDays(-30), to ?? DateTime.Today, default));
        api.MapGet("/reports/sales-by-salesman", async (ReportRepository repo, DateTime? from, DateTime? to) =>
            await repo.SalesBySalesmanAsync(from ?? DateTime.Today, to ?? DateTime.Today, default));
        api.MapGet("/reports/movement", async (ReportRepository repo, DateTime? from, DateTime? to, string? search) =>
            await repo.ArticleMovementAsync(from ?? DateTime.Today, to ?? DateTime.Today, search, default));
        api.MapGet("/reports/cash", async (ReportRepository repo, DateTime? from, DateTime? to) =>
            await repo.CashReportAsync(from ?? DateTime.Today, to ?? DateTime.Today, default));
        api.MapGet("/reports/weekly-settlement", async (WeeklySettlementRepository repo, DateTime? weekStart) =>
            await repo.GetReportAsync(weekStart, default));
        api.MapPost("/reports/product-inquiry", async (ProductInquiryRepository repo, ProductInquiryRequest req) =>
        {
            try
            {
                return Results.Ok(await repo.QueryAsync(req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message, message = ex.Message });
            }
        });
        api.MapPut("/reports/weekly-settlement/settings", async (WeeklySettlementRepository repo, UpdateWeeklySettlementSettingsRequest req) =>
        {
            try
            {
                return Results.Ok(await repo.SaveSettingsAsync(req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { message = ex.Message });
            }
        });
        api.MapPut("/reports/weekly-settlement/row", async (WeeklySettlementRepository repo, UpdateWeeklySettlementRowRequest req) =>
        {
            try
            {
                return Results.Ok(await repo.SaveRowAsync(req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { message = ex.Message });
            }
        });

        api.MapGet("/edari/status", async (EdariSyncRepository repo, EdariSettingsRepository settings, EdariSyncGate gate) =>
        {
            var status = await repo.GetStatusAsync(default);
            var live = await settings.GetLiveLinkAsync(default);
            var watching = gate.IsWatching;
            return status with
            {
                LastDataPullAt = live.LastDataPullAt,
                LastHeartbeatAt = live.LastHeartbeatAt,
                LastChangeDetectedAt = live.LastChangeDetectedAt,
                LiveWatching = watching,
                AutoSyncEnabled = live.Enabled && live.AutoSyncEnabled,
                LiveMessage = BuildEdariLiveMessage(status, live, watching),
                CircuitOpen = gate.CircuitOpen,
                CircuitRetryInSeconds = (int)Math.Ceiling(gate.CircuitRetryIn.TotalSeconds)
            };
        });
        api.MapGet("/edari/dead-letters", async (EdariSyncRepository repo, int limit = 100) =>
            await repo.GetDeadLettersAsync(limit, default));
        api.MapPost("/edari/sync/receipts/{id:long}/retry", async (long id, EdariSyncRepository repo) =>
        {
            var ok = await repo.RetryDeadLetterAsync(id, default);
            return ok
                ? Results.Ok(new { message = "أُعيدت الفاتورة إلى طابور الترحيل" })
                : Results.NotFound(new { message = "لا توجد فاتورة متوقفة بهذا الرقم" });
        });
        api.MapPost("/edari/sync/receipts/retry-all", async (EdariSyncRepository repo) =>
        {
            var count = await repo.RetryAllDeadLettersAsync(default);
            return Results.Ok(new { message = $"أُعيدت {count:N0} فاتورة إلى طابور الترحيل", count });
        });
        api.MapGet("/edari/unsynced", async (EdariSyncRepository repo, int limit = 50) =>
            await repo.UnsyncedReceiptsAsync(limit, default));
        api.MapGet("/edari/logs", async (EdariSyncRepository repo, int limit = 100) =>
            await repo.RecentLogsAsync(limit, default));
        api.MapGet("/edari/settings", async (EdariSettingsService svc, EdariSyncGate gate) =>
        {
            var dto = await svc.GetDtoAsync(default);
            return dto with { LiveWatching = gate.IsWatching };
        });
        api.MapPut("/edari/settings", async (EdariSettingsService svc, UpdateEdariSettingsRequest req) =>
        {
            await svc.SaveAsync(req, default);
            return Results.Ok(await svc.GetDtoAsync(default));
        });
        api.MapGet("/edari/years", async (EdariSettingsService svc) =>
        {
            var dto = await svc.GetDtoAsync(default);
            return Results.Ok(EdariSettingsRepository.DiscoverYears(dto.DataRoot));
        });
        api.MapPost("/edari/test-connection", async (EdariNexusClient nexus, EdariSettingsRepository repo) =>
        {
            var result = await nexus.TestConnectionAsync(default);
            await repo.UpdateConnectionTestAsync(result.Ok, result.Message, default);
            return Results.Ok(result);
        });
        api.MapPost("/edari/sync/receipts", async (EdariReceiptSyncService sync, IEdariRealtimeNotifier n, int batchSize = 50, bool syncAll = false) =>
        {
            var result = syncAll
                ? await sync.SyncAllAsync(batchSize, default)
                : await sync.SyncBatchAsync(batchSize, default);
            await n.NotifyEdariAsync(result.Message, false, default);
            return Results.Ok(result);
        });
        api.MapPost("/edari/sync/receipts/reset", async (EdariReceiptSyncService sync, DateTime? from, DateTime? to, long? sectionId) =>
        {
            var count = await sync.ResetReceiptsForResyncAsync(from, to, sectionId, default);
            return Results.Ok(new { resetCount = count, message = count > 0 ? $"تم تجهيز {count} فاتورة لإعادة الترحيل" : "لا توجد فواتير مطابقة" });
        });
        api.MapPost("/edari/sync/catalog", async (EdariCatalogSyncService catalog, IHubContext<PosHub> hub) =>
        {
            var count = await catalog.ImportOffersAsync(default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Offers);
            return Results.Ok(new EdariSyncRunResult(true, $"تم استيراد {count} عرض (يدوي — العروض الافتراضية من FOT POS V2 فقط)", 0, 0, count, DateTime.UtcNow));
        });
        api.MapPost("/edari/purge-legacy-offers", async (EdariLegacyOfferCleanupService cleanup) =>
            Results.Ok(await cleanup.PurgeImportedOffersAsync(default)));
        api.MapPost("/edari/sync/salesmen", async (EdariSalesmenSyncService sync, IEdariRealtimeNotifier n) =>
        {
            var r = await sync.SyncAsync(default);
            if (r.Success) await n.NotifyEdariAsync(r.Message, r.Added + r.Updated > 0);
            return Results.Ok(r);
        });
        api.MapPost("/edari/sync/articles", async (EdariArticlesSyncService sync, IEdariRealtimeNotifier n) =>
        {
            var r = await sync.SyncAsync(default);
            if (r.Success) await n.NotifyEdariAsync(r.Message, r.Added + r.Updated + r.Deleted > 0);
            return Results.Ok(r);
        });
        api.MapPost("/edari/sync/branches", async (EdariBranchesSyncService sync, IEdariRealtimeNotifier n) =>
        {
            var r = await sync.SyncAsync(default);
            if (r.Success) await n.NotifyEdariAsync(r.Message, r.SectionsCreated > 0);
            return Results.Ok(r);
        });
        api.MapPost("/edari/sync/accounts", async (
            EdariAccountsSyncService sync, IHubContext<PosHub> hub, IEdariRealtimeNotifier n) =>
        {
            var r = await sync.SyncAsync(default);
            if (r.Success)
            {
                // Cash box pickers in the control panel read the mirror we just refreshed.
                await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Accounts);
                await n.NotifyEdariAsync(r.Message, r.Added + r.Removed > 0);
            }
            return Results.Ok(r);
        });
        api.MapPost("/edari/sync/arabic-names", async (EdariArabicNamesBackfillService backfill) =>
            Results.Ok(await backfill.BackfillAsync(default)));
        api.MapGet("/edari/branches", async (EdariNexusClient nexus) =>
        {
            var rows = await nexus.GetBranchesAsync(default);
            return Results.Ok(rows.Select(b => new EdariBranchDto(b.Seq, b.DisplayName, b.Symbol)).ToList());
        });
        api.MapPost("/edari/sync/pull", async (EdariDataPullService pull, bool catalog = false) =>
        {
            var r = await pull.PullAsync(catalog, default);
            return Results.Ok(new EdariDataPullResultDto(
                r.Ok, r.Message, r.SalesmenAdded, r.SalesmenUpdated, r.SalesmenTotal,
                r.OffersImported, r.ArticlesAdded, r.ArticlesUpdated, r.ArticlesTotal,
                r.SectionsCreated, r.FinishedAt, r.ArticlesDeleted));
        });
        api.MapPost("/edari/sync/full", async (EdariDataPullService pull, bool catalog = false, bool receipts = true, int receiptBatch = 50) =>
            Results.Ok(await pull.FullSyncAsync(catalog, receipts, receiptBatch, default)));
        api.MapGet("/edari/tree/materials", async (
            EdariNexusClient nexus,
            ArticleTreeRepository localTree,
            long? parent,
            string? search,
            int limit = 200) =>
        {
            if (!string.IsNullOrWhiteSpace(search) && EdariStringHelper.HasArabic(search))
            {
                var local = await localTree.GetNodesAsync(parent, search, limit, default);
                return Results.Ok(local.Select(n => new EdariTreeNodeDto(
                    n.Seq, n.Father, n.Name, n.Num, n.Barcode, n.IsFolder, n.HasChildren, n.Price)).ToList());
            }

            return Results.Ok(await nexus.GetMaterialTreeAsync(parent, search, limit, default));
        });
        api.MapGet("/edari/tree/{seq:long}/product-count", async (EdariNexusClient nexus, long seq) =>
            Results.Ok(new { count = await nexus.CountDescendantProductsAsync(seq, default) }));

        api.MapGet("/pos/product-attribution", async (
            HttpContext http, ProductAttributionRepository repo, CashierRepository cashiers,
            long articleId, string? barcode) =>
        {
            var dto = await repo.GetAsync(articleId, barcode, default);
            if (CashierHttp.Id(http) is not long cashierId) return Results.Ok(dto);
            var flags = await cashiers.GetFeatureFlagsAsync(cashierId, default);
            var hasCommission = flags.ApplyCommissions && dto.HasCommission;
            var hasTarget = flags.ApplyTargets && dto.HasTarget;
            var requires = hasCommission || hasTarget;
            return Results.Ok(new ProductAttributionDto(requires, hasCommission, hasTarget, dto.Reason));
        });
        api.MapGet("/pos/allowed-salesmen", async (
            HttpContext http, ProductAttributionRepository repo, CashierRepository cashiers,
            long articleId, string? barcode) =>
        {
            var dto = await repo.GetAllowedSalesmenAsync(articleId, barcode, default);
            if (CashierHttp.Id(http) is not long cashierId) return Results.Ok(dto);
            var cashierList = await cashiers.GetAllowedSalesmenAsync(cashierId, default);
            if (cashierList.Count == 0) return Results.Ok(dto);
            if (!dto.Restricted)
                return Results.Ok(new ProductAllowedSalesmenDto(true, cashierList));
            var set = cashierList.Select(s => s.Id).ToHashSet();
            return Results.Ok(new ProductAllowedSalesmenDto(true, dto.Items.Where(s => set.Contains(s.Id)).ToList()));
        });
        api.MapGet("/pos/attribution-articles", async (
            HttpContext http, ProductAttributionRepository repo, CashierRepository cashiers) =>
        {
            if (CashierHttp.Id(http) is long cashierId)
            {
                var flags = await cashiers.GetFeatureFlagsAsync(cashierId, default);
                if (!flags.ApplyCommissions && !flags.ApplyTargets)
                    return Results.Ok(Array.Empty<long>());
            }
            return Results.Ok(await repo.GetArticlesRequiringSalesmanAsync(default));
        });

        api.MapGet("/sections", async (SectionRepository repo, bool summary = true) =>
            summary
                ? Results.Ok(await repo.ListSummariesAsync(default))
                : Results.Ok(await repo.ListBasicAsync(default)));
        api.MapGet("/sections/{id:long}", async (SectionRepository repo, long id) =>
        {
            var detail = await repo.GetDetailAsync(id, default);
            return detail is null ? Results.NotFound() : Results.Ok(detail);
        });
        api.MapPost("/sections", async (SectionRepository repo, CreateSectionRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await repo.CreateAsync(req, default);
                await PosHubEvents.NotifyCatalogUpdated(hub);
                return Results.Created($"/api/sections/{result.Id}", result);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapPut("/sections/{id:long}", async (SectionRepository repo, long id, UpdateSectionRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await repo.UpdateAsync(id, req, default);
                await PosHubEvents.NotifyCatalogUpdated(hub);
                return Results.Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapDelete("/sections/{id:long}", async (SectionRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            try
            {
                await repo.DeleteAsync(id, default);
                await PosHubEvents.NotifyCatalogUpdated(hub);
                return Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        api.MapGet("/terminals", async (TerminalRepository repo) => await repo.ListDetailsAsync(default));
        api.MapGet("/terminals/{id:long}", async (TerminalRepository repo, long id) =>
        {
            var t = await repo.GetDetailAsync(id, default);
            return t is null ? Results.NotFound() : Results.Ok(t);
        });
        api.MapPatch("/terminals/{id:long}", async (TerminalRepository repo, long id, UpdateTerminalRequest req) =>
        {
            await repo.UpdateAsync(id, req, default);
            return Results.NoContent();
        });
        api.MapDelete("/terminals/{id:long}", async (TerminalRepository repo, long id) =>
        {
            await repo.DeleteAsync(id, default);
            return Results.NoContent();
        });
        api.MapGet("/terminals/{id:long}/activity", async (PosLogRepository logs, long id, int limit = 30) =>
            await logs.ListByPosAsync(id, limit, default));

        api.MapGet("/cashiers", async (CashierRepository repo, int page = 1, int pageSize = 100, string? search = null) =>
            await repo.ListAsync(page, pageSize, search, default));
        api.MapGet("/cashiers/{id:long}", async (CashierRepository repo, long id) =>
        {
            var c = await repo.GetDetailAsync(id, default);
            return c is null ? Results.NotFound() : Results.Ok(c);
        });
        api.MapPost("/cashiers", async (CashierRepository repo, CreateCashierRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var id = await repo.CreateAsync(req, default);
                await PosHubEvents.NotifyCatalogUpdated(hub);
                return Results.Created($"/api/cashiers/{id}", new { id });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapPut("/cashiers/{id:long}", async (CashierRepository repo, long id, UpdateCashierRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                await repo.UpdateAsync(id, req, default);
                await PosHubEvents.NotifyCatalogUpdated(hub);
                return Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapDelete("/cashiers/{id:long}", async (CashierRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            await repo.DeactivateAsync(id, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.NoContent();
        });

        api.MapGet("/targets/rules", async (TargetRepository repo) => await repo.ListRulesAsync(default));
        api.MapGet("/targets/rules/{id:long}", async (TargetRepository repo, long id) =>
        {
            var rule = await repo.GetRuleAsync(id, default);
            return rule is null ? Results.NotFound() : Results.Ok(rule);
        });
        api.MapGet("/targets/progress", async (TargetRepository repo) => await repo.ListProgressAsync(default));
        api.MapGet("/targets/breakdowns", async (TargetRepository repo, DateTime? periodStart, DateTime? periodEnd) =>
            await repo.ListBreakdownsAsync(periodStart, periodEnd, default));
        api.MapGet("/targets/rules/{id:long}/breakdown", async (TargetRepository repo, long id, DateTime? periodStart, DateTime? periodEnd) =>
            await repo.GetBreakdownAsync(id, periodStart, periodEnd, default));
        api.MapGet("/targets/rules/{id:long}/receipts", async (TargetRepository repo, long id, DateTime? periodStart, DateTime? periodEnd) =>
            await repo.ListReceiptsAsync(id, periodStart, periodEnd, default));

        api.MapPost("/sync/push", async (IHubContext<PosHub> hub) =>
        {
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(new { version = CatalogVersionHolder.State.Current, sentAt = DateTime.UtcNow });
        });

        api.MapGet("/accounts/credit/edari", async (CreditAccountRepository repo, string? search) =>
            Results.Ok(await repo.GetAdminViewAsync(search, default)));
        api.MapGet("/accounts/credit/selected", async (CreditAccountRepository repo) =>
            Results.Ok(await repo.GetSelectedAsync(default)));
        api.MapPut("/accounts/credit/selection", async (CreditAccountRepository repo, SavePosCreditAccountsRequest req, IHubContext<PosHub> hub) =>
        {
            await repo.SaveSelectionAsync(req.EdariSeqs, default);
            await PosHubEvents.NotifyCatalogUpdated(hub);
            return Results.Ok(await repo.GetSelectedAsync(default));
        });
        api.MapGet("/accounts/cashbox/edari", async (CashBoxAccountRepository repo, string? search) =>
            Results.Ok(await repo.SearchAsync(search, default)));

        api.MapGet("/discount-qr-people", async (DiscountQrRepository repo) =>
            Results.Ok(await repo.ListAsync(default)));
        api.MapPost("/discount-qr-people", async (DiscountQrRepository repo, CreateDiscountQrPersonRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var created = await repo.CreateAsync(req.Name, default);
                await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Settings);
                return Results.Ok(created);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapPatch("/discount-qr-people/{id:long}", async (
            DiscountQrRepository repo, long id, UpdateDiscountQrPersonRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                await repo.UpdateAsync(id, req.Name, req.Active, default);
                await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Settings);
                return Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapGet("/discount-qr-people/{id:long}/receipts", async (DiscountQrRepository repo, long id) =>
            Results.Ok(await repo.ListReceiptsAsync(id, default)));
    }

    private static string BuildEdariLiveMessage(EdariSyncStatusDto status, EdariLiveLinkDto live, bool watching)
    {
        if (!live.Enabled)
            return "تكامل الإداري معطّل";
        if (!live.AutoSyncEnabled)
            return "التحديث التلقائي متوقف — استخدم «تحديث الآن» عند الحاجة";
        if (status.ConnectionOk == false)
            return status.Message;
        var watch = watching ? "مراقبة المجلد تعمل" : "فحص دوري كل 15 ثانية";
        if (live.LastChangeDetectedAt is { } changed)
            return $"ارتباط حي — {watch} · آخر تغيير {changed.ToLocalTime():HH:mm:ss}";
        return $"ارتباط حي — {watch} · بانتظار تغيير في الإداري";
    }
}
