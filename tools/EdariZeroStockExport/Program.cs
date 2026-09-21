// أداة قراءة فقط: تقرير + نسخة احتياطية كاملة للمواد التي مخزونها = 0 بالضبط (وليس سالباً)
// في قاعدة Edari الحالية (2026). لا تنفّذ أي حذف — فقط تُجهّز التقرير والنسخة الاحتياطية
// وملف Seq المرشحة للحذف، وتنتظر أمراً صريحاً لاحقاً بالحذف الفعلي.
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026"; // القاعدة الحالية الفعلية — وفق ext_edari_settings وتأكيد المستخدم

var apiDirs = new[]
{
    @"C:\Program Files\FOT POS Server\Api",
    @"C:\Program Files\FOT POS\Server\Api",
    @"D:\FOTLabel\FOTLabel",
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

Console.WriteLine($"متصل بقاعدة Edari: {DatabaseAlias}  (المصدر: {baseDir})");

var columns = await GetColumnNamesAsync(conn, "File13n");
Console.WriteLine($"عدد أعمدة File13n: {columns.Count}");

// مسح خفيف لكل الجدول لبناء شجرة الأصل/الفرع وتصنيف أوراق المنتجات
Console.WriteLine("جاري مسح File13n لتحديد الأوراق (المنتجات) والمجلدات (الشجرة)...");
var nodes = new Dictionary<long, Node>();
var fatherSeqs = new HashSet<long>();
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT Seq, Father, Name1, Num, Barcode, CurTot1, CurTot2, CurTot3 FROM File13n";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var father = r.IsDBNull(1) ? 0L : ToLong(r.GetValue(1));
        nodes[seq] = new Node(seq, father, ReadStr(r.GetValue(2)), ReadStr(r.GetValue(3)), ReadStr(r.GetValue(4)),
            ToNullableDouble(r.GetValue(5)), ToNullableDouble(r.GetValue(6)), ToNullableDouble(r.GetValue(7)));
        if (father > 0) fatherSeqs.Add(father);
    }
}
Console.WriteLine($"إجمالي السجلات في File13n: {nodes.Count}");

var leafNodes = nodes.Values.Where(n => !fatherSeqs.Contains(n.Seq)).ToList();
var zeroExact = leafNodes.Where(n => n.CurTot1.HasValue && n.CurTot1.Value == 0).ToList();
var negative = leafNodes.Where(n => n.CurTot1.HasValue && n.CurTot1.Value < 0).ToList();
var nullStock = leafNodes.Where(n => !n.CurTot1.HasValue).ToList();
var positive = leafNodes.Where(n => n.CurTot1.HasValue && n.CurTot1.Value > 0).ToList();

Console.WriteLine();
Console.WriteLine("=== تقرير المخزون (المنتجات — الأوراق فقط، وليس مجلدات الشجرة) ===");
Console.WriteLine($"إجمالي المنتجات (أوراق الشجرة): {leafNodes.Count}");
Console.WriteLine($"  مخزون = 0 بالضبط (المرشحة للحذف): {zeroExact.Count}");
Console.WriteLine($"  مخزون سالب (لن تُحذف): {negative.Count}");
Console.WriteLine($"  مخزون غير محدد NULL (لن تُحذف — تحتاج مراجعة يدوية): {nullStock.Count}");
Console.WriteLine($"  مخزون أكبر من صفر: {positive.Count}");

if (zeroExact.Count == 0)
{
    Console.WriteLine();
    Console.WriteLine("لا توجد منتجات بمخزون = 0 بالضبط. لا حاجة لأي نسخة احتياطية أو حذف.");
    return;
}

// تحذير: منتجات لها مخزون في مستودع 2 أو 3 مع أن مستودع 1 = صفر
var stockElsewhere = zeroExact.Where(n => (n.CurTot2 ?? 0) != 0 || (n.CurTot3 ?? 0) != 0).ToList();
if (stockElsewhere.Count > 0)
{
    Console.WriteLine();
    Console.WriteLine($"تنبيه: {stockElsewhere.Count} من المنتجات المرشحة للحذف لديها مخزون في مستودع 2 أو 3 (مع أن مستودع 1 = صفر). راجعها في التقرير قبل الحذف.");
}

