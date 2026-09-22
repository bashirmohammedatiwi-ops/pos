import { formatIqd, renderProductBarcode, THERMAL_DPI } from '@fot/shared';
import type { ProductDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';

export const LABEL_SIZES = [
  { id: '32x20', w: 32, h: 20, label: '32 × 20 مم' },
  { id: '35x25', w: 35, h: 25, label: '35 × 25 مم' },
  { id: '40x25', w: 40, h: 25, label: '40 × 25 مم' },
  { id: '40x30', w: 40, h: 30, label: '40 × 30 مم' },
  { id: '50x25', w: 50, h: 25, label: '50 × 25 مم' },
  { id: '50x30', w: 50, h: 30, label: '50 × 30 مم' },
  { id: '50x40', w: 50, h: 40, label: '50 × 40 مم' },
  { id: '58x40', w: 58, h: 40, label: '58 × 40 مم' },
  { id: '60x40', w: 60, h: 40, label: '60 × 40 مم' },
  { id: '70x40', w: 70, h: 40, label: '70 × 40 مم' },
  { id: '80x50', w: 80, h: 50, label: '80 × 50 مم' },
  { id: '80x60', w: 80, h: 60, label: '80 × 60 مم' },
  { id: 'custom', w: 40, h: 30, label: 'مخصص' },
] as const;

export type LabelSizeId = (typeof LABEL_SIZES)[number]['id'];

export type LabelFields = {
  shop: boolean;
  name: boolean;
  price: boolean;
  originalPrice: boolean;
  barcode: boolean;
  barcodeText: boolean;
  articleNum: boolean;
  offer: boolean;
  discount: boolean;
};

export const DEFAULT_LABEL_FIELDS: LabelFields = {
  shop: false,
  name: true,
  price: true,
  originalPrice: false,
  barcode: true,
  barcodeText: true,
  articleNum: false,
  offer: false,
  discount: false,
};

export const CONTENT_TEMPLATES: { id: string; label: string; hint: string; fields: LabelFields }[] = [
  { id: 'standard', label: 'قياسي', hint: 'اسم وسعر وباركود', fields: { ...DEFAULT_LABEL_FIELDS } },
  {
    id: 'price',
    label: 'سعر بارز',
    hint: 'يظهر السعر قبل العرض',
    fields: { ...DEFAULT_LABEL_FIELDS, originalPrice: true, barcodeText: false },
  },
  {
    id: 'namecode',
    label: 'اسم وباركود',
    hint: 'بدون سعر',
    fields: { ...DEFAULT_LABEL_FIELDS, price: false },
  },
  {
    id: 'barcode',
    label: 'باركود فقط',
    hint: 'للرفوف الصغيرة',
    fields: {
      shop: false, name: false, price: false, originalPrice: false,
      barcode: true, barcodeText: true, articleNum: false, offer: false, discount: false,
    },
  },
  {
    id: 'full',
    label: 'كامل',
    hint: 'كل الحقول المتاحة',
    fields: {
      shop: true, name: true, price: true, originalPrice: true,
      barcode: true, barcodeText: true, articleNum: true, offer: true, discount: true,
    },
  },
];

export type LayoutPreset = {
  id: string;
  label: string;
  columns: number;
  w: number;
  h: number;
  gap: number;
  sizeId: LabelSizeId;
};

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: '3x40x30', label: '3 أعمدة · 40×30', columns: 3, w: 40, h: 30, gap: 2, sizeId: '40x30' },
  { id: '3x40x25', label: '3 أعمدة · 40×25', columns: 3, w: 40, h: 25, gap: 2, sizeId: '40x25' },
  { id: '3x35x25', label: '3 أعمدة · 35×25', columns: 3, w: 35, h: 25, gap: 2, sizeId: '35x25' },
  { id: '3x32x20', label: '3 أعمدة · 32×20', columns: 3, w: 32, h: 20, gap: 2, sizeId: '32x20' },
  { id: '2x50x30', label: 'عمودان · 50×30', columns: 2, w: 50, h: 30, gap: 2, sizeId: '50x30' },
  { id: '1x50x30', label: 'عمود واحد · 50×30', columns: 1, w: 50, h: 30, gap: 0, sizeId: '50x30' },
];

