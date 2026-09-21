using System.Printing;
using System.Windows;
using System.Windows.Media;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Shared.Printing;

namespace FOT.Pos.Client;

public partial class PrintSettingsWindow : Window
{
    private LocalPrintConfig _local = LocalPrintConfig.Load();
    private PrintSettingsDto _settings = PrintSettingsDto.Default;

    public PrintSettingsWindow()
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        _settings = await PrintSettingsCache.GetAsync();
        SettingsSummary.Text =
            $"ترويسة: {_settings.HeaderText}\n" +
            $"ورق {_settings.PaperWidthMm}mm · خط {_settings.FontSize} · {_settings.Copies} نسخة\n" +
            $"طباعة تلقائية: {(_settings.AutoPrint ? "نعم" : "لا")}";

        AskBeforePrintChk.IsChecked = _local.AskBeforePrint;
        LoadPrinters();
    }

    private void LoadPrinters()
    {
        PrinterCombo.Items.Clear();
        try
        {
            using var server = new LocalPrintServer();
            foreach (var q in server.GetPrintQueues().OrderBy(p => p.Name))
                PrinterCombo.Items.Add(q.Name);

            if (!string.IsNullOrWhiteSpace(_local.PrinterName))
            {
                foreach (var item in PrinterCombo.Items)
                    if (item.ToString()?.Equals(_local.PrinterName, StringComparison.OrdinalIgnoreCase) == true)
                    { PrinterCombo.SelectedItem = item; return; }
            }

            var def = LocalPrintServer.GetDefaultPrintQueue()?.Name;
            if (def is not null)
                foreach (var item in PrinterCombo.Items)
                    if (item.ToString() == def) { PrinterCombo.SelectedItem = item; return; }

            if (PrinterCombo.Items.Count > 0) PrinterCombo.SelectedIndex = 0;
        }
        catch
        {
            PrinterCombo.Items.Add("(تعذّر قراءة الطابعات)");
            PrinterCombo.SelectedIndex = 0;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        _local.PrinterName = PrinterCombo.SelectedItem?.ToString();
        _local.AskBeforePrint = AskBeforePrintChk.IsChecked == true;
        _local.Save();
        DialogResult = true;
        Close();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);

    private void ShowStatus(string message, bool ok)
    {
        StatusLabel.Visibility = Visibility.Visible;
        StatusLabel.Text = message;
        StatusLabel.Foreground = ok
            ? new SolidColorBrush(Color.FromRgb(0x05, 0x96, 0x69))
            : new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26));
    }

    private async void TestPrint_Click(object sender, RoutedEventArgs e)
    {
        _settings = await PrintSettingsCache.GetAsync();
        var sample = ReceiptLayoutEngine.Sample(_settings);
        PrintReceipt(_settings, sample);
    }

    private async void Reprint_Click(object sender, RoutedEventArgs e)
    {
        var last = LastReceiptStore.Load();
        if (last is null) { ShowStatus("لا توجد فاتورة سابقة للطباعة", false); return; }
        _settings = await PrintSettingsCache.GetAsync();
        PrintReceipt(_settings, last);
    }

    private void PrintReceipt(PrintSettingsDto settings, ReceiptPrintPreviewDto data)
    {
        var local = LocalPrintConfig.Load();
        var printer = local.PrinterName ?? PrinterCombo.SelectedItem?.ToString();
        var ask = local.AskBeforePrint || AskBeforePrintChk.IsChecked == true;
        try
        {
            ReceiptPrinter.Print(settings, data, printer, silent: !ask);
            ShowStatus("تم إرسال أمر الطباعة", true);
        }
        catch (Exception ex)
        {
            ShowStatus($"فشل الطباعة: {ex.Message}", false);
        }
    }
}
