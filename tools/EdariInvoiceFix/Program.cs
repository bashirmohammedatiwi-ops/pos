// أداة تشخيص وإصلاح: فاتورة تحتوي أسطراً تشير إلى منتجات (Mat) تم حذفها من File13n،
// فيتعذر فتحها/تعديلها في Edari لأن الصنف المرجعي غير موجود.
// mode=diagnose <Num> (افتراضي): قراءة فقط — يعرض كل فاتورة بهذا الرقم وأسطرها والمنتجات المفقودة منها.
// mode=restore <Seq1,Seq2,...>: يستعيد منتجات محدَّدة بالضبط (بكل أعمدتها + إدراجها في فهرس مجلدها الأب) من full-backup.json.
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026";

var mode = args.Length > 0 ? args[0] : "diagnose";
var backupsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups"));
var backupDir = Directory.GetDirectories(backupsRoot, "edari-zero-stock-*")
    .Where(d => Directory.GetFiles(d, "delete-log-*.json").Length > 0)
    .OrderByDescending(d => d)
    .FirstOrDefault()
    ?? throw new InvalidOperationException("لم يُعثر على مجلد نسخة احتياطية يحتوي سجل حذف.");
Console.WriteLine($"مجلد النسخة الاحتياطية المرجعية: {backupDir}");

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

if (mode == "lookup")
{
    var codes = args[1].Split(',');
    foreach (var code in codes)
    {
        Console.WriteLine();
        Console.WriteLine($"=== بحث عن: '{code}' ===");
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT Seq, Num, Name1, Father, SubCount, CurTot1 FROM File13n WHERE Num = '{code}' OR CatNum = '{code}' OR Regist = '{code}'";
        cmd.CommandTimeout = 60;
        await using var r = await cmd.ExecuteReaderAsync();
        var found = false;
        while (await r.ReadAsync())
        {
            found = true;
            Console.WriteLine($"  Seq={ToLong(r.GetValue(0))}  Num={r.GetValue(1)}  Name1={r.GetValue(2)}  Father={ToLong(r.GetValue(3))}  SubCount={ToLong(r.GetValue(4))}  CurTot1={r.GetValue(5)}");
        }
        if (!found)
        {
            if (long.TryParse(code, out var seqTry))
            {
                await using var cmd2 = conn.CreateCommand();
                cmd2.CommandText = $"SELECT Seq, Num, Name1, Father, SubCount, CurTot1 FROM File13n WHERE Seq = {seqTry}";
                await using var r2 = await cmd2.ExecuteReaderAsync();
                if (await r2.ReadAsync())
                {
                    found = true;
                    Console.WriteLine($"  (كـSeq مباشر) Seq={ToLong(r2.GetValue(0))}  Num={r2.GetValue(1)}  Name1={r2.GetValue(2)}  Father={ToLong(r2.GetValue(3))}  SubCount={ToLong(r2.GetValue(4))}  CurTot1={r2.GetValue(5)}");
                }
            }
        }
        if (!found) Console.WriteLine("  لم يُعثر على أي تطابق.");
    }
    return;
}

if (mode == "scan-orphans")
{
    Console.WriteLine("جاري فحص كل الفواتير (File14n) بحثاً عن أي Mat لا يوجد له صنف حالياً في File13n...");
    var existingSeqs = new HashSet<long>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT Seq FROM File13n";
        cmd.CommandTimeout = 300;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) existingSeqs.Add(ToLong(r.GetValue(0)));
    }
    Console.WriteLine($"عدد الأصناف الموجودة حالياً: {existingSeqs.Count}");

    var orphanLines = new List<(long BillSeq, long Mat)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT DISTINCT BillSeq, Mat FROM File14n WHERE Mat > 0";
        cmd.CommandTimeout = 600;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var mat = ToLong(r.GetValue(1));
            if (!existingSeqs.Contains(mat))
                orphanLines.Add((ToLong(r.GetValue(0)), mat));
        }
    }
    Console.WriteLine($"أسطر فواتير تشير إلى أصناف غير موجودة حالياً: {orphanLines.Count}");
    var billSeqs = orphanLines.Select(o => o.BillSeq).Distinct().ToList();
    Console.WriteLine($"عدد الفواتير المتأثرة: {billSeqs.Count}");

    foreach (var billSeq in billSeqs)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT Num, Kind, Two, Remarks FROM File15n WHERE Seq = {billSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            var mats = orphanLines.Where(o => o.BillSeq == billSeq).Select(o => o.Mat).ToList();
            Console.WriteLine($"  فاتورة Seq={billSeq}  Num={ToLong(r.GetValue(0))}  Kind={ToLong(r.GetValue(1))}  Two={ToLong(r.GetValue(2))}  Remarks={r.GetValue(3)}  -> أصناف مفقودة: {string.Join(",", mats)}");
        }
    }
    return;
}

