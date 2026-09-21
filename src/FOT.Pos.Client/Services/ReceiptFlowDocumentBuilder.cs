using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Shared.Printing;

namespace FOT.Pos.Client.Services;

public static class ReceiptFlowDocumentBuilder
{
    public static FlowDocument ToFlowDocument(
        ReceiptLayout layout,
        PrintSettingsDto settings,
        Func<string?, byte[]?>? loadLogoBytes = null)
    {
        var widthPx = settings.PaperWidthMm <= 58 ? 220.0 : 300.0;
        var baseFont = Math.Clamp(settings.FontSize, 8, 16);
        var doc = new FlowDocument
        {
            FontFamily = new FontFamily("Consolas, Courier New, Segoe UI, Tahoma"),
            FontSize = baseFont,
            PageWidth = widthPx,
            PagePadding = new Thickness(6, 8, 6, 8),
            TextAlignment = TextAlignment.Right,
            FlowDirection = FlowDirection.RightToLeft
        };

        if (!string.IsNullOrWhiteSpace(layout.LogoUrl))
        {
            var bytes = loadLogoBytes?.Invoke(layout.LogoUrl);
            if (bytes is { Length: > 0 })
            {
                try
                {
                    var img = new BitmapImage();
                    using var ms = new MemoryStream(bytes);
                    img.BeginInit();
                    img.CacheOption = BitmapCacheOption.OnLoad;
                    img.StreamSource = ms;
                    img.EndInit();
                    img.Freeze();

                    var maxH = Math.Clamp(settings.LogoMaxHeightPx, 32, 160);
                    var scale = img.PixelHeight > 0 ? maxH / img.PixelHeight : 1;
                    var imgCtrl = new Image
                    {
                        Source = img,
                        Height = maxH,
                        Width = img.PixelWidth * scale,
                        Stretch = Stretch.Uniform,
                        HorizontalAlignment = HorizontalAlignment.Center
                    };
                    doc.Blocks.Add(new Paragraph(new InlineUIContainer(imgCtrl))
                    {
                        TextAlignment = TextAlignment.Center,
                        Margin = new Thickness(0, 0, 0, 8)
                    });
                }
                catch { /* skip broken logo */ }
            }
        }

        foreach (var line in layout.Lines)
        {
            if (string.IsNullOrEmpty(line.Text) && line.Style != ReceiptLineStyle.Separator) continue;
            doc.Blocks.Add(BuildParagraph(line, baseFont));
        }

        return doc;
    }

    private static Paragraph BuildParagraph(ReceiptLayoutLine line, double baseFont)
    {
        var para = new Paragraph { Margin = new Thickness(0, 0, 0, 2) };

        switch (line.Style)
        {
            case ReceiptLineStyle.Center:
            case ReceiptLineStyle.Separator:
                para.TextAlignment = TextAlignment.Center;
                break;
            case ReceiptLineStyle.ItemName:
                para.TextAlignment = TextAlignment.Right;
                para.Margin = new Thickness(0, 4, 0, 1);
                break;
            default:
                para.TextAlignment = TextAlignment.Right;
                break;
        }

        var fontSize = baseFont;
        if (line.Style is ReceiptLineStyle.Small or ReceiptLineStyle.Meta)
            fontSize = Math.Max(7, baseFont - 2);
        if (line.Style is ReceiptLineStyle.TableHeader)
            fontSize = Math.Max(7, baseFont - 1);
        para.FontSize = fontSize;

        if (line.Style == ReceiptLineStyle.Separator)
        {
            para.Foreground = Brushes.LightGray;
            para.Inlines.Add(new Run(line.Text));
            return para;
        }

        if (line.Style == ReceiptLineStyle.UnitPriceStruck)
        {
            para.Foreground = Brushes.Gray;
            para.FontSize = Math.Max(7, baseFont - 2);
            para.Inlines.Add(new Run("  سعر الوحدة: ") { FontSize = para.FontSize });
            para.Inlines.Add(new Run(line.Text.Trim()) { TextDecorations = TextDecorations.Strikethrough });
            if (!string.IsNullOrWhiteSpace(line.AltText))
            {
                para.Inlines.Add(new LineBreak());
                para.Inlines.Add(new Run(line.AltText) { FontWeight = FontWeights.SemiBold, Foreground = Brushes.Black });
            }
            return para;
        }

        if (line.Style is ReceiptLineStyle.Small or ReceiptLineStyle.Meta)
            para.Foreground = Brushes.Gray;

        var run = new Run(line.Text);
        if (line.Style is ReceiptLineStyle.Bold or ReceiptLineStyle.ItemName or ReceiptLineStyle.TableHeader)
            run.FontWeight = FontWeights.Bold;
        para.Inlines.Add(run);
        return para;
    }
}

public static class ReceiptLogoLoader
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly string CacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FOT.Pos", "receipt-logo");

    public static byte[]? Load(string? logoUrl, string apiBaseUrl)
    {
        if (string.IsNullOrWhiteSpace(logoUrl)) return null;

        try
        {
            Directory.CreateDirectory(CacheDir);
            var ext = Path.GetExtension(logoUrl);
            if (string.IsNullOrEmpty(ext)) ext = ".png";
            var cacheFile = Path.Combine(CacheDir, "logo" + ext);

            if (logoUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                var bytes = Http.GetByteArrayAsync(logoUrl).GetAwaiter().GetResult();
                File.WriteAllBytes(cacheFile, bytes);
                return bytes;
            }

            var baseUrl = apiBaseUrl.TrimEnd('/');
            var path = logoUrl.StartsWith('/') ? logoUrl : "/" + logoUrl;
            var fullUrl = baseUrl + path;

            if (File.Exists(cacheFile))
            {
                var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(cacheFile);
                if (age < TimeSpan.FromHours(6))
                    return File.ReadAllBytes(cacheFile);
            }

            var data = Http.GetByteArrayAsync(fullUrl).GetAwaiter().GetResult();
            File.WriteAllBytes(cacheFile, data);
            return data;
        }
        catch
        {
            try
            {
                var ext = Path.GetExtension(logoUrl) ?? ".png";
                var cacheFile = Path.Combine(CacheDir, "logo" + ext);
                if (File.Exists(cacheFile)) return File.ReadAllBytes(cacheFile);
            }
            catch { /* ignore */ }
            return null;
        }
    }
}
