using ClosedXML.Excel;

var path = args.Length > 0 ? args[0] : @"c:\Users\Future of Technology\Documents\pos\backups\perfume-sets.xlsx";
using var wb = new XLWorkbook(path);
foreach (var ws in wb.Worksheets)
{
    Console.WriteLine($"=== Sheet: {ws.Name} ===");
    var lastRow = ws.LastRowUsed()?.RowNumber() ?? 0;
    var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
    Console.WriteLine($"Rows={lastRow} Cols={lastCol}");
    for (var r = 1; r <= lastRow; r++)
    {
        var cells = new List<string>();
        for (var c = 1; c <= lastCol; c++)
        {
            var cell = ws.Cell(r, c);
            var v = cell.IsEmpty() ? "" : cell.GetFormattedString().Trim();
            cells.Add($"[{c}]{v}");
        }
        Console.WriteLine($"R{r}: {string.Join(" | ", cells)}");
    }
}
