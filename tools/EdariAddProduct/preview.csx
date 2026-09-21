using ClosedXML.Excel;
var path = @"c:\Users\Future of Technology\Desktop\الماركة الفرنسية.xlsx";
using var wb = new XLWorkbook(path);
var ws = wb.Worksheet(1);
var used = ws.RangeUsed();
Console.WriteLine($"Sheet: {ws.Name}, rows={used?.RowCount()}, cols={used?.ColumnCount()}");
for (int r = 1; r <= Math.Min(8, used?.RowCount() ?? 0); r++) {
  var cells = new List<string>();
  for (int c = 1; c <= Math.Min(6, used?.ColumnCount() ?? 0); c++)
    cells.Add(ws.Cell(r,c).GetFormattedString().Trim());
  Console.WriteLine($"R{r}: {string.Join(" | ", cells)}");
}
