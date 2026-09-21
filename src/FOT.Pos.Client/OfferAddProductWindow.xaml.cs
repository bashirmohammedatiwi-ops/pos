using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class OfferAddProductWindow : Window
{
    private ProductDto? _selected;

    public int DetailRole { get; set; }
    public bool RequirePercent { get; set; } = true;
    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidTo { get; set; }
    public bool Unlimited { get; set; } = true;

    public UpsertOfferDetailRequest? Result { get; private set; }

    public OfferAddProductWindow()
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        Loaded += (_, _) => SearchBox.Focus();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        DiscountPanel.Visibility = RequirePercent ? Visibility.Visible : Visibility.Collapsed;
        TitleLabel.Text = RequirePercent ? "إضافة منتج — نسبة خصم %" : "إضافة منتج مطلوب للمجموعة";
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchAsync();

    private async void SearchBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await SearchAsync();
    }

    private async Task SearchAsync()
    {
        var q = SearchBox.Text.Trim();
        if (q.Length < 2) return;
        ProductsGrid.ItemsSource = await AppServices.Api.SearchProductsAsync(q);
    }

    private void ProductsGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = ProductsGrid.SelectedItem as ProductDto;
        AddBtn.IsEnabled = _selected is not null;
        SelectedProductLabel.Text = _selected?.Name ?? "—";
    }

    private void Add_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;

        decimal discount = 0;
        if (RequirePercent)
        {
            if (!decimal.TryParse(PercentBox.Text, out discount) || discount <= 0 || discount > 100)
            {
                return;
            }
        }

        Result = new UpsertOfferDetailRequest(
            _selected.Seq, discount, 0,
            Unlimited ? null : ValidFrom,
            Unlimited ? null : ValidTo,
            Unlimited,
            DetailRole);

        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);
}
