using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Services;

namespace FOT.Pos.Infrastructure.Repositories;

/*
 * الفواتير الكاملة لتطبيق المدراء (تُرفع لخادم الفريق): رأس الفاتورة وسطورها وبيانات البطاقة.
 * من البطاقة تُرفع آخر 4 أرقام والنوع ومرجع العملية فقط — لا اسم حامل البطاقة ولا الرقم المقنّع.
 * «بصمة اليوم» تكشف ما نقص أو تغيّر (بيع دون اتصال، تعديل فاتورة، ربط رقم ورقي) دون قراءة السطور.
 */

public sealed class InvoiceDaySignature
{
    public string Day { get; set; } = "";
    public int N { get; set; }
    public long MaxId { get; set; }
    public decimal Sum { get; set; }
    public int Edits { get; set; }
    public long Printed { get; set; }
}

public sealed class SyncInvoiceLine
{
    public long Id { get; set; }
    public long ReceiptId { get; set; }
    public long ArticleId { get; set; }
    public string? Name { get; set; }
    public string? Barcode { get; set; }
    public decimal Qty { get; set; }
    public decimal Price { get; set; }
    public decimal Original { get; set; }
    public decimal Discount { get; set; }
    public string? Seller { get; set; }
    public string? Group { get; set; }
}

public sealed class SyncInvoice
{
    public long Id { get; set; }
    public long Number { get; set; }
    public long? Printed { get; set; }
    public DateTime At { get; set; }
    public int Kind { get; set; }
    public decimal Total { get; set; }
    public decimal ItemsDiscount { get; set; }
    public decimal OffersDiscount { get; set; }
    public decimal UserDiscount { get; set; }
    public decimal Payment { get; set; }
    public decimal CashBack { get; set; }
    public string? Cashier { get; set; }
    public string? Pos { get; set; }
    public string? Section { get; set; }
    public string? Seller { get; set; }
    public string? Remarks { get; set; }
    public string? Voucher { get; set; }
    public string? DiscountPerson { get; set; }
    public long? ReturnOf { get; set; }
    public int Edits { get; set; }
    public string? CardType { get; set; }
    public string? CardAcquirer { get; set; }
    public string? CardLast4 { get; set; }
    public string? CardRef { get; set; }
    public string? CardTerminal { get; set; }
    public bool Card { get; set; }
    public List<SyncInvoiceLine> Lines { get; set; } = [];
}

public sealed class InvoiceSyncRepository(ISqlConnectionFactory db, ReceiptSchemaService schema)
{
    private const string DayExpr = "CONVERT(CHAR(10), r.creation_date, 23)";

