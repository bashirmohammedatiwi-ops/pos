using System.IO;
using System.Text.Json;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public sealed class LocalPrintConfig
{
    public string? PrinterName { get; set; }
    public bool AskBeforePrint { get; set; }

    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FOT.Pos", "print-config.json");

    public static LocalPrintConfig Load()
    {
        try
        {
            if (!File.Exists(Path)) return new LocalPrintConfig();
            var json = File.ReadAllText(Path);
            return JsonSerializer.Deserialize<LocalPrintConfig>(json) ?? new LocalPrintConfig();
        }
        catch { return new LocalPrintConfig(); }
    }

    public void Save()
    {
        var dir = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public static class PrintSettingsCache
{
    private static PrintSettingsDto? _settings;
    private static DateTime _loadedAt;

    public static async Task<PrintSettingsDto> GetAsync()
    {
        if (_settings is not null && DateTime.UtcNow - _loadedAt < TimeSpan.FromMinutes(5))
            return _settings;

        if (await AppServices.Api.IsOnlineAsync())
        {
            var fromApi = await AppServices.Api.GetPrintSettingsAsync();
            if (fromApi is not null)
            {
                AppServices.Catalog.SavePrintSettings(fromApi);
                _settings = fromApi;
                _loadedAt = DateTime.UtcNow;
                return _settings;
            }
        }

        _settings = AppServices.Catalog.LoadPrintSettings() ?? PrintSettingsDto.Default;
        _loadedAt = DateTime.UtcNow;
        return _settings;
    }

    public static void Invalidate() => _settings = null;
}
