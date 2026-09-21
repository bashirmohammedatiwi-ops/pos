using System.Text.RegularExpressions;
using Dapper;

namespace FOT.Pos.Infrastructure.Data;

public sealed class SchemaVersionInfo
{
    public int? Version { get; init; }
    public string? Name { get; init; }
    public DateTime? AppliedAt { get; init; }
    public bool TableExists { get; init; }
    public int BundledLatest { get; init; }
    public int PendingCount { get; init; }
}

internal sealed class MigrationRow
{
    public int version { get; set; }
    public string name { get; set; } = "";
    public DateTime applied_at { get; set; }
}

public sealed class SchemaVersionService(ISqlConnectionFactory db)
{
    public const int LatestBundledVersion = 38;

    public static int ResolveBundledVersion(string? contentRoot)
    {
        try
        {
            var dir = Path.GetFullPath(Path.Combine(contentRoot ?? "", "..", "..", "database", "migrations"));
            if (!Directory.Exists(dir)) return LatestBundledVersion;
            var max = Directory.GetFiles(dir, "*.sql")
                .Select(Path.GetFileName)
                .Select(name => Regex.Match(name ?? "", @"^(\d+)_"))
                .Where(m => m.Success)
                .Select(m => int.Parse(m.Groups[1].Value))
                .DefaultIfEmpty(LatestBundledVersion)
                .Max();
            return Math.Max(max, LatestBundledVersion);
        }
        catch
        {
            return LatestBundledVersion;
        }
    }

    public async Task<SchemaVersionInfo> GetAsync(int bundledLatest = LatestBundledVersion, CancellationToken ct = default)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var exists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM sys.tables WHERE name = 'schema_migrations'
                ) THEN 1 ELSE 0 END
                """,
                cancellationToken: ct));
            if (exists == 0)
            {
                return new SchemaVersionInfo
                {
                    TableExists = false,
                    BundledLatest = bundledLatest,
                    PendingCount = bundledLatest + 1
                };
            }

            var row = await conn.QueryFirstOrDefaultAsync<MigrationRow>(new CommandDefinition(
                """
                SELECT TOP 1 version, name, applied_at
                FROM schema_migrations
                ORDER BY version DESC
                """,
                cancellationToken: ct));
            if (row is null)
            {
                return new SchemaVersionInfo
                {
                    TableExists = true,
                    BundledLatest = bundledLatest,
                    PendingCount = bundledLatest + 1
                };
            }

            return new SchemaVersionInfo
            {
                TableExists = true,
                Version = row.version,
                Name = row.name,
                AppliedAt = row.applied_at,
                BundledLatest = bundledLatest,
                PendingCount = Math.Max(0, bundledLatest - row.version)
            };
        }
        catch
        {
            return new SchemaVersionInfo
            {
                TableExists = false,
                BundledLatest = bundledLatest,
                PendingCount = bundledLatest + 1
            };
        }
    }
}
