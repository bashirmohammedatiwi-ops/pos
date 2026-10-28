/**
 * Native OpenXML (.xlsx) workbook generator for FOT Manager Portal.
 * Produces a standard ZIP-packaged .xlsx file (ECMA-376) so Excel opens it with ZERO warnings.
 */
import type { XlsxCellInput, XlsxRowInput, XlsxSheetInput, XlsxStyleDef } from '../../fot-admin/src/lib/xlsxBuilder';
export { buildXlsxBytes, downloadXlsxFile, colLetters } from '../../fot-admin/src/lib/xlsxBuilder';
export type { XlsxCellInput, XlsxRowInput, XlsxSheetInput, XlsxStyleDef };
