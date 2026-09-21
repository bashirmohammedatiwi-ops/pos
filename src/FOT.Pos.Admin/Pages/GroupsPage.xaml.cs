using System.Windows;
using System.Windows.Controls;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class GroupsPage : UserControl, IRefreshable
{
    public GroupsPage() => InitializeComponent();

    public async Task RefreshAsync()
    {
        var groups = await AppServices.Api.GetGroupsAsync();
        GroupsList.ItemsSource = groups;
        if (groups?.Count > 0) GroupsList.SelectedIndex = 0;
    }

    private async void GroupsList_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (GroupsList.SelectedItem is not ArticleGroupDto g) return;
        ItemsTitle.Text = $"{g.Name} ({g.ItemCount} منتج)";
        ItemsGrid.ItemsSource = await AppServices.Api.GetGroupItemsAsync(g.Id);
    }
}
