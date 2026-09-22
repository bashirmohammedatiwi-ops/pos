import type { PrintSettingsDto } from './print-types';

/** Iraqi cash has no coins below 250 IQD, so invoice totals settle on 250 steps. */
export const DEFAULT_TOTAL_ROUNDING = 250;

/** 0 disables rounding. */
export function totalRoundingStep(settings?: Pick<PrintSettingsDto, 'roundTotalTo'> | null) {
  const raw = Number(settings?.roundTotalTo);
  if (!Number.isFinite(raw)) return DEFAULT_TOTAL_ROUNDING;
  return raw <= 1 ? 0 : Math.floor(raw);
}

/**
 * Amount to knock off a total so it lands on the next lower step multiple.
 * Totals below one full step are left alone — rounding them down would zero
 * the invoice and hand the goods over for free.
 */
/** Offer sale prices land on the same 250 IQD cash step. */
export const OFFER_PRICE_STEP = 250;

export function roundToStep(value: number, step = OFFER_PRICE_STEP) {
  if (step <= 1) return Math.max(0, Math.round(Number(value) || 0));
  const n = Math.max(0, Number(value) || 0);
  return Math.round(n / step) * step;
}

/** Nearest 250 IQD. If that would wipe a real markdown, drop one step below original. */
export function roundOfferSalePrice(salePrice: number, originalPrice: number, step = OFFER_PRICE_STEP) {
  const original = Math.max(0, Math.round(Number(originalPrice) || 0));
  const sale = Math.max(0, Number(salePrice) || 0);
  const rounded = roundToStep(sale, step);
  if (original <= 0) return rounded;
  if (sale < original && rounded >= original) {
    let down = Math.floor(original / step) * step;
    if (down >= original) down -= step;
    return Math.max(0, down);
  }
  return rounded;
}

export function totalRoundingDiscount(total: number, step: number) {
  if (step <= 1 || !Number.isFinite(total)) return 0;
  const amount = Math.round(total);
  if (amount < step) return 0;
  return amount % step;
}
