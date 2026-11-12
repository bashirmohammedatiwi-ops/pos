/**
 * ملصق شركة التوصيل كما تصممه هاي إكسبريس (PDF من حسابنا عندهم) — لا تصميم خاص بنا.
 * يُحوَّل كل صفحة إلى صورة بدقة طابعة الملصقات (203 نقطة/إنش) ويُطبع 1:1 على طابعة الملصقات
 * عبر print:raster في تطبيق سطح المكتب — لا على الطابعة الحرارية أبداً.
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const LABEL_DPI = 203;
const MM_PER_PT = 25.4 / 72;

export type RasterLabel = { pages: string[]; widthMm: number; heightMm: number };

function base64ToBytes(b64: string) {
  const clean = b64.replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** صفحات PDF الملصق ← صور PNG بدقة الطابعة، مع مقاس الصفحة الأولى بالملم. */
export async function rasterizeLabelPdf(pdfBase64: string, dpi = LABEL_DPI): Promise<RasterLabel> {
  const pdf = await getDocument({ data: base64ToBytes(pdfBase64), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    let widthMm = 0;
    let heightMm = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (n === 1) {
        widthMm = base.width * MM_PER_PT;
        heightMm = base.height * MM_PER_PT;
      }
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('تعذر تجهيز صورة الملصق');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push(canvas.toDataURL('image/png'));
      page.cleanup();
    }
    if (!pages.length) throw new Error('ملف الملصق فارغ');
    return { pages, widthMm: Math.round(widthMm * 10) / 10, heightMm: Math.round(heightMm * 10) / 10 };
  } finally {
    void pdf.destroy();
  }
}

/** طابعة الملصقات: إعداد هذا الجهاز أولاً، ثم الإعداد العام من لوحة التحكم. */
export async function resolveLabelPrinter(fallback?: string | null): Promise<string | null> {
  try {
    const cfg = await window.fotDesktop?.getPrintConfig?.();
    if (cfg?.labelPrinterName) return cfg.labelPrinterName;
  } catch {
    /* نكمل بالإعداد العام */
  }
  return fallback?.trim() || null;
}

/**
 * يطبع ملصق هاي إكسبريس على طابعة الملصقات. copies = نسخ لكل طرد × عدد الطرود.
 * في المتصفح (بلا تطبيق سطح المكتب) يُفتح الـPDF للطباعة اليدوية.
 */
export async function printCourierLabel(pdfBase64: string, opts: { copies: number; printerName: string | null }) {
  const copies = Math.max(1, Math.min(50, Math.round(opts.copies)));
  if (!window.fotDesktop?.printRaster) {
    const blob = new Blob([base64ToBytes(pdfBase64)], { type: 'application/pdf' });
    window.open(URL.createObjectURL(blob), '_blank');
    return;
  }
  if (!opts.printerName) throw new Error('اختر طابعة الملصقات من «إعدادات الطباعة» أولاً — لا يُطبع الملصق على الطابعة الحرارية');
  const label = await rasterizeLabelPdf(pdfBase64);
  const res = await window.fotDesktop.printRaster(label.pages, {
    widthMm: label.widthMm,
    heightMm: label.heightMm,
    dpi: LABEL_DPI,
    printerName: opts.printerName,
    copies,
  });
  if (res && res.ok === false) throw new Error(res.message || 'تعذرت طباعة الملصق');
}
