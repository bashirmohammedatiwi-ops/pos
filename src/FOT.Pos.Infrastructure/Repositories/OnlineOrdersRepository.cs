using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// «كاشير الطلبات»: الإعدادات (صف واحد) وربط طلبات التطبيق بإيصالات المحل (migration 089).
/// </summary>
public sealed class OnlineOrdersRepository(ISqlConnectionFactory db)
{
    private const string SettingsSql = """
        SELECT CAST(enabled AS bit) AS Enabled,
               hi_express_account AS HiExpressAccount, hi_express_account_num AS HiExpressAccountNum,
               hi_express_account_name AS HiExpressAccountName,
               prepaid_account AS PrepaidAccount, prepaid_account_num AS PrepaidAccountNum,
               prepaid_account_name AS PrepaidAccountName,
               delivery_article_id AS DeliveryArticleId, delivery_article_name AS DeliveryArticleName,
               receipt_copies AS ReceiptCopies, invoice_copies AS InvoiceCopies, label_copies AS LabelCopies,
               label_printer_name AS LabelPrinterName,
               CAST(auto_print_new_slips AS bit) AS AutoPrintNewSlips,
               CAST(double_check AS bit) AS DoubleCheck,
               updated_at AS UpdatedAt
        FROM ext_online_orders_settings WHERE id = 1
        """;

