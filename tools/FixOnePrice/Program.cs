using Microsoft.Data.SqlClient;

const string barcode = "3760100683479";
const decimal newWholesale = 4800m;
var cs = @"Server=localhost\FOTSQLSERVER;Database=HAYAT2025.mdf;Trusted_Connection=True;TrustServerCertificate=True;";

await using var conn = new SqlConnection(cs);
await conn.OpenAsync();

await using var cmd = conn.CreateCommand();
cmd.CommandText = "UPDATE articles SET SellPr1 = @price WHERE LTRIM(RTRIM(Barcode)) = @barcode";
cmd.Parameters.AddWithValue("@price", newWholesale);
cmd.Parameters.AddWithValue("@barcode", barcode);
var n = await cmd.ExecuteNonQueryAsync();
Console.WriteLine($"Updated rows: {n}");

await using var verify = conn.CreateCommand();
verify.CommandText = "SELECT Barcode, Name2, SellPr1, SellPr4 FROM articles WHERE LTRIM(RTRIM(Barcode)) = @barcode";
verify.Parameters.AddWithValue("@barcode", barcode);
await using var r = await verify.ExecuteReaderAsync();
while (await r.ReadAsync())
    Console.WriteLine($"{r.GetString(0)} | {r.GetString(1)} | SellPr1={r.GetValue(2)} | SellPr4={r.GetValue(3)}");
