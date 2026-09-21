using FOT.Pos.Infrastructure.Edari;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace FOT.Pos.Api.Health;

public sealed class EdariHealthCheck(EdariNexusClient nexus) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await nexus.TestConnectionAsync(cancellationToken);
            return result.Ok
                ? HealthCheckResult.Healthy(result.Message)
                : HealthCheckResult.Degraded(result.Message);
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Degraded(ex.Message);
        }
    }
}
