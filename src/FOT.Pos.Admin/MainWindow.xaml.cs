using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using FOT.Pos.Admin.Controls;
using FOT.Pos.Admin.Navigation;
using FOT.Pos.Admin.Pages;
using FOT.Pos.Admin.Services;

namespace FOT.Pos.Admin;

public partial class MainWindow : Window
{
    private readonly Dictionary<string, UserControl> _pages = new();
    private bool _transitionReady;

    public MainWindow()
    {
        InitializeComponent();
        var userName = AppServices.Api.CurrentUser?.DisplayName ?? "—";
        UserLabel.Text = userName;
        UserInitial.Text = GetInitial(userName);
        NavigationService.Navigate += ShowPage;
        Sidebar.PageSelected += (_, key) => ShowPage(key);
        ShowPage("dashboard");
        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        await CheckApiAsync();
        try
        {
            await AppServices.Hub.ConnectAsync();
            AppServices.Hub.ReceiptCreated += OnReceiptCreated;
            AppServices.Hub.CatalogUpdated += OnCatalogUpdated;
            AppServices.Hub.EdariUpdated += OnEdariUpdated;
        }
        catch { SetApiStatus(false); }
        _transitionReady = true;
    }

    private async void OnClosed(object? sender, EventArgs e)
    {
        NavigationService.Navigate -= ShowPage;
        AppServices.Hub.ReceiptCreated -= OnReceiptCreated;
        AppServices.Hub.CatalogUpdated -= OnCatalogUpdated;
        AppServices.Hub.EdariUpdated -= OnEdariUpdated;
        await AppServices.Hub.DisposeAsync();
    }

    private void OnReceiptCreated(long id, int number)
    {
        Dispatcher.Invoke(() =>
        {
            if (PageHost.Content is DashboardPage dash) _ = dash.RefreshAsync();
            if (PageHost.Content is ReceiptsPage rec) _ = rec.RefreshAsync();
        });
    }

    /// <summary>
    /// Fired the instant any product/offer/account/setting is added, changed or removed —
    /// on the control panel side or on the Edari side (deletions included). Whatever page the
    /// user is currently looking at refreshes itself immediately, no manual reload needed.
    /// </summary>
    private void OnCatalogUpdated()
    {
        Dispatcher.Invoke(() =>
        {
            if (PageHost.Content is IRefreshable r) _ = r.RefreshAsync();
        });
    }

    private void OnEdariUpdated(string message, bool dataChanged)
    {
        Dispatcher.Invoke(() =>
        {
            if (PageHost.Content is EdariPage edari) _ = edari.RefreshAsync();
        });
    }

    private void ShowPage(string key)
    {
        if (!_pages.TryGetValue(key, out var page))
        {
            page = key switch
            {
                "dashboard" => new DashboardPage(),
                "products" => new ProductsPage(),
                "offers" => new OffersPage(),
                "groups" => new GroupsPage(),
                "accounts" => new AccountsPage(),
                "receipts" => new ReceiptsPage(),
                "activity" => new CashierActivityPage(),
                "reports" => new ReportsPage(),
                "salesmen" => new SalesmenPage(),
                "cashiers" => new CashiersPage(),
                "commissions" => new CommissionsPage(),
                "targets" => new TargetsPage(),
                "sections" => new SectionsPage(),
                "terminals" => new TerminalsPage(),
                "settings" => new SettingsPage(),
                "edari" => new EdariPage(),
                _ => new DashboardPage()
            };
            _pages[key] = page;
        }

        if (!_transitionReady)
        {
            PageHost.Content = page;
            PageHost.Opacity = 1;
        }
        else
        {
            var ease = new QuadraticEase { EasingMode = EasingMode.EaseOut };
            var fadeOut = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(100)) { EasingFunction = ease };
            fadeOut.Completed += (_, _) =>
            {
                PageHost.Content = page;
                PageHost.BeginAnimation(OpacityProperty,
                    new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)) { EasingFunction = ease });
            };
            PageHost.BeginAnimation(OpacityProperty, fadeOut);
        }

        Sidebar.SetActive(key);

        var nav = AppNavigation.Find(key);
        if (nav is not null)
        {
            PageTitle.Text = nav.Value.Page.Title;
            PageSubtitle.Text = nav.Value.Page.Subtitle;
            BreadcrumbLabel.Text = AppNavigation.Breadcrumb(key);
            var hideSubtitle = key == "dashboard" || string.IsNullOrWhiteSpace(nav.Value.Page.Subtitle);
            PageSubtitle.Visibility = hideSubtitle ? Visibility.Collapsed : Visibility.Visible;
        }

        if (page is IRefreshable r) _ = r.RefreshAsync();
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        await CheckApiAsync();
        if (PageHost.Content is IRefreshable r) await r.RefreshAsync();
    }

    private async Task CheckApiAsync() => SetApiStatus(await AppServices.Api.IsHealthyAsync());

    private void SetApiStatus(bool online)
    {
        ApiDot.Fill = online
            ? (Brush)FindResource("SuccessBrush")
            : (Brush)FindResource("DangerBrush");
        ApiStatus.Text = online ? "API" : "offline";
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Api.Logout();
        new LoginWindow().Show();
        Close();
    }

    private static string GetInitial(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name == "—") return "A";
        return name.Trim()[0].ToString().ToUpperInvariant();
    }
}

public interface IRefreshable
{
    Task RefreshAsync();
}
