namespace FOT.Pos.Shared.Dtos;

/// <summary>
/// Parameterless constructors so Dapper maps by column name instead of constructor signature.
/// Keep new SQL-mapped records `partial` and add a constructor here.
/// </summary>
public partial record OfferDto
{
    public OfferDto() : this(0, "", 0, false, 0, 0, 0) { }
}

public partial record ReceiptItemDto
{
    public ReceiptItemDto() : this(0, 0, null, null, 0, 0, 0, 0, 0) { }
}

public partial record SalesmanDto
{
    public SalesmanDto() : this(0, "") { }
}

public partial record SectionDto
{
    public SectionDto() : this(0, "", 0, false, 0) { }
}

public partial record SectionSummaryDto
{
    public SectionSummaryDto() : this(0, "", 0, null, false, 0, 0, 0, 0, 0, 0, 0, 0, 0) { }
}

public partial record CashierDto
{
    public CashierDto() : this(0, "", null, false, 0) { }
}

public partial record CashierPermissionsDto
{
    public CashierPermissionsDto() : this(
        0, null, false, false, false, false, false, false, false, false, false, false, false, false, false, 0, 0, 0)
    { }
}

public partial record DailySalesRowDto
{
    public DailySalesRowDto() : this(default, 0, 0) { }
}

public partial record SalesmanSalesRowDto
{
    public SalesmanSalesRowDto() : this(0, null, 0, 0) { }
}

public partial record MovementRowDto
{
    public MovementRowDto() : this(0, null, null, 0, 0) { }
}

public partial record EdariSyncLogDto
{
    public EdariSyncLogDto() : this(0, null, "", null, null, null, null, default) { }
}

public partial record ArticleGroupDto
{
    public ArticleGroupDto() : this(0, null, 0, 0, 0) { }
}

public partial record PrintSettingsDto
{
    public PrintSettingsDto() : this(
        0, null, null, null, null, null, null,
        false, false, false, 1, 80, 13, 72, false, true, true, true, true, true, true, true,
        "classic", 400, true, true, 250, null)
    { }
}

public partial record PosCashBoxSettingsDto
{
    public PosCashBoxSettingsDto() : this(null, 0, null, null, null, 0, null, null) { }
}

public partial record BusinessPeriodSettingsDto
{
    public BusinessPeriodSettingsDto() : this(
        6, 7, "السبت", "الجمعة",
        default, default, default, default, default, default)
    { }
}

public partial record CommissionRuleDto
{
    public CommissionRuleDto() : this(0, null, null, null, null, null, null, "", 0, false, default, null) { }
}

public partial record CommissionCalculationDto
{
    public CommissionCalculationDto() : this(0, 0, 0, null, 0, null, "", 0, 0, 0, 0, default) { }
}

public partial record CommissionGapRow
{
    public CommissionGapRow() : this(0, null, default, 0, null, 0, null, "") { }
}

public partial record CommissionReceiptReportRow
{
    public CommissionReceiptReportRow() : this(0, null, null, 0, 0, 0) { }
}

public partial record TargetProductRowDto
{
    public TargetProductRowDto() : this(0, null, 0, 0) { }
}

public partial record TargetReceiptRowDto
{
    public TargetReceiptRowDto() : this(0, null, default, 0, null, 0, 0, 0) { }
}

public partial record CommissionPayoutDto
{
    public CommissionPayoutDto() : this(0, 0, null, 0, default, null, false) { }
}

public partial record CommissionDailyReportRow
{
    public CommissionDailyReportRow() : this(default, 0, 0, 0) { }
}

public partial record CommissionGroupReportRow
{
    public CommissionGroupReportRow() : this(null, null, 0, 0, 0) { }
}

public partial record CommissionProductReportRow
{
    public CommissionProductReportRow() : this(0, null, 0, 0, 0, 0) { }
}

public partial record SalesmanCommissionSummaryDto
{
    public SalesmanCommissionSummaryDto() : this(0, null, "IQD", 0, 0, 0, 0, 0, null) { }
}

public partial record SalesmanCommissionProfileDto
{
    public SalesmanCommissionProfileDto() : this(0, null, "IQD", 0, 0, null) { }
}

public partial record CommissionGroupDto
{
    public CommissionGroupDto() : this(0, "", null, "", 0, null, null, null, 0, null, false, default, null, 0, 0, 0) { }
}

public partial record CommissionGroupTreeDto
{
    public CommissionGroupTreeDto() : this(0, 0, null, false, 0) { }
}

public partial record CommissionGroupItemDto
{
    public CommissionGroupItemDto() : this(0, null, null, null, null, null) { }
}

public partial record CatalogInfoDto
{
    public CatalogInfoDto() : this(0, 0) { }
}

public partial record ReceiptSummaryDto
{
}

public partial record ReceiptTotalsSummaryDto
{
}

public partial record PosTerminalDto
{
}

public partial record HoldReceiptDto
{
}

public partial record DiscountQrPersonDto
{
    public DiscountQrPersonDto() : this(0, "", "", true, default) { }
}

public partial record DiscountQrReceiptDto
{
    public DiscountQrReceiptDto() : this(0, 0, default, 0, 0) { }
}

public partial record SellerLookupDto
{
    public SellerLookupDto() : this(0, "") { }
}

public partial record SellerMeDto
{
    public SellerMeDto() : this(0, "", false) { }
}

public partial record SellerMallDto
{
    public SellerMallDto() : this(0, "", null, 0, 0, 0) { }
}

public partial record SellerCommissionGroupDto
{
    public SellerCommissionGroupDto() : this(0, "", "", 0, 0) { }
}

public partial record SellerCommissionProductDto
{
    public SellerCommissionProductDto() : this(null, null, null, 0, "", "", 0) { }
}

public partial record SellerCommissionLineDto
{
    public SellerCommissionLineDto() : this(0, "", null, 0, 0, null, default, null) { }
}

public partial record SellerGoalLineDto
{
    public SellerGoalLineDto() : this("", 0, null, default, null) { }
}

public partial record PortalSellerAccountDto
{
    public PortalSellerAccountDto() : this(0, "", false, false, null, null, null) { }
}

public partial record SellerHubAccountDto
{
    public SellerHubAccountDto() : this(0, "", null, false, false) { }
}

public partial record PortalManagerAccountDto
{
    public PortalManagerAccountDto() : this(0, "", "", false, null, default) { }
}
