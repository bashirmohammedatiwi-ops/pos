using Dapper;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class EdariSyncRepository(ISqlConnectionFactory db)
{
    public async Task<EdariSyncStatusDto> GetStatusAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT
              (SELECT COUNT(*) FROM reciepts WHERE synced=0 AND is_pending=0 AND dead_letter=0) AS UnsyncedCount,
              (SELECT COUNT(*) FROM reciepts WHERE synced=1 AND CAST(creation_date AS date)=CAST(GETDATE() AS date)) AS SyncedCount,
              (SELECT COUNT(*) FROM ext_edari_sync_log WHERE status='failed' AND CAST(attempted_at AS date)=CAST(GETDATE() AS date)) AS FailedCount,
              (SELECT COUNT(*) FROM reciepts WHERE dead_letter=1) AS DeadLetterCount,
              (SELECT DATEDIFF(MINUTE, MIN(creation_date), GETDATE()) FROM reciepts WHERE synced=0 AND is_pending=0) AS OldestUnsyncedMinutes,
              (SELECT database_alias FROM ext_edari_settings WHERE id=1) AS DatabaseAlias,
              (SELECT data_root FROM ext_edari_settings WHERE id=1) AS DataRoot,
              (SELECT last_connection_ok FROM ext_edari_settings WHERE id=1) AS ConnectionOk
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<StatusRow>(
            new CommandDefinition(sql, cancellationToken: ct));
        var deadInfo = row.DeadLetterCount > 0 ? $" — متوقفة نهائياً: {row.DeadLetterCount:N0}" : "";
        var ageInfo = row.OldestUnsyncedMinutes > 60
            ? $" (أقدم فاتورة {row.OldestUnsyncedMinutes / 60} ساعة)"
            : "";
        var msg = row.UnsyncedCount > 0
            ? $"بانتظار المزامنة: {row.UnsyncedCount:N0} فاتورة{ageInfo}{deadInfo} — نسخة {row.DatabaseAlias}"
            : $"جميع الفواتير متزامنة{deadInfo} — نسخة {row.DatabaseAlias}";
        return new EdariSyncStatusDto(row.UnsyncedCount, row.SyncedCount, row.FailedCount, msg,
            row.ConnectionOk, row.DatabaseAlias, row.DataRoot,
            DeadLetterCount: row.DeadLetterCount,
            OldestUnsyncedMinutes: row.OldestUnsyncedMinutes);
    }

    public async Task LogAttemptAsync(long receiptId, string status, long? edrNum, string? error, CancellationToken ct) =>
        await LogAttemptAsync(receiptId, status, edrNum, error, "receipt", null, ct);

    public async Task LogAttemptAsync(long? receiptId, string status, long? edrNum, string? error,
        string operation, string? details, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ext_edari_sync_log (receipt_id, status, edr_num, error_message, operation, details)
            VALUES (@receiptId, @status, @edrNum, @error, @operation, @details)
            """, new {
            receiptId,
            status,
            edrNum,
            error = error is null ? null : (error.Length > 400 ? error[..400] : error),
            operation,
            details = details is null ? null : (details.Length > 400 ? details[..400] : details)
        }, cancellationToken: ct));
    }

    public async Task LogOperationAsync(string operation, string status, string? details, CancellationToken ct) =>
        await LogAttemptAsync(0, status, null, null, operation, details, ct);

    public async Task<IReadOnlyList<ReceiptSummaryDto>> UnsyncedReceiptsAsync(int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit) r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(r.payment AS DECIMAL(18,2)) AS Payment,
                   CAST(r.cash_back AS DECIMAL(18,2)) AS CashBack,
                   r.salesman AS SalesmanId, s.name AS SalesmanName,
                   r.point_of_sale_id AS PosId, p.name AS PosName,
                   CAST(r.synced AS bit) AS Synced, r.edr_num AS EdrNum,
                   (SELECT COUNT(*) FROM reciept_items ri WHERE ri.reciept_id = r.id) AS ItemCount
            FROM reciepts r
            LEFT JOIN salesmen s ON s.id = r.salesman
            LEFT JOIN point_of_sales p ON p.id = r.point_of_sale_id
            WHERE r.synced=0 AND r.is_pending=0
            ORDER BY r.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<UnsyncedRow>(
            new CommandDefinition(sql, new { limit }, cancellationToken: ct))).ToList();
        return rows.Select(r => new ReceiptSummaryDto(
            r.Id, r.Number, r.CreationDate, r.TotalAmount, r.Payment, r.CashBack,
            r.SalesmanId, r.SalesmanName, r.PosId, r.PosName, r.Synced, r.EdrNum, r.ItemCount
        )).ToList();
    }

    public async Task<IReadOnlyList<EdariSyncLogDto>> RecentLogsAsync(int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit) id AS Id, receipt_id AS ReceiptId, status AS Status, edr_num AS EdrNum,
                   operation AS Operation, error_message AS ErrorMessage, details AS Details, attempted_at AS AttemptedAt
            FROM ext_edari_sync_log ORDER BY id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<EdariSyncLogDto>(
            new CommandDefinition(sql, new { limit }, cancellationToken: ct))).ToList();
    }

    /// <summary>
    /// Newest creation_date among queued receipts — drives the near-realtime push lane
    /// (same queue filter as GetReceiptsForSyncAsync). Returns null when the queue is empty.
    /// </summary>
    public async Task<DateTime?> GetNewestUnsyncedCreatedAtAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var value = await conn.ExecuteScalarAsync<DateTime?>(new CommandDefinition("""
            SELECT MAX(r.creation_date)
            FROM reciepts r
            WHERE r.synced = 0 AND r.is_pending = 0
              AND r.dead_letter = 0
              AND (r.next_sync_at IS NULL OR r.next_sync_at <= GETDATE())
            """, cancellationToken: ct));
        return value is { } v && v > DateTime.MinValue ? v : null;
    }

    public async Task<IReadOnlyList<ReceiptForEdariSync>> GetReceiptsForSyncAsync(int limit, CancellationToken ct)
    {
        const string headerSql = """
            SELECT TOP (@limit)
                r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                CAST(r.items_discount AS DECIMAL(18,2)) AS ItemsDiscount,
                CAST(r.offers_discount AS DECIMAL(18,2)) AS OffersDiscount,
                CAST(r.user_discount AS DECIMAL(18,2)) AS UserDiscount,
                CAST(r.payment AS DECIMAL(18,2)) AS Payment,
                CAST(r.cash_back AS DECIMAL(18,2)) AS CashBack,
                COALESCE(NULLIF(r.account, 0), 0) AS Account,
                COALESCE(
                    NULLIF(r.master_account, 0),
                    def_cb.master_account,
                    NULLIF(sec.master_account, 0),
                    0
                ) AS MasterAccount,
                r.salesman AS Salesman,
                COALESCE(r.cashier_id, 0) AS CashierId, COALESCE(r.kind, 0) AS Kind,
                COALESCE(sec.edari_branch_id, 0) AS Branch,
                COALESCE(sec.edari_warehouse_number, 1) AS Warehouse,
                CASE WHEN EXISTS (SELECT 1 FROM reciept_credit_card cc WHERE cc.reciept_id = r.id) THEN 1 ELSE 0 END AS IsCardPayment
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN sections sec ON sec.id = c.section_id
            LEFT JOIN section_cashboxes def_cb ON def_cb.section_id = sec.id AND def_cb.is_default = 1
            WHERE r.synced = 0 AND r.is_pending = 0
              AND r.dead_letter = 0
              AND (r.next_sync_at IS NULL OR r.next_sync_at <= GETDATE())
            ORDER BY r.id
            """;
        const string itemsSql = """
            SELECT ri.reciept_id AS ReceiptId, COALESCE(a.Seq, ri.article_id) AS ArticleSeq,
                   ri.barcode AS Barcode,
                   CAST(ri.quantity AS DECIMAL(18,6)) AS Quantity,
                   CAST(ri.price AS DECIMAL(18,6)) AS Price,
                   CAST(ri.original_price AS DECIMAL(18,6)) AS OriginalPrice,
                   CAST(ri.discount AS DECIMAL(18,6)) AS Discount
            FROM reciept_items ri
            LEFT JOIN articles a ON a.id = ri.article_id
            WHERE ri.reciept_id IN @ids
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var headers = (await conn.QueryAsync<ReceiptHeaderRow>(
            new CommandDefinition(headerSql, new { limit }, cancellationToken: ct))).ToList();
        if (headers.Count == 0) return [];

        var ids = headers.Select(h => h.Id).ToArray();
        var items = (await conn.QueryAsync<ItemRow>(
            new CommandDefinition(itemsSql, new { ids }, cancellationToken: ct))).ToLookup(i => i.ReceiptId);

        return headers.Select(h => new ReceiptForEdariSync(
            h.Id, h.Number, h.CreationDate, h.TotalAmount, h.ItemsDiscount, h.OffersDiscount,
            h.UserDiscount, h.Payment, h.CashBack, h.Account, h.MasterAccount, h.Salesman, h.CashierId,
            h.Branch, h.Warehouse, h.Kind, h.IsCardPayment,
            items[h.Id].Select(i => new ReceiptItemForEdariSync(
                i.ArticleSeq, i.Barcode, i.Quantity, i.Price, i.OriginalPrice, i.Discount)).ToList()
        )).ToList();
    }

    public async Task MarkReceiptSyncedAsync(long receiptId, long edrNum, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts
            SET synced = 1, edr_num = @edrNum, sync_date = GETDATE(),
                sync_attempts = 0, next_sync_at = NULL, dead_letter = 0, dead_reason = NULL
            WHERE id = @receiptId
            """, new { receiptId, edrNum }, cancellationToken: ct));
    }

    /// <summary>
    /// Records one failed posting attempt with escalating backoff (2m→5m→15m→30m→60m);
    /// dead-letters the receipt (stops automatic retries) when the attempt budget is
    /// exhausted or the failure is structural.
    /// </summary>
    public async Task RecordSyncFailureAsync(
        long receiptId, string reason, bool permanent, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts
            SET sync_attempts = sync_attempts + 1,
                last_sync_attempt_at = GETDATE(),
                dead_reason = @reason,
                dead_letter = CASE WHEN @permanent = 1 OR sync_attempts + 1 >= @maxAttempts THEN 1 ELSE 0 END,
                next_sync_at = CASE
                    WHEN @permanent = 1 OR sync_attempts + 1 >= @maxAttempts THEN NULL
                    ELSE DATEADD(SECOND,
                        CASE sync_attempts
                            WHEN 0 THEN 120
                            WHEN 1 THEN 300
                            WHEN 2 THEN 900
                            WHEN 3 THEN 1800
                            ELSE 3600 END,
                        GETDATE()) END
            WHERE id = @receiptId
            """, new { receiptId, reason = Truncate(reason, 400), permanent, maxAttempts = MaxSyncAttempts }, cancellationToken: ct));
    }

    public const int MaxSyncAttempts = 10;

    public async Task<bool> RetryDeadLetterAsync(long receiptId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts
            SET dead_letter = 0, dead_reason = NULL, sync_attempts = 0,
                next_sync_at = NULL, last_sync_attempt_at = NULL
            WHERE id = @receiptId AND dead_letter = 1 AND synced = 0
            """, new { receiptId }, cancellationToken: ct));
        return rows > 0;
    }

    public async Task<int> RetryAllDeadLettersAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts
            SET dead_letter = 0, dead_reason = NULL, sync_attempts = 0,
                next_sync_at = NULL, last_sync_attempt_at = NULL
            WHERE dead_letter = 1 AND synced = 0
            """, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<EdariDeadLetterDto>> GetDeadLettersAsync(int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit) r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   r.sync_attempts AS SyncAttempts, r.dead_reason AS Reason,
                   r.last_sync_attempt_at AS LastAttemptAt
            FROM reciepts r
            WHERE r.dead_letter = 1 AND r.synced = 0
            ORDER BY r.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<EdariDeadLetterDto>(
            new CommandDefinition(sql, new { limit }, cancellationToken: ct))).ToList();
    }

    private static string Truncate(string value, int max) =>
        value.Length > max ? value[..max] : value;

    /// <summary>Follows a bill that had to be renumbered in Edari after it was already posted.</summary>
    public async Task UpdateEdrNumAsync(long receiptId, long edrNum, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE reciepts SET edr_num = @edrNum WHERE id = @receiptId",
            new { receiptId, edrNum }, cancellationToken: ct));
    }

    public async Task UpdateLastReceiptSyncAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_edari_settings SET last_receipt_sync_at = GETDATE() WHERE id = 1",
            cancellationToken: ct));
    }

    public async Task UpdateLastCatalogSyncAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_edari_settings SET last_catalog_sync_at = GETDATE() WHERE id = 1",
            cancellationToken: ct));
    }

    public async Task<IReadOnlyList<long>> GetSyncedReceiptIdsAsync(
        DateTime? from, DateTime? to, long? sectionId, CancellationToken ct)
    {
        var where = "WHERE r.synced = 1 AND r.is_pending = 0";
        var p = new DynamicParameters();
        if (from.HasValue) { where += " AND r.creation_date >= @from"; p.Add("from", from.Value); }
        if (to.HasValue) { where += " AND r.creation_date < @toPlus"; p.Add("toPlus", to.Value.Date.AddDays(1)); }
        if (sectionId.HasValue)
        {
            where += " AND COALESCE(NULLIF(pos.section_id, 0), c.section_id) = @sectionId";
            p.Add("sectionId", sectionId);
        }

        var sql = $"""
            SELECT r.id
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            {where}
            ORDER BY r.id
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<long>(new CommandDefinition(sql, p, cancellationToken: ct))).ToList();
    }

    public async Task<int> ResetReceiptsSyncStateAsync(IReadOnlyList<long> receiptIds, CancellationToken ct)
    {
        if (receiptIds.Count == 0) return 0;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE reciepts
            SET synced = 0, edr_num = NULL, sync_date = NULL,
                sync_attempts = 0, next_sync_at = NULL, dead_letter = 0, dead_reason = NULL
            WHERE id IN @ids
            """, new { ids = receiptIds }, cancellationToken: ct));
    }

    private sealed class UnsyncedRow
    {
        public long Id { get; set; }
        // Receipt numbers are {year}{cashier}{seq} — 11 digits, far beyond int range.
        public long Number { get; set; }
        public DateTime CreationDate { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal Payment { get; set; }
        public decimal CashBack { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public long? PosId { get; set; }
        public string? PosName { get; set; }
        public bool Synced { get; set; }
        public long? EdrNum { get; set; }
        public int ItemCount { get; set; }
    }

    private sealed class StatusRow
    {
        public int UnsyncedCount { get; set; }
        public int SyncedCount { get; set; }
        public int FailedCount { get; set; }
        public int DeadLetterCount { get; set; }
        public int? OldestUnsyncedMinutes { get; set; }
        public string? DatabaseAlias { get; set; }
        public string? DataRoot { get; set; }
        public bool? ConnectionOk { get; set; }
    }

    private sealed class ReceiptHeaderRow
    {
        public long Id { get; set; }
        // BIGINT in SQL and {year}{cashier}{seq} in value — must stay long or Dapper overflows.
        public long Number { get; set; }
        public DateTime CreationDate { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal ItemsDiscount { get; set; }
        public decimal OffersDiscount { get; set; }
        public decimal UserDiscount { get; set; }
        public decimal Payment { get; set; }
        public decimal CashBack { get; set; }
        public long Account { get; set; }
        public long MasterAccount { get; set; }
        public long Salesman { get; set; }
        public long CashierId { get; set; }
        public int Kind { get; set; }
        public int Branch { get; set; }
        public int Warehouse { get; set; }
        public bool IsCardPayment { get; set; }
    }

    private sealed class ItemRow
    {
        public long ReceiptId { get; set; }
        public long ArticleSeq { get; set; }
        public string? Barcode { get; set; }
        public decimal Quantity { get; set; }
        public decimal Price { get; set; }
        public decimal OriginalPrice { get; set; }
        public decimal Discount { get; set; }
    }
}
