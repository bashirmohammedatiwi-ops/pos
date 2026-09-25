const TOKEN_KEY = 'fot_manager_token';
const ME_KEY = 'fot_manager_me';
const LAST_USER_KEY = 'fot_manager_last_user';

function storageGet(store: Storage | undefined, key: string): string | null {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}
function storageSet(store: Storage | undefined, key: string, value: string) {
  try { store?.setItem(key, value); } catch { /* ignore quota / private mode */ }
}
function storageDel(store: Storage | undefined, key: string) {
  try { store?.removeItem(key); } catch { /* ignore */ }
}

export function getToken() {
  return storageGet(localStorage, TOKEN_KEY) || storageGet(sessionStorage, TOKEN_KEY);
}
export function setToken(token: string | null) {
  storageDel(sessionStorage, TOKEN_KEY);
  if (token) storageSet(localStorage, TOKEN_KEY, token);
  else storageDel(localStorage, TOKEN_KEY);
}

export function getMe(): ManagerMe | null {
  try {
    const raw = storageGet(localStorage, ME_KEY) || storageGet(sessionStorage, ME_KEY);
    return raw ? JSON.parse(raw) as ManagerMe : null;
  } catch {
    return null;
  }
}
export function setMe(me: ManagerMe | null) {
  storageDel(sessionStorage, ME_KEY);
  if (me) storageSet(localStorage, ME_KEY, JSON.stringify(me));
  else storageDel(localStorage, ME_KEY);
}

export function getLastUser() {
  return storageGet(localStorage, LAST_USER_KEY) ?? '';
}
export function setLastUser(username: string) {
  if (username) storageSet(localStorage, LAST_USER_KEY, username);
}

