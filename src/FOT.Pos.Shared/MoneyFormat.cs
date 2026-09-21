namespace FOT.Pos.Shared;

public static class MoneyFormat
{
    public const string CurrencySymbol = "د.ع";

    public static string FormatAmount(decimal value) =>
        string.Format(System.Globalization.CultureInfo.GetCultureInfo("en-US"), "{0:N0}", value);

    public static string FormatCurrency(decimal value) => $"{FormatAmount(value)} {CurrencySymbol}";

    public static string FormatDateTime(DateTime value) =>
        value.ToString("dd/MM/yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture);
}
