using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var repair = args.Any(a => string.Equals(a, "--repair", StringComparison.OrdinalIgnoreCase));
var unhide = args.Any(a => string.Equals(a, "--unhide", StringComparison.OrdinalIgnoreCase));
var rebuild = args.Any(a => string.Equals(a, "--rebuild", StringComparison.OrdinalIgnoreCase));
var dump = args.Any(a => string.Equals(a, "--dump", StringComparison.OrdinalIgnoreCase));
var input = ResolvePath(args, repair ? "--repair" : null)
    ?? @"C:\Users\Future of Technology\Desktop\تعديل اسعار منتجات الفرنسيه.xlsx";
if (!File.Exists(input))
    throw new FileNotFoundException(input);

if (dump)
{
    using var wb = new XLWorkbook(input);
    var ws = wb.Worksheet(1);
    var last = ws.LastRowUsed()?.RowNumber() ?? 1;
    for (var r = 2; r <= last; r++)
        Console.WriteLine(ws.Cell(r, 2).GetString());
    return;
}

if (rebuild)
{
    RebuildClean(input);
    return;
}

if (unhide)
{
    UnhideAll(input);
    return;
}

if (repair)
{
    await RepairAndSortAsync(input);
    return;
}

var output = ResolveOutputPath(args, input);
await SortPreserveColumnsAsync(input, output);

static string? ResolvePath(string[] args, string? skipFlag)
{
    foreach (var a in args)
    {
        if (a.StartsWith("--", StringComparison.Ordinal)) continue;
        if (skipFlag != null && string.Equals(a, skipFlag, StringComparison.OrdinalIgnoreCase)) continue;
        var p = a.Trim('"', '\'');
        if (File.Exists(p)) return Path.GetFullPath(p);
    }
    return null;
}

static string ResolveOutputPath(string[] args, string input)
{
    var paths = args.Where(a => !a.StartsWith("--", StringComparison.Ordinal))
        .Select(a => Path.GetFullPath(a.Trim('"', '\'')))
        .Where(File.Exists)
        .ToList();
    if (paths.Count >= 2) return paths[1];
    return input;
}

