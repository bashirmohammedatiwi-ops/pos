namespace FOT.Pos.Infrastructure.Edari;

/// <summary>Edari salesman rows. Nexus has no SaleMan table; ids come from FilePOS5.SaleMan and names from the Edari 1..250 register.</summary>
internal static class EdariSalesmenConstants
{
    public const int MinId = 1;
    public const int MaxId = 250;
}

public sealed class EdariSellerRow
{
    public long Seq { get; set; }
    public string? Name { get; set; }
    public string? Num { get; set; }
}

public sealed record EdariSalesmenSyncResult(
    bool Success,
    string Message,
    int Added,
    int Updated,
    int Total,
    DateTime SyncedAt);
