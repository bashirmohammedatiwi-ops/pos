using System.IO;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media.Imaging;
using FOT.Pos.Admin.Controls;
using FOT.Pos.Admin.Printing;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Shared.Printing;
using Microsoft.Win32;

namespace FOT.Pos.Admin.Pages;

public partial class SettingsPage : UserControl, IRefreshable
{
    private PrintSettingsDto? _loaded;
    private bool _suppressPreview;
    private byte[]? _logoPreviewBytes;

    public SettingsPage() => InitializeComponent();

    public async Task RefreshAsync()
    {
        _suppressPreview = true;
        var s = await AppServices.Api.GetPrintSettingsAsync();
        if (s is null) { _suppressPreview = false; return; }
        _loaded = s;

        NameBox.Text = s.Name ?? "";
        HeaderBox.Text = s.HeaderText ?? "";
        HeaderDescBox.Text = s.HeaderDescription ?? "";
        FooterBox.Text = s.FooterText ?? "";
        QrBox.Text = s.QrCodeText ?? "";

        SelectCombo(PaperWidthCombo, s.PaperWidthMm <= 58 ? "58" : "80");
        SelectCombo(FontSizeCombo, s.FontSize.ToString());
        SelectCombo(CopiesCombo, Math.Clamp(s.Copies, 1, 3).ToString());
        SelectCombo(LogoHeightCombo, Math.Clamp(s.LogoMaxHeightPx, 48, 120).ToString());

        ShowLogoChk.IsChecked = s.ShowLogo;
        ShowItemTableChk.IsChecked = s.ShowItemTable;
        ShowSubtotalChk.IsChecked = s.ShowSubtotal;
        ShowPaymentLinesChk.IsChecked = s.ShowPaymentLines;
        ShowBarcodeChk.IsChecked = s.ShowBarcode;
        ShowArticleNumChk.IsChecked = s.ShowArticleNumber;
        ShowQrChk.IsChecked = s.ShowQrCode;
        ShowCashierChk.IsChecked = s.ShowCashier;
        ShowSalesmanChk.IsChecked = s.ShowSalesman;
        ShowDiscountsChk.IsChecked = s.ShowDiscountDetails;
        AutoPrintChk.IsChecked = s.AutoPrint;

        _logoPreviewBytes = await ReceiptFlowDocumentBuilder.LoadLogoFromUrlAsync(s.LogoUrl, AppServices.Api.BaseUrl);
        UpdateLogoPreview();

        _suppressPreview = false;
        UpdatePreview();
        StatusText.Text = "";
    }

