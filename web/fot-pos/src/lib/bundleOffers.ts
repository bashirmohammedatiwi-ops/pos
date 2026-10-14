import { roundOfferSalePrice } from '@fot/shared';

import type { CartLine } from '@/lib/sale';

import { offerSalePrice } from '@/lib/offerPrice';



/**
 * شروط تفعيل العرض المشروط.
 * matchMode: 0 كل المواد المشروطة · 1 عدد منها (minCount).
 * countBasis: 0 مواد مختلفة · 1 عدد قطع (تكرار نفس المادة يُحسب).
 */
export type BundleConditions = {

  matchMode: 0 | 1;

  minCount: number;

  countBasis: 0 | 1;

  /** أقل كمية للمادة كي تُحسب ضمن الشرط. */
  minQtyEach: number;

  /** أقل قيمة لمجموع المواد المشروطة في الفاتورة (0 = بلا حد). */
  minRequiredAmount: number;

  /** خصم نسبة على المواد المشروطة نفسها عند تحقق الشرط (0 = بلا خصم). */
  requiredDiscount: number;

};



export const DEFAULT_BUNDLE_CONDITIONS: BundleConditions = {

  matchMode: 0,

  minCount: 0,

  countBasis: 0,

  minQtyEach: 1,

  minRequiredAmount: 0,

  requiredDiscount: 0,

};



export type BundleOfferRule = {

  id: number;

  name: string;

  priority: number;

  requiredSeqs: number[];

  discounted: { seq: number; discount: number; discountType: number }[];

  /** غائبة في القواعد المخزّنة من إصدار أقدم — تُعامل كالافتراضي. */
  conditions?: BundleConditions;

};



export type PosBundleOfferDto = {

  id: number;

  name: string;

  priority: number;

  requiredItemSeqs: number[];

  discounted: { itemSeq: number; discount: number; discountType: number; detailRole: number }[];

  conditions?: Partial<BundleConditions> | null;

};



function normalizeConditions(raw?: Partial<BundleConditions> | null): BundleConditions {

  if (!raw) return { ...DEFAULT_BUNDLE_CONDITIONS };

  const num = (v: unknown, d: number) => {

    const n = Number(v);

    return Number.isFinite(n) ? n : d;

  };

  return {

    matchMode: num(raw.matchMode, 0) === 1 ? 1 : 0,

    minCount: Math.max(0, Math.floor(num(raw.minCount, 0))),

    countBasis: num(raw.countBasis, 0) === 1 ? 1 : 0,

    minQtyEach: Math.max(0.001, num(raw.minQtyEach, 1)),

    minRequiredAmount: Math.max(0, num(raw.minRequiredAmount, 0)),

    requiredDiscount: Math.min(100, Math.max(0, num(raw.requiredDiscount, 0))),

  };

}



export function mapBundleOffers(dtos: PosBundleOfferDto[]): BundleOfferRule[] {

  return (dtos ?? []).map(o => ({

    id: o.id,

    name: o.name,

    priority: o.priority,

    requiredSeqs: o.requiredItemSeqs ?? [],

    discounted: (o.discounted ?? [])

      .filter(d => d.detailRole === 0)

      .map(d => ({ seq: d.itemSeq, discount: d.discount, discountType: d.discountType })),

    conditions: normalizeConditions(o.conditions),

  })).filter(r => r.requiredSeqs.length > 0 && (r.discounted.length > 0 || (r.conditions?.requiredDiscount ?? 0) > 0));

}



function saleFromDiscount(original: number, discount: number, discountType: number) {

  const src = Number(original) || 0;

  const value = Number(discount) || 0;

  const raw = discountType === 2

    ? Math.max(0, value)

    : discountType === 1

      ? Math.max(0, src - value)

      : Math.max(0, src * (1 - value / 100));

  return roundOfferSalePrice(raw, src);

}



/** Full list price (before any markdown). */

export function listUnitPrice(line: CartLine) {

  return Number(line.originalPrice) || Number(line.catalogUnitPrice ?? line.price) || 0;

}



/** Catalog sale unit price (percent offer / stored discount) — not bundle. */

export function catalogUnitPrice(line: CartLine) {

  const list = listUnitPrice(line);

  const catalog = Number(line.catalogUnitPrice ?? line.price) || 0;

  if (catalog <= 0) return list;

  if (list > 0 && catalog > list) return list;

  return catalog;

}



type CartTotals = Map<number, { qty: number; amount: number }>;



/** كمية وقيمة كل مادة في الفاتورة (القيمة بسعر الكتالوج — قبل خصم العرض المشروط). */
function cartTotals(cart: CartLine[]): CartTotals {

  const map: CartTotals = new Map();

  for (const l of cart) {

    const seq = l.articleSeq ?? 0;

    if (seq <= 0) continue;

    const qty = Math.max(0, Number(l.quantity) || 0);

    if (qty <= 0) continue;

    const cur = map.get(seq) ?? { qty: 0, amount: 0 };

    cur.qty += qty;

    cur.amount += qty * catalogUnitPrice(l);

    map.set(seq, cur);

  }

  return map;

}



