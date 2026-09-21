using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using FOT.Pos.Api.Lan;
using Microsoft.Extensions.Options;

namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// Minimal DHCP server for the wired price-checker LAN so kiosks get an IP automatically after reboot.
/// </summary>
public sealed class LanDhcpHostedService(
    IOptions<PriceCheckerLanOptions> options,
    ILogger<LanDhcpHostedService> logger) : BackgroundService
{
    private const byte BootRequest = 1;
    private const byte BootReply = 2;
    private static readonly byte[] Magic = [99, 130, 83, 99];

    private readonly ConcurrentDictionary<string, Lease> _leases = new(StringComparer.OrdinalIgnoreCase);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var cfg = options.Value;
        if (!cfg.Enabled)
        {
            logger.LogInformation("Price-checker DHCP is disabled");
            return;
        }

        if (!IPAddress.TryParse(cfg.InterfaceIp, out var bindIp))
        {
            logger.LogWarning("Price-checker DHCP: invalid InterfaceIp {Ip}", cfg.InterfaceIp);
            return;
        }

        var ethIps = LanNetwork.ListPriceCheckerIpv4Addresses();
        if (!ethIps.Contains(cfg.InterfaceIp, StringComparer.OrdinalIgnoreCase))
        {
            logger.LogWarning(
                "Price-checker DHCP: {Ip} is not on an active Ethernet adapter ({Found}) — DHCP not started",
                cfg.InterfaceIp,
                string.Join(", ", ethIps));
            return;
        }

        if (!TryParsePool(cfg, out var poolStart, out var poolEnd))
        {
            logger.LogWarning("Price-checker DHCP: invalid pool {Start}-{End}", cfg.PoolStart, cfg.PoolEnd);
            return;
        }

        try { LanFirewall.EnsureDhcp(); }
        catch (Exception ex) { logger.LogDebug(ex, "DHCP firewall rule could not be verified"); }

        using var udp = new UdpClient(AddressFamily.InterNetwork);
        udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.Broadcast, true);
        udp.EnableBroadcast = true;
        udp.Client.Bind(new IPEndPoint(bindIp, 67));

        logger.LogInformation(
            "Price-checker DHCP listening on UDP 67 for {Subnet} (server {Server}, pool {Start}-{End})",
            cfg.InterfaceIp,
            cfg.InterfaceIp,
            cfg.PoolStart,
            cfg.PoolEnd);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = await udp.ReceiveAsync(stoppingToken);
                var buffer = result.Buffer;
                if (buffer.Length < 240 || buffer[0] != BootRequest) continue;
                if (!HasMagic(buffer)) continue;

                var mac = MacString(buffer, 28);
                if (string.IsNullOrEmpty(mac)) continue;

                var msgType = ReadMessageType(buffer);
                if (msgType is not (1 or 3)) continue; // DISCOVER or REQUEST

                var offered = AllocateIp(mac, poolStart, poolEnd, bindIp, cfg.LeaseHours);
                if (offered is null) continue;

                var reply = BuildReply(buffer, buffer.Length, offered, bindIp, cfg, msgType);
                var dest = new IPEndPoint(IPAddress.Broadcast, 68);
                await udp.SendAsync(reply, dest, stoppingToken);
                logger.LogInformation("DHCP {Type} {Mac} -> {Ip}", msgType == 1 ? "OFFER" : "ACK", mac, offered);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Price-checker DHCP packet failed");
            }
        }
    }

    private string? AllocateIp(string mac, uint poolStart, uint poolEnd, IPAddress serverIp, int leaseHours)
    {
        if (_leases.TryGetValue(mac, out var existing) && !existing.IsExpired())
            return existing.Ip;

        var used = _leases.Values
            .Where(l => !l.IsExpired())
            .Select(l => l.Ip)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        used.Add(serverIp.ToString());

        for (var n = poolStart; n <= poolEnd; n++)
        {
            var ip = UintToIp(n);
            if (used.Contains(ip)) continue;
            var lease = new Lease(ip, DateTime.UtcNow.AddHours(Math.Clamp(leaseHours, 1, 168)));
            _leases[mac] = lease;
            return ip;
        }

        return null;
    }

    private static bool TryParsePool(PriceCheckerLanOptions cfg, out uint start, out uint end)
    {
        start = end = 0;
        if (!IPAddress.TryParse(cfg.PoolStart, out var s) || !IPAddress.TryParse(cfg.PoolEnd, out var e))
            return false;
        start = IpToUint(s);
        end = IpToUint(e);
        return start > 0 && end >= start;
    }

    private static byte[] BuildReply(byte[] req, int length, string clientIp, IPAddress serverIp, PriceCheckerLanOptions cfg, int msgType)
    {
        var reply = new byte[300];
        Array.Copy(req, reply, Math.Min(length, reply.Length));
        reply[0] = BootReply;
        WriteIp(reply, 16, clientIp); // yiaddr
        WriteIp(reply, 20, serverIp.ToString()); // siaddr

        var opt = 236;
        var dhcpMsg = msgType == 1 ? (byte)2 : (byte)5; // OFFER or ACK
        WriteOption(reply, ref opt, 53, [dhcpMsg]);
        WriteOption(reply, ref opt, 1, MaskBytes(cfg.SubnetMask));
        WriteOption(reply, ref opt, 3, IpBytes(serverIp.ToString()));
        WriteOption(reply, ref opt, 54, IpBytes(serverIp.ToString()));
        WriteOption(reply, ref opt, 51, LeaseBytes(cfg.LeaseHours));
        reply[opt++] = 255;
        Array.Resize(ref reply, opt);
        return reply;
    }

    private static void WriteOption(byte[] buf, ref int i, byte code, byte[] val)
    {
        buf[i++] = code;
        buf[i++] = (byte)val.Length;
        Array.Copy(val, 0, buf, i, val.Length);
        i += val.Length;
    }

    private static byte[] LeaseBytes(int hours) =>
    [
        (byte)((hours * 3600 >> 24) & 0xff),
        (byte)((hours * 3600 >> 16) & 0xff),
        (byte)((hours * 3600 >> 8) & 0xff),
        (byte)(hours * 3600 & 0xff)
    ];

    private static byte[] IpBytes(string ip) => IPAddress.Parse(ip).GetAddressBytes();

    private static byte[] MaskBytes(string mask) => IPAddress.Parse(mask).GetAddressBytes();

    private static void WriteIp(byte[] buf, int offset, string ip)
    {
        var b = IPAddress.Parse(ip).GetAddressBytes();
        buf[offset] = b[0];
        buf[offset + 1] = b[1];
        buf[offset + 2] = b[2];
        buf[offset + 3] = b[3];
    }

    private static bool HasMagic(byte[] buf)
    {
        for (var i = 0; i < 4; i++)
            if (buf[236 + i] != Magic[i]) return false;
        return true;
    }

    private static int ReadMessageType(byte[] buf)
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

    private static string MacString(byte[] buf, int offset)
    {
        if (offset + 6 > buf.Length) return "";
        return string.Join(":", Enumerable.Range(0, 6).Select(j => buf[offset + j].ToString("X2")));
    }

    private static uint IpToUint(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3];
    }

    private static string UintToIp(uint n) =>
        $"{(n >> 24) & 0xff}.{(n >> 16) & 0xff}.{(n >> 8) & 0xff}.{n & 0xff}";

    private sealed class Lease(string ip, DateTime expiresUtc)
    {
        public string Ip { get; } = ip;
        public bool IsExpired() => DateTime.UtcNow >= expiresUtc;
    }
}
