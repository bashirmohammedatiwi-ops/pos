using System.Data.Common;
using System.Reflection;
using System.Text;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const long brandFolderSeq = 91593;

var apiDirs = new[]
{
    @"C:\Program Files\FOT POS Server\Api",
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Debug", "net9.0")),
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Release", "net9.0")),
};
var baseDir = apiDirs.FirstOrDefault(d => File.Exists(Path.Combine(d, "NexusDB.ADOProvider.dll")))
    ?? throw new InvalidOperationException("تعذر العثور على NexusDB.ADOProvider.dll");

Environment.CurrentDirectory = baseDir;
var asm = Assembly.LoadFrom(Path.Combine(baseDir, "NexusDB.ADOProvider.dll"));
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider", asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

var alias = args.FirstOrDefault(a => !a.StartsWith('-')) ?? "2026";
await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = $"server=127.0.0.1;database={alias};port=16000;Native=true";
await conn.OpenAsync();
Console.WriteLine($"متصل بالأدري: {alias}");

var nodes = new Dictionary<long, Node>();
var frontier = new List<long> { brandFolderSeq };
while (frontier.Count > 0)
{
    var batch = new List<Node>();
    foreach (var chunk in frontier.Chunk(200))
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT Seq, Father, Num, Barcode, Name1, Name2,
                   PurchaseTot, SalesTot, CurTot1, CurTot2, CurTot3
            FROM File13n
            WHERE Father IN ({string.Join(",", chunk)})
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = Convert.ToInt64(r.GetValue(0));
            batch.Add(new Node(
                seq,
                r.IsDBNull(1) ? 0 : Convert.ToInt64(r.GetValue(1)),
                Txt(r.GetValue(2)),
                Txt(r.GetValue(3)),
                Txt(r.GetValue(4)),
                Txt(r.GetValue(5)),
                Num(r, 6),
                Num(r, 7),
                Num(r, 8),
                Num(r, 9),
                Num(r, 10)));
        }
    }

    frontier = [];
    if (batch.Count == 0) break;
    var parentIds = batch.Select(n => n.Seq).ToHashSet();
    var parentsWithKids = new HashSet<long>();
    foreach (var chunk in parentIds.Chunk(200))
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT DISTINCT Father FROM File13n WHERE Father IN ({string.Join(",", chunk)})";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            if (!r.IsDBNull(0)) parentsWithKids.Add(Convert.ToInt64(r.GetValue(0)));
        }
    }

    foreach (var n in batch)
    {
        nodes[n.Seq] = n;
        if (parentsWithKids.Contains(n.Seq)) frontier.Add(n.Seq);
    }
    Console.WriteLine($"مستوى: {batch.Count} عقدة، مجلدات فرعية: {frontier.Count}");
}

var products = nodes.Values.Where(n => !frontier.Contains(n.Seq) && !nodes.Values.Any(c => c.Father == n.Seq)).ToList();

var sqlNames = await LoadSqlNamesAsync();
foreach (var p in products)
{
    if (sqlNames.TryGetValue(p.Seq, out var ar) && HasArabic(ar))
        p.Name = ar;
    else if (HasArabic(p.Name1))
        p.Name = p.Name1;
    else if (!string.IsNullOrWhiteSpace(p.Name2))
        p.Name = p.Name2;
    else
        p.Name = p.Name1;
}

var sales = ReadSectionSales(@"C:\Users\Future of Technology\AppData\Local\Temp\fot-shot\ev-report.csv");

var byBarcode = new Dictionary<string, Node>(StringComparer.OrdinalIgnoreCase);
foreach (var p in products)
{
    var key = NormBarcode(p.Barcode);
    if (key.Length == 0) continue;
    if (!byBarcode.ContainsKey(key)) byBarcode[key] = p;
}

var rows = sales
    .Select(s =>
    {
        byBarcode.TryGetValue(s.Barcode, out var product);
        var name = product?.Name;
        if (string.IsNullOrWhiteSpace(name)) name = s.Name;
        var remain = product is null ? 0 : Remaining(product);
        return new Row(s.Barcode, name, s.Qty, remain);
    })
    .ToList();
