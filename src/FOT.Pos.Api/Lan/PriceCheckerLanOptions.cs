namespace FOT.Pos.Api.Lan;

public sealed class PriceCheckerLanOptions
{
    public bool Enabled { get; set; } = true;
    public string InterfaceIp { get; set; } = "192.168.75.1";
    public string SubnetMask { get; set; } = "255.255.255.0";
    public string PoolStart { get; set; } = "192.168.75.10";
    public string PoolEnd { get; set; } = "192.168.75.250";
    public int LeaseHours { get; set; } = 72;
}
