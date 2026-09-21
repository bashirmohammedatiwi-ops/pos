export const DISCOUNT_QR_PREFIX = 'FOTDQ';

const CODE_RE = /^FOTDQ[0-9A-F]{16}$/;

export function normalizeDiscountQrCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isDiscountQrCode(raw: string): boolean {
  return CODE_RE.test(normalizeDiscountQrCode(raw));
}

export type DiscountQrPerson = {
  id: number;
  name: string;
  code: string;
};
