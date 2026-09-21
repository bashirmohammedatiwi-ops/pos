using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class ProductsPage : UserControl, IRefreshable
{
    private int _page = 1;
    private int _totalPages = 1;
    private string? _search;

    public ProductsPage()
    {
        InitializeComponent();
        Loaded += async (_, _) => await LoadAsync();
    }

    public Task RefreshAsync() => LoadAsync();

    private async Task LoadAsync()
    {
        var res = await AppServices.Api.GetProductsAsync(_page, _search);
        if (res is null) return;

        Grid.ItemsSource = res.Items;
        _totalPages = Math.Max(1, res.TotalPages);
        if (_page > _totalPages && res.TotalPages > 0)
        {
            _page = _totalPages;
            await LoadAsync();
            return;
        }

        TotalBadge.Text = $"{MoneyFormat.FormatAmount(res.Total)} منتج";
        PageBadge.Text = $"صفحة {res.Page} / {_totalPages}";
        PageLabel.Text = $"{res.Page} / {_totalPages}";

        if (res.Total == 0)
            RangeLabel.Text = string.IsNullOrWhiteSpace(_search) ? "لا توجد منتجات" : "لا توجد نتائج للبحث";
        else
        {
            var start = (res.Page - 1) * res.PageSize + 1;
            var end = Math.Min(res.Page * res.PageSize, res.Total);
            RangeLabel.Text = $"عرض {MoneyFormat.FormatAmount(start)}–{MoneyFormat.FormatAmount(end)} من {MoneyFormat.FormatAmount(res.Total)}";
        }

        var hasItems = res.Items.Count > 0;
        EmptyPanel.Visibility = hasItems ? Visibility.Collapsed : Visibility.Visible;
        Grid.Visibility = hasItems ? Visibility.Visible : Visibility.Collapsed;

        PrevBtn.IsEnabled = res.Page > 1;
        NextBtn.IsEnabled = res.Page < _totalPages && res.TotalPages > 0;
    }

    private async void Search_Click(object sender, RoutedEventArgs e)
    {
        _page = 1;
        _search = string.IsNullOrWhiteSpace(SearchBox.Text) ? null : SearchBox.Text.Trim();
        await LoadAsync();
    }

    private async void ClearSearch_Click(object sender, RoutedEventArgs e)
    {
        SearchBox.Text = string.Empty;
        _page = 1;
        _search = null;
        await LoadAsync();
    }

    private void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            Search_Click(sender, e);
    }

    private async void Prev_Click(object sender, RoutedEventArgs e)
    {
        if (_page <= 1) return;
        _page--;
        await LoadAsync();
    }

    private async void Next_Click(object sender, RoutedEventArgs e)
    {
        if (_page >= _totalPages) return;
        _page++;
        await LoadAsync();
    }

    private async void Grid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (Grid.SelectedItem is not ProductDto p) return;
        var dlg = new ProductEditDialog(p);
        if (dlg.ShowDialog() != true || dlg.Result is null) return;
        if (await AppServices.Api.UpdateProductAsync(p.Id, dlg.Result))
        {
            MessageBox.Show("تم التحديث");
            await LoadAsync();
        }
    }
}