export type BundleEvaluation = {

  satisfied: boolean;

  /** ما تحقق من شرط العدد (مواد أو قطع). */
  have: number;

  /** المطلوب لشرط العدد. */
  need: number;

  /** وحدة العدّ للعرض في الواجهة. */
  unit: 'مادة' | 'قطعة';

  amountHave: number;

  amountNeed: number;

  /** هل في الفاتورة أي مادة من العرض (مشروطة أو مخفّضة)؟ */
  touched: boolean;

};



export function evaluateBundle(rule: BundleOfferRule, totals: CartTotals): BundleEvaluation {

  const c = rule.conditions ?? DEFAULT_BUNDLE_CONDITIONS;

  const required = [...new Set(rule.requiredSeqs)];

  let distinctMet = 0;

  let pieces = 0;

  let amount = 0;

  let touched = false;

  for (const seq of required) {

    const t = totals.get(seq);

    if (!t) continue;

    touched = true;

    amount += t.amount;

    if (t.qty >= c.minQtyEach) distinctMet += 1;

    pieces += t.qty;

  }

  if (!touched) touched = rule.discounted.some(d => totals.has(d.seq));



  let have: number;

  let need: number;

  let unit: BundleEvaluation['unit'] = 'مادة';

  if (c.matchMode === 1) {

    need = Math.max(1, c.minCount);

    if (c.countBasis === 1) {

      have = pieces;

      unit = 'قطعة';

    } else {

      have = distinctMet;

    }

  } else {

    need = required.length;

    have = distinctMet;

  }

  const countOk = required.length > 0 && have >= need;

  const amountOk = c.minRequiredAmount <= 0 || amount >= c.minRequiredAmount;

  return {

    satisfied: countOk && amountOk,

    have,

    need,

    unit,

    amountHave: amount,

    amountNeed: c.minRequiredAmount,

    touched,

  };

}



function resolveWithTotals(

  articleSeq: number,

  line: CartLine,

  totals: CartTotals,

  rules: BundleOfferRule[],

  satisfiedCache: Map<number, boolean>,

): { price: number; offerName: string | null } {

  const list = listUnitPrice(line);

  const catalog = catalogUnitPrice(line);

  if (!articleSeq || !rules.length || list <= 0) {

    return { price: offerSalePrice(catalog, list), offerName: null };

  }



  let bestPrice = catalog;

  let bestName: string | null = null;

  let bestPriority = -Infinity;



  for (const rule of rules) {

    let ok = satisfiedCache.get(rule.id);

    if (ok === undefined) {

      ok = evaluateBundle(rule, totals).satisfied;

      satisfiedCache.set(rule.id, ok);

    }

    if (!ok) continue;

    let sale: number | null = null;

    if (rule.requiredSeqs.includes(articleSeq)) {

      // المواد المشروطة تبقى بسعر الكتالوج إلا إذا حدّد العرض خصماً عليها

      const pct = rule.conditions?.requiredDiscount ?? 0;

      if (pct > 0) sale = saleFromDiscount(list, pct, 0);

    } else {

      const disc = rule.discounted.find(d => d.seq === articleSeq);

      if (disc) sale = saleFromDiscount(list, disc.discount, disc.discountType);

    }

    if (sale == null || sale >= list) continue;

    if (rule.priority > bestPriority || (rule.priority === bestPriority && sale < bestPrice)) {

      bestPriority = rule.priority;

      bestPrice = sale;

      bestName = rule.name;

    }

  }



  return {

    price: offerSalePrice(bestPrice, list),

    offerName: bestName,

  };

}



export function resolveBundleUnitPrice(

  articleSeq: number,

  line: CartLine,

  cart: CartLine[],

  rules: BundleOfferRule[],

): { price: number; offerName: string | null } {

  return resolveWithTotals(articleSeq, line, cartTotals(cart), rules, new Map());

}



export function applyBundlePricingToCart(cart: CartLine[], rules: BundleOfferRule[]): CartLine[] {

  if (!rules.length || cart.length === 0) return cart;

  const totals = cartTotals(cart);

  const satisfied = new Map<number, boolean>();

  return cart.map(line => {

    if (line.sourceItemId != null || line.manualPrice) return line;

    const seq = line.articleSeq ?? 0;

    const list = listUnitPrice(line);

    const { price } = resolveWithTotals(seq, line, totals, rules, satisfied);

    const catalog = catalogUnitPrice(line);

    if (price === line.price && list === line.originalPrice) return line;

    return {

      ...line,

      price,

      originalPrice: list,

      catalogUnitPrice: line.catalogUnitPrice ?? catalog,

    };

  });

}



export type BundleProgress = BundleEvaluation & { id: number; name: string };



/** حالة العروض المشروطة التي تمسّ الفاتورة الحالية — مفعّلة أو قريبة من التفعيل. */
export function bundleProgress(cart: CartLine[], rules: BundleOfferRule[]): BundleProgress[] {

  if (!rules.length || !cart.length) return [];

  const totals = cartTotals(cart);

  return rules

    .map(rule => ({ id: rule.id, name: rule.name, ...evaluateBundle(rule, totals) }))

    .filter(p => p.touched)

    .sort((a, b) => Number(b.satisfied) - Number(a.satisfied) || (b.have / Math.max(1, b.need)) - (a.have / Math.max(1, a.need)));

}



export function cartPricesEqual(a: CartLine[], b: CartLine[]) {

  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {

    if (a[i].key !== b[i].key || a[i].price !== b[i].price) return false;

  }

  return true;

}
