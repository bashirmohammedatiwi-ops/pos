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
}
