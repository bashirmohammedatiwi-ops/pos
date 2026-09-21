using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace FOT.Pos.ServerHost.Services;

internal static class NetworkInfoService
{
    public static IReadOnlyList<string> GetLanAddresses()
    {
        var ips = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;

                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    if (IPAddress.IsLoopback(ua.Address)) continue;
                    ips.Add(ua.Address.ToString());
                }
            }
        }
        catch
        {
            // ignore
        }

        if (ips.Count == 0)
        {
            try
            {
                foreach (var addr in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (addr.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr))
                        ips.Add(addr.ToString());
                }
            }
            catch
            {
                // ignore
            }
        }

        return ips.OrderBy(ip => ip, StringComparer.Ordinal).ToList();
    }

    public static string FormatLanUrls(int port) =>
        string.Join("\n", GetLanAddresses().Select(ip => $"http://{ip}:{port}"));
}
