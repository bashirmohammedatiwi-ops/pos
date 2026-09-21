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
export function totalRoundingDiscount(total: number, step: number) {
  if (step <= 1 || !Number.isFinite(total)) return 0;
  const amount = Math.round(total);
  if (amount < step) return 0;
  return amount % step;
}
