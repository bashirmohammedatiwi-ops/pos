namespace FOT.Pos.Client.Models;

public sealed class InvoiceSlotState
{
    public List<CartLine> Lines { get; } = [];
    public List<CartGroup> Groups { get; } = [new CartGroup { Key = 1 }];
    public int ActiveGroupKey { get; set; } = 1;
    public string UserDiscountText { get; set; } = "";
    public DiscountInputMode DiscountMode { get; set; } = DiscountInputMode.Amount;
    public SaleKind ActiveSaleKind { get; set; } = SaleKind.Sale;
    public long? RecalledHoldId { get; set; }

    public bool HasItems => Lines.Count > 0;

    public decimal Subtotal => Math.Abs(Lines.Sum(c => c.LineTotal));

    public int ItemCount => (int)Lines.Sum(c => Math.Abs(c.Quantity));

    public void Clear()
    {
        Lines.Clear();
        Groups.Clear();
        Groups.Add(new CartGroup { Key = 1 });
        ActiveGroupKey = 1;
        UserDiscountText = "";
        DiscountMode = DiscountInputMode.Amount;
        ActiveSaleKind = SaleKind.Sale;
        RecalledHoldId = null;
    }

    public void ClearAfterSale()
    {
        Lines.Clear();
        UserDiscountText = "";
        DiscountMode = DiscountInputMode.Amount;
        ActiveSaleKind = SaleKind.Sale;
        RecalledHoldId = null;
    }
}
