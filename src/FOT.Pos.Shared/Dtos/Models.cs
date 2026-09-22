using System.Text.Json.Serialization;
using FOT.Pos.Shared.Serialization;

namespace FOT.Pos.Shared.Dtos;

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(Total / (double)PageSize);
}

public record LoginRequest(string Username, string Password);
public record LoginResponse(string Token, UserDto User);
public record UserDto(long Id, string Username, string DisplayName, string Role);
public record SellerLoginRequest(long SalesmanId, string Pin);
public partial record SellerLookupDto(long Id, string Name);
public partial record SellerMeDto(long Id, string Name, bool MustChangePin);
public record SellerLoginResponse(string Token, SellerMeDto Seller);
public partial record SellerMallDto(
    long SectionId, string SectionName, string? BranchName,
    int ReceiptCount, decimal SalesAmount, decimal CommissionAmount);
public record SellerGoalDto(
    long RuleId, string RuleName, string TargetType,
    decimal Sold, decimal WeeklyTarget, decimal Percent);
public partial record SellerCommissionGroupDto(
    long Id, string Name, string CommissionType, decimal CommissionValue, int ProductCount);
public partial record SellerCommissionProductDto(
    long? ArticleId, string? Barcode, string? Name,
    long GroupId, string GroupName, string CommissionType, decimal CommissionValue);
public record SellerWeekSummaryDto(
    DateTime WeekStart, DateTime WeekEnd, bool IsCurrent,
    decimal SalesAmount, decimal CommissionAmount, int ReceiptCount, int MallCount);
public record SellerDashboardDto(
    SellerMeDto Seller,
    SellerWeekSummaryDto Week,
    decimal BalanceDue,
    IReadOnlyList<SellerMallDto> Malls,
    IReadOnlyList<SellerGoalDto> Goals);

public partial record SellerCommissionLineDto(
    long Id,
    string ProductName,
    string? GroupName,
    decimal Quantity,
    decimal CommissionAmount,
    long? ReceiptNumber,
    DateTime OccurredAt,
    string? MallName,
    decimal SalesAmount = 0,
    string? CashierName = null);

public record SellerCommissionBundleDto(
    decimal TotalCommission,
    int LineCount,
    IReadOnlyList<SellerCommissionLineDto> Lines);

public partial record SellerGoalLineDto(
    string ProductName,
    decimal Quantity,
    long? ReceiptNumber,
    DateTime OccurredAt,
    string? MallName);

public record SellerGoalDetailDto(
    long RuleId,
    string RuleName,
    string TargetType,
    decimal Sold,
    decimal WeeklyTarget,
    decimal Percent,
    IReadOnlyList<SellerGoalLineDto> Lines);

public partial record PortalSellerAccountDto(
    long SalesmanId,
    string Name,
    bool HasAccount,
    bool IsActive,
    string? PinDisplay,
    DateTime? LastLoginAt,
    DateTime? CreatedAt);

public partial record PortalManagerAccountDto(
    long Id,
    string Username,
    string DisplayName,
    bool IsActive,
    string? PasswordDisplay,
    DateTime CreatedAt);

public record ManagerLoginRequest(string Username, string Password);
public record ManagerMeDto(long Id, string Username, string DisplayName);
public record ManagerLoginResponse(string Token, ManagerMeDto Manager);
public record ManagerDashboardDto(
    ManagerMeDto Manager,
    ManagerWeekSummaryDto Week,
    IReadOnlyList<ManagerSellerRowDto> Sellers,
    IReadOnlyList<ManagerCashierRowDto> Cashiers,
    IReadOnlyList<ManagerMallRowDto> Malls,
    IReadOnlyList<ManagerGoalRowDto> Goals,
    IReadOnlyList<ManagerProductRowDto> Products,
    DateTime? LastSyncAt = null,
    IReadOnlyList<ManagerDayRowDto>? Days = null);
public record ManagerSellerDetailDto(
    ManagerSellerRowDto Seller,
    IReadOnlyList<ManagerGoalRowDto> Goals,
    IReadOnlyList<ManagerLineDto> Lines);
public record CreateManagerAccountRequest(string Username, string DisplayName, string Password);
public record ResetManagerPasswordRequest(string Password);
public record UpdateManagerAccountRequest(string DisplayName);
public record PortalBulkIssueResult(int Issued, IReadOnlyList<PortalSellerAccountDto> Sellers);
public record PortalWebProbeDto(bool VisibleOnWeb, string Message, string WebUrl, int? StatusCode);
public record PortalWebStatusDto(
    int SellerAccounts,
    int ActiveSellers,
    bool SavedOnShop,
    bool VisibleOnWeb,
    string Message,
    string WebUrl,
    int? StatusCode);
public record PortalPublishResult(
    PortalSellerAccountDto Account,
    bool SavedOnShop,
    bool VisibleOnWeb,
    string Message,
    string WebUrl);

public partial record SellerHubAccountDto(
    long Id,
    string Name,
    string? PinHash,
    bool IsActive,
    bool MustChangePin);

public record SellerHubWeekPackDto(
    DateTime WeekStart,
    SellerWeekSummaryDto Week,
    IReadOnlyList<SellerMallDto> Malls,
    IReadOnlyList<SellerGoalDto> Goals,
    SellerCommissionBundleDto Commission,
    IReadOnlyList<SellerGoalDetailDto> GoalDetails);

public record SellerHubSnapshotDto(
    SellerMeDto Me,
    decimal BalanceDue,
    IReadOnlyList<SellerWeekSummaryDto> Weeks,
    IReadOnlyList<SellerCommissionGroupDto> Groups,
    IReadOnlyList<SellerCommissionProductDto> Products,
    IReadOnlyList<SellerHubWeekPackDto> WeekPacks);

public record SellerHubSyncRequest(
    DateTime GeneratedAt,
    IReadOnlyList<SellerHubAccountDto> Accounts,
    IReadOnlyList<SellerHubSnapshotDto> Snapshots,
    IReadOnlyList<ManagerHubAccountDto>? Managers = null,
    ManagerHubSnapshotDto? ManagerSnapshot = null);

public partial record ManagerHubAccountDto(
    long Id,
    string Username,
    string DisplayName,
    string? PasswordHash,
    bool IsActive);

public record ManagerWeekSummaryDto(
    DateTime WeekStart,
    DateTime WeekEnd,
    bool IsCurrent,
    decimal SalesAmount,
    decimal CommissionAmount,
    int ReceiptCount,
    decimal PieceCount,
    int SellerCount,
    int CashierCount);

public record ManagerSellerRowDto(
    long SalesmanId,
    string Name,
    decimal SalesAmount,
    decimal CommissionAmount,
    int ReceiptCount,
    decimal PieceCount,
    int GoalCount,
    int GoalsHit,
    decimal GoalPercent,
    decimal BalanceDue);

public partial record ManagerCashierRowDto(
    long CashierId,
    string Name,
    decimal SalesAmount,
    decimal CommissionAmount,
    int ReceiptCount,
    decimal PieceCount);

public partial record ManagerMallRowDto(
    long SectionId,
    string SectionName,
    string? BranchName,
    decimal SalesAmount,
    decimal CommissionAmount,
    int ReceiptCount,
    decimal PieceCount);

public record ManagerGoalRowDto(
    long RuleId,
    string RuleName,
    string TargetType,
    long SalesmanId,
    string SalesmanName,
    decimal Sold,
    decimal WeeklyTarget,
    decimal Percent);

