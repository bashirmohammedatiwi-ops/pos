using System.Windows;
using System.Windows.Controls;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class EdariPage : UserControl, IRefreshable
{
    public EdariPage() => InitializeComponent();

    public async Task RefreshAsync()
    {
        var status = await AppServices.Api.GetEdariStatusAsync();
        if (status is not null)
        {
            StatusText.Text = status.Message;
            UnsyncedCount.Text = status.UnsyncedCount.ToString("N0");
            SyncedCount.Text = status.SyncedCount.ToString("N0");
            FailedCount.Text = status.FailedCount.ToString("N0");
        }

        Grid.ItemsSource = await AppServices.Api.GetEdariUnsyncedAsync();
        LogsGrid.ItemsSource = await AppServices.Api.GetEdariLogsAsync();
        await LoadSettingsAsync();
    }

    private async Task LoadSettingsAsync()
    {
        var settings = await AppServices.Api.GetEdariSettingsAsync();
        if (settings is null) return;

        DataRootBox.Text = settings.DataRoot;
        ServerBox.Text = settings.Server;
        PortBox.Text = settings.Port.ToString();
        DriverBox.Text = settings.OdbcDriver;
        EnabledBox.IsChecked = settings.Enabled;
        AutoSyncBox.IsChecked = settings.AutoSyncEnabled;
        SyncIntervalBox.Text = settings.AutoSyncIntervalSeconds.ToString();
        CatalogSyncBox.IsChecked = settings.CatalogSyncEnabled;
        YearCombo.ItemsSource = settings.AvailableYears;
        YearCombo.Text = settings.DatabaseAlias;

        LastPullLabel.Text = FormatTimestamp(settings.LastDataPullAt);
        LastReceiptSyncLabel.Text = FormatTimestamp(settings.LastReceiptSyncAt);

        ConnectionStatusText.Text = settings.LastConnectionOk switch
        {
            true => $"آخر اختبار: ناجح — {settings.LastConnectionMessage}",
            false => $"آخر اختبار: فشل — {settings.LastConnectionMessage}",
            _ => "لم يُجرَ اختبار اتصال بعد"
        };
        ConnectionStatusText.Foreground = settings.LastConnectionOk == false
            ? System.Windows.Media.Brushes.IndianRed
            : System.Windows.Media.Brushes.Gray;

        if (string.IsNullOrWhiteSpace(SyncStatusText.Text))
            SyncStatusText.Text = "المزامنة التلقائية تجلب الفروع والمنتجات والبائعين من Edari، ثم ترحّل الفواتير.";
    }

    private static string FormatTimestamp(DateTime? value) =>
        value.HasValue ? value.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") : "—";

    private UpdateEdariSettingsRequest ReadSettingsFromForm()
    {
        var interval = int.TryParse(SyncIntervalBox.Text, out var sec) ? sec : 120;
        interval = Math.Clamp(interval, 15, 3600);
        SyncIntervalBox.Text = interval.ToString();

        return new UpdateEdariSettingsRequest(
            DataRootBox.Text.Trim(),
            string.IsNullOrWhiteSpace(YearCombo.Text) ? "2025" : YearCombo.Text.Trim(),
            ServerBox.Text.Trim(),
            int.TryParse(PortBox.Text, out var port) ? port : 16000,
            "Ado",
            DriverBox.Text.Trim(),
            null,
            null,
            EnabledBox.IsChecked == true,
            AutoSyncBox.IsChecked == true,
            interval,
            CatalogSyncBox.IsChecked == true);
    }

    private async void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        if (await AppServices.Api.SaveEdariSettingsAsync(ReadSettingsFromForm()))
        {
            MessageBox.Show("تم حفظ إعدادات الإداري.", "الإداري", MessageBoxButton.OK, MessageBoxImage.Information);
            await RefreshAsync();
        }
        else MessageBox.Show("تعذر حفظ الإعدادات.", "خطأ", MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private async void TestConnection_Click(object sender, RoutedEventArgs e)
    {
        await AppServices.Api.SaveEdariSettingsAsync(ReadSettingsFromForm());
        var result = await AppServices.Api.TestEdariConnectionAsync();
        if (result is null) return;
        MessageBox.Show(result.Message, result.Ok ? "اتصال ناجح" : "فشل الاتصال",
            MessageBoxButton.OK, result.Ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
        await RefreshAsync();
    }

    private async Task<bool> EnsureSettingsSavedAsync()
    {
        if (!await AppServices.Api.SaveEdariSettingsAsync(ReadSettingsFromForm()))
        {
            MessageBox.Show("تعذر حفظ الإعدادات قبل المزامنة.", "خطأ", MessageBoxButton.OK, MessageBoxImage.Warning);
            return false;
        }
        return true;
    }

    private async void SyncNow_Click(object sender, RoutedEventArgs e)
    {
        if (!await EnsureSettingsSavedAsync()) return;

        SyncNowBtn.IsEnabled = false;
        SyncStatusText.Text = "جاري المزامنة الفورية — جلب الفروع والمنتجات والبائعين وترحيل الفواتير…";
        try
        {
            var result = await AppServices.Api.SyncEdariFullAsync(
                catalog: CatalogSyncBox.IsChecked == true,
                receipts: true);
            if (result is null)
            {
                SyncStatusText.Text = "تعذر الاتصال بالخادم.";
                return;
            }

            SyncStatusText.Text = result.Message;
            MessageBox.Show(result.Message, result.Ok ? "مزامنة ناجحة" : "مزامنة جزئية",
                MessageBoxButton.OK, result.Ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
            await RefreshAsync();
        }
        finally
        {
            SyncNowBtn.IsEnabled = true;
        }
    }

    private async void SyncPull_Click(object sender, RoutedEventArgs e)
    {
        if (!await EnsureSettingsSavedAsync()) return;

        SyncStatusText.Text = "جاري جلب البيانات من Edari…";
        var result = await AppServices.Api.SyncEdariPullAsync(CatalogSyncBox.IsChecked == true);
        if (result is null)
        {
            SyncStatusText.Text = "تعذر الاتصال بالخادم.";
            return;
        }

        SyncStatusText.Text = result.Message;
        MessageBox.Show(result.Message, result.Ok ? "جلب البيانات" : "فشل جزئي",
            MessageBoxButton.OK, result.Ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
        await RefreshAsync();
    }

    private async void SyncReceipts_Click(object sender, RoutedEventArgs e)
    {
        SyncStatusText.Text = "جاري ترحيل الفواتير إلى Edari…";
        var result = await AppServices.Api.SyncEdariReceiptsAsync();
        if (result is null) return;

        SyncStatusText.Text = result.Message;
        MessageBox.Show(result.Message, "مزامنة الفواتير", MessageBoxButton.OK,
            result.Ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
        await RefreshAsync();
    }
}
