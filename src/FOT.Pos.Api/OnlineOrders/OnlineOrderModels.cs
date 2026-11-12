using System.Security.Cryptography;
using System.Text;

namespace FOT.Pos.Api.OnlineOrders;

/// <summary>ما يقرؤه سيرفر المحل من رد POST /pos-link/orders/lookup (الحقول التي يحتاجها لبناء الإيصال).</summary>
public sealed class SiteLookup
{
    public SiteOrder Order { get; set; } = new();
    public SiteCustomer? Customer { get; set; }
    public SiteReceipt Receipt { get; set; } = new();
    public List<string> Blockers { get; set; } = [];
    public bool CanInvoice { get; set; }
    public SiteInvoiced? Invoiced { get; set; }
    public SiteShipment? Shipment { get; set; }
}

public sealed class SiteOrder
{
    public string Id { get; set; } = "";
    public string OrderNumber { get; set; } = "";
    public string Code { get; set; } = "";
    public string? Stage { get; set; }
    public string? Status { get; set; }
    public string? DeliveryOption { get; set; }
    public string? PaymentMethod { get; set; }
    public string? PaymentStatus { get; set; }
    public bool Prepaid { get; set; }
    public int? ParcelCount { get; set; }
    public bool IsGift { get; set; }
    public bool GiftHidePrices { get; set; }
    /// <summary>«فاتورة هدية» من كاشير الطلبات: إيصال المحل هدية (Kind 2).</summary>
    public bool CashierGift { get; set; }

    public bool IsPickup => string.Equals(DeliveryOption, "PICKUP", StringComparison.OrdinalIgnoreCase);
}

public sealed class SiteCustomer
{
    public string? Name { get; set; }
    public string? Phone { get; set; }
    public string? Governorate { get; set; }
    public string? AddressLine { get; set; }
}

public sealed class SiteReceipt
{
    public List<SiteReceiptItem> Items { get; set; } = [];
    public decimal ItemsTotal { get; set; }
    public decimal Shipping { get; set; }
    public decimal GiftWrap { get; set; }
    public decimal Discount { get; set; }
    public decimal Total { get; set; }
    /// <summary>جزء الخصم الذي غطّته «فاتورة الهدية» (0 لغير الهدية).</summary>
    public decimal GiftDiscount { get; set; }
}

public sealed class SiteReceiptItem
{
    public string? Barcode { get; set; }
    public string? Name { get; set; }
    public decimal Qty { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal LineTotal { get; set; }
    public string? Kind { get; set; }
    public bool Free { get; set; }
}

public sealed class SiteInvoiced
{
    public string? ReceiptNumber { get; set; }
    public string? ClientReceiptId { get; set; }
    public DateTime? At { get; set; }
    public string? CashierName { get; set; }
}

public sealed class SiteShipment
{
    public string? State { get; set; }
    public string? TrackingNumber { get; set; }
    public string? StatusName { get; set; }
    public string? LastError { get; set; }
}

/// <summary>
/// معرّفات الإيصال الثابتة لكل طلب: إعادة الضغط على «إتمام وطباعة» أو انقطاع الشبكة لا ينشئ إيصالاً ثانياً،
/// لأن reciepts.client_receipt_id فريد والموقع يقبل الفوترة مرة واحدة لكل clientReceiptId.
/// </summary>
public static class OnlineOrderIds
{
    public static string SaleClientId(string orderId) => $"online-{orderId}";

    public static string ReturnClientId(string orderId) => $"online-return-{orderId}";

    public static Guid SaleGuid(string orderId) => DeterministicGuid(SaleClientId(orderId));

    public static Guid ReturnGuid(string orderId) => DeterministicGuid(ReturnClientId(orderId));

    /// <summary>UUID v5-style (SHA-1 لاسم ثابت داخل نطاق خاص بالمحل).</summary>
    public static Guid DeterministicGuid(string name)
    {
        var ns = new Guid("6f1c2a8e-4b7d-5e3a-9c61-0d4f2b8a7e15").ToByteArray();
        SwapGuidBytes(ns);
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var data = new byte[ns.Length + nameBytes.Length];
        Buffer.BlockCopy(ns, 0, data, 0, ns.Length);
        Buffer.BlockCopy(nameBytes, 0, data, ns.Length, nameBytes.Length);
        var hash = SHA1.HashData(data);
        var bytes = new byte[16];
        Array.Copy(hash, bytes, 16);
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        SwapGuidBytes(bytes);
        return new Guid(bytes);
    }

    private static void SwapGuidBytes(byte[] b)
    {
        (b[0], b[3]) = (b[3], b[0]);
        (b[1], b[2]) = (b[2], b[1]);
        (b[4], b[5]) = (b[5], b[4]);
        (b[6], b[7]) = (b[7], b[6]);
    }
}
