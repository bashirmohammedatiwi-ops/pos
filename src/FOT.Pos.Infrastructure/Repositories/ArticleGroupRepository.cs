using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ArticleGroupRepository(ISqlConnectionFactory db, ArticleTreeRepository trees, EdariNexusClient edari)
{
    public async Task<IReadOnlyList<ArticleGroupDto>> ListGroupsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT g.id AS Id, g.name AS Name, g.back_colour AS BackColour, g.fore_colour AS ForeColour,
                   (SELECT COUNT(*) FROM article_group_items i WHERE i.article_group_id = g.id) AS ItemCount
            FROM article_groups g ORDER BY g.sort_index, g.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<ArticleGroupDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<ArticleGroupItemDto>> GetItemsAsync(long groupId, CancellationToken ct)
    {
        var sql = $"""
            SELECT i.id AS Id, a.id AS ProductId, a.Seq AS Seq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                   LTRIM(RTRIM(a.Barcode)) AS Barcode,
                   CAST(COALESCE(NULLIF(a.SellPr4,0), 0) AS decimal(18,0)) AS StoredPrice,
                   CAST(COALESCE(NULLIF(a.SellPr4,0), 0) AS decimal(18,0)) AS OriginalPrice,
                   CAST(COALESCE(ao.discount,0) AS decimal(18,2)) AS DiscountValue,
                   CAST(COALESCE(ao.discount_type,0) AS int) AS DiscountType,
                   ao.offer_name AS OfferName,
                   i.back_colour AS BackColour, i.fore_colour AS ForeColour
            FROM article_group_items i
            INNER JOIN articles a ON a.Seq = i.barcode_id
            LEFT JOIN (
                SELECT od.item_id, od.discount, od.discount_type, o.name AS offer_name,
                       ROW_NUMBER() OVER (PARTITION BY od.item_id ORDER BY o.priority DESC) AS rn
                FROM offer_details od INNER JOIN offers o ON od.offer_id = o.id WHERE o.enabled = 1
            ) ao ON a.Seq = ao.item_id AND ao.rn = 1
            WHERE i.article_group_id = @groupId AND COALESCE(a.SellPr4,0) > 0
            ORDER BY i.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<Row>(new CommandDefinition(sql, new { groupId }, cancellationToken: ct));
        return rows.Select(r =>
        {
            var (price, _, _, _) = ProductPricing.Compute(r.OriginalPrice, r.StoredPrice, r.DiscountValue, r.DiscountType, r.OfferName);
            return new ArticleGroupItemDto(r.Id, r.ProductId, r.Seq, r.Name, r.Barcode, price, r.OriginalPrice, r.BackColour, r.ForeColour);
        }).ToList();
    }

    public async Task<ArticleGroupDto> CreateAsync(CreateArticleGroupRequest req, CancellationToken ct)
    {
        var name = NormalizeName(req.Name);
        if (name.Length == 0) throw new InvalidOperationException("أدخل اسم المجموعة");
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO article_groups (name, back_colour, fore_colour, font_size, button_size, sort_index)
            VALUES (@name, @back, @fore, 9, 0, ISNULL((SELECT MAX(sort_index) FROM article_groups), -1) + 1);
            SELECT CAST(SCOPE_IDENTITY() AS BIGINT);
            """, new { name, back = req.BackColour, fore = req.ForeColour }, cancellationToken: ct));
        return new ArticleGroupDto(id, name, req.BackColour, req.ForeColour, 0);
    }

    public async Task<bool> UpdateAsync(long id, UpdateArticleGroupRequest req, CancellationToken ct)
    {
        var name = NormalizeName(req.Name);
        if (name.Length == 0) throw new InvalidOperationException("أدخل اسم المجموعة");
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE article_groups
            SET name = @name, back_colour = @back, fore_colour = @fore
            WHERE id = @id
            """, new { id, name, back = req.BackColour, fore = req.ForeColour }, cancellationToken: ct));
        return n > 0;
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM article_group_items WHERE article_group_id = @id",
            new { id }, cancellationToken: ct));
        var n = await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM article_groups WHERE id = @id",
            new { id }, cancellationToken: ct));
        return n > 0;
    }

    public async Task<ArticleGroupWriteResult> AddProductsAsync(long groupId, IReadOnlyList<long> seqs, CancellationToken ct)
    {
        if (!await ExistsAsync(groupId, ct)) throw new InvalidOperationException("المجموعة غير موجودة");
        var wanted = seqs.Where(s => s > 0 && s <= int.MaxValue).Distinct().ToArray();
        if (wanted.Length == 0) return new ArticleGroupWriteResult(0, 0);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var colors = await conn.QueryFirstOrDefaultAsync<(int Back, int Fore)>(new CommandDefinition(
            "SELECT back_colour AS Back, fore_colour AS Fore FROM article_groups WHERE id = @groupId",
            new { groupId }, cancellationToken: ct));

        var added = await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO article_group_items
                (barcode_id, article_group_id, back_colour, fore_colour, font_size, button_size, type_)
            SELECT CAST(a.Seq AS INT), @groupId, @back, @fore, 0, 0, 0
            FROM articles a
            WHERE a.Seq IN @seqs
              AND COALESCE(a.SellPr4, 0) > 0
              AND NOT EXISTS (
                  SELECT 1 FROM article_group_items i
                  WHERE i.article_group_id = @groupId AND i.barcode_id = a.Seq
              )
            """, new { groupId, seqs = wanted, back = colors.Back, fore = colors.Fore }, cancellationToken: ct));
        return new ArticleGroupWriteResult(added, Math.Max(0, wanted.Length - added));
    }

    public async Task<ArticleGroupWriteResult> AddTreesAsync(long groupId, IReadOnlyList<long> treeSeqs, CancellationToken ct)
    {
        var all = new List<long>();
        foreach (var treeSeq in treeSeqs.Where(s => s > 0).Distinct())
            all.AddRange(await ResolveTreeProductSeqsAsync(treeSeq, ct));
        return await AddProductsAsync(groupId, all, ct);
    }

    private async Task<IReadOnlyList<long>> ResolveTreeProductSeqsAsync(long treeSeq, CancellationToken ct)
    {
        try
        {
            if (await edari.MaterialExistsAsync(treeSeq, ct))
            {
                var seqs = await edari.GetDescendantProductSeqsAsync(treeSeq, ct);
                if (seqs.Count > 0) return seqs;
            }
        }
        catch
        {
            /* local fallback */
        }

        return await trees.GetDescendantProductSeqsAsync(treeSeq, ct);
    }

    public async Task<bool> RemoveItemAsync(long groupId, long itemId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition("""
            DELETE FROM article_group_items
            WHERE id = @itemId AND article_group_id = @groupId
            """, new { groupId, itemId }, cancellationToken: ct));
        return n > 0;
    }

    private async Task<bool> ExistsAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT CASE WHEN EXISTS(SELECT 1 FROM article_groups WHERE id = @id) THEN 1 ELSE 0 END",
            new { id }, cancellationToken: ct)) == 1;
    }

    private static string NormalizeName(string? name) => (name ?? "").Trim() is { Length: > 0 } t
        ? (t.Length > 50 ? t[..50] : t)
        : "";

    private sealed record Row(long Id, long ProductId, long Seq, string? Name, string? Barcode,
        decimal StoredPrice, decimal OriginalPrice, decimal? DiscountValue, int DiscountType, string? OfferName,
        int BackColour, int ForeColour);
}
