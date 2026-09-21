using System.Drawing;
using System.IO;
using System.Windows.Forms;
using FOT.Pos.ServerHost.Services;
using MessageBox = System.Windows.Forms.MessageBox;

namespace FOT.Pos.ServerHost;

internal sealed class TrayHost : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ApiHostService _api;
    private readonly string _adminExe;
    private readonly string _clientExe;
    private readonly Action _showMainWindow;
    private string _status = "جاري التشغيل…";
    private string _mode = "";

    public TrayHost(ApiHostService api, string adminExe, string clientExe, Action showMainWindow)
    {
        _api = api;
        _adminExe = adminExe;
        _clientExe = clientExe;
        _showMainWindow = showMainWindow;
        _icon = new NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Visible = true,
            Text = "FOT POS Server",
        };
        _icon.DoubleClick += (_, _) => _showMainWindow();
        RefreshMenu();
    }

    public void SetRunning(bool running, string? error = null)
    {
        _mode = _api.UsesWindowsService ? "Windows Service" : "Process";
        _status = running ? $"يعمل ✓ ({_mode})" : error ?? "متوقف";
        _icon.Text = running ? $"FOT POS — {_api.LocalUrl}" : "FOT POS — متوقف";
        RefreshMenu();
    }

    public void ShowBalloon(string title, string text)
    {
        _icon.BalloonTipTitle = title;
        _icon.BalloonTipText = text;
        _icon.BalloonTipIcon = ToolTipIcon.Info;
        _icon.ShowBalloonTip(5000);
    }

    private void RefreshMenu()
    {
        var lan = NetworkInfoService.FormatLanUrls(_api.Port);
        var menu = new ContextMenuStrip();
        menu.RightToLeft = RightToLeft.Yes;
        menu.Items.Add($"الحالة: {_status}").Enabled = false;
        menu.Items.Add($"محلي: {_api.LocalUrl}").Enabled = false;
        if (!string.IsNullOrWhiteSpace(lan))
        {
            menu.Items.Add("── الشبكة ──").Enabled = false;
            foreach (var line in lan.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                menu.Items.Add(line).Enabled = false;
        }
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("إظهار النافذة", null, (_, _) => _showMainWindow());
        menu.Items.Add("لوحة التحكم", null, (_, _) => AdminLauncher.Open(_adminExe));
        menu.Items.Add("نقطة البيع", null, (_, _) => AdminLauncher.OpenClient(_clientExe));
        menu.Items.Add("نسخ عنوان الشبكة", null, (_, _) => CopyLan());
        menu.Items.Add("إعادة تشغيل الخادم", null, async (_, _) => await RestartAsync());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("خروج من المراقب فقط", null, (_, _) =>
        {
            _api.Stop();
            System.Windows.Application.Current.Shutdown();
        });
        _icon.ContextMenuStrip = menu;
    }

    private void CopyLan()
    {
        var lan = NetworkInfoService.FormatLanUrls(_api.Port)
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();
        if (string.IsNullOrWhiteSpace(lan)) return;
        try { System.Windows.Clipboard.SetText(lan.Trim()); } catch { /* ignore */ }
        ShowBalloon("FOT POS", "تم نسخ عنوان الشبكة");
    }

    private async Task RestartAsync()
    {
        try
        {
            await _api.RestartAsync(CancellationToken.None);
            SetRunning(true);
            ShowBalloon("FOT POS", "تم إعادة تشغيل الخادم");
        }
        catch (Exception ex)
        {
            SetRunning(false, ex.Message);
            MessageBox.Show(ex.Message, "FOT POS Server", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static Icon LoadTrayIcon()
    {
        try
        {
            var ico = Path.Combine(AppContext.BaseDirectory, "fot-pos-server.ico");
            if (File.Exists(ico))
                return new Icon(ico);
        }
        catch { /* fallback */ }
        return SystemIcons.Application;
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
