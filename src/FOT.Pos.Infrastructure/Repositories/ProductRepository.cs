using Dapper;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ProductRepository(ISqlConnectionFactory db)
{
    private sealed record Row(
        long Id, long Seq, string? Num, string? Name, string? Barcode,
        decimal OriginalPrice, decimal StoredFinalPrice, decimal Stock,
        decimal? DiscountValue, int DiscountType, string? OfferName,
        int StoredDiscountPercent = 0, long ChangeVersion = 0);

    public async Task<PagedResult<ProductDto>> ListAsync(int page, int pageSize, string? search, CancellationToken ct, string? filter = null)
    {
        var where = "WHERE COALESCE(a.SellPr4,0) > 0";
        var p = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += " AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }

        var kind = (filter ?? "").Trim().ToLowerInvariant();
        var extra = kind switch
        {
            "offer" or "discount" => " AND ao.item_id IS NOT NULL",
            "zero" => $" AND {ProductSql.EffectiveStock} <= 0",
            "negative" => $" AND {ProductSql.EffectiveStock} < 0",
            _ => ""
        };
        var countNeedsOffer = kind is "offer" or "discount";
        var countFrom = countNeedsOffer
            ? """
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            """
            : "FROM dbo.articles a";

        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT {ProductSql.SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            {where}{extra}
            ORDER BY a.Seq DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

            ;WITH {ProductSql.ActiveOffersCte}
            SELECT COUNT(*) {countFrom} {where}{extra};
            """;

        p.Add("offset", (page - 1) * pageSize);
        p.Add("pageSize", pageSize);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        List<Row> rows;
        int total;
        using (var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, p, cancellationToken: ct)))
        {
            rows = (await multi.ReadAsync<Row>()).ToList();
            total = await multi.ReadSingleAsync<int>();
        }
        var items = rows.Select(Map).ToList();

        // Shown in the products table as «الإداري X − بانتظار الدمج Y».
        if (items.Count > 0)
        {
            var pending = (await conn.QueryAsync<(long Id, double Qty)>(new CommandDefinition(
                "SELECT id, ext_pending_qty FROM articles WHERE id IN @ids AND ext_pending_qty <> 0",
                new { ids = items.Select(i => i.Id).ToArray() }, cancellationToken: ct)))
                .ToDictionary(x => x.Id, x => (decimal)x.Qty);
            if (pending.Count > 0)
                items = items.Select(i => pending.TryGetValue(i.Id, out var q) ? i with { PendingQty = q } : i).ToList();
        }
        return new PagedResult<ProductDto>(items, total, page, pageSize);
    }

    public async Task<ProductDto?> GetByIdAsync(long id, CancellationToken ct) =>
        await QueryOneAsync("a.id = @id", new { id }, ct);

    public async Task<ProductDto?> GetByBarcodeAsync(string code, CancellationToken ct)
    {
        var trimmed = code.Trim();
        // A code can be one product's barcode and another product's item number. The cashier's
        // local catalog takes the barcode match first, so the price checker must too — otherwise
        // the two show different products (and different offers) for the same scan.
        return await QueryOneAsync("(a.Barcode = @code OR a.Num = @code)", new { code = trimmed }, ct,
            orderBy: "CASE WHEN a.Barcode = @code THEN 0 ELSE 1 END, a.Seq DESC");
    }

    public async Task<CatalogInfoDto> GetCatalogInfoAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT COUNT(*) AS TotalProducts, COALESCE(MAX(CONVERT(BIGINT, ext_row_version)), 0) AS MaxSeq
            FROM dbo.articles WHERE COALESCE(SellPr4, 0) > 0
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowAsync<CatalogInfoDto>(new CommandDefinition(sql, cancellationToken: ct));
    }

    /// <summary>
    /// Every product id a terminal is allowed to keep. The delta feed can only add and update —
    /// a product deleted in Edari simply stops appearing, so without this list terminals never
    /// drop it and their local catalog grows forever (97k local rows against 30k live ones).
    /// Ids are ordered so the client can stream them into a prune without sorting.
    /// </summary>
    public async Task<IReadOnlyList<long>> GetLiveProductIdsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT a.id
            FROM dbo.articles a
            WHERE COALESCE(a.SellPr4, 0) > 0
            ORDER BY a.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var ids = await conn.QueryAsync<long>(new CommandDefinition(sql, cancellationToken: ct));
        return ids.ToList();
    }

    /// <summary>
    /// Delta feed ordered by the rowversion watermark: any INSERT/UPDATE on the article
    /// (admin edit, POS discount edit, Edari refresh) bumps it, so terminals converge quickly.
    /// </summary>
    public async Task<IReadOnlyList<ProductDto>> SyncBatchAsync(long sinceSeq, int pageSize, CancellationToken ct)
    {
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT TOP (@pageSize) {ProductSql.SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE a.ext_row_version > @sinceSeq AND COALESCE(a.SellPr4, 0) > 0
            ORDER BY a.ext_row_version ASC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<Row>(new CommandDefinition(sql, new { sinceSeq, pageSize }, cancellationToken: ct));
        return rows.Select(Map).ToList();
    }

    private async Task<ProductDto?> QueryOneAsync(string where, object param, CancellationToken ct, string orderBy = "a.Seq DESC")
    {
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT TOP 1 {ProductSql.SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE {where} AND COALESCE(a.SellPr4,0) > 0
            ORDER BY {orderBy}
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<Row>(new CommandDefinition(sql, param, cancellationToken: ct));
        return row is null ? null : Map(row);
    }

    private static ProductDto Map(Row r)
    {
        var (price, original, pct, offer) = ProductPricing.Compute(
            r.OriginalPrice, r.StoredFinalPrice, r.DiscountValue, r.DiscountType, r.OfferName,
            r.StoredDiscountPercent);
        return new ProductDto(r.Id, r.Seq, r.Num, r.Name, r.Barcode, original, price, r.Stock, pct, offer,
            r.ChangeVersion, r.StoredDiscountPercent);
    }

    public async Task<bool> UpdateAsync(long id, UpdateProductRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        // The stock the caller sees and sends back is the live one (Edari minus unmerged sales),
        // so the unmerged part is added back before it lands in CurTot1 — otherwise every save
        // from the products page would subtract today's sales a second time.
        var rows = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE articles SET
                Name1 = COALESCE(@name, Name1),
                Barcode = COALESCE(@barcode, Barcode),
                SellPr4 = COALESCE(@originalPrice, SellPr4),
                SellPr5 = COALESCE(@finalPrice, SellPr5),
                CurTot1 = COALESCE(@stock + COALESCE(ext_pending_qty, 0), CurTot1),
                ext_discount_percent = COALESCE(@discountPercent, ext_discount_percent)
            WHERE id = @id
            """, new
        {
            id,
            name = req.Name,
            barcode = req.Barcode,
            originalPrice = req.OriginalPrice,
            finalPrice = req.FinalPrice,
            stock = req.Stock,
            discountPercent = req.DiscountPercent is < 0 or > 100 ? null : req.DiscountPercent
        }, cancellationToken: ct));
        return rows > 0;
    }

    /// <summary>POS-side edit of the stored per-product discount percent (permission-gated client-side).</summary>
    public async Task<bool> UpdateDiscountPercentAsync(long id, int percent, CancellationToken ct)
    {
        if (percent is < 0 or > 100)
            throw new InvalidOperationException("نسبة الخصم يجب أن تكون بين 0 و 100");
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE articles SET ext_discount_percent = @percent WHERE id = @id",
            new { id, percent }, cancellationToken: ct));
        return rows > 0;
    }

    public async Task<IReadOnlyList<ProductDto>> SearchLocalAsync(string term, int limit, CancellationToken ct)
    {
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT TOP (@limit) {ProductSql.SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE COALESCE(a.SellPr4,0) > 0
              AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s)
            ORDER BY a.Name1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<Row>(new CommandDefinition(sql,
            new { s = $"%{term.Trim()}%", limit }, cancellationToken: ct));
        return rows.Select(Map).ToList();
    }
}
