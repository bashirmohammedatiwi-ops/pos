using System.Media;

namespace FOT.Pos.Client.Services;

public static class PosFeedback
{
    public static void ScanOk() { }
    public static void ScanError() => SystemSounds.Hand.Play();
    public static void SaleComplete() => SystemSounds.Exclamation.Play();
}
