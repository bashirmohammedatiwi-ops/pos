using System.Data.Common;
using System.Reflection;
using System.Runtime.InteropServices;

namespace FOT.Pos.Infrastructure.Edari;

public static class NexusDbAdoBootstrap
{
    public const string ProviderInvariant = "NexusDB.ADOProvider";
    private static readonly object Gate = new();
    private static bool _registered;
    private static string? _lastError;

    public static string? LastError => _lastError;

    public static bool TryEnsureRegistered(EdariOptions opts, out string? error)
    {
        lock (Gate)
        {
            if (_registered)
            {
                error = null;
                return true;
            }

            try
            {
                var providerPath = ResolveProviderPath(opts);
                if (providerPath is null)
                {
                    error = _lastError ?? "تعذر العثور على NexusDB.ADOProvider.dll";
                    return false;
                }

                var nativeDir = Path.GetDirectoryName(providerPath)!;
                providerPath = EnsureProviderInAppDirectory(providerPath);
                EnsureConnectorBinaries(opts, nativeDir);
                RegisterProvider(providerPath);
                _registered = true;
                error = null;
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                _lastError = error;
                return false;
            }
        }
    }

    public static DbConnection CreateConnection(EdariOptions opts)
    {
        if (!TryEnsureRegistered(opts, out var error))
            throw new InvalidOperationException(error);

        var appBase = AppContext.BaseDirectory;
        Environment.CurrentDirectory = appBase;
        AddDllSearchDirectory(Path.Combine(appBase, "Edari", "Native"));

        var factory = DbProviderFactories.GetFactory(ProviderInvariant);
        var conn = factory.CreateConnection()
            ?? throw new InvalidOperationException("NexusDB ADO provider returned null connection.");
        conn.ConnectionString = opts.BuildAdoConnectionString();
        return conn;
    }

    public static bool ProviderAvailable(EdariOptions opts) =>
        ResolveProviderPath(opts) is not null;

    private static void RegisterProvider(string providerPath)
    {
        var asm = Assembly.LoadFrom(providerPath);
        var factoryType = asm.GetType("NexusDB.ADOProvider.NexusDBProviderFactory")
            ?? throw new InvalidOperationException("NexusDBProviderFactory not found in ADO provider assembly.");

        DbProviderFactories.RegisterFactory(ProviderInvariant, factoryType);
    }

    private static string? ResolveProviderPath(EdariOptions opts)
    {
        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(opts.AdoProviderPath))
            candidates.Add(opts.AdoProviderPath.Trim());

        var appBase = AppContext.BaseDirectory;
        candidates.Add(Path.Combine(appBase, "Edari", "Native", "NexusDB.ADOProvider.dll"));
        candidates.Add(Path.Combine(appBase, "Native", "NexusDB.ADOProvider.dll"));
        candidates.Add(Path.Combine(appBase, "NexusDB.ADOProvider.dll"));

        foreach (var path in DefaultProviderPaths(opts))
            candidates.Add(path);

        foreach (var path in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (File.Exists(path))
                return Path.GetFullPath(path);
        }

