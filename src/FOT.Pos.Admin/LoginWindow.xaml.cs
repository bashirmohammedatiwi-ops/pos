using System.Windows;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;

namespace FOT.Pos.Admin;

public partial class LoginWindow : Window
{
    public LoginWindow()
    {
        InitializeComponent();
        if (AppConfig.IsRemote)
        {
            RemotePanel.Visibility = Visibility.Visible;
            Title = "FOT POS — إدارة عن بُعد";
            SubtitleText.Text = "جهاز فرعي — اتصل بالحاسبة الرئيسية عبر الشبكة";
            ServerUrlBox.Text = AppServices.Api.BaseUrl;
            Loaded += async (_, _) => await ProbeConnectionAsync();
        }
        else
        {
            SubtitleText.Text = "الحاسبة الرئيسية — السيرفر المحلي";
            _ = LoadServerInfoAsync();
        }
    }

    private async Task LoadServerInfoAsync()
    {
        try
        {
            var info = await AppServices.Api.GetServerInfoAsync();
            if (info?.LanAddresses is { Count: > 0 })
            {
                LanHintText.Text = "عنوان الشبكة للأجهزة الأخرى: " +
                    string.Join("  ·  ", info.LanAddresses.Select(ip => $"http://{ip}:{info.ApiPort}"));
                LanHintBorder.Visibility = Visibility.Visible;
            }
        }
        catch
        {
            // local API may still be starting
        }
    }

    private async void TestConnection_Click(object sender, RoutedEventArgs e) =>
        await ProbeConnectionAsync();

    private async Task ProbeConnectionAsync()
    {
        ApplyServerUrl();
        ConnectionStatus.Text = "جاري الاختبار…";
        ConnectionStatus.Foreground = new System.Windows.Media.SolidColorBrush(
            System.Windows.Media.Color.FromRgb(0x64, 0x74, 0x8B));
        var result = await AppServices.Api.ProbeAsync();
        ConnectionStatus.Text = result.Message;
        ConnectionStatus.Foreground = result.Ok
            ? System.Windows.Media.Brushes.ForestGreen
            : (System.Windows.Media.Brush)FindResource("DangerBrush");
    }

    private void ApplyServerUrl()
    {
        var url = ServerConnectionSettings.NormalizeApiUrl(ServerUrlBox.Text.Trim(), AppConfig.ApiPort);
        AppServices.Api.Configure(url, true);
        ServerUrlBox.Text = url;
        var settings = ServerConnectionSettings.Load();
        settings.ServerUrl = url;
        settings.Save();
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        ErrorBorder.Visibility = Visibility.Collapsed;
        if (AppConfig.IsRemote)
            ApplyServerUrl();

        LoginBtn.IsEnabled = false;
        LoginBtn.Content = "جاري الدخول...";
        try
        {
            if (AppConfig.IsRemote)
            {
                var probe = await AppServices.Api.ProbeAsync();
                if (!probe.Ok)
                {
                    ErrorText.Text = $"{probe.Message}\n{AppServices.Api.BaseUrl}";
                    ErrorBorder.Visibility = Visibility.Visible;
                    ConnectionStatus.Text = probe.Message;
                    ConnectionStatus.Foreground = (System.Windows.Media.Brush)FindResource("DangerBrush");
                    return;
                }
            }

            var ok = await AppServices.Api.LoginAsync(UsernameBox.Text, PasswordBox.Password);
            if (!ok)
            {
                ErrorText.Text = "اسم المستخدم أو كلمة المرور غير صحيحة";
                ErrorBorder.Visibility = Visibility.Visible;
                return;
            }
            new MainWindow().Show();
            Close();
        }
        catch (Exception ex)
        {
            ErrorText.Text = UiErrors.ToArabic(ex);
            ErrorBorder.Visibility = Visibility.Visible;
        }
        finally
        {
            LoginBtn.IsEnabled = true;
            LoginBtn.Content = AppConfig.IsRemote ? "دخول" : "دخول إلى لوحة التحكم";
        }
    }
}
