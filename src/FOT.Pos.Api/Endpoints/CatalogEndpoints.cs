using FOT.Pos.Api.Auth;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.Endpoints;

public static class CatalogEndpoints
{
    public static void MapCatalogEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/products", async (ProductRepository repo, int page = 1, int pageSize = 50, string? search = null, string? filter = null) =>
            await repo.ListAsync(page, pageSize, search, default, filter));

        api.MapGet("/products/{id:long}", async (ProductRepository repo, long id) =>
            await repo.GetByIdAsync(id, default) is { } p ? Results.Ok(p) : Results.NotFound());

        api.MapGet("/products/barcode/{code}", async (ProductRepository repo, string code) =>
            await repo.GetByBarcodeAsync(code, default) is { } p ? Results.Ok(p) : Results.NotFound());

        api.MapGet("/products/search", async (ProductRepository repo, string q, int limit = 20) =>
            await repo.SearchLocalAsync(q, Math.Clamp(limit, 1, 50), default));

        api.MapPatch("/products/{id:long}", async (ProductRepository repo, long id, UpdateProductRequest req, IHubContext<PosHub> hub) =>
        {
            if (!await repo.UpdateAsync(id, req, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.NoContent();
        });

        // POS-side stored product discount percent. Permission gating happens in the terminal
        // (allow_product_discount); the rowversion watermark pushes the change to every terminal.
        api.MapPut("/products/{id:long}/discount-percent", async (
            ProductRepository repo, long id, DiscountPercentRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                if (!await repo.UpdateDiscountPercentAsync(id, req.Percent, default)) return Results.NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            var updated = await repo.GetByIdAsync(id, default);
            return Results.Ok(updated);
        });

        api.MapGet("/catalog/info", async (ProductRepository repo) => await repo.GetCatalogInfoAsync(default));

        // Reconciliation list for terminals: the delta feed cannot express a deletion, so a
        // terminal whose local count disagrees with the server pulls every live id and drops
        // whatever is no longer there.
        api.MapGet("/catalog/ids", async (ProductRepository repo) =>
        {
            var ids = await repo.GetLiveProductIdsAsync(default);
            return Results.Ok(new CatalogIdsDto(ids.Count, ids));
        });

        // hwId (optional) records the terminal's watermark so the admin monitor can show
        // how far behind each terminal is instead of guessing from connection times.
        api.MapGet("/catalog/sync", async (
            ProductRepository repo,
            CatalogVersionRepository versions,
            TerminalRepository terminals,
            long sinceSeq = 0, int pageSize = 500, string? hwId = null) =>
        {
            var items = await repo.SyncBatchAsync(sinceSeq, Math.Clamp(pageSize, 1, 2000), default);
            if (!string.IsNullOrWhiteSpace(hwId))
            {
                var maxSeq = items.Count > 0 ? items.Max(p => p.Seq) : sinceSeq;
                var terminal = await terminals.GetByHwIdAsync(hwId, default);
                if (terminal is not null)
                    await versions.TouchTerminalSeqAsync(terminal.Id, maxSeq, default);
            }
            return items;
        });

        api.MapGet("/groups", async (ArticleGroupRepository repo) => await repo.ListGroupsAsync(default));
        api.MapGet("/groups/{id:long}/items", async (ArticleGroupRepository repo, long id) =>
            await repo.GetItemsAsync(id, default));
        api.MapPost("/groups", async (ArticleGroupRepository repo, CreateArticleGroupRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var created = await repo.CreateAsync(req, default);
                await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Groups);
                return Results.Ok(created);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapPut("/groups/{id:long}", async (ArticleGroupRepository repo, long id, UpdateArticleGroupRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                if (!await repo.UpdateAsync(id, req, default)) return Results.NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Groups);
            return Results.NoContent();
        });
        api.MapDelete("/groups/{id:long}", async (ArticleGroupRepository repo, long id, IHubContext<PosHub> hub) =>
        {
            if (!await repo.DeleteAsync(id, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Groups);
            return Results.NoContent();
        });
        api.MapPost("/groups/{id:long}/products", async (
            ArticleGroupRepository repo, long id, AddArticleGroupProductsRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await repo.AddProductsAsync(id, req.ArticleSeqs ?? [], default);
                if (result.Added > 0) await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Groups);
                return Results.Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapPost("/groups/{id:long}/trees", async (
            ArticleGroupRepository repo, long id, AddArticleGroupTreesRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await repo.AddTreesAsync(id, req.TreeSeqs ?? [], default);
                if (result.Added > 0) await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Groups);
                return Results.Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
        api.MapDelete("/groups/{id:long}/items/{itemId:long}", async (
            ArticleGroupRepository repo, long id, long itemId, IHubContext<PosHub> hub) =>
        {
            if (!await repo.RemoveItemAsync(id, itemId, default)) return Results.NotFound();
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Groups);
            return Results.NoContent();
        });

        api.MapGet("/salesmen", async (
            HttpContext http, DashboardRepository repo, CashierRepository cashiers,
            int page = 1, int pageSize = 100, bool activeOnly = false, bool includeAll = false) =>
        {
            if (CashierHttp.Id(http) is long cashierId)
            {
                var scoped = await cashiers.GetAllowedSalesmenAsync(cashierId, default);
                if (scoped.Count > 0)
                {
                    var size = Math.Clamp(pageSize, 1, 500);
                    var skip = Math.Max(0, page - 1) * size;
                    var slice = scoped.Skip(skip).Take(size).ToList();
                    return Results.Ok(new PagedResult<SalesmanDto>(slice, scoped.Count, page, size));
                }
            }
            return Results.Ok(await repo.SalesmenAsync(page, pageSize, activeOnly, includeAll, default));
        });

        api.MapGet("/accounts/credit", async (HttpContext http, CreditAccountRepository repo) =>
            await repo.ListForPosAsync(default, CashierHttp.Id(http)));

        // Live permissions for the logged-in cashier — lets POS apply admin edits without a re-login.
        api.MapGet("/pos/my-permissions", async (HttpContext http, CashierRepository cashiers) =>
            CashierHttp.Id(http) is long cashierId
                ? Results.Ok(await cashiers.GetPermissionsForCashierAsync(cashierId, default))
                : Results.Unauthorized());

        // Live cashboxes for the logged-in cashier's section — without this, adding a second
        // cashbox to a section never reaches an already-open POS session (it was frozen at
        // login), so the cashbox picker kept showing the single-box static view forever.
        api.MapGet("/pos/my-cashboxes", async (HttpContext http, SectionRepository sections) =>
            CashierHttp.Id(http) is long cashierId
                ? Results.Ok(await sections.GetCashBoxesForCashierAsync(cashierId, default))
                : Results.Unauthorized());

        api.MapGet("/pos/discount-qr-people", async (DiscountQrRepository repo) =>
            Results.Ok(await repo.ListActiveAsync(default)));

        api.MapGet("/pos/discount-qr", async (DiscountQrRepository repo, string? code) =>
        {
            var person = await repo.FindByCodeAsync(code ?? "", default);
            return person is null ? Results.NotFound() : Results.Ok(person);
        });
    }
}
