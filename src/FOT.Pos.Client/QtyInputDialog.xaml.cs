using System.Windows;
using System.Windows.Input;
using FOT.Pos.Client.Services;

namespace FOT.Pos.Client;

public partial class QtyInputDialog : Window
{
    public decimal Quantity { get; private set; }

    public QtyInputDialog(string productName, decimal currentQty)
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        ProductLabel.Text = productName;
        QtyBox.Text = currentQty.ToString("N0");
        Loaded += (_, _) => { QtyBox.SelectAll(); QtyBox.Focus(); };
    }

    private void Plus_Click(object sender, RoutedEventArgs e) => Nudge(1);
    private void Minus_Click(object sender, RoutedEventArgs e) => Nudge(-1);

    private void Nudge(int delta)
    {
        if (!decimal.TryParse(QtyBox.Text.Replace(",", ""), out var qty)) qty = 1;
        qty += delta;
        if (qty == 0) qty = delta > 0 ? 1 : -1;
        QtyBox.Text = qty.ToString("N0");
        QtyBox.SelectAll();
        QtyBox.Focus();
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (!decimal.TryParse(QtyBox.Text.Replace(",", ""), out var qty) || qty == 0)
        {
            ErrorLabel.Text = "أدخل كمية صحيحة";
            ErrorLabel.Visibility = Visibility.Visible;
            return;
        }
        Quantity = qty;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);

    private void QtyBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Ok_Click(sender, e);
    }
}
