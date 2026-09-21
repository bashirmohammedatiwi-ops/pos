// جرد TESTER: احتياط العائدية → نقل إلى 011014 TESTER → فاتورة مبيعات على حساب 134.
// الترتيب إلزامي: export ثم move ثم invoice.
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
const string TargetTreeNum = "011014";

var mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "all";
var backupsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "backups"));
var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);

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
conn.ConnectionString = $"server=127.0.0.1;database={DatabaseAlias};port=16000;Native=true";
await conn.OpenAsync();
Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine($"متصل بقاعدة Edari: {DatabaseAlias}");

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

var excelLines = ReadFoundInventory(desktop);
Console.WriteLine($"أصناف موجودة من ملف المقارنة: {excelLines.Count}  |  الكمية: {excelLines.Sum(x => x.Qty)}");

var matches = MatchFromFoundFile(excelLines, nodes, fatherSeqs, names);
PrintMatchSummary(matches);

var outDir = Path.Combine(backupsRoot, $"edari-tester-inventory-{DateTime.Now:yyyyMMdd-HHmmss}");
Directory.CreateDirectory(outDir);

if (mode is "export" or "all")
{
    await ExportAsync(conn, columns, nodes, names, extraBc, matches, targetFolder, account.Value, outDir, desktop);
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

if (mode is not ("export" or "move" or "invoice" or "all"))
    Console.WriteLine("الاستخدام: export | move | invoice | all");

static List<ExcelLine> ReadFoundInventory(string desktop)
{
    var file = Directory.GetFiles(desktop, "*.xlsx")
        .Select(p => new FileInfo(p))
        .Where(f => f.Name.Contains("مقارنة", StringComparison.OrdinalIgnoreCase)
                    && f.Name.Contains("TESTER", StringComparison.OrdinalIgnoreCase))
        .OrderByDescending(f => f.LastWriteTime)
        .FirstOrDefault()
        ?? throw new InvalidOperationException("لم يُعثر على ملف مقارنة TESTER على سطح المكتب.");

    Console.WriteLine($"ملف المقارنة: {file.FullName}");
    using var wb = new XLWorkbook(file.FullName);
    var ws = wb.Worksheets.FirstOrDefault(s => s.Name.Contains("موجود", StringComparison.Ordinal))
             ?? throw new InvalidOperationException("ورقة «موجود في الإداري» غير موجودة.");
    var last = ws.LastRowUsed()?.RowNumber() ?? 1;
    var list = new List<ExcelLine>();
    for (var r = 2; r <= last; r++)
    {
        var status = (ws.Cell(r, 2).GetFormattedString() ?? "").Trim();
        if (!status.Contains("موجود", StringComparison.Ordinal)) continue;
        var barcode = (ws.Cell(r, 3).GetFormattedString() ?? "").Trim();
        if (string.IsNullOrWhiteSpace(barcode)) continue;
        var qty = ws.Cell(r, 5).DataType == XLDataType.Number
            ? ws.Cell(r, 5).GetDouble()
            : double.TryParse(ws.Cell(r, 5).GetFormattedString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var q) ? q : 0;
        var seqText = ws.Cell(r, 7).DataType == XLDataType.Number
            ? ws.Cell(r, 7).GetDouble().ToString("0", CultureInfo.InvariantCulture)
            : (ws.Cell(r, 7).GetFormattedString() ?? "").Trim();
        long.TryParse(seqText, NumberStyles.Any, CultureInfo.InvariantCulture, out var seq);
        list.Add(new ExcelLine(r, barcode, qty, seq));
    }
    return list;
}

static List<MatchRow> MatchFromFoundFile(
    List<ExcelLine> lines, Dictionary<long, Node> nodes, HashSet<long> fatherSeqs, Dictionary<long, string> names)
{
    var result = new List<MatchRow>();
    foreach (var line in lines)
    {
        if (line.Seq <= 0 || !nodes.TryGetValue(line.Seq, out var n))
        {
            result.Add(new MatchRow(line, null, "غير موجود الآن في الإداري"));
            continue;
        }
        var how = "من ملف المقارنة";
        if (fatherSeqs.Contains(n.Seq))
            how += " (مجلد — ليس منتجاً عادياً)";
        result.Add(new MatchRow(line, n, how));
    }
    _ = names;
    return result;
}

static void PrintMatchSummary(List<MatchRow> matches)
{
    var ok = matches.Where(m => m.Node is not null && !m.How.Contains("مجلد")).ToList();
    var missing = matches.Where(m => m.Node is null).ToList();
    var folders = matches.Where(m => m.How.Contains("مجلد")).ToList();
    Console.WriteLine();
    Console.WriteLine("=== المواد الموجودة ===");
    Console.WriteLine($"منتجات للنقل/الفاتورة: {ok.Select(m => m.Node!.Seq).Distinct().Count()} مادة  /  {ok.Count} سطر  /  كمية {ok.Sum(m => m.Line.Qty)}");
    Console.WriteLine($"مجلدات مستبعدة: {folders.Count}");
    Console.WriteLine($"اختفت من الإداري: {missing.Count}");
    foreach (var m in missing)
        Console.WriteLine($"  {m.Line.Barcode} Seq={m.Line.Seq}");
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
        (n.Num ?? "").Trim().StartsWith(num, StringComparison.OrdinalIgnoreCase)
        && (n.Name1 ?? "").Contains("TESTER", StringComparison.OrdinalIgnoreCase));
}

