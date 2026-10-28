import { formatCommissionLabel, formatNum } from '@/api/client';
import type { ProductInquiryDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { downloadXlsxFile, type XlsxCellInput, type XlsxRowInput, type XlsxSheetInput } from './xlsxBuilder';

type ExportMeta = { from: string; to: string; scope: string };

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function receiptLabel(number?: number | null, id?: number) {
  if (number && number > 0) return String(number);
  return id ? `#${id}` : '—';
}

function productName(row: { productName?: string | null; articleSeq: number }) {
  return fixEdariName(row.productName) || `صنف #${row.articleSeq}`;
}

function salesmanName(row: { salesmanName?: string | null; salesmanId: number }) {
  return fixEdariName(row.salesmanName) || `بائع #${row.salesmanId}`;
}

function headRow(cols: string[]): XlsxRowInput {
  return r(
    cols.map(col => c(col, 'head', 'String')),
    24,
  );
}

function sheetBanner(title: string, period: string, subtitle: string, colSpan: number): XlsxRowInput[] {
  const half = Math.min(3, colSpan);
  return [
    r([c('FOT POS · استعلام مادة', 'brand', 'String', { mergeAcross: colSpan })], 28),
    r(
      [
        c(title, 'title', 'String', { mergeAcross: half }),
        c(period, 'titleSub', 'String', { mergeAcross: Math.max(0, colSpan - half - 1) }),
      ],
      24,
    ),
    r([c(subtitle, 'titleSub', 'String', { mergeAcross: colSpan })], 20),
    blank(8),
  ];
}

function dataStyles(zebra: boolean) {
  return {
    text: zebra ? 'zebraWrap' : 'plainWrap',
    plain: zebra ? 'zebra' : 'plain',
    n: zebra ? 'numZ' : 'num',
    i: zebra ? 'intZ' : 'int',
    p: zebra ? 'pctZ' : 'pct',
    m: zebra ? 'moneyZ' : 'money',
  };
}

function buildSummarySheet(data: ProductInquiryDto, meta: ExportMeta & { printedAt: string }): XlsxSheetInput {
  const widths = [44, 180, 110, 110, 95, 95, 85];
  const rows: XlsxRowInput[] = [];
  const s = data.summary;
  const totalSales = s.salesAmount;
  const avgTicket = s.receiptCount > 0 ? totalSales / s.receiptCount : 0;
  const avgQtyPerReceipt = s.receiptCount > 0 ? s.quantity / s.receiptCount : 0;
  const commRate = totalSales > 0 ? s.commissionAmount / totalSales : 0;

  rows.push(r([c('تقرير استعلام مادة — ملخص تنفيذي', 'brand', 'String', { mergeAcross: 6 })], 30));
  rows.push(
    r(
      [
        c(`${meta.from}  →  ${meta.to}`, 'brandSub', 'String', { mergeAcross: 3 }),
        c(`طُبع: ${meta.printedAt}`, 'brandSub', 'String', { mergeAcross: 2 }),
      ],
      22,
    ),
  );
  rows.push(blank(8));

  rows.push(r([c('معلومات النطاق', 'section', 'String', { mergeAcross: 6 })], 24));
  rows.push(
    r(
      [
        c(`النطاق: ${meta.scope}`, 'plainWrap', 'String', { mergeAcross: 3 }),
        c(`عدد الأصناف في النطاق: ${formatNum(data.scope.productCount)}`, 'plain', 'String', { mergeAcross: 2 }),
      ],
      22,
    ),
  );
  rows.push(r([c(`نوع النطاق: ${data.scope.label || data.scope.kind}`, 'plain', 'String', { mergeAcross: 6 })], 22));
  rows.push(blank(8));

  rows.push(r([c('مؤشرات الأداء', 'section', 'String', { mergeAcross: 6 })], 24));
  rows.push(
    r(
      [
        c('إجمالي الكمية', 'kpiLabel', 'String', { mergeAcross: 1 }),
        c('إجمالي المبيعات', 'kpiLabel'),
        c('عدد الفواتير', 'kpiLabel'),
        c('إجمالي العمولة', 'kpiLabel'),
        c('سطور العمولة', 'kpiLabel'),
        c('نسبة العمولة', 'kpiLabel'),
      ],
      20,
    ),
  );
  rows.push(
    r(
      [
        c(s.quantity, 'kpiInt', 'Number', { mergeAcross: 1 }),
        c(s.salesAmount, 'kpiValue', 'Number'),
        c(s.receiptCount, 'kpiInt', 'Number'),
        c(s.commissionAmount, 'kpiValue', 'Number'),
        c(s.commissionLineCount, 'kpiInt', 'Number'),
        c(commRate, 'kpiPct', 'Number'),
      ],
      28,
    ),
  );
  rows.push(blank(6));
  rows.push(
    r(
      [
        c('متوسط قيمة الفاتورة', 'kpiLabel', 'String', { mergeAcross: 1 }),
        c('متوسط كمية/فاتورة', 'kpiLabel'),
        c('عدد المنتجات', 'kpiLabel'),
        c('عدد البائعين', 'kpiLabel'),
        c('سطور العمولة', 'kpiLabel'),
        c('فواتير في الملف', 'kpiLabel'),
      ],
      20,
    ),
  );
  rows.push(
    r(
      [
        c(avgTicket, 'kpiValue', 'Number', { mergeAcross: 1 }),
        c(avgQtyPerReceipt, 'kpiValue', 'Number'),
        c(data.products.length, 'kpiInt', 'Number'),
        c(data.salesmen.length, 'kpiInt', 'Number'),
        c(data.commissions.length, 'kpiInt', 'Number'),
        c(data.receipts.length, 'kpiInt', 'Number'),
      ],
      28,
    ),
  );
  rows.push(blank(10));

  const topProducts = [...data.products].sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 8);
  rows.push(r([c('أعلى المنتجات حسب المبيعات (أعلى 8)', 'section', 'String', { mergeAcross: 6 })], 24));
  rows.push(headRow(['#', 'المنتج', 'الكمية', 'المبيعات', '% من الإجمالي', 'العمولة', 'فواتير']));
  topProducts.forEach((p, i) => {
    const z = i % 2 === 1;
    rows.push(
      r([
        c(i + 1, 'rank', 'Number'),
        c(productName(p), z ? 'zebraWrap' : 'plainWrap', 'String'),
        c(p.quantity, z ? 'numZ' : 'num', 'Number'),
        c(p.salesAmount, z ? 'numZ' : 'num', 'Number'),
        c(pct(p.salesAmount, totalSales) / 100, z ? 'pctZ' : 'pct', 'Number'),
        c(p.commissionAmount, z ? 'moneyZ' : 'money', 'Number'),
        c(p.receiptCount, z ? 'intZ' : 'int', 'Number'),
      ]),
    );
  });
  if (topProducts.length === 0) {
    rows.push(r([c('لا توجد بيانات منتجات في هذا النطاق', 'plain', 'String', { mergeAcross: 6 })]));
  }
  rows.push(blank(10));

  const topSalesmen = [...data.salesmen].sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 8);
  rows.push(r([c('أعلى البائعين حسب المبيعات (أعلى 8)', 'section', 'String', { mergeAcross: 6 })], 24));
  rows.push(headRow(['#', 'البائع', 'الكمية', 'المبيعات', '% من الإجمالي', 'العمولة', 'فواتير']));
  topSalesmen.forEach((sm, i) => {
    const z = i % 2 === 1;
    rows.push(
      r([
        c(i + 1, 'rank', 'Number'),
        c(salesmanName(sm), z ? 'zebraWrap' : 'plainWrap', 'String'),
        c(sm.quantity, z ? 'numZ' : 'num', 'Number'),
        c(sm.salesAmount, z ? 'numZ' : 'num', 'Number'),
        c(pct(sm.salesAmount, totalSales) / 100, z ? 'pctZ' : 'pct', 'Number'),
        c(sm.commissionAmount, z ? 'moneyZ' : 'money', 'Number'),
        c(sm.receiptCount, z ? 'intZ' : 'int', 'Number'),
      ]),
    );
  });
  if (topSalesmen.length === 0) {
    rows.push(r([c('لا توجد بيانات بائعين', 'plain', 'String', { mergeAcross: 6 })]));
  }
  rows.push(blank(10));

  rows.push(r([c('أوراق التقرير', 'section', 'String', { mergeAcross: 6 })], 24));
  rows.push(
    r([
      c(
        '① المنتجات — تفصيل كل صنف  |  ② البائعون — أداء المندوبين  |  ③ الفواتير — ملخص كل فاتورة  |  ④ العمولات — كل سطر عمولة',
        'nav',
        'String',
        { mergeAcross: 6 },
      ),
    ]),
  );

  if (data.receiptsTruncated || data.commissionsTruncated) {
    rows.push(blank(6));
    rows.push(
      r([
        c(
          'تنبيه: تم اقتطاع جزء من تفاصيل الفواتير أو العمولات في الاستعلام. هذا الملف يعكس الحد الأقصى المُصدَّر من الخادم — للتفاصيل الكاملة قلّص النطاق أو الفترة.',
          'note',
          'String',
          { mergeAcross: 6 },
        ),
      ]),
    );
  }
  rows.push(blank(8));
  rows.push(r([c('تقرير داخلي — نظام نقاط البيع FOT', 'foot', 'String', { mergeAcross: 6 })]));

  return { name: 'الملخص', rtl: true, columnWidths: widths, rows };
}

