import {
  clockLabel,
  dayKey,
  dayLabel,
  moneyIq,
  receiptLabel,
  stampLabel,
  weekdayShort,
  type CommissionLine,
} from './api';

export type DayBucket = {
  key: string;
  label: string;
  weekday: string;
  commission: number;
  count: number;
  qty: number;
};

export type ProductRank = {
  name: string;
  commission: number;
  count: number;
  qty: number;
};

export type ReceiptGroup = {
  id: string;
  receiptNumber: number | null;
  at: string;
  mallName?: string | null;
  commission: number;
  count: number;
  lines: CommissionLine[];
};

export type HourBand = {
  key: 'morning' | 'afternoon' | 'evening' | 'night';
  label: string;
  hint: string;
  commission: number;
  count: number;
  qty: number;
};

const BANDS: HourBand[] = [
  { key: 'morning', label: 'الصباح', hint: 'حتى الظهر', commission: 0, count: 0, qty: 0 },
  { key: 'afternoon', label: 'الظهر', hint: 'حتى العصر', commission: 0, count: 0, qty: 0 },
  { key: 'evening', label: 'المساء', hint: 'حتى الليل', commission: 0, count: 0, qty: 0 },
  { key: 'night', label: 'الليل', hint: 'بعد 9', commission: 0, count: 0, qty: 0 },
];

export function hourBand(iso: string): HourBand['key'] {
  const h = new Date(iso).getHours();
  if (Number.isNaN(h) || h < 6 || h >= 21) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function groupDays(lines: CommissionLine[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const line of lines) {
    const key = dayKey(line.occurredAt);
    const row = map.get(key) ?? {
      key,
      label: dayLabel(line.occurredAt),
      weekday: weekdayShort(line.occurredAt),
      commission: 0,
      count: 0,
      qty: 0,
    };
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += Number(line.quantity) || 0;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function rankProducts(lines: CommissionLine[]): ProductRank[] {
  const map = new Map<string, ProductRank>();
  for (const line of lines) {
    const name = line.productName || 'منتج';
    const row = map.get(name) ?? { name, commission: 0, count: 0, qty: 0 };
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += line.quantity;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.commission - a.commission);
}

export function groupReceipts(lines: CommissionLine[]): ReceiptGroup[] {
  const map = new Map<string, ReceiptGroup>();
  for (const line of lines) {
    const id = line.receiptNumber != null ? `r-${line.receiptNumber}` : `x-${line.id}`;
    const row = map.get(id) ?? {
      id,
      receiptNumber: line.receiptNumber ?? null,
      at: line.occurredAt,
      mallName: line.mallName,
      commission: 0,
      count: 0,
      lines: [],
    };
    row.commission += line.commissionAmount;
    row.count += 1;
    row.lines.push(line);
    if (line.occurredAt > row.at) row.at = line.occurredAt;
    if (!row.mallName && line.mallName) row.mallName = line.mallName;
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export function groupHours(lines: CommissionLine[]): HourBand[] {
  const rows = BANDS.map(b => ({ ...b }));
  for (const line of lines) {
    const row = rows.find(b => b.key === hourBand(line.occurredAt));
    if (!row) continue;
    row.commission += line.commissionAmount;
    row.count += 1;
    row.qty += Number(line.quantity) || 0;
  }
  return rows;
}

export function lineText(line: CommissionLine) {
  return [
    line.productName,
    `العمولة: ${moneyIq(line.commissionAmount)}`,
    `الفاتورة: ${receiptLabel(line.receiptNumber)}`,
    `الوقت: ${stampLabel(line.occurredAt)}`,
    `الكمية: ${line.quantity} قطعة`,
  ].filter(Boolean).join('\n');
}

export function receiptText(group: ReceiptGroup) {
  return [
    `${receiptLabel(group.receiptNumber)} · ${stampLabel(group.at)}`,
    `العمولة: ${moneyIq(group.commission)}`,
    ...group.lines.map(l => `• ${l.productName} — ${moneyIq(l.commissionAmount)}`),
  ].filter(Boolean).join('\n');
}

export function buildInsights(lines: CommissionLine[]) {
  const days = groupDays(lines);
  const products = rankProducts(lines);
  const receipts = groupReceipts(lines);
  const hours = groupHours(lines);
  const bestDay = [...days].sort((a, b) => b.commission - a.commission)[0];
  const bestProduct = products[0];
  const peakHour = [...hours].sort((a, b) => b.commission - a.commission)[0];
  return {
    days,
    products,
    receipts,
    hours,
    bestDay,
    bestProduct,
    peakHour: peakHour?.commission ? peakHour : undefined,
    invoiceCount: receipts.length,
    itemCount: lines.length,
    pieceCount: lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
  };
}

export function clockHint(iso: string) {
  const clock = clockLabel(iso);
  return clock || dayLabel(iso);
}

export type WeekPace = {
  elapsedDays: number;
  remainingDays: number;
  totalDays: number;
  dailyAvg: number;
  projected: number;
  progress: number;
};

export function weekPace(weekStart?: string, weekEnd?: string, amount = 0, today = ''): WeekPace {
  const start = (weekStart || '').slice(0, 10);
  const end = (weekEnd || '').slice(0, 10);
  const now = (today || new Date().toISOString().slice(0, 10)).slice(0, 10);
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

export function fillWeekDays(days: DayBucket[], weekStart?: string, weekEnd?: string): DayBucket[] {
  if (!weekStart || !weekEnd) return days;
  const map = new Map(days.map(d => [d.key, d]));
  const start = new Date(`${weekStart.slice(0, 10)}T12:00:00`);
  const end = new Date(`${weekEnd.slice(0, 10)}T12:00:00`);
  const out: DayBucket[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push(map.get(key) ?? {
      key,
      label: dayLabel(key),
      weekday: weekdayShort(key),
      commission: 0,
      count: 0,
      qty: 0,
    });
  }
  return out;
}
