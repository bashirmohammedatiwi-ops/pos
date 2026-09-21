using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class SectionsPage : UserControl, IRefreshable
{
    public SectionsPage()
    {
        InitializeComponent();
        Loaded += async (_, _) => await LoadAsync();
    }

    public async Task RefreshAsync() => await LoadAsync();

    private async Task LoadAsync()
    {
        try
        {
            var list = await AppServices.Api.GetSectionSummariesAsync();
            if (list is null)
            {
                MessageBox.Show("تعذّر تحميل نقاط البيع — تحقق من اتصال API وتطبيق تحديثات قاعدة البيانات");
                list = [];
            }

            Grid.ItemsSource = list;
            KpiTotal.Text = list.Count.ToString("N0");
            KpiActive.Text = list.Count(s => s.State).ToString("N0");
            KpiCashBoxes.Text = list.Sum(s => s.CashBoxCount).ToString("N0");
        }
        catch (Exception ex)
        {
            MessageBox.Show($"تعذّر تحميل نقاط البيع:\n{ex.Message}", "خطأ", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void Add_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new SectionEditDialog { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true || dlg.CreateResult is null) return;

        var (result, err) = await AppServices.Api.CreateSectionAsync(dlg.CreateResult);
        if (result is null)
        {
            MessageBox.Show(err ?? "فشل إنشاء القسم");
            return;
        }

        MessageBox.Show($"تم إضافة نقطة البيع\n{result.EdariMessage}");
        await LoadAsync();
    }

    private async void Grid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (Grid.SelectedItem is not SectionSummaryDto row) return;
        await EditSectionAsync(row.Id);
    }

    private async Task EditSectionAsync(long id)
    {
        var detail = await AppServices.Api.GetSectionDetailAsync(id);
        if (detail is null)
        {
            MessageBox.Show("تعذّر تحميل بيانات القسم");
            return;
        }

        var dlg = new SectionEditDialog(detail) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() != true) return;

        if (dlg.DeleteRequested)
        {
            var (deleted, deleteErr) = await AppServices.Api.DeleteSectionAsync(id);
            if (!deleted)
            {
                MessageBox.Show(deleteErr ?? "فشل الحذف");
                return;
            }

            MessageBox.Show("تم حذف نقطة البيع");
            await LoadAsync();
            return;
        }

        if (dlg.UpdateResult is null) return;

        var (result, err) = await AppServices.Api.UpdateSectionAsync(id, dlg.UpdateResult);
        if (result is null)
        {
            MessageBox.Show(err ?? "فشل التحديث");
            return;
        }

        MessageBox.Show($"تم التحديث\n{result.EdariMessage}");
        await LoadAsync();
    }

    private async void SyncEdari_Click(object sender, RoutedEventArgs e)
    {
        if (await AppServices.Api.SyncEdariBranchesAsync())
        {
            MessageBox.Show("تمت مزامنة فروع Edari");
            await LoadAsync();
        }
        else MessageBox.Show("فشلت المزامنة");
    }

    private void Grid_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        DeleteBtn.IsEnabled = Grid.SelectedItem is SectionSummaryDto;

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (Grid.SelectedItem is not SectionSummaryDto row) return;
        if (MessageBox.Show($"حذف نقطة البيع «{row.Name}»؟\n\nلا يمكن التراجع.", "تأكيد",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;

        var (ok, err) = await AppServices.Api.DeleteSectionAsync(row.Id);
        if (!ok)
        {
            MessageBox.Show(err ?? "فشل الحذف");
            return;
        }

        MessageBox.Show("تم حذف نقطة البيع");
        await LoadAsync();
    }
}
