using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ReportRepository(ISqlConnectionFactory db)
{
    public async Task<IReadOnlyList<DailySalesRowDto>> DailySalesAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        const string sql = """
            SELECT CAST(creation_date AS date) AS Date,
                   CAST(COALESCE(SUM(CASE WHEN kind = 1 THEN -total_amount ELSE total_amount END),0) AS DECIMAL(18,2)) AS Total,
                   SUM(CASE WHEN kind = 1 THEN 0 ELSE 1 END) AS ReceiptCount
            FROM reciepts
            WHERE CAST(creation_date AS date) BETWEEN @from AND @to AND is_pending=0 AND kind IN (0,1)
            GROUP BY CAST(creation_date AS date)
            ORDER BY Date DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<DailySalesRowDto>(
            new CommandDefinition(sql, new { from = from.Date, to = to.Date }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<SalesmanSalesRowDto>> SalesBySalesmanAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        const string sql = """
            SELECT COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                   COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name) AS Name,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -ri.quantity * ri.price WHEN r.kind = 0 THEN ri.quantity * ri.price ELSE 0 END), 0) AS DECIMAL(18,2)) AS Total,
                   COUNT(DISTINCT CASE WHEN r.kind = 0 THEN r.id END) AS Count,
                   COUNT(*) AS LineCount
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
            WHERE CAST(r.creation_date AS date) BETWEEN @from AND @to AND r.is_pending = 0
            GROUP BY COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0),
                     COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name)
            ORDER BY Total DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<SalesmanSalesRowDto>(
            new CommandDefinition(sql, new { from = from.Date, to = to.Date }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<MovementRowDto>> ArticleMovementAsync(DateTime from, DateTime to, string? search, CancellationToken ct)
    {
        var where = "WHERE CAST(r.creation_date AS date) BETWEEN @from AND @to AND r.is_pending=0";
        var p = new DynamicParameters(new { from = from.Date, to = to.Date });
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += " AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s OR ri.barcode LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }

        var sql = $"""
            SELECT ri.article_id AS ArticleId,
                   MAX(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1)))) AS Name,
                   COALESCE(
                       MAX(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Barcode))), N'')),
                       MAX(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), ri.barcode))), N'')),
                       MAX(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Num))), N''))
                   ) AS Barcode,
                   CAST(SUM(CASE WHEN r.kind = 0 THEN ri.quantity WHEN r.kind = 1 THEN -ri.quantity ELSE 0 END) AS DECIMAL(18,6)) AS SoldQty,
                   CAST(SUM(CASE WHEN r.kind = 0 THEN ri.quantity * ri.price WHEN r.kind = 1 THEN -ri.quantity * ri.price ELSE 0 END) AS DECIMAL(18,2)) AS SoldAmount,
                   CAST(SUM(CASE WHEN r.kind = 1 THEN ri.quantity ELSE 0 END) AS DECIMAL(18,6)) AS ReturnedQty,
                   CAST(SUM(CASE WHEN r.kind = 2 THEN ri.quantity ELSE 0 END) AS DECIMAL(18,6)) AS GiftQty,
                   COUNT(DISTINCT CASE WHEN r.kind = 0 THEN r.id END) AS ReceiptCount
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN articles a ON a.id = ri.article_id
            {where}
            GROUP BY ri.article_id
            ORDER BY SoldQty DESC, SoldAmount DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<MovementRowDto>(new CommandDefinition(sql, p, cancellationToken: ct))).ToList();
    }

    public async Task<CashReportDto> CashReportAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        // صافي المبيعات = البيع − المرتجعات. عدد الفواتير ومتوسطها لفواتير البيع فقط.
        const string sql = """
            SELECT CAST(COALESCE(SUM(CASE WHEN kind = 1 THEN -total_amount ELSE total_amount END),0) AS DECIMAL(18,2)) AS TotalSales,
                   SUM(CASE WHEN kind = 0 THEN 1 ELSE 0 END) AS ReceiptCount,
                   CAST(COALESCE(SUM(CASE WHEN kind = 1 THEN -payment ELSE payment END),0) AS DECIMAL(18,2)) AS TotalPayment,
                   CAST(COALESCE(SUM(cash_back),0) AS DECIMAL(18,2)) AS TotalCashBack,
                   CAST(COALESCE(SUM(CASE WHEN kind = 0 THEN total_amount ELSE 0 END),0) AS DECIMAL(18,2)) AS GrossSales,
                   CAST(COALESCE(SUM(CASE WHEN kind = 1 THEN total_amount ELSE 0 END),0) AS DECIMAL(18,2)) AS ReturnsTotal,
                   SUM(CASE WHEN kind = 1 THEN 1 ELSE 0 END) AS ReturnsCount
            FROM reciepts
            WHERE CAST(creation_date AS date) BETWEEN @from AND @to AND is_pending=0 AND kind IN (0,1)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<(decimal TotalSales, int? ReceiptCount, decimal TotalPayment, decimal TotalCashBack, decimal GrossSales, decimal ReturnsTotal, int? ReturnsCount)>(
            new CommandDefinition(sql, new { from = from.Date, to = to.Date }, cancellationToken: ct));
        var count = row.ReceiptCount ?? 0;
        var avg = count > 0 ? row.GrossSales / count : 0;
        return new CashReportDto(row.TotalSales, count, row.TotalPayment, row.TotalCashBack, avg, row.ReturnsTotal, row.ReturnsCount ?? 0);
    }

    /// <summary>
    /// تفصيل يوم واحد للوحة الرئيسية: المبيعات بالساعة (مع اليوم السابق للمقارنة) ·
    /// حسب القسم · حسب نقطة البيع · حسب الكاشير · مدفوعات البطاقة. نفس شروط تقرير الصندوق.
    /// </summary>
    public async Task<DayBreakdownDto> DayBreakdownAsync(DateTime date, CancellationToken ct)
    {
        const string sql = """
            SELECT DATEPART(hour, r.creation_date) AS Hour,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount ELSE r.total_amount END),0) AS DECIMAL(18,2)) AS Total, SUM(CASE WHEN r.kind = 1 THEN 0 ELSE 1 END) AS Count
            FROM reciepts r
            WHERE r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0 AND r.kind IN (0,1)
            GROUP BY DATEPART(hour, r.creation_date);

            SELECT DATEPART(hour, r.creation_date) AS Hour,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount ELSE r.total_amount END),0) AS DECIMAL(18,2)) AS Total, SUM(CASE WHEN r.kind = 1 THEN 0 ELSE 1 END) AS Count
            FROM reciepts r
            WHERE r.creation_date >= @prev AND r.creation_date < @day AND r.is_pending = 0 AND r.kind IN (0,1)
            GROUP BY DATEPART(hour, r.creation_date);

            SELECT COALESCE(sec.id, 0) AS Id, COALESCE(sec.name, N'بلا قسم') AS Name, CAST(NULL AS NVARCHAR(200)) AS Sub,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount ELSE r.total_amount END),0) AS DECIMAL(18,2)) AS Total, SUM(CASE WHEN r.kind = 1 THEN 0 ELSE 1 END) AS Count
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            WHERE r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0 AND r.kind IN (0,1)
            GROUP BY sec.id, sec.name
            ORDER BY Total DESC;

            SELECT COALESCE(r.point_of_sale_id, 0) AS Id, COALESCE(pos.name, N'—') AS Name, MAX(sec.name) AS Sub,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount ELSE r.total_amount END),0) AS DECIMAL(18,2)) AS Total, SUM(CASE WHEN r.kind = 1 THEN 0 ELSE 1 END) AS Count
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            WHERE r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0 AND r.kind IN (0,1)
            GROUP BY r.point_of_sale_id, pos.name
            ORDER BY Total DESC;

            SELECT COALESCE(r.cashier_id, 0) AS Id, COALESCE(c.username, N'—') AS Name, CAST(NULL AS NVARCHAR(200)) AS Sub,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount ELSE r.total_amount END),0) AS DECIMAL(18,2)) AS Total, SUM(CASE WHEN r.kind = 1 THEN 0 ELSE 1 END) AS Count
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            WHERE r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0 AND r.kind IN (0,1)
            GROUP BY r.cashier_id, c.username
            ORDER BY Total DESC;

            SELECT CAST(COALESCE(SUM(cc.amount),0) AS DECIMAL(18,2)) AS CardTotal, COUNT(cc.reciept_id) AS CardCount
            FROM reciepts r
            OUTER APPLY (
                SELECT TOP 1 k.reciept_id, CAST(k.amount AS DECIMAL(18,2)) AS amount FROM reciept_credit_card k
                WHERE k.reciept_id = r.id ORDER BY k.id DESC
            ) cc
            WHERE r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0 AND r.kind IN (0,1)
              AND cc.reciept_id IS NOT NULL;
            """;
        var day = date.Date;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            sql, new { day, next = day.AddDays(1), prev = day.AddDays(-1) }, cancellationToken: ct));
        var hourly = (await multi.ReadAsync<HourBucketDto>()).ToList();
        var prevHourly = (await multi.ReadAsync<HourBucketDto>()).ToList();
        var bySection = (await multi.ReadAsync<NamedTotalDto>()).ToList();
        var byPos = (await multi.ReadAsync<NamedTotalDto>()).ToList();
        var byCashier = (await multi.ReadAsync<NamedTotalDto>()).ToList();
        var card = await multi.ReadSingleAsync<(decimal CardTotal, int CardCount)>();
        return new DayBreakdownDto(day, hourly, prevHourly, bySection, byPos, byCashier, card.CardTotal, card.CardCount);
    }

    /// <summary>
    /// أوقات الذروة: صافي المبيعات وعدد فواتير البيع لكل (يوم أسبوع × ساعة) في المدة.
    /// Weekday: 0 = السبت … 6 = الجمعة (مستقل عن إعداد DATEFIRST).
    /// </summary>
    public async Task<HeatmapReportDto> SalesHeatmapAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        const string sql = """
            SELECT (DATEDIFF(day, '19000106', CAST(r.creation_date AS date)) % 7) AS Weekday,
                   DATEPART(hour, r.creation_date) AS Hour,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount ELSE r.total_amount END), 0) AS DECIMAL(18,2)) AS Total,
                   SUM(CASE WHEN r.kind = 1 THEN 0 ELSE 1 END) AS Count
            FROM reciepts r
            WHERE r.creation_date >= @from AND r.creation_date < DATEADD(day, 1, @to)
              AND r.is_pending = 0 AND r.kind IN (0, 1)
            GROUP BY (DATEDIFF(day, '19000106', CAST(r.creation_date AS date)) % 7), DATEPART(hour, r.creation_date);

            SELECT MIN(creation_date) FROM reciepts WHERE is_pending = 0 AND kind = 0;
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, new { from = from.Date, to = to.Date }, cancellationToken: ct));
        var cells = (await multi.ReadAsync<HeatCellDto>()).ToList();
        var first = await multi.ReadSingleOrDefaultAsync<DateTime?>();
        return new HeatmapReportDto(first, cells);
    }

    /// <summary>أداء كل كاشير في المدة: صافي المبيعات، الفواتير، المرتجعات، الهدايا، البطاقة، أيام العمل.</summary>
    public async Task<IReadOnlyList<CashierPerformanceRowDto>> CashierPerformanceAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        const string sql = """
            SELECT COALESCE(r.cashier_id, 0) AS CashierId,
                   COALESCE(MAX(NULLIF(LTRIM(RTRIM(c.account_name)), N'')), MAX(c.username), N'—') AS Name,
                   MAX(sec.name) AS SectionName,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount WHEN r.kind = 0 THEN r.total_amount ELSE 0 END), 0) AS DECIMAL(18,2)) AS NetSales,
                   SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS ReceiptCount,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN r.total_amount ELSE 0 END), 0) AS DECIMAL(18,2)) AS ReturnsTotal,
                   SUM(CASE WHEN r.kind = 1 THEN 1 ELSE 0 END) AS ReturnsCount,
                   SUM(CASE WHEN r.kind = 2 THEN 1 ELSE 0 END) AS GiftCount,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN COALESCE(r.user_discount, 0) ELSE 0 END), 0) AS DECIMAL(18,2)) AS ManualDiscount,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN cc.amount ELSE 0 END), 0) AS DECIMAL(18,2)) AS CardTotal,
                   COUNT(DISTINCT CASE WHEN r.kind = 0 THEN CAST(r.creation_date AS date) END) AS DaysWorked,
                   MIN(r.creation_date) AS FirstAt,
                   MAX(r.creation_date) AS LastAt
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            OUTER APPLY (
                SELECT TOP 1 CAST(k.amount AS DECIMAL(18,2)) AS amount FROM reciept_credit_card k
                WHERE k.reciept_id = r.id ORDER BY k.id DESC
            ) cc
            WHERE r.creation_date >= @from AND r.creation_date < DATEADD(day, 1, @to)
              AND r.is_pending = 0
            GROUP BY COALESCE(r.cashier_id, 0)
            ORDER BY NetSales DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<CashierPerformanceRowDto>(new CommandDefinition(sql, new { from = from.Date, to = to.Date }, commandTimeout: 90, cancellationToken: ct))).ToList();
    }


    /// <summary>
    /// مواد ستنفد قريباً: معدل البيع اليومي الصافي (آخر @days يوماً، أو منذ بدء النظام إن كان أقصر)
    /// مقابل الرصيد الحالي → عدد الأيام المتبقية. يُعرض ما يكفي أقل من @coverDays يوماً.
    /// </summary>
    public async Task<ReorderReportDto> ReorderAsync(int days, int coverDays, string? search, CancellationToken ct)
    {
        days = Math.Clamp(days, 3, 365);
        coverDays = Math.Clamp(coverDays, 1, 365);
        var p = new DynamicParameters(new { since = DateTime.Today.AddDays(-(days - 1)), coverDays });
        var filter = "";
        if (!string.IsNullOrWhiteSpace(search))
        {
            filter = " AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }
        var sql = $"""
            DECLARE @first DATETIME = (SELECT MIN(creation_date) FROM reciepts WHERE is_pending = 0 AND kind = 0);
            DECLARE @from DATE = CASE WHEN @first IS NOT NULL AND CAST(@first AS date) > @since THEN CAST(@first AS date) ELSE @since END;
            DECLARE @effDays INT = DATEDIFF(day, @from, CAST(GETDATE() AS date)) + 1;
            IF @effDays < 1 SET @effDays = 1;

            WITH sales AS (
                SELECT ri.article_id,
                       SUM(CASE WHEN r.kind = 1 THEN -ri.quantity ELSE ri.quantity END) AS net_qty,
                       MAX(r.creation_date) AS last_sale
                FROM reciept_items ri
                INNER JOIN reciepts r ON r.id = ri.reciept_id
                WHERE r.creation_date >= @from AND r.is_pending = 0 AND r.kind IN (0, 1)
                GROUP BY ri.article_id
                HAVING SUM(CASE WHEN r.kind = 1 THEN -ri.quantity ELSE ri.quantity END) > 0
            )
                SELECT a.id AS ArticleId,
                       LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                       COALESCE(NULLIF(LTRIM(RTRIM(a.Barcode)), N''), LTRIM(RTRIM(a.Num))) AS Barcode,
                       CAST(COALESCE(a.CurTot1, 0) AS DECIMAL(18,2)) AS Stock,
                       CAST(COALESCE(a.SellPr4, 0) AS DECIMAL(18,0)) AS Price,
                       CAST(s.net_qty AS DECIMAL(18,2)) AS SoldQty,
                       CAST(s.net_qty / @effDays AS DECIMAL(18,3)) AS DailyRate,
                       CAST(CASE WHEN COALESCE(a.CurTot1, 0) <= 0 THEN 0
                                 ELSE COALESCE(a.CurTot1, 0) / (s.net_qty / @effDays) END AS DECIMAL(18,1)) AS CoverDays,
                       s.last_sale AS LastSaleDate
                INTO #reorder_base
                FROM sales s
                INNER JOIN articles a ON a.id = s.article_id
                WHERE 1 = 1{filter};
            SELECT @effDays AS EffectiveDays,
                   SUM(CASE WHEN Stock <= 0 THEN 1 ELSE 0 END) AS OutOfStock,
                   SUM(CASE WHEN Stock > 0 AND CoverDays < 7 THEN 1 ELSE 0 END) AS UnderWeek,
                   SUM(CASE WHEN CoverDays < @coverDays THEN 1 ELSE 0 END) AS Total
            FROM #reorder_base;

            SELECT TOP (3000) * FROM #reorder_base WHERE CoverDays < @coverDays ORDER BY CoverDays ASC, DailyRate DESC;

            DROP TABLE #reorder_base;
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, p, commandTimeout: 120, cancellationToken: ct));
        var head = await multi.ReadSingleAsync<(int EffectiveDays, int? OutOfStock, int? UnderWeek, int? Total)>();
        var rows = (await multi.ReadAsync<ReorderRowDto>()).ToList();
        return new ReorderReportDto(head.EffectiveDays, coverDays, head.OutOfStock ?? 0, head.UnderWeek ?? 0, head.Total ?? 0, rows);
    }

    /// <summary>
    /// مواد راكدة: رصيدها في المخزن ≥ minStock ولم تُبع في نقاط البيع منذ @since (أو لم تُبع إطلاقاً).
    /// مرتبة حسب قيمة المخزون (الرصيد × السعر) — الأكثر تجميداً للمال أولاً.
    /// </summary>
    public async Task<SlowMoverReportDto> SlowMoversAsync(int days, decimal minStock, string? search, int limit, CancellationToken ct, bool neverSoldOnly = false)
    {
        var since = DateTime.Today.AddDays(-Math.Clamp(days, 1, 3650));
        var p = new DynamicParameters(new { since, minStock, limit = Math.Clamp(limit, 1, 20000), neverSoldOnly });
        var filter = "";
        if (!string.IsNullOrWhiteSpace(search))
        {
            filter = " AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }
        var sql = $"""
            WITH sales AS (
                SELECT ri.article_id,
                       MAX(r.creation_date) AS last_sale,
                       CAST(SUM(ri.quantity) AS DECIMAL(18,3)) AS total_qty
                FROM reciept_items ri
                INNER JOIN reciepts r ON r.id = ri.reciept_id
                WHERE r.is_pending = 0 AND r.kind = 0
                GROUP BY ri.article_id
            ),
            base AS (
                SELECT a.id AS ArticleId,
                       LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                       COALESCE(NULLIF(LTRIM(RTRIM(a.Barcode)), N''), LTRIM(RTRIM(a.Num))) AS Barcode,
                       CAST(COALESCE(a.CurTot1, 0) AS DECIMAL(18,2)) AS Stock,
                       CAST(COALESCE(a.SellPr4, 0) AS DECIMAL(18,0)) AS Price,
                       CAST(COALESCE(a.CurTot1, 0) * COALESCE(a.SellPr4, 0) AS DECIMAL(18,0)) AS StockValue,
                       s.last_sale AS LastSaleDate,
                       COALESCE(s.total_qty, 0) AS TotalSoldQty
                FROM articles a
                LEFT JOIN sales s ON s.article_id = a.id
                WHERE COALESCE(a.CurTot1, 0) >= @minStock
                  AND (s.last_sale IS NULL OR s.last_sale < @since){filter}
            )
            SELECT COUNT(*) AS TotalCount, CAST(COALESCE(SUM(StockValue), 0) AS DECIMAL(18,0)) AS TotalValue,
                   SUM(CASE WHEN LastSaleDate IS NULL THEN 1 ELSE 0 END) AS NeverSoldCount
            FROM base;

            SELECT TOP (@limit) * FROM base WHERE (@neverSoldOnly = 0 OR LastSaleDate IS NULL) ORDER BY StockValue DESC, Stock DESC;

            SELECT MIN(creation_date) FROM reciepts WHERE is_pending = 0 AND kind = 0;
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, p, commandTimeout: 120, cancellationToken: ct));
        var head = await multi.ReadSingleAsync<(int TotalCount, decimal TotalValue, int NeverSoldCount)>();
        var rows = (await multi.ReadAsync<SlowMoverRowDto>()).ToList();
        var first = await multi.ReadSingleOrDefaultAsync<DateTime?>();
        return new SlowMoverReportDto(since, first, head.TotalCount, head.TotalValue, head.NeverSoldCount, rows);
    }
}
