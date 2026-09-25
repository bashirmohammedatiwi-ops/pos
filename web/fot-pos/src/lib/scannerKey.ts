import { decodeScannerText } from '@fot/shared';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Character the barcode wedge meant to type.
 * Physical key (`e.code`) wins over the character the Arabic layout produced,
 * so FOTDQ is not rewritten into خ ب ف ي ض.
 */
export function latinFromKey(e: { key: string; code: string; shiftKey?: boolean }): string | null {
  if (e.code.startsWith('Key') && e.code.length === 4) {
    const letter = e.code.slice(3);
    if (LETTERS.includes(letter)) {
      if (e.key.length === 1 && e.key.toUpperCase() === letter) return e.key.toUpperCase();
      return letter;
    }
  }
  if (e.code === 'Digit8' && e.shiftKey) return '*';
  if (/^Digit[0-9]$/.test(e.code) || /^Numpad[0-9]$/.test(e.code)) return e.code.slice(-1);
  if (e.code === 'NumpadMultiply') return '*';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return '-';
  if (e.code === 'Period' || e.code === 'NumpadDecimal') return '.';
  if (e.code === 'Slash') return '/';
  if (e.key.length === 1) {
    const code = e.key.charCodeAt(0);
    if (code >= 0xc0 && code <= 0xff) {
      const folded = String.fromCharCode(code & 0x7f);
      if (/[0-9A-Za-z]/.test(folded)) return folded.toUpperCase();
    }
    if (/[0-9A-Za-z*×xX+\-./]/.test(e.key)) return e.key.toUpperCase() === e.key ? e.key : e.key.toUpperCase();
  }
  return null;
}

export function isScannerCharacter(e: { key: string; code: string }): boolean {
  if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Tab') return false;
  return e.key.length === 1 || e.code.startsWith('Key') || e.code.startsWith('Digit') || e.code.startsWith('Numpad');
}

export { decodeScannerText };
