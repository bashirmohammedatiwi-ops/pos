using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
var src = Directory.GetFiles(desktop, "*.xlsx")
    .Select(p => new FileInfo(p))
    .Where(f => f.Name.Contains("TESTER", StringComparison.OrdinalIgnoreCase)
                && !f.Name.Contains("مقارنة", StringComparison.OrdinalIgnoreCase)
                && !f.Name.StartsWith("TESTER_2026", StringComparison.OrdinalIgnoreCase)
                && !f.Name.StartsWith("EVOLUDERM", StringComparison.OrdinalIgnoreCase)
                && f.Length > 20_000)
    .OrderByDescending(f => f.LastWriteTime)
    .FirstOrDefault()
    ?? throw new InvalidOperationException("لم يُعثر على ملف جرد TESTER على سطح المكتب.");

Console.WriteLine($"ملف الجرد: {src.FullName}");

var inventory = ReadInventory(src.FullName);
Console.WriteLine($"أصناف الجرد: {inventory.Count}   القطع: {inventory.Sum(x => x.Qty)}");

var articles = await LoadEdariArticlesAsync();
Console.WriteLine($"مواد الإداري المحمّلة: {articles.BySeq.Count}   مفاتيح المطابقة: {articles.Index.Count}");

var rows = inventory.Select(item => MatchItem(item, articles)).ToList();
var found = rows.Where(r => r.Found).ToList();
var missing = rows.Where(r => !r.Found).ToList();
Console.WriteLine($"موجود: {found.Count}   غير موجود: {missing.Count}");

var outPath = Path.Combine(desktop, "جرد_TESTER_مقارنة_الاداري.xlsx");
WriteReport(outPath, src.Name, articles.Source, rows, found, missing);
Console.WriteLine($"التقرير: {outPath}");

static List<InvItem> ReadInventory(string path)
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheets.FirstOrDefault(s => s.Name.Contains("النهائي", StringComparison.Ordinal))
             ?? wb.Worksheets.First(s => s.Name != "الغلاف");
    var headerRow = 0;
    var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    var last = ws.LastRowUsed()?.RowNumber() ?? 0;
    for (var r = 1; r <= Math.Min(12, last); r++)
    {
        for (var c = 1; c <= 16; c++)
        {
            var h = CellText(ws.Cell(r, c));
            if (h is "الباركود" or "باركود") { headerRow = r; break; }
        }
        if (headerRow > 0) break;
    }
    if (headerRow == 0) throw new InvalidOperationException("تعذر إيجاد صف عناوين الباركود.");

    for (var c = 1; c <= 16; c++)
    {
        var h = CellText(ws.Cell(headerRow, c));
        if (!string.IsNullOrWhiteSpace(h)) map[h] = c;
    }

    int Col(params string[] names)
    {
        foreach (var n in names)
            if (map.TryGetValue(n, out var c)) return c;
        return 0;
    }

    var colBc = Col("الباركود", "باركود");
    var colName = Col("اسم الصنف", "الاسم");
    var colBrand = Col("الماركة");
    var colQty = Col("الكمية");
    var colScans = Col("مرات المسح");
    var colStatus = Col("اكتمال الاسم", "الحالة");

    var list = new List<InvItem>();
    for (var r = headerRow + 1; r <= last; r++)
    {
        var barcode = CellText(ws.Cell(r, colBc));
        if (string.IsNullOrWhiteSpace(barcode)) continue;
        if (barcode is "الباركود" or "الإجمالي" or "المجموع") continue;
        var qty = CellNumber(ws.Cell(r, colQty));
        list.Add(new InvItem(
            list.Count + 1,
            barcode.Trim(),
            CellText(ws.Cell(r, colName)),
            CellText(ws.Cell(r, colBrand)),
            qty,
            colScans > 0 ? CellNumber(ws.Cell(r, colScans)) : 0,
            CellText(ws.Cell(r, colStatus))));
    }
    return list;
}

