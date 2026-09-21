using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin.Services;

public sealed class ApiService
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private string _baseUrl = "http://localhost:5000";

    public string BaseUrl => _baseUrl;
    public bool IsRemote { get; private set; }
    public string? Token { get; private set; }
    public UserDto? CurrentUser { get; private set; }

    public void Configure(string baseUrl, bool isRemote = false)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        IsRemote = isRemote;
    }

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

    public Task<ServerInfoDto?> GetServerInfoAsync() => GetAsync<ServerInfoDto>("/api/server/info");

    public async Task<bool> LoginAsync(string username, string password)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/auth/login", new LoginRequest(username, password));
        if (!res.IsSuccessStatusCode) return false;
        var body = await res.Content.ReadFromJsonAsync<LoginResponse>(Json);
        if (body is null) return false;
        Token = body.Token;
        CurrentUser = body.User;
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        return true;
    }

    public void Logout()
    {
        Token = null;
        CurrentUser = null;
        _http.DefaultRequestHeaders.Authorization = null;
    }

    public Task<DashboardStatsDto?> GetStatsAsync() => GetAsync<DashboardStatsDto>("/api/dashboard/stats");
    public Task<List<ReceiptSummaryDto>?> GetRecentReceiptsAsync() => GetAsync<List<ReceiptSummaryDto>>("/api/dashboard/recent-receipts?limit=8");
    public Task<List<PosTerminalDto>?> GetTerminalsAsync() => GetAsync<List<PosTerminalDto>>("/api/dashboard/terminals");
    public Task<PagedResult<ProductDto>?> GetProductsAsync(int page, string? search) =>
        GetAsync<PagedResult<ProductDto>>($"/api/products?page={page}&pageSize=50{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");
    public Task<PagedResult<OfferDto>?> GetOffersAsync(int page) =>
        GetAsync<PagedResult<OfferDto>>($"/api/offers?page={page}&pageSize=50");
    public Task<PagedResult<ReceiptSummaryDto>?> GetReceiptsAsync(int page, string? search) =>
        GetAsync<PagedResult<ReceiptSummaryDto>>($"/api/receipts?page={page}&pageSize=50{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");

    public Task<ReceiptSearchResult?> SearchReceiptsAsync(
        int page, int pageSize, string? search, long? sectionId, long? posId, long? cashierId,
        int? kind, bool? synced, DateTime? from, DateTime? to)
    {
        var q = new List<string> { $"page={page}", $"pageSize={pageSize}" };
        if (!string.IsNullOrWhiteSpace(search)) q.Add($"search={Uri.EscapeDataString(search)}");
        if (sectionId.HasValue) q.Add($"sectionId={sectionId}");
        if (posId.HasValue) q.Add($"posId={posId}");
        if (cashierId.HasValue) q.Add($"cashierId={cashierId}");
        if (kind.HasValue) q.Add($"kind={kind}");
        if (synced == true) q.Add("synced=true");
        if (synced == false) q.Add("synced=false");
        if (from.HasValue) q.Add($"from={from:yyyy-MM-dd}");
        if (to.HasValue) q.Add($"to={to:yyyy-MM-dd}");
        return GetAsync<ReceiptSearchResult>($"/api/receipts?{string.Join("&", q)}");
    }

    public Task<List<SectionTerminalGroupDto>?> GetTerminalMonitorAsync() =>
        GetAsync<List<SectionTerminalGroupDto>>("/api/terminals/monitor");

    public Task<List<CashierActivityDto>?> GetCashierActivityAsync(DateTime from, DateTime to, string? search) =>
        GetAsync<List<CashierActivityDto>>(
            $"/api/activity/cashier?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}&limit=300{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");
    public Task<ReceiptDetailDto?> GetReceiptAsync(long id) => GetAsync<ReceiptDetailDto>($"/api/receipts/{id}");
    public Task<PagedResult<SalesmanDto>?> GetSalesmenAsync(int page) =>
        GetAsync<PagedResult<SalesmanDto>>($"/api/salesmen?page={page}&pageSize=100");
    public Task<List<SectionDto>?> GetSectionsAsync() => GetAsync<List<SectionDto>>("/api/sections?summary=false");
    public Task<List<SectionSummaryDto>?> GetSectionSummariesAsync() => GetAsync<List<SectionSummaryDto>>("/api/sections?summary=true");
    public Task<SectionDetailDto?> GetSectionDetailAsync(long id) => GetAsync<SectionDetailDto>($"/api/sections/{id}");
    public async Task<(SectionSaveResponse? Result, string? Error)> CreateSectionAsync(CreateSectionRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/sections", req);
        if (res.IsSuccessStatusCode)
            return (await res.Content.ReadFromJsonAsync<SectionSaveResponse>(Json), null);
        return (null, await res.Content.ReadAsStringAsync());
    }
    public async Task<(SectionSaveResponse? Result, string? Error)> UpdateSectionAsync(long id, UpdateSectionRequest req)
    {
        var res = await _http.PutAsJsonAsync($"{_baseUrl}/api/sections/{id}", req);
        if (res.IsSuccessStatusCode)
            return (await res.Content.ReadFromJsonAsync<SectionSaveResponse>(Json), null);
        return (null, await res.Content.ReadAsStringAsync());
    }
    public async Task<(bool Ok, string? Error)> DeleteSectionAsync(long id)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/sections/{id}");
        if (res.IsSuccessStatusCode) return (true, null);
        return (false, await ReadApiErrorAsync(res));
    }
    public Task<List<EdariBranchDto>?> GetEdariBranchesAsync() => GetAsync<List<EdariBranchDto>>("/api/edari/branches");
    public async Task<bool> SyncEdariBranchesAsync()
    {
        var res = await _http.PostAsync($"{_baseUrl}/api/edari/sync/branches", null);
        return res.IsSuccessStatusCode;
    }
    public Task<PagedResult<CashierDto>?> GetCashiersAsync(int page = 1, string? search = null) =>
        GetAsync<PagedResult<CashierDto>>($"/api/cashiers?page={page}&pageSize=50{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");
    public Task<CashierDetailDto?> GetCashierDetailAsync(long id) => GetAsync<CashierDetailDto>($"/api/cashiers/{id}");
    public async Task<(long? Id, string? Error)> CreateCashierAsync(CreateCashierRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/cashiers", req);
        if (res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadFromJsonAsync<Dictionary<string, long>>(Json);
            return (body?.GetValueOrDefault("id"), null);
        }
        var err = await res.Content.ReadAsStringAsync();
        return (null, err);
    }
    public async Task<(bool Ok, string? Error)> UpdateCashierAsync(long id, UpdateCashierRequest req)
    {
        var res = await _http.PutAsJsonAsync($"{_baseUrl}/api/cashiers/{id}", req);
        if (res.IsSuccessStatusCode) return (true, null);
        return (false, await res.Content.ReadAsStringAsync());
    }
    public async Task<bool> DeleteCashierAsync(long id)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/cashiers/{id}");
        return res.IsSuccessStatusCode;
    }

    public Task<List<PosTerminalDetailDto>?> GetPosTerminalsAsync() =>
        GetAsync<List<PosTerminalDetailDto>>("/api/terminals");
    public Task<PosTerminalDetailDto?> GetTerminalAsync(long id) =>
        GetAsync<PosTerminalDetailDto>($"/api/terminals/{id}");
    public async Task<bool> UpdateTerminalAsync(long id, UpdateTerminalRequest req)
    {
        var res = await _http.PatchAsJsonAsync($"{_baseUrl}/api/terminals/{id}", req);
        return res.IsSuccessStatusCode;
    }
    public async Task<long?> RegisterTerminalAsync(RegisterTerminalRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/terminals/register", req);
        if (!res.IsSuccessStatusCode) return null;
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, long>>(Json);
        return body?.GetValueOrDefault("id");
    }
    public async Task<bool> DeleteTerminalAsync(long id)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/terminals/{id}");
        return res.IsSuccessStatusCode;
    }
    public Task<List<CashierActivityDto>?> GetTerminalActivityAsync(long id, int limit = 25) =>
        GetAsync<List<CashierActivityDto>>($"/api/terminals/{id}/activity?limit={limit}");
    public Task<List<CommissionRuleDto>?> GetCommissionRulesAsync() =>
        GetAsync<List<CommissionRuleDto>>("/api/commissions/rules");
    public Task<List<CommissionGroupDto>?> GetCommissionGroupsAsync() =>
        GetAsync<List<CommissionGroupDto>>("/api/commissions/groups");
    public Task<CommissionGroupDetailDto?> GetCommissionGroupAsync(long id) =>
        GetAsync<CommissionGroupDetailDto>($"/api/commissions/groups/{id}");
    public async Task<long?> CreateCommissionGroupAsync(CreateCommissionGroupRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/groups", req);
        if (!res.IsSuccessStatusCode) return null;
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, long>>(Json);
        return body?.GetValueOrDefault("id");
    }
    public async Task<bool> UpdateCommissionGroupAsync(long id, UpdateCommissionGroupRequest req)
    {
        var res = await _http.PutAsJsonAsync($"{_baseUrl}/api/commissions/groups/{id}", req);
        return res.IsSuccessStatusCode;
    }
    public async Task<bool> DeleteCommissionGroupAsync(long id)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/commissions/groups/{id}");
        return res.IsSuccessStatusCode;
    }
    public async Task<CommissionGroupTreeApplyResult?> AddCommissionGroupTreeAsync(long groupId, long treeSeq, string? treeName)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/groups/{groupId}/trees",
            new AddCommissionGroupTreeRequest(treeSeq, treeName));
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<CommissionGroupTreeApplyResult>(Json);
    }
    public async Task<CommissionGroupItemDto?> AddCommissionGroupProductAsync(long groupId, string barcode)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/groups/{groupId}/products",
            new AddCommissionGroupProductRequest(null, barcode));
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<CommissionGroupItemDto>(Json);
    }
    public async Task<CommissionGroupItemDto?> AddCommissionGroupProductByIdAsync(long groupId, long articleId)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/groups/{groupId}/products",
            new AddCommissionGroupProductRequest(articleId, null));
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<CommissionGroupItemDto>(Json);
    }
    public async Task<bool> DeleteCommissionGroupTreeAsync(long groupId, long treeSeq)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/commissions/groups/{groupId}/trees/{treeSeq}");
        return res.IsSuccessStatusCode;
    }
    public async Task<bool> DeleteCommissionGroupItemAsync(long groupId, long itemId)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/commissions/groups/{groupId}/items/{itemId}");
        return res.IsSuccessStatusCode;
    }
    public async Task<int> MoveCommissionGroupTreeAsync(long fromGroupId, long treeSeq, long toGroupId)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/groups/move-tree",
            new MoveCommissionGroupTreeRequest(fromGroupId, treeSeq, toGroupId));
        if (!res.IsSuccessStatusCode) return 0;
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, int>>(Json);
        return body?.GetValueOrDefault("moved") ?? 0;
    }
    public async Task<int> MoveCommissionGroupItemsAsync(long[] itemIds, long toGroupId)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/groups/move-items",
            new MoveCommissionGroupItemsRequest(itemIds, toGroupId));
        if (!res.IsSuccessStatusCode) return 0;
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, int>>(Json);
        return body?.GetValueOrDefault("moved") ?? 0;
    }
    public Task<List<TargetRuleDto>?> GetTargetRulesAsync() =>
        GetAsync<List<TargetRuleDto>>("/api/targets/rules");
    public Task<List<TargetProgressDto>?> GetTargetProgressAsync() =>
        GetAsync<List<TargetProgressDto>>("/api/targets/progress");
    public Task<bool> SetOfferEnabledAsync(long id, bool enabled) =>
        PatchAsync($"/api/offers/{id}/enabled?enabled={enabled.ToString().ToLower()}");
    public Task<bool> UpdateProductAsync(long id, UpdateProductRequest req) =>
        PatchProductAsync($"/api/products/{id}", req);
    public Task<List<DailySalesRowDto>?> GetDailySalesReportAsync(DateTime from, DateTime to) =>
        GetAsync<List<DailySalesRowDto>>($"/api/reports/daily-sales?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");
    public Task<List<SalesmanSalesRowDto>?> GetSalesBySalesmanAsync(DateTime from, DateTime to) =>
        GetAsync<List<SalesmanSalesRowDto>>($"/api/reports/sales-by-salesman?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");
    public Task<List<MovementRowDto>?> GetMovementReportAsync(DateTime from, DateTime to, string? search) =>
        GetAsync<List<MovementRowDto>>($"/api/reports/movement?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");
    public Task<EdariSyncStatusDto?> GetEdariStatusAsync() => GetAsync<EdariSyncStatusDto>("/api/edari/status");
    public Task<List<ReceiptSummaryDto>?> GetEdariUnsyncedAsync() => GetAsync<List<ReceiptSummaryDto>>("/api/edari/unsynced?limit=100");
    public Task<List<EdariSyncLogDto>?> GetEdariLogsAsync() => GetAsync<List<EdariSyncLogDto>>("/api/edari/logs?limit=100");
    public Task<EdariSettingsDto?> GetEdariSettingsAsync() => GetAsync<EdariSettingsDto>("/api/edari/settings");
    public async Task<bool> SaveEdariSettingsAsync(UpdateEdariSettingsRequest req)
    {
        var res = await _http.PutAsJsonAsync($"{_baseUrl}/api/edari/settings", req);
        return res.IsSuccessStatusCode;
    }
    public Task<EdariConnectionTestResult?> TestEdariConnectionAsync() =>
        PostAsync<EdariConnectionTestResult>("/api/edari/test-connection");
    public Task<EdariSyncRunResult?> SyncEdariReceiptsAsync() =>
        PostAsync<EdariSyncRunResult>("/api/edari/sync/receipts?batchSize=50");
    public Task<EdariDataPullResultDto?> SyncEdariPullAsync(bool catalog = true) =>
        PostAsync<EdariDataPullResultDto>($"/api/edari/sync/pull?catalog={catalog.ToString().ToLowerInvariant()}");
    public Task<EdariFullSyncResult?> SyncEdariFullAsync(bool catalog = true, bool receipts = true) =>
        PostAsync<EdariFullSyncResult>(
            $"/api/edari/sync/full?catalog={catalog.ToString().ToLowerInvariant()}&receipts={receipts.ToString().ToLowerInvariant()}&receiptBatch=50");
    public Task<EdariSyncRunResult?> SyncEdariCatalogAsync() =>
        PostAsync<EdariSyncRunResult>("/api/edari/sync/catalog");
    public Task<List<EdariTreeNodeDto>?> GetEdariMaterialTreeAsync(long? parent = null, string? search = null) =>
        GetAsync<List<EdariTreeNodeDto>>($"/api/edari/tree/materials?limit=200{(parent.HasValue ? $"&parent={parent}" : "")}{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");
    public async Task<bool> CreateCommissionRuleAsync(CreateCommissionRuleRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/commissions/rules", req);
        return res.IsSuccessStatusCode;
    }
    public async Task<bool> CreateTargetRuleAsync(CreateTargetRuleRequest req)
    {
        var res = await _http.PostAsJsonAsync($"{_baseUrl}/api/targets/rules", req);
        return res.IsSuccessStatusCode;
    }
    public Task<List<ArticleGroupDto>?> GetGroupsAsync() => GetAsync<List<ArticleGroupDto>>("/api/groups");
    public Task<List<ArticleGroupItemDto>?> GetGroupItemsAsync(long id) => GetAsync<List<ArticleGroupItemDto>>($"/api/groups/{id}/items");
    public Task<List<AccountSummaryDto>?> GetCreditAccountsAsync() => GetAsync<List<AccountSummaryDto>>("/api/accounts/credit");
    public Task<List<AccountSummaryDto>?> SearchCashBoxAccountsAsync(string? search = null) =>
        GetAsync<List<AccountSummaryDto>>($"/api/accounts/cashbox/edari{(string.IsNullOrWhiteSpace(search) ? "" : $"?search={Uri.EscapeDataString(search)}")}");
    public Task<PrintSettingsDto?> GetPrintSettingsAsync() => GetAsync<PrintSettingsDto>("/api/settings/print");
    public async Task<PrintSettingsDto?> SavePrintSettingsAsync(UpdatePrintSettingsRequest req)
    {
        var res = await _http.PutAsJsonAsync($"{_baseUrl}/api/settings/print", req);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<PrintSettingsDto>(Json);
    }
    public async Task<PrintSettingsDto?> UploadPrintLogoAsync(string filePath)
    {
        await using var stream = File.OpenRead(filePath);
        using var content = new MultipartFormDataContent();
        content.Add(new StreamContent(stream), "file", Path.GetFileName(filePath));
        var res = await _http.PostAsync($"{_baseUrl}/api/settings/print/logo", content);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<PrintSettingsDto>(Json);
    }
    public async Task<PrintSettingsDto?> DeletePrintLogoAsync()
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/settings/print/logo");
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<PrintSettingsDto>(Json);
    }
    public Task<CashReportDto?> GetCashReportAsync(DateTime from, DateTime to) =>
        GetAsync<CashReportDto>($"/api/reports/cash?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");
    public Task<List<OfferDetailDto>?> GetOfferDetailsAsync(long id) => GetAsync<List<OfferDetailDto>>($"/api/offers/{id}/details");
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
    public async Task<bool> DeleteOfferAsync(long id)
    {
        var res = await _http.DeleteAsync($"{_baseUrl}/api/offers/{id}");
        return res.IsSuccessStatusCode;
    }
    public Task<List<ArticleTreeNodeDto>?> GetArticleTreeAsync(long? parent = null, string? search = null) =>
        GetAsync<List<ArticleTreeNodeDto>>($"/api/articles/tree?limit=200{(parent.HasValue ? $"&parent={parent}" : "")}{(string.IsNullOrWhiteSpace(search) ? "" : $"&search={Uri.EscapeDataString(search)}")}");
    public async Task<int?> GetTreeProductCountAsync(long seq, bool preferEdari = false)
    {
        var path = preferEdari
            ? $"/api/edari/tree/{seq}/product-count"
            : $"/api/articles/tree/{seq}/product-count";
        var res = await _http.GetAsync($"{_baseUrl}{path}");
        if (!res.IsSuccessStatusCode && preferEdari)
            return await GetTreeProductCountAsync(seq, false);
        if (!res.IsSuccessStatusCode) return null;
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, int>>(Json);
        return body?.GetValueOrDefault("count");
    }
    public Task<List<string>?> GetTreePathAsync(long seq) =>
        GetAsync<List<string>>($"/api/articles/tree/{seq}/path");
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
    public Task<List<ProductDto>?> SearchProductsAsync(string q) =>
        GetAsync<List<ProductDto>>($"/api/products/search?q={Uri.EscapeDataString(q)}&limit=40");

    private async Task<bool> PatchProductAsync(string path, UpdateProductRequest req)
    {
        var res = await _http.PatchAsJsonAsync($"{_baseUrl}{path}", req);
        return res.IsSuccessStatusCode;
    }

    private async Task<bool> PatchAsync(string path)
    {
        var res = await _http.PatchAsync($"{_baseUrl}{path}", null);
        return res.IsSuccessStatusCode;
    }

    private async Task<T?> PostAsync<T>(string path)
    {
        var res = await _http.PostAsync($"{_baseUrl}{path}", null);
        if (!res.IsSuccessStatusCode) return default;
        return await res.Content.ReadFromJsonAsync<T>(Json);
    }

    private async Task<T?> GetAsync<T>(string path)
    {
        var res = await _http.GetAsync($"{_baseUrl}{path}");
        if (!res.IsSuccessStatusCode) return default;
        return await res.Content.ReadFromJsonAsync<T>(Json);
    }

    private static async Task<string> ReadApiErrorAsync(HttpResponseMessage res)
    {
        var body = await res.Content.ReadAsStringAsync();
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var err))
                return err.GetString() ?? body;
        }
        catch { }
        return string.IsNullOrWhiteSpace(body) ? "فشل الطلب" : body;
    }
}

public static class AppServices
{
    public static ApiService Api { get; } = new();
    public static PosHubClient Hub { get; } = new(Api);
}
