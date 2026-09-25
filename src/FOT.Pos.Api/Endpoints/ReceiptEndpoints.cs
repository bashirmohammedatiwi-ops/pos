using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;

namespace FOT.Pos.Api.Endpoints;

public static class ReceiptEndpoints
{
    public static void MapReceiptEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/receipts", async (ReceiptRepository repo, int page = 1, int pageSize = 50, string? search = null,
            long? sectionId = null, long? posId = null, long? cashierId = null, int? kind = null,
            bool? synced = null, DateTime? from = null, DateTime? to = null, bool? hold = null) =>
            await repo.SearchAsync(page, pageSize, search, sectionId, posId, cashierId, kind,
                synced == true ? true : null, synced == false ? true : null, from, to, hold, default));

        api.MapGet("/receipts/holds", async (ReceiptRepository repo, long? sectionId, long? posId) =>
            await repo.ListAllHoldAsync(sectionId, posId, default));

        api.MapPost("/receipts/next-number", async (ReceiptRepository repo, AllocateReceiptNumberRequest req) =>
        {
            try
            {
                return Results.Ok(await repo.AllocateNumberAsync(req.CashierId, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        }).Produces<AllocateReceiptNumberResponse>(200).Produces(400);

        api.MapPost("/receipts/reserve-numbers", async (ReceiptRepository repo, ReserveReceiptNumbersRequest req) =>
        {
            try
            {
                return Results.Ok(await repo.ReserveBlockAsync(req, default));
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        }).Produces<ReserveReceiptNumbersResponse>(200).Produces(400);

        api.MapGet("/receipts/by-number/{number:long}", async (ReceiptRepository repo, long number) =>
        {
            var items = await repo.GetReturnSourcesByNumberAsync(number, default);
            return items.Count == 0 ? Results.NotFound() : Results.Ok(new ReceiptReturnMatchesDto(items));
        }).Produces<ReceiptReturnMatchesDto>(200).Produces(404);

        api.MapGet("/receipts/{id:long}", async (ReceiptRepository repo, long id) =>
            await repo.GetByIdAsync(id, default) is { } r ? Results.Ok(r) : Results.NotFound());

        api.MapPost("/receipts/{id:long}/printed-number", async (ReceiptRepository repo, long id, SetReceiptPrintedNumberRequest req) =>
        {
            try
            {
                return await repo.SetPrintedNumberAsync(id, req.PrintedNumber, default) is { } r
                    ? Results.Ok(r)
                    : Results.NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        }).Produces<ReceiptDetailDto>(200).Produces(400).Produces(404);

        api.MapPost("/receipts", async (ReceiptRepository repo, CreateReceiptRequest req, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await repo.CreateAsync(req, default);
                try
                {
                    if (!req.IsPending && result.Number > 0)
                        await PosHubEvents.NotifyReceiptCreated(hub, result.ReceiptId, result.Number);
                }
                catch { /* live notify must not fail a saved sale */ }
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
        }).Produces<CreateReceiptResponse>(200).Produces(400);

        api.MapGet("/receipts/hold", async (ReceiptRepository repo, long? posId) =>
            await repo.ListHoldAsync(posId, default));

        api.MapPost("/receipts/hold/{id:long}/complete", async (ReceiptRepository repo, long id, decimal payment, IHubContext<PosHub> hub) =>
        {
            try
            {
                var result = await repo.CompleteHoldAsync(id, payment, default);
                if (result is null) return Results.NotFound();
                try { await PosHubEvents.NotifyReceiptCreated(hub, result.Id, result.Number); }
                catch { /* live notify must not fail a saved sale */ }
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
        }).Produces<ReceiptDetailDto>(200).Produces(404);
    }
}
