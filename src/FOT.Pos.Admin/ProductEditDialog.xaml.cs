using System.Windows;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class ProductEditDialog : Window
{
    public UpdateProductRequest? Result { get; private set; }

    public ProductEditDialog(ProductDto product)
    {
        InitializeComponent();
        Title = $"تعديل — {product.Name}";
        NameBox.Text = product.Name ?? "";
        BarcodeBox.Text = product.Barcode ?? "";
        OriginalPriceBox.Text = product.OriginalPrice.ToString("N0");
        FinalPriceBox.Text = product.Price.ToString("N0");
        StockBox.Text = product.Stock.ToString("N0");
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        decimal? op = decimal.TryParse(OriginalPriceBox.Text, out var o) ? o : null;
        decimal? fp = decimal.TryParse(FinalPriceBox.Text, out var f) ? f : null;
        decimal? st = decimal.TryParse(StockBox.Text, out var s) ? s : null;
        Result = new UpdateProductRequest(
            string.IsNullOrWhiteSpace(NameBox.Text) ? null : NameBox.Text.Trim(),
            string.IsNullOrWhiteSpace(BarcodeBox.Text) ? null : BarcodeBox.Text.Trim(),
            op, fp, st);
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
