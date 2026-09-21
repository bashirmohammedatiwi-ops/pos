using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace FOT.Pos.Api.Lan;

public static class LanNetwork
{
    public const int ApiPort = 5000;
    public const int DiscoveryPort = 49500;
    public const string ProbeMagic = "FOT-POS?";
    public const string AppId = "FOT-POS";

    private static readonly string[] VirtualHints =
    [
        "hyper-v", "vethernet", "vmware", "virtualbox", "virtual", "vbox",
        "loopback", "bluetooth", "docker", "wsl", "vpn", "tap-windows",
        "cisco anyconnect", "nordlynx", "wireguard"
    ];

    public static IReadOnlyList<string> ListIpv4Addresses() =>
        ListAdapterIpv4Addresses(includeWireless: true);

    /// <summary>
    /// Ethernet-only addresses for price-checker kiosks on the wired LAN.
    /// Wi-Fi IPs (e.g. internet on another subnet) must not be advertised to wired devices.
    /// </summary>
    public static IReadOnlyList<string> ListPriceCheckerIpv4Addresses() =>
        ListAdapterIpv4Addresses(includeWireless: false);

    private static IReadOnlyList<string> ListAdapterIpv4Addresses(bool includeWireless)
    {
        var physical = new List<(string Ip, int Score)>();
        var fallback = new List<(string Ip, int Score)>();
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                if (!includeWireless && IsWirelessAdapter(ni)) continue;
                var virtualNic = IsVirtualAdapter(ni);
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    if (IPAddress.IsLoopback(ua.Address)) continue;
                    var ip = ua.Address.ToString();
                    var row = (ip, ScoreIp(ip) + ScoreAdapter(ni));
                    if (virtualNic || row.Item2 <= 0) fallback.Add(row);
                    else physical.Add(row);
                }
            }
        }
        catch
        {
            /* ignore adapter enumeration failures */
        }

        var chosen = physical.Count > 0 ? physical : fallback;
        if (chosen.Count == 0)
        {
            try
            {
                foreach (var addr in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (addr.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr))
                        chosen.Add((addr.ToString(), ScoreIp(addr.ToString())));
                }
            }
            catch
            {
                /* ignore DNS fallback failures */
            }
        }

        return chosen
            .Select(x => x.Ip)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(x => ScoreIp(x))
            .ThenBy(ip => ip, StringComparer.Ordinal)
            .ToList();
    }

    public static string[] ApiUrls(IEnumerable<string> ipv4) =>
        ipv4.Select(ip => $"http://{ip}:{ApiPort}").ToArray();

    public static IReadOnlyList<string> BroadcastAddresses()
    {
        var set = new HashSet<string>(StringComparer.Ordinal) { "255.255.255.255" };
        foreach (var ip in ListPriceCheckerIpv4Addresses())
        {
            var parts = ip.Split('.');
            if (parts.Length == 4) set.Add($"{parts[0]}.{parts[1]}.{parts[2]}.255");
        }
        return set.ToList();
    }

    public static int ScoreIp(string ip)
    {
        if (string.IsNullOrWhiteSpace(ip)) return -1;
        if (ip.StartsWith("169.254.", StringComparison.Ordinal)) return 0;
        if (ip.StartsWith("192.168.", StringComparison.Ordinal)) return 100;
        if (ip.StartsWith("10.", StringComparison.Ordinal)) return 80;
        if (IPAddress.TryParse(ip, out var parsed) && LanOrigin.IsPrivateOrLinkLocal(parsed)
            && parsed.GetAddressBytes()[0] == 172)
            return 60;
        return 20;
    }

    private static int ScoreAdapter(NetworkInterface ni)
    {
        return ni.NetworkInterfaceType switch
        {
            NetworkInterfaceType.Ethernet => 40,
            NetworkInterfaceType.GigabitEthernet => 40,
            NetworkInterfaceType.FastEthernetT => 40,
            NetworkInterfaceType.Wireless80211 => 0,
            _ => 5
        };
    }

    private static bool IsWirelessAdapter(NetworkInterface ni) =>
        ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211
        || $"{ni.Name} {ni.Description}".Contains("wi-fi", StringComparison.OrdinalIgnoreCase)
        || $"{ni.Name} {ni.Description}".Contains("wireless", StringComparison.OrdinalIgnoreCase)
        || $"{ni.Name} {ni.Description}".Contains("wifi", StringComparison.OrdinalIgnoreCase);

    private static bool IsVirtualAdapter(NetworkInterface ni)
    {
        var text = $"{ni.Name} {ni.Description}".ToLowerInvariant();
        return VirtualHints.Any(h => text.Contains(h, StringComparison.Ordinal));
    }
}
