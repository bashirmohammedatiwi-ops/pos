namespace FOT.Pos.Shared;

/// <summary>
/// Receipt display numbers: {year}{cashierCode}{sequence:000000}
/// e.g. 20261000001 = 2026, cashier 1, invoice 1.
/// </summary>
public static class ReceiptNumberFormatter
{
    public const int MaxSequence = 999_999;

    public static long Compose(int year, int cashierCode, int sequence)
    {
        if (year < 2000 || year > 9999)
            throw new ArgumentOutOfRangeException(nameof(year));
        if (cashierCode <= 0)
            throw new ArgumentOutOfRangeException(nameof(cashierCode));
        if (sequence <= 0 || sequence > MaxSequence)
            throw new ArgumentOutOfRangeException(nameof(sequence));

        return long.Parse($"{year}{cashierCode}{sequence:D6}");
    }

    public static string Format(long number) => number > 0 ? number.ToString() : "—";

    /// <summary>
    /// Inverse of <see cref="Compose"/>: year (4) + cashier code (1+) + sequence (6).
    /// </summary>
    public static bool TryDecompose(long number, out int year, out int cashierCode, out int sequence)
    {
        year = 0;
        cashierCode = 0;
        sequence = 0;
        var text = number.ToString();
        if (text.Length < 11) return false;
        if (!int.TryParse(text[..4], out year) || year < 2000 || year > 9999) return false;
        if (!int.TryParse(text[^6..], out sequence) || sequence <= 0 || sequence > MaxSequence) return false;
        if (!int.TryParse(text[4..^6], out cashierCode) || cashierCode <= 0) return false;
        return Compose(year, cashierCode, sequence) == number;
    }
}
