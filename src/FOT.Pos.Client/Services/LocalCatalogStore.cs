using System.IO;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public sealed record PendingReceiptEntry(
    int Id,
    string Payload,
    Guid ClientReceiptId,
    int LocalNumber,
    int RetryCount,
    string? LastError);

public sealed record PendingReceiptEnqueueResult(int QueueId, Guid ClientReceiptId, int LocalNumber);

public sealed class LocalCatalogStore
{
    /// <summary>يُرفع عند تغيير منطق التسعير/العروض لإجبار مزامنة كاملة للكاشير.</summary>
    public const int CatalogSchemaVersion = 2;

    private readonly string _dbPath;
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public LocalCatalogStore()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FOT.Pos.Client");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "catalog.db");
        EnsureSchema();
    }

    public int ProductCount
    {
        get
        {
            using var conn = Open();
            return (int)(long)conn.ExecuteScalar("SELECT COUNT(*) FROM products")!;
        }
    }

    public long LastSyncedSeq
    {
        get => long.TryParse(GetMeta("last_seq"), out var v) ? v : 0;
        set => SetMeta("last_seq", value.ToString());
    }

    public int StoredCatalogSchemaVersion
    {
        get => int.TryParse(GetMeta("catalog_schema_version"), out var v) ? v : 0;
        set => SetMeta("catalog_schema_version", value.ToString());
    }

    public bool NeedsSchemaRefresh() => StoredCatalogSchemaVersion != CatalogSchemaVersion;

    public void MarkSchemaCurrent() => StoredCatalogSchemaVersion = CatalogSchemaVersion;

    public ProductDto? FindByBarcode(string code)
    {
        var trimmed = code.Trim();
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, seq, num, name, barcode, original_price, price, stock, discount_percent, offer_name
            FROM products WHERE barcode = @c OR num = @c LIMIT 1
            """;
        cmd.Parameters.AddWithValue("@c", trimmed);
        using var r = cmd.ExecuteReader();
        return r.Read() ? ReadProduct(r) : null;
    }

    public IReadOnlyList<ProductDto> Search(string term, int limit)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, seq, num, name, barcode, original_price, price, stock, discount_percent, offer_name
            FROM products WHERE name LIKE @s OR barcode LIKE @s OR num LIKE @s
            ORDER BY name LIMIT @lim
            """;
        cmd.Parameters.AddWithValue("@s", $"%{term.Trim()}%");
        cmd.Parameters.AddWithValue("@lim", limit);
        using var r = cmd.ExecuteReader();
        var list = new List<ProductDto>();
        while (r.Read()) list.Add(ReadProduct(r));
        return list;
    }

    public void UpsertProducts(IEnumerable<ProductDto> products)
    {
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO products (id, seq, num, name, barcode, original_price, price, stock, discount_percent, offer_name)
            VALUES (@id, @seq, @num, @name, @barcode, @op, @p, @stock, @dp, @offer)
            ON CONFLICT(id) DO UPDATE SET
                seq=@seq, num=@num, name=@name, barcode=@barcode,
                original_price=@op, price=@p, stock=@stock, discount_percent=@dp, offer_name=@offer
            """;
        var pId = cmd.Parameters.Add("@id", SqliteType.Integer);
        var pSeq = cmd.Parameters.Add("@seq", SqliteType.Integer);
        var pNum = cmd.Parameters.Add("@num", SqliteType.Text);
        var pName = cmd.Parameters.Add("@name", SqliteType.Text);
        var pBarcode = cmd.Parameters.Add("@barcode", SqliteType.Text);
        var pOp = cmd.Parameters.Add("@op", SqliteType.Real);
        var pPrice = cmd.Parameters.Add("@p", SqliteType.Real);
        var pStock = cmd.Parameters.Add("@stock", SqliteType.Real);
        var pDp = cmd.Parameters.Add("@dp", SqliteType.Integer);
        var pOffer = cmd.Parameters.Add("@offer", SqliteType.Text);

        foreach (var p in products)
        {
            pId.Value = p.Id;
            pSeq.Value = p.Seq;
            pNum.Value = p.Num ?? (object)DBNull.Value;
            pName.Value = p.Name ?? (object)DBNull.Value;
            pBarcode.Value = p.Barcode ?? (object)DBNull.Value;
            pOp.Value = (double)p.OriginalPrice;
            pPrice.Value = (double)p.Price;
            pStock.Value = (double)p.Stock;
            pDp.Value = p.DiscountPercent;
            pOffer.Value = p.OfferName ?? (object)DBNull.Value;
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public void ClearProducts()
    {
        using var conn = Open();
        conn.ExecuteNonQuery("DELETE FROM products");
        SetMeta("last_seq", "0");
        StoredCatalogSchemaVersion = 0;
    }

    /// <summary>
    /// Removes products the server no longer has. The sync feed carries inserts and updates only,
    /// so a material deleted in Edari would otherwise stay on this terminal forever.
    /// </summary>
    public int PruneProducts(IReadOnlyCollection<long> liveIds)
    {
        if (liveIds.Count == 0) return 0;
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        conn.ExecuteNonQuery("CREATE TEMP TABLE IF NOT EXISTS live_ids (id INTEGER PRIMARY KEY)", tx);
        conn.ExecuteNonQuery("DELETE FROM live_ids", tx);

        using (var insert = conn.CreateCommand())
        {
            insert.Transaction = tx;
            insert.CommandText = "INSERT OR IGNORE INTO live_ids (id) VALUES (@id)";
            var pId = insert.Parameters.Add("@id", SqliteType.Integer);
            foreach (var id in liveIds)
            {
                pId.Value = id;
                insert.ExecuteNonQuery();
            }
        }

        int removed;
        using (var delete = conn.CreateCommand())
        {
            delete.Transaction = tx;
            delete.CommandText = "DELETE FROM products WHERE id NOT IN (SELECT id FROM live_ids)";
            removed = delete.ExecuteNonQuery();
        }

        conn.ExecuteNonQuery("DELETE FROM live_ids", tx);
        tx.Commit();
        return removed;
    }

    public PendingReceiptEnqueueResult EnqueueReceipt(string payloadJson, Guid clientReceiptId)
    {
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        var localNumber = NextLocalReceiptNumber(conn, tx);
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO pending_receipts (payload_json, created_at, client_receipt_id, local_number)
            VALUES (@p, @d, @cid, @ln);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("@p", payloadJson);
        cmd.Parameters.AddWithValue("@d", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("@cid", clientReceiptId.ToString());
        cmd.Parameters.AddWithValue("@ln", localNumber);
        var id = (int)(long)cmd.ExecuteScalar()!;
        tx.Commit();
        return new PendingReceiptEnqueueResult(id, clientReceiptId, localNumber);
    }

    public IReadOnlyList<PendingReceiptEntry> GetPendingReceipts()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, payload_json, client_receipt_id, local_number, retry_count, last_error
            FROM pending_receipts WHERE synced = 0 ORDER BY id
            """;
        using var r = cmd.ExecuteReader();
        var list = new List<PendingReceiptEntry>();
        while (r.Read())
        {
            var clientId = Guid.TryParse(r.IsDBNull(2) ? null : r.GetString(2), out var g) ? g : Guid.Empty;
            list.Add(new PendingReceiptEntry(
                r.GetInt32(0),
                r.GetString(1),
                clientId,
                r.IsDBNull(3) ? 0 : r.GetInt32(3),
                r.IsDBNull(4) ? 0 : r.GetInt32(4),
                r.IsDBNull(5) ? null : r.GetString(5)));
        }
        return list;
    }

    public void MarkReceiptSynced(int id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE pending_receipts SET synced = 1 WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        cmd.ExecuteNonQuery();
    }

    public void RecordReceiptSyncError(int id, string error)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            UPDATE pending_receipts
            SET retry_count = COALESCE(retry_count, 0) + 1, last_error = @e
            WHERE id = @id
            """;
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@e", error.Length > 400 ? error[..400] : error);
        cmd.ExecuteNonQuery();
    }

    public int PendingReceiptCount
    {
        get
        {
            using var conn = Open();
            return (int)(long)conn.ExecuteScalar("SELECT COUNT(*) FROM pending_receipts WHERE synced = 0")!;
        }
    }

    public void ReplaceSalesmen(IEnumerable<SalesmanDto> salesmen)
    {
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        conn.ExecuteNonQuery("DELETE FROM salesmen", tx);
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO salesmen (id, name) VALUES (@id, @name)";
        foreach (var s in salesmen)
        {
            cmd.Parameters.Clear();
            cmd.Parameters.AddWithValue("@id", s.Id);
            cmd.Parameters.AddWithValue("@name", s.Name ?? "");
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public IReadOnlyList<SalesmanDto> GetSalesmen()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name FROM salesmen ORDER BY name";
        using var r = cmd.ExecuteReader();
        var list = new List<SalesmanDto>();
        while (r.Read()) list.Add(new SalesmanDto(r.GetInt64(0), r.GetString(1)));
        return list;
    }

    public void ReplaceCreditAccounts(IEnumerable<AccountSummaryDto> accounts)
    {
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        conn.ExecuteNonQuery("DELETE FROM credit_accounts", tx);
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO credit_accounts (id, num, name, balance) VALUES (@id, @num, @name, @bal)";
        foreach (var a in accounts)
        {
            cmd.Parameters.Clear();
            cmd.Parameters.AddWithValue("@id", a.Id);
            cmd.Parameters.AddWithValue("@num", a.Num ?? (object)DBNull.Value);
            cmd.Parameters.AddWithValue("@name", a.Name ?? "");
            cmd.Parameters.AddWithValue("@bal", (double)a.Balance);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public IReadOnlyList<AccountSummaryDto> GetCreditAccounts()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, num, name, balance FROM credit_accounts ORDER BY name";
        using var r = cmd.ExecuteReader();
        var list = new List<AccountSummaryDto>();
        while (r.Read())
            list.Add(new AccountSummaryDto(
                r.GetInt64(0),
                r.IsDBNull(1) ? null : r.GetString(1),
                r.IsDBNull(2) ? null : r.GetString(2),
                (decimal)r.GetDouble(3)));
        return list;
    }

    public void ReplaceAttributionArticles(IEnumerable<long> articleIds)
    {
        using var conn = Open();
        using var tx = conn.BeginTransaction();
        conn.ExecuteNonQuery("DELETE FROM attribution_articles", tx);
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO attribution_articles (article_id) VALUES (@id)";
        foreach (var id in articleIds.Where(i => i > 0).Distinct())
        {
            cmd.Parameters.Clear();
            cmd.Parameters.AddWithValue("@id", id);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public IReadOnlyList<long> GetAttributionArticles()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT article_id FROM attribution_articles";
        using var r = cmd.ExecuteReader();
        var list = new List<long>();
        while (r.Read()) list.Add(r.GetInt64(0));
        return list;
    }

    public void SavePrintSettings(PrintSettingsDto settings)
    {
        var json = JsonSerializer.Serialize(settings, Json);
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO print_settings (id, json, updated_at) VALUES (1, @j, @d)
            ON CONFLICT(id) DO UPDATE SET json = @j, updated_at = @d
            """;
        cmd.Parameters.AddWithValue("@j", json);
        cmd.Parameters.AddWithValue("@d", DateTime.UtcNow.ToString("O"));
        cmd.ExecuteNonQuery();
    }

    public PrintSettingsDto? LoadPrintSettings()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT json FROM print_settings WHERE id = 1";
        var json = cmd.ExecuteScalar() as string;
        if (string.IsNullOrWhiteSpace(json)) return null;
        return JsonSerializer.Deserialize<PrintSettingsDto>(json, Json);
    }

    private static int NextLocalReceiptNumber(SqliteConnection conn, SqliteTransaction tx)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO meta (key, value) VALUES ('offline_receipt_seq', '1')
            ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
            SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'offline_receipt_seq';
            """;
        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    private void EnsureSchema()
    {
        using var conn = Open();
        conn.ExecuteNonQuery("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                seq INTEGER NOT NULL,
                num TEXT,
                name TEXT,
                barcode TEXT,
                original_price REAL NOT NULL,
                price REAL NOT NULL,
                stock REAL NOT NULL,
                discount_percent INTEGER NOT NULL,
                offer_name TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
            CREATE INDEX IF NOT EXISTS idx_products_num ON products(num);
            CREATE TABLE IF NOT EXISTS pending_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS salesmen (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS credit_accounts (
                id INTEGER PRIMARY KEY,
                num TEXT,
                name TEXT,
                balance REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS attribution_articles (
                article_id INTEGER PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS print_settings (
                id INTEGER PRIMARY KEY,
                json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """);
        EnsureColumn(conn, "pending_receipts", "client_receipt_id", "TEXT");
        EnsureColumn(conn, "pending_receipts", "local_number", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(conn, "pending_receipts", "retry_count", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(conn, "pending_receipts", "last_error", "TEXT");
    }

    private static void EnsureColumn(SqliteConnection conn, string table, string column, string definition)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table})";
        using var r = cmd.ExecuteReader();
        while (r.Read())
            if (string.Equals(r.GetString(1), column, StringComparison.OrdinalIgnoreCase))
                return;
        conn.ExecuteNonQuery($"ALTER TABLE {table} ADD COLUMN {column} {definition}");
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        return conn;
    }

    private string? GetMeta(string key)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT value FROM meta WHERE key = @k";
        cmd.Parameters.AddWithValue("@k", key);
        return cmd.ExecuteScalar() as string;
    }

    private void SetMeta(string key, string value)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO meta (key, value) VALUES (@k, @v)
            ON CONFLICT(key) DO UPDATE SET value = @v
            """;
        cmd.Parameters.AddWithValue("@k", key);
        cmd.Parameters.AddWithValue("@v", value);
        cmd.ExecuteNonQuery();
    }

    private static ProductDto ReadProduct(SqliteDataReader r) => new(
        r.GetInt64(0), r.GetInt64(1),
        r.IsDBNull(2) ? null : r.GetString(2),
        r.IsDBNull(3) ? null : r.GetString(3),
        r.IsDBNull(4) ? null : r.GetString(4),
        (decimal)r.GetDouble(5), (decimal)r.GetDouble(6), (decimal)r.GetDouble(7),
        r.GetInt32(8), r.IsDBNull(9) ? null : r.GetString(9));
}

file static class SqliteConnExtensions
{
    public static void ExecuteNonQuery(this SqliteConnection conn, string sql, SqliteTransaction? tx = null)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        if (tx is not null) cmd.Transaction = tx;
        cmd.ExecuteNonQuery();
    }

    public static object? ExecuteScalar(this SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteScalar();
    }
}
