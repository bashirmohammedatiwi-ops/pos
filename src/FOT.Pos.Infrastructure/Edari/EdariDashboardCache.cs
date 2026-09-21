using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariDashboardCache(IMemoryCache cache, IServiceScopeFactory scopeFactory)
{
    private const string StatsKey = "edari:dashboard-stats";
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);

    public async Task<EdariDashboardStatsDto> GetStatsAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(StatsKey, out EdariDashboardStatsDto? hit) && hit is not null)
            return hit;

        await using var scope = scopeFactory.CreateAsyncScope();
        var edari = scope.ServiceProvider.GetRequiredService<EdariNexusClient>();
        var stats = await edari.GetDashboardStatsAsync(ct);
        cache.Set(StatsKey, stats, Ttl);
        return stats;
    }

    public void Invalidate() => cache.Remove(StatsKey);
}
