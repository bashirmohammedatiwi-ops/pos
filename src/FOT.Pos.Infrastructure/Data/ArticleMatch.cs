using System.Data;
using Dapper;

namespace FOT.Pos.Infrastructure.Data;

/// <summary>
/// Bridges Edari Seq (groups, commission lines) to receipt <c>articles.id</c>.
/// Seq and id overlap across different products — never treat every Seq as a receipt id.
/// </summary>
internal static class ArticleMatch
{
    public static async Task FillIdTableAsync(
        IDbConnection conn, string table, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition(
            $"CREATE TABLE {table} (id BIGINT NOT NULL PRIMARY KEY);", cancellationToken: ct));
        var distinct = ids.Where(x => x > 0).Distinct().ToList();
        foreach (var batch in distinct.Chunk(400))
        {
            await conn.ExecuteAsync(new CommandDefinition(
                $"INSERT INTO {table} (id) VALUES (@id)",
                batch.Select(id => new { id }),
                cancellationToken: ct));
        }
    }

    public static async Task DropTableAsync(IDbConnection conn, string table, CancellationToken ct) =>
        await conn.ExecuteAsync(new CommandDefinition(
            $"IF OBJECT_ID('tempdb..{table}') IS NOT NULL DROP TABLE {table};", cancellationToken: ct));

    public static async Task<HashSet<long>> ExpandReceiptMatchIdsAsync(
        IDbConnection conn, IReadOnlyCollection<long> seqs, CancellationToken ct)
    {
        if (seqs.Count == 0) return [];
        if (seqs.Count <= 1500)
        {
            var ids = await conn.QueryAsync<long>(new CommandDefinition("""
                SELECT id FROM articles WHERE Seq IN @seqs
                UNION
                SELECT a.Seq FROM articles a
                WHERE a.Seq IN @seqs
                  AND NOT EXISTS (SELECT 1 FROM articles b WHERE b.id = a.Seq)
                """, new { seqs = seqs.ToArray() }, cancellationToken: ct));
            return ids.ToHashSet();
        }

        await FillIdTableAsync(conn, "#article_match_seqs", seqs, ct);
        try
        {
            var ids = await conn.QueryAsync<long>(new CommandDefinition("""
                SELECT a.id FROM articles a INNER JOIN #article_match_seqs s ON s.id = a.Seq
                UNION
                SELECT a.Seq FROM articles a INNER JOIN #article_match_seqs s ON s.id = a.Seq
                WHERE NOT EXISTS (SELECT 1 FROM articles b WHERE b.id = a.Seq)
                """, cancellationToken: ct));
            return ids.ToHashSet();
        }
        finally
        {
            await DropTableAsync(conn, "#article_match_seqs", ct);
        }
    }
}
