import { useEffect, useState } from 'react';
import { api, getSeller } from './api';
import { onBrandsChanged } from './access';

/* ─────────────────────────────────────────────────────────────────────────────
 * براندات البائع — كل براند شجرة مواد مستقلة في الإداري.
 * الخادم يرسل الحزمة كاملة (منذ بدء النظام) والحساب كله هنا: أي مدة، كل المحل أو مبيعاتي،
 * فرع محدد، مقارنة بالمدة السابقة — فوري ويعمل حتى مع ضعف الإنترنت (مخزّن محلياً).
 * ───────────────────────────────────────────────────────────────────────────── */

export interface BrandSummary {
  treeSeq: number;
  name: string;
  productCount: number;
  builtAt?: string | null;
  ready: boolean;
}

export interface BrandProduct {
  id: number;
  name: string;
  barcode: string;
  price: number;
}

/** صف: [يوم ISO, مادة, قسم, لي(1/0), كمية, مبلغ] */
export type BrandRow = [string, number, number, number, number, number];
/** فواتير: [يوم, قسم, لي, عدد] */
export type BrandReceiptRow = [string, number, number, number];

export interface BrandPack {
  treeSeq: number;
  name: string;
  builtAt?: string | null;
  from?: string | null;
  products: BrandProduct[];
  sections: { id: number; name: string }[];
  rows: BrandRow[];
  receipts: BrandReceiptRow[];
  /** [يوم, قسم, عدد] فواتير «كل المحل» بلا تكرار — قد تغيب في خادم أقدم. */
  receiptsAll?: [string, number, number][];
}

export type Scope = 'all' | 'mine';

export interface BrandFilter {
  from: string; // YYYY-MM-DD شامل
  to: string; // YYYY-MM-DD شامل
  scope: Scope;
  sectionId: number | null;
}

export interface ProductStat {
  id: number;
  name: string;
  barcode: string;
  price: number;
  qty: number;
  amount: number;
  share: number;
}

export interface BrandReport {
  amount: number;
  qty: number;
  receipts: number;
  productsSold: number;
  activeDays: number;
  days: { day: string; amount: number; qty: number; receipts: number }[];
  products: ProductStat[];
  sections: { id: number; name: string; amount: number; qty: number; receipts: number; share: number }[];
  /** المدة السابقة بنفس الطول للمقارنة. */
  prev: { amount: number; qty: number; receipts: number };
  avgTicket: number;
}

const CACHE = 'fot_seller_brand_';

/** مفتاح تخزين خاص بالبائع — جهاز مشترك لا يعرض براندات بائع لبائع آخر. */
function cacheKey(suffix: string) {
  return `${CACHE}${getSeller()?.id ?? 0}_${suffix}`;
}

/** يمسح كل كاش البراندات (عند الخروج أو انتهاء الجلسة). */
export function clearBrandCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function useBrandList() {
  const [list, setList] = useState<BrandSummary[] | null>(() => {
    try {
      const raw = localStorage.getItem(cacheKey('list'));
      return raw ? (JSON.parse(raw) as BrandSummary[]) : null;
    } catch {
      return null;
    }
  });
  const [err, setErr] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => onBrandsChanged(() => setVersion(v => v + 1)), []);
  useEffect(() => {
    let alive = true;
    api
      .brands()
      .then(l => {
        if (!alive) return;
        setList(l);
        try {
          localStorage.setItem(cacheKey('list'), JSON.stringify(l));
        } catch {
          /* ignore */
        }
      })
      .catch(e => alive && setErr(e instanceof Error ? e.message : 'تعذر التحميل'));
    return () => {
      alive = false;
    };
  }, [version]);
  return { list, err };
}

export function useBrandPack(seq: number | null) {
  const [pack, setPack] = useState<BrandPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => onBrandsChanged(() => setVersion(v => v + 1)), []);
  useEffect(() => {
    if (!seq) return;
    let alive = true;
    setErr('');
    try {
      const raw = localStorage.getItem(cacheKey(String(seq)));
      setPack(raw ? (JSON.parse(raw) as BrandPack) : null);
    } catch {
      setPack(null);
    }
    setLoading(true);
    api
      .brand(seq)
      .then(p => {
        if (!alive) return;
        setPack(p);
        try {
          localStorage.setItem(cacheKey(String(seq)), JSON.stringify(p));
        } catch {
          /* حزمة كبيرة — نكتفي بالذاكرة */
        }
      })
      .catch(e => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : 'تعذر التحميل';
        setErr(msg);
        // البراند غير مرتبط بهذا الحساب — لا نعرض نسخة مخزنة
        if (/غير مرتبط/.test(msg)) setPack(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [seq, version]);
  return { pack, loading, err };
}

/* ── التواريخ (محلياً بتقويم الجهاز — أيام الحزمة بتاريخ المحل) ── */

export function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;
}

export type PresetId = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'last30' | 'last90' | 'all' | 'custom';

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: 'week', label: 'هذا الأسبوع' },
  { id: 'lastWeek', label: 'الأسبوع الماضي' },
  { id: 'month', label: 'هذا الشهر' },
  { id: 'lastMonth', label: 'الشهر الماضي' },
  { id: 'last30', label: 'آخر 30 يوماً' },
  { id: 'last90', label: 'آخر 90 يوماً' },
  { id: 'all', label: 'كل الفترة' },
  { id: 'custom', label: 'مدة مخصصة' },
];

