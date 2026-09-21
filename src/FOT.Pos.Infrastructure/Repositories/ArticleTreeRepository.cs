using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ArticleTreeRepository(ISqlConnectionFactory db)
{
    public async Task<IReadOnlyList<ArticleTreeNodeDto>> GetNodesAsync(long? parentSeq, string? search, int limit, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(search))
        {
            const string searchSql = """
                SELECT TOP (@limit) a.Seq, a.Father,
                       LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                       LTRIM(RTRIM(a.Num)) AS Num, LTRIM(RTRIM(a.Barcode)) AS Barcode,
                       CASE WHEN EXISTS(SELECT 1 FROM articles c WHERE c.Father = a.Seq) THEN 1 ELSE 0 END AS IsFolder,
                       CASE WHEN EXISTS(SELECT 1 FROM articles c WHERE c.Father = a.Seq) THEN 1 ELSE 0 END AS HasChildren,
                       CAST(COALESCE(NULLIF(a.SellPr4,0),0) AS DECIMAL(18,0)) AS Price
                FROM articles a
                WHERE a.Name1 LIKE @s OR a.Num LIKE @s OR a.Barcode LIKE @s
                ORDER BY IsFolder DESC, a.Name1
                """;
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var searchRows = await conn.QueryAsync<TreeRow>(new CommandDefinition(
                searchSql, new { limit, s = $"%{search.Trim()}%" }, cancellationToken: ct));
            return searchRows.Select(r => r.ToDto()).ToList();
        }

        const string treeSql = """
            SELECT TOP (@limit) a.Seq, a.Father,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                   LTRIM(RTRIM(a.Num)) AS Num, LTRIM(RTRIM(a.Barcode)) AS Barcode,
                   CASE WHEN EXISTS(SELECT 1 FROM articles c WHERE c.Father = a.Seq) THEN 1 ELSE 0 END AS IsFolder,
                   CASE WHEN EXISTS(SELECT 1 FROM articles c WHERE c.Father = a.Seq) THEN 1 ELSE 0 END AS HasChildren,
                   CAST(COALESCE(NULLIF(a.SellPr4,0),0) AS DECIMAL(18,0)) AS Price
            FROM articles a
            WHERE (@parent IS NULL AND (a.Father = 0 OR a.Father IS NULL))
               OR (@parent IS NOT NULL AND a.Father = @parent)
            ORDER BY IsFolder DESC, a.Name1
            """;
        await using var c = await db.CreateOpenConnectionAsync(ct);
        var rows = await c.QueryAsync<TreeRow>(new CommandDefinition(
            treeSql, new { parent = parentSeq, limit }, cancellationToken: ct));
        return rows.Select(r => r.ToDto()).ToList();
    }

    private sealed class TreeRow
    {
        public long Seq { get; set; }
        public long? Father { get; set; }
        public string? Name { get; set; }
        public string? Num { get; set; }
        public string? Barcode { get; set; }
        public int IsFolder { get; set; }
        public int HasChildren { get; set; }
        public decimal Price { get; set; }
        public ArticleTreeNodeDto ToDto() => new(Seq, Father, Name, Num, Barcode, IsFolder == 1, HasChildren == 1, Price);
    }

    public async Task<IReadOnlyList<long>> GetDescendantProductSeqsAsync(long treeSeq, CancellationToken ct)
    {
        const string sql = """
            WITH tree AS (
                SELECT Seq FROM articles WHERE Seq = @treeSeq
                UNION ALL
                SELECT a.Seq FROM articles a INNER JOIN tree t ON a.Father = t.Seq
            )
            SELECT t.Seq
            FROM tree t
            WHERE NOT EXISTS(SELECT 1 FROM articles c WHERE c.Father = t.Seq)
            ORDER BY t.Seq
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<long>(new CommandDefinition(sql, new { treeSeq }, cancellationToken: ct))).ToList();
    }

    public async Task<string?> GetNodeNameAsync(long seq, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT TOP 1 LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) FROM articles WHERE Seq = @seq",
            new { seq }, cancellationToken: ct));
    }

    public async Task<int> CountDescendantProductsAsync(long treeSeq, CancellationToken ct)
    {
        const string sql = """
            WITH tree AS (
                SELECT Seq FROM articles WHERE Seq = @treeSeq
                UNION ALL
                SELECT a.Seq FROM articles a INNER JOIN tree t ON a.Father = t.Seq
            )
            SELECT COUNT(*) FROM tree t
            WHERE NOT EXISTS(SELECT 1 FROM articles c WHERE c.Father = t.Seq)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<int>(new CommandDefinition(sql, new { treeSeq }, cancellationToken: ct));
    }

    /// <summary>All products under a tree with names/prices — powers expandable scope cards (targets etc.).</summary>
    public async Task<IReadOnlyList<TreeProductInfoDto>> ListDescendantProductsAsync(long treeSeq, CancellationToken ct)
    {
        const string sql = """
            WITH tree AS (
                SELECT Seq FROM articles WHERE Seq = @treeSeq
                UNION ALL
                SELECT a.Seq FROM articles a INNER JOIN tree t ON a.Father = t.Seq
            )
            SELECT t.Seq,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
                   LTRIM(RTRIM(a.Barcode)) AS Barcode,
                   CAST(COALESCE(NULLIF(a.SellPr4,0),0) AS DECIMAL(18,0)) AS Price
            FROM tree t
            INNER JOIN articles a ON a.Seq = t.Seq
            WHERE NOT EXISTS(SELECT 1 FROM articles c WHERE c.Father = t.Seq)
            ORDER BY a.Name1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<TreeProductInfoDto>(
            new CommandDefinition(sql, new { treeSeq }, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<string>> GetAncestorPathAsync(long seq, CancellationToken ct)
    {
        const string sql = """
            WITH anc AS (
                SELECT Seq, Father, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), Name1))) AS Name, 0 AS lvl
                FROM articles WHERE Seq = @seq
                UNION ALL
                SELECT a.Seq, a.Father, LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), anc.lvl + 1
                FROM articles a INNER JOIN anc ON a.Seq = anc.Father
                WHERE anc.Father IS NOT NULL AND anc.Father <> 0
            )
            SELECT Name FROM anc WHERE Name IS NOT NULL ORDER BY lvl DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<string>(new CommandDefinition(sql, new { seq }, cancellationToken: ct))).ToList();
    }
}
