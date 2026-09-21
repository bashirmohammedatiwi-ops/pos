// سيتات عطور: تصدير المنتجات القديمة → نقلها إلى شجرة 011013 → فاتورة مبيعات على حساب 134.
// export (افتراضي): قراءة فقط — تقرير Excel + نسخة احتياطية JSON.
// move: ينقل المنتجات المطابقة إلى 011013 مع تصحيح Sub/SubCount.
// invoice: ينشئ فاتورة مبيعات Kind=4 على حساب رقم 134 بالكميات من الإكسل.
// all: export ثم move ثم invoice.
using System.Data.Common;
using System.Globalization;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string DatabaseAlias = "2026";
const string AccountNum = "134";
const string TargetTreeNum = "011013";
const string ExcelPath = @"c:\Users\Future of Technology\Documents\pos\backups\perfume-sets.xlsx";

var mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "export";
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
Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine($"متصل بقاعدة Edari: {DatabaseAlias}");

var excelLines = ReadExcelLines(ExcelPath);
Console.WriteLine($"أسطر الإكسل: {excelLines.Count}  |  باركودات فريدة: {excelLines.Select(x => x.Barcode).Distinct(StringComparer.OrdinalIgnoreCase).Count()}  |  مجموع الكميات: {excelLines.Sum(x => x.Qty)}");

var columns = await GetColumnNamesAsync(conn, "File13n");
var nodes = await LoadNodesAsync(conn);
var fatherSeqs = nodes.Values.Where(n => n.Father > 0).Select(n => n.Father).ToHashSet();
var extraBc = await LoadExtraBarcodesAsync(conn);
var names = await LoadCorrectedNamesAsync();
Console.WriteLine($"File13n: {nodes.Count}  |  باركودات فرعية: {extraBc.Count}  |  أسماء SQL: {names.Count}");

var targetFolder = FindFolderByNum(nodes, TargetTreeNum);
if (targetFolder is null)
    throw new InvalidOperationException($"لم يُعثر على شجرة {TargetTreeNum}");
Console.WriteLine($"الشجرة الهدف: Num={targetFolder.Num}  Seq={targetFolder.Seq}  Name={ResolveName(targetFolder.Seq, targetFolder.Name1, names)}");

var account = await FindAccountByNumAsync(conn, AccountNum);
if (account is null)
    throw new InvalidOperationException($"لم يُعثر على حساب رقم {AccountNum} في File11n");
Console.WriteLine($"حساب {AccountNum}: Seq={account.Value.Seq}  Name={account.Value.Name}");

var matches = MatchLines(excelLines, nodes, fatherSeqs, extraBc, names);
PrintMatchSummary(matches);

var outDir = Path.Combine(backupsRoot, $"edari-perfume-sets-{DateTime.Now:yyyyMMdd-HHmmss}");
Directory.CreateDirectory(outDir);

if (mode is "export" or "all")
{
    await ExportAsync(conn, columns, nodes, names, extraBc, matches, targetFolder, account.Value, outDir);
    CopyToDesktop(outDir);
}

if (mode is "move" or "all")
{
    var latest = mode == "move" ? FindLatestExportDir(backupsRoot) : outDir;
    await MoveAsync(conn, matches, targetFolder.Seq, latest);
}

if (mode is "invoice" or "all")
{
    var latest = mode == "invoice" ? FindLatestExportDir(backupsRoot) : outDir;
    await InvoiceAsync(conn, matches, account.Value, latest);
}

if (mode == "repair")
    await RepairInvoiceVoucherAsync(conn, args.Length > 1 && long.TryParse(args[1], out var billSeq) ? billSeq : 62);

if (mode == "restore-missing")
    await RestoreMissingAndAppendInvoiceAsync(conn, matches, targetFolder, account.Value, backupsRoot);

if (mode == "zero-stock")
{
    await AttachPerfumeFolderToMainTreeAsync(conn, targetFolder.Seq, 90543);
    await StockInZeroAsync(conn, targetFolder.Seq, backupsRoot);
}

if (mode == "missing")
{
    var missing = matches.Where(m => m.Node is null).Select(m => m.Line.Barcode).Distinct().ToList();
    foreach (var bc in missing)
    {
        Console.WriteLine($"--- {bc} ---");
        var digits = new string(bc.Where(char.IsDigit).ToArray());
        var hits = 0;
        foreach (var n in nodes.Values)
        {
            var nb = NormalizeBc(n.Barcode);
            var nn = NormalizeBc(n.Num);
            if (nb.Contains(digits) || nn.Contains(digits) ||
                (digits.Length >= 8 && (nb.Contains(digits[..^1]) || nn.Contains(digits[..^1]))))
            {
                Console.WriteLine($"  Seq={n.Seq} Num={n.Num} Bc={n.Barcode} Father={n.Father} Stock={n.CurTot1} Name={ResolveName(n.Seq, n.Name1, names)}");
                hits++;
                if (hits >= 8) break;
            }
        }
        foreach (var (ed, extra) in extraBc.Where(b => NormalizeBc(b.BarCode).Contains(digits) || (digits.Length >= 8 && NormalizeBc(b.BarCode).Contains(digits[..^1]))))
        {
            nodes.TryGetValue(ed, out var n);
            Console.WriteLine($"  BC Seq={ed} extra={extra} Num={n?.Num} Stock={n?.CurTot1}");
            hits++;
            if (hits >= 12) break;
        }
        if (hits == 0) Console.WriteLine("  لا نتائج");
    }
}

