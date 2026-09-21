using FOT.Pos.Api.Lan;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// Public LAN endpoints for dedicated Android price-checker devices.
/// Same catalog and offer pricing as POS, without a cashier session.
/// </summary>
public static class PriceCheckerEndpoints
{
    public static void MapPriceCheckerEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/price-checker").AllowAnonymous();

        api.MapGet("/ping", () => Results.Ok(new { ok = true, time = DateTime.UtcNow }));

        api.MapGet("/host", () =>
        {
            var ips = LanNetwork.ListPriceCheckerIpv4Addresses();
            return Results.Ok(new
            {
                host = ips.FirstOrDefault(),
                port = LanNetwork.ApiPort,
                urls = LanNetwork.ApiUrls(ips)
            });
        });

        api.MapGet("/product", async (ProductRepository repo, string? code) =>
        {
            if (string.IsNullOrWhiteSpace(code))
                return Results.BadRequest(new { error = "أدخل الباركود" });
            var product = await repo.GetByBarcodeAsync(code, default);
            return product is null ? Results.NotFound() : Results.Ok(product);
        });

        api.MapGet("/catalog/info", async (ProductRepository repo) =>
            await repo.GetCatalogInfoAsync(default));

        api.MapGet("/catalog/ids", async (ProductRepository repo) =>
        {
            var ids = await repo.GetLiveProductIdsAsync(default);
            return Results.Ok(new CatalogIdsDto(ids.Count, ids));
        });

        api.MapGet("/catalog/sync", async (ProductRepository repo, long sinceSeq = 0, int pageSize = 500) =>
            await repo.SyncBatchAsync(sinceSeq, Math.Clamp(pageSize, 1, 2000), default));
    }
}