let refreshWait: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (refreshWait) return refreshWait;
  const token = getToken();
  if (!token) return false;
  refreshWait = (async () => {
    try {
      const res = await fetch('/auth/manager-refresh', {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      const text = await res.text();
      if (!res.ok) return false;
      const data = text ? JSON.parse(text) as { token?: string; manager?: ManagerMe } : {};
      if (data.token) setToken(data.token);
      if (data.manager) setMe(data.manager);
      return !!data.token;
    } catch {
      return false;
    } finally {
      refreshWait = null;
    }
  })();
  return refreshWait;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
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
      if (!authCall && token && !retried && await refreshSession()) {
        return request<T>(path, init, true);
      }
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
export interface CashierDayRow {
  day: string; cashierId: number; name: string;
  salesAmount: number; receiptCount: number; pieceCount: number;
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
export interface DayRow {
  day: string; salesAmount: number; receiptCount: number; pieceCount: number;
}
export interface Dashboard {
  manager: ManagerMe; week: WeekSummary;
  sellers: SellerRow[]; cashiers: CashierRow[]; malls: MallRow[];
  goals: GoalRow[]; products: ProductRow[]; days?: DayRow[]; lastSyncAt?: string | null;
  cashierDays?: CashierDayRow[];
}
export interface SellerGoalGroup {
  salesmanId: number; salesmanName: string; goals: GoalRow[]; avg: number; hit: number;
}
export interface GoalRuleGroup {
  ruleId: number; ruleName: string; targetType: string; weeklyTarget: number;
  members: GoalRow[]; avg: number; hit: number; total: number;
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
export function moneyK(n: number) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1_000_000) return `${money(Math.round(n / 1_000_000))}م`;
  if (v >= 1000) return `${money(Math.round(n / 1000))}أ`;
  return money(n);
}
export function pieces(n: number) {
  return `${money(Math.round(Number(n) || 0))} قطعة`;
}
export function pct(n: number) {
  const v = Number(n) || 0;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;
}
export function shareOf(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}
export function avgTicket(sales: number, receipts: number) {
  return receipts > 0 ? sales / receipts : 0;
}
export function cashierLabel(name?: string | null) {
  const v = (name || '').trim();
  if (!v || v === 'مول' || v === 'بدون مول') return '';
  return v;
}
export function dayKey(iso: string) {
  return (iso || '').slice(0, 10);
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
export function liveGoals(goals?: GoalRow[] | null) {
  return (goals ?? []).filter(g => Number(g.weeklyTarget) > 0);
}
export function groupGoalsByRule(goals?: GoalRow[] | null): GoalRuleGroup[] {
  const map = new Map<number, GoalRuleGroup>();
  for (const g of liveGoals(goals)) {
    const cur = map.get(g.ruleId) ?? {
      ruleId: g.ruleId,
      ruleName: g.ruleName,
      targetType: g.targetType,
      weeklyTarget: g.weeklyTarget,
      members: [],
      avg: 0,
      hit: 0,
      total: 0,
    };
    cur.members.push(g);
    map.set(g.ruleId, cur);
  }
  return [...map.values()].map(row => {
    const list = [...row.members].sort((a, b) => b.percent - a.percent || a.salesmanName.localeCompare(b.salesmanName, 'ar'));
    const avg = list.length ? list.reduce((s, x) => s + x.percent, 0) / list.length : 0;
    return {
      ...row,
      members: list,
      avg,
      hit: list.filter(x => x.percent >= 100).length,
      total: list.length,
    };
  }).sort((a, b) => a.avg - b.avg || a.ruleName.localeCompare(b.ruleName, 'ar'));
}

export function groupGoalsBySeller(goals?: GoalRow[] | null): SellerGoalGroup[] {
  const map = new Map<number, SellerGoalGroup>();
  for (const g of liveGoals(goals)) {
    const cur = map.get(g.salesmanId) ?? {
      salesmanId: g.salesmanId, salesmanName: g.salesmanName, goals: [], avg: 0, hit: 0,
    };
    cur.goals.push(g);
    map.set(g.salesmanId, cur);
  }
  return [...map.values()].map(row => {
    const list = [...row.goals].sort((a, b) => a.percent - b.percent || a.ruleName.localeCompare(b.ruleName, 'ar'));
    const avg = list.reduce((s, x) => s + x.percent, 0) / list.length;
    return { ...row, goals: list, avg, hit: list.filter(x => x.percent >= 100).length };
  }).sort((a, b) => a.avg - b.avg || a.salesmanName.localeCompare(b.salesmanName, 'ar'));
}
export function resolveWeekSales(dash?: Dashboard | null) {
  if (!dash) return 0;
  if (dash.week.salesAmount > 0) return dash.week.salesAmount;
  const sellers = (dash.sellers ?? []).reduce((s, x) => s + (Number(x.salesAmount) || 0), 0);
  if (sellers > 0) return sellers;
  return (dash.days ?? []).reduce((s, d) => s + (Number(d.salesAmount) || 0), 0);
}
export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function targetKind(type: string) {
  return type === 'amount' ? 'هدف مبلغ' : 'هدف كمية';
}
export function tick(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

export function attachLiveGoals(sellers: SellerRow[], goals: GoalRow[]): SellerRow[] {
  const map = new Map(groupGoalsBySeller(goals).map(g => [g.salesmanId, g]));
  return sellers.map(s => {
    const g = map.get(s.salesmanId);
    if (!g) return { ...s, goalCount: 0, goalsHit: 0, goalPercent: 0 };
    return { ...s, goalCount: g.goals.length, goalsHit: g.hit, goalPercent: Math.round(g.avg * 10) / 10 };
  });
}

export function managerCsv(lines: LineRow[]) {
  const header = ['البائع', 'المنتج', 'الكاشير', 'الفاتورة', 'التاريخ', 'الوقت', 'القطع', 'المبيعات'];
  const rows = lines.map(l => [
    l.salesmanName, l.productName, cashierLabel(l.cashierName) || cashierLabel(l.mallName),
    l.receiptNumber ?? '', dayLabel(l.occurredAt), clockLabel(l.occurredAt), l.quantity,
    Math.round(l.salesAmount),
  ].join(','));
  return `\uFEFF${[header.join(','), ...rows].join('\n')}`;
}

export function teamCsv(sellers: SellerRow[], totalSales: number) {
  const header = ['الترتيب', 'البائع', 'المبيعات', 'الفواتير', 'متوسط الفاتورة', 'العمولة', 'الأهداف', 'المستحق'];
  const rows = [...sellers].sort((a, b) => b.salesAmount - a.salesAmount).map((s, i) => [
    i + 1, s.name, Math.round(s.salesAmount),
    s.receiptCount, Math.round(avgTicket(s.salesAmount, s.receiptCount)), Math.round(s.commissionAmount),
    s.goalCount ? `${s.goalsHit}/${s.goalCount}` : '—', Math.round(s.balanceDue),
  ].join(','));
  return `\uFEFF${[header.join(','), ...rows].join('\n')}`;
}

export function cashierCsv(rows: CashierRow[], totalSales: number) {
  const header = ['الترتيب', 'الكاشير', 'المبيعات', 'الفواتير', 'متوسط الفاتورة'];
  const lines = [...rows].sort((a, b) => b.salesAmount - a.salesAmount).map((c, i) => [
    i + 1, c.name, Math.round(c.salesAmount),
    c.receiptCount, Math.round(avgTicket(c.salesAmount, c.receiptCount)),
  ].join(','));
  return `\uFEFF${[header.join(','), ...lines].join('\n')}`;
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

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function weekReport(dash: Dashboard, extra?: string[]) {
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const top = [...dash.sellers].sort((a, b) => b.salesAmount - a.salesAmount)[0];
  return [
    `${dash.manager.displayName} — أسبوع ${weekRange(dash.week.weekStart, dash.week.weekEnd)}`,
    `المبيعات: ${moneyIq(resolveWeekSales(dash))}`,
    `الفواتير: ${dash.week.receiptCount}`,
    `متوسط الفاتورة: ${moneyIq(avgTicket(resolveWeekSales(dash), dash.week.receiptCount))}`,
    top ? `أقوى بائع: ${top.name} — ${moneyIq(top.salesAmount)}` : '',
    dash.goals.length ? `الأهداف: ${hit} من ${dash.goals.length} تحقق` : 'لا أهداف مربوطة',
    ...(extra ?? []),
  ].filter(Boolean).join('\n');
}

export function productCsv(rows: ProductRow[]) {
  const header = ['المنتج', 'المبيعات', 'القطع', 'الحركات'];
  const lines = rows.map(p => [p.name, Math.round(p.salesAmount), Math.round(p.quantity), p.count].join(','));
  return `\uFEFF${[header.join(','), ...lines].join('\n')}`;
}

export function weeksCsv(weeks: WeekSummary[]) {
  const header = ['الأسبوع', 'المبيعات', 'الفواتير', 'متوسط', 'بائعون', 'كاشير'];
  const rows = weeks.map(w => [
    dayLabel(w.weekStart), Math.round(w.salesAmount), w.receiptCount,
    Math.round(avgTicket(w.salesAmount, w.receiptCount)), w.sellerCount, w.cashierCount,
  ].join(','));
  return `\uFEFF${[header.join(','), ...rows].join('\n')}`;
}

export function daysCsv(days: Array<{ day?: string; key?: string; salesAmount?: number; sales?: number; receiptCount?: number; receipts?: number; pieceCount?: number; qty?: number }>) {
  const header = ['اليوم', 'المبيعات', 'الفواتير'];
  const rows = days.map(d => {
    const key = d.day || d.key || '';
    return [dayLabel(key), Math.round(d.salesAmount ?? d.sales ?? 0), d.receiptCount ?? d.receipts ?? 0].join(',');
  });
  return `\uFEFF${[header.join(','), ...rows].join('\n')}`;
}

export function lastSyncMs(iso?: string | null) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
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
