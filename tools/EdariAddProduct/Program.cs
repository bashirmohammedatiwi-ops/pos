using System.Data;
using System.Data.Common;
using System.Net.Http;
using System.Reflection;
using System.Text;
using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const string providerDir = @"D:\FOTLabel\FOTLabel";
const int templateSeqDefault = 91684;
const string skipEan = "3760100683257";

var asm = Assembly.LoadFrom(Path.Combine(providerDir, "NexusDB.ADOProvider.dll"));
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider",
    asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

Environment.CurrentDirectory = providerDir;
await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
await conn.OpenAsync();
Console.OutputEncoding = Encoding.UTF8;

if (args.Length == 0)
{
    PrintUsage();
    return;
}

switch (args[0])
{
    case "find-excel" when args.Length > 2:
        foreach (var row in ReadExcelRows(args[1]))
            if (row.Ean.Contains(args[2], StringComparison.OrdinalIgnoreCase) ||
                row.ProductName.Contains(args[2], StringComparison.OrdinalIgnoreCase) ||
                row.FullName.Contains(args[2], StringComparison.OrdinalIgnoreCase))
                Console.WriteLine($"{row.Ean} | {row.FullName}");
        break;
    case "preview-excel" when args.Length > 1:
        PreviewExcel(args[1]);
        break;
    case "import-excel" when args.Length > 1:
        await ImportExcelAsync(conn, args[1], dryRun: false);
        break;
    case "import-excel-dry" when args.Length > 1:
        await ImportExcelAsync(conn, args[1], dryRun: true);
        break;
    case "insert-one" when args.Length > 1:
        await InsertOneAsync(conn, args[1], args.Length > 2 ? args[2] : null);
        break;
    case "reconcile-excel" when args.Length > 1:
        await ReconcileExcelAsync(conn, args[1], dryRun: false);
        break;
    case "reconcile-excel-dry" when args.Length > 1:
        await ReconcileExcelAsync(conn, args[1], dryRun: true);
        break;
    case "apply-arabic-names-840" when args.Length > 1:
        await ApplyArabicNames840Async(conn, args[1], dryRun: false);
        break;
    case "apply-arabic-names-840-dry" when args.Length > 1:
        await ApplyArabicNames840Async(conn, args[1], dryRun: true);
        break;
    case "fix-purchase-840" when args.Length > 1:
        await FixPurchase840Async(conn, args[1], dryRun: false);
        break;
    case "fix-purchase-840-dry" when args.Length > 1:
        await FixPurchase840Async(conn, args[1], dryRun: true);
        break;
    case "import-purchase-840-dry" when args.Length > 1:
        await ImportPurchase840Async(conn, args[1], dryRun: true);
        break;
    case "import-purchase-840" when args.Length > 1:
        await ImportPurchase840Async(conn, args[1], dryRun: false);
        break;
    case "import-purchase-dry" when args.Length > 1:
        await ImportPurchase840Async(conn, args[1], dryRun: true);
        break;
    case "import-purchase" when args.Length > 1:
        await ImportPurchase840Async(conn, args[1], dryRun: false);
        break;
    case "repair-purchase-packlist" when args.Length > 1:
        await RepairPurchaseBillAsync(conn, int.Parse(args[1]));
        break;
    case "repair-purchase" when args.Length > 1:
        await RepairPurchaseBillAsync(conn, int.Parse(args[1]));
        break;
    case "verify-purchase" when args.Length > 1:
        await VerifyPurchaseInvoiceAsync(conn, args[1], args.Length > 2 ? int.Parse(args[2]) : 0);
        break;
    case "verify-arabic-840" when args.Length > 2:
        await VerifyArabic840Async(conn, args[1], args[2]);
        break;
    case "rebuild-840-dry" when args.Length > 2:
        await Rebuild840Async(conn, args[1], args[2], dryRun: true);
        break;
    case "rebuild-840" when args.Length > 2:
        await Rebuild840Async(conn, args[1], args[2], dryRun: false);
        break;
    case "fix-barcodes-840" when args.Length > 1:
        await FixBarcodes840Async(conn, args[1], dryRun: false);
        break;
    case "fix-barcodes-840-dry" when args.Length > 1:
        await FixBarcodes840Async(conn, args[1], dryRun: true);
        break;
    case "preview-arabic-excel" when args.Length > 1:
        PreviewArabicExcel(args[1]);
        break;
    case "clear-name2-840":
        await ClearName2Under840Async(conn);
        break;
    case "compare-840":
        await Compare840Async(conn, args.Length > 1 ? args[1] : "3760100173055");
        break;
    case "scan-tables":
        await ScanTablesAsync(conn);
        break;
    case "scan-lists":
        await ScanMaterialListsAsync(conn);
        break;
    case "rebuild-sub-840":
        await RebuildSub840Async(conn, args.Length > 1 && args[1] == "apply");
        break;
    case "probe-sub-folders":
        await ProbeSubFoldersAsync(conn);
        break;
    case "activate-all-840":
        await ActivateAll840Async(conn);
        break;
    case "fix-total-840":
        await FixTotal840Async(conn, args.Length > 1 && args[1] == "apply");
        break;
    case "file12-probe":
        await File12ProbeAsync(conn);
        break;
    case "sync-file12-840":
        await SyncFile12For840Async(conn, args.Length > 1 && args[1] == "apply");
        break;
    case "diff-visible":
        await DiffVisibleAsync(conn);
        break;
    case "sub-probe":
        await SubProbeAsync(conn);
        break;
    case "audit-840":
        await Audit840Async(conn);
        break;
    case "activate-840":
        await Activate840Async(conn, args.Length > 1 && args[1] == "apply");
        break;
    case "probe":
        await ProbeAsync(conn);
        break;
    case "fix-seq-counter":
    case "fix-manual-add":
        await FixManualAddAsync(conn, args.Length > 1 && args[1] == "apply");
        break;
    case "diag-manual-add":
        await DiagManualAddAsync(conn);
        break;
    case "template" when args.Length > 1 && int.TryParse(args[1], out var tplSeq):
        await ShowTemplateAsync(conn, tplSeq);
        break;
    default:
        PrintUsage();
        break;
}

static void PrintUsage() =>
    Console.WriteLine("Usage: verify-purchase <file> [billSeq] | import-purchase-dry <file> | import-purchase <file> | repair-purchase <billSeq> | import-purchase-840-dry <file> | import-purchase-840 <file> | fix-barcodes-840-dry <file> | fix-barcodes-840 <file> | preview-arabic-excel <file> | apply-arabic-names-840-dry <file> | apply-arabic-names-840 <file> | preview-excel <file> | reconcile-excel <file> | import-excel <file>");

