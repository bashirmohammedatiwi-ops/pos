using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public sealed record OfflineSessionCache(
    PosSessionDto Session,
    string ServerUrl,
    string PinVerifier,
    DateTime SavedAtUtc,
    bool AllowOfflineMode);

/// <summary>جلسة كاشير محفوظة للعمل دون اتصال بالخادم.</summary>
public static class OfflineSessionStore
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FOT.Pos.Client", "offline-session.json");

    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);

    public static string CreatePinVerifier(string pin)
    {
        var salt = Encoding.UTF8.GetBytes(TerminalHelper.GetHwId() + "|FOT-POS-OFFLINE");
        var data = Encoding.UTF8.GetBytes(pin.Trim());
        var combined = new byte[salt.Length + data.Length];
        Buffer.BlockCopy(salt, 0, combined, 0, salt.Length);
        Buffer.BlockCopy(data, 0, combined, salt.Length, data.Length);
        return Convert.ToHexString(SHA256.HashData(combined));
    }

    public static void Save(PosSessionDto session, string serverUrl, string pin)
    {
        var cache = new OfflineSessionCache(
            session,
            serverUrl.TrimEnd('/'),
            CreatePinVerifier(pin),
            DateTime.UtcNow,
            session.AllowOfflineMode);
        var dir = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path, JsonSerializer.Serialize(cache, new JsonSerializerOptions { WriteIndented = true }));
    }

    public static OfflineSessionCache? Load()
    {
        try
        {
            if (!File.Exists(Path)) return null;
            var cache = JsonSerializer.Deserialize<OfflineSessionCache>(File.ReadAllText(Path), Json);
            if (cache is null) return null;
            if (DateTime.UtcNow - cache.SavedAtUtc > MaxAge) return null;
            return cache;
        }
        catch
        {
            return null;
        }
    }

    public static bool VerifyPin(OfflineSessionCache cache, string pin) =>
        CreatePinVerifier(pin) == cache.PinVerifier;

    public static bool CanLoginOffline(OfflineSessionCache cache, LocalCatalogStore catalog)
    {
        if (DateTime.UtcNow - cache.SavedAtUtc > MaxAge) return false;
        var offlineAllowed = cache.AllowOfflineMode || cache.Session.Permissions?.OfflineLogin == true;
        if (!offlineAllowed) return false;
        return catalog.ProductCount > 0 || catalog.PendingReceiptCount > 0;
    }
}
