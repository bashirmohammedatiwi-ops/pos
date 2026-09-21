// استعادة مواد جرد TESTER المحذوفة صفرياً وإلحاقها بفاتورة المبيعات 24 على حساب 134.
using System.Data.Common;
using System.Globalization;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026";
const long InvoiceSeq = 194;
const long TargetFolderSeq = 92180;
const long AccountSeq = 170;
const string AccountNum = "134";
const string SkipBarcodeHint = "00079";

var mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "all";
var backupsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups"));
var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);

var apiDirs = new[]
{
    @"C:\Program Files\FOT POS Server\Api",
    @"C:\Program Files\FOT POS\Server\Api",
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Release", "net9.0")),
};
var baseDir = apiDirs.FirstOrDefault(d => File.Exists(Path.Combine(d, "NexusDB.ADOProvider.dll")))
    ?? throw new InvalidOperationException("تعذر العثور على NexusDB.ADOProvider.dll");

Environment.CurrentDirectory = baseDir;
var asm = Assembly.LoadFrom(Path.Combine(baseDir, "NexusDB.ADOProvider.dll"));
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider",
    asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = $"server=127.0.0.1;database={DatabaseAlias};port=16000;Native=true";
await conn.OpenAsync();
Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine($"متصل بالإداري: {DatabaseAlias}");

var missing = ReadMissing(desktop);
Console.WriteLine($"غير الموجود في المقارنة (بعد استبعاد لإ/00079): {missing.Count}  كمية={missing.Sum(x => x.Qty)}");
foreach (var m in missing)
    Console.WriteLine($"  {m.Barcode}  qty={m.Qty}");

var backupDirs = Directory.GetDirectories(backupsRoot, "edari-zero-stock-*")
    .Where(d => File.Exists(Path.Combine(d, "full-backup.json")))
    .OrderByDescending(d => new FileInfo(Path.Combine(d, "full-backup.json")).Length)
    .ToList();
if (backupDirs.Count == 0)
    throw new InvalidOperationException("لا توجد نسخة حذف صفري.");

var deletedSeqs = new HashSet<long>();
foreach (var dir in backupDirs)
{
    var log = Directory.GetFiles(dir, "delete-log-*.json").FirstOrDefault();
    if (log is null) continue;
    using var doc = JsonDocument.Parse(File.ReadAllText(log));
    if (!doc.RootElement.TryGetProperty("DeletedSeqs", out var arr)) continue;
    foreach (var x in arr.EnumerateArray())
        deletedSeqs.Add(x.GetInt64());
}
Console.WriteLine($"Seq محذوفة مسجّلة: {deletedSeqs.Count}");

var extraAll = new List<(long EdNum, string BarCode)>();
var hits = new Dictionary<string, Hit>(StringComparer.OrdinalIgnoreCase);
foreach (var dir in backupDirs)
{
    var json = Path.Combine(dir, "full-backup.json");
    Console.WriteLine($"بحث في {json}");
    var found = FindInBackup(json, missing.Select(x => x.Barcode).ToList());
    extraAll.AddRange(LoadBackupExtraBarcodes(json));
    foreach (var kv in found)
    {
        if (hits.ContainsKey(Norm(kv.Key))) continue;
        var seq = ToLong(kv.Value.GetValueOrDefault("Seq"));
        hits[Norm(kv.Key)] = new Hit(kv.Key, "حذف صفري 2026", dir, seq, kv.Value, deletedSeqs.Contains(seq));
        Console.WriteLine($"  ✓ {kv.Key} Seq={seq} deletedLog={deletedSeqs.Contains(seq)} SellPr4={GetNum(kv.Value, "SellPr4")} Name={GetStr(kv.Value, "Name1_Corrected") ?? GetStr(kv.Value, "Name1")}");
    }
}