static void RebuildClean(string input)
{
    using var src = new XLWorkbook(input);
    var from = src.Worksheet(1);
    var lastRow = from.LastRowUsed()?.RowNumber() ?? 1;
    var lastCol = Math.Max(from.LastColumnUsed()?.ColumnNumber() ?? 1, 9);

    var headers = new List<string>();
    for (var c = 1; c <= lastCol; c++)
    {
        var h = from.Cell(1, c).GetFormattedString().Trim();
        if (!string.IsNullOrEmpty(h)) headers.Add(h);
    }
    if (headers.Count == 0)
        headers.AddRange(["رقم المادة", "اسم المادة", "تكلفه", "بيع", "ربح", "سعر 4", "سعر 5", "سعر 6", "النوع"]);

    var body = new List<List<string>>();
    var typeCol = headers.FindIndex(h => h.Contains("النوع", StringComparison.Ordinal));
    for (var r = 2; r <= lastRow; r++)
    {
        var name = from.Cell(r, 2).GetFormattedString().Trim();
        var id = from.Cell(r, 1).GetFormattedString().Trim();
        if (string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(id)) continue;
        var cells = new List<string>();
        for (var c = 1; c <= headers.Count; c++)
            cells.Add(from.Cell(r, c).GetFormattedString().Trim());
        if (typeCol >= 0 && typeCol < cells.Count)
            cells[typeCol] = ClassifyType(name);
        body.Add(cells);
    }

    body = body
        .OrderBy(cells => TypeSortKey(typeCol >= 0 && typeCol < cells.Count ? cells[typeCol] : ClassifyType(cells.ElementAtOrDefault(1) ?? "")))
        .ThenBy(cells => SizeMl(cells.ElementAtOrDefault(1) ?? ""))
        .ThenBy(cells => cells.ElementAtOrDefault(1) ?? "", StringComparer.Create(new CultureInfo("ar-IQ"), false))
        .ToList();

    if (headers.All(h => !h.Contains("حجم", StringComparison.Ordinal)))
    {
        headers.Insert(2, "الحجم");
        foreach (var cells in body)
            cells.Insert(2, FormatSize(SizeMl(cells.ElementAtOrDefault(1) ?? ""), cells.ElementAtOrDefault(1) ?? ""));
    }

    using var wb = new XLWorkbook();
    var ws = wb.AddWorksheet("الاسعار");
    ws.RightToLeft = true;
    ws.Style.Font.FontName = "Arial";
    ws.Style.Font.FontSize = 12;
    ws.Style.Font.FontColor = XLColor.Black;

    for (var c = 0; c < headers.Count; c++)
    {
        var cell = ws.Cell(1, c + 1);
        cell.Value = headers[c];
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontColor = XLColor.White;
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3A5F");
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    }

    for (var i = 0; i < body.Count; i++)
    {
        var row = body[i];
        for (var c = 0; c < headers.Count; c++)
        {
            var value = c < row.Count ? row[c] : "";
            var cell = ws.Cell(i + 2, c + 1);
            if (c == 1 || c == headers.Count - 1 || value.Any(char.IsLetter))
            {
                cell.Value = value;
                if (c == 0 && Regex.IsMatch(value, @"^\d{8,}$"))
                    cell.Style.NumberFormat.Format = "@";
            }
            else if (double.TryParse(value.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var n))
                cell.Value = n;
            else
                cell.Value = value;
            cell.Style.Font.FontColor = XLColor.Black;
            cell.Style.Font.FontSize = 12;
            if (i % 2 == 1)
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F8FAFC");
        }
        ws.Row(i + 2).Height = 20;
    }

    ws.Row(1).Height = 22;
    ws.SheetView.ZoomScale = 110;
    ws.ActiveCell = ws.Cell(1, 1);
    ws.Columns(1, headers.Count).AdjustToContents(1, Math.Min(body.Count + 1, 160));
    ws.Column(2).Width = Math.Max(ws.Column(2).Width, 55);

    var outPath = input;
    try
    {
        wb.SaveAs(outPath);
    }
    catch (IOException)
    {
        outPath = Path.Combine(Path.GetDirectoryName(input)!,
            Path.GetFileNameWithoutExtension(input) + "-كامل.xlsx");
        wb.SaveAs(outPath);
    }

    Console.WriteLine($"صفوف ظاهرة: {body.Count}");
    Console.WriteLine($"أول مادة: {body.FirstOrDefault()?.ElementAtOrDefault(1)}");
    Console.WriteLine($"مادة الصف 105: {body.ElementAtOrDefault(103)?.ElementAtOrDefault(1)}");
    Console.WriteLine(outPath);
}

static void UnhideAll(string input)
{
    using var wb = new XLWorkbook(input);
    var ws = wb.Worksheet(1);
    var last = Math.Max(ws.LastRowUsed()?.RowNumber() ?? 1, 200);
    var hidden = 0;
    for (var r = 1; r <= last + 20; r++)
    {
        var row = ws.Row(r);
        if (row.IsHidden || row.Height < 1)
        {
            hidden++;
            row.Unhide();
            row.Height = 18;
        }
    }
    ws.Columns().Unhide();
    if (ws.AutoFilter.IsEnabled)
        ws.AutoFilter.Clear();
    ws.SheetView.FreezeRows(1);
    ws.SheetView.ZoomScale = 100;
    ws.ActiveCell = ws.Cell(2, 1);
    try
    {
        wb.SaveAs(input);
        ResetViewport(input);
        Console.WriteLine($"صفوف كانت مخفية أو بارتفاع صفر: {hidden}");
        Console.WriteLine($"آخر صف فيه بيانات: {ws.LastRowUsed()?.RowNumber()}");
        Console.WriteLine(input);
    }
    catch (IOException)
    {
        var alt = Path.Combine(Path.GetDirectoryName(input)!,
            Path.GetFileNameWithoutExtension(input) + "-ظاهر.xlsx");
        wb.SaveAs(alt);
        Console.WriteLine($"الملف مفتوح — حُفظ: {alt}");
    }
}

