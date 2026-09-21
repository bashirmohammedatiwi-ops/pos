using System.Data.Common;
using System.Reflection;
using System.Text;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

const double MinCostToUpdate = 25_000;

var baseDir = @"c:\Users\Future of Technology\Documents\pos\publish\desktop\FOT-POS-Server\Api";
Environment.CurrentDirectory = baseDir;
var asm = Assembly.LoadFrom(Path.Combine(baseDir, "NexusDB.ADOProvider.dll"));
DbProviderFactories.RegisterFactory("NexusDB.ADOProvider",
    asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")!);

await using var conn = DbProviderFactories.GetFactory("NexusDB.ADOProvider").CreateConnection()!;
conn.ConnectionString = "server=127.0.0.1;database=2025;port=16000;Native=true";
await conn.OpenAsync();

var fathers = new HashSet<int>();
var perfumeParents = new HashSet<int> { 90543 };

await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = "SELECT DISTINCT Father FROM File13n WHERE Father > 0";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync()) fathers.Add(Convert.ToInt32(r.GetValue(0)));
}

// كل Seq تحت شجرة العطور (مجلدات + مواد)
var underPerfume = new HashSet<int> { 90543 };
foreach (var level in Enumerable.Range(0, 4))
{
    var next = new HashSet<int>();
    await using var cmd = conn.CreateCommand();
    var parentList = string.Join(",", underPerfume);
    cmd.CommandText = $"SELECT Seq FROM File13n WHERE Father IN ({parentList})";
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = Convert.ToInt32(r.GetValue(0));
        next.Add(seq);
        perfumeParents.Add(seq);
    }
    foreach (var s in next) underPerfume.Add(s);
}

var toUpdate = new List<(int Seq, double OldPrice, double NewPrice, double Cost)>();

await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = """
        SELECT Seq, Father, Last, SellPr4
        FROM File13n
        """;
    cmd.CommandTimeout = 600;
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        var seq = Convert.ToInt32(r.GetValue(0));
        var father = Convert.ToInt32(r.GetValue(1));
        if (fathers.Contains(seq)) continue;
        if (!perfumeParents.Contains(father) && father != 90543) continue;

        var cost = Convert.ToDouble(r.IsDBNull(2) ? 0 : r.GetValue(2));
        var current = Convert.ToDouble(r.IsDBNull(3) ? 0 : r.GetValue(3));
        if (cost < MinCostToUpdate) continue;

        var neu = RoundTo250(cost * MarkupMultiplier(cost));
        if (Math.Abs(neu - current) < 0.01) continue;
        toUpdate.Add((seq, current, neu, cost));
    }
}

var skippedLow = 0;
// count skipped - optional quick estimate from another pass not needed

Console.WriteLine("=== معاينة ===");
Console.WriteLine($"سيتم تحديث: {toUpdate.Count} مادة (تكلفة >= {MinCostToUpdate:N0})");
Console.WriteLine("عينات:");
foreach (var row in toUpdate.OrderByDescending(x => x.Seq).Take(8))
    Console.WriteLine($"  Seq {row.Seq} | cost={row.Cost:N0} | {row.OldPrice:N0} -> {row.NewPrice:N0}");

Console.WriteLine("\n=== تنفيذ UPDATE ===");
var done = 0;
var errors = 0;
foreach (var batch in toUpdate.Chunk(100))
{
    foreach (var row in batch)
    {
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"UPDATE File13n SET SellPr4 = {row.NewPrice.ToString(System.Globalization.CultureInfo.InvariantCulture)} WHERE Seq = {row.Seq}";
            cmd.CommandTimeout = 120;
            await cmd.ExecuteNonQueryAsync();
            done++;
        }
        catch (Exception ex)
        {
            errors++;
            Console.WriteLine($"ERR Seq {row.Seq}: {ex.Message.Split('\n')[0]}");
        }
    }
    if (done % 500 == 0 && done > 0) Console.WriteLine($"  ... {done} محدّث");
}

Console.WriteLine($"\nتم: {done} محدّث | أخطاء: {errors}");

// تحقق
await using (var cmd = conn.CreateCommand())
{
    cmd.CommandText = $"SELECT Seq, Last, SellPr4 FROM File13n WHERE Seq = {toUpdate.First().Seq}";
    await using var r = await cmd.ExecuteReaderAsync();
    if (await r.ReadAsync())
        Console.WriteLine($"تحقق Seq {r.GetValue(0)}: cost={r.GetValue(1)} consumer={r.GetValue(2)}");
}

static double MarkupMultiplier(double price) => price switch
{
    < 50_000 => 1.30,
    <= 100_000 => 1.25,
    <= 150_000 => 1.20,
    <= 200_000 => 1.18,
    <= 250_000 => 1.15,
    <= 300_000 => 1.12,
    _ => 1.10
};

static double RoundTo250(double value) => Math.Round(value / 250) * 250;
