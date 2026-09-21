namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Single-flight Edari pull + file-change signal from the data folder watcher,
/// with a circuit breaker that stops hammering a down/hung Edari server:
/// after 3 consecutive connection failures all NexusDB access is refused for an
/// exponentially growing window (60s → 10m) instead of retrying every few seconds.
/// </summary>
public sealed class EdariSyncGate
{
    public const int SafetyPullSeconds = 300;

    /// <summary>Default periodic fingerprint check; overridable from ext_edari_settings.detect_seconds.</summary>
    public static int DetectSeconds { get; private set; } = 30;

    public static void ConfigureDetectSeconds(int seconds) =>
        DetectSeconds = Math.Clamp(seconds, 5, 600);

    private readonly SemaphoreSlim _lock = new(1, 1);
    private int _fileSignal;

    // Circuit breaker state
    private int _consecutiveFailures;
    private long _openUntilTicks;

    public const int FailureThreshold = 3;
    public static readonly TimeSpan MinOpenDuration = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan MaxOpenDuration = TimeSpan.FromMinutes(10);

    public bool IsWatching { get; set; }
    public string? WatchPath { get; set; }

    /// <summary>True while the breaker is open — NexusDB access must be refused fast.</summary>
    public bool CircuitOpen => DateTime.UtcNow < new DateTime(Interlocked.Read(ref _openUntilTicks), DateTimeKind.Utc);

    /// <summary>How long until the next half-open probe is allowed.</summary>
    public TimeSpan CircuitRetryIn
    {
        get
        {
            var until = new DateTime(Interlocked.Read(ref _openUntilTicks), DateTimeKind.Utc);
            var left = until - DateTime.UtcNow;
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }
    }

    public int ConsecutiveFailures => Volatile.Read(ref _consecutiveFailures);

    public void RecordConnectionSuccess()
    {
        Interlocked.Exchange(ref _consecutiveFailures, 0);
        Interlocked.Exchange(ref _openUntilTicks, 0);
    }

    public void RecordConnectionFailure()
    {
        var failures = Interlocked.Increment(ref _consecutiveFailures);
        if (failures < FailureThreshold) return;

        // 3 failures → 60s, then ×2 per extra failure, capped at 10 minutes.
        var overshoot = failures - FailureThreshold;
        var open = MinOpenDuration;
        while (overshoot-- > 0 && open < MaxOpenDuration)
            open += open;
        if (open > MaxOpenDuration) open = MaxOpenDuration;

        Interlocked.Exchange(ref _openUntilTicks, DateTime.UtcNow.Add(open).Ticks);
    }

    public async Task<bool> WaitAsync(TimeSpan timeout, CancellationToken ct) =>
        await _lock.WaitAsync(timeout, ct);

    public void Release()
    {
        try { _lock.Release(); }
        catch (SemaphoreFullException) { /* already released */ }
    }

    public void SignalFileChange() => Interlocked.Exchange(ref _fileSignal, 1);

    public bool ConsumeFileSignal() => Interlocked.Exchange(ref _fileSignal, 0) != 0;
}

/// <summary>Thrown when NexusDB access is refused because the circuit breaker is open.</summary>
public sealed class EdariCircuitOpenException(TimeSpan retryIn)
    : InvalidOperationException(
        $"خادم الإداري غير متصل — أُوقف المحاولة مؤقتاً لحمايته، إعادة المحاولة بعد {Math.Ceiling(retryIn.TotalSeconds):N0} ثانية")
{
    public TimeSpan RetryIn { get; } = retryIn;
}

public sealed record EdariCatalogFingerprint(string Token)
{
    public static EdariCatalogFingerprint FromParts(
        long materials, long maxSeq, long priceKey, long qtyKey, long nameLen,
        long sellers, long sellerMax, long sellerLen,
        long branches, long branchMax,
        string? nameBound = null) =>
        new($"m:{materials}:{maxSeq}:{priceKey}:{qtyKey}:{nameLen}:{SanitizeBound(nameBound)}|s:{sellers}:{sellerMax}:{sellerLen}|b:{branches}:{branchMax}");

    private static string SanitizeBound(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        return value.Replace('|', '/').Replace(':', '=').Trim();
    }
}

public sealed record EdariLiveLinkDto(
    DateTime? LastDataPullAt,
    DateTime? LastHeartbeatAt,
    DateTime? LastChangeDetectedAt,
    string? Fingerprint,
    bool AutoSyncEnabled,
    bool Enabled);

public interface IEdariRealtimeNotifier
{
    Task NotifyEdariAsync(string message, bool dataChanged, CancellationToken ct = default);
}

public sealed class NullEdariRealtimeNotifier : IEdariRealtimeNotifier
{
    public Task NotifyEdariAsync(string message, bool dataChanged, CancellationToken ct = default) =>
        Task.CompletedTask;
}
