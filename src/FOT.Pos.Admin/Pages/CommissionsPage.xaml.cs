using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class CommissionsPage : UserControl, IRefreshable
{
    private List<CommissionGroupDto> _groups = [];
    private List<GroupListItem> _allGroupItems = [];
    private long? _selectedGroupId;
    private List<ContentRow> _allContentRows = [];

    public CommissionsPage()
    {
        InitializeComponent();
        GroupFilterBox.Text = "بحث في المجاميع…";
        GroupFilterBox.GotFocus += (_, _) => { if (GroupFilterBox.Text == "بحث في المجاميع…") GroupFilterBox.Clear(); };
        GroupFilterBox.LostFocus += (_, _) => { if (string.IsNullOrWhiteSpace(GroupFilterBox.Text)) GroupFilterBox.Text = "بحث في المجاميع…"; };
        ContentFilterBox.Text = "تصفية المحتوى…";
        ContentFilterBox.GotFocus += (_, _) => { if (ContentFilterBox.Text == "تصفية المحتوى…") ContentFilterBox.Clear(); };
        ContentFilterBox.LostFocus += (_, _) => { if (string.IsNullOrWhiteSpace(ContentFilterBox.Text)) ContentFilterBox.Text = "تصفية المحتوى…"; };
    }

    public async Task RefreshAsync()
    {
        _groups = (await AppServices.Api.GetCommissionGroupsAsync())?.ToList() ?? [];
        ApplyGroupFilter();
        await LoadSalesmenAsync();
        if (_selectedGroupId.HasValue)
        {
            await LoadGroupDetailAsync(_selectedGroupId.Value);
            RestoreGroupSelection();
        }
        UpdateMoveTargets();
    }

    private void ApplyGroupFilter()
    {
        var filter = GroupFilterBox.Text.Trim();
        if (filter == "بحث في المجاميع…") filter = "";
        _allGroupItems = _groups.Select(g => new GroupListItem(g)).ToList();
        var filtered = string.IsNullOrEmpty(filter)
            ? _allGroupItems
            : _allGroupItems.Where(g => g.Source.Name.Contains(filter, StringComparison.OrdinalIgnoreCase)).ToList();
        GroupsList.ItemsSource = filtered;
    }

    private void RestoreGroupSelection()
    {
        if (!_selectedGroupId.HasValue) return;
        var item = GroupsList.Items.Cast<GroupListItem>().FirstOrDefault(i => i.Id == _selectedGroupId.Value);
        if (item is not null)
        {
            GroupsList.SelectedItem = item;
            ShowDetail();
        }
    }

    private void ShowDetail()
    {
        EmptyHint.Visibility = Visibility.Collapsed;
        DetailScroll.Visibility = Visibility.Visible;
    }

    private void ShowEmpty()
    {
        EmptyHint.Visibility = Visibility.Visible;
        DetailScroll.Visibility = Visibility.Collapsed;
    }

    private async Task LoadSalesmenAsync()
    {
        var sm = await AppServices.Api.GetSalesmenAsync(1);
        var items = new List<SalesmanPickerItem> { new(0, "كل المندوبين") };
        if (sm?.Items is not null)
            items.AddRange(sm.Items.Select(s => new SalesmanPickerItem(s.Id, s.Name ?? $"#{s.Id}")));
        GroupSalesmanCombo.ItemsSource = items;
        if (_selectedGroupId is null)
            GroupSalesmanCombo.SelectedIndex = 0;
    }

    private void UpdateMoveTargets()
    {
        var targets = _groups
            .Where(g => g.Id != _selectedGroupId)
            .Select(g => new GroupPickerItem(g.Id, g.Name))
            .ToList();
        MoveTargetCombo.ItemsSource = targets;
        MoveTargetCombo.SelectedIndex = targets.Count > 0 ? 0 : -1;
    }

    private async void NewGroup_Click(object sender, RoutedEventArgs e)
    {
        var n = _groups.Count + 1;
        var id = await AppServices.Api.CreateCommissionGroupAsync(
            new CreateCommissionGroupRequest($"مجموعة {n}", null, "fixed", 1000));
        if (id is null)
        {
            MessageBox.Show("تعذر إنشاء المجموعة — تحقق من الاتصال");
            return;
        }
        _selectedGroupId = id;
        _groups = (await AppServices.Api.GetCommissionGroupsAsync())?.ToList() ?? [];
        ApplyGroupFilter();
        RestoreGroupSelection();
        UpdateMoveTargets();
        await LoadGroupDetailAsync(id.Value);
        BarcodeBox.Focus();
    }

    private async void GroupsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (GroupsList.SelectedItem is not GroupListItem row)
        {
            if (!_selectedGroupId.HasValue)
                ShowEmpty();
            return;
        }
        _selectedGroupId = row.Id;
        ShowDetail();
        UpdateMoveTargets();
        await LoadGroupDetailAsync(row.Id);
    }

    private async Task LoadGroupDetailAsync(long id)
    {
        var detail = await AppServices.Api.GetCommissionGroupAsync(id);
        if (detail is null) return;

        GroupNameBox.Text = detail.Name;
        GroupValueBox.Text = detail.CommissionValue.ToString("N0");
        SelectSalesman(detail.SalesmanId);
        ContentTitle.Text = $"محتويات المجموعة ({detail.Items.Count + detail.Trees.Sum(t => t.ProductCount)} منتج)";

        _allContentRows =
        [
            ..detail.Trees.Select(t => new ContentRow("tree", t.TreeName ?? $"شجرة #{t.TreeSeq}", $"{t.ProductCount} منتج", t.TreeSeq, null)),
            ..detail.Items.Where(x => !x.SourceTreeSeq.HasValue)
                .Select(i => new ContentRow("product", i.ArticleName ?? i.Barcode ?? "—",
                    i.Price > 0
                        ? $"{i.Barcode ?? ""}{(string.IsNullOrWhiteSpace(i.Barcode) ? "" : " · ")}{i.Price:N0}"
                        : i.Barcode ?? "",
                    null, i.Id)),
        ];
        ApplyContentFilter();
        UpdateGroupCountsInList(detail);
    }

    private void UpdateGroupCountsInList(CommissionGroupDetailDto detail)
    {
        var count = detail.Items.Count + detail.Trees.Sum(t => t.ProductCount);
        var idx = _groups.FindIndex(g => g.Id == detail.Id);
        if (idx < 0) return;
        var g = _groups[idx];
        _groups[idx] = g with { ProductCount = count, Name = detail.Name, CommissionValue = detail.CommissionValue };
        ApplyGroupFilter();
        RestoreGroupSelection();
    }

    private void ApplyContentFilter()
    {
        var filter = ContentFilterBox.Text.Trim();
        if (filter == "تصفية المحتوى…") filter = "";
        var rows = string.IsNullOrEmpty(filter)
            ? _allContentRows
            : _allContentRows.Where(r =>
                r.Name.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                r.Detail.Contains(filter, StringComparison.OrdinalIgnoreCase)).ToList();
        ContentGrid.ItemsSource = new ObservableCollection<ContentRow>(rows);
    }

    private void SelectSalesman(long? id)
    {
        if (GroupSalesmanCombo.ItemsSource is not IEnumerable<SalesmanPickerItem> items) return;
        GroupSalesmanCombo.SelectedItem = items.FirstOrDefault(i => i.Id == (id ?? 0)) ?? items.First();
    }

    private long? GetSelectedSalesmanId()
    {
        if (GroupSalesmanCombo.SelectedItem is SalesmanPickerItem s && s.Id > 0) return s.Id;
        return null;
    }

    private async void SaveGroup_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedGroupId is null) return;
        if (!decimal.TryParse(GroupValueBox.Text.Replace(",", ""), out var value))
        {
            MessageBox.Show("أدخل مبلغاً صحيحاً");
            return;
        }
        var ok = await AppServices.Api.UpdateCommissionGroupAsync(_selectedGroupId.Value,
            new UpdateCommissionGroupRequest(
                GroupNameBox.Text.Trim(), null, "fixed", value,
                GetSelectedSalesmanId(), null, 0, null, true, null, null));
        if (!ok) { MessageBox.Show("فشل الحفظ"); return; }
        _groups = (await AppServices.Api.GetCommissionGroupsAsync())?.ToList() ?? [];
        ApplyGroupFilter();
        RestoreGroupSelection();
        UpdateMoveTargets();
    }

    private async void DeleteGroup_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedGroupId is null) return;
        if (MessageBox.Show("حذف المجموعة؟", "تأكيد", MessageBoxButton.YesNo) != MessageBoxResult.Yes) return;
        if (await AppServices.Api.DeleteCommissionGroupAsync(_selectedGroupId.Value))
        {
            _selectedGroupId = null;
            _groups = (await AppServices.Api.GetCommissionGroupsAsync())?.ToList() ?? [];
            ApplyGroupFilter();
            ShowEmpty();
        }
    }

    private async void AddTree_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedGroupId is null) return;
        var dlg = new EdariTreePickerDialog { SelectFolderOnly = true };
        if (dlg.ShowDialog() != true || dlg.SelectedNode is null) return;
        var node = dlg.SelectedNode;
        var result = await AppServices.Api.AddCommissionGroupTreeAsync(_selectedGroupId.Value, node.Seq, node.Name);
        if (result is null) { MessageBox.Show("فشل إضافة الشجرة"); return; }
        MessageBox.Show($"تمت إضافة {result.Added} منتج");
        await LoadGroupDetailAsync(_selectedGroupId.Value);
    }

    private async void AddBarcode_Click(object sender, RoutedEventArgs e) => await AddBarcodeAsync();

    private async void BarcodeBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await AddBarcodeAsync();
    }

    private async Task AddBarcodeAsync()
    {
        if (_selectedGroupId is null) return;
        var code = BarcodeBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(code)) return;
        var item = await AppServices.Api.AddCommissionGroupProductAsync(_selectedGroupId.Value, code);
        if (item is null) { MessageBox.Show("المنتج غير موجود"); return; }
        BarcodeBox.Clear();
        await LoadGroupDetailAsync(_selectedGroupId.Value);
        BarcodeBox.Focus();
    }

    private async void SearchProducts_Click(object sender, RoutedEventArgs e) => await SearchProductsAsync();

    private async void ProductSearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await SearchProductsAsync();
    }

    private async Task SearchProductsAsync()
    {
        var q = ProductSearchBox.Text.Trim();
        if (q.Length < 2) { MessageBox.Show("أدخل حرفين على الأقل"); return; }
        SearchResultsGrid.ItemsSource = await AppServices.Api.SearchProductsAsync(q);
    }

    private async void AddSearchProduct_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: ProductDto p })
            await AddProductBySeqAsync(p.Seq);
    }

    private async void SearchResultsGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (SearchResultsGrid.SelectedItem is ProductDto p)
            await AddProductBySeqAsync(p.Seq);
    }

    private async Task AddProductBySeqAsync(long seq)
    {
        if (_selectedGroupId is null) return;
        var item = await AppServices.Api.AddCommissionGroupProductByIdAsync(_selectedGroupId.Value, seq);
        if (item is null) { MessageBox.Show("تعذر الإضافة — ربما المنتج موجود مسبقاً"); return; }
        await LoadGroupDetailAsync(_selectedGroupId.Value);
        ProductSearchBox.Focus();
        ProductSearchBox.SelectAll();
    }

    private async void DeleteRow_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedGroupId is null || sender is not Button { Tag: ContentRow row }) return;
        if (row.Kind == "tree" && row.TreeSeq is long treeSeq)
            await AppServices.Api.DeleteCommissionGroupTreeAsync(_selectedGroupId.Value, treeSeq);
        else if (row.ItemId is long itemId)
            await AppServices.Api.DeleteCommissionGroupItemAsync(_selectedGroupId.Value, itemId);
        await LoadGroupDetailAsync(_selectedGroupId.Value);
    }

    private async void MoveSelected_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedGroupId is null || MoveTargetCombo.SelectedItem is not GroupPickerItem target) return;
        var selected = ContentGrid.SelectedItems.Cast<ContentRow>().Where(r => r.Kind == "product" && r.ItemId.HasValue).ToList();
        if (selected.Count == 0)
        {
            MessageBox.Show("حدد منتجات من الجدول (اضغط Ctrl للتحديد المتعدد)");
            return;
        }
        var ids = selected.Select(r => r.ItemId!.Value).ToArray();
        var moved = await AppServices.Api.MoveCommissionGroupItemsAsync(ids, target.Id);
        if (moved <= 0) { MessageBox.Show("فشل النقل"); return; }
        await LoadGroupDetailAsync(_selectedGroupId.Value);
        _groups = (await AppServices.Api.GetCommissionGroupsAsync())?.ToList() ?? [];
        ApplyGroupFilter();
        RestoreGroupSelection();
    }

    private void GroupFilterBox_TextChanged(object sender, TextChangedEventArgs e) => ApplyGroupFilter();

    private void ContentFilterBox_TextChanged(object sender, TextChangedEventArgs e) => ApplyContentFilter();

    private void AddModeTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AddModeTabs.SelectedIndex == 0)
            Dispatcher.BeginInvoke(() => BarcodeBox.Focus());
        else
            Dispatcher.BeginInvoke(() => ProductSearchBox.Focus());
    }

    private sealed record GroupListItem(CommissionGroupDto Source)
    {
        public long Id => Source.Id;
        public string Display => $"{Source.Name} — {Source.CommissionValue:N0} د.ع ({Source.ProductCount} منتج)";
    }

    private sealed record SalesmanPickerItem(long Id, string Name);

    private sealed record GroupPickerItem(long Id, string Name);

    private sealed record ContentRow(string Kind, string Name, string Detail, long? TreeSeq, long? ItemId)
    {
        public string KindLabel => Kind == "tree" ? "شجرة" : "منتج";
    }
}