var seen = rows.Select(r => NormBarcode(r.Barcode)).ToHashSet(StringComparer.OrdinalIgnoreCase);
foreach (var p in products)
{
    var key = NormBarcode(p.Barcode);
    if (key.Length == 0 || seen.Contains(key)) continue;
    rows.Add(new Row(p.Barcode, p.Name, 0, Remaining(p)));
    seen.Add(key);
}
rows = rows
    .OrderByDescending(x => x.Sold)
    .ThenBy(x => x.Name, StringComparer.CurrentCulture)
    .ToList();

var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
var outPath = Path.Combine(desktop, "مبيعات-أقسام-ماركة-840-2.xlsx");

using var wb = new XLWorkbook();
var ws = wb.Worksheets.Add("ماركة 840");
ws.RightToLeft = true;

var headers = new[] { "الباركود", "الاسم", "مبيعات الأقسام", "المتبقي" };
for (var i = 0; i < headers.Length; i++)
{
    var cell = ws.Cell(1, i + 1);
    cell.Value = headers[i];
    cell.Style.Font.Bold = true;
    cell.Style.Font.FontName = "Tahoma";
    cell.Style.Font.FontColor = XLColor.White;
    cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#312E81");
    cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
}

for (var i = 0; i < rows.Count; i++)
{
    var item = rows[i];
    var row = i + 2;
    var zebra = i % 2 == 1;
    ws.Cell(row, 1).Value = item.Barcode;
    ws.Cell(row, 1).Style.NumberFormat.Format = "@";
    ws.Cell(row, 2).Value = item.Name;
    SetQty(ws.Cell(row, 3), item.Sold);
    SetQty(ws.Cell(row, 4), item.Remain);
    for (var c = 1; c <= 4; c++)
    {
        var cell = ws.Cell(row, c);
        cell.Style.Font.FontName = "Tahoma";
        cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        if (zebra) cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F8FAFC");
        cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        cell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#E2E8F0");
    }
}

var totalRow = rows.Count + 2;
ws.Cell(totalRow, 2).Value = "الإجمالي";
SetQty(ws.Cell(totalRow, 3), rows.Sum(x => x.Sold));
SetQty(ws.Cell(totalRow, 4), rows.Sum(x => x.Remain));
for (var c = 1; c <= 4; c++)
{
    var cell = ws.Cell(totalRow, c);
    cell.Style.Font.Bold = true;
    cell.Style.Font.FontName = "Tahoma";
    cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#EEF2FF");
}

ws.SheetView.FreezeRows(1);
ws.Columns(1, 4).AdjustToContents();
ws.Column(2).Width = Math.Max(ws.Column(2).Width, 42);
ws.Row(1).Height = 24;

try { wb.SaveAs(outPath); }
catch (IOException) { Console.WriteLine("تعذر تحديث ملف المبيعات لأنه مفتوح."); }

const int coverMonths = 14;
const int leadMonths = 3;
var horizon = coverMonths + leadMonths;
var orders = rows
    .Select(x =>
    {
        var raw = Math.Max(0, x.Sold * horizon - x.Remain);
        var qty = (int)(Math.Ceiling(raw / 12d) * 12);
        var type = ProductType(x.Name);
        return new { x.Barcode, x.Name, Type = type, Monthly = x.Sold, x.Remain, x.Sold, Qty = qty };
    })
    .Where(x => x.Qty > 0)
    .OrderBy(x => TypeOrder(x.Type))
    .ThenBy(x => x.Type, StringComparer.CurrentCulture)
    .ThenByDescending(x => x.Sold)
    .ThenBy(x => x.Name, StringComparer.CurrentCulture)
    .ToList();

