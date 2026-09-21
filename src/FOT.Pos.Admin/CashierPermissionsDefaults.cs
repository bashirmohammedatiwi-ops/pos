using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public static class CashierPermissionsDefaults
{
    public static UpdatePermissionsRequest New() => new(
        MakeDiscount: false,
        ViewReceipts: true,
        CashReport: true,
        DeleteItem: true,
        DuplicateItem: true,
        OfflineLogin: false,
        DiscardReceipt: true,
        AllowCreditReceipt: false,
        AllowSalesReturn: false,
        AllowGiftReceipt: false,
        AllowPriceChange: false,
        AllowSearchArticles: true,
        AllowEditReceipt: false,
        ItemDiscountLimit: 0,
        UserDiscountLimit: 0,
        NumberOfHoldReceipts: 5);

    public static UpdatePermissionsRequest From(CashierPermissionsDto p) => new(
        p.MakeDiscount,
        p.ViewReceipts,
        p.CashReport,
        p.DeleteItem,
        p.DuplicateItem,
        p.OfflineLogin,
        p.DiscardReceipt,
        p.AllowCreditReceipt,
        p.AllowSalesReturn,
        p.AllowGiftReceipt,
        p.AllowPriceChange,
        p.AllowSearchArticles,
        p.AllowEditReceipt,
        p.ItemDiscountLimit,
        p.UserDiscountLimit,
        p.NumberOfHoldReceipts);
}
