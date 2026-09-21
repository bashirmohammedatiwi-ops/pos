const TOKEN_KEY = 'fot_manager_token';
const ME_KEY = 'fot_manager_me';
const LAST_USER_KEY = 'fot_manager_last_user';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getMe(): ManagerMe | null {
  try {
    const raw = sessionStorage.getItem(ME_KEY);
    return raw ? JSON.parse(raw) as ManagerMe : null;
  } catch {
    return null;
  }
}
export function setMe(me: ManagerMe | null) {
  if (me) sessionStorage.setItem(ME_KEY, JSON.stringify(me));
  else sessionStorage.removeItem(ME_KEY);
}

export function getLastUser() {
  return localStorage.getItem(LAST_USER_KEY) ?? '';
}
export function setLastUser(username: string) {
  if (username) localStorage.setItem(LAST_USER_KEY, username);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* raw */ }
    const authCall = path.startsWith('/auth/manager-');
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('بيانات المحل لم تصل إلى السيرفر بعد — انتظر المزامنة من لوحة التحكم');
    }
    if (res.status === 404 && authCall) throw new Error('لا مدير بهذا الاسم');
    if (res.status === 401) {
      if (!authCall && token) {
        setToken(null);
        setMe(null);
        throw new Error('انتهت الجلسة — أعد الدخول');
      }
      throw new Error('بيانات الدخول غير صحيحة');
    }
    throw new Error(msg || 'تعذر الاتصال');
  }
  return text ? JSON.parse(text) as T : {} as T;
}

export interface ManagerMe { id: number; username: string; displayName: string }
export interface WeekSummary {
  weekStart: string; weekEnd: string; isCurrent: boolean;
  salesAmount: number; commissionAmount: number; receiptCount: number;
  pieceCount: number; sellerCount: number; cashierCount: number;
}
export interface SellerRow {
  salesmanId: number; name: string;
  salesAmount: number; commissionAmount: number; receiptCount: number; pieceCount: number;
  goalCount: number; goalsHit: number; goalPercent: number; balanceDue: number;
}
export interface CashierRow {
  cashierId: number; name: string;
  salesAmount: number; commissionAmount: number; receiptCount: number; pieceCount: number;
}
export interface MallRow {
  sectionId: number; sectionName: string; branchName?: string | null;
  salesAmount: number; commissionAmount: number; receiptCount: number; pieceCount: number;
}
export interface GoalRow {
  ruleId: number; ruleName: string; targetType: string;
  salesmanId: number; salesmanName: string;
  sold: number; weeklyTarget: number; percent: number;
}
export interface LineRow {
  id: number; salesmanId: number; salesmanName: string;
  productName: string; groupName?: string | null;
  quantity: number; salesAmount: number; commissionAmount: number;
  receiptNumber?: number | null; occurredAt: string;
  cashierName?: string | null; mallName?: string | null;
}
export interface ProductRow {
  name: string; quantity: number; salesAmount: number; commissionAmount: number; count: number;
}
export interface Dashboard {
  manager: ManagerMe; week: WeekSummary;
  sellers: SellerRow[]; cashiers: CashierRow[]; malls: MallRow[];
  goals: GoalRow[]; products: ProductRow[]; lastSyncAt?: string | null;
}
export interface SellerDetail {
  seller: SellerRow; goals: GoalRow[]; lines: LineRow[];
}

function weekQs(weekStart?: string) {
  return weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
}

export const api = {
  lookup: (username: string) => request<ManagerMe>(`/auth/manager-lookup?username=${encodeURIComponent(username)}`),
  login: (username: string, password: string) =>
    request<{ token: string; manager: ManagerMe }>('/auth/manager-login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<ManagerMe>('/api/manager/me'),
  dashboard: (weekStart?: string) => request<Dashboard>(`/api/manager/dashboard${weekQs(weekStart)}`),
  weeks: () => request<WeekSummary[]>('/api/manager/weeks'),
  sellers: (weekStart?: string) => request<SellerRow[]>(`/api/manager/sellers${weekQs(weekStart)}`),
  seller: (id: number, weekStart?: string) => request<SellerDetail>(`/api/manager/sellers/${id}${weekQs(weekStart)}`),
  cashiers: (weekStart?: string) => request<CashierRow[]>(`/api/manager/cashiers${weekQs(weekStart)}`),
  malls: (weekStart?: string) => request<MallRow[]>(`/api/manager/malls${weekQs(weekStart)}`),
  goals: (weekStart?: string) => request<GoalRow[]>(`/api/manager/goals${weekQs(weekStart)}`),
  lines: (weekStart?: string) => request<{ totalCommission: number; lineCount: number; lines: LineRow[] }>(`/api/manager/lines${weekQs(weekStart)}`),
  products: (weekStart?: string) => request<ProductRow[]>(`/api/manager/products${weekQs(weekStart)}`),
};

export function money(n: number) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function moneyIq(n: number) {
  return `${money(n)} د.ع`;
}
export function pieces(n: number) {
  return `${money(Math.round(Number(n) || 0))} قطعة`;
}
export function pct(n: number) {
  const v = Number(n) || 0;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;
}
export function dayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
}
export function weekdayShort(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-IQ', { weekday: 'short' });
}
export function clockLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
}
export function stampLabel(iso: string) {
  const clock = clockLabel(iso);
  return clock ? `${dayLabel(iso)} · ${clock}` : dayLabel(iso);
}
export function receiptLabel(n?: number | null) {
  return n ? `#${n}` : 'فاتورة';
}
export function weekRange(start: string, end: string) {
  return `${dayLabel(start)} — ${dayLabel(end)}`;
}
export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'مساء الخير';
  return 'مساء النور';
}
export function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 12) return 'الآن';
  if (s < 60) return `قبل ${s} ث`;
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.round(h / 24)} ي`;
}
export function deltaPct(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}
export function goalTone(percent: number): 'ok' | 'goal' | 'warn' {
  if (percent >= 100) return 'ok';
  if (percent >= 80) return 'goal';
  return 'warn';
}
export function goalLabel(percent: number) {
  if (percent >= 100) return 'تحقق';
  if (percent >= 80) return 'قريب';
  return 'تركيز';
}
export function goalValue(type: string, n: number) {
  return type === 'amount' ? moneyIq(n) : pieces(n);
}
export function tick(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

export function managerCsv(lines: LineRow[]) {
  const header = ['البائع', 'المنتج', 'الكاشير', 'المول', 'الفاتورة', 'التاريخ', 'القطع', 'المبيعات', 'العمولة'];
  const rows = lines.map(l => [
    l.salesmanName, l.productName, l.cashierName ?? '', l.mallName ?? '',
    l.receiptNumber ?? '', dayLabel(l.occurredAt), l.quantity,
    Math.round(l.salesAmount), Math.round(l.commissionAmount),
  ].join(','));
  return `\uFEFF${[header.join(','), ...rows].join('\n')}`;
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
