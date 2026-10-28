using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var apply = args.Any(a => string.Equals(a, "--apply", StringComparison.OrdinalIgnoreCase));
var probeOnly = args.Any(a => string.Equals(a, "--probe", StringComparison.OrdinalIgnoreCase));
var pullPrices = args.Any(a => string.Equals(a, "--pull", StringComparison.OrdinalIgnoreCase));
var pushPrices = args.Any(a => string.Equals(a, "--push", StringComparison.OrdinalIgnoreCase));
// --round 250 → تقريب السعر الجديد لأقرب مضاعف (نصف المضاعف يُقرَّب للأعلى)
var roundTo = 0.0;
for (var i = 0; i < args.Length - 1; i++)
{
    if (string.Equals(args[i], "--round", StringComparison.OrdinalIgnoreCase)
        && double.TryParse(args[i + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out var rv) && rv > 0)
        roundTo = rv;
}
var excelDir = @"C:\Users\Future of Technology\Desktop";
var skipPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
for (var i = 0; i < args.Length - 1; i++)
{
    if (string.Equals(args[i], "--report", StringComparison.OrdinalIgnoreCase))
        skipPaths.Add(Path.GetFullPath(args[i + 1].Trim('"', '\'')));
}

var fileArgs = args
    .Where(a => !a.StartsWith("--", StringComparison.Ordinal))
    .Select(a => Path.GetFullPath(a.Trim('"', '\'')))
    .Where(p => File.Exists(p) && !skipPaths.Contains(p))
    .ToList();
var sources = fileArgs.Count > 0
    ? fileArgs.ToArray()
    :
    [
        Path.Combine(excelDir, "Rediant.xlsx"),
        Path.Combine(excelDir, "Elixir.xlsx"),
    ];
var reportPath = sources.Length == 1 && sources[0].Contains("MUA", StringComparison.OrdinalIgnoreCase)
    ? Path.Combine(excelDir, "تحديث-اسعار-MUA-المستهلك.xlsx")
    : Path.Combine(excelDir, "تحديث-اسعار-المستهلك.xlsx");
for (var i = 0; i < args.Length - 1; i++)
{
    if (string.Equals(args[i], "--report", StringComparison.OrdinalIgnoreCase))
        reportPath = Path.GetFullPath(args[i + 1].Trim('"', '\''));
}

if (probeOnly)
{
    foreach (var path in sources)
        ProbeExcel(path);
    return;
}

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

var databaseAlias = ResolveDatabaseAlias(args);
await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = $"server=127.0.0.1;database={databaseAlias};port=16000;Native=true";
await conn.OpenAsync();
Console.WriteLine($"متصل بقاعدة Edari: {databaseAlias}  (المصدر: {baseDir})");

if (pullPrices)
{
    if (sources.Length == 0) throw new InvalidOperationException("مرّر مسار ملف الإكسل.");
    await PullEdariPricesAsync(conn, sources[0]);
    return;
}

if (pushPrices)
{
    if (sources.Length == 0) throw new InvalidOperationException("مرّر مسار ملف الإكسل.");
    await PushEdariPricesAsync(conn, sources[0]);
    return;
}

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
        var target = roundTo > 0 && row.ShelfPrice > 0
            ? Math.Round(row.ShelfPrice / roundTo, MidpointRounding.AwayFromZero) * roundTo
            : row.ShelfPrice;
        var name = ResolveName(mat, sqlBySeq);
        var before = edari;
        var needsUpdate = target > 0 && Math.Abs(edari - target) >= 0.009;
        var status = needsUpdate
            ? "يحتاج تحديث في الإداري"
            : target > 0
                ? "متطابق — سعر الإداري = سعر الملف"
                : "لا سعر في الملف";
        report.Add(new ReportRow(row, mat with { Name1 = name }, status, before, target, edari, needsUpdate));
    }
}

WriteReport(reportPath, report);
Console.WriteLine($"ملف المقارنة: {reportPath}");

