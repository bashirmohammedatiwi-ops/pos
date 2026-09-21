import { useMemo } from 'react';
import {
  receiptHtml,
  receiptHtmlForBrowser,
  receiptThermalWidthPx,
  RECEIPT_TEMPLATES,
  normalizeReceiptTemplate,
  THERMAL_DPI,
} from '@fot/shared';
import type { PrintSettingsDto, ReceiptPrintPreviewDto } from '@/api/types';

export const SAMPLE_RECEIPT: ReceiptPrintPreviewDto = {
  receiptNumber: 1024,
  printedAt: new Date().toISOString(),
  kind: 0,
  cashierName: 'أحمد الكاشير',
  salesmanName: 'محمد المندوب',
  posLabel: 'نقطة بيع 1',
  cashBoxName: 'صندوق المحل الرئيسي',
  lines: [
    { name: 'شامبو هيربل essences', barcode: '6281000123456', articleNumber: 'A-1001', quantity: 2, unitPrice: 12500, lineTotal: 25000, originalPrice: 15000 },
    { name: 'كريم مرطب للوجه', barcode: '6281000987654', articleNumber: 'B-2044', quantity: 1, unitPrice: 22000, lineTotal: 22000, originalPrice: 22000 },
    { name: 'معجون أسنان', barcode: '6281000555555', articleNumber: 'C-3301', quantity: 3, unitPrice: 3500, lineTotal: 10500, originalPrice: 4000 },
  ],
  subTotal: 57500,
  userDiscount: 2500,
  total: 55000,
  paid: 60000,
  change: 5000,
};

export function ReceiptPreviewPanel({ settings, apiBase = '' }: { settings: PrintSettingsDto; apiBase?: string }) {
  const html = useMemo(() => {
    try {
      return receiptHtml(SAMPLE_RECEIPT, settings, apiBase);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر إنشاء المعاينة';
      return `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="font:13px sans-serif;padding:16px;color:#b91c1c">${message}</body></html>`;
    }
  }, [settings, apiBase]);
  const previewHtml = useMemo(() => {
    try {
      return receiptHtmlForBrowser(html);
    } catch {
      return html;
    }
  }, [html]);
  const paperWidth = settings.paperWidthMm === 58 ? 58 : 80;
  const nativeWidth = receiptThermalWidthPx(paperWidth);
  const previewScale = 96 / THERMAL_DPI;
  const width = Math.round(nativeWidth * previewScale);

  return (
    <div>
      <div className="mx-auto overflow-hidden rounded-lg bg-[#f4efe6] p-3 shadow-inner ring-1 ring-slate-200" style={{ width: width + 24, maxWidth: '100%' }}>
        <div className="mx-auto overflow-hidden bg-white shadow-sm" style={{ width, height: 680 }}>
          <iframe
            title="معاينة الإيصال"
            srcDoc={previewHtml}
            sandbox=""
            className="block bg-white"
            style={{
              width,
              height: 680,
              border: 0,
            }}
          />
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        معاينة مباشرة — نفس طباعة الكاشير · {settings.paperWidthMm}مم ·{' '}
        {RECEIPT_TEMPLATES.find(t => t.id === normalizeReceiptTemplate(settings.receiptTemplate))?.title}
      </p>
    </div>
  );
}
