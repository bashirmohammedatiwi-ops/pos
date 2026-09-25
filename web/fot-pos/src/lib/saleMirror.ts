import type { ReceiptReturnLineDto, ReceiptReturnSourceDto } from '@/api/types';
import { db } from '@/lib/db';

const KEY = 'sale_snapshots_v1';
const MAX = 200;

type SnapItem = {
  articleId: number;
  name?: string | null;
  barcode?: string | null;
  quantity: number;
  price: number;
  originalPrice: number;
  salesmanId?: number;
  salesmanName?: string | null;
  groupKey?: number | null;
  groupLabel?: string | null;
};

type SaleSnap = {
  number: number;
  clientReceiptId: string;
  returnOfClientReceiptId?: string;
  kind: number;
  createdAt: string;
  totalAmount: number;
  salesmanId: number;
  salesmanName?: string | null;
  items: SnapItem[];
};

function lineTotal(items: SnapItem[], kind: number, userDiscount: number) {
  const raw = items.reduce((s, i) => s + Number(i.quantity) * Number(i.price), 0);
  const sub = kind === 1 ? Math.abs(raw) : raw;
  return Math.max(0, sub - (Number(userDiscount) || 0));
}

async function loadSnaps(): Promise<SaleSnap[]> {
  try {
    const raw = await db.getMeta(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SaleSnap[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSnaps(list: SaleSnap[]) {
  const trimmed = list.slice(-MAX);
  await db.setMeta(KEY, JSON.stringify(trimmed));
}

/** Keeps line detail for returns after the sale is queued, including while the server is down. */
export async function rememberSale(payload: unknown, localNumber: number) {
  if (!localNumber || !payload || typeof payload !== 'object') return;
  const body = payload as {
    clientReceiptId?: string;
    returnOfClientReceiptId?: string;
    kind?: number;
    salesmanId?: number;
    salesmanName?: string | null;
    userDiscount?: number;
    soldAt?: string;
    items?: SnapItem[];
  };
  if (!body.clientReceiptId || !Array.isArray(body.items)) return;
  const kind = body.kind ?? 0;
  const snap: SaleSnap = {
    number: localNumber,
    clientReceiptId: body.clientReceiptId,
    returnOfClientReceiptId: body.returnOfClientReceiptId,
    kind,
    createdAt: body.soldAt || new Date().toISOString(),
    totalAmount: lineTotal(body.items, kind, body.userDiscount ?? 0),
    salesmanId: body.salesmanId ?? 0,
    salesmanName: body.salesmanName,
    items: body.items.map(i => ({
      articleId: i.articleId,
      name: i.name,
      barcode: i.barcode,
      quantity: Math.abs(Number(i.quantity) || 0),
      price: Number(i.price) || 0,
      originalPrice: Number(i.originalPrice) || Number(i.price) || 0,
      salesmanId: i.salesmanId,
      salesmanName: i.salesmanName,
      groupKey: i.groupKey,
      groupLabel: i.groupLabel,
    })),
  };
  const list = await loadSnaps();
  const next = list.filter(s => !(s.number === snap.number && s.clientReceiptId === snap.clientReceiptId));
  next.push(snap);
  await saveSnaps(next);
}

export async function findLocalReturnSource(number: number): Promise<ReceiptReturnSourceDto | null> {
  if (!number) return null;
  const snaps = await loadSnaps();
  const sale = [...snaps].reverse().find(s => s.number === number && s.kind === 0);
  if (!sale) return null;
  const returned = new Map<string, number>();
  for (const snap of snaps) {
    if (snap.kind !== 1 || snap.returnOfClientReceiptId !== sale.clientReceiptId) continue;
    for (const item of snap.items) {
      const key = `${item.articleId}|${item.salesmanId ?? 0}|${item.price}`;
      returned.set(key, (returned.get(key) ?? 0) + item.quantity);
    }
  }
  const items: ReceiptReturnLineDto[] = sale.items.map((item, index) => {
    const key = `${item.articleId}|${item.salesmanId ?? 0}|${item.price}`;
    const sold = item.quantity;
    const back = Math.min(sold, returned.get(key) ?? 0);
    if (back) returned.set(key, (returned.get(key) ?? 0) - back);
    return {
      itemId: index + 1,
      articleId: item.articleId,
      name: item.name,
      barcode: item.barcode,
      soldQty: sold,
      returnedQty: back,
      remainingQty: Math.max(0, sold - back),
      price: item.price,
      originalPrice: item.originalPrice,
      discount: Math.max(0, item.originalPrice - item.price),
      salesmanId: item.salesmanId,
      salesmanName: item.salesmanName,
      groupKey: item.groupKey,
      groupLabel: item.groupLabel,
    };
  });
  return {
    id: 0,
    number: sale.number,
    creationDate: sale.createdAt,
    kind: 0,
    totalAmount: sale.totalAmount,
    salesmanId: sale.salesmanId,
    salesmanName: sale.salesmanName,
    items,
    clientReceiptId: sale.clientReceiptId,
  };
}