// ملاحظة مهمة عن الترميز: قراءة Name1 مباشرة من Edari عبر ADO تُعطي أحياناً حروفاً
// تالفة (U+FFFD) لأن الموفر يفكّ ترميز العربية بشكل خاطئ — هذه علة معروفة في نفس
// المشروع (EdariStringHelper + HayatLegacyNameService). الاسم الصحيح موجود فعلاً في
// جدول articles بقاعدة FOT_POS_V2 (تمت مزامنته ودمجه مسبقاً بشكل سليم)، فنجلبه من هناك
// لعرض الاسم الصحيح في التقرير وسكربت الاسترجاع، مع الاحتفاظ بالقيمة الخام أيضاً.
Console.WriteLine("جاري جلب الأسماء الصحيحة (المُصانة) من قاعدة FOT_POS_V2 لتفادي تلف الترميز...");
var correctedNames = new Dictionary<long, string>();
try
{
    await using var sql = new SqlConnection(
        @"Server=localhost\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;");
    await sql.OpenAsync();
    await using var cmd = sql.CreateCommand();
    cmd.CommandText = "SELECT Seq, Name1 FROM articles WHERE Seq IS NOT NULL AND Name1 IS NOT NULL";
    cmd.CommandTimeout = 120;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var name = r.IsDBNull(1) ? null : r.GetString(1).Trim();
        if (!string.IsNullOrWhiteSpace(name)) correctedNames[seq] = name;
    }
    Console.WriteLine($"أسماء صحيحة محمّلة من FOT_POS_V2.articles: {correctedNames.Count}");
}
catch (Exception ex)
{
    Console.WriteLine($"تنبيه: تعذر الاتصال بـ FOT_POS_V2 لتصحيح الأسماء ({ex.Message}) — سيُستخدم الاسم الخام من Edari كما هو (قد يحتوي رموزاً تالفة).");
}

string ResolveName(long seq, string? rawName) =>
    correctedNames.TryGetValue(seq, out var corrected) ? corrected : (rawName ?? "");

// بناء مسار الشجرة الكامل (breadcrumb) لكل منتج مرشح
string BuildTreePath(long seq)
{
    var parts = new List<string>();
    var current = seq;
    var guard = 0;
    while (nodes.TryGetValue(current, out var n) && n.Father > 0 && guard++ < 64)
    {
        if (nodes.TryGetValue(n.Father, out var parent))
        {
            var name = ResolveName(parent.Seq, parent.Name1);
            parts.Add(string.IsNullOrWhiteSpace(name) ? $"#{parent.Seq}" : name.Trim());
            current = parent.Seq;
        }
        else break;
    }
    parts.Reverse();
    return string.Join(" / ", parts);
}

var outDir = Path.Combine(
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups")),
    $"edari-zero-stock-{DateTime.Now:yyyyMMdd-HHmmss}");
Directory.CreateDirectory(outDir);
Console.WriteLine();
Console.WriteLine($"مجلد الحفظ: {outDir}");

// جلب كل الأعمدة كاملة للمنتجات المرشحة (نسخة احتياطية كاملة بلا استثناء أي عمود)
Console.WriteLine("جاري جلب كل الأعمدة (نسخة احتياطية كاملة) للمنتجات المرشحة...");
var seqList = zeroExact.Select(n => n.Seq).ToList();
var fullRows = new List<Dictionary<string, object?>>();
foreach (var chunk in Chunk(seqList, 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT * FROM File13n WHERE Seq IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var col in columns)
        {
            var ord = r.GetOrdinal(col);
            dict[col] = r.IsDBNull(ord) ? null : r.GetValue(ord);
        }
        fullRows.Add(dict);
    }
}
Console.WriteLine($"تم جلب {fullRows.Count} صف كامل من File13n.");