public partial record ManagerLineDto(
    long Id,
    long SalesmanId,
    string SalesmanName,
    string ProductName,
    string? GroupName,
    decimal Quantity,
    decimal SalesAmount,
    decimal CommissionAmount,
    int? ReceiptNumber,
    DateTime OccurredAt,
    string? CashierName,
    string? MallName);

public partial record ManagerProductRowDto(
    string Name,
    decimal Quantity,
    decimal SalesAmount,
    decimal CommissionAmount,
    int Count);

public partial record ManagerDayRowDto(
    DateTime Day,
    decimal SalesAmount,
    int ReceiptCount,
    decimal PieceCount);

public record ManagerWeekPackDto(
    DateTime WeekStart,
    ManagerWeekSummaryDto Week,
    IReadOnlyList<ManagerSellerRowDto> Sellers,
    IReadOnlyList<ManagerCashierRowDto> Cashiers,
    IReadOnlyList<ManagerMallRowDto> Malls,
    IReadOnlyList<ManagerGoalRowDto> Goals,
    IReadOnlyList<ManagerLineDto> Lines,
    IReadOnlyList<ManagerProductRowDto> Products,
    IReadOnlyList<ManagerDayRowDto> Days);

public record ManagerHubSnapshotDto(
    IReadOnlyList<ManagerWeekSummaryDto> Weeks,
    IReadOnlyList<ManagerWeekPackDto> WeekPacks);

public record DashboardStatsDto(
    int ActiveOffers,
    int EdariMaterials,
    int EdariTreeFolders,
    int EdariSalesmen,
    int EdariBranches,
    int LocalProducts,
    int LocalSections,
    string? EdariDatabaseAlias,
    bool EdariConnected,
    string? EdariConnectionMessage);

public record ProductDto(
    long Id,
    long Seq,
    string? Num,
    string? Name,
    string? Barcode,
    decimal OriginalPrice,
    decimal Price,
    decimal Stock,
    int DiscountPercent,
    string? OfferName,
    long ChangeVersion = 0,
    int StoredDiscountPercent = 0);

public partial record OfferDto(
    long Id,
    string Name,
    int Priority,
    bool Enabled,
    int Type,
    int DetailCount,
    int ActiveProductCount);

/// <summary>Counts only — for dashboard badges without loading offers.</summary>
public record OfferStatsDto(int Total, int Enabled, int Disabled, int DiscountedItems);

public record OfferDetailDto(
    long Id,
    long? ItemId,
    string? ItemName,
    decimal Discount,
    int DiscountType,
    DateTime? FromDate,
    DateTime? ToDate,
    bool Unlimited,
    int DetailRole = 0,
    long? SourceTreeSeq = null,
    string? SourceTreeName = null,
    bool Excluded = false,
    string? Barcode = null,
    decimal Price = 0);

/// <summary>One product currently under a tree, with its in-offer state — powers expandable tree cards.</summary>
public record OfferTreeProductDto(
    long Seq,
    string? Name,
    string? Barcode,
    decimal Price,
    bool InOffer,
    bool Excluded,
    decimal? Discount,
    long? DetailId = null);

/// <summary>Per-tree membership state for an offer batch: current Edari size vs what's in the offer.</summary>
public record OfferTreeStateDto(
    long TreeSeq,
    string? TreeName,
    int CurrentTreeCount,
    int InOfferCount,
    int ExcludedCount,
    int Drift,
    DateTime? LastSyncedAt);

public record OfferTreeCardDto(
    long TreeSeq,
    string? TreeName,
    int Count,
    int ExcludedCount,
    decimal Discount,
    DateTime? LastSyncedAt = null);

public record OfferScopeDto(
    IReadOnlyList<OfferTreeCardDto> Trees,
    IReadOnlyList<OfferDetailDto> Standalone,
    decimal DefaultDiscount,
    bool Unlimited = true,
    DateTime? FromDate = null,
    DateTime? ToDate = null);

public record EdariBranchDto(long Seq, string Name, string? Symbol);

/// <summary>A product under a tree (for scope previews in targets and generic tree expansion).</summary>
public partial record TreeProductInfoDto(
    long Seq,
    string? Name,
    string? Barcode,
    decimal Price)
{
    public TreeProductInfoDto() : this(0, null, null, 0) { }
}

public record ArticleTreeNodeDto(
    long Seq,
    long? Father,
    string? Name,
    string? Num,
    string? Barcode,
    bool IsFolder,
    bool HasChildren,
    decimal Price = 0);

public record AddOfferTreeRequest(
    long TreeSeq,
    decimal DiscountPercent,
    DateTime? FromDate,
    DateTime? ToDate,
    bool Unlimited);

public record AddOfferBulkRequest(
    IReadOnlyList<long> ItemIds,
    decimal DiscountPercent,
    int DetailRole,
    DateTime? FromDate,
    DateTime? ToDate,
    bool Unlimited);

public record OfferTreeApplyResult(int ProductsAdded, int Skipped, string? TreeName, int ProductsUpdated = 0);

public partial record ReceiptSummaryDto(
    long Id,
    long Number,
    DateTime CreationDate,
    decimal TotalAmount,
    decimal Payment,
    decimal CashBack,
    long SalesmanId,
    string? SalesmanName,
    long? PosId,
    string? PosName,
    bool Synced,
    long? EdrNum,
    int ItemCount,
    decimal ItemsDiscount = 0,
    decimal OffersDiscount = 0,
    decimal UserDiscount = 0,
    int Kind = 0,
    long? CashierId = null,
    string? CashierName = null,
    string? AccountName = null,
    long? SectionId = null,
    string? SectionName = null,
    DateTime? SyncDate = null,
    decimal? CardAmount = null,
    string? CardName = null,
    string? CardAcquirer = null,
    string? CardAccNo = null,
    string? CardRrn = null,
    string? CardTerminalId = null,
    string? CardAuthCode = null,
    DateTime? CardTransTime = null,
    string? CardType = null,
    string? CardRefNo = null,
    long? MasterAccount = null,
    string? CashBoxNum = null,
    string? CashBoxName = null,
    /// <summary>Distinct salesmen on the receipt's lines — more than one means it has no single owner.</summary>
    int SalesmanCount = 0,
    long? DiscountQrPersonId = null,
    string? DiscountQrPersonName = null,
    bool WasEdited = false,
    long? PrintedNumber = null)
{
    public ReceiptSummaryDto() : this(
        0, 0, default, 0, 0, 0, 0, null, null, null, false, null, 0)
    {
    }

    public decimal GrossAmount => TotalAmount + OffersDiscount + UserDiscount + ItemsDiscount;
    public decimal NetAmount => TotalAmount;
    public string DisplayNumber => Number > 0 ? Number.ToString() : "—";
    public string KindLabel => Kind switch { 1 => "مرتجع", 2 => "هدية", _ => "مبيعات" };
    public string SyncLabel => Synced ? (EdrNum?.ToString() ?? "نعم") : "—";
    public bool PaidByCard => CardAmount.HasValue;
}

public partial record ReceiptTotalsSummaryDto(
    int ReceiptCount,
    decimal GrossTotal,
    decimal NetTotal,
    decimal TotalPayment,
    decimal TotalCashBack,
    decimal TotalOffersDiscount,
    decimal TotalUserDiscount,
    decimal TotalItemsDiscount)
{
    public ReceiptTotalsSummaryDto() : this(0, 0, 0, 0, 0, 0, 0, 0)
    {
    }
}