static ResultRow MatchItem(InvItem item, EdariCatalog cat)
{
    var keys = KeysOf(item.Barcode);
    EdariHit? hit = null;
    string? how = null;
    foreach (var key in keys)
    {
        if (!cat.Index.TryGetValue(key, out var list) || list.Count == 0) continue;
        hit = list[0];
        how = key == Norm(item.Barcode) ? hit.Via : $"{hit.Via} (بعد توحيد الباركود)";
        if (list.Count > 1)
            how += $" — {list.Count} مواد مطابقة";
        break;
    }

    if (hit is null)
    {
        return new ResultRow(item, false, "غير موجود في الإداري", null, null, null, null, null, null, null, null, null);
    }

    var art = cat.BySeq[hit.Seq];
    var testerHint = LooksLikeTester(art.Name) ? "يبدو تستر" : "مادة عادية (قد تكون نفس باركود البيع)";
    return new ResultRow(
        item, true, "موجود في الإداري", how, art.Seq, art.Num, art.Barcode, art.Name,
        art.TreePath, art.Stock1, art.Price, testerHint);
}

static bool LooksLikeTester(string? name)
{
    if (string.IsNullOrWhiteSpace(name)) return false;
    var n = name.Trim();
    return n.Contains("تستر", StringComparison.OrdinalIgnoreCase)
        || n.Contains("تستير", StringComparison.OrdinalIgnoreCase)
        || n.Contains("tester", StringComparison.OrdinalIgnoreCase)
        || n.Contains("TESTER", StringComparison.Ordinal);
}

static async Task<EdariCatalog> LoadEdariArticlesAsync()
{
    var bySeq = new Dictionary<long, EdariArt>();
    var index = new Dictionary<string, List<EdariHit>>(StringComparer.OrdinalIgnoreCase);
    var source = "Edari File13n 2026";

    var apiDirs = new[]
    {
        @"C:\Program Files\FOT POS Server\Api",
        @"C:\Program Files\FOT POS\Server\Api",
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Release", "net9.0")),
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Debug", "net9.0")),
    };
    var baseDir = apiDirs.FirstOrDefault(d => File.Exists(Path.Combine(d, "NexusDB.ADOProvider.dll")));
    if (baseDir is null)
        throw new InvalidOperationException("تعذر العثور على NexusDB.ADOProvider.dll للاتصال بالإداري.");

    Environment.CurrentDirectory = baseDir;
    var asm = Assembly.LoadFrom(Path.Combine(baseDir, "NexusDB.ADOProvider.dll"));
    DbProviderFactories.RegisterFactory("NexusDB.ADOProvider",
        asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

    await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
    conn.ConnectionString = "server=127.0.0.1;database=2026;port=16000;Native=true";
    await conn.OpenAsync();
    Console.WriteLine("متصل بالإداري: 2026");

    var columns = await ColumnNamesAsync(conn, "File13n");
    var hasExtra8 = columns.Contains("Extra8", StringComparer.OrdinalIgnoreCase);
    var hasStock2 = columns.Contains("CurTot2", StringComparer.OrdinalIgnoreCase);
    var sql = hasExtra8
        ? "SELECT Seq, Father, Name1, Num, Barcode, CurTot1, Extra8, SellPr4 FROM File13n"
        : "SELECT Seq, Father, Name1, Num, Barcode, CurTot1, SellPr4 FROM File13n";

    var fathers = new HashSet<long>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = sql;
        cmd.CommandTimeout = 600;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = ToLong(r.GetValue(0));
            var father = r.IsDBNull(1) ? 0L : ToLong(r.GetValue(1));
            var extra8 = hasExtra8 ? ReadStr(r.GetValue(6)) : null;
            var priceIdx = hasExtra8 ? 7 : 6;
            var art = new EdariArt(
                seq, father, ReadStr(r.GetValue(2)), ReadStr(r.GetValue(3)), ReadStr(r.GetValue(4)),
                ToNullableDouble(r.GetValue(5)), ToNullableDouble(r.GetValue(priceIdx)), extra8, "");
            bySeq[seq] = art;
            if (father > 0) fathers.Add(father);
        }
    }
    Console.WriteLine($"File13n: {bySeq.Count}");

    var extraBarcodes = 0;
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT EdNum, BarCode FROM File13BC";
        cmd.CommandTimeout = 300;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = ToLong(r.GetValue(0));
            var bc = ReadStr(r.GetValue(1));
            if (seq <= 0 || string.IsNullOrWhiteSpace(bc) || !bySeq.ContainsKey(seq)) continue;
            AddKeys(index, bc, new EdariHit(seq, "باركود إضافي File13BC"));
            extraBarcodes++;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه File13BC: {ex.Message.Split('\n')[0]}");
    }
    Console.WriteLine($"File13BC: {extraBarcodes}");

    var posNames = new Dictionary<long, string>();
    try
    {
        await using var sqlConn = new SqlConnection(
            @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
        await sqlConn.OpenAsync();
        await using var cmd = sqlConn.CreateCommand();
        cmd.CommandText = "SELECT Seq, Name1 FROM articles WHERE Seq IS NOT NULL AND Name1 IS NOT NULL";
        cmd.CommandTimeout = 120;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = ToLong(r.GetValue(0));
            var name = r.IsDBNull(1) ? null : r.GetString(1).Trim();
            if (!string.IsNullOrWhiteSpace(name)) posNames[seq] = name;
        }
        Console.WriteLine($"أسماء FOT_POS_V2: {posNames.Count}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه أسماء POS: {ex.Message.Split('\n')[0]}");
    }

    string NameOf(long seq, string? raw) =>
        posNames.TryGetValue(seq, out var n) ? n : (raw ?? "");

    foreach (var seq in bySeq.Keys.ToList())
    {
        var a = bySeq[seq];
        var name = NameOf(seq, a.Name);
        var path = BuildPath(seq, bySeq, fathers, NameOf);
        bySeq[seq] = a with { Name = name, TreePath = path };
        AddKeys(index, a.Barcode, new EdariHit(seq, "باركود المادة"));
        AddKeys(index, a.Num, new EdariHit(seq, "رقم المادة"));
        AddKeys(index, a.Extra8, new EdariHit(seq, "حقل Extra8"));
    }

    _ = hasStock2;
    _ = source;
    return new EdariCatalog(bySeq, index, "Edari 2026 — File13n + File13BC");
}

