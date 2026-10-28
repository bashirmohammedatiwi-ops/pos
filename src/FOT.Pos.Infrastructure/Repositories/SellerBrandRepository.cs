using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// براندات البائع: ربط حساب البائع بشجرة مواد أو أكثر، وبناء حزمة مبيعات كل شجرة لويب البائعين.
/// الحزمة مضغوطة: قائمة مواد + صفوف (يوم، مادة، قسم) بالكمية والمبلغ الصافي (المرتجع سالب، الهدايا مستبعدة)
/// مع حصة البائع نفسه، فيحسب الويب أي مدة يختارها البائع دون الرجوع للمحل.
/// </summary>
public sealed class SellerBrandRepository(ISqlConnectionFactory db, ArticleTreeRepository trees)
{
    public async Task<IReadOnlyList<SellerBrandLinkDto>> ListLinksAsync(long? salesmanId, CancellationToken ct)
    {
        var sql = """
            SELECT salesman_id AS SalesmanId, tree_seq AS TreeSeq,
                   COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(300), a.Name1))), N''), t.tree_name, N'شجرة #' + CAST(t.tree_seq AS NVARCHAR(30))) AS TreeName,
                   sort_order AS SortOrder
            FROM ext_seller_brand_trees t
            LEFT JOIN articles a ON a.Seq = t.tree_seq
            """ + (salesmanId is null ? "" : " WHERE t.salesman_id = @salesmanId") + """
             ORDER BY t.salesman_id, t.sort_order, t.tree_seq
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<SellerBrandLinkDto>(new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct))).ToList();
    }

    public async Task SetLinksAsync(long salesmanId, IReadOnlyList<SellerBrandTreeInput> links, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_seller_brand_trees WHERE salesman_id = @salesmanId", new { salesmanId }, tx, cancellationToken: ct));
        var order = 0;
        foreach (var l in links.Where(x => x.TreeSeq > 0).GroupBy(x => x.TreeSeq).Select(g => g.First()))
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_seller_brand_trees (salesman_id, tree_seq, tree_name, sort_order)
                VALUES (@salesmanId, @treeSeq, @treeName, @order)
                """, new { salesmanId, treeSeq = l.TreeSeq, treeName = l.TreeName, order = order++ }, tx, cancellationToken: ct));
        }
        await tx.CommitAsync(ct);
    }

    /// <summary>حزمة مبيعات شجرة منذ @from (صافية، بلا هدايا) لكل (يوم، مادة، قسم) مع حصة كل بائع مطلوب.</summary>
    public async Task<SellerBrandPackDto> BuildPackAsync(long treeSeq, string treeName, DateTime from, CancellationToken ct)
    {
        var seqs = await trees.GetDescendantProductSeqsAsync(treeSeq, ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var ids = await ArticleMatch.ExpandReceiptMatchIdsAsync(conn, seqs, ct);
        await ArticleMatch.DropTableAsync(conn, "#brand_ids", ct);
        await ArticleMatch.FillIdTableAsync(conn, "#brand_ids", ids, ct);
        try
        {
            var products = (await conn.QueryAsync<SellerBrandProductDto>(new CommandDefinition("""
                SELECT a.id AS Id,
                       LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                       COALESCE(NULLIF(LTRIM(RTRIM(a.Barcode)), N''), LTRIM(RTRIM(a.Num))) AS Barcode,
                       CAST(COALESCE(a.SellPr4, 0) AS DECIMAL(18,0)) AS Price
                FROM articles a
                INNER JOIN #brand_ids x ON x.id = a.id
                UNION ALL
                -- بنود قديمة سُجّل فيها Seq بدل id
                SELECT a.Seq AS Id,
                       LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))),
                       COALESCE(NULLIF(LTRIM(RTRIM(a.Barcode)), N''), LTRIM(RTRIM(a.Num))),
                       CAST(COALESCE(a.SellPr4, 0) AS DECIMAL(18,0))
                FROM articles a
                INNER JOIN #brand_ids x ON x.id = a.Seq
                WHERE NOT EXISTS (SELECT 1 FROM articles b WHERE b.id = a.Seq)
                """, commandTimeout: 120, cancellationToken: ct))).ToList();

            var rows = (await conn.QueryAsync<SellerBrandRowRaw>(new CommandDefinition("""
                SELECT CONVERT(CHAR(10), CAST(r.creation_date AS date), 23) AS Day,
                       ri.article_id AS ArticleId,
                       COALESCE(NULLIF(pos.section_id, 0), c.section_id, 0) AS SectionId,
                       COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                       CAST(SUM(CASE WHEN r.kind = 1 THEN -ri.quantity ELSE ri.quantity END) AS DECIMAL(18,3)) AS Qty,
                       CAST(SUM(CASE WHEN r.kind = 1 THEN -ri.quantity * ri.price ELSE ri.quantity * ri.price END) AS DECIMAL(18,2)) AS Amount
                FROM reciept_items ri
                INNER JOIN #brand_ids x ON x.id = ri.article_id
                INNER JOIN reciepts r ON r.id = ri.reciept_id
                LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
                LEFT JOIN cashiers c ON c.id = r.cashier_id
                WHERE r.creation_date >= @from AND r.is_pending = 0 AND r.kind IN (0, 1)
                GROUP BY CAST(r.creation_date AS date), ri.article_id,
                         COALESCE(NULLIF(pos.section_id, 0), c.section_id, 0),
                         COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
                """, new { from = from.Date }, commandTimeout: 180, cancellationToken: ct))).ToList();

            // فواتير البيع التي فيها مادة واحدة على الأقل من البراند — عدّ مستقل كي لا تتكرر الفاتورة لكل مادة
            var receiptRows = (await conn.QueryAsync<SellerBrandReceiptRaw>(new CommandDefinition("""
                SELECT CONVERT(CHAR(10), CAST(r.creation_date AS date), 23) AS Day,
                       COALESCE(NULLIF(pos.section_id, 0), c.section_id, 0) AS SectionId,
                       COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                       COUNT(DISTINCT r.id) AS Receipts
                FROM reciept_items ri
                INNER JOIN #brand_ids x ON x.id = ri.article_id
                INNER JOIN reciepts r ON r.id = ri.reciept_id
                LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
                LEFT JOIN cashiers c ON c.id = r.cashier_id
                WHERE r.creation_date >= @from AND r.is_pending = 0 AND r.kind = 0
                GROUP BY CAST(r.creation_date AS date),
                         COALESCE(NULLIF(pos.section_id, 0), c.section_id, 0),
                         COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
                """, new { from = from.Date }, commandTimeout: 180, cancellationToken: ct))).ToList();

            // إجمالي الفواتير بلا تقسيم بائع — فاتورة فيها بنود لبائعَين تُعد مرة واحدة في «كل المحل»
            var receiptTotals = (await conn.QueryAsync<SellerBrandReceiptRaw>(new CommandDefinition("""
                SELECT CONVERT(CHAR(10), CAST(r.creation_date AS date), 23) AS Day,
                       COALESCE(NULLIF(pos.section_id, 0), c.section_id, 0) AS SectionId,
                       CAST(0 AS BIGINT) AS SalesmanId,
                       COUNT(DISTINCT r.id) AS Receipts
                FROM reciept_items ri
                INNER JOIN #brand_ids x ON x.id = ri.article_id
                INNER JOIN reciepts r ON r.id = ri.reciept_id
                LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
                LEFT JOIN cashiers c ON c.id = r.cashier_id
                WHERE r.creation_date >= @from AND r.is_pending = 0 AND r.kind = 0
                GROUP BY CAST(r.creation_date AS date), COALESCE(NULLIF(pos.section_id, 0), c.section_id, 0)
                """, new { from = from.Date }, commandTimeout: 180, cancellationToken: ct))).ToList();

            var sections = (await conn.QueryAsync<SellerBrandSectionDto>(new CommandDefinition("""
                SELECT id AS Id, LTRIM(RTRIM(CONVERT(NVARCHAR(300), name))) AS Name FROM sections
                """, cancellationToken: ct))).ToList();

            // مضغوط: [يوم, مادة, قسم, بائع, كمية, مبلغ] و[يوم, قسم, بائع, فواتير]
            var compact = rows.Select(r => new object[] { r.Day, r.ArticleId, r.SectionId, r.SalesmanId, r.Qty, r.Amount }).ToList();
            var compactReceipts = receiptRows.Select(r => new object[] { r.Day, r.SectionId, r.SalesmanId, r.Receipts }).ToList();
            var compactTotals = receiptTotals.Select(r => new object[] { r.Day, r.SectionId, r.Receipts }).ToList();
            var usedSections = rows.Select(r => r.SectionId).ToHashSet();
            return new SellerBrandPackDto(
                treeSeq,
                treeName,
                DateTime.UtcNow,
                from.Date,
                products,
                sections.Where(s => usedSections.Contains(s.Id)).ToList(),
                compact,
                compactReceipts,
                compactTotals);
        }
        finally
        {
            await ArticleMatch.DropTableAsync(conn, "#brand_ids", ct);
        }
    }

    private sealed class SellerBrandRowRaw
    {
        public string Day { get; set; } = "";
        public long ArticleId { get; set; }
        public long SectionId { get; set; }
        public long SalesmanId { get; set; }
        public decimal Qty { get; set; }
        public decimal Amount { get; set; }
    }

    private sealed class SellerBrandReceiptRaw
    {
        public string Day { get; set; } = "";
        public long SectionId { get; set; }
        public long SalesmanId { get; set; }
        public int Receipts { get; set; }
    }
}
