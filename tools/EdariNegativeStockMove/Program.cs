// نقل المواد ذات المخزون السالب (CurTot1 < 0) إلى شجرتين محدَّدتين، بالتساوي.
// mode=export (افتراضي): قراءة فقط — تقرير Excel + نسخة احتياطية كاملة + خطة التوزيع (move-plan.json).
// mode=move: يقرأ خطة التوزيع من آخر مجلد تصدير، يعيد فحصها لحظياً، ثم ينقل Father لكل مادة
//            ويصحّح فهرس Sub/SubCount لكل من المجلد القديم والمجلد الجديد.
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026";
const long Target1Seq = 92103; // شجرة 011011
const long Target2Seq = 92104; // شجرة 011012

var mode = args.Length > 0 ? args[0] : "export";
var backupsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups"));

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

if (mode == "export")
{
    var columns = await GetColumnNamesAsync(conn, "File13n");
    Console.WriteLine($"عدد أعمدة File13n: {columns.Count}");

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
    var negative = leafNodes.Where(n => n.CurTot1.HasValue && n.CurTot1.Value < 0).OrderBy(n => n.Seq).ToList();
    Console.WriteLine($"إجمالي المنتجات (أوراق الشجرة): {leafNodes.Count}");
    Console.WriteLine($"مخزون سالب (المرشحة للنقل): {negative.Count}");

    if (negative.Count == 0)
    {
        Console.WriteLine("لا توجد مواد بمخزون سالب حالياً.");
        return;
    }

    Console.WriteLine("جاري جلب الأسماء الصحيحة من FOT_POS_V2.articles (لتفادي تلف ترميز العربية عبر Edari ADO)...");
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
        Console.WriteLine($"أسماء صحيحة محمّلة: {correctedNames.Count}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه: تعذر تصحيح الأسماء ({ex.Message}).");
    }

    string ResolveName(long seq, string? raw) => correctedNames.TryGetValue(seq, out var c) ? c : (raw ?? "");

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

    // خطة التوزيع بالتساوي: النصف الأول (بترتيب Seq تصاعدياً) -> الشجرة الأولى، الباقي -> الثانية
    var half = negative.Count / 2;
    var plan = new Dictionary<long, long>();
    for (var i = 0; i < negative.Count; i++)
        plan[negative[i].Seq] = i < half ? Target1Seq : Target2Seq;
    var toTarget1 = plan.Count(kv => kv.Value == Target1Seq);
    var toTarget2 = plan.Count(kv => kv.Value == Target2Seq);
    Console.WriteLine($"خطة التوزيع: {toTarget1} إلى الشجرة 011011 (Seq={Target1Seq})  |  {toTarget2} إلى الشجرة 011012 (Seq={Target2Seq})");

    var outDir = Path.Combine(backupsRoot, $"edari-negative-stock-{DateTime.Now:yyyyMMdd-HHmmss}");
    Directory.CreateDirectory(outDir);
    Console.WriteLine($"مجلد الحفظ: {outDir}");

    var seqList = negative.Select(n => n.Seq).ToList();
    Console.WriteLine("جاري جلب كل الأعمدة (نسخة احتياطية كاملة) للمنتجات المرشحة...");
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

    // تقرير إكسل
    var reportPath = Path.Combine(outDir, "تقرير-منتجات-مخزون-سالب.xlsx");
    using (var wb = new XLWorkbook())
    {
        var ws = wb.Worksheets.Add("مخزون سالب");
        var headers = new[]
        {
            "Seq", "الرقم (Num)", "الباركود", "الاسم (صحيح)", "مسار الشجرة الحالي",
            "المجلد الأب الحالي (Seq)", "الشجرة الجديدة (Num)", "الشجرة الجديدة (Seq)",
            "سعر الشراء/التكلفة (Last)", "متوسط التكلفة (CurAvrg)",
            "سعر الجملة (SellPr1)", "SellPr2", "SellPr3", "سعر المستهلك (SellPr4)", "سعر العرض (SellPr5)",
            "مخزون مستودع1 (CurTot1)", "مخزون مستودع2 (CurTot2)", "مخزون مستودع3 (CurTot3)",
            "المورد/العائدية (Supplier)", "Group1", "Group2", "Group3", "وحدة القياس (DefUnit)"
        };
        for (var i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        ws.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var n in negative)
        {
            var full = fullRows.FirstOrDefault(d => ToLong(d.GetValueOrDefault("Seq")) == n.Seq);
            var newTarget = plan[n.Seq];
            ws.Cell(row, 1).Value = n.Seq;
            ws.Cell(row, 2).Value = n.Num ?? "";
            ws.Cell(row, 3).Value = n.Barcode ?? "";
            ws.Cell(row, 4).Value = ResolveName(n.Seq, n.Name1);
            ws.Cell(row, 5).Value = BuildTreePath(n.Seq);
            ws.Cell(row, 6).Value = n.Father;
            ws.Cell(row, 7).Value = newTarget == Target1Seq ? "011011" : "011012";
            ws.Cell(row, 8).Value = newTarget;
            ws.Cell(row, 9).Value = GetNum(full, "Last");
            ws.Cell(row, 10).Value = GetNum(full, "CurAvrg");
            ws.Cell(row, 11).Value = GetNum(full, "SellPr1");
            ws.Cell(row, 12).Value = GetNum(full, "SellPr2");
            ws.Cell(row, 13).Value = GetNum(full, "SellPr3");
            ws.Cell(row, 14).Value = GetNum(full, "SellPr4");
            ws.Cell(row, 15).Value = GetNum(full, "SellPr5");
            ws.Cell(row, 16).Value = n.CurTot1 ?? 0;
            ws.Cell(row, 17).Value = n.CurTot2 ?? 0;
            ws.Cell(row, 18).Value = n.CurTot3 ?? 0;
            ws.Cell(row, 19).Value = GetNum(full, "Supplier");
            ws.Cell(row, 20).Value = GetNum(full, "Group1");
            ws.Cell(row, 21).Value = GetNum(full, "Group2");
            ws.Cell(row, 22).Value = GetNum(full, "Group3");
            ws.Cell(row, 23).Value = GetStr(full, "DefUnit");
            row++;
        }
        ws.SheetView.Freeze(1, 0);
        ws.Columns().AdjustToContents();
        wb.SaveAs(reportPath);
    }
    Console.WriteLine($"تقرير الإكسل: {reportPath}");

    // نسخة احتياطية كاملة (JSON خام لكل الأعمدة، بلا أي فقد)
    var backupPath = Path.Combine(outDir, "full-backup.json");
    var jsonRows = fullRows.Select(d =>
    {
        var dict = d.ToDictionary(
            kv => kv.Key,
            kv => (object?)(kv.Value is byte[] bytes ? Convert.ToBase64String(bytes) : kv.Value),
            StringComparer.OrdinalIgnoreCase);
        var seq = ToLong(d.GetValueOrDefault("Seq"));
        if (correctedNames.TryGetValue(seq, out var corrected)) dict["Name1_Corrected"] = corrected;
        dict["OldFather"] = ToLong(d.GetValueOrDefault("Father"));
        dict["PlannedNewFather"] = plan[seq];
        return dict;
    });
    File.WriteAllText(backupPath, JsonSerializer.Serialize(new
    {
        ExportedAtUtc = DateTime.UtcNow,
        DatabaseAlias,
        ProductCount = fullRows.Count,
        Products = jsonRows,
    }, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
    Console.WriteLine($"نسخة احتياطية كاملة (JSON): {backupPath}");

    // خطة النقل (المرجع الوحيد الذي يستخدمه mode=move لضمان تطابق كامل مع هذا التقرير)
    var planPath = Path.Combine(outDir, "move-plan.json");
    File.WriteAllText(planPath, JsonSerializer.Serialize(new
    {
        CreatedAtUtc = DateTime.UtcNow,
        DatabaseAlias,
        Target1Seq,
        Target2Seq,
        TotalCount = negative.Count,
        ToTarget1 = toTarget1,
        ToTarget2 = toTarget2,
        Assignments = negative.Select(n => new { n.Seq, OldFather = n.Father, NewFather = plan[n.Seq] }),
    }, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
    Console.WriteLine($"خطة النقل: {planPath}");

    Console.WriteLine();
    Console.WriteLine("=== لم يتم نقل أي شيء بعد ===");
    Console.WriteLine($"إجمالي المرشح: {negative.Count}  |  إلى 011011: {toTarget1}  |  إلى 011012: {toTarget2}");
    Console.WriteLine("راجع تقرير الإكسل، وانتظر أمر التنفيذ الصريح لتنفيذ النقل الفعلي.");
    return;
}

if (mode != "move")
{
    Console.WriteLine($"وضع غير معروف: {mode}");
    return;
}

// ============================= mode = move =============================
var planDir = args.Length > 1
    ? args[1]
    : Directory.GetDirectories(backupsRoot, "edari-negative-stock-*")
        .Where(d => File.Exists(Path.Combine(d, "move-plan.json")))
        .OrderByDescending(d => d)
        .FirstOrDefault()
    ?? throw new InvalidOperationException("لم يُعثر على move-plan.json.");

Console.WriteLine($"مجلد الخطة المستخدم: {planDir}");
using var planDoc = JsonDocument.Parse(File.ReadAllText(Path.Combine(planDir, "move-plan.json")));
var assignments = planDoc.RootElement.GetProperty("Assignments")
    .EnumerateArray()
    .Select(e => (Seq: e.GetProperty("Seq").GetInt64(), OldFather: e.GetProperty("OldFather").GetInt64(), NewFather: e.GetProperty("NewFather").GetInt64()))
    .ToList();
Console.WriteLine($"عدد العناصر في الخطة: {assignments.Count}");

// إعادة فحص لحظية: هل ما زال كل عنصر ورقة، مخزونه سالب، وفي نفس المجلد الأب المسجَّل في الخطة؟
Console.WriteLine();
Console.WriteLine("جاري إعادة الفحص اللحظي قبل النقل...");
var liveState = new Dictionary<long, (long Father, double? CurTot1)>();
foreach (var chunk in Chunk(assignments.Select(a => a.Seq).ToList(), 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, Father, CurTot1 FROM File13n WHERE Seq IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
        liveState[ToLong(r.GetValue(0))] = (ToLong(r.GetValue(1)), ToNullableDouble(r.GetValue(2)));
}

var becameParent = new HashSet<long>();
foreach (var chunk in Chunk(assignments.Select(a => a.Seq).ToList(), 150))
{
    var inList = string.Join(",", chunk);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT DISTINCT Father FROM File13n WHERE Father IN ({inList})";
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync()) becameParent.Add(ToLong(r.GetValue(0)));
}

var skipped = new List<(long Seq, string Reason)>();
var safeToMove = new List<(long Seq, long OldFather, long NewFather)>();
foreach (var a in assignments)
{
    if (!liveState.TryGetValue(a.Seq, out var st)) { skipped.Add((a.Seq, "غير موجود حالياً")); continue; }
    if (becameParent.Contains(a.Seq)) { skipped.Add((a.Seq, "أصبح له فروع الآن")); continue; }
    if (!st.CurTot1.HasValue || st.CurTot1.Value >= 0) { skipped.Add((a.Seq, $"لم يعد مخزونه سالباً (الآن={st.CurTot1})")); continue; }
    if (st.Father != a.OldFather) { skipped.Add((a.Seq, $"تغيّر المجلد الأب (كان {a.OldFather} وأصبح {st.Father})")); continue; }
    safeToMove.Add((a.Seq, st.Father, a.NewFather));
}
Console.WriteLine($"آمن للنقل الآن: {safeToMove.Count}");
Console.WriteLine($"تم تخطّيه: {skipped.Count}");
if (skipped.Count > 0)
    foreach (var g in skipped.GroupBy(s => s.Reason))
        Console.WriteLine($"  - {g.Key}: {g.Count()}");

if (safeToMove.Count == 0)
{
    Console.WriteLine("لا يوجد أي عنصر آمن للنقل حالياً.");
    return;
}

Console.WriteLine();
Console.WriteLine($"جاري نقل {safeToMove.Count} مادة (تحديث Father + فهرس Sub للمجلدات القديمة والجديدة)...");

// 1) تحديث Father لكل مادة
var movedCount = 0;
var moveErrors = new List<(long Seq, string Error)>();
foreach (var m in safeToMove)
{
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE File13n SET Father = {m.NewFather} WHERE Seq = {m.Seq}";
        cmd.CommandTimeout = 60;
        await cmd.ExecuteNonQueryAsync();
        movedCount++;
    }
    catch (Exception ex)
    {
        moveErrors.Add((m.Seq, ex.Message));
    }
}
Console.WriteLine($"تم تحديث Father لعدد {movedCount} مادة.");
if (moveErrors.Count > 0)
    Console.WriteLine($"فشل تحديث {moveErrors.Count} مادة.");

var actuallyMoved = safeToMove.Where(m => !moveErrors.Any(e => e.Seq == m.Seq)).ToList();

// 2) تصحيح فهرس Sub لكل مجلد أب قديم فقدَ أطفالاً (إزالة المراجع المنقولة فقط)
var oldFolders = actuallyMoved.Select(m => m.OldFather).Distinct().Where(f => f > 0).ToList();
Console.WriteLine();
Console.WriteLine($"جاري تحديث فهرس {oldFolders.Count} مجلد أب قديم...");
foreach (var folderSeq in oldFolders)
{
    var movedFromHere = actuallyMoved.Where(m => m.OldFather == folderSeq).Select(m => m.Seq).ToHashSet();
    await using var readCmd = conn.CreateCommand();
    readCmd.CommandText = $"SELECT Sub FROM File13n WHERE Seq = {folderSeq}";
    var subObj = await readCmd.ExecuteScalarAsync();
    var subBytes = subObj is byte[] b ? b : Array.Empty<byte>();
    var refs = new List<long>();
    for (var i = 0; i < subBytes.Length - subBytes.Length % 4; i += 4)
        refs.Add(BitConverter.ToInt32(subBytes, i));
    var newRefs = refs.Where(r => !movedFromHere.Contains(r)).ToList();

    var newBytes = new byte[newRefs.Count * 4];
    for (var i = 0; i < newRefs.Count; i++) BitConverter.GetBytes((int)newRefs[i]).CopyTo(newBytes, i * 4);

    await using var updCmd = conn.CreateCommand();
    updCmd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {newRefs.Count} WHERE Seq = {folderSeq}";
    var p = updCmd.CreateParameter();
    p.ParameterName = "SubVal";
    p.Value = newBytes;
    updCmd.Parameters.Add(p);
    await updCmd.ExecuteNonQueryAsync();
}
Console.WriteLine("تم تحديث فهارس المجلدات القديمة.");

// 3) تصحيح فهرس Sub للمجلدين الجديدين (إضافة كل المراجع المنقولة إليهما)
Console.WriteLine();
Console.WriteLine("جاري تحديث فهرس الشجرتين الجديدتين (011011 و011012)...");
foreach (var newFolderSeq in new[] { Target1Seq, Target2Seq })
{
    var movedHere = actuallyMoved.Where(m => m.NewFather == newFolderSeq).Select(m => m.Seq).ToList();
    await using var readCmd = conn.CreateCommand();
    readCmd.CommandText = $"SELECT Sub FROM File13n WHERE Seq = {newFolderSeq}";
    var subObj = await readCmd.ExecuteScalarAsync();
    var subBytes = subObj is byte[] b ? b : Array.Empty<byte>();
    var refs = new List<long>();
    for (var i = 0; i < subBytes.Length - subBytes.Length % 4; i += 4)
        refs.Add(BitConverter.ToInt32(subBytes, i));
    foreach (var seq in movedHere)
        if (!refs.Contains(seq)) refs.Add(seq);

    var newBytes = new byte[refs.Count * 4];
    for (var i = 0; i < refs.Count; i++) BitConverter.GetBytes((int)refs[i]).CopyTo(newBytes, i * 4);

    await using var updCmd = conn.CreateCommand();
    updCmd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {refs.Count} WHERE Seq = {newFolderSeq}";
    var p = updCmd.CreateParameter();
    p.ParameterName = "SubVal";
    p.Value = newBytes;
    updCmd.Parameters.Add(p);
    await updCmd.ExecuteNonQueryAsync();
    Console.WriteLine($"  Seq={newFolderSeq}: SubCount جديد={refs.Count}  (أُضيف {movedHere.Count})");
}

// تحقق نهائي
Console.WriteLine();
Console.WriteLine("جاري التحقق النهائي...");
var verifyIssues = new List<string>();
foreach (var newFolderSeq in new[] { Target1Seq, Target2Seq })
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT SubCount, Sub FROM File13n WHERE Seq = {newFolderSeq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (await r.ReadAsync())
    {
        var subCount = ToLong(r.GetValue(0));
        var subLen = r.IsDBNull(1) ? 0 : ((byte[])r.GetValue(1)).Length;
        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = $"SELECT COUNT(*) FROM File13n WHERE Father = {newFolderSeq}";
        var live = ToLong(await cmd2.ExecuteScalarAsync() ?? 0L);
        if (subLen / 4 != subCount || subCount != live)
            verifyIssues.Add($"Seq={newFolderSeq}: SubCount={subCount}, Sub/4={subLen / 4}, Father-count={live}");
    }
}
foreach (var folderSeq in oldFolders)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT SubCount, Sub FROM File13n WHERE Seq = {folderSeq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (await r.ReadAsync())
    {
        var subCount = ToLong(r.GetValue(0));
        var subLen = r.IsDBNull(1) ? 0 : ((byte[])r.GetValue(1)).Length;
        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = $"SELECT COUNT(*) FROM File13n WHERE Father = {folderSeq}";
        var live = ToLong(await cmd2.ExecuteScalarAsync() ?? 0L);
        if (subLen / 4 != subCount || subCount != live)
            verifyIssues.Add($"Seq={folderSeq}: SubCount={subCount}, Sub/4={subLen / 4}, Father-count={live}");
    }
}

if (verifyIssues.Count == 0)
    Console.WriteLine("لا توجد أي مشكلة — كل المجلدات (القديمة والجديدة) متوافقة تماماً.");
else
{
    Console.WriteLine($"تحذير: {verifyIssues.Count} مشكلة:");
    foreach (var i in verifyIssues) Console.WriteLine("  " + i);
}

var logPath = Path.Combine(planDir, $"move-log-{DateTime.Now:yyyyMMdd-HHmmss}.json");
File.WriteAllText(logPath, JsonSerializer.Serialize(new
{
    ExecutedAtUtc = DateTime.UtcNow,
    DatabaseAlias,
    TotalInPlan = assignments.Count,
    SkippedCount = skipped.Count,
    Skipped = skipped.Select(s => new { s.Seq, s.Reason }),
    MovedCount = movedCount,
    MoveErrors = moveErrors.Select(e => new { e.Seq, e.Error }),
    OldFoldersUpdated = oldFolders,
    Target1Seq,
    Target2Seq,
    VerifyIssues = verifyIssues,
}, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
Console.WriteLine($"سجل النقل: {logPath}");

Console.WriteLine();
Console.WriteLine("=== ملخص نهائي ===");
Console.WriteLine($"إجمالي الخطة: {assignments.Count}  |  تم تخطيه: {skipped.Count}  |  تم نقله فعلاً: {movedCount}");

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

sealed record Node(long Seq, long Father, string? Name1, string? Num, string? Barcode,
    double? CurTot1, double? CurTot2, double? CurTot3);
