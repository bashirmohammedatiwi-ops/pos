using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class OfferRepository(ISqlConnectionFactory db, ArticleTreeRepository treeRepo, EdariNexusClient edari)
{
    /// <summary>Lightweight counts for dashboards — avoids loading a full page of offers just for badges.</summary>
    public async Task<OfferStatsDto> GetStatsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT
              (SELECT COUNT(*) FROM offers) AS Total,
              (SELECT COUNT(*) FROM offers WHERE enabled = 1) AS Enabled,
              (SELECT COUNT(DISTINCT od.item_id) FROM offer_details od
               INNER JOIN articles a ON a.Seq = od.item_id
               WHERE od.discount > 0
                 AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL) AS DiscountedItems
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<OfferStatsRow>(
            new CommandDefinition(sql, cancellationToken: ct));
        return new OfferStatsDto(row.Total, row.Enabled, row.Total - row.Enabled, row.DiscountedItems);
    }

    private sealed class OfferStatsRow
    {
        public int Total { get; set; }
        public int Enabled { get; set; }
        public int DiscountedItems { get; set; }
    }

    public async Task<PagedResult<OfferDto>> ListAsync(int page, int pageSize, CancellationToken ct)
    {
        const string sql = """
            SELECT o.id AS Id, o.name AS Name, o.priority AS Priority, o.enabled AS Enabled, o.type AS Type,
                   (SELECT COUNT(*) FROM offer_details od
                    INNER JOIN articles a ON a.Seq = od.item_id
                    WHERE od.offer_id = o.id
                      AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL) AS DetailCount,
                   (SELECT COUNT(DISTINCT od.item_id) FROM offer_details od
                    INNER JOIN articles a ON a.Seq = od.item_id
                    WHERE od.offer_id = o.id AND od.discount > 0
                      AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL) AS ActiveProductCount
            FROM offers o
            ORDER BY o.priority DESC, o.id DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            SELECT COUNT(*) FROM offers;
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, new { offset = (page - 1) * pageSize, pageSize }, cancellationToken: ct));
        var items = (await multi.ReadAsync<OfferDto>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return new PagedResult<OfferDto>(items, total, page, pageSize);
    }

    public async Task<IReadOnlyList<OfferDetailDto>> GetDetailsAsync(long offerId, int? detailRole, CancellationToken ct)
    {
        var where = "WHERE od.offer_id = @offerId";
        if (detailRole.HasValue) where += " AND od.detail_role = @detailRole";

        var sql = $"""
            SELECT od.id AS Id, od.item_id AS ItemId,
                   COALESCE(a.Name1, tf.Name1, N'شجرة #' + CAST(od.source_tree_seq AS NVARCHAR(20))) AS ItemName,
                   CAST(od.discount AS DECIMAL(18,2)) AS Discount, od.discount_type AS DiscountType,
                   od.from_date AS FromDate, od.to_date AS ToDate, od.Unlimited AS Unlimited,
                   od.detail_role AS DetailRole, od.source_tree_seq AS SourceTreeSeq,
                   tf.Name1 AS SourceTreeName,
                   CAST(COALESCE(od.excluded, 0) AS BIT) AS Excluded,
                   a.Barcode AS Barcode,
                   CAST(COALESCE(a.SellPr4, 0) AS DECIMAL(18,0)) AS Price,
                   od.tree_synced_at AS TreeSyncedAt
            FROM offer_details od
            INNER JOIN articles a ON a.Seq = od.item_id
              AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL
            LEFT JOIN articles tf ON tf.Seq = od.source_tree_seq
            {where}
            ORDER BY od.source_tree_seq, od.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var items = await conn.QueryAsync<OfferDetailRow>(new CommandDefinition(
            sql, new { offerId, detailRole }, cancellationToken: ct));
        return items.Select(r => new OfferDetailDto(
            r.Id, r.ItemId, r.ItemName, r.Discount, r.DiscountType,
            r.FromDate, r.ToDate, r.Unlimited, r.DetailRole, r.SourceTreeSeq, r.SourceTreeName,
            r.Excluded, r.Barcode, r.Price)).ToList();
    }

    /// <summary>
    /// Editor payload: tree cards + standalone products only — never the full tree membership.
    /// </summary>
    public async Task<OfferScopeDto> GetScopeAsync(long offerId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var trees = (await conn.QueryAsync<OfferTreeCardDto>(new CommandDefinition("""
            SELECT od.source_tree_seq AS TreeSeq,
                   MAX(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), tf.Name1)))) AS TreeName,
                   SUM(CASE WHEN COALESCE(od.excluded, 0) = 0 THEN 1 ELSE 0 END) AS Count,
                   SUM(CASE WHEN COALESCE(od.excluded, 0) = 1 THEN 1 ELSE 0 END) AS ExcludedCount,
                   CAST(MAX(od.discount) AS DECIMAL(18,2)) AS Discount,
                   MAX(od.tree_synced_at) AS LastSyncedAt
            FROM offer_details od
            LEFT JOIN articles tf ON tf.Seq = od.source_tree_seq
            WHERE od.offer_id = @offerId
              AND od.source_tree_seq IS NOT NULL
              AND od.detail_role = 0
            GROUP BY od.source_tree_seq
            ORDER BY TreeName
            """, new { offerId }, cancellationToken: ct))).ToList();

        var standaloneRows = await conn.QueryAsync<OfferDetailRow>(new CommandDefinition("""
            SELECT od.id AS Id, od.item_id AS ItemId,
                   a.Name1 AS ItemName,
                   CAST(od.discount AS DECIMAL(18,2)) AS Discount, od.discount_type AS DiscountType,
                   od.from_date AS FromDate, od.to_date AS ToDate, od.Unlimited AS Unlimited,
                   od.detail_role AS DetailRole, od.source_tree_seq AS SourceTreeSeq,
                   CAST(NULL AS NVARCHAR(4000)) AS SourceTreeName,
                   CAST(COALESCE(od.excluded, 0) AS BIT) AS Excluded,
                   a.Barcode AS Barcode,
                   CAST(COALESCE(a.SellPr4, 0) AS DECIMAL(18,0)) AS Price,
                   od.tree_synced_at AS TreeSyncedAt
            FROM offer_details od
            INNER JOIN articles a ON a.Seq = od.item_id
              AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL
            WHERE od.offer_id = @offerId
              AND od.source_tree_seq IS NULL
              AND od.detail_role = 0
            ORDER BY od.id
            """, new { offerId }, cancellationToken: ct));
        var standalone = standaloneRows.Select(r => new OfferDetailDto(
            r.Id, r.ItemId, r.ItemName, r.Discount, r.DiscountType,
            r.FromDate, r.ToDate, r.Unlimited, r.DetailRole, r.SourceTreeSeq, r.SourceTreeName,
            r.Excluded, r.Barcode, r.Price)).ToList();

        var dateRow = await conn.QuerySingleOrDefaultAsync<DateScopeRow>(new CommandDefinition("""
            SELECT TOP 1
                   CAST(od.discount AS DECIMAL(18,2)) AS Discount,
                   CAST(COALESCE(od.Unlimited, 1) AS BIT) AS Unlimited,
                   od.from_date AS FromDate,
                   od.to_date AS ToDate
            FROM offer_details od
            WHERE od.offer_id = @offerId AND od.detail_role = 0
            ORDER BY od.id
            """, new { offerId }, cancellationToken: ct));

        return new OfferScopeDto(
            trees,
            standalone,
            dateRow?.Discount ?? 10,
            dateRow?.Unlimited ?? true,
            dateRow?.FromDate,
            dateRow?.ToDate);
    }

    private sealed class DateScopeRow
    {
        public decimal Discount { get; set; }
        public bool Unlimited { get; set; }
        public DateTime? FromDate { get; set; }
        public DateTime? ToDate { get; set; }
    }

    /// <summary>
    /// Every product currently under a tree in Edari/local mirror, with its in-offer state —
    /// powers the expandable tree cards (right side) and drift detection.
    /// </summary>
    public async Task<IReadOnlyList<OfferTreeProductDto>> ListTreeProductsAsync(
        long offerId, long treeSeq, IReadOnlyList<long> currentSeqs, CancellationToken ct)
    {
        if (currentSeqs.Count == 0) return [];
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var seqs = currentSeqs.ToArray();

        var products = (await conn.QueryAsync<TreeProductRow>(new CommandDefinition("""
            SELECT a.Seq, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                   LTRIM(RTRIM(a.Barcode)) AS Barcode,
                   CAST(COALESCE(NULLIF(a.SellPr4,0),0) AS DECIMAL(18,0)) AS Price,
                   od.id AS DetailId, CAST(od.discount AS DECIMAL(18,2)) AS Discount,
                   CAST(COALESCE(od.excluded, 0) AS BIT) AS Excluded
            FROM articles a
            LEFT JOIN offer_details od
              ON od.offer_id = @offerId AND od.item_id = a.Seq
            WHERE a.Seq IN @seqs
            """, new { offerId, seqs }, cancellationToken: ct)))
            .ToDictionary(r => r.Seq);

        var result = new List<OfferTreeProductDto>(currentSeqs.Count);
        foreach (var seq in currentSeqs)
        {
            if (!products.TryGetValue(seq, out var p)) continue;
            result.Add(new OfferTreeProductDto(
                p.Seq, p.Name, p.Barcode, p.Price,
                p.DetailId is > 0, p.Excluded, p.Discount, p.DetailId));
        }
        return result;
    }

    /// <summary>Exclude/un-exclude one product from a tree batch — stays excluded across membership refreshes.</summary>
    public async Task<bool> SetDetailExcludedAsync(long detailId, bool excluded, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE offer_details SET excluded = @excluded WHERE id = @detailId",
            new { detailId, excluded }, cancellationToken: ct)) > 0;
    }

    /// <summary>Resolves the tree's current products and maps offer state — one call for the endpoint.</summary>
    public async Task<IReadOnlyList<OfferTreeProductDto>> GetOfferTreeProductsAsync(long offerId, long treeSeq, CancellationToken ct)
    {
        var (seqs, _) = await ResolveTreeProductsAsync(treeSeq, ct);
        return await ListTreeProductsAsync(offerId, treeSeq, seqs, ct);
    }

    /// <summary>Current tree size vs what's in the offer — powers the drift badge.</summary>
    public async Task<OfferTreeStateDto?> GetTreeStateAsync(long offerId, long treeSeq, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<(string? Name, int InOffer, int Excluded, DateTime? SyncedAt)>(
            new CommandDefinition("""
                SELECT tf.Name1 AS Name,
                       (SELECT COUNT(*) FROM offer_details od2
                        WHERE od2.offer_id = @offerId AND od2.source_tree_seq = @treeSeq AND COALESCE(od2.excluded,0) = 0) AS InOffer,
                       (SELECT COUNT(*) FROM offer_details od3
                        WHERE od3.offer_id = @offerId AND od3.source_tree_seq = @treeSeq AND COALESCE(od3.excluded,0) = 1) AS Excluded,
                       (SELECT MAX(od4.tree_synced_at) FROM offer_details od4
                        WHERE od4.offer_id = @offerId AND od4.source_tree_seq = @treeSeq) AS SyncedAt
                FROM articles tf WHERE tf.Seq = @treeSeq
                """, new { offerId, treeSeq }, cancellationToken: ct));
        if (row == default) return null;

        var (seqs, _) = await ResolveTreeProductsAsync(treeSeq, ct);
        var current = seqs.Count;
        return new OfferTreeStateDto(
            treeSeq, row.Name, current, row.InOffer, row.Excluded,
            Math.Max(0, current - row.InOffer - row.Excluded), row.SyncedAt);
    }

    public async Task<long> CreateAsync(CreateOfferRequest req, CancellationToken ct)
    {
        const string sql = """
            INSERT INTO offers (name, priority, enabled, type, master_account, remarks)
            OUTPUT INSERTED.id
            VALUES (@name, @priority, @enabled, @type, 0, N'');
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        // Constr_priority: الأولوية فريدة على مستوى الجدول — عند التصادم نمنح أولوية جديدة تلقائياً
        var priority = req.Priority;
        if (await conn.ExecuteScalarAsync<int?>(
                new CommandDefinition("SELECT TOP 1 1 FROM offers WHERE priority = @priority", new { priority }, cancellationToken: ct)) is not null)
        {
            priority = await conn.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT ISNULL(MAX(priority), 0) + 1 FROM offers", cancellationToken: ct));
        }
        return await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            sql, new { name = req.Name, priority, enabled = req.Enabled, type = req.Type }, cancellationToken: ct));
    }

    public async Task SetEnabledAsync(long id, bool enabled, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE offers SET enabled = @enabled WHERE id = @id", new { id, enabled }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(long id, UpdateOfferRequest req, CancellationToken ct)
    {
        const string sql = """
            UPDATE offers SET name = @Name, priority = @Priority, type = @Type, enabled = @Enabled
            WHERE id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        if (await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
                "SELECT TOP 1 1 FROM offers WHERE priority = @Priority AND id <> @id", new { req.Priority, id }, cancellationToken: ct)) is not null)
            throw new InvalidOperationException("هذه الأولوية مستخدمة لعرض آخر — اختر قيمة مختلفة.");
        return await conn.ExecuteAsync(new CommandDefinition(sql, new { id, req.Name, req.Priority, req.Type, req.Enabled }, cancellationToken: ct)) > 0;
    }

    public async Task<long> AddDetailAsync(long offerId, UpsertOfferDetailRequest req, CancellationToken ct)
    {
        if (req.ItemId is not > 0 || !await IsLiveArticleAsync(req.ItemId.Value, ct))
            throw new InvalidOperationException("هذا المنتج غير موجود في الأداري.");

        const string sql = """
            INSERT INTO offer_details (offer_id, item_id, discount, discount_type, from_date, to_date, Unlimited, detail_role)
            OUTPUT INSERTED.id VALUES (@offerId, @itemId, @discount, @discountType, @fromDate, @toDate, @unlimited, @detailRole)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<long>(new CommandDefinition(sql, new
        {
            offerId, itemId = req.ItemId, discount = req.Discount,
            discountType = req.DiscountType is 1 or 2 ? req.DiscountType : 0,
            fromDate = req.FromDate, toDate = req.ToDate, unlimited = req.Unlimited, detailRole = req.DetailRole
        }, cancellationToken: ct));
    }

    public async Task<OfferTreeApplyResult> AddTreeAsync(long offerId, AddOfferTreeRequest req, CancellationToken ct)
    {
        var (seqs, treeName) = await ResolveTreeProductsAsync(req.TreeSeq, ct);
        if (seqs.Count == 0)
            return new OfferTreeApplyResult(0, 0, treeName);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var existing = (await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT item_id FROM offer_details WHERE offer_id = @offerId AND item_id IS NOT NULL",
            new { offerId }, cancellationToken: ct))).ToHashSet();

        var added = 0;
        var updated = 0;
        foreach (var seq in seqs)
        {
            if (existing.Contains(seq))
            {
                updated += await conn.ExecuteAsync(new CommandDefinition("""
                    UPDATE offer_details
                    SET discount = @discount, source_tree_seq = @treeSeq,
                        from_date = COALESCE(@fromDate, from_date),
                        to_date = CASE WHEN @fromDate IS NOT NULL OR @toDate IS NOT NULL THEN @toDate ELSE to_date END,
                        Unlimited = COALESCE(@unlimited, Unlimited)
                    WHERE offer_id = @offerId AND item_id = @seq AND detail_role = 0
                    """, new
                {
                    offerId, seq, discount = req.DiscountPercent,
                    fromDate = req.FromDate, toDate = req.ToDate, unlimited = req.Unlimited, treeSeq = req.TreeSeq
                }, cancellationToken: ct));
                continue;
            }
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO offer_details (offer_id, item_id, discount, discount_type, from_date, to_date, Unlimited, detail_role, source_tree_seq)
                VALUES (@offerId, @seq, @discount, 0, @fromDate, @toDate, @unlimited, 0, @treeSeq)
                """, new
            {
                offerId, seq, discount = req.DiscountPercent,
                fromDate = req.FromDate, toDate = req.ToDate, unlimited = req.Unlimited, treeSeq = req.TreeSeq
            }, cancellationToken: ct));
            added++;
            existing.Add(seq);
        }

        return new OfferTreeApplyResult(added, 0, treeName, updated);
    }

    public async Task<int> AddBulkAsync(long offerId, AddOfferBulkRequest req, CancellationToken ct)
    {
        if (req.ItemIds.Count == 0) return 0;
        var liveIds = await FilterLiveArticleSeqsAsync(req.ItemIds, ct);
        if (liveIds.Count == 0)
            throw new InvalidOperationException("لا يمكن إضافة منتجات غير موجودة في الأداري.");

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var existing = (await conn.QueryAsync<long>(new CommandDefinition(
            "SELECT item_id FROM offer_details WHERE offer_id = @offerId AND detail_role = @role AND item_id IS NOT NULL",
            new { offerId, role = req.DetailRole }, cancellationToken: ct))).ToHashSet();

        var added = 0;
        foreach (var id in liveIds)
        {
            if (!existing.Add(id)) continue;
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO offer_details (offer_id, item_id, discount, discount_type, from_date, to_date, Unlimited, detail_role)
                VALUES (@offerId, @id, @discount, 0, @fromDate, @toDate, @unlimited, @detailRole)
                """, new
            {
                offerId, id, discount = req.DiscountPercent,
                fromDate = req.FromDate, toDate = req.ToDate, unlimited = req.Unlimited, detailRole = req.DetailRole
            }, cancellationToken: ct));
            added++;
        }
        return added;
    }

    /// <summary>
    /// Terminals cache each product with its offer price already applied, and the delta feed keys
    /// off <c>articles.ext_row_version</c>. Editing an offer never touched the articles, so a new
    /// discount only reached a terminal if that product happened to be edited afterwards. Bumping
    /// the rowversion (an UPDATE writing the same value is enough) puts every product the offer
    /// covers back on the feed, so the cashier sees the new price on the next sync.
    /// </summary>
    public async Task<int> TouchOfferArticlesAsync(long offerId, CancellationToken ct)
    {
        const string sql = """
            UPDATE a SET a.ext_discount_percent = a.ext_discount_percent
            FROM dbo.articles a
            WHERE a.Seq IN (
                SELECT od.item_id FROM dbo.offer_details od
                WHERE od.offer_id = @offerId AND od.item_id IS NOT NULL)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(sql, new { offerId }, cancellationToken: ct));
    }

    /// <summary>Offer a detail belongs to — needed to refresh prices when only the detail id is known.</summary>
    public async Task<long?> GetDetailOfferIdAsync(long detailId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT offer_id FROM offer_details WHERE id = @detailId",
            new { detailId }, cancellationToken: ct));
    }

    public async Task<int> DeleteTreeBatchAsync(long offerId, long treeSeq, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM offer_details WHERE offer_id = @offerId AND source_tree_seq = @treeSeq",
            new { offerId, treeSeq }, cancellationToken: ct));
    }

    public async Task DeleteDetailAsync(long detailId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM offer_details WHERE id = @detailId", new { detailId }, cancellationToken: ct));
    }

    public async Task<bool> UpdateDetailAsync(long detailId, UpdateOfferDetailRequest req, CancellationToken ct)
    {
        const string sql = """
            UPDATE offer_details
            SET discount = @Discount,
                discount_type = COALESCE(@DiscountType, discount_type),
                from_date = COALESCE(@FromDate, from_date),
                to_date = CASE WHEN @FromDate IS NOT NULL OR @ToDate IS NOT NULL THEN @ToDate ELSE to_date END,
                Unlimited = COALESCE(@Unlimited, Unlimited)
            WHERE id = @detailId
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        int? discountType = req.DiscountType is 0 or 1 or 2 ? req.DiscountType : null;
        return await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            detailId,
            req.Discount,
            DiscountType = discountType,
            req.FromDate,
            req.ToDate,
            req.Unlimited,
        }, cancellationToken: ct)) > 0;
    }

    public async Task<int> UpdateTreeDiscountAsync(long offerId, long treeSeq, UpdateOfferTreeDiscountRequest req, CancellationToken ct)
    {
        var (seqs, _) = await ResolveTreeProductsAsync(treeSeq, ct);
        if (seqs.Count == 0) return 0;
        var seqArray = seqs.ToArray();

        const string sql = """
            UPDATE od
            SET discount = @Discount,
                source_tree_seq = @treeSeq,
                from_date = COALESCE(@FromDate, od.from_date),
                to_date = CASE WHEN @FromDate IS NOT NULL OR @ToDate IS NOT NULL THEN @ToDate ELSE od.to_date END,
                Unlimited = COALESCE(@Unlimited, od.Unlimited)
            FROM offer_details od
            WHERE od.offer_id = @offerId AND od.detail_role = 0
              AND (od.source_tree_seq = @treeSeq OR od.item_id IN @seqs)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            offerId,
            treeSeq,
            seqs = seqArray,
            Discount = req.DiscountPercent,
            req.FromDate,
            req.ToDate,
            req.Unlimited,
        }, cancellationToken: ct));
    }

    public async Task<int> UpdateAllDiscountAsync(long offerId, decimal discount, int detailRole, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE offer_details SET discount = @discount WHERE offer_id = @offerId AND detail_role = @detailRole",
            new { offerId, discount, detailRole }, cancellationToken: ct));
    }

    /// <summary>
    /// Every offer a product belongs to — disabled, required, and excluded rows included
    /// so admin search can say which group the article is in.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, IReadOnlyList<ProductOfferMembershipDto>>> GetMembershipsByItemIdsAsync(
        IReadOnlyCollection<long> itemIds, CancellationToken ct)
    {
        var empty = new Dictionary<long, IReadOnlyList<ProductOfferMembershipDto>>();
        if (itemIds.Count == 0) return empty;

        const string sql = """
            SELECT od.item_id AS ItemId, o.id AS OfferId,
                   CONVERT(NVARCHAR(4000), o.name) AS OfferName, o.type AS OfferType,
                   CAST(o.enabled AS BIT) AS Enabled, o.priority AS Priority,
                   CAST(od.discount AS DECIMAL(18,2)) AS Discount, od.discount_type AS DiscountType,
                   od.detail_role AS DetailRole,
                   CAST(COALESCE(od.excluded, 0) AS BIT) AS Excluded
            FROM offer_details od
            INNER JOIN offers o ON o.id = od.offer_id
            WHERE od.item_id IN @ids
            ORDER BY o.priority DESC, o.id, od.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<MembershipRow>(new CommandDefinition(
            sql, new { ids = itemIds.Distinct().ToArray() }, cancellationToken: ct))).ToList();

        var map = new Dictionary<long, IReadOnlyList<ProductOfferMembershipDto>>();
        foreach (var group in rows.GroupBy(r => r.ItemId))
        {
            var seen = new HashSet<long>();
            var list = new List<ProductOfferMembershipDto>();
            foreach (var r in group)
            {
                if (!seen.Add(r.OfferId)) continue;
                list.Add(new ProductOfferMembershipDto(
                    r.OfferId, r.OfferName ?? $"عرض #{r.OfferId}", r.OfferType, r.Enabled, r.Priority,
                    r.Discount, r.DiscountType, r.DetailRole, r.Excluded, IsWinning: false));
            }
            map[group.Key] = list;
        }
        return map;
    }

    public async Task DeleteAsync(long offerId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM offer_details WHERE offer_id = @offerId", new { offerId }, cancellationToken: ct));
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM offers WHERE id = @offerId", new { offerId }, cancellationToken: ct));
    }

    /// <summary>
    /// Drops offer lines whose product is missing from the Edari mirror (or has no name).
    /// Copied/legacy rows never had a local article, so article-delete cleanup misses them.
    /// </summary>
    public async Task<int> PruneOrphanOfferDetailsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            DELETE od
            FROM offer_details od
            WHERE od.item_id IS NULL
               OR NOT EXISTS (
                    SELECT 1 FROM articles a
                    WHERE a.Seq = od.item_id
                      AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL
               )
            """, cancellationToken: ct));
    }

    private async Task<bool> IsLiveArticleAsync(long seq, CancellationToken ct)
    {
        if (seq <= 0) return false;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM articles
                WHERE Seq = @seq
                  AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))), N'') IS NOT NULL
            ) THEN 1 ELSE 0 END
            """, new { seq }, cancellationToken: ct));
        return n == 1;
    }

    private async Task<IReadOnlyList<long>> FilterLiveArticleSeqsAsync(IEnumerable<long> seqs, CancellationToken ct)
    {
        var ids = seqs.Where(s => s > 0).Distinct().ToList();
        if (ids.Count == 0) return [];
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var found = await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT Seq FROM articles
            WHERE Seq IN @ids
              AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))), N'') IS NOT NULL
            """, new { ids }, cancellationToken: ct));
        return found.ToList();
    }

    private async Task<(IReadOnlyList<long> Seqs, string? Name)> ResolveTreeProductsAsync(long treeSeq, CancellationToken ct)
    {
        IReadOnlyList<long> seqs = [];
        string? name = null;
        try
        {
            if (await edari.MaterialExistsAsync(treeSeq, ct))
            {
                seqs = await edari.GetDescendantProductSeqsAsync(treeSeq, ct);
                name = await edari.GetNodeNameAsync(treeSeq, ct);
            }
        }
        catch
        {
            /* fall back to local articles */
        }

        if (seqs.Count == 0)
        {
            seqs = await treeRepo.GetDescendantProductSeqsAsync(treeSeq, ct);
            name ??= await treeRepo.GetNodeNameAsync(treeSeq, ct);
        }

        var live = await FilterLiveArticleSeqsAsync(seqs, ct);
        return (live, name);
    }

    private sealed class MembershipRow
    {
        public long ItemId { get; set; }
        public long OfferId { get; set; }
        public string? OfferName { get; set; }
        public int OfferType { get; set; }
        public bool Enabled { get; set; }
        public int Priority { get; set; }
        public decimal Discount { get; set; }
        public int DiscountType { get; set; }
        public int DetailRole { get; set; }
        public bool Excluded { get; set; }
    }

    private sealed class OfferDetailRow
    {
        public long Id { get; set; }
        public long? ItemId { get; set; }
        public string? ItemName { get; set; }
        public decimal Discount { get; set; }
        public int DiscountType { get; set; }
        public DateTime? FromDate { get; set; }
        public DateTime? ToDate { get; set; }
        public bool Unlimited { get; set; }
        public int DetailRole { get; set; }
        public long? SourceTreeSeq { get; set; }
        public string? SourceTreeName { get; set; }
        public bool Excluded { get; set; }
        public string? Barcode { get; set; }
        public decimal Price { get; set; }
        public DateTime? TreeSyncedAt { get; set; }
    }

    private sealed class TreeProductRow
    {
        public long Seq { get; set; }
        public string? Name { get; set; }
        public string? Barcode { get; set; }
        public decimal Price { get; set; }
        public long? DetailId { get; set; }
        public decimal? Discount { get; set; }
        public bool Excluded { get; set; }
    }
}
