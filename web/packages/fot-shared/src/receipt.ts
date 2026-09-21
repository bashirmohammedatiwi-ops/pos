import {
  CLASSIC_PART_IDS,
  CLASSIC_TABLE_COL_LABELS,
  isClassicBlockVisible,
  resolveClassicStyle,
  type ClassicDateFormat,
  type ClassicPartId,
  type ClassicTableCol,
  type ResolvedClassicStyle,
} from './classic-style';
import { formatIqd, formatNum } from './money';
import { renderReceiptBarcode } from './receipt-barcode';
import type {
  PrintSettingsDto,
  ReceiptPrintLineDto,
  ReceiptPrintPreviewDto,
  ReceiptTemplateId,
} from './print-types';

export const RECEIPT_TEMPLATES: {
  id: ReceiptTemplateId;
  title: string;
  hint: string;
}[] = [
  { id: 'classic', title: 'كلاسيكي', hint: 'جدول أصناف — تحكم بحجم وسماكة وترتيب كل جزء' },
  { id: 'compact', title: 'مضغوط', hint: 'أقصر وأكثف — يناسب ورق 58مم' },
  { id: 'branded', title: 'مميز', hint: 'شعار بارز في الأعلى وإجمالي داخل إطار' },
];

export function normalizeReceiptTemplate(value?: string | null): ReceiptTemplateId {
  const key = (value ?? '').trim().toLowerCase();
  if (key === 'compact') return 'compact';
  if (key === 'branded' || key === 'premium' || key === 'fancy') return 'branded';
  return 'classic';
}

/** Roll width the receipt is laid out for — also the page size the printer must be given. */
export function receiptPaperWidthMm(settings: PrintSettingsDto) {
  return settings.paperWidthMm === 58 ? 58 : 80;
}

/** Thermal heads are 203 dpi; layout in these pixels — never CSS-zoom — for sharp print. */
export const THERMAL_DPI = 203;
const CSS_DPI = 96;
const THERMAL_SCALE = THERMAL_DPI / CSS_DPI;

function thermalPx(cssPx: number) {
  return Math.max(1, Math.round(cssPx * THERMAL_SCALE));
}

/**
 * Converts native 203-DPI receipt CSS to normal browser 96-DPI CSS.
 * Electron/GDI needs the native pixels; browser preview/print must not treat
 * those same pixels as screen pixels or the receipt becomes 2.1× too wide.
 */
export function receiptHtmlForBrowser(html: string) {
  return html.replace(/<style>([\s\S]*?)<\/style>/i, (_block, css: string) => {
    const scaledCss = css.replace(/(-?\d+(?:\.\d+)?)px/g, (_match, value: string) => {
      const cssPx = Number(value) / THERMAL_SCALE;
      return `${Math.round(cssPx * 1000) / 1000}px`;
    });
    return `<style>${scaledCss}</style>`;
  });
}

/** Safe printable width inside the roll (mm). 80mm rolls rarely print edge-to-edge. */
export function receiptContentWidthMm(paperWidthMm: number) {
  return paperWidthMm <= 58 ? 50 : 70;
}

export function receiptThermalWidthPx(paperWidthMm: number) {
  return Math.round(receiptContentWidthMm(paperWidthMm) / 25.4 * THERMAL_DPI);
}

export function receiptLogoSrc(settings: PrintSettingsDto, apiBase = '') {
  if (!settings.showLogo || typeof settings.logoUrl !== 'string' || !settings.logoUrl) return '';
  if (settings.logoUrl.startsWith('http')) return settings.logoUrl;
  const base = apiBase.replace(/\/$/, '');
  const path = settings.logoUrl.startsWith('/') ? settings.logoUrl : `/${settings.logoUrl}`;
  return `${base}${path}`;
}

function escapeHtml(s: string | null | undefined) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function receiptNumberLabel(number: number) {
  return number > 0 ? String(number) : '—';
}

function tryReceiptBarcode(number: number, maxWidth: number) {
  if (number <= 0) return null;
  const label = receiptNumberLabel(number);
  try {
    return { ...renderReceiptBarcode(number, maxWidth), label };
  } catch {
    return { svg: '', width: 0, height: 0, label };
  }
}

