using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Shared.Printing;

public enum ReceiptLineStyle
{
    Normal,
    Bold,
    Center,
    Separator,
    Small,
    Right,
    TableHeader,
    ItemName,
    TableRow,
    UnitPriceStruck,
    UnitPriceFinal,
    Meta
}

public sealed record ReceiptLayoutLine(
    string Text,
    ReceiptLineStyle Style = ReceiptLineStyle.Normal,
    string? AltText = null);

public sealed class ReceiptLayout
{
    public int PaperWidthMm { get; init; }
    public int PaperWidthChars => PaperWidthMm <= 58 ? 32 : 42;
    public string? LogoUrl { get; init; }
    public IReadOnlyList<ReceiptLayoutLine> Lines { get; init; } = [];
}

public static class ReceiptLayoutEngine
{
    public static ReceiptLayout Build(PrintSettingsDto settings, ReceiptPrintPreviewDto data)
    {
        var width = settings.PaperWidthMm <= 58 ? 58 : 80;
        var cols = width <= 58 ? 32 : 42;
        var lines = new List<ReceiptLayoutLine>();

        void Center(string? t) { if (!string.IsNullOrWhiteSpace(t)) lines.Add(new(t.Trim(), ReceiptLineStyle.Center)); }
        void Bold(string? t) { if (!string.IsNullOrWhiteSpace(t)) lines.Add(new(t.Trim(), ReceiptLineStyle.Bold)); }
        void Line(string? t) { if (!string.IsNullOrWhiteSpace(t)) lines.Add(new(t.Trim())); }
        void Sep() => lines.Add(new(new string('─', cols), ReceiptLineStyle.Separator));

        if (settings.ShowLogo && !string.IsNullOrWhiteSpace(settings.LogoUrl))
            lines.Add(new("", ReceiptLineStyle.Center)); // logo slot — rendered first by WPF layer

        var template = settings.TemplateKey;
        if (template == "branded")
        {
            Bold(settings.HeaderText ?? "FOT POS");
            Center(settings.HeaderDescription);
            Sep();
            Bold($"فاتورة #{data.ReceiptNumber}");
        }
        else
        {
            Center(settings.HeaderText ?? "FOT POS");
            Center(settings.HeaderDescription);
            Sep();
            if (template == "compact")
                Line($"فاتورة #{data.ReceiptNumber}");
            else
                Bold($"فاتورة #{data.ReceiptNumber}");
        }
        Center(data.KindLabel);
        Line(data.PrintedAt.ToString("yyyy/MM/dd  HH:mm"));
        if (!string.IsNullOrWhiteSpace(data.PosLabel))
            Line(data.PosLabel);

        if (settings.ShowCashier && !string.IsNullOrWhiteSpace(data.CashierName))
            Line($"كاشير: {data.CashierName}");
        if (settings.ShowSalesman && !string.IsNullOrWhiteSpace(data.SalesmanName))
            Line($"مندوب: {data.SalesmanName}");
        if (settings.ShowCashBox && !string.IsNullOrWhiteSpace(data.CashBoxName))
            Line($"الصندوق: {data.CashBoxName}");

        Sep();

        if (settings.ShowItemTable)
            BuildItemTable(lines, settings, data, cols);
        else
            BuildItemList(lines, settings, data, cols);

        Sep();

        var combinedDisc = data.Lines.Sum(ItemDiscountAmount) + Math.Max(0, data.UserDiscount);
        var grossTotal = data.Lines.Sum(item => ListPrice(item) * Math.Abs(item.Quantity));

        lines.Add(new(PadLine("الإجمالي", FormatAmount(grossTotal), cols)));
        lines.Add(new(PadLine("الخصم", combinedDisc > 0 ? $"-{FormatAmount(combinedDisc)}" : FormatAmount(0), cols)));
        lines.Add(new(PadLine("الصافي للدفع", FormatAmount(data.Total), cols), ReceiptLineStyle.Bold));

        if (settings.ShowPaymentLines)
        {
            lines.Add(new(PadLine("الدفعة", FormatAmount(data.Paid), cols)));
            lines.Add(new(PadLine("المبلغ المرتجع", FormatAmount(data.Change), cols)));
        }

        Sep();

        if (settings.ShowQrCode && !string.IsNullOrWhiteSpace(settings.QrCodeText))
        {
            Center("[ QR ]");
            Center(settings.QrCodeText);
            Sep();
        }

        Center(settings.FooterText ?? "شكراً لتسوقكم");

        return new ReceiptLayout
        {
            PaperWidthMm = width,
            LogoUrl = settings.ShowLogo ? settings.LogoUrl : null,
            Lines = lines
        };
    }

