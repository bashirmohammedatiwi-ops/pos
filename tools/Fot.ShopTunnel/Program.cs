using System.Net.Sockets;
using System.Text;

var host = Get("--host", "187.124.23.65");
var tunnelPort = int.Parse(Get("--tunnel", "4704"));
var shopPort = int.Parse(Get("--shop", "5000"));
var auth = Get("--auth", "fot:e7Kq9mN2pL4xW8vR");
var workers = int.Parse(Get("--workers", "8"));

Console.WriteLine($"Connecting {workers} workers to {host}:{tunnelPort} -> shop 127.0.0.1:{shopPort}");
Console.WriteLine("Leave this window open.");

var tasks = Enumerable.Range(0, workers).Select(i => RunWorker(i, host, tunnelPort, shopPort, auth)).ToArray();
await Task.WhenAll(tasks);
return;

static string Get(string name, string fallback)
{
    var args = Environment.GetCommandLineArgs();
    for (var i = 0; i < args.Length - 1; i++)
        if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
            return args[i + 1];
    return fallback;
}

static async Task RunWorker(int id, string host, int tunnelPort, int shopPort, string auth)
{
    var authBytes = Encoding.ASCII.GetBytes($"AUTH {auth}\n");
    var go = "GO\n"u8.ToArray();
    while (true)
    {
        try
        {
            using var remote = new TcpClient { NoDelay = true };
            await remote.ConnectAsync(host, tunnelPort);
            var rs = remote.GetStream();
            await rs.WriteAsync(authBytes);
            var leftover = await WaitForGo(rs, go);

            using var local = new TcpClient { NoDelay = true };
            await local.ConnectAsync("127.0.0.1", shopPort);
            var ls = local.GetStream();
            if (leftover.Length > 0)
                await ls.WriteAsync(leftover);

            var toShop = rs.CopyToAsync(ls);
            var toVps = ls.CopyToAsync(rs);
            await Task.WhenAny(toShop, toVps);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{id}] {ex.Message}");
            await Task.Delay(3000);
        }
    }
}

static async Task<byte[]> WaitForGo(NetworkStream stream, byte[] go)
{
    var acc = new MemoryStream();
    var buf = new byte[4096];
    while (true)
    {
        var n = await stream.ReadAsync(buf);
        if (n <= 0) throw new IOException("tunnel closed before GO");
        acc.Write(buf, 0, n);
        var data = acc.ToArray();
        var idx = IndexOf(data, go);
        if (idx >= 0)
        {
            var start = idx + go.Length;
            return data[start..];
        }
        if (data.Length > 64) throw new IOException("tunnel rejected auth");
    }
}

static int IndexOf(byte[] data, byte[] needle)
{
    for (var i = 0; i <= data.Length - needle.Length; i++)
    {
        var ok = true;
        for (var j = 0; j < needle.Length; j++)
        {
            if (data[i + j] != needle[j]) { ok = false; break; }
        }
        if (ok) return i;
    }
    return -1;
}
