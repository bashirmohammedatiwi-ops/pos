using System.Windows;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class TargetCreateDialog : Window
{
    private long? _edariTreeSeq;
    private string? _edariTreeName;

    public CreateTargetRuleRequest? Result { get; private set; }

    public TargetCreateDialog() => InitializeComponent();

    private void PickTree_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new EdariTreePickerDialog { Owner = this };
        if (dlg.ShowDialog() != true || dlg.SelectedNode is null) return;
        _edariTreeSeq = dlg.SelectedNode.Seq;
        _edariTreeName = dlg.SelectedNode.Name;
        TreeBox.Text = $"{dlg.SelectedNode.Name} (Seq {dlg.SelectedNode.Seq})";
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text) || !decimal.TryParse(ValueBox.Text, out var val)) return;
        var type = (TypeCombo.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Tag?.ToString() ?? "amount";
        var period = (PeriodCombo.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Tag?.ToString() ?? "monthly";
        Result = new CreateTargetRuleRequest(
            NameBox.Text.Trim(),
            EdariTreeSeq: _edariTreeSeq,
            EdariTreeName: _edariTreeName);
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