static double ParseExcelNumber(string raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return 0;
    raw = raw.Trim().Replace(" ", "").Replace(",", ".");
    return double.TryParse(raw, System.Globalization.NumberStyles.Any,
        System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 0;
}

static double CellDouble(IXLWorksheet ws, int row, int col)
{
    var cell = ws.Cell(row, col);
    if (cell.IsEmpty()) return 0;
    if (cell.DataType == XLDataType.Number) return cell.GetDouble();
    return ParseExcelNumber(cell.GetFormattedString());
}

static List<(int LineNo, string Ean, string Description, double Qty, double UnitPrice, double LineTotal)> ReadPurchaseExcelLines(string path)
{
    using var wb = OpenWorkbookSafe(path);
    var ws = wb.Worksheet(1);
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? ws.RangeUsed()?.RowCount() ?? 0;
    if (lastRow == 0) throw new InvalidOperationException("الملف فارغ");

    var (headerRow, eanCol, descCol) = FindProductHeader(ws, lastRow);
    var qtyCol = 0;
    var priceCol = 0;
    var totalCol = 0;
    for (var c = 1; c <= 20; c++)
    {
        var h = CellText(ws, headerRow, c);
        if (qtyCol == 0 && h.Contains("Qt", StringComparison.OrdinalIgnoreCase))
            qtyCol = c;
        if (priceCol == 0 && (h.Equals("PU.HT", StringComparison.OrdinalIgnoreCase) ||
                              h.Contains("PU.HT", StringComparison.OrdinalIgnoreCase)))
            priceCol = c;
        if (totalCol == 0 && h.Contains("TOTAL PRICE", StringComparison.OrdinalIgnoreCase))
            totalCol = c;
    }
    if (qtyCol == 0) qtyCol = 8;
    if (priceCol == 0) priceCol = 11;

    var lines = new List<(int, string, string, double, double, double)>();
    for (var r = headerRow + 1; r <= lastRow; r++)
    {
        var lineNoStr = CellText(ws, r, 1);
        var desc = CellText(ws, r, descCol).Trim();
        var eanRaw = CellText(ws, r, eanCol);
        if (string.IsNullOrWhiteSpace(desc) && string.IsNullOrWhiteSpace(eanRaw))
        {
            if (lineNoStr.Contains("Total", StringComparison.OrdinalIgnoreCase))
                break;
            continue;
        }
        if (string.IsNullOrWhiteSpace(desc)) continue;

        var ean = NormalizeEanDigits(eanRaw);
        var qty = CellDouble(ws, r, qtyCol);
        double unitPrice;
        double lineTotal;
        if (totalCol > 0)
        {
            lineTotal = CellDouble(ws, r, totalCol);
            unitPrice = qty > 0 && lineTotal > 0 ? lineTotal / qty : 0;
        }
        else
        {
            unitPrice = priceCol > 0 ? CellDouble(ws, r, priceCol) : 0;
            lineTotal = qty * unitPrice;
        }
        var lineNo = int.TryParse(lineNoStr.Trim(), out var n) && n > 0 ? n : lines.Count + 1;
        lines.Add((lineNo, ean, desc, qty, unitPrice, lineTotal));
    }
    return lines;
}

static string ExtractPurchaseInvoiceRef(string path)
{
    using var wb = OpenWorkbookSafe(path);
    var ws = wb.Worksheet(1);
    for (var r = 1; r <= Math.Min(6, ws.LastRowUsed()?.RowNumber() ?? 0); r++)
    {
        for (var c = 1; c <= Math.Min(12, ws.LastColumnUsed()?.ColumnNumber() ?? 0); c++)
        {
            var text = CellText(ws, r, c);
            if (!text.Contains("FACTURE", StringComparison.OrdinalIgnoreCase) &&
                !text.Contains("Facture", StringComparison.OrdinalIgnoreCase))
                continue;
            var m = System.Text.RegularExpressions.Regex.Match(text, @"(\d{6,})");
            if (m.Success) return m.Groups[1].Value;
        }
    }
    return Path.GetFileNameWithoutExtension(path);
}

static async Task ImportPurchase840Async(DbConnection conn, string path, bool dryRun)
{
    const int supplierSeq = 2150;      // 2226701
    const int inventoryAccSeq = 39;    // مشتريات
    const int templateBillSeq = 17727; // فاتورة مشتريات أجنبية
    var invoiceRef = ExtractPurchaseInvoiceRef(path);

    var billDate = DateTime.Today;
    var lines = ReadPurchaseExcelLines(path);
    Console.WriteLine($"من Excel: {lines.Count} سطر (بنفس ترتيب الملف) | مرجع={invoiceRef} | السعر بالدولار مباشرة");

    var existingBillSeq = await ScalarIntAsync(conn, $"SELECT Seq FROM File15n WHERE Kind = 1 AND remarks = '{Esc(invoiceRef)}'");
    if (existingBillSeq > 0)
    {
        Console.WriteLine($"فاتورة remarks={invoiceRef} موجودة مسبقاً (Seq={existingBillSeq}) — سيتم حذفها وإعادة إنشائها");
        if (!dryRun)
        {
            await DeletePackListForPurchaseAsync(conn, existingBillSeq);
            await DeletePurchaseBillAsync(conn, existingBillSeq, supplierSeq, inventoryAccSeq);
        }
        else
        {
            Console.WriteLine("DRY RUN — سيتم حذف الفاتورة القديمة ثم إنشاء فاتورة جديدة بتاريخ اليوم");
            return;
        }
    }

    var equa = await ScalarDoubleAsync(conn, "SELECT Equal FROM File17n WHERE Seq = 1");
    if (equa <= 0) equa = 1530;
    Console.WriteLine($"سعر الصرف USD→IQD (Equa): {equa}");

    var resolved = new List<( (int LineNo, string Ean, string Description, double Qty, double UnitPrice, double LineTotal) line, int MatSeq, string MatNum, double PriceUsd, double LocalPrice, double OldStock, double OldAvrg)>();
    var missing = new List<(int LineNo, string Ean, string Description, double Qty, double UnitPrice, double LineTotal)>();

    foreach (var line in lines)
    {
        if (string.IsNullOrWhiteSpace(line.Ean))
        {
            missing.Add(line);
            continue;
        }

        var mat = await FindMaterialByBarcodeAsync(conn, line.Ean);
        if (mat is null)
        {
            missing.Add(line);
            continue;
        }

        var priceUsd = line.UnitPrice;
        var localPrice = priceUsd * equa;
        resolved.Add((line, mat.Value.Seq, mat.Value.Num, priceUsd, localPrice, mat.Value.CurTot1, mat.Value.CurAvrg));
    }

    // نفس المادة (Mat) قد تتكرر بباركود واحد لسببين: (1) عيّنة مجانية (سعر=0) تتشارك باركوداً خاطئاً مع
    // منتج آخر مختلف تماماً — تُستثنى العيّنة ويبقى المنتج المسعّر فقط، أو (2) نفس المنتج بدفعتين/صلاحيتين —
    // تُدمج في سطر واحد بكمية مجمّعة وسعر موزون. الإداري لا يعرض سطرين لنفس المادة في نفس الفاتورة.
    var dupGroups = resolved.GroupBy(x => x.MatSeq).Where(g => g.Count() > 1).ToList();
    if (dupGroups.Count > 0)
    {
        var dupNotes = new List<string>();
        var kept = resolved.Where(x => !dupGroups.Any(g => g.Key == x.MatSeq)).ToList();
        foreach (var g in dupGroups)
        {
            var items = g.ToList();
            var zeroPriced = items.Where(x => x.line.LineTotal == 0).ToList();
            var priced = items.Where(x => x.line.LineTotal != 0).ToList();
            if (zeroPriced.Count > 0 && priced.Count > 0)
            {
                kept.AddRange(priced);
                foreach (var z in zeroPriced)
                    dupNotes.Add($"  استُثنيت عيّنة مكررة الباركود: #{z.line.LineNo} {z.line.Description} (نفس باركود مادة Mat={g.Key} مع منتج مسعّر آخر)");
            }
            else
            {
                var first = items[0];
                var totalQtyM = items.Sum(x => x.line.Qty);
                var totalLineM = items.Sum(x => x.line.LineTotal);
                var mergedUnit = totalQtyM > 0 ? totalLineM / totalQtyM : 0;
                var mergedLocal = mergedUnit * equa;
                var lineNos = string.Join("+", items.Select(x => x.line.LineNo));
                var mergedLine = (first.line.LineNo, first.line.Ean, first.line.Description, totalQtyM, mergedUnit, totalLineM);
                kept.Add((mergedLine, first.MatSeq, first.MatNum, mergedUnit, mergedLocal, first.OldStock, first.OldAvrg));
                dupNotes.Add($"  دُمجت أسطر مكررة الباركود (#{lineNos}) Mat={g.Key}: Qty={totalQtyM:0.##} Unit={mergedUnit:0.####}");
            }
        }
        resolved = kept.OrderBy(x => x.line.LineNo).ToList();
        if (dupNotes.Count > 0)
        {
            Console.WriteLine("\n--- معالجة تكرار الباركود داخل نفس الفاتورة ---");
            foreach (var n in dupNotes) Console.WriteLine(n);
        }
    }

    var totalUsd = resolved.Sum(x => x.line.LineTotal);
    var totalIqd = totalUsd * equa;
    var totalQty = resolved.Sum(x => x.line.Qty);

    Console.WriteLine($"\n=== الملخص ===");
    Console.WriteLine($"أسطر مطابقة بالباركود: {resolved.Count}/{lines.Count}");
    Console.WriteLine($"بدون باركود/غير موجودة: {missing.Count}");
    Console.WriteLine($"إجمالي الكميات: {totalQty:0.##}");
    Console.WriteLine($"إجمالي USD: {totalUsd:0.####}");
    Console.WriteLine($"إجمالي IQD: {totalIqd:0.##}");
    Console.WriteLine($"الحساب: 2226701 (Seq={supplierSeq}) | التاريخ: {billDate:yyyy-MM-dd}");

    if (missing.Count > 0)
    {
        Console.WriteLine("\n--- أسطر غير مطابقة ---");
        foreach (var m in missing.Take(12))
            Console.WriteLine($"  #{m.LineNo} EAN={m.Ean} | {m.Description} | Qty={m.Qty}");
        if (missing.Count > 12) Console.WriteLine($"  ... +{missing.Count - 12} أخرى");
    }

    Console.WriteLine("\n--- عينة (أول 5) ---");
    foreach (var x in resolved.Take(5))
        Console.WriteLine($"  #{x.line.LineNo} {x.line.Ean} Mat={x.MatSeq} Qty={x.line.Qty} USD/u={x.PriceUsd:0.####} IQD/u={x.LocalPrice:0.##}");

    if (resolved.Count == 0)
    {
        Console.WriteLine("توقف: لا توجد أسطر صالحة للإدخال");
        return;
    }

    var nextBillSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File15n") + 1;
    var nextBillNum = await ScalarIntAsync(conn, "SELECT MAX(Num) FROM File15n WHERE Kind = 1") + 1;
    var nextLineSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
    var nextAccSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File12n") + 1;
    var nextDayBillN = await GetNextVoucherNumAsync(conn);
    var nextPackList = await ScalarIntAsync(conn, "SELECT MAX(PackList) FROM File15n") + 1;

    Console.WriteLine($"\n=== الخطة ===");
    Console.WriteLine($"File15n Seq={nextBillSeq} Num={nextBillNum} Kind=1 Two={supplierSeq}");
    Console.WriteLine($"File14n: {resolved.Count} سطر من Seq={nextLineSeq}");
    Console.WriteLine($"File12n: 2 قيد من Seq={nextAccSeq} DayBillN={nextDayBillN}");

    if (dryRun)
    {
        Console.WriteLine("\nDRY RUN — نفّذ: import-purchase-840 <file>");
        return;
    }

    var cols15 = await GetColumnNamesAsync(conn, "File15n");
    var cols14 = await GetColumnNamesAsync(conn, "File14n");
    var cols12 = await GetColumnNamesAsync(conn, "File12n");
    var templateLineSeq = await ScalarIntAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {templateBillSeq} ORDER BY Seq");
    if (templateLineSeq <= 0)
        templateLineSeq = await ScalarIntAsync(conn, "SELECT TOP 1 Seq FROM File14n WHERE Kind = 1 ORDER BY Seq DESC");
    var templateAcc1Seq = await ScalarIntAsync(conn, $"SELECT TOP 1 Seq FROM File12n WHERE BillSeq = {templateBillSeq} AND Acc = {inventoryAccSeq} ORDER BY Seq");
    var templateAcc2Seq = await ScalarIntAsync(conn, $"SELECT TOP 1 Seq FROM File12n WHERE BillSeq = {templateBillSeq} AND Dept = 0 ORDER BY Seq");
    var headerTpl = await ReadRowAsync(conn, "File15n", templateBillSeq, cols15);
    var lineTpl = await ReadRowAsync(conn, "File14n", templateLineSeq, cols14);
    var accTpl1 = await ReadRowAsync(conn, "File12n", templateAcc1Seq, cols12);
    var accTpl2 = await ReadRowAsync(conn, "File12n", templateAcc2Seq, cols12);
    if (headerTpl.Count == 0 || lineTpl.Count == 0 || accTpl1.Count == 0 || accTpl2.Count == 0)
        throw new InvalidOperationException("قالب فاتورة المشتريات غير موجود");

    var now = DateTime.Now;
    var header = new Dictionary<string, object?>(headerTpl, StringComparer.OrdinalIgnoreCase);
    header["Seq"] = nextBillSeq;
    header["Num"] = nextBillNum;
    header["Kind"] = 1;
    header["Date"] = billDate;
    header["Two"] = supplierSeq;
    header["Three"] = 0;
    header["curr"] = 1;
    header["Equa"] = equa;
    header["remarks"] = invoiceRef;
    header["Total"] = totalUsd;
    header["count"] = resolved.Count;
    header["DKindRecNo"] = inventoryAccSeq;
    header["DayBillN"] = nextDayBillN;
    header["PackList"] = nextPackList;
    header["CCur1"] = 2;
    header["CCur2"] = 2;
    header["CCur3"] = 2;
    header["CEq1"] = equa;
    header["CEq2"] = equa;
    header["CEq3"] = equa;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(header, "File15n");
        cmd.CommandTimeout = 120;
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ File15n Seq={nextBillSeq} Num={nextBillNum}");

    var lineSeq = nextLineSeq;
    var lineNo = 0;
    foreach (var x in resolved)
    {
        lineNo++;
        var lineRow = new Dictionary<string, object?>(lineTpl, StringComparer.OrdinalIgnoreCase);
        lineRow["Seq"] = lineSeq;
        lineRow["BillSeq"] = nextBillSeq;
        lineRow["Date"] = billDate;
        lineRow["Quant"] = x.line.Qty;
        lineRow["Price"] = x.PriceUsd;
        lineRow["Equa"] = equa;
        lineRow["Two"] = supplierSeq;
        lineRow["Kind"] = 1;
        lineRow["Curr"] = 1;
        lineRow["Mat"] = x.MatSeq;
        lineRow["BillNo"] = nextBillNum;
        lineRow["Mst"] = 1;
        lineRow["Frst"] = inventoryAccSeq;
        lineRow["MatName"] = "";
        lineRow["OCurAvrg"] = x.OldAvrg > 0 ? x.OldAvrg : x.LocalPrice;
        lineRow["OCCAvrg"] = x.OldAvrg > 0 ? x.OldAvrg : x.LocalPrice;
        lineRow["OCurTot"] = x.OldStock;
        lineRow["DtCreated"] = now;
        lineRow["DtModified"] = now;
        lineRow["UserCreate"] = 2;
        lineRow["UserModify"] = 2;
        lineRow["Version"] = 2;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = BuildInsertSql(lineRow, "File14n");
            cmd.CommandTimeout = 60;
            await cmd.ExecuteNonQueryAsync();
        }

        await UpdateMaterialAfterPurchaseAsync(conn, x.MatSeq, x.line.Qty, x.LocalPrice);
        lineSeq++;
        if (lineNo <= 3 || lineNo % 25 == 0)
            Console.WriteLine($"  ✓ #{x.line.LineNo} Mat={x.MatSeq} Qty={x.line.Qty} USD={x.PriceUsd:0.####}");
    }
    Console.WriteLine($"✓ File14n: {resolved.Count} سطر");

    var acc1 = new Dictionary<string, object?>(accTpl1, StringComparer.OrdinalIgnoreCase);
    acc1["Seq"] = nextAccSeq;
    acc1["Num"] = nextDayBillN;
    acc1["Date"] = billDate;
    acc1["Acc"] = inventoryAccSeq;
    acc1["Dept"] = true;
    acc1["Am"] = totalUsd;
    acc1["Equal"] = equa;
    acc1["Curr"] = 1;
    acc1["Ref"] = nextBillNum;
    acc1["ForBill"] = 1;
    acc1["Exp1"] = $"مشتريات بالفاتورة {nextBillNum}";
    acc1["Exp2"] = "";
    acc1["BillSeq"] = nextBillSeq;
    acc1["BillKind"] = 1;
    acc1["BillNum"] = nextBillNum;
    acc1["Two"] = supplierSeq;
    acc1["Thecur"] = 1;
    acc1["TheEq"] = equa;
    acc1["User"] = 2;
    acc1["DtCreated"] = now;

    var acc2 = new Dictionary<string, object?>(accTpl2, StringComparer.OrdinalIgnoreCase);
    acc2["Seq"] = nextAccSeq + 1;
    acc2["Num"] = nextDayBillN;
    acc2["Date"] = billDate;
    acc2["Acc"] = supplierSeq;
    acc2["Dept"] = false;
    acc2["Am"] = totalUsd;
    acc2["Equal"] = equa;
    acc2["Curr"] = 1;
    acc2["Ref"] = nextBillNum;
    acc2["ForBill"] = 1;
    acc2["Exp1"] = $"مشتريات بالفاتورة {nextBillNum}";
    acc2["Exp2"] = invoiceRef;
    acc2["BillSeq"] = nextBillSeq;
    acc2["BillKind"] = 1;
    acc2["BillNum"] = nextBillNum;
    acc2["Two"] = inventoryAccSeq;
    acc2["Thecur"] = 1;
    acc2["TheEq"] = equa;
    acc2["User"] = 2;
    acc2["DtCreated"] = now;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(acc1, "File12n");
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = BuildInsertSql(acc2, "File12n");
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ File12n: Seq {nextAccSeq}, {nextAccSeq + 1}");

    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"""
            UPDATE File11n SET CTot1 = CTot1 + {Inv(totalUsd)}, Tot1 = Tot1 + {Inv(totalIqd)}
            WHERE Seq = {supplierSeq}
            """;
        await upd.ExecuteNonQueryAsync();
        upd.CommandText = $"""
            UPDATE File11n SET Tot1 = Tot1 + {Inv(totalIqd)}
            WHERE Seq = {inventoryAccSeq}
            """;
        await upd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ File11n: حُدّث رصيد المورد والمشتريات");

    await EnsurePackListForPurchaseAsync(conn, nextBillSeq, supplierSeq, billDate);

    await ResetTableAutoIncAsync("File15n", await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File15n") + 1);
    await ResetTableAutoIncAsync("File14n", await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1);
    await ResetTableAutoIncAsync("File12n", nextAccSeq + 2);

    Console.WriteLine($"\n--- تم ---");
    Console.WriteLine($"فاتورة مشتريات Edari: Num={nextBillNum} Seq={nextBillSeq} | {resolved.Count} بند | {totalUsd:0.##} USD");
    if (missing.Count > 0)
        Console.WriteLine($"تنبيه: {missing.Count} سطر لم يُدخل (بدون باركود أو غير موجود)");
    Console.WriteLine("أعد فتح Edari وتحقق من الفاتورة والمخزون");
}

static async Task FixPurchase840Async(DbConnection conn, string path, bool dryRun)
{
    const int billSeq = 17758;
    const int supplierSeq = 2150;
    const int inventoryAccSeq = 39;
    var exists = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File15n WHERE Seq = {billSeq}");
    if (exists == 0) { Console.WriteLine($"توقف: الفاتورة Seq={billSeq} غير موجودة"); return; }

    var equa = await ScalarDoubleAsync(conn, "SELECT Equal FROM File17n WHERE Seq = 1");
    if (equa <= 0) equa = 1530;

    var excelLines = ReadPurchaseExcelLines(path).Where(x => !string.IsNullOrWhiteSpace(x.Ean)).ToList();
    var edariLines = new List<(long Seq, int Mat, double Qty, double Price)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq, Mat, Quant, Price FROM File14n WHERE BillSeq = {billSeq} ORDER BY Seq";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            edariLines.Add((Convert.ToInt64(r.GetValue(0)), Convert.ToInt32(r.GetValue(1)),
                Convert.ToDouble(r.GetValue(2)), Convert.ToDouble(r.GetValue(3))));
    }

    if (excelLines.Count != edariLines.Count)
    {
        Console.WriteLine($"توقف: Excel={excelLines.Count} سطر vs Edari={edariLines.Count}");
        return;
    }

    var oldTotalUsd = edariLines.Sum(x => x.Qty * x.Price);
    var newTotalUsd = excelLines.Sum(x => x.LineTotal);

    Console.WriteLine($"فاتورة Seq={billSeq}");
    Console.WriteLine($"  القديم: {oldTotalUsd:F4} USD");
    Console.WriteLine($"  الصحيح: {newTotalUsd:F4} USD");

    if (dryRun) { Console.WriteLine("\nDRY RUN — نفّذ: fix-purchase-840 <file>"); return; }

    for (var i = 0; i < excelLines.Count; i++)
    {
        var ex = excelLines[i];
        var ed = edariLines[i];
        var newPriceUsd = ex.UnitPrice;
        var newLocal = newPriceUsd * equa;
        if (Math.Abs(ed.Price - newPriceUsd) < 0.0001) continue;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                UPDATE File14n SET Price = {Inv(newPriceUsd)}, OCurAvrg = {Inv(newLocal)}, OCCAvrg = {Inv(newLocal)}
                WHERE Seq = {ed.Seq}
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                UPDATE File13n SET Last = {Inv(newLocal)}, Clast = {Inv(newLocal)},
                    CurAvrg = {Inv(newLocal)}, CCavrg = {Inv(newLocal)}
                WHERE Seq = {ed.Mat}
                """;
            await cmd.ExecuteNonQueryAsync();
        }
    }
    Console.WriteLine("✓ File14n + File13n prices");

    var deltaUsd = newTotalUsd - oldTotalUsd;
    var deltaIqd = deltaUsd * equa;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"UPDATE File15n SET Total = {Inv(newTotalUsd)} WHERE Seq = {billSeq}";
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = $"""
            UPDATE File12n SET Am = {Inv(newTotalUsd)}
            WHERE BillSeq = {billSeq} AND Acc IN ({inventoryAccSeq}, {supplierSeq})
            """;
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine("✓ File15n + File12n");

    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"""
            UPDATE File11n SET CTot1 = CTot1 + {Inv(deltaUsd)}, Tot1 = Tot1 + {Inv(deltaIqd)}
            WHERE Seq = {supplierSeq}
            """;
        await upd.ExecuteNonQueryAsync();
        upd.CommandText = $"UPDATE File11n SET Tot1 = Tot1 + {Inv(deltaIqd)} WHERE Seq = {inventoryAccSeq}";
        await upd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ File11n adjusted by {deltaUsd:F4} USD");
    Console.WriteLine($"\nتم — الفاتورة الآن {newTotalUsd:F4} USD");
}

static async Task DeletePurchaseBillAsync(DbConnection conn, int billSeq, int supplierSeq, int inventoryAccSeq)
{
    var totalUsd = await ScalarDoubleAsync(conn, $"SELECT Total FROM File15n WHERE Seq = {billSeq}");
    var equa = await ScalarDoubleAsync(conn, $"SELECT Equa FROM File15n WHERE Seq = {billSeq}");
    if (equa <= 0) equa = await ScalarDoubleAsync(conn, "SELECT Equal FROM File17n WHERE Seq = 1");
    if (equa <= 0) equa = 1530;
    var totalIqd = totalUsd * equa;

    var lines = new List<(int Mat, double Qty, double Price)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Mat, Quant, Price FROM File14n WHERE BillSeq = {billSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            lines.Add((Convert.ToInt32(r.GetValue(0)), Convert.ToDouble(r.GetValue(1)), Convert.ToDouble(r.GetValue(2))));
    }

    foreach (var line in lines)
        await AdjustMaterialStockAsync(conn, line.Mat, -line.Qty, line.Price * equa);

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"DELETE FROM File14n WHERE BillSeq = {billSeq}";
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = $"DELETE FROM File12n WHERE BillSeq = {billSeq}";
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = $"DELETE FROM File15n WHERE Seq = {billSeq}";
        await cmd.ExecuteNonQueryAsync();
    }

    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"""
            UPDATE File11n SET CTot1 = CTot1 - {Inv(totalUsd)}, Tot1 = Tot1 - {Inv(totalIqd)}
            WHERE Seq = {supplierSeq}
            """;
        await upd.ExecuteNonQueryAsync();
        upd.CommandText = $"UPDATE File11n SET Tot1 = Tot1 - {Inv(totalIqd)} WHERE Seq = {inventoryAccSeq}";
        await upd.ExecuteNonQueryAsync();
    }

    Console.WriteLine($"✓ حُذفت الفاتورة القديمة Seq={billSeq} ({lines.Count} بند)");
}

static async Task DeletePackListForPurchaseAsync(DbConnection conn, int purchaseBillSeq)
{
    var packListNo = await ReadFile15nIntFieldAsync(conn, purchaseBillSeq, "PackList");
    if (packListNo <= 0) return;

    var packBillSeq = await FindPackListBillByPackListNoAsync(conn, packListNo);
    if (packBillSeq <= 0) return;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"DELETE FROM File14n WHERE BillSeq = {packBillSeq}";
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = $"DELETE FROM File15n WHERE Seq = {packBillSeq}";
        await cmd.ExecuteNonQueryAsync();
    }
    Console.WriteLine($"✓ حُذفت قائمة التعبئة PackList={packListNo} (Seq={packBillSeq})");
}

static async Task<int> ReadFile15nIntFieldAsync(DbConnection conn, int seq, string field)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT * FROM File15n WHERE Seq = {seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return 0;
    for (var i = 0; i < r.FieldCount; i++)
        if (r.GetName(i).Equals(field, StringComparison.OrdinalIgnoreCase))
            return Convert.ToInt32(r.GetValue(i));
    return 0;
}

static async Task<int> FindPackListBillByPackListNoAsync(DbConnection conn, int packListNo)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT Seq FROM File15n WHERE Kind = 7";
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = Convert.ToInt32(r.GetValue(0));
        if (await ReadFile15nIntFieldAsync(conn, seq, "PackList") == packListNo)
            return seq;
    }
    return 0;
}

static async Task<int> GetNextVoucherNumAsync(DbConnection conn)
{
    var maxFile12 = await ScalarIntAsync(conn, "SELECT MAX(Num) FROM File12n");
    var maxDayBill = await ScalarIntAsync(conn, "SELECT MAX(DayBillN) FROM File15n");
    return Math.Max(maxFile12, maxDayBill) + 1;
}

static async Task RepairPurchaseBillAsync(DbConnection conn, int purchaseBillSeq)
{
    var kind = await ScalarIntAsync(conn, $"SELECT Kind FROM File15n WHERE Seq = {purchaseBillSeq}");
    if (kind != 1)
    {
        Console.WriteLine($"توقف: Seq={purchaseBillSeq} ليست فاتورة مشتريات (Kind={kind})");
        return;
    }

    var supplierSeq = await ReadFile15nIntFieldAsync(conn, purchaseBillSeq, "Two");
    var billDate = DateTime.Today;
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT * FROM File15n WHERE Seq = {purchaseBillSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            for (var i = 0; i < r.FieldCount; i++)
            {
                if (!r.GetName(i).Equals("Date", StringComparison.OrdinalIgnoreCase)) continue;
                if (!r.IsDBNull(i) && r.GetValue(i) is DateTime dt) billDate = dt.Date;
            }
        }
    }

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"UPDATE File14n SET MatName = '' WHERE BillSeq = {purchaseBillSeq}";
        var cleared = await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ MatName: {cleared} سطر");
    }

    var currentDayBillN = await ReadFile15nIntFieldAsync(conn, purchaseBillSeq, "DayBillN");
    var collisionCount = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File12n WHERE Num = {currentDayBillN}");
    if (collisionCount > 2)
    {
        var newVoucherNum = await GetNextVoucherNumAsync(conn);
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                UPDATE File15n SET DayBillN = {newVoucherNum}
                WHERE Seq = {purchaseBillSeq}
                """;
            await cmd.ExecuteNonQueryAsync();
            cmd.CommandText = $"""
                UPDATE File12n SET Num = {newVoucherNum}
                WHERE BillSeq = {purchaseBillSeq}
                """;
            await cmd.ExecuteNonQueryAsync();
        }
        Console.WriteLine($"✓ سند الفاتورة: {currentDayBillN} → {newVoucherNum} (كان مدمجاً مع سند آخر)");
    }
    else
    {
        Console.WriteLine($"✓ سند الفاتورة Num={currentDayBillN} (لا يوجد تداخل)");
    }

    var purchaseLines = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File14n WHERE BillSeq = {purchaseBillSeq} AND Kind = 1");
    Console.WriteLine($"فاتورة Seq={purchaseBillSeq}: {purchaseLines} بند مشتريات");
}

