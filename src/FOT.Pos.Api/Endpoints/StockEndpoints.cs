using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// Live stock: Edari stock minus what the cashiers sold and Edari has not merged yet.
/// See <see cref="PendingStockRepository"/> and <see cref="StockSettlementService"/>.
/// </summary>
public static class StockEndpoints
{
    public static void MapStockEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/stock/pending/status", async (PendingStockRepository repo) =>
            Results.Ok(await repo.GetStatusAsync(default)));

        // «دمجت الإيصالات — تحقق الآن»: asks Edari right away which bills its merge closed.
        api.MapPost("/stock/pending/check", async (StockSettlementService settlement, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await settlement.CheckAsync(default, TimeSpan.FromSeconds(90));
                if (result.Settled > 0 || result.StockChanged > 0)
                    await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
                return Results.Ok(result);
            }
            catch (EdariCircuitOpenException ex)
            {
                return Results.Ok(new PendingStockCheckResultDto(false, ex.Message, 0, 0, 0, 0));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return Results.Ok(new PendingStockCheckResultDto(false, "تعذّر الفحص من الإداري: " + ex.Message, 0, 0, 0, 0));
            }
        });

        // Fallback for odd cases (a bill deleted by hand in Edari, …): stop subtracting this
        // cashier's receipts that are already in Edari. Receipts not posted yet are left alone.
        api.MapPost("/stock/pending/settle/{posId:long}", async (PendingStockRepository repo, IHubContext<PosHub> hub, long posId) =>
        {
            var count = await repo.SettleManuallyAsync(posId, default);
            if (count > 0)
                await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.Ok(new { settled = count });
        });

        api.MapPut("/stock/pending/settings", async (PendingStockRepository repo, IHubContext<PosHub> hub, PendingStockSettingsRequest req) =>
        {
            await repo.SaveOptionsAsync(req.Enabled, req.MaxHours, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Products);
            return Results.Ok(await repo.GetStatusAsync(default));
        });

        // The cashier reports every receipt it keeps parked for manual transfer (full snapshot,
        // replaces the previous one), so those sales come off the stock before the transfer.
        api.MapPut("/stock/holds/{posId:long}", async (
            PendingStockRepository repo, TerminalRepository terminals, long posId, StockHoldsReplaceRequest req) =>
        {
            if (posId <= 0 && !string.IsNullOrWhiteSpace(req.HwId))
                posId = (await terminals.GetByHwIdAsync(req.HwId, default))?.Id ?? 0;
            if (posId <= 0)
                return Results.BadRequest(new { error = "نقطة البيع غير معروفة" });
            if (req.Receipts.Count > 2000)
                return Results.BadRequest(new { error = "عدد الفواتير المؤجلة أكبر من المسموح" });
            var changed = await repo.ReplaceHoldsAsync(posId, req.Receipts, default);
            return Results.Ok(new { changed });
        });
    }
}
