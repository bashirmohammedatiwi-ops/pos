using Dapper;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Services;

/// <summary>
/// Caches receipt table capabilities so checkout never probes sys.columns inside a transaction.
/// </summary>
public sealed class ReceiptSchemaService(ISqlConnectionFactory db)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _loaded;

    public bool LineAttribution { get; private set; }
    public bool ClientReceiptId { get; private set; }
    public bool ReturnOfReceiptId { get; private set; }
    public bool DiscountQrPerson { get; private set; }
    public bool ReceiptEdits { get; private set; }

    public async Task EnsureLoadedAsync(CancellationToken ct)
    {
        if (_loaded) return;
        await _gate.WaitAsync(ct);
        try
        {
            if (_loaded) return;
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            LineAttribution = await ColumnExistsAsync(conn, "reciept_items", "salesman_id", ct);
            ClientReceiptId = await ColumnExistsAsync(conn, "reciepts", "client_receipt_id", ct);
            ReturnOfReceiptId = await ColumnExistsAsync(conn, "reciepts", "return_of_receipt_id", ct);
            DiscountQrPerson = await ColumnExistsAsync(conn, "reciepts", "discount_qr_person_id", ct);
            ReceiptEdits = await TableExistsAsync(conn, "ext_receipt_edits", ct);
            _loaded = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public void DisableLineAttribution() => LineAttribution = false;

    private static async Task<bool> ColumnExistsAsync(
        System.Data.Common.DbConnection conn, string table, string column, CancellationToken ct)
    {
        var n = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID(@table) AND name = @column",
            new { table, column }, cancellationToken: ct));
        return n > 0;
    }

    private static async Task<bool> TableExistsAsync(
        System.Data.Common.DbConnection conn, string table, CancellationToken ct)
    {
        var n = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM sys.tables WHERE name = @table",
            new { table }, cancellationToken: ct));
        return n > 0;
    }
}
