using System.Windows.Threading;

namespace FOT.Pos.Client.Services;

/// <summary>Detects USB barcode scanner input (rapid keystrokes) and fires scan complete.</summary>
public sealed class BarcodeInputHandler
{
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(80) };
    private string _buffer = "";
    private DateTime _lastKey = DateTime.MinValue;
    private string _lastCode = "";
    private DateTime _lastScanAt = DateTime.MinValue;

    public event Action<string>? ScanCompleted;

    public BarcodeInputHandler()
    {
        _timer.Tick += (_, _) => Flush();
    }

    public void OnCharacter(char c)
    {
        var now = DateTime.UtcNow;
        if ((now - _lastKey).TotalMilliseconds > 120)
            _buffer = "";
        _lastKey = now;

        if (c == '\r' || c == '\n')
        {
            Flush();
            return;
        }

        _buffer += c;
        _timer.Stop();
        _timer.Start();
    }

    public void Reset()
    {
        _timer.Stop();
        _buffer = "";
    }

    private void Flush()
    {
        _timer.Stop();
        if (_buffer.Length < 2) { _buffer = ""; return; }
        var code = CollapseRepeated(_buffer.Trim());
        _buffer = "";
        if (code.Length == 0) return;
        var now = DateTime.UtcNow;
        if (code == _lastCode && (now - _lastScanAt).TotalMilliseconds < 350)
            return;
        _lastCode = code;
        _lastScanAt = now;
        ScanCompleted?.Invoke(code);
    }

    private static string CollapseRepeated(string code)
    {
        if (code.Length < 16 || code.Length % 2 != 0) return code;
        var mid = code.Length / 2;
        var left = code[..mid];
        return left == code[mid..] ? left : code;
    }
}
