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
  if (stripMm) await ensureFonts(Math.round((4.3 * dpi) / 25.4));
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

/** ارتفاع شريط ديما الحياة أسفل الملصق (يُحجز من طول الورقة فلا يغطي ملصق هاي إكسبريس). */
const BRAND_STRIP_MM = 12;

/** الشعار الأصلي (ملوّن) — يُرسم بمقاسه النهائي ثم يُحوَّل للأسود عند الرسم لحواف حادة. */
async function loadBrandLogo(): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = deemaLogoUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  // قصّ الهوامش البيضاء حول الشعار.
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (px[i + 3] > 40 && lum < 235) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return c;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** خط عربي واضح للطباعة: IBM Plex Sans Arabic إن توفر، وإلا خطوط ويندوز. */
const ARABIC_FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';

async function ensureFonts(px: number) {
  try {
    await Promise.all([
      document.fonts?.load(`700 ${px}px "IBM Plex Sans Arabic"`, 'ديما الحياة'),
      document.fonts?.load(`500 ${px}px "IBM Plex Sans Arabic"`, 'شكراً'),
    ]);
  } catch {
    /* خطوط ويندوز تكفي */
  }
}

/**
 * شريط ديما الحياة تحت ملصق هاي إكسبريس — تصميم هادئ بلونين:
 *   ─────────  [شعار]  ديما الحياة  ─────────
 *        deemaalhayat.com  ·  شكراً لاختياركِ
 * كل الشريط يُحوَّل إلى أبيض/أسود نقي فلا تطبع طابعة الملصقات حوافاً رمادية مهتزة.
 */
function drawBrandStrip(
  ctx: CanvasRenderingContext2D,
  logo: HTMLCanvasElement | null,
  box: { x: number; y: number; w: number; h: number },
  dpi: number,
) {
  const mm = dpi / 25.4;
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  const top = box.y + 1.4 * mm;
  const row1H = 6.6 * mm;
  const midY = top + row1H / 2;

  // الشعار بمقاسه النهائي (تنعيم عالي ثم تحويل للأسود عند العتبة).
  const logoH = Math.round(row1H);
  const logoW = logo ? Math.round((logo.width / logo.height) * logoH) : 0;
  let logoInk: HTMLCanvasElement | null = null;
  if (logo && logoW > 0) {
    logoInk = document.createElement('canvas');
    logoInk.width = logoW;
    logoInk.height = logoH;
    const lc = logoInk.getContext('2d')!;
    lc.imageSmoothingEnabled = true;
    lc.imageSmoothingQuality = 'high';
    lc.drawImage(logo, 0, 0, logoW, logoH);
    const d = lc.getImageData(0, 0, logoW, logoH);
    for (let i = 0; i < d.data.length; i += 4) {
      const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      const ink = d.data[i + 3] > 60 && lum < 225;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 0;
      d.data[i + 3] = ink ? 255 : 0;
    }
    lc.putImageData(d, 0, 0);
  }

  // الاسم
  const nameSize = Math.round(4.3 * mm);
  ctx.font = `700 ${nameSize}px ${ARABIC_FONT}`;
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  const name = 'ديما الحياة';
  const nameW = ctx.measureText(name).width;

  const gap = 1.8 * mm;
  const groupW = logoW + (logoInk ? gap : 0) + nameW;
  const cx = box.x + box.w / 2;
  const groupRight = cx + groupW / 2;
  // عربي: الشعار يميناً ثم الاسم.
  if (logoInk) ctx.drawImage(logoInk, Math.round(groupRight - logoW), Math.round(midY - logoH / 2));
  ctx.textAlign = 'right';
  ctx.fillText(name, groupRight - logoW - (logoInk ? gap : 0), midY + 0.2 * mm);

  // خطّان رفيعان على الجانبين
  const lineGap = 2.6 * mm;
  const sideMargin = 6 * mm;
  ctx.lineWidth = Math.max(1, Math.round(0.22 * mm));
  ctx.beginPath();
  ctx.moveTo(box.x + sideMargin, Math.round(midY) + 0.5);
  ctx.lineTo(cx - groupW / 2 - lineGap, Math.round(midY) + 0.5);
  ctx.moveTo(groupRight + lineGap, Math.round(midY) + 0.5);
  ctx.lineTo(box.x + box.w - sideMargin, Math.round(midY) + 0.5);
  ctx.stroke();

  // السطر الثاني: الموقع وشكر قصير
  const subSize = Math.round(2.35 * mm);
  ctx.font = `500 ${subSize}px ${ARABIC_FONT}`;
  ctx.textAlign = 'center';
  ctx.direction = 'rtl';
  ctx.fillText('شكراً لثقتكِ بنا  •  deemaalhayat.com', cx, top + row1H + 1.9 * mm);

  // أبيض/أسود نقي للشريط كله.
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const w0 = Math.min(ctx.canvas.width - x0, Math.ceil(box.w));
  const h0 = Math.min(ctx.canvas.height - y0, Math.ceil(box.h));
  if (w0 > 0 && h0 > 0) {
    const d = ctx.getImageData(x0, y0, w0, h0);
    for (let i = 0; i < d.data.length; i += 4) {
      const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      const v = lum < 150 ? 0 : 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    ctx.putImageData(d, x0, y0);
  }
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
