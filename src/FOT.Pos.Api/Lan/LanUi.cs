namespace FOT.Pos.Api.Lan;

public static class LanUi
{
    public static string? ResolveAdminDist(string contentRoot)
    {
        foreach (var path in Candidates(contentRoot))
        {
            if (File.Exists(Path.Combine(path, "index.html"))) return path;
        }
        return null;
    }

    public static string? ResolvePriceDist(string contentRoot)
    {
        foreach (var path in PriceCandidates(contentRoot))
        {
            if (File.Exists(Path.Combine(path, "index.html"))) return path;
        }
        return null;
    }

    private static IEnumerable<string> Candidates(string contentRoot)
    {
        yield return Path.GetFullPath(Path.Combine(contentRoot, "wwwroot"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "fot-admin"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "..", "resources", "fot-admin"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "..", "fot-admin"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "..", "..", "web", "fot-admin", "dist"));
    }

    private static IEnumerable<string> PriceCandidates(string contentRoot)
    {
        yield return Path.GetFullPath(Path.Combine(contentRoot, "wwwroot", "price"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "fot-price"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "..", "resources", "fot-price"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "..", "fot-price"));
        yield return Path.GetFullPath(Path.Combine(contentRoot, "..", "..", "web", "fot-price", "dist"));
    }
}