var missing = report.Count(x => x.Status.StartsWith("غير موجود", StringComparison.Ordinal));
var found = report.Where(x => x.Mat is not null).ToList();
var changed = found.Count(x => x.Changed);
var same = found.Count(x => x.Status.StartsWith("متطابق", StringComparison.Ordinal) || x.Status.StartsWith("مطابق", StringComparison.Ordinal));
var pending = found.Count(x => x.Status.StartsWith("يحتاج", StringComparison.Ordinal));
Console.WriteLine($"الموجود في الإداري: {found.Count} | يحتاج تحديث {pending} | مطابق {same} | غير موجود في الإداري {missing}");
if (pending > 0)
{
    foreach (var row in found.Where(x => x.Changed).Take(12))
        Console.WriteLine($"  → {row.Excel.Barcode} Seq {row.Mat!.Seq}: {row.Before} → {row.After}");
}

if (!apply)
{
    Console.WriteLine("لم يُنفَّذ تحديث (وضع تقرير فقط). أضف --apply لتطبيق التغييرات.");
    return;
}

var toUpdate = report.Where(x => x.Mat is not null && x.Changed).ToList();
Console.WriteLine($"سيتم تحديث: {toUpdate.Count}");

var done = 0;
var errors = 0;
var appliedSeqs = new HashSet<long>();
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
        appliedSeqs.Add(mat.Seq);
    }
    catch (Exception ex)
    {
        errors++;
        Console.WriteLine($"ERR Seq {mat.Seq} {row.Excel.Barcode}: {ex.Message.Split('\n')[0]}");
    }
}

Console.WriteLine($"تم تحديث SellPr4 (سعر المستهلك) في الإداري: {done} | أخطاء: {errors}");

// تقرير ما بعد التغيير: نفس الصفوف مع حالة التنفيذ الفعلية
var finalReport = report.Select(x =>
    x.Mat is not null && x.Changed
        ? x with { Status = appliedSeqs.Contains(x.Mat.Seq) ? "تم التحديث في الإداري" : "فشل التحديث" }
        : x).ToList();
WriteReport(reportPath, finalReport);
Console.WriteLine($"تقرير ما بعد التغيير: {reportPath}");