var orderPath = Path.Combine(desktop, "مقترح-شراء-ماركة-840-14-شهر.xlsx");
using (var orderBook = new XLWorkbook())
{
    var sheet = orderBook.Worksheets.Add("مقترح الشراء");
    sheet.RightToLeft = true;
    var orderHeaders = new[] { "النوع", "الباركود", "الاسم", "البيع الشهري", "المتبقي", "كمية الطلب" };
    for (var i = 0; i < orderHeaders.Length; i++)
    {
        var cell = sheet.Cell(1, i + 1);
        cell.Value = orderHeaders[i];
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontName = "Tahoma";
        cell.Style.Font.FontColor = XLColor.White;
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#312E81");
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
    }

    for (var i = 0; i < orders.Count; i++)
    {
        var item = orders[i];
        var row = i + 2;
        var zebra = i % 2 == 1;
        sheet.Cell(row, 1).Value = item.Type;
        sheet.Cell(row, 2).Value = item.Barcode;
        sheet.Cell(row, 2).Style.NumberFormat.Format = "@";
        sheet.Cell(row, 3).Value = item.Name;
        SetQty(sheet.Cell(row, 4), Math.Round(item.Monthly, 1));
        SetQty(sheet.Cell(row, 5), item.Remain);
        sheet.Cell(row, 6).Value = item.Qty;
        sheet.Cell(row, 6).Style.NumberFormat.Format = "#,##0";
        sheet.Cell(row, 6).Style.Font.Bold = true;
        sheet.Cell(row, 6).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        for (var c = 1; c <= 6; c++)
        {
            var cell = sheet.Cell(row, c);
            cell.Style.Font.FontName = "Tahoma";
            cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            if (zebra) cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F8FAFC");
            cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            cell.Style.Border.OutsideBorderColor = XLColor.FromHtml("#E2E8F0");
        }
    }

    var orderTotal = orders.Count + 2;
    sheet.Cell(orderTotal, 3).Value = "الإجمالي";
    sheet.Cell(orderTotal, 6).Value = orders.Sum(x => x.Qty);
    sheet.Cell(orderTotal, 6).Style.NumberFormat.Format = "#,##0";
    for (var c = 1; c <= 6; c++)
    {
        var cell = sheet.Cell(orderTotal, c);
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontName = "Tahoma";
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#EEF2FF");
    }

    sheet.SheetView.FreezeRows(1);
    sheet.Columns(1, 6).AdjustToContents();
    sheet.Column(3).Width = Math.Max(sheet.Column(3).Width, 42);
    sheet.Row(1).Height = 24;
    orderBook.SaveAs(orderPath);
}

var samplePath = Path.Combine(desktop, "840-order-sample.txt");
await File.WriteAllLinesAsync(
    samplePath,
    orders.Take(20).Select(x => $"{x.Type}\t{x.Barcode}\t{x.Name}\tmonth={x.Monthly:0.#}\tremain={x.Remain}\torder={x.Qty}"),
    new UTF8Encoding(true));
Console.WriteLine($"rows={rows.Count} sales={rows.Sum(x => x.Sold):0.##} remain={rows.Sum(x => x.Remain):0.##}");
Console.WriteLine($"orders={orders.Count} qty={orders.Sum(x => x.Qty)}");
Console.WriteLine(outPath);
Console.WriteLine(orderPath);

