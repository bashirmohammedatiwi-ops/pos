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
    /// <summary>ملصق شركة التوصيل يُطبع بلا اسم الزبونة (migration 092) — المساحة تذهب لـ«مواد الطلب».</summary>
    public bool LabelHideCustomer { get; set; }
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
    bool DoubleCheck = false,
    bool LabelHideCustomer = false);

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
    /// <summary>طلب توصيل: أجور التوصيل والتغليف خارج الفاتورة، ضمن مبلغ شركة التوصيل (migration 091).</summary>
    public decimal DeliveryFee { get; set; }
    public decimal GiftWrapFee { get; set; }
    public long CashierId { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool ReportedOk { get; set; }
    public DateTime? ReportedAt { get; set; }
    public string? LastError { get; set; }
}

public sealed record OnlineOrderCodeRequest(string Code);

/// <summary>«إتمام وطباعة» أو «تسليم للزبونة»: يُنشئ إيصال المحل ثم يبلغ الموقع.</summary>
public sealed record OnlineOrderFinalizeRequest(
    string Code,
    long? PosId = null,
    string? HwId = null,
    decimal? ExpectedTotal = null,
    /// <summary>البائع كما في الكاشير الأصلي — على رأس الإيصال وكل أسطره (0/null = بلا بائع).</summary>
    long? SalesmanId = null);

/// <summary>
/// تعديل طلب مُجهَّز قبل فوترته من «كاشير الطلبات»:
///  · Op = "add": إضافة صنف بالباركود (من كتالوج المحل؛ الموقع يأخذ سعره إن كان الصنف في التطبيق، وإلا سعر المحل).
///  · Op = "set": كمية سطر (LineId) — نقص يحتاج سبباً، صفر يحذف الإضافي، Charge يجعل الإضافي هدية أو مدفوعاً.
/// ClientEditId يمنع تكرار الإضافة عند إعادة الإرسال.
/// </summary>
public sealed record OnlineOrderEditRequest(
    string Code,
    string Op,
    string? Barcode = null,
    int? Qty = null,
    string? Charge = null,
    string? Reason = null,
    string? LineId = null,
    string? ClientEditId = null,
    /// <summary>Op = "discount": الخصم اليدوي بالدينار (0 = إلغاء) — بصلاحية «خصم» وحدّها كالكاشير.</summary>
    decimal? Amount = null,
    /// <summary>Op = "price": سعر القطعة الجديد لسطر LineId — بصلاحية «تغيير السعر» كالكاشير.</summary>
    decimal? UnitPrice = null,
    /// <summary>Op = "gift": «فاتورة هدية» (true) أو إلغاؤها — بصلاحية «الهدايا» كالكاشير، قبل الفوترة.</summary>
    bool? Gift = null,
    /// <summary>معرّف الطلب في الموقع (كاشير 2.6.6+): طلب لم يُفوتر في المحل يُعدَّل دون قراءته من الموقع أولاً.</summary>
    string? OrderId = null);

/// <summary>فاتورة طلب تطبيق محجوزة عن الترحيل التلقائي إلى الإداري (migration 090).</summary>
public sealed class OnlineEdariHoldDto
{
    public Guid ClientReceiptId { get; set; }
    public string OrderId { get; set; } = "";
    public string? OrderNumber { get; set; }
    public DateTime CreatedAt { get; set; }
    public int Edits { get; set; }
    public DateTime? LastEditAt { get; set; }
    public DateTime? ReleasedAt { get; set; }
    public string? ReleasedByName { get; set; }
    public long? ReceiptId { get; set; }
    public long? ReceiptNumber { get; set; }
    public decimal Total { get; set; }
    public bool Synced { get; set; }
    public string? DeliveryOption { get; set; }
    public string? TrackingNumber { get; set; }
    public string? CashierName { get; set; }
}

/// <summary>«ترحيل» فواتير طلبات التطبيق إلى الإداري: بأرقام الطلبات (Codes) أو كلها (All).</summary>
public sealed record OnlineOrdersPostRequest(IReadOnlyList<string>? OrderIds = null, bool All = false);

/// <summary>
/// خيارات التوصيل للطلب: TypeId نوع الشحنة عند هاي إكسبريس (null = الافتراضي، 0 = بلا نوع، 1 قابل للكسر،
/// 2 توصيل مبرد، 3 ممنوع الفتح، 4 معاملة خاصة)، عدد الطرود، ملاحظة للمندوب، هاتف ثانٍ.
/// SetType = true حين يُرسل TypeId (حتى لو null) — لتمييز «الافتراضي» عن «بلا تغيير».
/// </summary>
public sealed record OnlineOrderCourierOptionsRequest(
    string Code,
    bool SetType = false,
    int? TypeId = null,
    int? ParcelCount = null,
    string? Note = null,
    string? Phone2 = null);

/// <summary>صنف من كتالوج المحل بالباركود (قبل إضافته للطلب).</summary>
public sealed record OnlineOrderProductRequest(string Barcode);

public sealed record OnlineOrderReturnLineRequest(string Barcode, int Qty);

public sealed record OnlineOrderReturnRequest(
    string Code,
    IReadOnlyList<OnlineOrderReturnLineRequest> Lines,
    bool IncludeDelivery = true,
    long? PosId = null,
    string? HwId = null);
