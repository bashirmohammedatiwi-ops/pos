using System.Text;
using System.Text.RegularExpressions;

namespace EdariPerfumeProbe;

static class EdariStringHelper
{
    private static readonly Regex MultiSpace = new(@"\s{2,}", RegexOptions.Compiled);

    static EdariStringHelper()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public static string? ReadString(object? value)
    {
        if (value is null or DBNull) return null;
        if (value is byte[] bytes) return DecodeBytes(bytes);
        return Normalize(Convert.ToString(value));
    }

    public static string? Normalize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        text = text.Replace('\uFFFD', ' ').Trim();
        text = MultiSpace.Replace(text, " ").Trim();
        if (string.IsNullOrEmpty(text)) return null;
        try
        {
            var latin = Encoding.GetEncoding(1252);
            var bytes = latin.GetBytes(text);
            var utf8 = Encoding.UTF8.GetString(bytes);
            if (utf8 != text && HasArabic(utf8)) return MultiSpace.Replace(utf8.Trim(), " ");
        }
        catch { /* keep */ }
        return text;
    }

    private static string? DecodeBytes(byte[] bytes)
    {
        if (bytes.Length == 0) return null;
        var trimmed = bytes.AsSpan().TrimEnd((byte)0).ToArray();
        foreach (var enc in new[] { 1256, 1252, 28596 })
        {
            try
            {
                var s = Normalize(Encoding.GetEncoding(enc).GetString(trimmed));
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
            catch { /* next */ }
        }
        return Normalize(Encoding.UTF8.GetString(trimmed));
    }

    public static bool HasArabic(string? text) =>
        !string.IsNullOrWhiteSpace(text) &&
        Regex.IsMatch(text, @"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]{2,}");

    public static string? MergeNames(string? edari, string? legacy)
    {
        edari = Normalize(edari);
        legacy = Normalize(legacy);
        if (HasArabic(legacy) && !HasArabic(edari)) return legacy;
        if (!string.IsNullOrWhiteSpace(legacy) && string.IsNullOrWhiteSpace(edari)) return legacy;
        if (!string.IsNullOrWhiteSpace(edari) && string.IsNullOrWhiteSpace(legacy)) return edari;
        if (!string.IsNullOrWhiteSpace(edari) && !string.IsNullOrWhiteSpace(legacy))
            return HasArabic(legacy) ? legacy : (legacy.Length > edari.Length ? legacy : edari);
        return legacy ?? edari;
    }
}
