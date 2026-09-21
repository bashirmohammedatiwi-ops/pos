using System.Windows;
using FOT.Pos.Shared;
using Microsoft.Extensions.Configuration;
using FOT.Pos.Admin.Services;

namespace FOT.Pos.Admin;

public partial class App : Application
{
    private Mutex? _instance;

    private void App_OnStartup(object sender, StartupEventArgs e)
    {
        switch (AppInstance.TryAcquireSingle("FOT.Pos.Admin", "FOT.Pos.Admin", out _instance))
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
            MessageBox.Show($"خطأ غير متوقع:\n{UiErrors.ToArabic(ex)}", "FOT POS Admin",
                MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex)
                MessageBox.Show($"خطأ:\n{UiErrors.ToArabic(ex)}", "FOT POS Admin", MessageBoxButton.OK, MessageBoxImage.Error);
        };

        var config = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .Build();

        var role = config["DeploymentRole"] ?? AppConfig.RoleServer;
        if (e.Args.Any(a => string.Equals(a, "--remote", StringComparison.OrdinalIgnoreCase)))
            role = AppConfig.RoleRemote;

        var apiPort = int.TryParse(config["ApiPort"], out var p) ? p : 5000;
        AppConfig.Initialize(role, apiPort);

        var apiUrl = ResolveApiUrl(config, role, apiPort, e.Args);
        AppServices.Api.Configure(apiUrl, AppConfig.IsRemote);

        var login = new LoginWindow();
        MainWindow = login;
        login.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _instance?.Dispose();
        base.OnExit(e);
    }

    private static string ResolveApiUrl(IConfiguration config, string role, int apiPort, string[] args)
    {
        var fromArg = args.FirstOrDefault(a => a.StartsWith("--server=", StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(fromArg))
            return ServerConnectionSettings.NormalizeApiUrl(fromArg["--server=".Length..], apiPort);

        if (role == AppConfig.RoleRemote)
        {
            var saved = ServerConnectionSettings.Load().ServerUrl;
            if (!string.IsNullOrWhiteSpace(saved))
                return ServerConnectionSettings.NormalizeApiUrl(saved, apiPort);
        }

        return ServerConnectionSettings.NormalizeApiUrl(config["ApiBaseUrl"] ?? "http://localhost:5000", apiPort);
    }
}
