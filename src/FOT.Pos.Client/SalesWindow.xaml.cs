using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using FOT.Pos.Client.Models;
using FOT.Pos.Client.Services;
using FOT.Pos.Client.ViewModels;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class SalesWindow : Window
{
    private readonly SalesViewModel _vm = new();
    private readonly BarcodeInputHandler _scanner = new();
    private readonly DispatcherTimer _clock = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly DispatcherTimer _statusTimer = new() { Interval = TimeSpan.FromSeconds(10) };
    private readonly DispatcherTimer _successTimer = new() { Interval = TimeSpan.FromSeconds(1.8) };
    private bool _processingScan;
    private bool _discountFormatting;

    public SalesWindow()
    {
        InitializeComponent();
        DataContext = _vm;

        _vm.BeforeAddProduct += AddProductWithAttributionAsync;

        _vm.ToastRequested += (msg, ok) => Dispatcher.Invoke(() => PosToast.Show(ToastHost, ToastText, msg, ok));
        _vm.FocusScanRequested += () => Dispatcher.Invoke(FocusScan);
        _vm.SaleSuccessFlash += () => Dispatcher.Invoke(PlaySuccessAnimation);
        _vm.LineAdded += line => Dispatcher.Invoke(() =>
        {
            _vm.SelectedLine = line;
            CartGrid.SelectedItem = line;
            CartGrid.ScrollIntoView(line);
        });
        _vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SalesViewModel.TotalDisplay))
                Dispatcher.Invoke(PulseTotal);
            if (e.PropertyName == nameof(SalesViewModel.ShowProductsPanel))
                Dispatcher.Invoke(UpdateProductsColumn);
        };

        _scanner.ScanCompleted += async code => await Dispatcher.InvokeAsync(async () =>
        {
            if (_processingScan) return;
            _scanner.Reset();
            await RunScanAsync(code);
        });

        _clock.Tick += (_, _) => ClockLabel.Text = DateTime.Now.ToString("HH:mm:ss");
        _statusTimer.Tick += async (_, _) => await _vm.RefreshStatusAsync();
        _successTimer.Tick += (_, _) =>
        {
            _successTimer.Stop();
            _vm.HideSuccessOverlay();
        };

        AppServices.Sync.ProgressChanged += (s, t) => _vm.OnSyncProgress(s, t);
        AppServices.Sync.SyncCompleted += () => _vm.OnSyncCompleted();
        AppServices.Hub.CatalogUpdated += () => _ = RefreshFromHubAsync();
        AppServices.Coordinator.ReceiptsUploaded += n =>
            Dispatcher.Invoke(() => PosToast.Show(ToastHost, ToastText, $"رفع {n} فاتورة للخادم", true));

        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private async Task RefreshFromHubAsync()
    {
        try
        {
            await AppServices.Coordinator.RunAsync(force: true);
            await Dispatcher.InvokeAsync(() => _vm.ApplyCachedCreditAccounts());
        }
        catch
        {
            /* keep the cashier selling */
        }
    }

    private void FocusScan()
    {
        ScanBox.Focus();
        ScanBox.SelectAll();
    }

    private void UpdateProductsColumn()
    {
        ProductsColumn.Width = _vm.ShowProductsPanel ? new GridLength(300) : new GridLength(0);
        ProductsColumn.MinWidth = _vm.ShowProductsPanel ? 260 : 0;
    }

    private void PlaySuccessAnimation()
    {
        _successTimer.Stop();
        if (SuccessOverlay.TryFindResource("SuccessIn") is Storyboard anim)
        {
            anim = anim.Clone();
            anim.Completed += (_, _) => _successTimer.Start();
            if (SuccessOverlay.Child is Border card)
                anim.Begin(card);
        }
        else
        {
            _successTimer.Start();
        }
    }

    private void PulseTotal()
    {
        if (TotalLabel.TryFindResource("CartPulse") is not Storyboard pulse) return;
        pulse = pulse.Clone();
        pulse.Begin(TotalLabel);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        TouchKeyboardHelper.ApplyToWindow(this);
        ApplyPermissions();
        await _vm.InitializeAsync();
        WireComboSelections();
        UpdateProductsColumn();
        _clock.Start();
        _statusTimer.Start();
        try
        {
            await AppServices.Hub.ConnectAsync();
            _ = AppServices.Coordinator.RunAsync(force: true);
        }
        catch { /* offline ok */ }
        FocusScan();
    }

    private void ApplyPermissions()
    {
        if (!PermissionsHelper.CanDiscount(_vm.Permissions))
            DiscountBox.IsEnabled = false;
        if (!PermissionsHelper.CanCredit(_vm.Permissions))
            CreditPickerHost.Visibility = Visibility.Collapsed;
    }

    private void WireComboSelections()
    {
        if (CashBoxPicker.ItemsSource is not null && _vm.SelectedCashBox is not null)
            CashBoxPicker.SelectedItem = _vm.SelectedCashBox;
        else if (_vm.CashBoxes.Count > 0)
            CashBoxPicker.SelectedItem = _vm.CashBoxes[0];
    }

    private void CashBoxPicker_OnSelectionChanged(object? sender, EventArgs e)
    {
        if (CashBoxPicker.SelectedItem is SalesViewModel.CashBoxItem item)
            _vm.OnCashBoxChanged(item);
    }

    private async void OnClosed(object? sender, EventArgs e)
    {
        _clock.Stop();
        _statusTimer.Stop();
        _successTimer.Stop();
        await AppServices.Hub.DisposeAsync();
    }

    private async Task AddProductWithAttributionAsync(ProductDto product, decimal? qty = null)
    {
        var attr = await _vm.GetAttributionAsync(product);
        var salesman = _vm.ResolveSalesmanForAdd(attr);
        if (attr.RequiresSalesman && salesman is null)
        {
            var dlg = new SalesmanPickDialog(_vm.Salesmen, product.Name, attr.Reason);
            if (PosOverlay.Show(dlg, this) != true || dlg.SelectedSalesman is null) return;
            salesman = dlg.SelectedSalesman;
            _vm.SetActiveGroupSalesman(salesman);
        }
        _vm.AddProductToCart(product, qty, salesman);
    }

    private void CartGroup_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: int key })
            _vm.SetActiveGroup(key);
    }

    private void AddCartGroup_Click(object sender, RoutedEventArgs e) => _vm.AddCartGroup();

    private void SetGroupSalesman_Click(object sender, RoutedEventArgs e) => ShowGroupSalesmanDialog();

    private void LineSalesman_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: CartLine line })
        {
            _vm.SelectedLine = line;
            ShowLineSalesmanDialog();
        }
    }

    private void ShowGroupSalesmanDialog()
    {
        if (_vm.Salesmen.Count == 0) { _vm.Toast("لا يوجد مندوبون", false); return; }
        var dlg = new SalesmanPickDialog(_vm.Salesmen, _vm.ActiveGroupDisplay, "مندوب المجموعة النشطة");
        if (PosOverlay.Show(dlg, this) != true || dlg.SelectedSalesman is null) return;
        _vm.SetActiveGroupSalesman(dlg.SelectedSalesman);
    }

    private void ShowLineSalesmanDialog()
    {
        if (_vm.SelectedLine is null) return;
        if (_vm.Salesmen.Count == 0) { _vm.Toast("لا يوجد مندوبون", false); return; }
        var dlg = new SalesmanPickDialog(_vm.Salesmen, _vm.SelectedLine.Name, "مندوب هذا الصنف");
        if (PosOverlay.Show(dlg, this) != true || dlg.SelectedSalesman is null) return;
        _vm.AssignSalesmanToSelectedLine(dlg.SelectedSalesman);
    }

    private void DiscountBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_discountFormatting || !_vm.IsDiscountAmount) return;
        _discountFormatting = true;
        try
        {
            var caretFromEnd = DiscountBox.Text.Length - DiscountBox.CaretIndex;
            _vm.SetDiscountInput(DiscountBox.Text);
            if (DiscountBox.Text != _vm.UserDiscountText)
                DiscountBox.Text = _vm.UserDiscountText;
            DiscountBox.CaretIndex = Math.Max(0, DiscountBox.Text.Length - caretFromEnd);
        }
        finally
        {
            _discountFormatting = false;
        }
    }

    private void ScanBox_OnGotFocus(object sender, RoutedEventArgs e) =>
        ScanBarBorder.Style = (Style)FindResource("ScanBarFocused");

    private void ScanBox_OnLostFocus(object sender, RoutedEventArgs e) =>
        ScanBarBorder.Style = (Style)FindResource("ScanBar");

    private void CreditPicker_OnSelectionChanged(object? sender, EventArgs e)
    {
        if (CreditPicker.SelectedItem is AccountSummaryDto a)
            _vm.SelectedCreditAccount = a;
    }

    private async void ScanBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key is Key.Enter or Key.Return)
        {
            e.Handled = true;
            _scanner.Reset();
            await RunScanAsync(ScanBox.Text.Trim());
            return;
        }
    }

    private async Task RunScanAsync(string code)
    {
        if (string.IsNullOrWhiteSpace(code) || _processingScan) return;
        if (code.Length >= 16 && code.Length % 2 == 0)
        {
            var mid = code.Length / 2;
            var left = code[..mid];
            if (left == code[mid..]) code = left;
        }
        _processingScan = true;
        try
        {
            await _vm.ProcessScanAsync(code);
            ScanBox.Clear();
            _vm.ScanText = "";
            FocusScan();
        }
        finally
        {
            _processingScan = false;
            _scanner.Reset();
        }
    }

    private async void ProductTile_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: ArticleGroupItemDto item })
            await AddProductWithAttributionAsync(new ProductDto(item.ProductId, item.Seq, null, item.Name, item.Barcode,
                item.OriginalPrice, item.Price, 0, 0, null));
    }

    private void QuickDiscount_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string s } && int.TryParse(s, out var percent))
            _vm.ApplyDiscountPercent(percent);
    }

    private void CloseProducts_Click(object sender, RoutedEventArgs e)
    {
        if (_vm.ShowProductsPanel)
            _vm.ToggleProductsPanel();
    }

    private void CartGrid_OnLoadingRow(object sender, DataGridRowEventArgs e) =>
        e.Row.Header = (e.Row.GetIndex() + 1).ToString();

    private void ToggleProducts_Click(object sender, RoutedEventArgs e) => _vm.ToggleProductsPanel();

    private void CartQtyPlus_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: CartLine line })
            _vm.AdjustLineQty(line, 1);
    }

    private void CartQtyMinus_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: CartLine line })
            _vm.AdjustLineQty(line, -1);
    }

    private void CartRemove_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: CartLine line })
            _vm.RemoveLine(line);
    }

    private void CartGrid_OnMouseDoubleClick(object sender, MouseButtonEventArgs e) => ShowQtyDialog();

    private void RepeatLastScan_Click(object sender, RoutedEventArgs e) => _vm.RepeatLastScan();

    private void ShowQtyDialog()
    {
        if (_vm.SelectedLine is not CartLine line) return;
        var dlg = new QtyInputDialog(line.Name ?? "منتج", Math.Abs(line.Quantity));
        if (PosOverlay.Show(dlg, this) != true) return;
        var qty = _vm.IsReturnMode ? -Math.Abs(dlg.Quantity) : dlg.Quantity;
        _vm.SetSelectedLineQuantity(qty);
    }

    private void ClearCart_Click(object sender, RoutedEventArgs e)
    {
        if (!_vm.HasCartItems) return;
        if (MessageBox.Show("إفراغ السلة بالكامل؟", "نقطة البيع", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        _vm.ClearCart();
    }

    private void InvoiceSlot_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: int slot })
            _vm.SwitchToSlot(slot);
    }

    private void ToggleReturn_Click(object sender, RoutedEventArgs e) => _vm.ToggleReturnMode();

    private void ToggleGift_Click(object sender, RoutedEventArgs e) => _vm.ToggleGiftMode();

    private void DiscountPercentToggle_Click(object sender, RoutedEventArgs e) =>
        _vm.SetDiscountMode(DiscountInputMode.Percent);

    private void DiscountAmountToggle_Click(object sender, RoutedEventArgs e) =>
        _vm.SetDiscountMode(DiscountInputMode.Amount);

    private async void CompleteSale_Click(object sender, RoutedEventArgs e) => await CompleteSaleAsync();

    private async Task CompleteSaleAsync()
    {
        CompleteBtn.IsEnabled = false;
        try { await _vm.CompleteSaleAsync(); }
        finally { CompleteBtn.IsEnabled = _vm.CanCompleteSale; }
    }

    private async void Reprint_Click(object sender, RoutedEventArgs e) => await _vm.ReprintLastReceiptAsync();

    private async void CardPay_Click(object sender, RoutedEventArgs e)
    {
        if (_vm.CardPaymentBlockedReason() is string reason)
        {
            _vm.Toast(reason, false);
            return;
        }

        var dialog = new CardPaymentWindow(_vm.AmountDue);
        if (PosOverlay.Show(dialog, this) != true || dialog.Payment is null) return;

        await _vm.CompleteSaleAsync(dialog.Payment);
        FocusScan();
    }

    private void Window_OnKeyDown(object sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.F2:
                FocusScan();
                e.Handled = true;
                break;
            case Key.F3:
                CompleteSale_Click(sender, e);
                e.Handled = true;
                break;
            case Key.F4:
                _vm.CycleSlot();
                e.Handled = true;
                break;
            case Key.F5:
                _vm.SwitchToFirstParkedSlot();
                e.Handled = true;
                break;
            case Key.F6:
                _ = OpenHeldReceiptsAsync();
                e.Handled = true;
                break;
            case Key.F7:
                Reprint_Click(sender, e);
                e.Handled = true;
                break;
            case Key.F8:
                ToggleProducts_Click(sender, e);
                e.Handled = true;
                break;
            case Key.F9:
                ShowQtyDialog();
                e.Handled = true;
                break;
            case Key.F10:
                CardPay_Click(sender, e);
                e.Handled = true;
                break;
            case Key.F11:
                HoldSale_Click(sender, e);
                e.Handled = true;
                break;
            case Key.F12:
                _vm.RepeatLastScan();
                e.Handled = true;
                break;
            case Key.Back:
                if (Keyboard.FocusedElement is not TextBox)
                {
                    _vm.VoidLastLine();
                    e.Handled = true;
                }
                break;
            case Key.Add:
            case Key.OemPlus:
                _vm.AdjustSelectedQty(1);
                e.Handled = true;
                break;
            case Key.Subtract:
            case Key.OemMinus:
                _vm.AdjustSelectedQty(-1);
                e.Handled = true;
                break;
            case Key.Delete:
                _vm.RemoveSelectedLine();
                e.Handled = true;
                break;
            case Key.Escape:
                if (_vm.ShowSuccessOverlay) { _vm.HideSuccessOverlay(); e.Handled = true; break; }
                _vm.ScanText = "";
                ScanBox.Clear();
                FocusScan();
                e.Handled = true;
                break;
        }
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        Close();
        new LoginWindow().Show();
    }

    private async void Sync_Click(object sender, RoutedEventArgs e)
    {
        await AppServices.Sync.SyncCatalogAsync(fullRefresh: true);
        await _vm.SyncPendingReceiptsNowAsync();
    }

    private async void PendingSync_Click(object sender, System.Windows.Input.MouseButtonEventArgs e) =>
        await _vm.SyncPendingReceiptsNowAsync();

    private void PriceCheck_Click(object sender, RoutedEventArgs e)
    {
        PosOverlay.Show(new PriceCheckerWindow(), this);
        FocusScan();
    }

    private void PrintSettings_Click(object sender, RoutedEventArgs e)
    {
        PosOverlay.Show(new PrintSettingsWindow(), this);
        FocusScan();
    }

    private void Offers_Click(object sender, RoutedEventArgs e)
    {
        PosOverlay.Show(new OffersWindow(), this);
        FocusScan();
    }

    private async void HoldSale_Click(object sender, RoutedEventArgs e)
    {
        if (!_vm.HasCartItems) { _vm.Toast("السلة فارغة", false); return; }
        if (MessageBox.Show("تعليق الفاتورة الحالية على السيرفر؟", "نقطة البيع",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        await _vm.HoldSaleAsync();
        FocusScan();
    }

    private async void HeldReceipts_Click(object sender, RoutedEventArgs e) => await OpenHeldReceiptsAsync();

    private async Task OpenHeldReceiptsAsync()
    {
        await _vm.RefreshHeldReceiptsAsync();
        if (!_vm.HasHeldReceipts)
        {
            _vm.Toast("لا توجد فواتير معلّقة على السيرفر", false);
            return;
        }

        var dlg = new HoldReceiptWindow(_vm.HeldReceipts);
        if (PosOverlay.Show(dlg, this) != true || dlg.Selected is null) return;

        if (_vm.HasCartItems &&
            MessageBox.Show("السلة تحتوي أصنافاً. استبدالها بالفاتورة المعلّقة؟", "نقطة البيع",
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        await _vm.RecallHoldAsync(dlg.Selected.Id, force: true);
    }

    private void Window_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (ScanBox.IsKeyboardFocused) return;
        if (Keyboard.FocusedElement is TextBox or PasswordBox or ComboBox) return;
        if (e.Key is >= Key.F1 and <= Key.F12) return;
        if (Keyboard.Modifiers != ModifierKeys.None) return;

        if (e.Key is Key.Enter or Key.Return)
        {
            _scanner.OnCharacter('\r');
            e.Handled = true;
            return;
        }

        var ch = KeyToChar(e.Key);
        if (ch is not null)
        {
            _scanner.OnCharacter(ch.Value);
            e.Handled = true;
        }
    }

    private static char? KeyToChar(Key key) => key switch
    {
        >= Key.D0 and <= Key.D9 => (char)('0' + (key - Key.D0)),
        >= Key.NumPad0 and <= Key.NumPad9 => (char)('0' + (key - Key.NumPad0)),
        Key.OemMinus => '-',
        Key.Subtract => '-',
        Key.OemPeriod => '.',
        Key.Decimal => '.',
        _ => null
    };
}
