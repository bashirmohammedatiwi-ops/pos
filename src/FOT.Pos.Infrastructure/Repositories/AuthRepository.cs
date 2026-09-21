using BCrypt.Net;
using Dapper;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class AuthRepository(ISqlConnectionFactory db)
{
    private sealed record UserRow(long Id, string Username, string PasswordHash, string DisplayName, string Role);

    public async Task<UserDto?> ValidateAsync(string username, string password, CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, username AS Username, password_hash AS PasswordHash,
                   display_name AS DisplayName, role AS Role
            FROM ext_users WHERE username = @username AND is_active = 1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var user = await conn.QuerySingleOrDefaultAsync<UserRow>(new CommandDefinition(sql, new { username }, cancellationToken: ct));
        if (user is null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash)) return null;
        var displayName = TextEncodingHelper.UserDisplayLabel(user.Username, user.DisplayName);
        return new UserDto(user.Id, user.Username, displayName, user.Role);
    }

    public async Task EnsureAdminSeededAsync(CancellationToken ct)
    {
        const string check = "SELECT COUNT(*) FROM ext_users WHERE username = 'admin'";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var count = await conn.ExecuteScalarAsync<int>(new CommandDefinition(check, cancellationToken: ct));
        if (count > 0)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE ext_users SET display_name = N'مدير النظام' WHERE username = 'admin'",
                cancellationToken: ct));
            return;
        }
        var hash = BCrypt.Net.BCrypt.HashPassword("admin123");
        await conn.ExecuteAsync(new CommandDefinition(
            "INSERT INTO ext_users (username, password_hash, display_name, role) VALUES ('admin', @hash, N'مدير النظام', 'admin')",
            new { hash }, cancellationToken: ct));
    }
}
