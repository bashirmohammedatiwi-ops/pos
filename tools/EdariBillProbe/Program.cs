using System.Data.Common;
using System.Reflection;
using System.Text;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var apiDirs = new[]
{
    @"C:\Program Files\FOT POS Server\Api",
    Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "src", "FOT.Pos.Api", "bin", "Debug", "net9.0")),
};
var baseDir = apiDirs.First(d => File.Exists(Path.Combine(d, "NexusDB.ADOProvider.dll")));
Environment.CurrentDirectory = baseDir;
var asm = Assembly.LoadFrom(Path.Combine(baseDir, "NexusDB.ADOProvider.dll"));
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider", asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = "server=127.0.0.1;database=2026;port=16000;Native=true";
await conn.OpenAsync();

var outLines = new List<string>();
async Task Dump(string title, string sql)
{
    outLines.Add($"=== {title} ===");
    try
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        await using var r = await cmd.ExecuteReaderAsync();
        var names = Enumerable.Range(0, r.FieldCount).Select(r.GetName).ToArray();
        outLines.Add(string.Join(" | ", names));
        var n = 0;
        while (await r.ReadAsync() && n < 400)
        {
            outLines.Add(string.Join(" | ", Enumerable.Range(0, r.FieldCount).Select(i => r.IsDBNull(i) ? "" : Clean(Convert.ToString(r.GetValue(i))))));
            n++;
        }
    }
    catch (Exception ex)
    {
        outLines.Add("ERR " + ex.Message);
    }
}

var queries = args.SelectMany(a => a.StartsWith('@')
    ? File.ReadAllText(a[1..], Encoding.UTF8).Split(";;", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    : [a]);
foreach (var q in queries) await Dump(q.Length > 70 ? q[..70] : q, q);

static string Clean(string? s) =>
    new((s ?? "").Select(ch => char.IsControl(ch) || ch == '\uFFFD' ? ' ' : ch).ToArray());

var path = Path.Combine(Path.GetTempPath(), "fot-shot", "edari-probe.txt");
await File.WriteAllLinesAsync(path, outLines, new UTF8Encoding(true));
Console.WriteLine(path);
