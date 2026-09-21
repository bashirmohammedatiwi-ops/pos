import {
  receiptHtml,
  receiptHtmlForBrowser,
  receiptPaperWidthMm,
  type PrintSettingsDto,
  type ReceiptPrintPreviewDto,
} from '@fot/shared';
import { getApiBase } from './apiBase';

export { receiptHtml };

export async function printReceipt(data: ReceiptPrintPreviewDto, settings: PrintSettingsDto) {
  const html = receiptHtml(data, settings, getApiBase());
  const copies = settings.copies || 1;
  if (window.fotDesktop?.printHtml) {
    const config = await window.fotDesktop.getPrintConfig?.();
    const deviceName = config?.printerName ?? undefined;
    if (config?.askBeforePrint) {
      const w = window.open('', '_blank', 'width=360,height=640');
      if (!w) return;
      w.document.write(receiptHtmlForBrowser(html));
      w.document.close();
      w.focus();
      w.print();
      return;
    }
    const printed = await window.fotDesktop.printHtml(html, copies, deviceName, {
      paperWidthMm: receiptPaperWidthMm(settings),
    });
    if (printed && printed.ok === false) throw new Error(printed.message || 'تعذر الطباعة');
    return;
  }
  const w = window.open('', '_blank', 'width=360,height=640');
  if (!w) return;
  w.document.write(receiptHtmlForBrowser(html));
  w.document.close();
  w.focus();
  w.print();
}
