using Microsoft.Data.SqlClient;

namespace FOT.Pos.Infrastructure.Data;

public interface ISqlConnectionFactory
{
    Task<SqlConnection> CreateOpenConnectionAsync(CancellationToken ct = default);
}

public sealed class SqlConnectionFactory(string connectionString) : ISqlConnectionFactory
{
    public async Task<SqlConnection> CreateOpenConnectionAsync(CancellationToken ct = default)
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            var conn = new SqlConnection(connectionString);
            try
            {
                await conn.OpenAsync(ct);
                return conn;
            }
            catch
            {
                await conn.DisposeAsync();
                if (attempt >= 3 || ct.IsCancellationRequested) throw;
                await Task.Delay(400 * attempt, ct);
            }
        }

        throw new InvalidOperationException("تعذر فتح اتصال SQL بعد عدة محاولات");
    }
}