var unresolved = missing.Where(m => FindHit(hits, m.Barcode) is null).ToList();
if (unresolved.Count > 0)
{
    Console.WriteLine($"غير موجودة في نسخة الحذف — بحث 2025: {unresolved.Count}");
    var from2025 = await FindInYearAsync(unresolved.Select(x => x.Barcode).ToList(), "2025");
    foreach (var kv in from2025)
    {
        var seq = ToLong(kv.Value.GetValueOrDefault("Seq"));
        var inLog = deletedSeqs.Contains(seq);
        hits[Norm(kv.Key)] = new Hit(kv.Key, inLog ? "قاعدة 2025 + سجل الحذف" : "قاعدة 2025 فقط", "2025", seq, kv.Value, inLog);
        Console.WriteLine($"  2025 {kv.Key} Seq={seq} deletedLog={inLog} SellPr4={GetNum(kv.Value, "SellPr4")}");
    }
}

Console.WriteLine();
Console.WriteLine("=== نتيجة التحقق ===");
var toRestore = new List<(Miss Line, Hit Hit)>();
foreach (var m in missing)
{
    var hit = FindHit(hits, m.Barcode);
    if (hit is null)
    {
        Console.WriteLine($"  لا بطاقة: {m.Barcode} qty={m.Qty} — لن تُختلق");
        continue;
    }
    var ok = hit.InDeleteLog || hit.Source.Contains("حذف صفري", StringComparison.Ordinal);
    Console.WriteLine($"  {(ok ? "محذوفة مسبقاً" : "ليست من سجل الحذف")}: {m.Barcode} ← {hit.Origin} Seq={hit.Seq} {hit.Source}");
    if (ok) toRestore.Add((m, hit));
}

if (mode == "lookup")
{
    Console.WriteLine($"جاهزة للاستعادة: {toRestore.Count}");
    return;
}

if (toRestore.Count == 0)
{
    Console.WriteLine("لا مواد مؤكدة من الحذف السابق.");
    return;
}

var cols13 = await GetColumnNamesAsync(conn, "File13n");
var restored = new List<Restored>();
var outDir = Path.Combine(backupsRoot, $"edari-tester-restore-{DateTime.Now:yyyyMMdd-HHmmss}");
Directory.CreateDirectory(outDir);

foreach (var (line, hit) in toRestore)
{
    var row = new Dictionary<string, object?>(hit.Row, StringComparer.OrdinalIgnoreCase);
    var oldSeq = hit.Seq;
    var live = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Seq = {oldSeq}");
    long seq;
    if (live > 0)
    {
        seq = oldSeq;
        Console.WriteLine($"  {line.Barcode}: Seq={seq} موجودة الآن — عائدية وباركود فقط.");
    }
    else
    {
        seq = oldSeq;
        if (seq <= 0)
            seq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;
        row["Seq"] = seq;
        row["Father"] = TargetFolderSeq;
        row["Sub"] = null;
        row["SubCount"] = 0;
        row["CurTot1"] = 0d;
        if (!string.IsNullOrWhiteSpace(GetStr(row, "Name1_Corrected")))
            row["Name1"] = GetStr(row, "Name1_Corrected");
        if (row.ContainsKey("Barcode") && string.IsNullOrWhiteSpace(GetStr(row, "Barcode")))
            row["Barcode"] = line.Barcode;
        if (row.ContainsKey("Num") && string.IsNullOrWhiteSpace(GetStr(row, "Num")))
            row["Num"] = line.Barcode;

        var insertCols = cols13.Where(c =>
            !c.Equals("Sub", StringComparison.OrdinalIgnoreCase) &&
            row.ContainsKey(c) &&
            !c.Equals("Name1_Corrected", StringComparison.OrdinalIgnoreCase)).ToList();
        var insert = insertCols.ToDictionary(c => c, c => Coerce(row.GetValueOrDefault(c)), StringComparer.OrdinalIgnoreCase);
        await using var ins = conn.CreateCommand();
        ins.CommandText = BuildInsertSql(insert, "File13n");
        ins.CommandTimeout = 60;
        await ins.ExecuteNonQueryAsync();
        Console.WriteLine($"  ✓ أُعيدت {line.Barcode} Seq={seq} من {hit.Source}");
    }

    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"UPDATE File13n SET Father = {TargetFolderSeq} WHERE Seq = {seq}";
        await upd.ExecuteNonQueryAsync();
    }

    var cardBc = GetStr(row, "Barcode") ?? line.Barcode;
    await EnsureBarcodeAsync(conn, seq, cardBc);
    if (!string.Equals(cardBc, line.Barcode, StringComparison.OrdinalIgnoreCase))
        await EnsureBarcodeAsync(conn, seq, line.Barcode);
    foreach (var extra in extraAll.Where(x => x.EdNum == oldSeq || string.Equals(Norm(x.BarCode), Norm(line.Barcode), StringComparison.OrdinalIgnoreCase)))
        await EnsureBarcodeAsync(conn, seq, extra.BarCode);

    restored.Add(new Restored(
        line.Barcode, line.Qty, seq, oldSeq, hit.Source,
        GetNum(row, "SellPr4") ?? 0, GetNum(row, "Last") ?? 0, GetNum(row, "CurAvrg") ?? 0,
        GetStr(row, "Name1_Corrected") ?? GetStr(row, "Name1") ?? ""));
}