function receiptBarcodeBlock(graphic: ReturnType<typeof tryReceiptBarcode>) {
  if (!graphic) return '';
  if (!graphic.svg) return `<div class="center barcode-num">${escapeHtml(graphic.label)}</div>`;
  return `
    <div class="center barcode">
      ${graphic.svg}
      <div class="barcode-num">${escapeHtml(graphic.label)}</div>
    </div>`;
}

export function receiptKindLabel(kind?: number) {
  if (kind === 1) return 'مرتجع';
  if (kind === 2) return 'هدية';
  return 'مبيعات';
}

function formatWhen(iso: string, format: ClassicDateFormat = 'datetime') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB');
  const time = d.toLocaleTimeString('en-GB', { hour12: false });
  if (format === 'date') return date;
  if (format === 'time') return time;
  if (format === 'split') return `${date}\n${time}`;
  return d.toLocaleString('en-GB', { hour12: false });
}

function receiptLines(data: ReceiptPrintPreviewDto) {
  return Array.isArray(data.lines) ? data.lines : [];
}

function lineListPrice(line: ReceiptPrintLineDto) {
  const original = Number(line.originalPrice);
  if (Number.isFinite(original) && original > 0) return original;
  const unit = Number(line.unitPrice);
  return Number.isFinite(unit) ? unit : 0;
}

function lineHasDiscount(line: ReceiptPrintLineDto) {
  return line.originalPrice > line.unitPrice && line.originalPrice > 0;
}

function lineDiscountAmount(line: ReceiptPrintLineDto) {
  if (!lineHasDiscount(line)) return 0;
  return (line.originalPrice - line.unitPrice) * Math.abs(line.quantity);
}

function totalLineDiscounts(lines: ReceiptPrintLineDto[]) {
  return lines.reduce((sum, line) => sum + lineDiscountAmount(line), 0);
}

function grossLineTotal(line: ReceiptPrintLineDto) {
  return lineListPrice(line) * Math.abs(Number(line.quantity) || 0);
}

function netLineTotal(line: ReceiptPrintLineDto) {
  return Math.max(0, grossLineTotal(line) - lineDiscountAmount(line));
}

const PRINT_TABLE_COLS: ClassicTableCol[] = ['product', 'qty', 'unit', 'disc', 'total'];
const PRINT_TABLE_FR: Record<ClassicTableCol, number> = {
  product: 2.1,
  qty: 0.72,
  unit: 0.9,
  disc: 0.78,
  total: 0.95,
};

function classicColPercents(style: ResolvedClassicStyle) {
  const widths = PRINT_TABLE_COLS.map(col => {
    const n = Number(style.cols?.[col]);
    return Number.isFinite(n) && n > 0 ? n : PRINT_TABLE_FR[col];
  });
  const sum = widths.reduce((a, b) => a + b, 0) || 1;
  return PRINT_TABLE_COLS.map((_, i) => `${((widths[i] / sum) * 100).toFixed(2)}%`);
}

function classicLineCell(col: ClassicTableCol, line: ReceiptPrintLineDto) {
  if (col === 'product') {
    return `<td class="classic-product r-tableProduct">${escapeHtml(line.name)}</td>`;
  }
  if (col === 'qty') return `<td class="classic-num ltr r-tableValues">${formatNum(line.quantity)}</td>`;
  if (col === 'unit') return `<td class="classic-num ltr r-tableValues">${formatNum(lineListPrice(line))}</td>`;
  if (col === 'disc') {
    const disc = lineDiscountAmount(line);
    return `<td class="classic-num ltr r-tableValues">${disc > 0 ? formatNum(disc) : '—'}</td>`;
  }
  return `<td class="classic-num classic-total ltr r-tableValues">${formatNum(netLineTotal(line))}</td>`;
}

