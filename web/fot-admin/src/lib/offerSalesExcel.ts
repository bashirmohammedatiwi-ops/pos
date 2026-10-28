import { formatNum } from '@/api/client';
import type { OfferSalesDailyRowDto, OfferSalesProductDayRowDto, OfferSalesProductRowDto, OfferSalesReportDto } from '@/api/types';
import { offerTypeLabel } from '@/lib/offers';
import { fixEdariName } from '@/lib/text';
import {
  downloadXlsxFile,
  type XlsxCellInput,
  type XlsxImageInput,
  type XlsxRowInput,
  type XlsxSheetInput,
} from './xlsxBuilder';

function c(
  value: string | number,
  style: string,
  type?: 'String' | 'Number',
  opts?: { mergeAcross?: number; mergeDown?: number },
): XlsxCellInput {
  return {
    value,
    style,
    type: type ?? (typeof value === 'number' ? 'Number' : 'String'),
    mergeAcross: opts?.mergeAcross,
    mergeDown: opts?.mergeDown,
  };
}

function r(cells: XlsxCellInput[], height?: number): XlsxRowInput {
  return { cells, height };
}

function blank(height = 10): XlsxRowInput {
  return { cells: [], height };
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD clean date
}

function shortDayMonth(value?: string | null) {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function weekday(value?: string | null) {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-IQ', { weekday: 'long' });
}

function soldDatesLabel(p: OfferSalesProductRowDto): string {
  const f = p.firstSoldDate ? shortDate(p.firstSoldDate) : null;
  const l = p.lastSoldDate ? shortDate(p.lastSoldDate) : null;
  const days = p.activeDaysCount ?? 0;
  if (!f && !l) return '—';
  if (f === l || !l) return f ?? '—';
  return days > 1 ? `${f} ← ${l} (${days} أيام)` : `${f} ← ${l}`;
}

function visualShareBar(ratio0to1: number, maxBlocks = 14): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio0to1) ? ratio0to1 : 0));
  const filled = Math.max(clamped > 0 ? 1 : 0, Math.round(clamped * maxBlocks));
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, maxBlocks - filled));
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  try {
    const b64 = dataUrl.slice(comma + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Renders a high-resolution visual dashboard banner PNG (Daily Sales Trend Curve + Top Products Horizontal Bars)
 * using HTML5 Canvas so it embeds natively into the Excel worksheet via DrawingML.
 */
function renderOfferChartsPng(
  offerName: string,
  periodLabel: string,
  daily: OfferSalesDailyRowDto[],
  products: OfferSalesProductRowDto[],
): Uint8Array | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const W = 1360;
  const H = 430;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const font = (weight: string | number, size: number) => `${weight} ${size}px Tahoma, "Segoe UI", Arial, sans-serif`;

  // Background
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, W, H);

  // Outer border
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Top Header Strip
  const gradHeader = ctx.createLinearGradient(0, 0, W, 0);
  gradHeader.addColorStop(0, '#312E81');
  gradHeader.addColorStop(0.5, '#4338CA');
  gradHeader.addColorStop(1, '#6D28D9');
  ctx.fillStyle = gradHeader;
  ctx.fillRect(2, 2, W - 4, 52);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = font('bold', 19);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`لوحة المؤشرات والرسوم البيانية — ${offerName}`, W - 24, 28);

  ctx.fillStyle = '#E0E7FF';
  ctx.font = font('bold', 14);
  ctx.textAlign = 'left';
  ctx.fillText(periodLabel, 24, 28);

  // ── Left Card: Top Products Horizontal Bar Chart ──
  const leftCard = { x: 20, y: 68, w: 620, h: 344 };
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(leftCard.x, leftCard.y, leftCard.w, leftCard.h);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(leftCard.x, leftCard.y, leftCard.w, leftCard.h);

  ctx.fillStyle = '#1E1B4B';
  ctx.font = font('bold', 16);
  ctx.textAlign = 'right';
  ctx.fillText('أعلى المواد مبيعاً (صافي المبيعات والكمية)', leftCard.x + leftCard.w - 18, leftCard.y + 26);

  const topProds = products.slice(0, 7);
  const maxProdAmount = Math.max(1, ...topProds.map(p => p.amount));
  const barAreaTop = leftCard.y + 52;
  const rowH = 40;

  topProds.forEach((p, idx) => {
    const y = barAreaTop + idx * rowH;
    const rawName = fixEdariName(p.name ?? '') || p.barcode || `#${p.articleSeq}`;
    const label = rawName.length > 34 ? `${rawName.slice(0, 33)}…` : rawName;
    const ratio = Math.max(0.04, Math.min(1, p.amount / maxProdAmount));
    const maxBarW = 195;
    const barW = Math.round(ratio * maxBarW);

    // Product label on the right side of the card (260px dedicated width)
    ctx.fillStyle = '#0F172A';
    ctx.font = font('bold', 11.5);
    ctx.textAlign = 'right';
    ctx.fillText(`${idx + 1}. ${label}`, leftCard.x + leftCard.w - 14, y + 14, 255);

    // Bar track in the middle
    const barRight = leftCard.x + leftCard.w - 278;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(barRight - maxBarW, y + 4, maxBarW, 20);

    // Filled bar (growing RTL from barRight leftward)
    const barGrad = ctx.createLinearGradient(barRight - barW, y, barRight, y);
    barGrad.addColorStop(0, '#6366F1');
    barGrad.addColorStop(1, '#4338CA');
    ctx.fillStyle = barGrad;
    ctx.fillRect(barRight - barW, y + 4, barW, 20);

    // Value label on the left
    ctx.fillStyle = '#312E81';
    ctx.font = font('bold', 11.5);
    ctx.textAlign = 'left';
    ctx.fillText(`${formatNum(Math.round(p.amount))} د.ع (${formatNum(p.quantity)})`, leftCard.x + 12, y + 14, 130);
  });

  // ── Right Card: Daily Sales Curve (Smooth Area + Line + Points) ──
  const rightCard = { x: 660, y: 68, w: 680, h: 344 };
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(rightCard.x, rightCard.y, rightCard.w, rightCard.h);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rightCard.x, rightCard.y, rightCard.w, rightCard.h);

  ctx.fillStyle = '#1E1B4B';
  ctx.font = font('bold', 16);
  ctx.textAlign = 'right';
  ctx.fillText('منحنى المبيعات اليومية خلال فترة العرض', rightCard.x + rightCard.w - 18, rightCard.y + 26);

  const plot = {
    x: rightCard.x + 74,
    y: rightCard.y + 58,
    w: rightCard.w - 104,
    h: rightCard.h - 108,
  };

  const ptsData = daily.length > 0 ? daily : [{ date: '', amount: 0, quantity: 0, receiptCount: 0 }];
  const maxDayVal = Math.max(1, ...ptsData.map(d => d.amount));

  // Horizontal grid lines + Y-axis labels
  const gridSteps = 4;
  for (let g = 0; g <= gridSteps; g++) {
    const gy = plot.y + (plot.h * g) / gridSteps;
    const val = Math.round(maxDayVal * (1 - g / gridSteps));
    ctx.strokeStyle = g === gridSteps ? '#94A3B8' : '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, gy);
    ctx.lineTo(plot.x + plot.w, gy);
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = font('normal', 11);
    ctx.textAlign = 'right';
    ctx.fillText(formatNum(val), plot.x - 8, gy);
  }

  // Compute coordinates for daily points
  const coords = ptsData.map((d, i) => {
    const x =
      ptsData.length === 1
        ? plot.x + plot.w / 2
        : plot.x + (i / (ptsData.length - 1)) * plot.w;
    const y = plot.y + plot.h - (Math.max(0, d.amount) / maxDayVal) * (plot.h - 18);
    return { x, y, d };
  });

  // Area fill under the curve
  if (coords.length >= 2) {
    const areaGrad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
    areaGrad.addColorStop(0, 'rgba(79, 70, 229, 0.34)');
    areaGrad.addColorStop(1, 'rgba(79, 70, 229, 0.02)');
    ctx.fillStyle = areaGrad;
    ctx.beginPath();
    ctx.moveTo(coords[0].x, plot.y + plot.h);
    coords.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(coords[coords.length - 1].x, plot.y + plot.h);
    ctx.closePath();
    ctx.fill();

    // Curve stroke
    ctx.strokeStyle = '#4F46E5';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    coords.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  } else if (coords.length === 1) {
    // Single day bar + point
    const pt = coords[0];
    const bw = 56;
    const bh = Math.max(6, plot.y + plot.h - pt.y);
    ctx.fillStyle = 'rgba(79, 70, 229, 0.25)';
    ctx.fillRect(pt.x - bw / 2, pt.y, bw, bh);
  }

  // Draw data points, value badges, and X-axis date labels
  const labelStep = Math.max(1, Math.ceil(coords.length / 10));
  coords.forEach((pt, idx) => {
    // Outer white ring + inner indigo circle
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4338CA';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (idx % labelStep === 0 || idx === coords.length - 1) {
      // Value above point
      if (pt.d.amount > 0) {
        ctx.fillStyle = '#1E1B4B';
        ctx.font = font('bold', 11);
        ctx.textAlign = 'center';
        ctx.fillText(formatNum(Math.round(pt.d.amount)), pt.x, Math.max(plot.y - 6, pt.y - 12));
      }

      // Date label on X-axis
      ctx.fillStyle = '#334155';
      ctx.font = font('bold', 11);
      ctx.textAlign = 'center';
      ctx.fillText(shortDayMonth(pt.d.date), pt.x, plot.y + plot.h + 18);
    }
  });

  return dataUrlToBytes(canvas.toDataURL('image/png'));
}

