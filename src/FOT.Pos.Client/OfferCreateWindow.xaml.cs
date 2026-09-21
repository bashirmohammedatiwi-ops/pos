using System.Windows;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class OfferCreateWindow : Window
{
    public CreateOfferRequest? Result { get; private set; }

    public OfferCreateWindow()
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        Loaded += (_, _) => NameBox.Focus();
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text)) return;
        if (!int.TryParse(PriorityBox.Text, out var pri)) pri = 1;
        Result = new CreateOfferRequest(NameBox.Text.Trim(), pri, 0, EnabledBox.IsChecked == true);
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);
}
