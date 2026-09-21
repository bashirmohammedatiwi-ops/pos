// أداة تشخيص وإصلاح: بعد حذف مواد من داخل مجاميع/مجلدات في Edari (File13n)، يبقى العدّاد
// المخزَّن على المجلد الأب (SubCount) وفهرس الأطفال المخزَّن (Sub) قديمين (يشيران لعدد/عناصر
// لم تعد موجودة)، فتظهر التقارير وقوائم المواد صفوفاً فارغة بعدد العناصر المحذوفة.
// mode=diagnose (افتراضي): قراءة فقط — يقارن SubCount المخزَّن بالعدد الحقيقي الحالي للأطفال.
// mode=fix: يصحّح SubCount لكل مجلد متأثر ليطابق العدد الحقيقي، ويصفّر Sub القديم (يُعاد بناؤه من Edari نفسه).
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026";

var mode = args.Length > 0 ? args[0] : "diagnose";
var backupsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups"));

// نبحث عن مجلد النسخة الذي يحتوي فعلاً سجل حذف (delete-log) لأنه المرتبط بالحذف الحقيقي الذي نفّذناه
var backupDir = args.Length > 1 && mode != "inspect"
    ? args[1]
    : Directory.GetDirectories(backupsRoot, "edari-zero-stock-*")
        .Where(d => Directory.GetFiles(d, "delete-log-*.json").Length > 0)
        .OrderByDescending(d => d)
        .FirstOrDefault()
    ?? throw new InvalidOperationException("لم يُعثر على مجلد نسخة احتياطية يحتوي سجل حذف.");

Console.WriteLine($"مجلد النسخة الاحتياطية المستخدم: {backupDir}");
var backupJsonPath = Path.Combine(backupDir, "full-backup.json");
if (!File.Exists(backupJsonPath))
    throw new InvalidOperationException($"full-backup.json غير موجود في: {backupDir}");

using var doc = JsonDocument.Parse(File.ReadAllText(backupJsonPath));
var products = doc.RootElement.GetProperty("Products");
var deletedCountByFather = new Dictionary<long, int>();
foreach (var p in products.EnumerateArray())
{
    if (!p.TryGetProperty("Father", out var fatherEl)) continue;
    var father = fatherEl.ValueKind == JsonValueKind.Number ? fatherEl.GetInt64() : 0;
    if (father <= 0) continue;
    deletedCountByFather[father] = deletedCountByFather.GetValueOrDefault(father) + 1;
}
Console.WriteLine($"عدد المجلدات (المجاميع) المتأثرة بالحذف: {deletedCountByFather.Count}");
Console.WriteLine($"إجمالي المنتجات المحذوفة عبر كل هذه المجلدات: {deletedCountByFather.Values.Sum()}");

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

var folderSeqs = deletedCountByFather.Keys.ToList();

// SubCount المخزَّن حالياً + محتوى Sub الخام (مصفوفة Int32 LE — كل عنصر = Seq طفل) لكل مجلد متأثر
var storedInfo = new Dictionary<long, (long SubCount, byte[]? SubBytes)>();
foreach (var chunk in Chunk(folderSeqs, 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, SubCount, Sub FROM File13n WHERE Seq IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var subCount = r.IsDBNull(1) ? 0L : ToLong(r.GetValue(1));
        var subBytes = r.IsDBNull(2) ? null : (byte[])r.GetValue(2);
        storedInfo[seq] = (subCount, subBytes);
    }
}

