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
        int page, int pageSize, string? search, bool offersOnly, bool inStockOnly, CancellationToken ct)
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
        if (inStockOnly)
            where += " AND COALESCE(a.CurTot1,0) > 0";

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
        var codes = CodeCandidates(code);
        if (codes.Count == 0) return null;
        return await QueryOneAsync("(a.Barcode IN @codes OR a.Num IN @codes)", new { codes }, ct);
    }

    public async Task<StoreLookupResult> LookupManyAsync(IReadOnlyList<string>? codes, CancellationToken ct)
    {
        var wanted = (codes ?? [])
            .Select(c => c.Trim())
            .Where(c => c.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(100)
            .ToList();
        if (wanted.Count == 0) return new StoreLookupResult([], []);
        var expanded = wanted.SelectMany(CodeCandidates).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT {SelectColumns}
            FROM dbo.articles a
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE COALESCE(a.SellPr4,0) > 0
              AND (a.Barcode IN @codes OR a.Num IN @codes)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<Row>(new CommandDefinition(sql, new { codes = expanded }, cancellationToken: ct)))
            .Select(Map)
            .ToList();
        var found = new List<StoreProductDto>();
        var missing = new List<string>();
        foreach (var code in wanted)
        {
            var keys = CodeCandidates(code);
            var hit = rows.FirstOrDefault(p =>
                keys.Contains(p.Barcode ?? "", StringComparer.OrdinalIgnoreCase)
                || keys.Contains(p.Sku ?? "", StringComparer.OrdinalIgnoreCase));
            if (hit is null) missing.Add(code);
            else if (found.All(p => p.Id != hit.Id)) found.Add(hit);
        }
        return new StoreLookupResult(found, missing);
    }

    public async Task<IReadOnlyList<StoreOfferDto>> OffersAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT o.id AS Id,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), o.name))) AS Name,
                   o.priority AS Priority,
                   COUNT(DISTINCT od.item_id) AS ProductCount
            FROM dbo.offers o
            INNER JOIN dbo.offer_details od ON od.offer_id = o.id
            WHERE o.enabled = 1
              AND COALESCE(od.excluded, 0) = 0
              AND (od.discount > 0 OR od.discount_type = 2)
              AND (
                od.Unlimited = 1 OR (od.from_date IS NULL AND od.to_date IS NULL)
                OR (od.from_date IS NULL AND od.to_date IS NOT NULL AND CAST(GETDATE() AS date) <= od.to_date)
                OR (od.to_date IS NULL AND od.from_date IS NOT NULL AND CAST(GETDATE() AS date) >= od.from_date)
                OR (od.from_date IS NOT NULL AND od.to_date IS NOT NULL AND CAST(GETDATE() AS date) BETWEEN od.from_date AND od.to_date)
              )
            GROUP BY o.id, o.name, o.priority
            ORDER BY o.priority DESC, o.name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<StoreOfferDto>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<StoreCategoryDto>> CategoriesAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT g.id AS Id,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), g.name))) AS Name,
                   COUNT(i.id) AS ProductCount
            FROM dbo.article_groups g
            LEFT JOIN dbo.article_group_items i ON i.article_group_id = g.id
            GROUP BY g.id, g.name, g.sort_index
            ORDER BY g.sort_index, g.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<StoreCategoryDto>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<StoreCatalogPageDto?> CategoryProductsAsync(long categoryId, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var sql = $"""
            ;WITH {ProductSql.ActiveOffersCte}
            SELECT {SelectColumns}
            FROM dbo.articles a
            INNER JOIN dbo.article_group_items i ON i.barcode_id = a.Seq AND i.article_group_id = @categoryId
            LEFT JOIN ActiveOffers ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE COALESCE(a.SellPr4,0) > 0
            ORDER BY a.Name1, a.id
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

            SELECT COUNT(*)
            FROM dbo.articles a
            INNER JOIN dbo.article_group_items i ON i.barcode_id = a.Seq AND i.article_group_id = @categoryId
            WHERE COALESCE(a.SellPr4,0) > 0;

            SELECT COALESCE(MAX(CONVERT(BIGINT, ext_row_version)), 0)
            FROM dbo.articles WHERE COALESCE(SellPr4, 0) > 0;

            SELECT COUNT(*) FROM dbo.article_groups WHERE id = @categoryId;
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            sql, new { categoryId, offset = (page - 1) * pageSize, pageSize }, cancellationToken: ct));
        var items = (await multi.ReadAsync<Row>()).Select(Map).ToList();
        var total = await multi.ReadSingleAsync<int>();
        var revision = await multi.ReadSingleAsync<long>();
        var exists = await multi.ReadSingleAsync<int>();
        if (exists == 0) return null;
        return new StoreCatalogPageDto(items, page, pageSize, total, revision);
    }

    public async Task<StoreCatalogChangesDto> ChangesAsync(long since, int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 2000);
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

    private static List<string> CodeCandidates(string code)
    {
        var trimmed = code.Trim();
        if (trimmed.Length == 0) return [];
        var list = new List<string> { trimmed };
        if (trimmed.All(char.IsDigit))
        {
            var stripped = trimmed.TrimStart('0');
            if (stripped.Length > 0 && stripped != trimmed) list.Add(stripped);
            if (trimmed.Length < 13) list.Add(trimmed.PadLeft(13, '0'));
            if (trimmed.Length < 12) list.Add(trimmed.PadLeft(12, '0'));
        }
        return list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
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
