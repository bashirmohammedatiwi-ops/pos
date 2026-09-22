using System.Data.Common;
using System.Threading;
using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Services;
using Microsoft.Extensions.Caching.Memory;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class CommissionGroupRepository(
    ISqlConnectionFactory db,
    ArticleTreeRepository treeRepo,
    EdariNexusClient edari,
    ProductRepository products,
    IMemoryCache cache)
{
    private const string GroupSelect = """
        SELECT g.id AS Id, g.name AS Name, g.description AS Description,
               g.commission_type AS CommissionType, g.commission_value AS CommissionValue,
               g.salesman_id AS SalesmanId, s.name AS SalesmanName, g.label AS Label,
               g.sort_order AS SortOrder, g.color_hex AS ColorHex,
               CAST(g.is_active AS bit) AS IsActive,
               g.effective_from AS EffectiveFrom, g.effective_to AS EffectiveTo,
               (SELECT COUNT(*) FROM ext_commission_group_trees t WHERE t.group_id = g.id) AS TreeCount,
               (SELECT COUNT(*) FROM ext_commission_group_items i WHERE i.group_id = g.id) AS ItemCount,
               (SELECT COUNT(DISTINCT COALESCE(CAST(i.article_id AS NVARCHAR(30)), i.barcode))
                FROM ext_commission_group_items i WHERE i.group_id = g.id) AS ProductCount
        FROM ext_commission_groups g
        LEFT JOIN salesmen s ON s.id = g.salesman_id
        """;

    private const string TreesForGroupSql = """
        SELECT t.id AS Id, t.tree_seq AS TreeSeq, t.tree_name AS TreeName,
               CAST(t.is_full_tree AS bit) AS IsFullTree,
               (SELECT COUNT(*) FROM ext_commission_group_items i
                WHERE i.group_id = t.group_id AND i.source_tree_seq = t.tree_seq
                  AND COALESCE(i.excluded, 0) = 0) AS ProductCount,
               (SELECT COUNT(*) FROM ext_commission_group_items i
                WHERE i.group_id = t.group_id AND i.source_tree_seq = t.tree_seq
                  AND COALESCE(i.excluded, 0) = 1) AS ExcludedCount,
               t.last_synced_at AS LastSyncedAt
        FROM ext_commission_group_trees t
        WHERE t.group_id = @id
        ORDER BY t.tree_name, t.tree_seq
        """;

    public sealed record GroupMatchRow(
        long GroupId, string? GroupName, long? SalesmanId,
        string CommissionType, decimal CommissionValue, int SortOrder,
        long? ArticleId, string? Barcode);

    public async Task<IReadOnlyList<CommissionGroupDto>> ListAsync(CancellationToken ct)
    {
        var sql = GroupSelect + " ORDER BY g.sort_order, g.id";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsureSalesmenTableAsync(conn, ct);
        var groups = (await conn.QueryRowsAsync<CommissionGroupDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
        var salesmen = await LoadSalesmenAsync(conn, groups.Select(g => g.Id).ToArray(), ct);
        return groups.Select(g => g with { Salesmen = salesmen.GetValueOrDefault(g.Id) ?? [] }).ToList();
    }

    public async Task<CommissionGroupDetailDto?> GetDetailAsync(long id, CancellationToken ct)
    {
        var sql = GroupSelect + " WHERE g.id = @id";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var group = await conn.QueryRowOrDefaultAsync<CommissionGroupDto>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
        if (group is null) return null;

        var trees = (await conn.QueryRowsAsync<CommissionGroupTreeDto>(new CommandDefinition(
            TreesForGroupSql, new { id }, cancellationToken: ct))).ToList();

        var absorbed = 0;
        foreach (var tree in trees.Where(t => t.IsFullTree))
        {
            IReadOnlyList<long> seqs = await treeRepo.GetDescendantProductSeqsAsync(tree.TreeSeq, ct);
            if (seqs.Count == 0)
                seqs = (await ResolveTreeProductsAsync(tree.TreeSeq, ct)).Seqs;
            absorbed += await AbsorbItemsIntoTreeAsync(conn, id, tree.TreeSeq, tree.TreeName, seqs, ct);
        }
        if (absorbed > 0)
        {
            trees = (await conn.QueryRowsAsync<CommissionGroupTreeDto>(new CommandDefinition(
                TreesForGroupSql, new { id }, cancellationToken: ct))).ToList();
        }

        var items = (await conn.QueryRowsAsync<CommissionGroupItemDto>(new CommandDefinition("""
            SELECT i.id AS Id, i.article_id AS ArticleId, i.barcode AS Barcode,
                   COALESCE(i.article_name, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1)))) AS ArticleName,
                   i.source_tree_seq AS SourceTreeSeq, i.source_tree_name AS SourceTreeName,
                   CAST(COALESCE(i.excluded, 0) AS bit) AS Excluded,
                   CAST(COALESCE(NULLIF(a.SellPr4, 0), 0) AS DECIMAL(18,0)) AS Price
            FROM ext_commission_group_items i
            LEFT JOIN articles a ON a.Seq = i.article_id
            WHERE i.group_id = @id
            ORDER BY i.source_tree_seq, i.article_name, i.id
            """, new { id }, cancellationToken: ct))).ToList();

        await EnsureSalesmenTableAsync(conn, ct);
        var salesmen = await LoadSalesmenAsync(conn, [id], ct);
        return new CommissionGroupDetailDto(
            group.Id, group.Name, group.Description,
            group.CommissionType, group.CommissionValue,
            group.SalesmanId, group.SalesmanName, group.Label,
            group.SortOrder, group.ColorHex, group.IsActive,
            group.EffectiveFrom, group.EffectiveTo,
            trees, items)
        {
            Salesmen = salesmen.GetValueOrDefault(id) ?? []
        };
    }

    public async Task<long> CreateAsync(CreateCommissionGroupRequest req, CancellationToken ct)
    {
        TouchAttribution();
        const string sql = """
            INSERT INTO ext_commission_groups (
                name, description, commission_type, commission_value,
                salesman_id, label, sort_order, color_hex, effective_from, effective_to)
            OUTPUT INSERTED.id VALUES (
                @name, @desc, @type, @value,
                @salesmanId, @label, @sort, @color,
                COALESCE(@from, CAST(GETDATE() AS DATE)), @to)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsureSalesmenTableAsync(conn, ct);
        var ids = ResolveSalesmanIds(req.SalesmanId, req.SalesmanIds);
        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition(sql, new
        {
            name = req.Name,
            desc = req.Description,
            type = req.CommissionType,
            value = req.CommissionValue,
            salesmanId = ids.Count > 0 ? ids[0] : (long?)null,
            label = req.Label,
            sort = req.SortOrder,
            color = req.ColorHex,
            from = req.EffectiveFrom,
            to = req.EffectiveTo
        }, cancellationToken: ct));
        await ReplaceSalesmenAsync(conn, id, ids, ct);
        return id;
    }

    public async Task<bool> UpdateAsync(long id, UpdateCommissionGroupRequest req, CancellationToken ct)
    {
        TouchAttribution();
        const string sql = """
            UPDATE ext_commission_groups SET
                name = @name, description = @desc,
                commission_type = @type, commission_value = @value,
                salesman_id = @salesmanId, label = @label,
                sort_order = @sort, color_hex = @color, is_active = @active,
                effective_from = COALESCE(@from, effective_from),
                effective_to = @to, updated_at = GETDATE()
            WHERE id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsureSalesmenTableAsync(conn, ct);
        var ids = ResolveSalesmanIds(req.SalesmanId, req.SalesmanIds);
        var ok = await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            id,
            name = req.Name,
            desc = req.Description,
            type = req.CommissionType,
            value = req.CommissionValue,
            salesmanId = ids.Count > 0 ? ids[0] : (long?)null,
            label = req.Label,
            sort = req.SortOrder,
            color = req.ColorHex,
            active = req.IsActive,
            from = req.EffectiveFrom,
            to = req.EffectiveTo
        }, cancellationToken: ct)) > 0;
        if (ok) await ReplaceSalesmenAsync(conn, id, ids, ct);
        return ok;
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_exclusions WHERE group_id = @id", new { id }, cancellationToken: ct));
        return await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_groups WHERE id = @id", new { id }, cancellationToken: ct)) > 0;
    }

    public async Task SetActiveAsync(long id, bool active, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_commission_groups SET is_active=@active, updated_at=GETDATE() WHERE id=@id",
            new { id, active }, cancellationToken: ct));
    }

    public async Task<CommissionGroupTreeApplyResult> AddTreeAsync(long groupId, AddCommissionGroupTreeRequest req, CancellationToken ct)
    {
        TouchAttribution();
        var (seqs, treeName) = await ResolveTreeProductsAsync(req.TreeSeq, ct);
        var name = req.TreeName ?? treeName;
        if (seqs.Count == 0)
            return new CommissionGroupTreeApplyResult(0, 0, name);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_commission_group_trees WHERE group_id=@groupId AND tree_seq=@treeSeq)
                INSERT INTO ext_commission_group_trees (group_id, tree_seq, tree_name, is_full_tree)
                VALUES (@groupId, @treeSeq, @name, 1)
            ELSE
                UPDATE ext_commission_group_trees SET tree_name=@name, is_full_tree=1
                WHERE group_id=@groupId AND tree_seq=@treeSeq
            """, new { groupId, treeSeq = req.TreeSeq, name }, cancellationToken: ct));

        var (added, skipped, updated) = await ApplyTreeMembersAsync(
            conn, groupId, req.TreeSeq, name, seqs, ct);
        return new CommissionGroupTreeApplyResult(added, skipped, name, updated);
    }

    public async Task<CommissionGroupTreeApplyResult> AddPartialTreeAsync(
        long groupId, AddCommissionGroupPartialTreeRequest req, CancellationToken ct)
    {
        TouchAttribution();
        if (req.ArticleIds.Count == 0)
            return new CommissionGroupTreeApplyResult(0, 0, req.TreeName);

        var (_, treeName) = await ResolveTreeProductsAsync(req.TreeSeq, ct);
        var name = req.TreeName ?? treeName;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_commission_group_trees WHERE group_id=@groupId AND tree_seq=@treeSeq)
                INSERT INTO ext_commission_group_trees (group_id, tree_seq, tree_name, is_full_tree)
                VALUES (@groupId, @treeSeq, @name, 0)
            ELSE
                UPDATE ext_commission_group_trees SET tree_name=@name, is_full_tree=0
                WHERE group_id=@groupId AND tree_seq=@treeSeq
            """, new { groupId, treeSeq = req.TreeSeq, name }, cancellationToken: ct));

        var (added, skipped, updated) = await ApplyTreeMembersAsync(
            conn, groupId, req.TreeSeq, name, req.ArticleIds, ct);
        return new CommissionGroupTreeApplyResult(added, skipped, name, updated);
    }

    public async Task<CommissionGroupItemDto?> AddProductAsync(long groupId, AddCommissionGroupProductRequest req, CancellationToken ct)
    {
        TouchAttribution();
        long? articleSeq = null;
        string? barcode = req.Barcode?.Trim();
        string? articleName = null;

        if (req.ArticleId.HasValue)
        {
            await using var lookup = await db.CreateOpenConnectionAsync(ct);
            // Seq and id overlap across articles (~19k rows in FOT_POS_V2). Prefer Seq —
            // the admin picker always sends Edari Seq. QuerySingle throws
            // "Sequence contains more than one element" without TOP 1.
            var row = await lookup.QueryFirstOrDefaultAsync<(long Seq, string? Name, string? Barcode)>(
                new CommandDefinition("""
                    SELECT TOP 1 Seq, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) AS Name, Barcode
                    FROM articles
                    WHERE Seq = @seq OR id = @seq
                    ORDER BY CASE WHEN Seq = @seq THEN 0 ELSE 1 END
                    """, new { seq = req.ArticleId.Value }, cancellationToken: ct));
            if (row.Seq == 0) return null;
            articleSeq = row.Seq;
            articleName = row.Name;
            barcode ??= row.Barcode;
        }
        else if (!string.IsNullOrWhiteSpace(barcode))
        {
            var product = await products.GetByBarcodeAsync(barcode, ct);
            if (product is not null)
            {
                articleSeq = product.Seq;
                articleName = product.Name;
                barcode = product.Barcode ?? barcode;
            }
        }
        else return null;

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        if (articleSeq.HasValue)
        {
            var exists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM ext_commission_group_items WHERE group_id=@groupId AND article_id=@articleSeq",
                new { groupId, articleSeq }, cancellationToken: ct));
            if (exists > 0)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE ext_commission_group_items SET excluded = 0 WHERE group_id=@groupId AND article_id=@articleSeq",
                    new { groupId, articleSeq }, cancellationToken: ct));
                await TreeExclusionStore.SetCommissionAsync(conn, groupId, articleSeq.Value, null, false, ct);
                return await conn.QueryRowOrDefaultAsync<CommissionGroupItemDto>(new CommandDefinition("""
                    SELECT TOP 1 i.id AS Id, i.article_id AS ArticleId, i.barcode AS Barcode,
                           COALESCE(i.article_name, @name) AS ArticleName,
                           i.source_tree_seq AS SourceTreeSeq, i.source_tree_name AS SourceTreeName
                    FROM ext_commission_group_items i WHERE group_id=@groupId AND article_id=@articleSeq
                    """, new { groupId, articleSeq, name = articleName }, cancellationToken: ct));
            }

            var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO ext_commission_group_items (group_id, article_id, barcode, article_name)
                OUTPUT INSERTED.id VALUES (@groupId, @articleSeq, @barcode, @name)
                """, new { groupId, articleSeq, barcode, name = articleName }, cancellationToken: ct));

            return new CommissionGroupItemDto(id, articleSeq, barcode, articleName, null, null);
        }

        var id2 = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO ext_commission_group_items (group_id, barcode, article_name)
            OUTPUT INSERTED.id VALUES (@groupId, @barcode, NULL)
            """, new { groupId, barcode }, cancellationToken: ct));
        return new CommissionGroupItemDto(id2, null, barcode, null, null, null);
    }

    public async Task<int> DeleteTreeAsync(long groupId, long treeSeq, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            DELETE FROM ext_commission_group_exclusions
            WHERE group_id=@groupId AND (
                source_tree_seq=@treeSeq
                OR article_id IN (
                    SELECT article_id FROM ext_commission_group_items
                    WHERE group_id=@groupId AND source_tree_seq=@treeSeq AND article_id IS NOT NULL
                )
            )
            """, new { groupId, treeSeq }, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_items WHERE group_id=@groupId AND source_tree_seq=@treeSeq",
            new { groupId, treeSeq }, cancellationToken: ct));
        return await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_trees WHERE group_id=@groupId AND tree_seq=@treeSeq",
            new { groupId, treeSeq }, cancellationToken: ct));
    }

    public async Task<bool> DeleteItemAsync(long groupId, long itemId, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<(long? ArticleId, long? SourceTree)>(
            new CommandDefinition("""
                SELECT article_id, source_tree_seq
                FROM ext_commission_group_items
                WHERE id=@itemId AND group_id=@groupId
                """, new { itemId, groupId }, cancellationToken: ct));
        if (row == default) return false;

        var keepAsExclusion = row.ArticleId is > 0 && row.SourceTree is > 0
            && await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM ext_commission_group_trees
                    WHERE group_id=@groupId AND tree_seq=@treeSeq AND COALESCE(is_full_tree, 1) = 1
                ) THEN 1 ELSE 0 END
                """, new { groupId, treeSeq = row.SourceTree }, cancellationToken: ct)) == 1;

        if (keepAsExclusion)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE ext_commission_group_items SET excluded = 1 WHERE id=@itemId AND group_id=@groupId",
                new { itemId, groupId }, cancellationToken: ct));
            await TreeExclusionStore.SetCommissionAsync(conn, groupId, row.ArticleId!.Value, row.SourceTree, true, ct);
            return true;
        }

        return await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_items WHERE id=@itemId AND group_id=@groupId",
            new { itemId, groupId }, cancellationToken: ct)) > 0;
    }

    public async Task<int> MoveItemsAsync(MoveCommissionGroupItemsRequest req, CancellationToken ct)
    {
        TouchAttribution();
        if (req.ItemIds.Count == 0) return 0;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_commission_group_items SET group_id=@toGroupId
            WHERE id IN @ids
            """, new { toGroupId = req.ToGroupId, ids = req.ItemIds.ToArray() }, cancellationToken: ct));
    }

    public async Task<int> MoveTreeAsync(MoveCommissionGroupTreeRequest req, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        var tree = await conn.QuerySingleOrDefaultAsync<GroupTreeRow>(new CommandDefinition("""
            SELECT id AS Id, tree_name AS TreeName, CAST(is_full_tree AS bit) AS IsFullTree
            FROM ext_commission_group_trees
            WHERE group_id=@fromGroupId AND tree_seq=@treeSeq
            """, new { req.FromGroupId, req.TreeSeq }, cancellationToken: ct));
        if (tree is null) return 0;

        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_trees WHERE group_id=@fromGroupId AND tree_seq=@treeSeq",
            new { req.FromGroupId, req.TreeSeq }, cancellationToken: ct));

        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_commission_group_trees WHERE group_id=@toGroupId AND tree_seq=@treeSeq)
                INSERT INTO ext_commission_group_trees (group_id, tree_seq, tree_name, is_full_tree)
                VALUES (@toGroupId, @treeSeq, @name, @isFull)
            """, new { toGroupId = req.ToGroupId, treeSeq = req.TreeSeq, name = tree.TreeName, isFull = tree.IsFullTree },
            cancellationToken: ct));

        await conn.ExecuteAsync(new CommandDefinition("""
            DELETE x
            FROM ext_commission_group_exclusions x
            WHERE x.group_id=@toGroupId AND x.article_id IN (
                SELECT article_id FROM ext_commission_group_exclusions
                WHERE group_id=@fromGroupId AND (
                    source_tree_seq=@treeSeq
                    OR article_id IN (
                        SELECT article_id FROM ext_commission_group_items
                        WHERE group_id=@fromGroupId AND source_tree_seq=@treeSeq AND article_id IS NOT NULL
                    )
                )
            )
            """, new { toGroupId = req.ToGroupId, fromGroupId = req.FromGroupId, treeSeq = req.TreeSeq },
            cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_commission_group_exclusions SET group_id=@toGroupId
            WHERE group_id=@fromGroupId AND (
                source_tree_seq=@treeSeq
                OR article_id IN (
                    SELECT article_id FROM ext_commission_group_items
                    WHERE group_id=@fromGroupId AND source_tree_seq=@treeSeq AND article_id IS NOT NULL
                )
            )
            """, new { toGroupId = req.ToGroupId, fromGroupId = req.FromGroupId, treeSeq = req.TreeSeq },
            cancellationToken: ct));

        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_commission_group_items SET group_id=@toGroupId
            WHERE group_id=@fromGroupId AND source_tree_seq=@treeSeq
            """, new { toGroupId = req.ToGroupId, fromGroupId = req.FromGroupId, treeSeq = req.TreeSeq },
            cancellationToken: ct));
    }

    public async Task<IReadOnlyList<CommissionGroupTreeProductDto>> ListTreeProductsAsync(
        long groupId, long treeSeq, CancellationToken ct)
    {
        var (seqs, _) = await ResolveTreeProductsAsync(treeSeq, ct);
        if (seqs.Count == 0) return [];

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var blocked = await TreeExclusionStore.CommissionBlockedAsync(conn, groupId, ct);
        var state = (await conn.QueryAsync<(long ArticleId, long ItemId, bool Excluded)>(
            new CommandDefinition("""
                SELECT article_id, id, CAST(COALESCE(excluded,0) AS BIT)
                FROM ext_commission_group_items
                WHERE group_id=@groupId AND article_id IN @seqs
                """, new { groupId, seqs = seqs.ToArray() }, cancellationToken: ct)))
            .GroupBy(r => r.ArticleId)
            .ToDictionary(g => g.Key, g => g.First());

        var rows = await conn.QueryAsync<(long Seq, string? Name, string? Barcode, decimal Price)>(new CommandDefinition("""
            SELECT a.Seq, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name, a.Barcode,
                   CAST(COALESCE(NULLIF(a.SellPr4, 0), 0) AS DECIMAL(18,0)) AS Price
            FROM articles a WHERE a.Seq IN @seqs
            ORDER BY a.Name1
            """, new { seqs = seqs.ToArray() }, cancellationToken: ct));

        return rows.Select(r =>
        {
            var has = state.TryGetValue(r.Seq, out var v);
            var excluded = (has && v.Excluded) || blocked.Contains(r.Seq);
            return new CommissionGroupTreeProductDto(
                r.Seq, r.Name, r.Barcode, has && !excluded,
                excluded,
                has ? v.ItemId : null,
                r.Price);
        }).ToList();
    }

    /// <summary>Exclude/un-exclude one item — stays excluded across membership refreshes.</summary>
    public async Task<bool> SetItemExcludedAsync(long itemId, bool excluded, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<(long GroupId, long? ArticleId, long? SourceTree)>(
            new CommandDefinition("""
                SELECT group_id, article_id, source_tree_seq
                FROM ext_commission_group_items WHERE id = @itemId
                """, new { itemId }, cancellationToken: ct));
        if (row == default) return false;
        var ok = await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_commission_group_items SET excluded = @excluded WHERE id = @itemId",
            new { itemId, excluded }, cancellationToken: ct)) > 0;
        if (ok && row.ArticleId is > 0)
            await TreeExclusionStore.SetCommissionAsync(conn, row.GroupId, row.ArticleId.Value, row.SourceTree, excluded, ct);
        return ok;
    }

    /// <summary>Exclude a product Seq from a full tree even when the membership row was already deleted.</summary>
    public async Task SetArticleExcludedAsync(long groupId, long articleId, bool excluded, CancellationToken ct)
    {
        TouchAttribution();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var treeSeq = await conn.ExecuteScalarAsync<long?>(new CommandDefinition("""
            SELECT TOP 1 source_tree_seq FROM ext_commission_group_items
            WHERE group_id=@groupId AND article_id=@articleId
            """, new { groupId, articleId }, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_commission_group_items SET excluded = @excluded
            WHERE group_id=@groupId AND article_id=@articleId
            """, new { groupId, articleId, excluded }, cancellationToken: ct));
        await TreeExclusionStore.SetCommissionAsync(conn, groupId, articleId, treeSeq, excluded, ct);
    }

    public async Task<IReadOnlyList<GroupMatchRow>> GetActiveMatchersAsync(
        DbConnection conn, DbTransaction? tx, CancellationToken ct)
    {
        await EnsureSalesmenTableAsync(conn, ct, tx);
        const string sql = """
            SELECT g.id AS GroupId, g.name AS GroupName, gs.salesman_id AS SalesmanId,
                   g.commission_type AS CommissionType,
                   CAST(g.commission_value AS DECIMAL(18,6)) AS CommissionValue,
                   g.sort_order AS SortOrder,
                   COALESCE(canon.Seq, i.article_id) AS ArticleId, i.barcode AS Barcode
            FROM ext_commission_groups g
            INNER JOIN ext_commission_group_items i ON i.group_id = g.id
            LEFT JOIN ext_commission_group_salesmen gs ON gs.group_id = g.id
            OUTER APPLY (
                SELECT TOP 1 a.Seq
                FROM articles a
                WHERE i.article_id IS NOT NULL AND (a.Seq = i.article_id OR a.id = i.article_id)
                ORDER BY CASE WHEN a.Seq = i.article_id THEN 0 ELSE 1 END
            ) canon
            WHERE g.is_active = 1
              AND COALESCE(i.excluded, 0) = 0
              AND g.effective_from <= CAST(GETDATE() AS DATE)
              AND (g.effective_to IS NULL OR g.effective_to >= CAST(GETDATE() AS DATE))
            ORDER BY g.sort_order, g.id
            """;
        return (await conn.QueryAsync<GroupMatchRow>(new CommandDefinition(
            sql, transaction: tx, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyDictionary<long, IReadOnlyList<ProductCommissionMembershipDto>>> GetMembershipsByArticleIdsAsync(
        IReadOnlyCollection<long> articleIds, CancellationToken ct)
    {
        var empty = new Dictionary<long, IReadOnlyList<ProductCommissionMembershipDto>>();
        if (articleIds.Count == 0) return empty;

        const string sql = """
            SELECT i.article_id AS ArticleId, g.id AS GroupId, g.name AS GroupName,
                   CAST(g.is_active AS BIT) AS IsActive,
                   g.commission_type AS CommissionType,
                   CAST(g.commission_value AS DECIMAL(18,6)) AS CommissionValue,
                   i.source_tree_seq AS SourceTreeSeq, i.source_tree_name AS SourceTreeName,
                   CAST(COALESCE(i.excluded, 0) AS BIT) AS Excluded
            FROM ext_commission_group_items i
            INNER JOIN ext_commission_groups g ON g.id = i.group_id
            WHERE i.article_id IN @ids
            ORDER BY g.sort_order, g.name, g.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<MembershipRow>(new CommandDefinition(
            sql, new { ids = articleIds.Distinct().ToArray() }, cancellationToken: ct))).ToList();

        var map = new Dictionary<long, IReadOnlyList<ProductCommissionMembershipDto>>();
        foreach (var group in rows.GroupBy(r => r.ArticleId))
        {
            var seen = new HashSet<long>();
            var list = new List<ProductCommissionMembershipDto>();
            foreach (var r in group)
            {
                if (!seen.Add(r.GroupId)) continue;
                list.Add(new ProductCommissionMembershipDto(
                    r.GroupId, r.GroupName ?? $"مجموعة #{r.GroupId}", r.IsActive,
                    r.CommissionType, r.CommissionValue,
                    r.SourceTreeSeq, r.SourceTreeName, r.Excluded));
            }
            map[group.Key] = list;
        }
        return map;
    }

    public async Task<IReadOnlyList<ProductCommissionLookupDto>> LookupAsync(string term, int limit, CancellationToken ct)
    {
        var cap = Math.Clamp(limit, 1, 40);
        var found = await products.SearchLocalAsync(term, cap, ct);
        var extraIds = await SearchMemberArticleIdsAsync(term, cap, ct);
        var hits = new List<(long Id, long Seq, string? Name, string? Barcode, string? Num, decimal Price)>();
        var seen = new HashSet<long>();
        foreach (var p in found)
        {
            if (!seen.Add(p.Seq)) continue;
            hits.Add((p.Id, p.Seq, p.Name, p.Barcode, p.Num, p.OriginalPrice > 0 ? p.OriginalPrice : p.Price));
        }

        var missing = extraIds.Where(id => seen.Add(id)).ToList();
        if (missing.Count > 0)
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var cards = await conn.QueryAsync<(long Seq, long Id, string? Name, string? Barcode, string? Num, decimal Price)>(
                new CommandDefinition("""
                    SELECT i.article_id AS Seq,
                           COALESCE(a.id, i.article_id) AS Id,
                           COALESCE(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), i.article_name) AS Name,
                           COALESCE(a.Barcode, i.barcode) AS Barcode,
                           a.Num AS Num,
                           CAST(COALESCE(NULLIF(a.SellPr4, 0), 0) AS DECIMAL(18,0)) AS Price
                    FROM (
                        SELECT article_id, MAX(article_name) AS article_name, MAX(barcode) AS barcode
                        FROM ext_commission_group_items
                        WHERE article_id IN @ids
                        GROUP BY article_id
                    ) i
                    LEFT JOIN articles a ON a.Seq = i.article_id
                    """, new { ids = missing.ToArray() }, cancellationToken: ct));
            foreach (var c in cards)
                hits.Add(c);
        }

        var memberships = await GetMembershipsByArticleIdsAsync(hits.Select(h => h.Seq).ToList(), ct);
        return hits.Take(cap).Select(h => new ProductCommissionLookupDto(
            h.Id, h.Seq, h.Name, h.Barcode, h.Num, h.Price,
            memberships.GetValueOrDefault(h.Seq) ?? [])).ToList();
    }

    public async Task<IReadOnlyList<CommissionOverlapProductDto>> ListOverlapsAsync(CancellationToken ct)
    {
        const string sql = """
            ;WITH dups AS (
                SELECT TOP 200 i.article_id
                FROM ext_commission_group_items i
                WHERE i.article_id IS NOT NULL AND COALESCE(i.excluded, 0) = 0
                GROUP BY i.article_id
                HAVING COUNT(DISTINCT i.group_id) > 1
                ORDER BY i.article_id
            )
            SELECT i.article_id AS ArticleId,
                   COALESCE(MAX(i.article_name), LTRIM(RTRIM(CONVERT(NVARCHAR(4000), MAX(a.Name1))))) AS Name,
                   COALESCE(MAX(i.barcode), MAX(a.Barcode)) AS Barcode,
                   CAST(COALESCE(NULLIF(MAX(a.SellPr4), 0), 0) AS DECIMAL(18,0)) AS Price,
                   g.id AS GroupId, g.name AS GroupName,
                   CAST(g.is_active AS BIT) AS IsActive,
                   g.commission_type AS CommissionType,
                   CAST(g.commission_value AS DECIMAL(18,6)) AS CommissionValue,
                   MIN(i.source_tree_seq) AS SourceTreeSeq,
                   MAX(i.source_tree_name) AS SourceTreeName
            FROM ext_commission_group_items i
            INNER JOIN dups d ON d.article_id = i.article_id
            INNER JOIN ext_commission_groups g ON g.id = i.group_id
            LEFT JOIN articles a ON a.Seq = i.article_id
            WHERE COALESCE(i.excluded, 0) = 0
            GROUP BY i.article_id, g.id, g.name, g.is_active, g.commission_type, g.commission_value, g.sort_order
            ORDER BY Name, i.article_id, g.sort_order, g.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<OverlapRow>(new CommandDefinition(sql, cancellationToken: ct))).ToList();

        return rows
            .GroupBy(r => r.ArticleId)
            .Select(g =>
            {
                var first = g.First();
                return new CommissionOverlapProductDto(
                    g.Key, first.Name, first.Barcode, first.Price,
                    g.Select(r => new CommissionOverlapGroupDto(
                        r.GroupId, r.GroupName ?? $"مجموعة #{r.GroupId}", r.IsActive,
                        r.CommissionType, r.CommissionValue,
                        r.SourceTreeSeq, r.SourceTreeName)).ToList());
            })
            .ToList();
    }

    private async Task<IReadOnlyList<long>> SearchMemberArticleIdsAsync(string term, int limit, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var ids = await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT DISTINCT TOP (@limit) i.article_id
            FROM ext_commission_group_items i
            LEFT JOIN articles a ON a.Seq = i.article_id
            WHERE i.article_id IS NOT NULL
              AND (
                i.article_name LIKE @s
                OR i.barcode LIKE @s
                OR a.Name1 LIKE @s
                OR a.Barcode LIKE @s
                OR a.Num LIKE @s
              )
            """, new { limit, s = $"%{term.Trim()}%" }, cancellationToken: ct));
        return ids.ToList();
    }

    private async Task<(int added, int skipped, int updated)> ApplyTreeMembersAsync(
        DbConnection conn, long groupId, long treeSeq, string? treeName, IEnumerable<long> seqs, CancellationToken ct)
    {
        var existing = (await conn.QueryAsync<(long ArticleId, long? SourceTreeSeq)>(new CommandDefinition("""
            SELECT article_id AS ArticleId, source_tree_seq AS SourceTreeSeq
            FROM ext_commission_group_items
            WHERE group_id=@groupId AND article_id IS NOT NULL
            """, new { groupId }, cancellationToken: ct)))
            .GroupBy(r => r.ArticleId)
            .ToDictionary(g => g.Key, g => g.First().SourceTreeSeq);
        var blocked = await TreeExclusionStore.CommissionBlockedAsync(conn, groupId, ct);

        var added = 0;
        var skipped = 0;
        var updated = 0;
        foreach (var seq in seqs.Distinct())
        {
            if (blocked.Contains(seq)) { skipped++; continue; }
            if (existing.TryGetValue(seq, out var currentTree))
            {
                if (currentTree == treeSeq) { skipped++; continue; }
                await conn.ExecuteAsync(new CommandDefinition("""
                    UPDATE ext_commission_group_items
                    SET source_tree_seq=@treeSeq, source_tree_name=@treeName
                    WHERE group_id=@groupId AND article_id=@seq
                    """, new { groupId, seq, treeSeq, treeName }, cancellationToken: ct));
                existing[seq] = treeSeq;
                updated++;
                continue;
            }

            var articleName = await GetArticleNameAsync(conn, seq, ct);
            var barcode = await GetArticleBarcodeAsync(conn, seq, ct);
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_commission_group_items
                    (group_id, article_id, barcode, article_name, source_tree_seq, source_tree_name)
                VALUES (@groupId, @seq, @barcode, @name, @treeSeq, @treeName)
                """, new { groupId, seq, barcode, name = articleName, treeSeq, treeName }, cancellationToken: ct));
            existing[seq] = treeSeq;
            added++;
        }
        return (added, skipped, updated);
    }

    private static async Task<int> AbsorbItemsIntoTreeAsync(
        DbConnection conn, long groupId, long treeSeq, string? treeName, IReadOnlyList<long> seqs, CancellationToken ct)
    {
        if (seqs.Count == 0) return 0;
        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_commission_group_items
            SET source_tree_seq=@treeSeq, source_tree_name=@treeName
            WHERE group_id=@groupId
              AND article_id IN @seqs
              AND (source_tree_seq IS NULL OR source_tree_seq <> @treeSeq)
            """, new { groupId, treeSeq, treeName, seqs }, cancellationToken: ct));
    }

    private async Task<(IReadOnlyList<long> Seqs, string? Name)> ResolveTreeProductsAsync(long treeSeq, CancellationToken ct)
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
        catch { /* local fallback */ }

        var localSeqs = await treeRepo.GetDescendantProductSeqsAsync(treeSeq, ct);
        var localName = await treeRepo.GetNodeNameAsync(treeSeq, ct);
        return (localSeqs, localName);
    }

    private static IReadOnlyList<long> ResolveSalesmanIds(long? single, IReadOnlyList<long>? many)
    {
        if (many is { Count: > 0 })
            return many.Where(x => x > 0).Distinct().ToList();
        if (single is > 0)
            return [single.Value];
        return [];
    }

    private static int _salesmenTableState;

    private static async Task EnsureSalesmenTableAsync(DbConnection conn, CancellationToken ct, DbTransaction? tx = null)
    {
        if (Volatile.Read(ref _salesmenTableState) == 1) return;
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_group_salesmen')
            CREATE TABLE ext_commission_group_salesmen (
                group_id BIGINT NOT NULL,
                salesman_id BIGINT NOT NULL,
                CONSTRAINT PK_cgs PRIMARY KEY (group_id, salesman_id),
                CONSTRAINT FK_cgs_group FOREIGN KEY (group_id) REFERENCES ext_commission_groups(id) ON DELETE CASCADE
            );
            """, transaction: tx, cancellationToken: ct));
        Volatile.Write(ref _salesmenTableState, 1);
    }

    private static async Task ReplaceSalesmenAsync(DbConnection conn, long groupId, IReadOnlyList<long> ids, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_commission_group_salesmen WHERE group_id=@groupId",
            new { groupId }, cancellationToken: ct));
        foreach (var salesmanId in ids)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_commission_group_salesmen (group_id, salesman_id)
                VALUES (@groupId, @salesmanId)
                """, new { groupId, salesmanId }, cancellationToken: ct));
        }
    }

    private static async Task<Dictionary<long, List<CommissionGroupSalesmanDto>>> LoadSalesmenAsync(
        DbConnection conn, long[] groupIds, CancellationToken ct)
    {
        var map = new Dictionary<long, List<CommissionGroupSalesmanDto>>();
        if (groupIds.Length == 0) return map;
        var rows = await conn.QueryAsync<(long GroupId, long SalesmanId, string? Name)>(new CommandDefinition("""
            SELECT gs.group_id AS GroupId, gs.salesman_id AS SalesmanId, s.name AS Name
            FROM ext_commission_group_salesmen gs
            LEFT JOIN salesmen s ON s.id = gs.salesman_id
            WHERE gs.group_id IN @ids
            ORDER BY s.name, gs.salesman_id
            """, new { ids = groupIds }, cancellationToken: ct));
        foreach (var r in rows)
        {
            if (!map.TryGetValue(r.GroupId, out var list))
            {
                list = [];
                map[r.GroupId] = list;
            }
            list.Add(new CommissionGroupSalesmanDto(r.SalesmanId, r.Name));
        }
        return map;
    }

    private static async Task<string?> GetArticleNameAsync(DbConnection conn, long seq, CancellationToken ct) =>
        await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT TOP 1 LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) FROM articles WHERE Seq=@seq",
            new { seq }, cancellationToken: ct));

    private static async Task<string?> GetArticleBarcodeAsync(DbConnection conn, long seq, CancellationToken ct) =>
        await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT TOP 1 Barcode FROM articles WHERE Seq=@seq",
            new { seq }, cancellationToken: ct));

    private sealed class GroupTreeRow
    {
        public long Id { get; set; }
        public string? TreeName { get; set; }
        public bool IsFullTree { get; set; }
    }

    private sealed class MembershipRow
    {
        public long ArticleId { get; set; }
        public long GroupId { get; set; }
        public string? GroupName { get; set; }
        public bool IsActive { get; set; }
        public string CommissionType { get; set; } = "fixed";
        public decimal CommissionValue { get; set; }
        public long? SourceTreeSeq { get; set; }
        public string? SourceTreeName { get; set; }
        public bool Excluded { get; set; }
    }

    private sealed class OverlapRow
    {
        public long ArticleId { get; set; }
        public string? Name { get; set; }
        public string? Barcode { get; set; }
        public decimal Price { get; set; }
        public long GroupId { get; set; }
        public string? GroupName { get; set; }
        public bool IsActive { get; set; }
        public string CommissionType { get; set; } = "fixed";
        public decimal CommissionValue { get; set; }
        public long? SourceTreeSeq { get; set; }
        public string? SourceTreeName { get; set; }
    }

    private void TouchAttribution() => cache.Remove(ProductAttributionRepository.ArticlesCacheKey);
}
