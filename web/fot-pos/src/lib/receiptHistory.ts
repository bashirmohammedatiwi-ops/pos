/** Local wall-clock (no Z) so SQL stores the same shop time as GETDATE(). */
export function toLocalDateTime(input?: string | Date): string {
  const d = input instanceof Date ? input : input ? new Date(input) : new Date();
  const src = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${src.getFullYear()}-${p(src.getMonth() + 1)}-${p(src.getDate())}T${p(src.getHours())}:${p(src.getMinutes())}:${p(src.getSeconds())}`;
}

export type ReceiptEditLine = {
  articleId: number;
  name?: string;
  barcode?: string | null;
  quantity: number;
  price: number;
  originalPrice: number;
  discount: number;
  salesmanId: number;
  salesmanName?: string | null;
};

export type ReceiptEditSnapshot = {
  salesmanId: number;
  salesmanName?: string;
  userDiscount: number;
  masterAccount: number;
  items: ReceiptEditLine[];
};

export type ReceiptEditRevision = {
  editedAt: string;
  before: ReceiptEditSnapshot;
  after: ReceiptEditSnapshot;
};

export type ReceiptEditHistory = {
  original: ReceiptEditSnapshot;
  revisions: ReceiptEditRevision[];
};

export type ReceiptHistoryCarrier = {
  salesmanId: number;
  salesmanName?: string;
  userDiscount?: number;
  masterAccount?: number;
  soldAt?: string;
  editHistory?: ReceiptEditHistory;
  kind?: number;
  payment?: number;
  accountId?: number;
  card?: { amount?: number; [key: string]: unknown } | unknown;
  items?: Array<{
    articleId: number;
    name?: string;
    barcode?: string | null;
    quantity: number;
    price: number;
    originalPrice: number;
    discount: number;
    salesmanId?: number;
    salesmanName?: string | null;
  }>;
};

export function snapshotFromPayload(payload: ReceiptHistoryCarrier): ReceiptEditSnapshot {
  return {
    salesmanId: payload.salesmanId ?? 0,
    salesmanName: payload.salesmanName || undefined,
    userDiscount: Number(payload.userDiscount ?? 0),
    masterAccount: Number(payload.masterAccount ?? 0),
    items: (payload.items ?? []).map(i => ({
      articleId: i.articleId,
      name: i.name || undefined,
      barcode: i.barcode ?? null,
      quantity: Number(i.quantity) || 0,
      price: Number(i.price) || 0,
      originalPrice: Number(i.originalPrice) || 0,
      discount: Number(i.discount) || 0,
      salesmanId: Number(i.salesmanId ?? payload.salesmanId ?? 0) || 0,
      salesmanName: i.salesmanName || payload.salesmanName || undefined,
    })),
  };
}

export function snapshotsEqual(a: ReceiptEditSnapshot, b: ReceiptEditSnapshot): boolean {
  if (a.salesmanId !== b.salesmanId) return false;
  if (Math.abs(a.userDiscount - b.userDiscount) > 0.005) return false;
  if (a.masterAccount !== b.masterAccount) return false;
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i];
    const y = b.items[i];
    if (!x || !y) return false;
    if (x.articleId !== y.articleId) return false;
    if (Math.abs(x.quantity - y.quantity) > 0.0001) return false;
    if (Math.abs(x.price - y.price) > 0.005) return false;
    if (Math.abs(x.originalPrice - y.originalPrice) > 0.005) return false;
    if (Math.abs(x.discount - y.discount) > 0.005) return false;
    if (x.salesmanId !== y.salesmanId) return false;
  }
  return true;
}

function lastAfter(history?: ReceiptEditHistory): ReceiptEditSnapshot | undefined {
  const last = history?.revisions[history.revisions.length - 1];
  return last?.after ?? history?.original;
}

export function deferredInvoiceTotal(payload: ReceiptHistoryCarrier): number {
  const raw = (payload.items ?? []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.price) || 0), 0);
  const subtotal = payload.kind === 1 ? Math.abs(raw) : raw;
  return Math.max(0, subtotal - Number(payload.userDiscount ?? 0));
}

/** After add/remove, settle like a new sale: paid = new total, no leftover change from the old invoice. */
export function settleEditedReceipt<T extends ReceiptHistoryCarrier>(payload: T): T {
  const total = deferredInvoiceTotal(payload);
  const open = payload.kind === 1 || payload.kind === 2 || (Number(payload.accountId) || 0) > 0;
  const payment = open ? 0 : total;
  const card = payload.card && typeof payload.card === 'object'
    ? { ...(payload.card as Record<string, unknown>), amount: payment }
    : payload.card;
  return { ...payload, payment, card };
}

/** Keep soldAt immutable and append a before/after revision when the invoice actually changed. */
export function applyDeferredEdit<T extends ReceiptHistoryCarrier>(previous: T, next: T): T {
  const soldAt = previous.soldAt || next.soldAt || toLocalDateTime();
  const original = previous.editHistory?.original ?? snapshotFromPayload(previous);
  const before = lastAfter(previous.editHistory) ?? original;
  const after = snapshotFromPayload(next);
  const revisions = [...(previous.editHistory?.revisions ?? [])];
  if (!snapshotsEqual(before, after)) {
    revisions.push({ editedAt: toLocalDateTime(), before, after });
  }
  return settleEditedReceipt({ ...next, soldAt, editHistory: { original, revisions } });
}

export function seedDeferredHistory<T extends ReceiptHistoryCarrier>(payload: T, soldAt?: string): T {
  return {
    ...payload,
    soldAt: payload.soldAt || soldAt || toLocalDateTime(),
    editHistory: payload.editHistory ?? { original: snapshotFromPayload(payload), revisions: [] },
  };
}

/** Inject soldAt at upload so old parked invoices still post with their local create time. */
export function withSoldAt(payload: unknown, createdAt?: string): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;
  if (typeof p.soldAt === 'string' && p.soldAt.trim()) return payload;
  return { ...p, soldAt: toLocalDateTime(createdAt) };
}
