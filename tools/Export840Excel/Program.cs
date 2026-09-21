using ClosedXML.Excel;
using Microsoft.Data.SqlClient;

const int folderSeq = 91593;
const string connStr =
    @"Server=localhost\FOTSQLSERVER;Database=HAYAT2025.mdf;Trusted_Connection=True;TrustServerCertificate=True;";

var outDir = args.Length > 0 ? args[0] : Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
    "pos", "tools", "output");
Directory.CreateDirectory(outDir);
var outPath = Path.Combine(outDir, "tree-840-evoluderm.xlsx");

var rows = new List<(string Barcode, string EnglishName, decimal Wholesale, decimal Consumer)>();

await using (var conn = new SqlConnection(connStr))
{
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
        ORDER BY Barcode
        """;
    cmd.Parameters.AddWithValue("@folderSeq", folderSeq);
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        rows.Add((
            r.GetString(0),
            r.IsDBNull(1) ? "" : r.GetString(1),
            r.GetDecimal(2),
            r.GetDecimal(3)));
    }
}

using var wb = new XLWorkbook();
var ws = wb.Worksheets.Add("840 EVOLUDERM");
ws.Cell(1, 1).Value = "Barcode";
ws.Cell(1, 2).Value = "English Name";
ws.Cell(1, 3).Value = "Wholesale Price (IQD)";
ws.Cell(1, 4).Value = "Consumer Price (IQD)";

var header = ws.Range(1, 1, 1, 4);
header.Style.Font.Bold = true;
header.Style.Fill.BackgroundColor = XLColor.LightGray;

for (var i = 0; i < rows.Count; i++)
{
    var row = rows[i];
    var n = i + 2;
    ws.Cell(n, 1).Value = row.Barcode;
    ws.Cell(n, 1).Style.NumberFormat.Format = "@";
    ws.Cell(n, 2).Value = row.EnglishName;
    ws.Cell(n, 3).Value = (double)row.Wholesale;
    ws.Cell(n, 4).Value = (double)row.Consumer;
}

ws.Columns().AdjustToContents();
ws.SheetView.FreezeRows(1);
wb.SaveAs(outPath);

var desktop = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
    "tree-840-evoluderm.xlsx");
File.Copy(outPath, desktop, overwrite: true);

Console.WriteLine($"Exported {rows.Count} products");
Console.WriteLine(outPath);
Console.WriteLine(desktop);
