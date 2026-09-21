using System.Globalization;
using System.Windows;
using System.Windows.Input;
using FOT.Pos.Client.Services;

namespace FOT.Pos.Client;

public partial class PriceInputDialog : Window
{
    public decimal Price { get; private set; }

    public PriceInputDialog(string productName, decimal currentPrice, decimal originalPrice)
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        ProductLabel.Text = productName;
        OriginalLabel.Text = originalPrice > 0 ? $"السعر الأصلي: {originalPrice:N0} د.ع" : "";
        PriceBox.Text = currentPrice.ToString("N0", CultureInfo.InvariantCulture);
        Loaded += (_, _) => { PriceBox.SelectAll(); PriceBox.Focus(); };
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        var raw = PriceBox.Text.Replace(",", "").Trim();
        if (!decimal.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var price) &&
            !decimal.TryParse(raw, out price))
        {
            ErrorLabel.Text = "أدخل سعراً صحيحاً";
            ErrorLabel.Visibility = Visibility.Visible;
            return;
        }
        if (price < 0)
        {
            ErrorLabel.Text = "السعر لا يمكن أن يكون سالباً";
            ErrorLabel.Visibility = Visibility.Visible;
            return;
        }
        Price = price;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);

    private void PriceBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Ok_Click(sender, e);
    }
}
