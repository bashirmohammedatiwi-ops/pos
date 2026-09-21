using System.Windows;

namespace FOT.Pos.Admin;

public partial class OfferPercentDialog : Window
{
    public decimal Percent { get; private set; }

    public OfferPercentDialog(string? treeName)
    {
        InitializeComponent();
        TitleLabel.Text = string.IsNullOrWhiteSpace(treeName)
            ? "حدد نسبة التخفيض"
            : $"نسبة الخصم على شجرة: {treeName}";
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (!decimal.TryParse(PercentBox.Text, out var p) || p <= 0 || p > 100)
        {
            MessageBox.Show("أدخل نسبة بين 1 و 100");
            return;
        }
        Percent = p;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
