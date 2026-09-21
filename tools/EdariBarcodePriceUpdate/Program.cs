using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using ClosedXML.Excel;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var excelDir = @"C:\Users\Future of Technology\Desktop";
var sources = new[]
{
    Path.Combine(excelDir, "Rediant.xlsx"),
    Path.Combine(excelDir, "Elixir.xlsx"),
};
var reportPath = Path.Combine(excelDir, "تحديث-اسعار-المستهلك.xlsx");

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
conn.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
await conn.OpenAsync();

var excelRows = new List<ExcelPriceRow>();
foreach (var path in sources)
{
    if (!File.Exists(path)) throw new FileNotFoundException(path);
    excelRows.AddRange(ReadExcel(path));
}

Console.WriteLine($"صفوف الإكسل: {excelRows.Count}");

var folders = new HashSet<long>();
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT DISTINCT Father FROM File13n WHERE Father IS NOT NULL AND Father > 0";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        folders.Add(ToLong(r.GetValue(0)));
}

var byCode = new Dictionary<string, List<EdariMat>>(StringComparer.Ordinal);
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT Seq, Num, Name1, Barcode, SellPr4 FROM File13n";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var mat = new EdariMat(
            ToLong(r.GetValue(0)),
            ReadStr(r.GetValue(1)),
            ReadStr(r.GetValue(2)),
            ReadStr(r.GetValue(3)),
            ToDouble(r.GetValue(4)),
            folders.Contains(ToLong(r.GetValue(0))));
        Index(byCode, mat.Barcode, mat);
        Index(byCode, mat.Num, mat);
    }
}

try
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT EdNum, BarCode FROM File13BC";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var code = NormalizeBarcode(ReadStr(r.GetValue(1)));
        if (string.IsNullOrEmpty(code) || !byCode.TryGetValue(code, out var list))
            continue;
        var extra = list.FirstOrDefault(x => x.Seq == seq);
        if (extra is not null) Index(byCode, code, extra);
    }
}
catch
{
    /* جدول الباركود الإضافي قد لا يوجد */
}

var sqlBySeq = await LoadSqlArticlesAsync();
var hayatBySeq = await LoadHayatPricesAsync();
Console.WriteLine($"أسعار/أسماء نقطة البيع: {sqlBySeq.Count} | أسعار HAYAT القديمة: {hayatBySeq.Count}");

var report = new List<ReportRow>();
foreach (var row in excelRows)
{
    var hits = Find(byCode, row.Barcode)
        .Where(m => !m.IsFolder)
        .GroupBy(m => m.Seq)
        .Select(g => g.First())
        .ToList();

    if (hits.Count == 0)
    {
        report.Add(ReportRow.Missing(row));
        continue;
    }

    foreach (var mat in hits)
    {
        var edari = mat.SellPr4;
        var target = row.ShelfPrice;
        var name = ResolveName(mat, sqlBySeq);
        var before = ResolveBeforePrice(mat.Seq, target, edari, sqlBySeq, hayatBySeq);
        var edariMatches = Math.Abs(edari - target) < 0.009;
        var priceChanged = Math.Abs(before - target) >= 0.009;
        string status;
        if (!edariMatches)
            status = "الإداري لا يطابق الملف";
        else if (priceChanged)
            status = "تم التحديث";
        else
            status = "مطابق — لا تغيير";
        report.Add(new ReportRow(row, mat with { Name1 = name }, status, before, target, edari, priceChanged && edariMatches));
    }
}

WriteReport(reportPath, report);
Console.WriteLine($"ملف المقارنة: {reportPath}");

var missing = report.Count(x => x.Status.StartsWith("غير موجود", StringComparison.Ordinal));
var found = report.Where(x => x.Mat is not null).ToList();
var changed = found.Count(x => x.Changed);
var edariMismatch = found.Count(x => x.Status.StartsWith("الإداري لا يطابق", StringComparison.Ordinal));
var same = found.Count(x => x.Status.StartsWith("مطابق", StringComparison.Ordinal));
Console.WriteLine($"الموجود: {found.Count} | تم التحديث {changed} | مطابق {same} | غير مطابق للملف {edariMismatch} | غير موجود {missing}");
if (edariMismatch > 0)
{
    foreach (var row in found.Where(x => x.Status.StartsWith("الإداري لا يطابق", StringComparison.Ordinal)).Take(10))
        Console.WriteLine($"  ! {row.Excel.Barcode} Seq {row.Mat!.Seq}: إداري={row.EdariNow} ملف={row.After}");
}

