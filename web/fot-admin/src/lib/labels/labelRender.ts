import { encodeBarcode } from './barcodeEncode';

/* ─────────────────────────────────────────────────────────────────────────────
 * رسم الملصقات مباشرة بنقاط الطابعة (203/300 DPI) على canvas بالأبيض والأسود فقط.
 * ما تراه في المعاينة هو نفس الصورة التي تُرسل للطابعة بلا تحجيم.
 * صف واحد = عدد الأعمدة × عرض الملصق + الفواصل + الهوامش (رول ملصقات حراري).
 * ───────────────────────────────────────────────────────────────────────────── */

export type LabelContent = {
  name: boolean;
  price: boolean;
  oldPrice: boolean;
  barcode: boolean;
  digits: boolean;
  shop: boolean;
};

export type LabelSetup = {
  widthMm: number;
  heightMm: number;
  columns: number;
  /** الفراغ بين الملصقات في الصف. */
  gapMm: number;
  /** هامش يسار ويمين الرول. */
  sideMm: number;
  dpi: 203 | 300;
  /** تصحيح موضع الطباعة (معايرة الطابعة). */
  offsetXMm: number;
  offsetYMm: number;
  /** حشوة داخل الملصق. */
  paddingMm: number;
  content: LabelContent;
  nameLines: 1 | 2;
  textScale: 'sm' | 'md' | 'lg';
  currency: string;
  shopName: string;
};

export type LabelData = {
  name: string;
  barcode: string;
  price: number;
  oldPrice?: number;
};

export const DEFAULT_SETUP: LabelSetup = {
  widthMm: 38,
  heightMm: 25,
  columns: 3,
  gapMm: 2,
  sideMm: 1,
  dpi: 203,
  offsetXMm: 0,
  offsetYMm: 0,
  paddingMm: 1.2,
  content: { name: true, price: true, oldPrice: false, barcode: true, digits: true, shop: false },
  nameLines: 2,
  textScale: 'md',
  currency: 'د.ع',
  shopName: '',
};

export const SIZE_PRESETS: { id: string; w: number; h: number; cols: number; gap: number; label: string }[] = [
  { id: '30x20x3', w: 30, h: 20, cols: 3, gap: 2, label: '30×20 · 3 أعمدة' },
  { id: '32x25x3', w: 32, h: 25, cols: 3, gap: 2, label: '32×25 · 3 أعمدة' },
  { id: '35x25x3', w: 35, h: 25, cols: 3, gap: 2, label: '35×25 · 3 أعمدة' },
  { id: '38x25x3', w: 38, h: 25, cols: 3, gap: 2, label: '38×25 · 3 أعمدة' },
  { id: '40x30x2', w: 40, h: 30, cols: 2, gap: 2, label: '40×30 · عمودان' },
  { id: '50x25x2', w: 50, h: 25, cols: 2, gap: 2, label: '50×25 · عمودان' },
  { id: '40x25x1', w: 40, h: 25, cols: 1, gap: 0, label: '40×25 · عمود واحد' },
  { id: '50x30x1', w: 50, h: 30, cols: 1, gap: 0, label: '50×30 · عمود واحد' },
  { id: '58x40x1', w: 58, h: 40, cols: 1, gap: 0, label: '58×40 · عمود واحد' },
];

export function dots(mm: number, dpi: number) {
  return Math.max(0, Math.round((mm * dpi) / 25.4));
}

/** عرض الصف كاملاً بالمليمتر (ما يُرسل للطابعة كصفحة واحدة). */
export function rowWidthMm(s: LabelSetup) {
  return s.sideMm * 2 + s.columns * s.widthMm + (s.columns - 1) * s.gapMm;
}

export function formatPrice(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
}

const FONT = 'Tahoma, "Segoe UI", Arial, sans-serif';

function setFont(ctx: CanvasRenderingContext2D, px: number, weight = 700) {
  ctx.font = `${weight} ${px}px ${FONT}`;
}