function classicItemTable(data: ReceiptPrintPreviewDto, settings: PrintSettingsDto, style: ResolvedClassicStyle) {
  const cols = PRINT_TABLE_COLS;
  const colPct = classicColPercents(style);
  const lines = receiptLines(data);
  const rows = lines.map(line => {
    const meta = [
      settings.showArticleNumber && line.articleNumber ? escapeHtml(line.articleNumber) : '',
      settings.showBarcode && line.barcode ? escapeHtml(line.barcode) : '',
    ].filter(Boolean).join(' · ');

    return `
      <tr class="classic-item${meta ? ' classic-item-has-meta' : ''}">
        ${cols.map(col => classicLineCell(col, line)).join('')}
      </tr>
      ${meta ? `<tr class="classic-meta-row"><td class="classic-meta ltr" colspan="${cols.length}">${meta}</td></tr>` : ''}`;
  }).join('');

  const head = style.showTableHead !== false
    ? `<tr>
    ${cols.map(col => `<th class="${col === 'product' ? 'classic-h-name' : 'classic-h-num'}">${CLASSIC_TABLE_COL_LABELS[col]}</th>`).join('')}
  </tr>`
    : '';

  const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const totalDisc = lines.reduce((sum, line) => sum + lineDiscountAmount(line), 0);
  const totalNet = lines.reduce((sum, line) => sum + netLineTotal(line), 0);
  const foot = `<tr class="classic-qty-foot">
    ${cols.map(col => {
      if (col === 'qty') return `<td class="classic-num ltr">${formatNum(totalQty)}</td>`;
      if (col === 'disc') return `<td class="classic-num ltr">${totalDisc > 0 ? formatNum(totalDisc) : ''}</td>`;
      if (col === 'total') return `<td class="classic-num classic-total ltr">${formatNum(totalNet)}</td>`;
      return '<td></td>';
    }).join('')}
  </tr>`;

  return `
    <table class="classic-table">
      <colgroup>${colPct.map(w => `<col style="width:${w}">`).join('')}</colgroup>
      <thead class="r-tableHead">${head}</thead>
      <tbody class="r-tableValues">${rows}</tbody>
      <tfoot class="r-tableValues">${foot}</tfoot>
    </table>`;
}

function itemBlocks(data: ReceiptPrintPreviewDto, settings: PrintSettingsDto, template: ReceiptTemplateId, style?: ResolvedClassicStyle) {
  if (settings.showItemTable === false) return '';
  if (template === 'classic') return classicItemTable(data, settings, style ?? resolveClassicStyle(settings));
  const head = template === 'compact'
    ? ''
    : `<div class="line head"><span>الصنف</span><span class="amt">المبلغ</span></div>`;
  const rows = receiptLines(data).map(line => {
    const article = settings.showArticleNumber && line.articleNumber
      ? `<div class="muted meta">${escapeHtml(line.articleNumber)}</div>`
      : '';
    const barcode = settings.showBarcode && line.barcode
      ? `<div class="muted meta ltr">${escapeHtml(line.barcode)}</div>`
      : '';
    return `
      <div class="item">
        <div class="name">${escapeHtml(line.name)}</div>
        ${article}${barcode}
        <div class="line">
          <span class="qty ltr">${formatNum(line.quantity)} × ${formatNum(lineListPrice(line))}</span>
          <strong class="amt ltr">${formatNum(netLineTotal(line))}</strong>
        </div>
      </div>`;
  }).join('');
  return `${head}${rows}`;
}

function totalsBlock(data: ReceiptPrintPreviewDto, settings: PrintSettingsDto, classic?: ResolvedClassicStyle) {
  const lines = receiptLines(data);
  const combinedDisc = totalLineDiscounts(lines) + Math.max(0, data.userDiscount);
  const grossTotal = lines.reduce((sum, line) => sum + grossLineTotal(line), 0);
  const paymentRows = settings.showPaymentLines !== false
    ? `<div class="row"><span>الدفعة</span><span class="amt ltr">${formatIqd(data.paid)}</span></div>
       <div class="row"><span>المبلغ المرتجع</span><span class="amt ltr">${formatIqd(data.change)}</span></div>`
    : '';

  const body = `
    <div class="row"><span>الإجمالي</span><span class="amt ltr">${formatIqd(grossTotal)}</span></div>
    <div class="row"><span>الخصم</span><span class="amt ltr">${combinedDisc > 0 ? `-${formatIqd(combinedDisc)}` : formatIqd(0)}</span></div>
    <div class="row net-pay"><span>الصافي للدفع</span><span class="amt ltr">${formatIqd(data.total)}</span></div>
    ${paymentRows}`;
  return classic ? `<div class="r-totals">${body}</div>` : `<div class="totals">${body}</div>`;
}