static async Task VerifyPurchaseInvoiceAsync(DbConnection conn, string path, int billSeqOverride)
{
    var invoiceRef = ExtractPurchaseInvoiceRef(path);
    var excelLines = ReadPurchaseExcelLines(path);
    var billSeq = billSeqOverride > 0
        ? billSeqOverride
        : await ScalarIntAsync(conn, $"SELECT Seq FROM File15n WHERE Kind = 1 AND remarks = '{Esc(invoiceRef)}'");
    if (billSeq <= 0)
    {
        Console.WriteLine($"توقف: لا توجد فاتورة remarks={invoiceRef}");
        return;
    }

    var billNum = await ScalarIntAsync(conn, $"SELECT Num FROM File15n WHERE Seq = {billSeq}");
    var billTotal = await ScalarDoubleAsync(conn, $"SELECT Total FROM File15n WHERE Seq = {billSeq}");
    var edariLines = new List<(long Seq, string Bc, double Qty, double Price)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"""
            SELECT l.Seq, l.Quant, l.Price, COALESCE(NULLIF(m.Barcode, ''), m.Num) AS Bc
            FROM File14n l
            LEFT JOIN File13n m ON m.Seq = l.Mat
            WHERE l.BillSeq = {billSeq} AND l.Kind = 1
            ORDER BY l.Seq
            """;
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var bc = r.IsDBNull(3) ? "" : Convert.ToString(r.GetValue(3))?.Trim() ?? "";
            edariLines.Add((Convert.ToInt64(r.GetValue(0)), NormalizeEanDigits(bc),
                Convert.ToDouble(r.GetValue(1)), Convert.ToDouble(r.GetValue(2))));
        }
    }

    var excelMatched = excelLines.Where(x => !string.IsNullOrWhiteSpace(x.Ean)).ToList();
    var excelNoEan = excelLines.Where(x => string.IsNullOrWhiteSpace(x.Ean)).ToList();
    var excelTotal = excelMatched.Sum(x => x.LineTotal);
    var edariTotal = edariLines.Sum(x => x.Qty * x.Price);

    // نفس منطق الاستيراد: باركود متكرر بسعر=0 (عيّنة) يتشارك مع منتج مسعّر → يُستثنى العيّنة.
    // باركود متكرر بسعر (نفس المنتج بدفعات مختلفة) → يُدمج بكمية مجمّعة وسعر موزون، سطر واحد.
    var expected = new List<(int LineNo, string Ean, string Description, double Qty, double UnitPrice, double LineTotal)>();
    var skippedDupSamples = new List<(int LineNo, string Ean, string Description, double Qty, double LineTotal)>();
    var mergedGroups = new List<string>();
    foreach (var g in excelMatched.GroupBy(x => x.Ean))
    {
        var items = g.ToList();
        if (items.Count == 1) { expected.Add(items[0]); continue; }

        var zeroPriced = items.Where(x => x.LineTotal == 0).ToList();
        var priced = items.Where(x => x.LineTotal != 0).ToList();
        if (zeroPriced.Count > 0 && priced.Count > 0)
        {
            expected.AddRange(priced);
            foreach (var z in zeroPriced)
                skippedDupSamples.Add((z.LineNo, z.Ean, z.Description, z.Qty, z.LineTotal));
        }
        else
        {
            var first = items[0];
            var totalQtyM = items.Sum(x => x.Qty);
            var totalLineM = items.Sum(x => x.LineTotal);
            var mergedUnit = totalQtyM > 0 ? totalLineM / totalQtyM : 0;
            expected.Add((first.LineNo, first.Ean, first.Description, totalQtyM, mergedUnit, totalLineM));
            mergedGroups.Add($"#{string.Join("+", items.Select(x => x.LineNo))} {g.Key} → Qty={totalQtyM:0.##} Unit={mergedUnit:0.####}");
        }
    }
    expected = expected.OrderBy(x => x.LineNo).ToList();

    Console.WriteLine($"=== مقارنة الفاتورة ===");
    Console.WriteLine($"Excel: {excelLines.Count} سطر ({excelMatched.Count} بباركود، {excelNoEan.Count} بدون)");
    if (skippedDupSamples.Count > 0 || mergedGroups.Count > 0)
        Console.WriteLine($"بعد معالجة تكرار الباركود: {expected.Count} سطر متوقّع (استُثنيت {skippedDupSamples.Count} عيّنة مكررة، دُمجت {mergedGroups.Count} مجموعة)");
    Console.WriteLine($"Edari: Seq={billSeq} Num={billNum} | {edariLines.Count} بند");
    Console.WriteLine($"Excel total USD: {excelTotal:0.####}");
    Console.WriteLine($"Edari total USD: {edariTotal:0.####} | Header Total: {billTotal:0.####}");

    var orderOk = 0;
    var orderBad = 0;
    var issues = new List<string>();
    var edariIdx = 0;
    foreach (var ex in expected)
    {
        if (edariIdx >= edariLines.Count)
        {
            orderBad++;
            issues.Add($"#{ex.LineNo} MISSING | {ex.Ean} | {ex.Description}");
            continue;
        }

        var ed = edariLines[edariIdx++];
        var bcOk = ed.Bc == ex.Ean;
        var qtyOk = Math.Abs(ed.Qty - ex.Qty) < 0.01;
        var priceOk = Math.Abs(ed.Price - ex.UnitPrice) < 0.0001;
        if (bcOk && qtyOk && priceOk)
        {
            orderOk++;
            continue;
        }

        orderBad++;
        issues.Add($"#{ex.LineNo} pos={edariIdx} | Excel {ex.Ean} Qty={ex.Qty} Unit={ex.UnitPrice:0.####} | Edari {ed.Bc} Qty={ed.Qty} Unit={ed.Price:0.####}");
    }

    if (edariIdx < edariLines.Count)
        issues.Add($"+{edariLines.Count - edariIdx} بند زائد في Edari بعد موضع {edariIdx}");

    Console.WriteLine($"\n=== الترتيب والقيم ===");
    Console.WriteLine($"متطابق بالترتيب: {orderOk}/{expected.Count}");
    Console.WriteLine($"اختلافات: {orderBad}");
    if (skippedDupSamples.Count > 0)
    {
        Console.WriteLine("\n--- عيّنات مستثناة بسبب تكرار الباركود مع منتج آخر مسعّر ---");
        foreach (var s in skippedDupSamples)
            Console.WriteLine($"  #{s.LineNo} {s.Ean} | {s.Description} | Qty={s.Qty:0.##}");
    }
    if (mergedGroups.Count > 0)
    {
        Console.WriteLine("\n--- أسطر مدمجة (نفس الباركود بدفعات/صلاحيات مختلفة) ---");
        foreach (var m in mergedGroups)
            Console.WriteLine($"  {m}");
    }
    Console.WriteLine(Math.Abs(excelTotal - edariTotal) < 0.05 && Math.Abs(excelTotal - billTotal) < 0.05
        ? "✓ الإجمالي متطابق"
        : $"✗ فرق الإجمالي: Excel-Edari={excelTotal - edariTotal:0.####} Excel-Header={excelTotal - billTotal:0.####}");

    if (excelNoEan.Count > 0)
    {
        Console.WriteLine("\n--- بدون باركود في Excel (لم تُدخل) ---");
        foreach (var x in excelNoEan)
            Console.WriteLine($"  #{x.LineNo} {x.Description} | Qty={x.Qty:0.##} Total={x.LineTotal:0.####}");
    }

    if (issues.Count > 0)
    {
        Console.WriteLine("\n--- اختلافات ---");
        foreach (var x in issues.Take(25))
            Console.WriteLine($"  {x}");
        if (issues.Count > 25)
            Console.WriteLine($"  ... +{issues.Count - 25} أخرى");
    }

    if (orderBad == 0 && edariLines.Count == expected.Count &&
        Math.Abs(excelTotal - edariTotal) < 0.05 && Math.Abs(excelTotal - billTotal) < 0.05)
        Console.WriteLine("\n✓ الفاتورة تطابق الملف بنفس الترتيب");
    else
        Console.WriteLine("\n✗ الفاتورة لا تطابق الملف — شغّل: import-purchase <file> لإعادة المزامنة");
}

static async Task EnsurePackListForPurchaseAsync(DbConnection conn, int purchaseBillSeq, int supplierSeq, DateTime billDate)
{
    const int packListTemplateBillSeq = 17932;
    var packListNo = await ReadFile15nIntFieldAsync(conn, purchaseBillSeq, "PackList");
    if (packListNo <= 0)
    {
        Console.WriteLine("تخطي PackList: رقم القائمة غير موجود في رأس الفاتورة");
        return;
    }

    var existingPackBill = await FindPackListBillByPackListNoAsync(conn, packListNo);
    if (existingPackBill > 0)
    {
        Console.WriteLine($"✓ PackList {packListNo} موجودة مسبقاً (Seq={existingPackBill})");
        return;
    }

    var lines = new List<(int Mat, double Qty)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Mat, Quant FROM File14n WHERE BillSeq = {purchaseBillSeq} AND Kind = 1 ORDER BY Seq";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            lines.Add((Convert.ToInt32(r.GetValue(0)), Convert.ToDouble(r.GetValue(1))));
    }
    if (lines.Count == 0)
    {
        Console.WriteLine("تخطي PackList: لا توجد بنود مشتريات");
        return;
    }

    var cols15 = await GetColumnNamesAsync(conn, "File15n");
    var cols14 = await GetColumnNamesAsync(conn, "File14n");
    var headerTpl = await ReadRowAsync(conn, "File15n", packListTemplateBillSeq, cols15);
    if (headerTpl.Count == 0)
        throw new InvalidOperationException("قالب PackList غير موجود");

    var kind8TplSeq = await ScalarIntAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {packListTemplateBillSeq} AND Kind = 8 ORDER BY Seq");
    var kind7TplSeq = await ScalarIntAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {packListTemplateBillSeq} AND Kind = 7 ORDER BY Seq");
    var kind8Tpl = await ReadRowAsync(conn, "File14n", kind8TplSeq, cols14);
    var kind7Tpl = await ReadRowAsync(conn, "File14n", kind7TplSeq, cols14);
    if (kind8Tpl.Count == 0 || kind7Tpl.Count == 0)
        throw new InvalidOperationException("قالب بنود PackList غير موجود");

    var nextPackBillSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File15n") + 1;
    var nextPackNum = await ScalarIntAsync(conn, "SELECT MAX(Num) FROM File15n WHERE Kind = 7") + 1;
    var nextLineSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
    var now = DateTime.Now;

    var header = new Dictionary<string, object?>(headerTpl, StringComparer.OrdinalIgnoreCase);
    header["Seq"] = nextPackBillSeq;
    header["Num"] = nextPackNum;
    header["Kind"] = 7;
    header["Date"] = billDate;
    header["Two"] = supplierSeq;
    header["PackList"] = packListNo;
    header["count"] = lines.Count;
    header["Total"] = 0;
    header["Equa"] = 1;
    header["curr"] = 0;

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = BuildInsertSql(header, "File15n");
        await cmd.ExecuteNonQueryAsync();
    }

    var lineSeq = nextLineSeq;
    foreach (var line in lines)
    {
        foreach (var (tpl, kind, mst) in new (Dictionary<string, object?>, int, int)[]
        {
            (kind8Tpl, 8, 1),
            (kind7Tpl, 7, 4),
        })
        {
            var row = new Dictionary<string, object?>(tpl, StringComparer.OrdinalIgnoreCase);
            row["Seq"] = lineSeq;
            row["BillSeq"] = nextPackBillSeq;
            row["Date"] = billDate;
            row["Quant"] = line.Qty;
            row["Price"] = 0;
            row["Equa"] = 1;
            row["Two"] = supplierSeq;
            row["Kind"] = kind;
            row["Curr"] = 0;
            row["Mat"] = line.Mat;
            row["BillNo"] = nextPackNum;
            row["Mst"] = mst;
            row["Frst"] = 0;
            row["MatName"] = "";
            row["DtCreated"] = now;
            row["DtModified"] = now;
            row["UserCreate"] = 2;
            row["UserModify"] = 2;
            row["Version"] = 2;

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = BuildInsertSql(row, "File14n");
            await cmd.ExecuteNonQueryAsync();
            lineSeq++;
        }
    }

    await ResetTableAutoIncAsync("File15n", nextPackBillSeq + 1);
    await ResetTableAutoIncAsync("File14n", lineSeq);
    Console.WriteLine($"✓ PackList {packListNo}: Kind=7 Seq={nextPackBillSeq} Num={nextPackNum} ({lines.Count} مادة / {lines.Count * 2} سطر)");
}

