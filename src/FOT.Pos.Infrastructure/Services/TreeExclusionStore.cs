using System.Data;
using Dapper;

namespace FOT.Pos.Infrastructure.Services;

/// <summary>
/// Durable "removed from this full tree" records. Membership refresh must never
/// re-insert these Seq values, even if the member row was deleted.
/// </summary>
internal static class TreeExclusionStore
{
    public static async Task SetCommissionAsync(
        IDbConnection conn, long groupId, long articleId, long? treeSeq, bool excluded,
        CancellationToken ct, IDbTransaction? tx = null)
    {
        if (articleId <= 0) return;
        if (excluded)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                IF NOT EXISTS (SELECT 1 FROM ext_commission_group_exclusions WHERE group_id=@groupId AND article_id=@articleId)
                    INSERT INTO ext_commission_group_exclusions (group_id, article_id, source_tree_seq)
                    VALUES (@groupId, @articleId, @treeSeq)
                """, new { groupId, articleId, treeSeq }, tx, cancellationToken: ct));
            return;
        }
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_exclusions WHERE group_id=@groupId AND article_id=@articleId",
            new { groupId, articleId }, tx, cancellationToken: ct));
    }

    public static async Task SetOfferAsync(
        IDbConnection conn, long offerId, long itemId, long? treeSeq, bool excluded,
        CancellationToken ct, IDbTransaction? tx = null)
    {
        if (itemId <= 0) return;
        if (excluded)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                IF NOT EXISTS (SELECT 1 FROM offer_tree_exclusions WHERE offer_id=@offerId AND item_id=@itemId)
                    INSERT INTO offer_tree_exclusions (offer_id, item_id, source_tree_seq)
                    VALUES (@offerId, @itemId, @treeSeq)
                """, new { offerId, itemId, treeSeq }, tx, cancellationToken: ct));
            return;
        }
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM offer_tree_exclusions WHERE offer_id=@offerId AND item_id=@itemId",
            new { offerId, itemId }, tx, cancellationToken: ct));
    }

    public static async Task SetTargetAsync(
        IDbConnection conn, long ruleId, long articleId, bool excluded,
        CancellationToken ct, IDbTransaction? tx = null)
    {
        if (articleId <= 0) return;
        if (excluded)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                IF NOT EXISTS (SELECT 1 FROM ext_target_rule_exclusions WHERE rule_id=@ruleId AND article_id=@articleId)
                    INSERT INTO ext_target_rule_exclusions (rule_id, article_id)
                    VALUES (@ruleId, @articleId)
                """, new { ruleId, articleId }, tx, cancellationToken: ct));
            return;
        }
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_rule_exclusions WHERE rule_id=@ruleId AND article_id=@articleId",
            new { ruleId, articleId }, tx, cancellationToken: ct));
    }

    public static async Task<HashSet<long>> CommissionBlockedAsync(
        IDbConnection conn, long groupId, CancellationToken ct, IDbTransaction? tx = null)
    {
        var ids = await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT article_id FROM ext_commission_group_exclusions WHERE group_id=@groupId",
            new { groupId }, tx, cancellationToken: ct));
        return ids.ToHashSet();
    }

    public static async Task<HashSet<long>> OfferBlockedAsync(
        IDbConnection conn, long offerId, CancellationToken ct, IDbTransaction? tx = null)
    {
        var ids = await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT item_id FROM offer_tree_exclusions WHERE offer_id=@offerId",
            new { offerId }, tx, cancellationToken: ct));
        return ids.ToHashSet();
    }

    public static async Task<HashSet<long>> TargetBlockedAsync(
        IDbConnection conn, long ruleId, CancellationToken ct, IDbTransaction? tx = null)
    {
        var ids = await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT article_id FROM ext_target_rule_exclusions WHERE rule_id=@ruleId",
            new { ruleId }, tx, cancellationToken: ct));
        return ids.ToHashSet();
    }

    public static async Task ReplaceTargetAsync(
        IDbConnection conn, IDbTransaction tx, long ruleId, IReadOnlyList<long> articleIds, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_target_rule_exclusions WHERE rule_id=@ruleId",
            new { ruleId }, tx, cancellationToken: ct));
        foreach (var articleId in articleIds.Where(id => id > 0).Distinct())
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_target_rule_exclusions (rule_id, article_id)
                VALUES (@ruleId, @articleId)
                """, new { ruleId, articleId }, tx, cancellationToken: ct));
        }
    }
}