if (mode == "diagnose")
{
    var num = args.Length > 1 ? long.Parse(args[1]) : 2;
    Console.WriteLine();
    Console.WriteLine($"جاري البحث عن فواتير برقم Num = {num} ...");

    var bills = new List<(long Seq, long Num, long Kind, long Two, double Total, string Remarks)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq, Num, Kind, Two, Total, Remarks FROM File15n WHERE Num = {num}";
        cmd.CommandTimeout = 120;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            bills.Add((ToLong(r.GetValue(0)), ToLong(r.GetValue(1)), ToLong(r.GetValue(2)), ToLong(r.GetValue(3)),
                ToDouble(r.GetValue(4)), r.IsDBNull(5) ? "" : r.GetValue(5).ToString() ?? ""));
    }
    Console.WriteLine($"عدد الفواتير المطابقة (بكل الأنواع Kind): {bills.Count}");

    foreach (var b in bills)
    {
        Console.WriteLine();
        Console.WriteLine($"=== فاتورة Seq={b.Seq}  Num={b.Num}  Kind={b.Kind}  Two(عميل/مورد)={b.Two}  Total={b.Total}  Remarks={b.Remarks} ===");

        var lines = new List<(long Seq, long Mat, double Quant, double Price, string MatName)>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"SELECT Seq, Mat, Quant, Price, MatName FROM File14n WHERE BillSeq = {b.Seq}";
            cmd.CommandTimeout = 120;
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                lines.Add((ToLong(r.GetValue(0)), ToLong(r.GetValue(1)), ToDouble(r.GetValue(2)), ToDouble(r.GetValue(3)),
                    r.IsDBNull(4) ? "" : r.GetValue(4).ToString() ?? ""));
        }
        Console.WriteLine($"عدد الأسطر: {lines.Count}");

        var matSeqs = lines.Select(l => l.Mat).Distinct().ToList();
        var existing = new HashSet<long>();
        if (matSeqs.Count > 0)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT Seq FROM File13n WHERE Seq IN ({string.Join(",", matSeqs)})";
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) existing.Add(ToLong(r.GetValue(0)));
        }

        foreach (var l in lines)
        {
            var missing = !existing.Contains(l.Mat);
            Console.WriteLine($"  خط Seq={l.Seq}  Mat={l.Mat}  Qty={l.Quant}  Price={l.Price}  MatName='{l.MatName}'  {(missing ? "!! المنتج محذوف/غير موجود حالياً" : "موجود")}");
        }

        var missingMats = lines.Select(l => l.Mat).Distinct().Where(m => !existing.Contains(m)).ToList();
        if (missingMats.Count > 0)
        {
            Console.WriteLine();
            Console.WriteLine($"  >> منتجات مفقودة في هذه الفاتورة: {string.Join(", ", missingMats)}");
            Console.WriteLine($"  >> للاستعادة: dotnet run -- restore {string.Join(",", missingMats)}");
        }
    }
    return;
}

