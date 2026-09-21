namespace FOT.Pos.ServerHost;

internal static class SingleInstance
{
    private const string MutexName = "Global\\FOT.Pos.Server.SingleInstance";
    private static Mutex? _mutex;

    public static bool TryAcquire()
    {
        _mutex = new Mutex(true, MutexName, out var created);
        return created;
    }

    public static void Release()
    {
        if (_mutex is null) return;
        try { _mutex.ReleaseMutex(); } catch { /* ignore */ }
        _mutex.Dispose();
        _mutex = null;
    }
}
