using System.Windows;
using System.Windows.Controls;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Pages;

public partial class TargetsPage : UserControl, IRefreshable
{
    public TargetsPage() => InitializeComponent();

    public async Task RefreshAsync()
    {
        var rules = await AppServices.Api.GetTargetRulesAsync();
        RulesGrid.ItemsSource = rules;
        var progress = await AppServices.Api.GetTargetProgressAsync();
        ProgressGrid.ItemsSource = progress?.Select(p => new TargetProgressRow(p)).ToList();
    }

    private async void Add_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new TargetCreateDialog();
        if (dlg.ShowDialog() != true || dlg.Result is null) return;
        if (await AppServices.Api.CreateTargetRuleAsync(dlg.Result))
        { System.Windows.MessageBox.Show("تمت الإضافة"); await RefreshAsync(); }
    }

    private sealed class TargetProgressRow(TargetProgressDto dto)
    {
        public string RuleName => dto.RuleName;
        public string PeriodType => $"{dto.PeriodStart:yyyy-MM-dd} → {dto.PeriodEnd:yyyy-MM-dd}";
        public DateTime PeriodStart => dto.PeriodStart;
        public decimal CurrentValue => dto.CurrentQuantity;
        public decimal TargetValue => 0;
        public decimal ProgressPercent => 0;
    }
}
