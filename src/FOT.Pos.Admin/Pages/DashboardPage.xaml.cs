using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using FOT.Pos.Admin.Navigation;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;

namespace FOT.Pos.Admin.Pages;

public partial class DashboardPage : UserControl, IRefreshable
{
    private readonly DispatcherTimer _clock = new() { Interval = TimeSpan.FromSeconds(1) };

    public DashboardPage()
    {
        InitializeComponent();
        var name = AppServices.Api.CurrentUser?.DisplayName ?? "مدير";
        WelcomeText.Text = $"مرحباً، {name}";
        UpdateClock();
        _clock.Tick += (_, _) => UpdateClock();
        Loaded += (_, _) => _clock.Start();
        Unloaded += (_, _) => _clock.Stop();
    }

    public async Task RefreshAsync()
    {
        var stats = await AppServices.Api.GetStatsAsync();
        if (stats is null) return;

        ActiveOffers.Text = MoneyFormat.FormatAmount(stats.ActiveOffers);
        EdariMaterials.Text = MoneyFormat.FormatAmount(stats.EdariMaterials);
        EdariTreeFolders.Text = MoneyFormat.FormatAmount(stats.EdariTreeFolders);
        EdariSalesmen.Text = MoneyFormat.FormatAmount(stats.EdariSalesmen);
        EdariBranches.Text = MoneyFormat.FormatAmount(stats.EdariBranches);

        if (stats.EdariConnected)
        {
            EdariDot.Fill = (Brush)FindResource("SuccessBrush");
            EdariStatusTitle.Text = "متصل";
            EdariStatusBorder.Background = new SolidColorBrush(Color.FromRgb(0xF0, 0xFD, 0xF4));
            EdariStatusBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(0xBB, 0xF7, 0xD0));
            EdariStatus.Text = $"نسخة: {stats.EdariDatabaseAlias ?? "—"}";
        }
        else
        {
            EdariDot.Fill = (Brush)FindResource("DangerBrush");
            EdariStatusTitle.Text = "غير متصل";
            EdariStatusBorder.Background = new SolidColorBrush(Color.FromRgb(0xFE, 0xF2, 0xF2));
            EdariStatusBorder.BorderBrush = new SolidColorBrush(Color.FromRgb(0xFE, 0xCA, 0xCA));
            EdariStatus.Text = stats.EdariConnectionMessage ?? "تحقق من إعدادات Edari";
        }

        LastRefresh.Text = DateTime.Now.ToString("HH:mm");
    }

    private void UpdateClock()
    {
        var now = DateTime.Now;
        TodayDate.Text = now.ToString("dddd، d MMMM yyyy");
        TodayTime.Text = now.ToString("HH:mm:ss");
    }

    private void QuickNav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string key })
            NavigationService.GoTo(key);
    }
}
