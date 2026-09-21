using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared;

namespace FOT.Pos.Client;

public partial class PriceCheckerWindow : Window
{
    public PriceCheckerWindow()
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        Loaded += (_, _) => BarcodeBox.Focus();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);

    private async void BarcodeBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        var code = BarcodeBox.Text.Trim();
        if (string.IsNullOrEmpty(code)) return;

        var p = await AppServices.Api.GetByBarcodeAsync(code);
        if (p is null)
        {
            ProductName.Text = "المنتج غير موجود";
            ProductName.Foreground = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26));
            ProductPrice.Text = "";
            OfferLabel.Text = "";
            ResultCard.Background = new SolidColorBrush(Color.FromRgb(0xFE, 0xF2, 0xF2));
            ResultCard.BorderBrush = new SolidColorBrush(Color.FromRgb(0xFE, 0xCA, 0xCA));
            BarcodeBox.SelectAll();
            return;
        }

        ProductName.Text = p.Name ?? p.Barcode ?? "—";
        ProductName.Foreground = (Brush)FindResource("InkBrush");
        ProductPrice.Text = MoneyFormat.FormatCurrency(p.Price);
        OfferLabel.Text = p.DiscountPercent > 0 ? $"خصم {p.DiscountPercent:N0}%  ·  {p.OfferName}" : "";
        ResultCard.Background = new SolidColorBrush(Color.FromRgb(0xF0, 0xFD, 0xF9));
        ResultCard.BorderBrush = new SolidColorBrush(Color.FromRgb(0xA7, 0xF3, 0xD0));
        BarcodeBox.SelectAll();
    }
}
