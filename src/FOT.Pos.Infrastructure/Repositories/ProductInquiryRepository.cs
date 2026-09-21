using System.Data;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ProductInquiryRepository(
    ISqlConnectionFactory db,
    EdariNexusClient edari,
    ArticleTreeRepository treeRepo)
{
    public const int MaxProducts = 3000;
    public const int MaxReceipts = 400;
    public const int MaxCommissionLines = 800;

    public async Task<ProductInquiryDto> QueryAsync(ProductInquiryRequest req, CancellationToken ct)
    {
        var from = (req.From ?? DateTime.Today.AddDays(-7)).Date;
        var to = (req.To ?? DateTime.Today).Date;
        if (to < from) to = from;
        var toExclusive = to.AddDays(1);
        var salesmanId = req.SalesmanId is > 0 ? req.SalesmanId : null;

        var seqs = await ResolveSeqsAsync(req, ct);
        if (seqs.Count == 0)
            throw new InvalidOperationException("اختر منتجاً أو شجرة أو مجموعة عمولة.");
        if (seqs.Count > MaxProducts)
            throw new InvalidOperationException("النطاق كبير جداً — قلّل الأشجار أو المنتجات (الحد 3000 صنف).");

        var scope = await BuildScopeAsync(req, seqs, ct);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await ArticleMatch.FillIdTableAsync(conn, "#inq_seqs", seqs, ct);
        try
        {
            var matchIds = (await conn.QueryAsync<long>(new CommandDefinition("""
                SELECT a.id FROM articles a INNER JOIN #inq_seqs s ON s.id = a.Seq
                UNION
                SELECT a.Seq FROM articles a INNER JOIN #inq_seqs s ON s.id = a.Seq
                WHERE NOT EXISTS (SELECT 1 FROM articles b WHERE b.id = a.Seq)
                """, cancellationToken: ct))).ToHashSet();
            await ArticleMatch.FillIdTableAsync(conn, "#inq_ids", matchIds, ct);
            try
            {
                var p = new DynamicParameters();
                p.Add("from", from);
                p.Add("toExclusive", toExclusive);
                p.Add("salesmanId", salesmanId);

                var salesSummary = await QuerySalesSummaryAsync(conn, p, ct);
                var commissionSummary = await QueryCommissionSummaryAsync(conn, p, ct);
                var productSales = await QueryProductSalesAsync(conn, p, ct);
                var productCommissions = await QueryProductCommissionsAsync(conn, p, ct);
                var salesmanSales = await QuerySalesmanSalesAsync(conn, p, ct);
                var salesmanCommissions = await QuerySalesmanCommissionsAsync(conn, p, ct);
                var receiptSales = await QueryReceiptSalesAsync(conn, p, ct);
                var receiptCommissions = await QueryReceiptCommissionsAsync(conn, p, ct);
                var commissionLines = await QueryCommissionLinesAsync(conn, p, ct);

                var products = MergeProducts(productSales, productCommissions);
                var salesmen = MergeSalesmen(salesmanSales, salesmanCommissions);
                var receiptsTruncated = receiptSales.Count > MaxReceipts;
                var receiptRows = MergeReceipts(
                    receiptsTruncated ? receiptSales.Take(MaxReceipts).ToList() : receiptSales,
                    receiptCommissions);
                var commissionsTruncated = commissionLines.Count > MaxCommissionLines;
                var commissions = (commissionsTruncated
                    ? commissionLines.Take(MaxCommissionLines)
                    : commissionLines)
                    .Select(c => new ProductInquiryCommissionRowDto(
                        c.Id, c.ReceiptId, c.ReceiptNumber, c.SaleDate, c.ArticleSeq, c.ProductName,
                        c.SalesmanId, c.SalesmanName, c.CommissionType, c.CommissionValue,
                        c.Quantity, c.LineAmount, c.CommissionAmount, c.CommissionGroupId, c.CommissionGroupName))
                    .ToList();

                var summary = new ProductInquirySummaryDto(
                    salesSummary.Quantity,
                    salesSummary.SalesAmount,
                    salesSummary.ReceiptCount,
                    commissionSummary.CommissionAmount,
                    commissionSummary.LineCount);

                return new ProductInquiryDto(
                    scope, summary, products, salesmen, commissions, receiptRows,
                    receiptsTruncated, commissionsTruncated);
            }
            finally
            {
                await ArticleMatch.DropTableAsync(conn, "#inq_ids", ct);
            }
        }
        finally
        {
            await ArticleMatch.DropTableAsync(conn, "#inq_seqs", ct);
        }
    }

    private async Task<HashSet<long>> ResolveSeqsAsync(ProductInquiryRequest req, CancellationToken ct)
    {
        var set = new HashSet<long>();
        if (req.ArticleSeqs is { Count: > 0 })
        {
            foreach (var seq in req.ArticleSeqs.Where(x => x > 0))
                set.Add(seq);
        }
        if (req.TreeSeqs is { Count: > 0 })
        {
            foreach (var treeSeq in req.TreeSeqs.Where(x => x > 0).Distinct())
            {
                foreach (var seq in await ResolveTreeProductSeqsAsync(treeSeq, ct))
                    set.Add(seq);
            }
        }
        if (req.CommissionGroupId is > 0)
        {
            foreach (var seq in await LoadGroupSeqsAsync(req.CommissionGroupId.Value, ct))
                set.Add(seq);
        }
        return set;
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
        catch { /* local fallback */ }
        return await treeRepo.GetDescendantProductSeqsAsync(treeSeq, ct);
    }

    private async Task<List<long>> LoadGroupSeqsAsync(long groupId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var exists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_commission_groups WHERE id=@id",
            new { id = groupId }, cancellationToken: ct));
        if (exists == 0)
            throw new InvalidOperationException("مجموعة العمولة غير موجودة.");

        var seqs = await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT DISTINCT article_id
            FROM ext_commission_group_items
            WHERE group_id=@id AND article_id IS NOT NULL AND article_id > 0
              AND COALESCE(excluded, 0) = 0
            """, new { id = groupId }, cancellationToken: ct));
        return seqs.ToList();
    }

    private async Task<ProductInquiryScopeDto> BuildScopeAsync(
        ProductInquiryRequest req, HashSet<long> seqs, CancellationToken ct)
    {
        if (req.CommissionGroupId is > 0 &&
            (req.ArticleSeqs is null || req.ArticleSeqs.Count == 0) &&
            (req.TreeSeqs is null || req.TreeSeqs.Count == 0))
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var name = await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
                "SELECT name FROM ext_commission_groups WHERE id=@id",
                new { id = req.CommissionGroupId.Value }, cancellationToken: ct));
            return new ProductInquiryScopeDto("group", name, seqs.Count, req.CommissionGroupId);
        }

        if (req.TreeSeqs is { Count: > 0 } && (req.ArticleSeqs is null || req.ArticleSeqs.Count == 0))
        {
            var first = req.TreeSeqs.First(x => x > 0);
            var treeName = await treeRepo.GetNodeNameAsync(first, ct);
            var extra = req.TreeSeqs.Count(x => x > 0) > 1
                ? $" +{req.TreeSeqs.Count(x => x > 0) - 1}"
                : "";
            return new ProductInquiryScopeDto("tree", (treeName ?? $"شجرة #{first}") + extra, seqs.Count);
        }

        return new ProductInquiryScopeDto("product", $"{seqs.Count} صنف", seqs.Count);
    }

    private static CommandDefinition Cmd(string sql, DynamicParameters p, CancellationToken ct) =>
        new(sql, p, cancellationToken: ct, commandTimeout: 90);

    private static async Task<SalesSummaryRow> QuerySalesSummaryAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct)
    {
        var row = await conn.QueryFirstOrDefaultAsync<SalesSummaryRow>(Cmd("""
            SELECT
                CAST(COALESCE(SUM(ri.quantity), 0) AS DECIMAL(18,6)) AS Quantity,
                CAST(COALESCE(SUM(ri.quantity * ri.price), 0) AS DECIMAL(18,2)) AS SalesAmount,
                COUNT(DISTINCT r.id) AS ReceiptCount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            INNER JOIN #inq_ids x ON x.id = ri.article_id
            WHERE r.creation_date >= @from AND r.creation_date < @toExclusive
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND (@salesmanId IS NULL OR COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) = @salesmanId)
            """, p, ct));
        return row ?? new SalesSummaryRow();
    }

    private static async Task<CommissionSummaryRow> QueryCommissionSummaryAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct)
    {
        var row = await conn.QueryFirstOrDefaultAsync<CommissionSummaryRow>(Cmd("""
            SELECT
                CAST(COALESCE(SUM(c.commission_amount), 0) AS DECIMAL(18,2)) AS CommissionAmount,
                COUNT(*) AS LineCount
            FROM ext_commission_calculations c
            INNER JOIN #inq_seqs s ON s.id = c.article_id
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < @toExclusive
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            """, p, ct));
        return row ?? new CommissionSummaryRow();
    }

    private static async Task<List<ProductSaleRow>> QueryProductSalesAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<ProductSaleRow>(Cmd("""
            SELECT
                COALESCE(a.Seq, ri.article_id) AS ArticleSeq,
                LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS ProductName,
                COALESCE(LTRIM(RTRIM(a.Barcode)), LTRIM(RTRIM(ri.barcode))) AS Barcode,
                CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS Quantity,
                CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS SalesAmount,
                COUNT(DISTINCT r.id) AS ReceiptCount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            INNER JOIN #inq_ids x ON x.id = ri.article_id
            LEFT JOIN articles a ON a.id = ri.article_id
            WHERE r.creation_date >= @from AND r.creation_date < @toExclusive
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND (@salesmanId IS NULL OR COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) = @salesmanId)
            GROUP BY COALESCE(a.Seq, ri.article_id), a.Name1, a.Barcode, ri.barcode
            """, p, ct))).ToList();

    private static async Task<List<ProductCommissionRow>> QueryProductCommissionsAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<ProductCommissionRow>(Cmd("""
            SELECT
                c.article_id AS ArticleSeq,
                COALESCE(
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))),
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1)))) AS ProductName,
                CAST(SUM(c.commission_amount) AS DECIMAL(18,2)) AS CommissionAmount
            FROM ext_commission_calculations c
            INNER JOIN #inq_seqs s ON s.id = c.article_id
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN articles a ON a.Seq = c.article_id
            LEFT JOIN articles a2 ON a2.id = c.article_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < @toExclusive
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY c.article_id, a.Name1, a2.Name1
            """, p, ct))).ToList();

    private static async Task<List<SalesmanSaleRow>> QuerySalesmanSalesAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<SalesmanSaleRow>(Cmd("""
            SELECT
                COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع') AS SalesmanName,
                CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS Quantity,
                CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS SalesAmount,
                COUNT(DISTINCT r.id) AS ReceiptCount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            INNER JOIN #inq_ids x ON x.id = ri.article_id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
            WHERE r.creation_date >= @from AND r.creation_date < @toExclusive
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND (@salesmanId IS NULL OR COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) = @salesmanId)
            GROUP BY COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0),
                     COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع')
            """, p, ct))).ToList();

    private static async Task<List<SalesmanCommissionRow>> QuerySalesmanCommissionsAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<SalesmanCommissionRow>(Cmd("""
            SELECT
                c.salesman_id AS SalesmanId,
                COALESCE(s.name, N'بدون بائع') AS SalesmanName,
                CAST(SUM(c.commission_amount) AS DECIMAL(18,2)) AS CommissionAmount
            FROM ext_commission_calculations c
            INNER JOIN #inq_seqs seq ON seq.id = c.article_id
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN salesmen s ON s.id = c.salesman_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < @toExclusive
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY c.salesman_id, s.name
            """, p, ct))).ToList();

    private static async Task<List<ReceiptSaleRow>> QueryReceiptSalesAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<ReceiptSaleRow>(Cmd($"""
            SELECT TOP ({MaxReceipts + 1})
                r.id AS ReceiptId,
                r.number AS ReceiptNumber,
                r.creation_date AS SaleDate,
                COALESCE(NULLIF(r.salesman, 0), 0) AS SalesmanId,
                COALESCE(s.name, N'بدون بائع') AS SalesmanName,
                CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS Quantity,
                CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS SalesAmount,
                COUNT(*) AS LineCount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            INNER JOIN #inq_ids x ON x.id = ri.article_id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(r.salesman, 0), 0)
            WHERE r.creation_date >= @from AND r.creation_date < @toExclusive
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND (@salesmanId IS NULL OR COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) = @salesmanId)
            GROUP BY r.id, r.number, r.creation_date, r.salesman, s.name
            ORDER BY r.creation_date DESC, r.id DESC
            """, p, ct))).ToList();

    private static async Task<List<ReceiptCommissionRow>> QueryReceiptCommissionsAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<ReceiptCommissionRow>(Cmd("""
            SELECT
                c.receipt_id AS ReceiptId,
                CAST(SUM(c.commission_amount) AS DECIMAL(18,2)) AS CommissionAmount
            FROM ext_commission_calculations c
            INNER JOIN #inq_seqs seq ON seq.id = c.article_id
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < @toExclusive
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY c.receipt_id
            """, p, ct))).ToList();

    private static async Task<List<CommissionLineRow>> QueryCommissionLinesAsync(
        IDbConnection conn, DynamicParameters p, CancellationToken ct) =>
        (await conn.QueryAsync<CommissionLineRow>(Cmd($"""
            SELECT TOP ({MaxCommissionLines + 1})
                c.id AS Id,
                c.receipt_id AS ReceiptId,
                r.number AS ReceiptNumber,
                COALESCE(r.creation_date, c.calculated_at) AS SaleDate,
                c.article_id AS ArticleSeq,
                COALESCE(
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))),
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1)))) AS ProductName,
                c.salesman_id AS SalesmanId,
                s.name AS SalesmanName,
                c.commission_type AS CommissionType,
                CAST(c.commission_value AS DECIMAL(18,6)) AS CommissionValue,
                CAST(c.quantity AS DECIMAL(18,6)) AS Quantity,
                CAST(c.line_amount AS DECIMAL(18,2)) AS LineAmount,
                CAST(c.commission_amount AS DECIMAL(18,2)) AS CommissionAmount,
                c.commission_group_id AS CommissionGroupId,
                c.commission_group_name AS CommissionGroupName
            FROM ext_commission_calculations c
            INNER JOIN #inq_seqs seq ON seq.id = c.article_id
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN articles a ON a.Seq = c.article_id
            LEFT JOIN articles a2 ON a2.id = c.article_id
            LEFT JOIN salesmen s ON s.id = c.salesman_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < @toExclusive
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            ORDER BY COALESCE(r.creation_date, c.calculated_at) DESC, c.id DESC
            """, p, ct))).ToList();

    private static IReadOnlyList<ProductInquiryProductRowDto> MergeProducts(
        List<ProductSaleRow> sales, List<ProductCommissionRow> commissions)
    {
        var map = new Dictionary<long, ProductInquiryProductRowDto>();
        foreach (var s in sales)
        {
            map[s.ArticleSeq] = new ProductInquiryProductRowDto(
                s.ArticleSeq, s.ProductName, s.Barcode, s.Quantity, s.SalesAmount, 0, s.ReceiptCount);
        }
        foreach (var c in commissions)
        {
            if (map.TryGetValue(c.ArticleSeq, out var row))
            {
                map[c.ArticleSeq] = row with { CommissionAmount = c.CommissionAmount };
            }
            else
            {
                map[c.ArticleSeq] = new ProductInquiryProductRowDto(
                    c.ArticleSeq, c.ProductName, null, 0, 0, c.CommissionAmount, 0);
            }
        }
        return map.Values
            .OrderByDescending(r => r.SalesAmount)
            .ThenByDescending(r => r.CommissionAmount)
            .ToList();
    }

    private static IReadOnlyList<ProductInquirySalesmanRowDto> MergeSalesmen(
        List<SalesmanSaleRow> sales, List<SalesmanCommissionRow> commissions)
    {
        var map = new Dictionary<long, ProductInquirySalesmanRowDto>();
        foreach (var s in sales)
        {
            map[s.SalesmanId] = new ProductInquirySalesmanRowDto(
                s.SalesmanId, s.SalesmanName, s.Quantity, s.SalesAmount, 0, s.ReceiptCount);
        }
        foreach (var c in commissions)
        {
            if (map.TryGetValue(c.SalesmanId, out var row))
            {
                map[c.SalesmanId] = row with { CommissionAmount = c.CommissionAmount };
            }
            else
            {
                map[c.SalesmanId] = new ProductInquirySalesmanRowDto(
                    c.SalesmanId, c.SalesmanName, 0, 0, c.CommissionAmount, 0);
            }
        }
        return map.Values
            .OrderByDescending(r => r.CommissionAmount)
            .ThenByDescending(r => r.SalesAmount)
            .ToList();
    }

    private static IReadOnlyList<ProductInquiryReceiptRowDto> MergeReceipts(
        List<ReceiptSaleRow> sales, List<ReceiptCommissionRow> commissions)
    {
        var commissionByReceipt = commissions.ToDictionary(c => c.ReceiptId, c => c.CommissionAmount);
        var rows = sales.Select(s => new ProductInquiryReceiptRowDto(
            s.ReceiptId, s.ReceiptNumber, s.SaleDate, s.SalesmanId, s.SalesmanName,
            s.Quantity, s.SalesAmount, commissionByReceipt.GetValueOrDefault(s.ReceiptId), s.LineCount)).ToList();
        return rows;
    }

    private sealed class SalesSummaryRow
    {
        public decimal Quantity { get; set; }
        public decimal SalesAmount { get; set; }
        public int ReceiptCount { get; set; }
    }

    private sealed class CommissionSummaryRow
    {
        public decimal CommissionAmount { get; set; }
        public int LineCount { get; set; }
    }

    private sealed class ProductSaleRow
    {
        public long ArticleSeq { get; set; }
        public string? ProductName { get; set; }
        public string? Barcode { get; set; }
        public decimal Quantity { get; set; }
        public decimal SalesAmount { get; set; }
        public int ReceiptCount { get; set; }
    }

    private sealed class ProductCommissionRow
    {
        public long ArticleSeq { get; set; }
        public string? ProductName { get; set; }
        public decimal CommissionAmount { get; set; }
    }

    private sealed class SalesmanSaleRow
    {
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public decimal Quantity { get; set; }
        public decimal SalesAmount { get; set; }
        public int ReceiptCount { get; set; }
    }

    private sealed class SalesmanCommissionRow
    {
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public decimal CommissionAmount { get; set; }
    }

    private sealed class ReceiptSaleRow
    {
        public long ReceiptId { get; set; }
        public long? ReceiptNumber { get; set; }
        public DateTime? SaleDate { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public decimal Quantity { get; set; }
        public decimal SalesAmount { get; set; }
        public int LineCount { get; set; }
    }

    private sealed class ReceiptCommissionRow
    {
        public long ReceiptId { get; set; }
        public decimal CommissionAmount { get; set; }
    }

    private sealed class CommissionLineRow
    {
        public long Id { get; set; }
        public long ReceiptId { get; set; }
        public long? ReceiptNumber { get; set; }
        public DateTime? SaleDate { get; set; }
        public long ArticleSeq { get; set; }
        public string? ProductName { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public string? CommissionType { get; set; }
        public decimal CommissionValue { get; set; }
        public decimal Quantity { get; set; }
        public decimal LineAmount { get; set; }
        public decimal CommissionAmount { get; set; }
        public long? CommissionGroupId { get; set; }
        public string? CommissionGroupName { get; set; }
    }
}
