using System.Globalization;
using ClosedXML.Excel;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Microsoft.Data.SqlClient;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

const int evoludermFolderSeq = 91593;
const decimal usdRate = 1565m;
const decimal distFactor = 0.80m;
const string logoPath = @"c:\Users\Future of Technology\Documents\pos\tools\output\deema-logo.jpg";
const string sourcePricePath = @"c:\Users\Future of Technology\Documents\pos\tools\output\F26030764_EAN.xlsx";
const string connStr =
    @"Server=localhost\FOTSQLSERVER;Database=HAYAT2025.mdf;Trusted_Connection=True;TrustServerCertificate=True;";

var excludedBarcodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "3760100683790",
    "3760100683820"
};

var outDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "pos", "tools", "output");
Directory.CreateDirectory(outDir);
var desktopSource = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "F26030764_EAN.xlsx");
if (File.Exists(desktopSource) && !File.Exists(sourcePricePath))
    File.Copy(desktopSource, sourcePricePath, true);
var outPath = Path.Combine(outDir, "EVOLUDERM-Price-Catalogue.docx");
var outXlsx = Path.Combine(outDir, "EVOLUDERM-Price-Catalogue.xlsx");
var desktopPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "EVOLUDERM-Price-Catalogue.docx");
var desktopXlsx = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "EVOLUDERM-Price-Catalogue.xlsx");

var sourcePrices = LoadSourcePriceList(sourcePricePath);
var products = await LoadProductsAsync();
var priced = products
    .Where(p => !IsExcludedBarcode(p.Barcode, excludedBarcodes))
    .Where(p => !IsZeroInSource(sourcePrices, p.Barcode))
    .Where(p => p.WholesaleIqd > 0 && p.ConsumerIqd > 0)
    .Select(p => new PricedProduct(
        p.Barcode,
        p.EnglishName,
        RoundUsd(ToUsd(p.WholesaleIqd * distFactor)),
        RoundUsd(ToUsd(p.ConsumerIqd))))
    .OrderBy(p => p.EnglishName, StringComparer.OrdinalIgnoreCase)
    .ToList();

var zeroInSource = products.Where(p => IsZeroInSource(sourcePrices, p.Barcode)).ToList();
var zeroInEdari = products.Where(p =>
    !IsExcludedBarcode(p.Barcode, excludedBarcodes) &&
    !IsZeroInSource(sourcePrices, p.Barcode) && (p.WholesaleIqd <= 0 || p.ConsumerIqd <= 0)).ToList();
var manuallyExcluded = products.Where(p => IsExcludedBarcode(p.Barcode, excludedBarcodes)).ToList();

Console.WriteLine($"Source file: {sourcePrices.Count} EANs loaded");
Console.WriteLine($"Excluded — manual barcodes: {manuallyExcluded.Count}");
Console.WriteLine($"Excluded — zero price in source: {zeroInSource.Count}");
Console.WriteLine($"Excluded — zero price in Edari: {zeroInEdari.Count}");
Console.WriteLine($"Included in catalogue: {priced.Count}");
LogExcluded("Manually excluded", manuallyExcluded);
LogExcluded("Zero in source file (PU.HT = 0)", zeroInSource);
LogExcluded("Zero in Edari (SellPr1 or SellPr4)", zeroInEdari);

if (priced.Count == 0)
    throw new InvalidOperationException("No products left after filtering. Check source file and database prices.");

var distMin = priced.Min(p => p.DistributionUsd);
var distMax = priced.Max(p => p.DistributionUsd);
var consMin = priced.Min(p => p.ConsumerUsd);
var consMax = priced.Max(p => p.ConsumerUsd);
var generated = DateTime.Now.ToString("dd MMMM yyyy", CultureInfo.InvariantCulture);

using (var doc = WordprocessingDocument.Create(outPath, WordprocessingDocumentType.Document))
{
    var main = doc.AddMainDocumentPart();
    main.Document = new Document(new Body());
    var body = main.Document.Body!;

    EnsureDocumentSettings(main);
    EnsureStyles(main);
    var firstHeaderId = AddFirstPageHeader(main);
    var runningHeaderId = AddRunningHeader(main);
    var firstFooterId = AddFirstPageFooter(main);
    var footerId = AddFooter(main);

    body.Append(LetterheadBlock(main, logoPath));
    body.Append(Spacer(30));
    body.Append(TitleBlock());
    body.Append(Spacer(30));
    body.Append(PriceSummaryBox(priced.Count, distMin, distMax, consMin, consMax));
    body.Append(Spacer(50));
    body.Append(IntroParagraph(priced.Count));
    body.Append(Spacer(60));
    body.Append(SectionHeading("1. Pricing Overview"));
    body.Append(BodyPara(
        "This catalogue presents Deema Al Hayat's recommended price structure for the EVOLUDERM range in Iraq. " +
        "All amounts are quoted in US Dollars (USD) per unit and are intended for your market review and alignment."));
    body.Append(Spacer(40));
    body.Append(OverviewTable());
    body.Append(Spacer(60));
    body.Append(PageBreak());
    body.Append(SectionHeading("2. Product Price List"));
    body.Append(BodyPara($"{priced.Count} SKUs · sorted alphabetically · prices in USD."));
    body.Append(Spacer(30));
    foreach (var chunk in PriceTableChunks(priced))
        body.Append(chunk);
    body.Append(Spacer(60));
    body.Append(SectionHeading("3. Notes"));
    foreach (var note in PriceNotes(generated))
        body.Append(BulletPara(note));
    body.Append(Spacer(80));
    body.Append(ClosingBlock());
    body.Append(BuildSectionProperties(firstHeaderId, runningHeaderId, firstFooterId, footerId));
    main.Document.Save();
}