static string BuildPath(long seq, Dictionary<long, EdariArt> bySeq, HashSet<long> fathers, Func<long, string?, string> nameOf)
{
    var parts = new List<string>();
    var current = seq;
    var guard = 0;
    while (bySeq.TryGetValue(current, out var n) && n.Father > 0 && guard++ < 24)
    {
        if (!bySeq.TryGetValue(n.Father, out var parent)) break;
        var name = nameOf(parent.Seq, parent.Name);
        parts.Add(string.IsNullOrWhiteSpace(name) ? $"#{parent.Seq}" : name.Trim());
        current = parent.Seq;
    }
    parts.Reverse();
    return string.Join(" / ", parts);
}

static void AddKeys(Dictionary<string, List<EdariHit>> index, string? raw, EdariHit hit)
{
    if (string.IsNullOrWhiteSpace(raw)) return;
    foreach (var key in KeysOf(raw))
    {
        if (!index.TryGetValue(key, out var list))
        {
            list = [];
            index[key] = list;
        }
        if (list.All(x => x.Seq != hit.Seq || x.Via != hit.Via))
            list.Add(hit);
    }
}

static IEnumerable<string> KeysOf(string raw)
{
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    void Add(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return;
        s = s.Trim();
        if (seen.Add(s)) { }
    }

    Add(raw.Trim());
    var compact = Norm(raw);
    Add(compact);
    var digits = new string(raw.Where(char.IsDigit).ToArray());
    if (digits.Length >= 6) Add(digits);
    if (digits.Length >= 8)
    {
        var stripped = digits.TrimStart('0');
        if (stripped.Length >= 8) Add(stripped);
        if (digits.Length == 12) Add("0" + digits);
        if (digits.Length == 13 && digits.StartsWith('0')) Add(digits[1..]);
    }
    return seen;
}

static string Norm(string s) =>
    string.Concat(s.Trim().Where(ch => !char.IsWhiteSpace(ch)));