function sharedCss(
  contentPx: number,
  padPx: number,
  fontSize: number,
  fontWeight: number,
  logoH: number,
  barcodeW = 0,
  barcodeH = 0,
) {
  const u = thermalPx;
  const lighter = Math.max(300, fontWeight - 100);
  const stronger = Math.min(700, fontWeight + 100);
  return `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${contentPx}px; max-width: ${contentPx}px; margin: 0; padding: 0; overflow: hidden; }
  body { background: #fff; color: #000; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact;
         -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  .ticket { width: ${contentPx}px; max-width: ${contentPx}px; padding: ${padPx}px ${padPx}px ${padPx + u(6)}px;
            font-size: ${fontSize}px; line-height: 1.35; overflow: hidden; font-weight: ${fontWeight}; }
  .center { text-align: center; }
  .muted { color: #000; font-size: ${Math.max(u(9), fontSize - u(2))}px; font-weight: ${lighter}; }
  .ltr { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  .line, .row { display: flex; justify-content: space-between; align-items: baseline; gap: ${u(8)}px;
                width: 100%; min-width: 0; }
  .line > *, .row > * { min-width: 0; }
  .qty { flex: 1 1 auto; }
  .amt { flex: 0 0 auto; white-space: nowrap; text-align: left; }
  .name { font-weight: ${stronger}; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;
          unicode-bidi: plaintext; line-height: 1.35; }
  img.logo { display: block; margin: 0 auto; max-width: 100%; max-height: ${logoH}px; object-fit: contain; }
  .barcode { margin: ${u(10)}px 0 ${u(4)}px; padding: ${u(6)}px 0 ${u(2)}px; background: #fff; }
  .barcode svg { display: block; width: ${barcodeW || 0}px; height: ${barcodeH || 0}px; max-width: none;
                 margin: 0 auto; shape-rendering: crispEdges; image-rendering: pixelated; }
  .barcode-num { font-size: ${u(10)}px; font-weight: ${stronger}; letter-spacing: ${u(1)}px; margin-top: ${u(2)}px;
                 direction: ltr; unicode-bidi: isolate; }
  .kind { font-size: ${fontSize}px; font-weight: ${stronger}; margin: ${u(2)}px 0 ${u(1)}px;
          letter-spacing: 0.3px; }
  .totals, .r-totals { font-size: ${fontSize}px; font-weight: ${fontWeight}; }
  .totals .row, .r-totals .row { font-size: inherit; font-weight: inherit; margin: ${u(2)}px 0; }
  .net-pay { border: ${u(2)}px solid #000; padding: ${u(6)}px ${u(7)}px; margin: ${u(6)}px 0; }
  .total { font-size: ${fontSize}px; font-weight: ${fontWeight}; margin: ${u(3)}px 0; }
  .dash { border-top: ${u(1)}px dashed #000; margin: ${u(6)}px 0; }
  .dbl { border-top: ${u(2)}px solid #000; margin: ${u(8)}px 0 ${u(6)}px; }
  .line.head { font-size: ${Math.max(u(9), fontSize - u(1))}px; color: #000; font-weight: ${stronger};
               padding-bottom: ${u(3)}px; border-bottom: ${u(1)}px solid #000; margin-bottom: ${u(4)}px; }
  .item { padding: ${u(6)}px 0; border-bottom: ${u(1)}px dotted #000; }
  .item:last-child { border-bottom: 0; }
  .meta { margin: ${u(2)}px 0; overflow-wrap: break-word; }
  .foot { margin-top: ${u(6)}px; white-space: pre-wrap; }
  .classic-table { width: 100%; border-collapse: collapse; table-layout: fixed;
                   border-top: ${u(2)}px solid #000; border-bottom: ${u(2)}px solid #000; }
  .classic-table th, .classic-table td { vertical-align: top; overflow-wrap: anywhere; }
  .classic-table thead th { border-bottom: ${u(1)}px solid #000; }
  .classic-h-name { text-align: right; white-space: nowrap; }
  .classic-h-num { text-align: center; white-space: nowrap; }
  .classic-product { line-height: 1.2; text-align: right; }
  .classic-num { text-align: center; white-space: nowrap; }
  .classic-total { font-weight: ${stronger}; }
  .classic-item:not(.classic-item-has-meta) td,
  .classic-meta-row td { border-bottom: ${u(1)}px solid #000; }
  .classic-meta-row td { padding-top: 0; }
  .classic-table tbody tr:last-child td { border-bottom: 0; }
  .classic-qty-foot td { border-top: ${u(1)}px solid #000; font-weight: ${stronger}; }
`;
}

