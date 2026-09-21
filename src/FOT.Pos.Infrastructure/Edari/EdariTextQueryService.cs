using System.Net.Http;
using System.Text;
using System.Text.Json;
using FOT.Pos.Infrastructure.Services;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Reads Edari text through the nxServer admin query script instead of the ADO provider.
///
/// NexusDB stores Arabic as UTF-8 bytes inside its string fields. The ADO provider decodes
/// them with a single-byte codepage and replaces every Arabic byte with U+FFFD, so the text
/// is destroyed before it reaches us (CAST to BLOB and IDataReader.GetBytes are both
/// unsupported on that provider). The nxServer HTTP endpoint copies the stored bytes into the
/// response untouched, so decoding the raw response as UTF-8 gives the original Arabic.
/// </summary>
public sealed class EdariTextQueryService(
    EdariSettingsService settings,
    IHttpClientFactory httpFactory,
    ILogger<EdariTextQueryService> logger)
{
    private const int FallbackAdminPort = 10088;
    private const string ScriptName = "edari-query.nxscript";
    private static readonly string[] AdminPortFileRoots =
    [
        @"C:\ProgramData\NexusDB4\nxServer",
        @"D:\ProgramData\NexusDB4\nxServer",
    ];

    /// <summary>Shared across scopes so the port probe happens once, not per request.</summary>
    private static volatile int _cachedPort;

    /// <summary>True when the Arabic-safe channel answered the most recent call.</summary>
    public bool LastCallSucceeded { get; private set; }

    /// <summary>
    /// Runs a SELECT and returns the rows as strings. Returns an empty list on any failure —
    /// callers must keep working from the ADO path when the admin channel is unavailable.
    /// </summary>
    public async Task<IReadOnlyList<string?[]>> QueryAsync(string sql, CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        var ports = CandidatePorts();

        foreach (var port in ports)
        {
            try
            {
                var rows = await QueryPortAsync(port, opts.DatabaseAlias, sql, ct);
                if (rows is null) continue;
                _cachedPort = port;
                LastCallSucceeded = true;
                return rows;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "Edari text query failed on port {Port}", port);
            }
        }

        LastCallSucceeded = false;
        return [];
    }

    private async Task<List<string?[]>?> QueryPortAsync(int port, string alias, string sql, CancellationToken ct)
    {
        // sqlhex keeps Arabic literals and quoting intact through the URL.
        var hex = Convert.ToHexString(Encoding.UTF8.GetBytes(sql));
        var url = $"http://127.0.0.1:{port}/{ScriptName}"
            + $"?alias={Uri.EscapeDataString(alias)}&sqlhex={hex}";

        var http = httpFactory.CreateClient("edari-text");
        http.Timeout = TimeSpan.FromSeconds(30);
        using var res = await http.GetAsync(url, ct);
        if (!res.IsSuccessStatusCode) return null;

        var bytes = await res.Content.ReadAsByteArrayAsync(ct);
        if (bytes.Length == 0) return null;

        var json = Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF').Trim();
        if (!json.StartsWith('{')) return null;

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("ok", out var ok) || !ok.GetBoolean())
        {
            var error = doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() : null;
            logger.LogDebug("Edari text query rejected: {Error}", error);
            return null;
        }

        if (!doc.RootElement.TryGetProperty("rows", out var rowsEl) || rowsEl.ValueKind != JsonValueKind.Array)
            return [];

        var rows = new List<string?[]>();
        foreach (var row in rowsEl.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Array) continue;
            var cells = new List<string?>();
            foreach (var cell in row.EnumerateArray())
                cells.Add(cell.ValueKind == JsonValueKind.Null ? null : cell.GetString());
            rows.Add([.. cells]);
        }
        return rows;
    }

    private static IEnumerable<int> CandidatePorts()
    {
        var seen = new HashSet<int>();
        var known = _cachedPort;
        if (known > 0 && seen.Add(known))
            yield return known;

        foreach (var port in ReadConfiguredPorts())
            if (seen.Add(port)) yield return port;

        if (seen.Add(FallbackAdminPort))
            yield return FallbackAdminPort;
    }

    /// <summary>nxServer writes its live admin port next to each hosted data folder.</summary>
    private static IEnumerable<int> ReadConfiguredPorts()
    {
        var ports = new List<int>();
        foreach (var root in AdminPortFileRoots)
        {
            try
            {
                if (!Directory.Exists(root)) continue;
                foreach (var file in Directory.EnumerateFiles(root, "nxServer.remoteadmin", SearchOption.AllDirectories))
                {
                    foreach (var line in File.ReadLines(file))
                    {
                        const string key = "CurrentAdminPort=";
                        if (!line.StartsWith(key, StringComparison.OrdinalIgnoreCase)) continue;
                        if (int.TryParse(line[key.Length..].Trim(), out var port) && port is > 0 and < 65536)
                            ports.Add(port);
                    }
                }
            }
            catch
            {
                /* unreadable ProgramData — fall back to the default port */
            }
        }
        return ports.Distinct();
    }
}
