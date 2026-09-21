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
