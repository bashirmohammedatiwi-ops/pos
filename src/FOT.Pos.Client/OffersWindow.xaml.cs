using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class OffersWindow : Window
{
    private List<OfferDto> _offers = [];
    private OfferDto? _selected;
    private List<OfferDetailDto> _allDetails = [];

    public OffersWindow()
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today.AddMonths(1);
        Loaded += async (_, _) => await LoadOffersAsync();
    }

    private async Task LoadOffersAsync()
    {
        var res = await AppServices.Api.GetOffersAsync();
        _offers = res?.Items?.ToList() ?? [];
        ApplyOfferFilter();
        StatsLabel.Text = $"إجمالي {_offers.Count} مجموعة · {_offers.Count(o => o.Enabled)} نشطة · {_offers.Sum(o => o.DetailCount):N0} بند";
    }

    private void ApplyOfferFilter()
    {
        var q = OfferSearchBox.Text.Trim();
        var filtered = string.IsNullOrWhiteSpace(q)
            ? _offers
            : _offers.Where(o => o.Name.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
        OffersList.ItemsSource = filtered.Select(OfferListItem.From).ToList();
        if (_selected is not null)
            OffersList.SelectedItem = OffersList.Items.Cast<OfferListItem>().FirstOrDefault(i => i.Id == _selected.Id);
    }

    private void OfferSearchBox_OnTextChanged(object sender, TextChangedEventArgs e) => ApplyOfferFilter();

    private async void OffersList_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = OffersList.SelectedItem is OfferListItem row ? row.Source : null;
        var has = _selected is not null;
        SettingsPanel.IsEnabled = has;
        DetailsPanel.IsEnabled = has;
        DeleteOfferBtn.IsEnabled = has;

        if (_selected is null)
        {
            _allDetails = [];
            DiscountGrid.ItemsSource = null;
            RequiredGrid.ItemsSource = null;
            TreeBatchGrid.ItemsSource = null;
            return;
        }

        OfferNameBox.Text = _selected.Name;
        OfferPriorityBox.Text = _selected.Priority.ToString();
        OfferEnabledBox.IsChecked = _selected.Enabled;
        OfferTypeCombo.SelectedIndex = _selected.Type == 1 ? 1 : 0;
        UpdateTabsVisibility();
        await LoadDetailsAsync();
    }

    private void OfferTypeCombo_OnSelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateTabsVisibility();

    private void UpdateTabsVisibility()
    {
        var isBundle = GetOfferType() == 1;
        RequiredTab.Visibility = isBundle ? Visibility.Visible : Visibility.Collapsed;
    }

    private int GetOfferType() =>
        int.TryParse((OfferTypeCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString(), out var t) ? t : 0;

    private async Task LoadDetailsAsync()
    {
        if (_selected is null) return;
        var details = await AppServices.Api.GetOfferDetailsAsync(_selected.Id);
        _allDetails = details?.ToList() ?? [];

        var discounted = _allDetails.Where(d => d.DetailRole == 0).ToList();
        DiscountGrid.ItemsSource = discounted.Select(DetailRow.From).ToList();

        var required = _allDetails.Where(d => d.DetailRole == 1).ToList();
        RequiredGrid.ItemsSource = required.Select(r => new RequiredRow(r)).ToList();

        TreeBatchGrid.ItemsSource = discounted
            .Where(d => d.SourceTreeSeq.HasValue)
            .GroupBy(d => d.SourceTreeSeq!.Value)
            .Select(g => new TreeBatchRow(
                g.Key,
                g.First().SourceTreeName ?? $"شجرة #{g.Key}",
                g.Count(),
                g.First().Discount))
            .ToList();

        SummaryProducts.Text = $"أصناف مخفّضة: {discounted.Count(d => !d.SourceTreeSeq.HasValue):N0}";
        SummaryTrees.Text = $"دفعات شجرات: {discounted.Where(d => d.SourceTreeSeq.HasValue).Select(d => d.SourceTreeSeq).Distinct().Count():N0}";
        SummaryRequired.Text = $"أصناف مطلوبة: {required.Count:N0}";
    }

    private (DateTime? from, DateTime? to, bool unlimited) ReadValidity()
    {
        var unlimited = UnlimitedBox.IsChecked == true;
        return unlimited
            ? (null, null, true)
            : (FromDate.SelectedDate, ToDate.SelectedDate, false);
    }

    private void UnlimitedBox_OnChanged(object sender, RoutedEventArgs e)
    {
        var u = UnlimitedBox.IsChecked == true;
        FromDate.IsEnabled = !u;
        ToDate.IsEnabled = !u;
    }

    private async void CreateOffer_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OfferCreateWindow();
        if (PosOverlay.Show(dlg, this) != true || dlg.Result is null) return;
        if (!await AppServices.Api.CreateOfferAsync(dlg.Result))
        {
            MessageBox.Show("فشل إنشاء العرض", "خطأ", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private async void SaveOffer_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        if (string.IsNullOrWhiteSpace(OfferNameBox.Text))
        {
            MessageBox.Show("أدخل اسم العرض");
            return;
        }
        if (!int.TryParse(OfferPriorityBox.Text, out var priority)) priority = 1;

        var req = new UpdateOfferRequest(
            OfferNameBox.Text.Trim(), priority, GetOfferType(), OfferEnabledBox.IsChecked == true);

        if (!await AppServices.Api.UpdateOfferAsync(_selected.Id, req))
        {
            MessageBox.Show("فشل حفظ العرض");
            return;
        }
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private async void DeleteOffer_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        if (MessageBox.Show($"حذف عرض «{_selected.Name}» وجميع بنوده؟", "تأكيد",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        if (!await AppServices.Api.DeleteOfferAsync(_selected.Id))
        {
            MessageBox.Show("فشل الحذف");
            return;
        }
        _selected = null;
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private async void AddProduct_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var (from, to, unlimited) = ReadValidity();
        var dlg = new OfferAddProductWindow
        {
            DetailRole = 0,
            RequirePercent = true,
            ValidFrom = from,
            ValidTo = to,
            Unlimited = unlimited
        };
        if (PosOverlay.Show(dlg, this) != true || dlg.Result is null) return;
        if (!await AppServices.Api.AddOfferDetailAsync(_selected.Id, dlg.Result))
        {
            MessageBox.Show("فشل إضافة المنتج");
            return;
        }
        await LoadDetailsAsync();
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private async void AddRequired_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var (from, to, unlimited) = ReadValidity();
        var dlg = new OfferAddProductWindow
        {
            DetailRole = 1,
            RequirePercent = false,
            ValidFrom = from,
            ValidTo = to,
            Unlimited = unlimited
        };
        if (PosOverlay.Show(dlg, this) != true || dlg.Result is null) return;
        if (!await AppServices.Api.AddOfferDetailAsync(_selected.Id, dlg.Result with { Discount = 0 }))
        {
            MessageBox.Show("فشل إضافة المنتج المطلوب");
            return;
        }
        await LoadDetailsAsync();
        await LoadOffersAsync();
    }

    private async void AddTree_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var picker = new MaterialTreePickerWindow();
        if (PosOverlay.Show(picker, this) != true || picker.SelectedNode is null) return;

        var pctDlg = new OfferPercentDialog(picker.SelectedNode.Name);
        if (PosOverlay.Show(pctDlg, this) != true) return;

        var (from, to, unlimited) = ReadValidity();
        var result = await AppServices.Api.AddOfferTreeAsync(_selected.Id, new AddOfferTreeRequest(
            picker.SelectedNode.Seq, pctDlg.Percent, from, to, unlimited));

        if (result is null)
        {
            MessageBox.Show("فشل تطبيق العرض على الشجرة");
            return;
        }

        MessageBox.Show(
            $"تمت إضافة {result.ProductsAdded:N0} صنف من «{result.TreeName}»\n(تخطي {result.Skipped:N0} مكرر)",
            "شجرة مواد", MessageBoxButton.OK, MessageBoxImage.Information);
        await LoadDetailsAsync();
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private async void RemoveDetail_Click(object sender, RoutedEventArgs e)
    {
        if (DiscountGrid.SelectedItem is not DetailRow row) return;
        if (!await AppServices.Api.DeleteOfferDetailAsync(row.Id)) { MessageBox.Show("فشل الحذف"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private async void RemoveRequired_Click(object sender, RoutedEventArgs e)
    {
        if (RequiredGrid.SelectedItem is not RequiredRow row) return;
        if (!await AppServices.Api.DeleteOfferDetailAsync(row.Id)) { MessageBox.Show("فشل الحذف"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
    }

    private async void RemoveTreeBatch_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null || TreeBatchGrid.SelectedItem is not TreeBatchRow batch) return;
        if (MessageBox.Show($"حذف جميع أصناف شجرة «{batch.TreeName}» من العرض؟", "تأكيد",
                MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
        var removed = await AppServices.Api.DeleteOfferTreeBatchAsync(_selected.Id, batch.TreeSeq);
        if (removed < 0) { MessageBox.Show("فشل الحذف"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
        await SyncCatalogAsync();
    }

    private void DiscountGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        RemoveDiscountBtn.IsEnabled = DiscountGrid.SelectedItem is not null;
        if (DiscountGrid.SelectedItem is DetailRow r && r.SourceTreeSeq.HasValue)
        {
            RemoveTreeBtn.IsEnabled = true;
            TreeBatchGrid.SelectedItem = TreeBatchGrid.Items.Cast<TreeBatchRow>()
                .FirstOrDefault(t => t.TreeSeq == r.SourceTreeSeq);
        }
        else RemoveTreeBtn.IsEnabled = TreeBatchGrid.SelectedItem is not null;
    }

    private void RequiredGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        RemoveRequiredBtn.IsEnabled = RequiredGrid.SelectedItem is not null;

    private void TreeBatchGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        RemoveTreeBtn.IsEnabled = TreeBatchGrid.SelectedItem is not null && _selected is not null;

    private async void RefreshCatalog_Click(object sender, RoutedEventArgs e) => await SyncCatalogAsync();

    private static async Task SyncCatalogAsync() =>
        await AppServices.Sync.SyncCatalogAsync(fullRefresh: true);

    private void Close_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);

    private sealed class OfferListItem
    {
        public OfferDto Source { get; }
        public long Id => Source.Id;
        public string Name => Source.Name;
        public string StatusLabel => Source.Enabled ? "نشط" : "موقوف";
        public Brush StatusBg => Source.Enabled
            ? new SolidColorBrush(Color.FromRgb(220, 252, 231))
            : new SolidColorBrush(Color.FromRgb(241, 245, 249));
        public Brush StatusFg => Source.Enabled
            ? new SolidColorBrush(Color.FromRgb(5, 150, 105))
            : new SolidColorBrush(Color.FromRgb(100, 116, 139));
        public string MetaLabel => $"{Source.DetailCount:N0} بند · أولوية {Source.Priority}";

        private OfferListItem(OfferDto s) => Source = s;
        public static OfferListItem From(OfferDto o) => new(o);
    }

    private sealed class DetailRow
    {
        public long Id { get; init; }
        public string DisplayName { get; init; } = "";
        public decimal DiscountPercent { get; init; }
        public string SourceLabel { get; init; } = "";
        public long? SourceTreeSeq { get; init; }

        public static DetailRow From(OfferDetailDto d) => new()
        {
            Id = d.Id,
            DisplayName = d.ItemName ?? $"#{d.ItemId}",
            DiscountPercent = d.Discount,
            SourceLabel = d.SourceTreeSeq.HasValue ? "شجرة" : "منتج",
            SourceTreeSeq = d.SourceTreeSeq
        };
    }

    private sealed class RequiredRow(OfferDetailDto d)
    {
        public long Id => d.Id;
        public string DisplayName => d.ItemName ?? $"#{d.ItemId}";
        public string? Barcode => "";
    }

    private sealed record TreeBatchRow(long TreeSeq, string TreeName, int ProductCount, decimal DiscountPercent);
}
