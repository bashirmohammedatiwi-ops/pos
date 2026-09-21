namespace FOT.Pos.Api;

internal static class FotDataPaths
{
    public static string Root
    {
        get
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "FOT.Pos");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string Uploads => Ensure(Path.Combine(Root, "uploads"));

    public static string ReceiptUploads => Ensure(Path.Combine(Uploads, "receipt"));

    private static string Ensure(string path)
    {
        Directory.CreateDirectory(path);
        return path;
    }
}