ExportExcel(outXlsx, priced, distMin, distMax, consMin, consMax, generated);

try { File.Copy(outPath, desktopPath, true); Console.WriteLine($"Desktop Word: {desktopPath}"); }
catch (IOException)
{
    var alt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), $"EVOLUDERM-Price-Catalogue-{DateTime.Now:yyyyMMdd-HHmm}.docx");
    File.Copy(outPath, alt, true);
    Console.WriteLine($"Desktop Word (alt): {alt}");
}

try { File.Copy(outXlsx, desktopXlsx, true); Console.WriteLine($"Desktop Excel: {desktopXlsx}"); }
catch (IOException)
{
    var alt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), $"EVOLUDERM-Price-Catalogue-{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    File.Copy(outXlsx, alt, true);
    Console.WriteLine($"Desktop Excel (alt): {alt}");
}

Console.WriteLine($"Created: {outPath}");
Console.WriteLine($"Created: {outXlsx} ({priced.Count} products)");

static void ExportExcel(string path, List<PricedProduct> priced, decimal distMin, decimal distMax, decimal consMin, decimal consMax, string generated)
{
    using var wb = new XLWorkbook();
    var ws = wb.Worksheets.Add("EVOLUDERM Prices");
    ws.Style.Font.FontName = "Calibri";
    ws.Style.Font.FontSize = 11;

    ws.Cell(1, 1).Value = "Deema Al Hayat Cosmetics Trading Co. LTD.";
    ws.Cell(1, 1).Style.Font.Bold = true;
    ws.Cell(1, 1).Style.Font.FontSize = 14;
    ws.Cell(1, 1).Style.Font.FontColor = XLColor.FromHtml("#0B1220");
    ws.Range(1, 1, 1, 5).Merge();

    ws.Cell(2, 1).Value = "EVOLUDERM — Price Catalogue (Iraq) · USD";
    ws.Cell(2, 1).Style.Font.Bold = true;
    ws.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#0F9F76");
    ws.Range(2, 1, 2, 5).Merge();

    ws.Cell(3, 1).Value = $"Prepared for C2J SARL / EVOLUDERM  ·  {generated}";
    ws.Cell(3, 1).Style.Font.FontColor = XLColor.FromHtml("#64748B");
    ws.Range(3, 1, 3, 5).Merge();

    ws.Cell(5, 1).Value = "SKUs"; ws.Cell(5, 2).Value = priced.Count;
    ws.Cell(5, 3).Value = "Distribution"; ws.Cell(5, 4).Value = $"{FmtUsd(distMin)} – {FmtUsd(distMax)}";
    ws.Cell(5, 5).Value = "Consumer"; ws.Cell(6, 4).Value = $"{FmtUsd(consMin)} – {FmtUsd(consMax)}";
    ws.Range(5, 1, 6, 5).Style.Fill.BackgroundColor = XLColor.FromHtml("#F0FDF9");

    var headerRow = 8;
    var headers = new[] { "#", "Barcode", "Product Name", "Distribution (USD)", "Consumer (USD)" };
    for (var c = 0; c < headers.Length; c++)
    {
        var cell = ws.Cell(headerRow, c + 1);
        cell.Value = headers[c];
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontColor = XLColor.White;
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#0F9F76");
        cell.Style.Alignment.Horizontal = c >= 3 ? XLAlignmentHorizontalValues.Right : XLAlignmentHorizontalValues.Left;
    }

    for (var i = 0; i < priced.Count; i++)
    {
        var p = priced[i];
        var r = headerRow + 1 + i;
        var fill = i % 2 == 1 ? XLColor.FromHtml("#F8FAFC") : XLColor.White;
        ws.Cell(r, 1).Value = i + 1;
        ws.Cell(r, 2).Value = p.Barcode;
        ws.Cell(r, 2).Style.NumberFormat.Format = "@";
        ws.Cell(r, 3).Value = p.EnglishName;
        ws.Cell(r, 4).Value = (double)p.DistributionUsd;
        ws.Cell(r, 4).Style.NumberFormat.Format = "$#,##0.00";
        ws.Cell(r, 4).Style.Font.FontColor = XLColor.FromHtml("#0F9F76");
        ws.Cell(r, 5).Value = (double)p.ConsumerUsd;
        ws.Cell(r, 5).Style.NumberFormat.Format = "$#,##0.00";
        ws.Cell(r, 5).Style.Font.FontColor = XLColor.FromHtml("#0F9F76");
        ws.Range(r, 1, r, 5).Style.Fill.BackgroundColor = fill;
        ws.Cell(r, 4).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        ws.Cell(r, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
    }

    ws.Columns().AdjustToContents();
    ws.SheetView.FreezeRows(headerRow);
    wb.SaveAs(path);
}

static string SanitizeText(string? text)
{
    if (string.IsNullOrEmpty(text)) return "";
    return new string(text.Where(ch => ch is '\t' or '\n' or '\r' or >= ' ').ToArray());
}

static string NormalizeBarcode(string barcode) => barcode.Trim();

static bool IsExcludedBarcode(string barcode, HashSet<string> excluded) =>
    excluded.Contains(NormalizeBarcode(barcode));

static bool IsZeroInSource(Dictionary<string, decimal> sourcePrices, string barcode)
{
    var key = NormalizeBarcode(barcode);
    return sourcePrices.TryGetValue(key, out var price) && price <= 0m;
}

static void LogExcluded(string reason, List<RawProduct> items)
{
    if (items.Count == 0) return;
    Console.WriteLine($"  {reason}:");
    foreach (var p in items.OrderBy(x => x.Barcode))
        Console.WriteLine($"    {p.Barcode}  {p.EnglishName}");
}

static Dictionary<string, decimal> LoadSourcePriceList(string path)
{
    if (!File.Exists(path))
        throw new FileNotFoundException("Source price file not found.", path);

    using var stream = File.OpenRead(path);
    using var doc = SpreadsheetDocument.Open(stream, false);
    var workbookPart = doc.WorkbookPart ?? throw new InvalidOperationException("Workbook missing.");
    var sheet = workbookPart.Workbook.Sheets?.Elements<DocumentFormat.OpenXml.Spreadsheet.Sheet>().FirstOrDefault()
        ?? throw new InvalidOperationException("Worksheet missing.");
    var worksheetPart = (WorksheetPart)workbookPart.GetPartById(sheet.Id!);
    var sheetData = worksheetPart.Worksheet.Elements<DocumentFormat.OpenXml.Spreadsheet.SheetData>().First();
    var shared = workbookPart.SharedStringTablePart?.SharedStringTable;

    var prices = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
    foreach (var row in sheetData.Elements<DocumentFormat.OpenXml.Spreadsheet.Row>())
    {
        if (row.RowIndex is null || row.RowIndex < 11) continue;
        var ean = GetCellText(row, "D", shared).Trim();
        if (string.IsNullOrWhiteSpace(ean) || ean.Equals("EAN", StringComparison.OrdinalIgnoreCase)) continue;

        var unitPrice = ParseDecimal(GetCellText(row, "K", shared));
        if (unitPrice <= 0)
            unitPrice = ParseDecimal(GetCellText(row, "I", shared));

        var key = NormalizeBarcode(ean);
        prices[key] = unitPrice;
    }

    return prices;
}

static string GetCellText(
    DocumentFormat.OpenXml.Spreadsheet.Row row,
    string column,
    DocumentFormat.OpenXml.Spreadsheet.SharedStringTable? shared)
{
    var cell = row.Elements<DocumentFormat.OpenXml.Spreadsheet.Cell>()
        .FirstOrDefault(c => string.Equals(GetColumnName(c.CellReference?.Value), column, StringComparison.OrdinalIgnoreCase));
    if (cell is null) return "";

    if (cell.DataType?.Value == DocumentFormat.OpenXml.Spreadsheet.CellValues.SharedString && shared is not null)
    {
        if (int.TryParse(cell.CellValue?.InnerText, out var index) && index >= 0 && index < shared.Count())
            return shared.ElementAt(index).InnerText;
    }

    if (cell.DataType?.Value == DocumentFormat.OpenXml.Spreadsheet.CellValues.InlineString)
        return cell.InlineString?.InnerText ?? "";

    return cell.CellValue?.InnerText ?? "";
}

static string? GetColumnName(string? cellRef)
{
    if (string.IsNullOrEmpty(cellRef)) return null;
    return new string(cellRef.TakeWhile(char.IsLetter).ToArray());
}

static decimal ParseDecimal(string text) =>
    decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? value : 0m;

static decimal ToUsd(decimal iqd) => iqd / usdRate;
static decimal RoundUsd(decimal usd) => Math.Round(usd / 0.05m, MidpointRounding.AwayFromZero) * 0.05m;
static string FmtUsd(decimal v) => v.ToString("$0.00", CultureInfo.InvariantCulture);

static async Task<List<RawProduct>> LoadProductsAsync()
{
    var rows = new List<RawProduct>();
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = """
        SELECT
            LTRIM(RTRIM(Barcode)) AS Barcode,
            LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name2))) AS EnglishName,
            CAST(COALESCE(SellPr1, 0) AS DECIMAL(18,0)) AS Wholesale,
            CAST(COALESCE(SellPr4, 0) AS DECIMAL(18,0)) AS Consumer
        FROM articles
        WHERE Father = @folderSeq
          AND COALESCE(Barcode, N'') <> N''
          AND NOT EXISTS (SELECT 1 FROM articles c WHERE c.Father = articles.Seq)
        ORDER BY Name2, Barcode
        """;
    cmd.Parameters.AddWithValue("@folderSeq", evoludermFolderSeq);
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        rows.Add(new RawProduct(
            r.GetString(0),
            r.IsDBNull(1) ? "" : r.GetString(1),
            r.GetDecimal(2),
            r.GetDecimal(3)));
    }
    return rows;
}