static void WriteReport(string path, string sourceName, string edariSource, List<ResultRow> all, List<ResultRow> found, List<ResultRow> missing)
{
    using var wb = new XLWorkbook();
    var green = XLColor.FromHtml("#0F9F76");
    var red = XLColor.FromHtml("#B91C1C");
    var ink = XLColor.FromHtml("#0B1220");
    var muted = XLColor.FromHtml("#64748B");
    var mint = XLColor.FromHtml("#ECFDF5");
    var rose = XLColor.FromHtml("#FEF2F2");
    var zebra = XLColor.FromHtml("#F8FAFC");

    void StyleHeader(IXLWorksheet ws, int cols)
    {
        ws.Style.Font.FontName = "Calibri";
        ws.Style.Font.FontSize = 11;
        ws.RightToLeft = true;
        ws.ShowGridLines = false;
        ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        ws.PageSetup.PaperSize = XLPaperSize.A4Paper;
        ws.PageSetup.PagesWide = 1;
        ws.PageSetup.PagesTall = 0;
    }

    var sum = wb.Worksheets.Add("الملخص");
    StyleHeader(sum, 6);
    sum.Range(1, 1, 1, 6).Merge();
    sum.Cell(1, 1).Value = "مقارنة جرد TESTER مع الإداري";
    sum.Cell(1, 1).Style.Font.Bold = true;
    sum.Cell(1, 1).Style.Font.FontSize = 20;
    sum.Cell(1, 1).Style.Font.FontColor = XLColor.White;
    sum.Cell(1, 1).Style.Fill.BackgroundColor = green;
    sum.Row(1).Height = 30;

    sum.Cell(3, 1).Value = "ملف الجرد";
    sum.Cell(3, 2).Value = sourceName;
    sum.Cell(4, 1).Value = "مصدر الإداري";
    sum.Cell(4, 2).Value = edariSource;
    sum.Cell(5, 1).Value = "تاريخ المطابقة";
    sum.Cell(5, 2).Value = DateTime.Now.ToString("dd MMMM yyyy، hh:mm tt", new CultureInfo("ar-IQ"));

    void Kpi(int row, string title, int value, XLColor color)
    {
        sum.Cell(row, 1).Value = title;
        sum.Cell(row, 1).Style.Font.Bold = true;
        sum.Cell(row, 2).Value = value;
        sum.Cell(row, 2).Style.Font.Bold = true;
        sum.Cell(row, 2).Style.Font.FontSize = 16;
        sum.Cell(row, 2).Style.Font.FontColor = color;
    }
    Kpi(7, "أصناف الجرد", all.Count, ink);
    Kpi(8, "موجود في الإداري", found.Count, green);
    Kpi(9, "غير موجود في الإداري", missing.Count, red);
    Kpi(10, "قطع الموجود", (int)found.Sum(x => x.Item.Qty), green);
    Kpi(11, "قطع غير الموجود", (int)missing.Sum(x => x.Item.Qty), red);

    sum.Cell(13, 1).Value = "طريقة المطابقة";
    sum.Cell(13, 1).Style.Font.Bold = true;
    sum.Cell(13, 1).Style.Font.FontColor = green;
    sum.Range(14, 1, 16, 6).Merge();
    sum.Cell(14, 1).Value =
        "المطابقة على باركود المادة في File13n، ثم الباركودات الإضافية File13BC، ثم رقم المادة، مع توحيد المسافات والأصفار البادئة وباركود 12/13 خانة.\n" +
        "إذا وُجد الباركود على مادة بيع عادية وليس تستر، تُعد موجودة مع ملاحظة بذلك.\n" +
        "معظم أصناف هذا الجرد بلا اسم في ملف المسح؛ اسم الإداري يُعرض عند العثور عليها.";
    sum.Cell(14, 1).Style.Alignment.WrapText = true;
    sum.Row(14).Height = 56;
    sum.Column(1).Width = 28;
    sum.Column(2).Width = 48;

    WriteSheet(wb.Worksheets.Add("موجود في الإداري"), found, true, green, mint, zebra);
    WriteSheet(wb.Worksheets.Add("غير موجود في الإداري"), missing, false, red, rose, zebra);
    WriteSheet(wb.Worksheets.Add("الكل"), all, true, green, mint, zebra, markMissing: true);

    void WriteSheet(IXLWorksheet ws, List<ResultRow> data, bool includeEdari, XLColor accent, XLColor headTint, XLColor alt, bool markMissing = false)
    {
        StyleHeader(ws, 14);
        var headers = includeEdari
            ? new[] { "#", "حالة المطابقة", "باركود الجرد", "اسم الجرد", "كمية الجرد", "طريقة المطابقة", "Seq الإداري", "رقم المادة", "باركود الإداري", "اسم المادة في الإداري", "مسار الشجرة", "مخزون 1", "ملاحظة" }
            : new[] { "#", "باركود الجرد", "اسم الجرد", "الماركة", "كمية الجرد", "مرات المسح", "اكتمال الاسم" };
        for (var i = 0; i < headers.Length; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Font.FontColor = XLColor.White;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = accent;
        }
        ws.Row(1).Height = 22;
        ws.SheetView.FreezeRows(1);

        for (var i = 0; i < data.Count; i++)
        {
            var r = i + 2;
            var row = data[i];
            var fill = i % 2 == 1 ? alt : XLColor.White;
            if (markMissing && !row.Found) fill = rose;
            if (includeEdari)
            {
                ws.Cell(r, 1).Value = i + 1;
                ws.Cell(r, 2).Value = row.Status;
                ws.Cell(r, 2).Style.Font.Bold = true;
                ws.Cell(r, 2).Style.Font.FontColor = row.Found ? green : red;
                ws.Cell(r, 3).Value = row.Item.Barcode;
                ws.Cell(r, 3).Style.NumberFormat.Format = "@";
                ws.Cell(r, 4).Value = string.IsNullOrWhiteSpace(row.Item.Name) || row.Item.Name is "—" or "يحتاج اسم" ? "" : row.Item.Name;
                ws.Cell(r, 5).Value = row.Item.Qty;
                ws.Cell(r, 6).Value = row.How ?? "";
                if (row.Seq is long seq) ws.Cell(r, 7).Value = seq;
                ws.Cell(r, 8).Value = row.EdariNum ?? "";
                ws.Cell(r, 8).Style.NumberFormat.Format = "@";
                ws.Cell(r, 9).Value = row.EdariBarcode ?? "";
                ws.Cell(r, 9).Style.NumberFormat.Format = "@";
                ws.Cell(r, 10).Value = row.EdariName ?? "";
                ws.Cell(r, 11).Value = row.TreePath ?? "";
                if (row.Stock is double st) ws.Cell(r, 12).Value = st;
                ws.Cell(r, 13).Value = row.Note ?? "";
            }
            else
            {
                ws.Cell(r, 1).Value = i + 1;
                ws.Cell(r, 2).Value = row.Item.Barcode;
                ws.Cell(r, 2).Style.NumberFormat.Format = "@";
                ws.Cell(r, 3).Value = string.IsNullOrWhiteSpace(row.Item.Name) || row.Item.Name is "—" or "يحتاج اسم" ? "" : row.Item.Name;
                ws.Cell(r, 4).Value = row.Item.Brand ?? "";
                ws.Cell(r, 5).Value = row.Item.Qty;
                ws.Cell(r, 6).Value = row.Item.Scans;
                ws.Cell(r, 7).Value = row.Item.Status ?? "";
            }
            ws.Range(r, 1, r, headers.Length).Style.Fill.BackgroundColor = fill;
        }

        if (data.Count > 0)
            ws.Range(1, 1, data.Count + 1, headers.Length).SetAutoFilter();

        for (var c = 1; c <= headers.Length; c++)
            ws.Column(c).AdjustToContents(1, Math.Min(40, data.Count + 1), 8, 48);
        ws.Column(1).Width = 6;
    }

    if (File.Exists(path)) File.Delete(path);
    wb.SaveAs(path);
}

