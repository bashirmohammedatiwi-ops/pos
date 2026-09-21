using System.Windows.Controls;
using FOT.Pos.Admin.Services;

namespace FOT.Pos.Admin.Pages;

public partial class AccountsPage : UserControl, IRefreshable
{
    public AccountsPage() => InitializeComponent();

    public async Task RefreshAsync()
    {
        var list = await AppServices.Api.GetCreditAccountsAsync();
        Grid.ItemsSource = list;
    }
}
