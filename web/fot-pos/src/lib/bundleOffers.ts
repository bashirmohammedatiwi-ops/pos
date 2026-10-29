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

  /** كل giftEvery قطعة مدفوعة من المشروطة ← giftCount قطعة مخفّضة (0 = بلا حد). */
  giftEvery: number;

  giftCount: number;

};



export const DEFAULT_BUNDLE_CONDITIONS: BundleConditions = {

  matchMode: 0,

  minCount: 0,

  countBasis: 0,

  minQtyEach: 1,

  minRequiredAmount: 0,

  requiredDiscount: 0,

  giftEvery: 0,

  giftCount: 0,

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

    ...giftRatio(num(raw.giftEvery, 0), num(raw.giftCount, 0)),

  };

}

function giftRatio(every: number, count: number) {

  const e = Math.max(0, Math.floor(every));

  const c = Math.max(0, Math.floor(count));

  return e > 0 && c > 0 ? { giftEvery: e, giftCount: c } : { giftEvery: 0, giftCount: 0 };

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



/* ─────────────────────────────────────────────────────────────────────────────
 * توزيع القطع: كل قطعة في الفاتورة إما «مدفوعة» (سعر الكتالوج أو خصم المواد المشروطة)
 * أو «مخفّضة» بعرض مشروط (هدية). القطعة التي تكون مشروطة ومخفّضة معاً (هدية من نفس
 * الشجرة) تُخفَّض فقط إن بقي الشرط متحققاً بالقطع الأخرى — والأرخص يُخفَّض أولاً.
 * نسبة الهدايا (giftEvery/giftCount) تحدّ عدد القطع المخفّضة بالقطع المدفوعة.
 * ───────────────────────────────────────────────────────────────────────────── */

type Unit = {
  line: number;
  seq: number;
  qty: number;
  list: number;
  catalog: number;
  /** القطع اليدوية/المرتجعة والكسور (وزن) تُحسب في الشرط لكن لا تُخفَّض. */
  giftable: boolean;
  gift: { price: number; ruleId: number; name: string } | null;
};

function totalsOfUnits(units: Unit[]): CartTotals {
  const map: CartTotals = new Map();
  for (const u of units) {
    if (u.gift) continue;
    const cur = map.get(u.seq) ?? { qty: 0, amount: 0 };
    cur.qty += u.qty;
    cur.amount += u.qty * u.catalog;
    map.set(u.seq, cur);
  }
  return map;
}

function isFixed(line: CartLine) {
  return line.sourceItemId != null || !!line.manualPrice;
}

function sameArticleSlot(a: CartLine, b: CartLine) {
  return a.articleId === b.articleId && a.salesmanId === b.salesmanId && a.groupKey === b.groupKey && !isFixed(a) && !isFixed(b);
}

function baseKey(key: string) {
  const i = key.indexOf('~g');
  return i >= 0 ? key.slice(0, i) : key;
}

/** يعيد قطع سطور الهدايا إلى سطرها الأساسي قبل إعادة التوزيع. */
function mergeGiftLines(cart: CartLine[]): CartLine[] {
  if (!cart.some(l => l.bundleGift)) return cart;
  const out: CartLine[] = [];
  for (const l of cart) {
    if (!l.bundleGift) {
      out.push(l);
      continue;
    }
    const i = out.findIndex(b => !b.bundleGift && sameArticleSlot(b, l));
    if (i >= 0) {
      const b = out[i];
      out[i] = {
        ...b,
        quantity: +(b.quantity + l.quantity).toFixed(3),
        commissionAmount: b.commissionAmount != null || l.commissionAmount != null ? (b.commissionAmount ?? 0) + (l.commissionAmount ?? 0) : undefined,
      };
    } else {
      // حُذف السطر الأساسي: يصبح سطر الهدية هو الأساسي
      const { bundleGift: _g, bundleOfferName: _n, ...rest } = l;
      out.push({ ...rest, key: baseKey(l.key), price: catalogUnitPrice(l) });
    }
  }
  return out;
}

function buildUnits(cart: CartLine[]): Unit[] {
  const units: Unit[] = [];
  cart.forEach((l, line) => {
    const seq = l.articleSeq ?? 0;
    const qty = Math.max(0, Number(l.quantity) || 0);
    if (seq <= 0 || qty <= 0) return;
    const list = listUnitPrice(l);
    const catalog = catalogUnitPrice(l);
    const fixed = isFixed(l);
    const whole = Math.floor(qty + 1e-9);
    for (let k = 0; k < whole; k++) units.push({ line, seq, qty: 1, list, catalog, giftable: !fixed && list > 0, gift: null });
    const frac = +(qty - whole).toFixed(3);
    if (frac > 0) units.push({ line, seq, qty: frac, list, catalog, giftable: false, gift: null });
  });
  return units;
}

function paidRequiredPieces(units: Unit[], required: Set<number>) {
  let n = 0;
  for (const u of units) if (!u.gift && required.has(u.seq)) n += u.qty;
  return n;
}

/** يوزّع الهدايا لكل عرض متحقق (الأولوية الأعلى أولاً) ويعيد العروض المتحققة. */
function allocateGifts(units: Unit[], rules: BundleOfferRule[]) {
  const satisfied: BundleOfferRule[] = [];
  const ordered = [...rules].sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const rule of ordered) {
    if (!evaluateBundle(rule, totalsOfUnits(units)).satisfied) continue;
    satisfied.push(rule);
    const c = rule.conditions ?? DEFAULT_BUNDLE_CONDITIONS;
    const required = new Set(rule.requiredSeqs);
    const discBySeq = new Map(rule.discounted.map(d => [d.seq, d]));
    const limited = c.giftEvery > 0 && c.giftCount > 0;
    const candidates = units
      .filter(u => !u.gift && u.giftable && discBySeq.has(u.seq))
      .map(u => {
        const d = discBySeq.get(u.seq)!;
        return { u, sale: saleFromDiscount(u.list, d.discount, d.discountType) };
      })
      .filter(x => x.sale < x.u.catalog)
      // الأرخص يُخفَّض أولاً، ثم ترتيب السطور
      .sort((a, b) => a.u.list - b.u.list || a.u.line - b.u.line);
    let given = 0;
    for (const x of candidates) {
      x.u.gift = { price: x.sale, ruleId: rule.id, name: rule.name };
      const stillMet = evaluateBundle(rule, totalsOfUnits(units)).satisfied;
      const withinRatio = !limited || given + 1 <= Math.floor(paidRequiredPieces(units, required) / c.giftEvery) * c.giftCount;
      if (stillMet && withinRatio) given += 1;
      else x.u.gift = null;
    }
  }
  return satisfied;
}