// العدد الحقيقي الحالي للأطفال تحت كل مجلد
var liveCount = new Dictionary<long, long>();
foreach (var chunk in Chunk(folderSeqs, 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Father, COUNT(*) FROM File13n WHERE Father IN ({inList}) GROUP BY Father";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        liveCount[ToLong(r.GetValue(0))] = ToLong(r.GetValue(1));
}

var mismatched = new List<(long Seq, long StoredSubCount, long LiveCount, bool HasSubBlob, int DeletedHere)>();
foreach (var seq in folderSeqs)
{
    var stored = storedInfo.TryGetValue(seq, out var si) ? si : (SubCount: 0L, SubBytes: null);
    var live = liveCount.GetValueOrDefault(seq, 0L);
    if (stored.SubCount != live)
        mismatched.Add((seq, stored.SubCount, live, stored.SubBytes is not null, deletedCountByFather[seq]));
}

Console.WriteLine();
Console.WriteLine($"=== نتيجة التشخيص ===");
Console.WriteLine($"مجلدات فيها فرق بين SubCount المخزَّن والعدد الحقيقي الآن: {mismatched.Count} من {folderSeqs.Count}");
Console.WriteLine();
Console.WriteLine("عينة (أول 15):");
Console.WriteLine("Seq\tSubCount(مخزَّن)\tالعدد الحقيقي الآن\tSub blob موجود؟\tمحذوف من هذا المجلد");
foreach (var m in mismatched.Take(15))
    Console.WriteLine($"{m.Seq}\t{m.StoredSubCount}\t{m.LiveCount}\t{(m.HasSubBlob ? "نعم" : "لا")}\t{m.DeletedHere}");

// فحص مرجعي: هل توجد مجلدات أخرى (غير متأثرة بحذفنا) لها أطفال حالياً وSub = NULL بشكل طبيعي؟
// هذا يوضح إن كانت NULL قيمة مقبولة ومستقرة (وليست فقط حالة عابرة قبل إعادة البناء).
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT COUNT(*) FROM File13n WHERE SubCount > 0 AND Sub IS NULL";
    var nullWithChildren = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
    cmd.CommandText = "SELECT COUNT(*) FROM File13n WHERE SubCount > 0";
    var totalFolders = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
    Console.WriteLine();
    Console.WriteLine($"فحص مرجعي: من إجمالي {totalFolders} مجلد له أطفال، عدد من له Sub=NULL بشكل طبيعي: {nullWithChildren}");
}

if (mode == "diagnose")
{
    Console.WriteLine();
    Console.WriteLine("=== تشخيص فقط — لم يُعدَّل أي شيء ===");
    if (mismatched.Count > 0)
        Console.WriteLine("هذا الفرق هو ما يجعل Edari يعرض صفوفاً فارغة (SubCount/Sub لا يزالان يشيران للعدد القديم قبل الحذف).");
    Console.WriteLine("للتصحيح: نفّذ نفس الأداة بالوسيط fix");
    return;
}

if (mode == "inspect")
{
    var inspectSeqs = args.Length > 1 ? args[1].Split(',').Select(long.Parse).ToList() : mismatched.Take(3).Select(m => m.Seq).ToList();
    foreach (var seq in inspectSeqs)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT SubCount, Sub FROM File13n WHERE Seq = {seq}";
        await using var r = await cmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            var subCount = r.IsDBNull(0) ? 0L : ToLong(r.GetValue(0));
            var subBytes = r.IsDBNull(1) ? Array.Empty<byte>() : (byte[])r.GetValue(1);
            Console.WriteLine();
            Console.WriteLine($"Seq={seq}  SubCount={subCount}  Sub.Length={subBytes.Length} bytes  (bytes/SubCount = {(subCount > 0 ? (double)subBytes.Length / subCount : 0):F3})");
            Console.WriteLine("أول 128 بايت (hex): " + Convert.ToHexString(subBytes.Take(128).ToArray()));
        }
    }
    return;
}

if (mode != "fix")
{
    Console.WriteLine($"وضع غير معروف: {mode}");
    return;
}

if (mismatched.Count == 0)
{
    Console.WriteLine("لا يوجد ما يحتاج تصحيحاً.");
    return;
}

// Sub = مصفوفة Int32 LE، كل عنصر = Seq طفل حقيقي (تأكدنا من الصيغة عبر فحص عيّنات فعلية).
// الإصلاح الصحيح: نزيل من المصفوفة فقط مراجع الـSeq التي لم تعد موجودة (المحذوفة)،
// ونحافظ على ترتيب وموضع بقية الأطفال كما هو تماماً — لا نُصفّر Sub بالكامل (لأن ذلك
// يخالف الحالة الطبيعية: كل مجلد نشط في القاعدة له Sub غير NULL دوماً).
Console.WriteLine();
Console.WriteLine("جاري بناء فهرس كل الـSeq الموجودة حالياً في File13n (لتصفية المراجع المحذوفة من Sub)...");
var existingSeqs = new HashSet<long>();
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT Seq FROM File13n";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        existingSeqs.Add(ToLong(r.GetValue(0)));
}
Console.WriteLine($"عدد السجلات الموجودة حالياً: {existingSeqs.Count}");

