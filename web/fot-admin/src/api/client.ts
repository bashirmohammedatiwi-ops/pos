import type {
  AccountSummaryDto,
  PosCreditAccountDto,
  AddOfferBulkRequest,
  AddOfferTreeRequest,
  CatalogInfoDto,
  CashierPermissionsDto,
  ArticleGroupDto,
  ArticleGroupItemDto,
  ArticleGroupWriteResult,
  CreateArticleGroupRequest,
  UpdateArticleGroupRequest,
  CashierActivityDto,
  CashierVoidEventDto,
  CashierVoidReportDto,
  CashierDetailDto,
  CashierDto,
  CreateCashierRequest,
  UpdateCashierRequest,
  CashReportDto,
  DayBreakdownDto,
  CommissionCalculationDto,
  CommissionDailyReportRow,
  CommissionGroupReportRow,
  CommissionProductReportRow,
  CommissionReceiptReportRow,
  CommissionHealthDto,
  CommissionReceiptDiagnoseDto,
  CommissionPreviewDto,
  CommissionPayoutDto,
  RecalculateCommissionsResult,
  TargetReceiptRowDto,
  CommissionGroupDetailDto,
  CommissionGroupDto,
  CommissionGroupItemDto,
  CommissionGroupTreeApplyResult,
  CommissionGroupTreeProductDto,
  CommissionRuleDto,
  CreateCommissionGroupRequest,
  CreateCommissionRuleRequest,
  SalesmanCommissionProfileDto,
  SalesmanCommissionSummaryDto,
  UpdateCommissionRuleRequest,
  UpdateCommissionGroupRequest,
  UpdateSalesmanCommissionProfileRequest,
  UpdateWeeklySettlementRowRequest,
  UpdateWeeklySettlementSettingsRequest,
  WeeklySettlementReportDto,
  WeeklySettlementRowSaveDto,
  WeeklySettlementSettingsDto,
  ProductInquiryDto,
  ProductInquiryRequest,
  CreateOfferRequest,
  CreateTargetRuleRequest,
  DailySalesRowDto,
  DashboardStats,
  EdariConnectionTestResult,
  EdariBranchDto,
  EdariArabicNamesBackfillResult,
  EdariDataPullResult,
  EdariDeadLetterDto,
  EdariFullSyncResult,
  EdariSettingsDto,
  EdariSyncLogDto,
  EdariSyncRunResult,
  EdariSyncStatusDto,
  ClientErrorDto,
  LoginResponse,
  MovementRowDto,
  SlowMoverReportDto,
  ReorderReportDto,
  HeatmapReportDto,
  CashierPerformanceRowDto,
  OfferSalesClosureDto,
  OfferSalesReportDto,
  OfferBundleConditionsDto,
  OfferDetailDto,
  OfferDto,
  OfferFolderDto,
  OfferScopeDto,
  OfferStatsDto,
  ProductOfferLookupDto,
  ProductOfferMembershipsDto,
  ProductCommissionLookupDto,
  ProductCommissionMembershipsDto,
  CommissionOverlapProductDto,
  OfferTreeProductDto,
  OfferTreeStateDto,
  OfferTreeApplyResult,
  PagedResult,
  PrintSettingsDto,
  ProductDto,
  ReceiptDetailDto,
  HoldReceiptDto,
  ReceiptSearchResult,
  DiscountQrPersonDto,
  DiscountQrReceiptDto,
  PortalPublishResult,
  PortalSellerAccountDto,
  SellerAccessRequest,
  SellerBrandLinkDto,
  StaffDto,
  StaffSaveRequest,
  TeamHubStatusDto,
  TeamAudience,
  TeamCommissionProductDto,
  TeamManagerPermsDto,
  TeamAttendDto,
  TeamAttendSettingsDto,
  TeamAuditDto,
  TeamBoardDto,
  TeamNetworkDto,
  TeamShiftDto,
  TeamSummaryDto,
  TeamRosterDto,
  TeamAppReleaseDto,
  TeamPushStatusDto,
  WifiScanDto,
  TeamBroadcastDto,
  TeamDirStaffDto,
  TeamLeaveDto,
  TeamOverviewDto,
  TeamPostDto,
  TeamPostReaderDto,
  TeamPostSave,
  PortalWebStatusDto,
  PortalManagerAccountDto,
  PortalBulkIssueResult,
  ReceiptSummary,
  SalesmanDto,
  SalesmanSalesRowDto,
  CreateSectionRequest,
  SectionDetailDto,
  SectionDto,
  SectionSaveResponse,
  SectionSummaryDto,
  SectionTerminalGroupDto,
  PosTerminalDetailDto,
  UpdateSectionRequest,
  UpdateTerminalRequest,
  TargetBreakdownDto,
  TargetProgressDto,
  TargetRuleDto,
  UpdateTargetRuleRequest,
  TerminalDto,
  TreeNodeDto,
  TreeProductInfoDto,
  UpdateEdariSettingsRequest,
  UpdateOfferRequest,
  UpdateOfferDetailRequest,
  UpdateOfferTreeDiscountRequest,
  UpdatePermissionsRequest,
  UpdatePrintSettingsRequest,
  PosCashBoxSettingsDto,
  UpdatePosCashBoxSettingsRequest,
  BusinessPeriodSettingsDto,
  UpdateBusinessPeriodSettingsRequest,
  UpdateProductRequest,
  UpsertOfferDetailRequest,
  ReceiptPrintPreviewDto,
  ServerInfoDto,
  BackupFileItemDto,
  BackupManifestDto,
  BackupSettingsDto,
  CreateBackupRequest,
  RestoreBackupRequest,
  RestoreBackupResultDto,
  UpdateBackupSettingsRequest,
} from './types';
import { fetchLan } from '@fot/shared';
import { getApiBase } from '@/lib/apiBase';

const TOKEN_KEY = 'fot_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function readApiError(text: string) {
  const raw = (text ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const msg = parsed.error ?? parsed.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    /* not JSON */
  }
  return raw;
}

/** وقت انتهاء الرمز (ms) من حقل exp في JWT — null إن تعذرت القراءة. */
function tokenExpiry(token: string | null): number | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * تجديد جلسة الإدارة برمز جديد (يقبل الخادم رمزاً منتهياً منذ أقل من 14 يوماً لمستخدم فعّال).
 * طلب واحد مشترك مهما تعددت الطلبات المرفوضة في نفس اللحظة.
 */