function templateCss(template: ReceiptTemplateId, fontSize: number, fontWeight: number) {
  const u = thermalPx;
  const stronger = Math.min(700, fontWeight + 100);
  if (template === 'compact') {
    return `
  .store { font-size: ${fontSize + u(2)}px; font-weight: ${stronger}; margin: ${u(2)}px 0 0; }
  .item { padding: ${u(5)}px 0; }
  .item .name { font-size: ${fontSize}px; }
  .logo-wrap { margin-bottom: ${u(4)}px; }
  .total { font-size: ${fontSize}px; }
  .dash { margin: ${u(5)}px 0; }
`;
  }
  if (template === 'branded') {
    return `
  .head { border: ${u(2)}px solid #000; padding: ${u(8)}px ${u(6)}px ${u(7)}px; margin-bottom: ${u(8)}px; }
  .logo-wrap { margin-bottom: ${u(6)}px; }
  .store { font-size: ${fontSize + u(3)}px; font-weight: ${stronger}; }
  .invoice { font-size: ${fontSize + u(1)}px; font-weight: ${stronger}; margin: ${u(2)}px 0; }
  .total-box { margin-top: ${u(6)}px; }
  .item { padding: ${u(6)}px 0; }
`;
  }
  return `
  .logo-wrap { margin-bottom: ${u(6)}px; }
  .store { font-size: ${fontSize + u(4)}px; font-weight: ${stronger}; }
  .invoice { font-size: ${fontSize + u(2)}px; font-weight: ${stronger}; }
`;
}

function classicPartCss(style: ResolvedClassicStyle) {
  const u = thermalPx;
  const parts = CLASSIC_PART_IDS.map(id => {
    const part = style.parts[id];
    if (!part) return '';
    const size = Number(part.size);
    const weight = Number(part.weight);
    const align = part.align === 'left' || part.align === 'right' ? part.align : 'center';
    if (!Number.isFinite(size) || !Number.isFinite(weight)) return '';
    return `.r-${id} { font-size: ${u(size)}px; font-weight: ${weight}; text-align: ${align}; }`;
  }).join('\n');
  return `${parts}\n${classicTableCss(style)}`;
}

function classicTableCss(style: ResolvedClassicStyle) {
  const u = thermalPx;
  const head = style.parts.tableHead;
  const product = style.parts.tableProduct;
  const values = style.parts.tableValues;
  const meta = style.parts.tableDisc;
  const base = Math.min(Number(product?.size) || 8, Number(values?.size) || 8);
  const padY = Math.max(u(1), Math.round(u(base) * 0.18));
  const padX = Math.max(1, Math.round(padY * 0.65));
  return `
  .classic-table th, .classic-table td { padding: ${padY}px ${padX}px; }
  .classic-table thead th {
    font-size: ${u(Number(head?.size) || 7)}px;
    font-weight: ${Number(head?.weight) || 600};
  }
  .classic-table td.classic-product {
    font-size: ${u(Number(product?.size) || 8)}px;
    font-weight: ${Number(product?.weight) || 400};
  }
  .classic-table td.classic-num,
  .classic-table tfoot td {
    font-size: ${u(Number(values?.size) || 8)}px;
    font-weight: ${Number(values?.weight) || 400};
  }
  .classic-table .classic-meta {
    font-size: ${u(Number(meta?.size) || 6)}px;
    font-weight: ${Number(meta?.weight) || 400};
  }
  .classic-qty-foot td { padding: ${padY + 1}px ${padX}px; }
`;
}

