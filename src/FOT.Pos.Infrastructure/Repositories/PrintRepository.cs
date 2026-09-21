using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class PrintRepository(ISqlConnectionFactory db)
{
    private const string SelectSql = """
        SELECT TOP 1
            id AS Id,
            LTRIM(RTRIM(name)) AS Name,
            LTRIM(RTRIM(CONVERT(NVARCHAR(500), title))) AS HeaderText,
            LTRIM(RTRIM(CONVERT(NVARCHAR(500), title_description))) AS HeaderDescription,
            LTRIM(RTRIM(CONVERT(NVARCHAR(500), footer))) AS FooterText,
            LTRIM(RTRIM(qr_code)) AS QrCodeText,
            LTRIM(RTRIM(logo_url)) AS LogoUrl,
            CAST(COALESCE(show_logo, 0) AS bit) AS ShowLogo,
            CAST(COALESCE(print_barcode, 1) AS bit) AS ShowBarcode,
            CAST(COALESCE(print_article_number, 0) AS bit) AS ShowArticleNumber,
            COALESCE(print_count, 1) AS Copies,
            COALESCE(paper_width_mm, 80) AS PaperWidthMm,
            COALESCE(font_size, 13) AS FontSize,
            COALESCE(font_weight, 400) AS FontWeight,
            COALESCE(logo_max_height_px, 72) AS LogoMaxHeightPx,
            CAST(COALESCE(show_qr, 0) AS bit) AS ShowQrCode,
            CAST(COALESCE(show_cashier, 1) AS bit) AS ShowCashier,
            CAST(COALESCE(show_salesman, 1) AS bit) AS ShowSalesman,
            CAST(COALESCE(show_cash_box, 1) AS bit) AS ShowCashBox,
            CAST(COALESCE(show_total_quantity, 1) AS bit) AS ShowTotalQuantity,
            COALESCE(round_total_to, 250) AS RoundTotalTo,
            CAST(COALESCE(show_discounts, 1) AS bit) AS ShowDiscountDetails,
            CAST(COALESCE(show_item_table, 1) AS bit) AS ShowItemTable,
            CAST(COALESCE(show_subtotal, 1) AS bit) AS ShowSubtotal,
            CAST(COALESCE(show_payment_lines, 1) AS bit) AS ShowPaymentLines,
            CAST(COALESCE(auto_print, 1) AS bit) AS AutoPrint,
            LTRIM(RTRIM(COALESCE(receipt_template, N'classic'))) AS ReceiptTemplate,
            classic_style AS ClassicStyle
        FROM print_options ORDER BY id
        """;

    public async Task<PrintSettingsDto> GetSettingsAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        try
        {
            var row = await conn.QueryRowOrDefaultAsync<PrintSettingsDto>(
                new CommandDefinition(SelectSql, cancellationToken: ct));
            return row ?? PrintSettingsDto.Default;
        }
        catch
        {
            return PrintSettingsDto.Default;
        }
    }

    public async Task<PrintSettingsDto> SaveSettingsAsync(UpdatePrintSettingsRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var fontSize = Math.Clamp(req.FontSize, 9, 22);
        var fontWeight = Math.Clamp(req.FontWeight, 300, 700);
        var roundTotalTo = Math.Clamp(req.RoundTotalTo, 0, 100_000);
        var id = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT TOP 1 id FROM print_options ORDER BY id", cancellationToken: ct));

        if (id is null or 0)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO print_options (name, title, title_description, footer, qr_code,
                    print_barcode, print_article_number, print_count, paper_width_mm, font_size, font_weight,
                    show_qr, show_cashier, show_salesman, show_cash_box, show_total_quantity,
                    round_total_to, show_discounts, auto_print,
                    show_logo, show_item_table, show_subtotal, show_payment_lines, logo_max_height_px,
                    receipt_template, classic_style)
                VALUES (@Name, @HeaderText, @HeaderDescription, @FooterText, @QrCodeText,
                    @ShowBarcode, @ShowArticleNumber, @Copies, @PaperWidthMm, @FontSize, @FontWeight,
                    @ShowQrCode, @ShowCashier, @ShowSalesman, @ShowCashBox, @ShowTotalQuantity,
                    @RoundTotalTo, @ShowDiscountDetails, @AutoPrint,
                    @ShowLogo, @ShowItemTable, @ShowSubtotal, @ShowPaymentLines, @LogoMaxHeightPx,
                    @ReceiptTemplate, @ClassicStyle)
                """, new
            {
                req.Name, req.HeaderText, req.HeaderDescription, req.FooterText, req.QrCodeText,
                req.ShowBarcode, req.ShowArticleNumber, req.Copies, req.PaperWidthMm,
                FontSize = fontSize, FontWeight = fontWeight,
                req.ShowQrCode, req.ShowCashier, req.ShowSalesman, req.ShowCashBox,
                req.ShowTotalQuantity, RoundTotalTo = roundTotalTo,
                req.ShowDiscountDetails, req.AutoPrint,
                req.ShowLogo, req.ShowItemTable, req.ShowSubtotal, req.ShowPaymentLines, req.LogoMaxHeightPx,
                ReceiptTemplate = PrintSettingsDto.NormalizeTemplate(req.ReceiptTemplate),
                ClassicStyle = string.IsNullOrWhiteSpace(req.ClassicStyle) ? null : req.ClassicStyle
            }, cancellationToken: ct));
        }
        else
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE print_options SET
                    name = @Name, title = @HeaderText, title_description = @HeaderDescription,
                    footer = @FooterText, qr_code = @QrCodeText,
                    print_barcode = @ShowBarcode, print_article_number = @ShowArticleNumber,
                    print_count = @Copies, paper_width_mm = @PaperWidthMm,
                    font_size = @FontSize, font_weight = @FontWeight,
                    show_qr = @ShowQrCode, show_cashier = @ShowCashier, show_salesman = @ShowSalesman,
                    show_cash_box = @ShowCashBox, show_total_quantity = @ShowTotalQuantity,
                    round_total_to = @RoundTotalTo,
                    show_discounts = @ShowDiscountDetails, auto_print = @AutoPrint,
                    show_logo = @ShowLogo, show_item_table = @ShowItemTable,
                    show_subtotal = @ShowSubtotal, show_payment_lines = @ShowPaymentLines,
                    logo_max_height_px = @LogoMaxHeightPx,
                    receipt_template = @ReceiptTemplate,
                    classic_style = @ClassicStyle
                WHERE id = @id
                """, new
            {
                id,
                req.Name, req.HeaderText, req.HeaderDescription, req.FooterText, req.QrCodeText,
                req.ShowBarcode, req.ShowArticleNumber, req.Copies, req.PaperWidthMm,
                FontSize = fontSize, FontWeight = fontWeight,
                req.ShowQrCode, req.ShowCashier, req.ShowSalesman, req.ShowCashBox,
                req.ShowTotalQuantity, RoundTotalTo = roundTotalTo,
                req.ShowDiscountDetails, req.AutoPrint,
                req.ShowLogo, req.ShowItemTable, req.ShowSubtotal, req.ShowPaymentLines, req.LogoMaxHeightPx,
                ReceiptTemplate = PrintSettingsDto.NormalizeTemplate(req.ReceiptTemplate),
                ClassicStyle = string.IsNullOrWhiteSpace(req.ClassicStyle) ? null : req.ClassicStyle
            }, cancellationToken: ct));
        }

        return await GetSettingsAsync(ct);
    }

    public async Task<PrintSettingsDto> SetLogoUrlAsync(string? logoUrl, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var id = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT TOP 1 id FROM print_options ORDER BY id", cancellationToken: ct));
        if (id is null or 0)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO print_options (name, logo_url, show_logo) VALUES (N'الفاتورة', @logoUrl, 1)",
                new { logoUrl }, cancellationToken: ct));
        }
        else
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE print_options SET logo_url = @logoUrl, show_logo = CASE WHEN @logoUrl IS NULL THEN 0 ELSE 1 END WHERE id = @id",
                new { id, logoUrl }, cancellationToken: ct));
        }
        return await GetSettingsAsync(ct);
    }
}
