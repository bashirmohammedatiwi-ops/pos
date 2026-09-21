using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class OfferAddProductDialog : Window
{
    private ProductDto? _selected;

    public int DetailRole { get; set; }
    public bool RequirePercent { get; set; } = true;
    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidTo { get; set; }
    public bool Unlimited { get; set; } = true;

    public UpsertOfferDetailRequest? Result { get; private set; }

    public OfferAddProductDialog()
    {
        InitializeComponent();
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today.AddMonths(1);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        DiscountFields.Visibility = RequirePercent ? Visibility.Visible : Visibility.Collapsed;
        Title = RequirePercent ? "إضافة منتج — نسبة خصم %" : "إضافة منتج مطلوب للمجموعة";
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchAsync();

    private async void SearchBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await SearchAsync();
    }

    private async Task SearchAsync()
    {
        var q = SearchBox.Text.Trim();
        if (q.Length < 2) { MessageBox.Show("أدخل حرفين على الأقل"); return; }
        ProductsGrid.ItemsSource = await Services.AppServices.Api.SearchProductsAsync(q);
    }

    private void ProductsGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = ProductsGrid.SelectedItem as ProductDto;
        DiscountPanel.IsEnabled = _selected is not null;
        SelectedProductLabel.Text = _selected is null
            ? "—"
            : string.IsNullOrWhiteSpace(_selected.OfferName)
                ? $"{_selected.Name} — {_selected.OriginalPrice:N0}"
                : $"{_selected.Name} — {_selected.OriginalPrice:N0}\nموجود في عرض آخر: {_selected.OfferName}";
    }

    private void Add_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) { MessageBox.Show("اختر منتجاً"); return; }

        decimal discount = 0;
        if (RequirePercent)
        {
            if (!decimal.TryParse(PercentBox.Text, out discount) || discount <= 0 || discount > 100)
            {
                MessageBox.Show("أدخل نسبة بين 1 و 100");
                return;
            }
        }

        var unlimited = UnlimitedBox.IsChecked == true;
        Result = new UpsertOfferDetailRequest(
            _selected.Seq,
            discount,
            0,
            unlimited ? null : ValidFrom ?? FromDate.SelectedDate,
            unlimited ? null : ValidTo ?? ToDate.SelectedDate,
            unlimited,
            DetailRole);

        DialogResult = true;
    }

    private void UnlimitedBox_OnChanged(object sender, RoutedEventArgs e)
    {
        var unlimited = UnlimitedBox.IsChecked == true;
        FromDate.IsEnabled = !unlimited;
        ToDate.IsEnabled = !unlimited;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