    private void Form_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressPreview) return;
        UpdatePreview();
    }

    private void UpdatePreview()
    {
        Preview.SetLogoBytes(_logoPreviewBytes);
        Preview.Render(BuildFromForm());
    }

    private void UpdateLogoPreview()
    {
        if (_logoPreviewBytes is { Length: > 0 })
        {
            var img = new BitmapImage();
            using var ms = new MemoryStream(_logoPreviewBytes);
            img.BeginInit();
            img.CacheOption = BitmapCacheOption.OnLoad;
            img.StreamSource = ms;
            img.EndInit();
            img.Freeze();
            LogoPreviewImage.Source = img;
            RemoveLogoBtn.IsEnabled = true;
        }
        else
        {
            LogoPreviewImage.Source = null;
            RemoveLogoBtn.IsEnabled = _loaded?.LogoUrl is not null;
        }
    }

    private async void UploadLogo_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFileDialog
        {
            Filter = "صور|*.png;*.jpg;*.jpeg;*.webp;*.gif",
            Title = "اختر شعار المتجر"
        };
        if (dlg.ShowDialog() != true) return;

        UploadLogoBtn.IsEnabled = false;
        try
        {
            _logoPreviewBytes = await File.ReadAllBytesAsync(dlg.FileName);
            UpdateLogoPreview();

            var saved = await AppServices.Api.UploadPrintLogoAsync(dlg.FileName);
            if (saved is null)
            {
                StatusText.Foreground = (System.Windows.Media.Brush)FindResource("DangerBrush");
                StatusText.Text = "فشل رفع الشعار";
                return;
            }
            _loaded = saved;
            ShowLogoChk.IsChecked = true;
            StatusText.Foreground = (System.Windows.Media.Brush)FindResource("SuccessBrush");
            StatusText.Text = "تم رفع الشعار بنجاح";
            UpdatePreview();
        }
        finally { UploadLogoBtn.IsEnabled = true; }
    }

    private async void RemoveLogo_Click(object sender, RoutedEventArgs e)
    {
        RemoveLogoBtn.IsEnabled = false;
        try
        {
            var saved = await AppServices.Api.DeletePrintLogoAsync();
            _logoPreviewBytes = null;
            UpdateLogoPreview();
            if (saved is not null) _loaded = saved;
            ShowLogoChk.IsChecked = false;
            StatusText.Foreground = (System.Windows.Media.Brush)FindResource("SuccessBrush");
            StatusText.Text = "تم حذف الشعار";
            UpdatePreview();
        }
        finally { RemoveLogoBtn.IsEnabled = true; }
    }

    private PrintSettingsDto BuildFromForm()
    {
        var id = _loaded?.Id ?? 1;
        return new PrintSettingsDto(
            id,
            NameBox.Text.Trim(),
            HeaderBox.Text.Trim(),
            string.IsNullOrWhiteSpace(HeaderDescBox.Text) ? null : HeaderDescBox.Text.Trim(),
            FooterBox.Text.Trim(),
            string.IsNullOrWhiteSpace(QrBox.Text) ? null : QrBox.Text.Trim(),
            _loaded?.LogoUrl,
            ShowLogoChk.IsChecked == true,
            ShowBarcodeChk.IsChecked == true,
            ShowArticleNumChk.IsChecked == true,
            int.TryParse(GetComboTag(CopiesCombo), out var copies) ? copies : 1,
            GetComboTag(PaperWidthCombo) == "58" ? 58 : 80,
            int.TryParse(GetComboTag(FontSizeCombo), out var fs) ? fs : 11,
            int.TryParse(GetComboTag(LogoHeightCombo), out var lh) ? lh : 72,
            ShowQrChk.IsChecked == true,
            ShowCashierChk.IsChecked == true,
            ShowSalesmanChk.IsChecked == true,
            ShowDiscountsChk.IsChecked == true,
            ShowItemTableChk.IsChecked == true,
            ShowSubtotalChk.IsChecked == true,
            ShowPaymentLinesChk.IsChecked == true,
            AutoPrintChk.IsChecked == true);
    }

    private UpdatePrintSettingsRequest BuildRequest()
    {
        var s = BuildFromForm();
        return new UpdatePrintSettingsRequest(
            s.Name, s.HeaderText, s.HeaderDescription, s.FooterText, s.QrCodeText,
            s.ShowLogo, s.ShowBarcode, s.ShowArticleNumber, s.Copies, s.PaperWidthMm, s.FontSize,
            s.LogoMaxHeightPx, s.ShowQrCode, s.ShowCashier, s.ShowSalesman, s.ShowDiscountDetails,
            s.ShowItemTable, s.ShowSubtotal, s.ShowPaymentLines, s.AutoPrint);
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        SaveBtn.IsEnabled = false;
        try
        {
            var saved = await AppServices.Api.SavePrintSettingsAsync(BuildRequest());
            if (saved is null)
            {
                StatusText.Foreground = (System.Windows.Media.Brush)FindResource("DangerBrush");
                StatusText.Text = "فشل الحفظ — تحقق من الاتصال بالخادم";
                return;
            }
            _loaded = saved;
            StatusText.Foreground = (System.Windows.Media.Brush)FindResource("SuccessBrush");
            StatusText.Text = "تم حفظ إعدادات الطباعة — ستُطبَّق على نقاط البيع";
        }
        finally { SaveBtn.IsEnabled = true; }
    }

    private void TestPrint_Click(object sender, RoutedEventArgs e)
    {
        var settings = BuildFromForm();
        var layout = ReceiptLayoutEngine.Build(settings, ReceiptLayoutEngine.Sample(settings));
        var doc = ReceiptFlowDocumentBuilder.ToFlowDocument(layout, settings, _logoPreviewBytes);
        var pd = new PrintDialog();
        if (pd.ShowDialog() != true) return;
        pd.PrintDocument(((IDocumentPaginatorSource)doc).DocumentPaginator, "FOT POS — تجريبي");
    }

    private static void SelectCombo(ComboBox combo, string tag)
    {
        foreach (ComboBoxItem item in combo.Items)
            if (item.Tag?.ToString() == tag) { combo.SelectedItem = item; return; }
        combo.SelectedIndex = 0;
    }

    private static string? GetComboTag(ComboBox combo) =>
        (combo.SelectedItem as ComboBoxItem)?.Tag?.ToString();
}