// باركودات إضافية من File13BC لهذه المنتجات
var extraBarcodes = new List<(long EdNum, string BarCode)>();
try
{
    foreach (var chunk in Chunk(seqList, 150))
    {
        var inList = string.Join(",", chunk);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT EdNum, BarCode FROM File13BC WHERE EdNum IN ({inList})";
        cmd.CommandTimeout = 120;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            extraBarcodes.Add((ToLong(r.GetValue(0)), ReadStr(r.GetValue(1)) ?? ""));
    }
    Console.WriteLine($"باركودات إضافية (File13BC) مرتبطة بالمنتجات المرشحة: {extraBarcodes.Count}");
}
catch
{
    Console.WriteLine("ملاحظة: جدول File13BC غير متاح أو لا يحتوي بيانات لهذه المنتجات.");
}

// حركة سابقة (فواتير) — لمجرد الإبلاغ، لا تمنع الحذف، لكن تستحق المراجعة
var withMovement = new HashSet<long>();
try
{
    foreach (var chunk in Chunk(seqList, 150))
    {
        var inList = string.Join(",", chunk);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT DISTINCT Mat FROM File14n WHERE Mat IN ({inList})";
        cmd.CommandTimeout = 300;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            withMovement.Add(ToLong(r.GetValue(0)));
    }
    Console.WriteLine($"منتجات من ضمن المرشحة لها حركة فواتير سابقة (شراء/بيع) في File14n: {withMovement.Count}");
}
catch
{
    Console.WriteLine("ملاحظة: تعذر فحص File14n لحركة الفواتير (غير حرج).");
}