static string[] PriceNotes(string date) =>
[
    $"Price list generated on {date}.",
    "All prices are quoted in US Dollars (USD) per unit.",
    "Distribution Price — recommended net price for authorised wholesale and retail partners in Iraq.",
    "Consumer Price — recommended shelf price for end consumers in pharmacies and cosmetics stores.",
    "Amounts are rounded to the nearest USD 0.05 for commercial clarity.",
    "Prices may be reviewed periodically in line with market conditions and logistics costs."
];

static void EnsureDocumentSettings(MainDocumentPart main)
{
    var settingsPart = main.AddNewPart<DocumentSettingsPart>();
    settingsPart.Settings = new Settings(
        new CharacterSpacingControl { Val = CharacterSpacingValues.DoNotCompress },
        new ThemeFontLanguages { Val = "en-US", EastAsia = "en-US", Bidi = "en-US" },
        new UpdateFieldsOnOpen(),
        new Compatibility(
            new CompatibilitySetting { Name = CompatSettingNameValues.CompatibilityMode, Uri = "http://schemas.microsoft.com/office/word", Val = "15" }));
}

static void EnsureStyles(MainDocumentPart main)
{
    if (main.StyleDefinitionsPart != null) return;
    var stylesPart = main.AddNewPart<StyleDefinitionsPart>();
    var ltrPara = new ParagraphProperties(
        new Justification { Val = JustificationValues.Left },
        new WidowControl(),
        new SpacingBetweenLines { After = "80", Line = "276", LineRule = LineSpacingRuleValues.Auto });
    stylesPart.Styles = new Styles(
        new DocDefaults(
            new RunPropertiesDefault(new RunProperties(
                new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri", ComplexScript = "Calibri" },
                new Languages { Val = "en-US", EastAsia = "en-US", Bidi = "en-US" },
                new FontSize { Val = "22" })),
            new ParagraphPropertiesDefault(ltrPara)));
}

