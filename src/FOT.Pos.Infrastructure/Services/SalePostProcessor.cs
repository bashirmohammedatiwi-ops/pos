using System.Data.Common;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Services;

public sealed class SalePostProcessor(
    ISqlConnectionFactory db,
    CommissionGroupRepository groups,
    ILogger<SalePostProcessor> logger)
{
    private const int RecalcReceiptCap = 3000;

    private sealed class RuleRow
    {
        public long Id { get; init; }
        public long? ProductId { get; init; }
        public string? Barcode { get; init; }
        public long? SalesmanId { get; init; }
        public string CommissionType { get; init; } = "";
        public decimal CommissionValue { get; init; }
    }

    private sealed class ItemRow
    {
        public long Id { get; init; }
        public long ArticleId { get; init; }
        public long ArticleSeq { get; init; }
        public string? Barcode { get; init; }
        public string? ProductName { get; init; }
        public decimal Quantity { get; init; }
        public decimal Price { get; init; }
        public long SalesmanId { get; init; }
    }

    private sealed class ReceiptMeta
    {
        public int Kind { get; init; }
        public long SalesmanId { get; init; }
        // Receipt numbers are {year}{cashier}{seq} — long, or Dapper overflows.
        public long Number { get; init; }
        public DateTime CreationDate { get; init; }
        public int IsPending { get; init; }
        public long CashierId { get; init; }
    }

    public async Task<int> ProcessAsync(long receiptId, long fallbackSalesmanId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            return await ProcessOnConnectionAsync(conn, receiptId, fallbackSalesmanId, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Commission posting failed for receipt {ReceiptId}", receiptId);
            return 0;
        }
    }

    public async Task<RecalculateCommissionsResult> RecalculateAsync(
        RecalculateCommissionsRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        if (req.ReceiptId is > 0)
        {
            var lines = await ProcessOnConnectionAsync(conn, req.ReceiptId.Value, 0, ct);
            return new RecalculateCommissionsResult(
                1, 1, lines, lines == 0 ? 1 : 0,
                lines > 0
                    ? $"أُعيد حساب الفاتورة #{req.ReceiptId} — {lines} سطر عمولة"
                    : $"لم تُحتسب عمولة للفاتورة #{req.ReceiptId}. راجع التشخيص.");
        }

        var from = (req.From ?? DateTime.Today.AddDays(-30)).Date;
        var to = (req.To ?? DateTime.Today).Date;
        var ids = (await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT TOP (@cap) id
            FROM reciepts
            WHERE creation_date >= @from
              AND creation_date < DATEADD(day, 1, @to)
              AND (is_pending = 0 OR is_pending IS NULL)
            ORDER BY id
            """, new { from, to, cap = RecalcReceiptCap }, cancellationToken: ct))).ToList();

        var processed = 0;
        var written = 0;
        foreach (var id in ids)
        {
            ct.ThrowIfCancellationRequested();
            written += await ProcessOnConnectionAsync(conn, id, 0, ct);
            processed++;
        }

        return new RecalculateCommissionsResult(
            ids.Count, processed, written, Math.Max(0, processed - written),
            processed == 0
                ? "لا فواتير في الفترة المحددة"
                : $"أُعيد حساب {processed} فاتورة — سُجّل {written} سطر عمولة.");
    }

    public async Task<CommissionPreviewDto> PreviewAsync(CommissionPreviewRequest req, CancellationToken ct)
    {
        var qty = req.Quantity > 0 ? req.Quantity : 1;
        var price = req.Price;
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        long articleId = req.ArticleId ?? 0;
        long articleSeq = articleId;
        string? barcode = string.IsNullOrWhiteSpace(req.Barcode) ? null : req.Barcode.Trim();
        string? productName = null;

        try
        {
            var row = await conn.QueryFirstOrDefaultAsync<(long Id, long Seq, string? Name, string? Barcode)>(
                new CommandDefinition("""
                    SELECT TOP 1 a.id AS Id, a.Seq AS Seq,
                           LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                           a.Barcode AS Barcode
                    FROM articles a
                    WHERE (@id > 0 AND (a.id = @id OR a.Seq = @id))
                       OR (@barcode IS NOT NULL AND LTRIM(RTRIM(a.Barcode)) = @barcode)
                    ORDER BY CASE
                        WHEN @id > 0 AND a.Seq = @id THEN 0
                        WHEN @id > 0 AND a.id = @id THEN 1
                        ELSE 2
                    END
                    """, new { id = articleId, barcode }, cancellationToken: ct));
            if (row.Id > 0)
            {
                articleId = row.Id;
                articleSeq = row.Seq > 0 ? row.Seq : row.Id;
                productName = row.Name;
                barcode ??= row.Barcode;
                if (price <= 0)
                {
                    price = await conn.ExecuteScalarAsync<decimal?>(new CommandDefinition(
                        "SELECT TOP 1 CAST(SellPr4 AS DECIMAL(18,6)) FROM articles WHERE id=@id",
                        new { id = articleId }, cancellationToken: ct)) ?? 0;
                }
            }
        }
        catch
        {
            /* keep request values */
        }

        var item = new ItemRow
        {
            Id = 0,
            ArticleId = articleId,
            ArticleSeq = articleSeq,
            Barcode = barcode,
            ProductName = productName,
            Quantity = qty,
            Price = price,
            SalesmanId = req.SalesmanId
        };

        IReadOnlyList<CommissionGroupRepository.GroupMatchRow> matchers;
        try { matchers = await groups.GetActiveMatchersAsync(conn, null, ct); }
        catch { matchers = []; }
        var rules = await LoadRulesAsync(conn, ct);

        var productHits = matchers.Where(m => ProductMatches(m.ArticleId, m.Barcode, item)).ToList();
        var ruleHits = rules.Where(r => ProductMatches(r.ProductId, r.Barcode, item)).ToList();
        var salesman = ResolveSalesman(item, req.SalesmanId, 0, productHits, ruleHits);

        if (productHits.Count == 0 && ruleHits.Count == 0)
        {
            return new CommissionPreviewDto(false, null, null, null, productName, articleSeq, null, 0, 0, salesman,
                "المنتج غير مربوط بمجموعة أو قاعدة عمولة نشطة");
        }

        if (salesman <= 0)
        {
            return new CommissionPreviewDto(false, null, null, null, productName, articleSeq, null, 0, 0, 0,
                "حدد مندوباً لحساب العمولة");
        }

        var match = PickGroup(productHits, salesman);
        if (match is not null)
        {
            var amount = CommissionCalculator.ComputeAmount(match.CommissionType, match.CommissionValue, qty, qty * price);
            return new CommissionPreviewDto(amount != 0, "group", match.GroupId, match.GroupName, productName, articleSeq,
                match.CommissionType, match.CommissionValue, amount, salesman,
                amount != 0 ? "مطابق لمجموعة عمولة" : "مطابق لكن ناتج العمولة صفر");
        }

        var rule = PickRule(ruleHits, salesman);
        if (rule is not null)
        {
            var amount = CommissionCalculator.ComputeAmount(rule.CommissionType, rule.CommissionValue, qty, qty * price);
            return new CommissionPreviewDto(amount != 0, "rule", null, null, productName, articleSeq,
                rule.CommissionType, rule.CommissionValue, amount, salesman,
                amount != 0 ? "مطابق لقاعدة فردية" : "مطابق لكن ناتج العمولة صفر");
        }

        return new CommissionPreviewDto(false, null, null, null, productName, articleSeq, null, 0, 0, salesman,
            "المنتج مربوط بعمولة لكن المندوب لا يطابق مندوبي المجموعة/القاعدة");
    }

    public async Task<CommissionReceiptDiagnoseDto?> DiagnoseReceiptAsync(long receiptId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var meta = await LoadReceiptMetaAsync(conn, receiptId, ct);
        if (meta is null) return null;

        var items = await LoadItemsAsync(conn, receiptId, meta.SalesmanId, ct);
        IReadOnlyList<CommissionGroupRepository.GroupMatchRow> matchers;
        try { matchers = await groups.GetActiveMatchersAsync(conn, null, ct); }
        catch { matchers = []; }

        var rules = await LoadRulesAsync(conn, ct);
        var existing = (await conn.QueryAsync<(long? ItemId, decimal Amount, string? GroupName)>(
            new CommandDefinition("""
                SELECT receipt_item_id AS ItemId, commission_amount AS Amount, commission_group_name AS GroupName
                FROM ext_commission_calculations WHERE receipt_id = @receiptId
                """, new { receiptId }, cancellationToken: ct))).ToList();

        var lines = new List<CommissionLineDiagnoseDto>();
        foreach (var item in items)
        {
            var calc = existing.FirstOrDefault(c => c.ItemId == item.Id);
            var productHits = matchers.Where(m => ProductMatches(m.ArticleId, m.Barcode, item)).ToList();
            var ruleHits = rules.Where(r => ProductMatches(r.ProductId, r.Barcode, item)).ToList();
            var salesman = ResolveSalesman(item, meta.SalesmanId, 0, productHits, ruleHits);

            string status;
            string message;
            string? groupName = calc.GroupName;
            decimal? amount = calc.ItemId == item.Id || calc.Amount != 0 ? calc.Amount : null;
            var hasCalc = existing.Any(c => c.ItemId == item.Id);

            if (hasCalc)
            {
                status = "ok";
                message = "محسوبة";
            }
            else if (productHits.Count == 0 && ruleHits.Count == 0)
            {
                status = "no-match";
                message = "المنتج غير مربوط بمجموعة أو قاعدة عمولة نشطة";
            }
            else if (salesman <= 0)
            {
                status = "no-salesman";
                message = "لا يوجد مندوب على السطر ولا على الفاتورة ولا مندوب وحيد في المجموعة";
            }
            else
            {
                var match = PickGroup(productHits, salesman);
                var rule = match is null ? PickRule(ruleHits, salesman) : null;
                if (match is null && rule is null)
                {
                    status = "salesman-mismatch";
                    message = "المنتج مربوط بعمولة لكن المندوب لا يطابق مندوبي المجموعة/القاعدة";
                }
                else
                {
                    var lineAmount = item.Quantity * item.Price;
                    var type = match is not null ? match.CommissionType : rule!.CommissionType;
                    var value = match is not null ? match.CommissionValue : rule!.CommissionValue;
                    var commission = CommissionCalculator.ComputeAmount(type, value, item.Quantity, lineAmount);
                    if (meta.Kind == 1) commission = -Math.Abs(commission);
                    if (commission == 0)
                    {
                        status = "zero";
                        message = "ناتج العمولة صفر (قيمة صغيرة بعد التقريب أو كمية/سعر صفر)";
                    }
                    else
                    {
                        status = "pending";
                        message = "مطابق لكن لم يُحفظ — أعد الحساب";
                        groupName = match?.GroupName;
                        amount = commission;
                    }
                }
            }

            lines.Add(new CommissionLineDiagnoseDto(
                item.Id, item.ArticleId, item.ArticleSeq, item.ProductName, item.Barcode,
                salesman > 0 ? salesman : item.SalesmanId,
                item.Quantity, item.Price, hasCalc, hasCalc ? calc.Amount : amount,
                groupName, status, message));
        }

        return new CommissionReceiptDiagnoseDto(
            receiptId, meta.Number, meta.CreationDate, meta.SalesmanId,
            items.Count, existing.Count, lines);
    }

    private async Task<int> ProcessOnConnectionAsync(
        DbConnection conn, long receiptId, long fallbackSalesmanId, CancellationToken ct)
    {
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM ext_commission_calculations WHERE receipt_id = @receiptId",
                new { receiptId }, cancellationToken: ct));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "ext_commission_calculations missing or delete failed for {ReceiptId}", receiptId);
            return 0;
        }

        var meta = await LoadReceiptMetaAsync(conn, receiptId, ct);
        if (meta is null || meta.IsPending != 0) return 0;
        if (meta.CashierId > 0 && !await CashierAppliesCommissionsAsync(conn, meta.CashierId, ct))
            return 0;

        var receiptSalesman = meta.SalesmanId > 0 ? meta.SalesmanId : fallbackSalesmanId;
        var items = await LoadItemsAsync(conn, receiptId, receiptSalesman, ct);
        if (items.Count == 0) return 0;

        IReadOnlyList<CommissionGroupRepository.GroupMatchRow> groupMatchers;
        try
        {
            groupMatchers = await groups.GetActiveMatchersAsync(conn, null, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to load commission group matchers");
            groupMatchers = [];
        }

        var written = 0;
        var matchedItems = new HashSet<long>();

        foreach (var item in items)
        {
            var productHits = groupMatchers.Where(m => ProductMatches(m.ArticleId, m.Barcode, item)).ToList();
            if (productHits.Count == 0) continue;

            var salesman = ResolveSalesman(item, receiptSalesman, fallbackSalesmanId, productHits, []);
            if (salesman <= 0)
            {
                logger.LogInformation(
                    "Skip commission group match on receipt {ReceiptId} item {ItemId}: no salesman",
                    receiptId, item.Id);
                continue;
            }

            var match = PickGroup(productHits, salesman);
            if (match is null) continue;

            var lineAmount = item.Quantity * item.Price;
            var commission = CommissionCalculator.ComputeAmount(
                match.CommissionType, match.CommissionValue, item.Quantity, lineAmount);
            if (meta.Kind == 1) commission = -Math.Abs(commission);
            if (commission == 0) continue;

            await InsertCalcAsync(conn, receiptId, item, salesman, match.CommissionType, match.CommissionValue,
                lineAmount, commission, match.GroupId, match.GroupName, ct);
            matchedItems.Add(item.Id);
            written++;
        }

        var rules = await LoadRulesAsync(conn, ct);
        if (rules.Count == 0) return written;

        foreach (var item in items)
        {
            if (matchedItems.Contains(item.Id)) continue;

            var ruleHits = rules.Where(r => ProductMatches(r.ProductId, r.Barcode, item)).ToList();
            if (ruleHits.Count == 0) continue;

            var salesman = ResolveSalesman(item, receiptSalesman, fallbackSalesmanId, [], ruleHits);
            if (salesman <= 0)
            {
                logger.LogInformation(
                    "Skip commission rule match on receipt {ReceiptId} item {ItemId}: no salesman",
                    receiptId, item.Id);
                continue;
            }

            var rule = PickRule(ruleHits, salesman);
            if (rule is null) continue;

            var lineAmount = item.Quantity * item.Price;
            var commission = CommissionCalculator.ComputeAmount(
                rule.CommissionType, rule.CommissionValue, item.Quantity, lineAmount);
            if (meta.Kind == 1) commission = -Math.Abs(commission);
            if (commission == 0) continue;

            await InsertCalcAsync(conn, receiptId, item, salesman, rule.CommissionType, rule.CommissionValue,
                lineAmount, commission, null, null, ct);
            written++;
        }

        return written;
    }

    private static CommissionGroupRepository.GroupMatchRow? PickGroup(
        IReadOnlyList<CommissionGroupRepository.GroupMatchRow> hits, long salesmanId) =>
        hits.FirstOrDefault(m => m.SalesmanId is null or 0 || m.SalesmanId == salesmanId);

    private static RuleRow? PickRule(IReadOnlyList<RuleRow> hits, long salesmanId) =>
        hits.FirstOrDefault(r => r.SalesmanId is null or 0 || r.SalesmanId == salesmanId);

    private static long ResolveSalesman(
        ItemRow item,
        long receiptSalesman,
        long fallback,
        IReadOnlyList<CommissionGroupRepository.GroupMatchRow> groupHits,
        IReadOnlyList<RuleRow> ruleHits)
    {
        if (item.SalesmanId > 0) return item.SalesmanId;
        if (receiptSalesman > 0) return receiptSalesman;
        if (fallback > 0) return fallback;

        var assigned = groupHits.Select(m => m.SalesmanId)
            .Concat(ruleHits.Select(r => r.SalesmanId))
            .Where(id => id is > 0)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();
        return assigned.Count == 1 ? assigned[0] : 0;
    }

    private static bool ProductMatches(long? matcherArticleId, string? matcherBarcode, ItemRow item)
    {
        // Group items store Edari Seq. Receipts store articles.id. Seq and id overlap
        // across different products, so never match matcher Seq against the local id.
        if (matcherArticleId is > 0 && item.ArticleSeq > 0 && matcherArticleId.Value == item.ArticleSeq)
            return true;
        return BarcodeMatch(matcherBarcode, item.Barcode);
    }

    private static bool BarcodeMatch(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        return string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static async Task InsertCalcAsync(
        DbConnection conn, long receiptId, ItemRow item, long salesmanId,
        string type, decimal value, decimal lineAmount, decimal commission,
        long? groupId, string? groupName, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ext_commission_calculations (
                receipt_id, receipt_item_id, article_id, salesman_id,
                product_id, sale_amount,
                commission_type, commission_value, quantity, line_amount, commission_amount,
                commission_group_id, commission_group_name
            ) VALUES (
                @receiptId, @itemId, @articleId, @salesmanId,
                @articleId, @line,
                @type, @value, @qty, @line, @commission,
                @groupId, @groupName
            )
            """, new
        {
            receiptId,
            itemId = item.Id,
            articleId = item.ArticleSeq > 0 ? item.ArticleSeq : item.ArticleId,
            salesmanId,
            type,
            value,
            qty = item.Quantity,
            line = lineAmount,
            commission,
            groupId,
            groupName
        }, cancellationToken: ct));
    }

    private static async Task<ReceiptMeta?> LoadReceiptMetaAsync(
        DbConnection conn, long receiptId, CancellationToken ct)
    {
        try
        {
            return await conn.QuerySingleOrDefaultAsync<ReceiptMeta>(new CommandDefinition("""
                SELECT kind AS Kind,
                       COALESCE(NULLIF(salesman, 0), 0) AS SalesmanId,
                       number AS Number,
                       creation_date AS CreationDate,
                       COALESCE(is_pending, 0) AS IsPending,
                       COALESCE(cashier_id, 0) AS CashierId
                FROM reciepts WHERE id = @receiptId
                """, new { receiptId }, cancellationToken: ct));
        }
        catch
        {
            return await conn.QuerySingleOrDefaultAsync<ReceiptMeta>(new CommandDefinition("""
                SELECT kind AS Kind, COALESCE(NULLIF(salesman, 0), 0) AS SalesmanId,
                       number AS Number, creation_date AS CreationDate, 0 AS IsPending,
                       COALESCE(cashier_id, 0) AS CashierId
                FROM reciepts WHERE id = @receiptId
                """, new { receiptId }, cancellationToken: ct));
        }
    }

    private static async Task<bool> CashierAppliesCommissionsAsync(
        DbConnection conn, long cashierId, CancellationToken ct)
    {
        try
        {
            var apply = await conn.ExecuteScalarAsync<bool?>(new CommandDefinition(
                "SELECT CAST(COALESCE(apply_commissions, 1) AS bit) FROM cashiers WHERE id = @cashierId",
                new { cashierId }, cancellationToken: ct));
            return apply != false;
        }
        catch
        {
            return true;
        }
    }

    private static async Task<List<RuleRow>> LoadRulesAsync(DbConnection conn, CancellationToken ct)
    {
        try
        {
            return (await conn.QueryAsync<RuleRow>(new CommandDefinition("""
                SELECT id AS Id, product_id AS ProductId, article_barcode AS Barcode,
                       salesman_id AS SalesmanId,
                       commission_type AS CommissionType,
                       CAST(commission_value AS DECIMAL(18,6)) AS CommissionValue
                FROM ext_commission_rules
                WHERE is_active = 1 AND effective_from <= CAST(GETDATE() AS DATE)
                  AND (effective_to IS NULL OR effective_to >= CAST(GETDATE() AS DATE))
                """, cancellationToken: ct))).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static async Task<List<ItemRow>> LoadItemsAsync(
        DbConnection conn, long receiptId, long fallbackSalesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT ri.id AS Id, ri.article_id AS ArticleId,
                   COALESCE(a.Seq, ri.article_id) AS ArticleSeq,
                   ri.barcode AS Barcode,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS ProductName,
                   CAST(ri.quantity AS DECIMAL(18,6)) AS Quantity,
                   CAST(ri.price AS DECIMAL(18,6)) AS Price,
                   COALESCE(NULLIF(ri.salesman_id, 0), NULLIF(r.salesman, 0), @fallback, 0) AS SalesmanId
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN articles a ON a.id = ri.article_id
            WHERE ri.reciept_id = @receiptId
            """;
        const string legacySql = """
            SELECT ri.id AS Id, ri.article_id AS ArticleId,
                   ri.article_id AS ArticleSeq,
                   ri.barcode AS Barcode,
                   CAST(NULL AS NVARCHAR(4000)) AS ProductName,
                   CAST(ri.quantity AS DECIMAL(18,6)) AS Quantity,
                   CAST(ri.price AS DECIMAL(18,6)) AS Price,
                   COALESCE(NULLIF(r.salesman, 0), @fallback, 0) AS SalesmanId
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            WHERE ri.reciept_id = @receiptId
            """;
        try
        {
            return (await conn.QueryAsync<ItemRow>(new CommandDefinition(
                sql, new { receiptId, fallback = fallbackSalesmanId }, cancellationToken: ct))).ToList();
        }
        catch
        {
            return (await conn.QueryAsync<ItemRow>(new CommandDefinition(
                legacySql, new { receiptId, fallback = fallbackSalesmanId }, cancellationToken: ct))).ToList();
        }
    }
}
