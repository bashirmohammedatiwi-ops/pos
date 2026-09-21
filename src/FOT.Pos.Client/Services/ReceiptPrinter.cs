using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using FOT.Pos.Client.Models;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Shared.Printing;

namespace FOT.Pos.Client.Services;

public static class ReceiptPrinter
{
    public static void Print(
        PrintSettingsDto settings,
        ReceiptPrintPreviewDto data,
        string? preferredPrinter = null,
        bool silent = false)
    {
        var layout = ReceiptLayoutEngine.Build(settings, data);
        var doc = ReceiptFlowDocumentBuilder.ToFlowDocument(
            layout, settings, url => ReceiptLogoLoader.Load(url, AppServices.Api.BaseUrl));
        var copies = Math.Clamp(settings.Copies, 1, 5);

        for (var i = 0; i < copies; i++)
        {
            if (silent)
                PrintSilent(doc, settings, preferredPrinter);
            else
                PrintInteractive(doc, settings);
        }
    }

    public static ReceiptPrintPreviewDto BuildPrintData(
        CreateReceiptResponse result,
        CreateReceiptRequest req,
        IReadOnlyList<CartLine> lines,
        string? cashierName,
        string? salesmanName,
        string? posLabel)
    {
        var sub = lines.Sum(l => l.LineTotal);
        return new ReceiptPrintPreviewDto(
            result.Number,
            DateTime.Now,
            cashierName,
            salesmanName,
            posLabel,
            lines.Select(l => new ReceiptPrintLineDto(
                l.Name, l.Barcode, null, l.Quantity, l.Price, l.LineTotal, l.OriginalPrice)).ToList(),
            sub,
            req.UserDiscount,
            result.TotalAmount,
            req.Payment,
            result.CashBack);
    }

    public static void PrintFromSale(
        PrintSettingsDto settings,
        CreateReceiptResponse result,
        CreateReceiptRequest req,
        IReadOnlyList<CartLine> lines,
        string? cashierName,
        string? salesmanName,
        string? posLabel,
        string? preferredPrinter = null,
        bool? silent = null)
    {
        var data = BuildPrintData(result, req, lines, cashierName, salesmanName, posLabel);
        Print(settings, data, preferredPrinter, silent ?? settings.AutoPrint);
    }

    private static void PrintInteractive(FlowDocument doc, PrintSettingsDto settings)
    {
        var pd = new PrintDialog();
        if (pd.ShowDialog() != true) return;
        doc.PageHeight = pd.PrintableAreaHeight;
        doc.PageWidth = pd.PrintableAreaWidth;
        pd.PrintDocument(((IDocumentPaginatorSource)doc).DocumentPaginator, "FOT POS Receipt");
    }

    private static void PrintSilent(FlowDocument doc, PrintSettingsDto settings, string? preferredPrinter)
    {
        PrintQueue? queue = null;
        if (!string.IsNullOrWhiteSpace(preferredPrinter))
        {
            try
            {
                using var server = new LocalPrintServer();
                queue = server.GetPrintQueues().FirstOrDefault(q =>
                    q.Name.Equals(preferredPrinter, StringComparison.OrdinalIgnoreCase));
            }
            catch { /* use default */ }
        }

        queue ??= LocalPrintServer.GetDefaultPrintQueue();
        if (queue is null)
            throw new InvalidOperationException("لا توجد طابعة افتراضية — اختر طابعة من إعدادات الطباعة");

        var writer = PrintQueue.CreateXpsDocumentWriter(queue);
        doc.PageHeight = double.NaN;
        writer.Write(((IDocumentPaginatorSource)doc).DocumentPaginator);
    }
}
