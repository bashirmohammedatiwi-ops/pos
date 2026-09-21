using System.IO;
using System.Text.Json;

namespace FOT.Pos.Shared;

/// <summary>
/// Saved API server address for remote Admin and POS Client (persists across app restarts).
/// </summary>
public sealed class ServerConnectionSettings
{
    public string? ServerUrl { get; set; }

    private static string FilePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FOT.Pos",
            "server-connection.json");

    public static ServerConnectionSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath);
                return JsonSerializer.Deserialize<ServerConnectionSettings>(json) ?? new ServerConnectionSettings();
            }

            // migrate legacy admin-remote.json
            var legacy = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FOT.Pos",
                "admin-remote.json");
            if (File.Exists(legacy))
            {
                var legacyJson = File.ReadAllText(legacy);
                using var doc = JsonDocument.Parse(legacyJson);
                if (doc.RootElement.TryGetProperty("ServerUrl", out var urlEl))
                {
                    var migrated = new ServerConnectionSettings { ServerUrl = urlEl.GetString() };
                    migrated.Save();
                    return migrated;
                }
            }
        }
        catch
        {
            // ignore
        }

        return new ServerConnectionSettings();
    }

    public void Save()
    {
        var dir = Path.GetDirectoryName(FilePath)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Accepts full URL, IP, or host — always returns http://host:port without trailing slash.</summary>
    public static string NormalizeApiUrl(string input, int defaultPort = 5000)
    {
        input = input.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(input))
            return $"http://127.0.0.1:{defaultPort}";

        if (!input.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !input.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            input = $"http://{input}";

        if (!Uri.TryCreate(input, UriKind.Absolute, out var uri))
            return $"http://{input}:{defaultPort}";

        if (uri.Port is -1 or 80 or 443)
        {
            var builder = new UriBuilder(uri) { Port = defaultPort };
            return builder.Uri.ToString().TrimEnd('/');
        }

        return input;
    }
}
