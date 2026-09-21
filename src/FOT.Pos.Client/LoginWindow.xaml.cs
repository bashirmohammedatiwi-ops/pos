using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared;
using Microsoft.Extensions.Configuration;

namespace FOT.Pos.Client;

public partial class LoginWindow : Window
{
    private readonly int _apiPort;
    private readonly DispatcherTimer _clock = new() { Interval = TimeSpan.FromSeconds(1) };

    public LoginWindow()
    {
        InitializeComponent();
        var config = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();
        _apiPort = int.TryParse(config["ApiPort"], out var p) ? p : 5000;

        var saved = ServerConnectionSettings.Load().ServerUrl;
        ServerUrlBox.Text = !string.IsNullOrWhiteSpace(saved)
            ? ServerConnectionSettings.NormalizeApiUrl(saved, _apiPort)
            : AppServices.Api.BaseUrl;

        _clock.Tick += (_, _) => ClockLabel.Text = DateTime.Now.ToString("dddd · HH:mm:ss");
        Loaded += async (_, _) =>
        {
            TouchKeyboardHelper.ApplyToWindow(this);
            _clock.Start();
            ClockLabel.Text = DateTime.Now.ToString("dddd · HH:mm:ss");
            PinBox.Focus();
            await ProbeConnectionAsync(expandIfDown: true);
        };
        Closed += (_, _) => _clock.Stop();
    }

    private void ApplyServerUrl()
    {
        var url = ServerConnectionSettings.NormalizeApiUrl(ServerUrlBox.Text.Trim(), _apiPort);
        AppServices.Api.Configure(url);
        ServerUrlBox.Text = url;
        ServerUrlLabel.Text = url;
        var settings = ServerConnectionSettings.Load();
        settings.ServerUrl = url;
        settings.Save();
    }

    private async void TestConnection_Click(object sender, RoutedEventArgs e) =>
        await ProbeConnectionAsync(expandIfDown: false);

    private async Task ProbeConnectionAsync(bool expandIfDown)
    {
        ApplyServerUrl();
        ConnectionStatus.Text = "جاري الاختبار…";
        ConnectionBadgeText.Text = "جاري الاتصال…";
        ConnectionDot.Fill = new System.Windows.Media.SolidColorBrush(
            System.Windows.Media.Color.FromRgb(0x64, 0x74, 0x8B));
        ConnectionBadgeText.Foreground = new System.Windows.Media.SolidColorBrush(
            System.Windows.Media.Color.FromRgb(0xCB, 0xD5, 0xE1));
        var result = await AppServices.Api.ProbeAsync();
        ConnectionStatus.Text = result.Message;
        ConnectionBadgeText.Text = result.Ok ? "متصل" : "غير متصل";
        ConnectionDot.Fill = new System.Windows.Media.SolidColorBrush(result.Ok
            ? System.Windows.Media.Color.FromRgb(0x10, 0xB9, 0x81)
            : System.Windows.Media.Color.FromRgb(0xEF, 0x44, 0x44));
        ConnectionBadgeText.Foreground = new System.Windows.Media.SolidColorBrush(result.Ok
            ? System.Windows.Media.Color.FromRgb(0x6E, 0xE7, 0xB7)
            : System.Windows.Media.Color.FromRgb(0xFC, 0xA5, 0xA5));
        ConnectionStatus.Foreground = result.Ok
            ? (System.Windows.Media.Brush)FindResource("TealBrush")
            : (System.Windows.Media.Brush)FindResource("DangerBrush");
        if (expandIfDown && !result.Ok)
            ServerSettings.IsExpanded = true;
    }

    private void PinBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            Login_Click(sender, e);
            e.Handled = true;
        }
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        ErrorHost.Visibility = Visibility.Collapsed;
        ApplyServerUrl();

        if (string.IsNullOrWhiteSpace(PinBox.Password))
        {
            ErrorText.Text = "أدخل رمز الدخول";
            ErrorHost.Visibility = Visibility.Visible;
            return;
        }

        LoginBtn.IsEnabled = false;
        LoginBtn.Content = "جاري الدخول...";
        try
        {
            var probe = await AppServices.Api.ProbeAsync();
            if (!probe.Ok)
            {
                if (TryOfflineLogin(PinBox.Password, out var offlineError))
                {
                    OpenSalesWindow();
                    return;
                }

                ErrorText.Text = offlineError ?? probe.Message;
                ErrorHost.Visibility = Visibility.Visible;
                ServerSettings.IsExpanded = true;
                return;
            }

            var ok = await AppServices.Api.CashierLoginByPinAsync(PinBox.Password);
            if (!ok)
            {
                ErrorText.Text = "رمز الدخول غير صحيح";
                ErrorHost.Visibility = Visibility.Visible;
                return;
            }

            await AppServices.Api.CacheReferenceDataAsync();
            OpenSalesWindow();
        }
        catch (Exception ex)
        {
            ErrorText.Text = UiErrors.ToArabic(ex);
            ErrorHost.Visibility = Visibility.Visible;
        }
        finally
        {
            LoginBtn.IsEnabled = true;
            LoginBtn.Content = "دخول إلى الصندوق";
        }
    }

    private static bool TryOfflineLogin(string pin, out string? error)
    {
        error = null;
        var cache = OfflineSessionStore.Load();
        if (cache is null)
        {
            error = "لا يوجد جلسة محفوظة — اتصل بالخادم لتسجيل الدخول أولاً";
            return false;
        }

        if (!OfflineSessionStore.VerifyPin(cache, pin))
        {
            error = "رمز الدخول غير صحيح";
            return false;
        }

        if (!OfflineSessionStore.CanLoginOffline(cache, AppServices.Catalog))
        {
            error = "لا يمكن العمل دون اتصال — نزّل الكتالوج أولاً عبر اتصال بالخادم";
            return false;
        }

        if (!AppServices.Api.RestoreOfflineSession(cache))
        {
            error = "تعذّر استعادة الجلسة المحلية";
            return false;
        }

        return true;
    }

    private static void OpenSalesWindow()
    {
        var sales = new SalesWindow();
        Application.Current.MainWindow = sales;
        sales.Show();
        if (Application.Current.Windows.OfType<LoginWindow>().FirstOrDefault() is { } login)
            login.Close();
    }

    private void Exit_Click(object sender, RoutedEventArgs e) =>
        System.Windows.Application.Current.Shutdown();
}
