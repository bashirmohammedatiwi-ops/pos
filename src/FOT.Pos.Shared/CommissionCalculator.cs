namespace FOT.Pos.Shared;

public static class CommissionCalculator
{
    public static decimal ComputeAmount(string commissionType, decimal commissionValue, decimal quantity, decimal lineAmount)
    {
        if (commissionValue <= 0 || quantity <= 0) return 0;
        var raw = commissionType.Equals("percentage", StringComparison.OrdinalIgnoreCase)
            ? lineAmount * commissionValue / 100
            : commissionValue * quantity;
        return Math.Round(raw, 2, MidpointRounding.AwayFromZero);
    }
}
