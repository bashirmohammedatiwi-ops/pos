using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class WeeklySettlementRepository(
    ISqlConnectionFactory db,
    CommissionRepository commissions,
    TargetRepository targets,
    BusinessPeriodSettingsRepository periodSettings)
{
    public async Task<WeeklySettlementReportDto> GetReportAsync(DateTime? weekStart, CancellationToken ct)
    {
        var bounds = await ResolveWeekAsync(weekStart, ct);
        var settings = await LoadSettingsAsync(ct);
        var salesmanIds = settings.SalesmanIds;
        var deduction = settings.DeductionPercent;

        if (salesmanIds.Count == 0)
        {
            return new WeeklySettlementReportDto(
                bounds.Start, bounds.End, bounds.IsCurrent, !bounds.IsCurrent,
                deduction, salesmanIds, [], []);
        }

        var summaries = await commissions.SalesmanSummaryAsync(
            bounds.Start, bounds.End, activeOnly: false, includeAll: true, ct);
        var commissionById = summaries.ToDictionary(s => s.SalesmanId);

        var names = await LoadNamesAsync(salesmanIds, ct);
        var stored = await LoadSettlementsAsync(bounds.Start, salesmanIds, ct);

        var rules = await targets.ListRulesAsync(ct);
        var pinned = salesmanIds.ToHashSet();
        var columns = new List<WeeklySettlementTargetColumnDto>();
        var cellsBySalesman = new Dictionary<long, List<WeeklySettlementTargetCellDto>>();

        foreach (var rule in rules.Where(r => r.IsActive).OrderBy(r => r.Id))
        {
            var assignments = rule.Assignments ?? [];
            if (!assignments.Any(a => pinned.Contains(a.SalesmanId))) continue;

            var breakdown = await targets.GetBreakdownAsync(rule.Id, bounds.Start, bounds.End, ct);
            var type = string.IsNullOrWhiteSpace(rule.TargetType) ? "quantity" : rule.TargetType;
            columns.Add(new WeeklySettlementTargetColumnDto(rule.Id, rule.Name, type));
            var isAmount = string.Equals(type, "amount", StringComparison.OrdinalIgnoreCase);
            var soldById = breakdown.Salesmen.ToDictionary(s => s.SalesmanId);
            var assigned = assignments.ToDictionary(a => a.SalesmanId);

            foreach (var id in salesmanIds)
            {
                if (!assigned.TryGetValue(id, out var assign)) continue;
                soldById.TryGetValue(id, out var sm);
                var sold = isAmount ? (sm?.Amount ?? 0) : (sm?.Quantity ?? 0);
                var goal = assign.WeeklyTarget;
                var cell = new WeeklySettlementTargetCellDto(rule.Id, sold, goal, Percent(sold, goal));
                if (!cellsBySalesman.TryGetValue(id, out var list))
                {
                    list = [];
                    cellsBySalesman[id] = list;
                }
                list.Add(cell);
            }
        }

        var rows = new List<WeeklySettlementRowDto>(salesmanIds.Count);
        foreach (var id in salesmanIds)
        {
            commissionById.TryGetValue(id, out var summary);
            stored.TryGetValue(id, out var settle);
            names.TryGetValue(id, out var name);
            var commission = summary?.TotalCommission ?? 0;
            cellsBySalesman.TryGetValue(id, out var cells);
            rows.Add(new WeeklySettlementRowDto(
                id,
                summary?.SalesmanName ?? name,
                commission,
                AfterDeduction(commission, deduction),
                settle?.Amount ?? 0,
                settle?.Delivered ?? false,
                settle?.DeliveredAt,
                settle?.PayoutId,
                cells ?? []));
        }

        return new WeeklySettlementReportDto(
            bounds.Start, bounds.End, bounds.IsCurrent, !bounds.IsCurrent,
            deduction, salesmanIds, columns, rows);
    }

    public async Task<WeeklySettlementSettingsDto> SaveSettingsAsync(
        UpdateWeeklySettlementSettingsRequest req, CancellationToken ct)
    {
        var percent = Math.Clamp(req.DeductionPercent, 0, 100);
        var ids = (req.SalesmanIds ?? [])
            .Where(id => id > 0)
            .Distinct()
            .ToList();

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_weekly_settlement_settings WHERE id = 1)
                INSERT INTO ext_weekly_settlement_settings (id, deduction_percent) VALUES (1, @percent);
            ELSE
                UPDATE ext_weekly_settlement_settings
                SET deduction_percent = @percent, updated_at = GETDATE()
                WHERE id = 1;
            """, new { percent }, transaction: tx, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_weekly_settlement_salesmen",
            transaction: tx, cancellationToken: ct));
        var order = 0;
        foreach (var id in ids)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_weekly_settlement_salesmen (salesman_id, sort_order)
                VALUES (@id, @order)
                """, new { id, order }, transaction: tx, cancellationToken: ct));
            order++;
        }
        await tx.CommitAsync(ct);
        return new WeeklySettlementSettingsDto(percent, ids);
    }

    public async Task<WeeklySettlementRowSaveDto> SaveRowAsync(
        UpdateWeeklySettlementRowRequest req, CancellationToken ct)
    {
        if (req.SalesmanId <= 0) throw new InvalidOperationException("البائع غير صالح");

        var bounds = await ResolveWeekAsync(req.WeekStart, ct);
        var settings = await LoadSettingsAsync(ct);
        if (!settings.SalesmanIds.Contains(req.SalesmanId))
            throw new InvalidOperationException("البائع غير ظاهر في الكشف");

        var existing = await LoadOneAsync(bounds.Start, req.SalesmanId, ct);
        var amount = req.Amount ?? existing?.Amount ?? 0;
        if (amount < 0) throw new InvalidOperationException("مبلغ التسليم لا يكون سالباً");

        var delivered = existing?.Delivered ?? false;
        var deliveredAt = existing?.DeliveredAt;
        var payoutId = existing?.PayoutId;
        long? createdPayoutId = null;

        if (existing?.Delivered == true && req.Delivered != false)
        {
            if (req.Amount is decimal next && next != existing.Amount)
                throw new InvalidOperationException("الصف مؤشَّر — تراجع أولاً لتعديل المبلغ");
            return new WeeklySettlementRowSaveDto(
                req.SalesmanId, existing.Amount, true, existing.DeliveredAt, existing.PayoutId);
        }

        if (req.Delivered == true)
        {
            if (bounds.IsCurrent)
                throw new InvalidOperationException("لا يمكن التأشير قبل انتهاء الأسبوع");
            if (amount <= 0)
                throw new InvalidOperationException("أدخل مبلغ تسليم أكبر من صفر");

            if (payoutId is null or <= 0)
            {
                var note = $"تسليم أسبوع من {bounds.Start:yyyy-MM-dd} إلى {bounds.End:yyyy-MM-dd}";
                var payout = await commissions.RecordPayoutAsync(
                    req.SalesmanId,
                    new RecordCommissionPayoutRequest(amount, DateTime.Now, note),
                    ct);
                payoutId = payout.Id;
                createdPayoutId = payout.Id;
            }

            delivered = true;
            deliveredAt = DateTime.Now;
        }
        else if (req.Delivered == false)
        {
            if (payoutId is > 0)
                await commissions.VoidPayoutAsync(payoutId.Value, ct);
            delivered = false;
            deliveredAt = null;
            payoutId = null;
        }

        try
        {
            await UpsertSettlementAsync(bounds.Start, req.SalesmanId, amount, delivered, deliveredAt, payoutId, ct);
        }
        catch
        {
            if (createdPayoutId is > 0)
                await commissions.VoidPayoutAsync(createdPayoutId.Value, ct);
            throw;
        }
        return new WeeklySettlementRowSaveDto(req.SalesmanId, amount, delivered, deliveredAt, payoutId);
    }

    private async Task<(DateTime Start, DateTime End, bool IsCurrent)> ResolveWeekAsync(
        DateTime? weekStart, CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        var (currentStart, currentEnd) = BusinessPeriodHelper.GetCurrentWeek(
            period.WeekStartDay, period.WeekLengthDays);
        var seed = (weekStart ?? currentStart).Date;
        var (start, end) = BusinessPeriodHelper.GetWeekBounds(
            seed, period.WeekStartDay, period.WeekLengthDays);
        if (start > currentStart)
        {
            start = currentStart;
            end = currentEnd;
        }
        return (start, end, start == currentStart);
    }

    private async Task<WeeklySettlementSettingsDto> LoadSettingsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_weekly_settlement_settings WHERE id = 1)
                INSERT INTO ext_weekly_settlement_settings (id, deduction_percent) VALUES (1, 0);
            """, cancellationToken: ct));
        var percent = await conn.ExecuteScalarAsync<decimal>(new CommandDefinition(
            "SELECT deduction_percent FROM ext_weekly_settlement_settings WHERE id = 1",
            cancellationToken: ct));
        var ids = (await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT salesman_id
            FROM ext_weekly_settlement_salesmen
            ORDER BY sort_order, salesman_id
            """, cancellationToken: ct))).ToList();
        return new WeeklySettlementSettingsDto(percent, ids);
    }

    private async Task<Dictionary<long, string?>> LoadNamesAsync(
        IReadOnlyList<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<NameRow>(new CommandDefinition(
            "SELECT id AS Id, name AS Name FROM salesmen WHERE id IN @ids",
            new { ids }, cancellationToken: ct));
        return rows.ToDictionary(r => r.Id, r => r.Name);
    }

    private async Task<Dictionary<long, SettlementRow>> LoadSettlementsAsync(
        DateTime weekStart, IReadOnlyList<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<SettlementRow>(new CommandDefinition("""
            SELECT salesman_id AS SalesmanId, amount AS Amount,
                   CAST(delivered AS bit) AS Delivered, delivered_at AS DeliveredAt,
                   payout_id AS PayoutId
            FROM ext_weekly_settlements
            WHERE week_start = @weekStart AND salesman_id IN @ids
            """, new { weekStart = weekStart.Date, ids }, cancellationToken: ct));
        return rows.ToDictionary(r => r.SalesmanId);
    }

    private async Task<SettlementRow?> LoadOneAsync(DateTime weekStart, long salesmanId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<SettlementRow>(new CommandDefinition("""
            SELECT salesman_id AS SalesmanId, amount AS Amount,
                   CAST(delivered AS bit) AS Delivered, delivered_at AS DeliveredAt,
                   payout_id AS PayoutId
            FROM ext_weekly_settlements
            WHERE week_start = @weekStart AND salesman_id = @salesmanId
            """, new { weekStart = weekStart.Date, salesmanId }, cancellationToken: ct));
    }

    private async Task UpsertSettlementAsync(
        DateTime weekStart, long salesmanId, decimal amount, bool delivered,
        DateTime? deliveredAt, long? payoutId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            MERGE ext_weekly_settlements AS t
            USING (SELECT CAST(@weekStart AS DATE) AS week_start, @salesmanId AS salesman_id) AS s
              ON t.week_start = s.week_start AND t.salesman_id = s.salesman_id
            WHEN MATCHED THEN UPDATE SET
                amount = @amount,
                delivered = @delivered,
                delivered_at = @deliveredAt,
                payout_id = @payoutId,
                updated_at = GETDATE()
            WHEN NOT MATCHED THEN INSERT
                (week_start, salesman_id, amount, delivered, delivered_at, payout_id)
                VALUES (s.week_start, s.salesman_id, @amount, @delivered, @deliveredAt, @payoutId);
            """, new
        {
            weekStart = weekStart.Date,
            salesmanId,
            amount,
            delivered,
            deliveredAt,
            payoutId
        }, cancellationToken: ct));
    }

    private static decimal AfterDeduction(decimal commission, decimal percent)
    {
        var p = Math.Clamp(percent, 0, 100);
        return Math.Round(commission * (1 - p / 100m), 0, MidpointRounding.AwayFromZero);
    }

    private static decimal Percent(decimal achieved, decimal expected)
    {
        if (expected <= 0) return 0;
        return Math.Min(100m, Math.Round(achieved / expected * 100m, 1, MidpointRounding.AwayFromZero));
    }

    private sealed class SettlementRow
    {
        public long SalesmanId { get; set; }
        public decimal Amount { get; set; }
        public bool Delivered { get; set; }
        public DateTime? DeliveredAt { get; set; }
        public long? PayoutId { get; set; }
    }

    private sealed class NameRow
    {
        public long Id { get; set; }
        public string? Name { get; set; }
    }
}
