const TOKEN_KEY = 'fot_seller_token';
const SELLER_KEY = 'fot_seller_me';
const LAST_ID_KEY = 'fot_seller_last_id';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getSeller(): SellerMe | null {
  try {
    const raw = sessionStorage.getItem(SELLER_KEY);
    return raw ? JSON.parse(raw) as SellerMe : null;
  } catch {
    return null;
  }
}
export function setSeller(seller: SellerMe | null) {
  if (seller) sessionStorage.setItem(SELLER_KEY, JSON.stringify(seller));
  else sessionStorage.removeItem(SELLER_KEY);
}

export function getLastId() {
  return localStorage.getItem(LAST_ID_KEY) ?? '';
}
export function setLastId(id: string) {
  if (id) localStorage.setItem(LAST_ID_KEY, id);
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
    const authCall = path.startsWith('/auth/seller-login') || path.startsWith('/auth/seller-lookup');
    if (res.status === 401) {
      if (!authCall && token) {
        setToken(null);
        setSeller(null);
        throw new Error('انتهت الجلسة — أعد الدخول');
      }
      throw new Error('الرمز غير صحيح');
    }
    throw new Error(msg || 'تعذر الاتصال');
  }
  return text ? JSON.parse(text) as T : {} as T;
}

export interface SellerMe { id: number; name: string; mustChangePin: boolean }
export interface WeekSummary {
  weekStart: string; weekEnd: string; isCurrent: boolean;
  salesAmount: number; commissionAmount: number; receiptCount: number; mallCount: number;
}
export interface MallRow {
  sectionId: number; sectionName: string; branchName?: string | null;
  receiptCount: number; salesAmount: number; commissionAmount: number;
}
export interface GoalRow {
  ruleId: number; ruleName: string; targetType: string;
  sold: number; weeklyTarget: number; percent: number;
}
export interface GroupRow {
  id: number; name: string; commissionType: string; commissionValue: number; productCount: number;
}
export interface ProductRow {
  articleId?: number | null; barcode?: string | null; name?: string | null;
  groupId: number; groupName: string; commissionType: string; commissionValue: number;
}
export interface Dashboard {
  seller: SellerMe; week: WeekSummary; balanceDue: number;
  malls: MallRow[]; goals: GoalRow[];
}

function weekQs(weekStart?: string) {
  return weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
}

export const api = {
  lookup: (id: number) => request<SellerMe>(`/auth/seller-lookup?id=${id}`),
  login: (salesmanId: number, pin: string) =>
    request<{ token: string; seller: SellerMe }>('/auth/seller-login', {
      method: 'POST',
      body: JSON.stringify({ salesmanId, pin }),
    }),
  me: () => request<SellerMe>('/api/seller/me'),
  dashboard: (weekStart?: string) => request<Dashboard>(`/api/seller/dashboard${weekQs(weekStart)}`),
  weeks: () => request<WeekSummary[]>('/api/seller/weeks?count=12'),
  malls: (weekStart?: string) => request<MallRow[]>(`/api/seller/malls${weekQs(weekStart)}`),
  goals: (weekStart?: string) => request<GoalRow[]>(`/api/seller/goals${weekQs(weekStart)}`),
  groups: () => request<GroupRow[]>('/api/seller/commission-groups'),
  products: () => request<ProductRow[]>('/api/seller/commission-products'),
};

export function money(n: number) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function moneyIq(n: number) {
  return `${money(n)} د.ع`;
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

export function weekRange(start: string, end: string) {
  return `${dayLabel(start)} — ${dayLabel(end)}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'مساء الخير';
  return 'مساء النور';
}

export function weekKey(iso: string) {
  return iso.slice(0, 10);
}

export function deltaPct(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function commissionLabel(type: string, value: number) {
  return type === 'percentage' ? `${value}%` : moneyIq(value);
}

export function targetKind(type: string) {
  return type === 'amount' ? 'مبلغ' : 'كمية';
}

export function tick(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'abort' | 'fail'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return 'abort';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'fail';
  }
}

export function weekReport(dash: Dashboard) {
  return [
    `${dash.seller.name} — أسبوع ${weekRange(dash.week.weekStart, dash.week.weekEnd)}`,
    `المبيعات: ${moneyIq(dash.week.salesAmount)}`,
    `العمولة: ${moneyIq(dash.week.commissionAmount)}`,
    `الفواتير: ${dash.week.receiptCount}`,
    `المولات: ${dash.week.mallCount || dash.malls.length}`,
    `المستحق: ${moneyIq(dash.balanceDue)}`,
  ].join('\n');
}
