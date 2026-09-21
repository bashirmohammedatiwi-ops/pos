using System.Windows.Controls;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared;

namespace FOT.Pos.Admin.Pages;

public partial class ReportsPage : UserControl, IRefreshable
{
    public ReportsPage()
    {
        InitializeComponent();
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today;
    }

    public async Task RefreshAsync() => await LoadMovementAsync();

    private async Task LoadMovementAsync()
    {
        var from = FromDate.SelectedDate ?? DateTime.Today;
        var to = ToDate.SelectedDate ?? DateTime.Today;
        var rows = await AppServices.Api.GetMovementReportAsync(from, to, SearchBox.Text);
        MovementGrid.ItemsSource = rows;

        var daily = await AppServices.Api.GetDailySalesReportAsync(from.AddDays(-30), to);
        DailyGrid.ItemsSource = daily;

        var bySalesman = await AppServices.Api.GetSalesBySalesmanAsync(from, to);
        SalesmanGrid.ItemsSource = bySalesman;

        var cash = await AppServices.Api.GetCashReportAsync(from, to);
        if (cash is not null)
        {
            CashTotalSales.Text = MoneyFormat.FormatCurrency(cash.TotalSales);
            CashReceiptCount.Text = cash.ReceiptCount.ToString("N0");
            CashTotalPayment.Text = MoneyFormat.FormatCurrency(cash.TotalPayment);
            CashTotalChange.Text = MoneyFormat.FormatCurrency(cash.TotalCashBack);
            CashAverage.Text = MoneyFormat.FormatCurrency(cash.AverageTicket);
            CashHint.Text = $"الفترة: {from:yyyy-MM-dd} — {to:yyyy-MM-dd}";
        }
    }

    private async void Load_Click(object sender, System.Windows.RoutedEventArgs e) => await LoadMovementAsync();
}
