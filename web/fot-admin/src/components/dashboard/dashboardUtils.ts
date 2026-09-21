import type { DailySalesRowDto } from '@/api/types';
import { formatDate } from '@/api/client';

export function timeAgo(iso?: string) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return formatDate(iso);
}

export function deltaLabel(today: number, yesterday: number) {
  if (!yesterday && !today) return 'كما أمس';
  if (!yesterday) return 'بداية اليوم';
  const pct = ((today - yesterday) / yesterday) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

export function deltaArrow(today: number, yesterday: number) {
  if (!yesterday) return '';
  if (today > yesterday) return '↑';
  if (today < yesterday) return '↓';
  return '→';
}

export function deltaTone(today: number, yesterday: number, dark = false) {
  if (!yesterday) return dark ? 'text-slate-400' : 'text-slate-500';
  if (today > yesterday) return dark ? 'text-emerald-300' : 'text-emerald-700';
  if (today < yesterday) return dark ? 'text-amber-300' : 'text-amber-700';
  return dark ? 'text-slate-400' : 'text-slate-500';
}

export function kindClass(kind?: number) {
  if (kind === 1) return 'bg-red-50 text-red-700';
  if (kind === 2) return 'bg-violet-50 text-violet-700';
  return 'bg-slate-100 text-slate-600';
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'طاب يومك';
  return 'مساء الخير';
}

export function todayLabel() {
  return new Date().toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dateKey(iso: string) {
  return iso.slice(0, 10);
}

function eachIsoDay(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d > end) return out;
  let guard = 0;
  while (d <= end && guard < 366) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
    d.setDate(d.getDate() + 1);
    guard += 1;
  }
  return out;
}

export function fillDaily(rows: DailySalesRowDto[] | undefined, from: string, to: string) {
  const map = new Map((rows ?? []).map(r => [dateKey(r.date), r]));
  return eachIsoDay(from, to).map(date => map.get(date) ?? { date, total: 0, receiptCount: 0 });
}

export function weekdayShort(iso: string) {
  return new Date(`${dateKey(iso)}T00:00:00`).toLocaleDateString('ar-IQ', { weekday: 'short' });
}

export function weekProgress(from: string, to: string, today: string) {
  const days = eachIsoDay(from, to);
  const total = days.length || 1;
  const idx = days.findIndex(d => d >= today);
  const elapsed = idx < 0 ? total : Math.max(1, idx + 1);
  return { elapsed, total, pct: Math.round((elapsed / total) * 100) };
}

export function bestDay(days: { date: string; total: number }[]) {
  if (!days.length) return null;
  return days.reduce((best, d) => (d.total > best.total ? d : best), days[0]);
}

export function hourProgressOfDay() {
  const h = new Date().getHours();
  const start = 8;
  const end = 22;
  if (h <= start) return 0.05;
  if (h >= end) return 1;
  return (h - start) / (end - start);
}

/** Compare today's sales pace vs yesterday at same time of day. */
export function salesPace(todaySales: number, yesterdaySales: number) {
  const progress = hourProgressOfDay();
  if (!yesterdaySales) return todaySales > 0 ? 100 : 50;
  const expected = yesterdaySales * Math.max(0.08, progress);
  if (expected <= 0) return todaySales > 0 ? 100 : 50;
  return Math.round((todaySales / expected) * 100);
}

export function healthScore(opts: {
  edariConnected: boolean;
  onlineTerminals: number;
  terminalCount: number;
  attentionTotal: number;
  sales: number;
  ySales: number;
}) {
  let score = 0;
  score += opts.edariConnected ? 28 : 0;
  if (opts.terminalCount > 0) {
    score += Math.round((opts.onlineTerminals / opts.terminalCount) * 22);
  } else {
    score += 18;
  }
  score += Math.max(0, 25 - opts.attentionTotal * 6);
  const pace = salesPace(opts.sales, opts.ySales);
  score += Math.min(25, Math.round(pace * 0.25));
  return Math.min(100, Math.max(0, score));
}

export function healthLabel(score: number) {
  if (score >= 85) return 'ممتاز';
  if (score >= 70) return 'جيد';
  if (score >= 50) return 'متوسط';
  return 'يحتاج متابعة';
}

export function healthBreakdown(opts: {
  edariConnected: boolean;
  onlineTerminals: number;
  terminalCount: number;
  attentionTotal: number;
  sales: number;
  ySales: number;
}) {
  const pace = salesPace(opts.sales, opts.ySales);
  const terminalScore = opts.terminalCount > 0
    ? Math.round((opts.onlineTerminals / opts.terminalCount) * 22)
    : 18;
  const attentionScore = Math.max(0, 25 - opts.attentionTotal * 6);
  const paceScore = Math.min(25, Math.round(pace * 0.25));
  return [
    { id: 'edari', label: 'Edari', score: opts.edariConnected ? 28 : 0, max: 28, tone: 'bg-emerald-500' },
    { id: 'terminals', label: 'الأجهزة', score: terminalScore, max: 22, tone: 'bg-sky-500' },
    { id: 'attention', label: 'الانتباه', score: attentionScore, max: 25, tone: 'bg-amber-500' },
    { id: 'pace', label: 'الوتيرة', score: paceScore, max: 25, tone: 'bg-brand-500' },
  ];
}

export type SalesmanSalesStat = {
  salesmanId: number;
  name?: string;
  total: number;
  count?: number;
};

/** Merge Edari catalog order with period sales stats (zeros when no sales). */
export function mergeSalesmenWithSales(
  catalog: { id: number; name: string }[],
  stats: SalesmanSalesStat[],
): SalesmanSalesStat[] {
  const byId = new Map(stats.map(s => [s.salesmanId, s]));
  return catalog
    .filter(s => Boolean(s.name?.trim()))
    .map(s => {
      const hit = byId.get(s.id);
      return {
        salesmanId: s.id,
        name: s.name,
        total: hit?.total ?? 0,
        count: hit?.count ?? 0,
      };
    });
}