    /// <summary>بصمة كل يوم فيه فواتير منذ التاريخ المحدد.</summary>
    public async Task<IReadOnlyList<InvoiceDaySignature>> DaySignaturesAsync(DateTime from, CancellationToken ct)
    {
        await schema.EnsureLoadedAsync(ct);
        var editsJoin = schema.ReceiptEdits
            ? "LEFT JOIN (SELECT receipt_id, COUNT(*) AS c FROM ext_receipt_edits GROUP BY receipt_id) e ON e.receipt_id = r.id"
            : "";
        var editsCol = schema.ReceiptEdits ? "COALESCE(SUM(e.c), 0)" : "0";
        var printedCol = schema.PrintedNumber ? "COALESCE(SUM(CAST(COALESCE(r.printed_number, 0) AS BIGINT)), 0)" : "CAST(0 AS BIGINT)";
        var sql = $"""
            SELECT {DayExpr} AS Day, COUNT(*) AS N, MAX(r.id) AS MaxId,
                   CAST(COALESCE(SUM(r.total_amount), 0) AS DECIMAL(18,2)) AS Sum,
                   {editsCol} AS Edits, {printedCol} AS Printed
            FROM reciepts r {editsJoin}
            WHERE r.creation_date >= @from AND r.is_pending = 0
            GROUP BY {DayExpr}
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<InvoiceDaySignature>(new CommandDefinition(sql, new { from }, cancellationToken: ct))).ToList();
    }

    /// <summary>كل فواتير يوم مع سطورها.</summary>
    public async Task<IReadOnlyList<SyncInvoice>> ByDayAsync(DateTime day, CancellationToken ct)
    {
        var date = day.Date;
        return await LoadAsync("r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0",
            new { day = date, next = date.AddDays(1) }, ct);
    }

    /// <summary>الفواتير الأحدث من رقم معيّن (الأقدم أولاً، بحد أقصى).</summary>
    public async Task<IReadOnlyList<SyncInvoice>> AfterAsync(long afterId, int limit, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var last = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT MAX(id) FROM (SELECT TOP (@limit) r.id FROM reciepts r WHERE r.id > @afterId AND r.is_pending = 0 ORDER BY r.id) x",
            new { afterId, limit = Math.Clamp(limit, 1, 1000) }, cancellationToken: ct));
        if (last is null) return [];
        return await LoadAsync("r.id > @afterId AND r.id <= @last AND r.is_pending = 0", new { afterId, last }, ct);
    }

    private async Task<IReadOnlyList<SyncInvoice>> LoadAsync(string where, object args, CancellationToken ct)
    {
        await schema.EnsureLoadedAsync(ct);
        var printed = schema.PrintedNumber ? "r.printed_number" : "CAST(NULL AS BIGINT)";
        var returnOf = schema.ReturnOfReceiptId ? "r.return_of_receipt_id" : "CAST(NULL AS BIGINT)";
        var person = schema.DiscountQrPerson ? "r.discount_qr_person_name" : "CAST(NULL AS NVARCHAR(200))";
        var edits = schema.ReceiptEdits ? "(SELECT COUNT(*) FROM ext_receipt_edits e WHERE e.receipt_id = r.id)" : "0";
        var headers = $"""
            SELECT r.id AS Id, CAST(COALESCE(r.number, 0) AS BIGINT) AS Number, {printed} AS Printed,
                   r.creation_date AS At, r.kind AS Kind,
                   CAST(COALESCE(r.total_amount, 0) AS DECIMAL(18,2)) AS Total,
                   CAST(COALESCE(r.items_discount, 0) AS DECIMAL(18,2)) AS ItemsDiscount,
                   CAST(COALESCE(r.offers_discount, 0) AS DECIMAL(18,2)) AS OffersDiscount,
                   CAST(COALESCE(r.user_discount, 0) AS DECIMAL(18,2)) AS UserDiscount,
                   CAST(COALESCE(r.payment, 0) AS DECIMAL(18,2)) AS Payment,
                   CAST(COALESCE(r.cash_back, 0) AS DECIMAL(18,2)) AS CashBack,
                   COALESCE(NULLIF(LTRIM(RTRIM(c.account_name)), N''), c.username) AS Cashier,
                   CASE WHEN pos.id IS NULL THEN NULL WHEN pos.name IS NULL OR pos.name LIKE N'win:%' THEN N'نقطة بيع ' + CAST(pos.id AS NVARCHAR(12)) ELSE pos.name END AS Pos,
                   sec.name AS Section, s.name AS Seller,
                   NULLIF(LTRIM(RTRIM(r.remarks)), N'') AS Remarks,
                   NULLIF(LTRIM(RTRIM(r.voucher_code)), N'') AS Voucher,
                   NULLIF(LTRIM(RTRIM({person})), N'') AS DiscountPerson,
                   {returnOf} AS ReturnOf, {edits} AS Edits,
                   CAST(CASE WHEN k.id IS NULL THEN 0 ELSE 1 END AS BIT) AS Card,
                   k.card_type AS CardType, k.acquirer AS CardAcquirer,
                   RIGHT(LTRIM(RTRIM(k.accNo)), 4) AS CardLast4,
                   COALESCE(NULLIF(k.rrn, N''), k.ref_no) AS CardRef, k.terminalId AS CardTerminal
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            LEFT JOIN salesmen s ON s.id = r.salesman
            OUTER APPLY (SELECT TOP 1 * FROM reciept_credit_card x WHERE x.reciept_id = r.id ORDER BY x.id DESC) k
            WHERE {where}
            ORDER BY r.id
            """;
        var seller = schema.LineAttribution ? "COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), N''), ls.name)" : "CAST(NULL AS NVARCHAR(200))";
        var group = schema.LineAttribution ? "ri.group_label" : "CAST(NULL AS NVARCHAR(200))";
        var sellerJoin = schema.LineAttribution ? "LEFT JOIN salesmen ls ON ls.id = ri.salesman_id" : "";
        var lines = $"""
            SELECT ri.id AS Id, ri.reciept_id AS ReceiptId, ri.article_id AS ArticleId,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                   COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Barcode))), N''), NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), ri.barcode))), N'')) AS Barcode,
                   CAST(COALESCE(ri.quantity, 0) AS DECIMAL(18,3)) AS Qty,
                   CAST(COALESCE(ri.price, 0) AS DECIMAL(18,2)) AS Price,
                   CAST(COALESCE(ri.original_price, 0) AS DECIMAL(18,2)) AS Original,
                   CAST(COALESCE(ri.discount, 0) AS DECIMAL(18,2)) AS Discount,
                   {seller} AS Seller, {group} AS [Group]
            FROM reciept_items ri
            JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN articles a ON a.id = ri.article_id
            {sellerJoin}
            WHERE {where}
            ORDER BY ri.reciept_id, ri.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<SyncInvoice>(new CommandDefinition(headers, args, cancellationToken: ct))).ToList();
        if (rows.Count == 0) return rows;
        var byId = rows.ToDictionary(r => r.Id);
        foreach (var line in await conn.QueryAsync<SyncInvoiceLine>(new CommandDefinition(lines, args, cancellationToken: ct)))
            if (byId.TryGetValue(line.ReceiptId, out var owner)) owner.Lines.Add(line);
        return rows;
    }
}
