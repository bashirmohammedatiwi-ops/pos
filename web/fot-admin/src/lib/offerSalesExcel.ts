import { formatCurrency, formatNum } from '@/api/client';
import type { OfferSalesReportDto } from '@/api/types';
import { offerTypeLabel } from '@/lib/offers';
import { fixEdariName } from '@/lib/text';

const COLS = 10;
const widths = [34, 92, 200, 58, 72, 72, 72, 56, 48, 48];

function esc(s: string) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function cell(
  value: string | number,
  style: string,
  type?: 'String' | 'Number',
  opts?: { mergeAcross?: number; mergeDown?: number },
) {
  const t = type ?? (typeof value === 'number' ? 'Number' : 'String');
  const merge =
    (opts?.mergeAcross ? ` ss:MergeAcross="${opts.mergeAcross}"` : '')
    + (opts?.mergeDown ? ` ss:MergeDown="${opts.mergeDown}"` : '');
  if (t === 'Number') {
    return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="Number">${num(typeof value === 'number' ? value : Number(value))}</Data></Cell>`;
  }
  return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="String">${esc(String(value ?? ''))}</Data></Cell>`;
}

function row(cells: string, height?: number) {
  return `<Row${height ? ` ss:Height="${height}"` : ''}>${cells}</Row>`;
}

function blank(h?: number) {
  return row('', h);
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function weekday(value?: string | null) {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-IQ', { weekday: 'short' });
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
</Borders>`;

const styles = `<Styles>
<Style ss:ID="hero"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Tahoma" ss:Size="14"/>${bordersLight}<Interior ss:Color="#4338CA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="heroSub"><Font ss:Color="#E0E7FF" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#4338CA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="lbl"><Font ss:Bold="1" ss:Color="#64748B" ss:FontName="Tahoma" ss:Size="9"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="val"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="section"><Font ss:Bold="1" ss:Color="#312E81" ss:FontName="Tahoma" ss:Size="11"/>${bordersLight}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#312E81" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="kpiL"><Font ss:Bold="1" ss:Color="#64748B" ss:FontName="Tahoma" ss:Size="9"/>${bordersLight}<Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="kpiV"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="15"/>${bordersLight}<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="kpiI"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="15"/>${bordersLight}<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="kpiP"><Font ss:Bold="1" ss:Color="#4338CA" ss:FontName="Tahoma" ss:Size="15"/>${bordersLight}<Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="plain"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="plainWrap"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="zebra"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="zebraWrap"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="rank"><Font ss:Bold="1" ss:Color="#64748B" ss:FontName="Tahoma" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="num"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="numZ"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="int"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.##"/></Style>
<Style ss:ID="intZ"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.##"/></Style>
<Style ss:ID="pct"><Font ss:FontName="Tahoma" ss:Color="#475569" ss:Size="10"/>${bordersLight}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="pctZ"><Font ss:FontName="Tahoma" ss:Color="#475569" ss:Size="10"/>${bordersLight}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="0.0%"/></Style>
<Style ss:ID="total"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersTopBold}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="totalN"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${bordersTopBold}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="note"><Font ss:FontName="Tahoma" ss:Color="#57534E" ss:Size="9"/>${bordersLight}<Interior ss:Color="#FFFBEB" ss:Pattern="Solid"/><Alignment ss:WrapText="1"/></Style>
<Style ss:ID="foot"><Font ss:FontName="Tahoma" ss:Color="#94A3B8" ss:Size="9"/><Alignment ss:Horizontal="Center"/></Style>
</Styles>`;

function infoPair(rows: string[], label: string, value: string, mergeLabel = 1, mergeVal = 3) {
  rows.push(row(
    cell(label, 'lbl', 'String', { mergeAcross: mergeLabel })
    + cell(value, 'val', 'String', { mergeAcross: mergeVal }),
    20,
  ));
}

export function downloadOfferSalesExcel(report: OfferSalesReportDto) {
  const printedAt = new Date().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
  const period = `${shortDate(report.periodFrom)} — ${shortDate(report.periodTo)}`;
  const store = report.storeLabel ? fixEdariName(report.storeLabel) : '—';
  const typeLabel = offerTypeLabel(report.offerType);
  const discountNote = report.offerType === 0 && report.discountPercent > 0
    ? `خصم العرض ${formatNum(report.discountPercent)}%`
    : typeLabel;
  const coverage = report.scopeProductCount > 0 ? report.soldProductCount / report.scopeProductCount : 0;
  const activeDays = report.daily.filter(d => d.amount > 0 || d.quantity > 0).length;
  const merge = COLS - 1;

  const rows: string[] = [];

  rows.push(row(cell('FOT POS', 'hero', 'String', { mergeAcross: 2 }) + cell('تقرير مبيعات عرض — للشركة الأم', 'hero', 'String', { mergeAcross: merge - 2 }), 32));
  rows.push(row(
    cell(fixEdariName(report.offerName), 'heroSub', 'String', { mergeAcross: 5 })
    + cell(`رقم العرض: ${report.offerId}`, 'heroSub', 'String', { mergeAcross: 2 })
    + cell(`طُبع: ${printedAt}`, 'heroSub', 'String', { mergeAcross: merge - 7 }),
  ));
  rows.push(blank(10));

  rows.push(row(cell('بيانات التقرير', 'section', 'String', { mergeAcross: merge })));
  infoPair(rows, 'الفرع / المنفذ', store, 1, 3);
  infoPair(rows, 'نوع العرض', discountNote, 1, 3);
  infoPair(rows, 'فترة العرض', `${period} (${report.periodDays} يوم)`, 1, 3);
  infoPair(rows, 'نطاق المواد', `${formatNum(report.scopeProductCount)} مادة · مباعة ${formatNum(report.soldProductCount)} · بدون مبيعات ${formatNum(report.unsoldProductCount)}`, 1, 3);
  infoPair(rows, 'عمليات البيع', `${formatNum(report.receiptCount)} (بدون أرقام فواتير)`, 1, 3);
  rows.push(blank(8));

  rows.push(row(cell('ملخص الأداء المالي', 'section', 'String', { mergeAcross: merge })));
  rows.push(row(
    cell('صافي المبيعات', 'kpiL', 'String', { mergeAcross: 1 })
    + cell('إجمالي الكمية', 'kpiL', 'String', { mergeAcross: 1 })
    + cell('قيمة قبل الخصم', 'kpiL', 'String', { mergeAcross: 1 })
    + cell('إجمالي الخصم', 'kpiL', 'String', { mergeAcross: 1 })
    + cell('متوسط يومي', 'kpiL', 'String', { mergeAcross: 1 })
    + cell('متوسط العملية', 'kpiL', 'String', { mergeAcross: merge - 5 }),
    18,
  ));
  rows.push(row(
    cell(report.totalAmount, 'kpiV', 'Number', { mergeAcross: 1 })
    + cell(report.totalQuantity, 'kpiI', 'Number', { mergeAcross: 1 })
    + cell(report.totalListAmount, 'kpiV', 'Number', { mergeAcross: 1 })
    + cell(report.totalDiscountAmount, 'kpiV', 'Number', { mergeAcross: 1 })
    + cell(report.averageDailyAmount, 'kpiV', 'Number', { mergeAcross: 1 })
    + cell(report.averageTicketAmount, 'kpiV', 'Number', { mergeAcross: merge - 5 }),
    28,
  ));
  rows.push(row(
    cell('تغطية المواد المباعة', 'kpiL', 'String', { mergeAcross: 2 })
    + cell('أيام بمبيعات', 'kpiL', 'String', { mergeAcross: 2 })
    + cell('', 'kpiL', 'String', { mergeAcross: merge - 4 }),
    16,
  ));
  rows.push(row(
    cell(coverage, 'kpiP', 'Number', { mergeAcross: 2 })
    + cell(activeDays, 'kpiI', 'Number', { mergeAcross: 2 })
    + cell('', 'plain', 'String', { mergeAcross: merge - 4 }),
    26,
  ));
  rows.push(blank(10));

  if (report.daily.length > 0) {
    rows.push(row(cell('المبيعات اليومية', 'section', 'String', { mergeAcross: merge })));
    rows.push(row(
      cell('التاريخ', 'head')
      + cell('اليوم', 'head')
      + cell('الكمية', 'head')
      + cell('صافي المبيعات', 'head')
      + cell('عمليات', 'head')
      + cell('', 'head', 'String', { mergeAcross: merge - 4 }),
      22,
    ));
    report.daily.forEach((d, i) => {
      const z = i % 2 === 1;
      rows.push(row(
        cell(shortDate(d.date), z ? 'zebra' : 'plain')
        + cell(weekday(d.date), z ? 'zebra' : 'plain')
        + cell(d.quantity, z ? 'intZ' : 'int', 'Number')
        + cell(d.amount, z ? 'numZ' : 'num', 'Number')
        + cell(d.receiptCount, z ? 'intZ' : 'int', 'Number')
        + cell('', z ? 'zebra' : 'plain', 'String', { mergeAcross: merge - 4 }),
      ));
    });
    rows.push(blank(10));
  }

  const productHeaderRow = rows.length + 1;
  rows.push(row(cell('المواد المباعة خلال العرض', 'section', 'String', { mergeAcross: merge })));
  rows.push(row(
    cell('م', 'head')
    + cell('الباركود', 'head')
    + cell('اسم المادة', 'head')
    + cell('الكمية', 'head')
    + cell('قبل الخصم', 'head')
    + cell('صافي المبيعات', 'head')
    + cell('الخصم', 'head')
    + cell('الحصة', 'head')
    + cell('', 'head', 'String', { mergeAcross: merge - 7 }),
    24,
  ));

  report.products.forEach((p, i) => {
    const z = i % 2 === 1;
    rows.push(row(
      cell(i + 1, 'rank')
      + cell(p.barcode ?? '', z ? 'zebra' : 'plain')
      + cell(fixEdariName(p.name ?? ''), z ? 'zebraWrap' : 'plainWrap')
      + cell(p.quantity, z ? 'intZ' : 'int', 'Number')
      + cell(p.listAmount, z ? 'numZ' : 'num', 'Number')
      + cell(p.amount, z ? 'numZ' : 'num', 'Number')
      + cell(p.discountAmount, z ? 'numZ' : 'num', 'Number')
      + cell(p.sharePercent / 100, z ? 'pctZ' : 'pct', 'Number')
      + cell('', z ? 'zebra' : 'plain', 'String', { mergeAcross: merge - 7 }),
    ));
  });

  rows.push(row(
    cell('الإجمالي', 'total', 'String', { mergeAcross: 2 })
    + cell(report.totalQuantity, 'totalN', 'Number')
    + cell(report.totalListAmount, 'totalN', 'Number')
    + cell(report.totalAmount, 'totalN', 'Number')
    + cell(report.totalDiscountAmount, 'totalN', 'Number')
    + cell('', 'total', 'String', { mergeAcross: merge - 5 }),
  ));

  rows.push(blank(8));
  rows.push(row(
    cell(
      `ملخص نصي: صافي المبيعات ${formatCurrency(report.totalAmount)} · الكمية ${formatNum(report.totalQuantity)} · متوسط يومي ${formatCurrency(report.averageDailyAmount)}.`,
      'note',
      'String',
      { mergeAcross: merge },
    ),
  ));
  rows.push(row(
    cell(
      'تنويه: لا يتضمن التقرير أرقام الفواتير أو أسماء البائعين. الأرقام من مواد نطاق العرض فقط خلال فترة العرض.',
      'note',
      'String',
      { mergeAcross: merge },
    ),
  ));

  if (report.unsoldProductCount > 0 && report.unsoldSamples.length > 0) {
    rows.push(blank(6));
    rows.push(row(
      cell(
        `مواد العرض بدون مبيعات (${formatNum(report.unsoldProductCount)}) — عينة (${report.unsoldSamples.length})`,
        'section',
        'String',
        { mergeAcross: merge },
      ),
    ));
    report.unsoldSamples.forEach((u, i) => {
      const z = i % 2 === 1;
      rows.push(row(
        cell(u.barcode ?? '—', z ? 'zebra' : 'plain')
        + cell(fixEdariName(u.name ?? ''), z ? 'zebraWrap' : 'plainWrap', 'String', { mergeAcross: merge - 1 }),
      ));
    });
  }

  rows.push(blank(6));
  rows.push(row(cell('وثيقة مُولَّدة آلياً من FOT POS — للاستخدام الداخلي والشركة الأم', 'foot', 'String', { mergeAcross: merge })));

  const colXml = widths.map(w => `<Column ss:Width="${w}"/>`).join('');
  const productEndRow = rows.length;
  const sheet = `<Worksheet ss:Name="تقرير العرض" ss:RightToLeft="1">
<Table ss:DefaultColumnWidth="72">${colXml}${rows.join('')}</Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
<FreezePanes/>
<FrozenNoSplit/>
<SplitHorizontal>${productHeaderRow + 1}</SplitHorizontal>
<TopRowBottomPane>${productHeaderRow + 1}</TopRowBottomPane>
</WorksheetOptions>
<AutoFilter x:Range="R${productHeaderRow + 1}C1:R${productEndRow}C8" xmlns:x="urn:schemas-microsoft-com:office:excel"/>
</Worksheet>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${styles}
${sheet}
</Workbook>`;

  const blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const base = `مبيعات-عرض-${report.offerName}`.replace(/[^\w\u0600-\u06FF.-]+/g, '_').replace(/_+/g, '_');
  a.download = `${base}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
