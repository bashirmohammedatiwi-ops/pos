using System.Threading;
using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;
using Microsoft.Extensions.Caching.Memory;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class CommissionRepository(ISqlConnectionFactory db, IMemoryCache cache)
{
    private const string RuleSelect = """
        SELECT r.id AS Id, r.product_id AS ProductId,
               LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS ProductName,
               r.article_barcode AS Barcode,
               r.salesman_id AS SalesmanId,
               s.name AS SalesmanName,
               r.label AS Label,
               r.commission_type AS CommissionType,
               r.commission_value AS CommissionValue,
               CAST(r.is_active AS bit) AS IsActive,
               r.effective_from AS EffectiveFrom,
               r.effective_to AS EffectiveTo
        FROM ext_commission_rules r
        LEFT JOIN articles a ON a.Seq = r.product_id
        LEFT JOIN salesmen s ON s.id = r.salesman_id
        """;

    public async Task<IReadOnlyList<CommissionRuleDto>> ListRulesAsync(CancellationToken ct)
    {
        var sql = RuleSelect + " ORDER BY r.id DESC";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowsAsync<CommissionRuleDto>(new CommandDefinition(sql, cancellationToken: ct));
    }

    public async Task<CommissionRuleDto?> GetRuleAsync(long id, CancellationToken ct)
    {
        var sql = RuleSelect + " WHERE r.id = @id";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<CommissionRuleDto>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
    }

    public async Task<long> CreateAsync(CreateCommissionRuleRequest req, CancellationToken ct)
    {
        const string sql = """
            INSERT INTO ext_commission_rules (
                product_id, article_barcode, salesman_id, label,
                commission_type, commission_value, effective_from, effective_to)
            OUTPUT INSERTED.id VALUES (
                @productId, @barcode, @salesmanId, @label,
                @type, @value, COALESCE(@from, CAST(GETDATE() AS DATE)), @to)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition(sql, new
        {
            productId = req.ProductId,
            barcode = req.Barcode,
            salesmanId = req.SalesmanId,
            label = req.Label,
            type = req.CommissionType,
            value = req.CommissionValue,
            from = req.EffectiveFrom,
            to = req.EffectiveTo
        }, cancellationToken: ct));
        InvalidateAttribution();
        return id;
    }

    public async Task<bool> UpdateAsync(long id, UpdateCommissionRuleRequest req, CancellationToken ct)
    {
        const string sql = """
            UPDATE ext_commission_rules SET
                product_id = @productId,
                article_barcode = @barcode,
                salesman_id = @salesmanId,
                label = @label,
                commission_type = @type,
                commission_value = @value,
                effective_from = COALESCE(@from, effective_from),
                effective_to = @to,
                is_active = @active
            WHERE id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            id,
            productId = req.ProductId,
            barcode = req.Barcode,
            salesmanId = req.SalesmanId,
            label = req.Label,
            type = req.CommissionType,
            value = req.CommissionValue,
            from = req.EffectiveFrom,
            to = req.EffectiveTo,
            active = req.IsActive
        }, cancellationToken: ct));
        if (rows > 0) InvalidateAttribution();
        return rows > 0;
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_rules WHERE id = @id", new { id }, cancellationToken: ct));
        if (rows > 0) InvalidateAttribution();
        return rows > 0;
    }

    public async Task SetActiveAsync(long id, bool active, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_commission_rules SET is_active=@active WHERE id=@id", new { id, active }, cancellationToken: ct));
        InvalidateAttribution();
    }

    public async Task<IReadOnlyList<CommissionCalculationDto>> ListCalculationsAsync(
        DateTime? from, DateTime? to, long? salesmanId, int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit)
                c.id AS Id, c.receipt_id AS ReceiptId, c.article_id AS ArticleId,
                COALESCE(
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))),
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1)))) AS ProductName,
                c.salesman_id AS SalesmanId, s.name AS SalesmanName,
                c.commission_type AS CommissionType, c.commission_value AS CommissionValue,
                c.quantity AS Quantity, c.line_amount AS LineAmount,
                c.commission_amount AS CommissionAmount, c.calculated_at AS CalculatedAt,
                c.commission_group_id AS CommissionGroupId, c.commission_group_name AS CommissionGroupName,
                r.creation_date AS SaleDate, r.number AS ReceiptNumber
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN articles a ON a.Seq = c.article_id
            LEFT JOIN articles a2 ON a2.id = c.article_id
            LEFT JOIN salesmen s ON s.id = c.salesman_id
            WHERE (@from IS NULL OR COALESCE(r.creation_date, c.calculated_at) >= @from)
              AND (@to IS NULL OR COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@to AS DATE)))
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            ORDER BY COALESCE(r.creation_date, c.calculated_at) DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<CommissionCalculationDto>(new CommandDefinition(sql, new
        {
            from,
            to,
            salesmanId,
            limit = Math.Clamp(limit, 1, 500)
        }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<SalesmanCommissionSummaryDto>> SalesmanSummaryAsync(
        DateTime from, DateTime to, bool activeOnly, bool includeAll, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var where = activeOnly
            ? $"WHERE {SalesmanQueries.ActiveWhere}"
            : includeAll
                ? "WHERE sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''"
                : $"WHERE {await SalesmanQueries.EdariFilterWhereAsync(conn, ct)}";
        // ترتيب حسب سجل الإداري يتطلب JOIN صريح — لا يصح subquery داخل GROUP BY في SQL Server
        var registryOrder = await SalesmanQueries.OrderByAsync(conn, ct);
        var hasRegistrySort = registryOrder.StartsWith("(SELECT e.sort_num");
        var joinEr = hasRegistrySort ? "LEFT JOIN ext_edari_salesmen er ON er.salesman_id = sm.id" : string.Empty;
        var groupSort = hasRegistrySort ? ", er.sort_num" : (await SalesmanQueries.HasSortNumAsync(conn, ct) ? ", sm.sort_num" : string.Empty);
        var orderBy = hasRegistrySort ? "er.sort_num, sm.id" : registryOrder;
        var sql = $"""
            SELECT
                sm.id AS SalesmanId,
                sm.name AS SalesmanName,
                COALESCE(p.currency_code, N'IQD') AS CurrencyCode,
                COALESCE(p.opening_balance, 0) AS OpeningBalance,
                COALESCE(p.paid_out_total, 0) AS PaidOutTotal,
                COALESCE(SUM(c.commission_amount), 0) AS TotalCommission,
                COUNT(c.id) AS TransactionCount,
                COALESCE(p.opening_balance, 0) + COALESCE(SUM(c.commission_amount), 0) - COALESCE(p.paid_out_total, 0) AS BalanceDue,
                p.notes AS Notes
            FROM salesmen sm
            LEFT JOIN ext_salesman_commission_profiles p ON p.salesman_id = sm.id
            {joinEr}
            LEFT JOIN (
                SELECT c.id, c.salesman_id, c.commission_amount
                FROM ext_commission_calculations c
                LEFT JOIN reciepts r ON r.id = c.receipt_id
                WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
                  AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@to AS DATE))
            ) c ON c.salesman_id = sm.id
            {where}
            GROUP BY sm.id, sm.name, p.currency_code, p.opening_balance, p.paid_out_total, p.notes{groupSort}
            ORDER BY {orderBy}
            """;
        return (await conn.QueryRowsAsync<SalesmanCommissionSummaryDto>(new CommandDefinition(sql, new
        {
            from = from.Date,
            to = to.Date
        }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<SalesmanCommissionProfileDto>> ListProfilesAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var orderBy = await SalesmanQueries.OrderByAsync(conn, ct);
        var edariWhere = await SalesmanQueries.EdariFilterWhereAsync(conn, ct);
        var sql = $"""
            SELECT sm.id AS SalesmanId, sm.name AS SalesmanName,
                   COALESCE(p.currency_code, N'IQD') AS CurrencyCode,
                   COALESCE(p.opening_balance, 0) AS OpeningBalance,
                   COALESCE(p.paid_out_total, 0) AS PaidOutTotal,
                   p.notes AS Notes
            FROM salesmen sm
            LEFT JOIN ext_salesman_commission_profiles p ON p.salesman_id = sm.id
            WHERE {edariWhere}
            ORDER BY {orderBy}
            """;
        return (await conn.QueryRowsAsync<SalesmanCommissionProfileDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<CommissionDailyReportRow>> DailyReportAsync(
        DateTime from, DateTime to, long? salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT
                CAST(COALESCE(r.creation_date, c.calculated_at) AS DATE) AS Day,
                COALESCE(SUM(c.commission_amount), 0) AS TotalCommission,
                COUNT(*) AS TransactionCount,
                COALESCE(SUM(c.line_amount), 0) AS TotalSales
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@to AS DATE))
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY CAST(COALESCE(r.creation_date, c.calculated_at) AS DATE)
            ORDER BY Day
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<CommissionDailyReportRow>(new CommandDefinition(sql, new
        {
            from = from.Date,
            to = to.Date,
            salesmanId
        }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<CommissionGroupReportRow>> GroupReportAsync(
        DateTime from, DateTime to, long? salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT
                c.commission_group_id AS GroupId,
                COALESCE(NULLIF(LTRIM(RTRIM(c.commission_group_name)), N''), N'قواعد فردية') AS GroupName,
                COUNT(*) AS TransactionCount,
                COALESCE(SUM(c.commission_amount), 0) AS TotalCommission,
                COALESCE(SUM(c.line_amount), 0) AS TotalSales
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@to AS DATE))
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY c.commission_group_id, c.commission_group_name
            ORDER BY TotalCommission DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<CommissionGroupReportRow>(new CommandDefinition(sql, new
        {
            from = from.Date,
            to = to.Date,
            salesmanId
        }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<CommissionProductReportRow>> ProductReportAsync(
        DateTime from, DateTime to, long? salesmanId, int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit)
                c.article_id AS ArticleId,
                COALESCE(
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))),
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1)))) AS ProductName,
                COUNT(*) AS TransactionCount,
                COALESCE(SUM(c.commission_amount), 0) AS TotalCommission,
                COALESCE(SUM(c.line_amount), 0) AS TotalSales,
                COALESCE(SUM(c.quantity), 0) AS Quantity
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN articles a ON a.Seq = c.article_id
            LEFT JOIN articles a2 ON a2.id = c.article_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@to AS DATE))
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY c.article_id, a.Name1, a2.Name1
            ORDER BY TotalCommission DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<CommissionProductReportRow>(new CommandDefinition(sql, new
        {
            from = from.Date,
            to = to.Date,
            salesmanId,
            limit = Math.Clamp(limit, 1, 200)
        }, cancellationToken: ct))).ToList();
    }

    public async Task UpsertProfileAsync(long salesmanId, UpdateSalesmanCommissionProfileRequest req, CancellationToken ct)
    {
        const string sql = """
            MERGE ext_salesman_commission_profiles AS t
            USING (SELECT @salesmanId AS salesman_id) AS s ON t.salesman_id = s.salesman_id
            WHEN MATCHED THEN UPDATE SET
                currency_code = @currency,
                opening_balance = @opening,
                paid_out_total = @paid,
                notes = @notes,
                updated_at = GETDATE()
            WHEN NOT MATCHED THEN INSERT (salesman_id, currency_code, opening_balance, paid_out_total, notes)
                VALUES (@salesmanId, @currency, @opening, @paid, @notes);
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            salesmanId,
            currency = req.CurrencyCode,
            opening = req.OpeningBalance,
            paid = req.PaidOutTotal,
            notes = req.Notes
        }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<CommissionReceiptReportRow>> ReceiptReportAsync(
        DateTime from, DateTime to, long? salesmanId, int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit)
                c.receipt_id AS ReceiptId,
                r.number AS ReceiptNumber,
                MAX(COALESCE(r.creation_date, c.calculated_at)) AS SaleDate,
                COUNT(*) AS LineCount,
                COALESCE(SUM(c.commission_amount), 0) AS TotalCommission,
                COALESCE(SUM(c.line_amount), 0) AS TotalSales
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@to AS DATE))
              AND (@salesmanId IS NULL OR c.salesman_id = @salesmanId)
            GROUP BY c.receipt_id, r.number
            ORDER BY SaleDate DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<CommissionReceiptReportRow>(new CommandDefinition(sql, new
        {
            from = from.Date,
            to = to.Date,
            salesmanId,
            limit = Math.Clamp(limit, 1, 300)
        }, cancellationToken: ct))).ToList();
    }

    public async Task<CommissionHealthDto> GetHealthAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        from = from.Date;
        to = to.Date;
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        var activeGroups = await ScalarInt(conn, """
            SELECT COUNT(*) FROM ext_commission_groups
            WHERE is_active = 1 AND effective_from <= CAST(GETDATE() AS DATE)
              AND (effective_to IS NULL OR effective_to >= CAST(GETDATE() AS DATE))
            """, ct);
        var activeRules = await ScalarInt(conn, """
            SELECT COUNT(*) FROM ext_commission_rules
            WHERE is_active = 1 AND effective_from <= CAST(GETDATE() AS DATE)
              AND (effective_to IS NULL OR effective_to >= CAST(GETDATE() AS DATE))
            """, ct);
        var linkedProducts = await ScalarInt(conn, """
            SELECT COUNT(DISTINCT COALESCE(CAST(i.article_id AS NVARCHAR(30)), i.barcode))
            FROM ext_commission_group_items i
            INNER JOIN ext_commission_groups g ON g.id = i.group_id AND g.is_active = 1
            """, ct);
        var receiptsInPeriod = await ScalarInt(conn, """
            SELECT COUNT(*) FROM reciepts
            WHERE creation_date >= @from AND creation_date < DATEADD(day, 1, @to)
              AND (is_pending = 0 OR is_pending IS NULL)
            """, ct, new { from, to });
        var calculatedLines = await ScalarInt(conn, """
            SELECT COUNT(*)
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @from
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, @to)
            """, ct, new { from, to });

        const string eligibleFrom = """
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN articles a ON a.id = ri.article_id
            LEFT JOIN articles a2 ON a.id IS NULL AND a2.Seq = ri.article_id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
            LEFT JOIN ext_commission_calculations c
                ON c.receipt_id = r.id
               AND (c.receipt_item_id = ri.id
                    OR (c.receipt_item_id IS NULL AND c.article_id IN (COALESCE(a.Seq, a2.Seq, -1))))
            WHERE r.creation_date >= @from AND r.creation_date < DATEADD(day, 1, @to)
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND (
                    EXISTS (
                        SELECT 1
                        FROM ext_commission_group_items gi
                        INNER JOIN ext_commission_groups g ON g.id = gi.group_id
                        WHERE g.is_active = 1
                          AND g.effective_from <= CAST(GETDATE() AS DATE)
                          AND (g.effective_to IS NULL OR g.effective_to >= CAST(GETDATE() AS DATE))
                          AND (
                                (gi.article_id IS NOT NULL AND gi.article_id IN (a.Seq, a2.Seq))
                             OR (gi.barcode IS NOT NULL AND LTRIM(RTRIM(gi.barcode)) = LTRIM(RTRIM(ri.barcode)))
                          )
                    )
                 OR EXISTS (
                        SELECT 1 FROM ext_commission_rules ru
                        WHERE ru.is_active = 1
                          AND ru.effective_from <= CAST(GETDATE() AS DATE)
                          AND (ru.effective_to IS NULL OR ru.effective_to >= CAST(GETDATE() AS DATE))
                          AND (
                                (ru.product_id IS NOT NULL AND ru.product_id IN (a.Seq, a2.Seq))
                             OR (ru.article_barcode IS NOT NULL AND LTRIM(RTRIM(ru.article_barcode)) = LTRIM(RTRIM(ri.barcode)))
                          )
                    )
              )
            """;

        var eligibleCount = await ScalarInt(conn, $"SELECT COUNT(*) {eligibleFrom}", ct, new { from, to });
        var missingCount = await ScalarInt(conn, $"SELECT COUNT(*) {eligibleFrom} AND c.id IS NULL", ct, new { from, to });
        var linesWithoutSalesman = await ScalarInt(conn, $"""
            SELECT COUNT(*) {eligibleFrom}
              AND COALESCE(NULLIF(ri.salesman_id, 0), NULLIF(r.salesman, 0), 0) <= 0
            """, ct, new { from, to });

        var gaps = (await conn.QueryRowsAsync<CommissionGapRow>(new CommandDefinition($"""
            SELECT TOP 40
                r.id AS ReceiptId,
                r.number AS ReceiptNumber,
                r.creation_date AS SaleDate,
                ri.article_id AS ArticleId,
                COALESCE(
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))),
                    LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1)))) AS ProductName,
                COALESCE(NULLIF(ri.salesman_id, 0), NULLIF(r.salesman, 0), 0) AS SalesmanId,
                COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), N''), s.name) AS SalesmanName,
                CASE
                    WHEN COALESCE(NULLIF(ri.salesman_id, 0), NULLIF(r.salesman, 0), 0) <= 0
                        THEN N'لا يوجد مندوب على السطر أو الفاتورة'
                    ELSE N'المنتج مطابق لمجموعة/قاعدة لكن العمولة لم تُحفظ'
                END AS Reason
            {eligibleFrom}
              AND c.id IS NULL
            ORDER BY r.creation_date DESC
            """, new { from, to }, cancellationToken: ct))).ToList();

        var hints = new List<string>();
        if (activeGroups == 0 && activeRules == 0)
            hints.Add("لا توجد مجموعة أو قاعدة عمولة نشطة.");
        if (linkedProducts == 0 && activeGroups > 0)
            hints.Add("المجموعات نشطة لكن بدون منتجات مربوطة.");
        if (eligibleCount > 0 && calculatedLines == 0)
            hints.Add("وُجدت مبيعات لمنتجات عليها عمولة لكن لم تُحفظ أي حركة — اضغط «إعادة حساب الفترة».");
        if (linesWithoutSalesman > 0)
            hints.Add("بعض الأسطر بدون مندوب. اختر المندوب على المنتج عند البيع أو أعد الحساب بعد الإصلاح.");
        if (calculatedLines == 0 && eligibleCount == 0 && receiptsInPeriod > 0)
            hints.Add("هناك فواتير في الفترة لكن أصنافها غير مربوطة بمجموعة/قاعدة عمولة.");
        if (calculatedLines == 0 && receiptsInPeriod == 0)
            hints.Add("لا فواتير في هذه الفترة. تأكد من تاريخ «من / إلى» (التاريخ المحلي).");

        return new CommissionHealthDto(
            from, to, activeGroups, activeRules, linkedProducts, receiptsInPeriod,
            eligibleCount, calculatedLines, missingCount, linesWithoutSalesman, gaps, hints);
    }

    public async Task<IReadOnlyList<CommissionPayoutDto>> ListPayoutsAsync(
        DateTime? from, DateTime? to, long? salesmanId, int limit, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsurePayoutsTableAsync(conn, ct);
        const string sql = """
            SELECT TOP (@limit)
                p.id AS Id, p.salesman_id AS SalesmanId, s.name AS SalesmanName,
                p.amount AS Amount, p.paid_at AS PaidAt, p.note AS Note,
                CAST(p.voided AS bit) AS Voided
            FROM ext_commission_payouts p
            LEFT JOIN salesmen s ON s.id = p.salesman_id
            WHERE (@from IS NULL OR p.paid_at >= @from)
              AND (@to IS NULL OR p.paid_at < DATEADD(day, 1, CAST(@to AS DATE)))
              AND (@salesmanId IS NULL OR p.salesman_id = @salesmanId)
            ORDER BY p.paid_at DESC, p.id DESC
            """;
        return (await conn.QueryRowsAsync<CommissionPayoutDto>(new CommandDefinition(sql, new
        {
            from,
            to,
            salesmanId,
            limit = Math.Clamp(limit, 1, 400)
        }, cancellationToken: ct))).ToList();
    }

    public async Task<CommissionPayoutDto> RecordPayoutAsync(
        long salesmanId, RecordCommissionPayoutRequest req, CancellationToken ct)
    {
        if (salesmanId <= 0) throw new InvalidOperationException("المندوب غير صالح");
        if (req.Amount <= 0) throw new InvalidOperationException("أدخل مبلغ صرف أكبر من صفر");

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsurePayoutsTableAsync(conn, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var paidAt = req.PaidAt ?? DateTime.Now;
        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO ext_commission_payouts (salesman_id, amount, paid_at, note)
            OUTPUT INSERTED.id
            VALUES (@salesmanId, @amount, @paidAt, @note)
            """, new { salesmanId, amount = req.Amount, paidAt, note = req.Note },
            transaction: tx, cancellationToken: ct));

        await conn.ExecuteAsync(new CommandDefinition("""
            MERGE ext_salesman_commission_profiles AS t
            USING (SELECT @salesmanId AS salesman_id) AS s ON t.salesman_id = s.salesman_id
            WHEN MATCHED THEN UPDATE SET
                paid_out_total = COALESCE(t.paid_out_total, 0) + @amount,
                updated_at = GETDATE()
            WHEN NOT MATCHED THEN INSERT (salesman_id, currency_code, opening_balance, paid_out_total, notes)
                VALUES (@salesmanId, N'IQD', 0, @amount, NULL);
            """, new { salesmanId, amount = req.Amount }, transaction: tx, cancellationToken: ct));
        await tx.CommitAsync(ct);

        var name = await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT name FROM salesmen WHERE id=@salesmanId", new { salesmanId }, cancellationToken: ct));
        return new CommissionPayoutDto(id, salesmanId, name, req.Amount, paidAt, req.Note, false);
    }

    public async Task<bool> VoidPayoutAsync(long payoutId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsurePayoutsTableAsync(conn, ct);
        var row = await conn.QuerySingleOrDefaultAsync<(long SalesmanId, decimal Amount, bool Voided)>(
            new CommandDefinition(
                "SELECT salesman_id AS SalesmanId, amount AS Amount, CAST(voided AS bit) AS Voided FROM ext_commission_payouts WHERE id=@id",
                new { id = payoutId }, cancellationToken: ct));
        if (row.SalesmanId == 0) return false;
        if (row.Voided) return true;

        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_commission_payouts SET voided=1 WHERE id=@id",
            new { id = payoutId }, transaction: tx, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_salesman_commission_profiles
            SET paid_out_total = CASE WHEN paid_out_total - @amount < 0 THEN 0 ELSE paid_out_total - @amount END,
                updated_at = GETDATE()
            WHERE salesman_id=@salesmanId
            """, new { salesmanId = row.SalesmanId, amount = row.Amount },
            transaction: tx, cancellationToken: ct));
        await tx.CommitAsync(ct);
        return true;
    }

    private static int _payoutsTableState;

    private static async Task EnsurePayoutsTableAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (Volatile.Read(ref _payoutsTableState) == 1) return;
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_payouts')
            CREATE TABLE ext_commission_payouts (
                id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                salesman_id BIGINT NOT NULL,
                amount DECIMAL(18,4) NOT NULL,
                paid_at DATETIME2 NOT NULL CONSTRAINT DF_ext_cpo_paid2 DEFAULT GETDATE(),
                note NVARCHAR(400) NULL,
                voided BIT NOT NULL CONSTRAINT DF_ext_cpo_void2 DEFAULT 0,
                created_at DATETIME2 NOT NULL CONSTRAINT DF_ext_cpo_created2 DEFAULT GETDATE()
            );
            """, cancellationToken: ct));
        Volatile.Write(ref _payoutsTableState, 1);
    }

    private void InvalidateAttribution() => cache.Remove(ProductAttributionRepository.ArticlesCacheKey);

    private static async Task<int> ScalarInt(
        System.Data.Common.DbConnection conn, string sql, CancellationToken ct, object? param = null)
    {
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(sql, param, cancellationToken: ct));
        }
        catch
        {
            return 0;
        }
    }
}