if (mode == "restore")
{
    var seqsToRestore = args[1].Split(',').Select(long.Parse).ToList();
    Console.WriteLine($"جاري استعادة {seqsToRestore.Count} منتج: {string.Join(", ", seqsToRestore)}");

    var backupJsonPath = Path.Combine(backupDir, "full-backup.json");
    using var doc = JsonDocument.Parse(File.ReadAllText(backupJsonPath));
    var products = doc.RootElement.GetProperty("Products");

    var restored = 0;
    var affectedFolders = new HashSet<long>();
    foreach (var seq in seqsToRestore)
    {
        JsonElement? found = null;
        foreach (var p in products.EnumerateArray())
        {
            if (p.TryGetProperty("Seq", out var seqEl) && seqEl.GetInt64() == seq) { found = p; break; }
        }
        if (found is null)
        {
            Console.WriteLine($"  Seq={seq}: غير موجود في full-backup.json — لا يمكن استعادته من هذه النسخة.");
            continue;
        }

        // تأكد أنه غير موجود حالياً (لا نستبدل صفاً حياً بالخطأ)
        await using (var checkCmd = conn.CreateCommand())
        {
            checkCmd.CommandText = $"SELECT COUNT(*) FROM File13n WHERE Seq = {seq}";
            var cnt = ToLong(await checkCmd.ExecuteScalarAsync() ?? 0L);
            if (cnt > 0)
            {
                Console.WriteLine($"  Seq={seq}: موجود بالفعل حالياً في File13n — لن أستبدله، تخطّيته.");
                continue;
            }
        }

        var cols = new List<string>();
        var vals = new List<object?>();
        long father = 0;
        foreach (var prop in found.Value.EnumerateObject())
        {
            if (string.Equals(prop.Name, "Name1_Corrected", StringComparison.OrdinalIgnoreCase)) continue; // عمود مساعد فقط، ليس عموداً حقيقياً
            cols.Add(prop.Name);
            object? v;
            if (prop.Value.ValueKind == JsonValueKind.Number && prop.Value.TryGetInt64(out var l)) v = l;
            else v = prop.Value.ValueKind switch
            {
                JsonValueKind.Null => null,
                JsonValueKind.String => prop.Value.GetString(),
                JsonValueKind.Number => prop.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null
            };
            if (string.Equals(prop.Name, "Name1", StringComparison.OrdinalIgnoreCase)
                && found.Value.TryGetProperty("Name1_Corrected", out var correctedEl))
                v = correctedEl.GetString();
            if (string.Equals(prop.Name, "Father", StringComparison.OrdinalIgnoreCase) && v is long fv) father = fv;
            vals.Add(v);
        }
        // Sub و SubCount أعمدة داخلية خاصة بالمجلدات — لا نعيدها هنا (المنتج ورقة وليس مجلداً)
        var skipIdx = cols.Select((c, i) => (c, i)).Where(x => string.Equals(x.c, "Sub", StringComparison.OrdinalIgnoreCase) || string.Equals(x.c, "SubCount", StringComparison.OrdinalIgnoreCase)).Select(x => x.i).ToHashSet();
        var finalCols = cols.Where((c, i) => !skipIdx.Contains(i)).ToList();
        var finalVals = vals.Where((v, i) => !skipIdx.Contains(i)).ToList();

        var colList = string.Join(", ", finalCols.Select(QuoteIdent));
        var valList = string.Join(", ", finalVals.Select(FormatValue));
        await using (var insCmd = conn.CreateCommand())
        {
            insCmd.CommandText = $"INSERT INTO File13n ({colList}) VALUES ({valList})";
            insCmd.CommandTimeout = 60;
            await insCmd.ExecuteNonQueryAsync();
        }
        Console.WriteLine($"  Seq={seq}: تمت استعادته بنجاح (Father={father}).");
        restored++;
        if (father > 0) affectedFolders.Add(father);
    }

    // إعادة إدراج المنتجات المستعادة في فهرس Sub الخاص بمجلدها الأب (بنفس الأسلوب المُتحقَّق منه سابقاً)
    foreach (var folderSeq in affectedFolders)
    {
        await using var readCmd = conn.CreateCommand();
        readCmd.CommandText = $"SELECT SubCount, Sub FROM File13n WHERE Seq = {folderSeq}";
        await using var r = await readCmd.ExecuteReaderAsync();
        if (!await r.ReadAsync())
        {
            Console.WriteLine($"  تنبيه: المجلد الأب Seq={folderSeq} غير موجود — تعذّر تحديث فهرسه.");
            continue;
        }
        var subBytes = r.IsDBNull(1) ? Array.Empty<byte>() : (byte[])r.GetValue(1);
        var refs = new List<long>(subBytes.Length / 4 + seqsToRestore.Count);
        for (var i = 0; i < subBytes.Length - subBytes.Length % 4; i += 4)
            refs.Add(BitConverter.ToInt32(subBytes, i));

        foreach (var seq in seqsToRestore)
        {
            await using var existsCmd = conn.CreateCommand();
            existsCmd.CommandText = $"SELECT Father FROM File13n WHERE Seq = {seq}";
            var fatherObj = await existsCmd.ExecuteScalarAsync();
            if (fatherObj is null) continue;
            if (ToLong(fatherObj) != folderSeq) continue;
            if (!refs.Contains(seq)) refs.Add(seq);
        }

        var newBytes = new byte[refs.Count * 4];
        for (var i = 0; i < refs.Count; i++) BitConverter.GetBytes((int)refs[i]).CopyTo(newBytes, i * 4);

        await using var updCmd = conn.CreateCommand();
        updCmd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {refs.Count} WHERE Seq = {folderSeq}";
        var p = updCmd.CreateParameter();
        p.ParameterName = "SubVal";
        p.Value = newBytes;
        updCmd.Parameters.Add(p);
        await updCmd.ExecuteNonQueryAsync();
        Console.WriteLine($"  فهرس المجلد الأب Seq={folderSeq} حُدِّث: SubCount={refs.Count}");
    }

    Console.WriteLine();
    Console.WriteLine($"=== تمت استعادة {restored} من {seqsToRestore.Count} منتج ===");
    return;
}