static SectionProperties BuildSectionProperties(
    string firstHeaderId, string runningHeaderId, string firstFooterId, string footerId) =>
    new(
        new HeaderReference { Type = HeaderFooterValues.First, Id = firstHeaderId },
        new HeaderReference { Type = HeaderFooterValues.Default, Id = runningHeaderId },
        new FooterReference { Type = HeaderFooterValues.First, Id = firstFooterId },
        new FooterReference { Type = HeaderFooterValues.Default, Id = footerId },
        new PageSize { Width = 11906U, Height = 16838U },
        new PageMargin { Top = 720, Bottom = 960, Left = 1080, Right = 1080, Header = 360, Footer = 280, Gutter = 0 },
        new TitlePage());

static IEnumerable<OpenXmlElement> LtrParaElements(
    JustificationValues align = default,
    bool keepWithNext = false)
{
    if (align == default) align = JustificationValues.Left;
    yield return new Justification { Val = align };
    yield return new WidowControl();
    yield return new SpacingBetweenLines { After = "80", Line = "276", LineRule = LineSpacingRuleValues.Auto };
    if (keepWithNext) yield return new KeepNext();
}

static ParagraphProperties MakeLtrParaProps(JustificationValues align = default, bool keepWithNext = false) =>
    new(LtrParaElements(align, keepWithNext).ToArray());

static ParagraphProperties RtlParaProps() =>
    new(new BiDi(), new Justification { Val = JustificationValues.Right },
        new SpacingBetweenLines { After = "30", Line = "240" });

