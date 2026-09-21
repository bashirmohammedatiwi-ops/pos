using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Threading;
using FOT.Pos.Client.Models;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.ViewModels;

public sealed class SalesViewModel : INotifyPropertyChanged
{
    private readonly DispatcherTimer _searchDebounce = new() { Interval = TimeSpan.FromMilliseconds(280) };
    private readonly DispatcherTimer _totalsDebounce = new() { Interval = TimeSpan.FromMilliseconds(60) };
    private bool _pendingSaveSlot = true;
    private string _pendingSearch = "";
    private ProductDto? _currentProduct;
    private long? _recalledHoldId;
    private CartLine? _selectedLine;
    private string _userDiscountText = "";
    private DiscountInputMode _discountMode = DiscountInputMode.Amount;
    private SaleKind _activeSaleKind = SaleKind.Sale;
    private string _scanText = "";
    private string _productPreviewName = "جاهز للبيع";
    private string _productPreviewPrice = "";
    private string _productPreviewHint = "امسح الباركود أو اختر منتجاً من الشبكة";
    private string _totalDisplay = "0";
    private string _itemCountDisplay = "فارغة";
    private string _statusText = "متصل";
    private string _syncText = "";
    private string _pendingText = "";
    private bool _isOnline = true;
    private bool _isBusy;
    private bool _showHoldsPanel;
    private bool _showProductsPanel;
    private bool _showSuccessOverlay;
    private string _productFilter = "";
    private string _successMessage = "";
    private int _selectedGroupIndex;
    private int _activeSlotIndex;
    private bool _isLoadingSlot;
    private int _sessionSaleCount;
    private decimal _sessionSaleTotal;
    private readonly InvoiceSlotState[] _invoiceSlots = [new(), new(), new()];
    private ProductDto? _lastScannedProduct;
    private readonly List<ArticleGroupItemDto> _allGroupItems = [];

    public SalesViewModel()
    {
        Cart = [];
        Cart.CollectionChanged += OnCartCollectionChanged;
        SearchResults.CollectionChanged += (_, _) => OnChanged(nameof(HasSearchResults));
        _searchDebounce.Tick += async (_, _) => await RunSearchAsync();
        _totalsDebounce.Tick += (_, _) => ApplyPendingTotals();
        InitHoldSlots();
        var firstGroup = new CartGroup { Key = 1, IsActive = true };
        CartGroups.Add(firstGroup);
    }

    private void OnCartCollectionChanged(object? sender, System.Collections.Specialized.NotifyCollectionChangedEventArgs e)
    {
        if (e.NewItems is not null)
        {
            foreach (CartLine line in e.NewItems)
                line.PropertyChanged += OnCartLineChanged;
        }
        if (e.OldItems is not null)
        {
            foreach (CartLine line in e.OldItems)
                line.PropertyChanged -= OnCartLineChanged;
        }
        if (_isLoadingSlot) return;
        ScheduleTotalsRefresh();
    }

