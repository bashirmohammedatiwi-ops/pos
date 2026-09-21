using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Services;

public sealed record TreeMembershipRefreshResult(int OffersTreesChecked, int OffersItemsAdded, int GroupsTreesChecked, int GroupItemsAdded);

/// <summary>
/// Dynamic tree membership: when a whole tree (شجرة كاملة) is added to an offer or a
/// commission group, products later placed under that tree in Edari must join
/// automatically with whatever their tree carries. This refresher re-resolves every
/// registered tree and INSERTs only missing members (excluded rows stay excluded,
/// manual edits are never deleted). Runs after each Edari catalog pull that changed
/// articles, and on demand from the admin UI per tree.
/// </summary>
public sealed class TreeMembershipRefresher(
    ISqlConnectionFactory db,
    EdariNexusClient edari,
    ArticleTreeRepository treeRepo,
    ILogger<TreeMembershipRefresher> logger)
{
    public async Task<TreeMembershipRefreshResult> RefreshAllAsync(CancellationToken ct)
    {
        var (offerTrees, offerAdded) = await RefreshOffersAsync(ct);
        var (groupTrees, groupAdded) = await RefreshCommissionGroupsAsync(ct);
        if (offerAdded + groupAdded > 0)
            logger.LogInformation("Tree membership refresh: +{Offers} offer items, +{Groups} commission items", offerAdded, groupAdded);
        return new TreeMembershipRefreshResult(offerTrees, offerAdded, groupTrees, groupAdded);
    }

    /// <summary>Re-sync one offer tree batch; returns (currentCount, added).</summary>
    public async Task<(int CurrentCount, int Added)> RefreshOfferTreeAsync(long offerId, long treeSeq, CancellationToken ct)
    {
        var (seqs, _) = await ResolveTreeAsync(treeSeq, ct);
        var added = await InsertMissingOfferMembersAsync(offerId, treeSeq, seqs, ct);
        return (seqs.Count, added);
    }

    /// <summary>Re-sync one commission-group tree; returns (currentCount, added).</summary>
    public async Task<(int CurrentCount, int Added)> RefreshGroupTreeAsync(long groupId, long treeSeq, CancellationToken ct)
    {
        var (seqs, name) = await ResolveTreeAsync(treeSeq, ct);
        var added = await InsertMissingGroupMembersAsync(groupId, treeSeq, name, seqs, ct);
        return (seqs.Count, added);
    }

    private async Task<(int Trees, int Added)> RefreshOffersAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var batches = (await conn.QueryAsync<(long OfferId, long TreeSeq)>(
            new CommandDefinition("""
                SELECT DISTINCT offer_id, CAST(source_tree_seq AS BIGINT)
                FROM offer_details
                WHERE source_tree_seq IS NOT NULL AND COALESCE(excluded, 0) = 0
                """, cancellationToken: ct))).ToList();
        if (batches.Count == 0) return (0, 0);

        var total = 0;
        foreach (var (offerId, treeSeq) in batches)
        {
            try
            {
                var (seqs, _) = await ResolveTreeAsync(treeSeq, ct);
                total += await InsertMissingOfferMembersAsync(offerId, treeSeq, seqs, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Offer tree refresh failed for offer {Offer} tree {Tree}", offerId, treeSeq);
            }
        }
        return (batches.Count, total);
    }

    private async Task<(int Trees, int Added)> RefreshCommissionGroupsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var trees = (await conn.QueryAsync<(long GroupId, long TreeSeq, string? Name)>(
            new CommandDefinition("""
                SELECT group_id, CAST(tree_seq AS BIGINT), tree_name
                FROM ext_commission_group_trees
                WHERE COALESCE(is_full_tree, 1) = 1
                """, cancellationToken: ct))).ToList();
        if (trees.Count == 0) return (0, 0);

        var total = 0;
        foreach (var (groupId, treeSeq, name) in trees)
        {
            try
            {
                var (seqs, resolvedName) = await ResolveTreeAsync(treeSeq, ct);
                total += await InsertMissingGroupMembersAsync(groupId, treeSeq, resolvedName ?? name, seqs, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Commission tree refresh failed for group {Group} tree {Tree}", groupId, treeSeq);
            }
        }
        return (trees.Count, total);
    }

    private async Task<int> InsertMissingOfferMembersAsync(
        long offerId, long treeSeq, IReadOnlyList<long> currentSeqs, CancellationToken ct)
    {
        if (currentSeqs.Count == 0) return 0;
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        // Template of the batch: an existing active (non-excluded) row carries the
        // tree's current discount/dates — new members inherit exactly what the tree applies.
        var template = await conn.QuerySingleOrDefaultAsync<(decimal Discount, DateTime? From, DateTime? To, bool Unlimited)>(
            new CommandDefinition("""
                SELECT TOP 1
                    CAST(discount AS DECIMAL(18,2)) AS Discount,
                    from_date AS From, to_date AS [To],
                    CAST(Unlimited AS BIT) AS Unlimited
                FROM offer_details
                WHERE offer_id = @offerId AND source_tree_seq = @treeSeq AND COALESCE(excluded, 0) = 0
                ORDER BY id
                """, new { offerId, treeSeq }, cancellationToken: ct));

        var existing = (await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT item_id FROM offer_details WHERE offer_id = @offerId AND item_id IS NOT NULL",
            new { offerId }, cancellationToken: ct))).ToHashSet();

        var liveSeqs = currentSeqs.Count == 0
            ? []
            : (await conn.QueryAsync<long>(new CommandDefinition("""
                SELECT Seq FROM articles
                WHERE Seq IN @seqs
                  AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))), N'') IS NOT NULL
                """, new { seqs = currentSeqs.ToArray() }, cancellationToken: ct))).ToHashSet();

        var added = 0;
        foreach (var seq in currentSeqs)
        {
            if (!liveSeqs.Contains(seq) || existing.Contains(seq)) continue;
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO offer_details
                    (offer_id, item_id, discount, discount_type, from_date, to_date, Unlimited, detail_role, source_tree_seq, tree_synced_at)
                VALUES (@offerId, @seq, @discount, 0, @from, @to, @unlimited, 0, @treeSeq, GETDATE())
                """, new
            {
                offerId, seq, treeSeq,
                discount = template.Discount, from = template.From, to = template.To, unlimited = template.Unlimited
            }, cancellationToken: ct));
            existing.Add(seq);
            added++;
        }

        if (added > 0)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE offer_details SET tree_synced_at = GETDATE() WHERE offer_id = @offerId AND source_tree_seq = @treeSeq",
                new { offerId, treeSeq }, cancellationToken: ct));
        }
        return added;
    }

    private async Task<int> InsertMissingGroupMembersAsync(
        long groupId, long treeSeq, string? treeName, IReadOnlyList<long> currentSeqs, CancellationToken ct)
    {
        if (currentSeqs.Count == 0) return 0;
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        var existing = (await conn.QueryAsync<long?>(new CommandDefinition(
            "SELECT article_id FROM ext_commission_group_items WHERE group_id = @groupId",
            new { groupId }, cancellationToken: ct)))
            .Where(a => a.HasValue).Select(a => a!.Value).ToHashSet();

        var toAbsorb = currentSeqs.Where(existing.Contains).Distinct().ToList();
        if (toAbsorb.Count > 0)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE ext_commission_group_items
                SET source_tree_seq = @treeSeq,
                    source_tree_name = COALESCE(@treeName, source_tree_name),
                    tree_synced_at = GETDATE()
                WHERE group_id = @groupId
                  AND article_id IN @seqs
                  AND (source_tree_seq IS NULL OR source_tree_seq <> @treeSeq)
                """, new { groupId, treeSeq, treeName, seqs = toAbsorb }, cancellationToken: ct));
        }

        // Resolve names/barcodes for the missing members in one round-trip.
        var missing = currentSeqs.Where(s => !existing.Contains(s)).ToList();
        if (missing.Count == 0)
        {
            if (toAbsorb.Count > 0)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE ext_commission_group_trees SET last_synced_at = GETDATE() WHERE group_id = @groupId AND tree_seq = @treeSeq",
                    new { groupId, treeSeq }, cancellationToken: ct));
            }
            return 0;
        }

        var info = (await conn.QueryAsync<(long Seq, string? Name, string? Barcode)>(
            new CommandDefinition(
                "SELECT Seq, Name1, Barcode FROM articles WHERE Seq IN @seqs",
                new { seqs = missing }, cancellationToken: ct))).ToDictionary(r => r.Seq);

        foreach (var seq in missing)
        {
            var row = info.TryGetValue(seq, out var v) ? v : (seq, null, null);
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_commission_group_items
                    (group_id, article_id, barcode, article_name, source_tree_seq, source_tree_name, tree_synced_at)
                VALUES (@groupId, @seq, @barcode, @name, @treeSeq, @treeName, GETDATE())
                """, new { groupId, seq = (long?)seq, barcode = row.Barcode, name = row.Name, treeSeq, treeName }, cancellationToken: ct));
        }

        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_commission_group_trees SET last_synced_at = GETDATE() WHERE group_id = @groupId AND tree_seq = @treeSeq",
            new { groupId, treeSeq }, cancellationToken: ct));
        return missing.Count;
    }

    private async Task<(IReadOnlyList<long> Seqs, string? Name)> ResolveTreeAsync(long treeSeq, CancellationToken ct)
    {
        try
        {
            if (await edari.MaterialExistsAsync(treeSeq, ct))
            {
                var seqs = await edari.GetDescendantProductSeqsAsync(treeSeq, ct);
                var name = await edari.GetNodeNameAsync(treeSeq, ct);
                if (seqs.Count > 0 || !string.IsNullOrWhiteSpace(name))
                    return (seqs, name);
            }
        }
        catch
        {
            /* fall back to the local articles mirror */
        }
        var local = await treeRepo.GetDescendantProductSeqsAsync(treeSeq, ct);
        var localName = await treeRepo.GetNodeNameAsync(treeSeq, ct);
        return (local, localName);
    }
}