static Paragraph PageBreak() =>
    new(new ParagraphProperties(new PageBreakBefore()), new Run(new Text("") { Space = SpaceProcessingModeValues.Preserve }));

static string AddFirstPageHeader(MainDocumentPart main)
{
    var headerPart = main.AddNewPart<HeaderPart>("rIdFirstHeader");
    var relId = main.GetIdOfPart(headerPart);
    headerPart.Header = new Header(EmptyHeaderFooterParagraph());
    return relId;
}

static string AddFirstPageFooter(MainDocumentPart main)
{
    var footerPart = main.AddNewPart<FooterPart>("rIdFirstFooter");
    var relId = main.GetIdOfPart(footerPart);
    footerPart.Footer = new Footer(EmptyHeaderFooterParagraph());
    return relId;
}

static string AddRunningHeader(MainDocumentPart main)
{
    var headerPart = main.AddNewPart<HeaderPart>("rIdRunningHeader");
    var relId = main.GetIdOfPart(headerPart);
    headerPart.Header = new Header(RunningHeaderTable());
    return relId;
}

static string AddFooter(MainDocumentPart main)
{
    var footerPart = main.AddNewPart<FooterPart>();
    var relId = main.GetIdOfPart(footerPart);
    footerPart.Footer = new Footer(FooterTable());
    return relId;
}

static Paragraph EmptyHeaderFooterParagraph() => new(
    new ParagraphProperties(new SpacingBetweenLines { Before = "0", After = "0", Line = "240", LineRule = LineSpacingRuleValues.Exact }),
    new Run(new Text("") { Space = SpaceProcessingModeValues.Preserve }));

static Table RunningHeaderTable() => new(
    LtrTableProps(bottomBorder: true),
    new TableGrid(new GridColumn { Width = "6800" }, new GridColumn { Width = "2946" }),
    new TableRow(
        CompactLtrCell("Deema Al Hayat Cosmetics  ·  EVOLUDERM Price Catalogue", false, "64748B", "16", JustificationValues.Left),
        CompactLtrCell("Iraq Market · USD", false, "94A3B8", "16", JustificationValues.Right)));

static Table FooterTable() => new(
    LtrTableProps(topBorder: true),
    new TableGrid(new GridColumn { Width = "3600" }, new GridColumn { Width = "2546" }, new GridColumn { Width = "3600" }),
    new TableRow(
        CompactLtrCell("Deema Al Hayat Cosmetics", false, "64748B", "16", JustificationValues.Left),
        CompactLtrPageCell(),
        CompactLtrCell("Prepared for EVOLUDERM · Internal use only", false, "94A3B8", "16", JustificationValues.Right)));

static Table LetterheadBlock(MainDocumentPart main, string logoPath)
{
    const long logoW = 1280000L;
    const long logoH = 640000L;
    var logoCell = new TableCell(
        ImageParagraph(main, logoPath, logoW, logoH, 9901U),
        new TableCellProperties(
            new TableCellWidth { Width = "1600", Type = TableWidthUnitValues.Dxa },
            new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center },
            new TableCellMargin(new RightMargin { Width = "160", Type = TableWidthUnitValues.Dxa })));
    var infoCell = new TableCell(
        new Paragraph(MakeLtrParaProps(), Run("Deema Al Hayat Cosmetics Trading Co. LTD.", true, "0B1220", "24")),
        new Paragraph(RtlParaProps(), RunArabic("ديما الحياة لتجارة مواد التجميل محدودة المسؤولية", true, "0F9F76", "20")),
        new Paragraph(MakeLtrParaProps(),
            Run("Baghdad — Zayouna 714", false, "64748B", "18"),
            Run("     ", false, "64748B", "18"),
            Run("info@deemaalhayat.com.iq", false, "0F9F76", "18")),
        new TableCellProperties(
            new TableCellWidth { Width = "8400", Type = TableWidthUnitValues.Dxa },
            new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }));
    return new Table(
        NoBorderTableProps(),
        new TableRow(logoCell, infoCell),
        new TableRow(new TableCell(
            new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "120", After = "0" },
                new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 14, Space = 1 })),
                new Run(new Text(" ") { Space = SpaceProcessingModeValues.Preserve })),
            new TableCellProperties(new GridSpan { Val = 2 },
                new TableCellWidth { Width = "5000", Type = TableWidthUnitValues.Pct }))));
}

