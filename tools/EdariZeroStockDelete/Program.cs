// أداة حذف آمنة: تحذف فقط المنتجات المؤكدة (من نسخة احتياطية سابقة) بعد إعادة فحصها
// لحظياً في Edari 2026 (لا تحذف شيئاً لم يُنسَخ احتياطياً ولم تتم مراجعته أولاً).
// تُنفَّذ الحذوفات بترتيب آمن: الباركودات الفرعية (File13BC) أولاً، ثم صف المنتج (File13n)،
// مع تحقق نهائي بعد الحذف، وتسجيل كامل لكل ما حدث (بما فيه أي عناصر تم تخطّيها ولماذا).
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026"; // القاعدة الحالية الفعلية — وفق ext_edari_settings وتأكيد المستخدم

var backupsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups"));
var backupDir = args.Length > 0
    ? args[0]
    : Directory.GetDirectories(backupsRoot, "edari-zero-stock-*")
        .OrderByDescending(d => d)
        .FirstOrDefault()
    ?? throw new InvalidOperationException("لم يُعثر على مجلد نسخة احتياطية سابقة (edari-zero-stock-*) تحت backups/");

var seqsPath = Path.Combine(backupDir, "seqs.txt");
if (!File.Exists(seqsPath))
    throw new InvalidOperationException($"ملف seqs.txt غير موجود في: {backupDir}");

var candidateSeqs = File.ReadAllLines(seqsPath)
    .Select(l => l.Trim())
    .Where(l => l.Length > 0)
    .Select(long.Parse)
    .ToList();

Console.WriteLine($"مجلد النسخة الاحتياطية المرجعية: {backupDir}");
Console.WriteLine($"عدد المنتجات المرشحة (من النسخة الاحتياطية): {candidateSeqs.Count}");

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

// === إعادة فحص لحظية قبل الحذف (حماية من فرق التوقيت بين النسخة الاحتياطية والآن) ===
Console.WriteLine();
Console.WriteLine("جاري إعادة فحص كل منتج مرشح لحظياً قبل الحذف (المخزون، وهل أصبح مجلداً له فروع)...");

var liveState = new Dictionary<long, (long Father, double? CurTot1)>();
foreach (var chunk in Chunk(candidateSeqs, 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, Father, CurTot1 FROM File13n WHERE Seq IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var father = r.IsDBNull(1) ? 0L : ToLong(r.GetValue(1));
        var stock = ToNullableDouble(r.GetValue(2));
        liveState[seq] = (father, stock);
    }
}

