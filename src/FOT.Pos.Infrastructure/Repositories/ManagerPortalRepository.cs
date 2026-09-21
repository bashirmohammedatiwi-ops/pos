using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ManagerPortalRepository(
    ISqlConnectionFactory db,
    BusinessPeriodSettingsRepository periodSettings,
    TargetRepository targets)
{
    public async Task<(DateTime Start, DateTime EndInclusive)> ResolveWeekAsync(DateTime? weekStart, CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        if (weekStart.HasValue)
            return BusinessPeriodHelper.GetWeekBounds(weekStart.Value, period.WeekStartDay, period.WeekLengthDays);
        return BusinessPeriodHelper.GetCurrentWeek(period.WeekStartDay, period.WeekLengthDays);
    }

    public async Task<IReadOnlyList<ManagerWeekSummaryDto>> ListWeeksAsync(int count, CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        var (currentStart, _) = BusinessPeriodHelper.GetCurrentWeek(period.WeekStartDay, period.WeekLengthDays);
        var list = new List<ManagerWeekSummaryDto>();
        for (var i = 0; i < Math.Clamp(count, 1, 24); i++)
        {
            var start = currentStart.AddDays(-i * period.WeekLengthDays);
            var end = start.AddDays(period.WeekLengthDays - 1);
            list.Add(await SummarizeWeekAsync(start, end, i == 0, ct));
        }
        return list;
    }

    public async Task<ManagerWeekPackDto> GetWeekPackAsync(DateTime? weekStart, CancellationToken ct)
    {
        var (start, end) = await ResolveWeekAsync(weekStart, ct);
        var current = (await ResolveWeekAsync(null, ct)).Start.Date == start.Date;
        var week = await SummarizeWeekAsync(start, end, current, ct);
        var balances = await ListBalancesAsync(ct);
        var sellers = await ListSellersAsync(start, end, balances, ct);
        var goals = await ListGoalsAsync(start, end, ct);
        sellers = AttachGoals(sellers, goals);
        return new ManagerWeekPackDto(
            start, week, sellers,
            await ListCashiersAsync(start, end, ct),
            await ListMallsAsync(start, end, ct),
            goals,
            await ListLinesAsync(start, end, ct),
            await ListProductsAsync(start, end, ct));
    }

    public async Task<ManagerHubSnapshotDto> BuildSnapshotAsync(int weekCount, CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        var (currentStart, _) = BusinessPeriodHelper.GetCurrentWeek(period.WeekStartDay, period.WeekLengthDays);
        var count = Math.Clamp(weekCount, 1, 12);
        var weeks = new List<ManagerWeekSummaryDto>();
        var packs = new List<ManagerWeekPackDto>();
        Dictionary<long, decimal> balances;
        try { balances = await ListBalancesAsync(ct); }
        catch { balances = new Dictionary<long, decimal>(); }

        for (var i = 0; i < count; i++)
        {
            var start = currentStart.AddDays(-i * period.WeekLengthDays);
            var end = start.AddDays(period.WeekLengthDays - 1);
            try
            {
                var current = i == 0;
                var week = await SummarizeWeekAsync(start, end, current, ct);
                var sellers = await Safe(() => ListSellersAsync(start, end, balances, ct));
                var goals = await Safe(() => ListGoalsAsync(start, end, ct));
                sellers = AttachGoals(sellers, goals);
                weeks.Add(week);
                packs.Add(new ManagerWeekPackDto(
                    start, week, sellers,
                    await Safe(() => ListCashiersAsync(start, end, ct)),
                    await Safe(() => ListMallsAsync(start, end, ct)),
                    goals,
                    await Safe(() => ListLinesAsync(start, end, ct)),
                    await Safe(() => ListProductsAsync(start, end, ct))));
            }
            catch
            {
                var empty = new ManagerWeekSummaryDto(start, end, i == 0, 0, 0, 0, 0, 0, 0);
                weeks.Add(empty);
                packs.Add(new ManagerWeekPackDto(start, empty, [], [], [], [], [], []));
            }
        }

        return new ManagerHubSnapshotDto(weeks, packs);
    }

    private async Task<ManagerWeekSummaryDto> SummarizeWeekAsync(
        DateTime start, DateTime end, bool isCurrent, CancellationToken ct)
    {
        const string sql = """
            SELECT
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount,
                COUNT(DISTINCT c.receipt_id) AS ReceiptCount,
                COALESCE(SUM(c.quantity), 0) AS PieceCount,
                COUNT(DISTINCT NULLIF(c.salesman_id, 0)) AS SellerCount,
                COUNT(DISTINCT r.cashier_id) AS CashierCount
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<(decimal SalesAmount, decimal CommissionAmount, int ReceiptCount, decimal PieceCount, int SellerCount, int CashierCount)>(
            new CommandDefinition(sql, new { start = start.Date, end = end.Date }, cancellationToken: ct));
        return new ManagerWeekSummaryDto(
            start, end, isCurrent,
            row.SalesAmount, row.CommissionAmount, row.ReceiptCount,
            row.PieceCount, row.SellerCount, row.CashierCount);
    }

    private async Task<IReadOnlyList<ManagerSellerRowDto>> ListSellersAsync(
        DateTime start, DateTime end, IReadOnlyDictionary<long, decimal> balances, CancellationToken ct)
    {
        const string sql = """
            SELECT
                sm.id AS SalesmanId,
                sm.name AS Name,
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount,
                COUNT(DISTINCT c.receipt_id) AS ReceiptCount,
                COALESCE(SUM(c.quantity), 0) AS PieceCount
            FROM salesmen sm
            LEFT JOIN (
                SELECT c.salesman_id, c.line_amount, c.commission_amount, c.receipt_id, c.quantity
                FROM ext_commission_calculations c
                LEFT JOIN reciepts r ON r.id = c.receipt_id
                WHERE COALESCE(r.creation_date, c.calculated_at) >= @start
                  AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            ) c ON c.salesman_id = sm.id
            WHERE sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''
            GROUP BY sm.id, sm.name
            ORDER BY COALESCE(SUM(c.commission_amount), 0) DESC, sm.name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<(long SalesmanId, string Name, decimal SalesAmount, decimal CommissionAmount, int ReceiptCount, decimal PieceCount)>(
            new CommandDefinition(sql, new { start = start.Date, end = end.Date }, cancellationToken: ct))).ToList();
        return rows.Select(r => new ManagerSellerRowDto(
            r.SalesmanId, r.Name, r.SalesAmount, r.CommissionAmount, r.ReceiptCount, r.PieceCount,
            0, 0, 0, balances.GetValueOrDefault(r.SalesmanId))).ToList();
    }

    private async Task<IReadOnlyList<ManagerCashierRowDto>> ListCashiersAsync(
        DateTime start, DateTime end, CancellationToken ct)
    {
        const string sql = """
            SELECT
                COALESCE(cash.id, 0) AS CashierId,
                COALESCE(NULLIF(LTRIM(RTRIM(cash.account_name)), N''), NULLIF(LTRIM(RTRIM(cash.username)), N''), N'كاشير') AS Name,
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount,
                COUNT(DISTINCT c.receipt_id) AS ReceiptCount,
                COALESCE(SUM(c.quantity), 0) AS PieceCount
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN cashiers cash ON cash.id = r.cashier_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            GROUP BY cash.id, cash.account_name, cash.username
            ORDER BY SUM(c.commission_amount) DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<ManagerCashierRowDto>(new CommandDefinition(sql, new
        {
            start = start.Date,
            end = end.Date
        }, cancellationToken: ct))).ToList();
    }

    private async Task<IReadOnlyList<ManagerMallRowDto>> ListMallsAsync(
        DateTime start, DateTime end, CancellationToken ct)
    {
        const string sql = """
            SELECT
                COALESCE(sec.id, 0) AS SectionId,
                COALESCE(NULLIF(LTRIM(RTRIM(sec.name)), N''), N'بدون مول') AS SectionName,
                NULLIF(LTRIM(RTRIM(br.name)), N'') AS BranchName,
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount,
                COUNT(DISTINCT c.receipt_id) AS ReceiptCount,
                COALESCE(SUM(c.quantity), 0) AS PieceCount
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN cashiers cash ON cash.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), cash.section_id)
            LEFT JOIN branches br ON br.id = sec.branch_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            GROUP BY sec.id, sec.name, br.name
            ORDER BY SUM(c.commission_amount) DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<ManagerMallRowDto>(new CommandDefinition(sql, new
        {
            start = start.Date,
            end = end.Date
        }, cancellationToken: ct))).ToList();
    }

    private async Task<IReadOnlyList<ManagerLineDto>> ListLinesAsync(
        DateTime start, DateTime end, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP 280
                c.id AS Id,
                COALESCE(c.salesman_id, 0) AS SalesmanId,
                COALESCE(NULLIF(LTRIM(RTRIM(sm.name)), N''), N'بائع') AS SalesmanName,
                COALESCE(
                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N''),
                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1))), N''),
                    NULLIF(LTRIM(RTRIM(c.commission_group_name)), N''),
                    N'منتج'
                ) AS ProductName,
                NULLIF(LTRIM(RTRIM(c.commission_group_name)), N'') AS GroupName,
                c.quantity AS Quantity,
                COALESCE(c.line_amount, 0) AS SalesAmount,
                c.commission_amount AS CommissionAmount,
                r.number AS ReceiptNumber,
                COALESCE(r.creation_date, c.calculated_at) AS OccurredAt,
                COALESCE(NULLIF(LTRIM(RTRIM(cash.account_name)), N''), NULLIF(LTRIM(RTRIM(cash.username)), N''), N'كاشير') AS CashierName,
                COALESCE(NULLIF(LTRIM(RTRIM(sec.name)), N''), N'مول') AS MallName
            FROM ext_commission_calculations c
            LEFT JOIN salesmen sm ON sm.id = c.salesman_id
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN articles a ON a.Seq = c.article_id
            LEFT JOIN articles a2 ON a2.id = c.article_id
            LEFT JOIN cashiers cash ON cash.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), cash.section_id)
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            ORDER BY COALESCE(r.creation_date, c.calculated_at) DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<ManagerLineDto>(new CommandDefinition(sql, new
        {
            start = start.Date,
            end = end.Date
        }, cancellationToken: ct))).ToList();
    }

    private async Task<IReadOnlyList<ManagerProductRowDto>> ListProductsAsync(
        DateTime start, DateTime end, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP 40
                COALESCE(
                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N''),
                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1))), N''),
                    NULLIF(LTRIM(RTRIM(c.commission_group_name)), N''),
                    N'منتج'
                ) AS Name,
                COALESCE(SUM(c.quantity), 0) AS Quantity,
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount,
                COUNT(*) AS Count
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN articles a ON a.Seq = c.article_id
            LEFT JOIN articles a2 ON a2.id = c.article_id
            WHERE COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            GROUP BY
                COALESCE(
                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N''),
                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a2.Name1))), N''),
                    NULLIF(LTRIM(RTRIM(c.commission_group_name)), N''),
                    N'منتج'
                )
            ORDER BY SUM(c.commission_amount) DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<ManagerProductRowDto>(new CommandDefinition(sql, new
        {
            start = start.Date,
            end = end.Date
        }, cancellationToken: ct))).ToList();
    }

    private async Task<IReadOnlyList<ManagerGoalRowDto>> ListGoalsAsync(
        DateTime start, DateTime end, CancellationToken ct)
    {
        const string idsSql = """
            SELECT DISTINCT a.target_rule_id
            FROM ext_target_assignments a
            INNER JOIN ext_target_rules r ON r.id = a.target_rule_id
            WHERE COALESCE(a.is_active, 1) = 1
              AND COALESCE(r.is_active, 1) = 1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var ruleIds = (await conn.QueryAsync<long>(new CommandDefinition(idsSql, cancellationToken: ct))).ToList();
        var list = new List<ManagerGoalRowDto>();
        foreach (var ruleId in ruleIds)
        {
            try
            {
                var breakdown = await targets.GetBreakdownAsync(ruleId, start, end, ct);
                var isAmount = string.Equals(breakdown.TargetType, "amount", StringComparison.OrdinalIgnoreCase);
                foreach (var row in breakdown.Salesmen.Where(s => s.SalesmanId > 0))
                {
                    var sold = isAmount ? row.Amount : row.Quantity;
                    var weekly = row.WeeklyTarget;
                    var percent = weekly > 0 ? Math.Round(sold / weekly * 100m, 1) : 0;
                    list.Add(new ManagerGoalRowDto(
                        breakdown.RuleId, breakdown.RuleName, breakdown.TargetType,
                        row.SalesmanId, row.SalesmanName ?? "بائع",
                        sold, weekly, percent));
                }
            }
            catch
            {
                // skip a broken rule so the rest of the manager pack still uploads
            }
        }
        return list.OrderBy(g => g.Percent).ThenBy(g => g.SalesmanName).ToList();
    }

    private async Task<Dictionary<long, decimal>> ListBalancesAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT
                sm.id AS SalesmanId,
                COALESCE(p.opening_balance, 0)
                    + COALESCE(calc.total, 0)
                    - COALESCE(p.paid_out_total, 0) AS BalanceDue
            FROM salesmen sm
            LEFT JOIN ext_salesman_commission_profiles p ON p.salesman_id = sm.id
            LEFT JOIN (
                SELECT salesman_id, SUM(commission_amount) AS total
                FROM ext_commission_calculations
                GROUP BY salesman_id
            ) calc ON calc.salesman_id = sm.id
            WHERE sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<(long SalesmanId, decimal BalanceDue)>(
            new CommandDefinition(sql, cancellationToken: ct));
        return rows.GroupBy(r => r.SalesmanId).ToDictionary(g => g.Key, g => g.First().BalanceDue);
    }

    private static async Task<IReadOnlyList<T>> Safe<T>(Func<Task<IReadOnlyList<T>>> run)
    {
        try { return await run(); }
        catch { return []; }
    }

    private static IReadOnlyList<ManagerSellerRowDto> AttachGoals(
        IReadOnlyList<ManagerSellerRowDto> sellers, IReadOnlyList<ManagerGoalRowDto> goals)
    {
        var bySeller = goals.GroupBy(g => g.SalesmanId).ToDictionary(g => g.Key, g => g.ToList());
        return sellers.Select(s =>
        {
            if (!bySeller.TryGetValue(s.SalesmanId, out var rows) || rows.Count == 0)
                return s;
            var hit = rows.Count(g => g.Percent >= 100);
            var avg = rows.Average(g => g.Percent);
            return s with { GoalCount = rows.Count, GoalsHit = hit, GoalPercent = Math.Round(avg, 1) };
        }).ToList();
    }
}
