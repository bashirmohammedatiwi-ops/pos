using System.Reflection;
using System.Windows;
using System.Windows.Media;
using FOT.Pos.ServerHost.Services;
using MessageBox = System.Windows.MessageBox;

namespace FOT.Pos.ServerHost;

internal partial class MainWindow : Window
{
    private readonly ApiHostService _api;
    private readonly string _adminExe;
    private readonly string _clientExe;

    public MainWindow(ApiHostService api, string adminExe, string clientExe)
    {
        InitializeComponent();
        _api = api;
        _adminExe = adminExe;
        _clientExe = clientExe;
        var ver = Assembly.GetExecutingAssembly().GetName().Version;
        VersionText.Text = ver is null ? "الخادم الرئيسي" : $"الخادم الرئيسي — الإصدار {ver.Major}.{ver.Minor}.{ver.Build}";
        RefreshUrls();
    }

    public void SetStatus(bool running, string? error = null)
    {
        if (running)
        {
            StatusDot.Fill = new SolidColorBrush(System.Windows.Media.Color.FromRgb(16, 185, 129));
            StatusText.Text = "يعمل ✓";
            ModeText.Text = _api.UsesWindowsService
                ? "الوضع: خدمة Windows — يعمل تلقائياً عند تشغيل الجهاز"
                : "الوضع: عملية محلية — ثبّت الخدمة ليبدأ مع Windows";
        }
        else
        {
            StatusDot.Fill = new SolidColorBrush(System.Windows.Media.Color.FromRgb(239, 68, 68));
            StatusText.Text = "متوقف";
            ModeText.Text = error ?? "تحقق من السجلات أو أعد تثبيت الخدمة من المثبّت";
        }
        RefreshUrls();
    }

    private void RefreshUrls()
    {
        LocalUrlBox.Text = _api.LocalUrl;
        var lan = NetworkInfoService.FormatLanUrls(_api.Port);
        LanUrlBox.Text = string.IsNullOrWhiteSpace(lan)
            ? "(لا يوجد اتصال Ethernet/Wi-Fi نشط)"
            : lan;
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => RefreshUrls();

    private void CopyLocal_Click(object sender, RoutedEventArgs e) =>
        CopyText(LocalUrlBox.Text);

    private void CopyLan_Click(object sender, RoutedEventArgs e)
    {
        var first = LanUrlBox.Text.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
        CopyText(first ?? LanUrlBox.Text);
    }

    private static void CopyText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.StartsWith('(')) return;
        try { System.Windows.Clipboard.SetText(text.Trim()); } catch { /* ignore */ }
    }

    private void OpenAdmin_Click(object sender, RoutedEventArgs e) =>
        AdminLauncher.Open(_adminExe);

    private void OpenClient_Click(object sender, RoutedEventArgs e) =>
        AdminLauncher.OpenClient(_clientExe);

    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        RestartBtn.IsEnabled = false;
        try
        {
            await _api.RestartAsync(CancellationToken.None);
            SetStatus(true);
        }
        catch (Exception ex)
        {
            SetStatus(false, ex.Message);
            MessageBox.Show(ex.Message, "FOT POS Server", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            RestartBtn.IsEnabled = true;
        }
    }

    private void HideToTray_Click(object sender, RoutedEventArgs e)
    {
        Hide();
        if (System.Windows.Application.Current is App app)
            app.ShowTrayBalloon("FOT POS يعمل في الخلفية", "انقر أيقونة FOT POS في شريط المهام (أسفل يمين الشاشة)");
    }

    protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
        if (System.Windows.Application.Current is App app)
            app.ShowTrayBalloon("FOT POS يعمل في الخلفية", "الخادم لا يزال يعمل — انقر أيقونة FOT POS في شريط المهام");
    }
}
