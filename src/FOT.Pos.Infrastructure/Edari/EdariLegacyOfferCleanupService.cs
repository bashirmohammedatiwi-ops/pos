using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// يزيل عروض FilePosO المستوردة من Edari حتى لا تختلط مع عروض FOT POS V2.
/// </summary>
public sealed class EdariLegacyOfferCleanupService(
    ISqlConnectionFactory db,
    EdariSyncRepository syncRepo)
{
    public async Task<EdariLegacyOfferCleanupResult> PurgeImportedOffersAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        var mapped = (await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT offer_id FROM ext_edari_offer_map", cancellationToken: ct))).ToList();

        if (mapped.Count == 0)
        {
            var cleared = await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE articles SET SellPr5 = 0 WHERE COALESCE(SellPr5, 0) <> 0", cancellationToken: ct));
            var msg = cleared > 0
                ? $"لا عروض مستوردة — صُفّر SellPr5 لـ {cleared:N0} مادة"
                : "لا عروض Edari مستوردة في القاعدة";
            await syncRepo.LogOperationAsync("purge_edari_offers", "success", msg, ct);
            return new EdariLegacyOfferCleanupResult(true, msg, 0, 0, cleared);
        }

        await using var tx = conn.BeginTransaction();
        try
        {
            var details = await conn.ExecuteAsync(new CommandDefinition(
                "DELETE od FROM offer_details od INNER JOIN ext_edari_offer_map m ON m.offer_id = od.offer_id",
                transaction: tx, cancellationToken: ct));

            var offers = await conn.ExecuteAsync(new CommandDefinition(
                "DELETE o FROM offers o INNER JOIN ext_edari_offer_map m ON m.offer_id = o.id",
                transaction: tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM ext_edari_offer_map", transaction: tx, cancellationToken: ct));

            var sellPr5 = await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE articles SET SellPr5 = 0 WHERE COALESCE(SellPr5, 0) <> 0",
                transaction: tx, cancellationToken: ct));

            tx.Commit();

            var message = $"حُذفت {offers} عرض Edari · {details} بند · SellPr5 صُفّر لـ {sellPr5:N0} مادة";
            await syncRepo.LogOperationAsync("purge_edari_offers", "success", message, ct);
            return new EdariLegacyOfferCleanupResult(true, message, offers, details, sellPr5);
        }
        catch (Exception ex)
        {
            tx.Rollback();
            var err = ex.Message;
            await syncRepo.LogOperationAsync("purge_edari_offers", "failed", err, ct);
            return new EdariLegacyOfferCleanupResult(false, err, 0, 0, 0);
        }
    }
}

public sealed record EdariLegacyOfferCleanupResult(
    bool Ok,
    string Message,
    int OffersRemoved,
    int DetailsRemoved,
    int SellPr5Cleared);
