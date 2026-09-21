using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class OffersPage : UserControl, IRefreshable
{
    private List<OfferDto> _offers = [];
    private OfferDto? _selected;
    private List<OfferDetailDto> _allDetails = [];

    public OffersPage()
    {
        InitializeComponent();
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today.AddMonths(1);
        OfferTypeCombo.SelectedIndex = 0;
        UnlimitedBox.IsChecked = true;
    }

    public async Task RefreshAsync() => await LoadOffersAsync();

    private async Task LoadOffersAsync()
    {
        var res = await AppServices.Api.GetOffersAsync(1);
        _offers = res?.Items?.ToList() ?? [];
        UpdateKpis();
        ApplyOfferFilter();
    }

    private void UpdateKpis()
    {
        KpiTotal.Text = _offers.Count.ToString("N0");
        KpiActive.Text = _offers.Count(o => o.Enabled).ToString("N0");
        KpiProducts.Text = _offers.Sum(o => o.ActiveProductCount).ToString("N0");
        KpiTrees.Text = "—";
    }

    private void ApplyOfferFilter()
    {
        var q = OfferSearchBox.Text.Trim();
        IEnumerable<OfferDto> filtered = _offers;
        if (ActiveOnlyBox.IsChecked == true)
            filtered = filtered.Where(o => o.Enabled);
        if (!string.IsNullOrWhiteSpace(q))
            filtered = filtered.Where(o => o.Name.Contains(q, StringComparison.OrdinalIgnoreCase));
        OffersList.ItemsSource = filtered.Select(OfferListItem.From).ToList();
        if (_selected is not null)
            OffersList.SelectedItem = OffersList.Items.Cast<OfferListItem>().FirstOrDefault(i => i.Id == _selected.Id);
    }

    private void OfferSearchBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        if (!IsLoaded) return;
        ApplyOfferFilter();
    }

    private void Filter_Changed(object sender, RoutedEventArgs e)
    {
        if (!IsLoaded) return;
        ApplyOfferFilter();
    }

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
            TreeBatchList.ItemsSource = null;
            return;
        }

        OfferNameBox.Text = _selected.Name;
        OfferPriorityBox.Text = _selected.Priority.ToString();
        OfferEnabledBox.IsChecked = _selected.Enabled;
        OfferTypeCombo.SelectedIndex = _selected.Type switch { 1 => 1, 2 => 2, _ => 0 };
        UpdateTabsVisibility();
        await LoadDetailsAsync();
    }

    private void OfferTypeCombo_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded) return;
        UpdateTabsVisibility();
    }

    private void UpdateTabsVisibility()
    {
        if (RequiredTab is null) return;
        RequiredTab.Visibility = GetOfferType() == 1 ? Visibility.Visible : Visibility.Collapsed;
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

        var treeBatches = discounted
            .Where(d => d.SourceTreeSeq.HasValue)
            .GroupBy(d => d.SourceTreeSeq!.Value)
            .Select(g => TreeBatchCard.From(g.Key, g.First().SourceTreeName, g.Count(), g.First().Discount))
            .ToList();
        TreeBatchList.ItemsSource = treeBatches;

        var treeBatchCount = treeBatches.Count;
        if (_selected is not null && OffersList.SelectedItem is OfferListItem item && item.Id == _selected.Id)
            KpiTrees.Text = treeBatchCount.ToString("N0");

        SummaryProducts.Text = $"📦 {discounted.Count(d => !d.SourceTreeSeq.HasValue):N0} صنف مخفّض يدوياً";
        SummaryTrees.Text = $"🌳 {treeBatchCount:N0} دفعة شجرة · {discounted.Count(d => d.SourceTreeSeq.HasValue):N0} صنف من Edari";
        SummaryRequired.Text = $"🔗 {required.Count:N0} صنف مطلوب (مجموعة عرض)";
    }

    private (DateTime? from, DateTime? to, bool unlimited) ReadValidity()
    {
        var unlimited = UnlimitedBox.IsChecked == true;
        return unlimited ? (null, null, true) : (FromDate.SelectedDate, ToDate.SelectedDate, false);
    }

    private void UnlimitedBox_OnChanged(object sender, RoutedEventArgs e)
    {
        if (FromDate is null || ToDate is null) return;
        var u = UnlimitedBox.IsChecked == true;
        FromDate.IsEnabled = !u;
        ToDate.IsEnabled = !u;
    }

    private async void Create_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OfferCreateDialog { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.Result is null) return;
        if (!await AppServices.Api.CreateOfferAsync(dlg.Result))
        { MessageBox.Show("فشل إنشاء العرض"); return; }
        await LoadOffersAsync();
    }

    private async void SaveOffer_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        if (string.IsNullOrWhiteSpace(OfferNameBox.Text)) { MessageBox.Show("أدخل اسم العرض"); return; }
        if (!int.TryParse(OfferPriorityBox.Text, out var priority)) priority = 1;

        var req = new UpdateOfferRequest(OfferNameBox.Text.Trim(), priority, GetOfferType(), OfferEnabledBox.IsChecked == true);
        if (!await AppServices.Api.UpdateOfferAsync(_selected.Id, req))
        { MessageBox.Show("فشل حفظ العرض"); return; }
        MessageBox.Show("تم حفظ العرض");
        await LoadOffersAsync();
    }

    private async void DeleteOffer_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        if (MessageBox.Show($"حذف عرض «{_selected.Name}»؟", "تأكيد", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        if (!await AppServices.Api.DeleteOfferAsync(_selected.Id)) { MessageBox.Show("فشل الحذف"); return; }
        _selected = null;
        await LoadOffersAsync();
    }

    private async void AddProduct_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var (from, to, unlimited) = ReadValidity();
        var dlg = new OfferAddProductDialog
        {
            Owner = Window.GetWindow(this),
            DetailRole = 0,
            RequirePercent = true,
            ValidFrom = from,
            ValidTo = to,
            Unlimited = unlimited
        };
        if (dlg.ShowDialog() != true || dlg.Result is null) return;
        if (!await AppServices.Api.AddOfferDetailAsync(_selected.Id, dlg.Result))
        { MessageBox.Show("فشل إضافة المنتج"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
    }

    private async void AddRequired_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var (from, to, unlimited) = ReadValidity();
        var dlg = new OfferAddProductDialog
        {
            Owner = Window.GetWindow(this),
            DetailRole = 1,
            RequirePercent = false,
            ValidFrom = from,
            ValidTo = to,
            Unlimited = unlimited
        };
        if (dlg.ShowDialog() != true || dlg.Result is null) return;
        if (!await AppServices.Api.AddOfferDetailAsync(_selected.Id, dlg.Result with { Discount = 0 }))
        { MessageBox.Show("فشل إضافة المنتج المطلوب"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
    }

    private async void AddTree_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var picker = new EdariTreePickerDialog
        {
            Owner = Window.GetWindow(this),
            SelectFolderOnly = true
        };
        if (picker.ShowDialog() != true || picker.SelectedNode is null) return;

        var pctDlg = new OfferPercentDialog(picker.SelectedNode.Name) { Owner = Window.GetWindow(this) };
        if (pctDlg.ShowDialog() != true) return;

        var (from, to, unlimited) = ReadValidity();
        var result = await AppServices.Api.AddOfferTreeAsync(_selected.Id, new AddOfferTreeRequest(
            picker.SelectedNode.Seq, pctDlg.Percent, from, to, unlimited));

        if (result is null)
        {
            MessageBox.Show("فشل تطبيق العرض على الشجرة.\nتحقق من اتصال Edari أو من وجود أصناف تحت المجلد.", "خطأ",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (result.ProductsAdded == 0)
        {
            MessageBox.Show($"لم تُضف أصناف — ربما كلها موجودة مسبقاً (تخطي {result.Skipped:N0})", "تنبيه",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        else
        {
            MessageBox.Show(
                $"تم تطبيق {pctDlg.Percent:N0}% على {result.ProductsAdded:N0} صنف\nمن شجرة «{result.TreeName}»\n(تخطي {result.Skipped:N0} مكرر)",
                "شجرة Edari", MessageBoxButton.OK, MessageBoxImage.Information);
        }

        await LoadDetailsAsync();
        await LoadOffersAsync();
    }

    private async void RemoveDetail_Click(object sender, RoutedEventArgs e)
    {
        if (DiscountGrid.SelectedItem is not DetailRow row) return;
        if (!await AppServices.Api.DeleteOfferDetailAsync(row.Id)) { MessageBox.Show("فشل الحذف"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
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
        if (_selected is null) return;
        var batch = TreeBatchList.SelectedItem as TreeBatchCard
            ?? (DiscountGrid.SelectedItem is DetailRow r && r.SourceTreeSeq.HasValue
                ? TreeBatchList.Items.Cast<TreeBatchCard>().FirstOrDefault(t => t.TreeSeq == r.SourceTreeSeq)
                : null);
        if (batch is null) { MessageBox.Show("اختر دفعة شجرة"); return; }

        if (MessageBox.Show($"حذف جميع أصناف «{batch.TreeName}» من العرض؟", "تأكيد",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;

        if (await AppServices.Api.DeleteOfferTreeBatchAsync(_selected.Id, batch.TreeSeq) < 0)
        { MessageBox.Show("فشل الحذف"); return; }
        await LoadDetailsAsync();
        await LoadOffersAsync();
    }

    private void DiscountGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        RemoveDiscountBtn.IsEnabled = DiscountGrid.SelectedItem is not null;
        if (DiscountGrid.SelectedItem is DetailRow r && r.SourceTreeSeq.HasValue)
        {
            RemoveTreeBtn.IsEnabled = true;
            TreeBatchList.SelectedItem = TreeBatchList.Items.Cast<TreeBatchCard>()
                .FirstOrDefault(t => t.TreeSeq == r.SourceTreeSeq);
        }
        else RemoveTreeBtn.IsEnabled = TreeBatchList.SelectedItem is not null;
    }

    private void RequiredGrid_OnSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        RemoveRequiredBtn.IsEnabled = RequiredGrid.SelectedItem is not null;

    private void TreeBatchList_OnSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        RemoveTreeBtn.IsEnabled = TreeBatchList.SelectedItem is not null && _selected is not null;

    private sealed class OfferListItem
    {
        public OfferDto Source { get; }
        public long Id => Source.Id;
        public string Name => Source.Name;
        public string StatusLabel => Source.Enabled ? "نشط" : "موقوف";
        public string TypeLabel => Source.Type switch { 1 => "مجموعة", 2 => "أسعار فردية", _ => "خصم %" };
        public Brush StatusBg => Source.Enabled
            ? new SolidColorBrush(Color.FromRgb(236, 253, 245))
            : new SolidColorBrush(Color.FromRgb(243, 244, 246));
        public Brush StatusFg => Source.Enabled
            ? new SolidColorBrush(Color.FromRgb(5, 150, 105))
            : new SolidColorBrush(Color.FromRgb(107, 114, 128));
        public Brush CardBg => Brushes.White;
        public Brush CardBorder => Source.Enabled
            ? new SolidColorBrush(Color.FromRgb(229, 231, 235))
            : new SolidColorBrush(Color.FromRgb(209, 213, 219));
        public string MetaLabel => $"{Source.DetailCount:N0} بند · أولوية {Source.Priority} · {Source.ActiveProductCount:N0} صنف";

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
            SourceLabel = d.SourceTreeSeq.HasValue ? "🌳 Edari" : "📦 منتج",
            SourceTreeSeq = d.SourceTreeSeq
        };
    }

    private sealed class RequiredRow(OfferDetailDto d)
    {
        public long Id => d.Id;
        public string DisplayName => d.ItemName ?? $"#{d.ItemId}";
        public string? Barcode => "";
    }

    private sealed class TreeBatchCard
    {
        public long TreeSeq { get; init; }
        public string TreeName { get; init; } = "";
        public int ProductCount { get; init; }
        public decimal DiscountPercent { get; init; }
        public string DiscountLabel => $"{DiscountPercent:N0}%";
        public string SubLabel => $"{ProductCount:N0} صنف · Seq {TreeSeq}";

        public static TreeBatchCard From(long seq, string? name, int count, decimal pct) => new()
        {
            TreeSeq = seq,
            TreeName = name ?? $"شجرة #{seq}",
            ProductCount = count,
            DiscountPercent = pct
        };
    }
}