/** الأسبوع يبدأ السبت (كما في المحل). */
export function presetRange(id: PresetId, firstDay?: string | null): { from: string; to: string } {
  const today = isoDay(new Date());
  const d = new Date(`${today}T12:00:00`);
  const sinceSat = (d.getDay() + 1) % 7;
  const weekStart = addDays(today, -sinceSat);
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'week':
      return { from: weekStart, to: today };
    case 'lastWeek':
      return { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'lastMonth': {
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      return { from: isoDay(first), to: isoDay(last) };
    }
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    case 'all':
      return { from: (firstDay || addDays(today, -365)).slice(0, 10), to: today };
    default:
      return { from: addDays(today, -6), to: today };
  }
}

/** التقرير لأي مدة وفلتر — كله من الحزمة المحلية. */
export function buildReport(pack: BrandPack, f: BrandFilter): BrandReport {
  const products = new Map<number, BrandProduct>();
  for (const p of pack.products) products.set(p.id, p);
  const sectionName = new Map(pack.sections.map(s => [s.id, s.name] as const));
  const span = daysBetween(f.from, f.to);
  const prevFrom = addDays(f.from, -span);
  const prevTo = addDays(f.from, -1);
  const ok = (row: { 2: number; 3: number }) => (f.scope === 'all' || row[3] === 1) && (f.sectionId == null || row[2] === f.sectionId);

  const byDay = new Map<string, { amount: number; qty: number; receipts: number }>();
  const byProduct = new Map<number, { qty: number; amount: number }>();
  const bySection = new Map<number, { amount: number; qty: number; receipts: number }>();
  let amount = 0;
  let qty = 0;
  const prev = { amount: 0, qty: 0, receipts: 0 };

  for (const r of pack.rows) {
    const [day, article, section, , q, m] = r;
    if (!ok(r)) continue;
    if (day >= prevFrom && day <= prevTo) {
      prev.amount += m;
      prev.qty += q;
      continue;
    }
    if (day < f.from || day > f.to) continue;
    amount += m;
    qty += q;
    const d = byDay.get(day) ?? { amount: 0, qty: 0, receipts: 0 };
    d.amount += m;
    d.qty += q;
    byDay.set(day, d);
    const p = byProduct.get(article) ?? { qty: 0, amount: 0 };
    p.qty += q;
    p.amount += m;
    byProduct.set(article, p);
    const s = bySection.get(section) ?? { amount: 0, qty: 0, receipts: 0 };
    s.amount += m;
    s.qty += q;
    bySection.set(section, s);
  }

  let receipts = 0;
  const useTotals = f.scope === 'all' && Array.isArray(pack.receiptsAll) && pack.receiptsAll.length > 0;
  const receiptSource: BrandReceiptRow[] = useTotals
    ? pack.receiptsAll!.map(([day, section, n]) => [day, section, 0, n] as BrandReceiptRow)
    : pack.receipts;
  for (const r of receiptSource) {
    const [day, section, mine, n] = r;
    if (f.scope === 'mine' && mine !== 1) continue;
    if (f.sectionId != null && section !== f.sectionId) continue;
    if (day >= prevFrom && day <= prevTo) {
      prev.receipts += n;
      continue;
    }
    if (day < f.from || day > f.to) continue;
    receipts += n;
    const d = byDay.get(day) ?? { amount: 0, qty: 0, receipts: 0 };
    d.receipts += n;
    byDay.set(day, d);
    const s = bySection.get(section) ?? { amount: 0, qty: 0, receipts: 0 };
    s.receipts += n;
    bySection.set(section, s);
  }

  // سلسلة يومية كاملة (حتى الأيام بلا بيع) لرسم صادق
  const days: BrandReport['days'] = [];
  if (span <= 400) {
    for (let i = 0; i < span; i++) {
      const day = addDays(f.from, i);
      const v = byDay.get(day);
      days.push({ day, amount: v?.amount ?? 0, qty: v?.qty ?? 0, receipts: v?.receipts ?? 0 });
    }
  }

  const productStats: ProductStat[] = [...byProduct.entries()]
    .map(([id, v]) => {
      const p = products.get(id);
      return {
        id,
        name: p?.name || `مادة #${id}`,
        barcode: p?.barcode || '',
        price: p?.price ?? 0,
        qty: v.qty,
        amount: v.amount,
        share: amount > 0 ? (v.amount / amount) * 100 : 0,
      };
    })
    .filter(p => Math.abs(p.qty) > 0.0001 || Math.abs(p.amount) > 0.5)
    .sort((a, b) => b.amount - a.amount || b.qty - a.qty);

  const sections = [...bySection.entries()]
    .map(([id, v]) => ({ id, name: sectionName.get(id) || (id ? `قسم #${id}` : 'بلا قسم'), ...v, share: amount > 0 ? (v.amount / amount) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  return {
    amount,
    qty,
    receipts,
    productsSold: productStats.filter(p => p.qty > 0).length,
    activeDays: [...byDay.values()].filter(d => d.amount !== 0 || d.qty !== 0).length,
    days,
    products: productStats,
    sections,
    prev,
    avgTicket: receipts > 0 ? amount / receipts : 0,
  };
}

export function firstDataDay(pack: BrandPack | null) {
  if (!pack) return null;
  let min: string | null = null;
  for (const r of pack.rows) if (!min || r[0] < min) min = r[0];
  return min;
}

export function pct(now: number, prev: number) {
  if (!prev) return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}
