using System.ServiceProcess;

namespace FOT.Pos.ServerHost.Services;

internal static class WindowsServiceHelper
{
    public const string ServiceName = "FOTPOSServer";

    public static bool IsInstalled
    {
        get
        {
            try { return ServiceController.GetServices().Any(s => s.ServiceName == ServiceName); }
            catch { return false; }
        }
    }

    public static bool IsRunning
    {
        get
        {
            try
            {
                using var sc = new ServiceController(ServiceName);
                return sc.Status == ServiceControllerStatus.Running;
            }
            catch { return false; }
        }
    }

    public static void Restart()
    {
        using var sc = new ServiceController(ServiceName);
        if (sc.Status == ServiceControllerStatus.Running)
        {
            sc.Stop();
            sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
        }
        sc.Start();
        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(45));
    }

    public static void Start()
    {
        using var sc = new ServiceController(ServiceName);
        if (sc.Status == ServiceControllerStatus.Running) return;
        sc.Start();
        sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(45));
    }
}
