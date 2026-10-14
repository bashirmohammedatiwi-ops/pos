using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class OfferFolderRepository(ISqlConnectionFactory db)
{
    public async Task<IReadOnlyList<OfferFolderDto>> ListAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT f.id AS Id,
                   LTRIM(RTRIM(CONVERT(NVARCHAR(200), f.name))) AS Name,
                   f.sort_order AS SortOrder,
                   CAST(COUNT(o.id) AS INT) AS OfferCount
            FROM ext_offer_folders f
            LEFT JOIN offers o ON o.folder_id = f.id
            GROUP BY f.id, f.name, f.sort_order
            ORDER BY f.sort_order ASC, f.name ASC, f.id ASC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<OfferFolderDto>(
            new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<long> CreateAsync(string name, CancellationToken ct)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0)
            throw new InvalidOperationException("اسم المجلد مطلوب.");
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var sort = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT ISNULL(MAX(sort_order), 0) + 1 FROM ext_offer_folders", cancellationToken: ct));
        return await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO ext_offer_folders (name, sort_order)
            OUTPUT INSERTED.id
            VALUES (@name, @sort)
            """, new { name = trimmed, sort }, cancellationToken: ct));
    }

    public async Task<bool> RenameAsync(long id, string name, CancellationToken ct)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0)
            throw new InvalidOperationException("اسم المجلد مطلوب.");
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_offer_folders SET name = @name WHERE id = @id",
            new { id, name = trimmed }, cancellationToken: ct)) > 0;
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ext_offer_folders WHERE id = @id", new { id }, cancellationToken: ct)) > 0;
    }

    public async Task<bool> SetOfferFolderAsync(long offerId, long? folderId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        if (folderId is > 0)
        {
            var exists = await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
                "SELECT TOP 1 1 FROM ext_offer_folders WHERE id = @folderId",
                new { folderId }, cancellationToken: ct));
            if (exists is null)
                throw new InvalidOperationException("المجلد غير موجود.");
        }

        return await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE offers SET folder_id = @folderId WHERE id = @offerId",
            new { offerId, folderId }, cancellationToken: ct)) > 0;
    }
}
