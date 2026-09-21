using System.Text;
using System.Text.RegularExpressions;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// NexusDB ADO often returns Arabic as U+FFFD when Windows-1256 bytes are mis-decoded.
/// We strip replacement chars and normalize spacing; ODBC mode may preserve Arabic better.
/// </summary>
public static class EdariStringHelper
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

        // UTF-8 misread as Latin-1 (common in web/JSON paths)
        try
        {
            var latin = Encoding.GetEncoding(1252);
            var bytes = latin.GetBytes(text);
            var utf8 = Encoding.UTF8.GetString(bytes);
            if (utf8 != text && ArabicRun(utf8)) return MultiSpace.Replace(utf8.Trim(), " ");
        }
        catch
        {
            /* keep original */
        }

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
            catch
            {
                /* try next */
            }
        }

        return Normalize(Encoding.UTF8.GetString(trimmed));
    }

    public static bool IsReadableName(string? text) => IsReadable(text);

    private static bool IsReadable(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        if (text.Contains('\uFFFD')) return false;
        return System.Text.RegularExpressions.Regex.IsMatch(text, @"[\p{L}\p{N}]");
    }

    /// <summary>Authoritative branch label when syncing POS sections from Edari FileBrch.</summary>
    public static string ResolveBranchSyncName(string? edariRawName, string? mergedName, string? symbol, long seq)
    {
        if (IsReadable(mergedName)) return mergedName!;
        if (IsReadable(edariRawName)) return edariRawName!;
        return FormatLabel(edariRawName, symbol, seq);
    }

    public static string FormatLabel(string? name, string? symbol, long seq, string prefix = "فرع Edari")
    {
        var n = Normalize(name);
        if (IsReadable(n)) return n!;
        var sym = Normalize(symbol);
        if (IsReadable(sym)) return sym!;
        return $"{prefix} {seq}";
    }

    public static bool HasArabic(string? text) =>
        !string.IsNullOrWhiteSpace(text) && ArabicRun(text!);

    /// <summary>Product / tree names come from Edari File13n only — never HAYAT2025.</summary>
    public static string? PreferEdariProductName(string? edari)
    {
        var name = Normalize(edari);
        return IsReadable(name) ? name : null;
    }

    /// <summary>
    /// Prefer Hayat/legacy Arabic when Edari ADO strips or corrupts Name1.
    /// Used for salesmen/accounts only — product names use <see cref="PreferEdariProductName"/>.
    /// </summary>
    public static string? MergeNames(string? edari, string? legacy)
    {
        edari = Normalize(edari);
        legacy = Normalize(legacy);

        if (HasArabic(legacy) && !HasArabic(edari)) return legacy;
        if (IsReadable(legacy) && !IsReadable(edari)) return legacy;
        if (IsReadable(edari) && !IsReadable(legacy)) return edari;

        if (IsReadable(edari) && IsReadable(legacy))
        {
            if (legacy!.Length > edari!.Length + 2) return legacy;
            if (edari.Length > legacy.Length + 2) return edari;
            return HasArabic(legacy) ? legacy : edari;
        }

        return legacy ?? edari;
    }

    private static bool ArabicRun(string s) =>
        Regex.IsMatch(s, @"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]{2,}");
}