static string ResolveDatabaseAlias(string[] args)
{
    for (var i = 0; i < args.Length - 1; i++)
    {
        if (string.Equals(args[i], "--database", StringComparison.OrdinalIgnoreCase)
            || string.Equals(args[i], "--db", StringComparison.OrdinalIgnoreCase))
        {
            var v = args[i + 1].Trim();
            if (!string.IsNullOrEmpty(v)) return v;
        }
    }

    try
    {
        using var sql = new SqlConnection(
            @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
        sql.Open();
        using var cmd = sql.CreateCommand();
        cmd.CommandText = """
            SELECT TOP 1 LTRIM(RTRIM(database_alias))
            FROM ext_edari_settings
            WHERE enabled = 1 AND NULLIF(LTRIM(RTRIM(database_alias)), N'') IS NOT NULL
            ORDER BY id DESC
            """;
        var fromDb = Convert.ToString(cmd.ExecuteScalar())?.Trim();
        if (!string.IsNullOrEmpty(fromDb))
            return fromDb;
    }
    catch (Exception ex)
    {
        Console.WriteLine("تعذر قراءة database_alias من FOT POS: " + ex.Message);
    }

    return "2026";
}

static async Task PushEdariPricesAsync(DbConnection conn, string path)
{
    var (byCode, _) = await LoadPriceCatalogAsync(conn);
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);
    var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 1;
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
    var headers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    for (var c = 1; c <= lastCol; c++)
    {
        var name = ws.Cell(1, c).GetString().Trim();
        if (!string.IsNullOrEmpty(name)) headers[name] = c;
    }

    int Require(params string[] names)
    {
        foreach (var n in names)
            if (headers.TryGetValue(n, out var c)) return c;
        throw new InvalidOperationException("عمود غير موجود: " + string.Join(" / ", names));
    }

    var idCol = Require("رقم المادة", "الباركود", "Barcode");
    var wholesaleCol = Require("الجملة", "سعر الجملة");
    var consumerCol = Require("سعر المستهلك", "المستهلك");

    var updated = 0;
    var unchanged = 0;
    var missing = 0;
    var skipped = 0;
    var errors = 0;
    for (var r = 2; r <= lastRow; r++)
    {
        var code = NormalizeBarcode(CellText(ws.Cell(r, idCol)));
        if (string.IsNullOrEmpty(code)) continue;
        var wholesale = ParsePrice(CellText(ws.Cell(r, wholesaleCol)));
        var consumer = ParsePrice(CellText(ws.Cell(r, consumerCol)));
        if (wholesale <= 0 && consumer <= 0)
        {
            skipped++;
            Console.WriteLine($"  تخطي {code}: السعر غير صالح");
            continue;
        }

        var hits = FindPrice(byCode, code).Where(m => !m.IsFolder).GroupBy(m => m.Seq).Select(g => g.First()).ToList();
        if (hits.Count == 0)
        {
            missing++;
            Console.WriteLine($"  غير موجود: {code}");
            continue;
        }

        var exact = hits.Where(m =>
            string.Equals(m.Barcode, code, StringComparison.Ordinal)
            || string.Equals(NormalizeBarcode(m.Num), code, StringComparison.Ordinal)).ToList();
        var pool = exact.Count > 0 ? exact : hits;
        if (pool.Count > 1)
        {
            skipped++;
            Console.WriteLine($"  تخطي {code}: أكثر من مادة ({string.Join(",", pool.Select(m => m.Seq))})");
            continue;
        }

        var chosen = pool[0];
        var newWholesale = wholesale > 0 ? wholesale : chosen.SellPr1;
        var newConsumer = consumer > 0 ? consumer : chosen.SellPr4;
        if (Math.Abs(chosen.SellPr1 - newWholesale) < 0.009 && Math.Abs(chosen.SellPr4 - newConsumer) < 0.009)
        {
            unchanged++;
            continue;
        }

        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                $"UPDATE File13n SET SellPr1 = {newWholesale.ToString(CultureInfo.InvariantCulture)}, SellPr4 = {newConsumer.ToString(CultureInfo.InvariantCulture)} WHERE Seq = {chosen.Seq}";
            cmd.CommandTimeout = 120;
            var n = await cmd.ExecuteNonQueryAsync();
            if (n == 0)
            {
                errors++;
                Console.WriteLine($"  لم يُحدَّث Seq {chosen.Seq} {code}");
                continue;
            }
            updated++;
            Console.WriteLine($"  Seq {chosen.Seq} {code}: جملة {chosen.SellPr1} → {newWholesale} | مستهلك {chosen.SellPr4} → {newConsumer}");
        }
        catch (Exception ex)
        {
            errors++;
            Console.WriteLine($"  ERR {code}: {ex.Message.Split('\n')[0]}");
        }
    }

    Console.WriteLine($"تم التحديث: {updated} | مطابق مسبقاً: {unchanged} | غير موجود: {missing} | متخطى: {skipped} | أخطاء: {errors}");
}

static async Task<(Dictionary<string, List<PriceMat>> ByCode, Dictionary<long, PriceMat> BySeq)> LoadPriceCatalogAsync(DbConnection conn)
{
    var folders = new HashSet<long>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT DISTINCT Father FROM File13n WHERE Father IS NOT NULL AND Father > 0";
        cmd.CommandTimeout = 600;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            folders.Add(ToLong(r.GetValue(0)));
    }

    var bySeq = new Dictionary<long, PriceMat>();
    var byCode = new Dictionary<string, List<PriceMat>>(StringComparer.Ordinal);
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT Seq, Num, Name1, Barcode, SellPr1, SellPr4 FROM File13n";
        cmd.CommandTimeout = 600;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = ToLong(r.GetValue(0));
            var mat = new PriceMat(
                seq,
                ReadStr(r.GetValue(1)),
                ReadStr(r.GetValue(2)),
                NormalizeBarcode(ReadStr(r.GetValue(3))),
                ToDouble(r.GetValue(4)),
                ToDouble(r.GetValue(5)),
                folders.Contains(seq));
            bySeq[seq] = mat;
            IndexPrice(byCode, mat.Num, mat);
            IndexPrice(byCode, mat.Barcode, mat);
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
            if (string.IsNullOrEmpty(code) || !bySeq.TryGetValue(seq, out var mat)) continue;
            IndexPrice(byCode, code, mat);
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine("تعذر قراءة الباركود الإضافي: " + ex.Message.Split('\n')[0]);
    }

    return (byCode, bySeq);
}

