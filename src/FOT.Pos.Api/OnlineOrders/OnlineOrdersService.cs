using System.Text.Json;
using System.Text.Json.Nodes;
using FOT.Pos.Api.HostedServices;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.OnlineOrders;

/// <summary>رفض بسبب حالة الطلب أو الإعدادات — الرسالة عربية وتُعرض للكاشير كما هي.</summary>
public sealed class OnlineOrdersRefusal(string message, int status = 409, object? extra = null) : Exception(message)
{
    public int Status { get; } = status;
    public object? Extra { get; } = extra;
}

/// <summary>سطر في إيصال المحل كما سيُحفظ: مادة الكتالوج + سعر الطلب.</summary>
public sealed record PlannedLine(
    string? Barcode,
    string Name,
    decimal Qty,
    decimal ChargePrice,
    bool Free,
    string? Kind,
    long ArticleId,
    string? PosName,
    string? PosBarcode,
    decimal PosPrice,
    decimal ListPrice,
    bool PriceDiffers,
    bool Resolved);

public sealed record SalePlan(
    IReadOnlyList<PlannedLine> Lines,
    IReadOnlyList<string> Unresolved,
    decimal DeliveryFee,
    long? DeliveryArticleId,
    string? DeliveryArticleName,
    string? DeliveryBarcode,
    long? AccountSeq,
    string? AccountName,
    string PaymentLabel,
    decimal ComputedTotal,
    IReadOnlyList<string> Problems);

