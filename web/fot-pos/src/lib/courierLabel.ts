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
  /** مواد الطلب من بياناتنا: تُعاد كتابة خانة «مواد الطلب» جدولاً «منتج — عدد — منتج — عدد». */
  items?: LabelItem[] | null,
): Promise<RasterLabel> {
  // شريط الشعار أسفل الورقة: يُحجز من الطول فيُصغَّر ملصق هاي إكسبريس قليلاً ولا يُغطّى منه شيء.
  const stripMm = paper && brand ? BRAND_STRIP_MM : 0;
  const logo = stripMm ? await loadBrandLogo().catch(() => null) : null;
  if (stripMm || items?.length) await ensureFonts(Math.round((4.3 * dpi) / 25.4));
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
        if (items?.length && n === 1) await redrawItemsCell(ctx, page, viewport, dx, items, dpi, Math.round(viewport.height)).catch(() => false);
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
      if (items?.length && n === 1) await redrawItemsCell(ctx, page, viewport, 0, items, dpi, canvas.height).catch(() => false);
      pages.push(canvas.toDataURL('image/png'));
      page.cleanup();
    }
    if (!pages.length) throw new Error('ملف الملصق فارغ');
    return { pages, widthMm: Math.round(widthMm * 10) / 10, heightMm: Math.round(heightMm * 10) / 10 };
  } finally {
    void pdf.destroy();
  }
}

export type LabelItem = { name: string; qty: number };

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>['promise']>['getPage']>>;
type PdfViewport = ReturnType<PdfPage['getViewport']>;

/**
 * خانة «مواد الطلب» في ملصق هاي إكسبريس تُعاد كتابتها جدولاً من بياناتنا: «منتج | عدد | منتج | عدد»
 * بلا عناوين، بخط أصغر، والاسم الطويل يُختصر من وسطه (بدايته … نهايته). يُزاد ارتفاع الصف من الفراغ
 * أسفل الملصق وتنزل الأسطر التي تحته معه. باقي الملصق (QR، الباركود، البيانات) لا يُمس.
 * إن لم تُعرف الخانة بيقين يبقى الملصق كما هو.
 */
