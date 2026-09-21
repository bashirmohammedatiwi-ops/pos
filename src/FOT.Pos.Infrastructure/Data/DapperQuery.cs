using System.Data;
using Dapper;

namespace FOT.Pos.Infrastructure.Data;

/// <summary>
/// Dapper helpers that require a parameterless constructor.
/// Positional records without one fail to compile here instead of returning HTTP 500 at runtime
/// when SQL column types/order do not match the record constructor.
/// </summary>
public static class DapperQuery
{
    public static async Task<List<T>> QueryRowsAsync<T>(this IDbConnection conn, CommandDefinition cmd)
        where T : class, new()
        => [.. await conn.QueryAsync<T>(cmd)];

    public static Task<T?> QueryRowOrDefaultAsync<T>(this IDbConnection conn, CommandDefinition cmd)
        where T : class, new()
        => conn.QuerySingleOrDefaultAsync<T>(cmd);

    public static Task<T> QueryRowAsync<T>(this IDbConnection conn, CommandDefinition cmd)
        where T : class, new()
        => conn.QuerySingleAsync<T>(cmd);
}