/** يقسّم الاسم إلى أسطر ضمن العرض؛ يقصّ آخر سطر بـ… عند الحاجة. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  // كلمة واحدة أعرض من الملصق: قصّ بالأحرف
  const fit = (s: string) => {
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  };
  if (lines.length <= maxLines) return { lines: lines.map(fit), clipped: false };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`);
  return { lines: kept.map(fit), clipped: true };
}

export type LabelWarnings = {
  /** الباركود لا يتسع حتى بعرض نقطة واحدة للخط — غير قابل للقراءة على هذا الحجم. */
  barcodeTooLong: boolean;
  /** عرض الخط نقطة واحدة فقط — قد يصعب مسحه على بعض الماسحات. */
  barcodeThin: boolean;
  nameClipped: boolean;
  invalidBarcode: boolean;
};

/** يرسم ملصقاً واحداً داخل مستطيل (بالنقاط). يعيد التحذيرات. */
function drawLabel(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, item: LabelData, s: LabelSetup): LabelWarnings {
  const warn: LabelWarnings = { barcodeTooLong: false, barcodeThin: false, nameClipped: false, invalidBarcode: false };
  const pad = Math.max(dots(0.6, s.dpi), dots(s.paddingMm, s.dpi));
  const x = x0 + pad;
  const innerW = w - pad * 2;
  let y = y0 + pad;
  const bottom = y0 + h - pad;
  const mmPx = s.dpi / 25.4;
  const scale = s.textScale === 'sm' ? 0.88 : s.textScale === 'lg' ? 1.14 : 1;
  const c = s.content;

  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  // اسم المحل
  if (c.shop && s.shopName.trim()) {
    const px = Math.round(2.1 * mmPx * scale);
    setFont(ctx, px, 700);
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    const { lines } = wrapLines(ctx, s.shopName.trim(), innerW, 1);
    ctx.fillText(lines[0], x + innerW / 2, y);
    y += Math.round(px * 1.15);
  }

  // اسم المادة — أكبر خط يتسع في عدد الأسطر المطلوب
  if (c.name && item.name.trim()) {
    const maxPx = Math.round((h < dots(22, s.dpi) ? 2.6 : 3.0) * mmPx * scale);
    const minPx = Math.round(2.0 * mmPx);
    let px = maxPx;
    let res = { lines: [] as string[], clipped: false };
    for (; px >= minPx; px--) {
      setFont(ctx, px, 700);
      res = wrapLines(ctx, item.name.trim(), innerW, s.nameLines);
      if (!res.clipped) break;
    }
    px = Math.max(px, minPx);
    setFont(ctx, px, 700);
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    const lh = Math.round(px * 1.12);
    for (const line of res.lines) {
      ctx.fillText(line, x + innerW / 2, y);
      y += lh;
    }
    warn.nameClipped = res.clipped;
    y += Math.round(0.3 * mmPx);
  }

  // السعر (والسعر قبل الخصم)
  const hasOld = c.oldPrice && item.oldPrice != null && item.oldPrice > item.price + 0.5;
  if (c.price && item.price > 0) {
    const px = Math.round((h < dots(22, s.dpi) ? 3.0 : 3.6) * mmPx * scale);
    setFont(ctx, px, 800);
    ctx.direction = 'ltr';
    const main = `${formatPrice(item.price)} ${s.currency}`;
    const mainW = ctx.measureText(main).width;
    let oldText = '';
    let oldW = 0;
    const oldPx = Math.round(px * 0.62);
    if (hasOld) {
      setFont(ctx, oldPx, 600);
      oldText = formatPrice(item.oldPrice!);
      oldW = ctx.measureText(oldText).width + Math.round(1.2 * mmPx);
    }
    const total = mainW + oldW;
    let cx = x + (innerW - total) / 2;
    if (hasOld) {
      setFont(ctx, oldPx, 600);
      ctx.textAlign = 'left';
      const oy = y + Math.round((px - oldPx) * 0.6);
      ctx.fillText(oldText, cx, oy);
      const tw = ctx.measureText(oldText).width;
      ctx.fillRect(Math.round(cx), Math.round(oy + oldPx * 0.5), Math.round(tw), Math.max(1, Math.round(oldPx * 0.09)));
      cx += oldW;
    }
    setFont(ctx, px, 800);
    ctx.textAlign = 'left';
    ctx.fillText(main, cx, y);
    y += Math.round(px * 1.08);
  }

  // الباركود + أرقامه: يملأ ما تبقى من الارتفاع
  const code = (item.barcode || '').trim();
  if ((c.barcode || c.digits) && code) {
    const digitsPx = c.digits ? Math.round(2.2 * mmPx * Math.min(scale, 1.05)) : 0;
    const digitsH = c.digits ? Math.round(digitsPx * 1.05) : 0;
    if (c.barcode) {
      let encoded: ReturnType<typeof encodeBarcode> | null = null;
      try {
        encoded = encodeBarcode(code);
      } catch {
        warn.invalidBarcode = true;
      }
      if (encoded) {
        const quiet = encoded.kind === 'EAN13' ? 9 : 10;
        const total = encoded.modules.length + quiet * 2;
        // المنطقة الهادئة قد تمتد داخل حشوة الملصق البيضاء؛ الخطوط نفسها يجب أن تبقى داخل العرض الداخلي
        let mod = Math.min(Math.floor((innerW + pad * 2) / total), Math.floor(innerW / encoded.modules.length));
        if (mod < 1) {
          warn.barcodeTooLong = true;
          mod = 1;
        }
        warn.barcodeThin = mod === 1;
        // سقف للعرض: خطوط عريضة جداً لا فائدة منها
        mod = Math.min(mod, Math.max(1, Math.round(0.5 * mmPx)));
        const barsW = encoded.modules.length * mod;
        const bx = Math.round(x + (innerW - barsW) / 2);
        const barsTop = Math.round(y);
        const barsH = Math.max(dots(4, s.dpi), bottom - digitsH - barsTop);
        const guardExtra = encoded.guards && c.digits ? Math.round(digitsPx * 0.45) : 0;
        for (let i = 0; i < encoded.modules.length; i++) {
          if (!encoded.modules[i]) continue;
          // خطوط متتالية تُرسم كمستطيل واحد
          const isGuard = encoded.guards?.has(i) ?? false;
          let j = i;
          while (j + 1 < encoded.modules.length && encoded.modules[j + 1] && (encoded.guards?.has(j + 1) ?? false) === isGuard) j++;
          ctx.fillRect(bx + i * mod, barsTop, (j - i + 1) * mod, barsH + (isGuard ? guardExtra : 0));
          i = j;
        }
        y = barsTop + barsH;
      }
    }
    if (c.digits) {
      setFont(ctx, digitsPx, 700);
      ctx.direction = 'ltr';
      ctx.textAlign = 'center';
      // تباعد بسيط بين الأرقام لقراءة أوضح
      ctx.fillText(code, x + innerW / 2, Math.min(y, bottom - digitsH) + Math.round(digitsPx * 0.02));
    }
  }
  return warn;
}

