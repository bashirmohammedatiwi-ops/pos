/** Shared settings barcode for every FOT price-checker device. */
export const PRICE_CHECKER_SETTINGS_QR = 'FOTPCSETTINGS';

export function normalizePriceCheckerCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isPriceCheckerSettingsQr(raw: string): boolean {
  return normalizePriceCheckerCode(raw) === PRICE_CHECKER_SETTINGS_QR;
}
