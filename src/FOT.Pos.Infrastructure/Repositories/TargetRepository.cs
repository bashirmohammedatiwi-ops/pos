using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Caching.Memory;
using System.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class TargetRepository(
    ISqlConnectionFactory db,
    EdariNexusClient edari,
    ArticleTreeRepository treeRepo,
    BusinessPeriodSettingsRepository periodSettings,
    IMemoryCache cache)
{
    private static readonly TimeSpan TreeProductCacheTtl = TimeSpan.FromMinutes(10);

    public async Task<IReadOnlyList<TargetRuleDto>> ListRulesAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, name AS Name, CAST(is_active AS bit) AS IsActive,
                   edari_tree_seq AS EdariTreeSeq, edari_tree_name AS EdariTreeName,
                   target_type AS TargetType
            FROM ext_target_rules ORDER BY id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rules = (await conn.QueryAsync<TargetRuleRow>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
        return await HydrateRulesAsync(conn, rules, ct);
    }

    public async Task<TargetRuleDto?> GetRuleAsync(long id, CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, name AS Name, CAST(is_active AS bit) AS IsActive,
                   edari_tree_seq AS EdariTreeSeq, edari_tree_name AS EdariTreeName,
                   target_type AS TargetType
            FROM ext_target_rules WHERE id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rule = await conn.QuerySingleOrDefaultAsync<TargetRuleRow>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
        if (rule is null) return null;
        return (await HydrateRulesAsync(conn, [rule], ct)).FirstOrDefault();
    }

    public async Task<IReadOnlyList<TargetProgressDto>> ListProgressAsync(CancellationToken ct)
    {
        var (start, end) = await GetDefaultPeriodAsync(ct);
        var rules = await ListRulesAsync(ct);
        var list = new List<TargetProgressDto>();
        foreach (var rule in rules.Where(r => r.IsActive))
        {
            var breakdown = await GetBreakdownAsync(rule.Id, start, end, ct);
            list.Add(new TargetProgressDto(rule.Id, rule.Name, breakdown.TotalQuantity, start, end));
        }
        return list;
    }

    public async Task<IReadOnlyList<TargetBreakdownDto>> ListBreakdownsAsync(
        DateTime? periodStart, DateTime? periodEnd, CancellationToken ct)
    {
        var (start, end) = periodStart.HasValue && periodEnd.HasValue
            ? ResolvePeriod(periodStart, periodEnd)
            : await GetDefaultPeriodAsync(ct);
        var rules = await ListRulesAsync(ct);
        var list = new List<TargetBreakdownDto>();
        foreach (var rule in rules.Where(r => r.IsActive))
            list.Add(await GetBreakdownAsync(rule.Id, start, end, ct));
        return list;
    }

    public async Task<TargetBreakdownDto> GetBreakdownAsync(
        long ruleId, DateTime? periodStart, DateTime? periodEnd, CancellationToken ct)
    {
        var rule = await GetRuleAsync(ruleId, ct)
            ?? throw new InvalidOperationException("Target rule not found.");

        var (start, end) = ResolvePeriod(periodStart, periodEnd);
        var period = await periodSettings.GetAsync(ct);
        var dayCount = BusinessPeriodHelper.CountCalendarDays(start, end);
        var weekCount = BusinessPeriodHelper.CountBusinessWeeks(start, end, period.WeekStartDay, period.WeekLengthDays);
        var monthCount = BusinessPeriodHelper.CountCalendarMonths(start, end);

        var articleIds = await ResolveProductSeqsForRuleAsync(rule, ct);
        var assignments = rule.Assignments.ToDictionary(a => a.SalesmanId);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var matchIds = articleIds.Count == 0
            ? []
            : await ExpandArticleMatchIdsAsync(conn, articleIds, ct);
        var salesRows = matchIds.Count == 0
            ? []
            : await QuerySalesBySalesmanAsync(conn, matchIds, start, end, ct);
        var productRows = matchIds.Count == 0
            ? []
            : await QuerySalesByProductAsync(conn, matchIds, start, end, ct);

        var salesmanIds = assignments.Keys.Union(salesRows.Select(r => r.SalesmanId)).Distinct();
        // Amount-based targets measure IQD sold; quantity targets count pieces.
        var isAmount = string.Equals(rule.TargetType, "amount", StringComparison.OrdinalIgnoreCase);

        var rows = salesmanIds.Select(id =>
        {
            assignments.TryGetValue(id, out var assign);
            var sale = salesRows.FirstOrDefault(r => r.SalesmanId == id);
            var qty = sale?.Quantity ?? 0;
            var amount = sale?.Amount ?? 0;
            var metric = isAmount ? amount : qty;
            var name = sale?.SalesmanName ?? assign?.SalesmanName;
            var daily = assign?.DailyTarget ?? 0;
            var weekly = assign?.WeeklyTarget ?? 0;
            var monthly = assign?.MonthlyTarget ?? 0;
            return new
            {
                SalesmanId = id,
                SalesmanName = name,
                Quantity = qty,
                Amount = amount,
                DailyTarget = daily,
                WeeklyTarget = weekly,
                MonthlyTarget = monthly,
                DailyPercent = Percent(metric, daily * dayCount),
                WeeklyPercent = Percent(metric, weekly * Math.Max(1, weekCount)),
                MonthlyPercent = Percent(metric, monthly * Math.Max(1, monthCount))
            };
        })
        .OrderByDescending(r => isAmount ? r.Amount : r.Quantity)
        .Select((r, i) => new TargetSalesmanRowDto(
            r.SalesmanId, r.SalesmanName, r.Quantity,
            r.DailyTarget, r.WeeklyTarget, r.MonthlyTarget,
            r.DailyPercent, r.WeeklyPercent, r.MonthlyPercent, i + 1,
            r.Amount))
        .ToList();

        var unassigned = salesRows.Where(r => r.SalesmanId <= 0).Sum(r => r.Quantity);
        var receiptCount = productRows.Sum(p => p.ReceiptCount);
        return new TargetBreakdownDto(
            rule.Id, rule.Name, start, end, rule.Trees.Count, articleIds.Count,
            rows.Sum(r => r.Quantity), rows, rule.Trees, productRows, receiptCount, unassigned,
            rule.TargetType ?? "quantity",
            TotalAmount: rows.Sum(r => r.Amount));
    }

    public async Task<long> CreateAsync(CreateTargetRuleRequest req, CancellationToken ct)
    {
        var trees = NormalizeTrees(req.Trees, req.EdariTreeSeq, req.EdariTreeName);
        var legacy = trees.FirstOrDefault();
        var targetType = req.TargetType == "amount" ? "amount" : "quantity";

        const string sql = """
            INSERT INTO ext_target_rules (name, product_id, target_type, target_value, period_type, start_date, end_date, edari_tree_seq, edari_tree_name)
            OUTPUT INSERTED.id
            VALUES (@Name, NULL, @TargetType, 0, 'daily', CAST(GETDATE() AS DATE), NULL, @EdariTreeSeq, @EdariTreeName)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition(sql, new
        {
            req.Name,
            TargetType = targetType,
            EdariTreeSeq = legacy?.TreeSeq,
            EdariTreeName = legacy?.TreeName
        }, transaction: tx, cancellationToken: ct));

        await SaveTreesAsync(conn, tx, id, trees, ct);
        await SaveAssignmentsAsync(conn, tx, id, req.Assignments, ct);
        if (req.ExcludedArticleIds != null)
            await TreeExclusionStore.ReplaceTargetAsync(conn, tx, id, req.ExcludedArticleIds, ct);
        await tx.CommitAsync(ct);
        cache.Remove(ProductAttributionRepository.ArticlesCacheKey);
        return id;
    }

    public async Task UpdateAsync(long id, UpdateTargetRuleRequest req, CancellationToken ct)
    {
        var trees = NormalizeTrees(req.Trees, null, null);
        var legacy = trees.FirstOrDefault();
        var targetType = req.TargetType == "amount" ? "amount" : "quantity";

        const string sql = """
            UPDATE ext_target_rules SET
                name = @Name,
                target_type = @TargetType,
                edari_tree_seq = @EdariTreeSeq, edari_tree_name = @EdariTreeName
            WHERE id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            id,
            req.Name,
            TargetType = targetType,
            EdariTreeSeq = legacy?.TreeSeq,
            EdariTreeName = legacy?.TreeName
        }, transaction: tx, cancellationToken: ct));

        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_rule_trees WHERE rule_id = @id", new { id }, transaction: tx, cancellationToken: ct));
        await SaveTreesAsync(conn, tx, id, trees, ct);

        // ext_target_progress restricts deletes on ext_target_assignments (NO_ACTION FK) —
        // clear progress rows for this rule's assignments before replacing the assignments.
        await conn.ExecuteAsync(new CommandDefinition("""
            DELETE p FROM ext_target_progress p
            JOIN ext_target_assignments a ON a.id = p.target_assignment_id
            WHERE a.target_rule_id = @id
            """, new { id }, transaction: tx, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_assignments WHERE target_rule_id = @id", new { id }, transaction: tx, cancellationToken: ct));
        await SaveAssignmentsAsync(conn, tx, id, req.Assignments, ct);
        if (req.ExcludedArticleIds != null)
            await TreeExclusionStore.ReplaceTargetAsync(conn, tx, id, req.ExcludedArticleIds, ct);
        await tx.CommitAsync(ct);
        cache.Remove(ProductAttributionRepository.ArticlesCacheKey);
    }

    public async Task DeleteAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        // FK chain is NO_ACTION (restrict) both ways: ext_target_progress -> ext_target_assignments
        // -> ext_target_rules. Must delete child rows in that order before the parent rule.
        await conn.ExecuteAsync(new CommandDefinition("""
            DELETE p FROM ext_target_progress p
            JOIN ext_target_assignments a ON a.id = p.target_assignment_id
            WHERE a.target_rule_id = @id
            """, new { id }, transaction: tx, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_assignments WHERE target_rule_id = @id", new { id }, transaction: tx, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_rule_exclusions WHERE rule_id = @id", new { id }, transaction: tx, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_rules WHERE id = @id", new { id }, transaction: tx, cancellationToken: ct));
        await tx.CommitAsync(ct);
        cache.Remove(ProductAttributionRepository.ArticlesCacheKey);
    }

    public async Task SetActiveAsync(long id, bool active, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_target_rules SET is_active=@active WHERE id=@id", new { id, active }, cancellationToken: ct));
        cache.Remove(ProductAttributionRepository.ArticlesCacheKey);
    }

    public async Task SetArticleExcludedAsync(long ruleId, long articleId, bool excluded, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await TreeExclusionStore.SetTargetAsync(conn, ruleId, articleId, excluded, ct);
        cache.Remove(ProductAttributionRepository.ArticlesCacheKey);
    }

    private async Task<IReadOnlyList<TargetRuleDto>> HydrateRulesAsync(
        IDbConnection conn, IReadOnlyList<TargetRuleRow> rules, CancellationToken ct)
    {
        if (rules.Count == 0) return [];

        var ids = rules.Select(r => r.Id).ToArray();

        const string treeSql = """
            SELECT rule_id AS RuleId, tree_seq AS TreeSeq, tree_name AS TreeName
            FROM ext_target_rule_trees WHERE rule_id IN @ids ORDER BY tree_name
            """;
        var treeRows = (await conn.QueryAsync<TreeRow>(
            new CommandDefinition(treeSql, new { ids }, cancellationToken: ct))).ToList();
        var byRule = treeRows.GroupBy(t => t.RuleId).ToDictionary(g => g.Key, g => g.ToList());

        const string assignSql = """
            SELECT a.target_rule_id AS RuleId, a.employee_id AS SalesmanId, s.name AS SalesmanName,
                   COALESCE(a.daily_target, 0) AS DailyTarget,
                   COALESCE(a.weekly_target, COALESCE(a.assigned_value, 0)) AS WeeklyTarget,
                   COALESCE(a.monthly_target, 0) AS MonthlyTarget
            FROM ext_target_assignments a
            LEFT JOIN salesmen s ON s.id = a.employee_id
            WHERE a.target_rule_id IN @ids AND a.is_active = 1
            ORDER BY s.name
            """;
        var assignRows = (await conn.QueryAsync<AssignmentRow>(
            new CommandDefinition(assignSql, new { ids }, cancellationToken: ct))).ToList();
        var assignByRule = assignRows.GroupBy(a => a.RuleId).ToDictionary(g => g.Key, g => g.ToList());

        var excludeRows = (await conn.QueryAsync<(long RuleId, long ArticleId)>(
            new CommandDefinition("""
                SELECT rule_id, article_id FROM ext_target_rule_exclusions WHERE rule_id IN @ids
                """, new { ids }, cancellationToken: ct))).ToList();
        var excludeByRule = excludeRows.GroupBy(x => x.RuleId).ToDictionary(g => g.Key, g => g.Select(x => x.ArticleId).ToList());

        return rules.Select(r =>
        {
            var trees = byRule.TryGetValue(r.Id, out var list)
                ? list.Select(t => new TargetTreeLinkDto(t.TreeSeq, t.TreeName)).ToList()
                : [];
            if (trees.Count == 0 && r.EdariTreeSeq.HasValue)
                trees.Add(new TargetTreeLinkDto(r.EdariTreeSeq.Value, r.EdariTreeName));

            var assignments = assignByRule.TryGetValue(r.Id, out var alist)
                ? alist.Select(a => new TargetSalesmanAssignmentDto(
                    a.SalesmanId, a.SalesmanName, a.DailyTarget, a.WeeklyTarget, a.MonthlyTarget)).ToList()
                : [];

            var excluded = excludeByRule.TryGetValue(r.Id, out var ex) ? ex : [];
            return new TargetRuleDto(r.Id, r.Name, r.IsActive, trees, assignments, r.EdariTreeSeq, r.EdariTreeName, r.TargetType ?? "quantity", excluded);
        }).ToList();
    }

    private static async Task SaveAssignmentsAsync(
        IDbConnection conn, IDbTransaction tx, long ruleId,
        IReadOnlyList<TargetSalesmanAssignmentDto>? assignments, CancellationToken ct)
    {
        if (assignments is null || assignments.Count == 0) return;
        const string sql = """
            INSERT INTO ext_target_assignments (target_rule_id, employee_id, assigned_value, daily_target, weekly_target, monthly_target, is_active)
            VALUES (@ruleId, @salesmanId, @weeklyTarget, @dailyTarget, @weeklyTarget, @monthlyTarget, 1)
            """;
        foreach (var a in assignments.Where(x => x.SalesmanId > 0))
        {
            await conn.ExecuteAsync(new CommandDefinition(sql, new
            {
                ruleId,
                salesmanId = a.SalesmanId,
                a.DailyTarget,
                a.WeeklyTarget,
                a.MonthlyTarget
            }, transaction: tx, cancellationToken: ct));
        }
    }

    private async Task SaveTreesAsync(
        IDbConnection conn, IDbTransaction tx, long ruleId, IReadOnlyList<TargetTreeLinkDto> trees, CancellationToken ct)
    {
        if (trees.Count == 0) return;
        const string sql = """
            INSERT INTO ext_target_rule_trees (rule_id, tree_seq, tree_name)
            VALUES (@ruleId, @treeSeq, @treeName)
            """;
        foreach (var tree in trees)
        {
            await conn.ExecuteAsync(new CommandDefinition(sql, new
            {
                ruleId,
                treeSeq = tree.TreeSeq,
                treeName = tree.TreeName
            }, transaction: tx, cancellationToken: ct));
        }
    }

    private static IReadOnlyList<TargetTreeLinkDto> NormalizeTrees(
        IReadOnlyList<TargetTreeLinkDto>? trees, long? legacySeq, string? legacyName)
    {
        var list = trees?.Where(t => t.TreeSeq > 0).DistinctBy(t => t.TreeSeq).ToList() ?? [];
        if (list.Count == 0 && legacySeq is > 0)
            list.Add(new TargetTreeLinkDto(legacySeq.Value, legacyName));
        return list;
    }

    public async Task<HashSet<long>> ResolveProductSeqsForRulePublicAsync(TargetRuleDto rule, CancellationToken ct) =>
        await ResolveProductSeqsForRuleAsync(rule, ct);

    private async Task<HashSet<long>> ResolveProductSeqsForRuleAsync(TargetRuleDto rule, CancellationToken ct)
    {
        var set = new HashSet<long>();
        foreach (var tree in rule.Trees)
        {
            foreach (var seq in await ResolveTreeProductSeqsAsync(tree.TreeSeq, ct))
                set.Add(seq);
        }
        if (rule.ExcludedArticleIds is { Count: > 0 })
            set.ExceptWith(rule.ExcludedArticleIds);
        return set;
    }

    private async Task<IReadOnlyList<long>> ResolveTreeProductSeqsAsync(long treeSeq, CancellationToken ct)
    {
        var cacheKey = $"target-tree-products:{treeSeq}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<long>? cached) && cached is not null)
            return cached;

        IReadOnlyList<long> seqs;
        try
        {
            if (await edari.MaterialExistsAsync(treeSeq, ct))
            {
                seqs = await edari.GetDescendantProductSeqsAsync(treeSeq, ct);
                if (seqs.Count > 0)
                {
                    cache.Set(cacheKey, seqs, TreeProductCacheTtl);
                    return seqs;
                }
            }
        }
        catch { /* fallback */ }

        seqs = await treeRepo.GetDescendantProductSeqsAsync(treeSeq, ct);
        cache.Set(cacheKey, seqs, TreeProductCacheTtl);
        return seqs;
    }

    public async Task<IReadOnlyList<TargetReceiptRowDto>> ListReceiptsAsync(
        long ruleId, DateTime? periodStart, DateTime? periodEnd, CancellationToken ct)
    {
        var rule = await GetRuleAsync(ruleId, ct)
            ?? throw new InvalidOperationException("Target rule not found.");
        var (start, end) = ResolvePeriod(periodStart, periodEnd);
        var seqs = await ResolveProductSeqsForRulePublicAsync(rule, ct);
        if (seqs.Count == 0) return [];

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var matchIds = await ExpandArticleMatchIdsAsync(conn, seqs, ct);
        if (matchIds.Count == 0) return [];

        const string sql = """
            SELECT TOP 200
                r.id AS ReceiptId,
                r.number AS ReceiptNumber,
                r.creation_date AS SaleDate,
                COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع') AS SalesmanName,
                SUM(ri.quantity) AS Quantity,
                SUM(ri.quantity * ri.price) AS LineAmount,
                COUNT(*) AS LineCount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
            WHERE r.creation_date >= @periodStart AND r.creation_date < @periodEnd
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND ri.article_id IN @articleIds
            GROUP BY r.id, r.number, r.creation_date,
                     COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0),
                     COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع')
            ORDER BY r.creation_date DESC
            """;
        return (await conn.QueryRowsAsync<TargetReceiptRowDto>(new CommandDefinition(
            sql, new { periodStart = start, periodEnd = end, articleIds = matchIds.ToArray() },
            cancellationToken: ct))).ToList();
    }

    private static Task<HashSet<long>> ExpandArticleMatchIdsAsync(
        IDbConnection conn, HashSet<long> seqs, CancellationToken ct) =>
        ArticleMatch.ExpandReceiptMatchIdsAsync(conn, seqs, ct);

    private static async Task<IReadOnlyList<TargetProductRowDto>> QuerySalesByProductAsync(
        IDbConnection conn, HashSet<long> articleIds, DateTime periodStart, DateTime periodEnd, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP 80
                   COALESCE(a.Seq, ri.article_id) AS ArticleSeq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS ProductName,
                   SUM(ri.quantity) AS Quantity,
                   COUNT(DISTINCT r.id) AS ReceiptCount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            LEFT JOIN articles a ON a.id = ri.article_id
            WHERE r.creation_date >= @periodStart AND r.creation_date < @periodEnd
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND ri.article_id IN @articleIds
              AND NOT EXISTS (
                  SELECT 1 FROM cashiers cx
                  WHERE cx.id = r.cashier_id AND cx.apply_targets = 0)
            GROUP BY COALESCE(a.Seq, ri.article_id), a.Name1
            ORDER BY Quantity DESC
            """;
        if (articleIds.Count <= 2000)
        {
            return (await conn.QueryRowsAsync<TargetProductRowDto>(new CommandDefinition(
                sql, new { periodStart, periodEnd, articleIds = articleIds.ToArray() }, cancellationToken: ct))).ToList();
        }

        return [];
    }

    private static async Task<IReadOnlyList<SalesRow>> QuerySalesBySalesmanAsync(
        IDbConnection conn, HashSet<long> articleIds, DateTime periodStart, DateTime periodEnd, CancellationToken ct)
    {
        if (articleIds.Count <= 2000)
        {
            const string sql = """
                SELECT COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                       COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع') AS SalesmanName,
                       SUM(ri.quantity) AS Quantity,
                       SUM(CAST(ABS(ri.quantity) * ri.price AS DECIMAL(18,2))) AS Amount
                FROM reciepts r
                INNER JOIN reciept_items ri ON ri.reciept_id = r.id
                LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
                WHERE r.creation_date >= @periodStart AND r.creation_date < @periodEnd
                  AND (r.is_pending = 0 OR r.is_pending IS NULL)
                  AND ri.article_id IN @articleIds
                  AND NOT EXISTS (
                      SELECT 1 FROM cashiers cx
                      WHERE cx.id = r.cashier_id AND cx.apply_targets = 0)
                GROUP BY COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0),
                         COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع')
                """;
            return (await conn.QueryAsync<SalesRow>(new CommandDefinition(
                sql, new { periodStart, periodEnd, articleIds = articleIds.ToArray() }, cancellationToken: ct))).ToList();
        }

        await conn.ExecuteAsync(new CommandDefinition(
            "CREATE TABLE #target_articles (article_id BIGINT PRIMARY KEY)", cancellationToken: ct));
        foreach (var batch in articleIds.Chunk(1000))
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO #target_articles (article_id) VALUES (@id)",
                batch.Select(id => new { id }), cancellationToken: ct));
        }

        const string bigSql = """
            SELECT COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS SalesmanId,
                   COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع') AS SalesmanName,
                   SUM(ri.quantity) AS Quantity,
                   SUM(CAST(ABS(ri.quantity) * ri.price AS DECIMAL(18,2))) AS Amount
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            INNER JOIN #target_articles ta ON ta.article_id = ri.article_id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
            WHERE r.creation_date >= @periodStart AND r.creation_date < @periodEnd
              AND (r.is_pending = 0 OR r.is_pending IS NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM cashiers cx
                  WHERE cx.id = r.cashier_id AND cx.apply_targets = 0)
            GROUP BY COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0),
                     COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), s.name, N'بدون بائع')
            """;
        var result = (await conn.QueryAsync<SalesRow>(new CommandDefinition(
            bigSql, new { periodStart, periodEnd }, cancellationToken: ct))).ToList();
        await conn.ExecuteAsync(new CommandDefinition("DROP TABLE #target_articles", cancellationToken: ct));
        return result;
    }

    private static (DateTime Start, DateTime End) ResolvePeriod(DateTime? periodStart, DateTime? periodEnd)
    {
        if (periodStart.HasValue && periodEnd.HasValue)
        {
            var start = periodStart.Value.Date;
            var end = periodEnd.Value.Date;
            if (end <= start) end = start.AddDays(1);
            else end = end.AddDays(1);
            return (start, end);
        }
        return GetDefaultPeriodStatic();
    }

    private static (DateTime Start, DateTime End) GetDefaultPeriodStatic()
    {
        var (start, endInclusive) = BusinessPeriodHelper.GetCurrentWeek();
        return (start, endInclusive.AddDays(1));
    }

    private async Task<(DateTime Start, DateTime End)> GetDefaultPeriodAsync(CancellationToken ct)
    {
        var period = await periodSettings.GetAsync(ct);
        var (start, endInclusive) = BusinessPeriodHelper.GetCurrentWeek(period.WeekStartDay, period.WeekLengthDays);
        return (start, endInclusive.AddDays(1));
    }

    private static decimal Percent(decimal achieved, decimal expected)
    {
        if (expected <= 0) return 0;
        return Math.Min(100m, achieved / expected * 100m);
    }

    private sealed class TargetRuleRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public bool IsActive { get; set; }
        public long? EdariTreeSeq { get; set; }
        public string? EdariTreeName { get; set; }
        public string? TargetType { get; set; }
    }

    private sealed class TreeRow
    {
        public long RuleId { get; set; }
        public long TreeSeq { get; set; }
        public string? TreeName { get; set; }
    }

    private sealed class AssignmentRow
    {
        public long RuleId { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public decimal DailyTarget { get; set; }
        public decimal WeeklyTarget { get; set; }
        public decimal MonthlyTarget { get; set; }
    }

    private sealed class SalesRow
    {
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public decimal Quantity { get; set; }
        public decimal Amount { get; set; }
    }
}
