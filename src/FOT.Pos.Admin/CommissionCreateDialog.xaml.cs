using System.Windows;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class CommissionCreateDialog : Window
{
    public CreateCommissionRuleRequest? Result { get; private set; }

    public CommissionCreateDialog() => InitializeComponent();

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!decimal.TryParse(ValueBox.Text, out var val)) return;
        var type = (TypeCombo.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Tag?.ToString() ?? "percentage";
        Result = new CreateCommissionRuleRequest(null, string.IsNullOrWhiteSpace(BarcodeBox.Text) ? null : BarcodeBox.Text.Trim(),
            type, val, DateTime.Today, null);
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
