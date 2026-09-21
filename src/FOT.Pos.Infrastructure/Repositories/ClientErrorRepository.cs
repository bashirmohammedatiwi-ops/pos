using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// Stores client-side errors (admin dashboard + POS terminals) for field diagnostics.
/// Writes go through a bounded channel so a broken client can never slow a request.
/// </summary>
public sealed class ClientErrorRepository(ISqlConnectionFactory db)
{
    private static readonly System.Threading.Channels.Channel<ClientErrorInsert> Queue =
        System.Threading.Channels.Channel.CreateBounded<ClientErrorInsert>(
            new System.Threading.Channels.BoundedChannelOptions(500)
            {
                FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest,
                SingleReader = false,
            });

    public bool Enqueue(ClientErrorReportDto report, string source) =>
        Queue.Writer.TryWrite(new ClientErrorInsert(
            source,
            Truncate(report.Terminal, 100),
            Truncate(report.Message, 2000) ?? "(بدون رسالة)",
            Truncate(report.Stack, 16_000),
            Truncate(report.Context, 4_000),
            Truncate(report.AppVersion, 50)));

    /// <summary>Drains the queue into SQL; called by the telemetry background worker.</summary>
    public async Task<int> FlushAsync(CancellationToken ct)
    {
        var batch = new List<ClientErrorInsert>(32);
        while (batch.Count < 32 && Queue.Reader.TryRead(out var item))
            batch.Add(item);
        if (batch.Count == 0) return 0;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ext_client_errors (source, terminal, message, stack, context, app_version)
            VALUES (@Source, @Terminal, @Message, @Stack, @Context, @AppVersion)
            """, batch, cancellationToken: ct));
        return batch.Count;
    }

    public async Task<IReadOnlyList<ClientErrorDto>> RecentAsync(int limit, string? source, CancellationToken ct)
    {
        var sql = """
            SELECT TOP (@limit) id AS Id, source AS Source, terminal AS Terminal,
                   message AS Message, stack AS Stack, context AS Context,
                   app_version AS AppVersion, created_at AS CreatedAt
            FROM ext_client_errors
            WHERE (@source IS NULL OR source = @source)
            ORDER BY id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<ClientErrorDto>(
            new CommandDefinition(sql, new { limit, source }, cancellationToken: ct))).ToList();
    }

    public async Task<int> PurgeOlderThanAsync(int days, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_client_errors WHERE created_at < DATEADD(DAY, -@days, GETDATE())",
            new { days }, cancellationToken: ct));
    }

    private static string? Truncate(string? value, int max) =>
        value is null ? null : (value.Length > max ? value[..max] : value);

    private sealed record ClientErrorInsert(
        string Source, string? Terminal, string Message, string? Stack, string? Context, string? AppVersion);
}
