namespace FOT.Pos.Shared;

public enum AppInstanceResult
{
    Acquired,
    ActivatedExisting,
    AcquiredAfterCleanup
}

public static class AppInstance
{
    public static bool TryAcquire(string name, out Mutex? mutex)
    {
        var result = TryAcquireSingle(name, name, out mutex);
        return result is AppInstanceResult.Acquired or AppInstanceResult.AcquiredAfterCleanup;
    }

    public static AppInstanceResult TryAcquireSingle(string mutexName, string processName, out Mutex? mutex)
    {
        mutex = new Mutex(true, @"Local\" + mutexName, out var created);
        if (created) return AppInstanceResult.Acquired;

        mutex.Dispose();
        mutex = null;

        if (WindowActivator.TryActivateProcess(processName))
            return AppInstanceResult.ActivatedExisting;

        WindowActivator.KillOtherProcesses(processName);
        Thread.Sleep(400);

        mutex = new Mutex(true, @"Local\" + mutexName, out created);
        if (created) return AppInstanceResult.AcquiredAfterCleanup;

        mutex.Dispose();
        mutex = null;
        return AppInstanceResult.ActivatedExisting;
    }
}