static async Task<HashSet<string>> ColumnNamesAsync(DbConnection conn, string table)
{
    var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT TOP 1 * FROM {table}";
    await using var r = await cmd.ExecuteReaderAsync();
    for (var i = 0; i < r.FieldCount; i++) set.Add(r.GetName(i));
    return set;
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

static string? ReadStr(object? v) =>
    v is null or DBNull ? null : Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim();

static long ToLong(object? v)
{
    if (v is null or DBNull) return 0;
    try { return Convert.ToInt64(v, CultureInfo.InvariantCulture); }
    catch { return 0; }
}

static double? ToNullableDouble(object? v)
{
    if (v is null or DBNull) return null;
    try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); }
    catch { return null; }
}

sealed record InvItem(int No, string Barcode, string Name, string Brand, double Qty, double Scans, string Status);
sealed record EdariArt(long Seq, long Father, string? Name, string? Num, string? Barcode, double? Stock1, double? Price, string? Extra8, string TreePath);
sealed record EdariHit(long Seq, string Via);
sealed record EdariCatalog(Dictionary<long, EdariArt> BySeq, Dictionary<string, List<EdariHit>> Index, string Source);
sealed record ResultRow(
    InvItem Item, bool Found, string Status, string? How, long? Seq, string? EdariNum,
    string? EdariBarcode, string? EdariName, string? TreePath, double? Stock, double? Price, string? Note);