/** تحويل لأبيض/أسود خالص — الطابعات الحرارية تُفسد الرمادي. */
function threshold(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const v = lum < 150 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export type RenderedRow = {
  canvas: HTMLCanvasElement;
  widthMm: number;
  heightMm: number;
  warnings: LabelWarnings;
};

/** يرسم صفاً واحداً من الملصقات (حتى `columns` ملصق؛ الخانات الفارغة تبقى بيضاء). */
export function renderRow(items: (LabelData | null)[], s: LabelSetup, opts?: { outline?: boolean }): RenderedRow {
  const widthMm = rowWidthMm(s);
  const W = dots(widthMm, s.dpi);
  const H = dots(s.heightMm, s.dpi);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, W);
  canvas.height = Math.max(1, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  const merged: LabelWarnings = { barcodeTooLong: false, barcodeThin: false, nameClipped: false, invalidBarcode: false };
  const labelW = dots(s.widthMm, s.dpi);
  const offX = dots(s.offsetXMm, s.dpi);
  const offY = dots(s.offsetYMm, s.dpi);
  for (let i = 0; i < s.columns; i++) {
    const item = items[i];
    // الرول يُقرأ من اليسار لليمين كما يخرج من الطابعة
    const x = dots(s.sideMm + i * (s.widthMm + s.gapMm), s.dpi) + offX;
    if (opts?.outline) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 0.5, offY + 0.5, labelW - 1, H - 1);
      ctx.setLineDash([]);
    }
    if (!item) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, offY, labelW, H);
    ctx.clip();
    const w = drawLabel(ctx, x, offY, labelW, H, item, s);
    ctx.restore();
    merged.barcodeTooLong ||= w.barcodeTooLong;
    merged.barcodeThin ||= w.barcodeThin;
    merged.nameClipped ||= w.nameClipped;
    merged.invalidBarcode ||= w.invalidBarcode;
  }
  threshold(ctx, W, H);
  return { canvas, widthMm, heightMm: s.heightMm, warnings: merged };
}