// 1) تقرير إكسل مقروء بكل التفاصيل المطلوبة: الاسم، الباركود، المكان (الشجرة)، الأسعار، المخزون
var reportPath = Path.Combine(outDir, "تقرير-منتجات-مخزون-صفر.xlsx");
using (var wb = new XLWorkbook())
{
    var ws = wb.Worksheets.Add("مخزون صفر");
    var headers = new[]
    {
        "Seq", "الرقم (Num)", "الباركود", "الاسم (صحيح)", "الاسم الخام من Edari", "الاسم2", "مسار الشجرة (الفئة)",
        "المجلد الأب (Seq)", "اسم المجلد الأب",
        "سعر الشراء/التكلفة (Last)", "متوسط التكلفة (CurAvrg)",
        "سعر الجملة (SellPr1)", "SellPr2", "SellPr3", "سعر المستهلك (SellPr4)", "سعر العرض (SellPr5)",
        "مخزون مستودع1 (CurTot1)", "مخزون مستودع2 (CurTot2)", "مخزون مستودع3 (CurTot3)",
        "له حركة فواتير سابقة؟", "وحدة القياس (DefUnit)"
    };
    for (var i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
    ws.Row(1).Style.Font.Bold = true;

    var row = 2;
    foreach (var n in zeroExact.OrderBy(x => x.Seq))
    {
        var full = fullRows.FirstOrDefault(d => ToLong(d.GetValueOrDefault("Seq")) == n.Seq);
        var parentName = n.Father > 0 && nodes.TryGetValue(n.Father, out var p) ? ResolveName(p.Seq, p.Name1) : "";
        ws.Cell(row, 1).Value = n.Seq;
        ws.Cell(row, 2).Value = n.Num ?? "";
        ws.Cell(row, 3).Value = n.Barcode ?? "";
        ws.Cell(row, 4).Value = ResolveName(n.Seq, n.Name1);
        ws.Cell(row, 5).Value = n.Name1 ?? "";
        ws.Cell(row, 6).Value = GetStr(full, "Name2");
        ws.Cell(row, 7).Value = BuildTreePath(n.Seq);
        ws.Cell(row, 8).Value = n.Father;
        ws.Cell(row, 9).Value = parentName ?? "";
        ws.Cell(row, 10).Value = GetNum(full, "Last");
        ws.Cell(row, 11).Value = GetNum(full, "CurAvrg");
        ws.Cell(row, 12).Value = GetNum(full, "SellPr1");
        ws.Cell(row, 13).Value = GetNum(full, "SellPr2");
        ws.Cell(row, 14).Value = GetNum(full, "SellPr3");
        ws.Cell(row, 15).Value = GetNum(full, "SellPr4");
        ws.Cell(row, 16).Value = GetNum(full, "SellPr5");
        ws.Cell(row, 17).Value = n.CurTot1 ?? 0;
        ws.Cell(row, 18).Value = n.CurTot2 ?? 0;
        ws.Cell(row, 19).Value = n.CurTot3 ?? 0;
        ws.Cell(row, 20).Value = withMovement.Contains(n.Seq) ? "نعم" : "لا";
        ws.Cell(row, 21).Value = GetStr(full, "DefUnit");
        row++;
    }
    ws.SheetView.Freeze(1, 0);
    ws.Columns().AdjustToContents();
    wb.SaveAs(reportPath);
}
Console.WriteLine($"تقرير الإكسل: {reportPath}");

// 2) نسخة احتياطية خام كاملة (كل الأعمدة كما هي) — JSON بلا فقد أي بيانات
// Name1_Corrected: الاسم الصحيح من مزامنة FOT_POS_V2 (الاسم الخام Name1 من Edari قد يكون تالف الترميز)
var backupPath = Path.Combine(outDir, "full-backup.json");
var jsonRows = fullRows.Select(d =>
{
    var dict = d.ToDictionary(
        kv => kv.Key,
        kv => (object?)(kv.Value is byte[] bytes ? Convert.ToBase64String(bytes) : kv.Value),
        StringComparer.OrdinalIgnoreCase);
    var seq = ToLong(d.GetValueOrDefault("Seq"));
    if (correctedNames.TryGetValue(seq, out var corrected)) dict["Name1_Corrected"] = corrected;
    return dict;
});
var extraBarcodesForJson = extraBarcodes.Select(x => new { x.EdNum, x.BarCode });
var backupDoc = new
{
    ExportedAtUtc = DateTime.UtcNow,
    DatabaseAlias,
    ProductCount = fullRows.Count,
    Products = jsonRows,
    ExtraBarcodes = extraBarcodesForJson,
};
File.WriteAllText(backupPath, JsonSerializer.Serialize(backupDoc, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
Console.WriteLine($"نسخة احتياطية كاملة (JSON): {backupPath}");

// 3) سكربت استرجاع جاهز — INSERT لإعادة المنتجات تماماً كما كانت (بدون أعمدة Binary مثل Sub/Total)
var restorePath = Path.Combine(outDir, "restore-insert.sql");
var sb = new StringBuilder();
sb.AppendLine($"-- سكربت استرجاع المنتجات المحذوفة — تم إنشاؤه {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
sb.AppendLine($"-- قاعدة Edari: {DatabaseAlias}  |  عدد المنتجات: {fullRows.Count}");
sb.AppendLine("-- ملاحظة: أعمدة Binary الداخلية (Sub, Total) غير مُضمَّنة (خاصة بفهرسة المجلدات في Edari، فارغة عادة في المنتجات الورقية).");
sb.AppendLine("-- ملاحظة: عمود Name1 استُبدل بالاسم الصحيح من مزامنة FOT_POS_V2 عند توفره (Edari ADO لا يفكّ ترميز العربية بشكل سليم دوماً).");
sb.AppendLine("-- نفّذ هذا السكربت مباشرة على قاعدة Edari (نفس أداة الاتصال) لإعادة المنتجات كما كانت بالضبط، بنفس Seq.");
sb.AppendLine();
foreach (var d in fullRows.OrderBy(x => ToLong(x.GetValueOrDefault("Seq"))))
{
    var seq = ToLong(d.GetValueOrDefault("Seq"));
    var cols = d.Where(kv => kv.Value is not byte[]).Select(kv =>
        correctedNames.TryGetValue(seq, out var corrected) && string.Equals(kv.Key, "Name1", StringComparison.OrdinalIgnoreCase)
            ? new KeyValuePair<string, object?>(kv.Key, corrected)
            : kv).ToList();
    var colList = string.Join(", ", cols.Select(kv => QuoteIdent(kv.Key)));
    var valList = string.Join(", ", cols.Select(kv => FormatValue(kv.Value)));
    sb.AppendLine($"INSERT INTO File13n ({colList}) VALUES ({valList});");
}
if (extraBarcodes.Count > 0)
{
    sb.AppendLine();
    sb.AppendLine("-- باركودات إضافية (File13BC)");
    foreach (var (edNum, barCode) in extraBarcodes)
        sb.AppendLine($"INSERT INTO File13BC (EdNum, BarCode) VALUES ({edNum}, {FormatValue(barCode)});");
}
File.WriteAllText(restorePath, sb.ToString(), new UTF8Encoding(true));
Console.WriteLine($"سكربت الاسترجاع (INSERT جاهزة): {restorePath}");

// 4) قائمة Seq بسيطة — تُستخدم كمرجع لأمر الحذف اللاحق (DELETE FROM File13n WHERE Seq IN (...))
var seqsPath = Path.Combine(outDir, "seqs.txt");
File.WriteAllLines(seqsPath, seqList.Select(s => s.ToString(CultureInfo.InvariantCulture)));
Console.WriteLine($"قائمة Seq المرشحة للحذف: {seqsPath}");

Console.WriteLine();
Console.WriteLine("=== لم يتم حذف أي شيء ===");
Console.WriteLine($"عدد المنتجات المرشحة للحذف (مخزون = 0 بالضبط): {zeroExact.Count}");
Console.WriteLine("راجع تقرير الإكسل والنسخة الاحتياطية، وانتظر أمر الحذف الصريح لتنفيذه.");

static List<List<long>> Chunk(List<long> source, int size)
{
    var result = new List<List<long>>();
    for (var i = 0; i < source.Count; i += size)
        result.Add(source.Skip(i).Take(size).ToList());
    return result;
}

static long ToLong(object? v) => v switch
{
    null or DBNull => 0,
    long l => l,
    int i => i,
    short s => s,
    decimal dec => (long)dec,
    double dd => (long)dd,
    float f => (long)f,
    string str when long.TryParse(str, out var parsed) => parsed,
    _ => Convert.ToInt64(v, CultureInfo.InvariantCulture)
};

static double? ToNullableDouble(object? v) => v switch
{
    null or DBNull => null,
    double d => d,
    float f => f,
    decimal dec => (double)dec,
    long l => l,
    int i => i,
    short s => s,
    string str when double.TryParse(str, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) => parsed,
    _ => Convert.ToDouble(v, CultureInfo.InvariantCulture)
};

static string? ReadStr(object? v) => v is null or DBNull ? null : v.ToString()?.Trim();

static string? GetStr(Dictionary<string, object?>? row, string col)
    => row is not null && row.TryGetValue(col, out var v) ? ReadStr(v) : null;

static double? GetNum(Dictionary<string, object?>? row, string col)
    => row is not null && row.TryGetValue(col, out var v) ? ToNullableDouble(v) : null;

static async Task<List<string>> GetColumnNamesAsync(DbConnection conn, string table)
{
    var list = new List<string>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT TOP 0 * FROM {table}";
    await using var r = await cmd.ExecuteReaderAsync();
    for (var i = 0; i < r.FieldCount; i++)
        list.Add(r.GetName(i));
    return list;
}

static string QuoteIdent(string name) => $"\"{name.Replace("\"", "\"\"")}\"";

static string FormatValue(object? v)
{
    if (v is null or DBNull) return "NULL";
    return v switch
    {
        string s => $"'{s.Replace("'", "''")}'",
        bool b => b ? "1" : "0",
        byte or sbyte or short or ushort or int or uint or long or ulong =>
            Convert.ToString(v, CultureInfo.InvariantCulture)!,
        float or double or decimal =>
            Convert.ToString(v, CultureInfo.InvariantCulture)!,
        DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
        _ => $"'{v}'"
    };
}

sealed record Node(long Seq, long Father, string? Name1, string? Num, string? Barcode,
    double? CurTot1, double? CurTot2, double? CurTot3);
