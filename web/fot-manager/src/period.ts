import { avgTicket, dayKey, dayLabel, todayKey, type CashierDayRow, type CashierRow, type Dashboard, type DayRow, type LineRow, type SellerRow } from './api';
import { lineCashier } from './insights';

export type PeriodKind = 'today' | 'yesterday' | 'wtd' | 'week' | 'custom';

export type PeriodBounds = {
  kind: PeriodKind;
  from: string;
  to: string;
  label: string;
  singleDay: boolean;
};

export type PeriodStats = {
  sales: number;
  commission: number;
  receipts: number;
  pieces: number;
  lines: number;
  ticket: number;
};

export const SALES_CHIPS: { id: PeriodKind; label: string }[] = [
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: 'wtd', label: 'الأسبوع حتى اليوم' },
  { id: 'week', label: 'الأسبوع كامل' },
  { id: 'custom', label: 'مدة أخرى' },
];

export const PAY_CHIPS: { id: PeriodKind; label: string }[] = [
  { id: 'wtd', label: 'الأسبوع حتى اليوم' },
  { id: 'today', label: 'اليوم' },
  { id: 'week', label: 'الأسبوع كامل' },
  { id: 'custom', label: 'مدة أخرى' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function dateKey(value: Date | string) {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function addDays(key: string, days: number) {
  const d = new Date(`${key.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function yesterdayKey() {
  return addDays(todayKey(), -1);
}

export function inRange(iso: string, from: string, to: string) {
  const key = dayKey(iso);
  return key >= from && key <= to;
}

export function clampDate(key: string, start: string, end: string) {
  if (key < start) return start;
  if (key > end) return end;
  return key;
}

export function periodLabel(from: string, to: string) {
  if (from === to) {
    if (from === todayKey()) return 'اليوم';
    if (from === yesterdayKey()) return 'أمس';
    return dayLabel(from);
  }
  return `${dayLabel(from)} — ${dayLabel(to)}`;
}

export function resolveBounds(
  kind: PeriodKind,
  weekStart?: string,
  weekEnd?: string,
  customFrom?: string,
  customTo?: string,
): PeriodBounds {
  const today = todayKey();
  const start = (weekStart || today).slice(0, 10);
  const end = (weekEnd || today).slice(0, 10);
  const inWeek = today >= start && today <= end;
  const untilToday = inWeek ? today : end;

  if (kind === 'today') {
    const day = inWeek ? today : end;
    return { kind: 'today', from: day, to: day, label: day === today ? 'اليوم' : dayLabel(day), singleDay: true };
  }
  if (kind === 'yesterday') {
    const y = yesterdayKey();
    const day = y >= start && y <= end ? y : addDays(untilToday, -1);
    const clamped = clampDate(day, start, end);
    return { kind: 'yesterday', from: clamped, to: clamped, label: clamped === y ? 'أمس' : dayLabel(clamped), singleDay: true };
  }
  if (kind === 'wtd') {
    return {
      kind: 'wtd',
      from: start,
      to: untilToday,
      label: untilToday === end && !inWeek ? `أسبوع ${periodLabel(start, end)}` : 'هذا الأسبوع حتى اليوم',
      singleDay: start === untilToday,
    };
  }
  if (kind === 'custom') {
    const from = clampDate((customFrom || start).slice(0, 10), start, end);
    const to = clampDate((customTo || untilToday).slice(0, 10), start, end);
    const a = from <= to ? from : to;
    const b = from <= to ? to : from;
    return { kind: 'custom', from: a, to: b, label: periodLabel(a, b), singleDay: a === b };
  }
  return { kind: 'week', from: start, to: end, label: `أسبوع ${periodLabel(start, end)}`, singleDay: start === end };
}

export function filterLines(lines: LineRow[], from: string, to: string) {
  return lines.filter(l => inRange(l.occurredAt, from, to));
}

export function officialPeriod(days: DayRow[] | undefined, from: string, to: string) {
  const slice = (days ?? []).filter(d => {
    const key = String(d.day || '').slice(0, 10);
    return key >= from && key <= to;
  });
  if (!slice.length) return null;
  return {
    sales: slice.reduce((s, d) => s + (Number(d.salesAmount) || 0), 0),
    receipts: slice.reduce((s, d) => s + (Number(d.receiptCount) || 0), 0),
    pieces: slice.reduce((s, d) => s + (Number(d.pieceCount) || 0), 0),
  };
}

export function salesShareBase(periodTotal: number, people: Array<{ salesAmount: number }>) {
  const sum = people.reduce((s, row) => s + (Number(row.salesAmount) || 0), 0);
  return Math.max(Number(periodTotal) || 0, sum, 1);
}

export function prorateCommission(periodSales: number, weekSales: number, weekCommission: number) {
  const sales = Number(periodSales) || 0;
  const base = Number(weekSales) || 0;
  const comm = Number(weekCommission) || 0;
  if (comm <= 0 || sales <= 0 || base <= 0) return 0;
  return Math.round((comm * sales) / base);
}

export function applyPeriodCommission(
  stats: PeriodStats,
  dash: Dashboard | null | undefined,
  period: PeriodBounds,
): PeriodStats {
  if (!dash) return stats;
  const weekComm = Number(dash.week.commissionAmount) || 0;
  const weekSales = Number(dash.week.salesAmount) || 0;
  if (weekComm <= 0) return stats;
  if (period.kind === 'week') return { ...stats, commission: weekComm };
  if (stats.sales > 0 && weekSales > 0) {
    return { ...stats, commission: prorateCommission(stats.sales, weekSales, weekComm) };
  }
  return stats;
}

export function enrichSellerCommissions(
  rows: SellerRow[],
  roster: SellerRow[],
  options?: { prorate?: boolean; periodSales?: number; weekSales?: number },
): SellerRow[] {
  const rosterMap = new Map(roster.map(s => [s.salesmanId, s]));
  return rows.map(row => {
    const official = rosterMap.get(row.salesmanId);
    if (!official?.commissionAmount) return row;
    if (!options?.prorate) {
      return { ...row, commissionAmount: official.commissionAmount };
    }
    const weekSales = options.weekSales || roster.reduce((s, x) => s + (Number(x.salesAmount) || 0), 0);
    if (weekSales <= 0 || row.salesAmount <= 0) return { ...row, commissionAmount: 0 };
    return {
      ...row,
      commissionAmount: Math.round((official.commissionAmount * row.salesAmount) / official.salesAmount),
    };
  });
}

export function periodStats(lines: LineRow[], official?: { sales: number; receipts: number; pieces: number } | null): PeriodStats {
  const receipts = new Set<string | number>();
  let sales = 0;
  let commission = 0;
  let pieces = 0;
  for (const line of lines) {
    sales += Number(line.salesAmount) || 0;
    commission += Number(line.commissionAmount) || 0;
    pieces += Number(line.quantity) || 0;
    receipts.add(line.receiptNumber ?? `x-${line.id}`);
  }
  const salesOut = official && official.sales > 0 ? official.sales : sales;
  const receiptsOut = official && official.receipts > 0 ? official.receipts : receipts.size;
  const piecesOut = official && official.pieces > 0 ? official.pieces : pieces;
  return {
    sales: salesOut,
    commission,
    receipts: receiptsOut,
    pieces: piecesOut,
    lines: lines.length,
    ticket: avgTicket(salesOut, receiptsOut),
  };
}

export function sellersFromLines(lines: LineRow[], roster: SellerRow[] = []): SellerRow[] {
  const map = new Map<number, SellerRow & { recs: Set<string | number> }>();
  for (const s of roster) {
    map.set(s.salesmanId, {
      ...s,
      salesAmount: 0,
      commissionAmount: 0,
      receiptCount: 0,
      pieceCount: 0,
      recs: new Set(),
    });
  }
  for (const line of lines) {
    const cur = map.get(line.salesmanId) ?? {
      salesmanId: line.salesmanId,
      name: line.salesmanName,
      salesAmount: 0,
      commissionAmount: 0,
      receiptCount: 0,
      pieceCount: 0,
      goalCount: 0,
      goalsHit: 0,
      goalPercent: 0,
      balanceDue: 0,
      recs: new Set(),
    };
    cur.name = line.salesmanName || cur.name;
    cur.salesAmount += Number(line.salesAmount) || 0;
    cur.commissionAmount += Number(line.commissionAmount) || 0;
    cur.pieceCount += Number(line.quantity) || 0;
    cur.recs.add(line.receiptNumber ?? `x-${line.id}`);
    cur.receiptCount = cur.recs.size;
    map.set(line.salesmanId, cur);
  }
  return [...map.values()]
    .map(({ recs: _recs, ...row }) => row)
    .sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount);
}

export function cashiersFromLines(lines: LineRow[], roster: CashierRow[] = []): CashierRow[] {
  const map = new Map<string, CashierRow & { recs: Set<string | number> }>();
  for (const c of roster) {
    const key = c.name.toLowerCase();
    map.set(key, {
      ...c,
      salesAmount: 0,
      commissionAmount: 0,
      receiptCount: 0,
      pieceCount: 0,
      recs: new Set(),
    });
  }
  for (const line of lines) {
    const name = lineCashier(line) || 'كاشير';
    const key = name.toLowerCase();
    const cur = map.get(key) ?? {
      cashierId: map.size + 1,
      name,
      salesAmount: 0,
      commissionAmount: 0,
      receiptCount: 0,
      pieceCount: 0,
      recs: new Set(),
    };
    cur.name = name;
    cur.salesAmount += Number(line.salesAmount) || 0;
    cur.commissionAmount += Number(line.commissionAmount) || 0;
    cur.pieceCount += Number(line.quantity) || 0;
    cur.recs.add(line.receiptNumber ?? `x-${line.id}`);
    cur.receiptCount = cur.recs.size;
    map.set(key, cur);
  }
  return [...map.values()]
    .map(({ recs: _recs, ...row }) => row)
    .filter(c => c.salesAmount > 0 || c.receiptCount > 0 || c.commissionAmount > 0)
    .sort((a, b) => b.salesAmount - a.salesAmount);
}

function proratePeople<T extends { salesAmount: number; commissionAmount: number; receiptCount: number; pieceCount: number }>(
  rows: T[],
  period: PeriodBounds,
  dash: Dashboard | null | undefined,
): T[] {
  const official = officialPeriod(dash?.days, period.from, period.to);
  const weekSales = Number(dash?.week?.salesAmount) || rows.reduce((s, r) => s + r.salesAmount, 0);
  if (!official?.sales || weekSales <= 0) return [];
  const ratio = official.sales / weekSales;
  return rows
    .filter(r => r.salesAmount > 0 || r.receiptCount > 0)
    .map(r => ({
      ...r,
      salesAmount: Math.round(r.salesAmount * ratio),
      commissionAmount: Math.round(r.commissionAmount * ratio),
      receiptCount: Math.max(r.receiptCount > 0 ? 1 : 0, Math.round(r.receiptCount * ratio)),
      pieceCount: Math.round(r.pieceCount * ratio),
    }))
    .filter(r => r.salesAmount > 0 || r.receiptCount > 0);
}

export function cashiersForPeriod(days: CashierDayRow[] | undefined, from: string, to: string): CashierRow[] {
  const map = new Map<string, CashierRow>();
  for (const row of days ?? []) {
    const key = String(row.day || '').slice(0, 10);
    if (!key || key < from || key > to) continue;
    const name = (row.name || '').trim();
    if (!name) continue;
    const id = `${row.cashierId}:${name.toLowerCase()}`;
    const cur = map.get(id) ?? {
      cashierId: row.cashierId,
      name,
      salesAmount: 0,
      commissionAmount: 0,
      receiptCount: 0,
      pieceCount: 0,
    };
    cur.salesAmount += Number(row.salesAmount) || 0;
    cur.receiptCount += Number(row.receiptCount) || 0;
    cur.pieceCount += Number(row.pieceCount) || 0;
    map.set(id, cur);
  }
  return [...map.values()]
    .filter(c => c.salesAmount !== 0 || c.receiptCount > 0)
    .sort((a, b) => b.salesAmount - a.salesAmount || b.receiptCount - a.receiptCount);
}

export function mergeScopedCashiers(
  periodLines: LineRow[],
  roster: CashierRow[],
  period: PeriodBounds,
  dash: Dashboard | null | undefined,
): CashierRow[] {
  if (Array.isArray(dash?.cashierDays)) return cashiersForPeriod(dash.cashierDays, period.from, period.to);
  if (period.kind === 'week' && roster.some(c => c.salesAmount > 0)) {
    return roster.filter(c => c.salesAmount > 0 || c.receiptCount > 0);
  }
  const fromLines = cashiersFromLines(periodLines, roster);
  const lineSales = fromLines.reduce((s, c) => s + c.salesAmount, 0);
  if (fromLines.length > 0 && lineSales > 0) return fromLines;
  const prorated = proratePeople(roster, period, dash);
  return prorated.length ? prorated : fromLines;
}

export function mergeScopedSellers(
  periodLines: LineRow[],
  roster: SellerRow[],
  period: PeriodBounds,
  dash: Dashboard | null | undefined,
): SellerRow[] {
  if (period.kind === 'week' && roster.some(s => s.salesAmount > 0)) return roster;
  const fromLines = sellersFromLines(periodLines, roster);
  const lineSales = fromLines.reduce((s, r) => s + r.salesAmount, 0);
  if (fromLines.length > 0 && lineSales > 0) return fromLines;
  const prorated = proratePeople(roster, period, dash);
  return prorated.length ? prorated : fromLines;
}

export function commissionCsv(rows: SellerRow[]) {
  const header = ['البائع', 'العمولة', 'المبيعات', 'الفواتير'];
  const lines = [...rows]
    .filter(s => s.commissionAmount > 0)
    .sort((a, b) => b.commissionAmount - a.commissionAmount)
    .map(s => [s.name, Math.round(s.commissionAmount), Math.round(s.salesAmount), s.receiptCount].join(','));
  return `\uFEFF${[header.join(','), ...lines].join('\n')}`;
}
