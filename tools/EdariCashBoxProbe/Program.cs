using System.Data.Common;
using System.Reflection;
var baseDir = @"c:\Users\Future of Technology\Documents\pos\publish\desktop\FOT-POS-Server\Api";
Environment.CurrentDirectory = baseDir;
var asmPath = Path.Combine(baseDir, "Edari", "Native", "NexusDB.ADOProvider.dll");
var asm = Assembly.LoadFrom(asmPath);
var factoryType = asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!;
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider", factoryType);
var factory = DbProviderFactories.GetFactory("NexusDB.ADOProvider");
await using var conn = factory.CreateConnection()!;
conn.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
await conn.OpenAsync();
async Task Query(string label, string sql) {
  Console.WriteLine("=== " + label + " ===");
  await using var cmd = conn.CreateCommand();
  cmd.CommandText = sql;
  try {
    await using var r = await cmd.ExecuteReaderAsync();
    var n=0;
    while (await r.ReadAsync()) {
      n++;
      var parts = new string[r.FieldCount];
      for (int i=0;i<r.FieldCount;i++) parts[i] = r.GetName(i)+"="+(r.IsDBNull(i)?"null":Convert.ToString(r.GetValue(i)));
      Console.WriteLine(string.Join(" | ", parts));
    }
    if (n==0) Console.WriteLine("(no rows)");
  } catch (Exception ex) { Console.WriteLine("ERR: " + ex.Message); }
}
await Query("num 100", "SELECT Seq, Num, Name1, Cod, Father, CloseAcc FROM File11n WHERE Num = '100'");
await Query("num 131-138", "SELECT Seq, Num, Name1, Cod, Father, CloseAcc FROM File11n WHERE Num IN ('131','132','133','136','138') ORDER BY Num");
await Query("father=100", "SELECT Seq, Num, Name1, Cod, Father, CloseAcc FROM File11n WHERE Father = 100 ORDER BY Num");
await Query("name like ÕäÏæÞ", "SELECT TOP 20 Seq, Num, Name1, Cod, Father, CloseAcc FROM File11n WHERE Name1 LIKE '%ÕäÏæÞ%' ORDER BY Num");
