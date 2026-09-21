using System.Windows;
using System.Windows.Input;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class HoldReceiptWindow : Window
{
    public HoldReceiptDto? Selected { get; private set; }

    public HoldReceiptWindow(IEnumerable<HoldReceiptDto> holds)
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        Grid.ItemsSource = holds.ToList();
        if (Grid.Items.Count > 0) Grid.SelectedIndex = 0;
    }

    private void Grid_OnMouseDoubleClick(object sender, MouseButtonEventArgs e) => Recall_Click(sender, e);

    private void Recall_Click(object sender, RoutedEventArgs e)
    {
        Selected = Grid.SelectedItem as HoldReceiptDto;
        if (Selected is null) return;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);
}