static List<SaleLine> ReadSectionSales(string path)
{
    var map = new Dictionary<string, SaleLine>(StringComparer.OrdinalIgnoreCase);
    foreach (var line in File.ReadLines(path).Skip(3))
    {
        if (string.IsNullOrWhiteSpace(line)) continue;
        var cells = SplitCsv(line);
        if (cells.Count < 9) continue;
        var sign = cells[2].Trim() switch
        {
            "مبيعات" or "هدايا" => 1d,
            "مرتجعات" => -1d,
            _ => 0d
        };
        if (sign == 0) continue;
        var barcode = NormBarcode(cells[6]);
        if (barcode.Length == 0) barcode = NormBarcode(cells[5]);
        if (barcode.Length == 0) continue;
        if (!double.TryParse(cells[8].Trim(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var qty))
            continue;
        var name = cells[7].Trim();
        if (!map.TryGetValue(barcode, out var sale))
        {
            sale = new SaleLine(barcode, name, 0);
            map[barcode] = sale;
        }
        sale.Qty += qty * sign;
        if (sale.Name.Length == 0 && name.Length > 0) sale.Name = name;
    }
    return map.Values.ToList();
}

static List<string> SplitCsv(string line)
{
    var cells = new List<string>();
    var current = new System.Text.StringBuilder();
    var quoted = false;
    foreach (var ch in line)
    {
        if (ch == '"') { quoted = !quoted; continue; }
        if (ch == ',' && !quoted)
        {
            cells.Add(current.ToString());
            current.Clear();
            continue;
        }
        current.Append(ch);
    }
    cells.Add(current.ToString());
    return cells;
}

static string ProductType(string name)
{
    var text = name.Replace("EV", "", StringComparison.OrdinalIgnoreCase);
    (string Key, string Label)[] types =
    [
        ("شامبو", "شامبو"),
        ("بلسم", "بلسم"),
        ("قناع وجه", "قناع وجه"),
        ("قناع", "قناع شعر"),
        ("مثبت", "مثبت شعر"),
        ("بخاخ", "بخاخ"),
        ("رغوة", "رغوة"),
        ("سيروم", "سيروم"),
        ("كريم", "كريم"),
        ("لوشن", "لوشن"),
        ("مقشر", "مقشر"),
        ("ميسيلار", "ماء ميسيلار"),
        ("ماء", "ماء"),
        ("جل تنظيف", "جل تنظيف"),
        ("جل استحام", "جل استحمام"),
        ("جل ", "جل"),
        ("زيت", "زيت"),
        ("صابون", "صابون"),
        ("مزيل", "مزيل"),
        ("واقي", "واقي"),
        ("مرطب", "مرطب"),
    ];
    foreach (var (key, label) in types)
        if (text.Contains(key, StringComparison.Ordinal)) return label;
    return "أخرى";
}

static int TypeOrder(string type)
{
    string[] order = ["شامبو", "بلسم", "قناع شعر", "زيت", "مثبت شعر", "بخاخ", "رغوة", "كريم", "سيروم", "لوشن", "مرطب", "جل تنظيف", "جل استحمام", "جل", "قناع وجه", "مقشر", "ماء ميسيلار", "ماء", "صابون", "مزيل", "واقي", "أخرى"];
    var index = Array.IndexOf(order, type);
    return index < 0 ? order.Length : index;
}

static string NormBarcode(string? value)
{
    var text = (value ?? "").Trim();
    if (text.Length == 0) return "";
    if (double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number)
        && number is > 0 and < 1e16)
        text = number.ToString("0", System.Globalization.CultureInfo.InvariantCulture);
    return text.TrimStart('0').Length == 0 ? text : text;
}

static async Task<double> ObservedMonthsAsync()
{
    await using var sql = new SqlConnection(
        @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
    await sql.OpenAsync();
    await using var cmd = sql.CreateCommand();
    cmd.CommandText = """
        SELECT MIN(r.creation_date), MAX(r.creation_date)
        FROM reciept_items ri
        INNER JOIN reciepts r ON r.id = ri.reciept_id
        LEFT JOIN point_of_sales p ON p.id = r.point_of_sale_id
        WHERE COALESCE(r.is_pending, 0) = 0
          AND r.kind IN (0, 1)
          AND (
                p.section_id IN (1, 2, 3, 4, 8, 9, 10)
                OR r.cashier_id IN (1, 3, 4, 5)
              )
        """;
    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync() || reader.IsDBNull(0) || reader.IsDBNull(1))
        return 1;
    var first = reader.GetDateTime(0);
    var last = reader.GetDateTime(1);
    var days = Math.Max(1, (last.Date - first.Date).TotalDays + 1);
    return Math.Max(1, days / 30.437);
}