static void ResetViewport(string path)
{
    var tmp = path + ".tmp";
    if (File.Exists(tmp)) File.Delete(tmp);
    File.Copy(path, tmp, overwrite: true);
    using (var zip = ZipFile.Open(tmp, ZipArchiveMode.Update))
    {
        var entry = zip.GetEntry("xl/worksheets/sheet1.xml")
            ?? throw new InvalidOperationException("sheet1.xml غير موجود");
        string xml;
        using (var reader = new StreamReader(entry.Open()))
            xml = reader.ReadToEnd();
        xml = Regex.Replace(xml, @"topLeftCell=""A\d+""", "topLeftCell=\"A1\"");
        xml = Regex.Replace(xml, @"activeCell=""[A-Z]+\d+""", "activeCell=\"A2\"");
        xml = Regex.Replace(xml, @"sqref=""[A-Z]+\d+""", "sqref=\"A2\"");
        entry.Delete();
        var neu = zip.CreateEntry("xl/worksheets/sheet1.xml", CompressionLevel.Optimal);
        using var writer = new StreamWriter(neu.Open());
        writer.Write(xml);
    }
    File.Copy(tmp, path, overwrite: true);
    File.Delete(tmp);
}

static async Task RepairAndSortAsync(string input)
{
    using var wb = new XLWorkbook(input);
    var ws = wb.Worksheet(1);
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
    var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 1;

    var parsed = new List<ParsedRow>();
    for (var r = 2; r <= lastRow; r++)
    {
        var cells = new List<string>();
        var any = false;
        for (var c = 1; c <= lastCol; c++)
        {
            var t = CellText(ws.Cell(r, c));
            if (!string.IsNullOrWhiteSpace(t)) any = true;
            cells.Add(t);
        }
        if (!any) continue;
        parsed.Add(ParseFlexibleRow(cells));
    }

    parsed = parsed
        .OrderBy(p => TypeSortKey(p.Type))
        .ThenBy(p => p.Name, StringComparer.Create(new CultureInfo("ar-IQ"), false))
        .ToList();

    var priceCols = Math.Max(5, parsed.Max(p => p.Prices.Count));
    var headers = BuildHeaders(priceCols);

    var backup = Path.Combine(
        Path.GetDirectoryName(input)!,
        Path.GetFileNameWithoutExtension(input) + "-نسخة-قبل-الإصلاح.xlsx");
    if (!File.Exists(backup))
        File.Copy(input, backup, overwrite: false);

    ws.Clear(XLClearOptions.Contents);
    ws.RightToLeft = true;
    WriteHeader(ws, headers);

    for (var i = 0; i < parsed.Count; i++)
    {
        var p = parsed[i];
        var row = i + 2;
        WriteCell(ws.Cell(row, 1), p.Id, forceText: LooksLikeId(p.Id));
        WriteCell(ws.Cell(row, 2), p.Name, forceText: true);
        for (var j = 0; j < priceCols; j++)
        {
            var val = j < p.Prices.Count ? p.Prices[j] : "";
            WriteCell(ws.Cell(row, 3 + j), val, forceText: false);
        }
        ws.Cell(row, headers.Count).Value = p.Type;
    }

    StyleSheet(ws, headers.Count, parsed.Count);
    await SaveAsync(wb, input, "تم إصلاح الملف وترتيبه حسب النوع");
    Console.WriteLine($"نسخة احتياطية: {backup}");
    Console.WriteLine($"صفوف: {parsed.Count}");
}

