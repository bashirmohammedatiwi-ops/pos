/**
 * Native OpenXML (.xlsx) workbook generator for FOT Manager Portal.
 * نسخة مستقلة من web/fot-admin/src/lib/xlsxBuilder.ts — بناء Docker للمدراء لا يرى مجلد لوحة التحكم.
 */

export interface XlsxStyleDef {
  id: string;
  fontSize?: number;
  bold?: boolean;
  color?: string; // 6-hex RGB e.g. 'FFFFFF' or '#FFFFFF'
  bg?: string; // 6-hex RGB e.g. '4338CA'
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  border?: 'none' | 'thin' | 'topBold';
  numFmt?: string; // e.g. '#,##0', '#,##0.00', '0.0%'
}

export interface XlsxCellInput {
  value: string | number | null | undefined;
  style?: string;
  type?: 'String' | 'Number';
  mergeAcross?: number;
  mergeDown?: number;
}

export interface XlsxRowInput {
  cells: XlsxCellInput[];
  height?: number;
}

export interface XlsxImageInput {
  pngBytes: Uint8Array;
  fromCol: number; // 0-based column index
  fromRow: number; // 0-based row index
  toCol: number; // 0-based column index
  toRow: number; // 0-based row index
  title?: string;
}

export interface XlsxSheetInput {
  name: string;
  rtl?: boolean;
  columnWidths?: number[]; // in pixels (approx)
  rows: XlsxRowInput[];
  autoFilter?: { fromRow: number; toRow: number; cols: number };
  images?: XlsxImageInput[];
}

function cleanHex(hex?: string): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace('#', '').trim().toUpperCase();
  if (h.length === 6) return `FF${h}`;
  if (h.length === 8) return h;
  return undefined;
}

function escXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function colLetters(col1Based: number): string {
  let n = Math.max(1, col1Based);
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Converts pixel width (~72-200px) to Excel character width units. */
function pxToExcelWidth(px: number): number {
  return Math.max(6, Math.round((px / 6.5) * 100) / 100);
}

// ── Minimal ZIP (STORE method 0) packer with CRC-32 ─────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries: { path: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes + name)
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, 0, true); // compression: 0 = STORE
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    localParts.push(local, data);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // compression: STORE
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralParts) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const total = centralOffset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of centralParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

// ── OpenXML Workbook Builder ─────────────────────────────────────────────────