static async Task ReconcilePurchaseBillAsync(
    DbConnection conn,
    string path,
    int billSeq,
    int supplierSeq,
    int inventoryAccSeq,
    bool dryRun)
{
    var billNum = await ScalarIntAsync(conn, $"SELECT Num FROM File15n WHERE Seq = {billSeq}");
    var equa = await ScalarDoubleAsync(conn, "SELECT Equal FROM File17n WHERE Seq = 1");
    if (equa <= 0) equa = 1530;

    var lines = ReadPurchaseExcelLines(path);
    var resolved = new List<( (int LineNo, string Ean, string Description, double Qty, double UnitPrice, double LineTotal) line,
        int MatSeq, string MatNum, double PriceUsd, double LocalPrice, double OldStock, double OldAvrg)>();
    var missing = new List<(int LineNo, string Ean, string Description, double Qty, double UnitPrice, double LineTotal)>();

    foreach (var line in lines)
    {
        if (string.IsNullOrWhiteSpace(line.Ean))
        {
            missing.Add(line);
            continue;
        }

        var mat = await FindMaterialByBarcodeAsync(conn, line.Ean);
        if (mat is null)
        {
            missing.Add(line);
            continue;
        }

        var priceUsd = line.UnitPrice;
        var localPrice = priceUsd * equa;
        resolved.Add((line, mat.Value.Seq, mat.Value.Num, priceUsd, localPrice, mat.Value.CurTot1, mat.Value.CurAvrg));
    }

    var existingByMat = new Dictionary<int, (long Seq, double Qty, double Price)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq, Mat, Quant, Price FROM File14n WHERE BillSeq = {billSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            existingByMat[Convert.ToInt32(r.GetValue(1))] =
                (Convert.ToInt64(r.GetValue(0)), Convert.ToDouble(r.GetValue(2)), Convert.ToDouble(r.GetValue(3)));
    }

    var toAdd = resolved.Where(x => !existingByMat.ContainsKey(x.MatSeq)).ToList();
    var toUpdate = resolved.Where(x => existingByMat.ContainsKey(x.MatSeq)).ToList();
    var oldTotalUsd = await ScalarDoubleAsync(conn, $"SELECT Total FROM File15n WHERE Seq = {billSeq}");
    var newTotalUsd = resolved.Sum(x => x.line.LineTotal);

    Console.WriteLine($"مزامنة فاتورة Seq={billSeq} Num={billNum}");
    Console.WriteLine($"  مطابقة: {toUpdate.Count} | جديدة: {toAdd.Count} | غير موجودة بالباركود: {missing.Count}");
    Console.WriteLine($"  الإجمالي القديم: {oldTotalUsd:F4} USD → الجديد: {newTotalUsd:F4} USD");
    Console.WriteLine($"  التاريخ الجديد: {DateTime.Today:yyyy-MM-dd}");

    if (missing.Count > 0)
    {
        Console.WriteLine("--- غير مطابقة ---");
        foreach (var m in missing.Take(8))
            Console.WriteLine($"  #{m.LineNo} {m.Ean} | {m.Description} | Qty={m.Qty}");
    }

    if (dryRun)
    {
        Console.WriteLine("\nDRY RUN — نفّذ: import-purchase <file>");
        return;
    }

    var cols14 = await GetColumnNamesAsync(conn, "File14n");
    var templateLineSeq = await ScalarIntAsync(conn, $"SELECT TOP 1 Seq FROM File14n WHERE BillSeq = {billSeq} ORDER BY Seq");
    if (templateLineSeq <= 0)
        templateLineSeq = await ScalarIntAsync(conn, "SELECT TOP 1 Seq FROM File14n WHERE Kind = 1 ORDER BY Seq DESC");
    var lineTpl = await ReadRowAsync(conn, "File14n", templateLineSeq, cols14);
    if (lineTpl.Count == 0) throw new InvalidOperationException("قالب سطر المشتريات غير موجود");

    var now = DateTime.Now;
    var billDate = DateTime.Today;
    var updated = 0;
    foreach (var x in toUpdate)
    {
        var ed = existingByMat[x.MatSeq];
        var qtyDelta = x.line.Qty - ed.Qty;
        if (Math.Abs(qtyDelta) >= 0.009)
            await AdjustMaterialStockAsync(conn, x.MatSeq, qtyDelta, x.LocalPrice);

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                UPDATE File14n SET Quant = {Inv(x.line.Qty)}, Price = {Inv(x.PriceUsd)},
                    Equa = {Inv(equa)},
                    OCurAvrg = {Inv(x.LocalPrice)}, OCCAvrg = {Inv(x.LocalPrice)}
                WHERE Seq = {ed.Seq}
                """;
            await cmd.ExecuteNonQueryAsync();
        }
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                UPDATE File13n SET Last = {Inv(x.LocalPrice)}, Clast = {Inv(x.LocalPrice)}
                WHERE Seq = {x.MatSeq}
                """;
            await cmd.ExecuteNonQueryAsync();
        }
        updated++;
    }

    var nextLineSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File14n") + 1;
    var added = 0;
    foreach (var x in toAdd)
    {
        var lineRow = new Dictionary<string, object?>(lineTpl, StringComparer.OrdinalIgnoreCase);
        lineRow["Seq"] = nextLineSeq;
        lineRow["BillSeq"] = billSeq;
        lineRow["Date"] = billDate;
        lineRow["Quant"] = x.line.Qty;
        lineRow["Price"] = x.PriceUsd;
        lineRow["Equa"] = equa;
        lineRow["Two"] = supplierSeq;
        lineRow["Kind"] = 1;
        lineRow["Curr"] = 1;
        lineRow["Mat"] = x.MatSeq;
        lineRow["BillNo"] = billNum;
        lineRow["Mst"] = 1;
        lineRow["Frst"] = inventoryAccSeq;
        lineRow["MatName"] = "";
        lineRow["OCurAvrg"] = x.OldAvrg > 0 ? x.OldAvrg : x.LocalPrice;
        lineRow["OCCAvrg"] = x.OldAvrg > 0 ? x.OldAvrg : x.LocalPrice;
        lineRow["OCurTot"] = x.OldStock;
        lineRow["DtCreated"] = now;
        lineRow["DtModified"] = now;
        lineRow["UserCreate"] = 2;
        lineRow["UserModify"] = 2;
        lineRow["Version"] = 2;

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = BuildInsertSql(lineRow, "File14n");
        cmd.CommandTimeout = 60;
        await cmd.ExecuteNonQueryAsync();
        await UpdateMaterialAfterPurchaseAsync(conn, x.MatSeq, x.line.Qty, x.LocalPrice);
        nextLineSeq++;
        added++;
    }

    var nextDayBillN = await GetNextVoucherNumAsync(conn);
    var deltaUsd = newTotalUsd - oldTotalUsd;
    var deltaIqd = deltaUsd * equa;
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"""
            UPDATE File15n SET Total = {Inv(newTotalUsd)},
                DayBillN = {nextDayBillN}, Two = {supplierSeq}
            WHERE Seq = {billSeq}
            """;
        await cmd.ExecuteNonQueryAsync();
        cmd.CommandText = $"""
            UPDATE File12n SET Am = {Inv(newTotalUsd)}, Num = {nextDayBillN}
            WHERE BillSeq = {billSeq} AND Acc IN ({inventoryAccSeq}, {supplierSeq})
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    if (Math.Abs(deltaUsd) >= 0.0001)
    {
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"""
            UPDATE File11n SET CTot1 = CTot1 + {Inv(deltaUsd)}, Tot1 = Tot1 + {Inv(deltaIqd)}
            WHERE Seq = {supplierSeq}
            """;
        await upd.ExecuteNonQueryAsync();
        upd.CommandText = $"UPDATE File11n SET Tot1 = Tot1 + {Inv(deltaIqd)} WHERE Seq = {inventoryAccSeq}";
        await upd.ExecuteNonQueryAsync();
    }

    await ResetTableAutoIncAsync("File14n", nextLineSeq);
    Console.WriteLine($"✓ تمت المزامنة: تحديث {updated} | إضافة {added} | الإجمالي {newTotalUsd:F4} USD");
}

static async Task AdjustMaterialStockAsync(DbConnection conn, int matSeq, double qtyDelta, double localPrice)
{
    if (Math.Abs(qtyDelta) < 0.009) return;
    if (qtyDelta > 0)
    {
        await UpdateMaterialAfterPurchaseAsync(conn, matSeq, qtyDelta, localPrice);
        return;
    }

    var curTot1 = await ScalarDoubleAsync(conn, $"SELECT CurTot1 FROM File13n WHERE Seq = {matSeq}");
    var newStock = Math.Max(0, curTot1 + qtyDelta);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"""
        UPDATE File13n SET
            InTot = InTot + {Inv(qtyDelta)},
            CurTot1 = {Inv(newStock)},
            PurchaseTot = PurchaseTot + {Inv(qtyDelta)}
        WHERE Seq = {matSeq}
        """;
    await cmd.ExecuteNonQueryAsync();
}

static string Inv(double v) =>
    v.ToString(System.Globalization.CultureInfo.InvariantCulture);

static async Task ResetTableAutoIncAsync(string table, int target)
{
    var port = GetNxAdminPort();
    var url = $"http://127.0.0.1:{port}/edari-account-maint.nxscript?alias=2025&key=shorja-maintenance&table={table}&autoinc={target}";
    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    var body = await http.GetStringAsync(url);
    Console.WriteLine($"  autoinc {table} → {target}: {body.Trim()}");
}

static async Task<(int Seq, string Num, double CurTot1, double CurAvrg)?> FindMaterialByBarcodeAsync(DbConnection conn, string ean)
{
    const int folderSeq = 91593;
    var under840 = await FindMaterialByBarcodeInScopeAsync(conn, ean, folderSeq);
    if (under840 is not null) return under840;
    return await FindMaterialByBarcodeInScopeAsync(conn, ean, null);
}

static async Task<(int Seq, string Num, double CurTot1, double CurAvrg)?> FindMaterialByBarcodeInScopeAsync(
    DbConnection conn, string ean, int? folderSeq)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = folderSeq is null
        ? $"""
            SELECT TOP 1 Seq, Num, CurTot1, CurAvrg, Last
            FROM File13n
            WHERE Num = '{Esc(ean)}' OR Barcode = '{Esc(ean)}'
            ORDER BY Seq
            """
        : $"""
            SELECT TOP 1 Seq, Num, CurTot1, CurAvrg, Last
            FROM File13n
            WHERE Father = {folderSeq.Value}
            AND (Num = '{Esc(ean)}' OR Barcode = '{Esc(ean)}')
            ORDER BY Seq
            """;
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return null;
    var curAvrg = r.IsDBNull(3) ? 0.0 : Convert.ToDouble(r.GetValue(3));
    if (curAvrg == 0 && !r.IsDBNull(4))
        curAvrg = Convert.ToDouble(r.GetValue(4));
    return (
        Convert.ToInt32(r.GetValue(0)),
        r.GetValue(1)?.ToString()?.Trim() ?? "",
        r.IsDBNull(2) ? 0.0 : Convert.ToDouble(r.GetValue(2)),
        curAvrg
    );
}

static async Task UpdateMaterialAfterPurchaseAsync(DbConnection conn, int matSeq, double qty, double localPrice)
{
    var curTot1 = await ScalarDoubleAsync(conn, $"SELECT CurTot1 FROM File13n WHERE Seq = {matSeq}");
    var curAvrg = await ScalarDoubleAsync(conn, $"SELECT CurAvrg FROM File13n WHERE Seq = {matSeq}");
    if (curAvrg == 0)
        curAvrg = await ScalarDoubleAsync(conn, $"SELECT Last FROM File13n WHERE Seq = {matSeq}");

    var newStock = curTot1 + qty;
    var newAvrg = newStock <= 0 ? localPrice
        : ((curAvrg * curTot1) + (localPrice * qty)) / newStock;

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"""
        UPDATE File13n SET
            InTot = InTot + {Inv(qty)},
            CurTot1 = CurTot1 + {Inv(qty)},
            PurchaseTot = PurchaseTot + {Inv(qty)},
            Last = {Inv(localPrice)},
            Clast = {Inv(localPrice)},
            CurAvrg = {Inv(newAvrg)},
            CCavrg = {Inv(newAvrg)}
        WHERE Seq = {matSeq}
        """;
    await cmd.ExecuteNonQueryAsync();
}

static async Task<double> ScalarDoubleAsync(DbConnection conn, string sql)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    var v = await cmd.ExecuteScalarAsync();
    if (v is null or DBNull) return 0;
    return Convert.ToDouble(v);
}

static string ResolveExcelPath(string path) =>
    Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), path));

static XLWorkbook OpenWorkbookSafe(string path)
{
    path = ResolveExcelPath(path);
    try
    {
        return new XLWorkbook(path);
    }
    catch (InvalidOperationException ex) when (ex.Message.Contains("autofilter", StringComparison.OrdinalIgnoreCase))
    {
        var temp = Path.Combine(Path.GetTempPath(), $"edari_{Guid.NewGuid():N}.xlsx");
        File.Copy(path, temp, true);
        using (var doc = SpreadsheetDocument.Open(temp, true))
        {
            var wbPart = doc.WorkbookPart!;
            foreach (var sheet in wbPart.Workbook.Sheets!.Elements<Sheet>())
            {
                var wsPart = (WorksheetPart)wbPart.GetPartById(sheet.Id!);
                wsPart.Worksheet.RemoveAllChildren<AutoFilter>();
                wsPart.Worksheet.Save();
            }
            foreach (var tablePart in wbPart.GetPartsOfType<TableDefinitionPart>().ToList())
                wbPart.DeletePart(tablePart);
        }
        return new XLWorkbook(temp);
    }
}

static void PreviewArabicExcel(string path)
{
    var rows = ReadArabicExcelRows(path);
    Console.WriteLine($"EAN مع اسم عربي: {rows.Count}");
    foreach (var row in rows.Take(20))
        Console.WriteLine($"{row.Ean} | EV {row.ArabicName}");
}

static List<ArabicImportRow> ReadArabicExcelRows(string path)
{
    using var wb = OpenWorkbookSafe(path);
    var ws = wb.Worksheet(1);
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? ws.RangeUsed()?.RowCount() ?? 0;
    if (lastRow == 0) throw new InvalidOperationException("الملف فارغ");

    var (headerRow, eanCol, descCol) = FindArabicHeader(ws, lastRow);
    var rows = new List<ArabicImportRow>();
    var seen = new HashSet<string>(StringComparer.Ordinal);

    for (var r = headerRow + 1; r <= lastRow; r++)
    {
        var ean = NormalizeEanDigits(CellText(ws, r, eanCol));
        var arabic = CellText(ws, r, descCol).Trim();
        if (string.IsNullOrWhiteSpace(ean) && string.IsNullOrWhiteSpace(arabic)) continue;
        if (!LooksLikeEan(ean) || string.IsNullOrWhiteSpace(arabic)) continue;
        if (!seen.Add(ean)) continue;
        rows.Add(new ArabicImportRow(ean, arabic));
    }

    return rows;
}

static (int HeaderRow, int EanCol, int DescCol) FindArabicHeader(IXLWorksheet ws, int maxRow)
{
    for (var r = 1; r <= Math.Min(maxRow, 30); r++)
    {
        for (var c = 1; c <= 12; c++)
        {
            if (!CellText(ws, r, c).Equals("EAN", StringComparison.OrdinalIgnoreCase)) continue;
            var descCol = c + 1;
            for (var dc = c + 1; dc <= c + 3; dc++)
            {
                var h = CellText(ws, r, dc);
                if (h.Contains("Description", StringComparison.OrdinalIgnoreCase) ||
                    h.Contains("وصف", StringComparison.OrdinalIgnoreCase) ||
                    h.Contains("اسم", StringComparison.OrdinalIgnoreCase))
                {
                    descCol = dc;
                    break;
                }
            }
            return (r, c, descCol);
        }
    }
    return (10, 4, 5);
}

static async Task ApplyArabicNames840Async(DbConnection conn, string path, bool dryRun)
{
    const int folderSeq = 91593;
    var rows = ReadArabicExcelRows(path);
    Console.WriteLine($"من Excel: {rows.Count} EAN بأسماء عربية");

    var updated = 0;
    var missing = 0;
    var unchanged = 0;

    foreach (var row in rows)
    {
        var names = await GetProductNamesAsync(conn, row.Ean, folderSeq);
        if (names is null)
        {
            missing++;
            if (missing <= 5) Console.WriteLine($"  غير موجود: {row.Ean}");
            continue;
        }

        var newName1 = TruncateField($"EV {row.ArabicName}", 50);
        var newName2 = TruncateField(
            string.IsNullOrWhiteSpace(names.Value.Name2) ? names.Value.Name1 : names.Value.Name2, 50);

        if (names.Value.Name1 == newName1 && names.Value.Name2 == newName2)
        {
            unchanged++;
            continue;
        }

        if (!dryRun)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                UPDATE File13n
                SET Name1 = '{Esc(newName1)}', Name2 = '{Esc(newName2)}'
                WHERE Num = '{Esc(row.Ean)}' AND Father = {folderSeq}
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        updated++;
        if (updated <= 8)
            Console.WriteLine($"{row.Ean}\n  Name1: {newName1}\n  Name2: {newName2}");
    }

    Console.WriteLine($"\n{(dryRun ? "DRY RUN — " : "")}محدّث: {updated} | بدون تغيير: {unchanged} | غير موجود في 840: {missing}");
    if (dryRun) Console.WriteLine("نفّذ: apply-arabic-names-840 <file>");
}

static async Task Rebuild840Async(DbConnection conn, string eanFile, string arabicFile, bool dryRun)
{
    const int folderSeq = 91593;

    // 1) فحص السلامة — لا حركات ولا مواد يدوية تحت 840
    var moves = await ScalarIntAsync(conn, $"""
        SELECT COUNT(*) FROM File14n f
        INNER JOIN File13n m ON m.Seq = f.Mat
        WHERE m.Father = {folderSeq}
        """);
    if (moves > 0)
    {
        Console.WriteLine($"توقف: {moves} حركة في File14n على مواد 840 — احذف الحركات أولاً");
        return;
    }

    var stocked = await ScalarIntAsync(conn, $"""
        SELECT COUNT(*) FROM File13n
        WHERE Father = {folderSeq}
        AND (InTot <> 0 OR OutTot <> 0 OR CurTot1 <> 0 OR Tot1 <> 0 OR PurchaseTot <> 0 OR SalesTot <> 0)
        """);
    if (stocked > 0)
    {
        Console.WriteLine($"توقف: {stocked} مادة تحت 840 لها مخزون غير صفري");
        return;
    }

    // 2) القالب — يجب قراءته قبل الحذف
    var columns = await GetColumnNamesAsync(conn);
    var templateBase = await ReadRowAsync(conn, "File13n", templateSeqDefault, columns);
    if (templateBase.Count == 0)
    {
        Console.WriteLine($"توقف: قالب المادة Seq={templateSeqDefault} غير موجود");
        return;
    }
    var totalBlob = await ReadTotalBlobAsync(conn, templateSeqDefault);
    Console.WriteLine($"القالب Seq={templateSeqDefault}: {templateBase.Count} عمود | Total={(totalBlob is null ? "NULL" : totalBlob.Length + " بايت")}");

    // 3) الملفات
    var excelRows = ReadExcelRows(eanFile);
    var arabicByEan = ReadArabicExcelRows(arabicFile)
        .GroupBy(a => a.Ean, StringComparer.Ordinal)
        .ToDictionary(g => g.Key, g => g.First().ArabicName, StringComparer.Ordinal);
    Console.WriteLine($"ملف EAN: {excelRows.Count} مادة | ملف عربي: {arabicByEan.Count} اسم");

    var noArabic = excelRows.Where(x => !arabicByEan.ContainsKey(x.Ean)).ToList();
    if (noArabic.Count > 0)
    {
        Console.WriteLine($"بدون اسم عربي: {noArabic.Count} (سيُستخدم الاسم الفرنسي)");
        foreach (var x in noArabic.Take(10))
            Console.WriteLine($"  {x.Ean} | {x.ProductName}");
    }

    // 4) EAN مستخدم خارج 840 — لا نكرّره
    var conflicts = new HashSet<string>(StringComparer.Ordinal);
    foreach (var row in excelRows)
    {
        var n = await ScalarIntAsync(conn, $"""
            SELECT COUNT(*) FROM File13n
            WHERE Father <> {folderSeq}
            AND (Num = '{Esc(row.Ean)}' OR Barcode = '{Esc(row.Ean)}')
            """);
        if (n > 0) conflicts.Add(row.Ean);
    }
    if (conflicts.Count > 0)
    {
        Console.WriteLine($"\nتحذير: {conflicts.Count} EAN موجود خارج 840 — سيُتخطّى");
        foreach (var e in conflicts.Take(10)) Console.WriteLine($"  {e}");
    }

    var toInsert = excelRows.Where(x => !conflicts.Contains(x.Ean)).ToList();

    // 5) نسخة احتياطية
    var existing = await LoadEdari840ForBarcodeFixAsync(conn, folderSeq);
    var backupPath = Path.Combine(AppContext.BaseDirectory, $"backup-840-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
    var backup = new StringBuilder();
    backup.AppendLine("Seq\tNum\tBarcode\tName1\tName2");
    foreach (var e in existing)
        backup.AppendLine($"{e.Seq}\t{e.Num}\t{e.Barcode}\t{e.Name1}\t{e.Name2}");

    Console.WriteLine($"\n=== الخطة ===");
    Console.WriteLine($"حذف: {existing.Count} مادة (+ باركوداتها من File13BC)");
    Console.WriteLine($"إضافة: {toInsert.Count} مادة بأرقام Seq جديدة تبدأ من {await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1}");
    Console.WriteLine("Name1 = EV + العربي | Name2 = الفرنسي");

    if (dryRun)
    {
        Console.WriteLine("\n--- عينة ---");
        foreach (var row in toInsert.Take(8))
        {
            var ar = arabicByEan.TryGetValue(row.Ean, out var a) ? a : null;
            Console.WriteLine($"{row.Ean}\n  Name1: {TruncateField(ar is null ? row.FullName : $"EV {ar}", 50)}\n  Name2: {TruncateField(row.FullName, 50)}");
        }
        Console.WriteLine("\nDRY RUN — نفّذ: rebuild-840 <ean-file> <arabic-file>");
        return;
    }

    File.WriteAllText(backupPath, backup.ToString(), Encoding.UTF8);
    Console.WriteLine($"نسخة احتياطية: {backupPath}");

    // 6) حذف الباركودات من الفهرس
    var bcDeleted = 0;
    foreach (var e in existing.Where(x => !string.IsNullOrWhiteSpace(x.Barcode)))
    {
        await using var del = conn.CreateCommand();
        del.CommandText = $"DELETE FROM File13BC WHERE BarCode = '{Esc(e.Barcode)}'";
        try { bcDeleted += await del.ExecuteNonQueryAsync(); } catch { /* ignore */ }
    }
    Console.WriteLine($"File13BC: حُذف {bcDeleted}");

    // 7) حذف المواد
    await using (var del = conn.CreateCommand())
    {
        del.CommandText = $"DELETE FROM File13n WHERE Father = {folderSeq}";
        del.CommandTimeout = 300;
        var n = await del.ExecuteNonQueryAsync();
        Console.WriteLine($"File13n: حُذف {n} مادة");
    }

    // 8) تصفير فهرس المجلد قبل الإضافة
    await using (var upd = conn.CreateCommand())
    {
        upd.CommandText = $"UPDATE File13n SET SubCount = 0, Sub = NULL WHERE Seq = {folderSeq}";
        await upd.ExecuteNonQueryAsync();
    }

    // 9) الإضافة
    var added = 0;
    var failed = 0;
    var nextSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;

    foreach (var row in toInsert)
    {
        var arabic = arabicByEan.TryGetValue(row.Ean, out var a) ? a : null;
        var name1 = TruncateField(arabic is null ? row.FullName : $"EV {arabic}", 50);
        var name2 = TruncateField(row.FullName, 50);

        try
        {
            var template = new Dictionary<string, object?>(templateBase, StringComparer.OrdinalIgnoreCase);
            ApplyProduct(template, nextSeq, row.Ean, name1, folderSeq);
            template["Name2"] = name2;

            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = BuildInsertSql(template);
                cmd.CommandTimeout = 120;
                await cmd.ExecuteNonQueryAsync();
            }

            await using (var bc = conn.CreateCommand())
            {
                bc.CommandText = $"INSERT INTO File13BC (EdNum, BarCode, Qty, NoDscnt) VALUES ({nextSeq}, '{Esc(row.Ean)}', 1, False)";
                try { await bc.ExecuteNonQueryAsync(); }
                catch (Exception ex) { Console.WriteLine($"  WARN File13BC {row.Ean}: {ex.Message.Split('\n')[0]}"); }
            }

            added++;
            if (added <= 5 || added % 25 == 0)
                Console.WriteLine($"OK Seq={nextSeq} {row.Ean} | {name1}");
            nextSeq++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"FAIL {row.Ean}: {ex.Message.Split('\n')[0]}");
            failed++;
            nextSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;
        }
    }

    // 10) Total blob — يجعل المواد تظهر في قوائم Edari
    if (totalBlob is not null && totalBlob.Length > 0)
    {
        var hex = BitConverter.ToString(totalBlob).Replace("-", "");
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File13n SET Total = x'{hex}' WHERE Father = {folderSeq}";
        upd.CommandTimeout = 300;
        try
        {
            var n = await upd.ExecuteNonQueryAsync();
            Console.WriteLine($"Total: {n} مادة");
        }
        catch (Exception ex) { Console.WriteLine($"WARN Total: {ex.Message.Split('\n')[0]}"); }
    }

    // 11) إعادة بناء فهرس المجلد + عداد المواد
    await UpdateFolderSubCountAsync(conn, folderSeq);
    var subCount = await ScalarIntAsync(conn, $"SELECT SubCount FROM File13n WHERE Seq = {folderSeq}");
    Console.WriteLine($"SubCount المجلد: {subCount}");

    await ResetFile13nAutoIncAsync(conn, apply: true);

    Console.WriteLine($"\n--- انتهى --- added={added} failed={failed} skipped={conflicts.Count}");
    Console.WriteLine("أغلق Edari تماماً وأعد فتحه");
}

// المقارنة تتم على الخادم — تتجاوز مشكلة ترميز القراءة في مُشغِّل ADO
static async Task VerifyArabic840Async(DbConnection conn, string eanFile, string arabicFile)
{
    const int folderSeq = 91593;
    var excelRows = ReadExcelRows(eanFile);
    var arabicByEan = ReadArabicExcelRows(arabicFile)
        .GroupBy(a => a.Ean, StringComparer.Ordinal)
        .ToDictionary(g => g.Key, g => g.First().ArabicName, StringComparer.Ordinal);

    var okName1 = 0;
    var okName2 = 0;
    var missing = 0;
    var badName1 = new List<string>();
    var badName2 = new List<string>();

    foreach (var row in excelRows)
    {
        var exists = await ScalarIntAsync(conn,
            $"SELECT COUNT(*) FROM File13n WHERE Father = {folderSeq} AND Num = '{Esc(row.Ean)}'");
        if (exists == 0) { missing++; continue; }

        var arabic = arabicByEan.TryGetValue(row.Ean, out var a) ? a : null;
        var name1 = TruncateField(arabic is null ? row.FullName : $"EV {arabic}", 50);
        var name2 = TruncateField(row.FullName, 50);

        var m1 = await ScalarIntAsync(conn, $"""
            SELECT COUNT(*) FROM File13n
            WHERE Father = {folderSeq} AND Num = '{Esc(row.Ean)}' AND Name1 = '{Esc(name1)}'
            """);
        var m2 = await ScalarIntAsync(conn, $"""
            SELECT COUNT(*) FROM File13n
            WHERE Father = {folderSeq} AND Num = '{Esc(row.Ean)}' AND Name2 = '{Esc(name2)}'
            """);

        // الإداري (Delphi/CP1256) يقصّ الفراغ الأخير ولا يمثّل حروفاً مثل Ï
        if (m1 == 0)
            m1 = await MatchAnyAsync(conn, folderSeq, row.Ean, "Name1", NameVariants(name1));
        if (m2 == 0)
            m2 = await MatchAnyAsync(conn, folderSeq, row.Ean, "Name2", NameVariants(name2));

        if (m1 > 0) okName1++; else badName1.Add($"{row.Ean} | {name1}");
        if (m2 > 0) okName2++; else badName2.Add($"{row.Ean} | {name2}");
    }

    Console.WriteLine($"من Excel: {excelRows.Count}");
    Console.WriteLine($"Name1 مطابق (عربي): {okName1}/{excelRows.Count}");
    Console.WriteLine($"Name2 مطابق (فرنسي): {okName2}/{excelRows.Count}");
    Console.WriteLine($"غير موجود تحت 840: {missing}");

    foreach (var b in badName1.Take(8)) Console.WriteLine($"  Name1 مختلف: {b}");
    foreach (var b in badName2.Take(8)) Console.WriteLine($"  Name2 مختلف: {b}");
}

static IEnumerable<string> NameVariants(string name)
{
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var v in new[]
    {
        name.TrimEnd(),
        name.TrimEnd(' ', '—', '-'),
        StripDiacritics(name),
        StripDiacritics(name).TrimEnd(),
        StripDiacritics(name).TrimEnd(' ', '—', '-'),
    })
    {
        if (v.Length > 0 && seen.Add(v)) yield return v;
    }
}

static string StripDiacritics(string s)
{
    var d = s.Normalize(NormalizationForm.FormD);
    var sb = new StringBuilder(d.Length);
    foreach (var ch in d)
    {
        // أزل علامات اللاتينية فقط — احفظ التشكيل العربي
        if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) == System.Globalization.UnicodeCategory.NonSpacingMark
            && ch < 0x0600)
            continue;
        sb.Append(ch);
    }
    return sb.ToString().Normalize(NormalizationForm.FormC);
}

static async Task<int> MatchAnyAsync(DbConnection conn, int folderSeq, string ean, string column, IEnumerable<string> candidates)
{
    foreach (var cand in candidates)
    {
        var n = await ScalarIntAsync(conn, $"""
            SELECT COUNT(*) FROM File13n
            WHERE Father = {folderSeq} AND Num = '{Esc(ean)}' AND {column} = '{Esc(cand)}'
            """);
        if (n > 0) return n;
    }
    return 0;
}

static async Task<byte[]?> ReadTotalBlobAsync(DbConnection conn, int seq)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Total FROM File13n WHERE Seq = {seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync() || r.IsDBNull(0)) return null;
    return r.GetValue(0) as byte[];
}

static async Task<(string Name1, string Name2)?> GetProductNamesAsync(DbConnection conn, string ean, int folderSeq)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT Name1, Name2 FROM File13n WHERE Num = '{Esc(ean)}' AND Father = {folderSeq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (!await r.ReadAsync()) return null;
    var n1 = r.IsDBNull(0) ? "" : r.GetValue(0)?.ToString()?.Trim() ?? "";
    var n2 = r.IsDBNull(1) ? "" : r.GetValue(1)?.ToString()?.Trim() ?? "";
    return (n1, n2);
}

static void PreviewExcel(string path)
{
    using var wb = OpenWorkbookSafe(path);
    var ws = wb.Worksheet(1);
    var used = ws.RangeUsed() ?? throw new InvalidOperationException("الملف فارغ");
    Console.WriteLine($"Sheet: {ws.Name}, rows={used.RowCount()}, cols={used.ColumnCount()}");
    for (var r = 1; r <= Math.Min(40, used.RowCount()); r++)
    {
        var cells = new List<string>();
        for (var c = 1; c <= used.ColumnCount(); c++)
            cells.Add($"[{c}]={CellText(ws, r, c)}");
        Console.WriteLine($"R{r}: {string.Join(" | ", cells)}");
    }

    var rows = ReadExcelRowsDetailed(path);
    Console.WriteLine($"\nEAN فريد: {rows.Rows.Count} | أسطر مكررة: {rows.DuplicateLines} | بدون EAN: {rows.NoEanSamples}");
    foreach (var row in rows.Rows.Take(15))
        Console.WriteLine($"{row.Ean} | {row.FullName}");
}

static ExcelParseReport ReadExcelRowsDetailed(string path)
{
    using var wb = OpenWorkbookSafe(path);
    var ws = wb.Worksheet(1);
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? ws.RangeUsed()?.RowCount() ?? 0;
    if (lastRow == 0) throw new InvalidOperationException("الملف فارغ");

    var company = ExtractCompany(CellText(ws, 1, 1));
    var (headerRow, eanCol, descCol) = FindProductHeader(ws, lastRow);
    var startRow = headerRow + 1;

    var rows = new List<ImportRow>();
    var seenEan = new HashSet<string>(StringComparer.Ordinal);
    var duplicateLines = 0;
    var noEanSamples = 0;
    var invalidRows = 0;
    var totalProductLines = 0;

    for (var r = startRow; r <= lastRow; r++)
    {
        var lineNo = CellText(ws, r, 1);
        var refNo = CellText(ws, r, 2);
        var eanRaw = CellText(ws, r, eanCol);
        var description = CellText(ws, r, descCol);

        // توقف عند ملخص/نهاية الفاتورة
        if (string.IsNullOrWhiteSpace(description) && string.IsNullOrWhiteSpace(eanRaw))
        {
            if (lineNo.Contains("Total", StringComparison.OrdinalIgnoreCase) ||
                refNo.Contains("Total", StringComparison.OrdinalIgnoreCase))
                break;
            continue;
        }

        if (string.IsNullOrWhiteSpace(description)) { invalidRows++; continue; }

        // سطر منتج (رقم تسلسلي أو وصف موجود)
        if (LooksLikeLineNumber(lineNo) || LooksLikeEan(NormalizeEanDigits(eanRaw)))
            totalProductLines++;

        var ean = NormalizeEanDigits(eanRaw);
        if (!LooksLikeEan(ean))
        {
            noEanSamples++;
            continue;
        }

        if (!seenEan.Add(ean))
        {
            duplicateLines++;
            continue;
        }

        rows.Add(new ImportRow(ean, company, description.Trim(), BuildFullName(company, description)));
    }

    return new ExcelParseReport(rows, totalProductLines, duplicateLines, noEanSamples, invalidRows, lastRow, startRow);
}

static (int HeaderRow, int EanCol, int DescCol) FindProductHeader(IXLWorksheet ws, int maxRow)
{
    for (var r = 1; r <= Math.Min(maxRow, 30); r++)
    {
        var eanCol = 0;
        var descCol = 0;
        for (var c = 1; c <= 12; c++)
        {
            var h = CellText(ws, r, c);
            if (h.Equals("EAN", StringComparison.OrdinalIgnoreCase))
                eanCol = c;
            else if (h.Contains("Description", StringComparison.OrdinalIgnoreCase) ||
                     h.Contains("وصف", StringComparison.OrdinalIgnoreCase))
                descCol = c;
        }
        if (eanCol > 0 && descCol > 0)
            return (r, eanCol, descCol);
    }
    return (10, 3, 4);
}

static List<ImportRow> ReadExcelRows(string path) => ReadExcelRowsDetailed(path).Rows;

static bool LooksLikeLineNumber(string s) =>
    int.TryParse(s.Trim(), out var n) && n is > 0 and < 10000;

static string NormalizeEanDigits(string raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return "";
    var digits = new string(raw.Where(char.IsDigit).ToArray());
    return digits;
}

static int FindHeaderRow(IXLWorksheet ws, int maxRow) => FindProductHeader(ws, maxRow).HeaderRow;

static async Task FixBarcodes840Async(DbConnection conn, string path, bool dryRun)
{
    const int folderSeq = 91593;
    var excelRows = ReadExcelRows(path);
    Console.WriteLine($"من Excel: {excelRows.Count} EAN");

    var edariRows = await LoadEdari840ForBarcodeFixAsync(conn, folderSeq);
    Console.WriteLine($"في Edari تحت 840: {edariRows.Count} مادة");

    var excelByName = BuildExcelNameIndex(excelRows);
    var fixes = new List<(Edari840FixRow Edari, ImportRow Excel, string Reason)>();
    var unmatched = new List<Edari840FixRow>();
    var alreadyOk = 0;

    foreach (var edari in edariRows)
    {
        if (!TryMatchExcelRow(edari, excelByName, excelRows, out var excel))
        {
            unmatched.Add(edari);
            continue;
        }

        if (edari.Num == excel.Ean && edari.Barcode == excel.Ean)
        {
            alreadyOk++;
            continue;
        }

        fixes.Add((edari, excel, $"Num={edari.Num} Barcode={edari.Barcode} → {excel.Ean}"));
    }

    Console.WriteLine($"صحيحة: {alreadyOk} | تحتاج تصحيح: {fixes.Count} | بدون مطابقة بالاسم: {unmatched.Count}");
    foreach (var (edari, excel, reason) in fixes.Take(25))
        Console.WriteLine($"  FIX Seq={edari.Seq} | {excel.ProductName} | {reason}");
    if (fixes.Count > 25)
        Console.WriteLine($"  ... و {fixes.Count - 25} أخرى");

    if (unmatched.Count > 0)
    {
        Console.WriteLine("\n--- بدون مطابقة بالاسم ---");
        foreach (var u in unmatched.Take(30))
            Console.WriteLine($"  Seq={u.Seq} Num={u.Num} Name2={TruncateField(u.Name2, 55)}");
        if (unmatched.Count > 30)
            Console.WriteLine($"  ... و {unmatched.Count - 30} أخرى");
    }

    var edariByNum = edariRows.ToDictionary(e => e.Num, StringComparer.Ordinal);
    var orphanExcel = excelRows.Where(x => !edariByNum.ContainsKey(x.Ean)).ToList();
    var phase2Plan = new List<(Edari840FixRow Edari, ImportRow Excel)>();
    foreach (var excel in orphanExcel)
    {
        var edari = edariRows.FirstOrDefault(e =>
            e.Num != excel.Ean && NamesMatchEdariExcel(e, excel));
        if (edari is not null)
            phase2Plan.Add((edari, excel));
    }

    if (orphanExcel.Count > 0)
    {
        Console.WriteLine($"\n=== EAN في Excel غير مستخدم ({orphanExcel.Count}) ===");
        foreach (var excel in orphanExcel)
        {
            var plan = phase2Plan.FirstOrDefault(p => p.Excel.Ean == excel.Ean);
            if (plan.Edari is null)
                Console.WriteLine($"  ? {excel.Ean} | {excel.ProductName} — لا مادة مطابقة");
            else
                Console.WriteLine($"  FIX2 Seq={plan.Edari.Seq} {plan.Edari.Num} → {excel.Ean} | {excel.ProductName}");
        }
    }

    if (dryRun)
    {
        Console.WriteLine($"\nDRY RUN — سيُصحَّح {fixes.Count + phase2Plan.Count} مادة");
        return;
    }

    var updated = 0;
    var failed = 0;
    foreach (var (edari, excel, _) in fixes)
    {
        try
        {
            var conflict = await ScalarIntAsync(conn, $"""
                SELECT COUNT(*) FROM File13n
                WHERE Seq <> {edari.Seq}
                AND (Num = '{Esc(excel.Ean)}' OR Barcode = '{Esc(excel.Ean)}')
                """);
            if (conflict > 0)
            {
                Console.WriteLine($"SKIP Seq={edari.Seq}: EAN {excel.Ean} مستخدم بمادة أخرى");
                failed++;
                continue;
            }

            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"""
                    UPDATE File13n
                    SET Num = '{Esc(excel.Ean)}', Barcode = '{Esc(excel.Ean)}', Extra8 = '{Esc(excel.Ean)}'
                    WHERE Seq = {edari.Seq}
                    """;
                await cmd.ExecuteNonQueryAsync();
            }

            await UpdateFile13BcAsync(conn, edari.Seq, edari.Barcode, excel.Ean);
            Console.WriteLine($"OK Seq={edari.Seq} → {excel.Ean} | {excel.ProductName}");
            updated++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"FAIL Seq={edari.Seq}: {ex.Message.Split('\n')[0]}");
            failed++;
        }
    }

    Console.WriteLine($"\n--- انتهى --- updated={updated} failed={failed} ok={alreadyOk} unmatched={unmatched.Count}");

    var phase2 = 0;
    foreach (var (edari, excel) in phase2Plan)
    {
        try
        {
            var conflict = await ScalarIntAsync(conn, $"""
                SELECT COUNT(*) FROM File13n
                WHERE Seq <> {edari.Seq}
                AND (Num = '{Esc(excel.Ean)}' OR Barcode = '{Esc(excel.Ean)}')
                """);
            if (conflict > 0) { Console.WriteLine($"  SKIP2 {excel.Ean}: مستخدم"); continue; }

            var oldBc = edari.Barcode;
            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = $"""
                    UPDATE File13n
                    SET Num = '{Esc(excel.Ean)}', Barcode = '{Esc(excel.Ean)}', Extra8 = '{Esc(excel.Ean)}'
                    WHERE Seq = {edari.Seq}
                    """;
                await cmd.ExecuteNonQueryAsync();
            }
            await UpdateFile13BcAsync(conn, edari.Seq, oldBc, excel.Ean);
            Console.WriteLine($"  OK2 Seq={edari.Seq} → {excel.Ean} | {excel.ProductName}");
            phase2++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  FAIL2 {excel.Ean}: {ex.Message.Split('\n')[0]}");
        }
    }

    if (phase2 > 0)
        Console.WriteLine($"مرحلة 2: {phase2} تصحيح");
}

static async Task UpdateFile13BcAsync(DbConnection conn, int seq, string oldBarcode, string newBarcode)
{
    if (string.Equals(oldBarcode, newBarcode, StringComparison.Ordinal))
        return;

    if (!string.IsNullOrWhiteSpace(oldBarcode))
    {
        await using var del = conn.CreateCommand();
        del.CommandText = $"DELETE FROM File13BC WHERE BarCode = '{Esc(oldBarcode)}'";
        try { await del.ExecuteNonQueryAsync(); } catch { /* ignore */ }
    }

    var has = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File13BC WHERE BarCode = '{Esc(newBarcode)}'");
    if (has > 0)
    {
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File13BC SET EdNum = {seq} WHERE BarCode = '{Esc(newBarcode)}'";
        await upd.ExecuteNonQueryAsync();
        return;
    }

    await using var ins = conn.CreateCommand();
    ins.CommandText = $"INSERT INTO File13BC (EdNum, BarCode, Qty, NoDscnt) VALUES ({seq}, '{Esc(newBarcode)}', 1, False)";
    await ins.ExecuteNonQueryAsync();
}

static Dictionary<string, ImportRow> BuildExcelNameIndex(List<ImportRow> rows)
{
    var map = new Dictionary<string, ImportRow>(StringComparer.OrdinalIgnoreCase);
    foreach (var row in rows)
    {
        foreach (var key in NameMatchKeys(row.FullName, row.ProductName, row.Company))
        {
            if (!map.ContainsKey(key))
                map[key] = row;
        }
    }
    return map;
}

static bool NamesMatchEdariExcel(Edari840FixRow edari, ImportRow excel)
{
    var excelKeys = NameMatchKeys(excel.FullName, excel.ProductName, excel.Company).ToHashSet(StringComparer.OrdinalIgnoreCase);
    foreach (var key in NameMatchKeys(edari.Name2, edari.Name2, "EVOLUDERM"))
        if (excelKeys.Contains(key)) return true;

    var ek = NormalizeNameKey(edari.Name2);
    var xk = NormalizeNameKey(excel.FullName);
    return ek.Length >= 20 && xk.Length >= 20 &&
           (xk.StartsWith(ek, StringComparison.OrdinalIgnoreCase) ||
            ek.StartsWith(xk, StringComparison.OrdinalIgnoreCase));
}

static bool TryMatchExcelRow(Edari840FixRow edari, Dictionary<string, ImportRow> excelByName, List<ImportRow> allExcel, out ImportRow excel)
{
    foreach (var key in NameMatchKeys(edari.Name2, edari.Name2, "EVOLUDERM"))
    {
        if (excelByName.TryGetValue(key, out excel!))
            return true;
    }
    foreach (var key in NameMatchKeys(edari.Name1, edari.Name1, "EV"))
    {
        if (excelByName.TryGetValue(key, out excel!))
            return true;
    }

    // Name2 في Edari محدود بـ 50 حرف — مطابقة بالبادئة
    var edariKey = NormalizeNameKey(edari.Name2);
    if (edariKey.Length >= 20)
    {
        ImportRow? best = null;
        var bestLen = 0;
        foreach (var row in allExcel)
        {
            var excelKey = NormalizeNameKey(row.FullName);
            if (excelKey.StartsWith(edariKey, StringComparison.OrdinalIgnoreCase) ||
                edariKey.StartsWith(excelKey, StringComparison.OrdinalIgnoreCase))
            {
                var len = Math.Min(edariKey.Length, excelKey.Length);
                if (len > bestLen) { bestLen = len; best = row; }
            }
        }
        if (best is not null)
        {
            excel = best;
            return true;
        }
    }

    excel = null!;
    return false;
}

static IEnumerable<string> NameMatchKeys(string fullName, string productHint, string companyPrefix)
{
    var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    void Add(string? s)
    {
        var k = NormalizeNameKey(s);
        if (k.Length >= 8) keys.Add(k);
    }

    Add(fullName);
    Add(productHint);
    if (!string.IsNullOrWhiteSpace(fullName))
    {
        var stripped = fullName.Trim();
        if (stripped.StartsWith(companyPrefix, StringComparison.OrdinalIgnoreCase))
            Add(stripped[companyPrefix.Length..].Trim());
        if (stripped.StartsWith("EV ", StringComparison.OrdinalIgnoreCase))
            Add(stripped[3..].Trim());
        if (stripped.StartsWith("EVOLUDERM ", StringComparison.OrdinalIgnoreCase))
            Add(stripped["EVOLUDERM ".Length..].Trim());
    }
    return keys;
}

static string NormalizeNameKey(string? s)
{
    if (string.IsNullOrWhiteSpace(s)) return "";
    s = s.Trim().ToUpperInvariant();
    s = s.Normalize(System.Text.NormalizationForm.FormD);
    var sb = new StringBuilder(s.Length);
    foreach (var ch in s)
    {
        if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) == System.Globalization.UnicodeCategory.NonSpacingMark)
            continue;
        if (char.IsLetterOrDigit(ch))
            sb.Append(ch);
        else if (char.IsWhiteSpace(ch) || ch is '-' or '/' or '.' or ',')
            sb.Append(' ');
    }
    return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
}

static async Task<List<Edari840FixRow>> LoadEdari840ForBarcodeFixAsync(DbConnection conn, int folderSeq)
{
    var list = new List<Edari840FixRow>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"""
        SELECT Seq, Num, Name1, Name2, Barcode
        FROM File13n
        WHERE Father = {folderSeq}
        ORDER BY Seq
        """;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        list.Add(new Edari840FixRow(
            Convert.ToInt32(r.GetValue(0)),
            ValStr(r, 1),
            ValStr(r, 2),
            ValStr(r, 3),
            ValStr(r, 4)));
    }
    return list;
}

static string ExtractCompany(string headerCell)
{
    var text = headerCell.Trim();
    if (string.IsNullOrWhiteSpace(text)) return "EVOLUDERM";
    var parts = text.Split('|', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length > 0 && !string.IsNullOrWhiteSpace(parts[0]))
        return parts[0].Trim();
    return text.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "EVOLUDERM";
}

static string CellText(IXLWorksheet ws, int row, int col)
{
    var cell = ws.Cell(row, col);
    if (cell.IsEmpty()) return "";
    if (cell.DataType == XLDataType.Number)
        return ((long)Math.Round(cell.GetDouble())).ToString();
    return cell.GetFormattedString().Trim();
}

static bool LooksLikeEan(string s) =>
    s.Length is >= 8 and <= 14 && s.All(char.IsDigit);

static async Task ReconcileExcelAsync(DbConnection conn, string path, bool dryRun)
{
    var report = ReadExcelRowsDetailed(path);
    var excelEans = report.Rows;
    Console.WriteLine($"=== تحليل الملف ===");
    Console.WriteLine($"آخر صف: {report.LastRow} | بداية البيانات: {report.StartRow}");
    Console.WriteLine($"أسطر منتجات (تقريبي): {report.TotalProductLines}");
    Console.WriteLine($"EAN فريد في الملف: {excelEans.Count}");
    Console.WriteLine($"أسطر مكررة (نفس EAN): {report.DuplicateLines}");
    Console.WriteLine($"عينات بدون EAN: {report.NoEanSamples}");
    Console.WriteLine($"أسطر بدون وصف: {report.InvalidRows}");

    const int folderSeq = 91593;
    var inEdari840 = await LoadEdari840Async(conn, folderSeq);
    var excelSet = excelEans.Select(r => r.Ean).ToHashSet(StringComparer.Ordinal);

    var missing = excelEans.Where(r => !inEdari840.ContainsKey(r.Ean)).ToList();
    var extraInEdari = inEdari840.Values.Where(r => !excelSet.Contains(r.Num)).ToList();
    var dupNum = inEdari840.Values.GroupBy(r => r.Num).Where(g => g.Count() > 1).ToList();
    var dupBarcode = inEdari840.Values.Where(r => !string.IsNullOrWhiteSpace(r.Barcode))
        .GroupBy(r => r.Barcode).Where(g => g.Count() > 1).ToList();

    Console.WriteLine($"\n=== مقارنة Edari (شجرة 840) ===");
    Console.WriteLine($"مواد في Edari تحت 840: {inEdari840.Count}");
    Console.WriteLine($"ناقص من Edari: {missing.Count}");
    Console.WriteLine($"في Edari وليس في الملف: {extraInEdari.Count}");
    Console.WriteLine($"تكرار Num تحت 840: {dupNum.Count}");
    Console.WriteLine($"تكرار Barcode تحت 840: {dupBarcode.Count}");

    if (missing.Count > 0)
    {
        Console.WriteLine("\n--- ناقص ---");
        foreach (var m in missing)
            Console.WriteLine($"{m.Ean} | {TruncateField(m.FullName, 60)}");
    }

    if (extraInEdari.Count > 0 && extraInEdari.Count <= 20)
    {
        Console.WriteLine("\n--- في Edari فقط ---");
        foreach (var e in extraInEdari)
            Console.WriteLine($"{e.Num} | Seq={e.Seq} | {e.Name1}");
    }

    if (dupNum.Count > 0)
    {
        Console.WriteLine("\n--- تكرار Num ---");
        foreach (var g in dupNum)
            Console.WriteLine($"{g.Key}: {string.Join(", ", g.Select(x => x.Seq))}");
    }

    if (missing.Count == 0 && dupNum.Count == 0 && dupBarcode.Count == 0)
    {
        var globalDup = await CountGlobalDuplicateEansAsync(conn, excelSet, folderSeq);
        Console.WriteLine($"\n✓ كل EAN فريد في الملف ({excelEans.Count}) موجود في Edari تحت 840 — بدون تكرار محلي");
        Console.WriteLine($"  أسطر الفاتورة: {report.TotalProductLines} | مكرر في الملف: {report.DuplicateLines} | بدون EAN (عينات): {report.NoEanSamples}");
        if (globalDup > 0)
            Console.WriteLine($"  تحذير: {globalDup} EAN موجود أيضاً خارج شجرة 840");
        return;
    }

    if (dryRun)
    {
        Console.WriteLine($"\nDRY RUN — سيُضاف {missing.Count} مادة");
        return;
    }

    var columns = await GetColumnNamesAsync(conn);
    var templateBase = await ReadRowAsync(conn, "File13n", templateSeqDefault, columns);
    var added = 0;
    var failed = 0;

    foreach (var row in missing)
    {
        // تحقق عالمي — ربما موجود خارج 840
        var global = await ScalarIntAsync(conn,
            $"SELECT COUNT(*) FROM File13n WHERE Num = '{Esc(row.Ean)}' OR Barcode = '{Esc(row.Ean)}'");
        if (global > 0)
        {
            Console.WriteLine($"WARN {row.Ean}: موجود في Edari خارج 840 — تحقق يدوياً");
            continue;
        }

        try
        {
            var seq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;
            var template = new Dictionary<string, object?>(templateBase, StringComparer.OrdinalIgnoreCase);
            ApplyProduct(template, seq, row.Ean, row.FullName, folderSeq);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = BuildInsertSql(template);
            cmd.CommandTimeout = 120;
            await cmd.ExecuteNonQueryAsync();
            Console.WriteLine($"ADD Seq={seq} {row.Ean}");
            added++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"FAIL {row.Ean}: {ex.Message.Split('\n')[0]}");
            failed++;
        }
    }

    await UpdateFolderSubCountAsync(conn, folderSeq);
    await ResetFile13nAutoIncAsync(conn, apply: true);

    var after = await LoadEdari840Async(conn, folderSeq);
    var stillMissing = excelEans.Count(r => !after.ContainsKey(r.Ean));
    Console.WriteLine($"\n--- انتهى --- added={added} failed={failed} stillMissing={stillMissing} edari840={after.Count} expected={excelEans.Count}");
}

static async Task<int> CountGlobalDuplicateEansAsync(DbConnection conn, HashSet<string> eans, int folderSeq)
{
    var count = 0;
    foreach (var ean in eans)
    {
        var n = await ScalarIntAsync(conn, $"""
            SELECT COUNT(*) FROM File13n
            WHERE Father <> {folderSeq}
            AND (Num = '{Esc(ean)}' OR Barcode = '{Esc(ean)}')
            """);
        if (n > 0) count++;
    }
    return count;
}

static async Task<Dictionary<string, Edari840Row>> LoadEdari840Async(DbConnection conn, int folderSeq)
{
    var map = new Dictionary<string, Edari840Row>(StringComparer.Ordinal);
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"""
        SELECT Seq, Num, Name1, Barcode, Father
        FROM File13n
        WHERE Father = {folderSeq}
        """;
    cmd.CommandTimeout = 300;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var num = ValStr(r, 1);
        var barcode = ValStr(r, 3);
        var row = new Edari840Row(
            Convert.ToInt32(r.GetValue(0)),
            num,
            ValStr(r, 2),
            barcode,
            Convert.ToInt32(r.GetValue(4)));

        var key = !string.IsNullOrWhiteSpace(num) ? num : barcode;
        if (!string.IsNullOrWhiteSpace(key) && !map.ContainsKey(key))
            map[key] = row;
    }
    return map;
}

static string ValStr(System.Data.Common.DbDataReader r, int i) =>
    r.IsDBNull(i) ? "" : r.GetValue(i)?.ToString()?.Trim() ?? "";

static string BuildFullName(string company, string product)
{
    company = company.Trim();
    product = product.Trim();
    if (string.IsNullOrWhiteSpace(company)) return product;
    if (product.StartsWith(company, StringComparison.OrdinalIgnoreCase)) return product;
    return $"{company} {product}";
}

static async Task ClearName2Under840Async(DbConnection conn)
{
    const int folderSeq = 91593;
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"""
        UPDATE File13n SET Name2 = ''
        WHERE Father = {folderSeq}
        """;
    cmd.CommandTimeout = 300;
    var rows = await cmd.ExecuteNonQueryAsync();
    Console.WriteLine($"تم مسح Name2 لـ {rows} مادة تحت شجرة 840");

    await RunQuery(conn, $"""
        SELECT TOP 5 Seq, Num, Name1, Name2
        FROM File13n
        WHERE Father = {folderSeq}
        ORDER BY Seq
        """);
}

static async Task InsertOneAsync(DbConnection conn, string ean, string? description)
{
    description ??= $"EVOLUDERM TEST {ean}";
    var folderSeq = await ScalarIntAsync(conn, "SELECT Seq FROM File13n WHERE Num = '840' ORDER BY Seq");
    var columns = await GetColumnNamesAsync(conn);
    var templateBase = await ReadRowAsync(conn, "File13n", templateSeqDefault, columns);
    var seq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;
    var template = new Dictionary<string, object?>(templateBase, StringComparer.OrdinalIgnoreCase);
    ApplyProduct(template, seq, ean, description, folderSeq);
    var sql = BuildInsertSql(template);
    Console.WriteLine(sql.Length > 800 ? sql[..800] + "..." : sql);
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 120;
        var n = await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"OK rows={n} Seq={seq}");
    }
    catch (Exception ex)
    {
        Console.WriteLine("FULL ERROR:");
        Console.WriteLine(ex.ToString());
    }
}

static async Task CheckEansAsync(DbConnection conn, string path)
{
    var rows = ReadExcelRows(path).Skip(1);
    foreach (var row in rows)
    {
        await RunQuery(conn, $"""
            SELECT Seq, Num, Name1, Barcode, Father
            FROM File13n
            WHERE Num = '{Esc(row.Ean)}' OR Barcode = '{Esc(row.Ean)}'
            """);
    }
}

static async Task ImportExcelAsync(DbConnection conn, string path, bool dryRun, bool retryFailedOnly = false)
{
    var allRows = ReadExcelRows(path);
    if (allRows.Count == 0)
    {
        Console.WriteLine("لا توجد صفوف للاستيراد.");
        return;
    }

    var toImport = allRows; // reconcile يتولى المقارنة — الاستيراد القديم يضيف الكل الناقص
    Console.WriteLine($"إجمالي EAN فريد في الملف: {allRows.Count} | للمعالجة: {toImport.Count}");

    var folderSeq = await ScalarIntAsync(conn, "SELECT Seq FROM File13n WHERE Num = '840' ORDER BY Seq");
    if (folderSeq <= 0) throw new InvalidOperationException("لم يُعثر على مجلد الشجرة Num=840");

    var columns = await GetColumnNamesAsync(conn);
    var templateBase = await ReadRowAsync(conn, "File13n", templateSeqDefault, columns);
    if (templateBase.Count == 0) throw new InvalidOperationException("قالب المادة غير موجود");

    var nextSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;
    var added = 0;
    var skipped = 0;
    var failed = 0;
    var failedRows = new List<ImportRow>();

    foreach (var row in toImport)
    {
        if (string.IsNullOrWhiteSpace(row.Ean))
        {
            skipped++;
            continue;
        }

        var exists = await ScalarIntAsync(conn,
            $"SELECT COUNT(*) FROM File13n WHERE Num = '{Esc(row.Ean)}' OR Barcode = '{Esc(row.Ean)}'");

        if (exists > 0)
        {
            if (!retryFailedOnly)
                Console.WriteLine($"SKIP exists: {row.Ean} — {row.FullName}");
            skipped++;
            continue;
        }

        if (retryFailedOnly && exists > 0) { skipped++; continue; }

        if (dryRun)
        {
            Console.WriteLine($"DRY ADD Seq={nextSeq} {row.Ean} | {row.FullName}");
            nextSeq++;
            added++;
            continue;
        }

        try
        {
            nextSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n") + 1;
            var template = new Dictionary<string, object?>(templateBase, StringComparer.OrdinalIgnoreCase);
            ApplyProduct(template, nextSeq, row.Ean, row.FullName, folderSeq);
            var sql = BuildInsertSql(template);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.CommandTimeout = 120;
            await cmd.ExecuteNonQueryAsync();
            Console.WriteLine($"OK Seq={nextSeq} {row.Ean} | {row.FullName}");
            added++;
        }
        catch (Exception ex)
        {
            var msg = ex.Message;
            if (msg.Contains("duplicate", StringComparison.OrdinalIgnoreCase) || msg.Contains("unique", StringComparison.OrdinalIgnoreCase))
                Console.WriteLine($"FAIL dup {row.Ean}: موجود برقم/باركود مكرر");
            else if (msg.Length > 200) Console.WriteLine($"FAIL {row.Ean}: {msg[..200]}...");
            else Console.WriteLine($"FAIL {row.Ean}: {msg.Split('\n')[0]}");
            failedRows.Add(row);
            failed++;
        }
    }

    if (failedRows.Count > 0)
    {
        Console.WriteLine("\n--- فشل ---");
        foreach (var f in failedRows)
            Console.WriteLine($"{f.Ean} | {f.FullName}");
    }

    if (!dryRun)
    {
        await UpdateFolderSubCountAsync(conn, folderSeq);
        await ResetFile13nAutoIncAsync(conn, apply: true);
    }

    Console.WriteLine($"--- انتهى --- added={added} skipped={skipped} failed={failed} dryRun={dryRun}");
}

static async Task UpdateFolderSubCountAsync(DbConnection conn, int folderSeq)
{
    var childSeqs = new List<int>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq FROM File13n WHERE Father = {folderSeq} ORDER BY Seq";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            childSeqs.Add(Convert.ToInt32(r.GetValue(0)));
    }

    if (childSeqs.Count == 0) return;

    var sub = BuildSubBlob(childSeqs);
    var hex = BitConverter.ToString(sub).Replace("-", "");
    await using var upd = conn.CreateCommand();
    upd.CommandText = $"""
        UPDATE File13n
        SET SubCount = {childSeqs.Count}, Sub = x'{hex}'
        WHERE Seq = {folderSeq}
        """;
    try
    {
        await upd.ExecuteNonQueryAsync();
    }
    catch
    {
        await using var upd2 = conn.CreateCommand();
        upd2.CommandText = $"UPDATE File13n SET SubCount = {childSeqs.Count}, Sub = ? WHERE Seq = {folderSeq}";
        var p = upd2.CreateParameter();
        p.ParameterName = "Sub";
        p.Value = sub;
        upd2.Parameters.Add(p);
        await upd2.ExecuteNonQueryAsync();
    }
}

static void ApplyProduct(Dictionary<string, object?> template, int seq, string ean, string fullName, int folderSeq)
{
    var name = TruncateField(fullName, 50);
    template["Seq"] = seq;
    template["Num"] = TruncateField(ean, 50);
    template["Name1"] = name;
    template["Name2"] = "";
    template["Barcode"] = TruncateField(ean, 50);
    template["Father"] = folderSeq;
    if (template.ContainsKey("Extra8")) template["Extra8"] = TruncateField(ean, 50);
    if (template.ContainsKey("Sub")) template["Sub"] = 0;

    foreach (var col in template.Keys.ToList())
    {
        var lc = col.ToLowerInvariant();
        if (lc is "seq" or "num" or "name1" or "name2" or "barcode" or "father" or "extra8" or "sub")
            continue;

        if (lc.StartsWith("sellpr") || lc is "last" or "avrg" or "ccavrg" or "clast" or "ctop" or "curavrg" or "top" or "fixed"
            or "inam" or "outam" or "purchaseam" or "salesam" or "intot" or "outtot" or "tot1" or "tot2" or "tot3"
            or "purchasetot" or "salestot" or "curtot1" or "curtot2" or "curtot3" or "inbooked" or "outbooked"
            or "bonus" or "bonusdiv" or "point" or "point2" or "point3")
        {
            template[col] = template[col] is bool ? false : (object)0.0;
        }
    }
}

static string TruncateField(string value, int maxLen)
{
    var s = value.Trim();
    return s.Length <= maxLen ? s : s[..maxLen];
}

static string QuoteIdent(string name) => $"\"{name.Replace("\"", "\"\"")}\"";

static string BuildInsertSql(Dictionary<string, object?> template, string table = "File13n")
{
    var colList = string.Join(", ", template.Keys.Select(QuoteIdent));
    var valList = string.Join(", ", template.Values.Select(FormatValue));
    return $"INSERT INTO {table} ({colList}) VALUES ({valList})";
}

static string EdariDate(DateTime dt) => $"'{dt:yyyy-MM-dd}'";

static string Esc(string s) => s.Replace("'", "''");

static async Task Compare840Async(DbConnection conn, string editedNum)
{
    const int folderSeq = 91593;
    await RunQuery(conn, $"""
        SELECT Seq, Num, Name1, Stored, Dest, SubCount, DefUnit, Method, FixedFactor, Regist
        FROM File13n WHERE Num = '{Esc(editedNum)}'
        """);
    await RunQuery(conn, $"""
        SELECT TOP 3 Seq, Num, Name1, Stored, Dest, SubCount, DefUnit, Method, FixedFactor, Regist
        FROM File13n
        WHERE Father = {folderSeq} AND Num <> '{Esc(editedNum)}'
        ORDER BY Seq
        """);
    // compare with known good product from another tree
    await RunQuery(conn, """
        SELECT TOP 1 Seq, Num, Name1, Stored, Dest, SubCount, DefUnit, Method, FixedFactor, Regist
        FROM File13n WHERE Seq = 76576
        """);
}

static async Task ScanTablesAsync(DbConnection conn)
{
    foreach (var tbl in new[] {
        "File11n","File12n","File13n","File14n","File15n","File17n","File18n","File19n","File20n",
        "File21n","File22n","File23n","File24n","File25n","File26","File27n","File28n",
        "FileManu","FilePOS","FilePOS1","FilePOS2","FilePOS3","FilePOS4","FilePOS5","FilePosO","FilePosO_Mats",
        "FileBrch","Sections","Branches","Branch","SaleMan","FileMat","FileList","FileLists","MatList","Lists"
    })
    {
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM {tbl}";
            var c = await cmd.ExecuteScalarAsync();
            Console.WriteLine($"{tbl}: {c}");
        }
        catch { Console.WriteLine($"{tbl}: N/A"); }
    }
}

static async Task ScanMaterialListsAsync(DbConnection conn)
{
    // FilePOS1/2/3 — قوائم مواد POS
    foreach (var tbl in new[] { "FilePOS1", "FilePOS2", "FilePOS3", "FilePOS", "FilePosO", "FilePosO_Mats" })
    {
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT TOP 0 * FROM {tbl}";
            await using var r = await cmd.ExecuteReaderAsync();
            var cols = string.Join(", ", Enumerable.Range(0, r.FieldCount).Select(r.GetName));
            Console.WriteLine($"\n{tbl} cols: {cols}");
            await r.CloseAsync();

            cmd.CommandText = $"SELECT COUNT(*) FROM {tbl}";
            Console.WriteLine($"{tbl} rows: {await cmd.ExecuteScalarAsync()}");

            cmd.CommandText = $"SELECT TOP 10 * FROM {tbl}";
            await using var r2 = await cmd.ExecuteReaderAsync();
            var colNames = Enumerable.Range(0, r2.FieldCount).Select(r2.GetName).ToArray();
            Console.WriteLine(string.Join(" | ", colNames));
            var n = 0;
            while (await r2.ReadAsync() && n++ < 10)
            {
                var vals = Enumerable.Range(0, r2.FieldCount).Select(i =>
                    r2.IsDBNull(i) ? "" : r2.GetValue(i)?.ToString()?.Trim()?.Substring(0, Math.Min(30, r2.GetValue(i)?.ToString()?.Length ?? 0)));
                Console.WriteLine(string.Join(" | ", vals));
            }
        }
        catch (Exception ex) { Console.WriteLine($"{tbl}: {ex.Message.Split('\n')[0]}"); }
    }

    // البحث عن صفوف فارغة في جداول محتملة
    foreach (var sql in new[]
    {
        "SELECT Seq, SubCount FROM File13n WHERE Num = '840'",
        "SELECT COUNT(*) FROM File13n WHERE Father = 91593",
        "SELECT TOP 5 Seq, Num, Name1, Unt1, DefUnit FROM File13n WHERE Father = 91593 AND (Num IS NULL OR Num = '')",
    })
    {
        Console.WriteLine($"\n=== {sql} ===");
        try { await RunQuery(conn, sql); } catch { }
    }
}

static async Task ProbeSubFoldersAsync(DbConnection conn)
{
    Console.WriteLine("=== مجلدات Dest=4 مع SubCount > 5 ===");
    await RunQuery(conn, """
        SELECT TOP 15 Seq, Num, Name1, Dest, SubCount
        FROM File13n
        WHERE Dest = 4 AND SubCount > 5
        ORDER BY SubCount DESC
        """);

    await using var cmd = conn.CreateCommand();
    cmd.CommandText = """
        SELECT TOP 5 Seq, Num, SubCount, Sub
        FROM File13n
        WHERE Dest = 4 AND SubCount > 5 AND Sub IS NOT NULL
        ORDER BY SubCount DESC
        """;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = r.GetValue(0);
        var num = ValStr(r, 1);
        var sc = r.GetValue(2);
        var sub = r.IsDBNull(3) ? null : (byte[])r.GetValue(3)!;
        var hex = sub is null ? "NULL" : BitConverter.ToString(sub);
        var ints = sub is null ? "" : string.Join(",", ParseSubSeqs(sub));
        Console.WriteLine($"Seq={seq} Num={num} SubCount={sc} SubLen={sub?.Length ?? 0} => [{ints}]");
        if (sub is { Length: > 0 and <= 64 }) Console.WriteLine($"  hex: {hex}");
    }

    // مجلد 840 الحالي
    Console.WriteLine("\n=== مجلد 840 ===");
    await using var c2 = conn.CreateCommand();
    c2.CommandText = "SELECT Sub, SubCount FROM File13n WHERE Seq = 91593";
    await using var r2 = await c2.ExecuteReaderAsync();
    if (await r2.ReadAsync())
    {
        var sub = r2.IsDBNull(0) ? null : (byte[])r2.GetValue(0)!;
        var sc = r2.GetValue(1);
        Console.WriteLine($"SubCount={sc} SubLen={sub?.Length ?? 0}");
        if (sub != null)
        {
            Console.WriteLine($"Seqs in Sub: {string.Join(", ", ParseSubSeqs(sub))}");
            Console.WriteLine($"hex: {BitConverter.ToString(sub)}");
        }
    }
}

static IEnumerable<int> ParseSubSeqs(byte[] sub)
{
    for (var i = 0; i + 3 < sub.Length; i += 4)
    {
        var v = BitConverter.ToInt32(sub, i);
        if (v != 0) yield return v;
    }
}

static byte[] BuildSubBlob(IReadOnlyList<int> seqs)
{
    var buf = new byte[seqs.Count * 4];
    for (var i = 0; i < seqs.Count; i++)
        BitConverter.TryWriteBytes(buf.AsSpan(i * 4, 4), seqs[i]);
    return buf;
}

static async Task RebuildSub840Async(DbConnection conn, bool apply)
{
    const int folderSeq = 91593;

    var childSeqs = new List<int>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq FROM File13n WHERE Father = {folderSeq} ORDER BY Seq";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            childSeqs.Add(Convert.ToInt32(r.GetValue(0)));
    }

    Console.WriteLine($"أبناء المجلد 840: {childSeqs.Count}");

    // قراءة Sub الحالي
    byte[]? currentSub = null;
    var currentSubCount = 0;
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Sub, SubCount FROM File13n WHERE Seq = {folderSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            currentSubCount = Convert.ToInt32(r.GetValue(1));
            if (!r.IsDBNull(0)) currentSub = (byte[])r.GetValue(0)!;
        }
    }

    var currentSeqs = currentSub is null ? [] : ParseSubSeqs(currentSub).ToList();
    Console.WriteLine($"SubCount={currentSubCount} SubLen={currentSub?.Length ?? 0} seqs in Sub={currentSeqs.Count}");
    if (currentSeqs.Count > 0)
        Console.WriteLine($"  current: {string.Join(", ", currentSeqs.Take(5))}...");

    var newSub = BuildSubBlob(childSeqs);
    Console.WriteLine($"New Sub blob: {childSeqs.Count} entries, {newSub.Length} bytes");
    Console.WriteLine($"  first 5: {string.Join(", ", childSeqs.Take(5))}");
    Console.WriteLine($"  last 3: {string.Join(", ", childSeqs.TakeLast(3))}");

    if (!apply)
    {
        Console.WriteLine("\nDRY RUN — نفّذ: rebuild-sub-840 apply");
        return;
    }

    // NexusDB: تحديث BLOB عبر parameter أو hex
    var hex = BitConverter.ToString(newSub).Replace("-", "");
    await using var upd = conn.CreateCommand();
    upd.CommandText = $"""
        UPDATE File13n
        SET Sub = x'{hex}', SubCount = {childSeqs.Count}
        WHERE Seq = {folderSeq}
        """;
    try
    {
        var n = await upd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ تم تحديث Sub و SubCount — rows={n}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"FAIL hex update: {ex.Message.Split('\n')[0]}");
        // محاولة بديلة: parameter
        try
        {
            await using var upd2 = conn.CreateCommand();
            upd2.CommandText = $"UPDATE File13n SET Sub = ?, SubCount = ? WHERE Seq = {folderSeq}";
            var pSub = upd2.CreateParameter();
            pSub.ParameterName = "Sub";
            pSub.Value = newSub;
            upd2.Parameters.Add(pSub);
            var pSc = upd2.CreateParameter();
            pSc.ParameterName = "SubCount";
            pSc.Value = childSeqs.Count;
            upd2.Parameters.Add(pSc);
            var n = await upd2.ExecuteNonQueryAsync();
            Console.WriteLine($"✓ تم عبر parameter — rows={n}");
        }
        catch (Exception ex2)
        {
            Console.WriteLine($"FAIL parameter: {ex2.Message.Split('\n')[0]}");
            throw;
        }
    }

    Console.WriteLine("\nأغلق Edari وأعد فتحه — افتح «تعديل قائمة مواد» للمجلد 840");
}

static async Task ActivateAll840Async(DbConnection conn)
{
    const int folderSeq = 91593;
    const int refSeq = 91684;

    await UpdateFolderSubCountAsync(conn, folderSeq);

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"""
            UPDATE File13n
            SET Total = (SELECT Total FROM File13n WHERE Seq = {refSeq})
            WHERE Father = {folderSeq} AND Seq <> {refSeq}
            """;
        var n = await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ Total: {n} مادة");
    }

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"""
            UPDATE File13n SET
                InTot = 0, OutTot = 0, Tot1 = 0, Tot2 = 0, Tot3 = 0,
                CurTot1 = 0, CurTot2 = 0, CurTot3 = 0,
                InAm = 0, OutAm = 0, PurchaseTot = 0, PurchaseAm = 0,
                SalesTot = 0, SalesAm = 0, InBooked = 0, OutBooked = 0,
                Avrg = 0, Top = 0, Last = 0, CurAvrg = 0,
                Name2 = ''
            WHERE Father = {folderSeq}
            """;
        var n = await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ حقول مخزون/Name2: {n} مادة");
    }

    // DtModified إن وُجد
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT TOP 0 DtModified FROM File13n";
        await cmd.ExecuteScalarAsync();
        await using var upd = conn.CreateCommand();
        upd.CommandText = $"UPDATE File13n SET DtModified = CURRENT_TIMESTAMP WHERE Father = {folderSeq}";
        var n = await upd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ DtModified: {n} مادة");
    }
    catch { /* column may not exist */ }

    try
    {
        await RunQuery(conn, "SELECT * FROM File17n");
    }
    catch { }

    Console.WriteLine("\n=== تم التفعيل الكامل — أغلق Edari تماماً وأعد فتحه ===");
    Console.WriteLine("جرّب قائمة المواد — يجب أن تظهر كل الـ 135 مادة");
}

static async Task FixTotal840Async(DbConnection conn, bool apply)
{
    const int folderSeq = 91593;
    var zeroTotal = new byte[16]; // 16 zero bytes like edited products

    var seqs = new List<int>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq, Num, Total FROM File13n WHERE Father = {folderSeq}";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var seq = Convert.ToInt32(r.GetValue(0));
            var num = ValStr(r, 1);
            var needsFix = false;
            if (r.IsDBNull(2)) needsFix = true;
            else
            {
                var b = (byte[])r.GetValue(2)!;
                needsFix = !b.All(x => x == 0);
            }
            if (needsFix)
            {
                seqs.Add(seq);
                if (seqs.Count <= 5)
                {
                    var hex = r.IsDBNull(2) ? "NULL" : BitConverter.ToString((byte[])r.GetValue(2)!);
                    Console.WriteLine($"  needs fix: {num} Total={hex}");
                }
            }
        }
    }

    Console.WriteLine($"مواد تحتاج تصحيح Total: {seqs.Count} / 135");

    if (!apply)
    {
        Console.WriteLine("DRY RUN — نفّذ: fix-total-840 apply");
        return;
    }

    var fixed_ = 0;
    const int refSeq = 91684; // منتج ظهر بعد تعديل — Total صحيح
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            UPDATE File13n
            SET Total = (SELECT Total FROM File13n WHERE Seq = {refSeq})
            WHERE Father = {folderSeq} AND Seq <> {refSeq}
            """;
        cmd.CommandTimeout = 300;
        fixed_ = await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ نُسخ Total من Seq={refSeq} إلى {fixed_} مادة");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"FAIL copy Total: {ex.Message.Split('\n')[0]}");
    }

    Console.WriteLine($"تم تصحيح Total — أعد تشغيل Edari");
}