var unique = restored.GroupBy(x => x.Seq).Select(g => g.First()).ToList();
await RewriteSubAsync(conn, TargetFolderSeq, refs =>
{
    foreach (var r in unique)
        if (!refs.Contains(r.Seq)) refs.Add(r.Seq);
    return refs;
});
Console.WriteLine($"فهرس 011014 حُدِّث. بطاقات: {unique.Count}");

var headerCols = await GetColumnNamesAsync(conn, "File15n");
var header = await ReadRowAsync(conn, "File15n", InvoiceSeq, headerCols);
if (header.Count == 0)
    throw new InvalidOperationException($"الفاتورة Seq={InvoiceSeq} غير موجودة");
var cols14 = await GetColumnNamesAsync(conn, "File14n");
var tplSeq = await ScalarLongAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {InvoiceSeq} ORDER BY Seq");
var lineTpl = await ReadRowAsync(conn, "File14n", tplSeq, cols14);
var saleAcc = ToLong(header.GetValueOrDefault("DKindRecNo"));
var nextLineSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
var now = DateTime.Now;
var billDate = header.GetValueOrDefault("Date") as DateTime? ?? DateTime.Today;
var billNum = ToLong(header.GetValueOrDefault("Num"));
var two = ToLong(header.GetValueOrDefault("Two"));
if (two <= 0) two = AccountSeq;

var addedAmt = 0d;
var addedLines = 0;
var grouped = restored
    .GroupBy(x => x.Seq)
    .Select(g => (g.First(), Qty: g.Sum(x => x.Qty)))
    .ToList();

foreach (var (prod, qty) in grouped)
{
    var exists = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {InvoiceSeq} AND Mat = {prod.Seq}");
    if (exists > 0)
    {
        Console.WriteLine($"  الفاتورة فيها Seq={prod.Seq} — تخطّي");
        continue;
    }

    var price = prod.SellPr4;
    var lineRow = new Dictionary<string, object?>(lineTpl, StringComparer.OrdinalIgnoreCase);
    lineRow["Seq"] = nextLineSeq;
    lineRow["BillSeq"] = InvoiceSeq;
    lineRow["Date"] = billDate;
    lineRow["Quant"] = qty;
    lineRow["Price"] = price;
    lineRow["Two"] = two;
    lineRow["Kind"] = 4;
    lineRow["Mat"] = prod.Seq;
    lineRow["BillNo"] = billNum;
    lineRow["Frst"] = saleAcc;
    lineRow["MatName"] = "";
    lineRow["OCurAvrg"] = prod.CurAvrg > 0 ? prod.CurAvrg : prod.Last;
    lineRow["OCCAvrg"] = prod.CurAvrg > 0 ? prod.CurAvrg : prod.Last;
    lineRow["OCurTot"] = 0d;
    if (lineRow.ContainsKey("DtCreated")) lineRow["DtCreated"] = now;
    if (lineRow.ContainsKey("DtModified")) lineRow["DtModified"] = now;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(lineRow, "File14n");
        await cmd.ExecuteNonQueryAsync();
    }

    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"""
            UPDATE File13n SET
                CurTot1 = CurTot1 - {Inv(qty)},
                OutTot = OutTot + {Inv(qty)}
            WHERE Seq = {prod.Seq}
            """;
        try { await upd.ExecuteNonQueryAsync(); }
        catch
        {
            upd.CommandText = $"UPDATE File13n SET CurTot1 = CurTot1 - {Inv(qty)} WHERE Seq = {prod.Seq}";
            await upd.ExecuteNonQueryAsync();
        }
    }

    addedAmt += qty * price;
    addedLines++;
    nextLineSeq++;
    Console.WriteLine($"  ✓ فاتورة {billNum}: Mat={prod.Seq} {prod.Barcode} qty={qty} price={price:N0} {prod.Name}");
}

