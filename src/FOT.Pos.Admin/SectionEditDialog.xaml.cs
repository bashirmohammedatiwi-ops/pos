using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class SectionEditDialog : Window
{
    private readonly SectionDetailDto? _existing;
    private readonly ObservableCollection<AssignedCashBoxRow> _assigned = [];
    private AccountSummaryDto? _searchSelection;
    private DispatcherTimer? _searchTimer;

    public CreateSectionRequest? CreateResult { get; private set; }
    public UpdateSectionRequest? UpdateResult { get; private set; }
    public bool DeleteRequested { get; private set; }

    public SectionEditDialog(SectionDetailDto? existing = null)
    {
        InitializeComponent();
        _existing = existing;
        AssignedList.ItemsSource = _assigned;
        Loaded += async (_, _) => await InitAsync();
    }

    private async Task InitAsync()
    {
        try
        {
            var branches = await AppServices.Api.GetEdariBranchesAsync() ?? [];
            EdariBranchCombo.ItemsSource = branches;

            if (_existing is null)
            {
                Title = "إضافة قسم";
                TitleLabel.Text = "إضافة قسم";
                SubtitleLabel.Text = "اسم القسم + صناديق مرتبطة";
                ActiveBox.IsChecked = true;
                SellPriceBox.Text = "1";
                WarehouseBox.Text = "1";
                NewEdariBranchRadio.IsChecked = true;
                ApplyEdariMode();
            }
            else
            {
                Title = $"تعديل — {_existing.Name}";
                TitleLabel.Text = "تعديل القسم";
                SubtitleLabel.Text = "تحديث الصناديق أو اسم القسم";
                NameBox.Text = _existing.Name;
                ActiveBox.IsChecked = _existing.State;
                SellPriceBox.Text = _existing.SellPrice.ToString();
                WarehouseBox.Text = _existing.EdariWarehouseNumber.ToString();
                LinkEdariBranchRadio.IsChecked = true;
                EdariBranchCombo.SelectedItem = branches.FirstOrDefault(b => b.Seq == _existing.EdariBranchId)
                    ?? branches.FirstOrDefault();
                NewEdariBranchRadio.IsEnabled = false;
                LinkEdariBranchRadio.IsEnabled = false;
                ApplyEdariMode();
                DeleteBtn.Visibility = Visibility.Visible;

                foreach (var box in _existing.CashBoxes)
                {
                    _assigned.Add(new AssignedCashBoxRow(box.MasterAccount, box.MasterAccountBank,
                        box.MasterAccountName, box.MasterAccountNum, box.IsDefault));
                }
            }

            await SearchAccountsAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"تعذّر تحميل بيانات النافذة:\n{ex.Message}", "خطأ", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void EdariMode_Changed(object sender, RoutedEventArgs e)
    {
        if (!IsLoaded) return;
        ApplyEdariMode();
    }

    private void ApplyEdariMode()
    {
        var linkExisting = LinkEdariBranchRadio.IsChecked == true;
        EdariBranchCombo.IsEnabled = linkExisting;
        EdariBranchCombo.Visibility = linkExisting ? Visibility.Visible : Visibility.Collapsed;
        EdariBranchLabel.Visibility = linkExisting ? Visibility.Visible : Visibility.Collapsed;
    }

    private void AccountSearchBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        _searchTimer?.Stop();
        _searchTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _searchTimer.Tick += async (_, _) =>
        {
            _searchTimer.Stop();
            await SearchAccountsAsync();
        };
        _searchTimer.Start();
    }

    private async void SearchAccounts_Click(object sender, RoutedEventArgs e) => await SearchAccountsAsync();

    private async Task SearchAccountsAsync()
    {
        var q = AccountSearchBox.Text?.Trim() ?? "";
        var list = await AppServices.Api.SearchCashBoxAccountsAsync(q.Length >= 1 ? q : null) ?? [];
        AccountList.ItemsSource = list.Select(a => new CashBoxPickItem(a)).ToList();
    }

    private void AccountList_OnDoubleClick(object sender, MouseButtonEventArgs e) => AddSelectedAccount();

    private void AddAccount_Click(object sender, RoutedEventArgs e) => AddSelectedAccount();

    private void AddSelectedAccount()
    {
        if (AccountList.SelectedItem is CashBoxPickItem pick)
            _searchSelection = pick.Account;
        if (_searchSelection is null || _searchSelection.Id <= 0)
        {
            MessageBox.Show("اختر حساباً من نتائج البحث");
            return;
        }
        if (_assigned.Any(a => a.MasterAccount == _searchSelection.Id))
        {
            MessageBox.Show("هذا الحساب مضاف مسبقاً");
            return;
        }
        var isFirst = _assigned.Count == 0;
        _assigned.Add(new AssignedCashBoxRow(_searchSelection.Id, 0, _searchSelection.Name, _searchSelection.Num, isFirst));
        _searchSelection = null;
        AccountList.SelectedItem = null;
    }

    private void DefaultBox_Changed(object sender, RoutedEventArgs e)
    {
        if (sender is not RadioButton rb || rb.DataContext is not AssignedCashBoxRow row) return;
        foreach (var item in _assigned)
            item.IsDefault = item == row;
        AssignedList.Items.Refresh();
    }

    private void RemoveBox_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not AssignedCashBoxRow row) return;
        var wasDefault = row.IsDefault;
        _assigned.Remove(row);
        if (wasDefault && _assigned.Count > 0)
            _assigned[0].IsDefault = true;
        AssignedList.Items.Refresh();
    }

    private List<SectionCashBoxAssignment> BuildAssignments() =>
        _assigned.Select(a => new SectionCashBoxAssignment(a.MasterAccount, a.MasterAccountBank, a.IsDefault)).ToList();

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        var name = NameBox.Text?.Trim() ?? "";
        if (string.IsNullOrEmpty(name))
        {
            MessageBox.Show("أدخل اسم القسم");
            return;
        }
        if (!int.TryParse(WarehouseBox.Text?.Trim(), out var warehouse) || warehouse < 1)
        {
            MessageBox.Show("رقم المخزن غير صالح");
            return;
        }
        if (!int.TryParse(SellPriceBox.Text?.Trim(), out var sellPrice)) sellPrice = 1;
        if (_assigned.Count == 0)
        {
            MessageBox.Show("أضف حساباً واحداً على الأقل");
            return;
        }
        if (_assigned.All(a => !a.IsDefault))
            _assigned[0].IsDefault = true;

        var boxes = BuildAssignments();
        var active = ActiveBox.IsChecked == true;
        var symbol = string.IsNullOrWhiteSpace(SymbolBox.Text) ? null : SymbolBox.Text.Trim();

        if (_existing is null)
        {
            int? edariBranchId = null;
            if (LinkEdariBranchRadio.IsChecked == true)
            {
                if (EdariBranchCombo.SelectedItem is not EdariBranchDto branch)
                {
                    MessageBox.Show("اختر فرع Edari أو أنشئ فرعاً جديداً");
                    return;
                }
                edariBranchId = (int)branch.Seq;
            }

            CreateResult = new CreateSectionRequest(name, warehouse, edariBranchId, symbol, null, active, sellPrice, boxes);
        }
        else
        {
            UpdateResult = new UpdateSectionRequest(
                name, active, sellPrice, _existing.EdariBranchId, warehouse,
                _existing.GroupsColumnsCount, _existing.GroupsItemSize,
                _existing.RoundTotalTo, _existing.RoundItemTo,
                _existing.FastSaving, _existing.CollectivePrinting, _existing.DisplayArticleQuantity,
                boxes, symbol);
        }

        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_existing is null) return;
        if (MessageBox.Show($"حذف القسم «{_existing.Name}»؟\n\nلا يمكن التراجع.", "تأكيد",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;
        DeleteRequested = true;
        DialogResult = true;
    }

    private sealed record CashBoxPickItem(AccountSummaryDto Account)
    {
        public string Label => string.IsNullOrWhiteSpace(Account.Num)
            ? $"{Account.Name} (#{Account.Id})"
            : $"{Account.Num} — {Account.Name}";
    }

    public sealed class AssignedCashBoxRow
    {
        public long MasterAccount { get; }
        public int MasterAccountBank { get; }
        public bool IsDefault { get; set; }
        public string Label { get; }

        public AssignedCashBoxRow(long masterAccount, int bank, string? name, string? num, bool isDefault)
        {
            MasterAccount = masterAccount;
            MasterAccountBank = bank;
            IsDefault = isDefault;
            Label = string.IsNullOrWhiteSpace(num) ? $"{name} (#{masterAccount})" : $"{num} — {name}";
        }
    }
}
