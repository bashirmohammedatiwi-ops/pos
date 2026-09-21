using System.Text.RegularExpressions;

using System.Windows;

using System.Windows.Controls;

using System.Windows.Input;

using System.Windows.Threading;

using FOT.Pos.Admin.Services;

using FOT.Pos.Shared.Dtos;



namespace FOT.Pos.Admin;



public partial class CashierEditDialog : Window

{

    private readonly CashierPermissionsDto? _existingPermissions;

    private readonly IReadOnlyList<SectionDto> _sections;

    private readonly string? _existingUsername;

    private DispatcherTimer? _cardSearchTimer;

    private long? _cardAccount;

    private int _cardAccountBank;

    private bool _cardAccountCleared;



    public CreateCashierRequest? CreateResult { get; private set; }

    public UpdateCashierRequest? UpdateResult { get; private set; }



    public CashierEditDialog(IReadOnlyList<SectionDto> sections, CashierDetailDto? existing = null)

    {

        InitializeComponent();

        _sections = sections;

        SectionCombo.ItemsSource = sections;



        if (existing is null)

        {

            Title = "إضافة كاشير";

            TitleLabel.Text = "إضافة كاشير";

            SubtitleLabel.Text = "اسم + رمز دخول + قسم";

            PasswordHint.Visibility = Visibility.Collapsed;

            ActiveBox.IsChecked = true;

            LoadPermissions(CashierPermissionsDefaults.New());

            if (sections.Count > 0) SectionCombo.SelectedIndex = 0;

        }

        else

        {

            _existingUsername = existing.Username;

            Title = $"تعديل — {existing.AccountName ?? existing.Username}";

            TitleLabel.Text = "تعديل الكاشير";

            SubtitleLabel.Text = "تحديث الرمز أو القسم";

            AccountNameBox.Text = existing.AccountName ?? existing.Username;

            ActiveBox.IsChecked = existing.Active;

            PasswordHint.Text = "اترك الحقل فارغاً للإبقاء على الرمز الحالي";

            _existingPermissions = existing.Permissions;

            LoadPermissions(CashierPermissionsDefaults.From(existing.Permissions));

            SectionCombo.SelectedItem = sections.FirstOrDefault(s => s.Id == existing.SectionId)

                ?? sections.FirstOrDefault();



            _cardAccount = existing.CardMasterAccount;

            _cardAccountBank = existing.CardMasterAccountBank ?? 0;

            ShowCardAccount(existing.CardMasterAccountName, existing.CardMasterAccountNum);

        }



        Loaded += async (_, _) => await SearchCardAccountsAsync();

    }



    private void ShowCardAccount(string? name, string? num)

    {

        if (_cardAccount is not > 0)

        {

            CardAccountLabel.Text = "بدون صندوق مخصص";

            return;

        }

        CardAccountLabel.Text = string.IsNullOrWhiteSpace(num)

            ? $"{name} (#{_cardAccount})"

            : $"{num} — {name}";

    }



    private void CardAccountSearchBox_OnTextChanged(object sender, TextChangedEventArgs e)

    {

        _cardSearchTimer?.Stop();

        _cardSearchTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };

        _cardSearchTimer.Tick += async (_, _) =>

        {

            _cardSearchTimer.Stop();

            await SearchCardAccountsAsync();

        };