var apply = args.Any(a => string.Equals(a, "--apply", StringComparison.OrdinalIgnoreCase));
if (!apply)
{
    Console.WriteLine("لم يُنفَّذ تحديث (وضع تقرير فقط). أضف --apply لتطبيق التغييرات.");
    return;
}

var toUpdate = report.Where(x => x.Mat is not null && x.Changed).ToList();
Console.WriteLine($"سيتم تحديث: {toUpdate.Count}");

var done = 0;
var errors = 0;
foreach (var row in toUpdate)
{
    var mat = row.Mat!;
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            $"UPDATE File13n SET SellPr4 = {row.After.ToString(CultureInfo.InvariantCulture)} WHERE Seq = {mat.Seq}";
        cmd.CommandTimeout = 120;
        await cmd.ExecuteNonQueryAsync();
        done++;
    }
    catch (Exception ex)
    {
        errors++;
        Console.WriteLine($"ERR Seq {mat.Seq} {row.Excel.Barcode}: {ex.Message.Split('\n')[0]}");
    }
}

Console.WriteLine($"تم تحديث SellPr4 (سعر المستهلك) في الإداري: {done} | أخطاء: {errors}");

static List<ExcelPriceRow> ReadExcel(string path)
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheets.First();
    var header = ws.Row(2);
    var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    foreach (var cell in header.CellsUsed())
    {
        var name = cell.GetString().Trim();
        if (!string.IsNullOrEmpty(name))
            map[name] = cell.Address.ColumnNumber;
    }

    int Col(params string[] names)
    {
        foreach (var n in names)
            if (map.TryGetValue(n, out var c)) return c;
        throw new InvalidOperationException($"عمود غير موجود في {Path.GetFileName(path)}: {string.Join("/", names)}");
    }

    var brandCol = Col("Brand", "العلامة");
    var nameCol = Col("Product name", "الاسم", "المادة");
    var barcodeCol = Col("Barcode", "الباركود");
    var priceCol = Col("Shelf price", "سعر الرف", "سعر المستهلك");
    var source = Path.GetFileNameWithoutExtension(path);
    var rows = new List<ExcelPriceRow>();

    foreach (var xlRow in ws.RowsUsed().Skip(1))
    {
        if (xlRow.RowNumber() < 3) continue;
        var barcode = NormalizeBarcode(CellText(xlRow.Cell(barcodeCol)));
        if (string.IsNullOrEmpty(barcode)) continue;
        var price = ParsePrice(CellText(xlRow.Cell(priceCol)));
        rows.Add(new ExcelPriceRow(
            source,
            CellText(xlRow.Cell(brandCol)),
            CellText(xlRow.Cell(nameCol)),
            barcode,
            price,
            xlRow.RowNumber()));
    }

    return rows;
}

static void WriteReport(string path, List<ReportRow> rows)
{
    using var wb = new XLWorkbook();
    WriteSheet(wb.AddWorksheet("الكل"), rows);
    WriteSheet(wb.AddWorksheet("غير موجود"), rows.Where(r => r.Status.StartsWith("غير موجود", StringComparison.Ordinal)).ToList(), highlightMissingAll: true);
    WriteSheet(wb.AddWorksheet("تغيّر السعر"),
        rows.Where(r => r.Mat is not null && Math.Abs(r.Before - r.After) >= 0.009).ToList(),
        highlightChangedAll: true);
    SaveWorkbook(wb, path);
}

static void SaveWorkbook(XLWorkbook wb, string path)
{
    try
    {
        if (File.Exists(path)) File.Delete(path);
        wb.SaveAs(path);
        return;
    }
    catch (IOException)
    {
        var alt = Path.Combine(
            Path.GetDirectoryName(path)!,
            $"{Path.GetFileNameWithoutExtension(path)}-{DateTime.Now:yyyyMMdd-HHmm}{Path.GetExtension(path)}");
        wb.SaveAs(alt);
        Console.WriteLine($"الملف الأصلي مفتوح — حُفظت نسخة بديلة: {alt}");
    }
}