if (mode == "search2025" && args.Length > 1)
{
    await using var year = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
    year.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
    await year.OpenAsync();
    var q = args[1];
    Console.WriteLine($"بحث 2025 عن {q}");
    await using (var cmd = year.CreateCommand())
    {
        cmd.CommandText = $"""
            SELECT TOP 20 Seq, Num, Barcode, Extra8, Father, CurTot1, SellPr4, Name1
            FROM File13n
            WHERE Barcode LIKE '%{Esc(q)}%' OR Num LIKE '%{Esc(q)}%' OR Extra8 LIKE '%{Esc(q)}%'
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        var n = 0;
        while (await r.ReadAsync())
        {
            n++;
            Console.WriteLine($"  Seq={r.GetValue(0)} Num={r.GetValue(1)} Bc={r.GetValue(2)} Extra8={r.GetValue(3)} Father={r.GetValue(4)} Stock={r.GetValue(5)} Sell={r.GetValue(6)}");
        }
        if (n == 0) Console.WriteLine("  لا File13n");
    }
    await using (var cmd = year.CreateCommand())
    {
        cmd.CommandText = $"SELECT TOP 20 EdNum, BarCode FROM File13BC WHERE BarCode LIKE '%{Esc(q)}%'";
        await using var r = await cmd.ExecuteReaderAsync();
        var n = 0;
        while (await r.ReadAsync())
        {
            n++;
            Console.WriteLine($"  BC EdNum={r.GetValue(0)} {r.GetValue(1)}");
        }
        if (n == 0) Console.WriteLine("  لا File13BC");
    }
}

if (mode is not ("export" or "move" or "invoice" or "all" or "missing" or "repair" or "restore-missing" or "search2025" or "zero-stock"))
    Console.WriteLine("الاستخدام: export | move | invoice | all | missing | repair [billSeq] | restore-missing | zero-stock");

static List<ExcelLine> ReadExcelLines(string path)
{
    using var wb = new XLWorkbook(path);
    var ws = wb.Worksheet(1);
    var last = ws.LastRowUsed()?.RowNumber() ?? 0;
    var list = new List<ExcelLine>();
    for (var r = 2; r <= last; r++)
    {
        var bc = (ws.Cell(r, 1).GetFormattedString() ?? "").Trim();
        if (string.IsNullOrWhiteSpace(bc)) continue;
        var qty = 0d;
        var qCell = ws.Cell(r, 2);
        if (qCell.DataType == XLDataType.Number) qty = qCell.GetDouble();
        else double.TryParse(qCell.GetFormattedString(), NumberStyles.Any, CultureInfo.InvariantCulture, out qty);
        var note = (ws.Cell(r, 3).GetFormattedString() ?? "").Trim();
        list.Add(new ExcelLine(r, bc, qty, note));
    }
    return list;
}

static async Task<Dictionary<long, Node>> LoadNodesAsync(DbConnection conn)
{
    var nodes = new Dictionary<long, Node>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT Seq, Father, Name1, Num, Barcode, CurTot1, Last, CurAvrg, SellPr4 FROM File13n";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = ToLong(r.GetValue(0));
        nodes[seq] = new Node(
            seq,
            r.IsDBNull(1) ? 0 : ToLong(r.GetValue(1)),
            ReadStr(r.GetValue(2)),
            ReadStr(r.GetValue(3)),
            ReadStr(r.GetValue(4)),
            ToNullableDouble(r.GetValue(5)),
            ToNullableDouble(r.GetValue(6)),
            ToNullableDouble(r.GetValue(7)),
            ToNullableDouble(r.GetValue(8)));
    }
    return nodes;
}

static async Task<List<(long EdNum, string BarCode)>> LoadExtraBarcodesAsync(DbConnection conn)
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
        Console.WriteLine($"تنبيه File13BC: {ex.Message}");
    }
    return list;
}

static async Task<Dictionary<long, string>> LoadCorrectedNamesAsync()
{
    var map = new Dictionary<long, string>();
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
            var name = r.IsDBNull(1) ? null : r.GetString(1).Trim();
            if (!string.IsNullOrWhiteSpace(name))
                map[ToLong(r.GetValue(0))] = name;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه أسماء SQL: {ex.Message}");
    }
    return map;
}

static Node? FindFolderByNum(Dictionary<long, Node> nodes, string num)
{
    var exact = nodes.Values.FirstOrDefault(n =>
        string.Equals((n.Num ?? "").Trim(), num, StringComparison.OrdinalIgnoreCase));
    if (exact is not null) return exact;
    return nodes.Values.FirstOrDefault(n =>
        (n.Num ?? "").Trim().StartsWith(num, StringComparison.OrdinalIgnoreCase));
}

static async Task<(long Seq, string Num, string Name)?> FindAccountByNumAsync(DbConnection conn, string num)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, Num, Name1 FROM File11n WHERE Num = '{Esc(num)}'";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return null;
    return (ToLong(r.GetValue(0)), ReadStr(r.GetValue(1)) ?? num, ReadStr(r.GetValue(2)) ?? "");
}

static List<MatchRow> MatchLines(
    List<ExcelLine> lines,
    Dictionary<long, Node> nodes,
    HashSet<long> fatherSeqs,
    List<(long EdNum, string BarCode)> extraBc,
    Dictionary<long, string> names)
{
    var byExact = new Dictionary<string, List<Node>>(StringComparer.OrdinalIgnoreCase);
    void AddKey(string? key, Node n)
    {
        key = NormalizeBc(key);
        if (string.IsNullOrWhiteSpace(key)) return;
        if (!byExact.TryGetValue(key, out var list))
            byExact[key] = list = [];
        if (list.All(x => x.Seq != n.Seq)) list.Add(n);
    }
    foreach (var n in nodes.Values)
    {
        AddKey(n.Barcode, n);
        AddKey(n.Num, n);
    }
    foreach (var (ed, bc) in extraBc)
    {
        if (nodes.TryGetValue(ed, out var n))
            AddKey(bc, n);
    }

    var result = new List<MatchRow>();
    foreach (var line in lines)
    {
        var key = NormalizeBc(line.Barcode);
        var candidates = new List<(Node Node, string How)>();

        void Collect(string k, string how)
        {
            if (byExact.TryGetValue(k, out var found))
                foreach (var n in found)
                    if (candidates.All(c => c.Node.Seq != n.Seq))
                        candidates.Add((n, how));
        }

        Collect(key, "مطابقة تامة");
        if (key.Length > 0 && !key.StartsWith('0'))
            Collect("0" + key, "صفر بادئ");
        if (key.StartsWith('0') && key.Length > 1)
            Collect(key.TrimStart('0'), "بدون صفر بادئ");

        if (candidates.Count == 0 && key.Length >= 5 && key.Length < 13)
        {
            var suffix = nodes.Values
                .Where(n =>
                    EndsWithDigits(n.Barcode, key) ||
                    EndsWithDigits(n.Num, key) ||
                    extraBc.Any(b => b.EdNum == n.Seq && EndsWithDigits(b.BarCode, key)))
                .ToList();
            if (suffix.Count == 1)
                candidates.Add((suffix[0], "لاحقة فريدة (باركود ناقص)"));
            else if (suffix.Count > 1)
            {
                result.Add(new MatchRow(line, null, "متعدد",
                    $"لاحقة غير فريدة ({suffix.Count}): " + string.Join(", ", suffix.Take(6).Select(s => s.Seq))));
                continue;
            }
        }

        if (candidates.Count == 0)
        {
            result.Add(new MatchRow(line, null, "غير موجود", line.Note));
            continue;
        }

        var leaf = candidates.Where(c => !fatherSeqs.Contains(c.Node.Seq)).ToList();
        var pick = (leaf.Count > 0 ? leaf : candidates)
            .OrderBy(c => c.How == "مطابقة تامة" ? 0 : 1)
            .ThenBy(c => c.Node.Seq)
            .First();

        var how = pick.How;
        if (fatherSeqs.Contains(pick.Node.Seq))
            how += " (مجلد — ليس منتجاً عادياً)";
        result.Add(new MatchRow(line, pick.Node, how, line.Note));
    }
    return result;
}

static void PrintMatchSummary(List<MatchRow> matches)
{
    var ok = matches.Where(m => m.Node is not null && !m.How.Contains("مجلد")).ToList();
    var folders = matches.Where(m => m.How.Contains("مجلد")).ToList();
    var missing = matches.Where(m => m.Node is null && m.How == "غير موجود").ToList();
    var multi = matches.Where(m => m.How == "متعدد").ToList();
    Console.WriteLine();
    Console.WriteLine("=== نتيجة المطابقة ===");
    Console.WriteLine($"مطابق كمنتج عادي: {ok.Count}");
    Console.WriteLine($"مطابق كمجلد: {folders.Count}");
    Console.WriteLine($"غير موجود: {missing.Count}");
    Console.WriteLine($"لاحقة غير فريدة: {multi.Count}");
    if (missing.Count > 0)
    {
        Console.WriteLine("غير الموجود:");
        foreach (var m in missing)
            Console.WriteLine($"  صف {m.Line.Row}  {m.Line.Barcode}  qty={m.Line.Qty}  {m.Line.Note}");
    }
    if (multi.Count > 0)
    {
        Console.WriteLine("غير فريد:");
        foreach (var m in multi)
            Console.WriteLine($"  صف {m.Line.Row}  {m.Line.Barcode}  {m.Note}");
    }
}

static async Task ExportAsync(
    DbConnection conn,
    List<string> columns,
    Dictionary<long, Node> nodes,
    Dictionary<long, string> names,
    List<(long EdNum, string BarCode)> extraBc,
    List<MatchRow> matches,
    Node targetFolder,
    (long Seq, string Num, string Name) account,
    string outDir)
{
    var matchedSeqs = matches.Where(m => m.Node is not null).Select(m => m.Node!.Seq).Distinct().ToList();
    Console.WriteLine();
    Console.WriteLine($"جاري جلب كل أعمدة File13n لـ {matchedSeqs.Count} منتج قديم...");
    var fullRows = new List<Dictionary<string, object?>>();
    foreach (var chunk in Chunk(matchedSeqs, 150))
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT * FROM File13n WHERE Seq IN ({string.Join(",", chunk)})";
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

    var reportPath = Path.Combine(outDir, "سيتات-عطور-المنتجات-القديمة.xlsx");
    using (var wb = new XLWorkbook())
    {
        var ws = wb.AddWorksheet("المنتجات القديمة");
        var headers = new[]
        {
            "صف الإكسل", "باركود الملف", "الكمية المطلوبة", "ملاحظة الملف", "حالة المطابقة",
            "Seq", "الرقم (Num)", "الباركود الحالي", "الاسم",
            "مسار الشجرة الحالي", "المجلد الأب Seq", "اسم المجلد الأب", "رقم شجرة الأب",
            "سعر الشراء Last", "متوسط التكلفة CurAvrg", "سعر المستهلك SellPr4",
            "المخزون CurTot1", "مخزون2", "مخزون3",
            "الشجرة الهدف", "حساب الفاتورة"
        };
        for (var i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        ws.Row(1).Style.Font.Bold = true;
        var row = 2;
        foreach (var m in matches)
        {
            var n = m.Node;
            var full = n is null ? null : fullRows.FirstOrDefault(d => ToLong(d.GetValueOrDefault("Seq")) == n.Seq);
            ws.Cell(row, 1).Value = m.Line.Row;
            ws.Cell(row, 2).Value = m.Line.Barcode;
            ws.Cell(row, 3).Value = m.Line.Qty;
            ws.Cell(row, 4).Value = m.Line.Note;
            ws.Cell(row, 5).Value = m.How;
            if (n is not null)
            {
                ws.Cell(row, 6).Value = n.Seq;
                ws.Cell(row, 7).Value = n.Num ?? "";
                ws.Cell(row, 8).Value = n.Barcode ?? "";
                ws.Cell(row, 9).Value = ResolveName(n.Seq, n.Name1, names);
                ws.Cell(row, 10).Value = BuildTreePath(n.Seq, nodes, names);
                ws.Cell(row, 11).Value = n.Father;
                ws.Cell(row, 12).Value = n.Father > 0 && nodes.TryGetValue(n.Father, out var p)
                    ? ResolveName(p.Seq, p.Name1, names) : "";
                ws.Cell(row, 13).Value = n.Father > 0 && nodes.TryGetValue(n.Father, out var p2) ? (p2.Num ?? "") : "";
                ws.Cell(row, 14).Value = n.Last ?? GetNum(full, "Last");
                ws.Cell(row, 15).Value = n.CurAvrg ?? GetNum(full, "CurAvrg");
                ws.Cell(row, 16).Value = n.SellPr4 ?? GetNum(full, "SellPr4");
                ws.Cell(row, 17).Value = n.CurTot1 ?? 0;
                ws.Cell(row, 18).Value = GetNum(full, "CurTot2");
                ws.Cell(row, 19).Value = GetNum(full, "CurTot3");
            }
            ws.Cell(row, 20).Value = $"{targetFolder.Num} (Seq {targetFolder.Seq})";
            ws.Cell(row, 21).Value = $"{account.Num} {account.Name} (Seq {account.Seq})";
            row++;
        }
        ws.SheetView.Freeze(1, 0);
        ws.Columns().AdjustToContents();

        var sum = wb.AddWorksheet("ملخص");
        sum.Cell(1, 1).Value = "العنصر";
        sum.Cell(1, 2).Value = "القيمة";
        sum.Cell(2, 1).Value = "تاريخ التصدير";
        sum.Cell(2, 2).Value = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        sum.Cell(3, 1).Value = "قاعدة Edari";
        sum.Cell(3, 2).Value = DatabaseAlias;
        sum.Cell(4, 1).Value = "أسطر الملف";
        sum.Cell(4, 2).Value = matches.Count;
        sum.Cell(5, 1).Value = "مطابق";
        sum.Cell(5, 2).Value = matches.Count(m => m.Node is not null && !m.How.Contains("مجلد"));
        sum.Cell(6, 1).Value = "غير موجود";
        sum.Cell(6, 2).Value = matches.Count(m => m.Node is null);
        sum.Cell(7, 1).Value = "مجموع الكميات";
        sum.Cell(7, 2).Value = matches.Sum(m => m.Line.Qty);
        sum.Cell(8, 1).Value = "الشجرة الهدف";
        sum.Cell(8, 2).Value = $"{targetFolder.Num} Seq={targetFolder.Seq}";
        sum.Cell(9, 1).Value = "حساب الفاتورة";
        sum.Cell(9, 2).Value = $"{account.Num} {account.Name} Seq={account.Seq}";
        sum.Columns().AdjustToContents();
        wb.SaveAs(reportPath);
    }
    Console.WriteLine($"تقرير الإكسل: {reportPath}");

    var backupPath = Path.Combine(outDir, "full-backup.json");
    var jsonRows = fullRows.Select(d =>
    {
        var dict = d.ToDictionary(
            kv => kv.Key,
            kv => (object?)(kv.Value is byte[] bytes ? Convert.ToBase64String(bytes) : kv.Value),
            StringComparer.OrdinalIgnoreCase);
        var seq = ToLong(d.GetValueOrDefault("Seq"));
        if (names.TryGetValue(seq, out var corrected)) dict["Name1_Corrected"] = corrected;
        return dict;
    });
    File.WriteAllText(backupPath, JsonSerializer.Serialize(new
    {
        ExportedAtUtc = DateTime.UtcNow,
        DatabaseAlias,
        TargetTree = new { targetFolder.Seq, targetFolder.Num },
        Account = account,
        ExcelLines = matches.Select(m => new
        {
            m.Line.Row,
            m.Line.Barcode,
            m.Line.Qty,
            m.Line.Note,
            m.How,
            ProductSeq = m.Node?.Seq,
            OldFather = m.Node?.Father
        }),
        Products = jsonRows,
        ExtraBarcodes = extraBc.Where(b => matchedSeqs.Contains(b.EdNum)),
    }, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(true));
    Console.WriteLine($"نسخة احتياطية JSON: {backupPath}");
    File.WriteAllText(Path.Combine(outDir, "export-dir.txt"), outDir);
}

static void CopyToDesktop(string outDir)
{
    var report = Directory.GetFiles(outDir, "*.xlsx").FirstOrDefault();
    if (report is null) return;
    var dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        Path.GetFileName(report));
    File.Copy(report, dest, true);
    Console.WriteLine($"نسخة على سطح المكتب: {dest}");
}

static async Task MoveAsync(DbConnection conn, List<MatchRow> matches, long targetSeq, string outDir)
{
    var toMove = matches
        .Where(m => m.Node is not null && !m.How.Contains("مجلد"))
        .GroupBy(m => m.Node!.Seq)
        .Select(g => g.First().Node!)
        .Where(n => n.Father != targetSeq)
        .ToList();
    var already = matches.Where(m => m.Node is not null && m.Node.Father == targetSeq).Select(m => m.Node!.Seq).Distinct().Count();
    Console.WriteLine();
    Console.WriteLine($"للنقل إلى {TargetTreeNum}: {toMove.Count}  |  موجود أصلاً في الشجرة: {already}");
    if (toMove.Count == 0)
    {
        Console.WriteLine("لا يوجد ما يُنقل.");
        return;
    }

    var moved = new List<(long Seq, long OldFather)>();
    foreach (var n in toMove)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE File13n SET Father = {targetSeq} WHERE Seq = {n.Seq}";
        cmd.CommandTimeout = 60;
        await cmd.ExecuteNonQueryAsync();
        moved.Add((n.Seq, n.Father));
    }
    Console.WriteLine($"تم تحديث Father لـ {moved.Count} مادة.");

    var oldFolders = moved.Select(m => m.OldFather).Distinct().Where(f => f > 0).ToList();
    foreach (var folderSeq in oldFolders)
    {
        var gone = moved.Where(m => m.OldFather == folderSeq).Select(m => m.Seq).ToHashSet();
        await RewriteSubAsync(conn, folderSeq, keep: refs => refs.Where(r => !gone.Contains(r)).ToList());
    }
    await RewriteSubAsync(conn, targetSeq, keep: refs =>
    {
        foreach (var seq in moved.Select(m => m.Seq))
            if (!refs.Contains(seq)) refs.Add(seq);
        return refs;
    });

    var issues = new List<string>();
    foreach (var folder in oldFolders.Concat([targetSeq]).Distinct())
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT SubCount, Sub FROM File13n WHERE Seq = {folder}";
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync()) continue;
        var subCount = ToLong(r.GetValue(0));
        var subLen = r.IsDBNull(1) ? 0 : ((byte[])r.GetValue(1)).Length;
        await using var c2 = conn.CreateCommand();
        c2.CommandText = $"SELECT COUNT(*) FROM File13n WHERE Father = {folder}";
        var live = ToLong(await c2.ExecuteScalarAsync() ?? 0L);
        if (subLen / 4 != subCount || subCount != live)
            issues.Add($"Seq={folder}: SubCount={subCount} Sub/4={subLen / 4} Father-count={live}");
    }

    File.WriteAllText(Path.Combine(outDir, $"move-log-{DateTime.Now:yyyyMMdd-HHmmss}.json"),
        JsonSerializer.Serialize(new { Moved = moved, Issues = issues }, new JsonSerializerOptions { WriteIndented = true }),
        new UTF8Encoding(true));
    Console.WriteLine(issues.Count == 0
        ? "فهارس الشجرة متوافقة بعد النقل."
        : "تحذير فهارس: " + string.Join(" | ", issues));
}

static async Task RestoreMissingAndAppendInvoiceAsync(
    DbConnection conn,
    List<MatchRow> matches,
    Node targetFolder,
    (long Seq, string Num, string Name) account,
    string backupsRoot)
{
    const long invoiceSeq = 62;
    var missingLines = matches.Where(m => m.Node is null && m.Line.Qty > 0).ToList();
    if (missingLines.Count == 0)
    {
        Console.WriteLine("لا توجد باركودات ناقصة.");
        return;
    }

    Console.WriteLine($"باركودات بدون بطاقة: {missingLines.Count}");
    var backupDir = Directory.GetDirectories(backupsRoot, "edari-zero-stock-*")
        .OrderByDescending(d => d)
        .FirstOrDefault(d => File.Exists(Path.Combine(d, "full-backup.json")))
        ?? throw new InvalidOperationException("لم يُعثر على full-backup.json للحذف الصفري");
    var backupJson = Path.Combine(backupDir, "full-backup.json");
    Console.WriteLine($"النسخة الاحتياطية: {backupJson}");

    Console.WriteLine("جاري البحث في النسخة الاحتياطية...");
    var fromBackup = FindProductsInBackup(backupJson, missingLines.Select(m => m.Line.Barcode).Distinct().ToList());
    foreach (var kv in fromBackup)
        Console.WriteLine($"  نسخة 2026: {kv.Key} → Seq={ToLong(kv.Value.GetValueOrDefault("Seq"))} SellPr4={GetNum(kv.Value, "SellPr4")} Name={GetStr(kv.Value, "Name1_Corrected") ?? GetStr(kv.Value, "Name1")}");

    var still = missingLines.Select(m => NormalizeBc(m.Line.Barcode))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Where(bc => !fromBackup.ContainsKey(bc) && !fromBackup.Keys.Any(k => NormalizeBc(k) == bc))
        .ToList();

    var from2025 = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
    if (still.Count > 0)
    {
        Console.WriteLine($"غير موجودة في نسخة 2026 — بحث في قاعدة 2025: {string.Join(", ", still)}");
        from2025 = await FindProductsInYearAsync(still, "2025");
        foreach (var kv in from2025)
            Console.WriteLine($"  2025: {kv.Key} → Seq={ToLong(kv.Value.GetValueOrDefault("Seq"))} SellPr4={GetNum(kv.Value, "SellPr4")}");
    }

    var extraBcBackup = LoadBackupExtraBarcodes(backupJson);
    var cols13 = await GetColumnNamesAsync(conn, "File13n");
    var restored = new List<(string ExcelBc, long Seq, double SellPr4, double Last, double CurAvrg)>();

    foreach (var miss in missingLines)
    {
        var excelBc = miss.Line.Barcode;
        var key = NormalizeBc(excelBc);
        Dictionary<string, object?>? row = null;
        if (fromBackup.TryGetValue(excelBc, out var b1)) row = b1;
        else
        {
            var hit = fromBackup.FirstOrDefault(kv => NormalizeBc(kv.Key) == key);
            if (hit.Value is not null) row = hit.Value;
        }
        row ??= from2025.GetValueOrDefault(key) ?? from2025.GetValueOrDefault(excelBc);

        if (row is null)
        {
            Console.WriteLine($"  !! {excelBc}: لا بطاقة في النسخ — لن أختلق مادة بلا أسعار.");
            continue;
        }

        var oldSeq = ToLong(row.GetValueOrDefault("Seq"));
        var live = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Seq = {oldSeq}");
        long seq;
        if (live > 0)
        {
            seq = oldSeq;
            Console.WriteLine($"  {excelBc}: Seq={seq} موجودة — سأحدث العائدية والباركود فقط.");
        }
        else
        {
            seq = oldSeq;
            var clash = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Seq = {seq}");
            if (clash > 0)
                seq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;

            row["Seq"] = seq;
            row["Father"] = targetFolder.Seq;
            row["Sub"] = null;
            row["SubCount"] = 0;
            row["CurTot1"] = 0d;
            if (!string.IsNullOrWhiteSpace(GetStr(row, "Name1_Corrected")))
                row["Name1"] = GetStr(row, "Name1_Corrected");
            if (!string.IsNullOrWhiteSpace(excelBc))
            {
                if (row.ContainsKey("Barcode")) row["Barcode"] = excelBc.Replace("G", "", StringComparison.OrdinalIgnoreCase);
                if (row.ContainsKey("Num") && string.IsNullOrWhiteSpace(GetStr(row, "Num")))
                    row["Num"] = excelBc;
            }

            var insertCols = cols13.Where(c =>
                !c.Equals("Sub", StringComparison.OrdinalIgnoreCase) &&
                row.ContainsKey(c)).ToList();
            var insert = insertCols.ToDictionary(c => c, c => row.GetValueOrDefault(c), StringComparer.OrdinalIgnoreCase);
            await using var ins = conn.CreateCommand();
            ins.CommandText = BuildInsertSql(insert, "File13n");
            ins.CommandTimeout = 60;
            await ins.ExecuteNonQueryAsync();
            Console.WriteLine($"  ✓ أُعيدت البطاقة {excelBc} Seq={seq}");
        }

        await using (var upd = conn.CreateCommand())
        {
            upd.CommandText = $"UPDATE File13n SET Father = {targetFolder.Seq} WHERE Seq = {seq}";
            await upd.ExecuteNonQueryAsync();
        }

        var bc = (GetStr(row, "Barcode") ?? excelBc).Replace("G", "", StringComparison.OrdinalIgnoreCase);
        await EnsureBarcodeAsync(conn, seq, bc);
        if (!string.Equals(bc, excelBc, StringComparison.OrdinalIgnoreCase))
            await EnsureBarcodeAsync(conn, seq, excelBc);

        foreach (var extra in extraBcBackup.Where(x => x.EdNum == oldSeq || string.Equals(NormalizeBc(x.BarCode), key, StringComparison.OrdinalIgnoreCase)))
            await EnsureBarcodeAsync(conn, seq, extra.BarCode);

        restored.Add((excelBc, seq, GetNum(row, "SellPr4") ?? 0, GetNum(row, "Last") ?? 0, GetNum(row, "CurAvrg") ?? 0));
    }

    var uniqueRestored = restored.GroupBy(x => x.Seq).Select(g => g.First()).ToList();
    await RewriteSubAsync(conn, targetFolder.Seq, keep: refs =>
    {
        foreach (var r in uniqueRestored)
            if (!refs.Contains(r.Seq)) refs.Add(r.Seq);
        return refs;
    });
    Console.WriteLine($"فهرس 011013 حُدِّث. بطاقات جاهزة: {uniqueRestored.Count}");

    if (uniqueRestored.Count == 0)
        throw new InvalidOperationException("لم تُستعد أي بطاقة — توقفت قبل تعديل الفاتورة");

    var headerCols = await GetColumnNamesAsync(conn, "File15n");
    var header = await ReadRowAsync(conn, "File15n", invoiceSeq, headerCols);
    if (header.Count == 0)
        throw new InvalidOperationException($"الفاتورة Seq={invoiceSeq} غير موجودة");

    var cols14 = await GetColumnNamesAsync(conn, "File14n");
    var tplSeq = await ScalarLongAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {invoiceSeq} ORDER BY Seq");
    var lineTpl = await ReadRowAsync(conn, "File14n", tplSeq, cols14);
    var saleAcc = ToLong(header.GetValueOrDefault("DKindRecNo"));
    var nextLineSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
    var now = DateTime.Now;
    var billDate = header.GetValueOrDefault("Date") as DateTime? ?? DateTime.Today;
    var billNum = ToLong(header.GetValueOrDefault("Num"));

    var addedAmt = 0d;
    var addedLines = 0;
    var grouped = missingLines
        .Join(restored, m => NormalizeBc(m.Line.Barcode), r => NormalizeBc(r.ExcelBc), (m, r) => (m.Line.Qty, r))
        .GroupBy(x => x.r.Seq)
        .Select(g => (g.First().r, Qty: g.Sum(x => x.Qty)))
        .ToList();

    foreach (var (prod, qty) in grouped)
    {
        var exists = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {invoiceSeq} AND Mat = {prod.Seq}");
        if (exists > 0)
        {
            Console.WriteLine($"  الفاتورة فيها Seq={prod.Seq} مسبقاً — تخطّي التكرار.");
            continue;
        }

        var price = prod.SellPr4;
        var lineRow = new Dictionary<string, object?>(lineTpl, StringComparer.OrdinalIgnoreCase);
        lineRow["Seq"] = nextLineSeq;
        lineRow["BillSeq"] = invoiceSeq;
        lineRow["Date"] = billDate;
        lineRow["Quant"] = qty;
        lineRow["Price"] = price;
        lineRow["Two"] = account.Seq;
        lineRow["Kind"] = 4;
        lineRow["Mat"] = prod.Seq;
        lineRow["BillNo"] = billNum;
        lineRow["Frst"] = saleAcc;
        lineRow["MatName"] = "";
        lineRow["OCurAvrg"] = prod.CurAvrg > 0 ? prod.CurAvrg : prod.Last;
        lineRow["OCCAvrg"] = prod.CurAvrg > 0 ? prod.CurAvrg : prod.Last;
        lineRow["OCurTot"] = 0d;
        if (lineRow.ContainsKey("DtCreated")) lineRow["DtCreated"] = now;
        if (lineRow.ContainsKey("DtModified")) lineRow["DtModified"] = now;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = BuildInsertSql(lineRow, "File14n");
            await cmd.ExecuteNonQueryAsync();
        }

        await using (var upd = conn.CreateCommand())
        {
            upd.CommandText = $"UPDATE File13n SET CurTot1 = CurTot1 - {Inv(qty)} WHERE Seq = {prod.Seq}";
            await upd.ExecuteNonQueryAsync();
        }

        addedAmt += qty * price;
        addedLines++;
        nextLineSeq++;
        Console.WriteLine($"  ✓ أُضيف للفاتورة Mat={prod.Seq} qty={qty} price={price:N0}");
    }

    var newCount = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {invoiceSeq}");
    var newTotal = ToDouble(header.GetValueOrDefault("Total")) + addedAmt;
    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"UPDATE File15n SET Total = {Inv(newTotal)}, \"count\" = {newCount} WHERE Seq = {invoiceSeq}";
        await upd.ExecuteNonQueryAsync();
        upd.CommandText = $"UPDATE File12n SET Am = {Inv(newTotal)} WHERE BillSeq = {invoiceSeq}";
        await upd.ExecuteNonQueryAsync();
    }

    Console.WriteLine();
    Console.WriteLine($"=== تم === أُضيف {addedLines} سطر | أسطر الفاتورة الآن={newCount} | الإجمالي={newTotal:N2}");
}

static Dictionary<string, Dictionary<string, object?>> FindProductsInBackup(string path, List<string> barcodes)
{
    var wanted = barcodes
        .SelectMany(bc => new[] { bc, NormalizeBc(bc), NormalizeBc(bc).Replace("G", "", StringComparison.OrdinalIgnoreCase) })
        .Where(s => !string.IsNullOrWhiteSpace(s))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    using var doc = JsonDocument.Parse(File.ReadAllText(path));
    var seqByBc = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
    if (doc.RootElement.TryGetProperty("ExtraBarcodes", out var extras))
    {
        foreach (var e in extras.EnumerateArray())
        {
            var bc = e.TryGetProperty("BarCode", out var b) ? b.GetString() : null;
            if (string.IsNullOrWhiteSpace(bc) || !wanted.Contains(bc) && !wanted.Contains(NormalizeBc(bc))) continue;
            seqByBc[bc] = e.GetProperty("EdNum").GetInt64();
        }
    }

    var found = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
    foreach (var p in doc.RootElement.GetProperty("Products").EnumerateArray())
    {
        var dict = JsonToRow(p);
        var seq = ToLong(dict.GetValueOrDefault("Seq"));
        var keys = new[]
        {
            GetStr(dict, "Barcode"), GetStr(dict, "Num"), GetStr(dict, "Extra8")
        }.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!)
         .Concat(seqByBc.Where(kv => kv.Value == seq).Select(kv => kv.Key));

        foreach (var k in keys)
        {
            if (wanted.Contains(k) || wanted.Contains(NormalizeBc(k)))
                found[k] = dict;
        }
    }
    return found;
}

static List<(long EdNum, string BarCode)> LoadBackupExtraBarcodes(string path)
{
    var list = new List<(long, string)>();
    try
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        if (!doc.RootElement.TryGetProperty("ExtraBarcodes", out var extras)) return list;
        foreach (var e in extras.EnumerateArray())
        {
            var bc = e.TryGetProperty("BarCode", out var b) ? b.GetString() : null;
            if (!string.IsNullOrWhiteSpace(bc))
                list.Add((e.GetProperty("EdNum").GetInt64(), bc));
        }
    }
    catch { /* optional */ }
    return list;
}

static Dictionary<string, object?> JsonToRow(JsonElement p)
{
    var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    foreach (var prop in p.EnumerateObject())
    {
        object? v = prop.Value.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.String => prop.Value.GetString(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when prop.Value.TryGetInt64(out var l) => l,
            JsonValueKind.Number => prop.Value.GetDouble(),
            _ => null
        };
        dict[prop.Name] = v;
    }
    return dict;
}

static async Task<Dictionary<string, Dictionary<string, object?>>> FindProductsInYearAsync(List<string> barcodes, string alias)
{
    var map = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);
    try
    {
        await using var year = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
        year.ConnectionString = $"server=127.0.0.1;database={alias};port=16000;Native=true";
        await year.OpenAsync();
        var cols = await GetColumnNamesAsync(year, "File13n");
        foreach (var bc in barcodes)
        {
            var digits = new string(bc.Where(char.IsDigit).ToArray());
            long seq = 0;
            await using (var cmd = year.CreateCommand())
            {
                cmd.CommandText = $"""
                    SELECT TOP 1 Seq FROM File13n
                    WHERE Barcode = '{Esc(bc)}' OR Num = '{Esc(bc)}' OR Extra8 = '{Esc(bc)}'
                       OR Barcode = '{Esc(digits)}' OR Num = '{Esc(digits)}'
                    """;
                seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
            }
            if (seq <= 0 && digits.Length >= 8)
            {
                await using var cmd = year.CreateCommand();
                cmd.CommandText = $"SELECT TOP 1 EdNum FROM File13BC WHERE BarCode LIKE '%{Esc(digits)}%'";
                seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
            }
            if (seq <= 0 && digits.Length >= 8)
            {
                await using var cmd = year.CreateCommand();
                cmd.CommandText = $"""
                    SELECT TOP 1 Seq FROM File13n
                    WHERE Barcode LIKE '%{Esc(digits)}%' OR Num LIKE '%{Esc(digits)}%' OR Extra8 LIKE '%{Esc(digits)}%'
                    """;
                seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
            }
            if (seq <= 0) continue;
            var row = await ReadRowAsync(year, "File13n", seq, cols);
            if (row.Count > 0) map[bc] = row;
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه بحث {alias}: {ex.Message}");
    }
    return map;
}

static async Task EnsureBarcodeAsync(DbConnection conn, long seq, string barcode)
{
    barcode = barcode.Trim();
    if (string.IsNullOrWhiteSpace(barcode)) return;
    var exists = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13BC WHERE BarCode = '{Esc(barcode)}'");
    if (exists > 0)
    {
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File13BC SET EdNum = {seq} WHERE BarCode = '{Esc(barcode)}'";
        await upd.ExecuteNonQueryAsync();
        return;
    }
    try
    {
        await using var ins = conn.CreateCommand();
        ins.CommandText = $"INSERT INTO File13BC (EdNum, BarCode, Qty, NoDscnt) VALUES ({seq}, '{Esc(barcode)}', 1, False)";
        await ins.ExecuteNonQueryAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  تنبيه باركود {barcode}: {ex.Message.Split('\n')[0]}");
    }
}

static string? GetStr(Dictionary<string, object?>? row, string col)
    => row is not null && row.TryGetValue(col, out var v) ? ReadStr(v) : null;

static async Task RepairInvoiceVoucherAsync(DbConnection conn, long billSeq)
{
    Console.WriteLine($"=== إصلاح سند الفاتورة Seq={billSeq} ===");
    var cols15 = await GetColumnNamesAsync(conn, "File15n");
    var header = await ReadRowAsync(conn, "File15n", billSeq, cols15);
    if (header.Count == 0)
        throw new InvalidOperationException($"فاتورة Seq={billSeq} غير موجودة");

    var num = ToLong(header.GetValueOrDefault("Num"));
    var kind = ToLong(header.GetValueOrDefault("Kind"));
    var two = ToLong(header.GetValueOrDefault("Two"));
    var total = ToDouble(header.GetValueOrDefault("Total"));
    var dayBill = ToLong(header.GetValueOrDefault("DayBillN"));
    var count = ToLong(header.GetValueOrDefault("count"));
    Console.WriteLine($"File15n: Num={num} Kind={kind} Two={two} Total={total:N2} DayBillN={dayBill} count={count}");

    var lineCount = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {billSeq}");
    var lineKind4 = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {billSeq} AND Kind = 4");
    var lineMats = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {billSeq} AND Mat > 0");
    Console.WriteLine($"File14n: أسطر={lineCount}  Kind4={lineKind4}  لها مادة={lineMats}");

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"""
            SELECT Seq, Num, Acc, Dept, Am, BillSeq, BillKind, BillNum, ForBill, Exp1, Exp2
            FROM File12n WHERE BillSeq = {billSeq} OR Num = {dayBill}
            ORDER BY Seq
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        Console.WriteLine("قيود File12n المرتبطة برقم السند أو بالفاتورة:");
        var n = 0;
        while (await r.ReadAsync())
        {
            n++;
            Console.WriteLine(
                $"  Seq={ToLong(r.GetValue(0))} Num={ToLong(r.GetValue(1))} Acc={ToLong(r.GetValue(2))} Dept={r.GetValue(3)} Am={ToDouble(r.GetValue(4)):N2} BillSeq={ToLong(r.GetValue(5))} BillKind={ToLong(r.GetValue(6))} BillNum={ToLong(r.GetValue(7))} ForBill={r.GetValue(8)} Exp1={ReadStr(r.GetValue(9))} Exp2={ReadStr(r.GetValue(10))}");
        }
        if (n == 0) Console.WriteLine("  لا قيود");
    }

    var sameNumAll = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File12n WHERE Num = {dayBill}");
    var sameNumOtherBills = await ScalarLongAsync(conn,
        $"SELECT COUNT(*) FROM File12n WHERE Num = {dayBill} AND (BillSeq IS NULL OR BillSeq <> {billSeq})");
    var otherInvoices = await ScalarLongAsync(conn,
        $"SELECT COUNT(*) FROM File15n WHERE DayBillN = {dayBill} AND Seq <> {billSeq}");
    Console.WriteLine($"قيود بنفس رقم السند {dayBill}: {sameNumAll}  |  ليست لهذه الفاتورة: {sameNumOtherBills}  |  فواتير أخرى بنفس DayBillN: {otherInvoices}");

    if (lineCount == 0)
        throw new InvalidOperationException("أسطر الفاتورة مفقودة من File14n — لا يمكن الإصلاح بالسند فقط");

    var newVoucher = await GetNextVoucherNumAsync(conn);
    Console.WriteLine($"سند جديد فريد: {newVoucher}");

    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"UPDATE File15n SET DayBillN = {newVoucher} WHERE Seq = {billSeq}";
        await upd.ExecuteNonQueryAsync();
        upd.CommandText = $"UPDATE File12n SET Num = {newVoucher} WHERE BillSeq = {billSeq}";
        var entries = await upd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ DayBillN {dayBill} → {newVoucher}  |  قيود محدَّثة: {entries}");
    }

    var stillShared = await ScalarLongAsync(conn,
        $"SELECT COUNT(*) FROM File12n WHERE Num = {newVoucher} AND (BillSeq IS NULL OR BillSeq <> {billSeq})");
    var linesAfter = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {billSeq}");
    var dayAfter = await ScalarLongAsync(conn, $"SELECT DayBillN FROM File15n WHERE Seq = {billSeq}");
    Console.WriteLine($"بعد الإصلاح: DayBillN={dayAfter}  أسطر={linesAfter}  قيود غريبة على السند الجديد={stillShared}");
    Console.WriteLine("أعد فتح فاتورة المبيعات رقم 6 في الإداري.");
}