        _cardSearchTimer.Start();

    }



    private async void SearchCardAccounts_Click(object sender, RoutedEventArgs e) => await SearchCardAccountsAsync();



    private async Task SearchCardAccountsAsync()

    {

        try

        {

            var q = CardAccountSearchBox.Text?.Trim() ?? "";

            var list = await AppServices.Api.SearchCashBoxAccountsAsync(q.Length >= 1 ? q : null) ?? [];

            CardAccountList.ItemsSource = list.Select(a => new CardAccountPickItem(a)).ToList();

        }

        catch

        {

            CardAccountList.ItemsSource = null;

        }

    }



    private void CardAccountList_OnDoubleClick(object sender, MouseButtonEventArgs e) => SetCardAccount();



    private void SetCardAccount_Click(object sender, RoutedEventArgs e) => SetCardAccount();



    private void SetCardAccount()

    {

        if (CardAccountList.SelectedItem is not CardAccountPickItem pick || pick.Account.Id <= 0)

        {

            MessageBox.Show("اختر حساباً من نتائج البحث");

            return;

        }

        _cardAccount = pick.Account.Id;

        _cardAccountBank = 0;

        _cardAccountCleared = false;

        ShowCardAccount(pick.Account.Name, pick.Account.Num);

    }



    private void ClearCardAccount_Click(object sender, RoutedEventArgs e)

    {

        _cardAccount = null;

        _cardAccountBank = 0;

        _cardAccountCleared = true;

        CardAccountList.SelectedItem = null;

        ShowCardAccount(null, null);

    }



    private sealed record CardAccountPickItem(AccountSummaryDto Account)

    {

        public string Label => string.IsNullOrWhiteSpace(Account.Num)

            ? $"{Account.Name} (#{Account.Id})"

            : $"{Account.Num} — {Account.Name}";

    }



    public bool IsEdit => _existingPermissions is not null;



    private void LoadPermissions(UpdatePermissionsRequest p)

    {

        MakeDiscount.IsChecked = p.MakeDiscount;

        DeleteItem.IsChecked = p.DeleteItem;

        AllowReturn.IsChecked = p.AllowSalesReturn;

        AllowSearch.IsChecked = p.AllowSearchArticles;

        AllowPriceChange.IsChecked = p.AllowPriceChange;

        AllowCredit.IsChecked = p.AllowCreditReceipt;

        AllowGift.IsChecked = p.AllowGiftReceipt;

        AllowOffline.IsChecked = p.OfflineLogin;

        ItemDiscLimit.Text = p.ItemDiscountLimit.ToString("N0");

        UserDiscLimit.Text = p.UserDiscountLimit.ToString("N0");

        HoldLimit.Text = p.NumberOfHoldReceipts.ToString();

    }



    private UpdatePermissionsRequest ReadPermissions()

    {

        var existing = _existingPermissions;

        decimal itemDisc = existing?.ItemDiscountLimit ?? 0;

        decimal userDisc = existing?.UserDiscountLimit ?? 0;

        int hold = existing?.NumberOfHoldReceipts ?? 5;

        if (decimal.TryParse(ItemDiscLimit.Text, out var parsedItem)) itemDisc = parsedItem;

        if (decimal.TryParse(UserDiscLimit.Text, out var parsedUser)) userDisc = parsedUser;

        if (int.TryParse(HoldLimit.Text, out var parsedHold)) hold = parsedHold;



        return new UpdatePermissionsRequest(

            MakeDiscount.IsChecked == true,

            existing?.ViewReceipts ?? true,

            existing?.CashReport ?? true,

            DeleteItem.IsChecked == true,

            existing?.DuplicateItem ?? true,

            AllowOffline.IsChecked == true,

            existing?.DiscardReceipt ?? true,

            AllowCredit.IsChecked == true,

            AllowReturn.IsChecked == true,

            AllowGift.IsChecked == true,

            AllowPriceChange.IsChecked == true,

            AllowSearch.IsChecked == true,

            existing?.AllowEditReceipt ?? false,

            itemDisc,

            userDisc,

            hold);

    }



    private static string BuildUsername(string? displayName, string pin)

    {

        var baseName = displayName?.Trim();

        if (!string.IsNullOrWhiteSpace(baseName))

        {

            var slug = Regex.Replace(baseName, @"\s+", "_");

            slug = Regex.Replace(slug, @"[^\w\u0600-\u06FF]", "");

            if (!string.IsNullOrWhiteSpace(slug))

                return slug.Length > 40 ? slug[..40] : slug;

        }



        return $"c{pin}";

    }



    private void Save_Click(object sender, RoutedEventArgs e)

    {

        if (string.IsNullOrWhiteSpace(AccountNameBox.Text))

        {

            MessageBox.Show("أدخل اسم الكاشير");

            return;

        }

        if (SectionCombo.SelectedItem is not SectionDto section || section.Id <= 0)

        {

            MessageBox.Show("اختر القسم");

            return;

        }



        var password = PasswordBox.Password;

        var permissions = ReadPermissions();

        var accountName = AccountNameBox.Text.Trim();

        var active = ActiveBox.IsChecked == true;



        if (!IsEdit)

        {

            if (string.IsNullOrWhiteSpace(password))

            {

                MessageBox.Show("أدخل رمز الدخول");

                return;

            }



            CreateResult = new CreateCashierRequest(

                BuildUsername(accountName, password), password, accountName, permissions, section.Id, active,

                _cardAccount, _cardAccount is > 0 ? _cardAccountBank : null);

        }

        else

        {

            UpdateResult = new UpdateCashierRequest(

                _existingUsername,

                string.IsNullOrWhiteSpace(password) ? null : password,

                accountName,

                permissions,

                active,

                section.Id,

                _cardAccount,

                _cardAccount is > 0 ? _cardAccountBank : null,

                _cardAccountCleared && _cardAccount is not > 0);

        }



        DialogResult = true;

    }



    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

}