static void WriteSheet(IXLWorksheet ws, List<ReportRow> rows, bool highlightMissingAll = false, bool highlightChangedAll = false)
{
    ws.RightToLeft = true;
    ws.Style.Font.FontName = "Arial";
    var headers = new[]
    {
        "المصدر", "الحالة", "الباركود", "العلامة", "اسم الملف",
        "Seq", "اسم الإداري", "رقم المادة", "السعر قبل", "السعر بعد", "الفرق",
    };
    for (var i = 0; i < headers.Length; i++)
        ws.Cell(1, i + 1).Value = headers[i];
    ws.Row(1).Style.Font.Bold = true;
    ws.Row(1).Style.Fill.BackgroundColor = XLColor.FromHtml("#0F766E");
    ws.Row(1).Style.Font.FontColor = XLColor.White;

    var yellow = XLColor.FromHtml("#FDE68A");
    var redRow = XLColor.FromHtml("#FECACA");
    var redPrice = XLColor.FromHtml("#EF4444");
    var r = 2;
    foreach (var row in rows)
    {
        ws.Cell(r, 1).Value = row.Excel.Source;
        ws.Cell(r, 2).Value = row.Status;
        ws.Cell(r, 3).Value = row.Excel.Barcode;
        ws.Cell(r, 3).Style.NumberFormat.Format = "@";
        ws.Cell(r, 4).Value = row.Excel.Brand;
        ws.Cell(r, 5).Value = row.Excel.Name;
        ws.Cell(r, 6).Value = row.Mat?.Seq ?? 0;
        ws.Cell(r, 7).Value = row.Mat?.Name1 ?? "";
        ws.Cell(r, 8).Value = row.Mat?.Num ?? "";
        ws.Cell(r, 9).Value = row.Before;
        ws.Cell(r, 10).Value = row.After;
        ws.Cell(r, 11).Value = row.Mat is null ? 0 : row.After - row.Before;
        var missing = highlightMissingAll || row.Status.StartsWith("غير موجود", StringComparison.Ordinal);
        var changed = highlightChangedAll
            || (row.Mat is not null && Math.Abs(row.Before - row.After) >= 0.009);
        if (missing)
            ws.Row(r).Style.Fill.BackgroundColor = yellow;
        else if (changed)
        {
            ws.Row(r).Style.Fill.BackgroundColor = redRow;
            ws.Row(r).Style.Font.FontColor = XLColor.FromHtml("#7F1D1D");
            foreach (var col in new[] { 9, 10, 11 })
            {
                ws.Cell(r, col).Style.Fill.BackgroundColor = redPrice;
                ws.Cell(r, col).Style.Font.FontColor = XLColor.White;
                ws.Cell(r, col).Style.Font.Bold = true;
            }
        }
        r++;
    }

    ws.SheetView.FreezeRows(1);
    ws.Columns().AdjustToContents(1, 40);
}

static IEnumerable<EdariMat> Find(Dictionary<string, List<EdariMat>> byCode, string barcode)
{
    if (byCode.TryGetValue(barcode, out var exact))
        return exact;
    var trimmed = barcode.TrimStart('0');
    if (trimmed.Length > 0 && trimmed != barcode && byCode.TryGetValue(trimmed, out var alt))
        return alt;
    return [];
}

static void Index(Dictionary<string, List<EdariMat>> map, string? code, EdariMat mat)
{
    var key = NormalizeBarcode(code);
    if (string.IsNullOrEmpty(key)) return;
    if (!map.TryGetValue(key, out var list))
    {
        list = [];
        map[key] = list;
    }
    if (list.All(x => x.Seq != mat.Seq))
        list.Add(mat);
}