Console.WriteLine();
Console.WriteLine($"جاري تصحيح Sub و SubCount لعدد {mismatched.Count} مجلد (حذف المراجع الميتة فقط من داخل الفهرس)...");
var fixedCount = 0;
var countMismatchWarnings = new List<(long Seq, long DecodedRemaining, long LiveCount)>();
var fixErrors = new List<(long Seq, string Error)>();
var fixDetails = new List<object>();
foreach (var m in mismatched)
{
    try
    {
        var subBytes = storedInfo.TryGetValue(m.Seq, out var si) ? si.SubBytes : null;
        if (subBytes is null || subBytes.Length % 4 != 0)
        {
            fixErrors.Add((m.Seq, $"Sub غير صالح للتحليل (Length={subBytes?.Length ?? -1})"));
            continue;
        }

        var oldRefs = new List<long>(subBytes.Length / 4);
        for (var i = 0; i < subBytes.Length; i += 4)
            oldRefs.Add(BitConverter.ToInt32(subBytes, i));

        var newRefs = oldRefs.Where(existingSeqs.Contains).ToList();
        if (newRefs.Count != m.LiveCount)
            countMismatchWarnings.Add((m.Seq, newRefs.Count, m.LiveCount));

        var newBytes = new byte[newRefs.Count * 4];
        for (var i = 0; i < newRefs.Count; i++)
            BitConverter.GetBytes((int)newRefs[i]).CopyTo(newBytes, i * 4);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {newRefs.Count} WHERE Seq = {m.Seq}";
        cmd.CommandTimeout = 60;
        var p = cmd.CreateParameter();
        p.ParameterName = "SubVal";
        p.Value = newBytes;
        cmd.Parameters.Add(p);
        await cmd.ExecuteNonQueryAsync();

        fixedCount++;
        fixDetails.Add(new { m.Seq, OldSubCount = m.StoredSubCount, OldRefsInBlob = oldRefs.Count, NewSubCount = newRefs.Count, RemovedDeadRefs = oldRefs.Count - newRefs.Count });
    }
    catch (Exception ex)
    {
        fixErrors.Add((m.Seq, ex.Message));
    }
}
Console.WriteLine($"تم تصحيح {fixedCount} مجلد.");
if (countMismatchWarnings.Count > 0)
{
    Console.WriteLine($"تنبيه: {countMismatchWarnings.Count} مجلد كان فيه فرق طفيف بين (العدد بعد التصفية من Sub) و(العدد الحقيقي عبر Father) — استُخدم العدد المستخرج من Sub نفسه (الأدق لأنه مطابق لمحتوى الفهرس فعلياً).");
    foreach (var w in countMismatchWarnings.Take(10))
        Console.WriteLine($"  Seq={w.Seq}: من Sub={w.DecodedRemaining}  من Father={w.LiveCount}");
}
if (fixErrors.Count > 0)
{
    Console.WriteLine($"فشل تصحيح {fixErrors.Count} مجلد:");
    foreach (var e in fixErrors.Take(10))
        Console.WriteLine($"  Seq={e.Seq}: {e.Error}");
}

// تحقق نهائي بعد التصحيح: إعادة فحص فوري لعيّنة من المجلدات المصحَّحة
var verifyMismatch = new List<long>();
foreach (var chunk in Chunk(mismatched.Select(m => m.Seq).ToList(), 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, SubCount, Sub FROM File13n WHERE Seq IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        var subCount = r.IsDBNull(1) ? 0L : ToLong(r.GetValue(1));
        var subLen = r.IsDBNull(2) ? 0 : ((byte[])r.GetValue(2)).Length;
        if (subLen / 4 != subCount) verifyMismatch.Add(seq);
    }
}
Console.WriteLine();
Console.WriteLine(verifyMismatch.Count == 0
    ? "تحقق نهائي: طول Sub (بعد القسمة على 4) يطابق SubCount في كل المجلدات المصحَّحة."
    : $"تحذير: {verifyMismatch.Count} مجلد لا يزال فيه عدم تطابق بين طول Sub وSubCount بعد التصحيح.");

var logPath = Path.Combine(backupDir, $"folder-sub-fix-{DateTime.Now:yyyyMMdd-HHmmss}.json");
File.WriteAllText(logPath, JsonSerializer.Serialize(new
{
    ExecutedAtUtc = DateTime.UtcNow,
    DatabaseAlias,
    TotalAffectedFolders = folderSeqs.Count,
    MismatchedFolders = mismatched.Count,
    FixedCount = fixedCount,
    CountMismatchWarnings = countMismatchWarnings.Select(w => new { w.Seq, w.DecodedRemaining, w.LiveCount }),
    Errors = fixErrors.Select(e => new { e.Seq, e.Error }),
    VerifyMismatchAfterFix = verifyMismatch,
    Details = fixDetails,
}, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
Console.WriteLine($"سجل التصحيح: {logPath}");

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