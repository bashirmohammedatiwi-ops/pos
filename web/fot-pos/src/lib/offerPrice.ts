import { roundOfferSalePrice } from '@fot/shared';

/** Offer unit price on the same 250 IQD step as price-checker / admin. */
export function offerSalePrice(price: number, originalPrice: number): number {
  const original = Number(originalPrice) || 0;
  const sale = Number(price) || 0;
  if (original <= 0 || sale <= 0 || sale >= original) return sale;
  return roundOfferSalePrice(sale, original);
}

export function withOfferSalePrice<T extends { price: number; originalPrice: number; discountPercent?: number | null }>(
  p: T,
): T {
  const original = Number(p.originalPrice || p.price) || 0;
  const rounded = offerSalePrice(Number(p.price), original);
  if (rounded === Number(p.price)) return p;
  const discountPercent = original > 0 && rounded < original
    ? Math.round((1 - rounded / original) * 100)
    : 0;
  return { ...p, price: rounded, originalPrice: original, discountPercent };
}

export function withOfferSalePrices<T extends { price: number; originalPrice: number; discountPercent?: number | null }>(
  list: T[] | null | undefined,
): T[] {
  return (list ?? []).map(withOfferSalePrice);
}
