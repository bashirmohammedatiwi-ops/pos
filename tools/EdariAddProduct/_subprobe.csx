using System.Data.Common;
using System.Reflection;
var asm = Assembly.LoadFrom(@"D:\FOTLabel\FOTLabel\NexusDB.ADOProvider.dll");
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider", asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);
Environment.CurrentDirectory = @"D:\FOTLabel\FOTLabel";
await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
await conn.OpenAsync();
foreach (var num in new[] { "3760100173055", "3760420251112", "3790070496659" })
{
  await using var cmd = conn.CreateCommand();
  cmd.CommandText = $"SELECT Seq, Num, Sub, Dest FROM File13n WHERE Num = '{num}'";
  try {
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync()) {
      var sub = r.IsDBNull(2) ? "NULL" : r.GetValue(2)?.GetType().Name + "=" + BitConverter.ToString(r.IsDBNull(2) ? Array.Empty<byte>() : (byte[])r.GetValue(2));
      Console.WriteLine($"{num} Sub={sub} Dest={r.GetValue(3)}");
    }
  } catch (Exception ex) { Console.WriteLine($"{num} ERR: {ex.Message.Split('\n')[0]}"); }
}
