using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class TerminalsPage : UserControl, IRefreshable
{
    private List<PosTerminalDetailDto> _all = [];
    private PosTerminalDetailDto? _selected;

    public TerminalsPage()
    {
        InitializeComponent();
        Loaded += async (_, _) => await LoadAsync();
    }

    public async Task RefreshAsync() => await LoadAsync();

    private async Task LoadAsync()
    {
        _all = await AppServices.Api.GetPosTerminalsAsync() ?? [];
        UpdateKpis();
        ApplyFilter();
    }

    private void UpdateKpis()
    {
        KpiTotal.Text = _all.Count.ToString("N0");
        KpiOnline.Text = _all.Count(t => t.IsOnline).ToString("N0");
        KpiOffline.Text = _all.Count(t => !t.IsOnline).ToString("N0");
        KpiReceipts.Text = _all.Sum(t => t.TodayReceipts).ToString("N0");
        KpiSales.Text = MoneyFormat.FormatAmount(_all.Sum(t => t.TodaySales));
    }

    private void ApplyFilter()
    {
        IEnumerable<PosTerminalDetailDto> list = _all;

        if (StatusFilter.SelectedItem is ComboBoxItem statusItem && statusItem.Tag is string tag)
        {
            list = tag switch
            {
                "online" => list.Where(t => t.IsOnline),
                "offline" => list.Where(t => !t.IsOnline),
                _ => list
            };
        }

        var filtered = list.OrderByDescending(t => t.IsOnline).ThenBy(t => t.Name).ToList();
        TerminalList.ItemsSource = filtered.Select(t => new TerminalRow(t)).ToList();

        if (_selected is not null)
            TerminalList.SelectedItem = TerminalList.Items.Cast<TerminalRow>()
                .FirstOrDefault(r => r.Terminal.Id == _selected.Id);
    }

    private async void TerminalList_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = (TerminalList.SelectedItem as TerminalRow)?.Terminal;
        if (_selected is null)
        {
            DetailContent.Visibility = Visibility.Collapsed;
            DetailPlaceholder.Visibility = Visibility.Visible;
            return;
        }

        DetailPlaceholder.Visibility = Visibility.Collapsed;
        DetailContent.Visibility = Visibility.Visible;

        var t = await AppServices.Api.GetTerminalAsync(_selected.Id) ?? _selected;
        _selected = t;

        DetailName.Text = t.Name ?? "—";
        DetailHwId.Text = t.HwId ?? "—";
        DetailStatus.Text = t.Active ? (t.IsOnline ? "نشط · متصل" : "نشط · غير متصل") : "معطّل";
        DetailLastConn.Text = t.LastConnection?.ToString("yyyy/MM/dd HH:mm") ?? "—";
        DetailVersion.Text = t.ExeVersion ?? "—";
        DetailReceipts.Text = t.TodayReceipts.ToString("N0");
        DetailSales.Text = MoneyFormat.FormatAmount(t.TodaySales);
        DetailRemarks.Text = string.IsNullOrWhiteSpace(t.Remarks) ? "—" : t.Remarks;
        DetailVfd1.Text = string.IsNullOrWhiteSpace(t.VfdFirstLine) ? "—" : t.VfdFirstLine;
        DetailVfd2.Text = string.IsNullOrWhiteSpace(t.VfdSecondLine) ? "—" : t.VfdSecondLine;
        DetailOffline.Text = t.AllowOfflineMode ? "مسموح" : "غير مسموح";

        DetailDot.Fill = t.IsOnline
            ? (Brush)FindResource("SuccessBrush")
            : new SolidColorBrush(Color.FromRgb(0xCB, 0xD5, 0xE1));

        var activity = await AppServices.Api.GetTerminalActivityAsync(t.Id) ?? [];
        ActivityList.ItemsSource = activity;
    }

    private void Filter_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded) return;
        ApplyFilter();
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await LoadAsync();

    private async void Add_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new TerminalEditDialog { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.CreateResult is null) return;

        var id = await AppServices.Api.RegisterTerminalAsync(dlg.CreateResult);
        if (!id.HasValue)
        {
            MessageBox.Show("فشل إضافة الجهاز");
            return;
        }

        if (dlg.CreateExtras is not null)
            await AppServices.Api.UpdateTerminalAsync(id.Value, dlg.CreateExtras);

        MessageBox.Show("تم إضافة الجهاز");
        await LoadAsync();
        TerminalList.SelectedItem = _all.FirstOrDefault(t => t.Id == id.Value) is { } row
            ? new TerminalRow(row)
            : null;
    }

    private async void Edit_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var dlg = new TerminalEditDialog(_selected) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.UpdateResult is null) return;

        if (!await AppServices.Api.UpdateTerminalAsync(_selected.Id, dlg.UpdateResult))
        {
            MessageBox.Show("فشل التحديث");
            return;
        }

        MessageBox.Show("تم التحديث");
        await LoadAsync();
        TerminalList.SelectedItem = _all.FirstOrDefault(t => t.Id == _selected!.Id) is { } row
            ? new TerminalRow(row)
            : null;
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        if (MessageBox.Show($"حذف الجهاز «{_selected.Name}»؟", "تأكيد", MessageBoxButton.YesNo) != MessageBoxResult.Yes)
            return;

        if (!await AppServices.Api.DeleteTerminalAsync(_selected.Id))
        {
            MessageBox.Show("فشل الحذف");
            return;
        }

        _selected = null;
        DetailContent.Visibility = Visibility.Collapsed;
        DetailPlaceholder.Visibility = Visibility.Visible;
        await LoadAsync();
    }

    private sealed class TerminalRow(PosTerminalDetailDto terminal)
    {
        private readonly PosTerminalDetailDto _terminal = terminal;
        public PosTerminalDetailDto Terminal => _terminal;
        public string? Name => _terminal.Name;
        public string? HwId => _terminal.HwId;
        public bool IsOnline => _terminal.IsOnline;
    }
}
