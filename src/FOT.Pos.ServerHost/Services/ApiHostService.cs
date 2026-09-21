using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace FOT.Pos.ServerHost.Services;

internal sealed class ApiHostService(int port) : IDisposable
{
    private Process? _process;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(3) };

    public int Port { get; } = port;
    public string LocalUrl => $"http://localhost:{Port}";
    public bool UsesWindowsService { get; private set; }
    public bool OwnsProcess => _process is { HasExited: false };

    public async Task StartAsync(CancellationToken ct)
    {
        if (await IsHealthyAsync())
        {
            UsesWindowsService = WindowsServiceHelper.IsInstalled && WindowsServiceHelper.IsRunning;
            return;
        }

        if (WindowsServiceHelper.IsInstalled)
        {
            WindowsServiceHelper.Start();
            await WaitForHealthyAsync(TimeSpan.FromSeconds(45), ct, ownedProcess: false);
            UsesWindowsService = true;
            return;
        }

        if (OwnsProcess) return;

        var apiExe = ResolveApiExe();
        if (apiExe is null)
            throw new FileNotFoundException("تعذر العثور على FOT.Pos.Api.exe — نفّذ Install-WindowsService.ps1");

        var psi = new ProcessStartInfo
        {
            FileName = apiExe,
            WorkingDirectory = Path.GetDirectoryName(apiExe)!,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        _process = Process.Start(psi)
            ?? throw new InvalidOperationException("تعذر تشغيل خادم API");

        await WaitForHealthyAsync(TimeSpan.FromSeconds(45), ct, ownedProcess: true);
        UsesWindowsService = false;
    }

    public void Stop()
    {
        if (UsesWindowsService || _process is null) return;
        try
        {
            if (!_process.HasExited)
                _process.Kill(entireProcessTree: true);
        }
        catch { /* ignore */ }
        finally
        {
            _process.Dispose();
            _process = null;
        }
    }

    public async Task RestartAsync(CancellationToken ct)
    {
        if (WindowsServiceHelper.IsInstalled)
        {
            await Task.Run(WindowsServiceHelper.Restart, ct);
            UsesWindowsService = true;
            await WaitForHealthyAsync(TimeSpan.FromSeconds(45), ct, ownedProcess: false);
            return;
        }

        Stop();
        await Task.Delay(800, ct);
        await StartAsync(ct);
    }

    public async Task<bool> IsHealthyAsync()
    {
        try
        {
            var res = await _http.GetAsync($"{LocalUrl}/health");
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private async Task WaitForHealthyAsync(TimeSpan timeout, CancellationToken ct, bool ownedProcess)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (ownedProcess && _process?.HasExited == true)
                throw new InvalidOperationException(BuildApiCrashMessage());
            if (await IsHealthyAsync()) return;
            await Task.Delay(500, ct);
        }
        throw new TimeoutException("انتهت مهلة انتظار تشغيل API");
    }

    private static string BuildApiCrashMessage()
    {
        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "FOT.Pos", "logs");
        var latest = Directory.Exists(logDir)
            ? Directory.GetFiles(logDir, "api-*.log").OrderByDescending(f => f).FirstOrDefault()
            : null;
        return latest is null
            ? "توقف خادم API أثناء التشغيل — راجع سجل الأحداث في ProgramData\\FOT.Pos\\logs"
            : $"توقف خادم API أثناء التشغيل — راجع السجل:\n{latest}";
    }

    private static string? ResolveApiExe()
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "Api", "FOT.Pos.Api.exe"),
            Path.Combine(baseDir, "FOT.Pos.Api.exe"),
            Path.GetFullPath(Path.Combine(baseDir, "..", "FOT.Pos.Api", "bin", "Release", "net9.0", "win-x64", "FOT.Pos.Api.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "FOT.Pos.Api", "bin", "Debug", "net9.0", "FOT.Pos.Api.exe")),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    public void Dispose()
    {
        Stop();
        _http.Dispose();
    }
}
