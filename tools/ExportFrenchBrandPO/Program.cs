using ClosedXML.Excel;

var items = new Line[]
{
    new("Face Care", "22040", "3760100683622", "Cleansing Gel Vitamin C 500 ml", "500 ml", 360),
    new("Face Care", "24051", "", "Hydrating Cleansing Gel 500 ml", "500 ml", 360),
    new("Face Care", "24055", "3760420250481", "Anti-Imperfections Serum 30 ml", "30 ml", 360),
    new("Face Care", "15249", "3760100682601", "Micellar Water — Dry / Sensitive Skin 500 ml", "500 ml", 5000),
    new("Face Care", "15250", "3760100682618", "Micellar Water — Combination Skin 500 ml", "500 ml", 750),
    new("Face Care", "23026", "3760100685251", "Micellar Water Vitamin C 500 ml", "500 ml", 360),
    new("Face Care", "18347", "3760100183474", "Nourishing Day Care 50 ml", "50 ml", 240),
    new("Hair Care", "22011", "3760100683257", "Castor Oil Shampoo 1 L", "1 L", 480),
    new("Hair Care", "15259", "3760100682755", "Precious Oil Shampoo 1 L", "1 L", 480),
    new("Hair Care", "15269", "3760100682717", "Divine Argan Shampoo 1 L", "1 L", 480),
    new("Hair Care", "22012", "3760100683141", "Keratin Dry Hair Spray 250 ml", "250 ml", 240),
    new("Hair Care", "15263", "3760100682533", "Dry Shampoo 400 ml", "400 ml", 120),
    new("Body Care", "24019", "3760420251129", "Coconut Body Mist 200 ml", "200 ml", 240),
    new("Body Care", "24020", "3760420251105", "Peach Body Mist 200 ml", "200 ml", 240),
    new("Body Care", "25024", "3760420251730", "Pomegranate Body Mist 200 ml", "200 ml", 240),
    new("Body Care", "24021", "3760420251136", "Oriental Shimmering Body Mist 200 ml", "200 ml", 240),
    new("Body Care", "24028", "3760420250054", "Aloe Vera Deodorant", "—", 360),
    new("Body Care", "24057", "3760420250542", "Shimmering Sublimating Oil", "—", 240),
    new("Body Care", "20407", "3760100680171", "Pure Castor Oil 100 ml", "100 ml", 480),
    new("Body Care", "25015", "3760420251716", "Pomegranate Shower Gel 500 ml", "500 ml", 240),
    new("Body Care", "25017", "3760420251723", "Pomegranate Body Lotion 500 ml", "500 ml", 240),
    new("Oils", "23012", "3760100685237", "Pure Tahitian Monoi Oil", "—", 120),
    new("Oils", "14237", "3760100682441", "Sweet Almond Baby Oil 100 ml", "100 ml", 120),
};

var poNo = $"PO-DAH-{DateTime.Today:yyyyMMdd}";
var generated = DateTime.Today.ToString("dd MMMM yyyy");
var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
var outPath = Path.Combine(desktop, "EVOLUDERM-Purchase-Order-PO-DAH-20260917.xlsx");

using var wb = new XLWorkbook();
var ws = wb.Worksheets.Add("Purchase Order");
ws.Style.Font.FontName = "Calibri";
ws.Style.Font.FontSize = 11;
ws.Style.Font.FontColor = XLColor.FromHtml("#1A2332");
ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
ws.PageSetup.PaperSize = XLPaperSize.A4Paper;
ws.PageSetup.PagesWide = 1;
ws.PageSetup.PagesTall = 1;
ws.PageSetup.Margins.Left = 0.45;
ws.PageSetup.Margins.Right = 0.45;
ws.PageSetup.Margins.Top = 0.5;
ws.PageSetup.Margins.Bottom = 0.5;
ws.PageSetup.Header.Right.AddText("Deema Al Hayat  ·  Confidential");
ws.PageSetup.Footer.Left.AddText(poNo);
ws.PageSetup.Footer.Right.AddText("Page &P of &N");

var green = XLColor.FromHtml("#0F9F76");
var ink = XLColor.FromHtml("#0B1220");
var muted = XLColor.FromHtml("#64748B");
var mint = XLColor.FromHtml("#F0FDF9");
var line = XLColor.FromHtml("#D1FAE5");
var zebra = XLColor.FromHtml("#F8FAFC");

ws.Range(1, 1, 1, 8).Merge();
ws.Cell(1, 1).Value = "DEEMA AL HAYAT COSMETICS TRADING CO. LTD.";
ws.Cell(1, 1).Style.Font.Bold = true;
ws.Cell(1, 1).Style.Font.FontSize = 18;
ws.Cell(1, 1).Style.Font.FontColor = ink;

