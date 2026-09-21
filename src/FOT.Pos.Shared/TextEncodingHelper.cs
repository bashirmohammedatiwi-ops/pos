using System.Text;
using System.Text.RegularExpressions;

namespace FOT.Pos.Shared;

public static class TextEncodingHelper
{
    public static string FixUtf8Mojibake(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return text ?? "";
        if (Regex.IsMatch(text, @"^[\u0600-\u06FF\s\u0660-\u0669.,\-_]+$")) return text;

        try
        {
            var latin = Encoding.GetEncoding(1252);
            var bytes = latin.GetBytes(text);
            var utf8 = Encoding.UTF8.GetString(bytes);
            if (utf8 != text && Regex.IsMatch(utf8, @"[\u0600-\u06FF]{2,}"))
                return utf8;
        }
        catch
        {
            /* keep original */
        }

        return text;
    }

    public static string UserDisplayLabel(string username, string? displayName)
    {
        var fixedName = FixUtf8Mojibake(displayName?.Trim());
        if (!string.IsNullOrWhiteSpace(fixedName) && Regex.IsMatch(fixedName, @"[\u0600-\u06FFa-zA-Z]{2,}"))
            return fixedName;
        return username;
    }
}
