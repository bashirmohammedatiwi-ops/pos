using System.Windows;
using System.Windows.Controls;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class OfferCreateDialog : Window
{
    public CreateOfferRequest? Result { get; private set; }

    public OfferCreateDialog() => InitializeComponent();

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text)) return;
        if (!int.TryParse(PriorityBox.Text, out var pri)) pri = 1;
        var typeTag = (TypeCombo.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "0";
        var type = int.Parse(typeTag);
        Result = new CreateOfferRequest(NameBox.Text.Trim(), pri, type, EnabledBox.IsChecked == true);
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