ws.Range(2, 1, 2, 8).Merge();
ws.Cell(2, 1).Value = "Official exclusive distributor of EVOLUDERM in Iraq";
ws.Cell(2, 1).Style.Font.FontColor = green;
ws.Cell(2, 1).Style.Font.Bold = true;
ws.Cell(2, 1).Style.Font.FontSize = 12;

ws.Range(3, 1, 3, 8).Merge();
ws.Cell(3, 1).Value = "Hay Al-Muthana, Sector 714, Street 15 — Baghdad, Iraq    |    Tel: +964 770 026 4060    |    info@deemaalhayat.com.iq    |    Client code: C01521";
ws.Cell(3, 1).Style.Font.FontColor = muted;
ws.Cell(3, 1).Style.Font.FontSize = 10;

ws.Range(5, 1, 5, 8).Merge();
ws.Cell(5, 1).Value = "PURCHASE ORDER";
ws.Cell(5, 1).Style.Font.Bold = true;
ws.Cell(5, 1).Style.Font.FontSize = 22;
ws.Cell(5, 1).Style.Font.FontColor = XLColor.White;
ws.Cell(5, 1).Style.Fill.BackgroundColor = green;
ws.Cell(5, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
ws.Row(5).Height = 28;

ws.Range(6, 1, 6, 8).Merge();
ws.Cell(6, 1).Value = "EVOLUDERM product range  ·  Firm order for shipment to Baghdad, Iraq";
ws.Cell(6, 1).Style.Font.FontColor = muted;

Label(ws, 8, 1, "Buyer");
Value(ws, 8, 2, 4, "Deema Al Hayat Cosmetics Trading Co. LTD.");
Label(ws, 8, 5, "Supplier");
Value(ws, 8, 6, 8, "C2J SARL — EVOLUDERM");

Label(ws, 9, 1, "Address");
Value(ws, 9, 2, 4, "Hay Al-Muthana, Sector 714, St. 15, Baghdad, Iraq");
Label(ws, 9, 5, "Address");
Value(ws, 9, 6, 8, "235 Rue des Caboeufs, 92230 Gennevilliers, France");

Label(ws, 10, 1, "Contact");
Value(ws, 10, 2, 4, "+964 770 026 4060  ·  info@deemaalhayat.com.iq");
Label(ws, 10, 5, "Attention");
Value(ws, 10, 6, 8, "Mrs Charlene Stievenart  ·  SIRET 451 020 549 00064");

Label(ws, 11, 1, "PO number");
Value(ws, 11, 2, 4, poNo);
Label(ws, 11, 5, "Order date");
Value(ws, 11, 6, 8, generated);

Label(ws, 12, 1, "Currency");
Value(ws, 12, 2, 4, "EUR — unit prices to be confirmed by supplier");
Label(ws, 12, 5, "Incoterm / destination");
Value(ws, 12, 6, 8, "To be confirmed  ·  Baghdad, Iraq");

ws.Range(8, 1, 12, 8).Style.Fill.BackgroundColor = mint;
ws.Range(8, 1, 12, 8).Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
ws.Range(8, 1, 12, 8).Style.Border.OutsideBorderColor = line;

ws.Range(14, 1, 14, 8).Merge();
ws.Cell(14, 1).Value = "Please supply the products listed below. Quantities are in selling units. Kindly confirm availability, unit prices (EUR), packing and earliest shipment date.";
ws.Cell(14, 1).Style.Font.FontColor = muted;
ws.Cell(14, 1).Style.Alignment.WrapText = true;
ws.Row(14).Height = 28;

const int headerRow = 16;
string[] headers = ["#", "Category", "Ref.", "Barcode (EAN)", "Product description", "Size", "Qty (units)", "Notes"];
for (var c = 0; c < headers.Length; c++)
{
    var cell = ws.Cell(headerRow, c + 1);
    cell.Value = headers[c];
    cell.Style.Font.Bold = true;
    cell.Style.Font.FontColor = XLColor.White;
    cell.Style.Fill.BackgroundColor = green;
    cell.Style.Alignment.Horizontal = c is 0 or 6 ? XLAlignmentHorizontalValues.Center : XLAlignmentHorizontalValues.Left;
    cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
}
ws.Row(headerRow).Height = 20;

for (var i = 0; i < items.Length; i++)
{
    var p = items[i];
    var r = headerRow + 1 + i;
    var fill = i % 2 == 1 ? zebra : XLColor.White;
    ws.Cell(r, 1).Value = i + 1;
    ws.Cell(r, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    ws.Cell(r, 2).Value = p.Category;
    ws.Cell(r, 3).Value = p.Ref;
    ws.Cell(r, 3).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    ws.Cell(r, 4).Value = string.IsNullOrWhiteSpace(p.Barcode) ? "To be confirmed" : p.Barcode;
    ws.Cell(r, 4).Style.NumberFormat.Format = "@";
    if (string.IsNullOrWhiteSpace(p.Barcode))
        ws.Cell(r, 4).Style.Font.FontColor = XLColor.FromHtml("#B45309");
    ws.Cell(r, 5).Value = p.Name;
    ws.Cell(r, 6).Value = p.Size;
    ws.Cell(r, 7).Value = p.Qty;
    ws.Cell(r, 7).Style.NumberFormat.Format = "#,##0";
    ws.Cell(r, 7).Style.Font.Bold = true;
    ws.Cell(r, 7).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    ws.Cell(r, 8).Value = string.IsNullOrWhiteSpace(p.Barcode) ? "Barcode missing on our list — please confirm EAN" : "";
    ws.Range(r, 1, r, 8).Style.Fill.BackgroundColor = fill;
    ws.Range(r, 1, r, 8).Style.Border.BottomBorder = XLBorderStyleValues.Hair;
    ws.Range(r, 1, r, 8).Style.Border.BottomBorderColor = XLColor.FromHtml("#E2E8F0");
}

var last = headerRow + items.Length;
var totalRow = last + 1;
ws.Range(totalRow, 1, totalRow, 6).Merge();
ws.Cell(totalRow, 1).Value = $"TOTAL  ·  {items.Length} references";
ws.Cell(totalRow, 1).Style.Font.Bold = true;
ws.Cell(totalRow, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
ws.Cell(totalRow, 7).FormulaA1 = $"SUM(G{headerRow + 1}:G{last})";
ws.Cell(totalRow, 7).Style.NumberFormat.Format = "#,##0";
ws.Cell(totalRow, 7).Style.Font.Bold = true;
ws.Cell(totalRow, 7).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
ws.Range(totalRow, 1, totalRow, 8).Style.Fill.BackgroundColor = green;
ws.Range(totalRow, 1, totalRow, 8).Style.Font.FontColor = XLColor.White;
ws.Row(totalRow).Height = 22;

var note = totalRow + 2;
ws.Range(note, 1, note, 8).Merge();
ws.Cell(note, 1).Value = "Commercial terms";
ws.Cell(note, 1).Style.Font.Bold = true;
ws.Cell(note, 1).Style.Font.FontColor = green;

ws.Range(note + 1, 1, note + 4, 8).Merge();
ws.Cell(note + 1, 1).Value =
    "1. This document is a firm purchase order from Deema Al Hayat Cosmetics Trading Co. LTD. to C2J SARL / EVOLUDERM.\n" +
    "2. Please confirm stock availability, EXW/FOB/CIF prices in EUR, carton packing and the earliest shipment date.\n" +
    "3. Destination: Baghdad, Iraq. Preferred shipment: full order in one consignment if available.\n" +
    "4. Please return a proforma invoice quoting PO number " + poNo + ".";
ws.Cell(note + 1, 1).Style.Alignment.WrapText = true;
ws.Cell(note + 1, 1).Style.Alignment.Vertical = XLAlignmentVerticalValues.Top;
ws.Cell(note + 1, 1).Style.Font.FontColor = muted;
ws.Row(note + 1).Height = 62;

var sign = note + 6;
ws.Range(sign, 1, sign, 8).Merge();
ws.Cell(sign, 1).Value = "Best regards,";
ws.Range(sign + 1, 1, sign + 1, 8).Merge();
ws.Cell(sign + 1, 1).Value = "Deema Al Hayat Cosmetics Trading Co. LTD.";
ws.Cell(sign + 1, 1).Style.Font.Bold = true;
ws.Range(sign + 2, 1, sign + 2, 8).Merge();
ws.Cell(sign + 2, 1).Value = "Baghdad, Iraq  ·  " + generated;
ws.Cell(sign + 2, 1).Style.Font.FontColor = muted;

ws.Column(1).Width = 6;
ws.Column(2).Width = 14;
ws.Column(3).Width = 10;
ws.Column(4).Width = 20;
ws.Column(5).Width = 52;
ws.Column(6).Width = 12;
ws.Column(7).Width = 14;
ws.Column(8).Width = 42;
ws.SheetView.FreezeRows(headerRow);
ws.Range(headerRow, 1, last, 8).SetAutoFilter();
ws.ShowGridLines = false;

wb.SaveAs(outPath);
Console.WriteLine(outPath);
Console.WriteLine($"Lines {items.Length}  Units {items.Sum(x => x.Qty)}");

static void Label(IXLWorksheet ws, int row, int col, string text)
{
    ws.Cell(row, col).Value = text;
    ws.Cell(row, col).Style.Font.Bold = true;
    ws.Cell(row, col).Style.Font.FontColor = XLColor.FromHtml("#0F9F76");
    ws.Cell(row, col).Style.Font.FontSize = 10;
}

static void Value(IXLWorksheet ws, int row, int col, int toCol, string text)
{
    if (toCol > col) ws.Range(row, col, row, toCol).Merge();
    ws.Cell(row, col).Value = text;
    ws.Cell(row, col).Style.Font.Bold = true;
}

sealed record Line(string Category, string Ref, string Barcode, string Name, string Size, int Qty);
