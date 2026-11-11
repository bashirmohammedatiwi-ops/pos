namespace FOT.Pos.Shared.Dtos;

/// <summary>إعدادات «كاشير الطلبات» (صف واحد في ext_online_orders_settings).</summary>
public sealed class OnlineOrdersSettingsDto
{
    public bool Enabled { get; set; }
    /// <summary>حساب الإداري (Seq) للطلبات المدفوعة عند الاستلام — حساب «هاي إكسبريس».</summary>
    public long? HiExpressAccount { get; set; }
    public string? HiExpressAccountNum { get; set; }
    public string? HiExpressAccountName { get; set; }
    /// <summary>حساب الإداري (Seq) للطلبات المدفوعة مسبقاً بالبطاقة.</summary>
    public long? PrepaidAccount { get; set; }
    public string? PrepaidAccountNum { get; set; }
    public string? PrepaidAccountName { get; set; }
    /// <summary>مادة خدمية تحمل أجور التوصيل + التغليف في إيصال المحل.</summary>
    public long? DeliveryArticleId { get; set; }
    public string? DeliveryArticleName { get; set; }
    public int ReceiptCopies { get; set; } = 1;
    public int InvoiceCopies { get; set; } = 1;
    public int LabelCopies { get; set; } = 1;
    public string? LabelPrinterName { get; set; }
    public bool AutoPrintNewSlips { get; set; }
    public bool DoubleCheck { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public sealed record UpdateOnlineOrdersSettingsRequest(
    bool Enabled,
    long? HiExpressAccount,
    string? HiExpressAccountNum,
    string? HiExpressAccountName,
    long? PrepaidAccount,
    string? PrepaidAccountNum,
    string? PrepaidAccountName,
    long? DeliveryArticleId,
    string? DeliveryArticleName,
    int ReceiptCopies = 1,
    int InvoiceCopies = 1,
    int LabelCopies = 1,
    string? LabelPrinterName = null,
    bool AutoPrintNewSlips = false,
    bool DoubleCheck = false);

/// <summary>ربط طلب تطبيق بإيصال المحل.</summary>
public sealed class OnlineOrderReceiptLinkDto
{
    public long Id { get; set; }
    public string OrderId { get; set; } = "";
    public string OrderNumber { get; set; } = "";
    public long ReceiptId { get; set; }
    public long ReceiptNumber { get; set; }
    public Guid ClientReceiptId { get; set; }
    public string Kind { get; set; } = "sale";
    public string? DeliveryOption { get; set; }
    public string? TrackingNumber { get; set; }
    public decimal Total { get; set; }
    public long CashierId { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool ReportedOk { get; set; }
    public DateTime? ReportedAt { get; set; }
    public string? LastError { get; set; }
}

public sealed record OnlineOrderCodeRequest(string Code);

/// <summary>«إتمام وطباعة» أو «تسليم للزبونة»: يُنشئ إيصال المحل ثم يبلغ الموقع.</summary>
public sealed record OnlineOrderFinalizeRequest(string Code, long? PosId = null, string? HwId = null, decimal? ExpectedTotal = null);

public sealed record OnlineOrderReturnLineRequest(string Barcode, int Qty);

public sealed record OnlineOrderReturnRequest(
    string Code,
    IReadOnlyList<OnlineOrderReturnLineRequest> Lines,
    bool IncludeDelivery = true,
    long? PosId = null,
    string? HwId = null);
