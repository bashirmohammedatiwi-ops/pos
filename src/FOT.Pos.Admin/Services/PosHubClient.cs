using Microsoft.AspNetCore.SignalR.Client;

namespace FOT.Pos.Admin.Services;

public sealed class PosHubClient : IAsyncDisposable
{
    private HubConnection? _connection;
    private readonly ApiService _api;

    public event Action<long, int>? ReceiptCreated;

    /// <summary>Any catalog change (products/offers/accounts/settings) — added, updated or removed
    /// on either side (control panel or Edari). Fired for every connected client.</summary>
    public event Action? CatalogUpdated;

    /// <summary>Result of an Edari sync/pull tick (manual or automatic background). Fires for the
    /// admin group even when nothing changed, so the Edari page's live log always stays current.</summary>
    public event Action<string, bool>? EdariUpdated;

    public PosHubClient(ApiService api) => _api = api;

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        if (_api.Token is null) return;
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }

        var baseUrl = _api.BaseUrl;
        _connection = new HubConnectionBuilder()
            .WithUrl($"{baseUrl}/hubs/pos", o => o.AccessTokenProvider = () => Task.FromResult<string?>(_api.Token))
            .WithAutomaticReconnect()
            .Build();

        _connection.On<long, int>("ReceiptCreated", (id, num) => ReceiptCreated?.Invoke(id, num));
        _connection.On("CatalogUpdated", () => CatalogUpdated?.Invoke());
        _connection.On<string, bool>("EdariUpdated", (msg, changed) => EdariUpdated?.Invoke(msg, changed));
        await _connection.StartAsync(ct);
        await _connection.InvokeAsync("JoinAdmin", ct);
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null) await _connection.DisposeAsync();
    }
}