async function redrawItemsCell(
  ctx: CanvasRenderingContext2D,
  page: PdfPage,
  viewport: PdfViewport,
  dx: number,
  items: LabelItem[],
  dpi: number,
  labelBottom: number,
): Promise<boolean> {
  const mm = dpi / 25.4;
  const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const tc = await page.getTextContent();
  let label: { x: number; y: number } | null = null;
  for (const t of tc.items) {
    if (!('str' in t) || !t.str) continue;
    if (!norm(t.str).includes('مواد الطلب')) continue;
    const [x, y] = viewport.convertToViewportPoint(t.transform[4], t.transform[5]);
    label = { x: x + dx, y };
    break;
  }
  if (!label) return false;

  const W = ctx.canvas.width;
  const H = Math.min(ctx.canvas.height, labelBottom);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const dark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = (y * W + x) * 4;
    return d[i] + d[i + 1] + d[i + 2] < 330;
  };
  const yMid = Math.round(label.y - 1.2 * mm);
  /** خط عمودي حقيقي: داكن في 90% من 4مم حول منتصف الصف (الحروف لا تبلغ هذا). */
  const vertical = (x: number) => {
    let n = 0, total = 0;
    for (let y = yMid - Math.round(2 * mm); y <= yMid + Math.round(2 * mm); y++, total++) if (dark(x, y) || dark(x + 1, y)) n++;
    return n >= total * 0.9;
  };
  let divider = -1;
  for (let x = Math.round(label.x) - 2; x > W * 0.35; x--) if (vertical(x)) { divider = x; break; }
  if (divider < 0) return false;
  let left = -1;
  for (let x = divider - Math.round(4 * mm); x > 0; x--) if (vertical(x)) { left = x; break; }
  if (left < 0 || divider - left < 30 * mm) return false;
  /** خط أفقي: داكن في 90% من عرض الخانة. */
  const horizontal = (y: number) => {
    let n = 0, total = 0;
    for (let x = left + 3; x < divider - 3; x += 2, total++) if (dark(x, y)) n++;
    return total > 0 && n >= total * 0.9;
  };
  let top = -1;
  for (let y = yMid; y > 0; y--) if (horizontal(y)) { top = y; break; }
  let bottom = -1;
  for (let y = yMid; y < H; y++) if (horizontal(y)) { bottom = y; break; }
  if (top < 0 || bottom < 0 || bottom - top < 3 * mm) return false;
  // سُمك الخطوط: الصفوف الداكنة المتتالية عند الحد السفلي.
  let thick = 1;
  while (thick < 6 && horizontal(bottom + thick)) thick++;
  let topEdge = top;
  while (topEdge > 0 && horizontal(topEdge - 1)) topEdge--;

  // آخر حبر في الملصق (الخط المتقطع) — ما تحته فراغ يُستثمر لزيادة الصف.
  let lastInk = H - 1;
  scan: for (; lastInk > bottom; lastInk--) {
    for (let x = 0; x < W; x += 2) if (dark(x, lastInk)) break scan;
  }
  const slack = Math.max(0, H - 1 - lastInk - Math.round(1.2 * mm));

  // الجدول: منتجان في كل سطر. الخط يصغر تلقائياً كلما زادت المنتجات حتى تتسع كلها
  // (16 منتجاً وأكثر) في الخانة + الفراغ السفلي — بلا علامة «منتجات أخرى».
  const n = items.length;
  const rowsWanted = Math.ceil(n / 2);
  const cellH = bottom - (top + 1);
  const available = cellH + slack;
  const padY = Math.round((rowsWanted > 5 ? 0.45 : 0.9) * mm);
  const maxRowH = 3.25 * mm;
  const minRowH = 1.35 * mm; // ~ خط 1mm: أصغر ما تقرؤه العين على 203 نقطة/إنش
  const rowH = Math.max(minRowH, Math.min(maxRowH, (available - padY * 2) / rowsWanted));
  const fontPx = Math.max(Math.round(1.0 * mm), Math.min(Math.round(2.35 * mm), Math.round(rowH * 0.74)));
  const needH = Math.ceil(rowsWanted * rowH + padY * 2);
  const extra = Math.max(0, Math.min(needH - cellH, slack));
  const innerTop = top + 1;
  const innerBottom = bottom + extra; // الحد السفلي بعد الإزاحة
  const maxRows = Math.max(1, Math.floor((innerBottom - innerTop - padY * 2) / rowH));

  // إزاحة ما تحت الخانة للأسفل، ومدّ خطوط الجدول العمودية في الفراغ الجديد.
  if (extra > 0) {
    const part = ctx.getImageData(0, bottom, W, lastInk - bottom + 1);
    const filler = ctx.getImageData(0, bottom - Math.round(1.5 * mm), W, 1);
    ctx.putImageData(part, 0, bottom + extra);
    for (let y = bottom; y < bottom + extra; y++) ctx.putImageData(filler, 0, y);
  }
  // تفريغ الخانة (داخل الإطار).
  ctx.fillStyle = '#fff';
  ctx.fillRect(left + thick + 1, innerTop + thick, divider - left - thick * 2 - 1, innerBottom - innerTop - thick);

  const x0 = left + thick + Math.round(0.8 * mm);
  const x1 = divider - Math.round(0.8 * mm);
  const half = (x1 - x0) / 2;
  const qtyW = Math.max(Math.round(3.6 * mm), Math.round(fontPx * 2.2));
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  const line = Math.max(1, Math.round(0.12 * mm));
  ctx.lineWidth = line;

  const shown = n > maxRows * 2 ? maxRows * 2 - 1 : n;
  const rows = Math.min(maxRows, Math.ceil((n > maxRows * 2 ? shown + 1 : n) / 2));
  const tableTop = innerTop + Math.max(padY, Math.round((innerBottom - innerTop - rows * rowH) / 2));

  const fit = (text: string, maxW: number) => {
    if (ctx.measureText(text).width <= maxW) return text;
    const chars = [...text];
    // بداية … نهاية: أكبر عدد من الحروف يتسع، ثلثاه من البداية وثلثه من النهاية.
    let lo = 2, hi = chars.length - 1, best = '…';
    while (lo <= hi) {
      const k = Math.floor((lo + hi) / 2);
      const head = Math.ceil((k * 2) / 3), tail = k - head;
      // القص عند حدود الكلمات: لا نصف كلمة في البداية ولا في النهاية.
      let h = chars.slice(0, head).join('');
      if (chars[head] && chars[head] !== ' ' && h.includes(' ') && h.lastIndexOf(' ') > h.length * 0.5) h = h.slice(0, h.lastIndexOf(' '));
      let tl = tail ? chars.slice(chars.length - tail).join('') : '';
      const before = chars[chars.length - tail - 1];
      if (tl && before && before !== ' ' && tl.includes(' ')) tl = tl.slice(tl.indexOf(' ') + 1);
      const s = `${h.trim()}…${tl.trim()}`;
      if (ctx.measureText(s).width <= maxW) { best = s; lo = k + 1; } else hi = k - 1;
    }
    return best;
  };

  for (let r = 0; r < rows; r++) {
    const yTop = tableTop + r * rowH;
    const cy = yTop + rowH / 2;
    for (let c = 0; c < 2; c++) {
      const idx = r * 2 + c;
      // عربي: الخانة الأولى يميناً.
      const cellRight = x1 - c * half;
      const cellLeft = cellRight - half;
      const nameRight = cellRight - Math.round(0.6 * mm);
      const nameLeft = cellLeft + qtyW + Math.round(0.6 * mm);
      if (idx < shown) {
        const it = items[idx];
        ctx.font = `600 ${fontPx}px ${ARABIC_FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText(fit(it.name, nameRight - nameLeft), nameRight, cy + 0.15 * mm);
        ctx.font = `700 ${Math.round(fontPx * 1.05)}px ${ARABIC_FONT}`;
        ctx.textAlign = 'center';
        ctx.direction = 'ltr';
        ctx.fillText(String(it.qty), cellLeft + qtyW / 2, cy + 0.15 * mm);
        ctx.direction = 'rtl';
      } else if (idx === shown && n > shown) {
        ctx.font = `700 ${fontPx}px ${ARABIC_FONT}`;
        ctx.textAlign = 'right';
        ctx.fillText(`+ ${n - shown} منتجات أخرى`, nameRight, cy + 0.15 * mm);
      }
      // فاصل العدد
      ctx.beginPath();
      ctx.moveTo(Math.round(cellLeft + qtyW) + 0.5, yTop + 1);
      ctx.lineTo(Math.round(cellLeft + qtyW) + 0.5, yTop + rowH - 1);
      ctx.stroke();
    }
    // فاصل بين المنتجين، وخط بين الأسطر
    ctx.beginPath();
    ctx.moveTo(Math.round(x0 + half) + 0.5, yTop);
    ctx.lineTo(Math.round(x0 + half) + 0.5, yTop + rowH);
    if (r < rows - 1) {
      ctx.moveTo(x0, Math.round(yTop + rowH) + 0.5);
      ctx.lineTo(x1, Math.round(yTop + rowH) + 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
  return true;
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
export async function printCourierLabel(pdfBase64: string, opts: { copies: number; printerName: string | null; items?: LabelItem[] | null }) {
  const copies = Math.max(1, Math.min(50, Math.round(opts.copies)));
  if (!window.fotDesktop?.printRaster) {
    const blob = new Blob([base64ToBytes(pdfBase64)], { type: 'application/pdf' });
    window.open(URL.createObjectURL(blob), '_blank');
    return;
  }
  if (!opts.printerName) throw new Error('اختر طابعة الملصقات من «إعدادات الطباعة» أولاً — لا يُطبع الملصق على الطابعة الحرارية');
  const label = await rasterizeLabelPdf(pdfBase64, LABEL_DPI, await resolveLabelPaper(), await resolveLabelBrand(), opts.items);
  const res = await window.fotDesktop.printRaster(label.pages, {
    widthMm: label.widthMm,
    heightMm: label.heightMm,
    dpi: LABEL_DPI,
    printerName: opts.printerName,
    copies,
  });
  if (res && res.ok === false) throw new Error(res.message || 'تعذرت طباعة الملصق');
}
