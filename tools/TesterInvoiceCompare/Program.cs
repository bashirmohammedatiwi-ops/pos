// مقارنة TESTER_2026-09-17.xlsx مع فاتورة المبيعات 24 في الإداري.
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
Console.OutputEncoding = Encoding.UTF8;

const string DatabaseAlias = "2026";
const long InvoiceSeq = 194;
const long ExpectedBillNum = 24;
const string ExpectedAccountNum = "134";
const string ExpectedTreeNum = "011014";
const long ExpectedTreeSeq = 92180;

var excelPath = args.Length > 0
    ? args[0]
    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "TESTER_2026-09-17.xlsx");
if (!File.Exists(excelPath))
    throw new InvalidOperationException($"الملف غير موجود: {excelPath}");

var inventory = ReadInventory(excelPath);
Console.WriteLine($"ملف الجرد: {excelPath}");
Console.WriteLine($"أصناف الجرد: {inventory.Count}   القطع: {inventory.Sum(x => x.Qty)}");

var apiDirs = new[]
{
    @"C:\Program Files\FOT POS Server\Api",
    @"C:\Program Files\FOT POS\Server\Api",
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Release", "net9.0")),
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Debug", "net9.0")),
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
Console.WriteLine($"متصل بالإداري: {DatabaseAlias}");

var names = await LoadPosNamesAsync();
var header = await ReadInvoiceHeaderAsync(conn);
var lines = await ReadInvoiceLinesAsync(conn);
var articles = await LoadArticlesAsync(conn, names);
var extra = await LoadExtraBarcodesAsync(conn);
var account = await ReadAccountAsync(conn, ToLong(header.GetValueOrDefault("Two")));
var tree = await ReadTreeAsync(conn, ExpectedTreeSeq, names);

var index = BuildIndex(articles, extra);
var invoiceByMat = lines.GroupBy(l => l.Mat).ToDictionary(g => g.Key, g => g.ToList());

var results = new List<CompareRow>();
var usedMats = new HashSet<long>();
foreach (var item in inventory)
{
    var hit = FindArticle(item.Barcode, index);
    if (hit is null)
    {
        results.Add(new CompareRow(item, "غير موجود في بطاقة الإداري", null, null, 0, 0, 0, false, false, null));
        continue;
    }
    usedMats.Add(hit.Seq);
    invoiceByMat.TryGetValue(hit.Seq, out var invLines);
    var invQty = invLines?.Sum(x => x.Qty) ?? 0;
    var invPrice = invLines?.FirstOrDefault()?.Price ?? 0;
    var onInvoice = invQty > 0;
    var qtyOk = Math.Abs(invQty - item.Qty) < 0.0001;
    var fatherOk = hit.Father == ExpectedTreeSeq;
    var status = !onInvoice
        ? "في الإداري لكن ليس في الفاتورة"
        : !qtyOk
            ? "كمية الفاتورة تختلف"
            : !fatherOk
                ? "في الفاتورة — العائدية ليست 011014"
                : "مطابق";
    results.Add(new CompareRow(item, status, hit, invLines, invQty, invPrice, hit.SellPr4, onInvoice, fatherOk, qtyOk ? null : $"جرد {item.Qty} ≠ فاتورة {invQty}"));
}

var extraOnInvoice = lines
    .Where(l => !usedMats.Contains(l.Mat))
    .GroupBy(l => l.Mat)
    .Select(g =>
    {
        articles.TryGetValue(g.Key, out var art);
        return new ExtraLine(g.Key, art?.Barcode, art?.Name, g.Sum(x => x.Qty), g.First().Price, art?.Father == ExpectedTreeSeq);
    })
    .ToList();

var missingCard = results.Where(r => r.Hit is null).ToList();
var missingInvoice = results.Where(r => r.Hit is not null && !r.OnInvoice).ToList();
var qtyMismatch = results.Where(r => r.OnInvoice && r.Note is not null).ToList();
var wrongTree = results.Where(r => r.OnInvoice && r.Hit is not null && !r.InTree).ToList();
var matched = results.Where(r => r.Status == "مطابق").ToList();

var billNum = ToLong(header.GetValueOrDefault("Num"));
var kind = ToLong(header.GetValueOrDefault("Kind"));
var two = ToLong(header.GetValueOrDefault("Two"));
var total = ToDouble(header.GetValueOrDefault("Total"));
var count = ToLong(header.GetValueOrDefault("count"));
var remarks = header.GetValueOrDefault("remarks")?.ToString() ?? "";
var saleAcc = ToLong(header.GetValueOrDefault("DKindRecNo"));
var lineTotal = lines.Sum(x => x.Qty * x.Price);
var invQtySum = lines.Sum(x => x.Qty);
var excelQty = inventory.Sum(x => x.Qty);
var excelOnInvoiceQty = results.Where(r => r.OnInvoice).Sum(r => r.Item.Qty);

var settings = new List<Check>(
[
    new("رقم الفاتورة", billNum == ExpectedBillNum, $"{billNum}", $"{ExpectedBillNum}"),
    new("Seq الفاتورة", InvoiceSeq == 194, $"{InvoiceSeq}", "194"),
    new("نوع الفاتورة Kind", kind == 4, $"{kind}", "4 = مبيعات"),
    new("حساب العميل Two", account.Num == ExpectedAccountNum, $"{account.Num} {account.Name} Seq={account.Seq}", ExpectedAccountNum),
    new("شجرة TESTER", tree.Num == ExpectedTreeNum && tree.Seq == ExpectedTreeSeq, $"{tree.Num} {tree.Name} Seq={tree.Seq} أبناء={tree.ChildCount}", $"{ExpectedTreeNum} Seq={ExpectedTreeSeq}"),
    new("عدد أسطر الفاتورة", lines.Count == count || count == 0, $"{lines.Count} حي / count={count}", "يطابق count"),
    new("إجمالي الفاتورة", Math.Abs(total - lineTotal) < 1, $"رأس={total:N0}  أسطر={lineTotal:N0}", "رأس = مجموع الأسطر"),
    new("حساب المبيعات DKindRecNo", saleAcc > 0, $"{saleAcc}", "> 0"),
]);

Console.WriteLine();
Console.WriteLine("=== الفاتورة ===");
Console.WriteLine($"Num={billNum} Seq={InvoiceSeq} Kind={kind} Two={account.Num} {account.Name}");
Console.WriteLine($"أسطر={lines.Count}  count={count}  إجمالي الرأس={total:N0}  مجموع الأسطر={lineTotal:N0}");
Console.WriteLine($"البيان: {remarks}");
Console.WriteLine($"الشجرة: {tree.Num} {tree.Name} أبناء={tree.ChildCount}");
Console.WriteLine();
Console.WriteLine("=== الإعدادات ===");
foreach (var s in settings)
    Console.WriteLine($"{(s.Ok ? "OK" : "!!")}  {s.Title}: {s.Actual}  (المتوقع {s.Expected})");

Console.WriteLine();
Console.WriteLine("=== المطابقة مع الجرد ===");
Console.WriteLine($"جرد: {inventory.Count} صنف / {excelQty} قطعة");
Console.WriteLine($"مطابق تماماً: {matched.Count}");
Console.WriteLine($"في الإداري وليس في الفاتورة: {missingInvoice.Count} / قطع {missingInvoice.Sum(x => x.Item.Qty)}");
Console.WriteLine($"بلا بطاقة في الإداري: {missingCard.Count} / قطع {missingCard.Sum(x => x.Item.Qty)}");
Console.WriteLine($"اختلاف كمية: {qtyMismatch.Count}");
Console.WriteLine($"في الفاتورة وعائدية خاطئة: {wrongTree.Count}");
Console.WriteLine($"أسطر فاتورة بلا مقابل في الجرد: {extraOnInvoice.Count} / قطع {extraOnInvoice.Sum(x => x.Qty)}");
Console.WriteLine($"قطع الجرد الموجودة في الفاتورة: {excelOnInvoiceQty} من {excelQty}");

Console.WriteLine();
Console.WriteLine("=== غير موجود في الفاتورة (من ملف الجرد) ===");
foreach (var r in missingCard.Concat(missingInvoice))
{
    var name = r.Hit?.Name ?? r.Item.Name;
    var seq = r.Hit is null ? "" : $" Seq={r.Hit.Seq}";
    Console.WriteLine($"{r.Item.Barcode}\tqty={r.Item.Qty}\t{r.Status}{seq}\t{name}");
}

if (qtyMismatch.Count > 0)
{
    Console.WriteLine();
    Console.WriteLine("=== اختلاف الكمية ===");
    foreach (var r in qtyMismatch)
        Console.WriteLine($"{r.Item.Barcode}\tجرد={r.Item.Qty}\tفاتورة={r.InvoiceQty}\tSeq={r.Hit!.Seq}\t{r.Hit.Name}");
}

if (wrongTree.Count > 0)
{
    Console.WriteLine();
    Console.WriteLine("=== عائدية ليست 011014 ===");
    foreach (var r in wrongTree)
        Console.WriteLine($"{r.Item.Barcode}\tFather={r.Hit!.Father}\tSeq={r.Hit.Seq}\t{r.Hit.Name}");
}

var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
var outPath = Path.Combine(desktop, "مقارنة_TESTER_مع_فاتورة_24.xlsx");
WriteReport(outPath, Path.GetFileName(excelPath), header, account, tree, settings, results, extraOnInvoice, lines, total, lineTotal);
Console.WriteLine();
Console.WriteLine($"التقرير: {outPath}");

var jsonPath = Path.Combine(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups")),
    $"tester-invoice-compare-{DateTime.Now:yyyyMMdd-HHmmss}.json");
Directory.CreateDirectory(Path.GetDirectoryName(jsonPath)!);
File.WriteAllText(jsonPath, JsonSerializer.Serialize(new
{
    Excel = Path.GetFileName(excelPath),
    Invoice = new { Seq = InvoiceSeq, Num = billNum, Kind = kind, Account = account, Tree = tree, Remarks = remarks, HeaderTotal = total, LineTotal = lineTotal, LineCount = lines.Count, CountField = count, SaleAcc = saleAcc },
    Settings = settings,
    Counts = new
    {
        Inventory = inventory.Count,
        ExcelQty = excelQty,
        Matched = matched.Count,
        MissingCard = missingCard.Count,
        MissingInvoice = missingInvoice.Count,
        QtyMismatch = qtyMismatch.Count,
        WrongTree = wrongTree.Count,
        ExtraOnInvoice = extraOnInvoice.Count,
        InvoiceQty = invQtySum,
        ExcelOnInvoiceQty = excelOnInvoiceQty
    },
    Missing = missingCard.Concat(missingInvoice).Select(r => new
    {
        r.Item.Barcode, r.Item.Name, r.Item.Brand, r.Item.Qty, r.Status,
        Seq = r.Hit?.Seq, EdariName = r.Hit?.Name, Father = r.Hit?.Father, Price = r.Hit?.SellPr4
    }),
    QtyMismatch = qtyMismatch.Select(r => new { r.Item.Barcode, ExcelQty = r.Item.Qty, r.InvoiceQty, Seq = r.Hit!.Seq, r.Hit.Name }),
    WrongTree = wrongTree.Select(r => new { r.Item.Barcode, r.Hit!.Seq, r.Hit.Father, r.Hit.Name }),
    ExtraOnInvoice = extraOnInvoice
}, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
Console.WriteLine($"JSON: {jsonPath}");

static List<InvItem> ReadInventory(string path)
{
    using var wb = new XLWorkbook(path);
    Console.WriteLine("أوراق الملف: " + string.Join(" | ", wb.Worksheets.Select(s => s.Name)));
    IXLWorksheet? ws = null;
    foreach (var sheet in wb.Worksheets)
    {
        var lastProbe = sheet.LastRowUsed()?.RowNumber() ?? 0;
        for (var r = 1; r <= Math.Min(16, lastProbe); r++)
        {
            for (var c = 1; c <= 20; c++)
            {
                var h = CellText(sheet.Cell(r, c));
                if (h is "الباركود" or "باركود" or "Barcode")
                {
                    ws = sheet;
                    break;
                }
            }
            if (ws is not null) break;
        }
        if (ws is not null) break;
    }
    ws ??= wb.Worksheets.FirstOrDefault(s =>
                s.Name.Contains("مدمج", StringComparison.Ordinal)
                || s.Name.Contains("أصناف", StringComparison.Ordinal)
                || s.Name.Contains("النهائي", StringComparison.Ordinal))
         ?? wb.Worksheets.First();
    Console.WriteLine($"ورقة الجرد: {ws.Name}");
    var last = ws.LastRowUsed()?.RowNumber() ?? 0;
    var headerRow = 0;
    var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    for (var r = 1; r <= Math.Min(16, last); r++)
    {
        for (var c = 1; c <= 20; c++)
        {
            var h = CellText(ws.Cell(r, c));
            if (h is "الباركود" or "باركود" or "Barcode") { headerRow = r; break; }
        }
        if (headerRow > 0) break;
    }
    if (headerRow == 0)
    {
        Console.WriteLine("لم يُعثر على صف عناوين — أول 8 صفوف:");
        for (var r = 1; r <= Math.Min(8, last); r++)
        {
            var cells = Enumerable.Range(1, 8).Select(c => $"[{c}]{CellText(ws.Cell(r, c))}");
            Console.WriteLine($"R{r}: {string.Join(" | ", cells)}");
        }
        throw new InvalidOperationException("تعذر إيجاد صف عناوين الباركود.");
    }
    for (var c = 1; c <= 20; c++)
    {
        var h = CellText(ws.Cell(headerRow, c));
        if (!string.IsNullOrWhiteSpace(h)) map[h] = c;
    }
    Console.WriteLine("أعمدة: " + string.Join("، ", map.Select(kv => $"{kv.Key}={kv.Value}")));

    int Col(params string[] names)
    {
        foreach (var n in names)
            if (map.TryGetValue(n, out var c)) return c;
        return 0;
    }

    var colBc = Col("الباركود", "باركود", "Barcode");
    var colName = Col("اسم الصنف", "الاسم", "المادة", "Name");
    var colBrand = Col("الماركة", "Brand");
    var colQty = Col("الكمية", "Qty", "العدد");
    var list = new List<InvItem>();
    for (var r = headerRow + 1; r <= last; r++)
    {
        var barcode = CellText(ws.Cell(r, colBc));
        if (string.IsNullOrWhiteSpace(barcode)) continue;
        if (barcode is "الباركود" or "الإجمالي" or "المجموع") continue;
        list.Add(new InvItem(
            list.Count + 1,
            barcode.Trim(),
            colName > 0 ? CellText(ws.Cell(r, colName)) : "",
            colBrand > 0 ? CellText(ws.Cell(r, colBrand)) : "",
            colQty > 0 ? CellNumber(ws.Cell(r, colQty)) : 0));
    }
    return list;
}

static Dictionary<string, List<Art>> BuildIndex(Dictionary<long, Art> articles, List<(long Seq, string Barcode)> extra)
{
    var index = new Dictionary<string, List<Art>>(StringComparer.OrdinalIgnoreCase);
    void Add(string? raw, Art art)
    {
        if (string.IsNullOrWhiteSpace(raw)) return;
        foreach (var key in KeysOf(raw))
        {
            if (!index.TryGetValue(key, out var list))
            {
                list = [];
                index[key] = list;
            }
            if (list.All(x => x.Seq != art.Seq)) list.Add(art);
        }
    }
    foreach (var art in articles.Values)
    {
        Add(art.Barcode, art);
        Add(art.Num, art);
    }
    foreach (var (seq, bc) in extra)
    {
        if (!articles.TryGetValue(seq, out var art)) continue;
        Add(bc, art);
    }
    return index;
}

static Art? FindArticle(string barcode, Dictionary<string, List<Art>> index)
{
    foreach (var key in KeysOf(barcode))
        if (index.TryGetValue(key, out var list) && list.Count > 0)
            return list[0];
    return null;
}

static IEnumerable<string> KeysOf(string raw)
{
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    void Add(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return;
        seen.Add(s.Trim());
    }
    Add(raw);
    var compact = string.Concat(raw.Where(ch => !char.IsWhiteSpace(ch)));
    Add(compact);
    var digits = new string(raw.Where(char.IsDigit).ToArray());
    if (digits.Length >= 3) Add(digits);
    if (digits.Length >= 8)
    {
        var stripped = digits.TrimStart('0');
        if (stripped.Length >= 8) Add(stripped);
        if (digits.Length == 12) Add("0" + digits);
        if (digits.Length == 13 && digits.StartsWith('0')) Add(digits[1..]);
    }
    return seen;
}

static async Task<Dictionary<string, object?>> ReadInvoiceHeaderAsync(DbConnection conn)
{
    var cols = new List<string>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT TOP 0 * FROM File15n";
        await using var r = await cmd.ExecuteReaderAsync();
        for (var i = 0; i < r.FieldCount; i++) cols.Add(r.GetName(i));
    }
    var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT * FROM File15n WHERE Seq = {InvoiceSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) throw new InvalidOperationException($"الفاتورة Seq={InvoiceSeq} غير موجودة");
        foreach (var col in cols)
        {
            var ord = r.GetOrdinal(col);
            if (r.IsDBNull(ord)) { dict[col] = null; continue; }
            var val = r.GetValue(ord);
            if (val is byte[]) continue;
            dict[col] = val;
        }
    }
    return dict;
}

static async Task<List<InvLine>> ReadInvoiceLinesAsync(DbConnection conn)
{
    var list = new List<InvLine>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Mat, Quant, Price FROM File14n WHERE BillSeq = {InvoiceSeq}";
    cmd.CommandTimeout = 180;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        list.Add(new InvLine(ToLong(r.GetValue(0)), ToDouble(r.GetValue(1)), ToDouble(r.GetValue(2))));
    return list;
}

static async Task<Dictionary<long, Art>> LoadArticlesAsync(DbConnection conn, Dictionary<long, string> names)
{
    var map = new Dictionary<long, Art>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT Seq, Father, Name1, Num, Barcode, SellPr4, CurTot1 FROM File13n";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var raw = ReadStr(r.GetValue(2));
        map[seq] = new Art(
            seq,
            r.IsDBNull(1) ? 0 : ToLong(r.GetValue(1)),
            names.TryGetValue(seq, out var n) ? n : (raw ?? ""),
            ReadStr(r.GetValue(3)),
            ReadStr(r.GetValue(4)),
            ToDouble(r.GetValue(5)),
            ToDouble(r.GetValue(6)));
    }
    return map;
}