public record ReceiptSearchResult(
    IReadOnlyList<ReceiptSummaryDto> Items,
    int Total,
    int Page,
    int PageSize,
    ReceiptTotalsSummaryDto Summary);

public record PosTerminalMonitorDto(
    long Id,
    string? Name,
    string? HwId,
    long? SectionId,
    string? SectionName,
    long MasterAccount,
    int MasterAccountBank,
    string? MasterAccountName,
    string? MasterAccountNum,
    DateTime? LastConnection,
    DateTime? LastSync,
    DateTime? LastUpdate,
    string? ExeVersion,
    bool Active,
    bool IsOnline,
    string PathLabel);

public record CashierActivityDto(
    long Id,
    string? CashierName,
    string EventType,
    string? EventLabel,
    string? PosPath,
    DateTime CreatedAt,
    long? ReceiptId,
    string? ReceiptNum,
    string? Message);

public record SectionTerminalGroupDto(
    long SectionId,
    string SectionName,
    IReadOnlyList<PosTerminalMonitorDto> Terminals);

public partial record ReceiptItemDto(
    long Id,
    long ArticleId,
    string? Name,
    string? Barcode,
    decimal Quantity,
    decimal Price,
    decimal OriginalPrice,
    decimal Discount,
    decimal LineTotal,
    long SalesmanId = 0,
    string? SalesmanName = null,
    int? GroupKey = null,
    string? GroupLabel = null);

public record ReceiptEditLineDto(
    long ArticleId,
    string? Name,
    string? Barcode,
    decimal Quantity,
    decimal Price,
    decimal OriginalPrice,
    decimal Discount,
    long SalesmanId = 0,
    string? SalesmanName = null);

public record ReceiptEditSnapshotDto(
    long SalesmanId,
    string? SalesmanName,
    decimal UserDiscount,
    long MasterAccount,
    IReadOnlyList<ReceiptEditLineDto> Items);

public record ReceiptEditRevisionDto(
    DateTime EditedAt,
    ReceiptEditSnapshotDto Before,
    ReceiptEditSnapshotDto After);

public record ReceiptEditHistoryDto(
    ReceiptEditSnapshotDto? Original,
    IReadOnlyList<ReceiptEditRevisionDto>? Revisions);

public record ReceiptDetailDto(
    long Id,
    long Number,
    DateTime CreationDate,
    decimal TotalAmount,
    decimal Payment,
    decimal CashBack,
    decimal ItemsDiscount,
    decimal OffersDiscount,
    decimal UserDiscount,
    long SalesmanId,
    string? SalesmanName,
    bool Synced,
    long? EdrNum,
    IReadOnlyList<ReceiptItemDto> Items,
    int Kind = 0,
    long? ReturnOfReceiptId = null,
    long? DiscountQrPersonId = null,
    string? DiscountQrPersonName = null,
    bool WasEdited = false,
    IReadOnlyList<ReceiptEditRevisionDto>? Edits = null,
    long? PrintedNumber = null);

public record ReceiptReturnLineDto(
    long ItemId,
    long ArticleId,
    string? Name,
    string? Barcode,
    decimal SoldQty,
    decimal ReturnedQty,
    decimal RemainingQty,
    decimal Price,
    decimal OriginalPrice,
    decimal Discount,
    long SalesmanId = 0,
    string? SalesmanName = null,
    int? GroupKey = null,
    string? GroupLabel = null);

public record ReceiptReturnSourceDto(
    long Id,
    long Number,
    DateTime CreationDate,
    int Kind,
    decimal TotalAmount,
    long SalesmanId,
    string? SalesmanName,
    IReadOnlyList<ReceiptReturnLineDto> Items,
    long? PrintedNumber = null);

public record ReceiptReturnMatchesDto(IReadOnlyList<ReceiptReturnSourceDto> Items);

public record SetReceiptPrintedNumberRequest(long? PrintedNumber);

public record SectionCashBoxDto(
    long MasterAccount, int MasterAccountBank,
    string? MasterAccountName, string? MasterAccountNum, bool IsDefault);

public record SectionCashBoxAssignment(long MasterAccount, int? MasterAccountBank = null, bool IsDefault = false);

public partial record SalesmanDto(long Id, string Name);
public partial record SectionDto(long Id, string Name, long BranchId, bool State, int SellPrice);

public partial record SectionSummaryDto(
    long Id, string Name, long BranchId, string? BranchName, bool State, int SellPrice,
    int EdariBranchId, int EdariWarehouseNumber, long MasterAccount,
    int CashBoxCount, int TerminalCount, int OnlineTerminals, int TodayReceipts, decimal TodaySales);

public record SectionDetailDto(
    long Id, string Name, long BranchId, string? BranchName, bool State, int SellPrice,
    int EdariBranchId, int EdariWarehouseNumber,
    int GroupsColumnsCount, int GroupsItemSize, double RoundTotalTo, double RoundItemTo,
    bool FastSaving, bool CollectivePrinting, bool DisplayArticleQuantity,
    int TerminalCount, int OnlineTerminals, int TodayReceipts, decimal TodaySales,
    IReadOnlyList<SectionCashBoxDto> CashBoxes,
    IReadOnlyList<PosTerminalDto> Terminals);

public record CreateSectionRequest(
    string Name, int EdariWarehouseNumber,
    int? EdariBranchId = null, string? EdariSymbol = null,
    long? BranchId = null, bool State = true, int SellPrice = 1,
    IReadOnlyList<SectionCashBoxAssignment>? CashBoxes = null);

public record SectionSaveResponse(long Id, int EdariBranchId, string EdariMessage);

public record UpdateSectionRequest(
    string Name, bool State, int SellPrice,
    int EdariBranchId, int EdariWarehouseNumber,
    int GroupsColumnsCount, int GroupsItemSize, double RoundTotalTo, double RoundItemTo,
    bool FastSaving, bool CollectivePrinting, bool DisplayArticleQuantity,
    IReadOnlyList<SectionCashBoxAssignment>? CashBoxes = null,
    string? EdariSymbol = null);

public partial record PosTerminalDto(
    long Id,
    string? Name,
    string? HwId,
    long? SectionId,
    string? SectionName,
    long MasterAccount,
    int MasterAccountBank,
    string? MasterAccountName,
    string? MasterAccountNum,
    DateTime? LastConnection,
    string? ExeVersion,
    bool Active)
{
    public PosTerminalDto() : this(0, null, null, null, null, 0, 0, null, null, null, null, false)
    {
    }
}

public record PosTerminalDetailDto(
    long Id, string? Name, string? HwId, long? SectionId, string? SectionName,
    long MasterAccount, int MasterAccountBank, string? MasterAccountName, string? MasterAccountNum,
    DateTime? LastConnection, DateTime? LastSync, DateTime? LastUpdate,
    string? ExeVersion, bool Active, bool IsOnline, bool AllowOfflineMode,
    string? Remarks, string? VfdFirstLine, string? VfdSecondLine,
    int TodayReceipts, decimal TodaySales,
    string? MposService = null, string? MposComPort = null);

public record UpdateTerminalRequest(
    string? Name, long? SectionId, bool Active, bool AllowOfflineMode,
    string? Remarks, string? VfdFirstLine, string? VfdSecondLine,
    long? MasterAccount = null, int? MasterAccountBank = null,
    string? MposService = null, string? MposComPort = null);