static async Task File12ProbeAsync(DbConnection conn)
{
    foreach (var seq in new[] { 91684, 91595, 91714 })
    {
        Console.WriteLine($"\n=== File12n Seq={seq} ===");
        await RunQuery(conn, $"SELECT * FROM File12n WHERE Seq = {seq}");
    }
    await RunQuery(conn, """
        SELECT COUNT(*) AS MaterialsUnder840 FROM File13n WHERE Father = 91593
        """);
    await RunQuery(conn, """
        SELECT COUNT(*) AS File12For840 FROM File12n f
        INNER JOIN File13n m ON m.Seq = f.Seq
        WHERE m.Father = 91593
        """);
}

static async Task SyncFile12For840Async(DbConnection conn, bool apply)
{
    const int folderSeq = 91593;
    var cols12 = await GetColumnNamesAsync(conn, "File12n");
    var templateSeq = 91684; // منتج ظهر بعد تعديل
    var template = await ReadRowAsync(conn, "File12n", templateSeq, cols12);
    if (template.Count == 0)
        throw new InvalidOperationException($"لا يوجد قالب File12n للـ Seq={templateSeq}");

    Console.WriteLine($"File12n template columns: {template.Count}");
    foreach (var kv in template.OrderBy(k => k.Key))
        Console.WriteLine($"  {kv.Key} = {FmtVal(kv.Value)}");

    var materials = new List<(int Seq, string Num, string Name)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq, Num, Name1 FROM File13n WHERE Father = {folderSeq} ORDER BY Seq";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            materials.Add((Convert.ToInt32(r.GetValue(0)), ValStr(r, 1), ValStr(r, 2)));
    }

    var missing = new List<(int Seq, string Num, string Name)>();
    foreach (var m in materials)
    {
        var has = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File12n WHERE Seq = {m.Seq}");
        if (has == 0) missing.Add(m);
    }

    Console.WriteLine($"\nمواد تحت 840: {materials.Count} | لديها File12n: {materials.Count - missing.Count} | ناقص: {missing.Count}");

    if (!apply)
    {
        Console.WriteLine("DRY RUN — نفّذ: sync-file12-840 apply");
        foreach (var m in missing.Take(10))
            Console.WriteLine($"  MISSING File12n: {m.Num} Seq={m.Seq}");
        return;
    }

    var nextSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File12n") + 1;
    var added = 0;
    foreach (var m in missing)
    {
        try
        {
            var row = new Dictionary<string, object?>(template, StringComparer.OrdinalIgnoreCase);
            row["Seq"] = m.Seq; // File12n.Seq = File13n.Seq للمواد؟
            if (row.ContainsKey("Num")) row["Num"] = m.Num;
            if (row.ContainsKey("Remarks")) row["Remarks"] = TruncateField(m.Name, 200);
            if (row.ContainsKey("DateEntered")) row["DateEntered"] = DateTime.Now;
            if (row.ContainsKey("DtCreated")) row["DtCreated"] = DateTime.Now;
            if (row.ContainsKey("DtModified")) row["DtModified"] = DateTime.Now;

            // إذا Seq في File12n مستقل وليس نفس File13n
            var existsByMatSeq = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File12n WHERE Seq = {m.Seq}");
            if (existsByMatSeq > 0) continue;

            var sql = BuildInsertSql(row);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.CommandTimeout = 120;
            await cmd.ExecuteNonQueryAsync();
            added++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"FAIL {m.Num}: {ex.Message.Split('\n')[0]}");
        }
    }

    Console.WriteLine($"تم إضافة {added} سجل File12n");
}

