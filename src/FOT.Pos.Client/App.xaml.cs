using System.Windows;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared;
using Microsoft.Extensions.Configuration;

namespace FOT.Pos.Client;

public partial class App : Application
{
    private Mutex? _instance;

    private void App_OnStartup(object sender, StartupEventArgs e)
    {
        switch (AppInstance.TryAcquireSingle("FOT.Pos.Client", "FOT.Pos.Client", out _instance))
        {
            case AppInstanceResult.ActivatedExisting:
                Shutdown();
                return;
            case AppInstanceResult.Acquired:
            case AppInstanceResult.AcquiredAfterCleanup:
                break;
        }

        DispatcherUnhandledException += (_, args) =>
        {
            var ex = args.Exception;
            while (ex.InnerException is not null) ex = ex.InnerException;
            MessageBox.Show($"خطأ غير متوقع:\n{UiErrors.ToArabic(ex)}", "FOT POS",
                MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };

        var config = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();

        var apiPort = int.TryParse(config["ApiPort"], out var p) ? p : 5000;
        var fromArg = e.Args.FirstOrDefault(a => a.StartsWith("--server=", StringComparison.OrdinalIgnoreCase));
        var saved = ServerConnectionSettings.Load().ServerUrl;
        string apiUrl;
        if (!string.IsNullOrWhiteSpace(fromArg))
            apiUrl = ServerConnectionSettings.NormalizeApiUrl(fromArg["--server=".Length..], apiPort);
        else if (!string.IsNullOrWhiteSpace(saved))
            apiUrl = ServerConnectionSettings.NormalizeApiUrl(saved, apiPort);
        else
            apiUrl = ServerConnectionSettings.NormalizeApiUrl(config["ApiBaseUrl"] ?? "http://192.168.75.1:5000", apiPort);

        AppServices.Api.Configure(apiUrl);
        var login = new LoginWindow();
        MainWindow = login;
        login.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _instance?.Dispose();
        base.OnExit(e);
    }
}