/// <summary>
/// Offer header type: 0 = uniform %, 1 = required+discounted bundle, 2 = per-product sale price or %.
/// </summary>
public record CreateOfferRequest(string Name, int Priority, int Type, bool Enabled);

/// <summary>One offer a product belongs to — used by admin product→offer search.</summary>
public record ProductOfferMembershipDto(
    long OfferId,
    string OfferName,
    int OfferType,
    bool Enabled,
    int Priority,
    decimal Discount,
    int DiscountType,
    int DetailRole,
    bool Excluded,
    bool IsWinning);

/// <summary>Product hit with every offer it belongs to, of any type.</summary>
public record ProductOfferLookupDto(
    long Id,
    long Seq,
    string? Name,
    string? Barcode,
    string? Num,
    decimal OriginalPrice,
    decimal Price,
    int DiscountPercent,
    string? OfferName,
    IReadOnlyList<ProductOfferMembershipDto> Offers);

public record ProductOfferMembershipsDto(
    long ItemId,
    IReadOnlyList<ProductOfferMembershipDto> Offers);
public record UpdateOfferRequest(string Name, int Priority, int Type, bool Enabled);
public record UpsertOfferDetailRequest(
    long? ItemId,
    decimal Discount,
    int DiscountType,
    DateTime? FromDate,
    DateTime? ToDate,
    bool Unlimited,
    int DetailRole = 0);

public record UpdateOfferDetailRequest(
    decimal Discount,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    bool? Unlimited = null,
    int? DiscountType = null);

public record UpdateOfferTreeDiscountRequest(
    decimal DiscountPercent,
    DateTime? FromDate = null,
    DateTime? ToDate = null,
    bool? Unlimited = null);

public partial record CashierDto(
    long Id, string Username, string? AccountName, bool Active, long PermissionsId, string? PermissionsName = null,
    long SectionId = 0, string? SectionName = null);

public record CashierCreditAccountDto(
    long EdariSeq,
    string? Num = null,
    string? Name = null,
    decimal Balance = 0);

public record CashierDetailDto(
    long Id, string Username, string? AccountName, bool Active,
    long SectionId, string? SectionName,
    CashierPermissionsDto Permissions,
    long? CardMasterAccount = null,
    int? CardMasterAccountBank = null,
    string? CardMasterAccountName = null,
    string? CardMasterAccountNum = null,
    bool ApplyCommissions = true,
    bool ApplyTargets = true,
    IReadOnlyList<SalesmanDto>? AllowedSalesmen = null,
    IReadOnlyList<CashierCreditAccountDto>? CreditAccounts = null);

public record CreateCashierRequest(
    string Username, string Password, string? AccountName,
    UpdatePermissionsRequest Permissions,
    long SectionId,
    bool Active = true,
    long? CardMasterAccount = null,
    int? CardMasterAccountBank = null,
    bool ApplyCommissions = true,
    bool ApplyTargets = true,
    IReadOnlyList<long>? AllowedSalesmanIds = null,
    IReadOnlyList<CashierCreditAccountDto>? CreditAccounts = null);

public record UpdateCashierRequest(
    string? Username, string? Password, string? AccountName,
    UpdatePermissionsRequest? Permissions,
    bool Active,
    long? SectionId = null,
    long? CardMasterAccount = null,
    int? CardMasterAccountBank = null,
    bool ClearCardMasterAccount = false,
    bool? ApplyCommissions = null,
    bool? ApplyTargets = null,
    IReadOnlyList<long>? AllowedSalesmanIds = null,
    IReadOnlyList<CashierCreditAccountDto>? CreditAccounts = null);

public record CreateReceiptRequest(
    long CashierId,
    long SalesmanId,
    long? PosId,
    decimal Payment,
    IReadOnlyList<CreateReceiptItemRequest> Items,
    int Kind = 0,
    bool IsPending = false,
    decimal UserDiscount = 0,
    long? AccountId = null,
    long? MasterAccount = null,
    CardPaymentDto? Card = null,
    Guid? ClientReceiptId = null,
    long? Number = null,
    long? ReturnOfReceiptId = null,
    long? DiscountQrPersonId = null,
    string? DiscountQrPersonCode = null,
    string? DiscountQrPersonName = null,
    DateTime? SoldAt = null,
    ReceiptEditHistoryDto? EditHistory = null);

public partial record DiscountQrPersonDto(
    long Id,
    string Name,
    string Code,
    bool Active,
    DateTime CreatedAt,
    int ReceiptCount = 0,
    decimal TotalDiscount = 0);

public record CreateDiscountQrPersonRequest(string Name);
public record UpdateDiscountQrPersonRequest(string? Name = null, bool? Active = null);

public partial record DiscountQrReceiptDto(
    long Id,
    long Number,
    DateTime CreationDate,
    decimal TotalAmount,
    decimal UserDiscount,
    string? CashierName = null,
    string? PersonName = null);

/// <summary>
/// Result of a successful charge on the card terminal, as reported by the local
/// terminal service. Amounts are already converted back to whole dinars.
/// Every field binds leniently: the money is already taken when this arrives, so a value
/// typed differently by the reader's firmware must never cost the sale.
/// </summary>
public record CardPaymentDto(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)] decimal Amount,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? Rrn = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? TerminalId = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? Acquirer = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? AccNo = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? CardName = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? CardType = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? AuthCode = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? BatchNo = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? RefNo = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? MerchantName = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? CurrencyCode = null,
    [property: JsonConverter(typeof(LenientStringJsonConverter))] string? DeviceType = null,
    [property: JsonConverter(typeof(LenientDateTimeJsonConverter))] DateTime? TransTime = null);

public record CreateReceiptItemRequest(
    long ArticleId,
    string? Barcode,
    decimal Quantity,
    decimal Price,
    decimal OriginalPrice,
    decimal Discount,
    long SalesmanId = 0,
    string? SalesmanName = null,
    int? GroupKey = null,
    string? GroupLabel = null);

public record ProductAttributionDto(
    bool RequiresSalesman,
    bool HasCommission,
    bool HasTarget,
    string? Reason);

/// <summary>مندوبو منتج ذو عمولة — عند تحديد مجموعات/قواعد بمندوبين بعينهم يظهر لهم فقط في نقطة البيع.</summary>
public record ProductAllowedSalesmenDto(
    bool Restricted,
    IReadOnlyList<SalesmanDto> Items);

/// <summary>True when the server had to re-allocate the receipt number (client number collided).</summary>
public record CreateReceiptResponse(long ReceiptId, long Number, decimal TotalAmount, decimal CashBack, bool Renumbered = false);

public record AllocateReceiptNumberRequest(long CashierId);

/// <summary>Official receipt number reserved from the shop sequence before print/upload.</summary>
public record AllocateReceiptNumberResponse(long Number, int Year, int CashierCode, int Seq);

public record CashierLoginRequest(string? Username, string Password, string? HwId = null);
public record CashierRefreshRequest(string Token);
public record CashierRefreshResponse(string Token);
public record PosSessionDto(
    long CashierId, string CashierName, long SalesmanId, string SalesmanName,
    string Token, CashierPermissionsDto? Permissions, long? PosTerminalId,
    long SectionId, string? SectionName,
    IReadOnlyList<SectionCashBoxDto> CashBoxes,
    long ActiveMasterAccount, int ActiveMasterAccountBank,
    string? MposService = null, string? MposComPort = null, bool CardPaymentEnabled = false,
    bool AllowOfflineMode = false,
    bool ApplyCommissions = true,
    bool ApplyTargets = true,
    int CashierReceiptNum = 0,
    int ReceiptYear = 0,
    long ReceiptSeq = 0);

