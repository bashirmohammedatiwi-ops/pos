namespace FOT.Pos.Api.HostedServices;

/// <summary>
/// مفتاح المزامنة مع خادم الفريق (VPS). سري ولا يُحفظ في git:
///  1) SellerWeb:SyncKey في appsettings أو متغير البيئة SellerWeb__SyncKey إن ضُبط؛
///  2) وإلا الملف %ProgramData%\FOT.Pos\hub-sync.key — يُكتب من لوحة التحكم ويبقى بعد تحديث المثبّت.
/// </summary>
public static class HubSyncKeyStore
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "hub-sync.key");

    // المفتاح القديم منشور في المستودع — خادم الفريق يرفضه
    private const string Leaked = "fot-hub-sync-e7Kq9mN2pL4xW8vR";

    /// <summary>المفتاح المضبوط فعلاً (من الإعدادات أو لوحة التحكم)، أو null.</summary>
    public static string? ReadConfigured(IConfiguration config)
    {
        var configured = config["SellerWeb:SyncKey"]?.Trim();
        if (!string.IsNullOrEmpty(configured) && configured != Leaked) return configured;
        try
        {
            if (File.Exists(FilePath))
            {
                var stored = File.ReadAllText(FilePath).Trim();
                if (stored.Length >= 24) return stored;
            }
        }
        catch
        {
            /* غير متاح: المزامنة متوقفة حتى يُضبط */
        }
        return null;
    }

    /// <summary>
    /// المفتاح المستخدم للمزامنة: المضبوط، وإلا القديم مؤقتاً — يعمل مع خادم الفريق القديم
    /// إلى أن يُحدَّث الـ VPS ويُلصق مفتاحه الجديد في لوحة التحكم (فلا تنقطع المزامنة قبل ذلك).
    /// </summary>
    public static string Read(IConfiguration config) => ReadConfigured(config) ?? Leaked;

    /// <summary>مصدر المفتاح الحالي للعرض في لوحة التحكم.</summary>
    public static string Source(IConfiguration config)
    {
        var configured = config["SellerWeb:SyncKey"]?.Trim();
        if (!string.IsNullOrEmpty(configured) && configured != Leaked) return "settings";
        return ReadConfigured(config) is null ? "none" : "file";
    }

    public static void Save(string key)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, key.Trim());
    }

    public static string Mask(string? key) => key is null ? "" : key.Length <= 8 ? "••••" : $"{key[..4]}••••{key[^4..]}";
}
