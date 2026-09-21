using System.Diagnostics;
using System.Runtime.InteropServices;

namespace FOT.Pos.Shared;

internal static class WindowActivator
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SwRestore = 9;

    public static bool TryActivateProcess(string processName)
    {
        var current = Process.GetCurrentProcess().Id;
        var activated = false;
        foreach (var proc in Process.GetProcessesByName(processName))
        {
            using (proc)
            {
                if (proc.Id == current) continue;
                if (ActivateProcessWindows((uint)proc.Id))
                    activated = true;
            }
        }
        return activated;
    }

    public static void KillOtherProcesses(string processName)
    {
        var current = Process.GetCurrentProcess().Id;
        foreach (var proc in Process.GetProcessesByName(processName))
        {
            using (proc)
            {
                if (proc.Id == current) continue;
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
            }
        }
    }

    private static bool ActivateProcessWindows(uint pid)
    {
        IntPtr target = IntPtr.Zero;
        EnumWindows((hWnd, _) =>
        {
            GetWindowThreadProcessId(hWnd, out var wndPid);
            if (wndPid != pid || !IsWindowVisible(hWnd)) return true;
            target = hWnd;
            return false;
        }, IntPtr.Zero);

        if (target == IntPtr.Zero) return false;
        ShowWindow(target, SwRestore);
        return SetForegroundWindow(target);
    }
}