static async Task<Dictionary<long, double>> LoadSectionSalesAsync()
{
    var map = new Dictionary<long, double>();
    await using var sql = new SqlConnection(
        @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
    await sql.OpenAsync();
    await using var cmd = sql.CreateCommand();
    // 138 و136، كاشير زينب وسلوان ونبا، وكل الدلفري. الكمية الصافية بعد المرتجع.
    cmd.CommandText = """
        SELECT a.Seq,
               CAST(SUM(CASE
                   WHEN r.kind = 1 THEN -ri.quantity
                   WHEN r.kind = 0 THEN ri.quantity
                   ELSE 0 END) AS FLOAT) AS Qty
        FROM reciept_items ri
        INNER JOIN reciepts r ON r.id = ri.reciept_id
        INNER JOIN articles a ON a.id = ri.article_id
        LEFT JOIN point_of_sales p ON p.id = r.point_of_sale_id
        WHERE COALESCE(r.is_pending, 0) = 0
          AND r.kind IN (0, 1)
          AND (
                p.section_id IN (1, 2, 3, 4, 8, 9, 10)
                OR r.cashier_id IN (1, 3, 4, 5)
              )
        GROUP BY a.Seq
        """;
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        if (reader.IsDBNull(0)) continue;
        map[Convert.ToInt64(reader.GetValue(0))] = reader.IsDBNull(1) ? 0 : Convert.ToDouble(reader.GetValue(1));
    }
    return map;
}

static double Remaining(Node p)
{
    // الأداري ينسخ رصيد الشركة في الحقول الثلاثة عندما لا يوجد توزيع مختلف بين المخازن.
    // الجمع في هذه الحالة يضاعف المتبقي ثلاث مرات. نجمع فقط عندما تختلف المستودعات فعلاً.
    var split = Math.Abs(p.Cur1 - p.Cur2) > 0.001 || Math.Abs(p.Cur1 - p.Cur3) > 0.001;
    return split ? p.Cur1 + p.Cur2 + p.Cur3 : p.Cur1;
}

static void SetQty(IXLCell cell, double value)
{
    cell.Value = value;
    cell.Style.NumberFormat.Format = "#,##0.##";
    cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
}

static string Txt(object? value)
{
    if (value is null || value is DBNull) return "";
    return Convert.ToString(value)?.Trim() ?? "";
}

static double Num(DbDataReader r, int i)
{
    if (r.IsDBNull(i)) return 0;
    var v = Convert.ToDouble(r.GetValue(i));
    return double.IsFinite(v) ? v : 0;
}

static bool HasArabic(string? s) =>
    !string.IsNullOrWhiteSpace(s) && s.Any(ch => ch is >= '\u0600' and <= '\u06FF');

static async Task<Dictionary<long, string>> LoadSqlNamesAsync()
{
    var map = new Dictionary<long, string>();
    try
    {
        await using var sql = new SqlConnection(
            @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
        await sql.OpenAsync();
        await using var cmd = sql.CreateCommand();
        cmd.CommandText = """
            SELECT Seq, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1)))
            FROM articles
            WHERE Seq IS NOT NULL AND Seq <> 0
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            if (r.IsDBNull(0)) continue;
            map[Convert.ToInt64(r.GetValue(0))] = r.IsDBNull(1) ? "" : r.GetString(1).Trim();
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine("تعذر قراءة الأسماء العربية من SQL: " + ex.Message);
    }
    return map;
}

sealed class SaleLine(string barcode, string name, double qty)
{
    public string Barcode { get; } = barcode;
    public string Name { get; set; } = name;
    public double Qty { get; set; } = qty;
}

sealed record Row(string Barcode, string Name, double Sold, double Remain);

sealed class Node(
    long seq, long father, string num, string barcode, string name1, string name2,
    double purchased, double sold, double cur1, double cur2, double cur3)
{
    public long Seq { get; } = seq;
    public long Father { get; } = father;
    public string Num { get; } = num;
    public string Barcode { get; } = barcode;
    public string Name1 { get; } = name1;
    public string Name2 { get; } = name2;
    public double Purchased { get; } = purchased;
    public double Sold { get; } = sold;
    public double Cur1 { get; } = cur1;
    public double Cur2 { get; } = cur2;
    public double Cur3 { get; } = cur3;
    public string Name { get; set; } = name1;
}