var newCount = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {InvoiceSeq}");
var newTotal = ToDouble(header.GetValueOrDefault("Total")) + addedAmt;
await using (var upd = conn.CreateCommand())
{
    upd.CommandText = $"UPDATE File15n SET Total = {Inv(newTotal)}, \"count\" = {newCount} WHERE Seq = {InvoiceSeq}";
    await upd.ExecuteNonQueryAsync();
    upd.CommandText = $"UPDATE File12n SET Am = {Inv(newTotal)} WHERE BillSeq = {InvoiceSeq}";
    await upd.ExecuteNonQueryAsync();
}
try
{
    await using var acc = conn.CreateCommand();
    acc.CommandText = $"UPDATE File11n SET Tot1 = Tot1 + {Inv(addedAmt)} WHERE Seq = {AccountSeq}";
    await acc.ExecuteNonQueryAsync();
}
catch (Exception ex)
{
    Console.WriteLine($"تنبيه رصيد الحساب: {ex.Message}");
}

await TryResetAutoIncAsync("File14n", nextLineSeq);
await TryResetAutoIncAsync("File13n", await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1);

File.WriteAllText(Path.Combine(outDir, "restore-log.json"),
    JsonSerializer.Serialize(new
    {
        InvoiceSeq,
        BillNum = billNum,
        AddedLines = addedLines,
        AddedAmount = addedAmt,
        NewCount = newCount,
        NewTotal = newTotal,
        Restored = restored
    }, new JsonSerializerOptions { WriteIndented = true }),
    new UTF8Encoding(true));

Console.WriteLine();
Console.WriteLine($"=== تم === أُضيف {addedLines} سطر | أسطر الفاتورة={newCount} | الإجمالي={newTotal:N2} | حساب {AccountNum}");