public partial record CashierPermissionsDto(
    long Id, string? Name,
    bool MakeDiscount, bool ViewReceipts, bool CashReport, bool DeleteItem, bool DuplicateItem,
    bool OfflineLogin, bool DiscardReceipt, bool AllowCreditReceipt, bool AllowSalesReturn,
    bool AllowGiftReceipt, bool AllowPriceChange, bool AllowSearchArticles, bool AllowEditReceipt,
    decimal ItemDiscountLimit, decimal UserDiscountLimit, int NumberOfHoldReceipts,
    bool ManualTransfer = false, bool AllowProductDiscount = false,
    bool HideSalesmanGroups = false, bool InvoiceBoundReturn = false);

public record UpdateProductRequest(string? Name, string? Barcode, decimal? OriginalPrice, decimal? FinalPrice, decimal? Stock, int? DiscountPercent = null);
public record DiscountPercentRequest(int Percent);
public record RegisterTerminalRequest(
    string HwId, string? Name, long? SectionId = null,
    long? MasterAccount = null, int? MasterAccountBank = null);
public record TerminalHeartbeatRequest(
    string? ExeVersion,
    int? PendingOffline = null,
    int? DeadOffline = null,
    int? DeferredOffline = null,
    long? CatalogVersion = null);
public record CreateCommissionRuleRequest(
    long? ProductId, string? Barcode, string CommissionType, decimal CommissionValue,
    DateTime? EffectiveFrom, DateTime? EffectiveTo,
    long? SalesmanId = null, string? Label = null);

public record UpdateCommissionRuleRequest(
    long? ProductId, string? Barcode, long? SalesmanId, string? Label,
    string CommissionType, decimal CommissionValue,
    DateTime? EffectiveFrom, DateTime? EffectiveTo, bool IsActive);
public record TargetTreeLinkDto(long TreeSeq, string? TreeName);

public record TargetSalesmanAssignmentDto(
    long SalesmanId, string? SalesmanName,
    decimal DailyTarget, decimal WeeklyTarget, decimal MonthlyTarget);

public record CreateTargetRuleRequest(
    string Name,
    IReadOnlyList<TargetTreeLinkDto>? Trees = null,
    IReadOnlyList<TargetSalesmanAssignmentDto>? Assignments = null,
    long? EdariTreeSeq = null, string? EdariTreeName = null,
    string TargetType = "quantity",
    IReadOnlyList<long>? ExcludedArticleIds = null);

public record UpdateTargetRuleRequest(
    string Name,
    IReadOnlyList<TargetTreeLinkDto>? Trees,
    IReadOnlyList<TargetSalesmanAssignmentDto>? Assignments,
    string TargetType = "quantity",
    IReadOnlyList<long>? ExcludedArticleIds = null);
public record UpdatePermissionsRequest(
    bool MakeDiscount, bool ViewReceipts, bool CashReport, bool DeleteItem, bool DuplicateItem,
    bool OfflineLogin, bool DiscardReceipt, bool AllowCreditReceipt, bool AllowSalesReturn,
    bool AllowGiftReceipt, bool AllowPriceChange, bool AllowSearchArticles, bool AllowEditReceipt,
    decimal ItemDiscountLimit, decimal UserDiscountLimit, int NumberOfHoldReceipts,
    bool ManualTransfer = false, bool AllowProductDiscount = false,
    bool HideSalesmanGroups = false, bool InvoiceBoundReturn = false);

public partial record DailySalesRowDto(DateTime Date, decimal Total, int ReceiptCount);
public partial record SalesmanSalesRowDto(long SalesmanId, string? Name, decimal Total, int Count, int LineCount = 0);
public partial record MovementRowDto(long ArticleId, string? Name, string? Barcode, decimal SoldQty, decimal SoldAmount);
public record EdariSyncStatusDto(
    int UnsyncedCount, int SyncedCount, int FailedCount, string Message,
    bool? ConnectionOk = null, string? DatabaseAlias = null, string? DataRoot = null,
    DateTime? LastDataPullAt = null,
    DateTime? LastHeartbeatAt = null,
    DateTime? LastChangeDetectedAt = null,
    bool LiveWatching = false,
    bool AutoSyncEnabled = false,
    string? LiveMessage = null,
    int DeadLetterCount = 0,
    int? OldestUnsyncedMinutes = null,
    bool CircuitOpen = false,
    int CircuitRetryInSeconds = 0);

/// <summary>Receipt that exhausted its posting attempts (or failed structurally) and needs human action.</summary>
public partial record EdariDeadLetterDto(
    long Id, long Number, DateTime CreationDate, decimal TotalAmount,
    int SyncAttempts, string? Reason, DateTime? LastAttemptAt)
{
    public EdariDeadLetterDto() : this(0, 0, default, 0, 0, null, null) { }
}

/// <summary>One error report pushed by the admin dashboard or a POS terminal.</summary>
public record ClientErrorReportDto(
    string Message,
    string? Stack = null,
    string? Context = null,
    string? Terminal = null,
    string? AppVersion = null);

public record ClientErrorBatchDto(IReadOnlyList<ClientErrorReportDto> Errors);

public partial record ClientErrorDto(
    long Id,
    string Source,
    string? Terminal,
    string Message,
    string? Stack,
    string? Context,
    string? AppVersion,
    DateTime CreatedAt)
{
    public ClientErrorDto() : this(0, "admin", null, "", null, null, null, default) { }
}

public record ServerInfoDto(
    string HostName,
    IReadOnlyList<string> LanAddresses,
    int ApiPort,
    bool AdminUiHosted,
    DateTime TimestampUtc);

public record EdariSettingsDto(
    string DataRoot,
    string DatabaseAlias,
    string Server,
    int Port,
    string ConnectionMode,
    string OdbcDriver,
    string? AdoProviderPath,
    string? AdoConnectorDirectory,
    bool Enabled,
    bool AutoSyncEnabled,
    int AutoSyncIntervalSeconds,
    bool CatalogSyncEnabled,
    DateTime? LastReceiptSyncAt,
    DateTime? LastCatalogSyncAt,
    DateTime? LastDataPullAt,
    DateTime? LastConnectionTestAt,
    bool? LastConnectionOk,
    string? LastConnectionMessage,
    IReadOnlyList<string> AvailableYears,
    DateTime? LastHeartbeatAt = null,
    DateTime? LastChangeDetectedAt = null,
    bool LiveWatching = false,
    int DataPullIntervalSeconds = 240);

public record UpdateEdariSettingsRequest(
    string DataRoot,
    string DatabaseAlias,
    string Server,
    int Port,
    string ConnectionMode,
    string OdbcDriver,
    string? AdoProviderPath,
    string? AdoConnectorDirectory,
    bool Enabled,
    bool AutoSyncEnabled,
    int AutoSyncIntervalSeconds,
    bool CatalogSyncEnabled,
    int DataPullIntervalSeconds = 240);

public record EdariConnectionTestResult(
    bool Ok,
    string Message,
    int? MaterialTreeCount,
    int? OfferCount,
    DateTime TestedAt);

public record EdariTreeNodeDto(
    long Seq,
    long? Father,
    string? Name,
    string? Num,
    string? Barcode,
    bool IsFolder,
    bool HasChildren,
    decimal Price = 0);

