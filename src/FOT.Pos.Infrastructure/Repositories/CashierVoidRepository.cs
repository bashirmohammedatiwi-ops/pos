using System.Text.Json;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class CashierVoidRepository(ISqlConnectionFactory db, PosLogRepository logs)
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public async Task RecordAsync(long cashierId, RecordCashierVoidRequest req, CancellationToken ct)
    {
        var kind = req.Kind == "invoice" ? "invoice" : "line";
        var lines = (req.Lines ?? [])
            .Take(200)
            .Select(l => new CashierVoidLineDto(
                Clip(l.Name, 200),
                Clip(l.Barcode, 80),
                Clamp(l.Quantity),
                Clamp(l.Amount)))
            .ToList();
        var name = Clip(req.ProductName, 200) ?? (kind == "line" ? lines.FirstOrDefault()?.Name : null);
        var barcode = Clip(req.Barcode, 80) ?? (kind == "line" ? lines.FirstOrDefault()?.Barcode : null);
        var quantity = kind == "line"
            ? (req.Quantity > 0 ? Clamp(req.Quantity) : lines.Sum(l => l.Quantity))
            : lines.Sum(l => l.Quantity);
        var amount = req.Amount > 0 ? Clamp(req.Amount) : lines.Sum(l => l.Amount);
        var lineCount = kind == "invoice"
            ? Math.Max(req.LineCount, lines.Count)
            : Math.Max(1, lines.Count);
        var json = lines.Count == 0 ? null : JsonSerializer.Serialize(lines, JsonOpts);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ext_cashier_voids
                (cashier_id, kind, product_name, barcode, quantity, amount, line_count, receipt_num, source, lines_json)
            VALUES
                (@cashierId, @kind, @name, @barcode, @quantity, @amount, @lineCount, @receiptNum, @source, @json)
            """, new
        {
            cashierId,
            kind,
            name,
            barcode,
            quantity,
            amount,
            lineCount,
            receiptNum = Clip(req.ReceiptNum, 40),
            source = Clip(req.Source, 20),
            json,
        }, cancellationToken: ct));

        var label = kind == "invoice"
            ? $"إلغاء فاتورة ({lineCount} بنود)"
            : $"حذف بند: {name ?? barcode ?? "بند"}";
        await logs.LogAsync(
            kind == "invoice" ? "receipt_void" : "item_delete",
            label,
            cashierId,
            null,
            null,
            Clip(req.ReceiptNum, 40),
            json,
            ct);
    }

    public async Task<CashierVoidReportDto> SummaryAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<SummaryRow>(new CommandDefinition("""
            SELECT
                v.cashier_id AS CashierId,
                COALESCE(
                    NULLIF(LTRIM(RTRIM(c.account_name)), N''),
                    NULLIF(LTRIM(RTRIM(c.username)), N''),
                    CAST(v.cashier_id AS NVARCHAR(20))) AS CashierName,
                SUM(CASE WHEN v.kind = N'line' THEN 1 ELSE 0 END) AS DeletedLines,
                SUM(CASE WHEN v.kind = N'invoice' THEN 1 ELSE 0 END) AS CancelledInvoices,
                SUM(CASE WHEN v.kind = N'line' THEN v.amount ELSE 0 END) AS DeletedAmount,
                SUM(CASE WHEN v.kind = N'invoice' THEN v.amount ELSE 0 END) AS CancelledAmount
            FROM ext_cashier_voids v
            LEFT JOIN cashiers c ON c.id = v.cashier_id
            WHERE v.created_at >= @from AND v.created_at < @toPlus
            GROUP BY v.cashier_id, c.account_name, c.username
            ORDER BY SUM(CASE WHEN v.kind = N'invoice' THEN 1 ELSE 0 END) DESC,
                     SUM(CASE WHEN v.kind = N'line' THEN 1 ELSE 0 END) DESC,
                     CashierName
            """, new { from = from.Date, toPlus = to.Date.AddDays(1) }, cancellationToken: ct))).ToList();

        return new CashierVoidReportDto(
            rows.Select(r => new CashierVoidSummaryDto(
                r.CashierId,
                r.CashierName ?? r.CashierId.ToString(),
                r.DeletedLines,
                r.CancelledInvoices,
                r.DeletedAmount,
                r.CancelledAmount)).ToList(),
            rows.Sum(r => r.DeletedLines),
            rows.Sum(r => r.CancelledInvoices),
            rows.Sum(r => r.DeletedAmount),
            rows.Sum(r => r.CancelledAmount));
    }

    public async Task<IReadOnlyList<CashierVoidEventDto>> DetailAsync(
        long cashierId, DateTime from, DateTime to, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<EventRow>(new CommandDefinition("""
            SELECT TOP (500)
                id AS Id,
                kind AS Kind,
                product_name AS ProductName,
                barcode AS Barcode,
                quantity AS Quantity,
                amount AS Amount,
                line_count AS LineCount,
                receipt_num AS ReceiptNum,
                source AS Source,
                lines_json AS LinesJson,
                created_at AS CreatedAt
            FROM ext_cashier_voids
            WHERE cashier_id = @cashierId
              AND created_at >= @from AND created_at < @toPlus
            ORDER BY id DESC
            """, new { cashierId, from = from.Date, toPlus = to.Date.AddDays(1) }, cancellationToken: ct));

        return rows.Select(r => new CashierVoidEventDto(
            r.Id,
            r.Kind,
            r.ProductName,
            r.Barcode,
            r.Quantity,
            r.Amount,
            r.LineCount,
            r.ReceiptNum,
            r.Source,
            r.CreatedAt,
            ReadLines(r.LinesJson))).ToList();
    }

    private static IReadOnlyList<CashierVoidLineDto> ReadLines(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<CashierVoidLineDto>>(json, JsonOpts) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private static string? Clip(string? value, int max)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        return text.Length <= max ? text : text[..max];
    }

    private static decimal Clamp(decimal value)
    {
        if (value < 0) return 0;
        return value > 999_999_999m ? 999_999_999m : value;
    }

    private sealed class SummaryRow
    {
        public long CashierId { get; set; }
        public string? CashierName { get; set; }
        public int DeletedLines { get; set; }
        public int CancelledInvoices { get; set; }
        public decimal DeletedAmount { get; set; }
        public decimal CancelledAmount { get; set; }
    }

    private sealed class EventRow
    {
        public long Id { get; set; }
        public string Kind { get; set; } = "";
        public string? ProductName { get; set; }
        public string? Barcode { get; set; }
        public decimal Quantity { get; set; }
        public decimal Amount { get; set; }
        public int LineCount { get; set; }
        public string? ReceiptNum { get; set; }
        public string? Source { get; set; }
        public string? LinesJson { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
