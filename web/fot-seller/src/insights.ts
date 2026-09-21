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