/** سعر القطعة المدفوعة: خصم المواد المشروطة لأعلى عرض متحقق، وإلا سعر الكتالوج. */
function paidUnitPrice(seq: number, line: CartLine, satisfied: BundleOfferRule[]) {
  const list = listUnitPrice(line);
  const catalog = catalogUnitPrice(line);
  let best = catalog;
  let bestName: string | null = null;
  let bestPriority = -Infinity;
  for (const rule of satisfied) {
    const pct = rule.conditions?.requiredDiscount ?? 0;
    if (pct <= 0 || !rule.requiredSeqs.includes(seq)) continue;
    const sale = saleFromDiscount(list, pct, 0);
    if (sale >= list) continue;
    if (rule.priority > bestPriority || (rule.priority === bestPriority && sale < best)) {
      bestPriority = rule.priority;
      best = sale;
      bestName = rule.name;
    }
  }
  return { price: offerSalePrice(best, list), offerName: bestName };
}

export function resolveBundleUnitPrice(
  articleSeq: number,
  line: CartLine,
  cart: CartLine[],
  rules: BundleOfferRule[],
): { price: number; offerName: string | null } {
  const merged = mergeGiftLines(cart);
  const units = buildUnits(merged);
  const satisfied = allocateGifts(units, rules);
  const idx = merged.findIndex(l => l.key === baseKey(line.key));
  const gift = units.find(u => u.line === idx && u.gift)?.gift;
  if (line.bundleGift && gift) return { price: gift.price, offerName: gift.name };
  return paidUnitPrice(articleSeq, line, satisfied);
}

export function applyBundlePricingToCart(cart: CartLine[], rules: BundleOfferRule[]): CartLine[] {
  if (cart.length === 0) return cart;
  if (!rules.length) {
    // لا عروض: تعود قطع الهدايا لأسطرها بسعر الكتالوج
    return cart.some(l => l.bundleGift) ? mergeGiftLines(cart) : cart;
  }
  const merged = mergeGiftLines(cart);
  const units = buildUnits(merged);
  const satisfied = allocateGifts(units, rules);

  const out: CartLine[] = [];
  merged.forEach((line, i) => {
    if (isFixed(line)) {
      out.push(line);
      return;
    }
    const seq = line.articleSeq ?? 0;
    const list = listUnitPrice(line);
    const catalog = catalogUnitPrice(line);
    const mine = units.filter(u => u.line === i);
    const paidQty = +mine.filter(u => !u.gift).reduce((s, u) => s + u.qty, 0).toFixed(3);
    // مجموعات الهدايا حسب العرض والسعر
    const groups = new Map<string, { price: number; ruleId: number; name: string; qty: number }>();
    for (const u of mine) {
      if (!u.gift) continue;
      const k = `${u.gift.ruleId}:${u.gift.price}`;
      const g = groups.get(k) ?? { ...u.gift, qty: 0 };
      g.qty += u.qty;
      groups.set(k, g);
    }
    const parts = [...groups.values()];
    const total = Math.max(0.001, Number(line.quantity) || 0);
    const share = (q: number) => (line.commissionAmount != null ? (line.commissionAmount * q) / total : undefined);
    const base = { ...line, originalPrice: list, catalogUnitPrice: line.catalogUnitPrice ?? catalog };

    if (!parts.length || paidQty > 0 || seq <= 0) {
      const paid = seq > 0 ? paidUnitPrice(seq, line, satisfied).price : line.price;
      const qty = parts.length ? paidQty : line.quantity;
      const keep = paid === line.price && list === line.originalPrice && qty === line.quantity && !line.bundleGift && !line.bundleOfferName;
      out.push(keep ? line : { ...base, quantity: qty, price: paid, bundleGift: undefined, bundleOfferName: undefined, commissionAmount: parts.length ? share(qty) : line.commissionAmount });
    }
    parts.forEach((g, j) => {
      // كل القطع مخفّضة بعرض واحد: يبقى سطراً واحداً بلا فصل
      const whole = paidQty <= 0 && j === 0;
      out.push({
        ...base,
        key: whole ? line.key : `${line.key}~g${g.ruleId}${j ? `-${j}` : ''}`,
        quantity: +g.qty.toFixed(3),
        price: g.price,
        bundleGift: whole ? undefined : true,
        bundleOfferName: g.name,
        commissionAmount: share(g.qty),
      });
    });
  });
  return out;
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

    if (a[i].key !== b[i].key || a[i].price !== b[i].price || a[i].quantity !== b[i].quantity) return false;

  }

  return true;

}
