using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariCatalogSyncService(
    EdariNexusClient nexus,
    ISqlConnectionFactory db,
    EdariSyncRepository syncRepo)
{
    public async Task<int> ImportOffersAsync(CancellationToken ct)
    {
        var offers = await nexus.GetOffersAsync(ct);
        if (offers.Count == 0) return 0;

        var materials = await nexus.GetOfferMaterialsAsync(ct);
        var matsByOffer = materials.GroupBy(m => m.MasterSeq).ToDictionary(g => g.Key, g => g.ToList());

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var imported = 0;

        foreach (var offer in offers)
        {
            var offerId = await UpsertOfferAsync(conn, offer, ct);
            if (offerId <= 0) continue;

            if (matsByOffer.TryGetValue(offer.Seq, out var lines))
            {
                foreach (var line in lines)
                    await UpsertOfferDetailAsync(conn, offerId, line, offer, ct);
            }

            await conn.ExecuteAsync(new CommandDefinition("""
                MERGE ext_edari_offer_map AS t
                USING (SELECT @offerId AS offer_id, @seq AS edari_seq, @name AS edari_name) AS s
                ON t.offer_id = s.offer_id
                WHEN MATCHED THEN UPDATE SET edari_seq = s.edari_seq, edari_name = s.edari_name, last_synced_at = GETDATE()
                WHEN NOT MATCHED THEN INSERT (offer_id, edari_seq, edari_name) VALUES (s.offer_id, s.edari_seq, s.edari_name);
                """, new { offerId, seq = offer.Seq, name = offer.Name }, cancellationToken: ct));

            imported++;
        }

        if (imported > 0)
            await syncRepo.UpdateLastCatalogSyncAsync(ct);

        return imported;
    }

    public async Task<int> ValidateProductTreeLinksAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT TOP 500 a.Seq FROM articles a
            WHERE a.Seq > 0
            ORDER BY a.id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var seqs = (await conn.QueryAsync<long>(new CommandDefinition(sql, cancellationToken: ct))).ToList();

        var missing = 0;
        foreach (var seq in seqs)
        {
            if (!await nexus.MaterialExistsAsync(seq, ct))
                missing++;
        }

        await syncRepo.LogOperationAsync("catalog_validate", missing == 0 ? "success" : "failed",
            $"Checked {seqs.Count} products — {missing} missing from File13n", ct);
        return missing;
    }

    private static async Task<long> UpsertOfferAsync(System.Data.Common.DbConnection conn, EdariOfferRow offer, CancellationToken ct)
    {
        var existing = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT offer_id FROM ext_edari_offer_map WHERE edari_seq = @seq",
            new { seq = offer.Seq }, cancellationToken: ct));

        if (existing is > 0)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE offers SET name = @name, enabled = 1, type = @type WHERE id = @id",
                new { id = existing, name = offer.Name ?? $"Edari #{offer.Seq}", type = offer.Kind },
                cancellationToken: ct));
            return existing.Value;
        }

        return await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO offers (name, priority, enabled, type, master_account, remarks)
            OUTPUT INSERTED.id
            VALUES (@name, @priority, 1, @type, 0, N'Edari import');
            """, new
        {
            name = offer.Name ?? $"Edari #{offer.Seq}",
            priority = (int)offer.Seq,
            type = offer.Kind
        }, cancellationToken: ct));
    }

    private static async Task UpsertOfferDetailAsync(
        System.Data.Common.DbConnection conn, long offerId, EdariOfferMaterialRow line,
        EdariOfferRow offer, CancellationToken ct)
    {
        const string sql = """
            IF NOT EXISTS (SELECT 1 FROM offer_details WHERE offer_id = @offerId AND item_id = @itemId)
            INSERT INTO offer_details (offer_id, item_id, discount, discount_type, from_date, to_date, Unlimited)
            VALUES (@offerId, @itemId, @discount, @discountType, @fromDate, @toDate, @unlimited)
            """;
        await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            offerId,
            itemId = line.MatSeq,
            discount = line.Discount,
            discountType = line.DiscountType,
            fromDate = offer.FromDate,
            toDate = offer.ToDate,
            unlimited = offer.ToDate is null
        }, cancellationToken: ct));
    }
}
