using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.Hubs;

public sealed class PosHub : Hub
{
    public async Task JoinTerminal(string hwId) => await Groups.AddToGroupAsync(Context.ConnectionId, $"terminal:{hwId}");

    public async Task JoinAdmin() => await Groups.AddToGroupAsync(Context.ConnectionId, "admin");

    public async Task JoinPos() => await Groups.AddToGroupAsync(Context.ConnectionId, "pos");
}

/// <summary>
/// What changed in a catalog broadcast — lets POS terminals pull only what they need
/// (an offers-only change no longer forces every terminal into a full catalog sync).
/// </summary>
public static class CatalogScopes
{
    public const string All = "all";
    public const string Products = "products";
    public const string Offers = "offers";
    public const string Accounts = "accounts";
    public const string Settings = "settings";
    public const string Groups = "groups";
}

/// <summary>
/// Monotonic catalog version. Seeded from <c>ext_catalog_version</c> at startup so a restart
/// no longer resets it to zero (which used to make clients ignore stale pushes), and every
/// bump is persisted with its reason for diagnostics.
/// </summary>
public sealed class CatalogVersionState
{
    private long _version;

    public long Current => Interlocked.Read(ref _version);

    public void Seed(long fromDb) => Interlocked.Exchange(ref _version, fromDb);

    public long Bump() => Interlocked.Increment(ref _version);
}

public static class PosHubEvents
{
    public const string CatalogUpdated = "CatalogUpdated";
    public const string OfferUpdated = "OfferUpdated";
    public const string ReceiptCreated = "ReceiptCreated";
    public const string EdariUpdated = "EdariUpdated";

    /// <summary>Broadcasts a catalog change with its scope; POS clients sync selectively.</summary>
    public static async Task NotifyCatalogUpdated(IHubContext<PosHub> hub, string scope = CatalogScopes.All)
    {
        var version = CatalogVersionHolder.State.Bump();
        await CatalogVersionPersistence.RecordAsync(version, scope);
        await hub.Clients.All.SendAsync(CatalogUpdated, version, scope);
    }

    public static async Task NotifyReceiptCreated(IHubContext<PosHub> hub, long receiptId, long number) =>
        await hub.Clients.Group("admin").SendAsync(ReceiptCreated, receiptId, number);

    public static async Task NotifyEdariUpdated(IHubContext<PosHub> hub, string message, bool dataChanged)
    {
        if (dataChanged)
        {
            var version = CatalogVersionHolder.State.Bump();
            await CatalogVersionPersistence.RecordAsync(version, CatalogScopes.All);
            await hub.Clients.All.SendAsync(CatalogUpdated, version, CatalogScopes.All);
        }
        await hub.Clients.Group("admin").SendAsync(EdariUpdated, message, dataChanged);
    }
}

/// <summary>Process-wide version holder (set from DI at startup).</summary>
public static class CatalogVersionHolder
{
    public static CatalogVersionState State { get; } = new();
}

/// <summary>
/// Static bridge from the static PosHubEvents to the DI-registered repository;
/// assigned once in Program. Missing wiring degrades gracefully to memory-only versions.
/// </summary>
public static class CatalogVersionPersistence
{
    private static FOT.Pos.Infrastructure.Repositories.CatalogVersionRepository? _repo;

    public static void Init(FOT.Pos.Infrastructure.Repositories.CatalogVersionRepository repo) => _repo = repo;

    public static Task RecordAsync(long version, string scope)
    {
        _repo?.Record(version, scope);
        return Task.CompletedTask;
    }
}

public sealed class PosHubEdariRealtimeNotifier(IHubContext<PosHub> hub) : FOT.Pos.Infrastructure.Edari.IEdariRealtimeNotifier
{
    public Task NotifyEdariAsync(string message, bool dataChanged, CancellationToken ct = default) =>
        PosHubEvents.NotifyEdariUpdated(hub, message, dataChanged);
}