public record EdariSyncRunResult(
    bool Ok,
    string Message,
    int ReceiptsSynced,
    int ReceiptsFailed,
    int OffersImported,
    DateTime FinishedAt,
    int DeadLettered = 0);

public record EdariFullSyncResult(
    bool Ok,
    string Message,
    int SalesmenTotal,
    int ArticlesAdded,
    int ArticlesUpdated,
    int ArticlesTotal,
    int SectionsCreated,
    int ReceiptsSynced,
    int ReceiptsFailed,
    int OffersImported,
    DateTime FinishedAt,
    int ArticlesDeleted = 0);

public record EdariDataPullResultDto(
    bool Ok,
    string Message,
    int SalesmenAdded,
    int SalesmenUpdated,
    int SalesmenTotal,
    int OffersImported,
    int ArticlesAdded,
    int ArticlesUpdated,
    int ArticlesTotal,
    int SectionsCreated,
    DateTime FinishedAt,
    int ArticlesDeleted = 0);

public partial record EdariSyncLogDto(
    long Id,
    long? ReceiptId,
    string Status,
    long? EdrNum,
    string? Operation,
    string? ErrorMessage,
    string? Details,
    DateTime AttemptedAt);
public partial record HoldReceiptDto(
    long Id, DateTime CreationDate, decimal TotalAmount, int ItemCount, long SalesmanId, string? SalesmanName,
    long? PosId = null, string? PosName = null, string? SectionName = null, string? CashierName = null)
{
    public HoldReceiptDto() : this(0, default, 0, 0, 0, null)
    {
    }
}

public partial record ArticleGroupDto(long Id, string? Name, int BackColour, int ForeColour, int ItemCount);
public record ArticleGroupItemDto(long Id, long ProductId, long Seq, string? Name, string? Barcode, decimal Price, decimal OriginalPrice, int BackColour, int ForeColour);
public record CreateArticleGroupRequest(string Name, int BackColour = 0, int ForeColour = 16777215);
public record UpdateArticleGroupRequest(string Name, int BackColour, int ForeColour);
public record AddArticleGroupProductsRequest(IReadOnlyList<long> ArticleSeqs);
public record AddArticleGroupTreesRequest(IReadOnlyList<long> TreeSeqs);
public record ArticleGroupWriteResult(int Added, int Skipped);

/// <summary>Group is the Edari chart folder (صناديق المحل / دلفري …) — it tells a cash box apart
/// from a delivery or customer account that sits in the same linkable list.</summary>
public record AccountSummaryDto(long Id, string? Num, string? Name, decimal Balance, string? Group = null);
public record PosCreditAccountDto(
    long EdariSeq, string? Num, string? Name, decimal Balance, bool EnabledForPos, int SortOrder);
public record SavePosCreditAccountsRequest(IReadOnlyList<long> EdariSeqs);
public record CashReportDto(decimal TotalSales, int ReceiptCount, decimal TotalPayment, decimal TotalCashBack, decimal AverageTicket);

public partial record PrintSettingsDto(
    long Id,
    string? Name,
    string? HeaderText,
    string? HeaderDescription,
    string? FooterText,
    string? QrCodeText,
    string? LogoUrl,
    bool ShowLogo,
    bool ShowBarcode,
    bool ShowArticleNumber,
    int Copies,
    int PaperWidthMm,
    int FontSize,
    int LogoMaxHeightPx,
    bool ShowQrCode,
    bool ShowCashier,
    bool ShowSalesman,
    bool ShowDiscountDetails,
    bool ShowItemTable,
    bool ShowSubtotal,
    bool ShowPaymentLines,
    bool AutoPrint,
    string? ReceiptTemplate = "classic",
    int FontWeight = 400,
    bool ShowCashBox = true,
    bool ShowTotalQuantity = true,
    int RoundTotalTo = 250,
    [property: JsonConverter(typeof(ClassicStyleJsonConverter))]
    string? ClassicStyle = null)
{
    public static PrintSettingsDto Default => new(
        1, "الفاتورة الافتراضية", "FOT POS", null, "شكراً لتسوقكم", null, null,
        false, true, false, 1, 80, 13, 72, false, true, true, true, true, true, true, true,
        "classic", 400, true, true, 250, null);

    public string TemplateKey => NormalizeTemplate(ReceiptTemplate);

    public static string NormalizeTemplate(string? value) =>
        (value ?? "").Trim().ToLowerInvariant() switch
        {
            "compact" => "compact",
            "branded" or "premium" or "fancy" => "branded",
            _ => "classic"
        };
}

public partial record PosCashBoxSettingsDto(
    long? QiMasterAccount,
    int QiMasterAccountBank,
    string? QiMasterAccountName,
    string? QiMasterAccountNum,
    long? GiftMasterAccount,
    int GiftMasterAccountBank,
    string? GiftMasterAccountName,
    string? GiftMasterAccountNum,
    int EdariGiftAccount = 0,
    int EdariQiAccount = 0,
    string? EdariQiAccountName = null,
    string? EdariQiAccountNum = null)
{
    public static PosCashBoxSettingsDto Empty => new(null, 0, null, null, null, 0, null, null, 0, 0, null, null);
}

public record UpdatePosCashBoxSettingsRequest(
    long? QiMasterAccount,
    int? QiMasterAccountBank,
    long? GiftMasterAccount,
    int? GiftMasterAccountBank,
    int EdariGiftAccount = 0,
    int EdariQiAccount = 0);

public partial record BusinessPeriodSettingsDto(
    int WeekStartDay,
    int WeekLengthDays,
    string WeekStartDayName,
    string WeekEndDayName,
    DateTime CurrentWeekStart,
    DateTime CurrentWeekEnd,
    DateTime PreviousWeekStart,
    DateTime PreviousWeekEnd,
    DateTime CurrentMonthStart,
    DateTime CurrentMonthEnd)
{
    public static BusinessPeriodSettingsDto Default =>
        new(6, 7, "السبت", "الجمعة",
            DateTime.Today, DateTime.Today,
            DateTime.Today, DateTime.Today,
            new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1),
            new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1).AddMonths(1).AddDays(-1));
}

public record UpdateBusinessPeriodSettingsRequest(int WeekStartDay, int WeekLengthDays);

public record UpdatePrintSettingsRequest(
    string? Name,
    string? HeaderText,
    string? HeaderDescription,
    string? FooterText,
    string? QrCodeText,
    bool ShowLogo,
    bool ShowBarcode,
    bool ShowArticleNumber,
    int Copies,
    int PaperWidthMm,
    int FontSize,
    int LogoMaxHeightPx,
    bool ShowQrCode,
    bool ShowCashier,
    bool ShowSalesman,
    bool ShowDiscountDetails,
    bool ShowItemTable,
    bool ShowSubtotal,
    bool ShowPaymentLines,
    bool AutoPrint,
    string? ReceiptTemplate = "classic",
    int FontWeight = 400,
    bool ShowCashBox = true,
    bool ShowTotalQuantity = true,
    int RoundTotalTo = 250,
    [property: JsonConverter(typeof(ClassicStyleJsonConverter))]
    string? ClassicStyle = null);

public record ReceiptPrintLineDto(
    string? Name,
    string? Barcode,
    string? ArticleNum,
    decimal Quantity,
    decimal Price,
    decimal LineTotal,
    decimal OriginalPrice);

