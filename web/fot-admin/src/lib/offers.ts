import { OFFER_PRICE_STEP, roundOfferSalePrice, roundToStep } from '@fot/shared';

export { OFFER_PRICE_STEP };

/** 0 = نسبة موحّدة، 1 = مجموعة مطلوبة، 2 = أسعار فردية لكل منتج */
export const OFFER_TYPE = {
  percent: 0,
  bundle: 1,
  pricedGroup: 2,
} as const;

/** 0 = نسبة %، 1 = مبلغ يُطرح، 2 = سعر بيع نهائي */
export const DISCOUNT_TYPE = {
  percent: 0,
  amountOff: 1,
  salePrice: 2,
} as const;

export function offerTypeLabel(type: number) {
  if (type === OFFER_TYPE.bundle) return 'مجموعة مطلوبة';
  if (type === OFFER_TYPE.pricedGroup) return 'أسعار فردية';
  return 'خصم نسبة';
}

export function offerSalePrice(original: number, discount: number, discountType: number) {
  const src = Number(original) || 0;
  const value = Number(discount) || 0;
  const raw = discountType === DISCOUNT_TYPE.salePrice
    ? Math.max(0, value)
    : discountType === DISCOUNT_TYPE.amountOff
      ? Math.max(0, src - value)
      : Math.max(0, src * (1 - value / 100));
  return roundOfferSalePrice(raw, src);
}

export function offerPercent(original: number, discount: number, discountType: number) {
  const src = Number(original) || 0;
  if (src <= 0) return 0;
  const sale = offerSalePrice(src, discount, discountType);
  return Math.max(0, Math.min(100, Math.round((1 - sale / src) * 100)));
}

export function toOfferDiscount(original: number, mode: 'percent' | 'price', raw: number) {
  const src = Number(original) || 0;
  const value = Number(raw);
  if (mode === 'percent') {
    const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    return { discount: pct, discountType: DISCOUNT_TYPE.percent };
  }
  const sale = Number.isFinite(value) ? roundToStep(Math.max(0, value)) : 0;
  return { discount: sale, discountType: DISCOUNT_TYPE.salePrice, impliedPercent: src > 0 ? Math.round((1 - sale / src) * 100) : 0 };
}
