import type { DiscountQrPerson } from '@fot/shared';
import type { CardPaymentDto, PosSessionDto, ReceiptReturnSourceDto, SaleKind } from '@/api/types';
import { getHwId } from '@/lib/money';

export type CartGroupState = {
  key: number;
  salesmanId: number;
  salesmanName: string;
};

export type CartLine = {
  key: string;
  articleId: number;
  num: string | null;
  barcode: string | null;
  name: string;
  quantity: number;
  price: number;
  originalPrice: number;
  discount: number;
  salesmanId: number;
  salesmanName: string;
  groupKey: number;
  groupLabel: string;
  sourceItemId?: number;
  commissionAmount?: number;
  commissionType?: string;
  commissionValue?: number;
};

export type InvoiceSlot = {
  cart: CartLine[];
  userDiscount: number;
  saleKind: SaleKind;
  recalledHoldId: number | null;
  accountId: number;
  salesmanId: number;
  cartGroups: CartGroupState[];
  activeGroupKey: number;
  returnSource: ReceiptReturnSourceDto | null;
  discountQr: DiscountQrPerson | null;
};

export function emptyGroups(): CartGroupState[] {
  return [{ key: 1, salesmanId: 0, salesmanName: '' }];
}

export function emptySlot(salesmanId: number): InvoiceSlot {
  return {
    cart: [],
    userDiscount: 0,
    saleKind: 0,
    recalledHoldId: null,
    accountId: 0,
    salesmanId,
    cartGroups: emptyGroups(),
    activeGroupKey: 1,
    returnSource: null,
    discountQr: null,
  };
}

export function lineTotal(l: CartLine) {
  return l.quantity * l.price - l.discount;
}

export function lineCommissionAmount(l: Pick<CartLine, 'quantity' | 'price' | 'commissionType' | 'commissionValue' | 'commissionAmount'>) {
  if (!l.commissionType || !l.commissionValue || l.commissionValue <= 0 || l.quantity <= 0) {
    return l.commissionAmount ?? 0;
  }
  const raw = l.commissionType.toLowerCase() === 'percentage'
    ? l.quantity * l.price * l.commissionValue / 100
    : l.commissionValue * l.quantity;
  return Math.round(raw * 100) / 100;
}

export function cartCommission(cart: CartLine[]) {
  return cart.reduce((s, l) => s + lineCommissionAmount(l), 0);
}

export function cartSubtotal(cart: CartLine[], saleKind: SaleKind) {
  const raw = cart.reduce((s, l) => s + lineTotal(l), 0);
  return saleKind === 1 ? Math.abs(raw) : raw;
}

/** Invoice total at list price — before offer markdowns on the lines. */
export function cartGross(cart: CartLine[], saleKind: SaleKind) {
  const raw = cart.reduce((s, l) => s + l.quantity * (l.originalPrice || l.price), 0);
  return saleKind === 1 ? Math.abs(raw) : raw;
}

export function slotAmount(slot: Pick<InvoiceSlot, 'cart' | 'saleKind' | 'userDiscount'>) {
  return Math.max(0, cartSubtotal(slot.cart, slot.saleKind) - slot.userDiscount);
}

export function capItemDiscount(value: number, line: CartLine, limit: number | undefined) {
  const maxLine = Math.max(0, line.quantity * line.originalPrice);
  const next = Math.max(0, Number.isFinite(value) ? value : 0);
  const capped = limit && limit > 0 ? Math.min(next, limit) : next;
  return Math.min(capped, maxLine);
}

export function capUserDiscount(value: number, limit: number | undefined, subtotal: number) {
  const next = Math.max(0, Number.isFinite(value) ? value : 0);
  const capped = limit && limit > 0 ? Math.min(next, limit) : next;
  return Math.min(capped, Math.max(0, subtotal));
}

export function parseScan(raw: string): { qty: number; code: string } {
  const text = raw.trim();
  const m = text.match(/^(\d+[x*×])(.+)$/i);
  if (m) return { qty: Math.max(1, Number(m[1].slice(0, -1))), code: m[2].trim() };
  return { qty: 1, code: text };
}

export function cardBlockedReason(opts: {
  saleKind: SaleKind;
  accountId: number;
  recalledHoldId: number | null;
  total: number;
}): string | null {
  if (opts.saleKind === 1) return 'الإرجاع بالبطاقة غير مسموح';
  if (opts.saleKind === 2) return 'الهدية لا تُدفع بالبطاقة';
  if (opts.accountId > 0) return 'لا يمكن الجمع بين الآجل والبطاقة';
  if (opts.recalledHoldId) return 'أتمم الفاتورة المعلّقة نقداً أو آجلاً';
  if (opts.total <= 0) return 'المبلغ غير صالح للدفع بالبطاقة';
  return null;
}

export function sameLine(a: CartLine, articleId: number, salesmanId: number, groupKey: number, sourceItemId?: number) {
  if (sourceItemId != null || a.sourceItemId != null) {
    return a.sourceItemId === sourceItemId && a.articleId === articleId;
  }
  return a.articleId === articleId && a.salesmanId === salesmanId && a.groupKey === groupKey;
}

export function buildReceiptPayload(opts: {
  session: PosSessionDto;
  cart: CartLine[];
  salesmanId: number;
  saleKind: SaleKind;
  userDiscount: number;
  accountId: number;
  masterAccount: number;
  isHold: boolean;
  paid: number;
  card?: CardPaymentDto;
  /** Locally allocated receipt number — the server adopts it so the printed copy matches. */
  number?: number;
  returnOfReceiptId?: number;
  returnOfClientReceiptId?: string;
  discountQr?: DiscountQrPerson | null;
  salesmanName?: string;
  /** Shop-local create time — used by manual transfer so posting keeps the sale clock. */
  soldAt?: string;
}) {
  const accountId = opts.accountId > 0 ? opts.accountId : undefined;
  const payment = opts.isHold || accountId || opts.saleKind === 2 ? 0 : opts.paid;
  return {
    cashierId: opts.session.cashierId,
    salesmanId: opts.salesmanId,
    salesmanName: opts.salesmanName,
    soldAt: opts.soldAt,
    posId: opts.session.posTerminalId,
    payment,
    kind: opts.saleKind,
    isPending: opts.isHold,
    userDiscount: opts.userDiscount,
    accountId,
    masterAccount: opts.masterAccount || opts.session.activeMasterAccount,
    clientReceiptId: crypto.randomUUID(),
    hwId: getHwId() || undefined,
    card: opts.card,
    number: opts.number,
    returnOfReceiptId: opts.returnOfReceiptId && opts.returnOfReceiptId > 0 ? opts.returnOfReceiptId : undefined,
    returnOfClientReceiptId: opts.returnOfClientReceiptId,
    discountQrPersonId: opts.discountQr?.id,
    discountQrPersonCode: opts.discountQr?.code,
    discountQrPersonName: opts.discountQr?.name,
    items: opts.cart.map(l => ({
      articleId: l.articleId,
      name: l.name,
      barcode: l.barcode,
      quantity: opts.saleKind === 1 ? Math.abs(l.quantity) : l.quantity,
      price: l.price,
      originalPrice: l.originalPrice,
      discount: Math.max(0, l.originalPrice - l.price) + l.discount / Math.max(1, l.quantity),
      salesmanId: l.salesmanId,
      salesmanName: l.salesmanName || undefined,
      groupKey: l.groupKey > 0 ? l.groupKey : undefined,
      groupLabel: l.groupLabel || undefined,
    })),
  };
}