public record ReceiptPrintPreviewDto(
    long ReceiptNumber,
    DateTime PrintedAt,
    string? CashierName,
    string? SalesmanName,
    string? PosLabel,
    IReadOnlyList<ReceiptPrintLineDto> Lines,
    decimal SubTotal,
    decimal UserDiscount,
    decimal Total,
    decimal Paid,
    decimal Change,
    string? CashBoxName = null,
    /// <summary>0 = مبيعات, 1 = مرتجع, 2 = هدية</summary>
    int Kind = 0)
{
    public string KindLabel => Kind switch { 1 => "مرتجع", 2 => "هدية", _ => "مبيعات" };
}


public partial record CommissionRuleDto(
    long Id, long? ProductId, string? ProductName, string? Barcode,
    long? SalesmanId, string? SalesmanName, string? Label,
    string CommissionType, decimal CommissionValue, bool IsActive,
    DateTime EffectiveFrom, DateTime? EffectiveTo);

public partial record CommissionCalculationDto(
    long Id, long ReceiptId, long ArticleId, string? ProductName,
    long SalesmanId, string? SalesmanName,
    string CommissionType, decimal CommissionValue,
    decimal Quantity, decimal LineAmount, decimal CommissionAmount,
    DateTime CalculatedAt,
    long? CommissionGroupId = null, string? CommissionGroupName = null,
    DateTime? SaleDate = null,
    long? ReceiptNumber = null);

public record RecalculateCommissionsRequest(DateTime? From = null, DateTime? To = null, long? ReceiptId = null);

public record RecalculateCommissionsResult(
    int ReceiptsScanned, int ReceiptsProcessed, int LinesWritten, int Skipped, string Message);

public record CommissionHealthDto(
    DateTime From,
    DateTime To,
    int ActiveGroups,
    int ActiveRules,
    int LinkedProducts,
    int ReceiptsInPeriod,
    int EligibleLines,
    int CalculatedLines,
    int MissingCalculations,
    int LinesWithoutSalesman,
    IReadOnlyList<CommissionGapRow> Gaps,
    IReadOnlyList<string> Hints);

public partial record CommissionGapRow(
    long ReceiptId,
    long? ReceiptNumber,
    DateTime SaleDate,
    long ArticleId,
    string? ProductName,
    long SalesmanId,
    string? SalesmanName,
    string Reason);

public record CommissionReceiptDiagnoseDto(
    long ReceiptId,
    long? ReceiptNumber,
    DateTime? SaleDate,
    long ReceiptSalesmanId,
    int ItemCount,
    int CalculatedCount,
    IReadOnlyList<CommissionLineDiagnoseDto> Lines);

public record CommissionLineDiagnoseDto(
    long ItemId,
    long ArticleId,
    long ArticleSeq,
    string? ProductName,
    string? Barcode,
    long SalesmanId,
    decimal Quantity,
    decimal Price,
    bool HasCalculation,
    decimal? CommissionAmount,
    string? GroupName,
    string Status,
    string Message);

public partial record CommissionReceiptReportRow(
    long ReceiptId,
    long? ReceiptNumber,
    DateTime? SaleDate,
    int LineCount,
    decimal TotalCommission,
    decimal TotalSales);

public partial record TargetProductRowDto(
    long ArticleSeq, string? ProductName, decimal Quantity, int ReceiptCount);

public partial record TargetReceiptRowDto(
    long ReceiptId, long? ReceiptNumber, DateTime SaleDate,
    long SalesmanId, string? SalesmanName,
    decimal Quantity, decimal LineAmount, int LineCount);

public record CommissionPreviewRequest(
    long? ArticleId = null,
    string? Barcode = null,
    long SalesmanId = 0,
    decimal Quantity = 1,
    decimal Price = 0);

public record CommissionPreviewDto(
    bool Matched,
    string? Source,
    long? GroupId,
    string? GroupName,
    string? ProductName,
    long? ArticleSeq,
    string? CommissionType,
    decimal CommissionValue,
    decimal CommissionAmount,
    long ResolvedSalesmanId,
    string Message);

public partial record CommissionPayoutDto(
    long Id, long SalesmanId, string? SalesmanName,
    decimal Amount, DateTime PaidAt, string? Note, bool Voided);

public record RecordCommissionPayoutRequest(
    decimal Amount, DateTime? PaidAt = null, string? Note = null);

public partial record CommissionDailyReportRow(
    DateTime Day, decimal TotalCommission, int TransactionCount, decimal TotalSales);

public partial record CommissionGroupReportRow(
    long? GroupId, string? GroupName,
    int TransactionCount, decimal TotalCommission, decimal TotalSales);

public partial record CommissionProductReportRow(
    long ArticleId, string? ProductName,
    int TransactionCount, decimal TotalCommission, decimal TotalSales, decimal Quantity);

public partial record SalesmanCommissionSummaryDto(
    long SalesmanId, string? SalesmanName, string CurrencyCode,
    decimal OpeningBalance, decimal PaidOutTotal,
    decimal TotalCommission, int TransactionCount, decimal BalanceDue, string? Notes);

public partial record SalesmanCommissionProfileDto(
    long SalesmanId, string? SalesmanName, string CurrencyCode,
    decimal OpeningBalance, decimal PaidOutTotal, string? Notes);

public record UpdateSalesmanCommissionProfileRequest(
    string CurrencyCode, decimal OpeningBalance, decimal PaidOutTotal, string? Notes);

public record CommissionGroupSalesmanDto(long SalesmanId, string? SalesmanName);

public partial record CommissionGroupDto(
    long Id, string Name, string? Description,
    string CommissionType, decimal CommissionValue,
    long? SalesmanId, string? SalesmanName, string? Label,
    int SortOrder, string? ColorHex, bool IsActive,
    DateTime EffectiveFrom, DateTime? EffectiveTo,
    int TreeCount, int ItemCount, int ProductCount)
{
    public IReadOnlyList<CommissionGroupSalesmanDto> Salesmen { get; init; } = [];
}

public record CommissionGroupDetailDto(
    long Id, string Name, string? Description,
    string CommissionType, decimal CommissionValue,
    long? SalesmanId, string? SalesmanName, string? Label,
    int SortOrder, string? ColorHex, bool IsActive,
    DateTime EffectiveFrom, DateTime? EffectiveTo,
    IReadOnlyList<CommissionGroupTreeDto> Trees,
    IReadOnlyList<CommissionGroupItemDto> Items)
{
    public IReadOnlyList<CommissionGroupSalesmanDto> Salesmen { get; init; } = [];
}

public partial record CommissionGroupTreeDto(
    long Id, long TreeSeq, string? TreeName, bool IsFullTree, int ProductCount,
    int ExcludedCount = 0, DateTime? LastSyncedAt = null);

public partial record CommissionGroupItemDto(
    long Id, long? ArticleId, string? Barcode, string? ArticleName,
    long? SourceTreeSeq, string? SourceTreeName,
    bool Excluded = false,
    decimal Price = 0);

public record CreateCommissionGroupRequest(
    string Name, string? Description,
    string CommissionType, decimal CommissionValue,
    long? SalesmanId = null, string? Label = null,
    int SortOrder = 0, string? ColorHex = null,
    DateTime? EffectiveFrom = null, DateTime? EffectiveTo = null,
    IReadOnlyList<long>? SalesmanIds = null);

public record UpdateCommissionGroupRequest(
    string Name, string? Description,
    string CommissionType, decimal CommissionValue,
    long? SalesmanId, string? Label,
    int SortOrder, string? ColorHex, bool IsActive,
    DateTime? EffectiveFrom, DateTime? EffectiveTo,
    IReadOnlyList<long>? SalesmanIds = null);

