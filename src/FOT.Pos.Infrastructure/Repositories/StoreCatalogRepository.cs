using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// Live store catalog for external apps. Every read joins the active offers, so a save in the
/// control panel is visible on the next request. Offer edits also bump the article rowversion,
/// which <see cref="ChangesAsync"/> uses as the sync cursor.
/// </summary>
public sealed class StoreCatalogRepository(ISqlConnectionFactory db)
{
    private sealed record Head(int ProductCount, long Revision);

    private sealed record Row(
        long Id, string? Num, string? Name, string? Barcode,
        decimal OriginalPrice, decimal StoredFinalPrice, decimal Stock,
        decimal? DiscountValue, int DiscountType, string? OfferName,
        int StoredDiscountPercent, long ChangeVersion);

    public async Task<StoreCatalogVersionDto> VersionAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT COUNT(*) AS ProductCount,
                   COALESCE(MAX(CONVERT(BIGINT, ext_row_version)), 0) AS Revision
            FROM dbo.articles
            WHERE COALESCE(SellPr4, 0) > 0
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<Head>(new CommandDefinition(sql, cancellationToken: ct));
        return new StoreCatalogVersionDto(row.Revision, row.ProductCount, "IQD", DateTime.UtcNow);
    }

    public async Task<StoreCatalogPageDto> ListAsync(
        int page, int pageSize, string? search, bool offersOnly, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var where = "WHERE COALESCE(a.SellPr4,0) > 0";
        var p = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += " AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }
        if (offersOnly)
            where += " AND ao.item_id IS NOT NULL";

        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT {SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            {where}
            ORDER BY a.Name1, a.id
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

            ;WITH {ProductSql.ActiveOffersCte}
            SELECT COUNT(*)
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            {where};

            SELECT COALESCE(MAX(CONVERT(BIGINT, ext_row_version)), 0)
            FROM dbo.articles WHERE COALESCE(SellPr4, 0) > 0;
            """;
        p.Add("offset", (page - 1) * pageSize);
        p.Add("pageSize", pageSize);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, p, cancellationToken: ct));
        var items = (await multi.ReadAsync<Row>()).Select(Map).ToList();
        var total = await multi.ReadSingleAsync<int>();
        var revision = await multi.ReadSingleAsync<long>();
        return new StoreCatalogPageDto(items, page, pageSize, total, revision);
    }

    public async Task<StoreProductDto?> GetByIdAsync(long id, CancellationToken ct) =>
        await QueryOneAsync("a.id = @id", new { id }, ct);

    public async Task<StoreProductDto?> GetByCodeAsync(string code, CancellationToken ct)
    {
        var trimmed = code.Trim();
        if (trimmed.Length == 0) return null;
        return await QueryOneAsync("(a.Barcode = @code OR a.Num = @code)", new { code = trimmed }, ct);
    }

    public async Task<StoreCatalogChangesDto> ChangesAsync(long since, int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 500);
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT TOP (@take) {SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE a.ext_row_version > @since AND COALESCE(a.SellPr4, 0) > 0
            ORDER BY a.ext_row_version ASC;

            SELECT COUNT(*) AS ProductCount,
                   COALESCE(MAX(CONVERT(BIGINT, ext_row_version)), 0) AS Revision
            FROM dbo.articles
            WHERE COALESCE(SellPr4, 0) > 0;
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            sql, new { since, take = limit + 1 }, cancellationToken: ct));
        var rows = (await multi.ReadAsync<Row>()).ToList();
        var head = await multi.ReadSingleAsync<Head>();
        var hasMore = rows.Count > limit;
        if (hasMore) rows.RemoveAt(rows.Count - 1);
        var items = rows.Select(Map).ToList();
        var nextSince = items.Count > 0 ? items[^1].Revision : since;
        return new StoreCatalogChangesDto(items, head.Revision, nextSince, hasMore, head.ProductCount);
    }

    public async Task<IReadOnlyList<long>> LiveIdsAsync(CancellationToken ct)
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

    private async Task<StoreProductDto?> QueryOneAsync(string where, object param, CancellationToken ct)
    {
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT TOP 1 {SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE {where} AND COALESCE(a.SellPr4,0) > 0
            ORDER BY a.id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<Row>(new CommandDefinition(sql, param, cancellationToken: ct));
        return row is null ? null : Map(row);
    }

    private const string SelectColumns = """
        a.id AS Id, LTRIM(RTRIM(a.Num)) AS Num,
        LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
        LTRIM(RTRIM(a.Barcode)) AS Barcode,
        CAST(COALESCE(NULLIF(a.SellPr4,0),0) AS decimal(18,0)) AS OriginalPrice,
        CAST(0 AS decimal(18,0)) AS StoredFinalPrice,
        CAST(COALESCE(a.CurTot1,0) AS decimal(18,2)) AS Stock,
        CAST(ao.discount AS decimal(18,2)) AS DiscountValue,
        CAST(COALESCE(ao.discount_type,0) AS int) AS DiscountType,
        ao.offer_name AS OfferName,
        CAST(COALESCE(a.ext_discount_percent,0) AS int) AS StoredDiscountPercent,
        CONVERT(BIGINT, a.ext_row_version) AS ChangeVersion
        """;

    private static StoreProductDto Map(Row r)
    {
        var (price, original, effective, offerName) = ProductPricing.Compute(
            r.OriginalPrice, r.StoredFinalPrice, r.DiscountValue, r.DiscountType, r.OfferName,
            r.StoredDiscountPercent);
        var onOffer = original > 0 && price < original;
        int? listed = onOffer && offerName is not null && r.DiscountType == 0 && r.DiscountValue is > 0 and <= 100
            ? (int)Math.Round(r.DiscountValue.Value, MidpointRounding.AwayFromZero)
            : null;
        return new StoreProductDto(
            r.Id,
            string.IsNullOrWhiteSpace(r.Num) ? null : r.Num.Trim(),
            string.IsNullOrWhiteSpace(r.Barcode) ? null : r.Barcode.Trim(),
            string.IsNullOrWhiteSpace(r.Name) ? "" : r.Name.Trim(),
            r.Stock,
            r.Stock > 0,
            original,
            price,
            onOffer,
            onOffer ? effective : 0,
            listed,
            offerName,
            r.ChangeVersion);
    }
}