static string FmtVal(object? v)
{
    if (v is null) return "NULL";
    if (v is byte[] b) return $"bytes[{b.Length}]";
    var s = v.ToString() ?? "";
    return s.Length > 50 ? s[..50] + "…" : s;
}

static async Task DiffVisibleAsync(DbConnection conn)
{
    var visible = new[] { "3760100162905", "3760100173055", "3760100203769" };
    var hidden = new[] { "3760420251112", "3760100183382", "3760100683257" };
    var cols = await GetColumnNamesAsync(conn);

    Dictionary<string, object?> ReadOne(string num)
    {
        var seq = ScalarIntAsync(conn, $"SELECT Seq FROM File13n WHERE Num = '{Esc(num)}'").GetAwaiter().GetResult();
        return ReadRowAsync(conn, "File13n", seq, cols).GetAwaiter().GetResult();
    }

    // File12n — فهرس محتمل لقوائم المواد
    Console.WriteLine("=== File12n lookup ===");
    foreach (var num in visible.Concat(hidden))
    {
        var seq = await ScalarIntAsync(conn, $"SELECT Seq FROM File13n WHERE Num = '{Esc(num)}'");
        foreach (var q in new[]
        {
            $"SELECT COUNT(*) FROM File12n WHERE Seq = {seq}",
            $"SELECT COUNT(*) FROM File12n WHERE Mat = {seq}",
            $"SELECT COUNT(*) FROM File12n WHERE Num = '{Esc(num)}'",
        })
        {
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = q;
                var c = await cmd.ExecuteScalarAsync();
                if (Convert.ToInt32(c) > 0) Console.WriteLine($"{num}: {q} => {c}");
            }
            catch { /* column may not exist */ }
        }
    }

    // File12n columns
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT TOP 0 * FROM File12n";
        await using var r = await cmd.ExecuteReaderAsync();
        Console.WriteLine("File12n cols: " + string.Join(", ", Enumerable.Range(0, r.FieldCount).Select(r.GetName)));
    }
    catch (Exception ex) { Console.WriteLine("File12n cols ERR: " + ex.Message); }

    Console.WriteLine("\n=== Field diffs (visible vs hidden) ===");
    var visRows = visible.Select(ReadOne).ToList();
    var hidRows = hidden.Select(ReadOne).ToList();
    var allKeys = visRows.SelectMany(r => r.Keys).Union(hidRows.SelectMany(r => r.Keys)).Distinct(StringComparer.OrdinalIgnoreCase);

    foreach (var key in allKeys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase))
    {
        var visVals = visRows.Select(r => r.TryGetValue(key, out var v) ? Fmt(v) : "?").Distinct().ToList();
        var hidVals = hidRows.Select(r => r.TryGetValue(key, out var v) ? Fmt(v) : "?").Distinct().ToList();
        if (visVals.Count == 1 && hidVals.Count == 1 && visVals[0] == hidVals[0]) continue;
        if (visVals.All(v => v == "NULL") && hidVals.All(v => v == "NULL")) continue;
        Console.WriteLine($"{key}: V=[{string.Join("|", visVals)}] H=[{string.Join("|", hidVals)}]");
    }

    static string Fmt(object? v)
    {
        if (v is null) return "NULL";
        if (v is byte[] b) return $"B{b.Length}:{BitConverter.ToString(b.Take(6).ToArray())}";
        if (v is string s) return s.Length > 40 ? s[..40] + "…" : s;
        return v.ToString() ?? "NULL";
    }
}

