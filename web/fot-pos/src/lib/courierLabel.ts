/**
 * ملصق شركة التوصيل كما تصممه هاي إكسبريس (PDF من حسابنا عندهم) — لا تصميم خاص بنا.
 * يُحوَّل كل صفحة إلى صورة بدقة طابعة الملصقات (203 نقطة/إنش) ويُطبع 1:1 على طابعة الملصقات
 * عبر print:raster في تطبيق سطح المكتب — لا على الطابعة الحرارية أبداً.
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import deemaLogoUrl from '@/assets/deema-logo.png';

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

/** ورق الملصقات الشائع 100×150مم؛ ملصق هاي إكسبريس A6 (105×148.5مم) يُصغَّر ليدخل كاملاً. */
export const DEFAULT_LABEL_PAPER = { widthMm: 100, heightMm: 150 };

/**
 * صفحات PDF الملصق ← صور PNG بدقة الطابعة. مع paper: يُصغَّر الملصق (بنسبته) ليدخل في ورق الطابعة
 * كاملاً ويُوسَّط أفقياً، ومقاس الصفحة المطبوعة = مقاس الورق. بلاه: مقاس صفحة الـPDF كما هو.
 */
export async function rasterizeLabelPdf(
  pdfBase64: string,
  dpi = LABEL_DPI,
  paper?: { widthMm: number; heightMm: number } | null,
  brand = false,
): Promise<RasterLabel> {
  // شريط الشعار أسفل الورقة: يُحجز من الطول فيُصغَّر ملصق هاي إكسبريس قليلاً ولا يُغطّى منه شيء.
  const stripMm = paper && brand ? BRAND_STRIP_MM : 0;
  const logo = stripMm ? await loadBrandLogo().catch(() => null) : null;
  const pdf = await getDocument({ data: base64ToBytes(pdfBase64), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    let widthMm = 0;
    let heightMm = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const pageW = base.width * MM_PER_PT;
      const pageH = base.height * MM_PER_PT;
      const fit = paper ? Math.min(1, paper.widthMm / pageW, (paper.heightMm - stripMm) / pageH) : 1;
      if (n === 1) {
        widthMm = paper ? paper.widthMm : pageW;
        heightMm = paper ? paper.heightMm : pageH;
      }
      const viewport = page.getViewport({ scale: (dpi / 72) * fit });
      if (paper) {
        // لوحة بمقاس الورق والملصق في وسطها أفقياً (من الأعلى).
        const canvas = document.createElement('canvas');
        canvas.width = Math.round((paper.widthMm / 25.4) * dpi);
        canvas.height = Math.round((paper.heightMm / 25.4) * dpi);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('تعذر تجهيز صورة الملصق');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const dx = Math.max(0, Math.round((canvas.width - viewport.width) / 2));
        await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, dx, 0] }).promise;
        if (stripMm && n === 1) {
          const top = Math.round(viewport.height);
          drawBrandStrip(ctx, logo, { x: 0, y: top, w: canvas.width, h: canvas.height - top }, dpi);
        }
        pages.push(canvas.toDataURL('image/png'));
        page.cleanup();
        continue;
      }
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

/** ارتفاع شريط شعار ديما الحياة أسفل الملصق. */
const BRAND_STRIP_MM = 10.5;

/** الشعار صورةً سوداء نقية (طابعات الملصقات بلونين — التدرج الوردي/البنفسجي يصير رمادياً باهتاً). */
async function loadBrandLogo(): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = deemaLogoUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  // قصّ الحواف البيضاء + تحويل كل ما ليس أبيض إلى أسود.
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const ink = px[i + 3] > 40 && lum < 235;
      px[i] = px[i + 1] = px[i + 2] = ink ? 0 : 255;
      px[i + 3] = ink ? 255 : 0;
      if (ink) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  if (maxX <= minX || maxY <= minY) return c;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** شريط أنيق أسفل الملصق: خط رفيع، ثم الشعار + «ديما الحياة» + الموقع في الوسط. */
function drawBrandStrip(
  ctx: CanvasRenderingContext2D,
  logo: HTMLCanvasElement | null,
  box: { x: number; y: number; w: number; h: number },
  dpi: number,
) {
  const mm = dpi / 25.4;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  // خط فاصل قصير في الوسط
  ctx.lineWidth = Math.max(1, Math.round(0.25 * mm));
  const lineY = box.y + Math.round(1.2 * mm);
  ctx.beginPath();
  ctx.moveTo(box.x + box.w * 0.18, lineY);
  ctx.lineTo(box.x + box.w * 0.82, lineY);
  ctx.stroke();

  const rowTop = lineY + Math.round(1 * mm);
  const rowH = box.y + box.h - rowTop - Math.round(0.8 * mm);
  const logoH = Math.max(1, Math.round(rowH));
  const logoW = logo ? Math.round((logo.width / logo.height) * logoH) : 0;
  const gap = Math.round(2 * mm);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  const nameFont = `bold ${Math.round(3.6 * mm)}px "IBM Plex Sans Arabic", Tahoma, "Segoe UI", Arial, sans-serif`;
  const siteFont = `${Math.round(2.4 * mm)}px Tahoma, "Segoe UI", Arial, sans-serif`;
  const name = 'ديما الحياة';
  const site = 'deemaalhayat.com';
  ctx.font = nameFont;
  const nameW = ctx.measureText(name).width;
  ctx.font = siteFont;
  const siteW = ctx.measureText(site).width;
  const textW = Math.max(nameW, siteW);
  const total = logoW + (logo ? gap : 0) + textW;
  const startX = box.x + (box.w - total) / 2;
  const midY = rowTop + rowH / 2;
  // الاتجاه عربي: الشعار يمين والنص يساره.
  if (logo) ctx.drawImage(logo, Math.round(startX + textW + gap), Math.round(rowTop), logoW, logoH);
  ctx.textAlign = 'center';
  ctx.font = nameFont;
  ctx.fillText(name, startX + textW / 2, midY - 1.3 * mm);
  ctx.font = siteFont;
  ctx.direction = 'ltr';
  ctx.fillText(site, startX + textW / 2, midY + 1.9 * mm);
  ctx.restore();
}

/** شعار ديما الحياة على الملصق (إعداد هذا الجهاز؛ الافتراضي نعم). */
export async function resolveLabelBrand(): Promise<boolean> {
  try {
    const cfg = await window.fotDesktop?.getPrintConfig?.();
    return cfg?.labelBrand !== false;
  } catch {
    return true;
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

/** مقاس ورق طابعة الملصقات لهذا الجهاز (الافتراضي 100×150مم). */
export async function resolveLabelPaper(): Promise<{ widthMm: number; heightMm: number }> {
  try {
    const cfg = await window.fotDesktop?.getPrintConfig?.();
    const w = Number(cfg?.labelWidthMm);
    const h = Number(cfg?.labelHeightMm);
    if (w >= 30 && w <= 300 && h >= 30 && h <= 300) return { widthMm: w, heightMm: h };
  } catch {
    /* الافتراضي */
  }
  return DEFAULT_LABEL_PAPER;
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
  const label = await rasterizeLabelPdf(pdfBase64, LABEL_DPI, await resolveLabelPaper(), await resolveLabelBrand());
  const res = await window.fotDesktop.printRaster(label.pages, {
    widthMm: label.widthMm,
    heightMm: label.heightMm,
    dpi: LABEL_DPI,
    printerName: opts.printerName,
    copies,
  });
  if (res && res.ok === false) throw new Error(res.message || 'تعذرت طباعة الملصق');
}