static async Task<List<(long Seq, string Barcode)>> LoadExtraBarcodesAsync(DbConnection conn)
{
    var list = new List<(long, string)>();
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT EdNum, BarCode FROM File13BC";
        cmd.CommandTimeout = 300;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var bc = ReadStr(r.GetValue(1));
            if (!string.IsNullOrWhiteSpace(bc))
                list.Add((ToLong(r.GetValue(0)), bc));
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه File13BC: {ex.Message.Split('\n')[0]}");
    }
    return list;
}

static async Task<(long Seq, string Num, string Name)> ReadAccountAsync(DbConnection conn, long seq)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, Num, Name1 FROM File11n WHERE Seq = {seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return (seq, "?", "?");
    return (ToLong(r.GetValue(0)), ReadStr(r.GetValue(1)) ?? "", ReadStr(r.GetValue(2)) ?? "");
}

static async Task<(long Seq, string Num, string Name, long ChildCount)> ReadTreeAsync(DbConnection conn, long seq, Dictionary<long, string> names)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, Num, Name1 FROM File13n WHERE Seq = {seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return (seq, "?", "?", 0);
    var num = ReadStr(r.GetValue(1)) ?? "";
    var name = names.TryGetValue(seq, out var n) ? n : (ReadStr(r.GetValue(2)) ?? "");
    await using var c2 = conn.CreateCommand();
    c2.CommandText = $"SELECT COUNT(*) FROM File13n WHERE Father = {seq}";
    var children = ToLong(await c2.ExecuteScalarAsync() ?? 0L);
    return (seq, num, name, children);
}