static async Task PullEdariPricesAsync(DbConnection conn, string path)
{
    var folders = new HashSet<long>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT DISTINCT Father FROM File13n WHERE Father IS NOT NULL AND Father > 0";
        cmd.CommandTimeout = 600;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            folders.Add(ToLong(r.GetValue(0)));
    }

    var bySeq = new Dictionary<long, PriceMat>();
    var byCode = new Dictionary<string, List<PriceMat>>(StringComparer.Ordinal);
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT Seq, Num, Name1, Barcode, SellPr1, SellPr4 FROM File13n";
        cmd.CommandTimeout = 600;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = ToLong(r.GetValue(0));
            var mat = new PriceMat(
                seq,
                ReadStr(r.GetValue(1)),
                ReadStr(r.GetValue(2)),
                NormalizeBarcode(ReadStr(r.GetValue(3))),
                ToDouble(r.GetValue(4)),
                ToDouble(r.GetValue(5)),
                folders.Contains(seq));
            bySeq[seq] = mat;
            IndexPrice(byCode, mat.Num, mat);
            IndexPrice(byCode, mat.Barcode, mat);
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
            if (string.IsNullOrEmpty(code) || !bySeq.TryGetValue(seq, out var mat)) continue;
            IndexPrice(byCode, code, mat);
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine("تعذر قراءة الباركود الإضافي: " + ex.Message.Split('\n')[0]);
    }

    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);
    var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 1;
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
    var (headerRow, headerMap) = FindHeaderMap(ws);
    var idCol = TryCol(headerMap, "رقم المادة", "الباركود", "Barcode", "كود", "EAN")
        ?? throw new InvalidOperationException("تعذر العثور على عمود الباركود في الملف");
    var fileSpecialCol = TryCol(headerMap, "خاص");

    int Col(string name)
    {
        for (var c = 1; c <= lastCol; c++)
        {
            if (string.Equals(ws.Cell(headerRow, c).GetString().Trim(), name, StringComparison.OrdinalIgnoreCase))
                return c;
        }
        lastCol++;
        ws.Cell(headerRow, lastCol).Value = name;
        return lastCol;
    }

    int ColAdd(string name) => Col(name);
    var wholesaleCol = ColAdd("سعر الجملة");
    var consumerCol = ColAdd("سعر المستهلك (SellPr4)");
    var seqCol = ColAdd("Seq الإداري");
    var statusCol = ColAdd("مطابقة الإداري");

    var found = 0;
    var missing = 0;
    var multi = 0;
    var dataStart = headerRow + 1;
    for (var r = dataStart; r <= lastRow; r++)
    {
        var code = NormalizeBarcode(CellText(ws.Cell(r, idCol)));
        if (string.IsNullOrEmpty(code)) continue;
        var hits = FindPrice(byCode, code).Where(m => !m.IsFolder).GroupBy(m => m.Seq).Select(g => g.First()).ToList();
        if (hits.Count == 0)
        {
            missing++;
            ws.Cell(r, wholesaleCol).Clear();
            ws.Cell(r, consumerCol).Clear();
            ws.Cell(r, seqCol).Clear();
            ws.Cell(r, statusCol).Value = "غير موجود";
            continue;
        }

        var exact = hits.Where(m =>
            string.Equals(m.Barcode, code, StringComparison.Ordinal)
            || string.Equals(NormalizeBarcode(m.Num), code, StringComparison.Ordinal)).ToList();
        var chosen = (exact.Count > 0 ? exact : hits)
            .OrderByDescending(m => string.Equals(m.Barcode, code, StringComparison.Ordinal))
            .ThenByDescending(m => m.SellPr4 > 0)
            .First();
        if (hits.Count > 1) multi++;
        found++;
        WriteMoney(ws.Cell(r, wholesaleCol), chosen.SellPr1);
        WriteMoney(ws.Cell(r, consumerCol), chosen.SellPr4);
        ws.Cell(r, seqCol).Value = chosen.Seq;
        ws.Cell(r, seqCol).Style.NumberFormat.Format = "0";
        if (fileSpecialCol is not null)
        {
            var fileSpecial = ParsePrice(CellText(ws.Cell(r, fileSpecialCol.Value)));
            if (fileSpecial > 0 && Math.Abs(chosen.SellPr4 - fileSpecial) >= 0.009)
                ws.Cell(r, statusCol).Value = hits.Count > 1
                    ? $"يختلف عن خاص ({hits.Count} مواد — Seq {chosen.Seq})"
                    : "يختلف عن عمود خاص";
            else if (fileSpecial > 0)
                ws.Cell(r, statusCol).Value = hits.Count > 1
                    ? $"مطابق خاص ({hits.Count} مواد — Seq {chosen.Seq})"
                    : "مطابق عمود خاص";
            else
                ws.Cell(r, statusCol).Value = hits.Count > 1 ? $"مطابق ({hits.Count} مواد)" : "مطابق";
        }
        else
            ws.Cell(r, statusCol).Value = hits.Count > 1 ? $"مطابق ({hits.Count} مواد — Seq {chosen.Seq})" : "مطابق";
    }

    ws.Column(wholesaleCol).Style.NumberFormat.Format = "#,##0";
    ws.Column(consumerCol).Style.NumberFormat.Format = "#,##0";
    ws.Column(seqCol).Style.NumberFormat.Format = "0";
    var header = ws.Range(headerRow, 1, headerRow, lastCol);
    header.Style.Font.Bold = true;
    header.Style.Font.FontColor = XLColor.White;
    header.Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3A5F");
    ws.Columns(wholesaleCol, statusCol).AdjustToContents(1, Math.Min(lastRow, 40));

    try
    {
        wb.SaveAs(path);
        Console.WriteLine(path);
    }
    catch (IOException)
    {
        var alt = Path.Combine(Path.GetDirectoryName(path)!,
            Path.GetFileNameWithoutExtension(path) + "-أسعار-الإداري.xlsx");
        wb.SaveAs(alt);
        Console.WriteLine("الملف مفتوح — حُفظ: " + alt);
    }

    Console.WriteLine($"مطابق: {found} | غير موجود: {missing} | أكثر من مادة: {multi}");
}