static List<Miss> ReadMissing(string desktop)
{
    var file = Directory.GetFiles(desktop, "*.xlsx")
        .Select(p => new FileInfo(p))
        .Where(f => f.Name.Contains("مقارنة", StringComparison.OrdinalIgnoreCase)
                    && f.Name.Contains("TESTER", StringComparison.OrdinalIgnoreCase))
        .OrderByDescending(f => f.LastWriteTime)
        .FirstOrDefault()
        ?? throw new InvalidOperationException("ملف المقارنة غير موجود.");
    var copy = Path.Combine(Path.GetTempPath(), "tester-compare-copy.xlsx");
    using (var src = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
    using (var dst = new FileStream(copy, FileMode.Create, FileAccess.Write))
        src.CopyTo(dst);
    using var wb = new XLWorkbook(copy);
    var ws = wb.Worksheets.First(s => s.Name.Contains("غير موجود", StringComparison.Ordinal));
    var last = ws.LastRowUsed()?.RowNumber() ?? 1;
    var list = new List<Miss>();
    for (var r = 2; r <= last; r++)
    {
        var bc = (ws.Cell(r, 2).GetFormattedString() ?? "").Trim();
        if (string.IsNullOrWhiteSpace(bc)) continue;
        if (bc.Contains(SkipBarcodeHint, StringComparison.Ordinal) || bc.Contains("لإ/", StringComparison.Ordinal))
            continue;
        var qty = ws.Cell(r, 5).DataType == XLDataType.Number
            ? ws.Cell(r, 5).GetDouble()
            : double.TryParse(ws.Cell(r, 5).GetFormattedString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var q) ? q : 0;
        list.Add(new Miss(bc, qty));
    }
    return list;
}

static Hit? FindHit(Dictionary<string, Hit> hits, string barcode)
{
    if (hits.TryGetValue(Norm(barcode), out var h)) return h;
    foreach (var key in KeysOf(barcode))
        if (hits.TryGetValue(key, out h)) return h;
    return hits.Values.FirstOrDefault(x => KeysOf(x.Barcode).Overlaps(KeysOf(barcode)));
}

static Dictionary<string, Dictionary<string, object?>> FindInBackup(string path, List<string> barcodes)
{
    var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var bc in barcodes)
        foreach (var k in KeysOf(bc))
            wanted.Add(k);

    using var doc = JsonDocument.Parse(File.ReadAllText(path));
    var extraBySeq = new Dictionary<long, List<string>>();
    if (doc.RootElement.TryGetProperty("ExtraBarcodes", out var extras))
    {
        foreach (var e in extras.EnumerateArray())
        {
            var bc = e.TryGetProperty("BarCode", out var b) ? b.GetString() : null;
            if (string.IsNullOrWhiteSpace(bc)) continue;
            var seq = e.GetProperty("EdNum").GetInt64();
            if (!extraBySeq.TryGetValue(seq, out var list)) extraBySeq[seq] = list = [];
            list.Add(bc);
        }
    }

    var found = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
    JsonElement products;
    if (doc.RootElement.TryGetProperty("Products", out var p1)) products = p1;
    else if (doc.RootElement.TryGetProperty("products", out var p2)) products = p2;
    else return found;

    foreach (var p in products.EnumerateArray())
    {
        var dict = JsonToRow(p);
        var seq = ToLong(dict.GetValueOrDefault("Seq"));
        var keys = new List<string?>
        {
            GetStr(dict, "Barcode"), GetStr(dict, "Num"), GetStr(dict, "Extra8")
        };
        if (extraBySeq.TryGetValue(seq, out var extra))
            keys.AddRange(extra);

        foreach (var raw in keys.Where(s => !string.IsNullOrWhiteSpace(s)))
        {
            foreach (var k in KeysOf(raw!))
            {
                if (!wanted.Contains(k)) continue;
                var origin = barcodes.First(b => KeysOf(b).Contains(k));
                if (!found.ContainsKey(origin))
                    found[origin] = dict;
            }
        }
    }
    return found;
}

static List<(long EdNum, string BarCode)> LoadBackupExtraBarcodes(string path)
{
    var list = new List<(long, string)>();
    try
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        if (!doc.RootElement.TryGetProperty("ExtraBarcodes", out var extras)) return list;
        foreach (var e in extras.EnumerateArray())
        {
            var bc = e.TryGetProperty("BarCode", out var b) ? b.GetString() : null;
            if (!string.IsNullOrWhiteSpace(bc))
                list.Add((e.GetProperty("EdNum").GetInt64(), bc));
        }
    }
    catch { /* optional */ }
    return list;
}

