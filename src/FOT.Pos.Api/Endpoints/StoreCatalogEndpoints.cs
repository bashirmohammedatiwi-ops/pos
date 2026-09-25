using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// Public catalog for the price checker, the phone store, and any other shop app.
/// Anonymous on the LAN. Prices are computed on each request from the same offers the cashier uses.
/// </summary>
public static class StoreCatalogEndpoints
{
    public static void MapStoreCatalogEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/catalog").AllowAnonymous();
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
                    lookup = "/api/v1/catalog/lookup?code=",
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
            bool offersOnly = false) =>
            Results.Ok(await repo.ListAsync(page, pageSize, q, offersOnly, default)));

        api.MapGet("/products/{id:long}", async (StoreCatalogRepository repo, long id) =>
            await repo.GetByIdAsync(id, default) is { } product
                ? Results.Ok(product)
                : Results.NotFound(new { error = "المنتج غير موجود" }));

        api.MapGet("/lookup", async (StoreCatalogRepository repo, string? code) =>
        {
            if (string.IsNullOrWhiteSpace(code))
                return Results.BadRequest(new { error = "أدخل الباركود أو رقم المادة" });
            var product = await repo.GetByCodeAsync(code, default);
            return product is null
                ? Results.NotFound(new { error = "المنتج غير موجود" })
                : Results.Ok(product);
        });

        api.MapGet("/changes", async (StoreCatalogRepository repo, long since = 0, int limit = 200) =>
            Results.Ok(await repo.ChangesAsync(since, limit, default)));

        api.MapGet("/ids", async (StoreCatalogRepository repo) =>
        {
            var ids = await repo.LiveIdsAsync(default);
            return Results.Ok(new { total = ids.Count, ids });
        });
    }
}