export function refreshSession(): Promise<boolean> {
  const token = getToken();
  if (!token) return Promise.resolve(false);
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetchLan(`${getApiBase()}/auth/refresh`, {
        method: 'POST',
        credentials: 'omit',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        timeoutMs: 15_000,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as LoginResponse;
      if (!data?.token) return false;
      setToken(data.token);
      try {
        if (data.user) localStorage.setItem('fot_admin_user', JSON.stringify(data.user));
      } catch {
        /* تجاهل */
      }
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

let lastProactiveRefresh = 0;

/**
 * يجدد الرمز مسبقاً إذا بقي على انتهائه أقل من 8 ساعات — يُستدعى عند الفتح ودورياً.
 * مرة كل 10 دقائق كحد أقصى: ساعة جهاز خاطئة لا تسبب حلقة تجديد لا تنتهي.
 */
export async function keepSessionFresh() {
  const exp = tokenExpiry(getToken());
  if (exp == null) return;
  if (exp - Date.now() >= 8 * 3600_000) return;
  if (Date.now() - lastProactiveRefresh < 10 * 60_000) return;
  lastProactiveRefresh = Date.now();
  await refreshSession();
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number; _retried?: boolean }): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const timeoutMs = init?.timeoutMs ?? (init?.method && init.method !== 'GET' ? 120_000 : 30_000);
  const rest = { ...(init ?? {}) };
  delete rest.timeoutMs;
  delete rest._retried;
  let res: Response;
  try {
    res = await fetchLan(`${getApiBase()}${path}`, {
      ...rest,
      credentials: 'omit',
      headers,
      timeoutMs,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error('انتهت مهلة الاتصال بالخادم');
    }
    throw new Error(e instanceof Error ? e.message : 'تعذر الاتصال بالخادم');
  }
  if (res.status === 401 && token && !init?._retried && !path.startsWith('/auth/')) {
    // الرمز انتهى — نجدده بصمت ونعيد نفس الطلب مرة واحدة قبل إرسال المستخدم لشاشة الدخول
    if (await refreshSession()) return request<T>(path, { ...(init ?? {}), _retried: true });
  }
  if (res.status === 401) {
    setToken(null);
    localStorage.removeItem('fot_admin_user');
    const hashRouted =
      Boolean(window.fotDesktop) ||
      window.location.protocol === 'file:' ||
      window.location.hash.startsWith('#/');
    if (hashRouted) {
      window.location.hash = '#/login';
    } else {
      window.location.assign('/login');
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(readApiError(text) || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function withPages<T>(r: PagedResult<T>) {
  return { ...r, totalPages: r.pageSize <= 0 ? 0 : Math.ceil(r.total / r.pageSize) };
}

export const api = {
  health: () => fetchLan(`${getApiBase()}/health`, { timeoutMs: 2500 }).then(r => r.ok).catch(() => false),

  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  // Dashboard
  dashboardStats: () => request<DashboardStats>('/api/dashboard/stats'),
  recentReceipts: (limit = 8) => request<ReceiptSummary[]>(`/api/dashboard/recent-receipts?limit=${limit}`),
  terminals: () => request<TerminalDto[]>('/api/dashboard/terminals'),
  pushPosUpdates: () =>
    request<{ version: number; sentAt: string }>('/api/sync/push', { method: 'POST' }),

  // Products
  products: (page: number, search?: string, pageSize = 50, filter?: string) =>
    request<PagedResult<ProductDto>>(`/api/products${qs({ page, pageSize, search, filter })}`).then(withPages),
  searchProducts: (q: string) => request<ProductDto[]>(`/api/products/search${qs({ q, limit: 40 })}`),
  productById: (id: number) => request<ProductDto>(`/api/products/${id}`),
  productByBarcode: (code: string) => request<ProductDto>(`/api/products/barcode/${encodeURIComponent(code)}`),
  catalogInfo: () => request<CatalogInfoDto>('/api/catalog/info'),
  updateProduct: (id: number, req: UpdateProductRequest) =>
    request<void>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),

  // Offers
  offers: (page = 1) => request<PagedResult<OfferDto>>(`/api/offers${qs({ page, pageSize: 500 })}`).then(withPages),
  offersStats: () => request<OfferStatsDto>('/api/offers/stats'),
  offerFolders: () => request<OfferFolderDto[]>('/api/offers/folders'),
  createOfferFolder: (name: string) =>
    request<{ id: number }>('/api/offers/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameOfferFolder: (id: number, name: string) =>
    request<void>(`/api/offers/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteOfferFolder: (id: number) => request<void>(`/api/offers/folders/${id}`, { method: 'DELETE' }),
  moveOfferToFolder: (offerId: number, folderId: number | null) =>
    request<void>(`/api/offers/${offerId}/folder`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId }),
    }),
  offerDetails: (id: number, role?: number) =>
    request<OfferDetailDto[]>(`/api/offers/${id}/details${role != null ? qs({ role }) : ''}`),
  offerScope: (id: number) => request<OfferScopeDto>(`/api/offers/${id}/scope`),
  offerBundleConditions: (id: number) => request<OfferBundleConditionsDto>(`/api/offers/${id}/bundle-conditions`),
  saveOfferBundleConditions: (id: number, body: OfferBundleConditionsDto) =>
    request<void>(`/api/offers/${id}/bundle-conditions`, { method: 'PUT', body: JSON.stringify(body) }),
  lookupProductOffers: (q: string, limit = 20) =>
    request<ProductOfferLookupDto[]>(`/api/offers/lookup${qs({ q, limit })}`),
  lookupProductCommissions: (q: string, limit = 20) =>
    request<ProductCommissionLookupDto[]>(`/api/commissions/lookup${qs({ q, limit })}`),
  commissionMemberships: (itemIds: number[]) => {
    const ids = [...new Set(itemIds.filter(n => Number.isFinite(n) && n > 0))].slice(0, 200);
    if (!ids.length) return Promise.resolve([] as ProductCommissionMembershipsDto[]);
    return request<ProductCommissionMembershipsDto[]>(`/api/commissions/memberships${qs({ ids: ids.join(',') })}`);
  },
  commissionOverlaps: () => request<CommissionOverlapProductDto[]>('/api/commissions/groups/overlaps'),
  offerMemberships: (itemIds: number[]) => {
    const ids = [...new Set(itemIds.filter(n => Number.isFinite(n) && n > 0))].slice(0, 200);
    if (!ids.length) return Promise.resolve([] as ProductOfferMembershipsDto[]);
    return request<ProductOfferMembershipsDto[]>(`/api/offers/memberships${qs({ ids: ids.join(',') })}`);
  },
  createOffer: (req: CreateOfferRequest) =>
    request<{ id: number }>('/api/offers', { method: 'POST', body: JSON.stringify(req) }),
  updateOffer: (id: number, req: UpdateOfferRequest) =>
    request<void>(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  setOfferEnabled: (id: number, enabled: boolean) =>
    request<void>(`/api/offers/${id}/enabled?enabled=${enabled}`, { method: 'PATCH' }),
  deleteOffer: (id: number) => request<void>(`/api/offers/${id}`, { method: 'DELETE' }),
  addOfferDetail: (offerId: number, req: UpsertOfferDetailRequest) =>
    request<void>(`/api/offers/${offerId}/details`, { method: 'POST', body: JSON.stringify(req) }),
  deleteOfferDetail: (detailId: number) => request<void>(`/api/offers/details/${detailId}`, { method: 'DELETE' }),
  updateOfferDetail: (detailId: number, req: UpdateOfferDetailRequest) =>
    request<void>(`/api/offers/details/${detailId}`, { method: 'PATCH', body: JSON.stringify(req) }),
  updateOfferTreeDiscount: (offerId: number, treeSeq: number, req: UpdateOfferTreeDiscountRequest) =>
    request<{ updated: number }>(`/api/offers/${offerId}/tree/${treeSeq}/discount`, {
      method: 'PATCH',
      body: JSON.stringify(req),
    }),
  updateOfferDiscountAll: (offerId: number, percent: number, detailRole = 0) =>
    request<{ updated: number }>(
      `/api/offers/${offerId}/discount-all${qs({ percent, detailRole })}`,
      { method: 'PATCH' },
    ),
  addOfferTree: (offerId: number, req: AddOfferTreeRequest) =>
    request<OfferTreeApplyResult>(`/api/offers/${offerId}/details/tree`, { method: 'POST', body: JSON.stringify(req) }),
  addOfferBulk: (offerId: number, req: AddOfferBulkRequest) =>
    request<{ added: number }>(`/api/offers/${offerId}/details/bulk`, { method: 'POST', body: JSON.stringify(req) }),
  deleteOfferTree: (offerId: number, treeSeq: number) =>
    request<{ removed: number }>(`/api/offers/${offerId}/tree/${treeSeq}`, { method: 'DELETE' }),

  // Dynamic tree membership (offers)
  offerTreeProducts: (offerId: number, treeSeq: number) =>
    request<OfferTreeProductDto[]>(`/api/offers/${offerId}/trees/${treeSeq}/products`),
  offerTreeState: (offerId: number, treeSeq: number) =>
    request<OfferTreeStateDto>(`/api/offers/${offerId}/trees/${treeSeq}/state`),
  refreshOfferTree: (offerId: number, treeSeq: number) =>
    request<{ currentCount: number; added: number; message: string }>(
      `/api/offers/${offerId}/trees/${treeSeq}/refresh`,
      { method: 'POST' },
    ),
  setOfferDetailExcluded: (detailId: number, excluded: boolean) =>
    request<void>(`/api/offers/details/${detailId}/excluded?excluded=${excluded}`, { method: 'POST' }),
  setOfferArticleExcluded: (offerId: number, itemId: number, excluded: boolean) =>
    request<void>(`/api/offers/${offerId}/articles/${itemId}/excluded?excluded=${excluded}`, { method: 'POST' }),

  // Dynamic tree membership (commission groups)
  refreshCommissionTree: (groupId: number, treeSeq: number) =>
    request<{ currentCount: number; added: number; message: string }>(
      `/api/commissions/groups/${groupId}/trees/${treeSeq}/refresh`,
      { method: 'POST' },
    ),
  setCommissionItemExcluded: (itemId: number, excluded: boolean) =>
    request<void>(`/api/commissions/groups/items/${itemId}/excluded?excluded=${excluded}`, { method: 'POST' }),
  setCommissionArticleExcluded: (groupId: number, articleId: number, excluded: boolean) =>
    request<void>(`/api/commissions/groups/${groupId}/articles/${articleId}/excluded?excluded=${excluded}`, { method: 'POST' }),

  // Tree
  articleTree: (parent?: number, search?: string, limit = 200) =>
    request<TreeNodeDto[]>(`/api/articles/tree${qs({ limit, parent, search })}`),
  edariTree: (parent?: number, search?: string, limit = 200) =>
    request<TreeNodeDto[]>(`/api/edari/tree/materials${qs({ limit, parent, search })}`),
  edariBranches: () => request<EdariBranchDto[]>('/api/edari/branches'),
  edariTreeProductCount: (seq: number) => request<{ count: number }>(`/api/edari/tree/${seq}/product-count`),
  treeProductCount: (seq: number) => request<{ count: number }>(`/api/articles/tree/${seq}/product-count`),
  treeProducts: (seq: number) => request<TreeProductInfoDto[]>(`/api/articles/tree/${seq}/products`),

  // Receipts
  searchReceipts: (p: {
    page?: number;
    pageSize?: number;
    search?: string;
    sectionId?: number;
    posId?: number;
    cashierId?: number;
    kind?: number;
    synced?: boolean;
    hold?: boolean;
    from?: string;
    to?: string;
  }) => request<ReceiptSearchResult>(`/api/receipts${qs(p)}`),
  receiptDetail: (id: number) => request<ReceiptDetailDto>(`/api/receipts/${id}`),
  setReceiptPrintedNumber: (id: number, printedNumber: number | null) =>
    request<ReceiptDetailDto>(`/api/receipts/${id}/printed-number`, {
      method: 'POST',
      body: JSON.stringify({ printedNumber }),
    }),
  holdReceipts: (sectionId?: number, posId?: number) =>
    request<HoldReceiptDto[]>(`/api/receipts/holds${qs({ sectionId, posId })}`),
  completeHold: (id: number, payment: number) =>
    request<ReceiptDetailDto>(`/api/receipts/hold/${id}/complete${qs({ payment })}`, { method: 'POST' }),
  discountQrPeople: () => request<DiscountQrPersonDto[]>('/api/discount-qr-people'),
  createDiscountQrPerson: (name: string) =>
    request<DiscountQrPersonDto>('/api/discount-qr-people', { method: 'POST', body: JSON.stringify({ name }) }),
  updateDiscountQrPerson: (id: number, req: { name?: string; active?: boolean }) =>
    request<void>(`/api/discount-qr-people/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  discountQrReceipts: (id: number) =>
    request<DiscountQrReceiptDto[]>(`/api/discount-qr-people/${id}/receipts`),
  permissions: () => request<CashierPermissionsDto[]>('/api/permissions'),
  updatePermissions: (id: number, req: UpdatePermissionsRequest) =>
    request<void>(`/api/permissions/${id}`, { method: 'PUT', body: JSON.stringify(req) }),

  // Groups & accounts
  groups: () => request<ArticleGroupDto[]>('/api/groups'),
  groupItems: (id: number) => request<ArticleGroupItemDto[]>(`/api/groups/${id}/items`),
  createGroup: (req: CreateArticleGroupRequest) =>
    request<ArticleGroupDto>('/api/groups', { method: 'POST', body: JSON.stringify(req) }),
  updateGroup: (id: number, req: UpdateArticleGroupRequest) =>
    request<void>(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteGroup: (id: number) => request<void>(`/api/groups/${id}`, { method: 'DELETE' }),
  addGroupProducts: (id: number, articleSeqs: number[]) =>
    request<ArticleGroupWriteResult>(`/api/groups/${id}/products`, {
      method: 'POST',
      body: JSON.stringify({ articleSeqs }),
    }),
  addGroupTrees: (id: number, treeSeqs: number[]) =>
    request<ArticleGroupWriteResult>(`/api/groups/${id}/trees`, {
      method: 'POST',
      body: JSON.stringify({ treeSeqs }),
    }),
  deleteGroupItem: (id: number, itemId: number) =>
    request<void>(`/api/groups/${id}/items/${itemId}`, { method: 'DELETE' }),
  creditAccounts: () => request<AccountSummaryDto[]>('/api/accounts/credit'),
  creditAccountsEdari: (search?: string) =>
    request<PosCreditAccountDto[]>(`/api/accounts/credit/edari${qs({ search })}`),
  cashBoxAccountsEdari: (search?: string) =>
    request<AccountSummaryDto[]>(`/api/accounts/cashbox/edari${qs({ search })}`),
  creditAccountsSelected: () => request<PosCreditAccountDto[]>('/api/accounts/credit/selected'),
  saveCreditAccountSelection: (edariSeqs: number[]) =>
    request<PosCreditAccountDto[]>('/api/accounts/credit/selection', {
      method: 'PUT',
      body: JSON.stringify({ edariSeqs }),
    }),

  // Activity
  cashierActivity: (from: string, to: string, search?: string, cashierId?: number) =>
    request<CashierActivityDto[]>(`/api/activity/cashier${qs({ from, to, limit: 300, search, cashierId })}`),

  // Reports
  dailySales: (from: string, to: string) => request<DailySalesRowDto[]>(`/api/reports/daily-sales${qs({ from, to })}`),
  salesBySalesman: (from: string, to: string) =>
    request<SalesmanSalesRowDto[]>(`/api/reports/sales-by-salesman${qs({ from, to })}`),
  salesHeatmap: (from: string, to: string) => request<HeatmapReportDto>(`/api/reports/heatmap${qs({ from, to })}`),
  cashierPerformance: (from: string, to: string) =>
    request<CashierPerformanceRowDto[]>(`/api/reports/cashier-performance${qs({ from, to })}`),
  reorder: (days: number, coverDays: number, search?: string) =>
    request<ReorderReportDto>(`/api/reports/reorder${qs({ days, coverDays, search })}`),
  slowMovers: (days: number, minStock: number, search?: string, neverSold?: boolean) =>
    request<SlowMoverReportDto>(`/api/reports/slow-movers${qs({ days, minStock, search, neverSold: neverSold || undefined })}`),
  movement: (from: string, to: string, search?: string) =>
    request<MovementRowDto[]>(`/api/reports/movement${qs({ from, to, search })}`),
  cashReport: (from: string, to: string) => request<CashReportDto>(`/api/reports/cash${qs({ from, to })}`),
  dayBreakdown: (date: string) => request<DayBreakdownDto>(`/api/reports/day-breakdown${qs({ date })}`),
  cashierVoids: (from: string, to: string) =>
    request<CashierVoidReportDto>(`/api/reports/cashier-voids${qs({ from, to })}`),
  cashierVoidDetail: (cashierId: number, from: string, to: string) =>
    request<CashierVoidEventDto[]>(`/api/reports/cashier-voids/${cashierId}${qs({ from, to })}`),
  offerSalesClosures: () => request<OfferSalesClosureDto[]>('/api/reports/offer-sales/closures'),
  offerSalesReport: (offerId: number) =>
    request<OfferSalesReportDto>(`/api/reports/offer-sales/${offerId}`),

  // Staff
  salesmen: (includeAll = false) =>
    request<PagedResult<SalesmanDto>>(`/api/salesmen?page=1&pageSize=500&activeOnly=false&includeAll=${includeAll}`).then(withPages),
  portalSellers: () => request<PortalSellerAccountDto[]>('/api/portal-accounts/sellers'),
  issueSellerPin: (id: number) =>
    request<PortalSellerAccountDto>(`/api/portal-accounts/sellers/${id}/issue`, { method: 'POST' }),
  issueMissingSellerPins: () =>
    request<PortalBulkIssueResult>('/api/portal-accounts/sellers/issue-missing', { method: 'POST' }),
  setSellerPortalActive: (id: number, active: boolean) =>
    request<PortalSellerAccountDto>(`/api/portal-accounts/sellers/${id}/active${qs({ active })}`, { method: 'POST' }),
  setSellerAccess: (id: number, body: SellerAccessRequest) =>
    request<PortalSellerAccountDto>(`/api/portal-accounts/sellers/${id}/access`, { method: 'PUT', body: JSON.stringify(body) }),
  setAllSellersAccess: (body: SellerAccessRequest) =>
    request<{ updated: number }>('/api/portal-accounts/sellers/access-all', { method: 'PUT', body: JSON.stringify(body) }),
  sellerBrandLinks: () => request<SellerBrandLinkDto[]>('/api/portal-accounts/brand-links'),
  setSellerBrands: (id: number, trees: { treeSeq: number; treeName?: string | null }[]) =>
    request<SellerBrandLinkDto[]>(`/api/portal-accounts/sellers/${id}/brands`, { method: 'PUT', body: JSON.stringify({ trees }) }),
  // تطبيق الفريق
  teamStaff: () => request<StaffDto[]>('/api/team/staff'),
  createStaff: (body: StaffSaveRequest) => request<StaffDto>('/api/team/staff', { method: 'POST', body: JSON.stringify(body) }),
  updateStaff: (id: number, body: StaffSaveRequest) =>
    request<StaffDto>(`/api/team/staff/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  issueStaffPin: (id: number) => request<StaffDto>(`/api/team/staff/${id}/pin`, { method: 'POST' }),
  setStaffActive: (id: number, active: boolean) =>
    request<StaffDto>(`/api/team/staff/${id}/active${qs({ active })}`, { method: 'POST' }),
  importStaffCashiers: () => request<{ added: number; staff: StaffDto[] }>('/api/team/staff/import-cashiers', { method: 'POST' }),
  /** خادم الفريق عبر وكيل المحل */
  teamHubStatus: () => request<TeamHubStatusDto>('/api/team/hub/status'),
  resetStaffDevice: (id: number) => request<{ ok: boolean }>(`/api/team/hub/staff/${id}/reset-device`, { method: 'POST' }),
  // تطبيق الفريق: الإجازات والعطل والإعلانات والتبليغات (عبر وكيل خادم الفريق)
  teamOverview: () => request<TeamOverviewDto>('/api/team/hub/overview'),
  teamDirectory: () => request<TeamDirStaffDto[]>('/api/team/hub/directory'),
  teamLeave: (status: 'pending' | 'approved' | 'rejected' | 'all') => request<TeamLeaveDto[]>(`/api/team/hub/leave?status=${status}`),
  decideTeamLeave: (id: number, approve: boolean, note?: string) =>
    request<TeamLeaveDto>(`/api/team/hub/leave/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve, note }) }),
  setTeamWeeklyOff: (staffId: number, daysMask: number) =>
    request<{ daysMask: number }>(`/api/team/hub/staff/${staffId}/weekly-off`, { method: 'PUT', body: JSON.stringify({ daysMask }) }),
  teamPosts: () => request<TeamPostDto[]>('/api/team/hub/posts'),
  saveTeamPost: (body: TeamPostSave, id?: number) =>
    request<TeamPostDto>(id ? `/api/team/hub/posts/${id}` : '/api/team/hub/posts', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }),
  deleteTeamPost: (id: number) => request<{ ok: boolean }>(`/api/team/hub/posts/${id}`, { method: 'DELETE' }),
  teamPostReaders: (id: number) => request<TeamPostReaderDto[]>(`/api/team/hub/posts/${id}/readers`),
  teamNotify: (body: { title: string; body?: string; image?: string | null; audience: TeamAudience }) =>
    request<{ ok: boolean; count: number }>('/api/team/hub/notify', { method: 'POST', body: JSON.stringify(body) }),
  teamNotifyLog: () => request<TeamBroadcastDto[]>('/api/team/hub/notify/log'),
  uploadTeamMedia: (dataUrl: string) => request<{ url: string }>('/api/team/hub/media', { method: 'POST', body: JSON.stringify({ data: dataUrl }) }),
  teamBoard: () => request<TeamBoardDto>('/api/team/hub/attend/board'),
  teamAttendLog: (from: string, to: string, staffId?: number) =>
    request<TeamAttendDto[]>(`/api/team/hub/attend/log?from=${from}&to=${to}${staffId ? `&staffId=${staffId}` : ''}`),
  teamAttendSettings: () => request<{ settings: TeamAttendSettingsDto; networks: TeamNetworkDto[] }>('/api/team/hub/attend/settings'),
  saveTeamAttendSettings: (body: Partial<TeamAttendSettingsDto>) =>
    request<TeamAttendSettingsDto>('/api/team/hub/attend/settings', { method: 'PUT', body: JSON.stringify(body) }),
  saveTeamNetwork: (body: Partial<TeamNetworkDto>, id?: number) =>
    request<TeamNetworkDto>(id ? `/api/team/hub/networks/${id}` : '/api/team/hub/networks', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }),
  deleteTeamNetwork: (id: number) => request<{ ok: boolean }>(`/api/team/hub/networks/${id}`, { method: 'DELETE' }),
  correctTeamAttend: (id: number, body: { checkIn?: string; checkOut?: string | null; note?: string }) =>
    request<TeamAttendDto>(`/api/team/hub/attend/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  manualTeamAttend: (body: { staffId: number; checkIn: string; checkOut?: string | null; note?: string }) =>
    request<TeamAttendDto>('/api/team/hub/attend/manual', { method: 'POST', body: JSON.stringify(body) }),
  setTeamShift: (staffId: number, body: Partial<TeamShiftDto> & { reset?: boolean }) =>
    request<TeamShiftDto>(`/api/team/hub/staff/${staffId}/shift`, { method: 'PUT', body: JSON.stringify(body) }),
  setTeamOvertime: (staffId: number, enabled: boolean, rate: number | null) =>
    request<TeamShiftDto>(`/api/team/hub/staff/${staffId}/overtime`, { method: 'PUT', body: JSON.stringify({ enabled, rate }) }),
  /** شبكات الواي فاي المرئية من جهاز السيرفر في المحل */
  teamWifiScan: () => request<WifiScanDto>('/api/team/wifi-scan', { timeoutMs: 40_000 }),
  /** عنوان الإنترنت العام للمحل كما يراه خادم الفريق */
  teamShopIp: () => request<{ ip: string }>('/api/team/hub/whoami'),
  teamAttendSummary: (from: string, to: string) => request<TeamSummaryDto>(`/api/team/hub/attend/summary?from=${from}&to=${to}`),
  teamRoster: (from: string, days = 7) => request<TeamRosterDto>(`/api/team/hub/roster?from=${from}&days=${days}`),
  teamAppReleases: () => request<TeamAppReleaseDto[]>('/api/team/hub/app-releases'),
  uploadTeamAppRelease: (body: { version: string; notes?: string; required: boolean; data: string }) =>
    request<TeamAppReleaseDto>('/api/team/hub/app-releases', { method: 'POST', body: JSON.stringify(body), timeoutMs: 300_000 }),
  deleteTeamAppRelease: (id: number) => request<{ ok: boolean }>(`/api/team/hub/app-releases/${id}`, { method: 'DELETE' }),
  /** مفتاح الربط بين سيرفر المحل وخادم الفريق */
  teamSyncKey: () => request<{ configured: boolean; source: 'settings' | 'file' | 'none'; masked: string }>('/api/team/sync-key'),
  saveTeamSyncKey: (key: string) =>
    request<{ configured: boolean; source: string; masked: string }>('/api/team/sync-key', { method: 'PUT', body: JSON.stringify({ key }) }),
  teamPushStatus: () => request<TeamPushStatusDto>('/api/team/hub/push/status'),
  teamPushTest: (kind: 'staff' | 'manager', id: number) =>
    request<TeamPushStatusDto>('/api/team/hub/push/test', { method: 'POST', body: JSON.stringify({ kind, id }) }),
  teamManagers: () => request<{ managers: TeamManagerPermsDto[]; sections: { id: number; name: string; staffCount: number }[] }>('/api/team/hub/managers'),
  saveTeamManagerPerms: (id: number, body: { perms: Record<string, boolean>; sections: number[] }) =>
    request<{ id: number }>(`/api/team/hub/managers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  teamCommissionProducts: () => request<TeamCommissionProductDto[]>('/api/team/hub/commission-products'),
  setTeamProductImage: (barcode: string, url: string | null) =>
    request<{ ok?: boolean; image?: string }>(`/api/team/hub/product-images/${encodeURIComponent(barcode)}`, url ? { method: 'PUT', body: JSON.stringify({ url }) } : { method: 'DELETE' }),
  teamAudit: (limit = 300) => request<TeamAuditDto[]>(`/api/team/hub/audit?limit=${limit}`),
  /** صورة من خادم الفريق كرابط محلي (المتصفح لا يرسل رمز الدخول في وسم img). */
  teamMediaObjectUrl: async (url: string) => {
    // مرفقات الإجازات خاصة (/api/team/private/<name>?exp=&sig=) — تُجلب بمفتاح المزامنة عبر الوكيل بلا التوقيع
    const path = url.split('?')[0];
    const name = path.split('/').pop() ?? '';
    const folder = path.includes('/api/team/private/') ? 'private' : 'media';
    const token = getToken();
    const res = await fetchLan(`${getApiBase()}/api/team/hub/${folder}/${encodeURIComponent(name)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeoutMs: 60_000,
    });
    if (!res.ok) throw new Error('تعذر تحميل الصورة');
    return URL.createObjectURL(await res.blob());
  },
  portalWebStatus: () => request<PortalWebStatusDto>('/api/portal-accounts/web-status'),
  publishSellerToWeb: (id: number) =>
    request<PortalPublishResult>(`/api/portal-accounts/sellers/${id}/publish`, { method: 'POST' }),
  portalManagers: () => request<PortalManagerAccountDto[]>('/api/portal-accounts/managers'),
  createPortalManager: (username: string, displayName: string, password: string) =>
    request<PortalManagerAccountDto>('/api/portal-accounts/managers', {
      method: 'POST',
      body: JSON.stringify({ username, displayName, password }),
    }),
  resetPortalManager: (id: number, password: string) =>
    request<PortalManagerAccountDto>(`/api/portal-accounts/managers/${id}/reset`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  updatePortalManager: (id: number, displayName: string) =>
    request<PortalManagerAccountDto>(`/api/portal-accounts/managers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  setPortalManagerActive: (id: number, active: boolean) =>
    request<PortalManagerAccountDto>(`/api/portal-accounts/managers/${id}/active${qs({ active })}`, { method: 'POST' }),
  cashiers: (search?: string) =>
    request<PagedResult<CashierDto>>(`/api/cashiers${qs({ page: 1, pageSize: 200, search })}`).then(withPages),
  cashier: (id: number) => request<CashierDetailDto>(`/api/cashiers/${id}`),
  createCashier: (body: CreateCashierRequest) =>
    request<{ id: number }>('/api/cashiers', { method: 'POST', body: JSON.stringify(body) }),
  updateCashier: (id: number, body: UpdateCashierRequest) =>
    request<void>(`/api/cashiers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deactivateCashier: (id: number) => request<void>(`/api/cashiers/${id}`, { method: 'DELETE' }),
  sections: (summary = true) =>
    request<SectionSummaryDto[] | SectionDto[]>(`/api/sections${qs({ summary })}`),
  sectionDetail: (id: number) => request<SectionDetailDto>(`/api/sections/${id}`),
  createSection: (req: CreateSectionRequest) =>
    request<SectionSaveResponse>('/api/sections', { method: 'POST', body: JSON.stringify(req) }),
  updateSection: (id: number, req: UpdateSectionRequest) =>
    request<void>(`/api/sections/${id}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteSection: (id: number) => request<void>(`/api/sections/${id}`, { method: 'DELETE' }),
  posTerminals: () => request<PosTerminalDetailDto[]>('/api/terminals'),
  posTerminal: (id: number) => request<PosTerminalDetailDto>(`/api/terminals/${id}`),
  updateTerminal: (id: number, req: UpdateTerminalRequest) =>
    request<void>(`/api/terminals/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteTerminal: (id: number) => request<void>(`/api/terminals/${id}`, { method: 'DELETE' }),
  terminalActivity: (id: number, limit = 30) =>
    request<CashierActivityDto[]>(`/api/terminals/${id}/activity${qs({ limit })}`),

  // Commissions & targets
  // Commissions
  commissionRules: () => request<CommissionRuleDto[]>('/api/commissions/rules'),
  commissionRule: (id: number) => request<CommissionRuleDto>(`/api/commissions/rules/${id}`),
  createCommissionRule: (req: CreateCommissionRuleRequest) =>
    request<{ id: number }>('/api/commissions/rules', { method: 'POST', body: JSON.stringify(req) }),
  updateCommissionRule: (id: number, req: UpdateCommissionRuleRequest) =>
    request<void>(`/api/commissions/rules/${id}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteCommissionRule: (id: number) => request<void>(`/api/commissions/rules/${id}`, { method: 'DELETE' }),
  setCommissionRuleActive: (id: number, active: boolean) =>
    request<void>(`/api/commissions/rules/${id}/active?active=${active}`, { method: 'PATCH' }),
  commissionCalculations: (from?: string, to?: string, salesmanId?: number, limit = 500) =>
    request<CommissionCalculationDto[]>(
      `/api/commissions/calculations${qs({ from, to, salesmanId, limit })}`,
    ),
  commissionSummary: (from: string, to: string) =>
    request<SalesmanCommissionSummaryDto[]>(`/api/commissions/summary${qs({ from, to, activeOnly: false })}`),
  commissionDailyReport: (from: string, to: string, salesmanId?: number) =>
    request<CommissionDailyReportRow[]>(`/api/commissions/reports/daily${qs({ from, to, salesmanId })}`),
  commissionGroupReport: (from: string, to: string, salesmanId?: number) =>
    request<CommissionGroupReportRow[]>(`/api/commissions/reports/groups${qs({ from, to, salesmanId })}`),
  commissionProductReport: (from: string, to: string, salesmanId?: number, limit = 100) =>
    request<CommissionProductReportRow[]>(`/api/commissions/reports/products${qs({ from, to, salesmanId, limit })}`),
  commissionReceiptReport: (from: string, to: string, salesmanId?: number, limit = 200) =>
    request<CommissionReceiptReportRow[]>(`/api/commissions/reports/receipts${qs({ from, to, salesmanId, limit })}`),
  commissionHealth: (from: string, to: string) =>
    request<CommissionHealthDto>(`/api/commissions/health${qs({ from, to })}`),
  commissionDiagnose: (receiptId: number) =>
    request<CommissionReceiptDiagnoseDto>(`/api/commissions/diagnose/${receiptId}`),
  recalculateCommissions: (req: { from?: string; to?: string; receiptId?: number }) =>
    request<RecalculateCommissionsResult>('/api/commissions/recalculate', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  previewCommission: (req: {
    articleId?: number | null;
    barcode?: string | null;
    salesmanId?: number;
    quantity?: number;
    price?: number;
  }) =>
    request<CommissionPreviewDto>('/api/commissions/preview', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  commissionPayouts: (from?: string, to?: string, salesmanId?: number, limit = 200) =>
    request<CommissionPayoutDto[]>(`/api/commissions/payouts${qs({ from, to, salesmanId, limit })}`),
  recordCommissionPayout: (salesmanId: number, req: { amount: number; paidAt?: string; note?: string | null }) =>
    request<CommissionPayoutDto>(`/api/commissions/payouts/${salesmanId}`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  voidCommissionPayout: (payoutId: number) =>
    request<void>(`/api/commissions/payouts/${payoutId}/void`, { method: 'POST' }),
  targetReceipts: (id: number, periodStart?: string, periodEnd?: string) =>
    request<TargetReceiptRowDto[]>(`/api/targets/rules/${id}/receipts${qs({ periodStart, periodEnd })}`),
  commissionProfiles: () => request<SalesmanCommissionProfileDto[]>('/api/commissions/profiles'),
  saveCommissionProfile: (salesmanId: number, req: UpdateSalesmanCommissionProfileRequest) =>
    request<void>(`/api/commissions/profiles/${salesmanId}`, { method: 'PUT', body: JSON.stringify(req) }),
  commissionGroups: () => request<CommissionGroupDto[]>('/api/commissions/groups'),
  commissionGroup: (id: number) => request<CommissionGroupDetailDto>(`/api/commissions/groups/${id}`),
  createCommissionGroup: (req: CreateCommissionGroupRequest) =>
    request<{ id: number }>('/api/commissions/groups', { method: 'POST', body: JSON.stringify(req) }),
  updateCommissionGroup: (id: number, req: UpdateCommissionGroupRequest) =>
    request<void>(`/api/commissions/groups/${id}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteCommissionGroup: (id: number) =>
    request<void>(`/api/commissions/groups/${id}`, { method: 'DELETE' }),
  setCommissionGroupActive: (id: number, active: boolean) =>
    request<void>(`/api/commissions/groups/${id}/active?active=${active}`, { method: 'PATCH' }),
  addCommissionGroupTree: (groupId: number, treeSeq: number, treeName?: string) =>
    request<CommissionGroupTreeApplyResult>(`/api/commissions/groups/${groupId}/trees`, {
      method: 'POST',
      body: JSON.stringify({ treeSeq, treeName }),
    }),
  addCommissionGroupPartialTree: (
    groupId: number,
    treeSeq: number,
    articleIds: number[],
    treeName?: string,
  ) =>
    request<CommissionGroupTreeApplyResult>(`/api/commissions/groups/${groupId}/trees/partial`, {
      method: 'POST',
      body: JSON.stringify({ treeSeq, treeName, articleIds }),
    }),
  deleteCommissionGroupTree: (groupId: number, treeSeq: number) =>
    request<{ deleted: number }>(`/api/commissions/groups/${groupId}/trees/${treeSeq}`, { method: 'DELETE' }),
  addCommissionGroupProduct: (groupId: number, req: { articleId?: number; barcode?: string }) =>
    request<CommissionGroupItemDto>(`/api/commissions/groups/${groupId}/products`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  deleteCommissionGroupItem: (groupId: number, itemId: number) =>
    request<void>(`/api/commissions/groups/${groupId}/items/${itemId}`, { method: 'DELETE' }),
  moveCommissionGroupItems: (itemIds: number[], toGroupId: number) =>
    request<{ moved: number }>('/api/commissions/groups/move-items', {
      method: 'POST',
      body: JSON.stringify({ itemIds, toGroupId }),
    }),
  moveCommissionGroupTree: (fromGroupId: number, treeSeq: number, toGroupId: number) =>
    request<{ moved: number }>('/api/commissions/groups/move-tree', {
      method: 'POST',
      body: JSON.stringify({ fromGroupId, treeSeq, toGroupId }),
    }),
  commissionGroupTreeProducts: (groupId: number, treeSeq: number) =>
    request<CommissionGroupTreeProductDto[]>(`/api/commissions/groups/${groupId}/trees/${treeSeq}/products`),
  targetRules: () => request<TargetRuleDto[]>('/api/targets/rules'),
  targetRule: (id: number) => request<TargetRuleDto>(`/api/targets/rules/${id}`),
  targetProgress: () => request<TargetProgressDto[]>('/api/targets/progress'),
  targetBreakdowns: (periodStart?: string, periodEnd?: string) =>
    request<TargetBreakdownDto[]>(`/api/targets/breakdowns${qs({ periodStart, periodEnd })}`),
  targetBreakdown: (id: number, periodStart?: string, periodEnd?: string) =>
    request<TargetBreakdownDto>(`/api/targets/rules/${id}/breakdown${qs({ periodStart, periodEnd })}`),
  createTargetRule: (req: CreateTargetRuleRequest) =>
    request<{ id: number }>('/api/targets/rules', { method: 'POST', body: JSON.stringify(req) }),
  updateTargetRule: (id: number, req: UpdateTargetRuleRequest) =>
    request<void>(`/api/targets/rules/${id}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteTargetRule: (id: number) =>
    request<void>(`/api/targets/rules/${id}`, { method: 'DELETE' }),
  setTargetRuleActive: (id: number, active: boolean) =>
    request<void>(`/api/targets/rules/${id}/active?active=${active}`, { method: 'PATCH' }),
  setTargetArticleExcluded: (ruleId: number, articleId: number, excluded: boolean) =>
    request<void>(`/api/targets/rules/${ruleId}/articles/${articleId}/excluded?excluded=${excluded}`, { method: 'POST' }),

  // Terminals monitor
  terminalMonitor: () => request<SectionTerminalGroupDto[]>('/api/terminals/monitor'),

  // Print settings
  printSettings: () => request<PrintSettingsDto>('/api/settings/print'),
  printPreview: () => request<ReceiptPrintPreviewDto>('/api/settings/print/preview'),
  savePrintSettings: (req: UpdatePrintSettingsRequest) =>
    request<PrintSettingsDto>('/api/settings/print', { method: 'PUT', body: JSON.stringify(req) }),
  uploadPrintLogo: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<PrintSettingsDto>('/api/settings/print/logo', { method: 'POST', body: fd });
  },
  deletePrintLogo: () => request<PrintSettingsDto>('/api/settings/print/logo', { method: 'DELETE' }),

  // Cash box routing
  cashBoxSettings: () => request<PosCashBoxSettingsDto>('/api/settings/cashboxes'),
  saveCashBoxSettings: (req: UpdatePosCashBoxSettingsRequest) =>
    request<PosCashBoxSettingsDto>('/api/settings/cashboxes', { method: 'PUT', body: JSON.stringify(req) }),

  businessPeriodSettings: () => request<BusinessPeriodSettingsDto>('/api/settings/business-period'),
  saveBusinessPeriodSettings: (req: UpdateBusinessPeriodSettingsRequest) =>
    request<BusinessPeriodSettingsDto>('/api/settings/business-period', { method: 'PUT', body: JSON.stringify(req) }),

  weeklySettlement: (weekStart?: string) =>
    request<WeeklySettlementReportDto>(`/api/reports/weekly-settlement${qs({ weekStart })}`),
  saveWeeklySettlementSettings: (req: UpdateWeeklySettlementSettingsRequest) =>
    request<WeeklySettlementSettingsDto>('/api/reports/weekly-settlement/settings', {
      method: 'PUT',
      body: JSON.stringify(req),
    }),
  saveWeeklySettlementRow: (req: UpdateWeeklySettlementRowRequest) =>
    request<WeeklySettlementRowSaveDto>('/api/reports/weekly-settlement/row', {
      method: 'PUT',
      body: JSON.stringify(req),
    }),
  productInquiry: (req: ProductInquiryRequest) =>
    request<ProductInquiryDto>('/api/reports/product-inquiry', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  // Edari
  edariStatus: () => request<EdariSyncStatusDto>('/api/edari/status'),
  edariUnsynced: () => request<ReceiptSummary[]>('/api/edari/unsynced?limit=100'),
  edariLogs: () => request<EdariSyncLogDto[]>('/api/edari/logs?limit=100'),
  edariSettings: () => request<EdariSettingsDto>('/api/edari/settings'),
  edariYears: () => request<string[]>('/api/edari/years'),
  saveEdariSettings: (req: UpdateEdariSettingsRequest) =>
    request<void>('/api/edari/settings', { method: 'PUT', body: JSON.stringify(req) }),
  testEdariConnection: () => request<EdariConnectionTestResult>('/api/edari/test-connection', { method: 'POST' }),
  syncEdariReceipts: (syncAll = true, batchSize = 50) =>
    request<EdariSyncRunResult>(
      `/api/edari/sync/receipts?batchSize=${batchSize}&syncAll=${syncAll}`,
      { method: 'POST' },
    ),
  resetEdariReceipts: (from?: string, to?: string, sectionId?: number) =>
    request<{ resetCount: number; message: string }>(
      `/api/edari/sync/receipts/reset${qs({ from, to, sectionId })}`,
      { method: 'POST' },
    ),
  syncEdariCatalog: () => request<EdariSyncRunResult>('/api/edari/sync/catalog', { method: 'POST' }),
  syncEdariPull: (catalog = false) =>
    request<EdariDataPullResult>(`/api/edari/sync/pull?catalog=${catalog}`, { method: 'POST' }),
  syncEdariArticles: () =>
    request<{ success: boolean; message: string; added: number; updated: number; total: number }>(
      '/api/edari/sync/articles',
      { method: 'POST' },
    ),
  syncEdariBranches: () =>
    request<{ success: boolean; message: string; branchCount: number; edariBranchesAdded: number; sectionsCreated: number }>(
      '/api/edari/sync/branches',
      { method: 'POST' },
    ),
  syncEdariSalesmen: () =>
    request<{ success: boolean; message: string; added: number; updated: number; total: number }>(
      '/api/edari/sync/salesmen',
      { method: 'POST' },
    ),
  syncEdariFull: (catalog = false) =>
    request<EdariFullSyncResult>(
      `/api/edari/sync/full${qs({ catalog, receipts: true, receiptBatch: 50 })}`,
      { method: 'POST' },
    ),
  syncEdariArabicNames: () =>
    request<EdariArabicNamesBackfillResult>('/api/edari/sync/arabic-names', { method: 'POST' }),
  syncEdariAccounts: () =>
    request<{ success: boolean; message: string; total: number; cashBoxes: number; added: number; removed: number }>(
      '/api/edari/sync/accounts',
      { method: 'POST' },
    ),

  edariDeadLetters: () => request<EdariDeadLetterDto[]>('/api/edari/dead-letters?limit=100'),
  retryEdariDeadLetter: (id: number) =>
    request<{ message: string }>(`/api/edari/sync/receipts/${id}/retry`, { method: 'POST' }),
  retryAllEdariDeadLetters: () =>
    request<{ message: string; count: number }>('/api/edari/sync/receipts/retry-all', { method: 'POST' }),

  // Telemetry
  clientErrors: (limit = 50, source?: string) =>
    request<ClientErrorDto[]>(`/api/telemetry/errors?limit=${limit}${source ? `&source=${source}` : ''}`),
  purgeClientErrors: (days = 14) =>
    request<{ purged: number }>(`/api/telemetry/errors?days=${days}`, { method: 'DELETE' }),

  serverInfo: () => request<ServerInfoDto>('/api/server/info'),

  // System Backups
  backups: () => request<BackupFileItemDto[]>('/api/backups'),
  backupSettings: () => request<BackupSettingsDto>('/api/backups/settings'),
  saveBackupSettings: (req: UpdateBackupSettingsRequest) =>
    request<BackupSettingsDto>('/api/backups/settings', {
      method: 'PUT',
      body: JSON.stringify(req),
    }),
  createBackup: (req?: CreateBackupRequest) =>
    request<BackupFileItemDto>('/api/backups/create', {
      method: 'POST',
      body: JSON.stringify(req ?? {}),
      timeoutMs: 300_000,
    }),
  inspectBackup: (fileName: string) =>
    request<BackupManifestDto>(`/api/backups/${encodeURIComponent(fileName)}/inspect`),
  deleteBackup: (fileName: string) =>
    request<void>(`/api/backups/${encodeURIComponent(fileName)}`, { method: 'DELETE' }),
  restoreBackup: (fileName: string, req?: RestoreBackupRequest) =>
    request<RestoreBackupResultDto>(`/api/backups/${encodeURIComponent(fileName)}/restore`, {
      method: 'POST',
      body: JSON.stringify(req ?? {}),
      timeoutMs: 300_000,
    }),
  inspectUploadedBackup: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<BackupManifestDto>('/api/backups/inspect-upload', {
      method: 'POST',
      body: fd,
      timeoutMs: 120_000,
    });
  },
  uploadAndRestoreBackup: (
    file: File,
    opts?: { sections?: string[]; safety?: boolean; saveToVault?: boolean },
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    const q = qs({
      sections: opts?.sections?.length ? opts.sections.join(',') : undefined,
      safety: opts?.safety ?? true,
      saveToVault: opts?.saveToVault ?? true,
    });
    return request<RestoreBackupResultDto>(`/api/backups/upload-restore${q}`, {
      method: 'POST',
      body: fd,
      timeoutMs: 300_000,
    });
  },
  downloadBackup: async (fileName: string) => {
    const token = getToken();
    const res = await fetchLan(`${getApiBase()}/api/backups/${encodeURIComponent(fileName)}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeoutMs: 180_000,
    });
    if (!res.ok) throw new Error('تعذر تحميل ملف النسخة الاحتياطية');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ── Network API Platform ──
  apiPlatformOverview: () => request<ApiPlatformOverviewDto>('/api/platform/overview'),
  apiKeys: () => request<ApiKeyDto[]>('/api/platform/keys'),
  createApiKey: (req: CreateApiKeyRequest) =>
    request<CreateApiKeyResponse>('/api/platform/keys', { method: 'POST', body: JSON.stringify(req) }),
  updateApiKey: (id: number, req: UpdateApiKeyRequest) =>
    request<ApiKeyDto>(`/api/platform/keys/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteApiKey: (id: number) =>
    request<void>(`/api/platform/keys/${id}`, { method: 'DELETE' }),
  apiWebhooks: () => request<ApiWebhookDto[]>('/api/platform/webhooks'),
  createApiWebhook: (req: CreateApiWebhookRequest) =>
    request<ApiWebhookDto>('/api/platform/webhooks', { method: 'POST', body: JSON.stringify(req) }),
  updateApiWebhook: (id: number, req: UpdateApiWebhookRequest) =>
    request<ApiWebhookDto>(`/api/platform/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteApiWebhook: (id: number) =>
    request<void>(`/api/platform/webhooks/${id}`, { method: 'DELETE' }),
  testApiWebhook: (id: number) =>
    request<WebhookTestResultDto>(`/api/platform/webhooks/${id}/test`, { method: 'POST' }),
  recentNetworkEvents: (limit = 30) =>
    request<NetworkEventDto[]>(`/api/v1/events/recent${qs({ limit })}`),
  publishNetworkEvent: (eventType: string, data?: unknown) =>
    request<NetworkEventDto>('/api/v1/events/publish', {
      method: 'POST',
      body: JSON.stringify({ eventType, data }),
    }),
  callNetworkEndpoint: async (method: string, pathWithQuery: string, bodyJson?: string, customApiKey?: string) => {
    const t0 = performance.now();
    const token = getToken();
    const headers: Record<string, string> = {};
    if (customApiKey?.trim()) {
      headers['X-API-Key'] = customApiKey.trim();
    } else if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (bodyJson && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetchLan(`${getApiBase()}${pathWithQuery}`, {
      method,
      headers,
      body: bodyJson && method !== 'GET' ? bodyJson : undefined,
      timeoutMs: 30_000,
    });
    const elapsedMs = Math.round(performance.now() - t0);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs,
      catalogRevision: res.headers.get('X-Catalog-Revision'),
      body: parsed,
    };
  },
};

export interface ApiKeyDto {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  roleName: string;
  notes?: string | null;
  isActive: boolean;
  requestCount: number;
  lastUsedAt?: string | null;
  lastUsedIp?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes?: string[];
  roleName?: string;
  notes?: string;
  expiresInDays?: number | null;
}

export interface CreateApiKeyResponse {
  plainTextKey: string;
  key: ApiKeyDto;
}

export interface UpdateApiKeyRequest {
  name?: string;
  scopes?: string[];
  notes?: string;
  isActive?: boolean;
}

export interface ApiWebhookDto {
  id: number;
  name: string;
  targetUrl: string;
  hasSecret: boolean;
  events: string[];
  isActive: boolean;
  deliveryCount: number;
  failureCount: number;
  lastStatusCode?: number | null;
  lastError?: string | null;
  lastTriggeredAt?: string | null;
  createdAt: string;
}

export interface CreateApiWebhookRequest {
  name: string;
  targetUrl: string;
  secret?: string;
  events?: string[];
}

export interface UpdateApiWebhookRequest {
  name?: string;
  targetUrl?: string;
  secret?: string;
  events?: string[];
  isActive?: boolean;
}

export interface WebhookTestResultDto {
  ok: boolean;
  statusCode?: number | null;
  elapsedMs: number;
  message: string;
}

export interface NetworkEventDto {
  id: number;
  eventType: string;
  timestampUtc: string;
  data?: unknown;
}

export interface ApiEndpointDescriptorDto {
  group: string;
  method: string;
  path: string;
  summary: string;
  scope: string;
  anonymousAllowed: boolean;
  sampleQueryOrBody?: string | null;
}

export interface ApiPlatformOverviewDto {
  serverName: string;
  port: number;
  lanIps: string[];
  baseUrls: string[];
  swaggerUrl: string;
  openApiJsonUrl: string;
  sseStreamUrl: string;
  signalRHubUrl: string;
  catalogRevision: number;
  activeKeysCount: number;
  totalApiKeyRequests: number;
  activeWebhooksCount: number;
  availableScopes: string[];
  endpoints: ApiEndpointDescriptorDto[];
  recentEvents: NetworkEventDto[];
}

const NUM_LOCALE = 'en-US';

export function formatNum(n: number, maxDecimals = 0) {
  return new Intl.NumberFormat(NUM_LOCALE, {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: maxDecimals > 0 ? 0 : undefined,
  }).format(n);
}

/** @param currency ISO code, default IQD */
export function formatCurrency(n: number, currency = 'IQD') {
  return `${formatNum(n)} ${currency}`;
}

export function formatCommissionLabel(type: string, value: number) {
  if (type.toLowerCase() === 'percentage') return `${formatNum(value)}%`;
  return `${formatNum(value)} IQD / قطعة`;
}

export function commissionTypeLabel(type: string) {
  return type.toLowerCase() === 'percentage' ? 'نسبة مئوية' : 'مبلغ ثابت / قطعة';
}

export function formatDate(d: string | Date) {
  return new Date(d).toLocaleString(NUM_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateOnly(d: string | Date) {
  return new Date(d).toLocaleDateString(NUM_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayIso() {
  return localIso(new Date());
}

export function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localIso(d);
}

export function monthStartIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function receiptDisplayNumber(r: ReceiptSummary) {
  if (r.displayNumber) return r.displayNumber;
  if (r.printedNumber != null && r.printedNumber > 0) return String(r.printedNumber);
  return r.number > 0 ? String(r.number) : '—';
}

export function receiptGross(r: ReceiptSummary) {
  return r.grossAmount ?? r.totalAmount + r.offersDiscount + r.userDiscount + r.itemsDiscount;
}

export function receiptKindLabel(r: ReceiptSummary) {
  return r.kindLabel ?? (r.kind === 1 ? 'مرتجع' : r.kind === 2 ? 'هدية' : 'مبيعات');
}

export function receiptSyncLabel(r: ReceiptSummary) {
  return r.syncLabel ?? (r.synced ? (r.edrNum?.toString() ?? 'نعم') : '—');
}
