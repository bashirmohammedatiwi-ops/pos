/**
 * Native OpenXML (.xlsx) export for admin reports and DataGrid tables.
 * Opens in Microsoft Excel with RTL layout, full styling, smooth scrolling, and ZERO format warnings.
 */
import { downloadXlsxFile, type XlsxCellInput, type XlsxRowInput, type XlsxSheetInput } from './xlsxBuilder';

export type ReportExcelSheet = {
  name: string;
  title?: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  columnWidths?: number[];
};

function colStyle(v: string | number | null | undefined, zebra: boolean) {
  if (typeof v === 'number') {
    return Number.isInteger(v) && Math.abs(v) < 1e12 ? (zebra ? 'intZ' : 'int') : (zebra ? 'numZ' : 'num');
  }
  return zebra ? 'zebra' : 'plain';
}

function toXlsxSheet(sheet: ReportExcelSheet): XlsxSheetInput {
  const cols = Math.max(1, sheet.headers.length);
  const widths = sheet.columnWidths ?? sheet.headers.map(() => 115);
  const rows: XlsxRowInput[] = [];
  const mergeTitle = Math.max(0, cols - 1);

  if (sheet.title) {
    rows.push({
      height: 28,
      cells: [{ value: sheet.title, style: 'brand', mergeAcross: mergeTitle }],
    });
    if (sheet.subtitle) {
      rows.push({
        height: 22,
        cells: [{ value: sheet.subtitle, style: 'sub', mergeAcross: mergeTitle }],
      });
    }
    rows.push({ height: 10, cells: [] });
  }

  rows.push({
    height: 24,
    cells: sheet.headers.map(h => ({ value: h, style: 'head', type: 'String' })),
  });

  sheet.rows.forEach((dataRow, i) => {
    const z = i % 2 === 1;
    const isTotalRow =
      i === sheet.rows.length - 1 &&
      typeof dataRow[0] === 'string' &&
      /^(المجموع|الإجمالي|اجمالي|مجموع)/.test(dataRow[0].trim());

    const cells: XlsxCellInput[] = dataRow.map(v => {
      if (isTotalRow) {
        if (typeof v === 'number') {
          return {
            value: v,
            style: Number.isInteger(v) && Math.abs(v) < 1e12 ? 'totalInt' : 'totalNum',
            type: 'Number',
          };
        }
        return { value: v ?? '', style: 'total', type: 'String' };
      }
      return {
        value: v ?? '',
        style: colStyle(v, z),
        type: typeof v === 'number' ? 'Number' : 'String',
      };
    });

    rows.push({ height: isTotalRow ? 24 : 20, cells });
  });

  return {
    name: sheet.name,
    rtl: true,
    columnWidths: widths,
    rows,
  };
}

export function downloadReportExcel(fileName: string, sheets: ReportExcelSheet[]) {
  if (!sheets.length) return;
  const xlsxSheets = sheets.map(toXlsxSheet);
  downloadXlsxFile(fileName, xlsxSheets);
}

/** One sheet from header + rows — convenience for simple reports. */
export function downloadSimpleReportExcel(
  fileName: string,
  sheet: Omit<ReportExcelSheet, 'name'> & { name?: string },
) {
  downloadReportExcel(fileName, [{ name: sheet.name ?? 'البيانات', ...sheet }]);
}
