/** Invoice barcode: EAN-13 for price checkers, Code128 only when the number is too long. */

const CODE128_PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010010000', '11010000100',
  '11010011100', '11000111010',
] as const;

const START_B = 104;
const START_C = 105;
const STOP = 106;
/** ISO/IEC 15417 stop is 13 modules: pattern 106 + 2-module terminator. */
const STOP_TERMINATOR = '11';
const QUIET_MODULES = 10;

const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

export type BarcodeGraphic = { svg: string; width: number; height: number };

function patternFor(code: number): string {
  const pattern = CODE128_PATTERNS[code];
  if (!pattern) throw new Error(`Invalid Code128 code: ${code}`);
  return pattern;
}

function checksum(codes: number[]): number {
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  return sum % 103;
}

/** Encode so handheld scanners read the exact invoice digits. Numeric text uses Code C. */
export function encodeCode128(text: string): number[] {
  if (!text) throw new Error('Barcode text is empty');
  const digits = /^\d+$/.test(text);
  const codes: number[] = [];
  if (digits && text.length >= 2) {
    const payload = text.length % 2 === 1 ? `0${text}` : text;
    codes.push(START_C);
    for (let i = 0; i < payload.length; i += 2) codes.push(Number(payload.slice(i, i + 2)));
  } else {
    codes.push(START_B);
    for (const ch of text) {
      const code = ch.charCodeAt(0) - 32;
      if (code < 0 || code > 94) throw new Error(`Unsupported character for Code128: ${ch}`);
      codes.push(code);
    }
  }
  codes.push(checksum(codes), STOP);
  return codes;
}

function moduleCount(codes: number[]): number {
  return codes.reduce((n, code) => n + patternFor(code).length, 0) + STOP_TERMINATOR.length + QUIET_MODULES * 2;
}

function bitsToSvg(bits: string, height: number, moduleWidth: number): BarcodeGraphic {
  const width = bits.length * moduleWidth;
  let x = 0;
  let bars = '';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') {
      bars += `<rect x="${x}" y="0" width="${moduleWidth}" height="${height}" fill="#000"/>`;
    }
    x += moduleWidth;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${bars}</svg>`;
  return { svg, width, height };
}

function fitModuleWidth(modules: number, preferred: number, maxWidth?: number) {
  let moduleWidth = Math.max(2, Math.round(preferred));
  if (maxWidth && maxWidth > 0) {
    const fitted = Math.floor(maxWidth / modules);
    moduleWidth = Math.max(2, Math.min(moduleWidth, fitted || 2));
  }
  return moduleWidth;
}

export function ean13Checksum(d12: string): number {
  if (!/^\d{12}$/.test(d12)) throw new Error('EAN-13 payload must be 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function encodeEan13Bits(d12: string): string {
  const check = ean13Checksum(d12);
  const full = `${d12}${check}`;
  const parity = EAN_PARITY[Number(full[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) {
    const digit = Number(full[i + 1]);
    bits += parity[i] === 'L' ? EAN_L[digit] : EAN_G[digit];
  }
  bits += '01010';
  for (let i = 7; i < 13; i++) bits += EAN_R[Number(full[i])];
  bits += '101';
  return `${'0'.repeat(11)}${bits}${'0'.repeat(7)}`;
}

export function code128Svg(text: string, opts?: { height?: number; moduleWidth?: number; maxWidth?: number }) {
  return renderCode128(text, opts).svg;
}

function renderCode128(text: string, opts?: { height?: number; moduleWidth?: number; maxWidth?: number }): BarcodeGraphic {
  const height = Math.max(160, opts?.height ?? 184);
  const codes = encodeCode128(text);
  const modules = moduleCount(codes);
  const moduleWidth = fitModuleWidth(modules, opts?.moduleWidth ?? 3, opts?.maxWidth);
  const bits = `${'0'.repeat(QUIET_MODULES)}${codes.map(patternFor).join('')}${STOP_TERMINATOR}${'0'.repeat(QUIET_MODULES)}`;
  return bitsToSvg(bits, height, moduleWidth);
}

function renderEan13(d12: string, opts?: { height?: number; moduleWidth?: number; maxWidth?: number }): BarcodeGraphic {
  const height = Math.max(160, opts?.height ?? 184);
  const bits = encodeEan13Bits(d12);
  const moduleWidth = fitModuleWidth(bits.length, opts?.moduleWidth ?? 3, opts?.maxWidth);
  return bitsToSvg(bits, height, moduleWidth);
}

/** Price checkers read EAN-13; longer invoice numbers stay Code128-C. */
export function renderReceiptBarcode(number: number, maxWidth = 0): BarcodeGraphic {
  const digits = String(number).replace(/\D/g, '');
  if (!digits) throw new Error('Barcode text is empty');
  const opts = { height: 184, moduleWidth: 3, maxWidth: maxWidth > 0 ? maxWidth : undefined };
  if (digits.length <= 12) return renderEan13(digits.padStart(12, '0'), opts);
  return renderCode128(digits, opts);
}

function collapseRepeatedDigits(digits: string): string {
  if (digits.length >= 16 && digits.length % 2 === 0) {
    const mid = digits.length / 2;
    const left = digits.slice(0, mid);
    const right = digits.slice(mid);
    if (left === right) return left;
  }
  return digits;
}

function asPositiveInt(value: string): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Recover the printed invoice number from a price-checker / scanner read. */
export function receiptNumberFromScan(raw: string): number {
  const digits = collapseRepeatedDigits(String(raw ?? '').replace(/\D/g, ''));
  if (!digits) return 0;

  if (digits.length === 13 && ean13Checksum(digits.slice(0, 12)) === Number(digits[12])) {
    return asPositiveInt(digits.slice(0, 12));
  }

  if (digits.length === 12) {
    const upcBody = digits.slice(0, 11);
    const upcCheck = ean13Checksum(`0${upcBody}`);
    if (digits.startsWith('20') && upcCheck !== Number(digits[11])) return asPositiveInt(digits);
    if (upcCheck === Number(digits[11]) && upcBody.startsWith('20')) return asPositiveInt(upcBody);
    return asPositiveInt(digits);
  }

  return asPositiveInt(digits);
}

export function formatReceiptNumber(year: number, cashierCode: number, sequence: number) {
  return Number(`${year}${cashierCode}${String(sequence).padStart(6, '0')}`);
}