if (mode == "fixindex")
{
    // إصلاح مباشر: إضافة Seq ابن (موجود فعلاً في File13n بنفس Father) إلى فهرس Sub لمجلده الأب،
    // في حال لم يُدرَج فيه تلقائياً (كما حصل بسبب علة برمجية في وضع restore أعلاه).
    var folderSeq = long.Parse(args[1]);
    var childSeqs = args[2].Split(',').Select(long.Parse).ToList();

    await using var readCmd = conn.CreateCommand();
    readCmd.CommandText = $"SELECT SubCount, Sub FROM File13n WHERE Seq = {folderSeq}";
    await using var r = await readCmd.ExecuteReaderAsync();
    if (!await r.ReadAsync())
    {
        Console.WriteLine($"المجلد Seq={folderSeq} غير موجود.");
        return;
    }
    var subBytes = r.IsDBNull(1) ? Array.Empty<byte>() : (byte[])r.GetValue(1);
    var refs = new List<long>();
    for (var i = 0; i < subBytes.Length - subBytes.Length % 4; i += 4)
        refs.Add(BitConverter.ToInt32(subBytes, i));
    Console.WriteLine($"المجلد Seq={folderSeq}: SubCount مخزَّن حالياً={ToLong(r.GetValue(0))}  عدد المراجع في Sub={refs.Count}");

    var added = 0;
    foreach (var child in childSeqs)
    {
        await using var existsCmd = conn.CreateCommand();
        existsCmd.CommandText = $"SELECT Father FROM File13n WHERE Seq = {child}";
        var fatherObj = await existsCmd.ExecuteScalarAsync();
        if (fatherObj is null) { Console.WriteLine($"  Seq={child}: غير موجود في File13n — تخطّي."); continue; }
        if (ToLong(fatherObj) != folderSeq) { Console.WriteLine($"  Seq={child}: Father الفعلي={ToLong(fatherObj)} لا يطابق {folderSeq} — تخطّي."); continue; }
        if (refs.Contains(child)) { Console.WriteLine($"  Seq={child}: موجود بالفعل في الفهرس."); continue; }
        refs.Add(child);
        added++;
        Console.WriteLine($"  Seq={child}: أُضيف إلى الفهرس.");
    }

    if (added > 0)
    {
        var newBytes = new byte[refs.Count * 4];
        for (var i = 0; i < refs.Count; i++) BitConverter.GetBytes((int)refs[i]).CopyTo(newBytes, i * 4);
        await using var updCmd = conn.CreateCommand();
        updCmd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {refs.Count} WHERE Seq = {folderSeq}";
        var p = updCmd.CreateParameter();
        p.ParameterName = "SubVal";
        p.Value = newBytes;
        updCmd.Parameters.Add(p);
        await updCmd.ExecuteNonQueryAsync();
        Console.WriteLine($"تم تحديث المجلد Seq={folderSeq}: SubCount جديد={refs.Count}");
    }
    else
    {
        Console.WriteLine("لا حاجة لتحديث — كل العناصر موجودة مسبقاً في الفهرس.");
    }
    return;
}

Console.WriteLine($"وضع غير معروف: {mode}");

static long ToLong(object v) => v switch
{
    long l => l,
    int i => i,
    short s => s,
    decimal dec => (long)dec,
    double dd => (long)dd,
    float f => (long)f,
    string str when long.TryParse(str, out var parsed) => parsed,
    _ => Convert.ToInt64(v, CultureInfo.InvariantCulture)
};

static double ToDouble(object v) => v switch
{
    double d => d,
    float f => f,
    decimal dec => (double)dec,
    long l => l,
    int i => i,
    short s => s,
    string str when double.TryParse(str, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) => parsed,
    _ => Convert.ToDouble(v, CultureInfo.InvariantCulture)
};

static string QuoteIdent(string name) => $"\"{name.Replace("\"", "\"\"")}\"";

static string FormatValue(object? v)
{
    if (v is null) return "NULL";
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