static async Task SubProbeAsync(DbConnection conn)
{
    foreach (var num in new[] { "3760100173055", "3760420251112", "3790070496659", "840" })
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT Seq, Num, Sub, Dest, SubCount FROM File13n WHERE Num = '{num}'";
        try
        {
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                string subDesc;
                if (r.IsDBNull(2)) subDesc = "NULL";
                else
                {
                    var v = r.GetValue(2)!;
                    subDesc = v is byte[] b ? $"bytes[{b.Length}]={BitConverter.ToString(b)}" : $"{v.GetType().Name}:{v}";
                }
                Console.WriteLine($"{num} Seq={r.GetValue(0)} Sub={subDesc} Dest={r.GetValue(3)} SubCount={r.GetValue(4)}");
            }
        }
        catch (Exception ex) { Console.WriteLine($"{num} ERR: {ex.Message.Split('\n')[0]}"); }
    }
}

static async Task Audit840Async(DbConnection conn)
{
    const int folderSeq = 91593;
    // استكشاف جداول Edari
    foreach (var tbl in new[] { "File11n", "File12n", "File13n", "File14n", "File15n", "File17n",
        "File23n", "File24n", "File25n", "File26", "FileManu", "FilePOS1", "FilePOS2", "FilePOS3", "FilePosO" })
    {
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM {tbl}";
            var c = await cmd.ExecuteScalarAsync();
            Console.WriteLine($"{tbl}: {c} rows");
        }
        catch { Console.WriteLine($"{tbl}: N/A"); }
    }

    // هل Seq منتجنا موجود في جداول أخرى؟
    foreach (var tbl in new[] { "File14n", "File15n", "File17n", "File23n", "File24n", "File25n" })
    {
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM {tbl} WHERE Mat = 91684 OR MatSeq = 91684 OR Seq = 91684";
            var c = await cmd.ExecuteScalarAsync();
            if (Convert.ToInt32(c) > 0) Console.WriteLine($"{tbl} refs 91684: {c}");
        }
        catch { /* column names differ */ }
    }
}

