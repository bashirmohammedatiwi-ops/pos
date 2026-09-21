using System.Windows.Controls;
using FOT.Pos.Admin;
using FOT.Pos.Admin.Services;

namespace FOT.Pos.Admin.Pages;

public partial class SalesmenPage : UserControl, IRefreshable
{
    public SalesmenPage() => InitializeComponent();

    public async Task RefreshAsync()
    {
        var res = await AppServices.Api.GetSalesmenAsync(1);
        Grid.ItemsSource = res?.Items;
    }
}