export type LabelSettings = {
  sizeId: LabelSizeId;
  widthMm: number;
  heightMm: number;
  fields: LabelFields;
  align: 'center' | 'start';
  nameLines: 1 | 2 | 3;
  codeSize: 'sm' | 'md' | 'lg';
  insetMm: number;
  printerName: string;
  autoPrint: boolean;
  columns: number;
  gapMm: number;
  rowGapMm: number;
  marginMm: number;
  rowsPerPage: number;
};

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  sizeId: '40x30',
  widthMm: 40,
  heightMm: 30,
  fields: { ...DEFAULT_LABEL_FIELDS },
  align: 'center',
  nameLines: 2,
  codeSize: 'md',
  insetMm: 1.4,
  printerName: '',
  autoPrint: false,
  columns: 3,
  gapMm: 2,
  rowGapMm: 2,
  marginMm: 0,
  rowsPerPage: 1,
};

export type LabelItem = {
  name: string;
  barcode: string;
  articleNum: string;
  price: number;
  originalPrice: number;
  offerName: string;
  discountPercent: number;
  shopName: string;
  copies: number;
};

export type SheetMetrics = {
  columns: number;
  rows: number;
  gap: number;
  rowGap: number;
  margin: number;
  pageWidthMm: number;
  pageHeightMm: number;
  cellsPerPage: number;
};

export function productToLabelItem(p: ProductDto, copies: number, shopName = ''): LabelItem {
  return {
    name: fixEdariName(p.name) || p.barcode || p.num || `#${p.seq}`,
    barcode: (p.barcode || p.num || '').trim(),
    articleNum: (p.num || '').trim(),
    price: p.price,
    originalPrice: p.originalPrice,
    offerName: (p.offerName || '').trim(),
    discountPercent: p.discountPercent || 0,
    shopName: shopName.trim(),
    copies: Math.max(1, Math.min(999, Math.round(copies) || 1)),
  };
}

export function mmToThermalPx(mm: number) {
  return Math.max(1, Math.round(mm / 25.4 * THERMAL_DPI));
}

export function clampColumns(n: unknown) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(4, Math.max(1, v)) : 3;
}

export function sheetMetrics(settings: LabelSettings): SheetMetrics {
  const columns = clampColumns(settings.columns);
  const rows = Math.min(8, Math.max(1, Math.round(Number(settings.rowsPerPage)) || 1));
  const gap = Math.max(0, Math.min(10, Number(settings.gapMm) || 0));
  const rowGap = Math.max(0, Math.min(10, Number(settings.rowGapMm) || 0));
  const margin = Math.max(0, Math.min(8, Number(settings.marginMm) || 0));
  const pageWidthMm = margin * 2 + columns * settings.widthMm + (columns - 1) * gap;
  const pageHeightMm = margin * 2 + rows * settings.heightMm + (rows - 1) * rowGap;
  return {
    columns,
    rows,
    gap,
    rowGap,
    margin,
    pageWidthMm,
    pageHeightMm,
    cellsPerPage: columns * rows,
  };
}

export function expandLabelCopies(items: LabelItem[]): LabelItem[] {
  const out: LabelItem[] = [];
  for (const item of items) {
    const n = Math.max(0, Math.min(999, Math.round(item.copies) || 0));
    for (let i = 0; i < n; i++) out.push({ ...item, copies: 1 });
  }
  return out;
}

function chunk<T>(list: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages;
}

function padPage(cells: LabelItem[], size: number): Array<LabelItem | null> {
  const page: Array<LabelItem | null> = cells.slice();
  while (page.length < size) page.push(null);
  return page;
}

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function productBarcodeSvg(code: string, height: number, maxWidth: number) {
  try {
    return renderProductBarcode(code, {
      height,
      maxWidth,
      moduleWidth: 2,
      minModuleWidth: 1,
      quietModules: 3,
    }).svg;
  } catch {
    return '';
  }
}