static async Task Activate840Async(DbConnection conn, bool apply)
{
    const int folderSeq = 91593;
    var childCount = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File13n WHERE Father = {folderSeq}");
    var folderSubCount = await ScalarIntAsync(conn, $"SELECT SubCount FROM File13n WHERE Seq = {folderSeq}");

    Console.WriteLine($"مجلد 840: SubCount={folderSubCount} | أبناء فعلي={childCount}");

    // مواءمة حقول المخزون/الإجمالي مثل المنتج المُعدّل يدوياً
    var zeroFields = "InTot = 0, OutTot = 0, Tot1 = 0, Tot2 = 0, Tot3 = 0, CurTot1 = 0, CurTot2 = 0, CurTot3 = 0, " +
                     "InAm = 0, OutAm = 0, PurchaseTot = 0, PurchaseAm = 0, SalesTot = 0, SalesAm = 0, " +
                     "InBooked = 0, OutBooked = 0, Avrg = 0, Top = 0, Last = 0, CurAvrg = 0";

    var needZero = await ScalarIntAsync(conn, $"""
        SELECT COUNT(*) FROM File13n
        WHERE Father = {folderSeq}
        AND (InTot <> 0 OR PurchaseTot <> 0 OR CurTot1 <> 0 OR Tot1 <> 0)
        """);

    Console.WriteLine($"مواد بحقول مخزون غير صفرية: {needZero}");

    if (!apply)
    {
        Console.WriteLine("DRY RUN — نفّذ: activate-840 apply");
        return;
    }

    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"UPDATE File13n SET SubCount = {childCount} WHERE Seq = {folderSeq}";
        await cmd.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ SubCount للمجلد → {childCount}");
    }

    await using (var cmd2 = conn.CreateCommand())
    {
        cmd2.CommandText = $"UPDATE File13n SET {zeroFields} WHERE Father = {folderSeq}";
        var n = await cmd2.ExecuteNonQueryAsync();
        Console.WriteLine($"✓ صُفّرت حقول المخزون لـ {n} مادة");
    }

    Console.WriteLine("تم — أعد فتح Edari وجرب قائمة المواد");
}

static async Task ProbeAsync(DbConnection conn)
{
    await RunQuery(conn, """
        SELECT Num, SellPr4, InTot, CurTot1, Regist, Stored, Horiz, Extra5
        FROM File13n
        WHERE Num IN ('3760100162905','3760100173055','3760100203769','3760420251112','3760100183382')
        ORDER BY Num
        """);
    // Total blob
    foreach (var num in new[] { "3760100173055", "3760420251112", "3760100162905" })
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT Seq, Total FROM File13n WHERE Num = '{num}'";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var total = r.IsDBNull(1) ? "NULL" : BitConverter.ToString((byte[])r.GetValue(1));
            Console.WriteLine($"Total {num} Seq={r.GetValue(0)}: {total}");
        }
    }
}

static async Task DiagManualAddAsync(DbConnection conn)
{
    var maxSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n");
    var count = await ScalarIntAsync(conn, "SELECT COUNT(*) FROM File13n");
    Console.WriteLine($"File13n: COUNT={count} MAX(Seq)={maxSeq}");

    // تكرار Seq؟
    await RunQuery(conn, """
        SELECT TOP 5 Seq, COUNT(*) AS Cnt
        FROM File13n
        GROUP BY Seq
        HAVING COUNT(*) > 1
        """);

    Console.WriteLine("\n=== File17n ===");
    await RunQuery(conn, "SELECT * FROM File17n");

    Console.WriteLine("\n=== File11n (عينة) ===");
    await RunQuery(conn, "SELECT TOP 5 * FROM File11n ORDER BY Seq DESC");

    // عدادات محتملة في جداول أخرى
    foreach (var sql in new[]
    {
        "SELECT TOP 3 Seq, Num, Name1, Dest, SubCount, Father FROM File13n ORDER BY Seq DESC",
        "SELECT Seq, Num, Name1, Dest, SubCount FROM File13n WHERE Num = '840'",
        "SELECT COUNT(*) AS DupNum FROM (SELECT Num FROM File13n WHERE Num <> '' GROUP BY Num HAVING COUNT(*) > 1) x",
        "SELECT TOP 5 Num, COUNT(*) AS Cnt FROM File13n WHERE Num <> '' GROUP BY Num HAVING COUNT(*) > 1",
    })
    {
        Console.WriteLine($"\n=== {sql} ===");
        try { await RunQuery(conn, sql); } catch (Exception ex) { Console.WriteLine(ex.Message.Split('\n')[0]); }
    }

    // File17n قد يحتوي عداد Seq — اكتشاف الأعمدة
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT TOP 0 * FROM File17n";
        await using var r = await cmd.ExecuteReaderAsync();
        var cols = Enumerable.Range(0, r.FieldCount).Select(r.GetName).ToList();
        Console.WriteLine("\nFile17n columns: " + string.Join(", ", cols));
    }
    catch (Exception ex) { Console.WriteLine("File17n cols: " + ex.Message); }
}

static async Task FixManualAddAsync(DbConnection conn, bool apply)
{
    const int folderSeq = 91593;
    var maxSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n");
    var missingBc = await ScalarIntAsync(conn, $"""
        SELECT COUNT(*) FROM File13n m
        WHERE m.Father = {folderSeq}
        AND m.Barcode <> ''
        AND NOT EXISTS (SELECT 1 FROM File13BC bc WHERE bc.BarCode = m.Barcode)
        """);
    var badStock = await ScalarIntAsync(conn, $"""
        SELECT COUNT(*) FROM File13n
        WHERE Father = {folderSeq}
        AND (InTot <> 0 OR CurTot1 <> 0 OR PurchaseTot <> 0)
        """);

    Console.WriteLine("=== تشخيص إضافة المواد اليدوية ===");
    Console.WriteLine($"MAX(Seq) File13n = {maxSeq} → العداد يجب أن يكون {maxSeq + 1}");
    Console.WriteLine($"File13BC ناقص لمواد 840: {missingBc}");
    Console.WriteLine($"مواد 840 بحقول مخزون غير صفرية: {badStock}");

    if (!apply)
    {
        Console.WriteLine("\nDRY RUN — نفّذ: fix-manual-add apply");
        return;
    }

    await ResetFile13nAutoIncAsync(conn, apply: true);
    var bcAdded = await SyncFile13BcAsync(conn, folderSeq);
    var stockFixed = await ZeroStockFields840Async(conn, folderSeq);

    Console.WriteLine($"\n✓ تم الإصلاح — autoinc={maxSeq + 1}, File13BC+={bcAdded}, مخزون={stockFixed}");
    Console.WriteLine("أغلق Edari تماماً وأعد فتحه — ثم جرّب إضافة مادة يدوياً");
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

static async Task ResetFile13nAutoIncAsync(DbConnection conn, bool apply)
{
    var maxSeq = await ScalarIntAsync(conn, "SELECT MAX(Seq) FROM File13n");
    var target = maxSeq + 1;
    if (!apply)
    {
        Console.WriteLine($"DRY RUN autoinc → {target}");
        return;
    }

    var port = GetNxAdminPort();
    var url = $"http://127.0.0.1:{port}/edari-account-maint.nxscript?alias=2025&key=shorja-maintenance&table=File13n&autoinc={target}";
    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    var body = await http.GetStringAsync(url);
    Console.WriteLine($"MatSeqT (File13n autoinc) → {target}: {body.Trim()}");
    if (!body.Contains("\"ok\":true", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException($"فشل ضبط عداد المواد: {body.Trim()}");
}

static async Task<int> SyncFile13BcAsync(DbConnection conn, int folderSeq)
{
    var toAdd = new List<(int Seq, string Barcode)>();
    await using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = $"SELECT Seq, Barcode FROM File13n WHERE Father = {folderSeq} AND Barcode <> '' ORDER BY Seq";
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            toAdd.Add((Convert.ToInt32(r.GetValue(0)), ValStr(r, 1)));
    }

    var added = 0;
    foreach (var (seq, barcode) in toAdd)
    {
        var has = await ScalarIntAsync(conn, $"SELECT COUNT(*) FROM File13BC WHERE BarCode = '{Esc(barcode)}'");
        if (has > 0) continue;
        await using var ins = conn.CreateCommand();
        ins.CommandText = $"INSERT INTO File13BC (EdNum, BarCode, Qty, NoDscnt) VALUES ({seq}, '{Esc(barcode)}', 1, False)";
        try
        {
            await ins.ExecuteNonQueryAsync();
            added++;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WARN File13BC {barcode}: {ex.Message.Split('\n')[0]}");
        }
    }

    Console.WriteLine($"✓ File13BC: أُضيف {added} باركود");
    return added;
}

static async Task<int> ZeroStockFields840Async(DbConnection conn, int folderSeq)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"""
        UPDATE File13n SET
            InTot = 0, OutTot = 0, Tot1 = 0, Tot2 = 0, Tot3 = 0,
            CurTot1 = 0, CurTot2 = 0, CurTot3 = 0,
            InAm = 0, OutAm = 0, PurchaseTot = 0, PurchaseAm = 0,
            SalesTot = 0, SalesAm = 0, InBooked = 0, OutBooked = 0,
            Avrg = 0, Top = 0, Last = 0, CurAvrg = 0
        WHERE Father = {folderSeq}
        AND (InTot <> 0 OR CurTot1 <> 0 OR PurchaseTot <> 0 OR Tot1 <> 0)
        """;
    var n = await cmd.ExecuteNonQueryAsync();
    Console.WriteLine($"✓ حقول مخزون: {n} مادة");
    return n;
}

static async Task ShowTemplateAsync(DbConnection conn, int seq)
{
    var columns = await GetColumnNamesAsync(conn);
    var row = await ReadRowAsync(conn, "File13n", seq, columns);
    Console.WriteLine($"Template Seq={seq}, columns={row.Count}");
    foreach (var kv in row.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
    {
        if (kv.Value is byte[]) continue;
        var display = kv.Value is string s ? s.Trim() : kv.Value;
        if (display is null) continue;
        if (display.ToString()!.Length > 120) display = display.ToString()![..120] + "...";
        Console.WriteLine($"  {kv.Key} = {display}");
    }
}

static async Task<List<string>> GetColumnNamesAsync(DbConnection conn, string table = "File13n")
{
    var list = new List<string>();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT TOP 0 * FROM {table}";
    await using var r = await cmd.ExecuteReaderAsync();
    for (var i = 0; i < r.FieldCount; i++)
        list.Add(r.GetName(i));
    return list;
}

static async Task<List<string>> GetColumnNamesFile13Async(DbConnection conn) =>
    await GetColumnNamesAsync(conn, "File13n");

static async Task<Dictionary<string, object?>> ReadRowAsync(DbConnection conn, string table, int seq, List<string> columns)
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

static string FormatValue(object? v)
{
    if (v is null) return "NULL";
    return v switch
    {
        string s => $"'{s.Replace("'", "''")}'",
        bool b => b ? "1" : "0",
        byte or sbyte or short or ushort or int or uint or long or ulong =>
            Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)!,
        float or double or decimal =>
            Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)!,
        DateTime dt => $"'{dt:yyyy-MM-dd HH:mm:ss}'",
        _ => $"'{v}'"
    };
}

static async Task<int> ScalarIntAsync(DbConnection conn, string sql)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    var v = await cmd.ExecuteScalarAsync();
    return v is null or DBNull ? 0 : Convert.ToInt32(v);
}

static async Task RunQuery(DbConnection conn, string sql)
{
    Console.WriteLine("\n=== " + sql.Split('\n')[0].Trim() + " ===");
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 120;
        await using var r = await cmd.ExecuteReaderAsync();
        var cols = Enumerable.Range(0, r.FieldCount).Select(r.GetName);
        Console.WriteLine(string.Join(" | ", cols));
        while (await r.ReadAsync())
        {
            var vals = Enumerable.Range(0, r.FieldCount)
                .Select(i => r.IsDBNull(i) ? "NULL" : r.GetValue(i)?.ToString()?.Trim());
            Console.WriteLine(string.Join(" | ", vals));
        }
    }
    catch (Exception ex) { Console.WriteLine("ERR: " + ex.Message); }
}

sealed record ImportRow(string Ean, string Company, string ProductName, string FullName);

sealed record ExcelParseReport(
    List<ImportRow> Rows,
    int TotalProductLines,
    int DuplicateLines,
    int NoEanSamples,
    int InvalidRows,
    int LastRow,
    int StartRow);

sealed record ArabicImportRow(string Ean, string ArabicName);
sealed record Edari840FixRow(int Seq, string Num, string Name1, string Name2, string Barcode);
sealed record Edari840Row(int Seq, string Num, string Name1, string Barcode, int Father);
