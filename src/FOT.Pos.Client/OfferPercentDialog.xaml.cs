using System.Windows;
using FOT.Pos.Client.Services;

namespace FOT.Pos.Client;

public partial class OfferPercentDialog : Window
{
    public decimal Percent { get; private set; }

    public OfferPercentDialog(string? treeName)
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        TitleLabel.Text = string.IsNullOrWhiteSpace(treeName)
            ? "حدد نسبة التخفيض"
            : $"نسبة الخصم على شجرة: {treeName}";
        Loaded += (_, _) => { PercentBox.SelectAll(); PercentBox.Focus(); };
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (!decimal.TryParse(PercentBox.Text, out var p) || p <= 0 || p > 100)
        {
            ErrorLabel.Text = "أدخل نسبة بين 1 و 100";
            ErrorLabel.Visibility = Visibility.Visible;
            return;
        }
        Percent = p;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);
}
