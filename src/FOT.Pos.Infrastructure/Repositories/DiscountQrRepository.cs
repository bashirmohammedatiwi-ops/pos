using System.Security.Cryptography;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class DiscountQrRepository(ISqlConnectionFactory db)
{
    public async Task<IReadOnlyList<DiscountQrPersonDto>> ListAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<DiscountQrPersonDto>(new CommandDefinition("""
            SELECT p.id AS Id, p.name AS Name, p.code AS Code,
                   CAST(p.active AS bit) AS Active, p.created_at AS CreatedAt,
                   COALESCE(uses.ReceiptCount, 0) AS ReceiptCount,
                   CAST(COALESCE(uses.TotalDiscount, 0) AS DECIMAL(18,2)) AS TotalDiscount
            FROM ext_discount_qr_people p
            OUTER APPLY (
                SELECT COUNT(*) AS ReceiptCount,
                       SUM(r.user_discount) AS TotalDiscount
                FROM reciepts r
                WHERE r.discount_qr_person_id = p.id AND r.user_discount > 0
            ) uses
            ORDER BY p.active DESC, p.name
            """, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<DiscountQrPersonDto>> ListActiveAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<DiscountQrPersonDto>(new CommandDefinition("""
            SELECT id AS Id, name AS Name, code AS Code,
                   CAST(active AS bit) AS Active, created_at AS CreatedAt,
                   0 AS ReceiptCount, CAST(0 AS DECIMAL(18,2)) AS TotalDiscount
            FROM ext_discount_qr_people
            WHERE active = 1
            ORDER BY name
            """, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<DiscountQrPersonDto?> FindByCodeAsync(string code, CancellationToken ct)
    {
        var normalized = Normalize(code);
        if (normalized is null) return null;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<DiscountQrPersonDto>(new CommandDefinition("""
            SELECT id AS Id, name AS Name, code AS Code,
                   CAST(active AS bit) AS Active, created_at AS CreatedAt,
                   0 AS ReceiptCount, CAST(0 AS DECIMAL(18,2)) AS TotalDiscount
            FROM ext_discount_qr_people
            WHERE code = @code AND active = 1
            """, new { code = normalized }, cancellationToken: ct));
    }

    public async Task<DiscountQrPersonDto?> GetByIdAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<DiscountQrPersonDto>(new CommandDefinition("""
            SELECT id AS Id, name AS Name, code AS Code,
                   CAST(active AS bit) AS Active, created_at AS CreatedAt,
                   0 AS ReceiptCount, CAST(0 AS DECIMAL(18,2)) AS TotalDiscount
            FROM ext_discount_qr_people
            WHERE id = @id
            """, new { id }, cancellationToken: ct));
    }

    public async Task<DiscountQrPersonDto> CreateAsync(string name, CancellationToken ct)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0)
            throw new InvalidOperationException("أدخل اسم الشخص");

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        for (var i = 0; i < 6; i++)
        {
            var code = NewCode();
            try
            {
                var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                    INSERT INTO ext_discount_qr_people (name, code, active)
                    OUTPUT INSERTED.id
                    VALUES (@name, @code, 1)
                    """, new { name = trimmed, code }, cancellationToken: ct));
                return new DiscountQrPersonDto(id, trimmed, code, true, DateTime.Now, 0, 0);
            }
            catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
            {
                /* unique code collision — retry */
            }
        }

        throw new InvalidOperationException("تعذر توليد رمز فريد");
    }

    public async Task UpdateAsync(long id, string? name, bool? active, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_discount_qr_people
            SET name = COALESCE(NULLIF(LTRIM(RTRIM(@name)), N''), name),
                active = COALESCE(@active, active)
            WHERE id = @id
            """, new { id, name, active }, cancellationToken: ct));
        if (rows == 0) throw new InvalidOperationException("الشخص غير موجود");
    }

    public async Task<IReadOnlyList<DiscountQrReceiptDto>> ListReceiptsAsync(long personId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<DiscountQrReceiptDto>(new CommandDefinition("""
            SELECT r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(r.user_discount AS DECIMAL(18,2)) AS UserDiscount,
                   c.username AS CashierName,
                   COALESCE(r.discount_qr_person_name, p.name) AS PersonName
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN ext_discount_qr_people p ON p.id = r.discount_qr_person_id
            WHERE r.discount_qr_person_id = @personId AND r.user_discount > 0
            ORDER BY r.id DESC
            """, new { personId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<(long Id, string Name)?> ResolveForReceiptAsync(long? personId, string? code, CancellationToken ct)
    {
        if (personId is > 0)
        {
            var byId = await GetByIdAsync(personId.Value, ct);
            if (byId is { Active: true }) return (byId.Id, byId.Name);
        }

        if (!string.IsNullOrWhiteSpace(code))
        {
            var byCode = await FindByCodeAsync(code, ct);
            if (byCode is not null) return (byCode.Id, byCode.Name);
        }

        return null;
    }

    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var code = new string(raw.Trim().ToUpperInvariant().Where(ch => char.IsLetterOrDigit(ch)).ToArray());
        return code.Length == 21 && code.StartsWith("FOTDQ", StringComparison.Ordinal) ? code : null;
    }

    private static string NewCode() => "FOTDQ" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8));
}