/// <summary>
/// «كاشير الطلبات» على سيرفر المحل: يفتح الطلب من الموقع، يبني منه إيصال بيع حقيقياً عبر ReceiptRepository.CreateAsync
/// (نفس مسار أي بيع: الترقيم، المخزون المعلّق، الترحيل إلى الإداري)، ثم يبلغ الموقع بالفوترة.
/// معرّف الإيصال ثابت لكل طلب، فإعادة المحاولة لا تكرر شيئاً.
/// </summary>
public sealed class OnlineOrdersService(
    OnlineOrdersBridge bridge,
    OnlineOrdersRepository repo,
    ProductRepository products,
    ReceiptRepository receipts,
    CashierRepository cashiers,
    IHubContext<PosHub> hub,
    ILogger<OnlineOrdersService> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly string[] ReturnStages = ["RETURNING", "RETURNED", "PARTIALLY_DELIVERED", "DELIVERY_ISSUE", "CANCELLED"];

    public static SiteLookup Parse(JsonElement e) =>
        e.Deserialize<SiteLookup>(Json) ?? throw new OnlineOrdersRefusal("رد غير مفهوم من موقع الطلبات", 424);

    // ───────────────────────── قراءة ─────────────────────────

    /// <summary>رد الموقع كما هو + كتلة local: مطابقة الباركودات مع كتالوج المحل والموانع المحلية والربط المحفوظ.</summary>
    public async Task<JsonObject> LookupAsync(string code, CancellationToken ct)
    {
        var el = await bridge.LookupAsync(code, ct);
        var site = Parse(el);
        var settings = await repo.GetSettingsAsync(ct);
        var plan = await PlanSaleAsync(site, settings, ct);
        var links = string.IsNullOrEmpty(site.Order.Id) ? [] : await repo.ListLinksAsync(site.Order.Id, ct);
        var node = JsonNode.Parse(el.GetRawText())?.AsObject() ?? new JsonObject();
        node["local"] = JsonSerializer.SerializeToNode(new
        {
            plan.Lines,
            plan.Unresolved,
            plan.DeliveryFee,
            plan.DeliveryArticleName,
            plan.AccountName,
            plan.PaymentLabel,
            plan.ComputedTotal,
            problems = site.Invoiced is null ? plan.Problems : [],
            sale = links.FirstOrDefault(l => l.Kind == "sale"),
            @return = links.FirstOrDefault(l => l.Kind == "return"),
            invoicedHere = site.Invoiced?.ClientReceiptId == OnlineOrderIds.SaleClientId(site.Order.Id),
        }, Json);
        return node;
    }

    /// <summary>بيانات إعادة الطباعة — لا تنشئ شيئاً لا هنا ولا في الموقع.</summary>
    public async Task<JsonObject> PrintDataAsync(string code, CancellationToken ct)
    {
        var el = await bridge.PrintDataAsync(code, ct);
        var node = JsonNode.Parse(el.GetRawText())?.AsObject() ?? new JsonObject();
        // print-data لا يحمل معرّف الطلب؛ نقرؤه من lookup (قراءة فقط) لنجد إيصال المحل المربوط.
        var lookup = Parse(await bridge.LookupAsync(code, ct));
        var tracking = node["shipment"]?["trackingNumber"]?.GetValue<string?>();
        var sale = await repo.GetLinkAsync(lookup.Order.Id, "sale", ct);
        if (sale is not null && !string.IsNullOrWhiteSpace(tracking))
            await repo.SetTrackingAsync(lookup.Order.Id, tracking!, ct);
        var ret = await repo.GetLinkAsync(lookup.Order.Id, "return", ct);
        node["receiptPrint"] = sale is null
            ? null
            : JsonSerializer.SerializeToNode(await ReceiptPrintAsync(sale.ReceiptId, lookup, tracking, PaymentLabel(lookup), ct), Json);
        node["returnPrint"] = ret is null
            ? null
            : JsonSerializer.SerializeToNode(await ReceiptPrintAsync(ret.ReceiptId, lookup, tracking, "إيصال إرجاع", ct), Json);
        node["link"] = JsonSerializer.SerializeToNode(sale, Json);
        return node;
    }

    // ───────────────────────── الفوترة ─────────────────────────

    public async Task<object> FinalizeAsync(long cashierId, OnlineOrderFinalizeRequest req, bool pickup, CancellationToken ct)
    {
        var settings = await repo.GetSettingsAsync(ct);
        if (!settings.Enabled)
            throw new OnlineOrdersRefusal("كاشير الطلبات متوقف — فعّله من لوحة التحكم ← الإعدادات ← طلبات التطبيق");

        var site = Parse(await bridge.LookupAsync(req.Code, ct));
        var order = site.Order;
        if (string.IsNullOrEmpty(order.Id)) throw new OnlineOrdersRefusal("الطلب غير موجود", 404);
        if (!pickup && order.IsPickup) throw new OnlineOrdersRefusal("طلب استلام من المحل — استعمل «تسليم للزبونة»");
        if (pickup && !order.IsPickup) throw new OnlineOrdersRefusal("ليس طلب استلام من المحل — استعمل «إتمام وطباعة»");

        var clientId = OnlineOrderIds.SaleClientId(order.Id);
        var clientGuid = OnlineOrderIds.SaleGuid(order.Id);
        var cashier = await cashiers.GetByIdAsync(cashierId, ct);
        var cashierName = string.IsNullOrWhiteSpace(cashier?.AccountName) ? cashier?.Username ?? $"#{cashierId}" : cashier!.AccountName!;
        var terminal = string.IsNullOrWhiteSpace(req.HwId) ? (req.PosId is > 0 ? $"POS {req.PosId}" : null) : req.HwId;

        // فُوتر من قبل: بإيصالنا نفسه (رد ضاع) → نكمل الربط ونعيد بيانات الطباعة فقط؛ بإيصال آخر → رفض.
        if (site.Invoiced is not null)
        {
            if (!string.Equals(site.Invoiced.ClientReceiptId, clientId, StringComparison.Ordinal))
                throw new OnlineOrdersRefusal($"الطلب مُفوتر من قبل بالإيصال {site.Invoiced.ReceiptNumber}");
            var receiptId = (await repo.GetLinkAsync(order.Id, "sale", ct))?.ReceiptId
                ?? await repo.FindReceiptIdByClientIdAsync(clientGuid, ct)
                ?? throw new OnlineOrdersRefusal($"الطلب مُفوتر بالإيصال {site.Invoiced.ReceiptNumber} لكن الإيصال غير موجود في هذا المحل");
            var header = await repo.GetReceiptHeaderAsync(receiptId, ct);
            await repo.EnsureLinkAsync(NewLink(site, receiptId, header?.Number ?? 0, clientGuid, "sale", header?.TotalAmount ?? site.Receipt.Total, cashierId), ct);
            await repo.MarkReportedAsync(order.Id, "sale", site.Shipment?.TrackingNumber, ct);
            return await ResultAsync(site, receiptId, alreadyInvoiced: true, shipment: null, ct);
        }

        if (!site.CanInvoice)
        {
            var why = site.Blockers.Count > 0 ? string.Join(" — ", site.Blockers) : "الطلب غير جاهز للفوترة بعد";
            throw new OnlineOrdersRefusal(why, 409, new { blockers = site.Blockers });
        }
        if (req.ExpectedTotal is decimal expected && Math.Round(expected) != Math.Round(site.Receipt.Total))
            throw new OnlineOrdersRefusal($"تغيّر مبلغ الطلب منذ فتحه ({site.Receipt.Total:N0} بدل {expected:N0}) — راجع الطلب ثم أعد المحاولة");

        var plan = await PlanSaleAsync(site, settings, ct);
        if (plan.Problems.Count > 0)
            throw new OnlineOrdersRefusal(string.Join(" — ", plan.Problems), 409, new { problems = plan.Problems, unresolved = plan.Unresolved });

        var items = plan.Lines.Select(l => new CreateReceiptItemRequest(
            l.ArticleId, l.PosBarcode ?? l.Barcode, l.Qty, l.ChargePrice, l.ListPrice,
            Math.Max(0, l.ListPrice - l.ChargePrice))).ToList();
        if (plan.DeliveryFee > 0 && plan.DeliveryArticleId is long deliveryId)
            items.Add(new CreateReceiptItemRequest(deliveryId, plan.DeliveryBarcode, 1, plan.DeliveryFee, plan.DeliveryFee, 0));

        var credit = plan.AccountSeq is > 0;
        var create = new CreateReceiptRequest(
            CashierId: cashierId,
            SalesmanId: 0,
            PosId: req.PosId is > 0 ? req.PosId : null,
            Payment: credit ? 0 : site.Receipt.Total,
            Items: items,
            Kind: 0,
            IsPending: false,
            UserDiscount: site.Receipt.Discount,
            AccountId: credit ? plan.AccountSeq : null,
            ClientReceiptId: clientGuid,
            HwId: string.IsNullOrWhiteSpace(req.HwId) ? null : req.HwId);

        CreateReceiptResponse saved;
        try
        {
            saved = await receipts.CreateAsync(create, ct);
        }
        catch (InvalidOperationException ex)
        {
            throw new OnlineOrdersRefusal($"تعذر حفظ إيصال المحل: {ex.Message}", 400);
        }
        try
        {
            if (saved.Number > 0) await PosHubEvents.NotifyReceiptCreated(hub, saved.ReceiptId, saved.Number);
        }
        catch
        {
            /* البث المباشر لا يُفشل بيعاً محفوظاً */
        }

        await repo.EnsureLinkAsync(NewLink(site, saved.ReceiptId, saved.Number, clientGuid, "sale", saved.TotalAmount, cashierId), ct);
        logger.LogInformation("Online order {Order} saved as receipt {Number} ({Total})", order.OrderNumber, saved.Number, saved.TotalAmount);

        var body = new
        {
            code = order.Code,
            clientReceiptId = clientId,
            receiptNumber = saved.Number.ToString(),
            cashierName,
            cashierId = cashierId.ToString(),
            terminal,
            total = (long)Math.Round(saved.TotalAmount, MidpointRounding.AwayFromZero),
        };
        JsonElement res;
        try
        {
            res = pickup ? await bridge.PickupHandoverAsync(body, ct) : await bridge.InvoiceAsync(body, ct);
        }
        catch (OnlineOrdersException ex)
        {
            await repo.MarkReportFailedAsync(order.Id, "sale", ex.Message, CancellationToken.None);
            logger.LogWarning("Online order {Order}: receipt {Number} saved but the site refused/failed: {Message}", order.OrderNumber, saved.Number, ex.Message);
            throw new OnlineOrdersRefusal(
                $"حُفظ إيصال المحل رقم {saved.Number} لكن الموقع لم يسجّل {(pickup ? "التسليم" : "الفوترة")}: {ex.Message} — أعد المحاولة بنفس الزر (لن يتكرر الإيصال)",
                ex.Unreachable ? 424 : 409,
                new { receiptSaved = true, receiptNumber = saved.Number, unreachable = ex.Unreachable });
        }

        string? tracking = null;
        if (res.TryGetProperty("shipment", out var sh) && sh.ValueKind == JsonValueKind.Object
            && sh.TryGetProperty("trackingNumber", out var tn) && tn.ValueKind == JsonValueKind.String)
            tracking = tn.GetString();
        await repo.MarkReportedAsync(order.Id, "sale", tracking, ct);

        var shipment = res.TryGetProperty("shipment", out var s2) ? s2.Clone() : (JsonElement?)null;
        return await ResultAsync(site, saved.ReceiptId, alreadyInvoiced: false, shipment, ct, res);
    }

    private async Task<object> ResultAsync(SiteLookup site, long receiptId, bool alreadyInvoiced, JsonElement? shipment, CancellationToken ct, JsonElement? siteResult = null)
    {
        // بيانات الطباعة من الموقع: رد الفوترة يحملها؛ وإلا print-data (قراءة فقط).
        JsonElement print = siteResult is { } r && r.TryGetProperty("print", out var p) && p.ValueKind == JsonValueKind.Object
            ? p.Clone()
            : await bridge.PrintDataAsync(site.Order.Code, ct);
        string? tracking = null;
        if (print.TryGetProperty("shipment", out var ps) && ps.ValueKind == JsonValueKind.Object
            && ps.TryGetProperty("trackingNumber", out var t) && t.ValueKind == JsonValueKind.String)
            tracking = t.GetString();
        var receiptPrint = await ReceiptPrintAsync(receiptId, site, tracking, PaymentLabel(site), ct);
        return new
        {
            ok = true,
            alreadyInvoiced,
            receipt = new { id = receiptId, number = receiptPrint.ReceiptNumber, total = receiptPrint.Total },
            receiptPrint,
            print,
            shipment = shipment ?? (print.TryGetProperty("shipment", out var s) ? s.Clone() : (JsonElement?)null),
        };
    }

    // ───────────────────────── الإرجاع ─────────────────────────

    public async Task<object> ReturnAsync(long cashierId, OnlineOrderReturnRequest req, CancellationToken ct)
    {
        var settings = await repo.GetSettingsAsync(ct);
        if (!settings.Enabled)
            throw new OnlineOrdersRefusal("كاشير الطلبات متوقف — فعّله من لوحة التحكم ← الإعدادات ← طلبات التطبيق");
        var site = Parse(await bridge.LookupAsync(req.Code, ct));
        var order = site.Order;
        if (string.IsNullOrEmpty(order.Id)) throw new OnlineOrdersRefusal("الطلب غير موجود", 404);
        if (site.Invoiced is null) throw new OnlineOrdersRefusal("الطلب لم يُفوتر — لا يوجد إيصال بيع لإرجاعه");
        if (!ReturnStages.Contains(order.Stage ?? "", StringComparer.OrdinalIgnoreCase))
            throw new OnlineOrdersRefusal($"الطلب ليس مرتجعاً بعد (المرحلة: {order.Stage}) — ينتظر أن تعيده شركة التوصيل");

        var clientId = OnlineOrderIds.ReturnClientId(order.Id);
        var clientGuid = OnlineOrderIds.ReturnGuid(order.Id);
        var saleReceiptId = (await repo.GetLinkAsync(order.Id, "sale", ct))?.ReceiptId
            ?? await repo.FindReceiptIdByClientIdAsync(OnlineOrderIds.SaleGuid(order.Id), ct)
            ?? throw new OnlineOrdersRefusal($"إيصال البيع {site.Invoiced.ReceiptNumber} غير موجود في هذا المحل — أنشئ المرتجع يدوياً من الكاشير");

        var cashier = await cashiers.GetByIdAsync(cashierId, ct);
        var cashierName = string.IsNullOrWhiteSpace(cashier?.AccountName) ? cashier?.Username ?? $"#{cashierId}" : cashier!.AccountName!;
        var terminal = string.IsNullOrWhiteSpace(req.HwId) ? (req.PosId is > 0 ? $"POS {req.PosId}" : null) : req.HwId;

        var lines = (req.Lines ?? [])
            .Select(l => (Barcode: StoreSiteItems.NormalizeBarcode(l.Barcode), l.Qty))
            .Where(l => l.Barcode.Length > 0 && l.Qty > 0)
            .GroupBy(l => l.Barcode, StringComparer.OrdinalIgnoreCase)
            .Select(g => (Barcode: g.Key, Qty: g.Sum(x => x.Qty)))
            .ToList();

        var existing = await repo.GetLinkAsync(order.Id, "return", ct);
        CreateReceiptResponse saved;
        if (existing is not null)
        {
            saved = new CreateReceiptResponse(existing.ReceiptId, existing.ReceiptNumber, existing.Total, 0);
        }
        else
        {
            if (lines.Count == 0) throw new OnlineOrdersRefusal("امسح الأصناف الراجعة أولاً", 400);
            var source = await receipts.GetReturnSourceByIdAsync(saleReceiptId, ct)
                ?? throw new OnlineOrdersRefusal("إيصال البيع الأصلي غير موجود", 404);
            var header = await repo.GetReceiptHeaderAsync(saleReceiptId, ct);
            var remaining = source.Items.Select(i => new { i.ArticleId, i.Price, i.OriginalPrice, i.Barcode, Left = i.RemainingQty }).ToList();
            var left = remaining.Select(r => r.Left).ToArray();
            var items = new List<CreateReceiptItemRequest>();
            var problems = new List<string>();
            foreach (var (barcode, qty) in lines)
            {
                var product = await ResolveAsync(barcode, ct);
                if (product is null) { problems.Add($"{barcode}: غير موجود في كتالوج المحل"); continue; }
                var need = (decimal)qty;
                for (var i = 0; i < remaining.Count && need > 0; i++)
                {
                    if (remaining[i].ArticleId != product.Id || left[i] <= 0) continue;
                    var take = Math.Min(left[i], need);
                    left[i] -= take;
                    need -= take;
                    items.Add(new CreateReceiptItemRequest(product.Id, product.Barcode ?? barcode, take, remaining[i].Price,
                        Math.Max(remaining[i].OriginalPrice, remaining[i].Price), Math.Max(0, remaining[i].OriginalPrice - remaining[i].Price)));
                }
                if (need > 0) problems.Add($"{product.Name ?? barcode}: الكمية الراجعة أكبر من المباع بـ {need:0.##}");
            }
            if (req.IncludeDelivery && settings.DeliveryArticleId is long deliveryId)
            {
                for (var i = 0; i < remaining.Count; i++)
                {
                    if (remaining[i].ArticleId != deliveryId || left[i] <= 0) continue;
                    items.Add(new CreateReceiptItemRequest(deliveryId, remaining[i].Barcode, left[i], remaining[i].Price, remaining[i].Price, 0));
                    left[i] = 0;
                }
            }
            if (problems.Count > 0) throw new OnlineOrdersRefusal(string.Join(" — ", problems), 409, new { problems });
            if (items.Count == 0) throw new OnlineOrdersRefusal("لا يوجد ما يُرجع", 400);

            // خصم الفاتورة يُرجع بنسبة ما أُرجع؛ إرجاع كامل = الخصم كاملاً فيصفو الحساب.
            var sourceSubtotal = source.Items.Sum(i => i.SoldQty * i.Price);
            var returnSubtotal = items.Sum(i => i.Quantity * i.Price);
            var discount = header is { UserDiscount: > 0 } && sourceSubtotal > 0
                ? Math.Min(returnSubtotal, Math.Round(header.UserDiscount * returnSubtotal / sourceSubtotal, MidpointRounding.AwayFromZero))
                : 0;
            var account = header?.Account ?? 0;
            var create = new CreateReceiptRequest(
                CashierId: cashierId,
                SalesmanId: 0,
                PosId: req.PosId is > 0 ? req.PosId : null,
                Payment: account > 0 ? 0 : Math.Max(0, returnSubtotal - discount),
                Items: items,
                Kind: 1,
                IsPending: false,
                UserDiscount: discount,
                AccountId: account > 0 ? account : null,
                ClientReceiptId: clientGuid,
                ReturnOfReceiptId: saleReceiptId,
                HwId: string.IsNullOrWhiteSpace(req.HwId) ? null : req.HwId);
            try
            {
                saved = await receipts.CreateAsync(create, ct);
            }
            catch (InvalidOperationException ex)
            {
                throw new OnlineOrdersRefusal($"تعذر حفظ إيصال الإرجاع: {ex.Message}", 400);
            }
            try
            {
                if (saved.Number > 0) await PosHubEvents.NotifyReceiptCreated(hub, saved.ReceiptId, saved.Number);
            }
            catch
            {
                /* البث المباشر لا يُفشل إرجاعاً محفوظاً */
            }
            await repo.EnsureLinkAsync(NewLink(site, saved.ReceiptId, saved.Number, clientGuid, "return", saved.TotalAmount, cashierId), ct);
        }

        if (existing?.ReportedOk != true)
        {
            try
            {
                await bridge.ReturnAsync(new
                {
                    code = order.Code,
                    clientReceiptId = clientId,
                    receiptNumber = saved.Number.ToString(),
                    cashierName,
                    cashierId = cashierId.ToString(),
                    terminal,
                    lines = lines.Select(l => new { barcode = l.Barcode, qty = l.Qty }).ToList(),
                }, ct);
                await repo.MarkReportedAsync(order.Id, "return", null, ct);
            }
            catch (OnlineOrdersException ex)
            {
                await repo.MarkReportFailedAsync(order.Id, "return", ex.Message, CancellationToken.None);
                throw new OnlineOrdersRefusal(
                    $"حُفظ إيصال الإرجاع رقم {saved.Number} لكن الموقع لم يسجّله: {ex.Message} — أعد المحاولة (لن يتكرر الإيصال)",
                    ex.Unreachable ? 424 : 409,
                    new { receiptSaved = true, receiptNumber = saved.Number, unreachable = ex.Unreachable });
            }
        }

        var print = await ReceiptPrintAsync(saved.ReceiptId, site, site.Shipment?.TrackingNumber, "إيصال إرجاع", ct);
        return new { ok = true, already = existing is not null, receipt = new { id = saved.ReceiptId, number = saved.Number, total = saved.TotalAmount }, receiptPrint = print };
    }

    // ───────────────────────── البناء ─────────────────────────

    /// <summary>
    /// يحوّل أسطر إيصال الموقع إلى أسطر المحل. السعر المحفوظ (Price) هو ما دفعته الزبونة لأن مجموع الإيصال
    /// = Σ الكمية × Price − خصم الفاتورة؛ سعر الكتالوج الحالي يُحفظ في OriginalPrice والفرق في Discount
    /// (لكل قطعة، كما يفعل الكاشير)، فتظهر تخفيضات الموقع في تقارير العروض. الهدية بسعر صفر.
    /// </summary>
    public async Task<SalePlan> PlanSaleAsync(SiteLookup site, OnlineOrdersSettingsDto settings, CancellationToken ct)
    {
        var lines = new List<PlannedLine>();
        var unresolved = new List<string>();
        foreach (var item in site.Receipt.Items)
        {
            var charge = item.Free ? 0 : Math.Max(0, item.UnitPrice);
            var product = await ResolveAsync(item.Barcode, ct);
            if (product is null)
            {
                unresolved.Add(string.IsNullOrWhiteSpace(item.Barcode) ? $"(بلا باركود) {item.Name}" : $"{item.Barcode} — {item.Name}");
                lines.Add(new PlannedLine(item.Barcode, item.Name ?? "", item.Qty, charge, item.Free, item.Kind, 0, null, null, 0, charge, false, false));
                continue;
            }
            var posList = product.OriginalPrice > 0 ? product.OriginalPrice : product.Price;
            var list = Math.Max(posList, charge);
            lines.Add(new PlannedLine(
                item.Barcode, item.Name ?? product.Name ?? "", item.Qty, charge, item.Free, item.Kind,
                product.Id, product.Name, product.Barcode, product.Price, list,
                !item.Free && Math.Abs(product.Price - charge) >= 1, true));
        }

        var problems = new List<string>();
        if (!settings.Enabled) problems.Add("كاشير الطلبات متوقف من لوحة التحكم");
        if (unresolved.Count > 0)
            problems.Add($"أصناف غير موجودة في كتالوج المحل: {string.Join("، ", unresolved)} — أضف الباركود للمادة في الإداري ثم أعد فتح الطلب");

        var fee = Math.Max(0, site.Receipt.Shipping) + Math.Max(0, site.Receipt.GiftWrap);
        long? deliveryId = null;
        string? deliveryName = settings.DeliveryArticleName, deliveryBarcode = null;
        if (fee > 0)
        {
            var art = settings.DeliveryArticleId is > 0 ? await products.GetByIdAnyPriceAsync(settings.DeliveryArticleId.Value, ct) : null;
            if (art is null)
                problems.Add("الطلب فيه أجور توصيل/تغليف ولم تُضبط مادة «أجور التوصيل» — لوحة التحكم ← الإعدادات ← طلبات التطبيق");
            else
            {
                deliveryId = art.Id;
                deliveryName = art.Name ?? deliveryName;
                deliveryBarcode = art.Barcode;
            }
        }

        var pickup = site.Order.IsPickup;
        long? account = null;
        string? accountName = null;
        string paymentLabel;
        if (site.Order.Prepaid)
        {
            account = settings.PrepaidAccount;
            accountName = settings.PrepaidAccountName ?? settings.PrepaidAccountNum;
            paymentLabel = "مدفوع مسبقاً بالبطاقة";
            if (account is not > 0) problems.Add("حساب «الدفع المسبق بالبطاقة» غير مضبوط — لوحة التحكم ← الإعدادات ← طلبات التطبيق");
        }
        else if (!pickup)
        {
            account = settings.HiExpressAccount;
            accountName = settings.HiExpressAccountName ?? settings.HiExpressAccountNum;
            paymentLabel = "الدفع عند الاستلام — هاي إكسبريس";
            if (account is not > 0) problems.Add("حساب «هاي إكسبريس» غير مضبوط — لوحة التحكم ← الإعدادات ← طلبات التطبيق");
        }
        else
        {
            paymentLabel = "نقداً عند الاستلام من المحل";
        }

        var computed = lines.Sum(l => l.Qty * l.ChargePrice) + (deliveryId is not null ? fee : 0) - site.Receipt.Discount;
        if (unresolved.Count == 0 && (fee == 0 || deliveryId is not null) && Math.Abs(computed - site.Receipt.Total) >= 1)
            problems.Add($"مجموع الأسطر ({computed:N0}) لا يساوي مبلغ الطلب ({site.Receipt.Total:N0}) — أعد فتح الطلب");

        return new SalePlan(lines, unresolved, fee, deliveryId, deliveryName, deliveryBarcode,
            account is > 0 ? account : null, accountName, paymentLabel, computed, problems);
    }

    /// <summary>
    /// باركود الموقع ← مادة المحل. الموقع يرفع الباركود، أو رقم المادة إن لم يكن باركود،
    /// أو «POS:Seq» للمادة الثانية بنفس الباركود، أو Seq وحده لمادة بلا باركود ولا رقم (StoreSiteItems.ResolveBarcode).
    /// </summary>
    public async Task<ProductDto?> ResolveAsync(string? barcode, CancellationToken ct)
    {
        var code = StoreSiteItems.NormalizeBarcode(barcode);
        if (code.Length == 0) return null;
        if (code.StartsWith("POS:", StringComparison.OrdinalIgnoreCase))
            return long.TryParse(code[4..], out var posSeq) ? await products.GetBySeqAsync(posSeq, ct) : null;
        var p = await products.GetByBarcodeAsync(code, ct);
        if (p is not null) return p;
        if (long.TryParse(code, out var seq))
        {
            var bySeq = await products.GetBySeqAsync(seq, ct);
            if (bySeq is not null && string.IsNullOrWhiteSpace(bySeq.Barcode) && string.IsNullOrWhiteSpace(bySeq.Num))
                return bySeq;
        }
        return null;
    }

    private static string PaymentLabel(SiteLookup site) =>
        site.Order.Prepaid ? "مدفوع مسبقاً بالبطاقة"
        : site.Order.IsPickup ? "نقداً عند الاستلام من المحل"
        : "الدفع عند الاستلام — هاي إكسبريس";

    private static OnlineOrderReceiptLinkDto NewLink(SiteLookup site, long receiptId, long number, Guid clientGuid, string kind, decimal total, long cashierId) => new()
    {
        OrderId = site.Order.Id,
        OrderNumber = string.IsNullOrWhiteSpace(site.Order.OrderNumber) ? site.Order.Code : site.Order.OrderNumber,
        ReceiptId = receiptId,
        ReceiptNumber = number,
        ClientReceiptId = clientGuid,
        Kind = kind,
        DeliveryOption = site.Order.DeliveryOption,
        TrackingNumber = site.Shipment?.TrackingNumber,
        Total = total,
        CashierId = cashierId,
    };

    /// <summary>إيصال المحل للطباعة بنفس قالب الكاشير (ReceiptPrintPreviewDto) + رقم الطلب والتتبع والزبونة.</summary>
    private async Task<OnlineReceiptPrint> ReceiptPrintAsync(long receiptId, SiteLookup site, string? tracking, string paymentLabel, CancellationToken ct)
    {
        var detail = await receipts.GetByIdAsync(receiptId, ct)
            ?? throw new OnlineOrdersRefusal("إيصال المحل غير موجود", 404);
        var header = await repo.GetReceiptHeaderAsync(receiptId, ct);
        var lines = detail.Items.Select(i => new OnlineReceiptPrintLine(
            i.Name ?? i.Barcode ?? $"#{i.ArticleId}", i.Barcode ?? "", "", Math.Abs(i.Quantity), i.Price,
            Math.Abs(i.Quantity) * i.Price, Math.Max(i.OriginalPrice, i.Price))).ToList();
        string? cashierName = null;
        var link = (await repo.ListLinksAsync(site.Order.Id, ct)).FirstOrDefault(l => l.ReceiptId == receiptId);
        if (link is not null)
        {
            var c = await cashiers.GetByIdAsync(link.CashierId, ct);
            cashierName = string.IsNullOrWhiteSpace(c?.AccountName) ? c?.Username : c!.AccountName;
        }
        return new OnlineReceiptPrint(
            ReceiptNumber: detail.Number,
            PrintedAt: detail.CreationDate.ToString("o"),
            Kind: header?.Kind ?? 0,
            CashierName: cashierName,
            Lines: lines,
            SubTotal: lines.Sum(l => l.LineTotal),
            UserDiscount: detail.UserDiscount,
            Total: detail.TotalAmount,
            Paid: detail.Payment,
            Change: 0,
            OrderNumber: string.IsNullOrWhiteSpace(site.Order.OrderNumber) ? site.Order.Code : site.Order.OrderNumber,
            TrackingNumber: string.IsNullOrWhiteSpace(tracking) ? link?.TrackingNumber : tracking,
            CustomerName: site.Customer?.Name,
            PaymentLabel: paymentLabel);
    }
}

public sealed record OnlineReceiptPrintLine(
    string Name, string Barcode, string ArticleNumber, decimal Quantity, decimal UnitPrice, decimal LineTotal, decimal OriginalPrice);

/// <summary>نفس حقول ReceiptPrintPreviewDto في fot-shared + حقول الطلب.</summary>
public sealed record OnlineReceiptPrint(
    long ReceiptNumber,
    string PrintedAt,
    int Kind,
    string? CashierName,
    IReadOnlyList<OnlineReceiptPrintLine> Lines,
    decimal SubTotal,
    decimal UserDiscount,
    decimal Total,
    decimal Paid,
    decimal Change,
    string? OrderNumber,
    string? TrackingNumber,
    string? CustomerName,
    string? PaymentLabel);