export function buildXlsxBytes(sheets: XlsxSheetInput[], customStyles: XlsxStyleDef[] = []): Uint8Array {
  const encoder = new TextEncoder();
  const safeSheets = sheets.length > 0 ? sheets : [{ name: 'البيانات', rows: [] }];

  // Built-in + custom styles registry
  const defaultStyles: XlsxStyleDef[] = [
    { id: 'default', fontSize: 10, color: '0F172A', valign: 'center' },
    { id: 'brand', fontSize: 12, bold: true, color: 'FFFFFF', bg: '4338CA', align: 'center', valign: 'center', border: 'thin' },
    { id: 'brandSub', fontSize: 10, color: 'E0E7FF', bg: '4338CA', align: 'center', valign: 'center', border: 'thin' },
    { id: 'hero', fontSize: 13, bold: true, color: 'FFFFFF', bg: '4338CA', align: 'center', valign: 'center', border: 'thin' },
    { id: 'heroSub', fontSize: 10, color: 'E0E7FF', bg: '4338CA', align: 'center', valign: 'center', wrap: true, border: 'thin' },
    { id: 'title', fontSize: 15, bold: true, color: '0F172A', valign: 'center' },
    { id: 'titleSub', fontSize: 10, color: '475569', valign: 'center' },
    { id: 'sub', fontSize: 10, color: '64748B', valign: 'center' },
    { id: 'section', fontSize: 11, bold: true, color: '312E81', bg: 'EEF2FF', valign: 'center', border: 'thin' },
    { id: 'head', fontSize: 10, bold: true, color: 'FFFFFF', bg: '312E81', align: 'center', valign: 'center', wrap: true, border: 'thin' },
    { id: 'head2', fontSize: 10, bold: true, color: '1E293B', bg: 'CBD5E1', align: 'center', valign: 'center', border: 'thin' },
    { id: 'lbl', fontSize: 9.5, bold: true, color: '475569', bg: 'F8FAFC', valign: 'center', border: 'thin' },
    { id: 'val', fontSize: 10, bold: true, color: '0F172A', valign: 'center', wrap: true, border: 'thin' },
    { id: 'kpiL', fontSize: 9.5, bold: true, color: '475569', bg: 'F1F5F9', align: 'center', valign: 'center', wrap: true, border: 'thin' },
    { id: 'kpiLabel', fontSize: 9.5, bold: true, color: '475569', bg: 'F1F5F9', align: 'center', valign: 'center', wrap: true, border: 'thin' },
    { id: 'kpiV', fontSize: 13, bold: true, color: '0F172A', bg: 'FFFFFF', align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0.00' },
    { id: 'kpiValue', fontSize: 13, bold: true, color: '0F172A', bg: 'FFFFFF', align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0.00' },
    { id: 'kpiI', fontSize: 13, bold: true, color: '0F172A', bg: 'FFFFFF', align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
    { id: 'kpiInt', fontSize: 13, bold: true, color: '0F172A', bg: 'FFFFFF', align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
    { id: 'kpiP', fontSize: 13, bold: true, color: '4338CA', bg: 'FFFFFF', align: 'center', valign: 'center', border: 'thin', numFmt: '0.0%' },
    { id: 'kpiPct', fontSize: 13, bold: true, color: '4338CA', bg: 'FFFFFF', align: 'center', valign: 'center', border: 'thin', numFmt: '0.0%' },
    { id: 'plain', fontSize: 10, color: '0F172A', valign: 'center', border: 'thin' },
    { id: 'plainC', fontSize: 10, color: '0F172A', align: 'center', valign: 'center', border: 'thin' },
    { id: 'plainW', fontSize: 10, color: '0F172A', valign: 'center', wrap: true, border: 'thin' },
    { id: 'plainWrap', fontSize: 10, color: '0F172A', valign: 'center', wrap: true, border: 'thin' },
    { id: 'zebra', fontSize: 10, color: '0F172A', bg: 'F8FAFC', valign: 'center', border: 'thin' },
    { id: 'zebraC', fontSize: 10, color: '0F172A', bg: 'F8FAFC', align: 'center', valign: 'center', border: 'thin' },
    { id: 'zebraWrap', fontSize: 10, color: '0F172A', bg: 'F8FAFC', valign: 'center', wrap: true, border: 'thin' },
    { id: 'rank', fontSize: 10, bold: true, color: '64748B', bg: 'F1F5F9', align: 'center', valign: 'center', border: 'thin' },
    { id: 'num', fontSize: 10, color: '0F172A', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0.00' },
    { id: 'numZ', fontSize: 10, color: '0F172A', bg: 'F8FAFC', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0.00' },
    { id: 'int', fontSize: 10, color: '0F172A', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0' },
    { id: 'intZ', fontSize: 10, color: '0F172A', bg: 'F8FAFC', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0' },
    { id: 'pct', fontSize: 10, color: '475569', align: 'right', valign: 'center', border: 'thin', numFmt: '0.0%' },
    { id: 'pctZ', fontSize: 10, color: '475569', bg: 'F8FAFC', align: 'right', valign: 'center', border: 'thin', numFmt: '0.0%' },
    { id: 'money', fontSize: 10, bold: true, color: '4338CA', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0.00' },
    { id: 'moneyZ', fontSize: 10, bold: true, color: '4338CA', bg: 'F8FAFC', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0.00' },
    { id: 'barCell', fontSize: 9.5, bold: true, color: '4338CA', valign: 'center', border: 'thin' },
    { id: 'barCellZ', fontSize: 9.5, bold: true, color: '4338CA', bg: 'F8FAFC', valign: 'center', border: 'thin' },
    { id: 'total', fontSize: 10, bold: true, color: '0F172A', bg: 'EEF2FF', valign: 'center', border: 'topBold' },
    { id: 'totalN', fontSize: 10, bold: true, color: '0F172A', bg: 'EEF2FF', align: 'right', valign: 'center', border: 'topBold', numFmt: '#,##0.00' },
    { id: 'totalNum', fontSize: 10, bold: true, color: '0F172A', bg: 'EEF2FF', align: 'right', valign: 'center', border: 'topBold', numFmt: '#,##0.00' },
    { id: 'totalInt', fontSize: 10, bold: true, color: '0F172A', bg: 'EEF2FF', align: 'right', valign: 'center', border: 'topBold', numFmt: '#,##0' },
    { id: 'note', fontSize: 9.5, color: '92400E', bg: 'FFFBEB', valign: 'center', wrap: true, border: 'thin' },
    { id: 'nav', fontSize: 10, color: '334155', bg: 'F8FAFC', valign: 'center', wrap: true, border: 'thin' },
    { id: 'foot', fontSize: 9, color: '94A3B8', align: 'center', valign: 'center' },
    { id: 'kicker', fontSize: 10, bold: true, color: '8A7340', valign: 'center' },
    { id: 'kpi', fontSize: 12, bold: true, color: '101628', bg: 'F4F1EA', align: 'right', valign: 'center', border: 'thin', numFmt: '#,##0' },
    { id: 'find', fontSize: 10.5, color: '101628', valign: 'center', wrap: true },
  ];

  const allStyles = [...defaultStyles];
  for (const cs of customStyles) {
    const idx = allStyles.findIndex(s => s.id === cs.id);
    if (idx >= 0) allStyles[idx] = cs;
    else allStyles.push(cs);
  }

  // Build numFmts, fonts, fills, borders, cellXfs
  const numFmtMap = new Map<string, number>();
  let nextNumFmtId = 164;
  const numFmtsXml: string[] = [];

  const fontsXml: string[] = [];
  const fontKeyMap = new Map<string, number>();

  // Fill 0 = none, Fill 1 = gray125 (required by Excel OpenXML spec)
  const fillsXml: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  const fillKeyMap = new Map<string, number>();

  // Border 0 = none, Border 1 = thin, Border 2 = topBold
  const bordersXml: string[] = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>`,
    `<border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="medium"><color rgb="FF312E81"/></top>
      <bottom style="double"><color rgb="FF312E81"/></bottom>
      <diagonal/>
    </border>`,
  ];

  const styleIdToXfIndex = new Map<string, number>();
  const cellXfsXml: string[] = [];

  for (const st of allStyles) {
    let numFmtId = 0;
    if (st.numFmt) {
      let existing = numFmtMap.get(st.numFmt);
      if (existing === undefined) {
        existing = nextNumFmtId++;
        numFmtMap.set(st.numFmt, existing);
        numFmtsXml.push(`<numFmt numFmtId="${existing}" formatCode="${escXml(st.numFmt)}"/>`);
      }
      numFmtId = existing;
    }

    const fSize = st.fontSize ?? 10;
    const fColor = cleanHex(st.color) ?? 'FF0F172A';
    const fBold = st.bold ? 1 : 0;
    const fontKey = `${fSize}|${fColor}|${fBold}`;
    let fontId = fontKeyMap.get(fontKey);
    if (fontId === undefined) {
      fontId = fontsXml.length;
      fontKeyMap.set(fontKey, fontId);
      fontsXml.push(
        `<font>${fBold ? '<b/>' : ''}<sz val="${fSize}"/><color rgb="${fColor}"/><name val="Tahoma"/><family val="2"/></font>`,
      );
    }

    let fillId = 0;
    const bgHex = cleanHex(st.bg);
    if (bgHex) {
      let existingFill = fillKeyMap.get(bgHex);
      if (existingFill === undefined) {
        existingFill = fillsXml.length;
        fillKeyMap.set(bgHex, existingFill);
        fillsXml.push(
          `<fill><patternFill patternType="solid"><fgColor rgb="${bgHex}"/><bgColor indexed="64"/></patternFill></fill>`,
        );
      }
      fillId = existingFill;
    }

    const borderId = st.border === 'thin' ? 1 : st.border === 'topBold' ? 2 : 0;
    const hAlign = st.align ? ` horizontal="${st.align}"` : '';
    const vAlign = ` vertical="${st.valign ?? 'center'}"`;
    const wrap = st.wrap ? ' wrapText="1"' : '';
    const xfIndex = cellXfsXml.length;
    styleIdToXfIndex.set(st.id, xfIndex);

    cellXfsXml.push(
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
        ` applyFont="1" applyFill="${fillId > 0 ? 1 : 0}" applyBorder="${borderId > 0 ? 1 : 0}" applyAlignment="1"${numFmtId > 0 ? ' applyNumberFormat="1"' : ''}>` +
        `<alignment${hAlign}${vAlign}${wrap} readingOrder="2"/>` +
        `</xf>`,
    );
  }

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (numFmtsXml.length > 0 ? `<numFmts count="${numFmtsXml.length}">${numFmtsXml.join('')}</numFmts>` : '') +
    `<fonts count="${fontsXml.length}">${fontsXml.join('')}</fonts>` +
    `<fills count="${fillsXml.length}">${fillsXml.join('')}</fills>` +
    `<borders count="${bordersXml.length}">${bordersXml.join('')}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${cellXfsXml.length}">${cellXfsXml.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  // Build each worksheet XML + optional Drawings/Media
  const usedSheetNames = new Set<string>();
  const sheetMeta: {
    name: string;
    relId: string;
    fileName: string;
    xml: string;
    relsXml?: string;
  }[] = [];
  const drawingEntries: { path: string; data: Uint8Array }[] = [];
  const drawingOverrideParts: string[] = [];
  let mediaCounter = 0;
  let drawingCounter = 0;

  safeSheets.forEach((sh, idx) => {
    let baseName = (sh.name || `ورقة ${idx + 1}`)
      .replace(/[\\/*?:\[\]]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 28);
    if (!baseName) baseName = `Sheet${idx + 1}`;
    let finalName = baseName;
    let suffix = 2;
    while (usedSheetNames.has(finalName.toLowerCase())) {
      finalName = `${baseName.slice(0, 25)} (${suffix++})`;
    }
    usedSheetNames.add(finalName.toLowerCase());

    const merges: string[] = [];
    const occupied = new Set<string>(); // "r:c" reserved by mergeDown
    const rowsXml: string[] = [];
    let maxColSeen = sh.columnWidths?.length ?? 1;

    sh.rows.forEach((rInput, rIdx) => {
      const rNum = rIdx + 1;
      let cNum = 1;
      const cellsXml: string[] = [];

      for (const cellIn of rInput.cells) {
        while (occupied.has(`${rNum}:${cNum}`)) {
          cNum++;
        }

        const xfIdx = styleIdToXfIndex.get(cellIn.style ?? 'default') ?? 0;
        const mAcross = Math.max(0, Math.floor(cellIn.mergeAcross ?? 0));
        const mDown = Math.max(0, Math.floor(cellIn.mergeDown ?? 0));

        const startCol = cNum;
        const endCol = cNum + mAcross;
        const endRow = rNum + mDown;
        if (endCol > maxColSeen) maxColSeen = endCol;

        if (mAcross > 0 || mDown > 0) {
          merges.push(`<mergeCell ref="${colLetters(startCol)}${rNum}:${colLetters(endCol)}${endRow}"/>`);
          for (let rr = rNum; rr <= endRow; rr++) {
            for (let cc = startCol; cc <= endCol; cc++) {
              if (rr === rNum && cc === startCol) continue;
              occupied.add(`${rr}:${cc}`);
            }
          }
        }

        const ref = `${colLetters(startCol)}${rNum}`;
        const isNum =
          cellIn.type === 'Number' ||
          (cellIn.type === undefined && typeof cellIn.value === 'number' && Number.isFinite(cellIn.value));

        if (isNum) {
          const nVal = typeof cellIn.value === 'number' ? cellIn.value : Number(cellIn.value);
          const safeNum = Number.isFinite(nVal) ? nVal : 0;
          cellsXml.push(`<c r="${ref}" s="${xfIdx}"><v>${safeNum}</v></c>`);
        } else {
          const strVal = cellIn.value == null ? '' : String(cellIn.value);
          if (strVal.length === 0) {
            cellsXml.push(`<c r="${ref}" s="${xfIdx}"/>`);
          } else {
            const preserve = /^\s|\s$|\n/.test(strVal) ? ' xml:space="preserve"' : '';
            cellsXml.push(`<c r="${ref}" s="${xfIdx}" t="inlineStr"><is><t${preserve}>${escXml(strVal)}</t></is></c>`);
          }
        }

        // Emit styled blank cells across horizontal merge so borders render cleanly around merged boxes
        for (let cc = startCol + 1; cc <= endCol; cc++) {
          cellsXml.push(`<c r="${colLetters(cc)}${rNum}" s="${xfIdx}"/>`);
        }

        cNum = endCol + 1;
      }

      const htAttr = rInput.height ? ` ht="${rInput.height}" customHeight="1"` : '';
      rowsXml.push(`<row r="${rNum}"${htAttr}>${cellsXml.join('')}</row>`);
    });

    const widths = sh.columnWidths && sh.columnWidths.length > 0 ? sh.columnWidths : [];
    const colsChildren: string[] = [];
    const totalCols = Math.max(widths.length, maxColSeen, 1);
    for (let c = 1; c <= totalCols; c++) {
      const px = widths[c - 1] ?? 100;
      const w = pxToExcelWidth(px);
      colsChildren.push(`<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`);
    }

    // Optional embedded images/charts via DrawingML
    let drawingTag = '';
    let sheetRelsXml: string | undefined;
    const validImages = (sh.images ?? []).filter(im => im.pngBytes && im.pngBytes.length > 0);
    if (validImages.length > 0) {
      drawingCounter++;
      const dIndex = drawingCounter;
      drawingTag = `<drawing r:id="rId1"/>`;
      sheetRelsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${dIndex}.xml"/>` +
        `</Relationships>`;

      const anchors: string[] = [];
      const dRels: string[] = [];

      validImages.forEach((im, imIdx) => {
        mediaCounter++;
        const imgId = mediaCounter;
        const relId = `rId${imIdx + 1}`;
        const mediaName = `image${imgId}.png`;
        drawingEntries.push({
          path: `xl/media/${mediaName}`,
          data: im.pngBytes,
        });
        dRels.push(
          `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`,
        );

        const title = escXml(im.title ?? `Chart ${imIdx + 1}`);
        anchors.push(
          `<xdr:twoCellAnchor editAs="oneCell">` +
            `<xdr:from><xdr:col>${Math.max(0, im.fromCol)}</xdr:col><xdr:colOff>45720</xdr:colOff><xdr:row>${Math.max(0, im.fromRow)}</xdr:row><xdr:rowOff>45720</xdr:rowOff></xdr:from>` +
            `<xdr:to><xdr:col>${Math.max(im.fromCol + 1, im.toCol)}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.max(im.fromRow + 1, im.toRow)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
            `<xdr:pic>` +
              `<xdr:nvPicPr>` +
                `<xdr:cNvPr id="${imIdx + 2}" name="${title}"/>` +
                `<xdr:cNvPicPr><a:picLocks noChangeAspect="0"/></xdr:cNvPicPr>` +
              `</xdr:nvPicPr>` +
              `<xdr:blipFill>` +
                `<a:blip r:embed="${relId}"/>` +
                `<a:stretch><a:fillRect/></a:stretch>` +
              `</xdr:blipFill>` +
              `<xdr:spPr>` +
                `<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>` +
                `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
              `</xdr:spPr>` +
            `</xdr:pic>` +
            `<xdr:clientData/>` +
          `</xdr:twoCellAnchor>`,
        );
      });

      const drawingXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
        `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        anchors.join('') +
        `</xdr:wsDr>`;

      const drawingRelsXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        dRels.join('') +
        `</Relationships>`;

      drawingEntries.push({
        path: `xl/drawings/drawing${dIndex}.xml`,
        data: encoder.encode(drawingXml),
      });
      drawingEntries.push({
        path: `xl/drawings/_rels/drawing${dIndex}.xml.rels`,
        data: encoder.encode(drawingRelsXml),
      });
      drawingOverrideParts.push(
        `<Override PartName="/xl/drawings/drawing${dIndex}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      );
    }

    const rtl = sh.rtl !== false ? ' rightToLeft="1"' : '';
    const tabSelected = idx === 0 ? ' tabSelected="1"' : '';

    // NOTE: No <pane state="frozen"/> is emitted so every worksheet scrolls 100% freely from top to bottom on any screen size.
    const wsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheetViews><sheetView${rtl}${tabSelected} workbookViewId="0"/></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/>` +
      (colsChildren.length > 0 ? `<cols>${colsChildren.join('')}</cols>` : '') +
      `<sheetData>${rowsXml.join('')}</sheetData>` +
      (merges.length > 0 ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '') +
      drawingTag +
      `</worksheet>`;

    sheetMeta.push({
      name: finalName,
      relId: `rId${idx + 1}`,
      fileName: `sheet${idx + 1}.xml`,
      xml: wsXml,
      relsXml: sheetRelsXml,
    });
  });

  const stylesRelId = `rId${sheetMeta.length + 1}`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    sheetMeta
      .map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="${s.relId}"/>`)
      .join('') +
    `</sheets>` +
    `</workbook>`;

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetMeta
      .map(
        s =>
          `<Relationship Id="${s.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${s.fileName}"/>`,
      )
      .join('') +
    `<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (mediaCounter > 0 ? `<Default Extension="png" ContentType="image/png"/>` : '') +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheetMeta
      .map(
        s =>
          `<Override PartName="/xl/worksheets/${s.fileName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    drawingOverrideParts.join('') +
    `</Types>`;

  const zipEntries: { path: string; data: Uint8Array }[] = [
    { path: '[Content_Types].xml', data: encoder.encode(contentTypesXml) },
    { path: '_rels/.rels', data: encoder.encode(rootRelsXml) },
    { path: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
    { path: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml) },
    { path: 'xl/styles.xml', data: encoder.encode(stylesXml) },
  ];

  for (const s of sheetMeta) {
    zipEntries.push({
      path: `xl/worksheets/${s.fileName}`,
      data: encoder.encode(s.xml),
    });
    if (s.relsXml) {
      zipEntries.push({
        path: `xl/worksheets/_rels/${s.fileName}.rels`,
        data: encoder.encode(s.relsXml),
      });
    }
  }

  for (const d of drawingEntries) {
    zipEntries.push(d);
  }

  return buildZip(zipEntries);
}

export function downloadXlsxFile(fileName: string, sheets: XlsxSheetInput[], customStyles?: XlsxStyleDef[]) {
  const bytes = buildXlsxBytes(sheets, customStyles);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cleanBase = fileName
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/[^\w\u0600-\u06FF.-]+/g, '_')
    .replace(/_+/g, '_') || 'report';
  a.download = `${cleanBase}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
