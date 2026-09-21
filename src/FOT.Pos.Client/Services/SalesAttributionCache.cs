namespace FOT.Pos.Client.Services;

public sealed class SalesAttributionCache
{
    private HashSet<long> _articleIds = [];

    public void Replace(IEnumerable<long> articleIds) =>
        _articleIds = articleIds.Where(id => id > 0).ToHashSet();

    public bool RequiresSalesman(long articleId) => _articleIds.Contains(articleId);
}
