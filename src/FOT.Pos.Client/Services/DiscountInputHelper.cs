using System.Globalization;

namespace FOT.Pos.Client.Services;

public static class DiscountInputHelper
{
    public static string NormalizeRaw(string? text) =>
        (text ?? "").Replace(",", "").Replace(" ", "").Trim();

    public static string FormatForDisplay(string? raw, bool amountMode)
    {
        var norm = NormalizeRaw(raw);
        if (string.IsNullOrEmpty(norm)) return "";
        if (!amountMode) return norm;

        if (!decimal.TryParse(norm, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) &&
            !decimal.TryParse(norm, out v))
            return norm;

        return v.ToString("N0", CultureInfo.InvariantCulture);
    }

    public static bool TryParseAmount(string? text, out decimal value)
    {
        value = 0;
        var norm = NormalizeRaw(text);
        if (string.IsNullOrEmpty(norm)) return false;
        return decimal.TryParse(norm, NumberStyles.Any, CultureInfo.InvariantCulture, out value) ||
               decimal.TryParse(norm, out value);
    }
}