function estimateTextWidth(text: string, fontPx: number) {
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 0x0600 && c <= 0x06FF) w += fontPx * 0.86;
    else if (c > 255) w += fontPx * 0.9;
    else if (ch === ' ') w += fontPx * 0.3;
    else if (/\d/.test(ch)) w += fontPx * 0.58;
    else w += fontPx * 0.54;
  }
  return w;
}

export function fitLabelFont(text: string, maxWidth: number, maxLines: number, maxPx: number, minPx: number) {
  if (!text || maxWidth <= 0) return minPx;
  const lines = Math.max(1, maxLines);
  for (let px = maxPx; px >= minPx; px--) {
    if (estimateTextWidth(text, px) <= maxWidth * lines) return px;
  }
  return minPx;
}

export function labelNameLooksLong(name: string) {
  return (name || '').trim().length > 22;
}

function codeFontPx(code: string, innerW: number, size: LabelSettings['codeSize'], compact: boolean) {
  const digits = Math.max(6, code.replace(/\s/g, '').length);
  const fitted = Math.floor(innerW / (digits * 0.62));
  const max = size === 'lg' ? 26 : size === 'sm' ? 15 : 21;
  const min = compact ? 12 : 14;
  return clamp(fitted, min, max);
}

function labelInner(item: LabelItem, settings: LabelSettings, widthPx: number, heightPx: number) {
  const compact = heightPx < mmToThermalPx(24);
  const insetMm = clamp(Number(settings.insetMm) || 1.4, 0.6, 3);
  const padX = Math.max(3, mmToThermalPx(insetMm));
  const padY = Math.max(3, mmToThermalPx(Math.max(0.7, insetMm * 0.8)));
  const innerW = Math.max(16, widthPx - padX * 2);
  const innerH = Math.max(16, heightPx - padY * 2);
  const f = settings.fields;
  const hasOfferPrice = item.originalPrice > item.price + 0.005;
  const wantedNameLines = settings.nameLines === 1 ? 1 : settings.nameLines === 3 ? 3 : 2;
  const textAlign = settings.align === 'start' ? 'right' : 'center';
  const align = settings.align === 'start' ? 'flex-end' : 'center';
  const stackGap = compact ? 1 : 2;
  const code = (item.barcode || item.articleNum).trim();
  const showBars = Boolean(f.barcode && code);
  const showHri = Boolean(f.barcodeText && code);
  const showName = Boolean(f.name && item.name);
  const showShop = Boolean(f.shop && item.shopName);
  const showOffer = Boolean(f.offer && item.offerName);
  const showDiscount = Boolean(f.discount && item.discountPercent > 0);
  const showPrice = Boolean(f.price || (f.originalPrice && hasOfferPrice));
  const showArticle = Boolean(f.articleNum && item.articleNum && item.articleNum !== item.barcode);

  const minBars = compact ? 18 : 24;
  const minHri = compact ? 13 : 15;
  let nameLines = wantedNameLines;
  let namePx = showName
    ? fitLabelFont(item.name, innerW, nameLines, clamp(Math.round(heightPx * 0.14), compact ? 12 : 14, 26), compact ? 10 : 11)
    : 12;
  let pricePx = clamp(Math.round(heightPx * (showBars ? 0.16 : 0.24)), compact ? 13 : 16, 40);
  let shopPx = clamp(Math.round(heightPx * 0.07), 9, 13);
  let metaPx = clamp(Math.round(heightPx * 0.068), 9, 13);
  let codePx = showHri ? codeFontPx(code, innerW, settings.codeSize, compact) : 14;

  const topCount = [showShop, showName, showOffer, showDiscount, showPrice, showArticle].filter(Boolean).length;
  const scanCount = (showBars ? 1 : 0) + (showHri ? 1 : 0);
  const gaps = Math.max(0, topCount + (scanCount ? 1 : 0) - 1) * stackGap;
  const scanPairGap = showBars && showHri ? 1 : 0;

  const nameHeight = (lines: number, px: number) => {
    if (!showName) return 0;
    const used = Math.min(lines, Math.max(1, Math.ceil(estimateTextWidth(item.name, px) / Math.max(1, innerW))));
    return Math.round(px * 1.12 * used);
  };

  const fixedH = (lines: number) =>
    (showShop ? Math.round(shopPx * 1.12) : 0)
    + nameHeight(lines, namePx)
    + (showOffer ? Math.round(metaPx * 1.15) : 0)
    + (showDiscount ? Math.round(metaPx * 1.15) : 0)
    + (showPrice ? Math.round(pricePx * 1.02) : 0)
    + (showArticle ? Math.round(metaPx * 1.1) : 0)
    + (showHri ? Math.round(codePx * 1.05) : 0)
    + gaps + scanPairGap;

  if (showBars && innerH - fixedH(nameLines) < minBars && nameLines > 1) {
    nameLines = 1;
    namePx = fitLabelFont(item.name, innerW, 1, namePx, compact ? 10 : 11);
  }
  if (showBars && innerH - fixedH(nameLines) < minBars) {
    namePx = Math.max(compact ? 10 : 11, namePx - 2);
    pricePx = Math.max(compact ? 12 : 14, pricePx - 3);
    codePx = Math.max(minHri, codePx - 2);
  }

  const leftover = innerH - fixedH(nameLines);
  const barcodeH = showBars ? Math.max(compact ? 14 : 16, leftover) : 0;

  const top: string[] = [];
  if (showShop) top.push(`<div class="l-shop">${esc(item.shopName)}</div>`);
  if (showName) top.push(`<div class="l-name">${esc(item.name)}</div>`);
  if (showOffer) top.push(`<div class="l-offer">${esc(item.offerName)}</div>`);
  if (showDiscount) top.push(`<div class="l-offer">خصم ${esc(String(Math.round(item.discountPercent)))}%</div>`);

  const priceBits: string[] = [];
  if (f.originalPrice && hasOfferPrice) priceBits.push(`<span class="l-was">${esc(formatIqd(item.originalPrice))}</span>`);
  if (f.price) priceBits.push(`<span class="l-now">${esc(formatIqd(item.price))}</span>`);
  if (priceBits.length) top.push(`<div class="l-price">${priceBits.join('')}</div>`);
  if (showArticle) top.push(`<div class="l-num" dir="ltr">${esc(item.articleNum)}</div>`);

  const scan: string[] = [];
  if (showBars) {
    const svg = productBarcodeSvg(code, Math.max(16, barcodeH), innerW);
    if (svg) scan.push(`<div class="l-bars">${svg}</div>`);
  }
  if (showHri) scan.push(`<div class="l-code" dir="ltr">${esc(code)}</div>`);

  const body = [
    top.length ? `<div class="l-top">${top.join('')}</div>` : '',
    scan.length ? `<div class="l-scan">${scan.join('')}</div>` : '',
  ].filter(Boolean).join('') || '<div class="l-name">ملصق فارغ</div>';

  const css = `
    .label{width:${widthPx}px;height:${heightPx}px;box-sizing:border-box;padding:${padY}px ${padX}px;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:${stackGap}px;overflow:hidden;min-width:0;min-height:0;background:#fff;color:#000;font-family:Tahoma,'Segoe UI',Arial,sans-serif}
    .l-top{display:flex;flex-direction:column;align-items:${align};gap:${stackGap}px;width:100%;min-width:0;flex:0 0 auto}
    .l-scan{margin-top:auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:1px;width:100%;min-width:0;min-height:0;flex:1 1 auto}
    .l-shop{font-size:${shopPx}px;font-weight:700;line-height:1.1;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:${textAlign}}
    .l-name{font-size:${namePx}px;font-weight:700;line-height:1.12;max-width:100%;min-width:0;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${nameLines};text-align:${textAlign}}
    .l-offer{font-size:${metaPx}px;font-weight:700;color:#111;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:${textAlign}}
    .l-price{display:flex;flex-wrap:nowrap;align-items:baseline;justify-content:${settings.align === 'start' ? 'flex-end' : 'center'};gap:3px;direction:ltr;max-width:100%;min-width:0}
    .l-now{font-size:${pricePx}px;font-weight:800;line-height:1;letter-spacing:-0.03em;white-space:nowrap}
    .l-was{font-size:${Math.max(9, metaPx)}px;font-weight:600;text-decoration:line-through;opacity:.7;white-space:nowrap}
    .l-bars{width:100%;max-width:100%;min-width:0;display:flex;justify-content:center;align-items:flex-end;line-height:0;overflow:hidden}
    .l-bars svg{display:block;width:100%;max-width:100%;height:${Math.max(16, barcodeH)}px}
    .l-code{font-size:${codePx}px;font-weight:800;line-height:1;letter-spacing:0.01em;font-variant-numeric:tabular-nums;font-family:Consolas,'Cascadia Mono','Courier New',Tahoma,monospace;text-align:center;white-space:nowrap;max-width:100%;overflow:hidden}
    .l-num{font-size:${Math.max(10, metaPx)}px;font-weight:700;line-height:1.1;opacity:.9;text-align:center;max-width:100%;overflow:hidden;white-space:nowrap}
  `;

  return { css, body };
}

