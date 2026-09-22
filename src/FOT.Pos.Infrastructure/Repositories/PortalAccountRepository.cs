using System.Security.Cryptography;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class PortalAccountRepository(ISqlConnectionFactory db)
{
    public async Task<IReadOnlyList<SellerHubAccountDto>> ListSyncAccountsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT
                sm.id AS Id,
                sm.name AS Name,
                a.pin_hash AS PinHash,
                CAST(COALESCE(a.is_active, 0) AS bit) AS IsActive,
                CAST(COALESCE(a.must_change_pin, 0) AS bit) AS MustChangePin
            FROM salesmen sm
            INNER JOIN ext_seller_accounts a ON a.salesman_id = sm.id
            WHERE sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''
            ORDER BY sm.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<SellerHubAccountDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<PortalSellerAccountDto>> ListSellersAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT
                sm.id AS SalesmanId,
                sm.name AS Name,
                CAST(CASE WHEN a.salesman_id IS NULL THEN 0 ELSE 1 END AS bit) AS HasAccount,
                CAST(COALESCE(a.is_active, 0) AS bit) AS IsActive,
                a.pin_display AS PinDisplay,
                a.last_login_at AS LastLoginAt,
                a.created_at AS CreatedAt
            FROM salesmen sm
            LEFT JOIN ext_seller_accounts a ON a.salesman_id = sm.id
            WHERE sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''
            ORDER BY sm.id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<PortalSellerAccountDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<PortalSellerAccountDto?> IssueSellerPinAsync(long salesmanId, CancellationToken ct)
    {
        const string exists = """
            SELECT TOP 1 id FROM salesmen
            WHERE id = @salesmanId AND name IS NOT NULL AND LTRIM(RTRIM(name)) <> N''
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var id = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(exists, new { salesmanId }, cancellationToken: ct));
        if (id is null) return null;

        var pin = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        var hash = BCrypt.Net.BCrypt.HashPassword(pin);
        const string upsert = """
            MERGE ext_seller_accounts AS t
            USING (SELECT @salesmanId AS salesman_id) AS s ON t.salesman_id = s.salesman_id
            WHEN MATCHED THEN
                UPDATE SET pin_hash = @hash, pin_display = @pin, is_active = 1, must_change_pin = 0
            WHEN NOT MATCHED THEN
                INSERT (salesman_id, pin_hash, pin_display, must_change_pin, is_active)
                VALUES (@salesmanId, @hash, @pin, 0, 1);
            """;
        await conn.ExecuteAsync(new CommandDefinition(upsert, new { salesmanId, hash, pin }, cancellationToken: ct));
        return (await ListSellersAsync(ct)).FirstOrDefault(s => s.SalesmanId == salesmanId);
    }

    public async Task<PortalBulkIssueResult> IssueMissingSellerPinsAsync(CancellationToken ct)
    {
        var current = await ListSellersAsync(ct);
        var missing = current.Where(s => !s.HasAccount).Select(s => s.SalesmanId).ToList();
        foreach (var id in missing)
            await IssueSellerPinAsync(id, ct);
        return new PortalBulkIssueResult(missing.Count, await ListSellersAsync(ct));
    }

    public async Task<PortalSellerAccountDto?> SetSellerActiveAsync(long salesmanId, bool active, CancellationToken ct)
    {
        const string sql = """
            UPDATE ext_seller_accounts SET is_active = @active WHERE salesman_id = @salesmanId
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(sql, new { salesmanId, active }, cancellationToken: ct));
        if (n <= 0) return null;
        return (await ListSellersAsync(ct)).FirstOrDefault(s => s.SalesmanId == salesmanId);
    }

    public async Task<IReadOnlyList<ManagerHubAccountDto>> ListSyncManagersAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, username AS Username, display_name AS DisplayName,
                   password_hash AS PasswordHash,
                   CAST(COALESCE(is_active, 0) AS bit) AS IsActive
            FROM ext_users
            WHERE role = N'manager'
            ORDER BY id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<ManagerHubAccountDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<ManagerHubAccountDto?> GetSyncManagerByUsernameAsync(string username, CancellationToken ct)
    {
        username = (username ?? "").Trim();
        if (username.Length < 2) return null;
        const string sql = """
            SELECT TOP 1 id AS Id, username AS Username, display_name AS DisplayName,
                   password_hash AS PasswordHash,
                   CAST(COALESCE(is_active, 0) AS bit) AS IsActive
            FROM ext_users
            WHERE role = N'manager' AND LOWER(username) = LOWER(@username)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryFirstOrDefaultAsync<ManagerHubAccountDto>(
            new CommandDefinition(sql, new { username }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<PortalManagerAccountDto>> ListManagersAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, username AS Username, display_name AS DisplayName,
                   CAST(is_active AS bit) AS IsActive, password_display AS PasswordDisplay,
                   created_at AS CreatedAt
            FROM ext_users
            WHERE role = N'manager'
            ORDER BY id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<PortalManagerAccountDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<(PortalManagerAccountDto? Row, string? Error)> CreateManagerAsync(
        string username, string displayName, string password, CancellationToken ct)
    {
        username = (username ?? "").Trim();
        displayName = (displayName ?? "").Trim();
        password = (password ?? "").Trim();
        if (username.Length < 2) return (null, "أدخل اسم الدخول");
        if (displayName.Length < 2) return (null, "أدخل الاسم الظاهر");
        var pinError = ValidateManagerPassword(password);
        if (pinError is not null) return (null, pinError);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var taken = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_users WHERE username = @username",
            new { username }, cancellationToken: ct));
        if (taken > 0) return (null, "اسم الدخول مستخدم");

        var hash = BCrypt.Net.BCrypt.HashPassword(password);
        const string insert = """
            INSERT INTO ext_users (username, password_hash, password_display, display_name, role, is_active)
            VALUES (@username, @hash, @password, @displayName, N'manager', 1);
            SELECT CAST(SCOPE_IDENTITY() AS BIGINT);
            """;
        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            insert, new { username, hash, password, displayName }, cancellationToken: ct));
        var row = (await ListManagersAsync(ct)).FirstOrDefault(m => m.Id == id);
        return (row, null);
    }

    public async Task<(PortalManagerAccountDto? Row, string? Error)> ResetManagerPasswordAsync(
        long id, string password, CancellationToken ct)
    {
        password = (password ?? "").Trim();
        var pinError = ValidateManagerPassword(password);
        if (pinError is not null) return (null, pinError);
        var hash = BCrypt.Net.BCrypt.HashPassword(password);
        const string sql = """
            UPDATE ext_users
            SET password_hash = @hash, password_display = @password
            WHERE id = @id AND role = N'manager'
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(sql, new { id, hash, password }, cancellationToken: ct));
        if (n <= 0) return (null, "تعذر تحديث الرمز");
        return ((await ListManagersAsync(ct)).FirstOrDefault(m => m.Id == id), null);
    }

    public async Task<PortalManagerAccountDto?> UpdateManagerNameAsync(long id, string displayName, CancellationToken ct)
    {
        displayName = (displayName ?? "").Trim();
        if (displayName.Length < 2) return null;
        const string sql = """
            UPDATE ext_users SET display_name = @displayName
            WHERE id = @id AND role = N'manager'
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(sql, new { id, displayName }, cancellationToken: ct));
        if (n <= 0) return null;
        return (await ListManagersAsync(ct)).FirstOrDefault(m => m.Id == id);
    }

    public async Task<PortalManagerAccountDto?> SetManagerActiveAsync(long id, bool active, CancellationToken ct)
    {
        const string sql = """
            UPDATE ext_users SET is_active = @active WHERE id = @id AND role = N'manager'
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(sql, new { id, active }, cancellationToken: ct));
        if (n <= 0) return null;
        return (await ListManagersAsync(ct)).FirstOrDefault(m => m.Id == id);
    }

    private static string? ValidateManagerPassword(string password)
    {
        if (password.Length < 4) return "أدخل رمزاً من 4 خانات على الأقل";
        if (password.Length > 64) return "الرمز طويل جداً";
        return null;
    }
}
