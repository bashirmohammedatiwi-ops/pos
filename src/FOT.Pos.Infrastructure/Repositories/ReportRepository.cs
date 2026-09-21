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
                   CAST(COALESCE(SUM(total_amount),0) AS DECIMAL(18,2)) AS Total,
                   COUNT(*) AS ReceiptCount
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
                   CAST(COALESCE(SUM(ri.quantity * ri.price), 0) AS DECIMAL(18,2)) AS Total,
                   COUNT(DISTINCT r.id) AS Count,
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
            where += " AND (a.Name1 LIKE @s OR a.Barcode LIKE @s OR a.Num LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }

        var sql = $"""
            SELECT ri.article_id AS ArticleId, a.Name1 AS Name, ri.barcode AS Barcode,
                   CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS SoldQty,
                   CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS SoldAmount
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN articles a ON a.id = ri.article_id
            {where}
            GROUP BY ri.article_id, a.Name1, ri.barcode
            ORDER BY SoldAmount DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<MovementRowDto>(new CommandDefinition(sql, p, cancellationToken: ct))).ToList();
    }

    public async Task<CashReportDto> CashReportAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        const string sql = """
            SELECT CAST(COALESCE(SUM(total_amount),0) AS DECIMAL(18,2)) AS TotalSales, COUNT(*) AS ReceiptCount,
                   CAST(COALESCE(SUM(payment),0) AS DECIMAL(18,2)) AS TotalPayment,
                   CAST(COALESCE(SUM(cash_back),0) AS DECIMAL(18,2)) AS TotalCashBack
            FROM reciepts
            WHERE CAST(creation_date AS date) BETWEEN @from AND @to AND is_pending=0 AND kind IN (0,1)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<(decimal TotalSales, int ReceiptCount, decimal TotalPayment, decimal TotalCashBack)>(
            new CommandDefinition(sql, new { from = from.Date, to = to.Date }, cancellationToken: ct));
        var avg = row.ReceiptCount > 0 ? row.TotalSales / row.ReceiptCount : 0;
        return new CashReportDto(row.TotalSales, row.ReceiptCount, row.TotalPayment, row.TotalCashBack, avg);
    }
}
