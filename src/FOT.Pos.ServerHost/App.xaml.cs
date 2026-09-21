using System.IO;
using System.Windows;
using FOT.Pos.ServerHost.Services;
using Microsoft.Extensions.Configuration;
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;

namespace FOT.Pos.ServerHost;

public partial class App : Application
{
    private TrayHost? _tray;
    private ApiHostService? _api;
    private MainWindow? _mainWindow;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        if (!SingleInstance.TryAcquire())
        {
            MessageBox.Show(
                "FOT POS Server يعمل بالفعل.\n\nابحث عن أيقونة FOT POS في شريط المهام (أسفل يمين الشاشة — قد تكون في ^).",
                "FOT POS Server",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        var config = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();

        var port = int.TryParse(config["ApiPort"], out var p) ? p : 5000;
        var autoOpenAdmin = !string.Equals(config["AutoOpenAdmin"], "false", StringComparison.OrdinalIgnoreCase);
        var adminExe = config["AdminExeName"] ?? "FOT.Pos.Admin.exe";
        var clientExe = config["ClientExeName"] ?? "FOT.Pos.Client.exe";

        _api = new ApiHostService(port);
        _mainWindow = new MainWindow(_api, adminExe, clientExe);
        MainWindow = _mainWindow;
        _tray = new TrayHost(_api, adminExe, clientExe, ShowMainWindow);

        try
        {
            await _api.StartAsync(CancellationToken.None);
            _tray.SetRunning(true);
            _mainWindow.SetStatus(true);
            _mainWindow.Show();
            _mainWindow.Activate();

            ShowTrayBalloon("FOT POS Server يعمل", $"الخادم: {_api.LocalUrl}");

            if (autoOpenAdmin)
                AdminLauncher.Open(adminExe);
        }
        catch (Exception ex)
        {
            _tray.SetRunning(false, ex.Message);
            _mainWindow.SetStatus(false, ex.Message);
            _mainWindow.Show();

            if (!WindowsServiceHelper.IsInstalled)
            {
                MessageBox.Show(
                    $"تعذر تشغيل الخادم:\n{ex.Message}\n\nثبّت الحزمة من FOT-POS-Server-Setup.exe كمسؤول.",
                    "FOT POS Server",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
        }
    }

    public void ShowMainWindow()
    {
        if (_mainWindow is null) return;
        _mainWindow.Show();
        _mainWindow.WindowState = WindowState.Normal;
        _mainWindow.Activate();
    }

    public void ShowTrayBalloon(string title, string text) =>
        _tray?.ShowBalloon(title, text);

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        _api?.Dispose();
        SingleInstance.Release();
        base.OnExit(e);
    }
}
