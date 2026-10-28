using FOT.Pos.Api.Auth;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// Public catalog for the price checker, the phone store, and any other shop app on the LAN.
/// Read endpoints are anonymous on the LAN; write endpoints require <c>catalog:write</c> or admin auth.
/// </summary>
public static class StoreCatalogEndpoints
{
    public static void MapStoreCatalogEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/catalog").AllowAnonymous().WithTags("Network API v1 - Catalog");
        api.AddEndpointFilter(async (ctx, next) =>
        {
            ctx.HttpContext.Response.Headers.CacheControl = "no-store";
            return await next(ctx);
        });

        api.MapGet("/", async (StoreCatalogRepository repo) =>
        {
            var version = await repo.VersionAsync(default);
            return Results.Ok(new
            {
                name = "FOT Store Catalog",
                version = 1,
                currency = version.Currency,
                revision = version.Revision,
                productCount = version.ProductCount,
                pricedAt = version.PricedAt,
                endpoints = new
                {
                    version = "/api/v1/catalog/version",
                    products = "/api/v1/catalog/products",
                    product = "/api/v1/catalog/products/{id}",
                    search = "/api/v1/catalog/search?q=",
                    lookup = "/api/v1/catalog/lookup?code=",
                    lookupBatch = "POST /api/v1/catalog/lookup",
                    quote = "POST /api/v1/catalog/quote",
                    offers = "/api/v1/catalog/offers",
                    bundles = "/api/v1/catalog/bundles",
                    categories = "/api/v1/catalog/categories",
                    categoryProducts = "/api/v1/catalog/categories/{id}/products",
                    trees = "/api/v1/catalog/trees",
                    treeProducts = "/api/v1/catalog/trees/{treeSeq}/products",
                    changes = "/api/v1/catalog/changes?since=",
                    ids = "/api/v1/catalog/ids"
                }
            });
        });

        api.MapGet("/version", async (StoreCatalogRepository repo) =>
            Results.Ok(await repo.VersionAsync(default)));

        api.MapGet("/products", async (
            StoreCatalogRepository repo,
            int page = 1,
            int pageSize = 50,
            string? q = null,
            bool offersOnly = false,
            bool inStock = false) =>
            Results.Ok(await repo.ListAsync(page, pageSize, q, offersOnly, inStock, default)));

        api.MapGet("/products/{id:long}", async (StoreCatalogRepository repo, long id) =>
            await repo.GetByIdAsync(id, default) is { } product
                ? Results.Ok(product)
                : Results.NotFound(new { error = "المنتج غير موجود" }));

        api.MapGet("/search", async (StoreCatalogRepository repo, string? q, int limit = 25, bool offersOnly = false, bool inStock = false) =>
        {
            if (string.IsNullOrWhiteSpace(q))
                return Results.Ok(Array.Empty<StoreProductDto>());
            var page = await repo.ListAsync(1, Math.Clamp(limit, 1, 100), q.Trim(), offersOnly, inStock, default);
            return Results.Ok(page.Items);
        });

        api.MapGet("/lookup", async (StoreCatalogRepository repo, string? code) =>
        {
            if (string.IsNullOrWhiteSpace(code))
                return Results.BadRequest(new { error = "أدخل الباركود أو رقم المادة" });
            var product = await repo.GetByCodeAsync(code, default);
            return product is null
                ? Results.NotFound(new { error = "المنتج غير موجود" })
                : Results.Ok(product);
        });

        api.MapPost("/lookup", async (StoreCatalogRepository repo, StoreLookupRequest? body) =>
        {
            if (body?.Codes is not { Count: > 0 })
                return Results.BadRequest(new { error = "أرسل قائمة الباركودات في codes" });
            return Results.Ok(await repo.LookupManyAsync(body.Codes, default));
        });

        api.MapPost("/quote", async (
            CartQuoteRequest? body,
            ApiPlatformRepository platformRepo,
            StoreCatalogRepository catalogRepo,
            DiscountQrRepository qrRepo) =>
        {
            if (body?.Items is not { Count: > 0 })
                return Results.BadRequest(new { error = "أرسل قائمة المواد في items" });
            return Results.Ok(await platformRepo.QuoteCartAsync(body, catalogRepo, qrRepo, default));
        });

        api.MapGet("/offers", async (StoreCatalogRepository repo) =>
            Results.Ok(await repo.OffersAsync(default)));

        api.MapGet("/bundles", async (OfferRepository offers) =>
            Results.Ok(await offers.GetPosBundleOffersAsync(default)));

        api.MapGet("/categories", async (StoreCatalogRepository repo) =>
            Results.Ok(await repo.CategoriesAsync(default)));

        api.MapGet("/categories/{id:long}/products", async (
            StoreCatalogRepository repo, long id, int page = 1, int pageSize = 50) =>
        {
            var pageResult = await repo.CategoryProductsAsync(id, page, pageSize, default);
            return pageResult is null
                ? Results.NotFound(new { error = "القسم غير موجود" })
                : Results.Ok(pageResult);
        });

        api.MapGet("/trees", async (ArticleTreeRepository trees, long? parentSeq = null, string? search = null, int limit = 100) =>
            Results.Ok(await trees.GetNodesAsync(parentSeq, search, Math.Clamp(limit, 1, 500), default)));

        api.MapGet("/trees/{treeSeq:long}/products", async (ArticleTreeRepository trees, long treeSeq) =>
            Results.Ok(await trees.ListDescendantProductsAsync(treeSeq, default)));

        api.MapGet("/changes", async (StoreCatalogRepository repo, long since = 0, int limit = 200) =>
            Results.Ok(await repo.ChangesAsync(since, limit, default)));

        api.MapGet("/ids", async (StoreCatalogRepository repo) =>
        {
            var ids = await repo.LiveIdsAsync(default);
            return Results.Ok(new { total = ids.Count, ids });
        });

        api.MapPatch("/products/{id:long}", async (
            HttpContext http,
            ProductRepository repo,
            StoreCatalogRepository storeRepo,
            long id,
            UpdateProductRequest req,
            IHubContext<PosHub> hub) =>
        {
            if (ApiScope.Enforce(http, "catalog:write") is { } denied) return denied;
            if (!await repo.UpdateAsync(id, req, default))
                return Results.NotFound(new { error = "المنتج غير موجود" });
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.Ok(await storeRepo.GetByIdAsync(id, default));
        });

        api.MapPut("/products/{id:long}/discount", async (
            HttpContext http,
            ProductRepository repo,
            StoreCatalogRepository storeRepo,
            long id,
            DiscountPercentRequest req,
            IHubContext<PosHub> hub) =>
        {
            if (ApiScope.Enforce(http, "catalog:write") is { } denied) return denied;
            try
            {
                if (!await repo.UpdateDiscountPercentAsync(id, req.Percent, default))
                    return Results.NotFound(new { error = "المنتج غير موجود" });
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.Ok(await storeRepo.GetByIdAsync(id, default));
        });
    }
}
