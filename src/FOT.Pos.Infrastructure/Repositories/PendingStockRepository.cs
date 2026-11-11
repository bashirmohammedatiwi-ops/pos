using System.Data.Common;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// Live stock. Edari's CurTot1 only drops when «دمج الإيصالات» runs, usually at the end of the shift
/// or the day, so every screen showed stock as if nothing had been sold since. This keeps
/// <c>articles.ext_pending_qty</c> = sold and not merged yet (sales + gifts − returns, plus the
/// cashiers' parked manual-transfer receipts), and everything that shows stock subtracts it
/// (<see cref="ProductSql.EffectiveStock"/>).
///
/// The value is always recomputed from the receipts themselves — never added to or subtracted from —
/// so it cannot drift; a periodic <see cref="ReconcileAllAsync"/> repairs anything missed. Changing it
/// bumps <c>ext_row_version</c>, which carries the new stock to the cashiers, the price checker and the
/// store website through the delta feeds they already use.
/// </summary>
public sealed class PendingStockRepository(ISqlConnectionFactory db, ILogger<PendingStockRepository> logger)
{
    /// <summary>A parked receipt the cashier stopped reporting for this long no longer counts.</summary>
    public static readonly TimeSpan HoldStaleAfter = TimeSpan.FromHours(24);

    private const int ChunkSize = 1000;

    public sealed record Options(bool Enabled, int MaxHours);

    private Options? _cached;
    private DateTime _cachedAt;

    // Per-article signed quantity still waiting for Edari: kind 1 (return) puts stock back, kind 0
    // (sale) and 2 (gift → output invoice) take it out. Edari posts ABS(qty) and takes the
    // direction from the bill kind, so the same is done here.
    private const string PendingCte = """
        WITH pend AS (
            SELECT ri.article_id AS article_id,
                   SUM(CASE WHEN r.kind = 1 THEN -ABS(ri.quantity) ELSE ABS(ri.quantity) END) AS q
            FROM reciepts r
            INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            WHERE r.stock_settled_at IS NULL AND r.is_pending = 0 AND ri.article_id IS NOT NULL
            GROUP BY ri.article_id
            UNION ALL
            SELECT h.article_id,
                   SUM(CASE WHEN h.kind = 1 THEN -ABS(h.quantity) ELSE ABS(h.quantity) END)
            FROM ext_stock_holds h
            WHERE h.reported_at >= @holdSince
              AND NOT EXISTS (SELECT 1 FROM reciepts r2 WHERE r2.client_receipt_id = h.client_receipt_id)
            GROUP BY h.article_id
        ),
        agg AS (SELECT article_id, SUM(q) AS q FROM pend GROUP BY article_id)
        """;

    public async Task<Options> GetOptionsAsync(CancellationToken ct, bool fresh = false)
    {
        if (!fresh && _cached is not null && DateTime.UtcNow - _cachedAt < TimeSpan.FromSeconds(30))
            return _cached;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QueryFirstOrDefaultAsync<OptionsRow>(new CommandDefinition("""
            SELECT TOP 1 CAST(COALESCE(pending_stock_enabled, 1) AS bit) AS Enabled,
                   COALESCE(pending_stock_max_hours, 72) AS MaxHours
            FROM ext_edari_settings ORDER BY id
            """, cancellationToken: ct));
        var opts = row is not null ? new Options(row.Enabled, Math.Clamp(row.MaxHours, 6, 24 * 14)) : new Options(true, 72);
        _cached = opts;
        _cachedAt = DateTime.UtcNow;
        return opts;
    }