static Table PriceSummaryBox(int count, decimal distMin, decimal distMax, decimal consMin, decimal consMax) =>
    new(
        new TableProperties(
            new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
            new TableLayout { Type = TableLayoutValues.Fixed },
            new TableJustification { Val = TableRowAlignmentValues.Left },
            new TableBorders(
                new TopBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new LeftBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new RightBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new InsideVerticalBorder { Val = BorderValues.Single, Color = "D1FAE5", Size = 4 })),
        new TableRow(
            StatCell($"{count}", "Total SKUs", "F0FDF9"),
            StatCell($"{FmtUsd(distMin)} – {FmtUsd(distMax)}", "Distribution Range", "F0FDF9"),
            StatCell($"{FmtUsd(consMin)} – {FmtUsd(consMax)}", "Consumer Range", "F0FDF9"),
            StatCell("USD", "Currency", "F0FDF9")));

static Table OverviewTable()
{
    var headers = new[] { "Price Type", "Description", "Audience" };
    var widths = new[] { "2200", "4200", "3346" };
    var rows = new List<TableRow> { HeaderRow(headers, widths) };
    rows.Add(DataRow([
        "Distribution Price",
        "Recommended net unit price for authorised partners supplying pharmacies and cosmetics stores.",
        "Wholesale & retail distributors"
    ], widths, false));
    rows.Add(DataRow([
        "Consumer Price",
        "Recommended shelf price displayed to end consumers at point of sale.",
        "Pharmacies & cosmetics boutiques"
    ], widths, true));
    return WrapTable(rows);
}

static IEnumerable<OpenXmlElement> PriceTableChunks(List<PricedProduct> products)
{
    var headers = new[] { "#", "Barcode", "Product Name", "Distribution (USD)", "Consumer (USD)" };
    var widths = new[] { "400", "1500", "3600", "1700", "1700" };
    const int chunkSize = 50;
    for (var start = 0; start < products.Count; start += chunkSize)
    {
        var rows = new List<TableRow> { HeaderRow(headers, widths, rightAlignFrom: 3) };
        var slice = products.Skip(start).Take(chunkSize).ToList();
        for (var i = 0; i < slice.Count; i++)
            rows.Add(PriceDataRow(start + i + 1, slice[i], widths, i % 2 == 1));
        yield return WrapTable(rows, widths);
        if (start + chunkSize < products.Count)
            yield return Spacer(40);
    }
}

static TableRow PriceDataRow(int num, PricedProduct p, string[] widths, bool shaded)
{
    var fill = shaded ? "F8FAFC" : "FFFFFF";
    var row = new TableRow();
    var texts = new[] { num.ToString(), p.Barcode, p.EnglishName, FmtUsd(p.DistributionUsd), FmtUsd(p.ConsumerUsd) };
    for (var i = 0; i < texts.Length; i++)
    {
        var align = i >= 3 ? JustificationValues.Right : JustificationValues.Left;
        var color = i >= 3 ? "0F9F76" : "1A2332";
        var bold = i >= 3;
        var pgh = new Paragraph(new ParagraphProperties(LtrParaElements(align).Concat([
            new SpacingBetweenLines { Line = "220", After = "0", Before = "0" }
        ]).ToArray()), Run(texts[i], bold, color, "17"));
        row.Append(Cell(pgh, widths[i], false, fill));
    }
    return row;
}

static Paragraph TitleBlock() => new(
    MakeLtrParaProps(JustificationValues.Left),
    Run("EVOLUDERM", true, "0F9F76", "48"),
    new Run(new Break()),
    Run("Price Catalogue — Iraq", true, "0B1220", "36"),
    new Run(new Break()),
    Run("Prepared for C2J SARL / EVOLUDERM", false, "64748B", "20"));

static Paragraph IntroParagraph(int count) => BodyPara(
    "Dear EVOLUDERM Team,\n\n" +
    $"Please find attached our recommended price structure for the EVOLUDERM range in Iraq, covering {count} products.\n\n" +
    "All figures are quoted in US Dollars (USD) per unit. Two price levels are provided for your review:\n\n" +
    "Distribution Price — for authorised wholesale and retail partners supplying our network.\n" +
    "Consumer Price — recommended shelf price for end consumers.\n\n" +
    "We remain at your disposal for any clarification or alignment on market positioning.");

static Paragraph SectionHeading(string text) => new(
    new ParagraphProperties(LtrParaElements(JustificationValues.Left, keepWithNext: true).Concat([
        new SpacingBetweenLines { Before = "100", After = "60" },
        new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 8, Space = 4 })
    ]).ToArray()),
    Run(text, true, "0B1220", "26"));

static Paragraph BodyPara(string text)
{
    var p = new Paragraph(MakeLtrParaProps());
    var lines = text.Split('\n');
    for (var i = 0; i < lines.Length; i++)
    {
        p.Append(Run(lines[i], false, "334155", "21"));
        if (i < lines.Length - 1) p.Append(new Run(new Break()));
    }
    return p;
}

