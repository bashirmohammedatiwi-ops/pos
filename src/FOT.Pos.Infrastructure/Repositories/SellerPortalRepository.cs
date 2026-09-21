using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class SellerPortalRepository(
    ISqlConnectionFactory db,
    BusinessPeriodSettingsRepository periodSettings,
    TargetRepository targets)
{
    public async Task<SellerLookupDto?> LookupAsync(long salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP 1 sm.id AS Id, sm.name AS Name
            FROM salesmen sm
            WHERE sm.id = @salesmanId
              AND sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<SellerLookupDto>(
            new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct));
    }

    public async Task<SellerMeDto?> GetMeAsync(long salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT sm.id AS Id, sm.name AS Name,
                   CAST(COALESCE(a.must_change_pin, 0) AS bit) AS MustChangePin
            FROM salesmen sm
            LEFT JOIN ext_seller_accounts a ON a.salesman_id = sm.id
            WHERE sm.id = @salesmanId
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<SellerMeDto>(
            new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct));
    }

    public async Task<(SellerLookupDto? Seller, string? PinHash, bool Active)> GetAccountAsync(
        long salesmanId, CancellationToken ct)
    {
        var seller = await LookupAsync(salesmanId, ct);
        if (seller is null) return (null, null, false);
        const string sql = """
            SELECT pin_hash, CAST(COALESCE(is_active, 1) AS bit) AS is_active
            FROM ext_seller_accounts WHERE salesman_id = @salesmanId
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<AccountRow>(
            new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct));
        if (row is null) return (seller, null, true);
        return (seller, row.pin_hash, row.is_active);
    }

    public async Task CreateAccountAsync(long salesmanId, string pinHash, CancellationToken ct)
    {
        const string sql = """
            INSERT INTO ext_seller_accounts (salesman_id, pin_hash, must_change_pin, is_active, last_login_at)
            VALUES (@salesmanId, @pinHash, 0, 1, SYSUTCDATETIME())
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(sql, new { salesmanId, pinHash }, cancellationToken: ct));
    }

    public async Task TouchLoginAsync(long salesmanId, CancellationToken ct)
    {
        const string sql = "UPDATE ext_seller_accounts SET last_login_at = SYSUTCDATETIME() WHERE salesman_id = @salesmanId";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct));
    }

    public async Task<(DateTime Start, DateTime EndInclusive)> ResolveWeekAsync(DateTime? weekStart, CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        if (weekStart.HasValue)
            return BusinessPeriodHelper.GetWeekBounds(weekStart.Value, period.WeekStartDay, period.WeekLengthDays);
        return BusinessPeriodHelper.GetCurrentWeek(period.WeekStartDay, period.WeekLengthDays);
    }

    public async Task<IReadOnlyList<SellerWeekSummaryDto>> ListWeeksAsync(long salesmanId, int count, CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        var (currentStart, _) = BusinessPeriodHelper.GetCurrentWeek(period.WeekStartDay, period.WeekLengthDays);
        var list = new List<SellerWeekSummaryDto>();
        for (var i = 0; i < Math.Clamp(count, 1, 24); i++)
        {
            var start = currentStart.AddDays(-i * period.WeekLengthDays);
            var end = start.AddDays(period.WeekLengthDays - 1);
            list.Add(await SummarizeWeekAsync(salesmanId, start, end, i == 0, ct));
        }
        return list;
    }

    public async Task<SellerDashboardDto> GetDashboardAsync(long salesmanId, DateTime? weekStart, CancellationToken ct)
    {
        var me = await GetMeAsync(salesmanId, ct)
            ?? throw new InvalidOperationException("البائع غير موجود");
        var (start, end) = await ResolveWeekAsync(weekStart, ct);
        var week = await SummarizeWeekAsync(salesmanId, start, end, IsCurrent(start, ct), ct);
        var malls = await ListMallsAsync(salesmanId, start, end, ct);
        var goals = await ListGoalsAsync(salesmanId, start, end, ct);
        var balance = await BalanceDueAsync(salesmanId, ct);
        return new SellerDashboardDto(me, week with { MallCount = malls.Count }, balance, malls, goals);
    }

    public async Task<IReadOnlyList<SellerMallDto>> ListMallsAsync(
        long salesmanId, DateTime start, DateTime end, CancellationToken ct)
    {
        const string sql = """
            SELECT
                COALESCE(sec.id, 0) AS SectionId,
                COALESCE(NULLIF(LTRIM(RTRIM(sec.name)), N''), N'بدون مول') AS SectionName,
                NULLIF(LTRIM(RTRIM(br.name)), N'') AS BranchName,
                COUNT(DISTINCT r.id) AS ReceiptCount,
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN cashiers cash ON cash.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), cash.section_id)
            LEFT JOIN branches br ON br.id = sec.branch_id
            WHERE c.salesman_id = @salesmanId
              AND COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            GROUP BY sec.id, sec.name, br.name
            ORDER BY SUM(c.commission_amount) DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryRowsAsync<SellerMallDto>(new CommandDefinition(sql, new
        {
            salesmanId,
            start = start.Date,
            end = end.Date
        }, cancellationToken: ct))).ToList();
        return rows.Select(r => r with { SalesAmount = 0 }).ToList();
    }

    public async Task<IReadOnlyList<SellerGoalDto>> ListGoalsAsync(
        long salesmanId, DateTime start, DateTime end, CancellationToken ct)
    {
        const string idsSql = """
            SELECT DISTINCT a.target_rule_id
            FROM ext_target_assignments a
            INNER JOIN ext_target_rules r ON r.id = a.target_rule_id
            WHERE a.employee_id = @salesmanId
              AND COALESCE(a.is_active, 1) = 1
              AND COALESCE(r.is_active, 1) = 1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var ruleIds = (await conn.QueryAsync<long>(new CommandDefinition(
            idsSql, new { salesmanId }, cancellationToken: ct))).ToList();

        var list = new List<SellerGoalDto>();
        foreach (var ruleId in ruleIds)
        {
            var breakdown = await targets.GetBreakdownAsync(ruleId, start, end.AddDays(1), ct);
            var row = breakdown.Salesmen.FirstOrDefault(s => s.SalesmanId == salesmanId);
            if (row is null) continue;
            var isAmount = string.Equals(breakdown.TargetType, "amount", StringComparison.OrdinalIgnoreCase);
            var sold = isAmount ? row.Amount : row.Quantity;
            list.Add(new SellerGoalDto(
                breakdown.RuleId, breakdown.RuleName, breakdown.TargetType,
                sold, row.WeeklyTarget, row.WeeklyPercent));
        }
        return list.OrderByDescending(g => g.Percent).ToList();
    }

    public async Task<IReadOnlyList<SellerCommissionGroupDto>> ListCommissionGroupsAsync(
        long salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT g.id AS Id, g.name AS Name, g.commission_type AS CommissionType,
                   g.commission_value AS CommissionValue,
                   (SELECT COUNT(*) FROM ext_commission_group_items i
                    WHERE i.group_id = g.id AND COALESCE(i.excluded, 0) = 0) AS ProductCount
            FROM ext_commission_groups g
            WHERE COALESCE(g.is_active, 1) = 1
              AND (
                    g.salesman_id = @salesmanId
                    OR EXISTS (
                        SELECT 1 FROM ext_commission_group_salesmen gs
                        WHERE gs.group_id = g.id AND gs.salesman_id = @salesmanId)
                    OR (
                        g.salesman_id IS NULL
                        AND NOT EXISTS (SELECT 1 FROM ext_commission_group_salesmen gs WHERE gs.group_id = g.id)
                    )
                  )
            ORDER BY g.sort_order, g.name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<SellerCommissionGroupDto>(
            new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<SellerCommissionProductDto>> ListCommissionProductsAsync(
        long salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP 400
                i.article_id AS ArticleId,
                i.barcode AS Barcode,
                COALESCE(i.article_name, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1)))) AS Name,
                g.id AS GroupId,
                g.name AS GroupName,
                g.commission_type AS CommissionType,
                g.commission_value AS CommissionValue
            FROM ext_commission_group_items i
            INNER JOIN ext_commission_groups g ON g.id = i.group_id
            LEFT JOIN articles a ON a.Seq = i.article_id
            WHERE COALESCE(g.is_active, 1) = 1
              AND COALESCE(i.excluded, 0) = 0
              AND (
                    g.salesman_id = @salesmanId
                    OR EXISTS (
                        SELECT 1 FROM ext_commission_group_salesmen gs
                        WHERE gs.group_id = g.id AND gs.salesman_id = @salesmanId)
                    OR (
                        g.salesman_id IS NULL
                        AND NOT EXISTS (SELECT 1 FROM ext_commission_group_salesmen gs WHERE gs.group_id = g.id)
                    )
                  )
            ORDER BY g.sort_order, g.name, i.article_name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<SellerCommissionProductDto>(
            new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct))).ToList();
    }

    private async Task<SellerWeekSummaryDto> SummarizeWeekAsync(
        long salesmanId, DateTime start, DateTime end, bool isCurrent, CancellationToken ct)
    {
        const string sql = """
            SELECT
                COALESCE(SUM(c.line_amount), 0) AS SalesAmount,
                COALESCE(SUM(c.commission_amount), 0) AS CommissionAmount,
                COUNT(DISTINCT c.receipt_id) AS ReceiptCount,
                COUNT(DISTINCT COALESCE(sec.id, 0)) AS MallCount
            FROM ext_commission_calculations c
            LEFT JOIN reciepts r ON r.id = c.receipt_id
            LEFT JOIN cashiers cash ON cash.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), cash.section_id)
            WHERE c.salesman_id = @salesmanId
              AND COALESCE(r.creation_date, c.calculated_at) >= @start
              AND COALESCE(r.creation_date, c.calculated_at) < DATEADD(day, 1, CAST(@end AS DATE))
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<(decimal SalesAmount, decimal CommissionAmount, int ReceiptCount, int MallCount)>(
            new CommandDefinition(sql, new { salesmanId, start = start.Date, end = end.Date }, cancellationToken: ct));
        // Seller web must never receive sales totals — only commission and activity.
        return new SellerWeekSummaryDto(start, end, isCurrent, 0, row.CommissionAmount, row.ReceiptCount, row.MallCount);
    }

    private async Task<decimal> BalanceDueAsync(long salesmanId, CancellationToken ct)
    {
        const string sql = """
            SELECT COALESCE(p.opening_balance, 0) + COALESCE((
                SELECT SUM(c.commission_amount) FROM ext_commission_calculations c WHERE c.salesman_id = @salesmanId
            ), 0) - COALESCE(p.paid_out_total, 0)
            FROM (SELECT @salesmanId AS salesman_id) x
            LEFT JOIN ext_salesman_commission_profiles p ON p.salesman_id = x.salesman_id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<decimal>(new CommandDefinition(sql, new { salesmanId }, cancellationToken: ct));
    }

    private bool IsCurrent(DateTime start, CancellationToken _)
    {
        var (cur, _) = BusinessPeriodHelper.GetCurrentWeek();
        return start.Date == cur.Date;
    }

    private sealed class AccountRow
    {
        public string pin_hash { get; set; } = "";
        public bool is_active { get; set; } = true;
    }
}
