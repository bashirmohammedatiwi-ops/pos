import { scrubSellerPayload } from './privacy';

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
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('بيانات المحل لم تصل إلى السيرفر بعد — انتظر المزامنة من لوحة التحكم');
    }
    if (res.status === 404 && authCall) {
      throw new Error(path.includes('lookup') ? 'لا بائع بهذا الرقم' : 'تعذر الدخول');
    }
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
  if (text && text.trimStart().startsWith('<')) {
    throw new Error('واجهة المحل لا ترد على طلب البائع — حدّث خادم نقطة البيع');
  }
  return text ? scrubSellerPayload(JSON.parse(text) as T) : {} as T;
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
export interface CommissionLine {
  id: number; productName: string; groupName?: string | null;
  quantity: number; commissionAmount: number;
  receiptNumber?: number | null; occurredAt: string; mallName?: string | null;
}
export interface CommissionBundle {
  totalCommission: number; lineCount: number; lines: CommissionLine[];
}
export interface GoalLine {
  productName: string; quantity: number;
  receiptNumber?: number | null; occurredAt: string; mallName?: string | null;
}
export interface GoalDetail extends GoalRow {
  lines: GoalLine[];
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
  goals: (weekStart?: string) => request<GoalRow[]>(`/api/seller/goals${weekQs(weekStart)}`),
  groups: () => request<GroupRow[]>('/api/seller/commission-groups'),
  products: () => request<ProductRow[]>('/api/seller/commission-products'),
  commissionLines: (weekStart?: string, sectionId?: number) =>
    request<CommissionBundle>(`/api/seller/commission-lines${weekQs(weekStart)}${sectionId == null ? '' : `${weekStart ? '&' : '?'}sectionId=${sectionId}`}`),
  goalLines: (ruleId: number, weekStart?: string) =>
    request<GoalDetail>(`/api/seller/goals/${ruleId}/lines${weekQs(weekStart)}`),
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

export function dayKey(iso: string) {
  return iso.slice(0, 10);
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

export function weekdayLong(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-IQ', { weekday: 'long' });
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

export function weekKey(iso: string) {
  return iso.slice(0, 10);
}

export function deltaPct(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function moneyK(n: number) {
  const v = Math.abs(Math.round(Number(n) || 0));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return money(v);
}

export function commissionLabel(type: string, value: number) {
  return type === 'percentage' ? `${value}%` : moneyIq(value);
}

export function targetKind(type: string) {
  return type === 'amount' ? 'هدف مبلغ' : 'هدف كمية';
}

export function goalValue(type: string, n: number) {
  return type === 'amount' ? moneyIq(n) : money(n);
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

export function weekReport(dash: Dashboard, extra?: string[]) {
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  return [
    `${dash.seller.name} — أسبوع ${weekRange(dash.week.weekStart, dash.week.weekEnd)}`,
    `العمولة: ${moneyIq(dash.week.commissionAmount)}`,
    dash.balanceDue > 0 ? `المستحق: ${moneyIq(dash.balanceDue)}` : '',
    dash.goals.length ? `الأهداف: ${hit} من ${dash.goals.length} تحقق` : 'لا أهداف مربوطة',
    ...(extra ?? []),
  ].filter(Boolean).join('\n');
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function commissionCsv(lines: CommissionLine[]) {
  const header = ['المنتج', 'الفاتورة', 'التاريخ', 'الوقت', 'الكمية', 'العمولة'];
  const rows = lines.map(l => [
    csvCell(l.productName),
    csvCell(l.receiptNumber ?? ''),
    csvCell(dayLabel(l.occurredAt)),
    csvCell(clockLabel(l.occurredAt)),
    csvCell(l.quantity),
    csvCell(Math.round(l.commissionAmount)),
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
