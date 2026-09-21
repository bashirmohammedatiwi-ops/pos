namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Maps POS receipt fields to Edari FilePOS5/FilePOS4 (pre-merge staging bills).
/// </summary>
internal static class EdariReceiptMapper
{
    /// <summary>
    /// FilePOS5.Kind decides what «دمج الإيصالات» produces:
    /// 1 → فاتورة مبيعات (File15n Kind=4, SaleAcc + CashAcc),
    /// 2 → مردودات مبيعات (File15n Kind=5, UnSaleAcc + CashAcc),
    /// 3 → فاتورة إخراج (File15n Kind=6, stock only).
    /// Legacy FOT POS wrote returns as FOT_Reciepts.Kind=1 → FilePOS5.Kind=2.
    /// Gifts post as Kind 3 (output invoice) against the configured gifts account.
    /// </summary>
    public static int MapEdariBillKind(int posKind, long account)
    {
        _ = account;
        return posKind switch
        {
            1 => 2,
            2 => 3,
            _ => 1,
        };
    }

    /// <summary>Edari POS bills keep positive Quant; the Kind (not the sign) chooses مرتجع vs مبيعات.</summary>
    public static decimal MapEdariQuantity(decimal quantity) => Math.Abs(quantity);

    /// <summary>Line total for FilePOS4, always positive to match FilePOS5.Tot.</summary>
    public static decimal MapEdariLineTotal(decimal quantity, decimal price) =>
        MapEdariQuantity(quantity) * price;

    /// <summary>
    /// Amount the FilePOS4 lines must add up to. Legacy FOT POS keeps the lines at their
    /// pre-invoice-discount value and carries the invoice discount on FilePOS5.Dscnt, which
    /// «دمج الإيصالات» subtracts — so the lines are the receipt total plus that discount.
    /// </summary>
    public static decimal ExpectedBillLinesTotal(decimal totalAmount, decimal userDiscount) =>
        Math.Abs(totalAmount) + Math.Max(0m, userDiscount);

    /// <summary>
    /// FilePOS5.Dscnt is the invoice-level discount only. The offers/item discount is already
    /// taken out of the FilePOS4 line prices, so adding it here made «دمج الإيصالات» subtract
    /// it a second time and post less than the receipt collected.
    /// </summary>
    public static decimal MapEdariBillDiscount(decimal userDiscount) => Math.Max(0m, userDiscount);

    /// <summary>Edari SaleMan is 1-based when a salesman is selected.</summary>
    public static long MapEdariSalesman(long salesmanId) =>
        salesmanId > 0 ? salesmanId + 1 : 0;

    /// <summary>
    /// Legacy Edari FilePOS5 always uses Casher=1 — cash box posting uses FileBrch.CashAcc on merge.
    /// </summary>
    public static long MapEdariCasher(long masterAccount) => 1;

    /// <summary>Cash sales stay Acc=0 until Edari merge; credit uses the selected account Seq.</summary>
    public static long MapEdariAccount(long account) => account > 0 ? account : 0;

    /// <summary>
    /// FOT_Reciepts.Kind is one less than FilePOS5.Kind (legacy sale: POS5=1 → staging=0).
    /// </summary>
    public static int MapEdariStagingKind(int edariBillKind) =>
        edariBillKind switch
        {
            1 => 0,
            2 => 1,
            3 => 2,
            _ => 0,
        };

    /// <summary>
    /// Edari FOT_Reciepts.pos_id is the terminal slot in Edari (not SQL point_of_sale_id).
    /// The unique index "numbers" is (pos_id, Number), and legacy FOT POS owns slots 1-4 and keeps
    /// its own running Number per slot — sharing a slot makes both systems fight over the same
    /// numbers and the loser's receipt never reaches Edari. Slots stay above 100 for that reason.
    /// </summary>
    public static int MapEdariPosId(int edariBranch) => 100 + edariBranch;

    /// <summary>
    /// FOT_Reciepts.Reciept_Id is unique and legacy FOT POS fills it from its own HAYAT2025 identity,
    /// which runs through the same low range as ours — without an offset our insert silently replaces
    /// the legacy row for the receipt that happens to share the id. The column is a signed 32-bit int,
    /// so the offset leaves room for ~1.1 billion of our own receipts. The offset doubles as the marker
    /// that tells our staging rows apart from the legacy ones (see StagingReceiptIdFloor).
    /// </summary>
    public static long MapStagingReceiptId(long posReceiptId) => StagingReceiptIdFloor + posReceiptId;

    /// <summary>Every staging row at or above this Reciept_Id was written by us, not by legacy FOT POS.</summary>
    public const long StagingReceiptIdFloor = 1_000_000_000L;

    /// <summary>Recovers the POS receipt id from a staging Reciept_Id written by us.</summary>
    public static long UnmapStagingReceiptId(long stagingReceiptId) => stagingReceiptId - StagingReceiptIdFloor;

    /// <summary>Edari staging cashier_id per branch (not SQL cashiers.id).</summary>
    public static int MapEdariCashierId(int edariBranch) => edariBranch switch
    {
        1 => 3,
        2 => 2,
        3 => 4,
        4 => 5,
        5 => 3,
        _ => 3,
    };
}