static void WriteMoney(IXLCell cell, double value)
{
    cell.Value = value;
    cell.Style.NumberFormat.Format = "#,##0";
}

static void IndexPrice(Dictionary<string, List<PriceMat>> map, string? code, PriceMat mat)
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

static IEnumerable<PriceMat> FindPrice(Dictionary<string, List<PriceMat>> byCode, string barcode)
{
    if (byCode.TryGetValue(barcode, out var exact))
        return exact;
    var trimmed = barcode.TrimStart('0');
    if (trimmed.Length > 0 && trimmed != barcode && byCode.TryGetValue(trimmed, out var alt))
        return alt;
    return [];
}

static void ProbeExcel(string path)
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheets.Worksheet(1);
    Console.WriteLine($"=== {Path.GetFileName(path)} | ورقة: {ws.Name} ===");
    for (var r = 1; r <= Math.Min(6, ws.LastRowUsed()?.RowNumber() ?? 6); r++)
    {
        var parts = new List<string>();
        foreach (var cell in ws.Row(r).CellsUsed())
        {
            var t = cell.GetFormattedString().Trim();
            if (!string.IsNullOrEmpty(t))
                parts.Add($"[{cell.Address.ColumnNumber}]={t}");
        }
        if (parts.Count > 0)
            Console.WriteLine($"  صف {r}: {string.Join(" | ", parts)}");
    }
}

static List<ExcelPriceRow> ReadExcel(string path)
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheets.Worksheet(1);
    var (headerRow, map) = FindHeaderMap(ws);
    int Col(params string[] names)
    {
        foreach (var n in names)
            if (map.TryGetValue(n, out var c)) return c;
        throw new InvalidOperationException($"عمود غير موجود في {Path.GetFileName(path)} (صف {headerRow}): {string.Join("/", names)}");
    }

    var brandCol = TryCol(map, "Brand", "العلامة", "الماركة", "البراند") ?? 0;
    var nameCol = TryCol(map, "Product name", "الاسم", "اسم المادة", "المادة", "المنتج", "اسم المنتج", "Product Name", "Description", "الاسم الإنكليزي") ?? 0;
    var barcodeCol = Col("Barcode", "الباركود", "رمز الباركود", "EAN", "EAN/UPC", "UPC", "كود");
    var priceCol = Col(
        "سعر الرف الجديد", "خاص", "المستهلك دينار", "Updated RSP", "New RSP", "RSP", "Shelf price", "سعر الرف", "سعر المستهلك", "سعر الرف الحالي",
        "Consumer price", "Consumer Price", "Retail price", "Retail Price", "SRP", "سعر البيع", "السعر");
    var source = Path.GetFileNameWithoutExtension(path);
    var rows = new List<ExcelPriceRow>();
    var dataStart = headerRow + 1;

    foreach (var xlRow in ws.RowsUsed())
    {
        if (xlRow.RowNumber() < dataStart) continue;
        var barcode = NormalizeBarcode(CellText(xlRow.Cell(barcodeCol)));
        if (string.IsNullOrEmpty(barcode)) continue;
        var price = ParsePrice(CellText(xlRow.Cell(priceCol)));
        rows.Add(new ExcelPriceRow(
            source,
            brandCol > 0 ? CellText(xlRow.Cell(brandCol)) : "",
            nameCol > 0 ? CellText(xlRow.Cell(nameCol)) : "",
            barcode,
            price,
            xlRow.RowNumber()));
    }

    return rows;
}

