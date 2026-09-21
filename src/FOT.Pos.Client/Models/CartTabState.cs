namespace FOT.Pos.Client.Models;

public sealed class CartTabState
{
    public int Id { get; init; }
    public string Label { get; set; } = "1";
    public List<CartLine> Lines { get; } = [];
    public string UserDiscountText { get; set; } = "";
    public long? RecalledHoldId { get; set; }
    public SaleKind ActiveSaleKind { get; set; }
    public DiscountInputMode DiscountMode { get; set; }
}
