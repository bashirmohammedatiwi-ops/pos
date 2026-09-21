import {
  avgTicket,
  cashierLabel,
  clockLabel,
  dayKey,
  dayLabel,
  moneyIq,
  receiptLabel,
  shareOf,
  stampLabel,
  todayKey,
  weekdayShort,
  type CashierRow,
  type Dashboard,
  type LineRow,
  type MallRow,
  type SellerRow,
  type WeekSummary,
} from './api';

export type DayBucket = {
  key: string;
  label: string;
  weekday: string;
  sales: number;
  commission: number;
  count: number;
  qty: number;
  receipts: number;
};

export type ProductRank = {
  name: string;
  sales: number;
  commission: number;
  count: number;
  qty: number;
};

export type ReceiptGroup = {
  id: string;
  receiptNumber: number | null;
  at: string;
  cashierName?: string | null;
  sales: number;
  commission: number;
  count: number;
  qty: number;
  sellers: string[];
  lines: LineRow[];
};

export type HourBand = {
  key: 'morning' | 'afternoon' | 'evening' | 'night';
  label: string;
  hint: string;
  sales: number;
  commission: number;
  count: number;
  qty: number;
};

export type PersonShare = {
  id: string;
  name: string;
  sales: number;
  commission: number;
  pieces: number;
  receipts: number;
  share: number;
  avg: number;
};

const BANDS: HourBand[] = [
  { key: 'morning', label: 'الصباح', hint: 'حتى الظهر', sales: 0, commission: 0, count: 0, qty: 0 },
  { key: 'afternoon', label: 'الظهر', hint: 'حتى العصر', sales: 0, commission: 0, count: 0, qty: 0 },
  { key: 'evening', label: 'المساء', hint: 'حتى الليل', sales: 0, commission: 0, count: 0, qty: 0 },
  { key: 'night', label: 'الليل', hint: 'بعد 9', sales: 0, commission: 0, count: 0, qty: 0 },
];