static Paragraph BulletPara(string text) => new(
    new ParagraphProperties(LtrParaElements().Concat([
        new Indentation { Left = "360", Hanging = "180" },
        new SpacingBetweenLines { After = "60" }
    ]).ToArray()),
    Run("•  ", true, "0F9F76", "21"),
    Run(text, false, "334155", "21"));

static Paragraph ClosingBlock()
{
    var p = new Paragraph(new ParagraphProperties(LtrParaElements().Concat([
        new SpacingBetweenLines { Before = "120", After = "0" }
    ]).ToArray()));
    p.Append(Run("Best regards,", false, "334155", "21"));
    p.Append(new Run(new Break()));
    p.Append(new Run(new Break()));
    p.Append(Run("Deema Al Hayat Cosmetics Trading Co. LTD.", true, "0B1220", "24"));
    p.Append(new Run(new Break()));
    p.Append(Run("Baghdad, Zayouna 714  ·  info@deemaalhayat.com.iq", false, "64748B", "20"));
    return p;
}

static Paragraph Spacer(int twips) =>
    new(new ParagraphProperties(new SpacingBetweenLines { After = twips.ToString() }));

static TableProperties LtrTableProps(bool topBorder = false, bool bottomBorder = false) => new(
    new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
    new TableLayout { Type = TableLayoutValues.Fixed },
    new TableJustification { Val = TableRowAlignmentValues.Left },
    new TableBorders(
        new TopBorder { Val = topBorder ? BorderValues.Single : BorderValues.Nil, Color = "E2E8F0", Size = topBorder ? 4U : 0U },
        new BottomBorder { Val = bottomBorder ? BorderValues.Single : BorderValues.Nil, Color = "0F9F76", Size = bottomBorder ? 8U : 0U },
        new LeftBorder { Val = BorderValues.Nil },
        new RightBorder { Val = BorderValues.Nil },
        new InsideHorizontalBorder { Val = BorderValues.Nil },
        new InsideVerticalBorder { Val = BorderValues.Nil }));

static TableProperties NoBorderTableProps() => LtrTableProps();

static TableCell CompactLtrCell(string text, bool bold, string color, string size, JustificationValues align) =>
    new TableCell(
        new Paragraph(new ParagraphProperties(LtrParaElements(align).Concat([
            new SpacingBetweenLines { Before = "40", After = "40", Line = "240", LineRule = LineSpacingRuleValues.Exact }
        ]).ToArray()), Run(text, bold, color, size)),
        new TableCellProperties(new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }));

static TableCell CompactLtrPageCell()
{
    var p = new Paragraph(new ParagraphProperties(LtrParaElements(JustificationValues.Center).Concat([
        new SpacingBetweenLines { Before = "40", After = "40", Line = "240", LineRule = LineSpacingRuleValues.Exact }
    ]).ToArray()));
    p.Append(Run("Page ", false, "94A3B8", "16"));
    p.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
    p.Append(new Run(new FieldCode(" PAGE ") { Space = SpaceProcessingModeValues.Preserve }));
    p.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
    p.Append(new Run(new RunProperties(new FontSize { Val = "16" }, new Color { Val = "94A3B8" }),
        new Text("1") { Space = SpaceProcessingModeValues.Preserve }));
    p.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
    return new TableCell(p, new TableCellProperties(new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }));
}

static TableCell StatCell(string value, string label, string fill) => new(
    new Paragraph(new ParagraphProperties(LtrParaElements(JustificationValues.Center).Concat([
        new SpacingBetweenLines { Before = "80", After = "40" }
    ]).ToArray()), Run(value, true, "0F9F76", "28")),
    new Paragraph(new ParagraphProperties(LtrParaElements(JustificationValues.Center).Concat([
        new SpacingBetweenLines { After = "80" }
    ]).ToArray()), Run(label, false, "64748B", "18")),
    new TableCellProperties(
        new Shading { Val = ShadingPatternValues.Clear, Fill = fill },
        new TableCellWidth { Width = "2373", Type = TableWidthUnitValues.Dxa },
        new TableCellMargin(new TopMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
            new BottomMargin { Width = "60", Type = TableWidthUnitValues.Dxa })));

static Table WrapTable(List<TableRow> rows, string[]? colWidths = null)
{
    var table = new Table();
    table.AppendChild(new TableProperties(
        new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
        new TableLayout { Type = TableLayoutValues.Fixed },
        new TableJustification { Val = TableRowAlignmentValues.Left },
        new TableBorders(
            new TopBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new BottomBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new LeftBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new RightBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new InsideHorizontalBorder { Val = BorderValues.Single, Color = "E2E8F0", Size = 4 },
            new InsideVerticalBorder { Val = BorderValues.Single, Color = "E2E8F0", Size = 4 })));
    if (colWidths is { Length: > 0 })
    {
        var grid = new TableGrid();
        foreach (var w in colWidths) grid.Append(new GridColumn { Width = w });
        table.Append(grid);
    }
    foreach (var row in rows) table.Append(row);
    return table;
}

