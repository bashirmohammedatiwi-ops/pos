using System.Data.Common;
using System.Reflection;
using System.Text;

Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
const string providerDir = @"D:\FOTLabel\FOTLabel";
Environment.CurrentDirectory = providerDir;
var asm = Assembly.LoadFrom(Path.Combine(providerDir, "NexusDB.ADOProvider.dll"));
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider",
    asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
await conn.OpenAsync();

if (args.Length > 0 && args[0] == "schema")
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT * FROM File13BC WHERE BarCode = '3760420250931'";
    await using var r = await cmd.ExecuteReaderAsync();
    for (var i = 0; i < r.FieldCount; i++)
        Console.WriteLine($"{i}: {r.GetName(i)} ({r.GetFieldType(i).Name})");
    if (await r.ReadAsync())
        for (var i = 0; i < r.FieldCount; i++)
            Console.WriteLine($"  {r.GetName(i)}={r.GetValue(i)}");
    return;
}

var defaultBarcodes = new[] { "3760420250931", "3760420250948", "3760420250924", "3760420250955" };
var barcodes = args.Length > 0 && args[0] == "fix-dupes"
    ? (args.Length > 1 ? args[1..] : defaultBarcodes)
    : args.Length > 0 && args[0] != "schema" ? args : defaultBarcodes;

if (args.Length > 0 && args[0] == "fix-dupes")
{
    foreach (var bc in barcodes)
    {
        await using var cntCmd = conn.CreateCommand();
        cntCmd.CommandText = $"SELECT COUNT(*) FROM File13BC WHERE BarCode = '{bc.Replace("'", "''")}'";
        var cnt = Convert.ToInt32(await cntCmd.ExecuteScalarAsync() ?? 0);
        if (cnt <= 1) { Console.WriteLine($"{bc}: OK ({cnt})"); continue; }

        // Keep one row; Nexus File13BC has no stable row id — delete all then re-insert one.
        await using var edCmd = conn.CreateCommand();
        edCmd.CommandText = $"SELECT EdNum, Qty FROM File13BC WHERE BarCode = '{bc.Replace("'", "''")}'";
        await using var r = await edCmd.ExecuteReaderAsync();
        await r.ReadAsync();
        var edNum = r.GetValue(0);
        var qty = r.GetValue(1);
        await r.CloseAsync();

        await using var del = conn.CreateCommand();
        del.CommandText = $"DELETE FROM File13BC WHERE BarCode = '{bc.Replace("'", "''")}'";
        var deleted = await del.ExecuteNonQueryAsync();

        await using var ins = conn.CreateCommand();
        ins.CommandText = $"INSERT INTO File13BC (EdNum, BarCode, Qty, NoDscnt) VALUES ({edNum}, '{bc.Replace("'", "''")}', {qty}, False)";
        await ins.ExecuteNonQueryAsync();
        Console.WriteLine($"{bc}: deleted {deleted}, re-inserted 1 (EdNum={edNum})");
    }
    return;
}

foreach (var bc in barcodes)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = $"SELECT EdNum, BarCode, Qty FROM File13BC WHERE BarCode = '{bc.Replace("'", "''")}'";
    Console.WriteLine($"=== File13BC {bc} ===");
    await using var r = await cmd.ExecuteReaderAsync();
    var n = 0;
    while (await r.ReadAsync())
    {
        n++;
        Console.WriteLine($"  EdNum={r.GetValue(0)} BarCode={r.GetValue(1)} Qty={r.GetValue(2)}");
    }
    if (n == 0) Console.WriteLine("  (none)");
}
