import { formatCommissionLabel, formatNum } from '@/api/client';
import type { ProductInquiryDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';

type ExportMeta = { from: string; to: string; scope: string };

function esc(s: string) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s: string) {
  return esc(s).replace(/'/g, '&apos;');
}

function num(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function cell(
  value: string | number,
  style: string,
  type?: 'String' | 'Number',
  opts?: { mergeAcross?: number; mergeDown?: number; formula?: string },
) {
  const t = type ?? (typeof value === 'number' ? 'Number' : 'String');
  const merge =
    (opts?.mergeAcross ? ` ss:MergeAcross="${opts.mergeAcross}"` : '')
    + (opts?.mergeDown ? ` ss:MergeDown="${opts.mergeDown}"` : '');
  if (opts?.formula) {
    return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="String">${esc(opts.formula)}</Data></Cell>`;
  }
  if (t === 'Number') {
    const n = num(typeof value === 'number' ? value : Number(value));
    return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="Number">${n}</Data></Cell>`;
  }
  return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="String">${esc(String(value ?? ''))}</Data></Cell>`;
}

function row(cells: string, height?: number) {
  const h = height ? ` ss:Height="${height}"` : '';
  return `<Row${h}>${cells}</Row>`;
}

function blank(h?: number) {
  return row('', h);
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

function productName(r: { productName?: string | null; articleSeq: number }) {
  return fixEdariName(r.productName) || `صنف #${r.articleSeq}`;
}

function salesmanName(r: { salesmanName?: string | null; salesmanId: number }) {
  return fixEdariName(r.salesmanName) || `بائع #${r.salesmanId}`;
}

const bordersLight = `
<Borders>
<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
</Borders>`;

const bordersTopBold = `
<Borders>
<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#312E81"/>
<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
</Borders>`;

const styles = `<Styles>
<Style ss:ID="brand"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Tahoma" ss:Size="12"/>${bordersLight}<Interior ss:Color="#4338CA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="brandSub"><Font ss:Color="#E0E7FF" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#4338CA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="title"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="20"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="titleSub"><Font ss:Color="#475569" ss:FontName="Tahoma" ss:Size="11"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="section"><Font ss:Bold="1" ss:Color="#312E81" ss:FontName="Tahoma" ss:Size="12"/>${bordersLight}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#312E81" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="head2"><Font ss:Bold="1" ss:Color="#1E293B" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#CBD5E1" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="kpiLabel"><Font ss:Bold="1" ss:Color="#64748B" ss:FontName="Tahoma" ss:Size="9"/>${bordersLight}<Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="kpiValue"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="14"/>${bordersLight}<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="kpiInt"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="14"/>${bordersLight}<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="kpiPct"><Font ss:Bold="1" ss:Color="#4338CA" ss:FontName="Tahoma" ss:Size="14"/>${bordersLight}<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="plain"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="plainWrap"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="zebra"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="zebraWrap"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="rank"><Font ss:Bold="1" ss:Color="#64748B" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="num"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="numZ"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="int"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="intZ"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="pct"><Font ss:FontName="Tahoma" ss:Color="#475569" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="pctZ"><Font ss:FontName="Tahoma" ss:Color="#475569" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="money"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#4338CA" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="moneyZ"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#4338CA" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="total"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersTopBold}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="totalNum"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersTopBold}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="totalInt"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersTopBold}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="note"><Font ss:FontName="Tahoma" ss:Color="#92400E" ss:Size="10"/>${bordersLight}<Interior ss:Color="#FFFBEB" ss:Pattern="Solid"/><Alignment ss:WrapText="1"/></Style>
<Style ss:ID="nav"><Font ss:FontName="Tahoma" ss:Color="#334155" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:WrapText="1"/></Style>
<Style ss:ID="foot"><Font ss:FontName="Tahoma" ss:Color="#94A3B8" ss:Size="9"/><Alignment ss:Horizontal="Center"/></Style>
</Styles>`;

function columns(widths: number[]) {
  return widths.map(w => `<Column ss:Width="${w}"/>`).join('');
}

type SheetOpts = {
  widths: number[];
  freezeRow?: number;
  autoFilterFromRow?: number;
  autoFilterToRow?: number;
  autoFilterCols?: number;
};

function sheet(name: string, rows: string[], opts: SheetOpts) {
  const safeName = name.slice(0, 31).replace(/[\\/*?:\[\]]/g, ' ');
  let options = '';
  if (opts.freezeRow != null && opts.freezeRow > 0) {
    const r = opts.freezeRow;
    options = `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
<FreezePanes/>
<FrozenNoSplit/>
<SplitHorizontal>${r}</SplitHorizontal>
<TopRowBottomPane>${r}</TopRowBottomPane>
<ActivePane>2</ActivePane>
</WorksheetOptions>`;
  }
  if (opts.autoFilterFromRow != null && opts.autoFilterToRow != null && opts.autoFilterCols) {
    const range = `R${opts.autoFilterFromRow}C1:R${opts.autoFilterToRow}C${opts.autoFilterCols}`;
    options += `<AutoFilter x:Range="${range}" xmlns:x="urn:schemas-microsoft-com:office:excel"/>`;
  }
  return `<Worksheet ss:Name="${escAttr(safeName)}" ss:RightToLeft="1">
<Table ss:DefaultColumnWidth="72">${columns(opts.widths)}${rows.join('')}</Table>
${options}
</Worksheet>`;
}

function headRow(cols: string[]) {
  return row(cols.map(c => cell(c, 'head')).join(''), 22);
}

function sheetBanner(title: string, period: string, subtitle: string, colSpan: number) {
  const rows: string[] = [];
  rows.push(row(
    cell('FOT POS · استعلام مادة', 'brand', 'String', { mergeAcross: colSpan }),
    26,
  ));
  rows.push(row(
    cell(title, 'title', 'String', { mergeAcross: Math.min(3, colSpan) })
    + cell(period, 'titleSub', 'String', { mergeAcross: colSpan - Math.min(3, colSpan) }),
    24,
  ));
  rows.push(row(cell(subtitle, 'titleSub', 'String', { mergeAcross: colSpan })));
  rows.push(blank(6));
  return rows;
}

function buildSummarySheet(data: ProductInquiryDto, meta: ExportMeta & { printedAt: string }) {
  const w = [8, 140, 100, 88, 88, 72, 72];
  const rows: string[] = [];
  const s = data.summary;
  const totalSales = s.salesAmount;
  const avgTicket = s.receiptCount > 0 ? totalSales / s.receiptCount : 0;
  const avgQtyPerReceipt = s.receiptCount > 0 ? s.quantity / s.receiptCount : 0;
  const commRate = totalSales > 0 ? s.commissionAmount / totalSales : 0;

  rows.push(row(cell('تقرير استعلام مادة — ملخص تنفيذي', 'brand', 'String', { mergeAcross: 6 }), 30));
  rows.push(row(
    cell(`${meta.from}  →  ${meta.to}`, 'brandSub', 'String', { mergeAcross: 3 })
    + cell(`طُبع: ${meta.printedAt}`, 'brandSub', 'String', { mergeAcross: 2 }),
  ));
  rows.push(blank(8));

  rows.push(row(cell('معلومات النطاق', 'section', 'String', { mergeAcross: 6 })));
  rows.push(row(
    cell(`النطاق: ${meta.scope}`, 'plainWrap', 'String', { mergeAcross: 3 })
    + cell(`عدد الأصناف في النطاق: ${formatNum(data.scope.productCount)}`, 'plain', 'String', { mergeAcross: 2 }),
  ));
  rows.push(row(cell(`نوع النطاق: ${data.scope.label || data.scope.kind}`, 'plain', 'String', { mergeAcross: 6 })));
  rows.push(blank(8));

  rows.push(row(cell('مؤشرات الأداء', 'section', 'String', { mergeAcross: 6 })));
  rows.push(row(
    cell('إجمالي الكمية', 'kpiLabel')
    + cell('إجمالي المبيعات', 'kpiLabel')
    + cell('عدد الفواتير', 'kpiLabel')
    + cell('إجمالي العمولة', 'kpiLabel')
    + cell('سطور العمولة', 'kpiLabel')
    + cell('نسبة العمولة', 'kpiLabel'),
    20,
  ));
  rows.push(row(
    cell(s.quantity, 'kpiInt', 'Number')
    + cell(s.salesAmount, 'kpiValue', 'Number')
    + cell(s.receiptCount, 'kpiInt', 'Number')
    + cell(s.commissionAmount, 'kpiValue', 'Number')
    + cell(s.commissionLineCount, 'kpiInt', 'Number')
    + cell(commRate, 'kpiPct', 'Number'),
    28,
  ));
  rows.push(blank(6));
  rows.push(row(
    cell('متوسط قيمة الفاتورة', 'kpiLabel')
    + cell('متوسط كمية/فاتورة', 'kpiLabel')
    + cell('عدد المنتجات في التقرير', 'kpiLabel')
    + cell('عدد البائعين', 'kpiLabel')
    + cell('سطور العمولة في الملف', 'kpiLabel')
    + cell('فواتير في الملف', 'kpiLabel'),
  ));
  rows.push(row(
    cell(avgTicket, 'kpiValue', 'Number')
    + cell(avgQtyPerReceipt, 'kpiValue', 'Number')
    + cell(data.products.length, 'kpiInt', 'Number')
    + cell(data.salesmen.length, 'kpiInt', 'Number')
    + cell(data.commissions.length, 'kpiInt', 'Number')
    + cell(data.receipts.length, 'kpiInt', 'Number'),
  ));
  rows.push(blank(10));

  const topProducts = [...data.products].sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 8);
  rows.push(row(cell('أعلى المنتجات حسب المبيعات (أعلى 8)', 'section', 'String', { mergeAcross: 6 })));
  rows.push(headRow(['#', 'المنتج', 'الكمية', 'المبيعات', '% من الإجمالي', 'العمولة', 'فواتير']));
  topProducts.forEach((r, i) => {
    const z = i % 2 === 1;
    rows.push(row([
      cell(i + 1, 'rank'),
      cell(productName(r), z ? 'zebraWrap' : 'plainWrap'),
      cell(r.quantity, z ? 'numZ' : 'num', 'Number'),
      cell(r.salesAmount, z ? 'numZ' : 'num', 'Number'),
      cell(pct(r.salesAmount, totalSales) / 100, z ? 'pctZ' : 'pct', 'Number'),
      cell(r.commissionAmount, z ? 'moneyZ' : 'money', 'Number'),
      cell(r.receiptCount, z ? 'intZ' : 'int', 'Number'),
    ].join('')));
  });
  if (topProducts.length === 0) {
    rows.push(row(cell('لا توجد بيانات منتجات في هذا النطاق', 'plain', 'String', { mergeAcross: 6 })));
  }
  rows.push(blank(10));

  const topSalesmen = [...data.salesmen].sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 8);
  rows.push(row(cell('أعلى البائعين حسب المبيعات (أعلى 8)', 'section', 'String', { mergeAcross: 6 })));
  rows.push(headRow(['#', 'البائع', 'الكمية', 'المبيعات', '% من الإجمالي', 'العمولة', 'فواتير']));
  topSalesmen.forEach((r, i) => {
    const z = i % 2 === 1;
    rows.push(row([
      cell(i + 1, 'rank'),
      cell(salesmanName(r), z ? 'zebraWrap' : 'plainWrap'),
      cell(r.quantity, z ? 'numZ' : 'num', 'Number'),
      cell(r.salesAmount, z ? 'numZ' : 'num', 'Number'),
      cell(pct(r.salesAmount, totalSales) / 100, z ? 'pctZ' : 'pct', 'Number'),
      cell(r.commissionAmount, z ? 'moneyZ' : 'money', 'Number'),
      cell(r.receiptCount, z ? 'intZ' : 'int', 'Number'),
    ].join('')));
  });
  if (topSalesmen.length === 0) {
    rows.push(row(cell('لا توجد بيانات بائعين', 'plain', 'String', { mergeAcross: 6 })));
  }
  rows.push(blank(10));

  rows.push(row(cell('أوراق التقرير', 'section', 'String', { mergeAcross: 6 })));
  rows.push(row(cell(
    '① المنتجات — تفصيل كل صنف  |  ② البائعون — أداء المندوبين  |  ③ الفواتير — ملخص كل فاتورة  |  ④ العمولات — كل سطر عمولة',
    'nav',
    'String',
    { mergeAcross: 6 },
  )));

  if (data.receiptsTruncated || data.commissionsTruncated) {
    rows.push(blank(6));
    rows.push(row(cell(
      'تنبيه: تم اقتطاع جزء من تفاصيل الفواتير أو العمولات في الاستعلام. هذا الملف يعكس الحد الأقصى المُصدَّر من الخادم — للتفاصيل الكاملة قلّص النطاق أو الفترة.',
      'note',
      'String',
      { mergeAcross: 6 },
    )));
  }
  rows.push(blank(8));
  rows.push(row(cell('تقرير داخلي — نظام نقاط البيع FOT', 'foot', 'String', { mergeAcross: 6 })));

  return sheet('الملخص', rows, { widths: w });
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

function buildProductsSheet(data: ProductInquiryDto, meta: ExportMeta) {
  const cols = 9;
  const widths = [36, 200, 110, 72, 92, 92, 72, 68, 64];
  const rows = sheetBanner('تفصيل المنتجات', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  const headerRow = 5;
  rows.push(headRow(['#', 'المنتج', 'الباركود', 'الكمية', 'مبلغ البيع', 'العمولة', '% من المبيعات', 'فواتير', 'سعر وسيط']));
  const sorted = [...data.products].sort((a, b) => b.salesAmount - a.salesAmount);
  const totalSales = data.summary.salesAmount;
  let tq = 0;
  let ts = 0;
  let tc = 0;
  let tr = 0;
  sorted.forEach((r, i) => {
    const st = dataStyles(i % 2 === 1);
    const unit = r.quantity > 0 ? r.salesAmount / r.quantity : 0;
    tq += r.quantity;
    ts += r.salesAmount;
    tc += r.commissionAmount;
    tr += r.receiptCount;
    rows.push(row([
      cell(i + 1, 'rank'),
      cell(productName(r), st.text),
      cell(r.barcode?.trim() || '—', st.plain),
      cell(r.quantity, st.n, 'Number'),
      cell(r.salesAmount, st.n, 'Number'),
      cell(r.commissionAmount, st.m, 'Number'),
      cell(pct(r.salesAmount, totalSales) / 100, st.p, 'Number'),
      cell(r.receiptCount, st.i, 'Number'),
      cell(unit, st.n, 'Number'),
    ].join('')));
  });
  const lastRow = headerRow + sorted.length;
  rows.push(row([
    cell('الإجمالي', 'total', 'String', { mergeAcross: 2 }),
    cell(tq, 'totalNum', 'Number'),
    cell(ts, 'totalNum', 'Number'),
    cell(tc, 'totalNum', 'Number'),
    cell(totalSales > 0 ? 1 : 0, 'totalNum', 'Number'),
    cell(tr, 'totalInt', 'Number'),
    cell('', 'total'),
  ].join(''), 22));
  return sheet('المنتجات', rows, {
    widths,
    freezeRow: headerRow,
    autoFilterFromRow: headerRow,
    autoFilterToRow: Math.max(headerRow, lastRow),
    autoFilterCols: cols,
  });
}

function buildSalesmenSheet(data: ProductInquiryDto, meta: ExportMeta) {
  const cols = 8;
  const widths = [36, 160, 72, 92, 92, 72, 68, 80];
  const rows = sheetBanner('أداء البائعين', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  const headerRow = 5;
  rows.push(headRow(['#', 'البائع', 'الكمية', 'مبلغ البيع', 'العمولة', '% من المبيعات', 'فواتير', 'متوسط الفاتورة']));
  const sorted = [...data.salesmen].sort((a, b) => b.salesAmount - a.salesAmount);
  const totalSales = data.summary.salesAmount;
  let tq = 0;
  let ts = 0;
  let tc = 0;
  let tr = 0;
  sorted.forEach((r, i) => {
    const st = dataStyles(i % 2 === 1);
    const avg = r.receiptCount > 0 ? r.salesAmount / r.receiptCount : 0;
    tq += r.quantity;
    ts += r.salesAmount;
    tc += r.commissionAmount;
    tr += r.receiptCount;
    rows.push(row([
      cell(i + 1, 'rank'),
      cell(salesmanName(r), st.text),
      cell(r.quantity, st.n, 'Number'),
      cell(r.salesAmount, st.n, 'Number'),
      cell(r.commissionAmount, st.m, 'Number'),
      cell(pct(r.salesAmount, totalSales) / 100, st.p, 'Number'),
      cell(r.receiptCount, st.i, 'Number'),
      cell(avg, st.n, 'Number'),
    ].join('')));
  });
  const lastRow = headerRow + sorted.length;
  rows.push(row([
    cell('الإجمالي', 'total', 'String', { mergeAcross: 1 }),
    cell(tq, 'totalNum', 'Number'),
    cell(ts, 'totalNum', 'Number'),
    cell(tc, 'totalNum', 'Number'),
    cell(totalSales > 0 ? 1 : 0, 'totalNum', 'Number'),
    cell(tr, 'totalInt', 'Number'),
    cell('', 'total'),
  ].join('')));
  return sheet('البائعون', rows, {
    widths,
    freezeRow: headerRow,
    autoFilterFromRow: headerRow,
    autoFilterToRow: Math.max(headerRow, lastRow),
    autoFilterCols: cols,
  });
}

function buildReceiptsSheet(data: ProductInquiryDto, meta: ExportMeta) {
  const cols = 9;
  const widths = [78, 72, 120, 72, 92, 92, 64, 64, 56];
  const rows = sheetBanner('ملخص الفواتير', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  const headerRow = 5;
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
  sorted.forEach((r, i) => {
    const st = dataStyles(i % 2 === 1);
    const rate = r.salesAmount > 0 ? r.commissionAmount / r.salesAmount : 0;
    tq += r.quantity;
    ts += r.salesAmount;
    tc += r.commissionAmount;
    tl += r.lineCount;
    rows.push(row([
      cell(shortDate(r.saleDate), st.plain),
      cell(receiptLabel(r.receiptNumber, r.receiptId), st.plain),
      cell(salesmanName(r), st.text),
      cell(r.quantity, st.n, 'Number'),
      cell(r.salesAmount, st.n, 'Number'),
      cell(r.commissionAmount, st.m, 'Number'),
      cell(r.lineCount, st.i, 'Number'),
      cell(rate, st.p, 'Number'),
      cell('', st.plain),
    ].join('')));
  });
  const lastRow = headerRow + sorted.length;
  rows.push(row([
    cell('الإجمالي', 'total', 'String', { mergeAcross: 2 }),
    cell(tq, 'totalNum', 'Number'),
    cell(ts, 'totalNum', 'Number'),
    cell(tc, 'totalNum', 'Number'),
    cell(tl, 'totalInt', 'Number'),
    cell('', 'total'),
    cell('', 'total'),
  ].join('')));
  return sheet('الفواتير', rows, {
    widths,
    freezeRow: headerRow,
    autoFilterFromRow: headerRow,
    autoFilterToRow: Math.max(headerRow, lastRow),
    autoFilterCols: cols,
  });
}

function buildCommissionsSheet(data: ProductInquiryDto, meta: ExportMeta) {
  const cols = 11;
  const widths = [78, 68, 160, 110, 100, 88, 56, 72, 88, 88, 72];
  const rows = sheetBanner('تفاصيل العمولات', `${meta.from} → ${meta.to}`, meta.scope, cols - 1);
  const headerRow = 5;
  rows.push(headRow([
    'التاريخ', 'الفاتورة', 'المنتج', 'البائع', 'مجموعة العمولة', 'نوع العمولة',
    'الكمية', 'مبلغ السطر', 'العمولة', '% من السطر', 'معرّف',
  ]));
  const sorted = [...data.commissions].sort((a, b) => {
    const da = a.saleDate ? new Date(a.saleDate).getTime() : 0;
    const db = b.saleDate ? new Date(b.saleDate).getTime() : 0;
    if (db !== da) return db - da;
    return (b.receiptNumber ?? 0) - (a.receiptNumber ?? 0);
  });
  let tq = 0;
  let tl = 0;
  let tc = 0;
  sorted.forEach((r, i) => {
    const st = dataStyles(i % 2 === 1);
    const rate = r.lineAmount > 0 ? r.commissionAmount / r.lineAmount : 0;
    tq += r.quantity;
    tl += r.lineAmount;
    tc += r.commissionAmount;
    rows.push(row([
      cell(shortDate(r.saleDate), st.plain),
      cell(receiptLabel(r.receiptNumber, r.receiptId), st.plain),
      cell(productName(r), st.text),
      cell(salesmanName(r), st.text),
      cell(r.commissionGroupName ?? '—', st.plain),
      cell(r.commissionType ? formatCommissionLabel(r.commissionType, r.commissionValue) : '—', st.plain),
      cell(r.quantity, st.n, 'Number'),
      cell(r.lineAmount, st.n, 'Number'),
      cell(r.commissionAmount, st.m, 'Number'),
      cell(rate, st.p, 'Number'),
      cell(r.id, st.i, 'Number'),
    ].join('')));
  });
  const lastRow = headerRow + sorted.length;
  rows.push(row([
    cell('الإجمالي', 'total', 'String', { mergeAcross: 5 }),
    cell(tq, 'totalNum', 'Number'),
    cell(tl, 'totalNum', 'Number'),
    cell(tc, 'totalNum', 'Number'),
    cell('', 'total'),
    cell('', 'total'),
  ].join('')));
  return sheet('العمولات', rows, {
    widths,
    freezeRow: headerRow,
    autoFilterFromRow: headerRow,
    autoFilterToRow: Math.max(headerRow, lastRow),
    autoFilterCols: cols,
  });
}

export function buildProductInquiryExcel(data: ProductInquiryDto, meta: ExportMeta) {
  const printedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
  const fullMeta = { ...meta, printedAt };
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${styles}
${buildSummarySheet(data, fullMeta)}
${buildProductsSheet(data, meta)}
${buildSalesmenSheet(data, meta)}
${buildReceiptsSheet(data, meta)}
${buildCommissionsSheet(data, meta)}
</Workbook>`;
}

export function downloadProductInquiryExcel(data: ProductInquiryDto, meta: ExportMeta) {
  const xml = buildProductInquiryExcel(data, meta);
  const blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `product-inquiry_${meta.from}_${meta.to}_${stamp}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
