import { fetchLan } from '@fot/shared';
import { getApiBase } from '@/lib/apiBase';
import { isServerUnreachable, markServerReachable, markServerUnreachable } from '@/lib/connectionGate';
import type { ApiHealth, HealthzReport } from '@fot/shared';
import type {
  AccountSummaryDto,
  ArticleGroupDto,
  ArticleGroupItemDto,
  CatalogInfoDto,
  CashReportDto,
  CashierPermissionsDto,
  AllocateReceiptNumberResponse,
  CreateReceiptResponse,
  HoldReceiptDto,
  PosSessionDto,
  ReceiptDetailDto,
  ReceiptReturnMatchesDto,
  ReceiptReturnSourceDto,
  PrintSettingsDto,
  ProductDto,
  ProductAttributionDto,
  ProductAllowedSalesmenDto,
  ReceiptSearchResult,
  SalesmanDto,
  SectionCashBoxDto,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isPermanentReceiptError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0 || error.status === 401 || error.status === 408 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

function parseApiErrorText(status: number, text: string): string {
  const trimmed = text.trim();
  try {
    const j = JSON.parse(trimmed) as { error?: string; title?: string; detail?: string };
    if (j.error) return j.error;
    if (j.detail) return j.detail;
    if (j.title) return j.title;
  } catch {
    /* plain text from server */
  }
  if (trimmed.includes('pending local transaction'))
    return 'الخادم يحتاج التحديث — ثبّت FOT-POS-Server-Setup.exe ثم أعد تشغيل الخدمة';
  if (trimmed.includes('parameterless default constructor'))
    return 'خطأ في قاعدة البيانات — حدّث برنامج الخادم ثم أعد المحاولة';
  if (status >= 500) return 'خطأ في الخادم — تأكد من تحديث برنامج الخادم';
  return trimmed.slice(0, 240) || 'فشل الطلب';
}

const TOKEN_KEY = 'fot_pos_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

type RequestInitEx = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  bypassGate?: boolean;
  skipRefresh?: boolean;
};

export const TOKEN_REFRESHED_EVENT = 'fot-pos-token-refreshed';