function wrapClassic(id: ClassicPartId, inner: string, extra = '') {
  return `<div class="r-${id}${extra ? ` ${extra}` : ''}">${inner}</div>`;
}

function renderClassicBlocks(
  data: ReceiptPrintPreviewDto,
  settings: PrintSettingsDto,
  style: ResolvedClassicStyle,
  logo: string,
  store: string,
  desc: string,
  receiptLabel: string,
  barcodeWidth: number,
) {
  const when = formatWhen(data.printedAt, style.dateFormat);
  const hidden = (id: Parameters<typeof isClassicBlockVisible>[1]) => !isClassicBlockVisible(style, id);

  return style.order.map(id => {
    if (hidden(id)) return '';
    if (id === 'sepA' || id === 'sepB' || id === 'sepC') return '<div class="dash"></div>';
    if (id === 'logo') {
      return logo && settings.showLogo
        ? `<div class="logo-wrap center"><img class="logo" src="${logo}" alt=""/></div>`
        : '';
    }
    if (id === 'title') return wrapClassic('title', store, 'store');
    if (id === 'subtitle') return desc ? wrapClassic('subtitle', desc, 'muted') : '';
    if (id === 'invoice') {
      return wrapClassic('invoice', `فاتورة <span class="ltr">#${escapeHtml(receiptLabel)}</span>`, 'invoice');
    }
    if (id === 'kind') return wrapClassic('kind', escapeHtml(receiptKindLabel(data.kind)), 'kind');
    if (id === 'datetime') {
      if (!when) return '';
      const lines = when.split('\n').map(line => `<div class="ltr">${escapeHtml(line)}</div>`).join('');
      return wrapClassic('datetime', lines, 'meta');
    }
    if (id === 'pos') {
      return data.posLabel ? wrapClassic('pos', escapeHtml(data.posLabel), 'meta') : '';
    }
    if (id === 'cashier') {
      return settings.showCashier && data.cashierName
        ? wrapClassic('cashier', `${escapeHtml(style.cashierLabel)}: ${escapeHtml(data.cashierName)}`, 'meta')
        : '';
    }
    if (id === 'salesman') {
      return settings.showSalesman && data.salesmanName
        ? wrapClassic('salesman', `${escapeHtml(style.salesmanLabel)}: ${escapeHtml(data.salesmanName)}`, 'meta')
        : '';
    }
    if (id === 'cashbox') {
      return settings.showCashBox !== false && data.cashBoxName
        ? wrapClassic('cashbox', `${escapeHtml(style.cashboxLabel)}: ${escapeHtml(data.cashBoxName)}`, 'meta')
        : '';
    }
    if (id === 'table') return itemBlocks(data, settings, 'classic', style);
    if (id === 'totals') return totalsBlock(data, settings, style);
    if (id === 'footer') {
      return settings.footerText
        ? wrapClassic('footer', escapeHtml(settings.footerText), 'muted foot')
        : '';
    }
    if (id === 'qr') {
      return settings.showQrCode && settings.qrCodeText
        ? `<div class="center muted">[QR: ${escapeHtml(settings.qrCodeText)}]</div>`
        : '';
    }
    if (id === 'barcode') return receiptBarcodeBlock(tryReceiptBarcode(data.receiptNumber, barcodeWidth));
    return '';
  }).filter(Boolean).join('\n');
}

