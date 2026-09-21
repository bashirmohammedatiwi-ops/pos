using Microsoft.AspNetCore.SignalR.Client;

namespace FOT.Pos.Client.Services;

public sealed class PosHubClient : IAsyncDisposable
{
    private HubConnection? _connection;
    private readonly ApiService _api;

    public event Action? CatalogUpdated;

    public PosHubClient(ApiService api) => _api = api;

    public bool IsConnected => _connection?.State == HubConnectionState.Connected;

    public async Task ConnectAsync(CancellationToken ct = default)
    {
        if (_api.Session?.Token is null) return;
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }

        var baseUrl = _api.BaseUrl;
        _connection = new HubConnectionBuilder()
            .WithUrl($"{baseUrl}/hubs/pos", o => o.AccessTokenProvider = () => Task.FromResult<string?>(_api.Session.Token))
            .WithAutomaticReconnect()
            .Build();

        _connection.On("CatalogUpdated", () => CatalogUpdated?.Invoke());
        _connection.Reconnected += async _ => await OnReconnectedAsync();

        await _connection.StartAsync(ct);
        await JoinGroupsAsync(ct);
    }

    private async Task JoinGroupsAsync(CancellationToken ct = default)
    {
        if (_connection is null) return;
        try { await _connection.InvokeAsync("JoinPos", ct); } catch { /* older servers */ }
        try { await _connection.InvokeAsync("JoinTerminal", TerminalHelper.GetHwId(), ct); } catch { /* optional */ }
    }

    private async Task OnReconnectedAsync()
    {
        await JoinGroupsAsync();
        CatalogUpdated?.Invoke();
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null) await _connection.DisposeAsync();
    }
}
