using Dapper;
using FOT.Pos.Infrastructure.Edari;

namespace FOT.Pos.Infrastructure.Repositories;

internal static class SalesmanQueries
{
    private static volatile int _schemaFlags = -1;
    private const int FlagSortNum = 1;
    private const int FlagIsEdari = 2;
    private const int FlagEdariRegistry = 4;

    /// <summary>
    /// Salesmen with a non-empty name who sold, earned commission, have a profile, or are assigned to groups/rules.
    /// </summary>
    internal const string ActiveWhere = """
        sm.name IS NOT NULL
        AND LTRIM(RTRIM(sm.name)) <> N''
        AND (
            EXISTS (
                SELECT 1 FROM reciepts r
                WHERE r.salesman = sm.id
                  AND r.creation_date >= DATEADD(day, -365, GETDATE())
            )
            OR EXISTS (
                SELECT 1 FROM reciept_items ri
                INNER JOIN reciepts r ON r.id = ri.reciept_id
                WHERE ri.salesman_id = sm.id
                  AND r.creation_date >= DATEADD(day, -365, GETDATE())
            )
            OR EXISTS (
                SELECT 1 FROM ext_commission_calculations c WHERE c.salesman_id = sm.id
            )
            OR EXISTS (
                SELECT 1 FROM ext_salesman_commission_profiles p WHERE p.salesman_id = sm.id
            )
            OR EXISTS (
                SELECT 1 FROM ext_commission_group_salesmen gs WHERE gs.salesman_id = sm.id
            )
            OR EXISTS (
                SELECT 1 FROM ext_commission_rules ru
                WHERE ru.salesman_id = sm.id AND ru.is_active = 1
            )
        )
        """;

    internal const string NonEmptyNameWhere = """
        sm.name IS NOT NULL
        AND LTRIM(RTRIM(sm.name)) <> N''
        """;

    internal const string EdariRegistryWhere = """
        EXISTS (SELECT 1 FROM ext_edari_salesmen e WHERE e.salesman_id = sm.id)
        """;

    /// <summary>Fallback when registry not yet populated — Edari admin seller ids 1..250.</summary>
    internal const string EdariIdRangeWhere = """
        sm.id BETWEEN 1 AND 250
        """;

    internal const string EdariOnlyWhere = """
        sm.is_edari = 1
        AND sm.name IS NOT NULL
        AND LTRIM(RTRIM(sm.name)) <> N''
        """;

    internal static void ResetSchemaCache() => _schemaFlags = -1;

    internal static async Task<bool> HasSortNumAsync(System.Data.Common.DbConnection conn, CancellationToken ct) =>
        (await LoadSchemaFlagsAsync(conn, ct) & FlagSortNum) != 0;

    internal static async Task<bool> HasIsEdariAsync(System.Data.Common.DbConnection conn, CancellationToken ct) =>
        (await LoadSchemaFlagsAsync(conn, ct) & FlagIsEdari) != 0;

    internal static async Task<bool> HasEdariRegistryAsync(System.Data.Common.DbConnection conn, CancellationToken ct) =>
        (await LoadSchemaFlagsAsync(conn, ct) & FlagEdariRegistry) != 0;

    internal static async Task<int> EdariRegistryCountAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (!await HasEdariRegistryAsync(conn, ct))
            return 0;
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_edari_salesmen",
            cancellationToken: ct));
    }

    private static async Task<int> LoadSchemaFlagsAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        var cached = _schemaFlags;
        if (cached >= 0) return cached;

        var sortLen = await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
            "SELECT COL_LENGTH(OBJECT_ID(N'dbo.salesmen'), N'sort_num')",
            cancellationToken: ct));
        var edariLen = await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
            "SELECT COL_LENGTH(OBJECT_ID(N'dbo.salesmen'), N'is_edari')",
            cancellationToken: ct));
        var registry = await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
            "SELECT CASE WHEN OBJECT_ID(N'dbo.ext_edari_salesmen', N'U') IS NOT NULL THEN 1 ELSE 0 END",
            cancellationToken: ct));

        var flags = 0;
        if (sortLen is > 0) flags |= FlagSortNum;
        if (edariLen is > 0) flags |= FlagIsEdari;
        if (registry is > 0) flags |= FlagEdariRegistry;
        _schemaFlags = flags;
        return flags;
    }

    internal static async Task<string> OrderByAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (await HasEdariRegistryAsync(conn, ct) && await EdariRegistryCountAsync(conn, ct) > 0)
            return "(SELECT e.sort_num FROM ext_edari_salesmen e WHERE e.salesman_id = sm.id), sm.id";

        var flags = await LoadSchemaFlagsAsync(conn, ct);
        if ((flags & FlagSortNum) != 0)
            return "sm.sort_num, sm.id";
        return "sm.id";
    }

    internal static async Task<string> GroupBySortNumAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (await HasEdariRegistryAsync(conn, ct) && await EdariRegistryCountAsync(conn, ct) > 0)
            return ", (SELECT e.sort_num FROM ext_edari_salesmen e WHERE e.salesman_id = sm.id)";

        return (await LoadSchemaFlagsAsync(conn, ct) & FlagSortNum) != 0 ? ", sm.sort_num" : "";
    }

    /// <summary>Best available filter for Edari admin sellers.</summary>
    internal static async Task<string> EdariFilterWhereAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (await HasEdariRegistryAsync(conn, ct) && await EdariRegistryCountAsync(conn, ct) > 0)
            return EdariRegistryWhere;

        if (await HasIsEdariAsync(conn, ct))
            return EdariOnlyWhere;

        if (await HasSortNumAsync(conn, ct))
            return """
                sm.sort_num IS NOT NULL
                AND sm.name IS NOT NULL
                AND LTRIM(RTRIM(sm.name)) <> N''
                """;

        return EdariIdRangeWhere;
    }

    internal static async Task<bool> IsEdariRegistryValidAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (!await HasEdariRegistryAsync(conn, ct))
            return false;

        var count = await EdariRegistryCountAsync(conn, ct);
        var expected = EdariSalesmenConstants.MaxId - EdariSalesmenConstants.MinId + 1;
        if (count != expected)
            return false;

        var outOfRange = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(*)
            FROM ext_edari_salesmen
            WHERE salesman_id < @minId OR salesman_id > @maxId
            """, new
        {
            minId = EdariSalesmenConstants.MinId,
            maxId = EdariSalesmenConstants.MaxId,
        }, cancellationToken: ct));

        return outOfRange == 0;
    }
}