static async Task AttachPerfumeFolderToMainTreeAsync(DbConnection conn, long folderSeq, long rootSeq)
{
    var father = await ScalarLongAsync(conn, $"SELECT Father FROM File13n WHERE Seq = {folderSeq}");
    if (father != rootSeq)
    {
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File13n SET Father = {rootSeq} WHERE Seq = {folderSeq}";
        await upd.ExecuteNonQueryAsync();
        Console.WriteLine($"رُبطت الشجرة {folderSeq} تحت المجلد الرئيسي {rootSeq} (كان Father={father})");
    }
    else
    {
        Console.WriteLine($"الشجرة {folderSeq} مربوطة مسبقاً تحت {rootSeq}");
    }

    await RewriteSubAsync(conn, rootSeq, keep: refs =>
    {
        if (!refs.Contains(folderSeq)) refs.Add(folderSeq);
        return refs;
    });
    var live = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Father = {rootSeq}");
    var stored = await ScalarLongAsync(conn, $"SELECT SubCount FROM File13n WHERE Seq = {rootSeq}");
    Console.WriteLine($"فهرس المجلد الرئيسي: SubCount={stored}  أطفال فعليون={live}");
}

static async Task StockInZeroAsync(DbConnection conn, long folderSeq, string backupsRoot)
{
    const long inAcc = 82;   // 3131 مخزون
    const long adjAcc = 86;  // 3135 تسويات الجرد
    var items = new List<(long Seq, string Num, string Name, double Stock, double Cost)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"""
            SELECT Seq, Num, Name1, CurTot1, Last, CurAvrg
            FROM File13n
            WHERE Father = {folderSeq} AND CurTot1 < 0
            ORDER BY CurTot1, Num
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var stock = ToDouble(r.GetValue(3));
            var last = ToDouble(r.GetValue(4));
            var avrg = ToDouble(r.GetValue(5));
            var cost = avrg > 0 ? avrg : last;
            items.Add((ToLong(r.GetValue(0)), ReadStr(r.GetValue(1)) ?? "", ReadStr(r.GetValue(2)) ?? "", stock, cost));
        }
    }

    if (items.Count == 0)
    {
        Console.WriteLine("لا توجد كميات غير صفرية تحتاج إدخال.");
        return;
    }

    var outDir = Path.Combine(backupsRoot, $"edari-stock-in-zero-{DateTime.Now:yyyyMMdd-HHmmss}");
    Directory.CreateDirectory(outDir);
    File.WriteAllText(Path.Combine(outDir, "before.json"),
        JsonSerializer.Serialize(items.Select(x => new { x.Seq, x.Num, x.Name, x.Stock, x.Cost }),
            new JsonSerializerOptions { WriteIndented = true }),
        new UTF8Encoding(true));
    Console.WriteLine($"نسخة قبل التصفير: {outDir}  |  مواد={items.Count}");

    var templateBillSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File15n WHERE Kind = 3");
    if (templateBillSeq <= 0)
        throw new InvalidOperationException("لا توجد فاتورة إدخال (Kind=3) كقالب");

    var cols15 = await GetColumnNamesAsync(conn, "File15n");
    var cols14 = await GetColumnNamesAsync(conn, "File14n");
    var cols12 = await GetColumnNamesAsync(conn, "File12n");
    var headerTpl = await ReadRowAsync(conn, "File15n", templateBillSeq, cols15);
    var templateLineSeq = await ScalarLongAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {templateBillSeq} ORDER BY Seq");
    var lineTpl = await ReadRowAsync(conn, "File14n", templateLineSeq, cols14);
    var accTplDebit = await ReadFirst12Async(conn, templateBillSeq, cols12, dept: true);
    var accTplCredit = await ReadFirst12Async(conn, templateBillSeq, cols12, dept: false);
    if (headerTpl.Count == 0 || lineTpl.Count == 0 || accTplDebit.Count == 0 || accTplCredit.Count == 0)
        throw new InvalidOperationException("قالب فاتورة الإدخال غير مكتمل");

    var nextBillSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File15n") + 1;
    var nextBillNum = await ScalarLongAsync(conn, "SELECT MAX(Num) FROM File15n WHERE Kind = 3") + 1;
    var nextLineSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
    var nextAccSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File12n") + 1;
    var nextDayBillN = await GetNextVoucherNumAsync(conn);
    var billDate = DateTime.Today;
    var now = DateTime.Now;
    var remarks = $"تصفير سيتات عطور {now:yyyy-MM-dd}";
    var total = items.Sum(x => Math.Abs(x.Stock) * x.Cost);

    var header = new Dictionary<string, object?>(headerTpl, StringComparer.OrdinalIgnoreCase);
    header["Seq"] = nextBillSeq;
    header["Num"] = nextBillNum;
    header["Kind"] = 3;
    header["Date"] = billDate;
    header["Two"] = adjAcc;
    header["Three"] = 0;
    header["remarks"] = remarks;
    header["Total"] = total;
    header["count"] = items.Count;
    header["DKindRecNo"] = inAcc;
    header["DayBillN"] = nextDayBillN;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(header, "File15n");
        cmd.CommandTimeout = 120;
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"فاتورة إدخال Seq={nextBillSeq} Num={nextBillNum} Kind=3 سند={nextDayBillN} أسطر={items.Count} الإجمالي={total:N2}");

    var lineSeq = nextLineSeq;
    foreach (var item in items)
    {
        var qty = Math.Abs(item.Stock);
        var lineRow = new Dictionary<string, object?>(lineTpl, StringComparer.OrdinalIgnoreCase);
        lineRow["Seq"] = lineSeq;
        lineRow["BillSeq"] = nextBillSeq;
        lineRow["Date"] = billDate;
        lineRow["Quant"] = qty;
        lineRow["Price"] = item.Cost;
        lineRow["Two"] = adjAcc;
        lineRow["Kind"] = 3;
        lineRow["Mat"] = item.Seq;
        lineRow["BillNo"] = nextBillNum;
        lineRow["Frst"] = inAcc;
        lineRow["MatName"] = "";
        lineRow["OCurAvrg"] = item.Cost;
        lineRow["OCCAvrg"] = item.Cost;
        lineRow["OCurTot"] = item.Stock;
        if (lineRow.ContainsKey("DtCreated")) lineRow["DtCreated"] = now;
        if (lineRow.ContainsKey("DtModified")) lineRow["DtModified"] = now;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = BuildInsertSql(lineRow, "File14n");
            await cmd.ExecuteNonQueryAsync();
        }

        await using (var upd = conn.CreateCommand())
        {
            upd.CommandText = $"""
                UPDATE File13n SET
                    CurTot1 = 0,
                    InTot = InTot + {Inv(qty)}
                WHERE Seq = {item.Seq}
                """;
            try { await upd.ExecuteNonQueryAsync(); }
            catch
            {
                upd.CommandText = $"UPDATE File13n SET CurTot1 = 0 WHERE Seq = {item.Seq}";
                await upd.ExecuteNonQueryAsync();
            }
        }

        Console.WriteLine($"  إدخال Mat={item.Seq} {item.Num} qty={qty} cost={item.Cost:N0}  ({item.Stock} → 0)");
        lineSeq++;
    }

    var acc1 = new Dictionary<string, object?>(accTplDebit, StringComparer.OrdinalIgnoreCase);
    acc1["Seq"] = nextAccSeq;
    acc1["Num"] = nextDayBillN;
    acc1["Date"] = billDate;
    acc1["Acc"] = inAcc;
    acc1["Dept"] = true;
    acc1["Am"] = total;
    acc1["Ref"] = nextBillNum;
    acc1["ForBill"] = 1;
    acc1["Exp1"] = $"إدخال بالفاتورة {nextBillNum}";
    acc1["Exp2"] = remarks;
    acc1["BillSeq"] = nextBillSeq;
    acc1["BillKind"] = 3;
    acc1["BillNum"] = nextBillNum;
    acc1["Two"] = adjAcc;
    if (acc1.ContainsKey("DtCreated")) acc1["DtCreated"] = now;

    var acc2 = new Dictionary<string, object?>(accTplCredit, StringComparer.OrdinalIgnoreCase);
    acc2["Seq"] = nextAccSeq + 1;
    acc2["Num"] = nextDayBillN;
    acc2["Date"] = billDate;
    acc2["Acc"] = adjAcc;
    acc2["Dept"] = false;
    acc2["Am"] = total;
    acc2["Ref"] = nextBillNum;
    acc2["ForBill"] = 1;
    acc2["Exp1"] = $"إدخال بالفاتورة {nextBillNum}";
    acc2["Exp2"] = remarks;
    acc2["BillSeq"] = nextBillSeq;
    acc2["BillKind"] = 3;
    acc2["BillNum"] = nextBillNum;
    acc2["Two"] = inAcc;
    if (acc2.ContainsKey("DtCreated")) acc2["DtCreated"] = now;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(acc1, "File12n");
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = BuildInsertSql(acc2, "File12n");
        await cmd.ExecuteNonQueryAsync();
    }

    await TryResetAutoIncAsync("File15n", nextBillSeq + 1);
    await TryResetAutoIncAsync("File14n", lineSeq);
    await TryResetAutoIncAsync("File12n", nextAccSeq + 2);

    var stillNeg = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Father = {folderSeq} AND CurTot1 <> 0");
    var verifyLines = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {nextBillSeq}");
    Console.WriteLine($"تحقق: أسطر الإدخال={verifyLines}  مواد لا تزال غير صفر في 011013={stillNeg}");
    Console.WriteLine($"فاتورة الإدخال رقم {nextBillNum} (Seq={nextBillSeq}) على حساب التسوية 3135.");
}

static async Task<long> GetNextVoucherNumAsync(DbConnection conn)
{
    var maxFile12 = await ScalarLongAsync(conn, "SELECT MAX(Num) FROM File12n");
    var maxDayBill = await ScalarLongAsync(conn, "SELECT MAX(DayBillN) FROM File15n");
    return Math.Max(maxFile12, maxDayBill) + 1;
}

static async Task RewriteSubAsync(DbConnection conn, long folderSeq, Func<List<long>, List<long>> keep)
{
    await using var read = conn.CreateCommand();
    read.CommandText = $"SELECT Sub FROM File13n WHERE Seq = {folderSeq}";
    var subObj = await read.ExecuteScalarAsync();
    var subBytes = subObj is byte[] b ? b : [];
    var refs = new List<long>();
    for (var i = 0; i < subBytes.Length - subBytes.Length % 4; i += 4)
        refs.Add(BitConverter.ToInt32(subBytes, i));
    refs = keep(refs);
    var newBytes = new byte[refs.Count * 4];
    for (var i = 0; i < refs.Count; i++)
        BitConverter.GetBytes((int)refs[i]).CopyTo(newBytes, i * 4);

    await using var upd = conn.CreateCommand();
    upd.CommandText = $"UPDATE File13n SET Sub = :SubVal, SubCount = {refs.Count} WHERE Seq = {folderSeq}";
    var p = upd.CreateParameter();
    p.ParameterName = "SubVal";
    p.Value = newBytes;
    upd.Parameters.Add(p);
    await upd.ExecuteNonQueryAsync();
}

static async Task InvoiceAsync(
    DbConnection conn,
    List<MatchRow> matches,
    (long Seq, string Num, string Name) account,
    string outDir)
{
    var lines = matches
        .Where(m => m.Node is not null && !m.How.Contains("مجلد") && m.Line.Qty > 0)
        .GroupBy(m => m.Node!.Seq)
        .Select(g =>
        {
            var n = g.First().Node!;
            return new InvoiceLine(n, g.Sum(x => x.Line.Qty), n.SellPr4 ?? 0, g.Select(x => x.Line.Barcode).Distinct().ToList());
        })
        .ToList();
    if (lines.Count == 0)
        throw new InvalidOperationException("لا توجد أسطر مطابقة لإنشاء الفاتورة");

    var templateBillSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File15n WHERE Kind = 4");
    if (templateBillSeq <= 0)
        throw new InvalidOperationException("لا توجد فاتورة مبيعات (Kind=4) يمكن اتخاذها قالباً");

    var cols15 = await GetColumnNamesAsync(conn, "File15n");
    var cols14 = await GetColumnNamesAsync(conn, "File14n");
    var cols12 = await GetColumnNamesAsync(conn, "File12n");
    var headerTpl = await ReadRowAsync(conn, "File15n", templateBillSeq, cols15);
    var templateLineSeq = await ScalarLongAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {templateBillSeq} ORDER BY Seq");
    if (templateLineSeq <= 0)
        templateLineSeq = await ScalarLongAsync(conn, "SELECT TOP 1 Seq FROM File14n WHERE Kind = 4 ORDER BY Seq DESC");
    var lineTpl = await ReadRowAsync(conn, "File14n", templateLineSeq, cols14);
    if (headerTpl.Count == 0 || lineTpl.Count == 0)
        throw new InvalidOperationException("تعذر قراءة قالب فاتورة المبيعات");

    var saleAcc = ToLong(headerTpl.GetValueOrDefault("DKindRecNo"));
    if (saleAcc <= 0)
        saleAcc = await ScalarLongAsync(conn, "SELECT TOP 1 SaleAcc FROM FileBrch WHERE SaleAcc > 0 ORDER BY Seq");

    var accTplDebit = await ReadFirst12Async(conn, templateBillSeq, cols12, dept: true);
    var accTplCredit = await ReadFirst12Async(conn, templateBillSeq, cols12, dept: false);
    if (accTplDebit.Count == 0 || accTplCredit.Count == 0)
        throw new InvalidOperationException("قالب قيود File12n غير مكتمل لفاتورة المبيعات");

    var equa = await ScalarDoubleAsync(conn, "SELECT Equal FROM File17n WHERE Seq = 1");
    if (equa <= 0) equa = 1;
    var tplPrice = ToDouble(lineTpl.GetValueOrDefault("Price"));
    var priceIsUsd = equa > 1 && tplPrice > 0 && tplPrice < 500;

    var nextBillSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File15n") + 1;
    var nextBillNum = await ScalarLongAsync(conn, "SELECT MAX(Num) FROM File15n WHERE Kind = 4") + 1;
    var nextLineSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
    var nextAccSeq = await ScalarLongAsync(conn, "SELECT MAX(Seq) FROM File12n") + 1;
    var nextDayBillN = await GetNextVoucherNumAsync(conn);
    var billDate = DateTime.Today;
    var now = DateTime.Now;
    var remarks = $"سيتات عطور {now:yyyy-MM-dd}";

    double LinePrice(InvoiceLine x)
    {
        var sell = x.SellPr4;
        if (sell <= 0) return 0;
        return priceIsUsd ? Math.Round(sell / equa, 6) : sell;
    }

    var total = lines.Sum(x => x.Qty * LinePrice(x));
    Console.WriteLine();
    Console.WriteLine($"=== فاتورة مبيعات ===");
    Console.WriteLine($"قالب Seq={templateBillSeq}  |  جديد Seq={nextBillSeq} Num={nextBillNum} Kind=4");
    Console.WriteLine($"الحساب Two={account.Seq} ({account.Num} {account.Name})");
    Console.WriteLine($"حساب المبيعات DKindRecNo={saleAcc}");
    Console.WriteLine($"أسطر={lines.Count}  الإجمالي={total:N2}  Equa={equa}  السعر={(priceIsUsd ? "USD=SellPr4/Equa" : "SellPr4 محلي")}");

    var header = new Dictionary<string, object?>(headerTpl, StringComparer.OrdinalIgnoreCase);
    header["Seq"] = nextBillSeq;
    header["Num"] = nextBillNum;
    header["Kind"] = 4;
    header["Date"] = billDate;
    header["Two"] = account.Seq;
    header["Three"] = 0;
    header["remarks"] = remarks;
    header["Total"] = total;
    header["count"] = lines.Count;
    header["DKindRecNo"] = saleAcc;
    header["DayBillN"] = nextDayBillN;
    if (header.ContainsKey("Equa")) header["Equa"] = headerTpl.GetValueOrDefault("Equa") ?? equa;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(header, "File15n");
        cmd.CommandTimeout = 120;
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ File15n Seq={nextBillSeq} Num={nextBillNum}");

    var lineSeq = nextLineSeq;
    var written = 0;
    foreach (var x in lines)
    {
        var price = LinePrice(x);
        var lineRow = new Dictionary<string, object?>(lineTpl, StringComparer.OrdinalIgnoreCase);
        lineRow["Seq"] = lineSeq;
        lineRow["BillSeq"] = nextBillSeq;
        lineRow["Date"] = billDate;
        lineRow["Quant"] = x.Qty;
        lineRow["Price"] = price;
        lineRow["Two"] = account.Seq;
        lineRow["Kind"] = 4;
        lineRow["Mat"] = x.Node.Seq;
        lineRow["BillNo"] = nextBillNum;
        lineRow["Frst"] = saleAcc;
        lineRow["MatName"] = "";
        lineRow["OCurAvrg"] = x.Node.CurAvrg ?? x.Node.Last ?? 0;
        lineRow["OCCAvrg"] = x.Node.CurAvrg ?? x.Node.Last ?? 0;
        lineRow["OCurTot"] = x.Node.CurTot1 ?? 0;
        if (lineRow.ContainsKey("DtCreated")) lineRow["DtCreated"] = now;
        if (lineRow.ContainsKey("DtModified")) lineRow["DtModified"] = now;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = BuildInsertSql(lineRow, "File14n");
            cmd.CommandTimeout = 60;
            await cmd.ExecuteNonQueryAsync();
        }

        var oldStock = x.Node.CurTot1 ?? 0;
        var newStock = oldStock - x.Qty;
        await using (var upd = conn.CreateCommand())
        {
            upd.CommandText = $"""
                UPDATE File13n SET
                    CurTot1 = {Inv(newStock)},
                    OutTot = OutTot + {Inv(x.Qty)}
                WHERE Seq = {x.Node.Seq}
                """;
            try { await upd.ExecuteNonQueryAsync(); }
            catch
            {
                upd.CommandText = $"UPDATE File13n SET CurTot1 = {Inv(newStock)} WHERE Seq = {x.Node.Seq}";
                await upd.ExecuteNonQueryAsync();
            }
        }
        written++;
        lineSeq++;
        if (written <= 3 || written % 25 == 0)
            Console.WriteLine($"  ✓ Mat={x.Node.Seq} qty={x.Qty} price={price:0.##} stock {oldStock}→{newStock}");
    }
    Console.WriteLine($"✓ File14n: {written} سطر");

    var acc1 = new Dictionary<string, object?>(accTplDebit, StringComparer.OrdinalIgnoreCase);
    acc1["Seq"] = nextAccSeq;
    acc1["Num"] = nextDayBillN;
    acc1["Date"] = billDate;
    acc1["Acc"] = account.Seq;
    acc1["Dept"] = true;
    acc1["Am"] = total;
    acc1["Ref"] = nextBillNum;
    acc1["ForBill"] = 1;
    acc1["Exp1"] = $"مبيعات بالفاتورة {nextBillNum}";
    acc1["Exp2"] = remarks;
    acc1["BillSeq"] = nextBillSeq;
    acc1["BillKind"] = 4;
    acc1["BillNum"] = nextBillNum;
    acc1["Two"] = saleAcc;
    if (acc1.ContainsKey("DtCreated")) acc1["DtCreated"] = now;

    var acc2 = new Dictionary<string, object?>(accTplCredit, StringComparer.OrdinalIgnoreCase);
    acc2["Seq"] = nextAccSeq + 1;
    acc2["Num"] = nextDayBillN;
    acc2["Date"] = billDate;
    acc2["Acc"] = saleAcc;
    acc2["Dept"] = false;
    acc2["Am"] = total;
    acc2["Ref"] = nextBillNum;
    acc2["ForBill"] = 1;
    acc2["Exp1"] = $"مبيعات بالفاتورة {nextBillNum}";
    acc2["Exp2"] = remarks;
    acc2["BillSeq"] = nextBillSeq;
    acc2["BillKind"] = 4;
    acc2["BillNum"] = nextBillNum;
    acc2["Two"] = account.Seq;
    if (acc2.ContainsKey("DtCreated")) acc2["DtCreated"] = now;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(acc1, "File12n");
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = BuildInsertSql(acc2, "File12n");
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ File12n: {nextAccSeq}, {nextAccSeq + 1}");

    try
    {
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File11n SET Tot1 = Tot1 + {Inv(total)} WHERE Seq = {account.Seq}";
        await upd.ExecuteNonQueryAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"تنبيه تحديث رصيد الحساب: {ex.Message}");
    }

    await TryResetAutoIncAsync("File15n", nextBillSeq + 1);
    await TryResetAutoIncAsync("File14n", lineSeq);
    await TryResetAutoIncAsync("File12n", nextAccSeq + 2);

    var verifyLines = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {nextBillSeq}");
    var verifyTotal = await ScalarDoubleAsync(conn, $"SELECT Total FROM File15n WHERE Seq = {nextBillSeq}");
    Console.WriteLine($"تحقق: أسطر الفاتورة={verifyLines}  الإجمالي={verifyTotal:N2}");

    File.WriteAllText(Path.Combine(outDir, $"invoice-{nextBillNum}.json"),
        JsonSerializer.Serialize(new
        {
            BillSeq = nextBillSeq,
            BillNum = nextBillNum,
            Kind = 4,
            Account = account,
            SaleAcc = saleAcc,
            LineCount = written,
            Total = total,
            VerifyLines = verifyLines,
            VerifyTotal = verifyTotal,
            Lines = lines.Select(x => new { x.Node.Seq, x.Qty, Price = LinePrice(x), x.SellPr4 })
        }, new JsonSerializerOptions { WriteIndented = true }),
        new UTF8Encoding(true));
    Console.WriteLine($"فاتورة المبيعات: رقم {nextBillNum}  Seq={nextBillSeq}  على حساب {account.Num}");
}

static async Task<Dictionary<string, object?>> ReadFirst12Async(DbConnection conn, long billSeq, List<string> cols, bool dept)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT TOP 1 Seq FROM File12n WHERE BillSeq = {billSeq} AND Dept = {(dept ? 1 : 0)} ORDER BY Seq";
    var seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
    if (seq <= 0) return [];
    return await ReadRowAsync(conn, "File12n", seq, cols);
}

static int GetNxAdminPort()
{
    const int fallback = 10088;
    try
    {
        var path = @"C:\ProgramData\NexusDB4\nxServer\D%3A%5CFuture%20of%20Technology%5CEdariNX%5Cnx4.7505%5C\nxServer.remoteadmin";
        if (!File.Exists(path)) return fallback;
        foreach (var line in File.ReadAllLines(path))
        {
            if (!line.StartsWith("CurrentAdminPort=", StringComparison.OrdinalIgnoreCase)) continue;
            if (int.TryParse(line["CurrentAdminPort=".Length..].Trim(), out var port) && port > 0)
                return port;
        }
    }
    catch { /* ignore */ }
    return fallback;
}

static async Task TryResetAutoIncAsync(string table, long target)
{
    try
    {
        var port = GetNxAdminPort();
        var url = $"http://127.0.0.1:{port}/edari-account-maint.nxscript?alias=2026&key=shorja-maintenance&table={table}&autoinc={target}";
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var body = await http.GetStringAsync(url);
        Console.WriteLine($"  autoinc {table} → {target}: {body.Trim()}");
        if (!body.Contains("\"ok\":true", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(body.Trim());
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  تنبيه autoinc {table}: {ex.Message}");
    }
}

static string FindLatestExportDir(string backupsRoot)
{
    var dirs = Directory.GetDirectories(backupsRoot, "edari-perfume-sets-*")
        .OrderByDescending(d => d)
        .ToList();
    if (dirs.Count == 0) throw new InvalidOperationException("لا يوجد مجلد تصدير سابق — نفّذ export أولاً");
    return dirs[0];
}

static string ResolveName(long seq, string? raw, Dictionary<long, string> names) =>
    names.TryGetValue(seq, out var c) ? c : (raw ?? "");

static string BuildTreePath(long seq, Dictionary<long, Node> nodes, Dictionary<long, string> names)
{
    var parts = new List<string>();
    var current = seq;
    var guard = 0;
    while (nodes.TryGetValue(current, out var n) && n.Father > 0 && guard++ < 64)
    {
        if (!nodes.TryGetValue(n.Father, out var parent)) break;
        var name = ResolveName(parent.Seq, parent.Name1, names);
        parts.Add(string.IsNullOrWhiteSpace(name) ? $"#{parent.Seq}" : name.Trim());
        current = parent.Seq;
    }
    parts.Reverse();
    return string.Join(" / ", parts);
}

static string NormalizeBc(string? s)
{
    if (string.IsNullOrWhiteSpace(s)) return "";
    s = s.Trim();
    if (s.EndsWith(".0", StringComparison.Ordinal)) s = s[..^2];
    return s;
}

static bool EndsWithDigits(string? value, string suffix)
{
    var v = NormalizeBc(value);
    return v.Length > suffix.Length && v.EndsWith(suffix, StringComparison.OrdinalIgnoreCase);
}

static List<List<long>> Chunk(List<long> source, int size)
{
    var result = new List<List<long>>();
    for (var i = 0; i < source.Count; i += size)
        result.Add(source.Skip(i).Take(size).ToList());
    return result;
}

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

static async Task<Dictionary<string, object?>> ReadRowAsync(DbConnection conn, string table, long seq, List<string> columns)
{
    var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT * FROM {table} WHERE Seq = {seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return dict;
    foreach (var col in columns)
    {
        var ord = r.GetOrdinal(col);
        if (r.IsDBNull(ord)) { dict[col] = null; continue; }
        var val = r.GetValue(ord);
        if (val is byte[]) continue;
        dict[col] = val;
    }
    return dict;
}

static string BuildInsertSql(Dictionary<string, object?> template, string table)
{
    var colList = string.Join(", ", template.Keys.Select(QuoteIdent));
    var valList = string.Join(", ", template.Values.Select(FormatValue));
    return $"INSERT INTO {table} ({colList}) VALUES ({valList})";
}

static string QuoteIdent(string name) => $"\"{name.Replace("\"", "\"\"")}\"";

static string FormatValue(object? v) => v switch
{
    null => "NULL",
    string s => $"'{s.Replace("'", "''")}'",
    bool b => b ? "1" : "0",
    byte or sbyte or short or ushort or int or uint or long or ulong =>
        Convert.ToString(v, CultureInfo.InvariantCulture)!,
    float or double or decimal => Convert.ToString(v, CultureInfo.InvariantCulture)!,
    DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
    _ => $"'{v}'"
};

static async Task<long> ScalarLongAsync(DbConnection conn, string sql)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    return ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
}

static async Task<double> ScalarDoubleAsync(DbConnection conn, string sql)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    return ToDouble(await cmd.ExecuteScalarAsync());
}

static long ToLong(object? v) => v switch
{
    null or DBNull => 0,
    long l => l,
    int i => i,
    short s => s,
    decimal dec => (long)dec,
    double d => (long)d,
    float f => (long)f,
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

static double? ToNullableDouble(object? v) => v is null or DBNull ? null : ToDouble(v);
static string? ReadStr(object? v) => v is null or DBNull ? null : v.ToString()?.Trim();
static double? GetNum(Dictionary<string, object?>? row, string col)
    => row is not null && row.TryGetValue(col, out var v) ? ToNullableDouble(v) : null;
static string Esc(string s) => s.Replace("'", "''");
static string Inv(double v) => v.ToString(CultureInfo.InvariantCulture);

sealed record ExcelLine(int Row, string Barcode, double Qty, string Note);
sealed record Node(long Seq, long Father, string? Name1, string? Num, string? Barcode,
    double? CurTot1, double? Last, double? CurAvrg, double? SellPr4);
sealed record MatchRow(ExcelLine Line, Node? Node, string How, string Note);
sealed record InvoiceLine(Node Node, double Qty, double SellPr4, List<string> Barcodes);
