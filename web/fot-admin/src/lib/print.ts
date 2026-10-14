import { receiptHtml, receiptHtmlForBrowser, receiptPaperWidthMm } from '@fot/shared';
import type { PrintSettingsDto, ReceiptPrintPreviewDto } from '@fot/shared';
import type { ReceiptDetailDto, ReceiptSummary } from '@/api/types';
import { getApiBase } from '@/lib/apiBase';

export async function printHtmlDoc(html: string, copies = 1, paperWidthMm?: number) {
  if (window.fotDesktop?.printHtml) {
    const printed = await window.fotDesktop.printHtml(html, copies, undefined, { paperWidthMm });
    if (printed && printed.ok === false) throw new Error(printed.message || 'تعذرت الطباعة');
    return;
  }
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) throw new Error('تم حظر نافذة الطباعة');
  w.document.write(receiptHtmlForBrowser(html));
  w.document.close();
  w.focus();
  w.print();
}

/**
 * طباعة مستند A4 (تقرير/فاتورة كاملة) — حوار طباعة النظام لاختيار الطابعة والورق.
 * لا تستخدم printHtmlDoc للمستندات: تلك مخصصة لطابعة الفواتير الحرارية.
 */
export async function printDocument(html: string) {
  if (window.fotDesktop?.printHtml) {
    const printed = await window.fotDesktop.printHtml(html, 1, undefined, { kind: 'document' });
    if (printed && printed.ok === false) throw new Error(printed.message || 'تعذرت الطباعة');
    return;
  }
  const w = window.open('', '_blank', 'width=1000,height=800');
  if (!w) throw new Error('تم حظر نافذة الطباعة — اسمح بالنوافذ المنبثقة');
  w.document.write(html);
  w.document.close();
  const go = () => {
    w.focus();
    w.print();
  };
  if (w.document.readyState === 'complete') window.setTimeout(go, 150);
  else w.addEventListener('load', () => window.setTimeout(go, 150));
}

export function receiptToPreview(r: ReceiptSummary, d: ReceiptDetailDto): ReceiptPrintPreviewDto {
  return {
    receiptNumber: r.number,
    printedAt: r.creationDate,
    kind: r.kind ?? 0,
    cashierName: r.cashierName ?? d.salesmanName,
    salesmanName: d.salesmanName ?? r.salesmanName,
    posLabel: r.posName,
    lines: d.items.map(i => ({
      name: i.name ?? '',
      barcode: i.barcode ?? '',
      articleNumber: String(i.articleId),
      quantity: i.quantity,
      unitPrice: i.price,
      lineTotal: i.lineTotal,
      originalPrice: i.originalPrice,
    })),
    subTotal: d.totalAmount + d.userDiscount + d.offersDiscount + d.itemsDiscount,
    userDiscount: d.userDiscount + d.offersDiscount + d.itemsDiscount,
    total: d.totalAmount,
    paid: d.payment,
    change: d.cashBack,
  };
}

export async function printReceipt(r: ReceiptSummary, d: ReceiptDetailDto, settings: PrintSettingsDto) {
  const html = receiptHtml(receiptToPreview(r, d), settings, getApiBase());
  await printHtmlDoc(html, settings.copies || 1, receiptPaperWidthMm(settings));
}
