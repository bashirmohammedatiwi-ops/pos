using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Hubs;

/// <summary>
/// LAN-wide Event Bus: keeps a bounded ring buffer of recent events, streams real-time Server-Sent Events (SSE)
/// to any connected HTTP client, and dispatches outbound webhooks to registered LAN services.
/// </summary>
public sealed class NetworkEventBus(IServiceScopeFactory scopeFactory, IHttpClientFactory httpClientFactory, ILogger<NetworkEventBus> logger)
{
    public const string HttpClientName = "fot-webhook";
    private const int MaxHistory = 100;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private long _nextId;
    private readonly ConcurrentQueue<NetworkEventDto> _history = new();
    private readonly ConcurrentDictionary<Guid, Channel<NetworkEventDto>> _subscribers = new();

    public static NetworkEventBus? Instance { get; private set; }

    public void RegisterGlobalInstance() => Instance = this;

    public NetworkEventDto Publish(string eventType, object? data)
    {
        var id = Interlocked.Increment(ref _nextId);
        var evt = new NetworkEventDto(id, eventType, DateTime.UtcNow, data);

        _history.Enqueue(evt);
        while (_history.Count > MaxHistory && _history.TryDequeue(out _)) { }

        foreach (var (_, channel) in _subscribers)
        {
            channel.Writer.TryWrite(evt);
        }

        _ = Task.Run(() => DispatchWebhooksAsync(evt));
        return evt;
    }

    public IReadOnlyList<NetworkEventDto> Recent(int limit = 50, long sinceId = 0)
    {
        limit = Math.Clamp(limit, 1, MaxHistory);
        return _history
            .Where(e => e.Id > sinceId)
            .OrderByDescending(e => e.Id)
            .Take(limit)
            .ToList();
    }

    public (Guid SubscriptionId, ChannelReader<NetworkEventDto> Reader) Subscribe(long sinceId = 0)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<NetworkEventDto>(new BoundedChannelOptions(64)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false
        });

        if (sinceId > 0)
        {
            foreach (var past in _history.Where(e => e.Id > sinceId).OrderBy(e => e.Id))
                channel.Writer.TryWrite(past);
        }

        _subscribers[id] = channel;
        return (id, channel.Reader);
    }

    public void Unsubscribe(Guid subscriptionId)
    {
        if (_subscribers.TryRemove(subscriptionId, out var ch))
            ch.Writer.TryComplete();
    }

    public async Task<WebhookTestResultDto> SendSingleWebhookAsync(ActiveWebhookTarget target, NetworkEventDto evt, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        using var scope = scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<ApiPlatformRepository>();
        try
        {
            var json = JsonSerializer.Serialize(evt, JsonOpts);
            using var req = new HttpRequestMessage(HttpMethod.Post, target.TargetUrl)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            req.Headers.TryAddWithoutValidation("X-FOT-Event", evt.EventType);
            req.Headers.TryAddWithoutValidation("X-FOT-Delivery", evt.Id.ToString());
            if (!string.IsNullOrWhiteSpace(target.Secret))
            {
                var sig = ComputeHmac(target.Secret, json);
                req.Headers.TryAddWithoutValidation("X-FOT-Signature", $"sha256={sig}");
            }

            var client = httpClientFactory.CreateClient(HttpClientName);
            using var resp = await client.SendAsync(req, ct);
            sw.Stop();
            var code = (int)resp.StatusCode;
            var ok = resp.IsSuccessStatusCode;
            var err = ok ? null : $"HTTP {code}";
            await repo.RecordWebhookDeliveryAsync(target.Id, ok, code, err);
            return new WebhookTestResultDto(ok, code, sw.ElapsedMilliseconds, ok ? $"تم الإرسال بنجاح (HTTP {code})" : $"رد الخادم برمز HTTP {code}");
        }
        catch (Exception ex)
        {
            sw.Stop();
            await repo.RecordWebhookDeliveryAsync(target.Id, false, null, ex.Message);
            return new WebhookTestResultDto(false, null, sw.ElapsedMilliseconds, ex.Message);
        }
    }

    private async Task DispatchWebhooksAsync(NetworkEventDto evt)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<ApiPlatformRepository>();
            var targets = await repo.GetActiveWebhookTargetsAsync(CancellationToken.None);
            if (targets.Count == 0) return;

            var matching = targets
                .Where(t => t.Events.Contains("*") || t.Events.Contains(evt.EventType))
                .ToList();
            if (matching.Count == 0) return;

            await Parallel.ForEachAsync(matching, async (target, ct) =>
            {
                await SendSingleWebhookAsync(target, evt, ct);
            });
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Webhook dispatch failed for event {Event}", evt.EventType);
        }
    }

    private static string ComputeHmac(string secret, string payload)
    {
        var key = Encoding.UTF8.GetBytes(secret);
        var bytes = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(key, bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