static async Task SortPreserveColumnsAsync(string input, string output)
{
    using var wb = new XLWorkbook(input);
    var ws = wb.Worksheet(1);
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
    var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 1;

    var header = ReadHeader(ws, lastCol);
    var (idCol, nameCol, typeCol, priceStart) = MapColumns(header);

    var rows = new List<ParsedRow>();
    for (var r = 2; r <= lastRow; r++)
    {
        var cells = new List<string>();
        var any = false;
        for (var c = 1; c <= lastCol; c++)
        {
            var t = CellText(ws.Cell(r, c));
            if (!string.IsNullOrWhiteSpace(t)) any = true;
            cells.Add(t);
        }
        if (!any) continue;

        var id = idCol >= 0 && idCol < cells.Count ? cells[idCol] : cells[0];
        var name = nameCol >= 0 && nameCol < cells.Count ? cells[nameCol] : cells.ElementAtOrDefault(1) ?? "";
        var type = typeCol >= 0 && typeCol < cells.Count && !string.IsNullOrWhiteSpace(cells[typeCol])
            ? cells[typeCol]
            : ClassifyType(name);
        var prices = new List<string>();
        for (var c = priceStart; c < cells.Count; c++)
        {
            if (c == typeCol) continue;
            prices.Add(cells[c]);
        }
        rows.Add(new ParsedRow(id, name, type, prices));
    }

    rows = rows
        .OrderBy(x => TypeSortKey(x.Type))
        .ThenBy(x => x.Name, StringComparer.Create(new CultureInfo("ar-IQ"), false))
        .ToList();

    var priceCols = Math.Max(5, rows.Max(r => r.Prices.Count));
    var headers = BuildHeaders(priceCols);
    ws.Clear(XLClearOptions.Contents);
    ws.RightToLeft = true;
    WriteHeader(ws, headers);

    for (var i = 0; i < rows.Count; i++)
    {
        var p = rows[i];
        var row = i + 2;
        WriteCell(ws.Cell(row, 1), p.Id, forceText: LooksLikeId(p.Id));
        WriteCell(ws.Cell(row, 2), p.Name, forceText: true);
        for (var j = 0; j < priceCols; j++)
            WriteCell(ws.Cell(row, 3 + j), j < p.Prices.Count ? p.Prices[j] : "");
        ws.Cell(row, headers.Count).Value = p.Type;
    }

    StyleSheet(ws, headers.Count, rows.Count);
    await SaveAsync(wb, output, $"تم الترتيب: {rows.Count} صف");
}

static ParsedRow ParseFlexibleRow(List<string> cells)
{
    // Layout after bad sort: رقم | النوع | اسم | أسعار...
    if (cells.Count >= 4
        && LooksLikeType(cells[1])
        && (cells[2].StartsWith("EV ", StringComparison.Ordinal) || cells[2].Length > 12))
        return new ParsedRow(cells[0], cells[2], cells[1], cells.Skip(3).ToList());

    // Original layout: رقم | اسم | أسعار...
    if (cells.Count >= 2 && cells[1].StartsWith("EV ", StringComparison.Ordinal))
        return new ParsedRow(cells[0], cells[1], ClassifyType(cells[1]), cells.Skip(2).ToList());

    if (cells.Count >= 3 && LooksLikeType(cells[1]))
        return new ParsedRow(cells[0], cells[2], cells[1], cells.Skip(3).ToList());

    return new ParsedRow(cells.ElementAtOrDefault(0) ?? "", cells.ElementAtOrDefault(1) ?? "", "أخرى", cells.Skip(2).ToList());
}

static List<string> BuildHeaders(int priceCols)
{
    var h = new List<string> { "رقم المادة", "اسم المادة" };
    var priceNames = new[] { "تكلفه", "بيع", "ربح", "سعر 4", "سعر 5", "سعر 6", "سعر 7", "سعر 8" };
    for (var i = 0; i < priceCols; i++)
        h.Add(i < priceNames.Length ? priceNames[i] : $"سعر {i + 1}");
    h.Add("النوع");
    return h;
}

static void WriteHeader(IXLWorksheet ws, List<string> headers)
{
    for (var c = 0; c < headers.Count; c++)
        ws.Cell(1, c + 1).Value = headers[c];
}

static void StyleSheet(IXLWorksheet ws, int colCount, int rowCount)
{
    ws.SheetView.FreezeRows(1);
    ws.Range(1, 1, 1, colCount).Style.Font.Bold = true;
    ws.Range(1, 1, 1, colCount).Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3A5F");
    ws.Range(1, 1, 1, colCount).Style.Font.FontColor = XLColor.White;
    ws.Columns(1, colCount).AdjustToContents(1, Math.Min(rowCount + 1, 250));
}

static List<string> ReadHeader(IXLWorksheet ws, int lastCol)
{
    var header = new List<string>();
    for (var c = 1; c <= lastCol; c++)
        header.Add(ws.Cell(1, c).GetFormattedString().Trim());
    return header;
}

