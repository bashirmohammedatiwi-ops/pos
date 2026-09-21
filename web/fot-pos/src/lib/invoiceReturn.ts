import { receiptNumberFromScan } from '@fot/shared';
import type { ProductDto, ReceiptReturnLineDto, ReceiptReturnSourceDto } from '@/api/types';
import type { CartLine } from '@/lib/sale';

export function parseInvoiceNumber(raw: string) {
  return receiptNumberFromScan(raw);
}

export function looksLikeReceiptNumber(code: string) {
  const n = receiptNumberFromScan(code);
  const text = String(n);
  return n >= 20_000_000_000 && text.startsWith('20') && text.length >= 11 && text.length <= 14;
}

export function cartQtyForSourceItem(cart: CartLine[], itemId: number) {
  return cart.filter(l => l.sourceItemId === itemId).reduce((sum, line) => sum + line.quantity, 0);
}

export function remainingForSourceItem(source: ReceiptReturnSourceDto, cart: CartLine[], itemId: number) {
  const line = source.items.find(item => item.itemId === itemId);
  if (!line) return 0;
  return Math.max(0, line.remainingQty - cartQtyForSourceItem(cart, itemId));
}

export function matchReturnProduct(
  source: ReceiptReturnSourceDto,
  cart: CartLine[],
  product: ProductDto,
  qty: number,
): { ok: true; line: ReceiptReturnLineDto; qty: number } | { ok: false; error: string } {
  const candidates = source.items.filter(item =>
    item.articleId === product.id
    || (!!product.barcode && !!item.barcode && item.barcode === product.barcode),
  );
  if (!candidates.length) return { ok: false, error: 'هذا الصنف ليس في الفاتورة الأصلية' };
  const line = candidates.find(item => remainingForSourceItem(source, cart, item.itemId) > 0);
  if (!line) return { ok: false, error: 'تم إرجاع الكمية المباعة من هذا الصنف' };
  const left = remainingForSourceItem(source, cart, line.itemId);
  return { ok: true, line, qty: Math.max(1, Math.min(qty, left)) };
}

export function sourceLinesToCart(source: ReceiptReturnSourceDto): CartLine[] {
  return source.items
    .filter(item => item.remainingQty > 0)
    .map(item => ({
      key: `ret-${item.itemId}`,
      articleId: item.articleId,
      num: null,
      barcode: item.barcode ?? null,
      name: item.name || item.barcode || `#${item.articleId}`,
      quantity: item.remainingQty,
      price: item.price,
      originalPrice: item.originalPrice || item.price,
      discount: 0,
      salesmanId: item.salesmanId ?? 0,
      salesmanName: item.salesmanName ?? '',
      groupKey: item.groupKey || 1,
      groupLabel: item.groupLabel || `مجموعة ${item.groupKey || 1}`,
      sourceItemId: item.itemId,
    }));
}