/** ملصق معايرة: إطار كل ملصق + خطوط منتصف + مسطرة مليمترية — للتحقق من الأبعاد والإزاحة. */
export function renderCalibration(s: LabelSetup): RenderedRow {
  const widthMm = rowWidthMm(s);
  const W = dots(widthMm, s.dpi);
  const H = dots(s.heightMm, s.dpi);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  const labelW = dots(s.widthMm, s.dpi);
  const offX = dots(s.offsetXMm, s.dpi);
  const offY = dots(s.offsetYMm, s.dpi);
  const t = Math.max(1, dots(0.25, s.dpi));
  for (let i = 0; i < s.columns; i++) {
    const x = dots(s.sideMm + i * (s.widthMm + s.gapMm), s.dpi) + offX;
    // إطار على حافة الملصق تماماً
    ctx.fillRect(x, offY, labelW, t);
    ctx.fillRect(x, offY + H - t, labelW, t);
    ctx.fillRect(x, offY, t, H);
    ctx.fillRect(x + labelW - t, offY, t, H);
    // خطا المنتصف
    ctx.fillRect(x + Math.round(labelW / 2), offY + dots(3, s.dpi), t, H - dots(6, s.dpi));
    ctx.fillRect(x + dots(3, s.dpi), offY + Math.round(H / 2), labelW - dots(6, s.dpi), t);
    // مسطرة: علامة كل 1 مم على الحافة العليا
    for (let mm = 1; mm < s.widthMm; mm++) {
      const len = mm % 5 === 0 ? dots(2, s.dpi) : dots(1, s.dpi);
      ctx.fillRect(x + dots(mm, s.dpi), offY, 1, len);
    }
    ctx.font = `700 ${dots(2.4, s.dpi)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${s.widthMm}×${s.heightMm}`, x + labelW / 2, offY + dots(3.2, s.dpi));
    ctx.fillText(`#${i + 1}`, x + labelW / 2, offY + H - dots(5.5, s.dpi));
  }
  threshold(ctx, W, H);
  return { canvas, widthMm, heightMm: s.heightMm, warnings: { barcodeTooLong: false, barcodeThin: false, nameClipped: false, invalidBarcode: false } };
}

/** يقسّم قائمة الملصقات (بعد تكرار النسخ) إلى صفوف. */
export function toRows(items: { data: LabelData; copies: number }[], columns: number): (LabelData | null)[][] {
  const flat: LabelData[] = [];
  for (const it of items) for (let i = 0; i < Math.max(0, Math.min(999, Math.round(it.copies))); i++) flat.push(it.data);
  const rows: (LabelData | null)[][] = [];
  for (let i = 0; i < flat.length; i += columns) {
    const row: (LabelData | null)[] = flat.slice(i, i + columns);
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return rows;
}