function sheetCss(settings: LabelSettings, metrics: SheetMetrics, labelCss: string) {
  const pageW = mmToThermalPx(metrics.pageWidthMm);
  const pageH = mmToThermalPx(metrics.pageHeightMm);
  const labelW = mmToThermalPx(settings.widthMm);
  const labelH = mmToThermalPx(settings.heightMm);
  const gap = mmToThermalPx(metrics.gap);
  const rowGap = mmToThermalPx(metrics.rowGap);
  const margin = mmToThermalPx(metrics.margin);
  return `
    html,body{width:${pageW}px;height:${pageH}px;overflow:hidden}
    .sheet{width:${pageW}px;height:${pageH}px;box-sizing:border-box;padding:${margin}px;display:grid;grid-template-columns:repeat(${metrics.columns},${labelW}px);grid-template-rows:repeat(${metrics.rows},${labelH}px);column-gap:${gap}px;row-gap:${rowGap}px;direction:ltr;background:#fff;overflow:hidden}
    .cell{width:${labelW}px;height:${labelH}px;overflow:hidden;min-width:0;min-height:0;background:#fff}
    ${labelCss}
  `;
}

function sheetBodies(cells: Array<LabelItem | null>, settings: LabelSettings) {
  const widthPx = mmToThermalPx(settings.widthMm);
  const heightPx = mmToThermalPx(settings.heightMm);
  let css = '';
  const html = cells.map(item => {
    if (!item) return '<div class="cell"></div>';
    const built = labelInner(item, settings, widthPx, heightPx);
    css = built.css;
    return `<div class="cell"><div class="label">${built.body}</div></div>`;
  }).join('');
  return { css, html };
}