static int? TryCol(Dictionary<string, int> map, params string[] names)
{
    foreach (var n in names)
        if (map.TryGetValue(n, out var c)) return c;
    return null;
}

static (int HeaderRow, Dictionary<string, int> Map) FindHeaderMap(IXLWorksheet ws)
{
    var last = ws.LastRowUsed()?.RowNumber() ?? 1;
    for (var r = 1; r <= Math.Min(8, last); r++)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var cell in ws.Row(r).CellsUsed())
        {
            var name = cell.GetString().Trim();
            if (!string.IsNullOrEmpty(name))
                map[name] = cell.Address.ColumnNumber;
        }
        if (map.Keys.Any(k => ContainsAny(k, "barcode", "باركود", "ean", "upc", "كود"))
            && map.Keys.Any(k => ContainsAny(k, "price", "سعر", "retail", "shelf", "consumer", "رف", "مستهلك", "خاص", "rsp")))
            return (r, map);
    }

    throw new InvalidOperationException($"تعذر اكتشاف صف العناوين في {ws.Name}");
}

static bool ContainsAny(string haystack, params string[] needles)
{
    foreach (var n in needles)
        if (haystack.Contains(n, StringComparison.OrdinalIgnoreCase))
            return true;
    return false;
}

static void WriteReport(string path, List<ReportRow> rows)
{
    using var wb = new XLWorkbook();
    var summary = wb.AddWorksheet("ملخص");
    summary.RightToLeft = true;
    var matched = rows.Count(r => r.Mat is not null && r.Status.StartsWith("متطابق", StringComparison.Ordinal));
    var pending = rows.Count(r => r.Changed);
    var missing = rows.Count(r => r.Status.StartsWith("غير موجود", StringComparison.Ordinal));
    summary.Cell(1, 1).Value = "ملخص مقارنة الأسعار (سعر الملف ↔ SellPr4 في الإداري)";
    summary.Cell(2, 1).Value = $"متطابق: {matched} | يحتاج تحديث: {pending} | غير موجود في الإداري: {missing}";
    summary.Cell(3, 1).Value = "ورقة «الكل»: كل الأسعار. إذا نُفّذ التحديث سابقاً ستظهر «متطابق» والفرق = 0.";
    summary.Cell(4, 1).Value = "ورقة «يحتاج تحديث»: فقط ما يختلف سعر الإداري عن سعر الملف.";
    WriteSheet(wb.AddWorksheet("الكل"), rows);
    WriteSheet(wb.AddWorksheet("غير موجود"), rows.Where(r => r.Status.StartsWith("غير موجود", StringComparison.Ordinal)).ToList(), highlightMissingAll: true);
    WriteSheet(wb.AddWorksheet("يحتاج تحديث"),
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
        "Seq", "اسم الإداري", "رقم المادة", "سعر الإداري (SellPr4)", "سعر الملف", "الفرق (ملف − إداري)", "سعر الملف قبل التقريب",
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
        ws.Cell(r, 12).Value = row.Excel.ShelfPrice;
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
sealed record PriceMat(long Seq, string Num, string Name1, string Barcode, double SellPr1, double SellPr4, bool IsFolder);
sealed record ReportRow(ExcelPriceRow Excel, EdariMat? Mat, string Status, double Before, double After, double EdariNow, bool Changed)
{
    public static ReportRow Missing(ExcelPriceRow excel) =>
        new(excel, null, "غير موجود", 0, excel.ShelfPrice, 0, false);
}
