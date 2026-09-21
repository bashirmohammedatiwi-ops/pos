using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public static class PermissionsHelper
{
    public static bool CanDiscount(CashierPermissionsDto? p) => p?.MakeDiscount ?? true;
    public static bool CanReturn(CashierPermissionsDto? p) => p?.AllowSalesReturn ?? true;
    public static bool CanSearch(CashierPermissionsDto? p) => p?.AllowSearchArticles ?? true;
    public static bool CanCredit(CashierPermissionsDto? p) => p?.AllowCreditReceipt ?? true;
    public static bool CanDeleteItem(CashierPermissionsDto? p) => p?.DeleteItem ?? true;
    public static bool CanHold(CashierPermissionsDto? p) => (p?.NumberOfHoldReceipts ?? 5) > 0;
    public static int MaxHoldReceipts(CashierPermissionsDto? p) => p?.NumberOfHoldReceipts ?? 5;
    public static bool CanChangePrice(CashierPermissionsDto? p) => p?.AllowPriceChange ?? false;
    public static bool CanManageOffers(CashierPermissionsDto? p) =>
        p?.AllowPriceChange == true || p?.MakeDiscount == true;

    public static decimal MaxUserDiscount(CashierPermissionsDto? p)
    {
        var limit = p?.UserDiscountLimit ?? 0;
        // 0 = no cap (legacy POS convention)
        return limit <= 0 ? decimal.MaxValue : limit;
    }
}
