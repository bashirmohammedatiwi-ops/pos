using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class ReceiptsPage : UserControl, IRefreshable
{
    private int _page = 1;
    private bool _filtersLoaded;

    public ReceiptsPage()
    {
        InitializeComponent();
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today;
    }

    public async Task RefreshAsync()
    {
        if (!_filtersLoaded) await LoadFiltersAsync();
        await LoadAsync();
    }

    private async Task LoadFiltersAsync()
    {
        var sections = await AppServices.Api.GetSectionsAsync() ?? [];
        SectionCombo.ItemsSource = new[] { new SectionDto(0, "— الكل —", 0, true, 0) }.Concat(sections).ToList();
        SectionCombo.SelectedIndex = 0;

        var cashiers = await AppServices.Api.GetCashiersAsync(1);
        CashierCombo.ItemsSource = new[] { new CashierFilterRow(0, "— الكل —") }
            .Concat((cashiers?.Items ?? []).Select(c => new CashierFilterRow(c.Id, c.Username))).ToList();
        CashierCombo.SelectedIndex = 0;

        var terminals = await AppServices.Api.GetTerminalsAsync() ?? [];
        PosCombo.ItemsSource = new[] { new PosFilterRow(0, "— الكل —") }
            .Concat(terminals.Select(t => new PosFilterRow(t.Id, t.Name ?? t.HwId ?? $"#{t.Id}"))).ToList();
        PosCombo.SelectedIndex = 0;

        _filtersLoaded = true;
    }

    private async Task LoadAsync()
    {
        long? sectionId = SectionCombo.SelectedItem is SectionDto s && s.Id > 0 ? s.Id : null;
        long? posId = PosCombo.SelectedItem is PosFilterRow p && p.Id > 0 ? p.Id : null;
        long? cashierId = CashierCombo.SelectedItem is CashierFilterRow c && c.Id > 0 ? c.Id : null;
        int? kind = int.TryParse((KindCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString(), out var k) ? k : null;
        if ((KindCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString() == "") kind = null;

        bool? synced = (SyncCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString() switch
        {
            "1" => true,
            "0" => false,
            _ => null
        };

        var res = await AppServices.Api.SearchReceiptsAsync(
            _page, 100, string.IsNullOrWhiteSpace(SearchBox.Text) ? null : SearchBox.Text.Trim(),
            sectionId, posId, cashierId, kind, synced,
            FromDate.SelectedDate, ToDate.SelectedDate);

        if (res is null) return;
        Grid.ItemsSource = res.Items.Select(ReceiptGridRow.From).ToList();
        ResultCountLabel.Text = $"{res.Total:N0} فاتورة";

        var sum = res.Summary;
        SumCount.Text = sum.ReceiptCount.ToString("N0");
        SumNet.Text = MoneyFormat.FormatCurrency(sum.NetTotal);
        SumPaid.Text = MoneyFormat.FormatCurrency(sum.TotalPayment);
        SumDiscount.Text = MoneyFormat.FormatCurrency(sum.TotalOffersDiscount + sum.TotalUserDiscount);
    }

    private async void Grid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (Grid.SelectedItem is ReceiptGridRow row)
            await LoadRowDetailsAsync(row, null);
    }

    private async void Grid_LoadingRowDetails(object sender, DataGridRowDetailsEventArgs e)
    {
        if (e.Row.Item is not ReceiptGridRow row) return;
        await LoadRowDetailsAsync(row, e.DetailsElement);
    }

    private void Grid_UnloadingRowDetails(object sender, DataGridRowDetailsEventArgs e)
    {
        if (e.Row.Item is ReceiptGridRow row)
            row.ResetDetails();
    }

    private static async Task LoadRowDetailsAsync(ReceiptGridRow row, DependencyObject? detailsRoot)
    {
        if (row.DetailLoaded || row.DetailLoading) return;

        row.DetailLoading = true;
        row.SetLoadingStatus();
        try
        {
            var detail = await AppServices.Api.GetReceiptAsync(row.Source.Id);
            if (detail?.Items is { Count: > 0 })
                row.ApplyDetailItems(detail.Items);
            else if (detail is null)
                row.ApplyDetailItems(null, failed: true);
            else
                row.ApplyDetailItems([], empty: true);
        }
        catch
        {
            row.ApplyDetailItems(null, failed: true);
        }
        finally
        {
            row.DetailLoading = false;
            RefreshDetailGrid(detailsRoot, row);
        }
    }

    private static void RefreshDetailGrid(DependencyObject? root, ReceiptGridRow row)
    {
        if (root is null) return;
        if (FindVisualChild<DataGrid>(root) is { } grid)
        {
            grid.ItemsSource = null;
            grid.ItemsSource = row.DetailItems;
        }
    }

    private static T? FindVisualChild<T>(DependencyObject parent) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is T match) return match;
            var nested = FindVisualChild<T>(child);
            if (nested is not null) return nested;
        }
        return null;
    }

    private async void Search_Click(object sender, RoutedEventArgs e) { _page = 1; await LoadAsync(); }
    private async void Clear_Click(object sender, RoutedEventArgs e)
    {
        SearchBox.Text = "";
        SectionCombo.SelectedIndex = 0;
        PosCombo.SelectedIndex = 0;
        CashierCombo.SelectedIndex = 0;
        KindCombo.SelectedIndex = 0;
        SyncCombo.SelectedIndex = 0;
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today;
        _page = 1;
        await LoadAsync();
    }
    private async void Filter_Changed(object sender, SelectionChangedEventArgs e) { if (_filtersLoaded) await LoadAsync(); }
    private async void DateFilter_Changed(object? sender, SelectionChangedEventArgs e) { if (_filtersLoaded) await LoadAsync(); }
    private async void SearchBox_OnKeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) await LoadAsync(); }

    private void ToggleCardColumns_Click(object sender, RoutedEventArgs e)
    {
        if (ReferenceEquals(sender, CardColumnsButton))
            ShowCardInfoBox.IsChecked = ShowCardInfoBox.IsChecked != true;

        var show = ShowCardInfoBox.IsChecked == true;
        var visibility = show ? Visibility.Visible : Visibility.Collapsed;
        foreach (var column in new[]
                 {
                     CardAccNoColumn, CardTypeColumn, CardRrnColumn, CardRefColumn,
                     CardTerminalColumn, CardTimeColumn, CardNameColumn, CardAmountColumn,
                     CardAcquirerColumn, CardAuthColumn
                 })
            column.Visibility = visibility;

        CardColumnsButton.Content = show ? "إخفاء تفاصيل الكارت" : "إظهار تفاصيل الكارت";
    }

    private sealed record CashierFilterRow(long Id, string Username);
    private sealed record PosFilterRow(long Id, string Name);

    public sealed class ReceiptGridRow : INotifyPropertyChanged
    {
        public ReceiptSummaryDto Source { get; init; } = null!;
        public ObservableCollection<ReceiptItemDto> DetailItems { get; } = [];
        public bool DetailLoaded { get; private set; }
        public bool DetailLoading { get; set; }
        public string DetailStatus { get; private set; } = "";

        public void SetLoadingStatus()
        {
            DetailStatus = "جاري التحميل…";
            OnChanged(nameof(DetailStatus));
        }

        public long Id => Source.Id;
        public string DisplayNumber => Source.DisplayNumber;
        public DateTime CreationDate => Source.CreationDate;
        public string? CashierName => Source.CashierName ?? "—";
        public decimal GrossAmount => Source.GrossAmount;
        public decimal Payment => Source.Payment;
        public decimal CashBack => Source.CashBack;
        public decimal OffersDiscount => Source.OffersDiscount;
        public decimal UserDiscount => Source.UserDiscount;
        public decimal NetAmount => Source.NetAmount;
        public int ItemCount => Source.ItemCount;
        public string KindLabel => Source.KindLabel;
        public string AccountName => Blank(Source.AccountName);
        public string? SectionName => Source.SectionName;
        public string SyncLabel => Source.SyncLabel;

        public string CardAmountLabel => Source.CardAmount?.ToString("N0") ?? "—";
        public string CardName => Blank(Source.CardName);
        public string CardAcquirer => Blank(Source.CardAcquirer);
        public string CardAccNo => Blank(Source.CardAccNo);
        public string CardRrn => Blank(Source.CardRrn);
        public string CardTerminalId => Blank(Source.CardTerminalId);
        public string CardAuthCode => Blank(Source.CardAuthCode);
        public string CardTransTimeLabel => Source.CardTransTime?.ToString("dd/MM/yy") ?? "—";
        public string CardType => Blank(Source.CardType);
        public string CardRefNo => Blank(Source.CardRefNo);

        private static string Blank(string? value) => string.IsNullOrWhiteSpace(value) ? "—" : value;

        public static ReceiptGridRow From(ReceiptSummaryDto s) => new() { Source = s };

        public void ResetDetails()
        {
            DetailLoaded = false;
            DetailLoading = false;
            DetailStatus = "";
            DetailItems.Clear();
        }

        public void ApplyDetailItems(IReadOnlyList<ReceiptItemDto>? items, bool failed = false, bool empty = false)
        {
            DetailItems.Clear();
            if (failed)
            {
                DetailItems.Add(new ReceiptItemDto(0, 0, "تعذّر تحميل التفاصيل", null, 0, 0, 0, 0, 0));
                DetailStatus = "خطأ";
            }
            else if (empty)
            {
                DetailItems.Add(new ReceiptItemDto(0, 0, "لا توجد أصناف في هذه الفاتورة", null, 0, 0, 0, 0, 0));
                DetailStatus = "فارغة";
            }
            else if (items is not null)
            {
                foreach (var item in items)
                    DetailItems.Add(item);
                DetailStatus = $"{items.Count} صنف";
            }
            else
            {
                DetailItems.Add(new ReceiptItemDto(0, 0, "تعذّر تحميل التفاصيل", null, 0, 0, 0, 0, 0));
                DetailStatus = "خطأ";
            }

            DetailLoaded = !failed && items is not null;
            OnChanged(nameof(DetailItems));
            OnChanged(nameof(DetailStatus));
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        private void OnChanged([CallerMemberName] string? name = null) =>
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