static TableRow HeaderRow(string[] cells, string[] widths, int rightAlignFrom = -1)
{
    var row = new TableRow(new TableRowProperties(new TableHeader()));
    for (var i = 0; i < cells.Length; i++)
    {
        var align = rightAlignFrom >= 0 && i >= rightAlignFrom ? JustificationValues.Right : JustificationValues.Left;
        row.Append(Cell(new Paragraph(MakeLtrParaProps(align), Run(cells[i], true, "FFFFFF", "18")), widths[i], true, "0F9F76"));
    }
    return row;
}

static TableRow DataRow(string[] cells, string[] widths, bool shaded)
{
    var row = new TableRow();
    for (var i = 0; i < cells.Length; i++)
    {
        var p = new Paragraph(new ParagraphProperties(LtrParaElements().Concat([
            new SpacingBetweenLines { Line = "260" }
        ]).ToArray()), Run(cells[i], false, "1A2332", "18"));
        row.Append(Cell(p, widths[i], false, shaded ? "F8FAFC" : "FFFFFF"));
    }
    return row;
}

static TableCell Cell(Paragraph p, string width, bool header, string? fill = null)
{
    var props = new List<OpenXmlElement> { new TableCellWidth { Width = width, Type = TableWidthUnitValues.Dxa } };
    if (fill != null) props.Add(new Shading { Val = ShadingPatternValues.Clear, Fill = fill });
    props.Add(new TableCellMargin(new TopMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
        new BottomMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
        new LeftMargin { Width = "80", Type = TableWidthUnitValues.Dxa },
        new RightMargin { Width = "80", Type = TableWidthUnitValues.Dxa }));
    return new TableCell(p, new TableCellProperties(props.ToArray()));
}

static Run Run(string text, bool bold, string color, string halfPoints) =>
    new Run(new RunProperties(
        bold ? new Bold() : null!,
        new Color { Val = color },
        new FontSize { Val = halfPoints },
        new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri" },
        new Languages { Val = "en-US", EastAsia = "en-US" }),
        new Text(SanitizeText(text)) { Space = SpaceProcessingModeValues.Preserve });

static Run RunArabic(string text, bool bold, string color, string halfPoints) =>
    new Run(new RunProperties(
        bold ? new Bold() : null!,
        new Color { Val = color },
        new FontSize { Val = halfPoints },
        new RunFonts { Ascii = "Arial", HighAnsi = "Arial", ComplexScript = "Arial" },
        new Languages { Val = "ar-IQ", Bidi = "ar-IQ" }),
        new Text(SanitizeText(text)) { Space = SpaceProcessingModeValues.Preserve });

static Paragraph ImageParagraph(MainDocumentPart mainPart, string path, long cx, long cy, uint docPropId)
{
    if (!File.Exists(path))
        return new Paragraph(MakeLtrParaProps(), Run("Deema Al Hayat Cosmetics", true, "0F9F76", "24"));

    var imagePart = mainPart.AddImagePart(ImagePartType.Jpeg);
    using (var fs = File.OpenRead(path)) imagePart.FeedData(fs);
    var relId = mainPart.GetIdOfPart(imagePart);
    var drawing = new Drawing(
        new DW.Inline(
            new DW.Extent { Cx = cx, Cy = cy },
            new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
            new DW.DocProperties { Id = docPropId, Name = "Company Logo" },
            new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
            new A.Graphic(new A.GraphicData(new PIC.Picture(
                new PIC.NonVisualPictureProperties(
                    new PIC.NonVisualDrawingProperties { Id = docPropId, Name = "deema-logo.jpg" },
                    new PIC.NonVisualPictureDrawingProperties()),
                new PIC.BlipFill(
                    new A.Blip { Embed = relId, CompressionState = A.BlipCompressionValues.Print },
                    new A.Stretch(new A.FillRectangle())),
                new PIC.ShapeProperties(
                    new A.Transform2D(new A.Offset { X = 0L, Y = 0L }, new A.Extents { Cx = cx, Cy = cy }),
                    new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle })))
            { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" }))
        {
            DistanceFromTop = 0U,
            DistanceFromBottom = 0U,
            DistanceFromLeft = 0U,
            DistanceFromRight = 0U
        });
    return new Paragraph(new ParagraphProperties(new SpacingBetweenLines { After = "0", Line = "240" }), new Run(drawing));
}

sealed record RawProduct(string Barcode, string EnglishName, decimal WholesaleIqd, decimal ConsumerIqd);
sealed record PricedProduct(string Barcode, string EnglishName, decimal DistributionUsd, decimal ConsumerUsd);
