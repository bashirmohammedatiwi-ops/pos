using System.Net;
using System.Net.Sockets;

const string ServerIp = "192.168.75.1";
const string Mask = "255.255.255.0";
const string PoolStart = "192.168.75.10";
const string PoolEnd = "192.168.75.250";
const int LeaseHours = 72;

if (!IPAddress.TryParse(ServerIp, out var bindIp))
    return 1;

var leases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ServerIp };
var start = IpToUint(PoolStart);
var end = IpToUint(PoolEnd);

using var udp = new UdpClient(AddressFamily.InterNetwork);
udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.Broadcast, true);
udp.EnableBroadcast = true;
udp.Client.Bind(new IPEndPoint(bindIp, 67));
Console.WriteLine($"FOT LAN DHCP listening on {ServerIp}:67 pool {PoolStart}-{PoolEnd}");

while (true)
{
    UdpReceiveResult result;
    try { result = await udp.ReceiveAsync(); }
    catch (Exception ex)
    {
        Console.WriteLine("recv " + ex.Message);
        continue;
    }

    var buf = result.Buffer;
    if (buf.Length < 240 || buf[0] != 1) continue;
    if (buf[236] != 99 || buf[237] != 130 || buf[238] != 83 || buf[239] != 99) continue;

    var mac = string.Join(":", Enumerable.Range(0, 6).Select(i => buf[28 + i].ToString("X2")));
    var msg = ReadMsg(buf);
    if (msg is not (1 or 3)) continue;

    if (!leases.TryGetValue(mac, out var offered))
    {
        offered = null;
        for (var n = start; n <= end; n++)
        {
            var ip = UintToIp(n);
            if (!used.Add(ip)) continue;
            offered = ip;
            leases[mac] = ip;
            break;
        }
    }
    if (offered is null) continue;

    var reply = BuildReply(buf, offered, ServerIp, Mask, msg == 1 ? (byte)2 : (byte)5, LeaseHours);
    await udp.SendAsync(reply, new IPEndPoint(IPAddress.Broadcast, 68));
    Console.WriteLine($"{DateTime.Now:HH:mm:ss} {(msg == 1 ? "OFFER" : "ACK")} {mac} -> {offered}");
}

static int ReadMsg(byte[] buf)
{
    var i = 240;
    while (i < buf.Length - 2)
    {
        var code = buf[i++];
        if (code == 255) break;
        if (code == 0) continue;
        var len = buf[i++];
        if (code == 53 && len >= 1) return buf[i];
        i += len;
    }
    return 0;
}

static byte[] BuildReply(byte[] req, string clientIp, string serverIp, string mask, byte dhcpType, int hours)
{
    var reply = new byte[300];
    Array.Copy(req, reply, Math.Min(req.Length, reply.Length));
    reply[0] = 2;
    reply[10] = 0x80;
    reply[11] = 0x00;
    WriteIp(reply, 16, clientIp);
    WriteIp(reply, 20, serverIp);
    var i = 236;
    reply[i++] = 99; reply[i++] = 130; reply[i++] = 83; reply[i++] = 99;
    WriteOpt(reply, ref i, 53, [dhcpType]);
    WriteOpt(reply, ref i, 1, IPAddress.Parse(mask).GetAddressBytes());
    WriteOpt(reply, ref i, 3, IPAddress.Parse(serverIp).GetAddressBytes());
    WriteOpt(reply, ref i, 54, IPAddress.Parse(serverIp).GetAddressBytes());
    var secs = hours * 3600;
    WriteOpt(reply, ref i, 51, [(byte)(secs >> 24), (byte)(secs >> 16), (byte)(secs >> 8), (byte)secs]);
    reply[i++] = 255;
    Array.Resize(ref reply, i);
    return reply;
}

static void WriteOpt(byte[] buf, ref int i, byte code, byte[] val)
{
    buf[i++] = code;
    buf[i++] = (byte)val.Length;
    Array.Copy(val, 0, buf, i, val.Length);
    i += val.Length;
}

static void WriteIp(byte[] buf, int offset, string ip)
{
    var b = IPAddress.Parse(ip).GetAddressBytes();
    buf[offset] = b[0];
    buf[offset + 1] = b[1];
    buf[offset + 2] = b[2];
    buf[offset + 3] = b[3];
}

static uint IpToUint(string ip)
{
    var b = IPAddress.Parse(ip).GetAddressBytes();
    return ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3];
}

static string UintToIp(uint n) =>
    $"{(n >> 24) & 0xff}.{(n >> 16) & 0xff}.{(n >> 8) & 0xff}.{n & 0xff}";