function wrapPrintSheet(innerCss: string, body: string, pageWidthMm: number, pageHeightMm: number) {
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><style>
    @page{size:${pageWidthMm}mm ${pageHeightMm}mm;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    ${innerCss}
  </style></head><body>${body}</body></html>`;
}

export function buildLabelPreview(item: LabelItem, settings: LabelSettings) {
  const widthPx = mmToThermalPx(settings.widthMm);
  const heightPx = mmToThermalPx(settings.heightMm);
  const { css, body } = labelInner(item, settings, widthPx, heightPx);
  const scoped = css
    .replace(/\.label\{/g, '.fot-lbl .label{')
    .replace(/\.l-/g, '.fot-lbl .l-');
  return {
    widthPx,
    heightPx,
    html: `<style>${scoped}</style><div class="fot-lbl"><div class="label">${body}</div></div>`,
  };
}

/** Preview one printer row (or page) so the shop sees the 3-across die-cut. */
export function buildSheetPreview(items: LabelItem[], settings: LabelSettings) {
  const metrics = sheetMetrics(settings);
  const sample = items.length ? items : [{
    name: 'اسم المادة',
    barcode: '1234567890128',
    articleNum: 'A-100',
    price: 12500,
    originalPrice: 15000,
    offerName: 'عرض',
    discountPercent: 17,
    shopName: 'المحل',
    copies: 1,
  }];
  const cells: Array<LabelItem | null> = [];
  for (let i = 0; i < metrics.cellsPerPage; i++) cells.push(sample[i % sample.length] ?? null);
  const { css, html } = sheetBodies(cells, settings);
  const inner = sheetCss(settings, metrics, css)
    .replace(/\.sheet\{/g, '.fot-sheet .sheet{')
    .replace(/\.cell\{/g, '.fot-sheet .cell{')
    .replace(/\.label\{/g, '.fot-sheet .label{')
    .replace(/\.l-/g, '.fot-sheet .l-');
  return {
    widthPx: mmToThermalPx(metrics.pageWidthMm),
    heightPx: mmToThermalPx(metrics.pageHeightMm),
    pageWidthMm: metrics.pageWidthMm,
    pageHeightMm: metrics.pageHeightMm,
    columns: metrics.columns,
    rows: metrics.rows,
    html: `<style>${inner}</style><div class="fot-sheet"><div class="sheet">${html}</div></div>`,
  };
}

export async function printProductLabels(items: LabelItem[], settings: LabelSettings) {
  const jobs = expandLabelCopies(items);
  if (!jobs.length) throw new Error('لا ملصقات للطباعة');
  const metrics = sheetMetrics(settings);
  const pages = chunk(jobs, metrics.cellsPerPage);
  const deviceName = settings.printerName.trim() || undefined;

  if (window.fotDesktop?.printHtml) {
    for (const page of pages) {
      const cells = padPage(page, metrics.cellsPerPage);
      const { css, html } = sheetBodies(cells, settings);
      const documentHtml = wrapPrintSheet(
        sheetCss(settings, metrics, css),
        `<div class="sheet">${html}</div>`,
        metrics.pageWidthMm,
        metrics.pageHeightMm,
      );
      const printed = await window.fotDesktop.printHtml(documentHtml, 1, deviceName, {
        paperWidthMm: metrics.pageWidthMm,
        paperHeightMm: metrics.pageHeightMm,
        kind: 'label',
      });
      if (printed && printed.ok === false) throw new Error(printed.message || 'تعذرت الطباعة');
    }
    return;
  }

  await printProductLabelsBrowser(pages, settings, metrics);
}

async function printProductLabelsBrowser(
  pages: LabelItem[][],
  settings: LabelSettings,
  metrics: SheetMetrics,
) {
  const sheets: string[] = [];
  let css = '';
  for (const page of pages) {
    const built = sheetBodies(padPage(page, metrics.cellsPerPage), settings);
    css = sheetCss(settings, metrics, built.css);
    sheets.push(`<div class="sheet">${built.html}</div>`);
  }
  const html = `<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>طباعة باركود</title><style>
    @page{size:${metrics.pageWidthMm}mm ${metrics.pageHeightMm}mm;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    ${css.replace(/(-?\d+(?:\.\d+)?)px/g, (_m, value: string) => {
      const mm = (Number(value) / THERMAL_DPI) * 25.4;
      return `${Math.round(mm * 1000) / 1000}mm`;
    })}
    .sheet{page-break-after:always;break-after:page}
    .sheet:last-child{page-break-after:auto;break-after:auto}
  </style></head><body>${sheets.join('')}</body></html>`;
  const w = window.open('', '_blank', 'width=720,height=420');
  if (!w) throw new Error('تم حظر نافذة الطباعة');
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