export function receiptHtml(data: ReceiptPrintPreviewDto, settings: PrintSettingsDto, apiBase = '') {
  try {
    return buildReceiptHtml(data, settings, apiBase);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'تعذر إنشاء الفاتورة';
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="font:13px sans-serif;padding:16px;color:#b91c1c">${escapeHtml(message)}</body></html>`;
  }
}

function buildReceiptHtml(data: ReceiptPrintPreviewDto, settings: PrintSettingsDto, apiBase = '') {
  const template = normalizeReceiptTemplate(settings.receiptTemplate);
  const widthMm = receiptPaperWidthMm(settings);
  const contentPx = receiptThermalWidthPx(widthMm);
  const padPx = Math.round(3 / 25.4 * THERMAL_DPI);
  // Settings use familiar 96-DPI CSS sizes. Convert them to native 203-DPI
  // pixels so the captured bitmap prints at the intended physical size.
  const requestedFont = Number(settings.fontSize);
  const logicalFont = Math.min(22, Math.max(9, Number.isFinite(requestedFont) ? requestedFont : 13));
  const fontSize = thermalPx(logicalFont);
  const requestedWeight = Number(settings.fontWeight);
  const fontWeight = Math.min(700, Math.max(300, Number.isFinite(requestedWeight) ? requestedWeight : 400));
  const requestedLogoH = Number(settings.logoMaxHeightPx);
  const logicalLogoH = Number.isFinite(requestedLogoH) && requestedLogoH > 0
    ? requestedLogoH
    : template === 'compact' ? 48 : template === 'branded' ? 88 : 72;
  const logoH = thermalPx(logicalLogoH);
  const logo = receiptLogoSrc(settings, apiBase);
  const receiptLabel = receiptNumberLabel(data.receiptNumber);
  const store = escapeHtml(settings.headerText || 'FOT POS');
  const desc = settings.headerDescription ? escapeHtml(settings.headerDescription) : '';
  const classic = template === 'classic' ? resolveClassicStyle(settings) : null;
  const barcodeMax = contentPx - padPx * 2;
  const barcode = tryReceiptBarcode(data.receiptNumber, barcodeMax);

  let ticketInner: string;
  let extraCss = '';
  if (classic) {
    extraCss = classicPartCss(classic);
    ticketInner = renderClassicBlocks(data, settings, classic, logo, store, desc, receiptLabel, barcodeMax);
  } else {
    const when = formatWhen(data.printedAt);
    const logoBlock = logo
      ? `<div class="logo-wrap center"><img class="logo" src="${logo}" alt=""/></div>`
      : '';
    const titleBlock = `
    <div class="center store">${store}</div>
    ${desc ? `<div class="center muted">${desc}</div>` : ''}`;
    const header = template === 'branded'
      ? `<header class="head">${logoBlock}${titleBlock}</header>`
      : `${logoBlock}${titleBlock}`;
    const invoiceLine = `<div class="center invoice">فاتورة <span class="ltr">#${escapeHtml(receiptLabel)}</span></div>`;
    const meta = `
    ${invoiceLine}
    <div class="center kind">${escapeHtml(receiptKindLabel(data.kind))}</div>
    ${when ? `<div class="center muted meta ltr">${escapeHtml(when)}</div>` : ''}
    ${data.posLabel ? `<div class="center muted meta">${escapeHtml(data.posLabel)}</div>` : ''}
    ${settings.showCashier && data.cashierName ? `<div class="muted meta">كاشير: ${escapeHtml(data.cashierName)}</div>` : ''}
    ${settings.showSalesman && data.salesmanName ? `<div class="muted meta">بائع: ${escapeHtml(data.salesmanName)}</div>` : ''}
    ${settings.showCashBox !== false && data.cashBoxName ? `<div class="muted meta">الصندوق: ${escapeHtml(data.cashBoxName)}</div>` : ''}`;
    const totals = totalsBlock(data, settings);
    const sep = template === 'branded' ? '<div class="dbl"></div>' : '<div class="dash"></div>';
    ticketInner = `
  ${header}
  ${sep}
  ${meta}
  ${sep}
  ${itemBlocks(data, settings, template)}
  ${sep}
  ${totals}
  ${settings.footerText ? `${sep}<div class="center muted foot">${escapeHtml(settings.footerText)}</div>` : ''}
  ${settings.showQrCode && settings.qrCodeText ? `<div class="center muted">[QR: ${escapeHtml(settings.qrCodeText)}]</div>` : ''}
  ${receiptBarcodeBlock(barcode)}`;
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>فاتورة ${escapeHtml(receiptLabel)}</title>
<style>
${sharedCss(contentPx, padPx, fontSize, fontWeight, logoH, barcode?.width ?? 0, barcode?.height ?? 0)}
${templateCss(template, fontSize, fontWeight)}
${extraCss}
</style>
</head>
<body>
<div class="ticket t-${template}">
  ${ticketInner}
</div>
</body>
</html>`;
}