export function downloadOfferSalesExcel(report: OfferSalesReportDto) {
  const printedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
  const offerTitle = fixEdariName(report.offerName);
  const period = `${shortDate(report.periodFrom)} ← ${shortDate(report.periodTo)}`;
  const store = report.storeLabel ? fixEdariName(report.storeLabel) : '—';
  const typeLabel = offerTypeLabel(report.offerType);
  const discountNote =
    report.offerType === 0 && report.discountPercent > 0
      ? `خصم العرض ${formatNum(report.discountPercent)}%`
      : typeLabel;

  const COLS = 10;
  const mergeAll = COLS - 1;
  const widths = [44, 128, 250, 145, 76, 82, 108, 108, 100, 125];

  // Generate embedded high-resolution chart banner PNG
  const chartPng = renderOfferChartsPng(offerTitle, period, report.daily ?? [], report.products ?? []);

  // ── Sheet 1: التقرير التنفيذي ومنحنى المبيعات والمواد المباعة ─────────────
  const rows: XlsxRowInput[] = [];

  // 1. Header Banner
  rows.push(
    r(
      [
        c('FOT POS', 'hero', 'String', { mergeAcross: 1 }),
        c(`تقرير مبيعات العرض — ${offerTitle}`, 'hero', 'String', { mergeAcross: mergeAll - 2 }),
      ],
      32,
    ),
  );
  rows.push(
    r(
      [
        c(`الفرع: ${store}`, 'heroSub', 'String', { mergeAcross: 2 }),
        c(`نوع العرض: ${discountNote}`, 'heroSub', 'String', { mergeAcross: 2 }),
        c(`فترة العرض: ${period}`, 'heroSub', 'String', { mergeAcross: 2 }),
        c(`تاريخ التصدير: ${printedAt}`, 'heroSub', 'String', { mergeAcross: 1 }),
      ],
      24,
    ),
  );
  rows.push(blank(8));

  // 2. Clean Financial Totals ONLY (No averages, no unsold counts)
  rows.push(r([c('إجماليات مبيعات العرض', 'section', 'String', { mergeAcross: mergeAll })], 24));
  rows.push(
    r(
      [
        c('صافي مبيعات العرض (د.ع)', 'kpiL', 'String', { mergeAcross: 1 }),
        c('القيمة قبل الخصم (د.ع)', 'kpiL', 'String', { mergeAcross: 1 }),
        c('إجمالي الخصم الممنوح (د.ع)', 'kpiL', 'String', { mergeAcross: 1 }),
        c('إجمالي الكمية المباعة', 'kpiL', 'String', { mergeAcross: 1 }),
        c('عدد المواد المباعة', 'kpiL', 'String', { mergeAcross: 1 }),
      ],
      20,
    ),
  );
  rows.push(
    r(
      [
        c(report.totalAmount, 'kpiV', 'Number', { mergeAcross: 1 }),
        c(report.totalListAmount, 'kpiV', 'Number', { mergeAcross: 1 }),
        c(report.totalDiscountAmount, 'kpiV', 'Number', { mergeAcross: 1 }),
        c(report.totalQuantity, 'kpiI', 'Number', { mergeAcross: 1 }),
        c(report.products.length, 'kpiI', 'Number', { mergeAcross: 1 }),
      ],
      28,
    ),
  );
  rows.push(blank(10));

  // 3. Space reserved for the embedded Chart Image (if available in browser)
  const sheet1Images: XlsxImageInput[] = [];
  if (chartPng) {
    rows.push(
      r(
        [
          c(
            'منحنى المبيعات اليومية وأعلى المواد مبيعاً خلال فترة العرض',
            'section',
            'String',
            { mergeAcross: mergeAll },
          ),
        ],
        24,
      ),
    );
    const chartStartRow0 = rows.length; // 0-based row where chart starts
    const chartRowCount = 16;
    for (let i = 0; i < chartRowCount; i++) {
      rows.push(blank(22));
    }
    sheet1Images.push({
      pngBytes: chartPng,
      fromCol: 0,
      fromRow: chartStartRow0,
      toCol: COLS,
      toRow: chartStartRow0 + chartRowCount,
      title: `منحنى مبيعات العرض - ${offerTitle}`,
    });
    rows.push(blank(10));
  }

  // 4. Sold Products Table (with Sales Dates per product + visual share bar)
  const maxProdAmount = Math.max(1, ...report.products.map(p => p.amount));
  rows.push(
    r(
      [
        c(
          `جدول المواد المباعة وتواريخ البيع خلال العرض (${formatNum(report.products.length)} مادة)`,
          'section',
          'String',
          { mergeAcross: mergeAll },
        ),
      ],
      24,
    ),
  );
  rows.push(
    r(
      [
        c('م', 'head'),
        c('الباركود', 'head'),
        c('اسم المادة', 'head'),
        c('تواريخ البيع', 'head'),
        c('أيام البيع', 'head'),
        c('الكمية المباعة', 'head'),
        c('القيمة قبل الخصم', 'head'),
        c('صافي المبيعات', 'head'),
        c('قيمة الخصم', 'head'),
        c('الحصة والمؤشر', 'head'),
      ],
      25,
    ),
  );

  report.products.forEach((p, i) => {
    const z = i % 2 === 1;
    const bar = visualShareBar(p.amount / maxProdAmount, 10);
    const shareText = `${bar} ${p.sharePercent.toFixed(1)}%`;
    rows.push(
      r(
        [
          c(i + 1, 'rank', 'Number'),
          c(p.barcode ?? '', z ? 'zebraC' : 'plainC', 'String'),
          c(fixEdariName(p.name ?? ''), z ? 'zebraWrap' : 'plainWrap', 'String'),
          c(soldDatesLabel(p), z ? 'zebraC' : 'plainC', 'String'),
          c(p.activeDaysCount || 1, z ? 'intZ' : 'int', 'Number'),
          c(p.quantity, z ? 'intZ' : 'int', 'Number'),
          c(p.listAmount, z ? 'numZ' : 'num', 'Number'),
          c(p.amount, z ? 'moneyZ' : 'money', 'Number'),
          c(p.discountAmount, z ? 'numZ' : 'num', 'Number'),
          c(shareText, z ? 'barCellZ' : 'barCell', 'String'),
        ],
        21,
      ),
    );
  });

  rows.push(
    r(
      [
        c('الإجمالي العام للمواد المباعة', 'total', 'String', { mergeAcross: 4 }),
        c(report.totalQuantity, 'totalInt', 'Number'),
        c(report.totalListAmount, 'totalN', 'Number'),
        c(report.totalAmount, 'totalN', 'Number'),
        c(report.totalDiscountAmount, 'totalN', 'Number'),
        c('100.0%', 'total', 'String'),
      ],
      25,
    ),
  );

  // 5. Daily Sales Table with visual curve bar on Sheet 1
  if (report.daily.length > 0) {
    const maxDailyAmt = Math.max(1, ...report.daily.map(d => d.amount));
    rows.push(blank(12));
    rows.push(
      r([c('جدول ومنحنى المبيعات اليومية بالتاريخ', 'section', 'String', { mergeAcross: mergeAll })], 24),
    );
    rows.push(
      r(
        [
          c('م', 'head'),
          c('التاريخ', 'head'),
          c('اليوم', 'head'),
          c('الكمية المباعة', 'head'),
          c('صافي المبيعات (د.ع)', 'head', 'String', { mergeAcross: 1 }),
          c('عدد الفواتير/العمليات', 'head'),
          c('نسبة اليوم', 'head'),
          c('منحنى اليوم البصري', 'head', 'String', { mergeAcross: 1 }),
        ],
        24,
      ),
    );
    report.daily.forEach((d, i) => {
      const z = i % 2 === 1;
      const dayShare = report.totalAmount > 0 ? d.amount / report.totalAmount : 0;
      const curveBar = visualShareBar(d.amount / maxDailyAmt, 18);
      rows.push(
        r(
          [
            c(i + 1, 'rank', 'Number'),
            c(shortDate(d.date), z ? 'zebraC' : 'plainC', 'String'),
            c(weekday(d.date), z ? 'zebraC' : 'plainC', 'String'),
            c(d.quantity, z ? 'intZ' : 'int', 'Number'),
            c(d.amount, z ? 'moneyZ' : 'money', 'Number', { mergeAcross: 1 }),
            c(d.receiptCount, z ? 'intZ' : 'int', 'Number'),
            c(dayShare, z ? 'pctZ' : 'pct', 'Number'),
            c(curveBar, z ? 'barCellZ' : 'barCell', 'String', { mergeAcross: 1 }),
          ],
          21,
        ),
      );
    });
    rows.push(
      r(
        [
          c('مجموع الأيام', 'total', 'String', { mergeAcross: 2 }),
          c(report.totalQuantity, 'totalInt', 'Number'),
          c(report.totalAmount, 'totalN', 'Number', { mergeAcross: 1 }),
          c(report.receiptCount, 'totalInt', 'Number'),
          c(report.totalAmount > 0 ? 1 : 0, 'pct', 'Number'),
          c('', 'total', 'String', { mergeAcross: 1 }),
        ],
        24,
      ),
    );
  }

  // ── Sheet 2: سجل مبيعات المواد بالتاريخ (Product Sales by Date) ────────────
  const productDailyList: OfferSalesProductDayRowDto[] = report.productDaily ?? [];
  const byDateRows: XlsxRowInput[] = [
    r(
      [
        c(
          `تفصيل مبيعات المواد بالتاريخ — ${offerTitle} (${period})`,
          'brand',
          'String',
          { mergeAcross: 8 },
        ),
      ],
      28,
    ),
    r(
      [
        c('م', 'head'),
        c('تاريخ البيع', 'head'),
        c('اليوم', 'head'),
        c('الباركود', 'head'),
        c('اسم المادة', 'head'),
        c('الكمية المباعة', 'head'),
        c('القيمة قبل الخصم', 'head'),
        c('صافي المبيعات', 'head'),
        c('قيمة الخصم', 'head'),
      ],
      24,
    ),
  ];

  if (productDailyList.length > 0) {
    productDailyList.forEach((pd, i) => {
      const z = i % 2 === 1;
      byDateRows.push(
        r(
          [
            c(i + 1, 'rank', 'Number'),
            c(shortDate(pd.date), z ? 'zebraC' : 'plainC', 'String'),
            c(weekday(pd.date), z ? 'zebraC' : 'plainC', 'String'),
            c(pd.barcode ?? '', z ? 'zebraC' : 'plainC', 'String'),
            c(fixEdariName(pd.name ?? ''), z ? 'zebraWrap' : 'plainWrap', 'String'),
            c(pd.quantity, z ? 'intZ' : 'int', 'Number'),
            c(pd.listAmount, z ? 'numZ' : 'num', 'Number'),
            c(pd.amount, z ? 'moneyZ' : 'money', 'Number'),
            c(pd.discountAmount, z ? 'numZ' : 'num', 'Number'),
          ],
          20,
        ),
      );
    });
  } else {
    // Fallback if server hasn't populated productDaily yet: use products with their date range
    report.products.forEach((p, i) => {
      const z = i % 2 === 1;
      byDateRows.push(
        r(
          [
            c(i + 1, 'rank', 'Number'),
            c(soldDatesLabel(p), z ? 'zebraC' : 'plainC', 'String'),
            c(p.firstSoldDate ? weekday(p.firstSoldDate) : '—', z ? 'zebraC' : 'plainC', 'String'),
            c(p.barcode ?? '', z ? 'zebraC' : 'plainC', 'String'),
            c(fixEdariName(p.name ?? ''), z ? 'zebraWrap' : 'plainWrap', 'String'),
            c(p.quantity, z ? 'intZ' : 'int', 'Number'),
            c(p.listAmount, z ? 'numZ' : 'num', 'Number'),
            c(p.amount, z ? 'moneyZ' : 'money', 'Number'),
            c(p.discountAmount, z ? 'numZ' : 'num', 'Number'),
          ],
          20,
        ),
      );
    });
  }

  byDateRows.push(
    r(
      [
        c('الإجمالي العام', 'total', 'String', { mergeAcross: 4 }),
        c(report.totalQuantity, 'totalInt', 'Number'),
        c(report.totalListAmount, 'totalN', 'Number'),
        c(report.totalAmount, 'totalN', 'Number'),
        c(report.totalDiscountAmount, 'totalN', 'Number'),
      ],
      24,
    ),
  );

  // ── Sheet 3: مصفوفة المواد × الأيام (Products × Days Matrix) ──────────────
  const sortedDates = Array.from(
    new Set([
      ...report.daily.map(d => shortDate(d.date)),
      ...productDailyList.map(pd => shortDate(pd.date)),
    ]),
  )
    .filter(d => d && d !== '—')
    .sort();

  const sheets: XlsxSheetInput[] = [
    {
      name: 'تقرير العرض والمنحنى',
      rtl: true,
      columnWidths: widths,
      rows,
      images: sheet1Images,
    },
    {
      name: 'مبيعات المواد بالتاريخ',
      rtl: true,
      columnWidths: [44, 110, 95, 130, 260, 95, 115, 115, 105],
      rows: byDateRows,
    },
  ];

  if (sortedDates.length > 0 && productDailyList.length > 0) {
    const qtyMap = new Map<string, number>();
    for (const pd of productDailyList) {
      const k = `${pd.articleSeq}|${shortDate(pd.date)}`;
      qtyMap.set(k, (qtyMap.get(k) ?? 0) + pd.quantity);
    }

    const matrixCols = 3 + sortedDates.length + 2;
    const matrixRows: XlsxRowInput[] = [
      r(
        [
          c(
            `مصفوفة الكميات المباعة يومياً لكل مادة — ${offerTitle}`,
            'brand',
            'String',
            { mergeAcross: matrixCols - 1 },
          ),
        ],
        28,
      ),
      r(
        [
          c('م', 'head'),
          c('الباركود', 'head'),
          c('اسم المادة', 'head'),
          ...sortedDates.map(d => c(shortDayMonth(d), 'head', 'String')),
          c('مجموع الكمية', 'head'),
          c('صافي المبيعات', 'head'),
        ],
        24,
      ),
    ];

    report.products.forEach((p, idx) => {
      const z = idx % 2 === 1;
      const dayCells = sortedDates.map(d => {
        const q = qtyMap.get(`${p.articleSeq}|${d}`) ?? 0;
        return q > 0
          ? c(q, z ? 'intZ' : 'int', 'Number')
          : c('—', z ? 'zebraC' : 'plainC', 'String');
      });
      matrixRows.push(
        r(
          [
            c(idx + 1, 'rank', 'Number'),
            c(p.barcode ?? '', z ? 'zebraC' : 'plainC', 'String'),
            c(fixEdariName(p.name ?? ''), z ? 'zebraWrap' : 'plainWrap', 'String'),
            ...dayCells,
            c(p.quantity, 'totalInt', 'Number'),
            c(p.amount, 'money', 'Number'),
          ],
          20,
        ),
      );
    });

    const dayTotals = sortedDates.map(d => {
      let sum = 0;
      for (const pd of productDailyList) {
        if (shortDate(pd.date) === d) sum += pd.quantity;
      }
      return c(sum, 'totalInt', 'Number');
    });

    matrixRows.push(
      r(
        [
          c('إجمالي اليوم', 'total', 'String', { mergeAcross: 2 }),
          ...dayTotals,
          c(report.totalQuantity, 'totalInt', 'Number'),
          c(report.totalAmount, 'totalN', 'Number'),
        ],
        24,
      ),
    );

    sheets.push({
      name: 'مصفوفة الأيام والمواد',
      rtl: true,
      columnWidths: [42, 125, 240, ...sortedDates.map(() => 68), 95, 115],
      rows: matrixRows,
    });
  }

  const base = `مبيعات-عرض-${offerTitle}`
    .replace(/[^\w\u0600-\u06FF.-]+/g, '_')
    .replace(/_+/g, '_');
  downloadXlsxFile(base, sheets);
}
