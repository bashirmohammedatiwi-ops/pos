using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class PosLogRepository(ISqlConnectionFactory db)
{
    public async Task<IReadOnlyList<CashierActivityDto>> ListByPosAsync(long posId, int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit)
                l.id AS Id,
                COALESCE(c.username, CAST(l.cashier_id AS NVARCHAR(20))) AS CashierName,
                COALESCE(l.event_type, 'other') AS EventType,
                l.message AS Message,
                CONCAT(COALESCE(sec.name, N'رئيسي'), N' / ', COALESCE(p.name, N'—')) AS PosPath,
                l.created_at AS CreatedAt,
                l.receipt_id AS ReceiptId,
                l.receipt_num AS ReceiptNum
            FROM ext_pos_logs l
            LEFT JOIN cashiers c ON c.id = l.cashier_id
            LEFT JOIN point_of_sales p ON p.id = l.pos_id
            LEFT JOIN sections sec ON sec.id = p.section_id
            WHERE l.pos_id = @posId
            ORDER BY l.id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<ActivityRow>(
            new CommandDefinition(sql, new { posId, limit }, cancellationToken: ct));
        return rows.Select(r => new CashierActivityDto(
            r.Id, r.CashierName, r.EventType, EventLabel(r.EventType), r.PosPath,
            r.CreatedAt, r.ReceiptId, r.ReceiptNum, r.Message)).ToList();
    }

    public async Task LogAsync(
        string eventType, string message, long? cashierId, long? posId, long? receiptId,
        string? receiptNum, string? details, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_pos_logs (source, level, message, details, cashier_id, pos_id, receipt_id, receipt_num, event_type)
                VALUES ('pos', 'info', @message, @details, @cashierId, @posId, @receiptId, @receiptNum, @eventType)
                """, new { eventType, message, details, cashierId, posId, receiptId, receiptNum }, cancellationToken: ct));
        }
        catch
        {
            // Logging must never break checkout or admin pages.
        }
    }

    public async Task<IReadOnlyList<CashierActivityDto>> ListAsync(
        DateTime from, DateTime to, long? cashierId, string? search, int limit, CancellationToken ct)
    {
        var where = "WHERE l.created_at >= @from AND l.created_at < @toPlus";
        var p = new DynamicParameters();
        p.Add("from", from);
        p.Add("toPlus", to.Date.AddDays(1));
        if (cashierId.HasValue) { where += " AND l.cashier_id = @cashierId"; p.Add("cashierId", cashierId); }
        if (!string.IsNullOrWhiteSpace(search))
        {
            where += " AND (l.message LIKE @s OR l.receipt_num LIKE @s OR c.username LIKE @s OR p.name LIKE @s)";
            p.Add("s", $"%{search.Trim()}%");
        }
        p.Add("limit", limit);

        var sql = $"""
            SELECT TOP (@limit)
                l.id AS Id,
                COALESCE(c.username, CAST(l.cashier_id AS NVARCHAR(20))) AS CashierName,
                COALESCE(l.event_type, 'other') AS EventType,
                l.message AS Message,
                CONCAT(COALESCE(sec.name, N'رئيسي'), N' / ', COALESCE(p.name, N'—')) AS PosPath,
                l.created_at AS CreatedAt,
                l.receipt_id AS ReceiptId,
                l.receipt_num AS ReceiptNum
            FROM ext_pos_logs l
            LEFT JOIN cashiers c ON c.id = l.cashier_id
            LEFT JOIN point_of_sales p ON p.id = l.pos_id
            LEFT JOIN sections sec ON sec.id = p.section_id
            {where}
            ORDER BY l.id DESC
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<ActivityRow>(new CommandDefinition(sql, p, cancellationToken: ct));
        return rows.Select(r => new CashierActivityDto(
            r.Id, r.CashierName, r.EventType, EventLabel(r.EventType), r.PosPath,
            r.CreatedAt, r.ReceiptId, r.ReceiptNum, r.Message)).ToList();
    }

    private static string EventLabel(string? type) => type switch
    {
        "receipt_create" => "إضافة إيصال",
        "receipt_edit" => "تعديل إيصال",
        "item_delete" => "حذف مادة من الإيصال",
        "receipt_void" => "إلغاء إيصال",
        _ => type ?? "حدث"
    };

    private sealed class ActivityRow
    {
        public long Id { get; set; }
        public string? CashierName { get; set; }
        public string EventType { get; set; } = "";
        public string? Message { get; set; }
        public string? PosPath { get; set; }
        public DateTime CreatedAt { get; set; }
        public long? ReceiptId { get; set; }
        public string? ReceiptNum { get; set; }
    }
}