function buildProductsSheet(data: ProductInquiryDto, meta: ExportMeta): XlsxSheetInput {
  const cols = 9;
  const widths = [42, 220, 120, 82, 105, 105, 85, 78, 82];
  const rows = sheetBanner('تفصيل المنتجات', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  rows.push(headRow(['#', 'المنتج', 'الباركود', 'الكمية', 'مبلغ البيع', 'العمولة', '% من المبيعات', 'فواتير', 'سعر وسيط']));
  const sorted = [...data.products].sort((a, b) => b.salesAmount - a.salesAmount);
  const totalSales = data.summary.salesAmount;
  let tq = 0;
  let ts = 0;
  let tc = 0;
  let tr = 0;
  sorted.forEach((p, i) => {
    const st = dataStyles(i % 2 === 1);
    const unit = p.quantity > 0 ? p.salesAmount / p.quantity : 0;
    tq += p.quantity;
    ts += p.salesAmount;
    tc += p.commissionAmount;
    tr += p.receiptCount;
    rows.push(
      r([
        c(i + 1, 'rank', 'Number'),
        c(productName(p), st.text, 'String'),
        c(p.barcode?.trim() || '—', st.plain, 'String'),
        c(p.quantity, st.n, 'Number'),
        c(p.salesAmount, st.n, 'Number'),
        c(p.commissionAmount, st.m, 'Number'),
        c(pct(p.salesAmount, totalSales) / 100, st.p, 'Number'),
        c(p.receiptCount, st.i, 'Number'),
        c(unit, st.n, 'Number'),
      ]),
    );
  });
  rows.push(
    r(
      [
        c('الإجمالي', 'total', 'String', { mergeAcross: 2 }),
        c(tq, 'totalNum', 'Number'),
        c(ts, 'totalNum', 'Number'),
        c(tc, 'totalNum', 'Number'),
        c(totalSales > 0 ? 1 : 0, 'pct', 'Number'),
        c(tr, 'totalInt', 'Number'),
        c('', 'total', 'String'),
      ],
      24,
    ),
  );
  return { name: 'المنتجات', rtl: true, columnWidths: widths, rows };
}

function buildSalesmenSheet(data: ProductInquiryDto, meta: ExportMeta): XlsxSheetInput {
  const cols = 8;
  const widths = [42, 180, 82, 105, 105, 85, 78, 92];
  const rows = sheetBanner('أداء البائعين', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  rows.push(headRow(['#', 'البائع', 'الكمية', 'مبلغ البيع', 'العمولة', '% من المبيعات', 'فواتير', 'متوسط الفاتورة']));
  const sorted = [...data.salesmen].sort((a, b) => b.salesAmount - a.salesAmount);
  const totalSales = data.summary.salesAmount;
  let tq = 0;
  let ts = 0;
  let tc = 0;
  let tr = 0;
  sorted.forEach((sm, i) => {
    const st = dataStyles(i % 2 === 1);
    const avg = sm.receiptCount > 0 ? sm.salesAmount / sm.receiptCount : 0;
    tq += sm.quantity;
    ts += sm.salesAmount;
    tc += sm.commissionAmount;
    tr += sm.receiptCount;
    rows.push(
      r([
        c(i + 1, 'rank', 'Number'),
        c(salesmanName(sm), st.text, 'String'),
        c(sm.quantity, st.n, 'Number'),
        c(sm.salesAmount, st.n, 'Number'),
        c(sm.commissionAmount, st.m, 'Number'),
        c(pct(sm.salesAmount, totalSales) / 100, st.p, 'Number'),
        c(sm.receiptCount, st.i, 'Number'),
        c(avg, st.n, 'Number'),
      ]),
    );
  });
  rows.push(
    r(
      [
        c('الإجمالي', 'total', 'String', { mergeAcross: 1 }),
        c(tq, 'totalNum', 'Number'),
        c(ts, 'totalNum', 'Number'),
        c(tc, 'totalNum', 'Number'),
        c(totalSales > 0 ? 1 : 0, 'pct', 'Number'),
        c(tr, 'totalInt', 'Number'),
        c('', 'total', 'String'),
      ],
      24,
    ),
  );
  return { name: 'البائعون', rtl: true, columnWidths: widths, rows };
}

function buildReceiptsSheet(data: ProductInquiryDto, meta: ExportMeta): XlsxSheetInput {
  const cols = 9;
  const widths = [90, 88, 140, 82, 105, 105, 72, 82, 72];
  const rows = sheetBanner('ملخص الفواتير', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  rows.push(headRow(['التاريخ', 'رقم الفاتورة', 'البائع', 'كمية النطاق', 'مبلغ النطاق', 'العمولة', 'بنود', 'عمولة/مبيعات', 'ملاحظة']));
  const sorted = [...data.receipts].sort((a, b) => {
    const da = a.saleDate ? new Date(a.saleDate).getTime() : 0;
    const db = b.saleDate ? new Date(b.saleDate).getTime() : 0;
    return db - da;
  });
  let tq = 0;
  let ts = 0;
  let tc = 0;
  let tl = 0;
  sorted.forEach((rec, i) => {
    const st = dataStyles(i % 2 === 1);
    const rate = rec.salesAmount > 0 ? rec.commissionAmount / rec.salesAmount : 0;
    tq += rec.quantity;
    ts += rec.salesAmount;
    tc += rec.commissionAmount;
    tl += rec.lineCount;
    rows.push(
      r([
        c(shortDate(rec.saleDate), st.plain, 'String'),
        c(receiptLabel(rec.receiptNumber, rec.receiptId), st.plain, 'String'),
        c(salesmanName(rec), st.text, 'String'),
        c(rec.quantity, st.n, 'Number'),
        c(rec.salesAmount, st.n, 'Number'),
        c(rec.commissionAmount, st.m, 'Number'),
        c(rec.lineCount, st.i, 'Number'),
        c(rate, st.p, 'Number'),
        c('', st.plain, 'String'),
      ]),
    );
  });
  rows.push(
    r(
      [
        c('الإجمالي', 'total', 'String', { mergeAcross: 2 }),
        c(tq, 'totalNum', 'Number'),
        c(ts, 'totalNum', 'Number'),
        c(tc, 'totalNum', 'Number'),
        c(tl, 'totalInt', 'Number'),
        c('', 'total', 'String'),
        c('', 'total', 'String'),
      ],
      24,
    ),
  );
  return { name: 'الفواتير', rtl: true, columnWidths: widths, rows };
}

function buildCommissionsSheet(data: ProductInquiryDto, meta: ExportMeta): XlsxSheetInput {
  const cols = 11;
  const widths = [90, 82, 180, 130, 120, 100, 68, 92, 96, 92, 82];
  const rows = sheetBanner('تفاصيل العمولات', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  rows.push(
    headRow([
      'التاريخ',
      'الفاتورة',
      'المنتج',
      'البائع',
      'مجموعة العمولة',
      'نوع العمولة',
      'الكمية',
      'مبلغ السطر',
      'العمولة',
      '% من السطر',
      'معرّف',
    ]),
  );
  const sorted = [...data.commissions].sort((a, b) => {
    const da = a.saleDate ? new Date(a.saleDate).getTime() : 0;
    const db = b.saleDate ? new Date(b.saleDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.receiptNumber ?? 0) - (a.receiptNumber ?? 0);
  });
  let tq = 0;
  let tl = 0;
  let tc = 0;
  sorted.forEach((cm, i) => {
    const st = dataStyles(i % 2 === 1);
    const rate = cm.lineAmount > 0 ? cm.commissionAmount / cm.lineAmount : 0;
    tq += cm.quantity;
    tl += cm.lineAmount;
    tc += cm.commissionAmount;
    rows.push(
      r([
        c(shortDate(cm.saleDate), st.plain, 'String'),
        c(receiptLabel(cm.receiptNumber, cm.receiptId), st.plain, 'String'),
        c(productName(cm), st.text, 'String'),
        c(salesmanName(cm), st.text, 'String'),
        c(cm.commissionGroupName ?? '—', st.plain, 'String'),
        c(cm.commissionType ? formatCommissionLabel(cm.commissionType, cm.commissionValue) : '—', st.plain, 'String'),
        c(cm.quantity, st.n, 'Number'),
        c(cm.lineAmount, st.n, 'Number'),
        c(cm.commissionAmount, st.m, 'Number'),
        c(rate, st.p, 'Number'),
        c(cm.id, st.i, 'Number'),
      ]),
    );
  });
  rows.push(
    r(
      [
        c('الإجمالي', 'total', 'String', { mergeAcross: 5 }),
        c(tq, 'totalNum', 'Number'),
        c(tl, 'totalNum', 'Number'),
        c(tc, 'totalNum', 'Number'),
        c('', 'total', 'String'),
        c('', 'total', 'String'),
      ],
      24,
    ),
  );
  return { name: 'العمولات', rtl: true, columnWidths: widths, rows };
}

export function downloadProductInquiryExcel(data: ProductInquiryDto, meta: ExportMeta) {
  const printedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
  const fullMeta = { ...meta, printedAt };
  const stamp = new Date().toISOString().slice(0, 10);
  const sheets: XlsxSheetInput[] = [
    buildSummarySheet(data, fullMeta),
    buildProductsSheet(data, meta),
    buildSalesmenSheet(data, meta),
    buildReceiptsSheet(data, meta),
    buildCommissionsSheet(data, meta),
  ];
  downloadXlsxFile(`استعلام-مادة_${meta.from}_${meta.to}_${stamp}`, sheets);
}
