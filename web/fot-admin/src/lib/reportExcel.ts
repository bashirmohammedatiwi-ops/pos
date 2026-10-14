/** SpreadsheetML (.xls) export for admin reports — opens in Excel with RTL and styling. */

export type ReportExcelSheet = {
  name: string;
  title?: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  columnWidths?: number[];
};

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

function cell(
  value: string | number | null | undefined,
  style: string,
  opts?: { mergeAcross?: number },
) {
  const merge = opts?.mergeAcross ? ` ss:MergeAcross="${opts.mergeAcross}"` : '';
  if (typeof value === 'number') {
    return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="Number">${num(value)}</Data></Cell>`;
  }
  return `<Cell ss:StyleID="${style}"${merge}><Data ss:Type="String">${esc(String(value ?? ''))}</Data></Cell>`;
}

function row(cells: string, height?: number) {
  return `<Row${height ? ` ss:Height="${height}"` : ''}>${cells}</Row>`;
}

const border = `
<Borders>
<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
</Borders>`;

const borderTop = `
<Borders>
<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#312E81"/>
</Borders>`;

const styles = `<Styles>
<Style ss:ID="brand"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Tahoma" ss:Size="11"/>${border}<Interior ss:Color="#4338CA" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="title"><Font ss:Bold="1" ss:Color="#0F172A" ss:FontName="Tahoma" ss:Size="16"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="sub"><Font ss:Color="#64748B" ss:FontName="Tahoma" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="head"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Tahoma" ss:Size="10"/>${border}<Interior ss:Color="#312E81" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="plain"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="plainW"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="zebra"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="num"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="numZ"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
<Style ss:ID="int"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="intZ"><Font ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${border}<Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/></Style>
<Style ss:ID="total"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${borderTop}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/></Style>
<Style ss:ID="totalN"><Font ss:Bold="1" ss:FontName="Tahoma" ss:Color="#0F172A" ss:Size="10"/>${borderTop}<Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style>
</Styles>`;

function colStyle(v: string | number | null | undefined, zebra: boolean) {
  if (typeof v === 'number') {
    return Number.isInteger(v) && Math.abs(v) < 1e12 ? (zebra ? 'intZ' : 'int') : (zebra ? 'numZ' : 'num');
  }
  return zebra ? 'zebra' : 'plain';
}

function buildSheetXml(sheet: ReportExcelSheet) {
  const cols = sheet.headers.length;
  const widths = sheet.columnWidths ?? sheet.headers.map(() => 96);
  const colXml = widths.map(w => `<Column ss:Width="${w}"/>`).join('');
  const rows: string[] = [];
  const mergeTitle = Math.max(0, cols - 1);

  if (sheet.title) {
    rows.push(row(cell(sheet.title, 'brand', { mergeAcross: mergeTitle }), 26));
    if (sheet.subtitle) {
      rows.push(row(cell(sheet.subtitle, 'sub', { mergeAcross: mergeTitle })));
    }
    rows.push(row(''));
  }

  const headerRowNum = rows.length + 1;
  rows.push(row(sheet.headers.map(h => cell(h, 'head')).join(''), 22));

  sheet.rows.forEach((dataRow, i) => {
    const z = i % 2 === 1;
    rows.push(row(
      dataRow.map(v => cell(v, colStyle(v, z))).join(''),
    ));
  });

  const safeName = sheet.name.slice(0, 31).replace(/[\\/*?:\[\]]/g, ' ');
  const lastRow = rows.length;
  const freeze = headerRowNum;
  return `<Worksheet ss:Name="${escAttr(safeName)}" ss:RightToLeft="1">
<Table ss:DefaultColumnWidth="72">${colXml}${rows.join('')}</Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
<FreezePanes/>
<FrozenNoSplit/>
<SplitHorizontal>${freeze}</SplitHorizontal>
<TopRowBottomPane>${freeze}</TopRowBottomPane>
</WorksheetOptions>
<AutoFilter x:Range="R${headerRowNum}C1:R${lastRow}C${cols}" xmlns:x="urn:schemas-microsoft-com:office:excel"/>
</Worksheet>`;
}

export function buildReportExcelXml(sheets: ReportExcelSheet[]) {
  const body = sheets.map(buildSheetXml).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${styles}
${body}
</Workbook>`;
}

export function downloadReportExcel(fileName: string, sheets: ReportExcelSheet[]) {
  if (!sheets.length) return;
  const xml = buildReportExcelXml(sheets);
  const blob = new Blob(['\uFEFF', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const base = fileName.replace(/[^\w\u0600-\u06FF.-]+/g, '_').replace(/_+/g, '_') || 'report';
  a.download = base.endsWith('.xls') ? base : `${base}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** One sheet from header + rows — convenience for simple reports. */
export function downloadSimpleReportExcel(
  fileName: string,
  sheet: Omit<ReportExcelSheet, 'name'> & { name?: string },
) {
  downloadReportExcel(fileName, [{ name: sheet.name ?? 'البيانات', ...sheet }]);
}
