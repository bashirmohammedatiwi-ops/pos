using System.IO;
using System.Text.Json;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public static class LastReceiptStore
{
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FOT.Pos", "last-receipt.json");

    public static void Save(ReceiptPrintPreviewDto data)
    {
        var dir = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path, JsonSerializer.Serialize(data));
    }

    public static ReceiptPrintPreviewDto? Load()
    {
        try
        {
            if (!File.Exists(Path)) return null;
            return JsonSerializer.Deserialize<ReceiptPrintPreviewDto>(File.ReadAllText(Path));
        }
        catch { return null; }
    }
}