    private void OnCartLineChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not (nameof(CartLine.LineTotal) or nameof(CartLine.Quantity) or nameof(CartLine.Price)))
            return;
        if (_isLoadingSlot) return;
        ScheduleTotalsRefresh();
    }

    private void ScheduleTotalsRefresh(bool saveSlot = true)
    {
        _pendingSaveSlot = saveSlot;
        _totalsDebounce.Stop();
        _totalsDebounce.Start();
    }

    private void ApplyPendingTotals()
    {
        _totalsDebounce.Stop();
        RecalculateTotals();
        if (_pendingSaveSlot) SaveCurrentSlot();
        RefreshSlotsDisplay();
    }

    private void InitHoldSlots()
    {
        HoldSlots.Clear();
        for (var i = 0; i < 3; i++)
            HoldSlots.Add(new HoldSlotItem());
        RefreshSlotsDisplay();
    }

    public ObservableCollection<CartLine> Cart { get; }
    public ObservableCollection<ArticleGroupDto> Groups { get; } = [];
    public ObservableCollection<ArticleGroupItemDto> GroupItems { get; } = [];
    public ObservableCollection<ProductDto> SearchResults { get; } = [];
    public ObservableCollection<SalesmanDto> Salesmen { get; } = [];
    public ObservableCollection<CartGroup> CartGroups { get; } = [];
    public ObservableCollection<CashBoxItem> CashBoxes { get; } = [];
    public ObservableCollection<AccountSummaryDto> CreditAccounts { get; } = [];
    public ObservableCollection<HoldReceiptDto> HeldReceipts { get; } = [];
    public ObservableCollection<HoldSlotItem> HoldSlots { get; } = [];

    public CashierPermissionsDto? Permissions { get; private set; }
    public string CashierName { get; private set; } = "";
    public string SectionName { get; private set; } = "—";

    public CartLine? SelectedLine
    {
        get => _selectedLine;
        set { _selectedLine = value; OnChanged(); }
    }

    public string ScanText
    {
        get => _scanText;
        set { _scanText = value; OnChanged(); }
    }

    public string UserDiscountText
    {
        get => _userDiscountText;
        set { _userDiscountText = value; OnChanged(); ScheduleTotalsRefresh(); }
    }

    public void SetDiscountInput(string? input)
    {
        if (_isLoadingSlot) return;
        var norm = DiscountInputHelper.NormalizeRaw(input);
        if (string.IsNullOrEmpty(norm))
        {
            UserDiscountText = "";
            return;
        }

        if (IsDiscountAmount && DiscountInputHelper.TryParseAmount(norm, out var amt))
            UserDiscountText = amt.ToString("N0", System.Globalization.CultureInfo.InvariantCulture);
        else
            UserDiscountText = norm;
    }

    public string ProductPreviewName
    {
        get => _productPreviewName;
        set { _productPreviewName = value; OnChanged(); }
    }

    public string ProductPreviewPrice
    {
        get => _productPreviewPrice;
        set { _productPreviewPrice = value; OnChanged(); }
    }

    public string ProductPreviewHint
    {
        get => _productPreviewHint;
        set { _productPreviewHint = value; OnChanged(); }
    }

    public bool ShowProductPreview { get; private set; }

    public string SubtotalDisplay { get; private set; } = "0 د.ع";
    public string DiscountDisplay { get; private set; } = "0 د.ع";
    public bool HasCartItems { get; private set; }
    public bool HasSearchResults => SearchResults.Count > 0;
    public string CashierInitial => string.IsNullOrWhiteSpace(CashierName) ? "ك" : CashierName.Trim()[0].ToString();
    public bool HasHeldReceipts => HeldReceipts.Count > 0;
    public bool IsSaleMode => ActiveSaleKind == SaleKind.Sale;
    public bool IsGiftMode => ActiveSaleKind == SaleKind.Gift;
    public bool IsEditingHeldReceipt => _recalledHoldId is not null;
    public string HeldReceiptBanner => _recalledHoldId is long id ? $"تعديل فاتورة معلّقة #{id}" : "";

    public bool ShowHoldsPanel
    {
        get => _showHoldsPanel;
        set { _showHoldsPanel = value; OnChanged(); }
    }

    public string HoldCountDisplay => HeldReceipts.Count == 0 ? "" : $"{HeldReceipts.Count} معلّقة";
    public bool ShowHeldBadge => HeldReceipts.Count > 0;
    public bool ShowPendingBadge => !string.IsNullOrEmpty(PendingText);
    public bool ShowSyncBadge => !string.IsNullOrEmpty(SyncText);
    public bool CanManageOffers => PermissionsHelper.CanManageOffers(Permissions);
    public bool CanHoldSale => PermissionsHelper.CanHold(Permissions);
    public bool CanChangePrice => PermissionsHelper.CanChangePrice(Permissions);
    public bool HasLastReceipt { get; private set; }
    public string LastReceiptDisplay { get; private set; } = "";
    public bool ShowCreditBalance => SelectedCreditAccount?.Id > 0;
    public string CreditBalanceDisplay => SelectedCreditAccount?.Id > 0
        ? $"رصيد: {MoneyFormat.FormatCurrency(SelectedCreditAccount.Balance)}"
        : "";
    public bool CanRepeatLastScan => _lastScannedProduct is not null;

    public bool CanApplyDiscount => PermissionsHelper.CanDiscount(Permissions);

    public int GroupItemsCount => GroupItems.Count;

    public bool HasGroupItems => GroupItemsCount > 0;

    public string GroupItemsCountDisplay => GroupItemsCount == 0 ? "" : $"{GroupItemsCount:N0} صنف";
    public string SessionStatsDisplay => _sessionSaleCount == 0 ? "لم تُبَع فواتير بعد" : $"{_sessionSaleCount} فاتورة · {MoneyFormat.FormatCurrency(_sessionSaleTotal)}";
    public bool CanCompleteSale => HasCartItems;

    public bool ShowProductsPanel
    {
        get => _showProductsPanel;
        set { _showProductsPanel = value; OnChanged(); }
    }

    public string ProductFilterText
    {
        get => _productFilter;
        set { _productFilter = value; OnChanged(); ApplyProductFilter(); }
    }

    public bool ShowSuccessOverlay
    {
        get => _showSuccessOverlay;
        private set { _showSuccessOverlay = value; OnChanged(); }
    }

    public string SuccessMessage
    {
        get => _successMessage;
        private set { _successMessage = value; OnChanged(); }
    }

    public string TotalDisplay
    {
        get => _totalDisplay;
        private set { _totalDisplay = value; OnChanged(); }
    }

    public string ItemCountDisplay
    {
        get => _itemCountDisplay;
        private set { _itemCountDisplay = value; OnChanged(); }
    }

    public string StatusText
    {
        get => _statusText;
        private set { _statusText = value; OnChanged(); }
    }

    public string SyncText
    {
        get => _syncText;
        set { _syncText = value; OnChanged(); }
    }

    public string PendingText
    {
        get => _pendingText;
        private set { _pendingText = value; OnChanged(); }
    }

    public bool IsOnline
    {
        get => _isOnline;
        private set { _isOnline = value; OnChanged(); }
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set { _isBusy = value; OnChanged(); }
    }

    public SaleKind ActiveSaleKind
    {
        get => _activeSaleKind;
        private set
        {
            if (_activeSaleKind == value) return;
            _activeSaleKind = value;
            OnChanged();
            OnChanged(nameof(IsReturnMode));
            OnChanged(nameof(IsGiftMode));
            OnChanged(nameof(IsSaleMode));
            OnChanged(nameof(SaleModeLabel));
            OnChanged(nameof(SaleModeAccent));
        }
    }

    public bool IsReturnMode => ActiveSaleKind == SaleKind.Return;

    public string SaleModeLabel => ActiveSaleKind switch
    {
        SaleKind.Return => "مرتجع",
        SaleKind.Gift => "هدية",
        _ => "بيع"
    };

    public string SaleModeAccent => ActiveSaleKind switch
    {
        SaleKind.Return => "#DC2626",
        SaleKind.Gift => "#7C3AED",
        _ => "#059669"
    };

    public DiscountInputMode DiscountMode
    {
        get => _discountMode;
        private set
        {
            if (_discountMode == value) return;
            _discountMode = value;
            OnChanged();
            OnChanged(nameof(IsDiscountPercent));
            OnChanged(nameof(IsDiscountAmount));
            OnChanged(nameof(DiscountModeHint));
            RecalculateTotals();
            SaveCurrentSlot();
            RefreshSlotsDisplay();
        }
    }

    public bool IsDiscountPercent => DiscountMode == DiscountInputMode.Percent;
    public bool IsDiscountAmount => DiscountMode == DiscountInputMode.Amount;
    public string DiscountModeHint => IsDiscountPercent ? "نسبة %" : "مبلغ د.ع";

    public void SetDiscountMode(DiscountInputMode mode)
    {
        if (DiscountMode == mode) return;
        DiscountMode = mode;
        if (mode == DiscountInputMode.Amount && !string.IsNullOrWhiteSpace(_userDiscountText))
            SetDiscountInput(_userDiscountText);
    }

    public void ToggleReturnMode()
    {
        if (!PermissionsHelper.CanReturn(Permissions))
        {
            Toast("لا تملك صلاحية الإرجاع", false);
            return;
        }
        ActiveSaleKind = ActiveSaleKind == SaleKind.Return ? SaleKind.Sale : SaleKind.Return;
        SaveCurrentSlot();
        RefreshSlotsDisplay();
    }

    public void ToggleGiftMode()
    {
        ActiveSaleKind = ActiveSaleKind == SaleKind.Gift ? SaleKind.Sale : SaleKind.Gift;
        SaveCurrentSlot();
        RefreshSlotsDisplay();
    }

    public int SelectedGroupIndex
    {
        get => _selectedGroupIndex;
        set
        {
            if (_selectedGroupIndex == value) return;
            _selectedGroupIndex = value;
            OnChanged();
            _ = LoadGroupItemsAsync();
        }
    }

    public int ActiveGroupKey
    {
        get => _activeGroupKey;
        set
        {
            if (_activeGroupKey == value) return;
            _activeGroupKey = value;
            OnChanged();
            OnChanged(nameof(ActiveGroupDisplay));
        }
    }

    public string ActiveGroupDisplay
    {
        get
        {
            var g = ActiveGroup;
            return g is null ? "مجموعة 1" : g.DisplayLabel;
        }
    }

    public CartGroup? ActiveGroup => CartGroups.FirstOrDefault(g => g.Key == ActiveGroupKey) ?? CartGroups.FirstOrDefault();

    public bool HasMultipleGroups => CartGroups.Count > 1;

    public AccountSummaryDto? SelectedCreditAccount
    {
        get => _selectedCreditAccount;
        set
        {
            _selectedCreditAccount = value;
            OnChanged();
            OnChanged(nameof(ShowCreditBalance));
            OnChanged(nameof(CreditBalanceDisplay));
        }
    }

    private int _activeGroupKey = 1;
    private AccountSummaryDto? _selectedCreditAccount;

    public CashBoxItem? SelectedCashBox { get; set; }

    public event PropertyChangedEventHandler? PropertyChanged;
    public event Action<string, bool>? ToastRequested;
    public event Action? FocusScanRequested;
    public event Action? SaleCompleted;
    public event Action? SaleSuccessFlash;
    public event Action<CartLine>? LineAdded;
    public event Func<ProductDto, decimal?, Task>? BeforeAddProduct;

    public async Task InitializeAsync()
    {
        var session = AppServices.Api.Session;
        Permissions = session?.Permissions;
        CashierName = session?.CashierName ?? "";
        SectionName = session?.SectionName ?? "—";
        OnChanged(nameof(CashierName));
        OnChanged(nameof(SectionName));
        OnChanged(nameof(CanManageOffers));
        OnChanged(nameof(CanHoldSale));
        OnChanged(nameof(CanChangePrice));
        OnChanged(nameof(CanApplyDiscount));

        LoadCashBoxes();
        await LoadSalesmenAsync();
        await RefreshAttributionCacheAsync();
        await LoadCreditAccountsAsync();
        await LoadGroupsAsync();
        await RefreshHeldReceiptsAsync();
        await RefreshStatusAsync();
        RefreshLastReceiptDisplay();
    }

    public void RefreshLastReceiptDisplay()
    {
        var last = LastReceiptStore.Load();
        HasLastReceipt = last is not null;
        LastReceiptDisplay = last is null ? "" : $"#{last.ReceiptNumber}";
        OnChanged(nameof(HasLastReceipt));
        OnChanged(nameof(LastReceiptDisplay));
    }

    public void RepeatLastScan()
    {
        if (_lastScannedProduct is null) { Toast("لا يوجد مسح سابق", false); return; }
        _ = InvokeAddAsync(_lastScannedProduct);
    }

    private async Task InvokeAddAsync(ProductDto product, decimal? qty = null)
    {
        if (BeforeAddProduct is not null)
            await BeforeAddProduct(product, qty);
        else
            AddProductToCart(product, qty);
    }

    public void VoidLastLine()
    {
        if (Cart.Count == 0) return;
        if (!PermissionsHelper.CanDeleteItem(Permissions)) { Toast("لا تملك صلاحية الحذف", false); return; }
        var line = Cart[^1];
        Cart.Remove(line);
        _recalledHoldId = null;
        ScheduleTotalsRefresh();
        Toast($"حُذف: {line.Name}");
    }

    public bool SetSelectedLinePrice(decimal price)
    {
        if (SelectedLine is null) return false;
        if (!PermissionsHelper.CanChangePrice(Permissions)) { Toast("لا تملك صلاحية تغيير السعر", false); return false; }
        if (price < 0) return false;
        SelectedLine.Price = price;
        _recalledHoldId = null;
        ScheduleTotalsRefresh();
        Toast($"سعر {SelectedLine.Name}: {price:N0}");
        return true;
    }

    public void DuplicateSelectedLine()
    {
        if (SelectedLine is null) { Toast("اختر صنفاً", false); return; }
        var src = SelectedLine;
        Cart.Add(new CartLine
        {
            ArticleId = src.ArticleId,
            Name = src.Name,
            Barcode = src.Barcode,
            Price = src.Price,
            OriginalPrice = src.OriginalPrice,
            Quantity = IsReturnMode ? -1m : 1m
        });
    }

    public async Task RefreshHeldReceiptsAsync()
    {
        HeldReceipts.Clear();
        var holds = await AppServices.Api.GetHoldReceiptsAsync();
        if (holds is null) return;
        foreach (var h in holds.OrderByDescending(h => h.CreationDate))
            HeldReceipts.Add(h);
        OnChanged(nameof(HasHeldReceipts));
        OnChanged(nameof(HoldCountDisplay));
        OnChanged(nameof(ShowHeldBadge));
    }

    public void SwitchToSlot(int slotNumber)
    {
        if (slotNumber is < 1 or > 3) return;
        var idx = slotNumber - 1;
        if (idx == _activeSlotIndex) return;

        SaveCurrentSlot();
        _activeSlotIndex = idx;
        LoadSlot(idx);
        RefreshSlotsDisplay();
        Toast($"فاتورة {slotNumber}");
        FocusScanRequested?.Invoke();
    }

    public void CycleSlot() => SwitchToSlot((_activeSlotIndex + 1) % 3 + 1);

    public void SwitchToFirstParkedSlot()
    {
        for (var i = 0; i < 3; i++)
        {
            if (i == _activeSlotIndex || !_invoiceSlots[i].HasItems) continue;
            SwitchToSlot(i + 1);
            return;
        }
    }

    private void SaveCurrentSlot()
    {
        var slot = _invoiceSlots[_activeSlotIndex];
        slot.Lines.Clear();
        foreach (var line in Cart)
            slot.Lines.Add(CloneLine(line));
        slot.UserDiscountText = UserDiscountText;
        slot.DiscountMode = DiscountMode;
        slot.ActiveSaleKind = ActiveSaleKind;
        slot.RecalledHoldId = _recalledHoldId;
        slot.Groups.Clear();
        foreach (var g in CartGroups)
            slot.Groups.Add(new CartGroup { Key = g.Key, DefaultSalesmanId = g.DefaultSalesmanId, DefaultSalesmanName = g.DefaultSalesmanName });
        slot.ActiveGroupKey = ActiveGroupKey;
    }

    private void LoadSlot(int idx)
    {
        _isLoadingSlot = true;
        try
        {
            var slot = _invoiceSlots[idx];
            Cart.Clear();
            foreach (var line in slot.Lines)
                Cart.Add(CloneLine(line));
            UserDiscountText = slot.UserDiscountText;
            _discountMode = slot.DiscountMode;
            OnChanged(nameof(IsDiscountPercent));
            OnChanged(nameof(IsDiscountAmount));
            OnChanged(nameof(DiscountModeHint));
            ActiveSaleKind = slot.ActiveSaleKind;
            _recalledHoldId = slot.RecalledHoldId;
            CartGroups.Clear();
            foreach (var g in slot.Groups)
                CartGroups.Add(new CartGroup { Key = g.Key, DefaultSalesmanId = g.DefaultSalesmanId, DefaultSalesmanName = g.DefaultSalesmanName });
            if (CartGroups.Count == 0) CartGroups.Add(new CartGroup { Key = 1 });
            ActiveGroupKey = slot.ActiveGroupKey > 0 ? slot.ActiveGroupKey : CartGroups[0].Key;
            RefreshGroupActiveFlags();
            OnChanged(nameof(HasMultipleGroups));
            OnChanged(nameof(ActiveGroupDisplay));
        }
        finally
        {
            _isLoadingSlot = false;
        }
        RecalculateTotals();
        OnChanged(nameof(IsEditingHeldReceipt));
        OnChanged(nameof(HeldReceiptBanner));
        RefreshSlotsDisplay();
    }

    private void RefreshSlotsDisplay()
    {
        for (var i = 0; i < 3; i++)
        {
            var disc = i == _activeSlotIndex ? UserDiscount : ComputeSlotDiscount(_invoiceSlots[i]);
            HoldSlots[i].Update(_invoiceSlots[i], i == _activeSlotIndex, i + 1, disc);
        }
    }

    private decimal ComputeSlotDiscount(InvoiceSlotState slot)
    {
        if (!PermissionsHelper.CanDiscount(Permissions)) return 0;
        var gross = slot.Subtotal;
        if (gross <= 0) return 0;
        var raw = (slot.UserDiscountText ?? "").Replace(",", "").Replace(" ", "").Trim();
        if (string.IsNullOrEmpty(raw)) return 0;
        if (!decimal.TryParse(raw, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var v) &&
            !decimal.TryParse(raw, out v))
            return 0;
        if (v <= 0) return 0;

        decimal disc;
        if (slot.DiscountMode == DiscountInputMode.Percent)
        {
            var pct = Math.Clamp(v, 0, 100);
            disc = Math.Round(gross * pct / 100m, 0);
        }
        else
        {
            disc = v;
        }

        var max = PermissionsHelper.MaxUserDiscount(Permissions);
        disc = Math.Min(disc, max);
        return Math.Min(disc, gross);
    }

    public void ToggleProductsPanel() => ShowProductsPanel = !ShowProductsPanel;

    private static CartLine CloneLine(CartLine src)
    {
        var line = new CartLine
        {
            ArticleId = src.ArticleId,
            Name = src.Name,
            Barcode = src.Barcode,
            Price = src.Price,
            OriginalPrice = src.OriginalPrice,
            Quantity = src.Quantity
        };
        line.SetAttribution(src.SalesmanId, src.SalesmanName, src.GroupKey, src.GroupLabel);
        return line;
    }

    public void ApplyDiscountPercent(int percent)
    {
        if (!PermissionsHelper.CanDiscount(Permissions)) { Toast("لا تملك صلاحية الخصم", false); return; }
        var disc = Math.Round(GrossSubtotal * percent / 100m, 0);
        UserDiscountText = Math.Min(disc, PermissionsHelper.MaxUserDiscount(Permissions)).ToString("N0");
    }

    public bool SetSelectedLineQuantity(decimal qty)
    {
        if (SelectedLine is null) return false;
        if (qty == 0) { RemoveSelectedLine(); return true; }
        SelectedLine.Quantity = qty;
        _recalledHoldId = null;
        RecalculateTotals();
        return true;
    }

    public async Task ReprintLastReceiptAsync()
    {
        var last = LastReceiptStore.Load();
        if (last is null) { Toast("لا توجد فاتورة سابقة", false); return; }
        try
        {
            var settings = await PrintSettingsCache.GetAsync();
            var local = LocalPrintConfig.Load();
            ReceiptPrinter.Print(settings, last, local.PrinterName, silent: false);
            Toast("إعادة طباعة");
        }
        catch (Exception ex) { Toast(UiErrors.ToArabic(ex), false); }
    }

    private void RecordSessionSale(decimal total)
    {
        _sessionSaleCount++;
        _sessionSaleTotal += total;
        OnChanged(nameof(SessionStatsDisplay));
    }

    private void FlashSaleSuccess(string message)
    {
        SuccessMessage = message;
        ShowSuccessOverlay = true;
        SaleSuccessFlash?.Invoke();
    }

    public void HideSuccessOverlay() => ShowSuccessOverlay = false;

    private void ApplyProductFilter()
    {
        GroupItems.Clear();
        var term = _productFilter.Trim();
        var source = string.IsNullOrWhiteSpace(term)
            ? _allGroupItems
            : _allGroupItems.Where(i => (i.Name?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false)
                                        || (i.Barcode?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false));
        foreach (var i in source) GroupItems.Add(i);
        OnChanged(nameof(GroupItemsCount));
        OnChanged(nameof(HasGroupItems));
        OnChanged(nameof(GroupItemsCountDisplay));
    }

    private void LoadCashBoxes()
    {
        CashBoxes.Clear();
        foreach (var box in AppServices.Api.Session?.CashBoxes ?? [])
            CashBoxes.Add(new CashBoxItem(box));

        var active = AppServices.Api.ActiveMasterAccount;
        SelectedCashBox = CashBoxes.FirstOrDefault(b => b.MasterAccount == active) ?? CashBoxes.FirstOrDefault();
        OnChanged(nameof(CashBoxes));
    }

    public void OnCashBoxChanged(CashBoxItem? item)
    {
        SelectedCashBox = item;
        if (item is not null)
            AppServices.Api.SetActiveCashBox(item.MasterAccount);
    }

    private async Task LoadSalesmenAsync()
    {
        Salesmen.Clear();
        foreach (var s in AppServices.Catalog.GetSalesmen())
            Salesmen.Add(s);

        if (Salesmen.Count > 0 || !await AppServices.Api.IsOnlineAsync()) return;

        var res = await AppServices.Api.GetSalesmenAsync();
        if (res?.Items is null) return;
        foreach (var s in res.Items) Salesmen.Add(s);
        AppServices.Catalog.ReplaceSalesmen(res.Items);
    }

    public async Task RefreshAttributionCacheAsync()
    {
        var local = AppServices.Catalog.GetAttributionArticles();
        if (local.Count > 0)
            AppServices.Attribution.Replace(local);

        if (!await AppServices.Api.IsOnlineAsync()) return;

        try
        {
            var ids = await AppServices.Api.GetAttributionArticleIdsAsync();
            if (ids is not null)
            {
                AppServices.Attribution.Replace(ids);
                AppServices.Catalog.ReplaceAttributionArticles(ids);
            }
        }
        catch { /* offline */ }
    }

    public async Task<ProductAttributionDto> GetAttributionAsync(ProductDto product)
    {
        if (product.Seq > 0 && AppServices.Attribution.RequiresSalesman(product.Seq))
            return new ProductAttributionDto(true, true, false, "عمولة أو تاركت — اختر المندوب");
        if (!await AppServices.Api.IsOnlineAsync())
            return new ProductAttributionDto(false, false, false, null);
        return await AppServices.Api.GetProductAttributionAsync(product.Id, product.Barcode)
               ?? new ProductAttributionDto(false, false, false, null);
    }

    public SalesmanDto? ResolveSalesmanForAdd(ProductAttributionDto attr)
    {
        if (ActiveGroup?.DefaultSalesmanId is long id and > 0)
        {
            return Salesmen.FirstOrDefault(s => s.Id == id)
                   ?? new SalesmanDto(id, ActiveGroup.DefaultSalesmanName ?? $"#{id}");
        }
        return null;
    }

    public void AddCartGroup()
    {
        var key = CartGroups.Count == 0 ? 1 : CartGroups.Max(g => g.Key) + 1;
        CartGroups.Add(new CartGroup { Key = key });
        ActiveGroupKey = key;
        RefreshGroupActiveFlags();
        OnChanged(nameof(HasMultipleGroups));
    }

    public void SetActiveGroup(int key)
    {
        if (CartGroups.All(g => g.Key != key)) return;
        ActiveGroupKey = key;
        RefreshGroupActiveFlags();
    }

    public void SetActiveGroupSalesman(SalesmanDto salesman)
    {
        var group = ActiveGroup;
        if (group is null) return;
        group.DefaultSalesmanId = salesman.Id;
        group.DefaultSalesmanName = salesman.Name;
        OnChanged(nameof(ActiveGroupDisplay));
    }

    private void RefreshGroupActiveFlags()
    {
        foreach (var g in CartGroups)
            g.IsActive = g.Key == ActiveGroupKey;
    }

    public void AssignSalesmanToSelectedLine(SalesmanDto salesman)
    {
        if (SelectedLine is null) return;
        SelectedLine.SetAttribution(salesman.Id, salesman.Name, SelectedLine.GroupKey, SelectedLine.GroupLabel);
        Toast($"مندوب {SelectedLine.Name}: {salesman.Name}");
    }

    private async Task LoadCreditAccountsAsync()
    {
        CreditAccounts.Clear();
        if (!PermissionsHelper.CanCredit(Permissions)) return;

        var cached = AppServices.Catalog.GetCreditAccounts();
        if (cached.Count > 0)
        {
            CreditAccounts.Add(new AccountSummaryDto(0, null, "— نقدي —", 0));
            foreach (var a in cached) CreditAccounts.Add(a);
            SelectedCreditAccount = CreditAccounts.FirstOrDefault();
            OnChanged(nameof(SelectedCreditAccount));
            if (!await AppServices.Api.IsOnlineAsync()) return;
        }

        var accounts = await AppServices.Api.GetCreditAccountsAsync();
        if (accounts is null) return;
        CreditAccounts.Clear();
        CreditAccounts.Add(new AccountSummaryDto(0, null, "— نقدي —", 0));
        foreach (var a in accounts) CreditAccounts.Add(a);
        AppServices.Catalog.ReplaceCreditAccounts(accounts);
        SelectedCreditAccount = CreditAccounts.FirstOrDefault();
        OnChanged(nameof(SelectedCreditAccount));
    }

    private async Task LoadGroupsAsync()
    {
        Groups.Clear();
        var groups = await AppServices.Api.GetGroupsAsync();
        if (groups is null || groups.Count == 0) return;
        foreach (var g in groups) Groups.Add(g);
        SelectedGroupIndex = 0;
    }

    private async Task LoadGroupItemsAsync()
    {
        GroupItems.Clear();
        _allGroupItems.Clear();
        if (SelectedGroupIndex < 0 || SelectedGroupIndex >= Groups.Count) return;
        var group = Groups[SelectedGroupIndex];
        IReadOnlyList<ArticleGroupItemDto>? items = null;
        if (AppServices.GroupCache.TryGet(group.Id, out items) && items is not null)
        {
            _allGroupItems.AddRange(items);
            ApplyProductFilter();
            return;
        }

        items = await AppServices.Api.GetGroupItemsAsync(group.Id);
        if (items is null) return;
        AppServices.GroupCache.Set(group.Id, items);
        _allGroupItems.AddRange(items);
        ApplyProductFilter();
    }

    public void QueueSearch(string term)
    {
        // Barcode field is lookup-only; no live search dropdown.
        _pendingSearch = term;
        _searchDebounce.Stop();
        SearchResults.Clear();
    }

    private async Task RunSearchAsync()
    {
        _searchDebounce.Stop();
        if (!PermissionsHelper.CanSearch(Permissions)) return;
        var results = await AppServices.Api.SearchProductsAsync(_pendingSearch);
        SearchResults.Clear();
        foreach (var p in results) SearchResults.Add(p);
    }

    public async Task ProcessScanAsync(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return;

        if (TryParseQtyPrefix(code, out var qty, out var productCode))
        {
            await ProcessScanWithQtyAsync(productCode, qty);
            return;
        }

        var product = await AppServices.Api.GetByBarcodeAsync(code);
        if (product is null)
        {
            PosFeedback.ScanError();
            Toast("لم يُعثر على المنتج", false);
            return;
        }

        _lastScannedProduct = product;
        OnChanged(nameof(CanRepeatLastScan));
        await InvokeAddAsync(product);
    }

    private static bool TryParseQtyPrefix(string code, out decimal qty, out string productCode)
    {
        qty = 1;
        productCode = code;
        foreach (var sep in new[] { '*', 'x', 'X', '×' })
        {
            var idx = code.IndexOf(sep);
            if (idx <= 0) continue;
            if (decimal.TryParse(code[..idx].Replace(",", ""), out qty) && qty > 0)
            {
                productCode = code[(idx + 1)..].Trim();
                return !string.IsNullOrWhiteSpace(productCode);
            }
        }
        return false;
    }

    private async Task ProcessScanWithQtyAsync(string code, decimal qty)
    {
        var product = await AppServices.Api.GetByBarcodeAsync(code);
        if (product is null) { Toast("لم يُعثر على المنتج", false); return; }
        await InvokeAddAsync(product, qty);
    }

    public async Task SubmitScanBoxAsync()
    {
        var text = ScanText.Trim();
        if (string.IsNullOrEmpty(text)) return;
        await ProcessScanAsync(text);
        ScanText = "";
        SearchResults.Clear();
        ClearProductPreview();
    }

    public void PreviewSearchProduct(ProductDto product) => ShowProduct(product);

    public Task SelectAndAddProductAsync(ProductDto product) => InvokeAddAsync(product);

    public Task AddGroupItemAsync(ArticleGroupItemDto item)
    {
        var product = new ProductDto(item.ProductId, item.Seq, null, item.Name, item.Barcode,
            item.OriginalPrice, item.Price, 0, 0, null);
        return InvokeAddAsync(product);
    }

    private void ShowProduct(ProductDto p)
    {
        _currentProduct = p;
        ShowProductPreview = true;
        ProductPreviewName = p.Name ?? p.Barcode ?? "—";
        ProductPreviewPrice = MoneyFormat.FormatCurrency(p.Price);
        ProductPreviewHint = string.IsNullOrWhiteSpace(p.Barcode) ? "جاهز للإضافة" : p.Barcode;
        OnChanged(nameof(ShowProductPreview));
    }

    public void ClearProductPreview()
    {
        _currentProduct = null;
        ShowProductPreview = false;
        ProductPreviewName = "";
        ProductPreviewPrice = "";
        ProductPreviewHint = "";
        OnChanged(nameof(ShowProductPreview));
    }

    public void AddProductToCart(ProductDto product, decimal? qtyOverride = null, SalesmanDto? salesman = null)
    {
        if (IsReturnMode && !PermissionsHelper.CanReturn(Permissions))
        {
            Toast("لا تملك صلاحية الإرجاع", false);
            return;
        }
        _recalledHoldId = null;
        OnChanged(nameof(IsEditingHeldReceipt));
        OnChanged(nameof(HeldReceiptBanner));
        var qty = qtyOverride ?? (IsReturnMode ? -1m : 1m);
        if (IsReturnMode && qtyOverride is null) qty = -1m;
        else if (IsReturnMode && qtyOverride > 0) qty = -Math.Abs(qtyOverride.Value);
        else if (!IsReturnMode && qtyOverride > 0) qty = Math.Abs(qtyOverride.Value);

        var group = ActiveGroup;
        var groupKey = group?.Key;
        var groupLabel = group?.Label;
        var salesmanId = salesman?.Id ?? group?.DefaultSalesmanId ?? 0;
        var salesmanName = salesman?.Name ?? group?.DefaultSalesmanName;

        var existing = Cart.FirstOrDefault(c =>
            c.ArticleId == product.Id && c.SalesmanId == salesmanId && c.GroupKey == groupKey);
        CartLine? addedLine = null;
        if (existing is not null)
        {
            existing.Quantity += qty;
            addedLine = existing;
        }
        else
        {
            addedLine = new CartLine
            {
                ArticleId = product.Id,
                Name = product.Name,
                Barcode = product.Barcode ?? product.Num,
                Price = product.Price,
                OriginalPrice = product.OriginalPrice,
                Quantity = qty
            };
            addedLine.SetAttribution(salesmanId, salesmanName, groupKey, groupLabel);
            Cart.Add(addedLine);
        }

        _lastScannedProduct = product;
        OnChanged(nameof(CanRepeatLastScan));
        ShowProduct(product);
        ScanText = "";
        SearchResults.Clear();
        if (addedLine is not null)
        {
            SelectedLine = addedLine;
            LineAdded?.Invoke(addedLine);
        }
        FocusScanRequested?.Invoke();
    }

    public void AdjustLineQty(CartLine line, int delta)
    {
        SelectedLine = line;
        AdjustSelectedQty(delta);
    }

    public void RemoveLine(CartLine line)
    {
        SelectedLine = line;
        RemoveSelectedLine();
    }

    public void AdjustSelectedQty(int delta)
    {
        if (SelectedLine is null) return;
        SelectedLine.Quantity += delta;
        if (SelectedLine.Quantity == 0) Cart.Remove(SelectedLine);
        _recalledHoldId = null;
        ScheduleTotalsRefresh();
    }

    public void RemoveSelectedLine()
    {
        if (!PermissionsHelper.CanDeleteItem(Permissions)) { Toast("لا تملك صلاحية الحذف", false); return; }
        if (SelectedLine is null) return;
        Cart.Remove(SelectedLine);
        _recalledHoldId = null;
        ScheduleTotalsRefresh();
    }

    public void ClearCart()
    {
        Cart.Clear();
        CartGroups.Clear();
        CartGroups.Add(new CartGroup { Key = 1 });
        ActiveGroupKey = 1;
        RefreshGroupActiveFlags();
        OnChanged(nameof(HasMultipleGroups));
        OnChanged(nameof(ActiveGroupDisplay));
        _recalledHoldId = null;
        ScheduleTotalsRefresh();
    }

    public async Task<bool> HoldSaleAsync()
    {
        if (Cart.Count == 0) { Toast("السلة فارغة", false); return false; }
        if (!PermissionsHelper.CanHold(Permissions)) { Toast("لا تملك صلاحية التعليق", false); return false; }

        await RefreshHeldReceiptsAsync();
        var max = PermissionsHelper.MaxHoldReceipts(Permissions);
        if (_recalledHoldId is null && HeldReceipts.Count >= max)
        {
            Toast($"الحد الأقصى {max} فواتير معلّقة — أكمل أو استرجع واحدة", false);
            return false;
        }

        IsBusy = true;
        try
        {
            var result = await AppServices.Api.CreateReceiptAsync(BuildRequest(0, true));
            if (result is null) { Toast("فشل التعليق", false); return false; }
            Toast($"تم التعليق · #{result.Number}");
            ResetAfterSale(clearDiscount: true);
            await RefreshHeldReceiptsAsync();
            return true;
        }
        finally { IsBusy = false; }
    }

    public async Task<bool> RecallHoldAsync(long holdId, bool force = false)
    {
        if (!force && HasCartItems && _recalledHoldId != holdId)
            return false;

        var detail = await AppServices.Api.GetReceiptAsync(holdId);
        if (detail is null) { Toast("تعذّر تحميل الفاتورة", false); return false; }

        Cart.Clear();
        foreach (var item in detail.Items)
        {
            Cart.Add(new CartLine
            {
                ArticleId = item.ArticleId,
                Name = item.Name,
                Barcode = item.Barcode,
                Price = item.Price,
                OriginalPrice = item.OriginalPrice,
                Quantity = item.Quantity
            });
        }

        UserDiscountText = detail.UserDiscount > 0 ? detail.UserDiscount.ToString("N0") : "";
        _recalledHoldId = holdId;
        RecalculateTotals();
        OnChanged(nameof(IsEditingHeldReceipt));
        OnChanged(nameof(HeldReceiptBanner));
        Toast($"فاتورة #{holdId} · {detail.Items.Count} أصناف");
        FocusScanRequested?.Invoke();
        return true;
    }

    /// <summary>Card payment is always offered; the terminal service defaults to localhost:9092.</summary>
    public bool CardPaymentAvailable => true;

    /// <summary>Amount the card must cover — card sales always take the full total.</summary>
    public decimal AmountDue => Math.Max(0, GrossSubtotal - UserDiscount);

    /// <summary>Reason the card button cannot be used right now, or null when it can.</summary>
    public string? CardPaymentBlockedReason()
    {
        if (Cart.Count == 0) return "السلة فارغة";
        if (!AppServices.CardTerminal.IsConfigured) return "تعذر ضبط خدمة جهاز الدفع";
        if (IsReturnMode) return "الإرجاع بالبطاقة يجري من جهاز الدفع نفسه";
        if (ActiveSaleKind == SaleKind.Gift) return "الهدايا تُسجّل بدون بطاقة";
        if (SelectedCreditAccount?.Id > 0) return "لا يمكن الدفع بالبطاقة مع حساب آجل";
        if (IsEditingHeldReceipt) return "أكمل الفاتورة المعلّقة نقداً أو ابدأ فاتورة جديدة";
        if (AmountDue <= 0) return "لا يوجد مبلغ للدفع";
        return null;
    }

    public async Task<bool> CompleteSaleAsync(CardPaymentDto? card = null)
    {
        if (Cart.Count == 0) { Toast("السلة فارغة", false); return false; }
        if (AppServices.Api.Session is null) return false;

        var total = Math.Max(0, GrossSubtotal - UserDiscount);
        var accountId = SelectedCreditAccount?.Id > 0 ? SelectedCreditAccount.Id : (long?)null;
        var paid = card is not null
            ? total
            : accountId is not null
                ? 0m
                : ActiveSaleKind == SaleKind.Gift
                    ? 0m
                    : total;
        if (card is null && accountId is null && paid < total && ActiveSaleKind != SaleKind.Gift)
        {
            Toast("المبلغ المدفوع غير كافٍ", false);
            return false;
        }

        IsBusy = true;
        try
        {
            if (_recalledHoldId is long holdId)
            {
                var holdResult = await AppServices.Api.CompleteHoldAsync(holdId, paid);
                if (holdResult is null) { Toast("فشل استرجاع الفاتورة", false); return false; }
                Toast($"فاتورة #{holdResult.Number} · {MoneyFormat.FormatCurrency(holdResult.TotalAmount)}");
                FlashSaleSuccess($"تم البيع · #{holdResult.Number}");
                RecordSessionSale(holdResult.TotalAmount);
                await PrintAsync(new CreateReceiptResponse(holdResult.Id, holdResult.Number, holdResult.TotalAmount, holdResult.CashBack),
                    BuildRequest(paid, false), holdResult.SalesmanName);
                ResetAfterSale(clearDiscount: true);
                SaleCompleted?.Invoke();
                RefreshLastReceiptDisplay();
                PosFeedback.SaleComplete();
                await RefreshHeldReceiptsAsync();
                return true;
            }

            var req = BuildRequest(paid, false, card);
            var result = await AppServices.Api.CreateReceiptAsync(req);
            if (result is null) { Toast("فشل حفظ الفاتورة", false); return false; }

            var offline = result.ReceiptId == 0;
            var cardNote = card is null ? "" : $" · {card.CardName ?? "بطاقة"}";
            var receiptLabel = offline ? $"مؤقت #{result.Number}" : $"#{result.Number}";
            Toast(offline
                ? $"حُفظت محلياً · {receiptLabel} · {MoneyFormat.FormatCurrency(result.TotalAmount)}{cardNote}"
                : $"{receiptLabel} · {MoneyFormat.FormatCurrency(result.TotalAmount)}{cardNote}");
            FlashSaleSuccess(offline ? $"حُفظت · {receiptLabel}" : $"تم البيع · #{result.Number}");
            RecordSessionSale(result.TotalAmount);

            await PrintAsync(result, req, null);

            ResetAfterSale(clearDiscount: true);
            SaleCompleted?.Invoke();
            RefreshLastReceiptDisplay();
            PosFeedback.SaleComplete();
            await RefreshStatusAsync();
            await RefreshHeldReceiptsAsync();
            return true;
        }
        finally { IsBusy = false; }
    }

    private async Task PrintAsync(CreateReceiptResponse result, CreateReceiptRequest req, string? salesmanName)
    {
        try
        {
            var settings = await PrintSettingsCache.GetAsync();
            var local = LocalPrintConfig.Load();
            var printData = ReceiptPrinter.BuildPrintData(
                result, req, Cart.ToList(),
                AppServices.Api.Session!.CashierName, salesmanName, null);
            LastReceiptStore.Save(printData);

            var silent = settings.AutoPrint && !local.AskBeforePrint;
            ReceiptPrinter.Print(settings, printData, local.PrinterName, silent);
        }
        catch (Exception ex)
        {
            Toast($"تعذرت الطباعة: {UiErrors.ToArabic(ex)}", false);
        }
    }

    private void ResetAfterSale(bool clearDiscount)
    {
        Cart.Clear();
        _recalledHoldId = null;
        if (clearDiscount) UserDiscountText = "";
        SelectedCreditAccount = CreditAccounts.FirstOrDefault();
        OnChanged(nameof(SelectedCreditAccount));
        ActiveSaleKind = SaleKind.Sale;

        var slot = _invoiceSlots[_activeSlotIndex];
        slot.ClearAfterSale();
        if (clearDiscount) slot.UserDiscountText = "";

        RecalculateTotals();
        RefreshSlotsDisplay();
        OnChanged(nameof(IsEditingHeldReceipt));
        OnChanged(nameof(HeldReceiptBanner));
        FocusScanRequested?.Invoke();
    }

    private CreateReceiptRequest BuildRequest(decimal paid, bool isPending, CardPaymentDto? card = null, Guid? clientReceiptId = null)
    {
        var kind = (int)ActiveSaleKind;
        return new CreateReceiptRequest(
            AppServices.Api.Session!.CashierId,
            0,
            AppServices.Api.Session.PosTerminalId, paid,
            Cart.Select(c => new CreateReceiptItemRequest(c.ArticleId, c.Barcode,
                ActiveSaleKind == SaleKind.Return ? Math.Abs(c.Quantity) : c.Quantity, c.Price,
                c.OriginalPrice, Math.Max(0, c.OriginalPrice - c.Price),
                c.SalesmanId, c.SalesmanName, c.GroupKey, c.GroupLabel)).ToList(),
            kind, isPending, UserDiscount,
            SelectedCreditAccount?.Id is > 0 ? SelectedCreditAccount.Id : null,
            AppServices.Api.ActiveMasterAccount > 0 ? AppServices.Api.ActiveMasterAccount : null,
            card,
            clientReceiptId);
    }

    public async Task RefreshStatusAsync()
    {
        var online = await AppServices.Api.IsOnlineAsync();
        IsOnline = online;
        StatusText = online ? "متصل بالخادم" : "وضع دون اتصال";
        if (online)
            await AppServices.Coordinator.RunAsync();
        PendingText = AppServices.Catalog.PendingReceiptCount > 0
            ? $"لم تُرفع: {AppServices.Catalog.PendingReceiptCount}" : "";
        OnChanged(nameof(ShowPendingBadge));
    }

    public async Task<int> SyncPendingReceiptsNowAsync()
    {
        var before = AppServices.Catalog.PendingReceiptCount;
        if (before == 0) return 0;

        await AppServices.Coordinator.RunAsync(force: true);
        var synced = before - AppServices.Catalog.PendingReceiptCount;

        if (synced > 0)
            Toast($"تم رفع {synced} فاتورة للخادم");
        if (!string.IsNullOrWhiteSpace(AppServices.Sync.LastReceiptSyncError))
            Toast(AppServices.Sync.LastReceiptSyncError, false);
        else if (synced == 0 && AppServices.Catalog.PendingReceiptCount > 0)
            Toast("تعذّر رفع الفواتير — تحقق من الخادم وقاعدة البيانات", false);

        await RefreshStatusAsync();
        return synced;
    }

    public void OnSyncProgress(int synced, int total)
    {
        SyncText = total > 0 ? $"{synced:N0}/{total:N0}" : "";
        OnChanged(nameof(ShowSyncBadge));
    }

    public void ApplyCachedCreditAccounts()
    {
        if (!PermissionsHelper.CanCredit(Permissions)) return;
        var selectedId = SelectedCreditAccount?.Id ?? 0;
        CreditAccounts.Clear();
        CreditAccounts.Add(new AccountSummaryDto(0, null, "— نقدي —", 0));
        foreach (var a in AppServices.Catalog.GetCreditAccounts())
            CreditAccounts.Add(a);
        SelectedCreditAccount = CreditAccounts.FirstOrDefault(a => a.Id == selectedId)
            ?? CreditAccounts.FirstOrDefault();
        OnChanged(nameof(SelectedCreditAccount));
    }

    public void OnSyncCompleted()
    {
        SyncText = $"{AppServices.Catalog.ProductCount:N0} منتج";
        OnChanged(nameof(ShowSyncBadge));
        ApplyCachedCreditAccounts();
        _ = RefreshAttributionCacheAsync();
    }

    private decimal SignedCartTotal => Cart.Sum(c => c.LineTotal);

    private decimal GrossSubtotal => Math.Abs(SignedCartTotal);

    private decimal UserDiscount
    {
        get
        {
            if (!PermissionsHelper.CanDiscount(Permissions)) return 0;
            if (GrossSubtotal <= 0) return 0;
            var raw = (UserDiscountText ?? "").Replace(",", "").Replace(" ", "").Trim();
            if (string.IsNullOrEmpty(raw)) return 0;
            if (!decimal.TryParse(raw, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var v) &&
                !decimal.TryParse(raw, out v))
                return 0;
            if (v <= 0) return 0;

            decimal disc;
            if (DiscountMode == DiscountInputMode.Percent)
            {
                var pct = Math.Clamp(v, 0, 100);
                disc = Math.Round(GrossSubtotal * pct / 100m, 0);
            }
            else
            {
                disc = v;
            }

            var max = PermissionsHelper.MaxUserDiscount(Permissions);
            disc = Math.Min(disc, max);
            return Math.Min(disc, GrossSubtotal);
        }
    }

    private void RecalculateTotals()
    {
        var count = (int)Cart.Sum(c => Math.Abs(c.Quantity));
        HasCartItems = Cart.Count > 0;
        ItemCountDisplay = count == 0 ? "فارغة" : $"{Cart.Count} أصناف · {count} قطعة";

        var gross = GrossSubtotal;
        var disc = UserDiscount;
        var net = Math.Max(0, gross - disc);

        SubtotalDisplay = MoneyFormat.FormatCurrency(gross);
        DiscountDisplay = disc > 0 ? MoneyFormat.FormatCurrency(disc) : "—";
        TotalDisplay = MoneyFormat.FormatCurrency(net);

        OnChanged(nameof(CanCompleteSale));
        OnChanged(nameof(AmountDue));
        OnChanged(nameof(HasCartItems));
        OnChanged(nameof(SubtotalDisplay));
        OnChanged(nameof(DiscountDisplay));
    }

    public void Toast(string msg, bool ok = true) => ToastRequested?.Invoke(msg, ok);

    private void OnChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    public sealed class CashBoxItem(SectionCashBoxDto box)
    {
        public long MasterAccount => box.MasterAccount;
        public string Label => string.IsNullOrWhiteSpace(box.MasterAccountNum)
            ? box.MasterAccountName ?? $"#{box.MasterAccount}"
            : $"{box.MasterAccountNum} — {box.MasterAccountName}";
        public override string ToString() => Label;
    }
}