static async Task<(long Seq, string Num, string Name)?> FindAccountByNumAsync(DbConnection conn, string num)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Seq, Num, Name1 FROM File11n WHERE Num = '{Esc(num)}'";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return null;
    return (ToLong(r.GetValue(0)), ReadStr(r.GetValue(1)) ?? num, ReadStr(r.GetValue(2)) ?? "");
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
    string outDir,
    string desktop)
{
    var matchedSeqs = matches.Where(m => m.Node is not null).Select(m => m.Node!.Seq).Distinct().ToList();
    Console.WriteLine();
    Console.WriteLine($"جاري تصدير احتياط {matchedSeqs.Count} مادة (كل أعمدة File13n + العائدية)...");
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

    var reportName = $"TESTER-احتياط-تفاصيل-وعائدية-{DateTime.Now:yyyyMMdd-HHmm}.xlsx";
    var reportPath = Path.Combine(outDir, reportName);
    using (var wb = new XLWorkbook())
    {
        var ws = wb.AddWorksheet("تفاصيل وعائدية");
        ws.RightToLeft = true;
        var headers = new[]
        {
            "صف المقارنة", "باركود الجرد", "كمية الجرد", "حالة المطابقة",
            "Seq", "الرقم Num", "الباركود الحالي", "اسم المادة",
            "مسار الشجرة الحالي", "المجلد الأب Seq", "اسم المجلد الأب", "رقم شجرة الأب",
            "سعر الشراء Last", "متوسط التكلفة CurAvrg", "سعر المستهلك SellPr4",
            "المخزون CurTot1", "مخزون2", "مخزون3",
            "الشجرة الهدف", "حساب الفاتورة"
        };
        for (var i = 0; i < headers.Length; i++)
        {
            ws.Cell(1, i + 1).Value = headers[i];
            ws.Cell(1, i + 1).Style.Font.Bold = true;
            ws.Cell(1, i + 1).Style.Font.FontColor = XLColor.White;
            ws.Cell(1, i + 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#0F9F76");
        }
        var row = 2;
        foreach (var m in matches)
        {
            var n = m.Node;
            var full = n is null ? null : fullRows.FirstOrDefault(d => ToLong(d.GetValueOrDefault("Seq")) == n.Seq);
            ws.Cell(row, 1).Value = m.Line.Row;
            ws.Cell(row, 2).Value = m.Line.Barcode;
            ws.Cell(row, 2).Style.NumberFormat.Format = "@";
            ws.Cell(row, 3).Value = m.Line.Qty;
            ws.Cell(row, 4).Value = m.How;
            if (n is not null)
            {
                ws.Cell(row, 5).Value = n.Seq;
                ws.Cell(row, 6).Value = n.Num ?? "";
                ws.Cell(row, 6).Style.NumberFormat.Format = "@";
                ws.Cell(row, 7).Value = n.Barcode ?? "";
                ws.Cell(row, 7).Style.NumberFormat.Format = "@";
                ws.Cell(row, 8).Value = ResolveName(n.Seq, n.Name1, names);
                ws.Cell(row, 9).Value = BuildTreePath(n.Seq, nodes, names);
                ws.Cell(row, 10).Value = n.Father;
                ws.Cell(row, 11).Value = n.Father > 0 && nodes.TryGetValue(n.Father, out var p)
                    ? ResolveName(p.Seq, p.Name1, names) : "";
                ws.Cell(row, 12).Value = n.Father > 0 && nodes.TryGetValue(n.Father, out var p2) ? (p2.Num ?? "") : "";
                ws.Cell(row, 13).Value = n.Last ?? GetNum(full, "Last");
                ws.Cell(row, 14).Value = n.CurAvrg ?? GetNum(full, "CurAvrg");
                ws.Cell(row, 15).Value = n.SellPr4 ?? GetNum(full, "SellPr4");
                ws.Cell(row, 16).Value = n.CurTot1 ?? 0;
                ws.Cell(row, 17).Value = GetNum(full, "CurTot2");
                ws.Cell(row, 18).Value = GetNum(full, "CurTot3");
            }
            ws.Cell(row, 19).Value = $"{targetFolder.Num} {ResolveName(targetFolder.Seq, targetFolder.Name1, names)} (Seq {targetFolder.Seq})";
            ws.Cell(row, 20).Value = $"{account.Num} {account.Name} (Seq {account.Seq})";
            row++;
        }
        ws.SheetView.FreezeRows(1);
        ws.Range(1, 1, Math.Max(1, matches.Count + 1), headers.Length).SetAutoFilter();
        ws.Columns().AdjustToContents();

        var sum = wb.AddWorksheet("ملخص");
        sum.RightToLeft = true;
        sum.Cell(1, 1).Value = "احتياط قبل نقل العائدية وفاتورة المبيعات";
        sum.Cell(1, 1).Style.Font.Bold = true;
        sum.Cell(2, 1).Value = "تاريخ التصدير";
        sum.Cell(2, 2).Value = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        sum.Cell(3, 1).Value = "قاعدة Edari";
        sum.Cell(3, 2).Value = DatabaseAlias;
        sum.Cell(4, 1).Value = "أسطر الموجود";
        sum.Cell(4, 2).Value = matches.Count;
        sum.Cell(5, 1).Value = "مواد فريدة";
        sum.Cell(5, 2).Value = matchedSeqs.Count;
        sum.Cell(6, 1).Value = "مجموع الكميات";
        sum.Cell(6, 2).Value = matches.Sum(m => m.Line.Qty);
        sum.Cell(7, 1).Value = "الشجرة الهدف";
        sum.Cell(7, 2).Value = $"{targetFolder.Num} Seq={targetFolder.Seq}";
        sum.Cell(8, 1).Value = "حساب الفاتورة";
        sum.Cell(8, 2).Value = $"{account.Num} {account.Name} Seq={account.Seq}";
        sum.Columns().AdjustToContents();
        wb.SaveAs(reportPath);
    }
    Console.WriteLine($"تقرير الاحتياط: {reportPath}");

    var dest = Path.Combine(desktop, reportName);
    File.Copy(reportPath, dest, true);
    Console.WriteLine($"نسخة على سطح المكتب: {dest}");

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
        TargetTree = new { targetFolder.Seq, targetFolder.Num, Name = ResolveName(targetFolder.Seq, targetFolder.Name1, names) },
        Account = account,
        ExcelLines = matches.Select(m => new
        {
            m.Line.Row,
            m.Line.Barcode,
            m.Line.Qty,
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
    var remarks = $"جرد TESTER {now:yyyy-MM-dd}";

    double LinePrice(InvoiceLine x)
    {
        var sell = x.SellPr4;
        if (sell <= 0) return 0;
        return priceIsUsd ? Math.Round(sell / equa, 6) : sell;
    }

    var total = lines.Sum(x => x.Qty * LinePrice(x));
    Console.WriteLine();
    Console.WriteLine("=== فاتورة مبيعات ===");
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
        if (written <= 5 || written % 50 == 0)
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
    acc2["Date"] = billDate;
    acc2["Num"] = nextDayBillN;
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
    var verifyFather = await ScalarLongAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Father = {matches.First(m => m.Node is not null).Node!.Seq}");
    _ = verifyFather;
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

static async Task<long> GetNextVoucherNumAsync(DbConnection conn)
{
    var maxFile12 = await ScalarLongAsync(conn, "SELECT MAX(Num) FROM File12n");
    var maxDayBill = await ScalarLongAsync(conn, "SELECT MAX(DayBillN) FROM File15n");
    return Math.Max(maxFile12, maxDayBill) + 1;
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
    var dirs = Directory.GetDirectories(backupsRoot, "edari-tester-inventory-*")
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

static async Task<Dictionary<string, object?>> ReadFirst12Async(DbConnection conn, long billSeq, List<string> cols, bool dept)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT TOP 1 Seq FROM File12n WHERE BillSeq = {billSeq} AND Dept = {(dept ? 1 : 0)} ORDER BY Seq";
    var seq = ToLong(await cmd.ExecuteScalarAsync() ?? 0L);
    if (seq <= 0) return [];
    return await ReadRowAsync(conn, "File12n", seq, cols);
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

sealed record ExcelLine(int Row, string Barcode, double Qty, long Seq);
sealed record Node(long Seq, long Father, string? Name1, string? Num, string? Barcode,
    double? CurTot1, double? Last, double? CurAvrg, double? SellPr4);
sealed record MatchRow(ExcelLine Line, Node? Node, string How);
sealed record InvoiceLine(Node Node, double Qty, double SellPr4, List<string> Barcodes);