static (int IdCol, int NameCol, int TypeCol, int PriceStart) MapColumns(List<string> header)
{
    var idCol = header.FindIndex(h => h.Contains("رقم", StringComparison.Ordinal));
    var nameCol = header.FindIndex(h => string.Equals(h, "اسم المادة", StringComparison.OrdinalIgnoreCase));
    if (nameCol < 0)
        nameCol = header.FindIndex(h => h.Contains("اسم", StringComparison.Ordinal) && !h.Contains("رقم", StringComparison.Ordinal));
    var typeCol = header.FindIndex(h => h.Contains("النوع", StringComparison.Ordinal));
    var priceStart = 2;
    if (nameCol >= 0) priceStart = nameCol + 1;
    else if (idCol >= 0) priceStart = idCol + 1;
    return (idCol, nameCol, typeCol, priceStart);
}

static async Task SaveAsync(XLWorkbook wb, string path, string message)
{
    try
    {
        wb.SaveAs(path);
        Console.WriteLine($"{message}: {path}");
    }
    catch (IOException)
    {
        var alt = Path.Combine(
            Path.GetDirectoryName(path)!,
            Path.GetFileNameWithoutExtension(path) + $"-مصلح-{DateTime.Now:HHmm}.xlsx");
        wb.SaveAs(alt);
        Console.WriteLine($"{message} (ملف مفتوح — نسخة بديلة): {alt}");
    }
    await Task.CompletedTask;
}

static bool LooksLikeType(string s)
{
    var t = s.Trim();
    if (string.IsNullOrEmpty(t)) return false;
    if (LooksLikeId(t)) return false;
    if (t.StartsWith("EV ", StringComparison.Ordinal)) return false;
    if (double.TryParse(t.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out _))
        return false;
    return t.Length <= 28 && !t.Contains('—');
}

static bool LooksLikeId(string s)
{
    var t = s.Trim().Replace(",", "");
    if (Regex.IsMatch(t, @"^\d{4,}$")) return true;
    return double.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var n) && n > 100;
}

static string FormatSize(int ml, string name)
{
    if (ml >= 999999) return "";
    if (name.Contains("منديل", StringComparison.Ordinal))
        return $"{ml - 100000} منديل";
    if (name.Contains("قطعة", StringComparison.Ordinal))
        return $"{ml - 100000} قطعة";
    if (name.Contains("جم", StringComparison.Ordinal) && !name.Contains("مل", StringComparison.Ordinal))
        return $"{ml} جم";
    return ml switch
    {
        1000 => "1 لتر",
        2000 => "2 لتر",
        _ => $"{ml} مل",
    };
}

static int SizeMl(string name)
{
    var n = name.Replace("ـ", "").Trim();
    var liter = Regex.Match(n, @"(\d+(?:[.,]\d+)?)\s*لتر", RegexOptions.IgnoreCase);
    if (liter.Success && double.TryParse(liter.Groups[1].Value.Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out var liters))
        return (int)Math.Round(liters * 1000);

    var ml = Regex.Match(n, @"(\d+(?:[.,]\d+)?)\s*(?:مل|جم|جرام|ml|ML|g|G)\b", RegexOptions.IgnoreCase);
    if (!ml.Success)
        ml = Regex.Match(n, @"(\d+(?:[.,]\d+)?)\s*ml", RegexOptions.IgnoreCase);
    if (ml.Success && double.TryParse(ml.Groups[1].Value.Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out var amount))
        return (int)Math.Round(amount);

    var pcs = Regex.Match(n, @"(\d+)\s*(?:قطعة|منديل)");
    if (pcs.Success && int.TryParse(pcs.Groups[1].Value, out var count))
        return 100000 + count;

    return 999999;
}

