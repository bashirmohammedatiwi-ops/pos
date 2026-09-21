using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Configuration;

namespace FOT.Pos.Infrastructure.Services;

public sealed class EdariSettingsService(
    IConfiguration config,
    EdariSettingsRepository repo,
    EdariDashboardCache edariCache)
{
    private EdariOptions? _cache;
    private DateTime _cacheAt;

    public async Task<EdariOptions> GetEffectiveAsync(CancellationToken ct)
    {
        if (_cache is not null && DateTime.UtcNow - _cacheAt < TimeSpan.FromSeconds(30))
            return _cache;

        var db = await repo.LoadAsync(ct);
        _cache = EdariSettingsMerger.Merge(config, db);
        _cacheAt = DateTime.UtcNow;
        EdariSyncGate.ConfigureDetectSeconds(_cache.EffectiveDetectSeconds);
        return _cache;
    }

    public void InvalidateCache() => _cache = null;

    public Task<EdariSettingsDto> GetDtoAsync(CancellationToken ct) => repo.GetDtoAsync(ct);

    public async Task SaveAsync(UpdateEdariSettingsRequest req, CancellationToken ct)
    {
        await repo.SaveAsync(req, ct);
        InvalidateCache();
        edariCache.Invalidate();
    }
}