static async Task<Dictionary<long, string>> LoadPosNamesAsync()
{
    var map = new Dictionary<long, string>();
    try
    {
        await using var sql = new SqlConnection(
            @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
        await sql.OpenAsync();
        await using var cmd = sql.CreateCommand();
        cmd.CommandText = "SELECT Seq, Name1 FROM articles WHERE Seq IS NOT NULL AND Name1 IS NOT NULL";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var name = r.IsDBNull(1) ? null : r.GetString(1).Trim();
            if (!string.IsNullOrWhiteSpace(name))
                map[ToLong(r.GetValue(0))] = name;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه أسماء POS: {ex.Message.Split('\n')[0]}");
    }
    return map;
}

static void WriteReport(
    string path,
    string excelName,
    Dictionary<string, object?> header,
    (long Seq, string Num, string Name) account,
    (long Seq, string Num, string Name, long ChildCount) tree,
    List<Check> settings,
    List<CompareRow> results,
    List<ExtraLine> extra,
    List<InvLine> lines,
    double headerTotal,
    double lineTotal)
{
    using var wb = new XLWorkbook();
    var green = XLColor.FromHtml("#0F9F76");
    var red = XLColor.FromHtml("#B91C1C");
    var amber = XLColor.FromHtml("#B45309");
    var rose = XLColor.FromHtml("#FEF2F2");
    var mint = XLColor.FromHtml("#ECFDF5");

    var sum = wb.AddWorksheet("الملخص");
    sum.RightToLeft = true;
    sum.Cell(1, 1).Value = "مقارنة جرد TESTER مع فاتورة المبيعات 24";
    sum.Cell(1, 1).Style.Font.Bold = true;
    sum.Cell(1, 1).Style.Font.FontSize = 16;
    sum.Range(1, 1, 1, 4).Merge();
    sum.Cell(3, 1).Value = "ملف الجرد";
    sum.Cell(3, 2).Value = excelName;
    sum.Cell(4, 1).Value = "الفاتورة";
    sum.Cell(4, 2).Value = $"رقم {header.GetValueOrDefault("Num")}  Seq={InvoiceSeq}  Kind={header.GetValueOrDefault("Kind")}";
    sum.Cell(5, 1).Value = "الحساب";
    sum.Cell(5, 2).Value = $"{account.Num} {account.Name}";
    sum.Cell(6, 1).Value = "الشجرة";
    sum.Cell(6, 2).Value = $"{tree.Num} {tree.Name} (أبناء {tree.ChildCount})";
    sum.Cell(7, 1).Value = "إجمالي الرأس / الأسطر";
    sum.Cell(7, 2).Value = $"{headerTotal:N0} / {lineTotal:N0}";
    var row = 9;
    sum.Cell(row, 1).Value = "الفحص";
    sum.Cell(row, 2).Value = "النتيجة";
    sum.Cell(row, 3).Value = "الواقع";
    sum.Cell(row, 4).Value = "المتوقع";
    foreach (var s in settings)
    {
        row++;
        sum.Cell(row, 1).Value = s.Title;
        sum.Cell(row, 2).Value = s.Ok ? "صحيح" : "خطأ";
        sum.Cell(row, 2).Style.Font.FontColor = s.Ok ? green : red;
        sum.Cell(row, 3).Value = s.Actual;
        sum.Cell(row, 4).Value = s.Expected;
    }
    row += 2;
    sum.Cell(row, 1).Value = "أصناف الجرد"; sum.Cell(row, 2).Value = results.Count; row++;
    sum.Cell(row, 1).Value = "مطابق"; sum.Cell(row, 2).Value = results.Count(r => r.Status == "مطابق"); row++;
    sum.Cell(row, 1).Value = "بلا بطاقة"; sum.Cell(row, 2).Value = results.Count(r => r.Hit is null); row++;
    sum.Cell(row, 1).Value = "ليس في الفاتورة"; sum.Cell(row, 2).Value = results.Count(r => r.Hit is not null && !r.OnInvoice); row++;
    sum.Cell(row, 1).Value = "اختلاف كمية"; sum.Cell(row, 2).Value = results.Count(r => r.OnInvoice && r.Note is not null); row++;
    sum.Cell(row, 1).Value = "عائدية خاطئة"; sum.Cell(row, 2).Value = results.Count(r => r.OnInvoice && !r.InTree);
    sum.Columns().AdjustToContents();

    void Sheet(string name, IEnumerable<CompareRow> data, XLColor accent)
    {
        var ws = wb.AddWorksheet(name);
        ws.RightToLeft = true;
        var headers = new[] { "#", "الحالة", "باركود الجرد", "اسم الجرد", "كمية الجرد", "كمية الفاتورة", "Seq", "اسم الإداري", "سعر الفاتورة", "سعر البطاقة", "العائدية", "ملاحظة" };
        for (var i = 0; i < headers.Length; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Font.FontColor = XLColor.White;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = accent;
        }
        var irow = 2;
        foreach (var r in data)
        {
            ws.Cell(irow, 1).Value = irow - 1;
            ws.Cell(irow, 2).Value = r.Status;
            ws.Cell(irow, 3).Value = r.Item.Barcode;
            ws.Cell(irow, 3).Style.NumberFormat.Format = "@";
            ws.Cell(irow, 4).Value = r.Item.Name;
            ws.Cell(irow, 5).Value = r.Item.Qty;
            ws.Cell(irow, 6).Value = r.InvoiceQty;
            if (r.Hit is not null) ws.Cell(irow, 7).Value = r.Hit.Seq;
            ws.Cell(irow, 8).Value = r.Hit?.Name ?? "";
            ws.Cell(irow, 9).Value = r.InvoicePrice;
            ws.Cell(irow, 10).Value = r.CardPrice;
            ws.Cell(irow, 11).Value = r.Hit is null ? "" : (r.InTree ? "011014" : $"Father={r.Hit.Father}");
            ws.Cell(irow, 12).Value = r.Note ?? "";
            if (r.Hit is null || !r.OnInvoice) ws.Range(irow, 1, irow, 12).Style.Fill.BackgroundColor = rose;
            else if (r.Note is not null || !r.InTree) ws.Range(irow, 1, irow, 12).Style.Fill.BackgroundColor = XLColor.FromHtml("#FFFBEB");
            else ws.Range(irow, 1, irow, 12).Style.Fill.BackgroundColor = irow % 2 == 0 ? mint : XLColor.White;
            irow++;
        }
        if (irow > 2) ws.Range(1, 1, irow - 1, 12).SetAutoFilter();
        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents();
    }

    Sheet("غير موجود في الفاتورة", results.Where(r => !r.OnInvoice), red);
    Sheet("اختلاف كمية", results.Where(r => r.OnInvoice && r.Note is not null), amber);
    Sheet("الكل", results, green);

    if (extra.Count > 0)
    {
        var ws = wb.AddWorksheet("زيادة في الفاتورة");
        ws.RightToLeft = true;
        var headers = new[] { "Seq", "الباركود", "الاسم", "الكمية", "السعر", "في 011014" };
        for (var i = 0; i < headers.Length; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Font.FontColor = XLColor.White;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = amber;
        }
        for (var i = 0; i < extra.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = extra[i].Seq;
            ws.Cell(i + 2, 2).Value = extra[i].Barcode ?? "";
            ws.Cell(i + 2, 2).Style.NumberFormat.Format = "@";
            ws.Cell(i + 2, 3).Value = extra[i].Name ?? "";
            ws.Cell(i + 2, 4).Value = extra[i].Qty;
            ws.Cell(i + 2, 5).Value = extra[i].Price;
            ws.Cell(i + 2, 6).Value = extra[i].InTree ? "نعم" : "لا";
        }
        ws.Columns().AdjustToContents();
    }

    if (File.Exists(path)) File.Delete(path);
    wb.SaveAs(path);
}

static string CellText(IXLCell cell)
{
    if (cell.IsEmpty()) return "";
    return cell.DataType switch
    {
        XLDataType.Number => cell.GetDouble().ToString("0.#############", CultureInfo.InvariantCulture),
        _ => cell.GetString().Trim()
    };
}

static double CellNumber(IXLCell cell)
{
    if (cell.IsEmpty()) return 0;
    if (cell.DataType == XLDataType.Number) return cell.GetDouble();
    return double.TryParse(cell.GetString().Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : 0;
}

static string? ReadStr(object? v) => v is null or DBNull ? null : Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim();
static long ToLong(object? v) => v switch
{
    null or DBNull => 0,
    long l => l,
    int i => i,
    short s => s,
    decimal dec => (long)dec,
    double d => (long)d,
    string str when long.TryParse(str, NumberStyles.Any, CultureInfo.InvariantCulture, out var p) => p,
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

sealed record InvItem(int No, string Barcode, string Name, string Brand, double Qty);
sealed record Art(long Seq, long Father, string Name, string? Num, string? Barcode, double SellPr4, double Stock);
sealed record InvLine(long Mat, double Qty, double Price);
sealed record CompareRow(InvItem Item, string Status, Art? Hit, List<InvLine>? Lines, double InvoiceQty, double InvoicePrice, double CardPrice, bool OnInvoice, bool InTree, string? Note);
sealed record ExtraLine(long Seq, string? Barcode, string? Name, double Qty, double Price, bool InTree);
sealed record Check(string Title, bool Ok, string Actual, string Expected);
