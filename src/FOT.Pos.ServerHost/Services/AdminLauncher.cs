using System.Diagnostics;
using System.IO;

namespace FOT.Pos.ServerHost.Services;

internal static class AdminLauncher
{
    public static void Open(string adminExeName) =>
        Start("Admin", adminExeName, "تعذر العثور على تطبيق الإدارة (FOT.Pos.Admin.exe)");

    public static void OpenClient(string clientExeName) =>
        Start("Client", clientExeName, "تعذر العثور على نقطة البيع (FOT.Pos.Client.exe)");

    private static void Start(string subFolder, string exeName, string missingMessage)
    {
        var exe = Resolve(subFolder, exeName);
        if (exe is null)
        {
            System.Windows.MessageBox.Show(
                missingMessage,
                "FOT POS Server",
                System.Windows.MessageBoxButton.OK,
                System.Windows.MessageBoxImage.Warning);
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(exe)!,
        });
    }

    private static string? Resolve(string subFolder, string exeName)
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, subFolder, exeName),
            Path.Combine(baseDir, exeName),
            Path.GetFullPath(Path.Combine(baseDir, "..", $"FOT.Pos.{subFolder}", "bin", "Debug", "net9.0-windows", exeName)),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", $"FOT.Pos.{subFolder}", "bin", "Debug", "net9.0-windows", exeName)),
        };
        return candidates.FirstOrDefault(File.Exists);
    }
}