function tokenExpiresAt(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const current = getToken();
  if (!current) return false;
  refreshInFlight = (async () => {
    try {
      const res = await request<{ token: string }>('/auth/cashier-refresh', {
        method: 'POST',
        bypassGate: true,
        skipRefresh: true,
        timeoutMs: 3_000,
        body: JSON.stringify({ token: current }),
      });
      if (!res?.token) return false;
      setToken(res.token);
      window.dispatchEvent(new CustomEvent(TOKEN_REFRESHED_EVENT, { detail: { token: res.token } }));
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function ensureFreshToken() {
  const token = getToken();
  if (!token) return;
  const exp = tokenExpiresAt(token);
  if (exp == null || exp - Date.now() > 10 * 60_000) return;
  await refreshAccessToken();
}

async function request<T>(path: string, init?: RequestInitEx): Promise<T> {
  if (!init?.bypassGate && isServerUnreachable()) {
    throw new ApiError(0, 'تعذر الاتصال بالخادم');
  }

  if (!init?.skipRefresh && !isServerUnreachable() && getToken()
    && !path.startsWith('/auth/cashier-login') && !path.startsWith('/auth/login')) {
    await ensureFreshToken();
  }

  const token = getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const timeoutMs = init?.timeoutMs ?? (init?.method && init.method !== 'GET' ? 45_000 : 8_000);
  const retries = init?.retries ?? 0;
  const rest = { ...(init ?? {}) };
  delete rest.timeoutMs;
  delete rest.retries;
  delete rest.bypassGate;
  delete rest.skipRefresh;
  let res: Response;
  try {
    res = await fetchLan(`${getApiBase()}${path}`, {
      ...rest,
      credentials: 'omit',
      headers,
      timeoutMs,
    }, retries);
  } catch (e) {
    markServerUnreachable();
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new ApiError(408, 'انتهت مهلة الاتصال بالخادم');
    }
    throw new ApiError(0, e instanceof Error ? e.message : 'تعذر الاتصال بالخادم');
  }
  if (res.status === 401) {
    const isLogin = path.startsWith('/auth/cashier-login') || path.startsWith('/auth/login');
    if (!isLogin && !init?.skipRefresh && getToken() && !isServerUnreachable() && await refreshAccessToken()) {
      return request<T>(path, { ...init, skipRefresh: true });
    }
    throw new ApiError(401, isLogin ? 'Unauthorized' : 'تعذر التحقق من الجلسة مع الخادم');
  }
  if (!res.ok) {
    if (res.status >= 502 && res.status <= 504) markServerUnreachable();
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, parseApiErrorText(res.status, text || res.statusText));
  }
  markServerReachable();
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Offline must be detected in under a second — every cashier action branches on it. */
const HEALTH_TIMEOUT_MS = 800;

/**
 * Sale and login calls fall back to the local queue / cached session, so they must give
 * up quickly instead of holding the button for the default 45s.
 */
const SALE_TIMEOUT_MS = 2_000;

/**
 * Scanning and search always have a local mirror behind them, so a single short attempt is
 * enough — retrying a dead link only delays the cashier.
 */
const LOOKUP: RequestInitEx = { timeoutMs: 1_200, retries: 0 };

export function refreshSessionToken() {
  return refreshAccessToken();
}

/** Paged catalog pulls move thousands of rows and may legitimately take a while. */
const CATALOG_TIMEOUT_MS = 30_000;

async function probeHealth(path: '/health' | '/healthz', timeoutMs: number): Promise<Response | null> {
  try {
    return await fetchLan(`${getApiBase()}${path}`, { timeoutMs }, 0);
  } catch {
    markServerUnreachable();
    return null;
  }
}

export const api = {
  health: async () => {
    const r = await probeHealth('/health', HEALTH_TIMEOUT_MS);
    if (r?.ok) {
      markServerReachable();
      return true;
    }
    markServerUnreachable();
    return false;
  },

  healthInfo: async () => {
    const r = await probeHealth('/health', HEALTH_TIMEOUT_MS);
    if (!r?.ok) {
      markServerUnreachable();
      return null;
    }
    markServerReachable();
    return (await r.json()) as ApiHealth;
  },

  healthz: async () => {
    const r = await probeHealth('/healthz', 4000);
    if (!r) return null;
    try {
      return (await r.json()) as HealthzReport;
    } catch {
      return null;
    }
  },

  cashierLogin: (username: string, password: string, hwId: string) =>
    request<PosSessionDto>('/auth/cashier-login', {
      method: 'POST',
      timeoutMs: SALE_TIMEOUT_MS,
      body: JSON.stringify({ username, password, hwId }),
    }),

  /** Live permissions for the logged-in cashier — applies admin edits without re-login. */
  myPermissions: () => request<CashierPermissionsDto | null>('/api/pos/my-permissions'),

  /** Live cashboxes for the logged-in cashier's section — applies admin edits without re-login. */
  myCashBoxes: () => request<SectionCashBoxDto[]>('/api/pos/my-cashboxes'),

  discountQrPeople: () =>
    request<Array<{ id: number; name: string; code: string; active: boolean }>>('/api/pos/discount-qr-people'),

  lookupDiscountQr: (code: string) =>
    request<{ id: number; name: string; code: string }>('/api/pos/discount-qr?code=' + encodeURIComponent(code), LOOKUP),

  productByBarcode: (code: string) =>
    request<ProductDto>(`/api/products/barcode/${encodeURIComponent(code)}`, LOOKUP),

  searchProducts: (q: string) =>
    request<ProductDto[]>(`/api/products/search?q=${encodeURIComponent(q)}&limit=24`, LOOKUP),

  groups: () => request<ArticleGroupDto[]>('/api/groups'),

  groupItems: (id: number) => request<ArticleGroupItemDto[]>(`/api/groups/${id}/items`),

  salesmen: () =>
    request<{ items: SalesmanDto[] } | SalesmanDto[]>('/api/salesmen?page=1&pageSize=500&includeAll=true', {
      timeoutMs: CATALOG_TIMEOUT_MS,
    }).then(r => (Array.isArray(r) ? r : r?.items ?? [])),

  creditAccounts: () => request<AccountSummaryDto[]>('/api/accounts/credit', { timeoutMs: 15_000 }),

  holds: (posId?: number | null) =>
    request<HoldReceiptDto[]>(`/api/receipts/hold${posId ? `?posId=${posId}` : ''}`),

  receiptDetail: (id: number) => request<ReceiptDetailDto>(`/api/receipts/${id}`),

  receiptByNumber: async (number: number): Promise<ReceiptReturnSourceDto[]> => {
    const raw = await request<ReceiptReturnMatchesDto | ReceiptReturnSourceDto>(
      `/api/receipts/by-number/${number}`,
      LOOKUP,
    );
    if (raw && 'kind' in raw && typeof raw.kind === 'number' && 'number' in raw) {
      return [raw];
    }
    if (raw && 'items' in raw && Array.isArray(raw.items) && raw.items.every(item => 'kind' in item)) {
      return raw.items;
    }
    return [];
  },

  completeHold: (id: number, payment: number) =>
    request<ReceiptDetailDto>(`/api/receipts/hold/${id}/complete?payment=${payment}`, {
      method: 'POST',
      timeoutMs: SALE_TIMEOUT_MS,
    }),

  createReceipt: (body: unknown) =>
    request<CreateReceiptResponse>('/api/receipts', {
      method: 'POST',
      timeoutMs: SALE_TIMEOUT_MS,
      body: JSON.stringify(body),
    }),

  nextReceiptNumber: (cashierId: number) =>
    request<AllocateReceiptNumberResponse>('/api/receipts/next-number', {
      method: 'POST',
      timeoutMs: SALE_TIMEOUT_MS,
      body: JSON.stringify({ cashierId }),
    }),

  heartbeat: async (
    terminalId: number,
    outbox?: { ready: number; dead: number; deferred?: number },
    catalogVersion?: number,
  ) => {
    let exeVersion = 'electron-1.0';
    try {
      const info = await window.fotDesktop?.info?.();
      if (info?.version) exeVersion = `electron-${info.version}`;
    } catch {
      /* ignore */
    }
    return request<void>(`/api/terminals/${terminalId}/heartbeat`, {
      method: 'POST',
      timeoutMs: 8_000,
      // Outbox health + catalog version ride the existing heartbeat so the admin
      // monitor sees stuck terminals and stale catalogs without extra requests.
      body: JSON.stringify({
        exeVersion,
        pendingOffline: outbox?.ready,
        deadOffline: outbox?.dead,
        deferredOffline: outbox?.deferred,
        catalogVersion,
      }),
    }).catch(() => undefined);
  },

  catalogInfo: () => request<CatalogInfoDto>('/api/catalog/info'),

  catalogSync: (sinceSeq: number, hwId?: string) =>
    request<ProductDto[]>(
      `/api/catalog/sync?sinceSeq=${sinceSeq}&pageSize=500${hwId ? `&hwId=${encodeURIComponent(hwId)}` : ''}`,
      { timeoutMs: CATALOG_TIMEOUT_MS },
    ),

  catalogIds: () =>
    request<{ total: number; ids: number[] }>('/api/catalog/ids', { timeoutMs: CATALOG_TIMEOUT_MS }),

  printSettings: () => request<PrintSettingsDto>('/api/settings/print'),

  cashReport: (from: string, to: string) =>
    request<CashReportDto>(`/api/reports/cash?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  receipts: (query: {
    cashierId?: number;
    posId?: number;
    from?: string;
    to?: string;
    pageSize?: number;
    hold?: boolean;
  }) => {
    const p = new URLSearchParams();
    if (query.cashierId) p.set('cashierId', String(query.cashierId));
    if (query.posId) p.set('posId', String(query.posId));
    if (query.from) p.set('from', query.from);
    if (query.to) p.set('to', query.to);
    if (query.pageSize) p.set('pageSize', String(query.pageSize));
    if (query.hold != null) p.set('hold', String(query.hold));
    return request<ReceiptSearchResult>(`/api/receipts?${p}`);
  },

  attributionArticles: () => request<number[]>('/api/pos/attribution-articles'),

  productAttribution: (articleId: number, barcode?: string | null) => {
    const p = new URLSearchParams({ articleId: String(articleId) });
    if (barcode?.trim()) p.set('barcode', barcode.trim());
    return request<ProductAttributionDto>(`/api/pos/product-attribution?${p}`, { timeoutMs: 8_000, retries: 0 });
  },

  allowedSalesmen: (articleId: number, barcode?: string | null) => {
    const p = new URLSearchParams({ articleId: String(articleId) });
    if (barcode?.trim()) p.set('barcode', barcode.trim());
    return request<ProductAllowedSalesmenDto>(`/api/pos/allowed-salesmen?${p}`, LOOKUP);
  },

  previewCommission: (req: {
    articleId?: number | null;
    barcode?: string | null;
    salesmanId?: number;
    quantity?: number;
    price?: number;
  }) =>
    request<{
      matched: boolean;
      commissionType?: string | null;
      commissionValue: number;
      commissionAmount: number;
    }>('/api/commissions/preview', {
      method: 'POST',
      timeoutMs: 5_000,
      body: JSON.stringify(req),
    }).catch(() => ({
      matched: false,
      commissionType: null as string | null,
      commissionValue: 0,
      commissionAmount: 0,
    })),
};
