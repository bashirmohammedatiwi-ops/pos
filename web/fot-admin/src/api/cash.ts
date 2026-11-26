import { getToken, keepSessionFresh } from '@/api/client';
import { getApiBase } from '@/lib/apiBase';

/* تقرير الصناديق — أرصدة وكشوف صناديق «إداري» من سيرفر المحل (قراءة فقط). */

export interface CashDayDto {
  date: string;
  in: number;
  out: number;
  count: number;
  /** الرصيد في نهاية اليوم */
  closing: number;
}
export interface CashBoxDto {
  seq: number;
  num: string;
  name: string;
  currency: 'IQD' | 'USD';
  /** من الصناديق البارزة في تطبيق المدراء */
  featured: boolean;
  /** يظهر في «عرض المزيد» في تطبيق المدراء */
  extra?: boolean;
  /** النقد الآن: آخر مبلغ مثبّت + الحركات بعده */
  balance: number;
  /** الرصيد الدفتري (مدين − دائن) */
  ledgerBalance: number;
  fixDate?: string | null;
  fixBalance?: number | null;
  todayIn: number;
  todayOut: number;
  todayCount: number;
  days: CashDayDto[];
}
export interface CashBoxesDto {
  today: string;
  at: string;
  boxes: CashBoxDto[];
  featured: string[];
  /** صناديق «عرض المزيد» بترتيبها؛ null = تلقائي (كل كاشير يعمل اليوم) */
  extra?: string[] | null;
  rootNum: string;
}
export interface CashLineDto {
  seq: number;
  num: string;
  date: string;
  time?: string | null;
  description: string;
  in: number;
  out: number;
  balance: number;
  other?: string | null;
  billNum?: string | null;
  rate?: number | null;
}
export interface CashStatementDto {
  box: CashBoxDto;
  from: string;
  to: string;
  opening: number;
  closing: number;
  totalIn: number;
  totalOut: number;
  count: number;
  truncated: boolean;
  lines: CashLineDto[];
  days: CashDayDto[];
}
export interface CashFlowRowDto {
  seq: number;
  num: string;
  name: string;
  group: string;
  groupSeq: number;
  in: number;
  out: number;
  count: number;
  transfer: boolean;
}
export interface CashFlowGroupDto {
  seq: number;
  name: string;
  in: number;
  out: number;
  count: number;
  transfer: boolean;
}
export interface CashFlowCurrencyDto {
  currency: 'IQD' | 'USD';
  in: number;
  out: number;
  transferIn: number;
  transferOut: number;
  groups: CashFlowGroupDto[];
  rows: CashFlowRowDto[];
}
export interface CashFlowDto {
  from: string;
  to: string;
  seq: number | null;
  scope: string;
  boxes: number;
  currencies: CashFlowCurrencyDto[];
}
export interface CashReportSettings {
  rootNum: string;
  featured: string[];
  /** null = تلقائي */
  extra?: string[] | null;
}

export async function reportCall<T>(path: string, init?: RequestInit): Promise<T> {
  await keepSessionFresh();
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      ...init,
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error('تعذر الاتصال بالخادم');
  }
  if (!res.ok) {
    let message = '';
    try {
      message = ((await res.json()) as { error?: string })?.error ?? '';
    } catch {
      /* ليس JSON */
    }
    throw new Error(message || (res.status === 404 ? 'سيرفر المحل لا يدعم هذا التقرير بعد — حدّث السيرفر' : res.status === 403 ? 'هذا التقرير للمدير العام فقط' : 'تعذر تحميل التقرير'));
  }
  return res.json() as Promise<T>;
}

export const cashReportApi = {
  boxes: (fresh = false) => reportCall<CashBoxesDto>(`/api/reports/cash/boxes${fresh ? '?fresh=true' : ''}`),
  statement: (seq: number, from: string, to: string) => reportCall<CashStatementDto>(`/api/reports/cash/statement?account=${seq}&from=${from}&to=${to}`),
  /** من أين جاء المال وإلى أين ذهب — كل الصناديق أو صندوق واحد */
  flow: (from: string, to: string, seq?: number | null) => reportCall<CashFlowDto>(`/api/reports/cash/flow?from=${from}&to=${to}${seq ? `&account=${seq}` : ''}`),
  settings: () => reportCall<CashReportSettings>('/api/reports/cash/settings'),
  saveSettings: (s: CashReportSettings) => reportCall<CashReportSettings>('/api/reports/cash/settings', { method: 'PUT', body: JSON.stringify(s) }),
};

/** مبلغ بعملة الصندوق: الدينار عدداً صحيحاً، والدولار بكسوره إن وُجدت */
export function cashAmount(v: number, currency: string) {
  const n = Number(v) || 0;
  return currency === 'USD'
    ? n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
    : Math.round(n).toLocaleString('en-US');
}
export const cashUnit = (currency: string) => (currency === 'USD' ? '$' : 'د.ع');
