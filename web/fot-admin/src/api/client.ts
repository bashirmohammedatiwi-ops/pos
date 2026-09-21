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
  CashierDetailDto,
  CashierDto,
  CreateCashierRequest,
  UpdateCashierRequest,
  CashReportDto,
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
  OfferDetailDto,
  OfferDto,
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
  PortalSellerAccountDto,
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

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
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
  offers: (page = 1) => request<PagedResult<OfferDto>>(`/api/offers${qs({ page, pageSize: 100 })}`).then(withPages),
  offersStats: () => request<OfferStatsDto>('/api/offers/stats'),
  offerDetails: (id: number, role?: number) =>
    request<OfferDetailDto[]>(`/api/offers/${id}/details${role != null ? qs({ role }) : ''}`),
  offerScope: (id: number) => request<OfferScopeDto>(`/api/offers/${id}/scope`),
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

  // Dynamic tree membership (commission groups)
  refreshCommissionTree: (groupId: number, treeSeq: number) =>
    request<{ currentCount: number; added: number; message: string }>(
      `/api/commissions/groups/${groupId}/trees/${treeSeq}/refresh`,
      { method: 'POST' },
    ),
  setCommissionItemExcluded: (itemId: number, excluded: boolean) =>
    request<void>(`/api/commissions/groups/items/${itemId}/excluded?excluded=${excluded}`, { method: 'POST' }),

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
  movement: (from: string, to: string, search?: string) =>
    request<MovementRowDto[]>(`/api/reports/movement${qs({ from, to, search })}`),
  cashReport: (from: string, to: string) => request<CashReportDto>(`/api/reports/cash${qs({ from, to })}`),

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
  portalManagers: () => request<PortalManagerAccountDto[]>('/api/portal-accounts/managers'),
  createPortalManager: (username: string, displayName: string) =>
    request<PortalManagerAccountDto>('/api/portal-accounts/managers', {
      method: 'POST',
      body: JSON.stringify({ username, displayName }),
    }),
  resetPortalManager: (id: number) =>
    request<PortalManagerAccountDto>(`/api/portal-accounts/managers/${id}/reset`, { method: 'POST' }),
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
};

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
