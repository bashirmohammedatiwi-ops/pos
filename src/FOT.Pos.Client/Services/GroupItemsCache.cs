using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public sealed class GroupItemsCache
{
    private readonly Dictionary<long, CacheEntry> _cache = [];
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    public bool TryGet(long groupId, out IReadOnlyList<ArticleGroupItemDto>? items)
    {
        items = null;
        if (!_cache.TryGetValue(groupId, out var entry)) return false;
        if (DateTime.UtcNow - entry.At > Ttl) { _cache.Remove(groupId); return false; }
        items = entry.Items;
        return true;
    }

    public void Set(long groupId, IReadOnlyList<ArticleGroupItemDto> items) =>
        _cache[groupId] = new CacheEntry(items, DateTime.UtcNow);

    public void Clear() => _cache.Clear();

    private sealed record CacheEntry(IReadOnlyList<ArticleGroupItemDto> Items, DateTime At);
}
