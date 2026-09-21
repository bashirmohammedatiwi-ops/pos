using System.Globalization;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

/// <summary>
/// Talks to the card reader through the vendor service that runs on the same
/// machine as the reader (the address is configured per POS point, e.g.
/// localhost:9092). The service exposes a single /createRequest entry point and
/// echoes the terminal's answer back to us.
/// </summary>
public sealed class CardTerminalService
{
    private const string SaleCategory = "com.pax.payment.Sale";
    private const string VoidCategory = "com.pax.payment.Void";
    private const string Currency = "IQD";

    /// <summary>The terminal works in fils; the dinar has three minor digits.</summary>
    private const decimal MinorUnits = 1000m;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(3) };
    private string? _baseUrl;
    private string? _comPort;

    public const string DefaultService = "localhost:9092";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_baseUrl);
    public string? ServiceAddress { get; private set; }

    public void Configure(string? hostAndPort, string? comPort)
    {
        var service = string.IsNullOrWhiteSpace(hostAndPort) ? DefaultService : hostAndPort.Trim();
        ServiceAddress = service;
        _comPort = string.IsNullOrWhiteSpace(comPort) ? DetectA910ComPort() : comPort.Trim();
        _baseUrl = service.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? service.TrimEnd('/')
            : $"http://{service.TrimEnd('/')}";
    }

    /// <summary>PAX A910S appears as USB VID_2FB8 with three CDC ports; the first interface (MI_00) is the data port.</summary>
    public static string? DetectA910ComPort()
    {
        try
        {
            using var usb = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\USB");
            if (usb is null) return null;
            foreach (var device in usb.GetSubKeyNames().Where(n => n.StartsWith("VID_2FB8", StringComparison.OrdinalIgnoreCase)))
            {
                using var devKey = usb.OpenSubKey(device);
                if (devKey is null) continue;
                foreach (var instance in devKey.GetSubKeyNames())
                {
                    using var inst = devKey.OpenSubKey(instance);
                    using var param = inst?.OpenSubKey("Device Parameters");
                    var port = param?.GetValue("PortName") as string;
                    if (!string.IsNullOrWhiteSpace(port) &&
                        (device.Contains("MI_00", StringComparison.OrdinalIgnoreCase) || port.Length > 0))
                    {
                        if (device.Contains("MI_00", StringComparison.OrdinalIgnoreCase))
                            return port;
                    }
                }
            }

            foreach (var device in usb.GetSubKeyNames().Where(n => n.StartsWith("VID_2FB8", StringComparison.OrdinalIgnoreCase)))
            {
                using var devKey = usb.OpenSubKey(device);
                if (devKey is null) continue;
                foreach (var instance in devKey.GetSubKeyNames())
                {
                    using var inst = devKey.OpenSubKey(instance);
                    using var param = inst?.OpenSubKey("Device Parameters");
                    var port = param?.GetValue("PortName") as string;
                    if (!string.IsNullOrWhiteSpace(port)) return port;
                }
            }
        }
        catch
        {
            /* device not enumerated yet */
        }

        return null;
    }

    public async Task<bool> IsConnectedAsync(CancellationToken ct = default)
    {
        if (_baseUrl is null) return false;
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(8));
            var res = await _http.GetAsync($"{_baseUrl}/isConnected", cts.Token);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Refreshes COM detection, reconnects USB if needed, and verifies the service sees the reader.</summary>
    public async Task<bool> EnsureConnectedAsync(CancellationToken ct = default)
    {
        if (_baseUrl is null) return false;
        if (string.IsNullOrWhiteSpace(_comPort))
            _comPort = DetectA910ComPort();

        if (!await IsConnectedAsync(ct))
        {
            if (string.IsNullOrWhiteSpace(_comPort)) return false;
            if (!await ConnectAsync(ct)) return false;
            return await IsConnectedAsync(ct);
        }

        if (!string.IsNullOrWhiteSpace(_comPort))
            await ConnectAsync(ct);

        return await IsConnectedAsync(ct);
    }

    /// <summary>Asks the service to (re)attach the reader on the configured COM port.</summary>
    public async Task<bool> ConnectAsync(CancellationToken ct = default)
    {
        if (_baseUrl is null) return false;
        if (string.IsNullOrWhiteSpace(_comPort))
            _comPort = DetectA910ComPort();
        if (_comPort is null) return false;
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(20));
            var res = await _http.PostAsync(
                $"{_baseUrl}/connectDeviceByUsb?comPort={Uri.EscapeDataString(_comPort)}",
                new StringContent("", Encoding.UTF8, "application/json"), cts.Token);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public Task<CardChargeResult> ChargeAsync(decimal amount, CancellationToken ct = default) =>
        SendAsync(SaleCategory, new
        {
            amount = (long)Math.Round(amount * MinorUnits, MidpointRounding.AwayFromZero),
            tipAmount = 0,
            currencyCode = Currency
        }, ct);

    public Task<CardChargeResult> VoidAsync(long voucherNo, CancellationToken ct = default) =>
        SendAsync(VoidCategory, new { voucherNo }, ct);

    private async Task<CardChargeResult> SendAsync(string category, object parm, CancellationToken ct)
    {
        if (_baseUrl is null)
            return CardChargeResult.Fail("لم يُضبط عنوان خدمة جهاز الدفع لنقطة البيع هذه");

        var body = JsonSerializer.Serialize(new { CATEGORY = category, parm });

        HttpResponseMessage res;
        try
        {
            res = await _http.PostAsync($"{_baseUrl}/createRequest",
                new StringContent(body, Encoding.UTF8, "application/json"), ct);
        }
        catch (OperationCanceledException)
        {
            return CardChargeResult.Fail("أُلغيت العملية قبل رد الجهاز — تحقق من الجهاز قبل إعادة المحاولة", cancelled: true);
        }
        catch (Exception ex)
        {
            return CardChargeResult.Fail($"تعذر الوصول إلى خدمة جهاز الدفع ({ex.Message})");
        }

        if (!res.IsSuccessStatusCode)
            return CardChargeResult.Fail($"خدمة جهاز الدفع ردّت بالرمز {(int)res.StatusCode}");

        var raw = await res.Content.ReadAsStringAsync(ct);
        return Parse(raw);
    }

    private static CardChargeResult Parse(string raw)
    {
        TerminalEnvelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<TerminalEnvelope>(raw, Json);
        }
        catch
        {
            return CardChargeResult.Fail("رد جهاز الدفع غير مفهوم");
        }

        if (envelope is null)
            return CardChargeResult.Fail("لم يرد جهاز الدفع بأي بيانات");

        if (envelope.ResultCode != "200")
        {
            var cancelled = IsDeviceCancellation(envelope.ResultCode, envelope.Message);
            var msg = string.IsNullOrWhiteSpace(envelope.Message)
                ? cancelled ? "تم إلغاء الدفع من الجهاز" : "رفض جهاز الدفع العملية"
                : envelope.Message!;
            return new CardChargeResult(false, msg, null, envelope.ResultCode, cancelled);
        }

        if (string.IsNullOrWhiteSpace(envelope.Response))
            return CardChargeResult.Fail("قبل الجهاز العملية لكن دون تفاصيل البطاقة");

        try
        {
            using var doc = JsonDocument.Parse(envelope.Response!);
            var root = doc.RootElement;
            var payment = new CardPaymentDto(
                Amount: ReadDecimal(root, "amount") / MinorUnits,
                Rrn: Read(root, "voucherNo"),
                TerminalId: Read(root, "terminalId"),
                Acquirer: Read(root, "aquirerName") ?? Read(root, "acquirerName"),
                AccNo: Read(root, "cardNo"),
                CardName: Read(root, "issuerName"),
                CardType: Read(root, "cardType"),
                AuthCode: Read(root, "authCode"),
                BatchNo: Read(root, "batchNo"),
                RefNo: Read(root, "refNo"),
                MerchantName: Read(root, "merchantName"),
                CurrencyCode: Read(root, "currencyCode"),
                DeviceType: envelope.TypeDevice,
                TransTime: ReadDate(root, "transTime"));
            return new CardChargeResult(true, envelope.Message ?? "تم الدفع", payment, envelope.ResultCode);
        }
        catch
        {
            return CardChargeResult.Fail("تعذر قراءة تفاصيل البطاقة من رد الجهاز");
        }
    }

    private static string? Read(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => value.ToString()
        };
    }

    private static decimal ReadDecimal(JsonElement root, string name)
    {
        var text = Read(root, name);
        return decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? value : 0m;
    }

    private static DateTime? ReadDate(JsonElement root, string name)
    {
        var text = Read(root, name);
        if (string.IsNullOrWhiteSpace(text)) return null;
        return DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var value)
            ? value
            : null;
    }

    private static bool IsDeviceCancellation(string? resultCode, string? message)
    {
        var m = (message ?? "").Trim();
        if (m.Length > 0)
        {
            var lower = m.ToLowerInvariant();
            if (lower.Contains("cancel") || lower.Contains("aborted") || lower.Contains("user abort"))
                return true;
            if (m.Contains("إلغ", StringComparison.Ordinal) || m.Contains("الغاء", StringComparison.Ordinal)
                || m.Contains("ألغ", StringComparison.Ordinal) || m.Contains("ملغ", StringComparison.Ordinal))
                return true;
        }

        var code = (resultCode ?? "").Trim().ToUpperInvariant();
        return code is "CANCEL" or "USER_CANCEL" or "USERCANCEL" or "CANCELLED" or "ABORT"
            or "-1" or "-2" or "1001" or "1002";
    }

    private sealed record TerminalEnvelope(string? TypeDevice, string? ResultCode, string? Response, string? Message);
}

public sealed record CardChargeResult(bool Ok, string Message, CardPaymentDto? Payment, string? ResultCode, bool CancelledByDevice = false)
{
    public static CardChargeResult Fail(string message, bool cancelled = false) =>
        new(false, message, null, null, cancelled);
}
