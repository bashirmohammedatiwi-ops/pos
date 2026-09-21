using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Admin.Services;

namespace FOT.Pos.Admin.Pages;

public partial class CashierActivityPage : UserControl, IRefreshable
{
    public CashierActivityPage()
    {
        InitializeComponent();
        FromDate.SelectedDate = DateTime.Today;
        ToDate.SelectedDate = DateTime.Today;
    }

    public Task RefreshAsync() => LoadAsync();

    private async Task LoadAsync()
    {
        var from = FromDate.SelectedDate ?? DateTime.Today;
        var to = ToDate.SelectedDate ?? DateTime.Today;
        var search = string.IsNullOrWhiteSpace(SearchBox.Text) ? null : SearchBox.Text.Trim();
        Grid.ItemsSource = await AppServices.Api.GetCashierActivityAsync(from, to, search);
    }

    private async void Search_Click(object sender, System.Windows.RoutedEventArgs e) => await LoadAsync();
    private async void SearchBox_OnKeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) await LoadAsync(); }
}
