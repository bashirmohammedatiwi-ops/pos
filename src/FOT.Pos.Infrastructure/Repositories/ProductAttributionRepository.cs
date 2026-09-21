using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ProductAttributionRepository(ISqlConnectionFactory db, TargetRepository targets, IMemoryCache cache)
{
    public const string ArticlesCacheKey = "pos:attribution-articles-seq";
    public const string TargetKeysCacheKey = "pos:attribution-target-keys-seq";
    private static readonly TimeSpan ArticlesCacheTtl = TimeSpan.FromMinutes(10);

    public async Task<ProductAttributionDto> GetAsync(long articleId, string? barcode, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var keys = await ResolveKeysAsync(conn, articleId, ct);
        var hasCommission = await HasCommissionAsync(conn, keys, barcode, ct);
        // Target trees are cached; skip the walk when commission already requires a salesman.
        var hasTarget = !hasCommission && keys is not null && await HasTargetAsync(keys, ct);
        var requires = hasCommission || hasTarget;
        return new ProductAttributionDto(requires, hasCommission, hasTarget, BuildReason(hasCommission, hasTarget));
    }

    public Task<IReadOnlySet<long>> GetArticlesRequiringSalesmanAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync(ArticlesCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = ArticlesCacheTtl;
            return await LoadArticlesRequiringSalesmanAsync(ct);
        })!;

    public void InvalidateArticlesCache()
    {
        cache.Remove(ArticlesCacheKey);
        cache.Remove(TargetKeysCacheKey);
    }

    /// <summary>
    /// مندوبو منتج ذو عمولة: إن قُيِّدت مجموعات/قواعد المنتج بمندوبين بعينهم تُعاد قائمتهم (Restricted=true)،
    /// وإلا فالبضاعة متاحة لكل المندوبين (Restricted=false).
    /// </summary>
    public async Task<ProductAllowedSalesmenDto> GetAllowedSalesmenAsync(long articleId, string? barcode, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var keys = await ResolveKeysAsync(conn, articleId, ct);
        var bc = string.IsNullOrWhiteSpace(barcode) ? null : barcode.Trim();
        const string sql = """
            SELECT s.id AS Id, LTRIM(RTRIM(s.name)) AS Name FROM (
                SELECT DISTINCT gs.salesman_id
                FROM ext_commission_group_items gi
                INNER JOIN ext_commission_groups g ON g.id = gi.group_id AND g.is_active = 1
                  AND g.effective_from <= CAST(GETDATE() AS DATE)
                  AND (g.effective_to IS NULL OR g.effective_to >= CAST(GETDATE() AS DATE))
                INNER JOIN ext_commission_group_salesmen gs ON gs.group_id = g.id
                WHERE COALESCE(gi.excluded, 0) = 0
                  AND (
                    (@seq IS NOT NULL AND gi.article_id = @seq)
                    OR (@bc IS NOT NULL AND gi.barcode = @bc)
                  )
                UNION
                SELECT DISTINCT r.salesman_id
                FROM ext_commission_rules r
                WHERE r.is_active = 1 AND r.salesman_id > 0
                  AND r.effective_from <= CAST(GETDATE() AS DATE)
                  AND (r.effective_to IS NULL OR r.effective_to >= CAST(GETDATE() AS DATE))
                  AND (
                    (@seq IS NOT NULL AND r.product_id = @seq)
                    OR (@bc IS NOT NULL AND r.article_barcode = @bc)
                  )
            ) x
            INNER JOIN salesmen s ON s.id = x.salesman_id
            WHERE s.name IS NOT NULL AND LTRIM(RTRIM(s.name)) <> N''
            ORDER BY s.id
            """;
        var items = (await conn.QueryRowsAsync<SalesmanDto>(new CommandDefinition(
            sql,
            new { seq = keys?.Seq, bc = (object?)bc ?? DBNull.Value },
            cancellationToken: ct))).ToList();
        return new ProductAllowedSalesmenDto(items.Count > 0, items);
    }

    private async Task<IReadOnlySet<long>> LoadArticlesRequiringSalesmanAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var raw = new HashSet<long>();

        var ruleSeqs = await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT DISTINCT product_id FROM ext_commission_rules
            WHERE is_active = 1 AND product_id IS NOT NULL AND product_id > 0
              AND effective_from <= CAST(GETDATE() AS DATE)
              AND (effective_to IS NULL OR effective_to >= CAST(GETDATE() AS DATE))
            """, cancellationToken: ct));
        foreach (var seq in ruleSeqs) raw.Add(seq);

        var groupSeqs = await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT DISTINCT i.article_id FROM ext_commission_group_items i
            INNER JOIN ext_commission_groups g ON g.id = i.group_id AND g.is_active = 1
              AND g.effective_from <= CAST(GETDATE() AS DATE)
              AND (g.effective_to IS NULL OR g.effective_to >= CAST(GETDATE() AS DATE))
            WHERE i.article_id IS NOT NULL AND i.article_id > 0
              AND COALESCE(i.excluded, 0) = 0
            """, cancellationToken: ct));
        foreach (var seq in groupSeqs) raw.Add(seq);

        foreach (var key in await LoadTargetKeysAsync(ct))
            raw.Add(key);

        if (raw.Count == 0) return new HashSet<long>();

        var expanded = await ExpandArticleKeysAsync(conn, raw, ct);
        return expanded;
    }

    private async Task<HashSet<long>> LoadTargetKeysAsync(CancellationToken ct)
    {
        var seqs = new HashSet<long>();
        var activeRules = await targets.ListRulesAsync(ct);
        foreach (var rule in activeRules.Where(r => r.IsActive))
        {
            var ruleProductSeqs = await targets.ResolveProductSeqsForRulePublicAsync(rule, ct);
            foreach (var seq in ruleProductSeqs) seqs.Add(seq);
        }

        if (seqs.Count == 0) return [];
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await ExpandArticleKeysAsync(conn, seqs, ct);
    }

    private Task<HashSet<long>> GetTargetKeysAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync(TargetKeysCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = ArticlesCacheTtl;
            return await LoadTargetKeysAsync(ct);
        })!;

    private async Task<bool> HasTargetAsync(ArticleKeys keys, CancellationToken ct)
    {
        var set = await GetTargetKeysAsync(ct);
        return keys.Seq > 0 && set.Contains(keys.Seq);
    }

    /// <summary>
    /// العضوية والتاركت تُخزَّن بـ Edari Seq. لا نضيف articles.id أبداً:
    /// هوية SQL تتصادم مع Seq لمنتج آخر (مثال: id 3571 = رفيولي، Seq 3571 = دويل موس).
    /// المفتاح القديم المخزَّن كـ SQL id يُحوَّل إلى Seq فقط إن لم يكن هذا الرقم Seq لمنتج آخر.
    /// </summary>
    private static async Task<HashSet<long>> ExpandArticleKeysAsync(
        System.Data.Common.DbConnection conn, HashSet<long> raw, CancellationToken ct)
    {
        var keys = raw.Where(k => k > 0).Distinct().ToArray();
        var set = new HashSet<long>(keys);
        if (keys.Length == 0) return set;

        var seqs = await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT a.Seq
            FROM articles a
            WHERE a.Seq IN @keys
            UNION
            SELECT a.Seq
            FROM articles a
            WHERE a.id IN @keys
              AND NOT EXISTS (SELECT 1 FROM articles b WHERE b.Seq = a.id)
            """, new { keys }, cancellationToken: ct));
        foreach (var seq in seqs)
        {
            if (seq > 0) set.Add(seq);
        }
        return set;
    }

    private static async Task<ArticleKeys?> ResolveKeysAsync(
        System.Data.Common.DbConnection conn, long articleId, CancellationToken ct)
    {
        if (articleId <= 0) return null;
        return await conn.QueryFirstOrDefaultAsync<ArticleKeys>(new CommandDefinition("""
            SELECT TOP 1 id AS Id, Seq
            FROM articles
            WHERE id = @articleId OR Seq = @articleId
            ORDER BY CASE WHEN id = @articleId THEN 0 ELSE 1 END
            """, new { articleId }, cancellationToken: ct));
    }

    private static async Task<bool> HasCommissionAsync(
        System.Data.Common.DbConnection conn, ArticleKeys? keys, string? barcode, CancellationToken ct)
    {
        var bc = string.IsNullOrWhiteSpace(barcode) ? null : barcode.Trim();
        if (keys is null && bc is null) return false;

        const string sql = """
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM ext_commission_rules r
                WHERE r.is_active = 1
                  AND r.effective_from <= CAST(GETDATE() AS DATE)
                  AND (r.effective_to IS NULL OR r.effective_to >= CAST(GETDATE() AS DATE))
                  AND (
                    (@seq IS NOT NULL AND r.product_id = @seq)
                    OR (@bc IS NOT NULL AND r.article_barcode = @bc)
                  )
            ) OR EXISTS (
                SELECT 1 FROM ext_commission_group_items gi
                INNER JOIN ext_commission_groups g ON g.id = gi.group_id
                WHERE g.is_active = 1
                  AND COALESCE(gi.excluded, 0) = 0
                  AND g.effective_from <= CAST(GETDATE() AS DATE)
                  AND (g.effective_to IS NULL OR g.effective_to >= CAST(GETDATE() AS DATE))
                  AND (
                    (@seq IS NOT NULL AND gi.article_id = @seq)
                    OR (@bc IS NOT NULL AND gi.barcode = @bc)
                  )
            ) THEN 1 ELSE 0 END
            """;
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql,
            new { seq = keys?.Seq, bc = (object?)bc ?? DBNull.Value },
            cancellationToken: ct));
    }

    private static string? BuildReason(bool hasCommission, bool hasTarget) => (hasCommission, hasTarget) switch
    {
        (true, true) => "عمولة وتاركت — اختر المندوب",
        (true, false) => "عمولة — اختر المندوب",
        (false, true) => "تاركت — اختر المندوب",
        _ => null
    };

    private sealed record ArticleKeys(long Id, long Seq);
}