    public async Task SaveOptionsAsync(bool enabled, int maxHours, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_edari_settings SET pending_stock_enabled = @enabled, pending_stock_max_hours = @maxHours
            """, new { enabled, maxHours = Math.Clamp(maxHours, 6, 24 * 14) }, cancellationToken: ct));
        _cached = null;
        await ReconcileAllAsync(ct);
    }

    /// <summary>Recompute after a receipt was saved or changed; never throws (a sale must not fail on this).</summary>
    public async Task RecomputeForReceiptAsync(long receiptId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var ids = (await conn.QueryAsync<long>(new CommandDefinition(
                "SELECT DISTINCT article_id FROM reciept_items WHERE reciept_id = @receiptId AND article_id IS NOT NULL",
                new { receiptId }, cancellationToken: ct))).ToList();
            await RecomputeAsync(conn, null, ids, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Pending stock recompute failed for receipt {Receipt}", receiptId);
        }
    }

    public async Task<int> RecomputeAsync(IReadOnlyCollection<long> articleIds, CancellationToken ct)
    {
        if (articleIds.Count == 0) return 0;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await RecomputeAsync(conn, null, articleIds, ct);
    }

    internal async Task<int> RecomputeAsync(DbConnection conn, DbTransaction? tx, IReadOnlyCollection<long> articleIds, CancellationToken ct)
    {
        if (articleIds.Count == 0) return 0;
        var opts = await GetOptionsAsync(ct);
        var changed = 0;
        foreach (var chunk in articleIds.Distinct().Chunk(ChunkSize))
        {
            changed += await conn.ExecuteAsync(new CommandDefinition($"""
                {PendingCte}
                UPDATE a SET a.ext_pending_qty = t.target
                FROM articles a
                LEFT JOIN agg g ON g.article_id = a.id
                CROSS APPLY (SELECT CASE WHEN @enabled = 1 THEN COALESCE(g.q, 0) ELSE 0 END AS target) t
                WHERE a.id IN @ids AND ABS(a.ext_pending_qty - t.target) > 0.0001
                """, new { ids = chunk, enabled = opts.Enabled, holdSince = HoldSince() },
                transaction: tx, commandTimeout: 60, cancellationToken: ct));
        }
        return changed;
    }

    /// <summary>Brings every article to the value its receipts say. Cheap: only the open receipts are read.</summary>
    public async Task<int> ReconcileAllAsync(CancellationToken ct)
    {
        var opts = await GetOptionsAsync(ct, fresh: true);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var changed = await conn.ExecuteAsync(new CommandDefinition($"""
            {PendingCte}
            UPDATE a SET a.ext_pending_qty = t.target
            FROM articles a
            LEFT JOIN agg g ON g.article_id = a.id
            CROSS APPLY (SELECT CASE WHEN @enabled = 1 THEN COALESCE(g.q, 0) ELSE 0 END AS target) t
            WHERE (a.ext_pending_qty <> 0 OR g.article_id IS NOT NULL)
              AND ABS(a.ext_pending_qty - t.target) > 0.0001
            """, new { enabled = opts.Enabled, holdSince = HoldSince() }, commandTimeout: 120, cancellationToken: ct));
        if (changed > 0)
            logger.LogInformation("Pending stock reconcile corrected {Count} product(s)", changed);
        return changed;
    }

    /// <summary>
    /// Receipts that went to Edari and still wait for its merge — plus, once after install, the
    /// «verify» baseline rows whose real state is still unknown.
    /// </summary>
    public async Task<IReadOnlyList<(long Id, bool Verify)>> GetSettlementCandidatesAsync(int limit, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<(long Id, string? Source)>(new CommandDefinition("""
            SELECT TOP (@limit) id, stock_settle_source
            FROM reciepts
            WHERE is_pending = 0 AND synced = 1
              AND (stock_settled_at IS NULL OR stock_settle_source = N'verify')
            ORDER BY id
            """, new { limit }, cancellationToken: ct));
        return rows.Select(r => (r.Id, string.Equals(r.Source, "verify", StringComparison.Ordinal))).ToList();
    }

    /// <summary>Material Seqs (Edari ids) of the given receipts — whose Edari stock must be re-read.</summary>
    public async Task<IReadOnlyList<long>> GetArticleSeqsAsync(IReadOnlyCollection<long> receiptIds, CancellationToken ct)
    {
        if (receiptIds.Count == 0) return [];
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var all = new HashSet<long>();
        foreach (var chunk in receiptIds.Chunk(ChunkSize))
        {
            all.UnionWith(await conn.QueryAsync<long>(new CommandDefinition("""
                SELECT DISTINCT CAST(a.Seq AS BIGINT)
                FROM reciept_items ri INNER JOIN articles a ON a.id = ri.article_id
                WHERE ri.reciept_id IN @ids AND a.Seq IS NOT NULL
                """, new { ids = chunk }, cancellationToken: ct)));
        }
        return all.ToList();
    }

    /// <summary>
    /// One transaction: Edari's post-merge stock for the touched materials, the receipts marked settled,
    /// and their pending quantities recomputed — so the shown stock never jumps up in between.
    /// </summary>
    public async Task<SettlementApplyResult> ApplySettlementAsync(
        IReadOnlyCollection<long> settleIds, string source,
        IReadOnlyCollection<long> verifiedClosedIds, IReadOnlyCollection<long> verifiedOpenIds,
        IReadOnlyDictionary<long, double> edariStockBySeq, CancellationToken ct)
    {
        var touchedReceipts = settleIds.Concat(verifiedClosedIds).Concat(verifiedOpenIds).Distinct().ToList();
        if (touchedReceipts.Count == 0 && edariStockBySeq.Count == 0)
            return new SettlementApplyResult(0, 0, 0, 0);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            var stockChanged = 0;
            if (edariStockBySeq.Count > 0)
            {
                stockChanged = await conn.ExecuteAsync(new CommandDefinition("""
                    UPDATE articles SET CurTot1 = @Stock
                    WHERE Seq = @Seq AND ABS(ISNULL(CurTot1, 0) - @Stock) > 0.0001
                    """, edariStockBySeq.Select(kv => new { Seq = kv.Key, Stock = kv.Value }).ToList(),
                    transaction: tx, cancellationToken: ct));
            }

            var settled = 0;
            foreach (var chunk in settleIds.Chunk(ChunkSize))
            {
                settled += await conn.ExecuteAsync(new CommandDefinition("""
                    UPDATE reciepts SET stock_settled_at = SYSDATETIME(), stock_settle_source = @source
                    WHERE id IN @ids AND (stock_settled_at IS NULL OR stock_settle_source = N'verify')
                    """, new { ids = chunk, source }, transaction: tx, cancellationToken: ct));
            }
            foreach (var chunk in verifiedClosedIds.Chunk(ChunkSize))
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    UPDATE reciepts SET stock_settle_source = N'baseline'
                    WHERE id IN @ids AND stock_settle_source = N'verify'
                    """, new { ids = chunk }, transaction: tx, cancellationToken: ct));
            }
            var reopened = 0;
            foreach (var chunk in verifiedOpenIds.Chunk(ChunkSize))
            {
                reopened += await conn.ExecuteAsync(new CommandDefinition("""
                    UPDATE reciepts SET stock_settled_at = NULL, stock_settle_source = NULL
                    WHERE id IN @ids AND stock_settle_source = N'verify'
                    """, new { ids = chunk }, transaction: tx, cancellationToken: ct));
            }

            var articleIds = new HashSet<long>();
            foreach (var chunk in touchedReceipts.Chunk(ChunkSize))
            {
                articleIds.UnionWith(await conn.QueryAsync<long>(new CommandDefinition(
                    "SELECT DISTINCT article_id FROM reciept_items WHERE reciept_id IN @ids AND article_id IS NOT NULL",
                    new { ids = chunk }, transaction: tx, cancellationToken: ct)));
            }
            var pendingChanged = await RecomputeAsync(conn, tx, articleIds, ct);

            await tx.CommitAsync(ct);
            return new SettlementApplyResult(settled, reopened, stockChanged, pendingChanged);
        }
        catch
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* doomed */ }
            throw;
        }
    }

    /// <summary>Receipts older than the limit stop counting (Edari never merged them — or never got them).</summary>
    public async Task<int> ExpireOldAsync(CancellationToken ct)
    {
        var opts = await GetOptionsAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var expired = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts SET stock_settled_at = SYSDATETIME(), stock_settle_source = N'expired'
            WHERE stock_settled_at IS NULL AND is_pending = 0
              AND creation_date < DATEADD(HOUR, -@maxHours, GETDATE())
            """, new { maxHours = opts.MaxHours }, cancellationToken: ct));
        if (expired > 0)
        {
            logger.LogWarning("Pending stock: {Count} receipt(s) older than {Hours}h were never merged in Edari — no longer subtracted",
                expired, opts.MaxHours);
            await ReconcileAllAsync(ct);
        }
        return expired;
    }

    /// <summary>The control panel's «اعتبرها مدموجة» for one cashier: only receipts already in Edari.</summary>
    public async Task<int> SettleManuallyAsync(long posId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var ids = (await conn.QueryAsync<long>(new CommandDefinition("""
            SELECT id FROM reciepts
            WHERE point_of_sale_id = @posId AND stock_settled_at IS NULL AND is_pending = 0 AND synced = 1
            """, new { posId }, cancellationToken: ct))).ToList();
        if (ids.Count == 0) return 0;
        var r = await ApplySettlementAsync(ids, "manual", [], [], new Dictionary<long, double>(), ct);
        return r.Settled;
    }

    /// <summary>Receipts pushed again to Edari get a new open bill there — they wait for its merge again.</summary>
    public async Task ReopenAsync(IReadOnlyCollection<long> receiptIds, CancellationToken ct)
    {
        if (receiptIds.Count == 0) return;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var articleIds = new HashSet<long>();
        foreach (var chunk in receiptIds.Chunk(ChunkSize))
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE reciepts SET stock_settled_at = NULL, stock_settle_source = NULL WHERE id IN @ids",
                new { ids = chunk }, cancellationToken: ct));
            articleIds.UnionWith(await conn.QueryAsync<long>(new CommandDefinition(
                "SELECT DISTINCT article_id FROM reciept_items WHERE reciept_id IN @ids AND article_id IS NOT NULL",
                new { ids = chunk }, cancellationToken: ct)));
        }
        await RecomputeAsync(conn, null, articleIds, ct);
    }

    /// <summary>
    /// Replaces everything one cashier has parked for manual transfer. Returns the products whose
    /// pending quantity changed.
    /// </summary>
    public async Task<int> ReplaceHoldsAsync(long posId, IReadOnlyList<StockHoldReceiptDto> receipts, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            var before = (await conn.QueryAsync<long>(new CommandDefinition(
                "SELECT DISTINCT article_id FROM ext_stock_holds WHERE pos_id = @posId",
                new { posId }, transaction: tx, cancellationToken: ct))).ToHashSet();
            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM ext_stock_holds WHERE pos_id = @posId",
                new { posId }, transaction: tx, cancellationToken: ct));

            var rows = receipts
                .Where(r => r.ClientReceiptId != Guid.Empty)
                .SelectMany(r => r.Items
                    .Where(i => i.ArticleId > 0 && i.Quantity != 0)
                    .Select(i => new
                    {
                        posId,
                        clientReceiptId = r.ClientReceiptId,
                        articleId = i.ArticleId,
                        quantity = (double)Math.Abs(i.Quantity),
                        kind = r.Kind is 1 or 2 ? r.Kind : 0,
                        soldAt = r.SoldAt
                    }))
                .ToList();
            if (rows.Count > 0)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO ext_stock_holds (pos_id, client_receipt_id, article_id, quantity, kind, sold_at)
                    VALUES (@posId, @clientReceiptId, @articleId, @quantity, @kind, @soldAt)
                    """, rows, transaction: tx, cancellationToken: ct));
            }

            before.UnionWith(rows.Select(r => r.articleId));
            var changed = await RecomputeAsync(conn, tx, before, ct);
            await tx.CommitAsync(ct);
            return changed;
        }
        catch
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* doomed */ }
            throw;
        }
    }

    /// <summary>Holds whose receipt has arrived (or that went stale) — removed to keep the table small.</summary>
    public async Task<int> PruneHoldsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            DELETE h FROM ext_stock_holds h
            WHERE h.reported_at < DATEADD(DAY, -3, SYSDATETIME())
               OR EXISTS (SELECT 1 FROM reciepts r WHERE r.client_receipt_id = h.client_receipt_id)
            """, cancellationToken: ct));
    }

    public async Task MarkCheckAsync(string message, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_edari_settings
            SET pending_stock_last_check_at = SYSDATETIME(), pending_stock_last_message = @message
            """, new { message = message.Length > 400 ? message[..400] : message }, cancellationToken: ct));
    }

    public async Task<PendingStockStatusDto> GetStatusAsync(CancellationToken ct)
    {
        var opts = await GetOptionsAsync(ct, fresh: true);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition("""
            SELECT r.point_of_sale_id AS PosId,
                   MAX(CONVERT(NVARCHAR(200), pos.name)) AS PosName,
                   COUNT(*) AS Receipts,
                   SUM(CASE WHEN r.synced = 1 THEN 1 ELSE 0 END) AS InEdari,
                   SUM(CASE WHEN r.synced = 0 THEN 1 ELSE 0 END) AS NotInEdari,
                   MIN(r.creation_date) AS Oldest,
                   MAX(r.creation_date) AS Newest
            FROM reciepts r
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            WHERE r.stock_settled_at IS NULL AND r.is_pending = 0
            GROUP BY r.point_of_sale_id;

            SELECT r.point_of_sale_id AS PosId,
                   CAST(SUM(CASE WHEN r.kind = 1 THEN -ABS(ri.quantity) ELSE ABS(ri.quantity) END) AS DECIMAL(18,2)) AS Pieces
            FROM reciepts r INNER JOIN reciept_items ri ON ri.reciept_id = r.id
            WHERE r.stock_settled_at IS NULL AND r.is_pending = 0
            GROUP BY r.point_of_sale_id;

            SELECT h.pos_id AS PosId, MAX(CONVERT(NVARCHAR(200), pos.name)) AS PosName,
                   COUNT(DISTINCT h.client_receipt_id) AS Receipts,
                   CAST(SUM(CASE WHEN h.kind = 1 THEN -ABS(h.quantity) ELSE ABS(h.quantity) END) AS DECIMAL(18,2)) AS Pieces,
                   MAX(h.reported_at) AS ReportedAt
            FROM ext_stock_holds h
            LEFT JOIN point_of_sales pos ON pos.id = h.pos_id
            WHERE h.reported_at >= @holdSince
              AND NOT EXISTS (SELECT 1 FROM reciepts r2 WHERE r2.client_receipt_id = h.client_receipt_id)
            GROUP BY h.pos_id;

            SELECT COUNT(*) AS Products, CAST(COALESCE(SUM(ext_pending_qty), 0) AS DECIMAL(18,2)) AS Pieces
            FROM articles WHERE ext_pending_qty <> 0;

            SELECT TOP 1 pending_stock_last_check_at AS LastCheckAt, pending_stock_last_message AS LastMessage
            FROM ext_edari_settings ORDER BY id;

            SELECT COUNT(*) FROM reciepts
            WHERE stock_settle_source = N'expired' AND stock_settled_at >= DATEADD(DAY, -7, SYSDATETIME());
            """, new { holdSince = HoldSince() }, cancellationToken: ct));

        var pos = (await multi.ReadAsync<PosRow>()).ToList();
        var pieces = (await multi.ReadAsync<(long? PosId, decimal Pieces)>()).ToDictionary(x => x.PosId ?? 0, x => x.Pieces);
        var holds = (await multi.ReadAsync<HoldRow>()).ToList();
        var totals = await multi.ReadSingleAsync<(int Products, decimal Pieces)>();
        var check = await multi.ReadFirstOrDefaultAsync<(DateTime? LastCheckAt, string? LastMessage)>();
        var expired7d = await multi.ReadSingleAsync<int>();

        var cashiers = pos.Select(p => new PendingStockCashierDto(
                p.PosId ?? 0, CleanPosName(p.PosName, p.PosId), p.Receipts, p.InEdari, p.NotInEdari,
                pieces.TryGetValue(p.PosId ?? 0, out var pc) ? pc : 0, p.Oldest, p.Newest, 0, 0, null))
            .ToDictionary(c => c.PosId);
        foreach (var h in holds)
        {
            cashiers[h.PosId] = cashiers.TryGetValue(h.PosId, out var c)
                ? c with { HeldReceipts = h.Receipts, HeldPieces = h.Pieces, HoldsReportedAt = h.ReportedAt }
                : new PendingStockCashierDto(h.PosId, CleanPosName(h.PosName, h.PosId), 0, 0, 0, 0, null, null,
                    h.Receipts, h.Pieces, h.ReportedAt);
        }

        return new PendingStockStatusDto(
            opts.Enabled, opts.MaxHours, totals.Products, totals.Pieces,
            check.LastCheckAt, check.LastMessage, expired7d,
            cashiers.Values.OrderBy(c => c.PosId).ToList());
    }

    private static string CleanPosName(string? name, long? id) =>
        string.IsNullOrWhiteSpace(name) ? $"كاشير {id}" : name.Trim();

    private static DateTime HoldSince() => DateTime.Now - HoldStaleAfter;

    private sealed class OptionsRow
    {
        public bool Enabled { get; set; }
        public int MaxHours { get; set; }
    }

    private sealed class PosRow
    {
        public long? PosId { get; set; }
        public string? PosName { get; set; }
        public int Receipts { get; set; }
        public int InEdari { get; set; }
        public int NotInEdari { get; set; }
        public DateTime? Oldest { get; set; }
        public DateTime? Newest { get; set; }
    }

    private sealed class HoldRow
    {
        public long PosId { get; set; }
        public string? PosName { get; set; }
        public int Receipts { get; set; }
        public decimal Pieces { get; set; }
        public DateTime? ReportedAt { get; set; }
    }
}

public sealed record SettlementApplyResult(int Settled, int Reopened, int StockChanged, int PendingChanged);
