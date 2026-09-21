namespace FOT.Pos.Client.Services;

public static class TerminalHelper
{
    public static string GetHwId()
    {
        var machine = Environment.MachineName;
        return $"FOT-{machine}".ToUpperInvariant();
    }
}
