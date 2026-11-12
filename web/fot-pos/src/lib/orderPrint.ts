import {
  orderInvoiceHtml,
  orderLabelHtml,
  orderSlipHtml,
  receiptHtmlForBrowser,
  type OrderPrintData,
  type OrderSlipLine,
  type PrintSettingsDto,
  type ReceiptPrintPreviewDto,
} from '@fot/shared';
import { api } from '@/api/client';
import { db } from '@/lib/db';
import { printReceipt } from '@/lib/printReceipt';

/** إعدادات فاتورة المحل: من الخادم، وإلا آخر نسخة محفوظة على الجهاز. */
export async function loadShopPrintSettings(): Promise<PrintSettingsDto | null> {
  try {
    const live = await api.printSettings();
    if (live) {
      try {
        await db.savePrintSettings(live);
      } catch {
        /* الحفظ المحلي اختياري */
      }
      return live;
    }
  } catch {
    /* نكمل بالمحفوظ */
  }
  return db.loadPrintSettings();
}

/** مستند حراري 80مم على طابعة معيّنة (أو الافتراضية). copies = 0 → لا شيء. */
export async function printThermalDoc(html: string, copies: number, printerName?: string | null) {
  const n = Math.max(0, Math.round(copies));
  if (n === 0) return;
  if (window.fotDesktop?.printHtml) {
    let device = printerName || undefined;
    if (!device) {
      const config = await window.fotDesktop.getPrintConfig?.();
      device = config?.printerName ?? undefined;
    }
    const printed = await window.fotDesktop.printHtml(html, n, device, { paperWidthMm: 80 });
    if (printed && printed.ok === false) throw new Error(printed.message || 'تعذرت الطباعة');
    return;
  }
  const w = window.open('', '_blank', 'width=380,height=680');
  if (!w) return;
  w.document.write(receiptHtmlForBrowser(html));
  w.document.close();
  w.focus();
  w.print();
}

export async function printOrderReceipt(receipt: ReceiptPrintPreviewDto, settings: PrintSettingsDto | null, copies: number) {
  if (copies <= 0) return;
  const base: PrintSettingsDto = settings ?? {
    id: 0,
    headerText: 'ديما الحياة',
    showLogo: false,
    showBarcode: true,
    showArticleNumber: false,
    copies: 1,
    paperWidthMm: 80,
    fontSize: 13,
    logoMaxHeightPx: 72,
    showQrCode: false,
    showCashier: true,
    showSalesman: false,
    showCashBox: false,
    showTotalQuantity: true,
    showDiscountDetails: true,
    showItemTable: true,
    showSubtotal: true,
    showPaymentLines: false,
    autoPrint: true,
    receiptTemplate: 'classic',
  };
  await printReceipt(receipt, { ...base, copies, showSalesman: false });
}

export async function printOrderInvoice(data: OrderPrintData, copies: number) {
  await printThermalDoc(orderInvoiceHtml(data), copies);
}

/** ملصق لكل طرد («1 من N»)، كل ملصق بعدد النسخ المضبوط، على طابعة الملصقات إن ضُبطت. */
export async function printOrderLabels(data: OrderPrintData, copies: number, printerName?: string | null) {
  const parcels = Math.max(1, Math.round(data.order.parcelCount ?? 1));
  for (let i = 1; i <= parcels; i++) {
    await printThermalDoc(orderLabelHtml(data, i, parcels), copies, printerName);
  }
}

export async function printOrderSlip(opts: {
  storeName?: string | null;
  orderNumber: string;
  code: string;
  customerName?: string | null;
  governorate?: string | null;
  deliveryOption?: string | null;
  isGift?: boolean;
  notes?: string | null;
  lines: OrderSlipLine[];
}) {
  await printThermalDoc(orderSlipHtml(opts), 1);
}

/** نغمة «طلب جديد جاهز» — نغمتان صاعدتان، مختلفة عن صفارة الخطأ. */
export function playNewOrderChime() {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const tone = (at: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    };
    const t = ctx.currentTime;
    tone(t, 660, 0.18);
    tone(t + 0.2, 880, 0.18);
    tone(t + 0.4, 1175, 0.28);
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    /* الصوت مقفل أو غير مدعوم */
  }
}