static async Task<Dictionary<long, SqlArticle>> LoadSqlArticlesAsync()
{
    var map = new Dictionary<long, SqlArticle>();
    try
    {
        await using var sql = new Microsoft.Data.SqlClient.SqlConnection(
            @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
        await sql.OpenAsync();
        await using var cmd = sql.CreateCommand();
        cmd.CommandText = """
            SELECT Seq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) AS Name1,
                   CAST(COALESCE(SellPr4, 0) AS FLOAT) AS SellPr4
            FROM articles
            WHERE Seq IS NOT NULL AND Seq <> 0
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = Convert.ToInt64(r.GetValue(0));
            map[seq] = new SqlArticle(
                ReadStr(r.GetValue(1)),
                r.IsDBNull(2) ? 0 : Convert.ToDouble(r.GetValue(2)));
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine("تعذر قراءة بيانات نقطة البيع: " + ex.Message);
    }
    return map;
}

static async Task<Dictionary<long, double>> LoadHayatPricesAsync()
{
    var map = new Dictionary<long, double>();
    try
    {
        await using var sql = new Microsoft.Data.SqlClient.SqlConnection(
            @"Server=localhost\FOTSQLSERVER;Database=HAYAT2025.mdf;Trusted_Connection=True;TrustServerCertificate=True;");
        await sql.OpenAsync();
        await using var cmd = sql.CreateCommand();
        cmd.CommandText = """
            SELECT Seq, CAST(COALESCE(SellPr4, 0) AS FLOAT) AS SellPr4
            FROM articles
            WHERE Seq IS NOT NULL AND Seq <> 0
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            map[Convert.ToInt64(r.GetValue(0))] = r.IsDBNull(1) ? 0 : Convert.ToDouble(r.GetValue(1));
    }
    catch (Exception ex)
    {
        Console.WriteLine("تعذر قراءة أسعار HAYAT القديمة: " + ex.Message);
    }
    return map;
}

static string ResolveName(EdariMat mat, Dictionary<long, SqlArticle> sqlBySeq)
{
    if (sqlBySeq.TryGetValue(mat.Seq, out var sql) && !string.IsNullOrWhiteSpace(sql.Name1))
        return sql.Name1;
    return mat.Name1;
}

static double ResolveBeforePrice(
    long seq,
    double target,
    double edariNow,
    Dictionary<long, SqlArticle> sqlBySeq,
    Dictionary<long, double> hayatBySeq)
{
    if (hayatBySeq.TryGetValue(seq, out var hayat) && hayat > 0 && Math.Abs(hayat - target) >= 0.009)
        return hayat;
    if (sqlBySeq.TryGetValue(seq, out var sql) && sql.SellPr4 > 0 && Math.Abs(sql.SellPr4 - target) >= 0.009)
        return sql.SellPr4;
    if (Math.Abs(edariNow - target) >= 0.009)
        return edariNow;
    return target;
}

static string CellText(IXLCell cell)
{
    if (cell.IsEmpty()) return "";
    if (cell.DataType == XLDataType.Number)
        return cell.GetDouble().ToString("0.############", CultureInfo.InvariantCulture);
    return cell.GetFormattedString().Trim();
}

static double ParsePrice(string raw)
{
    var t = raw.Trim().Replace(",", "").Replace(" ", "");
    if (double.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var n))
        return n;
    if (double.TryParse(t, NumberStyles.Any, new CultureInfo("ar-IQ"), out n))
        return n;
    return 0;
}

static string NormalizeBarcode(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return "";
    var t = raw.Trim();
    if (t.EndsWith(".0", StringComparison.Ordinal)) t = t[..^2];
    if (double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && n > 0 && Math.Abs(n - Math.Round(n)) < 0.001)
        t = Math.Round(n).ToString("0", CultureInfo.InvariantCulture);
    return t;
}

static string ReadStr(object? v) => v is null or DBNull ? "" : Convert.ToString(v)?.Trim() ?? "";

static long ToLong(object? v)
{
    if (v is null or DBNull) return 0;
    try { return Convert.ToInt64(Convert.ToDecimal(v)); }
    catch { return Convert.ToInt64(Convert.ToDouble(v)); }
}

static double ToDouble(object? v)
{
    if (v is null or DBNull) return 0;
    return Convert.ToDouble(v);
}

sealed record ExcelPriceRow(string Source, string Brand, string Name, string Barcode, double ShelfPrice, int ExcelRow);
sealed record SqlArticle(string Name1, double SellPr4);
sealed record EdariMat(long Seq, string Num, string Name1, string Barcode, double SellPr4, bool IsFolder);
sealed record ReportRow(ExcelPriceRow Excel, EdariMat? Mat, string Status, double Before, double After, double EdariNow, bool Changed)
{
    public static ReportRow Missing(ExcelPriceRow excel) =>
        new(excel, null, "غير موجود", 0, excel.ShelfPrice, 0, false);
}
