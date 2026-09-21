using System.Diagnostics;

namespace FOT.Pos.Api.Lan;

public static class LanFirewall
{
    public static void Ensure()
    {
        TryAdd("FOT POS API (TCP 5000)", "TCP", LanNetwork.ApiPort);
        TryAdd("FOT POS LAN Discovery (UDP 49500)", "UDP", LanNetwork.DiscoveryPort);
    }

    public static void EnsureDhcp() => TryAdd("FOT POS Price Checker DHCP (UDP 67)", "UDP", 67);

    private static void TryAdd(string name, string protocol, int port)
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "netsh",
                Arguments = $"advfirewall firewall add rule name=\"{name}\" dir=in action=allow protocol={protocol} localport={port}",
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            process?.WaitForExit(4000);
        }
        catch
        {
            /* LocalSystem can add rules; ignore if netsh is unavailable */
        }
    }
}
