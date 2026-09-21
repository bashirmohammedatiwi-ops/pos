using System.Windows;
using System.Windows.Controls;
using FOT.Pos.Admin.Printing;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Shared.Printing;

namespace FOT.Pos.Admin.Controls;

public partial class ReceiptPreviewControl : UserControl
{
    private byte[]? _logoBytes;

    public ReceiptPreviewControl() => InitializeComponent();

    public void SetLogoBytes(byte[]? bytes) => _logoBytes = bytes;

    public void Render(PrintSettingsDto settings, ReceiptPrintPreviewDto? data = null)
    {
        data ??= ReceiptLayoutEngine.Sample(settings);
        var layout = ReceiptLayoutEngine.Build(settings, data);
        var width = settings.PaperWidthMm <= 58 ? 220.0 : 300.0;
        PaperBorder.Width = width + 24;
        PaperHint.Text = settings.PaperWidthMm <= 58 ? "ورق 58mm — طابعة حرارية" : "ورق 80mm — طابعة حرارية";

        var doc = ReceiptFlowDocumentBuilder.ToFlowDocument(layout, settings, _logoBytes);
        PreviewViewer.Document = doc;
    }
}
