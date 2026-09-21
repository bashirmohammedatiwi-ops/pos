using FOT.Pos.Infrastructure.Data;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace FOT.Pos.Api.Health;

public sealed class SqlDbHealthCheck(ISqlConnectionFactory db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(cancellationToken);
            return HealthCheckResult.Healthy("FOT_POS_V2");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy(ex.Message);
        }
    }
}