var becameParent = new HashSet<long>();
foreach (var chunk in Chunk(candidateSeqs, 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT DISTINCT Father FROM File13n WHERE Father IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        becameParent.Add(ToLong(r.GetValue(0)));
}

var skipped = new List<(long Seq, string Reason)>();
var safeToDelete = new List<long>();
foreach (var seq in candidateSeqs)
{
    if (!liveState.TryGetValue(seq, out var st))
    {
        skipped.Add((seq, "غير موجود حالياً في File13n (محذوف مسبقاً أو Seq غير صحيح)"));
        continue;
    }
    if (becameParent.Contains(seq))
    {
        skipped.Add((seq, "أصبح له فروع/عناصر فرعية الآن (لم يعد ورقة في الشجرة)"));
        continue;
    }
    if (!st.CurTot1.HasValue || st.CurTot1.Value != 0)
    {
        skipped.Add((seq, $"تغيّر المخزون الحالي إلى {st.CurTot1?.ToString(CultureInfo.InvariantCulture) ?? "NULL"} (لم يعد صفراً بالضبط)"));
        continue;
    }
    safeToDelete.Add(seq);
}

Console.WriteLine($"آمن للحذف الآن: {safeToDelete.Count}");
Console.WriteLine($"تم تخطّيه (لن يُحذف): {skipped.Count}");
if (skipped.Count > 0)
{
    Console.WriteLine("أسباب التخطي:");
    foreach (var g in skipped.GroupBy(s => s.Reason))
        Console.WriteLine($"  - {g.Key}: {g.Count()}");
}

if (safeToDelete.Count == 0)
{
    Console.WriteLine();
    Console.WriteLine("لا يوجد أي عنصر آمن للحذف حالياً. لم يتم حذف أي شيء.");
    return;
}

Console.WriteLine();
Console.WriteLine($"جاري حذف {safeToDelete.Count} منتج (بالترتيب الآمن: الباركودات الفرعية أولاً، ثم صف المنتج)...");

// 1) حذف الباركودات الفرعية أولاً (File13BC) — بيانات تابعة، حذفها أولاً يمنع تعليقها بلا مرجع
var barcodesDeleted = 0;
try
{
    foreach (var chunk in Chunk(safeToDelete, 150))
    {
        var inList = string.Join(",", chunk);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"DELETE FROM File13BC WHERE EdNum IN ({inList})";
        cmd.CommandTimeout = 300;
        barcodesDeleted += await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"File13BC: تم حذف {barcodesDeleted} باركود فرعي.");
}
catch (Exception ex)
{
    Console.WriteLine($"تنبيه: تعذر حذف بعض/كل باركودات File13BC ({ex.Message}) — سيتم الاستمرار بحذف المنتجات نفسها.");
}

// 2) حذف صفوف المنتجات نفسها (File13n)
var productsDeleted = 0;
var deleteErrors = new List<(long Seq, string Error)>();
foreach (var chunk in Chunk(safeToDelete, 150))
{
    var inList = string.Join(",", chunk);
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"DELETE FROM File13n WHERE Seq IN ({inList})";
        cmd.CommandTimeout = 300;
        productsDeleted += await cmd.ExecuteNonQueryAsync();
    }
    catch (Exception)
    {
        // إذا فشلت الدفعة كاملة، جرّب كل Seq منفرداً لتحديد العنصر المشكل بدقة دون فقد بقية الدفعة
        foreach (var seq in chunk)
        {
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = $"DELETE FROM File13n WHERE Seq = {seq}";
                cmd.CommandTimeout = 60;
                productsDeleted += await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception exOne)
            {
                deleteErrors.Add((seq, exOne.Message));
            }
        }
    }
}

Console.WriteLine($"File13n: تم حذف {productsDeleted} منتج.");
if (deleteErrors.Count > 0)
{
    Console.WriteLine($"تعذر حذف {deleteErrors.Count} عنصر (انظر سجل الحذف للتفاصيل).");
}

// === تحقق نهائي بعد الحذف ===
var stillThere = new List<long>();
foreach (var chunk in Chunk(safeToDelete, 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq FROM File13n WHERE Seq IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        stillThere.Add(ToLong(r.GetValue(0)));
}

Console.WriteLine();
if (stillThere.Count == 0)
{
    Console.WriteLine("تحقق نهائي: تم تأكيد حذف كل العناصر الآمنة بنجاح من File13n.");
}
else
{
    Console.WriteLine($"تحذير: {stillThere.Count} عنصر ما زال موجوداً في File13n بعد الحذف (يحتاج مراجعة).");
}

// === تسجيل كامل للعملية ===
var logPath = Path.Combine(backupDir, $"delete-log-{DateTime.Now:yyyyMMdd-HHmmss}.json");
var log = new
{
    ExecutedAtUtc = DateTime.UtcNow,
    DatabaseAlias,
    BackupDir = backupDir,
    CandidatesFromBackup = candidateSeqs.Count,
    SafeToDeleteCount = safeToDelete.Count,
    SkippedCount = skipped.Count,
    Skipped = skipped.Select(s => new { s.Seq, s.Reason }),
    ProductsDeleted = productsDeleted,
    BarcodesDeleted = barcodesDeleted,
    DeleteErrors = deleteErrors.Select(e => new { e.Seq, e.Error }),
    StillPresentAfterDelete = stillThere,
    DeletedSeqs = safeToDelete.Except(stillThere).ToList(),
};
File.WriteAllText(logPath, JsonSerializer.Serialize(log, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
Console.WriteLine($"سجل العملية الكامل: {logPath}");

Console.WriteLine();
Console.WriteLine("=== ملخص نهائي ===");
Console.WriteLine($"مرشح من النسخة الاحتياطية: {candidateSeqs.Count}");
Console.WriteLine($"تم تخطّيه (تغيّر وضعه): {skipped.Count}");
Console.WriteLine($"تم حذفه فعلاً: {productsDeleted} منتج + {barcodesDeleted} باركود فرعي");
Console.WriteLine($"تذكير: للاسترجاع الكامل عند الحاجة، استخدم restore-insert.sql الموجود في: {backupDir}");

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