        _lastError = "لم يُعثر على NexusDB.ADOProvider.dll — ثبّت موفر ADO من EdariNX/FOT POS أو حدّد المسار في الإعدادات.";
        return null;
    }

    private static IEnumerable<string> DefaultProviderPaths(EdariOptions opts)
    {
        yield return @"D:\FOT POS\Dashboard\OLD VERIONS\NexusDB.ADOProvider.dll";
        yield return @"D:\FOT POS\Dashboard\Services\FOTPOSService\NexusDB.ADOProvider.dll";
        yield return @"D:\FOTLabel\FOTLabel\NexusDB.ADOProvider.dll";

        foreach (var dir in EdariNativeSearchDirectories(opts))
        {
            yield return Path.Combine(dir, "NexusDB.ADOProvider.dll");
        }
    }

    private static void EnsureConnectorBinaries(EdariOptions opts, string providerDirectory)
    {
        var targetDir = AppContext.BaseDirectory;
        var connectorDirs = new List<string> { providerDirectory };
        if (!string.IsNullOrWhiteSpace(opts.AdoConnectorDirectory))
            connectorDirs.Add(opts.AdoConnectorDirectory.Trim());
        connectorDirs.Add(Path.Combine(targetDir, "Edari", "Native"));
        connectorDirs.Add(targetDir);
        foreach (var dir in DefaultConnectorDirectories(opts))
            connectorDirs.Add(dir);

        var connectorNames = RuntimeInformation.ProcessArchitecture switch
        {
            Architecture.X64 => new[] { "AdoServerConnectorV4_64.dll", "ADOServerConnectorV4_64.dll" },
            _ => new[] { "AdoServerConnectorV4.dll", "ADOServerConnectorV4.dll" }
        };

        if (ConnectorPresentInDirectory(targetDir, connectorNames))
            return;

        string? sourceFile = null;
        foreach (var name in connectorNames)
        {
            foreach (var dir in connectorDirs.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir))
                    continue;

                var source = Path.Combine(dir, name);
                if (!File.Exists(source))
                    continue;

                sourceFile = source;
                break;
            }

            if (sourceFile is not null)
                break;
        }

        if (sourceFile is null)
        {
            throw new FileNotFoundException(
                "AdoServerConnectorV4 DLL not found — copy ADOServerConnectorV4_64.dll next to the API executable.");
        }

        var destinations = new[] { targetDir, providerDirectory, Path.Combine(targetDir, "Edari", "Native") }
            .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var dir in destinations)
        {
            if (string.IsNullOrWhiteSpace(dir))
                continue;

            Directory.CreateDirectory(dir);
            foreach (var name in connectorNames)
                CopyIfMissing(sourceFile, Path.Combine(dir, name));
        }
    }

    private static bool ConnectorPresentInDirectory(string directory, IReadOnlyList<string> connectorNames)
    {
        foreach (var name in connectorNames)
        {
            if (File.Exists(Path.Combine(directory, name)))
                return true;
        }

        return false;
    }

    private static void CopyIfMissing(string sourceFile, string destinationPath)
    {
        if (File.Exists(destinationPath))
            return;

        File.Copy(sourceFile, destinationPath, overwrite: false);
    }

    private static string EnsureProviderInAppDirectory(string providerPath)
    {
        var targetDir = AppContext.BaseDirectory;
        var targetPath = Path.Combine(targetDir, "NexusDB.ADOProvider.dll");
        var fullProviderPath = Path.GetFullPath(providerPath);

        if (!string.Equals(fullProviderPath, Path.GetFullPath(targetPath), StringComparison.OrdinalIgnoreCase))
            CopyIfMissing(fullProviderPath, targetPath);

        return targetPath;
    }

    private static IEnumerable<string> DefaultConnectorDirectories(EdariOptions opts)
    {
        yield return @"D:\FOTLabel\FOTLabel";
        yield return @"D:\FOT POS\Dashboard\Services\FOTPOSService";
        yield return @"D:\FOT POS\Dashboard";
        yield return @"D:\All Tools";

        foreach (var dir in EdariNativeSearchDirectories(opts))
            yield return dir;
    }

    private static IEnumerable<string> EdariNativeSearchDirectories(EdariOptions opts)
    {
        var appBase = AppContext.BaseDirectory;
        yield return Path.Combine(appBase, "Edari", "Native");

        if (!string.IsNullOrWhiteSpace(opts.DataRoot))
        {
            var dataRoot = opts.DataRoot.Trim();
            var edariRoot = Directory.GetParent(dataRoot)?.FullName;
            if (!string.IsNullOrWhiteSpace(edariRoot))
            {
                yield return Path.Combine(edariRoot, "Win_Net");
                yield return Path.Combine(edariRoot, "WinNet");
                yield return edariRoot;
            }
        }

        yield return @"D:\Future of Technology\EdariNX\Win_Net";
        yield return @"D:\Future of Technology\EdariNX";
    }

    private static void AddDllSearchDirectory(string directory)
    {
        if (!Directory.Exists(directory))
            return;

        if (OperatingSystem.IsWindows())
            SetDllDirectory(directory);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectory(string lpPathName);
}