    private static void BuildItemTable(
        List<ReceiptLayoutLine> lines,
        PrintSettingsDto settings,
        ReceiptPrintPreviewDto data,
        int cols)
    {
        var narrow = cols <= 32;
        var hdr = narrow
            ? PadCols5("المادة", "كم", "إفرادي", "حسم", "الإجمالي", 9, 3, 6, 5, 7)
            : PadCols5("المادة", "كم", "إفرادي", "حسم", "الإجمالي", 13, 4, 8, 7, 10);
        lines.Add(new(hdr, ReceiptLineStyle.TableHeader));

        foreach (var item in data.Lines)
        {
            var name = Trunc(item.Name ?? item.Barcode ?? "—", narrow ? 28 : 38);
            lines.Add(new(name, ReceiptLineStyle.ItemName));
            var disc = ItemDiscountAmount(item);
            var net = NetLineTotal(item);
            var row = narrow
                ? PadCols5("", FormatQty(item.Quantity), FormatAmount(ListPrice(item)), disc > 0 ? FormatAmount(disc) : "—", FormatAmount(net), 9, 3, 6, 5, 7)
                : PadCols5("", FormatQty(item.Quantity), FormatAmount(ListPrice(item)), disc > 0 ? FormatAmount(disc) : "—", FormatAmount(net), 13, 4, 8, 7, 10);
            lines.Add(new(row, ReceiptLineStyle.TableRow));

            var meta = new List<string>();
            if (settings.ShowArticleNumber && !string.IsNullOrWhiteSpace(item.ArticleNum))
                meta.Add($"رقم: {item.ArticleNum}");
            if (settings.ShowBarcode && !string.IsNullOrWhiteSpace(item.Barcode))
                meta.Add(item.Barcode);
            if (meta.Count > 0)
                lines.Add(new("  " + string.Join(" · ", meta), ReceiptLineStyle.Meta));
        }

        var qtyTotal = data.Lines.Sum(i => i.Quantity);
        var discTotal = data.Lines.Sum(ItemDiscountAmount);
        var netTotal = data.Lines.Sum(NetLineTotal);
        var qtyRow = narrow
            ? PadCols5("", FormatQty(qtyTotal), "", discTotal > 0 ? FormatAmount(discTotal) : "", FormatAmount(netTotal), 9, 3, 6, 5, 7)
            : PadCols5("", FormatQty(qtyTotal), "", discTotal > 0 ? FormatAmount(discTotal) : "", FormatAmount(netTotal), 13, 4, 8, 7, 10);
        lines.Add(new(qtyRow, ReceiptLineStyle.TableRow));
    }

    private static void BuildItemList(
        List<ReceiptLayoutLine> lines,
        PrintSettingsDto settings,
        ReceiptPrintPreviewDto data,
        int cols)
    {
        foreach (var item in data.Lines)
        {
            var name = Trunc(item.Name ?? item.Barcode ?? "—", cols <= 32 ? 28 : 38);
            lines.Add(new(name, ReceiptLineStyle.Bold));

            var meta = new List<string>();
            if (settings.ShowArticleNumber && !string.IsNullOrWhiteSpace(item.ArticleNum))
                meta.Add($"رقم: {item.ArticleNum}");
            if (settings.ShowBarcode && !string.IsNullOrWhiteSpace(item.Barcode))
                meta.Add(item.Barcode);
            if (meta.Count > 0)
                lines.Add(new(string.Join(" · ", meta), ReceiptLineStyle.Small));

            var qtyPrice = $"{FormatQty(item.Quantity)} × {FormatAmount(ListPrice(item))}";
            lines.Add(new(PadLine(qtyPrice, FormatAmount(NetLineTotal(item)), cols), ReceiptLineStyle.Right));
        }
    }

    public static ReceiptPrintPreviewDto Sample(PrintSettingsDto settings) => new(
        20261000001,
        DateTime.Now,
        settings.ShowCashier ? "أحمد الكاشير" : null,
        settings.ShowSalesman ? "محمد المندوب" : null,
        "نقطة بيع 1",
        [
            new("شامبو هيربل essences", "6281000123456", "A-1001", 2, 12500, 25000, 15000),
            new("كريم مرطب للوجه", "6281000987654", "B-2044", 1, 22000, 22000, 22000),
            new("معجون أسنان", "6281000555555", "C-3301", 3, 3500, 10500, 4000)
        ],
        57500, 2500, 55000, 60000, 5000);

    private static decimal ListPrice(ReceiptPrintLineDto item) =>
        item.OriginalPrice > 0 ? item.OriginalPrice : item.Price;

    private static bool ItemHasDiscount(ReceiptPrintLineDto item) =>
        item.OriginalPrice > item.Price && item.OriginalPrice > 0;

    private static decimal ItemDiscountAmount(ReceiptPrintLineDto item) =>
        ItemHasDiscount(item) ? (item.OriginalPrice - item.Price) * Math.Abs(item.Quantity) : 0;

    private static decimal NetLineTotal(ReceiptPrintLineDto item) =>
        Math.Max(0, ListPrice(item) * Math.Abs(item.Quantity) - ItemDiscountAmount(item));

    private static string FormatAmount(decimal v) => v.ToString("N0");
    private static string FormatQty(decimal v) => v % 1 == 0 ? v.ToString("N0") : v.ToString("0.##");

    private static string Trunc(string s, int max) =>
        s.Length <= max ? s : s[..(max - 1)] + "…";

    private static string PadLine(string left, string right, int width)
    {
        var gap = width - left.Length - right.Length;
        if (gap < 1) gap = 1;
        return left + new string(' ', gap) + right;
    }

    private static string PadCols5(string c1, string c2, string c3, string c4, string c5, int w1, int w2, int w3, int w4, int w5)
    {
        static string Fit(string s, int w) => s.Length >= w ? s[..w] : s.PadLeft(w);
        return Fit(c1, w1) + Fit(c2, w2) + Fit(c3, w3) + Fit(c4, w4) + Fit(c5, w5);
    }
}
