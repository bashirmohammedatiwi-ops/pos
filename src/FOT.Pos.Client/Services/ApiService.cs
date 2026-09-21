using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client.Services;

public sealed class ApiService
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private string _baseUrl = "http://localhost:5000";

    public string BaseUrl => _baseUrl;
    public PosSessionDto? Session { get; private set; }
    public long ActiveMasterAccount { get; private set; }
    public int ActiveMasterAccountBank { get; private set; }
    public long? SelectedSalesmanId { get; set; }
    public string? SelectedSalesmanName { get; set; }

    public void Configure(string baseUrl) => _baseUrl = baseUrl.TrimEnd('/');

    public async Task<bool> IsHealthyAsync() => (await ProbeAsync()).Ok;

    public async Task<ConnectionProbeResult> ProbeAsync()
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var res = await _http.GetAsync($"{_baseUrl}/health", cts.Token);
            if (res.IsSuccessStatusCode)
                return new ConnectionProbeResult(true, "متصل بالخادم ✓");
            return new ConnectionProbeResult(false, $"الخادم رفض الاتصال ({(int)res.StatusCode})");
        }
        catch (TaskCanceledException)
        {
            return new ConnectionProbeResult(false, "انتهت مهلة الاتصال — تحقق من عنوان IP والكابل");
        }
        catch (HttpRequestException)
        {
            return new ConnectionProbeResult(false, "تعذر الوصول للخادم — تحقق من Ethernet وأن الخادم يعمل");
        }
        catch
        {
            return new ConnectionProbeResult(false, "تعذر الاتصال بالخادم");
        }
    }

    public async Task<bool> CashierLoginByPinAsync(string pin)
    {
        var hwId = TerminalHelper.GetHwId();
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/auth/cashier-login",
            new CashierLoginRequest(null, pin, hwId));
        if (!res.IsSuccessStatusCode) return false;
        Session = await res.Content.ReadFromJsonAsync<PosSessionDto>(Json);
        if (Session is null) return false;
        ApplySession(Session);
        OfflineSessionStore.Save(Session, _baseUrl, pin);
        return true;
    }

    public bool RestoreOfflineSession(OfflineSessionCache cache)
    {
        Configure(cache.ServerUrl);
        Session = cache.Session;
        ApplySession(Session);
        return Session is not null;
    }

    private void ApplySession(PosSessionDto session)
    {
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.Token);
        SelectedSalesmanId = session.SalesmanId;
        SelectedSalesmanName = session.SalesmanName;
        ActiveMasterAccount = session.ActiveMasterAccount;
        ActiveMasterAccountBank = session.ActiveMasterAccountBank;
        AppServices.CardTerminal.Configure(
            session.MposService ?? CardTerminalService.DefaultService,
            session.MposComPort);
    }

    public async Task CacheReferenceDataAsync(CancellationToken ct = default)
    {
        if (!await IsOnlineAsync()) return;

        var salesmen = await GetSalesmenAsync();
        if (salesmen?.Items is { Count: > 0 })
            AppServices.Catalog.ReplaceSalesmen(salesmen.Items);

        var accounts = await GetCreditAccountsAsync();
        if (accounts is not null)
            AppServices.Catalog.ReplaceCreditAccounts(accounts);

        var attribution = await GetAttributionArticleIdsAsync();
        if (attribution is not null)
        {
            AppServices.Catalog.ReplaceAttributionArticles(attribution);
            AppServices.Attribution.Replace(attribution);
        }

        var print = await GetPrintSettingsAsync();
        if (print is not null)
            AppServices.Catalog.SavePrintSettings(print);
    }

    public void SetActiveCashBox(long masterAccount)
    {
        var box = Session?.CashBoxes.FirstOrDefault(b => b.MasterAccount == masterAccount);
        if (box is null) return;
        ActiveMasterAccount = box.MasterAccount;
        ActiveMasterAccountBank = box.MasterAccountBank;
    }

    public string ActiveCashBoxLabel()
    {
        var box = Session?.CashBoxes.FirstOrDefault(b => b.MasterAccount == ActiveMasterAccount);
        if (box is null) return "—";
        return string.IsNullOrWhiteSpace(box.MasterAccountNum)
            ? box.MasterAccountName ?? $"#{box.MasterAccount}"
            : $"{box.MasterAccountNum} — {box.MasterAccountName}";
    }

    public async Task HeartbeatAsync()
    {
        if (Session?.PosTerminalId is not long id) return;
        await _http.PostAsJsonAsync($"{_baseUrl}/api/terminals/{id}/heartbeat",
            new TerminalHeartbeatRequest("2.0"));
    }

    public async Task<IReadOnlyList<ProductDto>> SearchProductsAsync(string term)
    {
        var local = AppServices.Catalog.Search(term, 20);
        if (local.Count > 0 || !await IsOnlineAsync()) return local;

        var res = await _http.GetAsync($"{_baseUrl}/api/products/search?q={Uri.EscapeDataString(term)}&limit=20");
        if (!res.IsSuccessStatusCode) return local;
        var online = await res.Content.ReadFromJsonAsync<List<ProductDto>>(Json) ?? [];
        AppServices.Catalog.UpsertProducts(online);
        return online;
    }

    public async Task<ProductAttributionDto?> GetProductAttributionAsync(long articleId, string? barcode) =>
        await GetAsync<ProductAttributionDto>(
            $"/api/pos/product-attribution?articleId={articleId}&barcode={Uri.EscapeDataString(barcode ?? "")}");

    public async Task<IReadOnlyList<long>?> GetAttributionArticleIdsAsync() =>
        await GetAsync<IReadOnlyList<long>>("/api/pos/attribution-articles");

    public async Task<IReadOnlyList<HoldReceiptDto>?> GetHoldReceiptsAsync() =>
        await GetAsync<IReadOnlyList<HoldReceiptDto>>($"/api/receipts/hold?posId={Session?.PosTerminalId}");

    public async Task<ReceiptDetailDto?> GetReceiptAsync(long id) =>
        await GetAsync<ReceiptDetailDto>($"/api/receipts/{id}");

    public async Task<ReceiptDetailDto?> CompleteHoldAsync(long id, decimal payment)
    {
        var res = await _http.PostAsync($"{_baseUrl}/api/receipts/hold/{id}/complete?payment={payment}", null);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<ReceiptDetailDto>(Json);
    }

    public async Task<IReadOnlyList<ArticleGroupDto>?> GetGroupsAsync() =>
        await GetAsync<IReadOnlyList<ArticleGroupDto>>("/api/groups");

    public async Task<IReadOnlyList<ArticleGroupItemDto>?> GetGroupItemsAsync(long groupId) =>
        await GetAsync<IReadOnlyList<ArticleGroupItemDto>>($"/api/groups/{groupId}/items");

    public async Task<IReadOnlyList<AccountSummaryDto>?> GetCreditAccountsAsync() =>
        await GetAsync<IReadOnlyList<AccountSummaryDto>>("/api/accounts/credit");

    public async Task<bool> IsOnlineAsync()
    {
        try
        {
            var res = await _http.GetAsync($"{_baseUrl}/health");
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public async Task<ProductDto?> GetByBarcodeAsync(string code)
    {
        var local = AppServices.Catalog.FindByBarcode(code);
        if (local is not null) return local;

        if (!await IsOnlineAsync()) return null;

        var res = await _http.GetAsync($"{_baseUrl}/api/products/barcode/{Uri.EscapeDataString(code)}");
        if (!res.IsSuccessStatusCode) return null;
        var product = await res.Content.ReadFromJsonAsync<ProductDto>(Json);
        if (product is not null) AppServices.Catalog.UpsertProducts([product]);
        return product;
    }

    public async Task<CatalogInfoDto?> GetCatalogInfoAsync() =>
        await GetAsync<CatalogInfoDto>("/api/catalog/info");

    public async Task<IReadOnlyList<ProductDto>?> SyncCatalogBatchAsync(long sinceSeq)
    {
        var res = await _http.GetAsync($"{_baseUrl}/api/catalog/sync?sinceSeq={sinceSeq}&pageSize=500");
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<List<ProductDto>>(Json);
    }

    /// <summary>Live product ids — the sync feed cannot express a deletion, so pruning needs this list.</summary>
    public async Task<CatalogIdsDto?> GetCatalogIdsAsync() =>
        await GetAsync<CatalogIdsDto>("/api/catalog/ids");

    public async Task<PagedResult<SalesmanDto>?> GetSalesmenAsync() =>
        await GetAsync<PagedResult<SalesmanDto>>("/api/salesmen?page=1&pageSize=200");

    public Task<PagedResult<OfferDto>?> GetOffersAsync() =>
        GetAsync<PagedResult<OfferDto>>("/api/offers?page=1&pageSize=200");

    public Task<List<OfferDetailDto>?> GetOfferDetailsAsync(long id, int? role = null) =>
        GetAsync<List<OfferDetailDto>>($"/api/offers/{id}/details{(role.HasValue ? $"?role={role}" : "")}");

    public Task<List<ArticleTreeNodeDto>?> GetArticleTreeAsync(long? parent = null, string? search = null) =>
        GetAsync<List<ArticleTreeNodeDto>>($"/api/articles/tree?limit=200{(parent.HasValue ? $"&parent={parent}" : "")}{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");

    public async Task<OfferTreeApplyResult?> AddOfferTreeAsync(long offerId, AddOfferTreeRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/offers/{offerId}/details/tree", req);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<OfferTreeApplyResult>(Json);
    }

    public async Task<int> DeleteOfferTreeBatchAsync(long offerId, long treeSeq)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/offers/{offerId}/tree/{treeSeq}");
        if (!res.IsSuccessStatusCode) return -1;
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, int>>(Json);
        return body?.GetValueOrDefault("removed") ?? 0;
    }

    public async Task<bool> DeleteOfferAsync(long id)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/offers/{id}");
        return res.IsSuccessStatusCode;
    }

    public async Task<bool> CreateOfferAsync(CreateOfferRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/offers", req);
        return res.IsSuccessStatusCode;
    }

    public async Task<bool> UpdateOfferAsync(long id, UpdateOfferRequest req)
    {
        var res = await _http.PatchAsJsonAsync($"{_baseUrl}/api/offers/{id}", req);
        return res.IsSuccessStatusCode;
    }

    public async Task<bool> AddOfferDetailAsync(long offerId, UpsertOfferDetailRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/offers/{offerId}/details", req);
        return res.IsSuccessStatusCode;
    }

    public async Task<bool> DeleteOfferDetailAsync(long detailId)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/offers/details/{detailId}");
        return res.IsSuccessStatusCode;
    }

    public Task<PrintSettingsDto?> GetPrintSettingsAsync() => GetAsync<PrintSettingsDto>("/api/settings/print");

    public async Task<CreateReceiptResponse?> CreateReceiptAsync(CreateReceiptRequest req) =>
        (await TryCreateReceiptAsync(req)).Response;

    public async Task<(CreateReceiptResponse? Response, string? Error)> TryCreateReceiptAsync(
        CreateReceiptRequest req, bool replayingPending = false)
    {
        req = EnsureClientReceiptId(req);
        var json = JsonSerializer.Serialize(req, Json);
        decimal Total() => req.Items.Sum(i => i.Quantity * i.Price) - req.UserDiscount;

        if (!await IsOnlineAsync())
        {
            if (!replayingPending)
            {
                var queued = AppServices.Catalog.EnqueueReceipt(json, req.ClientReceiptId!.Value);
                var total = Total();
                return (new CreateReceiptResponse(0, queued.LocalNumber, total, Math.Max(0, req.Payment - total)), null);
            }
            return (null, "غير متصل بالخادم");
        }

        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/receipts", req);
        if (!res.IsSuccessStatusCode)
        {
            var error = await ReadApiErrorAsync(res);
            if (!replayingPending)
            {
                var queued = AppServices.Catalog.EnqueueReceipt(json, req.ClientReceiptId!.Value);
                var total = Total();
                return (new CreateReceiptResponse(0, queued.LocalNumber, total, Math.Max(0, req.Payment - total)), null);
            }
            return (null, error);
        }

        var body = await res.Content.ReadFromJsonAsync<CreateReceiptResponse>(Json);
        return (body, null);
    }

    private static CreateReceiptRequest EnsureClientReceiptId(CreateReceiptRequest req) =>
        req.ClientReceiptId is null ? req with { ClientReceiptId = Guid.NewGuid() } : req;

    private static async Task<string> ReadApiErrorAsync(HttpResponseMessage res)
    {
        try
        {
            var raw = await res.Content.ReadAsStringAsync();
            if (string.IsNullOrWhiteSpace(raw)) return $"رفض الخادم ({(int)res.StatusCode})";
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("error", out var err))
                return err.GetString() ?? raw;
            return raw.Length > 180 ? raw[..180] : raw;
        }
        catch
        {
            return $"رفض الخادم ({(int)res.StatusCode})";
        }
    }

    private async Task<T?> GetAsync<T>(string path)
    {
        var res = await _http.GetAsync($"{_baseUrl}{path}");
        if (!res.IsSuccessStatusCode) return default;
        return await res.Content.ReadFromJsonAsync<T>(Json);
    }
}

public static class AppServices
{
    public static ApiService Api { get; } = new();
    public static LocalCatalogStore Catalog { get; } = new();
    public static CatalogSyncService Sync { get; } = new(Api, Catalog);
    public static PosSyncCoordinator Coordinator { get; } = new(Api, Sync, Catalog);
    public static PosHubClient Hub { get; } = new(Api);
    public static GroupItemsCache GroupCache { get; } = new();
    public static CardTerminalService CardTerminal { get; } = new();
    public static SalesAttributionCache Attribution { get; } = new();
}
