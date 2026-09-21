using System.Reflection;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Data;

/// <summary>
/// Applies bundled SQL migrations on API startup so schema stays in sync with the app version.
/// </summary>
public sealed class SchemaMigrationRunner(ISqlConnectionFactory db, ILogger<SchemaMigrationRunner> logger)
{
    private static readonly Regex GoSplit = new(@"(?im)^\s*GO\s*$", RegexOptions.Compiled);
    private static readonly Regex VersionMatch = new(@"^(\d+)_", RegexOptions.Compiled);

    public async Task<int> ApplyPendingAsync(CancellationToken ct = default)
    {
        var files = LoadMigrationFiles();
        if (files.Count == 0)
        {
            logger.LogWarning("No bundled migration files found");
            return 0;
        }

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        await ExecuteBatchesAsync(conn, files.First(f => f.Version == 0).Sql, ct);

        var applied = (await conn.QueryAsync<(int Version, string Name)>(new CommandDefinition(
            "SELECT version AS Version, name AS Name FROM schema_migrations",
            cancellationToken: ct))).ToDictionary(x => x.Version, x => x.Name);

        if (!applied.ContainsKey(0))
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO schema_migrations (version, name) VALUES (0, @name)",
                new { name = "000_schema_migrations.sql" },
                cancellationToken: ct));
            applied[0] = "000_schema_migrations.sql";
        }

        var ran = 0;
        foreach (var file in files.Where(f => f.Version > 0))
        {
            if (applied.ContainsKey(file.Version))
                continue;

            logger.LogInformation("Applying migration {Name}", file.Name);
            await ExecuteBatchesAsync(conn, file.Sql, ct);
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO schema_migrations (version, name) VALUES (@version, @name)",
                new { version = file.Version, name = file.Name },
                cancellationToken: ct));
            ran++;
        }

        if (ran > 0)
            logger.LogInformation("Applied {Count} database migration(s)", ran);

        return ran;
    }

    private static async Task ExecuteBatchesAsync(System.Data.Common.DbConnection conn, string sql, CancellationToken ct)
    {
        foreach (var batch in GoSplit.Split(sql))
        {
            var text = batch.Trim();
            if (text.Length == 0) continue;
            await conn.ExecuteAsync(new CommandDefinition(text, cancellationToken: ct));
        }
    }

    private static IReadOnlyList<MigrationFile> LoadMigrationFiles()
    {
        var assembly = typeof(SchemaMigrationRunner).Assembly;
        var prefix = "FOT.Pos.Infrastructure.Migrations.";
        var list = new List<MigrationFile>();

        foreach (var name in assembly.GetManifestResourceNames())
        {
            if (!name.StartsWith(prefix, StringComparison.Ordinal) || !name.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
                continue;

            var fileName = name[prefix.Length..];
            var match = VersionMatch.Match(fileName);
            if (!match.Success) continue;

            using var stream = assembly.GetManifestResourceStream(name);
            if (stream is null) continue;
            using var reader = new StreamReader(stream);
            list.Add(new MigrationFile(
                int.Parse(match.Groups[1].Value),
                fileName,
                reader.ReadToEnd()));
        }

        return list.OrderBy(f => f.Version).ToList();
    }

    private sealed record MigrationFile(int Version, string Name, string Sql);
}