static string ClassifyType(string name)
{
    var n = name.Trim();
    if (string.IsNullOrEmpty(n)) return "أخرى";

    (string key, string label)[] rules =
    [
        ("Baume Levres", "مرطب شفاه"),
        ("قناع شعر", "قناع شعر"),
        ("قناع وجه", "قناع وجه"),
        ("قناع تنظيف", "قناع وجه"),
        ("ماسك ليلي", "قناع وجه"),
        ("شامبو", "شامبو"),
        ("بلسم", "بلسم"),
        ("علاج أطراف", "علاج شعر"),
        ("سيروم شعر", "سيروم شعر"),
        ("سيروم", "سيروم وجه"),
        ("جل استحام", "جل استحام"),
        ("لوشن", "لوشن"),
        ("كريم يدين", "كريم يدين"),
        ("كريم لليدين", "كريم يدين"),
        ("كريم إزالة", "مزيل شعر"),
        ("كريم نهاري", "كريم وجه"),
        ("كريم وجه", "كريم وجه"),
        ("كريم مات", "كريم وجه"),
        ("كريم مركّز", "كريم وجه"),
        ("كريم", "كريم"),
        ("ماء ميسيلار", "ماء ميسيلار"),
        ("محلول ميسيلار", "ماء ميسيلار"),
        ("مزيل عرق", "مزيل عرق"),
        ("مزيل طلاء", "مزيل طلاء"),
        ("مقشر جسم", "مقشر جسم"),
        ("مقشر وجه", "مقشر وجه"),
        ("جل تنظيف مقشر", "مقشر وجه"),
        ("زيت شعر", "زيت شعر"),
        ("زيت", "زيت"),
        ("رغوة تصفيف", "رغوة شعر"),
        ("رغوة تنظيف", "رغوة وجه"),
        ("بخاخ فك", "بخاخ شعر"),
        ("بخاخ للشعر", "بخاخ"),
        ("بخاخ", "بخاخ"),
        ("مثبت شعر", "مثبت شعر"),
        ("مناديل", "مناديل"),
        ("شرائط شمع", "شمع"),
        ("حليب تنظيف", "حليب تنظيف"),
        ("جل تنظيف", "جل تنظيف"),
        ("مرطب", "مرطب"),
    ];

    foreach (var (key, label) in rules)
        if (n.Contains(key, StringComparison.OrdinalIgnoreCase))
            return label;

    return "أخرى";
}

static int TypeSortKey(string type) => type switch
{
    "شامبو" => 10,
    "بلسم" => 20,
    "قناع شعر" => 30,
    "علاج شعر" => 40,
    "سيروم شعر" => 50,
    "زيت شعر" => 60,
    "بخاخ شعر" => 70,
    "رغوة شعر" => 80,
    "مثبت شعر" => 90,
    "جل استحام" => 110,
    "لوشن" => 120,
    "مقشر جسم" => 130,
    "كريم يدين" => 140,
    "مزيل عرق" => 150,
    "مزيل شعر" => 160,
    "زيت" => 170,
    "جل تنظيف" => 200,
    "رغوة وجه" => 210,
    "ماء ميسيلار" => 220,
    "سيروم وجه" => 230,
    "كريم وجه" => 240,
    "مقشر وجه" => 250,
    "قناع وجه" => 260,
    "مرطب" => 270,
    "بخاخ" => 280,
    "كريم" => 290,
    "حليب تنظيف" => 300,
    "مرطب شفاه" => 310,
    "مناديل" => 320,
    "مزيل طلاء" => 330,
    "شمع" => 340,
    _ => 900,
};

static string CellText(IXLCell cell)
{
    if (cell.IsEmpty()) return "";
    if (cell.DataType == XLDataType.Number)
        return cell.GetDouble().ToString(CultureInfo.InvariantCulture);
    return cell.GetFormattedString().Trim();
}

static void WriteCell(IXLCell cell, string value, bool forceText = false)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        cell.Clear();
        return;
    }

    var text = value.Trim();
    if (forceText || ContainsLetters(text) || Regex.IsMatch(text, @"^\d{8,}$"))
    {
        cell.Value = text;
        if (Regex.IsMatch(text, @"^\d{8,}$"))
            cell.Style.NumberFormat.Format = "@";
        return;
    }

    var n = ParseNumber(text);
    if (n.HasValue)
    {
        cell.Value = n.Value;
        return;
    }

    cell.Value = text;
}

static bool ContainsLetters(string s) =>
    s.Any(ch => char.IsLetter(ch) || ch is '—' or '–' or '‏');

static double? ParseNumber(string value)
{
    var t = Regex.Replace(value.Trim(), @"[^\d.,\-]", "").Replace(",", "");
    if (string.IsNullOrEmpty(t)) return null;
    if (double.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var n))
        return n;
    return null;
}

sealed record ParsedRow(string Id, string Name, string Type, List<string> Prices);