public record AddCommissionGroupTreeRequest(long TreeSeq, string? TreeName = null);

public record AddCommissionGroupPartialTreeRequest(
    long TreeSeq, string? TreeName, IReadOnlyList<long> ArticleIds);

public record AddCommissionGroupProductRequest(long? ArticleId = null, string? Barcode = null);

public record MoveCommissionGroupItemsRequest(
    IReadOnlyList<long> ItemIds, long ToGroupId);

public record MoveCommissionGroupTreeRequest(
    long FromGroupId, long TreeSeq, long ToGroupId);

public record CommissionGroupTreeApplyResult(
    int Added, int Skipped, string? TreeName, int Updated = 0);

/// <summary>One commission group a product belongs to — used by admin product search and add warnings.</summary>
public record ProductCommissionMembershipDto(
    long GroupId,
    string GroupName,
    bool IsActive,
    string CommissionType,
    decimal CommissionValue,
    long? SourceTreeSeq,
    string? SourceTreeName,
    bool Excluded);

public record ProductCommissionLookupDto(
    long Id,
    long Seq,
    string? Name,
    string? Barcode,
    string? Num,
    decimal Price,
    IReadOnlyList<ProductCommissionMembershipDto> Groups);

public record ProductCommissionMembershipsDto(
    long ItemId,
    IReadOnlyList<ProductCommissionMembershipDto> Groups);

public record CommissionOverlapGroupDto(
    long GroupId,
    string GroupName,
    bool IsActive,
    string CommissionType,
    decimal CommissionValue,
    long? SourceTreeSeq,
    string? SourceTreeName);

public record CommissionOverlapProductDto(
    long ArticleId,
    string? Name,
    string? Barcode,
    decimal Price,
    IReadOnlyList<CommissionOverlapGroupDto> Groups);

public record CommissionGroupTreeProductDto(
    long ArticleId, string? Name, string? Barcode, bool InGroup,
    bool Excluded = false, long? ItemId = null, decimal Price = 0);

public record TargetRuleDto(
    long Id, string Name, bool IsActive,
    IReadOnlyList<TargetTreeLinkDto> Trees,
    IReadOnlyList<TargetSalesmanAssignmentDto> Assignments,
    long? EdariTreeSeq = null, string? EdariTreeName = null,
    string TargetType = "quantity",
    IReadOnlyList<long>? ExcludedArticleIds = null);

public partial record CatalogInfoDto(int TotalProducts, long MaxSeq);

/// <summary>Every product id a terminal may keep locally — the basis for pruning deleted ones.</summary>
public record CatalogIdsDto(int Total, IReadOnlyList<long> Ids);

public record TargetProgressDto(
    long RuleId, string RuleName, decimal CurrentQuantity,
    DateTime PeriodStart, DateTime PeriodEnd);

public record TargetSalesmanRowDto(
    long SalesmanId, string? SalesmanName,
    decimal Quantity,
    decimal DailyTarget, decimal WeeklyTarget, decimal MonthlyTarget,
    decimal DailyPercent, decimal WeeklyPercent, decimal MonthlyPercent,
    int Rank,
    decimal Amount = 0);

public record TargetBreakdownDto(
    long RuleId, string RuleName,
    DateTime PeriodStart, DateTime PeriodEnd,
    int TreeCount, int ProductCount,
    decimal TotalQuantity,
    IReadOnlyList<TargetSalesmanRowDto> Salesmen,
    IReadOnlyList<TargetTreeLinkDto> Trees,
    IReadOnlyList<TargetProductRowDto>? Products = null,
    int ReceiptCount = 0,
    decimal UnassignedQuantity = 0,
    string TargetType = "quantity",
    decimal TotalAmount = 0);

public record WeeklySettlementSettingsDto(
    decimal DeductionPercent,
    IReadOnlyList<long> SalesmanIds);

public record UpdateWeeklySettlementSettingsRequest(
    decimal DeductionPercent,
    IReadOnlyList<long> SalesmanIds);

public record WeeklySettlementTargetColumnDto(
    long TargetId,
    string Name,
    string TargetType);

public record WeeklySettlementTargetCellDto(
    long TargetId,
    decimal Sold,
    decimal Goal,
    decimal Percent);

public record WeeklySettlementRowDto(
    long SalesmanId,
    string? SalesmanName,
    decimal Commission,
    decimal AfterDeduction,
    decimal Amount,
    bool Delivered,
    DateTime? DeliveredAt,
    long? PayoutId,
    IReadOnlyList<WeeklySettlementTargetCellDto> Targets);

public record WeeklySettlementReportDto(
    DateTime WeekStart,
    DateTime WeekEnd,
    bool IsCurrentWeek,
    bool CanDeliver,
    decimal DeductionPercent,
    IReadOnlyList<long> SalesmanIds,
    IReadOnlyList<WeeklySettlementTargetColumnDto> TargetColumns,
    IReadOnlyList<WeeklySettlementRowDto> Rows);

public record UpdateWeeklySettlementRowRequest(
    DateTime WeekStart,
    long SalesmanId,
    decimal? Amount = null,
    bool? Delivered = null);

public record WeeklySettlementRowSaveDto(
    long SalesmanId,
    decimal Amount,
    bool Delivered,
    DateTime? DeliveredAt,
    long? PayoutId);

public record ProductInquiryRequest(
    DateTime? From = null,
    DateTime? To = null,
    IReadOnlyList<long>? ArticleSeqs = null,
    IReadOnlyList<long>? TreeSeqs = null,
    long? CommissionGroupId = null,
    long? SalesmanId = null);

public record ProductInquiryScopeDto(
    string Kind,
    string? Label,
    int ProductCount,
    long? CommissionGroupId = null);

public record ProductInquirySummaryDto(
    decimal Quantity,
    decimal SalesAmount,
    int ReceiptCount,
    decimal CommissionAmount,
    int CommissionLineCount);

public record ProductInquiryProductRowDto(
    long ArticleSeq, string? ProductName, string? Barcode,
    decimal Quantity, decimal SalesAmount, decimal CommissionAmount, int ReceiptCount);

public record ProductInquirySalesmanRowDto(
    long SalesmanId, string? SalesmanName,
    decimal Quantity, decimal SalesAmount, decimal CommissionAmount, int ReceiptCount);

public record ProductInquiryCommissionRowDto(
    long Id, long ReceiptId, long? ReceiptNumber, DateTime? SaleDate,
    long ArticleSeq, string? ProductName,
    long SalesmanId, string? SalesmanName,
    string? CommissionType, decimal CommissionValue,
    decimal Quantity, decimal LineAmount, decimal CommissionAmount,
    long? CommissionGroupId, string? CommissionGroupName);

public record ProductInquiryReceiptRowDto(
    long ReceiptId, long? ReceiptNumber, DateTime? SaleDate,
    long SalesmanId, string? SalesmanName,
    decimal Quantity, decimal SalesAmount, decimal CommissionAmount, int LineCount);

public record ProductInquiryDto(
    ProductInquiryScopeDto Scope,
    ProductInquirySummaryDto Summary,
    IReadOnlyList<ProductInquiryProductRowDto> Products,
    IReadOnlyList<ProductInquirySalesmanRowDto> Salesmen,
    IReadOnlyList<ProductInquiryCommissionRowDto> Commissions,
    IReadOnlyList<ProductInquiryReceiptRowDto> Receipts,
    bool ReceiptsTruncated = false,
    bool CommissionsTruncated = false);