    public async Task<OnlineOrdersSettingsDto> GetSettingsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<OnlineOrdersSettingsDto>(new CommandDefinition(SettingsSql, cancellationToken: ct))
            ?? new OnlineOrdersSettingsDto();
    }

    public async Task<OnlineOrdersSettingsDto> SaveSettingsAsync(UpdateOnlineOrdersSettingsRequest req, CancellationToken ct)
    {
        var args = new
        {
            enabled = req.Enabled,
            hiAcc = req.HiExpressAccount is > 0 ? req.HiExpressAccount : null,
            hiNum = Clip(req.HiExpressAccountNum, 60),
            hiName = Clip(req.HiExpressAccountName, 200),
            preAcc = req.PrepaidAccount is > 0 ? req.PrepaidAccount : null,
            preNum = Clip(req.PrepaidAccountNum, 60),
            preName = Clip(req.PrepaidAccountName, 200),
            article = req.DeliveryArticleId is > 0 ? req.DeliveryArticleId : null,
            articleName = Clip(req.DeliveryArticleName, 200),
            receiptCopies = Math.Clamp(req.ReceiptCopies, 0, 5),
            invoiceCopies = Math.Clamp(req.InvoiceCopies, 0, 5),
            labelCopies = Math.Clamp(req.LabelCopies, 0, 5),
            labelPrinter = Clip(req.LabelPrinterName, 200),
            autoSlips = req.AutoPrintNewSlips,
            doubleCheck = req.DoubleCheck,
        };
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_online_orders_settings WHERE id = 1)
                INSERT INTO ext_online_orders_settings (id) VALUES (1);
            UPDATE ext_online_orders_settings SET
                enabled = @enabled,
                hi_express_account = @hiAcc, hi_express_account_num = @hiNum, hi_express_account_name = @hiName,
                prepaid_account = @preAcc, prepaid_account_num = @preNum, prepaid_account_name = @preName,
                delivery_article_id = @article, delivery_article_name = @articleName,
                receipt_copies = @receiptCopies, invoice_copies = @invoiceCopies, label_copies = @labelCopies,
                label_printer_name = @labelPrinter,
                auto_print_new_slips = @autoSlips, double_check = @doubleCheck,
                updated_at = SYSDATETIME()
            WHERE id = 1;
            """, args, cancellationToken: ct));
        return await GetSettingsAsync(ct);
    }

    private const string LinkColumns = """
        id AS Id, order_id AS OrderId, order_number AS OrderNumber, receipt_id AS ReceiptId,
        receipt_number AS ReceiptNumber, client_receipt_id AS ClientReceiptId, kind AS Kind,
        delivery_option AS DeliveryOption, tracking_number AS TrackingNumber,
        CAST(total AS DECIMAL(18,2)) AS Total, cashier_id AS CashierId, created_at AS CreatedAt,
        CAST(delivery_fee AS DECIMAL(18,2)) AS DeliveryFee, CAST(gift_wrap_fee AS DECIMAL(18,2)) AS GiftWrapFee,
        CAST(reported_ok AS bit) AS ReportedOk, reported_at AS ReportedAt, last_error AS LastError
        """;

    public async Task<OnlineOrderReceiptLinkDto?> GetLinkAsync(string orderId, string kind, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<OnlineOrderReceiptLinkDto>(new CommandDefinition(
            $"SELECT {LinkColumns} FROM ext_online_order_receipts WHERE order_id = @orderId AND kind = @kind",
            new { orderId, kind }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<OnlineOrderReceiptLinkDto>> ListLinksAsync(string orderId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowsAsync<OnlineOrderReceiptLinkDto>(new CommandDefinition(
            $"SELECT {LinkColumns} FROM ext_online_order_receipts WHERE order_id = @orderId ORDER BY id",
            new { orderId }, cancellationToken: ct));
    }

    /// <summary>يحفظ الربط مرة واحدة لكل (طلب، نوع) — إعادة المحاولة لا تكرره.</summary>
    public async Task<OnlineOrderReceiptLinkDto> EnsureLinkAsync(OnlineOrderReceiptLinkDto link, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_online_order_receipts WITH (UPDLOCK, HOLDLOCK) WHERE order_id = @OrderId AND kind = @Kind)
                INSERT INTO ext_online_order_receipts (
                    order_id, order_number, receipt_id, receipt_number, client_receipt_id, kind,
                    delivery_option, tracking_number, total, cashier_id, created_at, reported_ok, delivery_fee, gift_wrap_fee)
                VALUES (
                    @OrderId, @OrderNumber, @ReceiptId, @ReceiptNumber, @ClientReceiptId, @Kind,
                    @DeliveryOption, @TrackingNumber, @Total, @CashierId, SYSDATETIME(), 0, @DeliveryFee, @GiftWrapFee);
            """, new
        {
            link.OrderId,
            link.OrderNumber,
            link.ReceiptId,
            link.ReceiptNumber,
            link.ClientReceiptId,
            link.Kind,
            link.DeliveryOption,
            link.TrackingNumber,
            link.Total,
            link.CashierId,
            link.DeliveryFee,
            link.GiftWrapFee,
        }, cancellationToken: ct));
        return (await GetLinkAsync(link.OrderId, link.Kind, ct))!;
    }

    /// <summary>مبلغ الفاتورة بعد تعديلها قبل الترحيل.</summary>
    public async Task SetLinkTotalAsync(string orderId, string kind, decimal total, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_online_order_receipts SET total = @total WHERE order_id = @orderId AND kind = @kind",
            new { orderId, kind, total }, cancellationToken: ct));
    }

    public async Task MarkReportedAsync(string orderId, string kind, string? trackingNumber, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_online_order_receipts
            SET reported_ok = 1, reported_at = SYSDATETIME(), last_error = NULL,
                tracking_number = COALESCE(@trackingNumber, tracking_number)
            WHERE order_id = @orderId AND kind = @kind
            """, new { orderId, kind, trackingNumber = Clip(trackingNumber, 80) }, cancellationToken: ct));
    }

    public async Task MarkReportFailedAsync(string orderId, string kind, string error, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_online_order_receipts SET last_error = @error
            WHERE order_id = @orderId AND kind = @kind
            """, new { orderId, kind, error = Clip(error, 400) }, cancellationToken: ct));
    }

    public async Task SetTrackingAsync(string orderId, string trackingNumber, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_online_order_receipts SET tracking_number = @trackingNumber
            WHERE order_id = @orderId AND kind = N'sale' AND COALESCE(tracking_number, N'') <> @trackingNumber
            """, new { orderId, trackingNumber = Clip(trackingNumber, 80) }, cancellationToken: ct));
    }

    /// <summary>رأس إيصال محفوظ: الحساب الآجل وخصم الفاتورة — يحتاجهما إيصال الإرجاع.</summary>
    public async Task<ReceiptHeaderLite?> GetReceiptHeaderAsync(long receiptId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<ReceiptHeaderLite>(new CommandDefinition("""
            SELECT id AS Id, number AS Number, kind AS Kind, COALESCE(account, 0) AS Account,
                   CAST(COALESCE(user_discount, 0) AS DECIMAL(18,2)) AS UserDiscount,
                   CAST(total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   creation_date AS CreationDate
            FROM reciepts WHERE id = @receiptId
            """, new { receiptId }, cancellationToken: ct));
    }

    public async Task<long?> FindReceiptIdByClientIdAsync(Guid clientReceiptId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT TOP 1 id FROM reciepts WHERE client_receipt_id = @clientReceiptId",
            new { clientReceiptId }, cancellationToken: ct));
    }

    /// <summary>أرقام طلبات التطبيق لإيصالات القائمة — علامة «طلب تطبيق» في لوحة التحكم.</summary>
    public async Task<IReadOnlyDictionary<long, OnlineReceiptMark>> OrderNumbersForReceiptsAsync(IReadOnlyCollection<long> receiptIds, CancellationToken ct)
    {
        if (receiptIds.Count == 0) return new Dictionary<long, OnlineReceiptMark>();
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<OnlineReceiptMark>(new CommandDefinition("""
            SELECT receipt_id AS ReceiptId, order_number AS OrderNumber,
                   CAST(delivery_fee AS DECIMAL(18,2)) AS DeliveryFee, CAST(gift_wrap_fee AS DECIMAL(18,2)) AS GiftWrapFee
            FROM ext_online_order_receipts WHERE receipt_id IN @ids
            """, new { ids = receiptIds.ToArray() }, cancellationToken: ct));
        var map = new Dictionary<long, OnlineReceiptMark>();
        foreach (var r in rows) map[r.ReceiptId] = r;
        return map;
    }

    // ───────────────────────── الترحيل اليدوي إلى الإداري (migration 090) ─────────────────────────

    /// <summary>
    /// يحجز إيصال البيع عن الترحيل التلقائي. يُكتب قبل حفظ الإيصال (بمعرّفه الثابت) فلا تلتقطه
    /// مزامنة الإداري في اللحظة بين الحفظ والربط. إعادة الكتابة لا تفك حجزاً مُرحّلاً.
    /// </summary>
    public async Task HoldAsync(Guid clientReceiptId, string orderId, string? orderNumber, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            IF NOT EXISTS (SELECT 1 FROM ext_online_edari_holds WHERE client_receipt_id = @clientReceiptId)
                INSERT INTO ext_online_edari_holds (client_receipt_id, order_id, order_number)
                VALUES (@clientReceiptId, @orderId, @orderNumber)
            """, new { clientReceiptId, orderId, orderNumber = Clip(orderNumber, 64) }, cancellationToken: ct));
    }

    /// <summary>الحجز كما هو: null = لا حجز (إيصال قديم يُرحَّل تلقائياً كأي بيع).</summary>
    public async Task<OnlineEdariHoldDto?> GetHoldAsync(Guid clientReceiptId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<OnlineEdariHoldDto>(new CommandDefinition($"""
            {HoldSelect} WHERE h.client_receipt_id = @clientReceiptId
            """, new { clientReceiptId }, cancellationToken: ct));
    }

    /// <summary>فواتير طلبات التطبيق بانتظار الترحيل (الأقدم أولاً).</summary>
    public async Task<IReadOnlyList<OnlineEdariHoldDto>> ListHeldAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<OnlineEdariHoldDto>(new CommandDefinition($"""
            {HoldSelect} WHERE h.released_at IS NULL AND r.id IS NOT NULL ORDER BY h.created_at
            """, cancellationToken: ct));
        return rows.ToList();
    }

    /// <summary>تعديل على فاتورة محجوزة (عدد التعديلات ووقت آخرها — للعرض والمراجعة).</summary>
    public async Task MarkEditedAsync(Guid clientReceiptId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_online_edari_holds SET edits = edits + 1, last_edit_at = SYSDATETIME()
            WHERE client_receipt_id = @clientReceiptId AND released_at IS NULL
            """, new { clientReceiptId }, cancellationToken: ct));
    }

    /// <summary>«ترحيل»: يفك الحجز فتلتقط مزامنة الإداري الإيصال في دورتها التالية. يرد بعدد ما فُك.</summary>
    public async Task<int> ReleaseAsync(IReadOnlyCollection<Guid> clientReceiptIds, long cashierId, string? cashierName, CancellationToken ct)
    {
        if (clientReceiptIds.Count == 0) return 0;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_online_edari_holds
            SET released_at = SYSDATETIME(), released_by = @cashierId, released_by_name = @cashierName
            WHERE client_receipt_id IN @ids AND released_at IS NULL
            """, new { ids = clientReceiptIds.ToArray(), cashierId, cashierName = Clip(cashierName, 120) }, cancellationToken: ct));
    }

    private const string HoldSelect = """
        SELECT h.client_receipt_id AS ClientReceiptId, h.order_id AS OrderId, h.order_number AS OrderNumber,
               h.created_at AS CreatedAt, h.edits AS Edits, h.last_edit_at AS LastEditAt,
               h.released_at AS ReleasedAt, h.released_by_name AS ReleasedByName,
               r.id AS ReceiptId, r.number AS ReceiptNumber,
               CAST(COALESCE(r.total_amount, 0) AS DECIMAL(18,2)) AS Total,
               CAST(COALESCE(r.synced, 0) AS bit) AS Synced,
               l.delivery_option AS DeliveryOption, l.tracking_number AS TrackingNumber,
               COALESCE(c.account_name, c.username) AS CashierName
        FROM ext_online_edari_holds h
        LEFT JOIN reciepts r ON r.client_receipt_id = h.client_receipt_id
        LEFT JOIN ext_online_order_receipts l ON l.client_receipt_id = h.client_receipt_id
        LEFT JOIN cashiers c ON c.id = r.cashier_id
        """;

    private static string? Clip(string? value, int max)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        return v.Length <= max ? v : v[..max];
    }
}

public sealed class ReceiptHeaderLite
{
    public long Id { get; set; }
    public long Number { get; set; }
    public int Kind { get; set; }
    public long Account { get; set; }
    public decimal UserDiscount { get; set; }
    public decimal TotalAmount { get; set; }
    public DateTime CreationDate { get; set; }
}

/// <summary>علامة «طلب تطبيق» على الفاتورة في لوحة التحكم: رقم الطلب وأجور التوصيل والتغليف الخارجة عنها.</summary>
public sealed class OnlineReceiptMark
{
    public long ReceiptId { get; set; }
    public string OrderNumber { get; set; } = "";
    public decimal DeliveryFee { get; set; }
    public decimal GiftWrapFee { get; set; }
}
