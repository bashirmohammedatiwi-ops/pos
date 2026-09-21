using System.Net;
using System.Net.Sockets;

namespace FOT.Pos.Api.Lan;

public static class LanOrigin
{
    public static bool IsAllowed(string origin, ISet<string> allowedOrigins)
    {
        if (string.IsNullOrEmpty(origin) || origin == "null") return true;
        if (origin.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return true;
        if (origin.StartsWith("fot:", StringComparison.OrdinalIgnoreCase)) return true;
        if (allowedOrigins.Contains(origin)) return true;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
        if (!uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;

        var host = uri.Host;
        if (host is "localhost" or "127.0.0.1" or "::1" or "[::1]") return true;
        return IPAddress.TryParse(host, out var ip) && IsPrivateOrLinkLocal(ip);
    }

    public static bool IsPrivateOrLinkLocal(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily != AddressFamily.InterNetwork) return false;

        var b = ip.GetAddressBytes();
        if (b[0] == 10) return true;
        if (b[0] == 192 && b[1] == 168) return true;
        if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;
        if (b[0] == 169 && b[1] == 254) return true;
        return false;
    }
}
