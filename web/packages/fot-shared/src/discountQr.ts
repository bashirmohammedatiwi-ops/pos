export const DISCOUNT_QR_PREFIX = 'FOTDQ';

const CODE_RE = /^FOTDQ[0-9A-F]{16}$/;

/** Windows Arabic 101 unshifted keys, so a US wedge scanner still yields the printed code. */
const AR_LAYOUT: Record<string, string> = {
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l',
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm',
  'ذ': '`', 'ج': '[', 'د': ']', 'ك': ';', 'ط': "'", 'و': ',', 'ز': '.', 'ظ': '/',
};

function replaceToken(value: string, from: string, to: string) {
  return value.split(from).join(to);
}

/** Undo Latin-1 bytes a wedge emitted with the high bit set (O → Ï). */
function foldLatin1(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 0xc0 && code <= 0xff) {
      const folded = String.fromCharCode(code & 0x7f);
      out += /[0-9A-Za-z]/.test(folded) ? folded : '';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Windows Arabic layout emits lam-alef as two characters (لأ لإ لآ لا).
 * The sale field already keeps the physical Latin letter, and the hamza
 * half still lands in the box: GT-212 is read as GأTإ-212.
 */
function dropLamAlefTails(value: string): string {
  return value
    .replace(/[Gg]أ/g, 'G')
    .replace(/[Tt]إ/g, 'T')
    .replace(/[Bb]آ/g, 'B')
    .replace(/[Bb]ا/g, m => (m[0] === 'B' ? 'B' : 'b'));
}

/** Scanner text typed through an Arabic keyboard, back to the Latin barcode. */
export function decodeScannerText(raw: string): string {
  const prepared = replaceToken(
    replaceToken(replaceToken(replaceToken(foldLatin1(raw), 'لآ', 'B'), 'لأ', 'G'), 'لإ', 'T'),
    'لا',
    'b',
  );
  const tails = dropLamAlefTails(prepared);
  let out = '';
  for (const ch of tails) out += AR_LAYOUT[ch] ?? ch;
  return dropLamAlefTails(out);
}

export function normalizeDiscountQrCode(raw: string): string {
  const cleaned = decodeScannerText(raw).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  const at = cleaned.indexOf(DISCOUNT_QR_PREFIX);
  if (at >= 0) return cleaned.slice(at, at + DISCOUNT_QR_PREFIX.length + 16);
  // The caret in an RTL field can tear "FOT" off the front and leave "DQ" + the hex body.
  const body = cleaned.match(/DQ([0-9A-F]{16})/);
  if (body && cleaned.length > body[0].length && cleaned.includes('F') && cleaned.includes('O') && cleaned.includes('T')) {
    return DISCOUNT_QR_PREFIX + body[1];
  }
  return cleaned;
}

export function isDiscountQrCode(raw: string): boolean {
  return CODE_RE.test(normalizeDiscountQrCode(raw));
}

export type DiscountQrPerson = {
  id: number;
  name: string;
  code: string;
};