static async Task<Dictionary<string, Dictionary<string, object?>>> FindInYearAsync(List<string> barcodes, string alias)
{
    var map = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
    try
    {
        await using var year = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
        year.ConnectionString = $"server=127.0.0.1;database={alias};port=16000;Native=true";
        await year.OpenAsync();
        var cols = await GetColumnNamesAsync(year, "File13n");
        foreach (var bc in barcodes)
        {
            long seq = 0;
            foreach (var key in KeysOf(bc))
            {
                await using var cmd = year.CreateCommand();
                cmd.CommandText = $"""
                    SELECT TOP 1 Seq FROM File13n
                    WHERE Barcode = '{Esc(key)}' OR Num = '{Esc(key)}' OR Extra8 = '{Esc(key)}'
                    """;
                seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
                if (seq > 0) break;
            }
            if (seq <= 0 && Digits(bc).Length >= 8)
            {
                var digits = Digits(bc);
                await using var cmd = year.CreateCommand();
                cmd.CommandText = $"SELECT TOP 1 EdNum FROM File13BC WHERE BarCode = '{Esc(bc)}' OR BarCode = '{Esc(digits)}'";
                seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
            }
            if (seq <= 0) continue;
            var row = await ReadRowAsync(year, "File13n", seq, cols);
            if (row.Count > 0) map[bc] = row;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه بحث {alias}: {ex.Message}");
    }
    return map;
}

static HashSet<string> KeysOf(string raw)
{
    var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    if (string.IsNullOrWhiteSpace(raw)) return set;
    var t = raw.Trim();
    set.Add(t);
    var digits = Digits(t);
    if (digits.Length >= 8)
    {
        set.Add(digits);
        if (digits.Length == 12) set.Add("0" + digits);
        if (digits.Length == 13 && digits.StartsWith('0')) set.Add(digits[1..]);
        var stripped = digits.TrimStart('0');
        if (stripped.Length >= 8) set.Add(stripped);
    }
    else if (digits.Length >= 3)
        set.Add(digits);
    return set;
}

static string Digits(string s) => new(s.Where(char.IsDigit).ToArray());
static string Norm(string s) => s.Trim();

static Dictionary<string, object?> JsonToRow(JsonElement p)
{
    var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    foreach (var prop in p.EnumerateObject())
    {
        object? v = prop.Value.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.String => prop.Value.GetString(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when prop.Value.TryGetInt64(out var l) => l,
            JsonValueKind.Number => prop.Value.GetDouble(),
            _ => null
        };
        dict[prop.Name] = v;
    }
    return dict;
}

static object? Coerce(object? v)
{
    if (v is string s && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt)
        && s.Contains('T', StringComparison.Ordinal))
        return dt;
    return v;
}

static async Task EnsureBarcodeAsync(DbConnection conn, long seq, string barcode)
{
    barcode = barcode.Trim();
    if (string.IsNullOrWhiteSpace(barcode)) return;
    var exists = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13BC WHERE BarCode = '{Esc(barcode)}'");
    if (exists > 0)
    {
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File13BC SET EdNum = {seq} WHERE BarCode = '{Esc(barcode)}'";
        await upd.ExecuteNonQueryAsync();
        return;
    }
    try
    {
        await using var ins = conn.CreateCommand();
        ins.CommandText = $"INSERT INTO File13BC (EdNum, BarCode, Qty, NoDscnt) VALUES ({seq}, '{Esc(barcode)}', 1, False)";
        await ins.ExecuteNonQueryAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  تنبيه باركود {barcode}: {ex.Message.Split('\n')[0]}");
    }
}

static async Task RewriteSubAsync(DbConnection conn, long folderSeq, Func<List<long>, List<long>> keep)
{
    await using var read = conn.CreateCommand();
    read.CommandText = $"SELECT Sub FROM File13n WHERE Seq = {folderSeq}";
    var subObj = await read.ExecuteScalarAsync();
    var subBytes = subObj is byte[] b ? b : [];
    var refs = new List<long>();
    for (var i = 0; i < subBytes.Length - subBytes.Length % 4; i += 4)
        refs.Add(BitConverter.ToInt32(subBytes, i));
    refs = keep(refs);
    var newBytes = new byte[refs.Count * 4];
    for (var i = 0; i < refs.Count; i++)
        BitConverter.GetBytes((int)refs[i]).CopyTo(newBytes, i * 4);
    await using var upd = conn.CreateCommand();
    upd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {refs.Count} WHERE Seq = {folderSeq}";
    var p = upd.CreateParameter();
    p.ParameterName = "SubVal";
    p.Value = newBytes;
    upd.Parameters.Add(p);
    await upd.ExecuteNonQueryAsync();
}