export function hourBand(iso: string): HourBand['key'] {
  const h = new Date(iso).getHours();
  if (Number.isNaN(h) || h < 6 || h >= 21) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function lineCashier(line: LineRow) {
  return cashierLabel(line.cashierName) || cashierLabel(line.mallName);
}

export function officialDays(
  days: { day: string; salesAmount: number; receiptCount: number; pieceCount: number }[] | undefined,
  lines: LineRow[],
  weekStart?: string,
  weekEnd?: string,
): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const row of groupDays(lines)) map.set(row.key, row);
  for (const d of days ?? []) {
    const key = String(d.day || '').slice(0, 10);
    if (!key) continue;
    const prev = map.get(key);
    map.set(key, {
      key,
      label: dayLabel(key),
      weekday: weekdayShort(key),
      sales: d.salesAmount,
      commission: prev?.commission ?? 0,
      count: prev?.count ?? d.receiptCount,
      qty: d.pieceCount,
      receipts: d.receiptCount,
    });
  }
  if (weekStart && weekEnd) {
    const start = new Date(`${weekStart.slice(0, 10)}T12:00:00`);
    const end = new Date(`${weekEnd.slice(0, 10)}T12:00:00`);
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const key = new Date(t).toISOString().slice(0, 10);
      if (!map.has(key)) {
        map.set(key, {
          key, label: dayLabel(key), weekday: weekdayShort(key),
          sales: 0, commission: 0, count: 0, qty: 0, receipts: 0,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function unifyCashiers(cashiers: CashierRow[], malls: MallRow[], lines: LineRow[]): CashierRow[] {
  const live = cashiers.filter(c => cashierLabel(c.name) && (c.salesAmount > 0 || c.receiptCount > 0));
  if (live.length) return [...live].sort((a, b) => b.salesAmount - a.salesAmount);
  const map = new Map<string, CashierRow>();
  const put = (id: number, name: string, sales: number, comm: number, receipts: number, pieces: number) => {
    const label = cashierLabel(name);
    if (!label) return;
    const key = label.toLowerCase();
    const cur = map.get(key);
    const row: CashierRow = { cashierId: id || cur?.cashierId || map.size + 1, name: label, salesAmount: sales, commissionAmount: comm, receiptCount: receipts, pieceCount: pieces };
    if (!cur || row.salesAmount > cur.salesAmount || (row.salesAmount === cur.salesAmount && row.commissionAmount > cur.commissionAmount)) {
      map.set(key, { ...row, cashierId: cur?.cashierId || row.cashierId });
    }
  };
  for (const c of cashiers) put(c.cashierId, c.name, c.salesAmount, c.commissionAmount, c.receiptCount, c.pieceCount);
  for (const m of malls) put(m.sectionId, m.sectionName, m.salesAmount, m.commissionAmount, m.receiptCount, m.pieceCount);
  if (!map.size) {
    const agg = new Map<string, { name: string; sales: number; comm: number; receipts: Set<number | string>; pieces: number }>();
    for (const line of lines) {
      const name = lineCashier(line);
      if (!name) continue;
      const key = name.toLowerCase();
      const row = agg.get(key) ?? { name, sales: 0, comm: 0, receipts: new Set(), pieces: 0 };
      row.sales += line.salesAmount;
      row.comm += line.commissionAmount;
      row.pieces += line.quantity;
      row.receipts.add(line.receiptNumber ?? `x-${line.id}`);
      agg.set(key, row);
    }
    let i = 1;
    for (const row of agg.values()) put(i++, row.name, row.sales, row.comm, row.receipts.size, row.pieces);
  }
  return [...map.values()].sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount);
}

export function groupDays(lines: LineRow[]): DayBucket[] {
  const map = new Map<string, DayBucket & { recs: Set<number | string> }>();
  for (const line of lines) {
    const key = dayKey(line.occurredAt);
    const row = map.get(key) ?? {
      key, label: dayLabel(line.occurredAt), weekday: weekdayShort(line.occurredAt),
      sales: 0, commission: 0, count: 0, qty: 0, receipts: 0, recs: new Set(),
    };
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += Number(line.quantity) || 0;
    row.recs.add(line.receiptNumber ?? `x-${line.id}`);
    row.receipts = row.recs.size;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function rankProducts(lines: LineRow[]): ProductRank[] {
  const map = new Map<string, ProductRank>();
  for (const line of lines) {
    const name = line.productName || 'منتج';
    const row = map.get(name) ?? { name, sales: 0, commission: 0, count: 0, qty: 0 };
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += line.quantity;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.sales - a.sales || b.commission - a.commission);
}

export function groupReceipts(lines: LineRow[]): ReceiptGroup[] {
  const map = new Map<string, ReceiptGroup>();
  for (const line of lines) {
    const id = line.receiptNumber != null ? `r-${line.receiptNumber}` : `x-${line.id}`;
    const row = map.get(id) ?? {
      id,
      receiptNumber: line.receiptNumber ?? null,
      at: line.occurredAt,
      cashierName: lineCashier(line),
      sales: 0,
      commission: 0,
      count: 0,
      qty: 0,
      sellers: [],
      lines: [],
    };
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += Number(line.quantity) || 0;
    row.lines.push(line);
    if (line.occurredAt > row.at) row.at = line.occurredAt;
    if (!row.cashierName) row.cashierName = lineCashier(line);
    if (line.salesmanName && !row.sellers.includes(line.salesmanName)) row.sellers.push(line.salesmanName);
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export function groupHours(lines: LineRow[]): HourBand[] {
  const rows = BANDS.map(b => ({ ...b }));
  for (const line of lines) {
    const row = rows.find(b => b.key === hourBand(line.occurredAt));
    if (!row) continue;
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += Number(line.quantity) || 0;
  }
  return rows;
}

export function sellerShares(sellers: SellerRow[], totalSales: number): PersonShare[] {
  return [...sellers]
    .sort((a, b) => b.salesAmount - a.salesAmount || b.commissionAmount - a.commissionAmount)
    .map(s => ({
      id: String(s.salesmanId),
      name: s.name,
      sales: s.salesAmount,
      commission: s.commissionAmount,
      pieces: s.pieceCount,
      receipts: s.receiptCount,
      share: shareOf(s.salesAmount, totalSales),
      avg: avgTicket(s.salesAmount, s.receiptCount),
    }));
}

export function cashierShares(cashiers: CashierRow[], totalSales: number): PersonShare[] {
  return cashiers.map(c => ({
    id: `${c.cashierId}-${c.name}`,
    name: c.name,
    sales: c.salesAmount,
    commission: c.commissionAmount,
    pieces: c.pieceCount,
    receipts: c.receiptCount,
    share: shareOf(c.salesAmount, totalSales),
    avg: avgTicket(c.salesAmount, c.receiptCount),
  }));
}

export function linesForSeller(lines: LineRow[], salesmanId: number) {
  return lines.filter(l => l.salesmanId === salesmanId);
}

export function linesForCashier(lines: LineRow[], name: string) {
  const key = name.toLowerCase();
  return lines.filter(l => lineCashier(l).toLowerCase() === key);
}

export function sellersThroughCashier(lines: LineRow[], name: string): PersonShare[] {
  const map = new Map<string, PersonShare & { recs: Set<number | string> }>();
  for (const line of linesForCashier(lines, name)) {
    const key = String(line.salesmanId);
    const row = map.get(key) ?? {
      id: key, name: line.salesmanName, sales: 0, commission: 0, pieces: 0, receipts: 0, share: 0, avg: 0, recs: new Set(),
    };
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.pieces += line.quantity;
    row.recs.add(line.receiptNumber ?? `x-${line.id}`);
    row.receipts = row.recs.size;
    map.set(key, row);
  }
  const rows = [...map.values()];
  const total = rows.reduce((s, r) => s + r.sales, 0);
  return rows
    .map(r => ({ ...r, share: shareOf(r.sales, total), avg: avgTicket(r.sales, r.receipts) }))
    .sort((a, b) => b.sales - a.sales);
}

export function cashiersForSeller(lines: LineRow[], salesmanId: number): PersonShare[] {
  const map = new Map<string, PersonShare & { recs: Set<number | string> }>();
  for (const line of linesForSeller(lines, salesmanId)) {
    const name = lineCashier(line);
    if (!name) continue;
    const key = name.toLowerCase();
    const row = map.get(key) ?? {
      id: key, name, sales: 0, commission: 0, pieces: 0, receipts: 0, share: 0, avg: 0, recs: new Set(),
    };
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.pieces += line.quantity;
    row.recs.add(line.receiptNumber ?? `x-${line.id}`);
    row.receipts = row.recs.size;
    map.set(key, row);
  }
  const rows = [...map.values()];
  const total = rows.reduce((s, r) => s + r.sales, 0);
  return rows
    .map(r => ({ ...r, share: shareOf(r.sales, total), avg: avgTicket(r.sales, r.receipts) }))
    .sort((a, b) => b.sales - a.sales);
}

export function mergeLines(a: LineRow[], b: LineRow[]) {
  const map = new Map<number, LineRow>();
  for (const line of a) map.set(line.id, line);
  for (const line of b) map.set(line.id, line);
  return [...map.values()].sort((x, y) => String(y.occurredAt).localeCompare(String(x.occurredAt)));
}

export function peopleForProduct(lines: LineRow[], name: string) {
  const subset = lines.filter(l => l.productName === name);
  const sellers = new Map<string, PersonShare & { recs: Set<number | string> }>();
  const cashiers = new Map<string, PersonShare & { recs: Set<number | string> }>();
  const add = (map: Map<string, PersonShare & { recs: Set<number | string> }>, id: string, label: string, line: LineRow) => {
    const row = map.get(id) ?? { id, name: label, sales: 0, commission: 0, pieces: 0, receipts: 0, share: 0, avg: 0, recs: new Set() };
    row.sales += line.salesAmount;
    row.commission += line.commissionAmount;
    row.pieces += line.quantity;
    row.recs.add(line.receiptNumber ?? `x-${line.id}`);
    row.receipts = row.recs.size;
    map.set(id, row);
  };
  for (const line of subset) {
    add(sellers, String(line.salesmanId), line.salesmanName, line);
    const cashier = lineCashier(line);
    if (cashier) add(cashiers, cashier.toLowerCase(), cashier, line);
  }
  const finish = (rows: (PersonShare & { recs: Set<number | string> })[]) => {
    const total = rows.reduce((s, r) => s + r.sales, 0);
    return rows.map(r => ({ ...r, share: shareOf(r.sales, total), avg: avgTicket(r.sales, r.receipts) })).sort((a, b) => b.sales - a.sales);
  };
  return {
    lines: subset,
    sellers: finish([...sellers.values()]),
    cashiers: finish([...cashiers.values()]),
    receipts: groupReceipts(subset),
  };
}

export type ShopAlert = {
  id: string;
  tone: 'warn' | 'goal' | 'gold';
  title: string;
  hint: string;
  to: string;
};

export function buildAlerts(
  dash: Dashboard | null,
  prev: Dashboard | null,
  cashiers: CashierRow[],
  stale: boolean,
): ShopAlert[] {
  const out: ShopAlert[] = [];
  if (stale) out.push({ id: 'stale', tone: 'warn', title: 'المزامنة قديمة', hint: 'افتح لوحة التحكم حتى تُرفع البيانات من جديد', to: '/' });
  for (const g of (dash?.goals ?? []).filter(x => x.percent < 80).slice(0, 5)) {
    out.push({
      id: `g-${g.ruleId}-${g.salesmanId}`,
      tone: 'warn',
      title: `${g.salesmanName} يحتاج تركيز`,
      hint: `${g.ruleName} · ${Math.round(g.percent)}٪`,
      to: '/goals',
    });
  }
  if (prev && dash) {
    for (const s of dash.sellers) {
      const old = prev.sellers.find(x => x.salesmanId === s.salesmanId);
      if (!old || old.salesAmount <= 0) continue;
      const drop = ((s.salesAmount - old.salesAmount) / Math.abs(old.salesAmount)) * 100;
      if (drop <= -20) {
        out.push({
          id: `drop-${s.salesmanId}`,
          tone: 'warn',
          title: `${s.name} انخفض عن السابق`,
          hint: `${Math.round(drop)}٪ مقارنة بالأسبوع الماضي`,
          to: `/team?q=${encodeURIComponent(s.name)}`,
        });
      }
    }
  }
  const quiet = cashiers.filter(c => c.salesAmount <= 0 && c.receiptCount <= 0);
  if (quiet.length && cashiers.length > quiet.length) {
    out.push({
      id: 'quiet-c',
      tone: 'gold',
      title: `${quiet.length} كاشير بلا حركة`,
      hint: quiet.slice(0, 3).map(c => c.name).join(' · '),
      to: '/cashiers',
    });
  }
  return out.slice(0, 8);
}

export function buildInsights(lines: LineRow[], dash: Dashboard | null, cashiers: CashierRow[]) {
  const days = officialDays(dash?.days, lines, dash?.week.weekStart, dash?.week.weekEnd);
  const products = rankProducts(lines);
  const receipts = groupReceipts(lines);
  const hours = groupHours(lines);
  const bestDay = [...days].sort((a, b) => b.sales - a.sales || b.commission - a.commission)[0];
  const bestProduct = products[0];
  const peakHour = [...hours].sort((a, b) => b.sales - a.sales || b.commission - a.commission)[0];
  const topSeller = [...(dash?.sellers ?? [])].sort((a, b) => b.salesAmount - a.salesAmount)[0];
  const topCashier = cashiers[0];
  const weekSales = dash?.week.salesAmount ?? 0;
  const weekReceipts = dash?.week.receiptCount ?? receipts.length;
  return {
    days,
    products,
    receipts,
    hours,
    bestDay,
    bestProduct,
    peakHour: peakHour && (peakHour.sales || peakHour.commission) ? peakHour : undefined,
    topSeller,
    topCashier,
    invoiceCount: receipts.length,
    itemCount: lines.length,
    pieceCount: lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
    avgTicket: avgTicket(weekSales, weekReceipts),
  };
}

export function lineText(line: LineRow) {
  return [
    line.productName,
    `البائع: ${line.salesmanName}`,
    lineCashier(line) ? `الكاشير: ${lineCashier(line)}` : '',
    `المبيعات: ${moneyIq(line.salesAmount)}`,
    `الفاتورة: ${receiptLabel(line.receiptNumber)}`,
    `الوقت: ${stampLabel(line.occurredAt)}`,
    `الكمية: ${line.quantity} قطعة`,
  ].filter(Boolean).join('\n');
}

export function receiptText(group: ReceiptGroup) {
  return [
    `${receiptLabel(group.receiptNumber)} · ${stampLabel(group.at)}`,
    group.cashierName ? `الكاشير: ${group.cashierName}` : '',
    `البائعون: ${group.sellers.join('، ')}`,
    `المبيعات: ${moneyIq(group.sales)}`,
    ...group.lines.map(l => `• ${l.productName} — ${moneyIq(l.salesAmount)}`),
  ].filter(Boolean).join('\n');
}

export function clockHint(iso: string) {
  return clockLabel(iso) || dayLabel(iso);
}

export function weekKey(w?: WeekSummary | string) {
  if (!w) return '';
  return (typeof w === 'string' ? w : w.weekStart).slice(0, 10);
}

export type WeekPace = {
  elapsedDays: number;
  remainingDays: number;
  totalDays: number;
  dailyAvg: number;
  projected: number;
  progress: number;
};

export function weekPace(weekStart?: string, weekEnd?: string, amount = 0, today = todayKey()): WeekPace {
  const start = (weekStart || '').slice(0, 10);
  const end = (weekEnd || '').slice(0, 10);
  const now = (today || todayKey()).slice(0, 10);
  if (!start || !end) {
    return { elapsedDays: 1, remainingDays: 0, totalDays: 1, dailyAvg: amount, projected: amount, progress: 100 };
  }
  const s = Date.parse(`${start}T12:00:00`);
  const e = Date.parse(`${end}T12:00:00`);
  const t = Date.parse(`${now}T12:00:00`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return { elapsedDays: 1, remainingDays: 0, totalDays: 1, dailyAvg: amount, projected: amount, progress: 100 };
  }
  const totalDays = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const clamped = Math.min(e, Math.max(s, Number.isFinite(t) ? t : s));
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.round((clamped - s) / 86400000) + 1));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const dailyAvg = amount / elapsedDays;
  return {
    elapsedDays,
    remainingDays,
    totalDays,
    dailyAvg,
    projected: dailyAvg * totalDays,
    progress: (elapsedDays / totalDays) * 100,
  };
}

export function prevDay<T extends { key: string }>(days: T[], key?: string): T | undefined {
  if (!key || !days.length) return undefined;
  const i = days.findIndex(d => d.key === key);
  if (i > 0) return days[i - 1];
  const earlier = days.filter(d => d.key < key);
  return earlier[earlier.length - 1];
}

export function shopHealth(opts: {
  goalAvg: number;
  goalCount: number;
  salesDelta?: number;
  stale: boolean;
  hasSales: boolean;
}): { score: number; label: string; tone: 'ok' | 'goal' | 'warn' | 'gold' } {
  let score = 48;
  if (opts.hasSales) score += 12;
  if (opts.goalCount) {
    if (opts.goalAvg >= 100) score += 28;
    else if (opts.goalAvg >= 80) score += 20;
    else if (opts.goalAvg >= 50) score += 10;
    else score -= 8;
  }
  if (opts.salesDelta != null) {
    if (opts.salesDelta > 8) score += 16;
    else if (opts.salesDelta > 0) score += 8;
    else if (opts.salesDelta < -15) score -= 16;
    else if (opts.salesDelta < -5) score -= 8;
  }
  if (opts.stale) score -= 22;
  score = Math.max(8, Math.min(100, Math.round(score)));
  const tone = score >= 80 ? 'ok' : score >= 60 ? 'goal' : score >= 40 ? 'gold' : 'warn';
  const label = score >= 80 ? 'المحل في وضع قوي' : score >= 60 ? 'المحل يسير بشكل جيد' : score >= 40 ? 'يحتاج متابعة' : 'يحتاج تركيز فوري';
  return { score, label, tone };
}
