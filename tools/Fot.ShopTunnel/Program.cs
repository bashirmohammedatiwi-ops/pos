using System.Net.Sockets;
using System.Text;

var host = Get("--host", "187.124.23.65");
var tunnelPort = int.Parse(Get("--tunnel", "4704"));
var shopPort = int.Parse(Get("--shop", "5000"));
var auth = Get("--auth", "fot:e7Kq9mN2pL4xW8vR");
var workers = int.Parse(Get("--workers", "8"));

using var mutex = new Mutex(false, @"Local\FOT.Pos.ShopTunnel");
try
{
    if (!mutex.WaitOne(0)) return;
}
catch (AbandonedMutexException)
{
    /* previous tunnel exited without releasing the lock */
}

var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "logs");
Directory.CreateDirectory(logDir);
var logPath = Path.Combine(logDir, "shop-tunnel.log");
void Log(string message)
{
    try
    {
        File.AppendAllText(logPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}");
    }
    catch { /* logging must not stop the tunnel */ }
}

Log($"tunnel start {workers} workers {host}:{tunnelPort} -> 127.0.0.1:{shopPort}");

var nextLogAt = 0L;
void LogRetry(string message)
{
    var now = Environment.TickCount64;
    if (now < nextLogAt) return;
    nextLogAt = now + 60_000;
    Log(message);
}

var tasks = Enumerable.Range(0, workers).Select(i => RunWorker(i, host, tunnelPort, shopPort, auth, LogRetry)).ToArray();
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

static async Task RunWorker(int id, string host, int tunnelPort, int shopPort, string auth, Action<string> log)
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
            if (id == 0) log($"tunnel retry: {ex.Message}");
            await Task.Delay(8000);
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
