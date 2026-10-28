using System.Text.RegularExpressions;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// تحليل مخرجات netsh wlan بغض النظر عن لغة ويندوز: كلمتا SSID و BSSID لا تُترجمان،
/// وبقية الحقول تُعرف من شكل القيمة (نسبة الإشارة %، رقم القناة، النطاق GHz).
/// </summary>
public static partial class WifiScan
{
    public sealed record AccessPoint(string Bssid, int? Signal, int? Channel, string? Band);
    public sealed record Network(string Ssid, string? Auth, List<AccessPoint> AccessPoints);
    public sealed record Current(string? Ssid, string? Bssid, int? Signal);

    [GeneratedRegex(@"^\s*SSID\s+\d+\s*:\s*(.*)$")]
    private static partial Regex SsidLine();
    [GeneratedRegex(@"^\s*BSSID\s+\d+\s*:\s*([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})")]
    private static partial Regex BssidLine();
    [GeneratedRegex(@"^\s*[^:]+?\s*:\s*(.+?)\s*$")]
    private static partial Regex Field();
    [GeneratedRegex(@"BSSID\s*:\s*([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})")]
    private static partial Regex IfaceBssid();
    [GeneratedRegex(@"^\s*SSID\s*:\s*(.*)$")]
    private static partial Regex IfaceSsid();

    public static List<Network> ParseNetworks(string text)
    {
        var list = new List<Network>();
        Network? net = null;
        string? bssid = null;
        int? signal = null, channel = null;
        string? band = null;
        var fieldIndex = 0;

        void FlushAp()
        {
            if (net is not null && bssid is not null)
                net.AccessPoints.Add(new AccessPoint(bssid, signal, channel, band));
            bssid = null;
            signal = channel = null;
            band = null;
        }

        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            var s = SsidLine().Match(line);
            if (s.Success)
            {
                FlushAp();
                net = new Network(s.Groups[1].Value.Trim(), null, []);
                list.Add(net);
                fieldIndex = 0;
                continue;
            }
            var b = BssidLine().Match(line);
            if (b.Success)
            {
                FlushAp();
                bssid = b.Groups[1].Value.ToLowerInvariant();
                continue;
            }
            var f = Field().Match(line);
            if (!f.Success || net is null) continue;
            var value = f.Groups[1].Value;
            if (bssid is null)
            {
                // بعد SSID: نوع الشبكة ثم المصادقة ثم التشفير — المصادقة هي الحقل الثاني
                fieldIndex++;
                if (fieldIndex == 2) list[^1] = net = net with { Auth = value };
                continue;
            }
            if (signal is null && Regex.IsMatch(value, @"^\d{1,3}\s*%$")) signal = int.Parse(value.TrimEnd('%', ' '));
            else if (band is null && value.Contains("GHz", StringComparison.OrdinalIgnoreCase)) band = value;
            else if (channel is null && Regex.IsMatch(value, @"^\d{1,3}$")) channel = int.Parse(value);
        }
        FlushAp();
        // الشبكات المخفية بلا اسم تبقى (قد تكون شبكة المحل)، والأقوى أولاً
        return list
            .Where(n => n.AccessPoints.Count > 0)
            .Select(n => n with { AccessPoints = n.AccessPoints.OrderByDescending(a => a.Signal ?? 0).ToList() })
            .OrderByDescending(n => n.AccessPoints.Max(a => a.Signal ?? 0))
            .ToList();
    }

    public static Current? ParseInterface(string text)
    {
        string? ssid = null, bssid = null;
        int? signal = null;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            var b = IfaceBssid().Match(line);
            if (b.Success) { bssid ??= b.Groups[1].Value.ToLowerInvariant(); continue; }
            var s = IfaceSsid().Match(line);
            if (s.Success) { ssid ??= s.Groups[1].Value.Trim(); continue; }
            var f = Field().Match(line);
            if (f.Success && signal is null && bssid is not null && Regex.IsMatch(f.Groups[1].Value, @"^\d{1,3}\s*%$"))
                signal = int.Parse(f.Groups[1].Value.TrimEnd('%', ' '));
        }
        return bssid is null ? null : new Current(ssid, bssid, signal);
    }
}