static async Task TryResetAutoIncAsync(string table, long target)
{
    try
    {
        var port = 10088;
        var path = @"C:\ProgramData\NexusDB4\nxServer\D%3A%5CFuture%20of%20Technology%5CEdariNX%5Cnx4.7505%5C\nxServer.remoteadmin";
        if (File.Exists(path))
        {
            foreach (var line in File.ReadAllLines(path))
            {
                if (!line.StartsWith("CurrentAdminPort=", StringComparison.OrdinalIgnoreCase)) continue;
                if (int.TryParse(line["CurrentAdminPort=".Length..].Trim(), out var p) && p > 0) port = p;
            }
        }
        var url = $"http://127.0.0.1:{port}/edari-account-maint.nxscript?alias=2026&key=shorja-maintenance&table={table}&autoinc={target}";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var body = await http.GetStringAsync(url);
        Console.WriteLine($"  autoinc {table} → {target}: {body.Trim()}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  تنبيه autoinc {table}: {ex.Message}");
    }
}

static async Task<List<string>> GetColumnNamesAsync(DbConnection conn, string table)
{
    var list = new List<string>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT TOP 0 * FROM {table}";
    await using var r = await cmd.ExecuteReaderAsync();
    for (var i = 0; i < r.FieldCount; i++) list.Add(r.GetName(i));
    return list;
}

static async Task<Dictionary<string, object?>> ReadRowAsync(DbConnection conn, string table, long seq, List<string> columns)
{
    var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT * FROM {table} WHERE Seq = {seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return dict;
    foreach (var col in columns)
    {
        var ord = r.GetOrdinal(col);
        if (r.IsDBNull(ord)) { dict[col] = null; continue; }
        var val = r.GetValue(ord);
        if (val is byte[]) continue;
        dict[col] = val;
    }
    return dict;
}

static string BuildInsertSql(Dictionary<string, object?> template, string table)
{
    var colList = string.Join(", ", template.Keys.Select(n => $"\"{n.Replace("\"", "\"\"")}\""));
    var valList = string.Join(", ", template.Values.Select(FormatValue));
    return $"INSERT INTO {table} ({colList}) VALUES ({valList})";
}

static string FormatValue(object? v) => v switch
{
    null => "NULL",
    string s => $"'{s.Replace("'", "''")}'",
    bool b => b ? "1" : "0",
    byte or sbyte or short or ushort or int or uint or long or ulong => Convert.ToString(v, CultureInfo.InvariantCulture)!,
    float or double or decimal => Convert.ToString(v, CultureInfo.InvariantCulture)!,
    DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
    _ => $"'{v}'"
};

static async Task<long> ScalarLongAsync(DbConnection conn, string sql)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    return ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
}

static long ToLong(object? v) => v switch
{
    null or DBNull => 0,
    long l => l,
    int i => i,
    short s => s,
    decimal dec => (long)dec,
    double d => (long)d,
    float f => (long)f,
    string str when long.TryParse(str, NumberStyles.Any, CultureInfo.InvariantCulture, out var p) => p,
    JsonElement je when je.ValueKind == JsonValueKind.Number && je.TryGetInt64(out var l) => l,
    _ => Convert.ToInt64(v, CultureInfo.InvariantCulture)
};

static double ToDouble(object? v) => v switch
{
    null or DBNull => 0,
    double d => d,
    float f => f,
    decimal dec => (double)dec,
    long l => l,
    int i => i,
    string str when double.TryParse(str, NumberStyles.Any, CultureInfo.InvariantCulture, out var p) => p,
    _ => Convert.ToDouble(v, CultureInfo.InvariantCulture)
};

static double? GetNum(Dictionary<string, object?>? row, string col)
    => row is not null && row.TryGetValue(col, out var v) && v is not null ? ToDouble(v) : null;
static string? GetStr(Dictionary<string, object?>? row, string col)
    => row is not null && row.TryGetValue(col, out var v) && v is not null ? v.ToString()?.Trim() : null;
static string Esc(string s) => s.Replace("'", "''");
static string Inv(double v) => v.ToString(CultureInfo.InvariantCulture);

sealed record Miss(string Barcode, double Qty);
sealed record Hit(string Barcode, string Source, string Origin, long Seq, Dictionary<string, object?> Row, bool InDeleteLog);
sealed record Restored(string Barcode, double Qty, long Seq, long OldSeq, string Source, double SellPr4, double Last, double CurAvrg, string Name);
