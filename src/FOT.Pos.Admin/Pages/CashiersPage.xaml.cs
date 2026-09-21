using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class CashiersPage : UserControl, IRefreshable
{
    private int _page = 1;
    private int _totalPages = 1;
    private string? _search;
    private List<SectionDto> _sections = [];

    public CashiersPage()
    {
        InitializeComponent();
        Loaded += async (_, _) => await InitAsync();
    }

    public async Task RefreshAsync() => await LoadAsync();

    private async Task InitAsync()
    {
        try
        {
            _sections = await AppServices.Api.GetSectionsAsync() ?? [];
            if (_sections.Count == 0)
            {
                var summaries = await AppServices.Api.GetSectionSummariesAsync();
                if (summaries is null)
                    MessageBox.Show("تعذّر تحميل الأقسام — تحقق من اتصال API وتطبيق تحديثات قاعدة البيانات");
            }
            await LoadAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"تعذّر تحميل بيانات الكاشير:\n{ex.Message}", "خطأ", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task LoadAsync()
    {
        var res = await AppServices.Api.GetCashiersAsync(_page, _search);
        if (res is null) return;

        Grid.ItemsSource = res.Items;
        _totalPages = Math.Max(1, res.TotalPages);

        KpiTotal.Text = MoneyFormat.FormatAmount(res.Total);
        KpiActive.Text = MoneyFormat.FormatAmount(res.Items.Count(c => c.Active));
        KpiInactive.Text = MoneyFormat.FormatAmount(res.Items.Count(c => !c.Active));
        PageLabel.Text = $"{res.Page} / {_totalPages}";

        if (res.Total == 0)
            RangeLabel.Text = "لا يوجد كاشير";
        else
        {
            var start = (res.Page - 1) * res.PageSize + 1;
            var end = Math.Min(res.Page * res.PageSize, res.Total);
            RangeLabel.Text = $"عرض {start}–{end} من {res.Total}";
        }

        var hasItems = res.Items.Count > 0;
        EmptyPanel.Visibility = hasItems ? Visibility.Collapsed : Visibility.Visible;
        Grid.Visibility = hasItems ? Visibility.Visible : Visibility.Collapsed;
        PrevBtn.IsEnabled = res.Page > 1;
        NextBtn.IsEnabled = res.Page < _totalPages && res.TotalPages > 0;
    }

    private async void Add_Click(object sender, RoutedEventArgs e)
    {
        if (_sections.Count == 0)
        {
            MessageBox.Show("أضف قسم نقطة بيع أولاً من شاشة الأقسام");
            return;
        }

        var dlg = new CashierEditDialog(_sections) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.CreateResult is null) return;

        var (id, err) = await AppServices.Api.CreateCashierAsync(dlg.CreateResult);
        if (!id.HasValue)
        {
            MessageBox.Show(err ?? "فشل إنشاء الكاشير");
            return;
        }

        MessageBox.Show("تم إضافة الكاشير");
        await LoadAsync();
    }

    private async void Grid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (Grid.SelectedItem is not CashierDto cashier) return;
        await EditCashierAsync(cashier);
    }

    private async Task EditCashierAsync(CashierDto cashier)
    {
        var detail = await AppServices.Api.GetCashierDetailAsync(cashier.Id);
        if (detail is null)
        {
            MessageBox.Show("تعذّر تحميل بيانات الكاشير");
            return;
        }

        var dlg = new CashierEditDialog(_sections, detail) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.UpdateResult is null) return;

        var (ok, err) = await AppServices.Api.UpdateCashierAsync(cashier.Id, dlg.UpdateResult);
        if (!ok)
        {
            MessageBox.Show(err ?? "فشل التحديث");
            return;
        }

        MessageBox.Show("تم التحديث");
        await LoadAsync();
    }

    private async void Search_Click(object sender, RoutedEventArgs e)
    {
        _page = 1;
        _search = string.IsNullOrWhiteSpace(SearchBox.Text) ? null : SearchBox.Text.Trim();
        await LoadAsync();
    }

    private async void ClearSearch_Click(object sender, RoutedEventArgs e)
    {
        SearchBox.Text = "";
        _search = null;
        _page = 1;
        await LoadAsync();
    }

    private void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Search_Click(sender, e);
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
}
