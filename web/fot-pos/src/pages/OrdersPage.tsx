import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatIqd, formatNum, type PrintSettingsDto } from '@fot/shared';
import { ApiError, api, onlineOrdersApi } from '@/api/client';
import type { PosSessionDto, SalesmanDto } from '@/api/types';
import { SalesmanPicker } from '@/components/SalesmanPicker';
import { useBarcodeCapture } from '@/hooks/useBarcodeCapture';
import { getHwId } from '@/lib/money';
import {
  LINE_COLORS,
  SHIPMENT_STATE_LABELS,
  STAGE_LABELS,
  linesLabel,
  orderTotals,
  parseOrderCode,
  unitsLabel,
  type FinalizeResult,
  type LookupResult,
  type OnlineOrdersStatus,
  type PosProductLookup,
  type QueueResult,
  type QueueRow,
  type SiteLine,
} from '@/lib/onlineOrders';
import {
  loadShopPrintSettings,
  playNewOrderChime,
  printOrderInvoice,
  printOrderReceipt,
  printOrderSlip,
} from '@/lib/orderPrint';
import { printCourierLabel, resolveLabelPrinter } from '@/lib/courierLabel';
import type { HeldInvoice, OrderEditBody } from '@/lib/onlineOrders';
import { resolveCashierPermissions } from '@/lib/permissions';
import { capUserDiscount } from '@/lib/sale';
import { collapseRepeatedScan } from '@/lib/scanGuard';
import { decodeScannerText } from '@/lib/scannerKey';
import { playErrorBeep } from '@/lib/sound';
import { speakSalesmanName } from '@/lib/speakName';

type QueueTab = 'ready' | 'pickup' | 'awaitingCourier' | 'picking' | 'returns';
type Tab = QueueTab | 'posting';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'ready', label: 'جاهزة للفوترة', hint: 'جُهّزت وتنتظر الإيصال والشحن' },
  { id: 'pickup', label: 'استلام بالمحل', hint: 'تأتي الزبونة لاستلامها من المحل' },
  { id: 'awaitingCourier', label: 'بانتظار الشحن', hint: 'فُوترت وتنتظر رقم التتبع أو المندوب' },
  { id: 'picking', label: 'قيد التجهيز', hint: 'يجهّزها الموظفون الآن' },
  { id: 'posting', label: 'بانتظار الترحيل', hint: 'فواتير لم تُرحَّل للإداري — تُعدّل حتى ترحيلها' },
  { id: 'returns', label: 'مرتجعات', hint: 'طرود رجعت للمحل' },
];

/** أزرق «زيادة»: قطع أكثر من المطلوب لصنف موجود في الطلب (نفس لون تطبيق التجهيز). */
const OVER_BLUE = '#2563EB';

const RETURN_STAGES = ['RETURNING', 'RETURNED', 'PARTIALLY_DELIVERED', 'DELIVERY_ISSUE', 'CANCELLED'];
const EDITABLE_STAGES = ['PICKED', 'READY_FOR_PICKUP'];
/** بعد الفوترة: الطرد في المحل بانتظار المندوب (الشحنة أُنشئت أو تُنشأ). */
const INVOICED_EDIT_STAGES = ['INVOICED', 'HANDED_OVER'];

const QUEUE_MS = 15_000;
const STATUS_MS = 60_000;

/** يقرأ الباركود كما يكتبه الماسح ويطابقه بلا حساسية لحالة الأحرف. */
function normBarcode(raw: string | null | undefined) {
  return String(raw ?? '').replace(/[‎‏‪-‮﻿\s]/g, '').toUpperCase();
}

/** حدث داخلي: فشل طلب بسبب الاتصال — الصفحة تُظهر الشريط الأحمر فوراً وتعيد الفحص بسرعة. */
const CONN_EVENT = 'fot-orders-conn';

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 0 || e.status === 408) {
      window.dispatchEvent(new CustomEvent(CONN_EVENT, { detail: 'shop' }));
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'هذا الجهاز غير متصل بالشبكة — لم يُنفَّذ شيء، أعد المحاولة بعد عودة الاتصال'
        : 'انقطع الاتصال بسيرفر المحل — لم يُنفَّذ شيء، أعد المحاولة بعد عودة الاتصال';
    }
    if (e.status === 424) window.dispatchEvent(new CustomEvent(CONN_EVENT, { detail: 'site' }));
    return e.message;
  }
  if (e instanceof TypeError) {
    window.dispatchEvent(new CustomEvent(CONN_EVENT, { detail: 'shop' }));
    return 'انقطع الاتصال — لم يُنفَّذ شيء، أعد المحاولة بعد عودة الاتصال';
  }
  return e instanceof Error ? e.message : 'حدث خطأ غير متوقع';
}

/** نص مفهوم لسبب تعذر الوصول للموقع (رسالة السيرفر قد تكون تقنية). */
function siteDownText(raw: string | null | undefined) {
  const t = (raw ?? '').trim();
  if (!t || /[a-z]{4,}/i.test(t)) return 'لا يصل سيرفر المحل إلى موقع الطلبات — غالباً انقطع الإنترنت في المحل';
  return t;
}

function isSiteDown(e: unknown) {
  return e instanceof ApiError && e.status === 424;
}

function isShopDown(e: unknown) {
  return e instanceof ApiError && (e.status === 0 || e.status === 408);
}

function newEditId() {
  return `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** ما سيُسلَّم من السطر: المطلوب حتى كميته، والإضافي كله. */
function deliveredQty(l: SiteLine) {
  return l.kind === 'ORDERED' ? Math.min(l.pickedQty, l.orderedQty) : l.pickedQty;
}

/** ناقص مميَّز عن المُزال: برتقالي للنقص الجزئي، وأحمر مشطوب للمُزال كله. */
const SHORT_ORANGE = '#EA580C';

/** سطر الطلب يطابق الباركود الممسوح؟ (باركود الموقع أو باركود مادة المحل المقابلة). */
function lineMatches(order: LookupResult, line: SiteLine, key: string) {
  if (!key) return false;
  if (normBarcode(line.barcode) === key) return true;
  const plan = order.local.lines.find(p => normBarcode(p.barcode) === normBarcode(line.barcode));
  return !!plan && normBarcode(plan.posBarcode) === key;
}

// ── التعديل الفوري على الشاشة (قبل رد السيرفر) ──

/** قيم الأصناف كما يحسبها الموقع: الهدية بصفر، والبديل بالأرخص. */
function linesMoney(lines: SiteLine[]) {
  const byId = new Map(lines.map(l => [l.id, l]));
  let orderedSubtotal = 0, delivered = 0, extrasValue = 0, freeExtrasValue = 0;
  for (const l of lines) {
    if (l.kind === 'ORDERED') {
      orderedSubtotal += l.orderedQty * l.unitPrice;
      delivered += deliveredQty(l) * l.unitPrice;
    } else if (l.pickedQty > 0) {
      if (l.charge === 'FREE') freeExtrasValue += l.pickedQty * l.unitPrice;
      else {
        const sub = l.substituteForLineId ? byId.get(l.substituteForLineId) : null;
        extrasValue += l.pickedQty * (sub ? Math.min(l.unitPrice, sub.unitPrice) : l.unitPrice);
      }
    }
  }
  return { orderedSubtotal, shortageValue: orderedSubtotal - delivered, extrasValue, freeExtrasValue, value: delivered + extrasValue };
}

/** الطلب بأسطر جديدة: المبالغ تُقدَّر بفرق قيمة الأصناف حتى يصل رد السيرفر (لحظات) فيصححها. */
function withLines(o: LookupResult, lines: SiteLine[]): LookupResult {
  const before = linesMoney(o.lines);
  const after = linesMoney(lines);
  const delta = after.value - before.value;
  const gift = !!o.order.cashierGift;
  return {
    ...o,
    lines,
    receipt: {
      ...o.receipt,
      itemsTotal: Math.max(0, o.receipt.itemsTotal + delta),
      // الهدية: الأصناف بلا مقابل — المبلغ لا يتغير، ويكبر جزء الهدية.
      total: gift ? o.receipt.total : Math.max(0, o.receipt.total + delta),
      discount: gift ? o.receipt.discount + delta : o.receipt.discount,
      ...(gift ? { giftDiscount: (o.receipt.giftDiscount ?? 0) + delta } : {}),
    },
    money: {
      ...o.money,
      orderedSubtotal: after.orderedSubtotal,
      shortageValue: after.shortageValue,
      extrasValue: after.extrasValue,
      freeExtrasValue: after.freeExtrasValue,
      finalSubtotal: o.money.finalSubtotal + delta,
      codAmount: o.order.prepaid || gift ? o.money.codAmount : Math.max(0, o.money.codAmount + delta),
      ...(gift ? { manualDiscount: (o.money.manualDiscount ?? 0) + delta } : {}),
    },
  };
}

/** «set» فوراً: كمية السطر (صفر يحذف الإضافي)، وسبب النقص، وهدية/مدفوع. */
function optimisticSet(o: LookupResult, lineId: string, qty: number, opts: { reason?: string; charge?: 'PAID' | 'FREE' }) {
  const lines = o.lines.flatMap(l => {
    if (l.id !== lineId) return [l];
    if (l.kind === 'EXTRA' && qty <= 0) return [];
    const full = l.kind === 'ORDERED' && qty >= l.orderedQty;
    return [{ ...l, pickedQty: qty, missingQty: l.kind === 'ORDERED' ? Math.max(0, l.orderedQty - qty) : 0, charge: opts.charge ?? l.charge, reason: full ? null : opts.reason ?? l.reason }];
  });
  return withLines(o, lines);
}

/** «add» فوراً كما يفعله الموقع: يكمل الناقص من الصنف أولاً، والباقي زيادة/إضافي (سطر مؤقت حتى الرد). */
function optimisticAdd(
  o: LookupResult,
  item: { barcode: string; name: string; shadeName?: string | null; unitPrice: number },
  qty: number,
  charge: 'PAID' | 'FREE',
  reason: string | null,
) {
  const key = normBarcode(item.barcode);
  const lines = [...o.lines];
  let left = qty;
  if (charge === 'PAID') {
    for (let i = 0; i < lines.length && left > 0; i++) {
      const l = lines[i];
      if (l.kind !== 'ORDERED' || !lineMatches(o, l, key) || l.pickedQty >= l.orderedQty) continue;
      const take = Math.min(left, l.orderedQty - l.pickedQty);
      const picked = l.pickedQty + take;
      lines[i] = { ...l, pickedQty: picked, missingQty: Math.max(0, l.orderedQty - picked), reason: picked >= l.orderedQty ? null : l.reason };
      left -= take;
    }
  }
  if (left > 0) {
    const idx = lines.findIndex(l => l.kind === 'EXTRA' && lineMatches(o, l, key) && l.charge === charge && !l.substituteForLineId);
    if (idx >= 0) lines[idx] = { ...lines[idx], pickedQty: lines[idx].pickedQty + left };
    else {
      lines.push({
        id: `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'EXTRA',
        barcode: item.barcode,
        name: item.name,
        shadeName: item.shadeName ?? null,
        orderedQty: 0,
        pickedQty: left,
        missingQty: 0,
        unitPrice: item.unitPrice,
        charge,
        reason,
        substituteForLineId: null,
        state: 'EXTRA',
        color: 'yellow',
        label: 'إضافي',
      });
    }
  }
  return withLines(o, lines);
}

/** سطر مؤقت لم يصل رد السيرفر به بعد — أزراره تنتظر لحظة. */
function isTempLine(l: SiteLine) {
  return l.id.startsWith('tmp-');
}

type AddState = {
  barcode: string;
  loading: boolean;
  product: Extract<PosProductLookup, { found: true }> | null;
  qty: number;
  charge: 'PAID' | 'FREE';
  reason: string;
  error: string | null;
  saving: boolean;
};

type ReasonState = { line: SiteLine; qty: number; reason: string; saving: boolean; error: string | null };

export function OrdersPage({
  session,
  onLogout,
  onBack,
  initialCode,
}: {
  session: PosSessionDto;
  onLogout: () => void;
  /** موجود حين فُتحت الشاشة من الكاشير العادي. */
  onBack?: () => void;
  initialCode?: string | null;
}) {
  const px = resolveCashierPermissions(session.permissions);
  const [status, setStatus] = useState<OnlineOrdersStatus | null>(null);
  const [shopDown, setShopDown] = useState(false);
  const [siteDown, setSiteDown] = useState<string | null>(null);
  /** هذا الجهاز نفسه بلا شبكة (المتصفح يبلغ بذلك فوراً). */
  const [netDown, setNetDown] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [tab, setTab] = useState<Tab>('ready');
  const [order, setOrder] = useState<LookupResult | null>(null);
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const [printSettings, setPrintSettings] = useState<PrintSettingsDto | null>(null);
  const [checked, setChecked] = useState<Record<string, number>>({});
  const [returned, setReturned] = useState<Record<string, number>>({});
  const [includeDelivery, setIncludeDelivery] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [queueFilter, setQueueFilter] = useState('');
  const [add, setAdd] = useState<AddState | null>(null);
  const [reasonAsk, setReasonAsk] = useState<ReasonState | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  /** البائع على إيصال الطلب كالكاشير الأصلي: يبدأ ببائع الجلسة ويبقى حتى يُغيَّر. */
  const [salesmanId, setSalesmanId] = useState<number>(session.salesmanId ?? 0);
  const [salesmen, setSalesmen] = useState<SalesmanDto[]>([]);
  const [salesmanOpen, setSalesmanOpen] = useState(false);
  useEffect(() => {
    void api.salesmen().then(setSalesmen).catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setSalesmanOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** طابور التعديلات (بالترتيب) وعدد ما لم يرد بعد — الشاشة لا تنتظره. */
  const editChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingEditsRef = useRef(0);
  const [pendingEdits, setPendingEdits] = useState(0);
  const editFailedRef = useRef(false);
  const lastFreshRef = useRef<LookupResult | null>(null);
  const queueRefreshTimer = useRef(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldInvoice[] | null>(null);
  const [heldPick, setHeldPick] = useState<Set<string>>(new Set());
  /** عُدّلت فاتورة مُفوترة: الإيصال والملصق المطبوعان قديمان. */
  const [needsReprint, setNeedsReprint] = useState(false);
  const [printersOpen, setPrintersOpen] = useState(false);
  const courierSaveRef = useRef<Promise<boolean> | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  /** تعديل سعر صنف (صلاحية «تغيير السعر»). */
  const [priceLine, setPriceLine] = useState<SiteLine | null>(null);
  /** «فاتورة هدية» (صلاحية «الهدايا»). */
  const [giftOpen, setGiftOpen] = useState(false);
  const needsReprintRef = useRef(false);
  needsReprintRef.current = needsReprint;
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef(0);
  const flashTimer = useRef(0);
  const knownReady = useRef<Set<string> | null>(null);
  const orderRef = useRef<LookupResult | null>(null);
  orderRef.current = order;
  const addRef = useRef<AddState | null>(null);
  addRef.current = add;
  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  /** آخر مسح في حقل المسح: «✓ الصنف — 2 / 3». */
  const [scanNote, setScanNote] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const flashLine = useCallback((id: string | null) => {
    window.clearTimeout(flashTimer.current);
    setFlash(id);
    if (id) flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
  }, []);

  const printCfg = status?.print;

  // ── الاتصال: سيرفر المحل ثم الموقع ──
  const refreshStatus = useCallback(async () => {
    const shopOk = await api.health();
    setShopDown(!shopOk);
    if (!shopOk) return;
    try {
      const s = await onlineOrdersApi.status();
      setStatus(s);
      setSiteDown(s.reachable ? null : siteDownText(s.error));
    } catch (e) {
      if (isShopDown(e)) setShopDown(true);
      else setSiteDown(errorText(e));
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const q = await onlineOrdersApi.queue();
      setQueue(q);
      setSiteDown(null);
      setShopDown(false);
      const ids = new Set(q.ready.map(r => r.id));
      const known = knownReady.current;
      if (known) {
        const fresh = q.ready.filter(r => !known.has(r.id));
        if (fresh.length) {
          playNewOrderChime();
          showToast(fresh.length === 1 ? `طلب جديد جاهز: ${fresh[0].orderNumber}` : `${fresh.length} طلبات جديدة جاهزة`);
          if (printCfg?.autoPrintNewSlips) {
            for (const row of fresh) {
              try {
                const d = await onlineOrdersApi.lookup(row.code);
                await printOrderSlip({
                  orderNumber: d.order.orderNumber,
                  code: d.order.code,
                  customerName: d.customer.name,
                  governorate: d.customer.governorate,
                  deliveryOption: d.order.deliveryOption,
                  isGift: d.order.isGift,
                  notes: d.order.notes,
                  lines: d.receipt.items.map(i => ({ name: i.name, qty: i.qty, barcode: i.barcode })),
                });
              } catch {
                /* القائمة اختيارية — لا توقف الطابور */
              }
            }
          }
        }
      }
      knownReady.current = ids;
    } catch (e) {
      if (isShopDown(e)) setShopDown(true);
      else setSiteDown(errorText(e));
    }
    // فواتير بانتظار الترحيل: من سيرفر المحل نفسه (تعمل حتى لو تعذر الموقع).
    try {
      const h = await onlineOrdersApi.held();
      setHeld(h);
      setHeldPick(prev => new Set([...prev].filter(id => h.some(x => x.orderId === id))));
    } catch {
      /* سيرفر أقدم بلا ترحيل يدوي */
    }
  }, [printCfg?.autoPrintNewSlips, showToast]);

  /** ملصق هاي إكسبريس نفسه على طابعة الملصقات: نسخ الملصق × عدد الطرود. */
  const printLabelFor = useCallback(async (code: string, parcels?: number | null) => {
    const lbl = await onlineOrdersApi.label(code);
    const printer = await resolveLabelPrinter(printCfg?.labelPrinterName);
    const perParcel = Math.max(1, printCfg?.labelCopies ?? 1);
    await printCourierLabel(lbl.pdfBase64, {
      copies: perParcel * Math.max(1, parcels ?? lbl.parcelCount ?? 1),
      printerName: printer,
      items: lbl.items,
      hideCustomer: !!printCfg?.labelHideCustomer,
    });
  }, [printCfg?.labelCopies, printCfg?.labelPrinterName, printCfg?.labelHideCustomer]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshStatus();
      if (cancelled) return;
      await refreshQueue();
      const ps = await loadShopPrintSettings();
      if (!cancelled) setPrintSettings(ps);
    })();
    return () => {
      cancelled = true;
    };
    // مرة عند الفتح؛ الفواصل أدناه تكمل
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => { void refreshQueue(); }, QUEUE_MS);
    return () => window.clearInterval(t);
  }, [refreshQueue]);

  useEffect(() => {
    const t = window.setInterval(() => { void refreshStatus(); }, STATUS_MS);
    return () => window.clearInterval(t);
  }, [refreshStatus]);

  // ── فتح الطلب ──
  const openOrder = useCallback(async (raw: string) => {
    const code = parseOrderCode(raw) ?? raw.trim();
    if (!code) return;
    if (needsReprintRef.current && orderRef.current && orderRef.current.order.code !== code
      && !window.confirm('عُدّلت الفاتورة المفتوحة ولم تُطبع من جديد (الإيصال والملصق).\nفتح طلب آخر الآن؟')) {
      return;
    }
    setLoadingCode(code);
    setOrderError(null);
    setActionError(null);
    setResult(null);
    setChecked({});
    checkedRef.current = {};
    setScanNote(null);
    setReturned({});
    setIncludeDelivery(true);
    setAdd(null);
    setReasonAsk(null);
    setEditingLine(null);
    setNeedsReprint(false);
    try {
      const d = await onlineOrdersApi.lookup(code);
      setOrder(d);
      if (RETURN_STAGES.includes(d.order.stage) && d.invoiced) setTab('returns');
      else if (d.order.stage === 'INVOICED') setTab('awaitingCourier');
      else if (d.order.deliveryOption === 'PICKUP') setTab('pickup');
      else if (d.order.stage === 'PICKED') setTab('ready');
    } catch (e) {
      setOrder(null);
      setOrderError(errorText(e));
      if (isShopDown(e)) setShopDown(true);
      playErrorBeep();
    } finally {
      setLoadingCode(null);
    }
  }, []);

  useEffect(() => {
    if (initialCode) void openOrder(initialCode);
  }, [initialCode, openOrder]);

  const offline = netDown || shopDown || !!siteDown;

  // الاتصال: شبكة الجهاز نفسه (online/offline من المتصفح) + فشل أي طلب بسبب الاتصال → الشريط الأحمر فوراً.
  useEffect(() => {
    const onOffline = () => setNetDown(true);
    const onOnline = () => {
      setNetDown(false);
      void refreshStatus();
      void refreshQueue();
    };
    const onConn = (ev: Event) => {
      const kind = (ev as CustomEvent<string>).detail;
      if (kind === 'shop') setShopDown(true);
      else if (kind === 'site') setSiteDown(prev => prev ?? siteDownText(null));
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener(CONN_EVENT, onConn);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(CONN_EVENT, onConn);
    };
  }, [refreshQueue, refreshStatus]);

  // منقطع: فحص كل 5 ثوانٍ حتى يعود؛ وعند العودة يُحدَّث الطابور والطلب المفتوح (والمراجعة كما هي).
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (!offline) {
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        showToast('عاد الاتصال ✓ — يمكنك المتابعة');
        void refreshQueue();
        const o = orderRef.current;
        if (o) void onlineOrdersApi.lookup(o.order.code).then(d => { if (orderRef.current?.order.id === d.order.id) setOrder(d); }).catch(() => {});
      }
      return;
    }
    wasOfflineRef.current = true;
    const t = window.setInterval(() => { void refreshStatus(); }, 5_000);
    return () => window.clearInterval(t);
  }, [offline, refreshQueue, refreshStatus, showToast]);
  const returnMode = !!order && !!order.invoiced && RETURN_STAGES.includes(order.order.stage);
  /** فاتورة مُفوترة هنا ولم تُرحَّل للإداري: تُعدّل ويتبعها الموقع وهاي إكسبريس (قبل استلام المندوب). */
  const editableInvoiced =
    !!order && !!order.invoiced && !!order.local.edari?.editable && order.order.deliveryOption !== 'PICKUP'
    && !order.order.prepaid && INVOICED_EDIT_STAGES.includes(order.order.stage);
  /** الكاشير يعدّل الأصناف: طلب مُجهَّز قبل الفوترة، أو فاتورة لم تُرحَّل بعد. */
  const editable =
    !!order && order.order.status !== 'CANCELLED' && !offline && status?.enabled !== false
    && ((!order.invoiced && EDITABLE_STAGES.includes(order.order.stage)) || editableInvoiced);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  /** الأصناف المسلّمة فعلاً (أسطر إيصال الموقع) بباركوداتها كما في الموقع وفي كتالوج المحل. */
  const deliveredLines = useMemo(() => {
    if (!order) return [];
    // local.lines يطابق receipt.items بالترتيب نفسه — نأخذ الفهرس قبل التصفية.
    return order.receipt.items
      .map((i, idx) => ({ i, plan: order.local.lines[idx] }))
      .filter(({ i }) => i.qty > 0 && i.barcode)
      .map(({ i, plan }) => ({
        key: normBarcode(i.barcode),
        barcode: i.barcode!,
        aliases: [normBarcode(i.barcode), normBarcode(plan?.posBarcode)].filter(Boolean),
        name: i.name,
        qty: i.qty,
        free: !!i.free,
      }))
      .reduce<{ key: string; barcode: string; aliases: string[]; name: string; qty: number; free: boolean }[]>((acc, l) => {
        const same = acc.find(a => a.key === l.key);
        if (same) same.qty += l.qty;
        else acc.push({ ...l, aliases: [...l.aliases] });
        return acc;
      }, []);
  }, [order]);
  const deliveredRef = useRef(deliveredLines);
  deliveredRef.current = deliveredLines;

  // ── المراجعة المزدوجة داخل الجدول ──

  /** قطعة واحدة مُراجَعة (مسحة أو «+») — عند اكتمال السطر يصير «مطابق» ويرتفع عن الباهت. */
  const verifyLine = useCallback((line: SiteLine) => {
    const total = deliveredQty(line);
    const now = Math.min(checkedRef.current[line.id] ?? 0, total);
    if (total <= 0 || now >= total) return;
    const next = { ...checkedRef.current, [line.id]: now + 1 };
    checkedRef.current = next;
    setChecked(next);
    setScanNote({ text: `${now + 1 >= total ? '✓ مطابق' : '✓'} ${line.name} — ${formatNum(now + 1)} / ${formatNum(total)}`, ok: true });
    flashLine(line.id);
  }, [flashLine]);

  /** «−» في المراجعة: تراجع عن قطعة مُراجَعة (يعود السطر باهتاً). */
  const unverifyLine = useCallback((line: SiteLine) => {
    const now = Math.min(checkedRef.current[line.id] ?? 0, deliveredQty(line));
    if (now <= 0) return;
    const next = { ...checkedRef.current, [line.id]: now - 1 };
    checkedRef.current = next;
    setChecked(next);
  }, []);

  /** ما يضيفه الكاشير بيده (صنف ممسوح، «+» زيادة، إرجاع ناقص) بين يديه — يُعدّ مُراجَعاً. */
  function autoVerify(before: LookupResult | null, fresh: LookupResult) {
    if (!status?.print.doubleCheck || fresh.invoiced) return;
    const prev = new Map((before?.lines ?? []).map(l => [l.id, deliveredQty(l)]));
    let next = checkedRef.current;
    for (const l of fresh.lines) {
      const was = prev.get(l.id) ?? 0;
      const grew = deliveredQty(l) - was;
      if (grew <= 0) continue;
      const base = Math.min(next[l.id] ?? 0, was);
      next = { ...next, [l.id]: Math.min(deliveredQty(l), base + grew) };
    }
    if (next !== checkedRef.current) {
      checkedRef.current = next;
      setChecked(next);
    }
  }

  // ── إضافة صنف بالباركود ──
  const openAdd = useCallback(async (barcode: string) => {
    const current = addRef.current;
    const key = normBarcode(barcode);
    // مسح الباركود نفسه والنافذة مفتوحة = قطعة أخرى.
    if (current && current.product && (normBarcode(current.barcode) === key || normBarcode(current.product.barcode) === key)) {
      setAdd({ ...current, qty: Math.min(999, current.qty + 1) });
      return;
    }
    setAdd({ barcode, loading: true, product: null, qty: 1, charge: 'PAID', reason: '', error: null, saving: false });
    try {
      const p = await onlineOrdersApi.product(barcode);
      if (!p.found) {
        playErrorBeep();
        setAdd(null);
        showToast(`الباركود ${barcode} غير موجود في كتالوج المحل`, 'err');
        return;
      }
      setAdd(prev => (prev && prev.barcode === barcode ? { ...prev, loading: false, product: p } : prev));
    } catch (e) {
      playErrorBeep();
      setAdd(null);
      showToast(errorText(e), 'err');
    }
  }, [showToast]);

  // ── طابور التعديلات: الشاشة تتغير فوراً، والطلبات تُرسل بالترتيب، ثم يُطابَق رد السيرفر ──

  /**
   * تعديل على الطلب: optimistic يغيّر الشاشة فوراً (بلا انتظار الشبكة)، والطلب يُرسل بعد ما قبله فلا تتعارض
   * الضغطات السريعة. عند انتهاء الطابور يُعرض رد السيرفر الأخير (الحقيقة)، وإن فشل تعديل يُعاد الطلب من السيرفر.
   */
  function runEdit(
    body: OrderEditBody,
    opts: { optimistic?: (o: LookupResult) => LookupResult; onDone?: (fresh: LookupResult) => void } = {},
  ): Promise<LookupResult | null> {
    const before = orderRef.current;
    if (!before) return Promise.resolve(null);
    const orderId = before.order.id;
    if (opts.optimistic) {
      const next = opts.optimistic(before);
      orderRef.current = next;
      setOrder(next);
      setResult(null);
      // ما يضيفه الكاشير بيده بين يديه — يُعدّ مُراجَعاً فوراً.
      autoVerify(before, next);
    }
    pendingEditsRef.current += 1;
    setPendingEdits(pendingEditsRef.current);
    const run = editChainRef.current.then(async () => {
      try {
        const fresh = await onlineOrdersApi.edit({ ...body, orderId } as OrderEditBody);
        if (fresh.order.id === orderId) lastFreshRef.current = fresh;
        opts.onDone?.(fresh);
        if (fresh.reprint) setNeedsReprint(true);
        if (fresh.courierUpdate && !fresh.courierUpdate.ok) {
          playErrorBeep();
          showToast(`عُدّلت الفاتورة لكن لم يصل التعديل لهاي إكسبريس: ${fresh.courierUpdate.error ?? ''} — راجع الطلب في لوحة الإدارة`, 'err');
        }
        return fresh;
      } catch (e) {
        editFailedRef.current = true;
        playErrorBeep();
        showToast(errorText(e), 'err');
        return null;
      } finally {
        pendingEditsRef.current -= 1;
        setPendingEdits(pendingEditsRef.current);
        if (pendingEditsRef.current === 0) await settleEdits(orderId);
      }
    });
    editChainRef.current = run.catch(() => null);
    return run;
  }

  /** انتهى الطابور: رد السيرفر الأخير يحل محل التقدير (والمراجعة تنتقل من الأسطر المؤقتة لأسطرها الحقيقية). */
  async function settleEdits(orderId: string) {
    const failed = editFailedRef.current;
    let fresh = lastFreshRef.current;
    editFailedRef.current = false;
    lastFreshRef.current = null;
    if (failed || !fresh) fresh = await onlineOrdersApi.lookup(orderRef.current?.order.code ?? '').catch(() => null);
    const shown = orderRef.current;
    if (!fresh || !shown || shown.order.id !== orderId || fresh.order.id !== orderId) return;
    // المراجعة: عدّ السطر المؤقت يذهب لسطره الحقيقي (نفس الباركود ونوع الشحن).
    const real = new Set(fresh.lines.map(l => l.id));
    let next = checkedRef.current;
    for (const l of shown.lines) {
      if (real.has(l.id) || !next[l.id]) continue;
      const target = fresh.lines.find(f => f.kind === l.kind && f.charge === l.charge && normBarcode(f.barcode) === normBarcode(l.barcode));
      const moved = next[l.id];
      next = { ...next };
      delete next[l.id];
      if (target) next[target.id] = (next[target.id] ?? 0) + moved;
    }
    if (next !== checkedRef.current) {
      checkedRef.current = next;
      setChecked(next);
    }
    autoVerify(shown, fresh);
    orderRef.current = fresh;
    setOrder(fresh);
    scheduleQueueRefresh();
  }

  /** الطابور الجانبي يُحدَّث مرة بعد هدوء التعديلات — لا مع كل ضغطة. */
  function scheduleQueueRefresh() {
    window.clearTimeout(queueRefreshTimer.current);
    queueRefreshTimer.current = window.setTimeout(() => { void refreshQueue(); }, 1500);
  }

  /** انتظار ما بقي من التعديلات (قبل الفوترة مثلاً). */
  async function flushEdits() {
    while (pendingEditsRef.current > 0) await editChainRef.current;
  }

  async function confirmAdd() {
    const a = addRef.current;
    const o = orderRef.current;
    if (!a || !a.product || !o || a.saving) return;
    const p = a.product;
    const code = p.siteBarcode || a.barcode;
    // النافذة تُغلق فوراً والصنف يظهر في الجدول؛ السعر النهائي من الموقع يصل بعد لحظة.
    setAdd(null);
    void runEdit(
      { code: o.order.code, op: 'add', barcode: code, qty: a.qty, charge: a.charge, reason: a.reason.trim() || undefined, clientEditId: newEditId() },
      {
        optimistic: cur => {
          const next = optimisticAdd(cur, { barcode: code, name: p.name ?? code, unitPrice: Math.round(p.price) }, a.qty, a.charge, a.reason.trim() || 'أُضيف عند الكاشير');
          const hit = next.lines.find(l => lineMatches(next, l, normBarcode(code)) && (a.charge === 'FREE' ? l.charge === 'FREE' : true));
          flashLine(hit?.id ?? null);
          return next;
        },
        onDone: fresh => showToast(`أُضيف ${p.name ?? a.barcode} × ${a.qty}${a.charge === 'FREE' ? ' (هدية)' : ''} — المبلغ الآن ${formatIqd(fresh.receipt.total)}`),
      },
    );
  }

  /** خصم يدوي على الطلب (0 يلغيه) — يتعدّل المبلغ في الموقع وعند هاي إكسبريس بعد الفوترة. */
  async function applyDiscount(amount: number, reason: string): Promise<boolean> {
    const o = orderRef.current;
    if (!o) return false;
    const fresh = await runEdit({
      code: o.order.code,
      op: 'discount',
      amount: Math.max(0, Math.round(amount)),
      reason: reason.trim() || undefined,
      clientEditId: newEditId(),
    });
    if (!fresh) return false;
    showToast(amount > 0 ? `خصم ${formatIqd(amount)} — المبلغ الآن ${formatIqd(fresh.receipt.total)}` : `أُلغي الخصم — المبلغ الآن ${formatIqd(fresh.receipt.total)}`);
    return true;
  }

  /** تعديل على مستوى الطلب (سعر صنف، فاتورة هدية) — يرد بالطلب محدّثاً. */
  async function applyEdit(body: OrderEditBody, done: (fresh: LookupResult) => string): Promise<boolean> {
    const fresh = await runEdit(body);
    if (!fresh) return false;
    showToast(done(fresh));
    return true;
  }

  /** «+» على صنف مكتمل: قطعة زائدة في صفه نفسه (أزرق «زيادة») — فوراً. */
  function addOver(line: SiteLine) {
    const o = orderRef.current;
    if (!o || !line.barcode) return;
    const barcode = line.barcode;
    void runEdit(
      { code: o.order.code, op: 'add', barcode, qty: 1, charge: 'PAID', reason: 'زيادة على الكمية المطلوبة', clientEditId: newEditId() },
      { optimistic: cur => optimisticAdd(cur, { barcode, name: line.name, shadeName: line.shadeName, unitPrice: line.unitPrice }, 1, 'PAID', 'زيادة على الكمية المطلوبة') },
    );
    flashLine(line.id);
  }

  /** تعديل على فاتورة مُفوترة: اطلب إعادة الطباعة، وأظهر إن لم يصل التعديل لهاي إكسبريس. */
  function afterEdit(fresh: LookupResult, before: LookupResult | null = null) {
    autoVerify(before, fresh);
    if (fresh.reprint) setNeedsReprint(true);
    if (fresh.courierUpdate && !fresh.courierUpdate.ok) {
      playErrorBeep();
      showToast(`عُدّلت الفاتورة لكن لم يصل التعديل لهاي إكسبريس: ${fresh.courierUpdate.error ?? ''} — راجع الطلب في لوحة الإدارة`, 'err');
    }
  }

  // ── تعديل كمية سطر — فوراً على الشاشة ──
  function applyLine(line: SiteLine, qty: number, opts: { reason?: string; charge?: 'PAID' | 'FREE' } = {}) {
    const o = orderRef.current;
    if (!o || isTempLine(line)) return;
    void runEdit(
      { code: o.order.code, op: 'set', lineId: line.id, qty, charge: opts.charge, reason: opts.reason, clientEditId: newEditId() },
      { optimistic: cur => optimisticSet(cur, line.id, qty, opts) },
    );
    if (!(line.kind === 'EXTRA' && qty <= 0)) flashLine(line.id);
  }

  function changeLine(line: SiteLine, qty: number) {
    if (isTempLine(line)) return;
    // «+» على صنف مكتمل: قطعة زائدة (أزرق «زيادة») بنفس الباركود — بلا نافذة.
    if (line.kind === 'ORDERED' && qty > line.orderedQty && line.barcode) {
      addOver(line);
      return;
    }
    if (line.kind === 'ORDERED' && qty < line.orderedQty) {
      // إرجاع قطعة لسطر ناقص سببه مسجّل: لا داعي لسؤال جديد.
      if (qty > line.pickedQty && line.reason) {
        applyLine(line, qty, { reason: line.reason });
        return;
      }
      setReasonAsk({ line, qty, reason: line.reason ?? '', saving: false, error: null });
      return;
    }
    applyLine(line, qty);
  }

  function confirmReason() {
    const r = reasonAsk;
    if (!r || r.saving) return;
    if (!r.reason.trim()) {
      setReasonAsk({ ...r, error: 'اكتب سبب النقص' });
      return;
    }
    // النافذة تُغلق فوراً والسطر يتغير؛ إن رفض السيرفر يعود الطلب كما كان مع رسالة.
    setReasonAsk(null);
    applyLine(r.line, r.qty, { reason: r.reason.trim() });
  }

  // ── الماسح: رمز الطلب قبل أي شيء ──
  const onScan = useCallback((rawCode: string) => {
    const normalized = collapseRepeatedScan(decodeScannerText(rawCode));
    if (!normalized) return;
    const orderCode = parseOrderCode(normalized);
    if (orderCode) {
      if (addRef.current) setAdd(null);
      void openOrder(orderCode);
      return;
    }
    const current = orderRef.current;
    if (!current) {
      playErrorBeep();
      showToast('امسح رمز الطلب (QR) أولاً', 'err');
      return;
    }
    if (addRef.current) {
      void openAdd(normalized);
      return;
    }
    const key = normBarcode(normalized);
    const line = deliveredRef.current.find(l => l.aliases.includes(key));
    const inReturn = !!current.invoiced && RETURN_STAGES.includes(current.order.stage);
    if (inReturn) {
      if (!line) {
        playErrorBeep();
        showToast(`الباركود ${normalized} ليس من أصناف هذا الطلب`, 'err');
        return;
      }
      setReturned(prev => {
        const n = (prev[line.key] ?? 0) + 1;
        if (n > line.qty) {
          playErrorBeep();
          showToast(`${line.name}: كل الكمية (${line.qty}) ممسوحة`, 'err');
          return prev;
        }
        return { ...prev, [line.key]: n };
      });
      return;
    }
    // المراجعة المزدوجة: كل مسحة تُطابق قطعة في سطرها (المطلوب أولاً ثم الإضافي) حتى يكتمل.
    if (status?.print.doubleCheck && !current.invoiced) {
      const target = current.lines
        .filter(l => lineMatches(current, l, key) && (checkedRef.current[l.id] ?? 0) < deliveredQty(l))
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ORDERED' ? -1 : 1))[0];
      if (target) {
        verifyLine(target);
        return;
      }
    }
    if (editableRef.current) {
      void openAdd(normalized);
      return;
    }
    playErrorBeep();
    showToast(current.invoiced ? 'الطلب مُفوتر — لا تُضاف أصناف بعد الفوترة' : 'لا يمكن تعديل هذا الطلب الآن', 'err');
  }, [openAdd, openOrder, showToast, status?.print.doubleCheck, verifyLine]);

  useBarcodeCapture(!busy && !reasonAsk && !discountOpen && !printersOpen && !priceLine && !giftOpen, onScan);

  // ── الطباعة ──
  /** يطبع بعد الفوترة ويرد: هل طُبع كل شيء؟ (وهل الملصق ينتظر رقم التتبع؟) */
  async function runPrints(fin: FinalizeResult, opts: { label: boolean; quiet?: boolean }): Promise<{ ok: boolean; labelPending: boolean; errors: string[] }> {
    const copies = printCfg ?? { receiptCopies: 1, invoiceCopies: 1, labelCopies: 1, labelPrinterName: null };
    const errors: string[] = [];
    try {
      await printOrderReceipt(fin.receiptPrint, printSettings, copies.receiptCopies);
    } catch (e) {
      errors.push(`إيصال المحل: ${errorText(e)}`);
    }
    try {
      await printOrderInvoice(fin.print, copies.invoiceCopies);
    } catch (e) {
      errors.push(`فاتورة الزبونة: ${errorText(e)}`);
    }
    const tracking = fin.shipment?.trackingNumber ?? fin.print.shipment?.trackingNumber;
    if (opts.label && fin.shipment?.state === 'CREATED' && tracking) {
      try {
        await printLabelFor(fin.print.order.code, fin.print.order.parcelCount);
      } catch (e) {
        errors.push(`ملصق هاي إكسبريس: ${errorText(e)}`);
      }
    }
    if (errors.length && !opts.quiet) showToast(errors.join(' — '), 'err');
    return { ok: errors.length === 0, labelPending: opts.label && !(fin.shipment?.state === 'CREATED' && tracking), errors };
  }

  /** إغلاق الطلب المفتوح: الشاشة تعود لحقل المسح جاهزة للطلب التالي. */
  function closeOrder() {
    orderRef.current = null;
    setOrder(null);
    setResult(null);
    setChecked({});
    checkedRef.current = {};
    setScanNote(null);
    setNeedsReprint(false);
    setActionError(null);
    setOrderError(null);
  }

  /** بعد تعديل فاتورة مُفوترة: الإيصال والفاتورة وملصق هاي إكسبريس من جديد (لا ينشئ شيئاً). */
  async function reprintAfterEdit() {
    if (!orderRef.current) return;
    setBusy(true);
    setBusyText('جاري حفظ التعديلات…');
    await flushEdits();
    const o = orderRef.current;
    if (!o) { setBusy(false); setBusyText(''); return; }
    setBusyText('جاري طباعة الفاتورة المعدّلة…');
    const errors: string[] = [];
    try {
      const d = await onlineOrdersApi.printData(o.order.code);
      const copies = printCfg ?? { receiptCopies: 1, invoiceCopies: 1, labelCopies: 1, labelPrinterName: null };
      if (d.receiptPrint) {
        try {
          await printOrderReceipt(d.receiptPrint, printSettings, Math.max(1, copies.receiptCopies));
        } catch (e) {
          errors.push(`إيصال المحل: ${errorText(e)}`);
        }
      }
      try {
        await printOrderInvoice(d, Math.max(1, copies.invoiceCopies));
      } catch (e) {
        errors.push(`فاتورة الزبونة: ${errorText(e)}`);
      }
      if (o.order.deliveryOption !== 'PICKUP') {
        if (d.shipment?.trackingNumber) {
          try {
            await printLabelFor(o.order.code, o.order.parcelCount);
          } catch (e) {
            errors.push(`ملصق هاي إكسبريس: ${errorText(e)}`);
          }
        } else {
          errors.push('ملصق هاي إكسبريس: رقم التتبع لم يصل بعد — اطبعه من «بانتظار الشحن» حين يصل');
        }
      }
      if (errors.length) showToast(errors.join(' — '), 'err');
      else {
        setNeedsReprint(false);
        showToast('طُبعت الفاتورة المعدّلة والملصق');
      }
    } catch (e) {
      showToast(errorText(e), 'err');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  /** «ترحيل»: الفواتير المحددة (أو فاتورة الطلب المفتوح) تُرسل لمزامنة الإداري ولا تُعدّل بعدها. */
  async function postInvoices(orderIds: string[] | 'all') {
    await flushEdits();
    const n = orderIds === 'all' ? held?.length ?? 0 : orderIds.length;
    if (!n) return;
    const ok = window.confirm(
      `ترحيل ${n === 1 ? 'فاتورة واحدة' : `${n} فواتير`} إلى الإداري؟\nبعد الترحيل لا يمكن تعديل الفاتورة من كاشير الطلبات.`,
    );
    if (!ok) return;
    setBusy(true);
    setBusyText('جاري الترحيل…');
    try {
      const r = await onlineOrdersApi.post(orderIds === 'all' ? { all: true } : { orderIds });
      showToast(r.message);
      setHeldPick(new Set());
      await refreshQueue();
      const o = orderRef.current;
      if (o) {
        const fresh = await onlineOrdersApi.lookup(o.order.code).catch(() => null);
        if (fresh) setOrder(fresh);
      }
    } catch (e) {
      showToast(errorText(e), 'err');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  /** خيارات التوصيل: بعد الفوترة تصل هاي إكسبريس فوراً ويُطبع ملصقها من جديد. */
  async function saveCourierOptions(opts: CourierOptionsInput): Promise<boolean> {
    const o = orderRef.current;
    if (!o) return false;
    // قبل الفوترة الحفظ تلقائي وهادئ (البطاقة تعرض «حُفظت»)؛ بعدها يُعدّل هاي إكسبريس ويُطبع الملصق.
    const quiet = !o.invoiced;
    if (quiet) {
      const run = (async () => {
        try {
          const fresh = await onlineOrdersApi.courierOptions({
            code: o.order.code,
            setType: true,
            typeId: opts.typeId,
            parcelCount: opts.parcelCount,
            note: opts.note,
            phone2: opts.phone2,
          });
          if (orderRef.current?.order.id === fresh.order.id) setOrder(fresh);
          return true;
        } catch (e) {
          playErrorBeep();
          showToast(errorText(e), 'err');
          return false;
        }
      })();
      // «إتمام وطباعة» ينتظر آخر حفظ — فلا تُنشأ الشحنة قبل أن تصل خيارات التوصيل.
      courierSaveRef.current = run;
      return run;
    }
    setBusy(true);
    setBusyText('جاري تحديث الشحنة عند هاي إكسبريس…');
    try {
      const fresh = await onlineOrdersApi.courierOptions({
        code: o.order.code,
        setType: true,
        typeId: opts.typeId,
        parcelCount: opts.parcelCount,
        note: opts.note,
        phone2: opts.phone2,
      });
      setOrder(fresh);
      afterEdit(fresh);
      if (fresh.reprintLabel) {
        setBusyText('جاري طباعة ملصق هاي إكسبريس…');
        try {
          await printLabelFor(fresh.order.code, fresh.order.parcelCount);
          showToast('حُفظت خيارات التوصيل وطُبع الملصق الجديد');
        } catch (e) {
          showToast(`حُفظت الخيارات لكن تعذرت طباعة الملصق: ${errorText(e)}`, 'err');
        }
      } else if (!fresh.courierUpdate || fresh.courierUpdate.ok) {
        showToast('حُفظت خيارات التوصيل');
      }
      return true;
    } catch (e) {
      playErrorBeep();
      showToast(errorText(e), 'err');
      return false;
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  /** إيصال المحل لا يطابق الموقع بعد تعديل لم يكتمل: يُعاد بناؤه من الموقع. */
  async function syncReceipt() {
    await flushEdits();
    const o = orderRef.current;
    if (!o) return;
    setBusy(true);
    setBusyText('جاري مزامنة إيصال المحل…');
    try {
      const fresh = await onlineOrdersApi.edit({ code: o.order.code, op: 'sync' });
      setOrder(fresh);
      if (fresh.reprint) setNeedsReprint(true);
      showToast('طابق إيصال المحل الطلب');
    } catch (e) {
      showToast(errorText(e), 'err');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function finalize() {
    if (!order) return;
    const pickup = order.order.deliveryOption === 'PICKUP';
    setBusy(true);
    setBusyText(pickup ? 'جاري التسليم والطباعة…' : 'جاري الفوترة وإنشاء الشحنة…');
    setActionError(null);
    try {
      // خيارات التوصيل التي تُحفظ تلقائياً الآن يجب أن تصل قبل إنشاء الشحنة.
      if (courierSaveRef.current) {
        setBusyText('جاري حفظ خيارات التوصيل…');
        await courierSaveRef.current;
        courierSaveRef.current = null;
        setBusyText(pickup ? 'جاري التسليم والطباعة…' : 'جاري الفوترة وإنشاء الشحنة…');
      }
      // تعديلات لم يرد بها السيرفر بعد تُحفظ أولاً — الفوترة على الطلب كما هو في الموقع.
      if (pendingEditsRef.current > 0) {
        setBusyText('جاري حفظ التعديلات…');
        await flushEdits();
        setBusyText(pickup ? 'جاري التسليم والطباعة…' : 'جاري الفوترة وإنشاء الشحنة…');
      }
      const current = orderRef.current ?? order;
      const body = {
        code: current.order.code,
        posId: session.posTerminalId,
        hwId: getHwId() || undefined,
        expectedTotal: current.receipt.total,
        salesmanId: salesmanId > 0 ? salesmanId : undefined,
      };
      const fin = pickup ? await onlineOrdersApi.pickup(body) : await onlineOrdersApi.finalize(body);
      setResult(fin);
      setBusyText('جاري الطباعة…');
      const printed = await runPrints(fin, { label: !pickup, quiet: true });
      const done = fin.alreadyInvoiced ? `الطلب مُفوتر من قبل بالإيصال ${fin.receipt.number}` : `تم — الإيصال ${fin.receipt.number}`;
      // تمّت الفوترة: نافذة الطلب تُغلق دائماً والمؤشر على حقل المسح للطلب التالي.
      // للتعديل أو إعادة الطباعة: امسح QR الطلب، أو افتحه من «بانتظار الترحيل».
      closeOrder();
      if (printed.ok) {
        showToast(printed.labelPending ? `${done} — الملصق يُطبع من «بانتظار الشحن» حين يصل رقم التتبع` : done);
      } else {
        showToast(`${done} — تعذرت الطباعة: ${printed.errors.join(' — ')} · أعد الطباعة من «بانتظار الترحيل»`, 'err');
      }
      void refreshQueue();
    } catch (e) {
      setActionError(errorText(e));
      if (isSiteDown(e)) setSiteDown(errorText(e));
      playErrorBeep();
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  /** إعادة طباعة من بيانات الموقع والمحل — لا تنشئ شيئاً. */
  async function reprint(code: string, what: 'receipt' | 'invoice' | 'label' | 'return') {
    setBusy(true);
    setBusyText('جاري الطباعة…');
    try {
      // الطباعة على آخر تعديل: ما لم يرد به السيرفر بعد يُنتظر أولاً.
      await flushEdits();
      const d = await onlineOrdersApi.printData(code);
      const copies = printCfg ?? { receiptCopies: 1, invoiceCopies: 1, labelCopies: 1, labelPrinterName: null };
      if (what === 'receipt') {
        if (!d.receiptPrint) throw new Error('لا يوجد إيصال محل مربوط بهذا الطلب');
        await printOrderReceipt(d.receiptPrint, printSettings, Math.max(1, copies.receiptCopies));
      } else if (what === 'return') {
        if (!d.returnPrint) throw new Error('لا يوجد إيصال إرجاع لهذا الطلب');
        await printOrderReceipt(d.returnPrint, printSettings, Math.max(1, copies.receiptCopies));
      } else if (what === 'invoice') {
        await printOrderInvoice(d, Math.max(1, copies.invoiceCopies));
      } else {
        if (!d.shipment?.trackingNumber) throw new Error('رقم التتبع لم يصل بعد من شركة التوصيل');
        await printLabelFor(code, d.order.parcelCount);
      }
      showToast('أُرسلت للطابعة');
    } catch (e) {
      showToast(errorText(e), 'err');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function createReturn() {
    if (!order) return;
    const lines = deliveredLines
      .filter(l => (returned[l.key] ?? 0) > 0)
      .map(l => ({ barcode: l.barcode, qty: returned[l.key] }));
    if (!lines.length && !order.local.return) {
      showToast('امسح الأصناف الراجعة أولاً', 'err');
      return;
    }
    setBusy(true);
    setBusyText('جاري إنشاء إيصال الإرجاع…');
    setActionError(null);
    try {
      const res = await onlineOrdersApi.returnOrder({
        code: order.order.code,
        lines,
        includeDelivery,
        posId: session.posTerminalId,
        hwId: getHwId() || undefined,
      });
      try {
        await printOrderReceipt(res.receiptPrint, printSettings, Math.max(1, printCfg?.receiptCopies ?? 1));
      } catch (e) {
        showToast(`إيصال الإرجاع: ${errorText(e)}`, 'err');
      }
      showToast(res.already ? `سُجّل الإرجاع من قبل بالإيصال ${res.receipt.number}` : `تم الإرجاع — الإيصال ${res.receipt.number}`);
      const fresh = await onlineOrdersApi.lookup(order.order.code).catch(() => null);
      if (fresh) setOrder(fresh);
      void refreshQueue();
    } catch (e) {
      setActionError(errorText(e));
      playErrorBeep();
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  function printSlip() {
    if (!order) return;
    void printOrderSlip({
      orderNumber: order.order.orderNumber,
      code: order.order.code,
      customerName: order.customer.name,
      governorate: order.customer.governorate,
      deliveryOption: order.order.deliveryOption,
      isGift: order.order.isGift,
      notes: order.order.notes,
      lines: order.receipt.items.map(i => ({ name: i.name, qty: i.qty, barcode: i.barcode })),
    }).catch(e => showToast(errorText(e), 'err'));
  }

  // ── البائع (كالكاشير الأصلي، أعلى يمين الشاشة) ──
  // قبل الفوترة: البائع المختار يُسجَّل على الإيصال عند «إتمام وطباعة» ويبقى للطلبات التالية.
  // بعد الفوترة: بائع إيصال الطلب نفسه، ويُغيَّر ما دامت الفاتورة لم تُرحَّل للإداري.
  const invoicedHere = !!order?.invoiced && !!order.local.invoicedHere && order.local.salesmanId !== undefined;
  const chipSalesmanId = invoicedHere ? order!.local.salesmanId ?? 0 : salesmanId;
  const nameOf = (id: number) => (id > 0 ? salesmen.find(s => s.id === id)?.name ?? (id === session.salesmanId ? session.salesmanName || `#${id}` : `#${id}`) : null);
  const salesmanLocked = invoicedHere && !!order?.local.edari && !order.local.edari.held;
  const salesmanChip = {
    name: nameOf(chipSalesmanId),
    disabled: busy || salesmanLocked,
    hint: salesmanLocked ? 'رُحّلت الفاتورة إلى الإداري — لا يتغير بائعها' : invoicedHere ? 'بائع هذه الفاتورة — يُغيَّر حتى ترحيلها (F3)' : 'بائع الفاتورة عند «إتمام وطباعة» (F3)',
    onPick: () => setSalesmanOpen(true),
  };

  async function pickSalesman(id: number) {
    setSalesmanOpen(false);
    const o = orderRef.current;
    const onInvoice = !!o?.invoiced && !!o.local.invoicedHere && o.local.salesmanId !== undefined;
    if (!o || !onInvoice) {
      setSalesmanId(id);
      showToast(id > 0 ? `البائع: ${nameOf(id)}` : 'بدون بائع');
      return;
    }
    try {
      await onlineOrdersApi.setSalesman({ orderId: o.order.id, salesmanId: id });
      const cur = orderRef.current;
      if (cur && cur.order.id === o.order.id) {
        const next = { ...cur, local: { ...cur.local, salesmanId: id } };
        orderRef.current = next;
        setOrder(next);
      }
      showToast(id > 0 ? `بائع الفاتورة الآن: ${nameOf(id)}` : 'الفاتورة بدون بائع الآن');
    } catch (e) {
      playErrorBeep();
      showToast(errorText(e), 'err');
    }
  }

  /** «إغلاق» نافذة الطلب (أو Esc): التعديلات الجارية تكمل في الخلفية. */
  function closeOrderWindow() {
    if (busy) return;
    if (needsReprintRef.current && !window.confirm('عُدّلت الفاتورة ولم تُطبع من جديد (الإيصال والملصق).\nإغلاق الطلب دون إعادة الطباعة؟')) return;
    closeOrder();
  }

  const closeRef = useRef(closeOrderWindow);
  closeRef.current = closeOrderWindow;
  const anyDialog = !!add || !!reasonAsk || discountOpen || printersOpen || !!priceLine || giftOpen || salesmanOpen;
  useEffect(() => {
    if (!order || anyDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, anyDialog]);

  if (!px.onlineOrders) {
    return (
      <div className="pos-app items-center justify-center p-6" dir="rtl">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-lg">
          <div className="mb-2 text-lg font-bold text-red-700">لا صلاحية لكاشير الطلبات</div>
          <p className="mb-4 text-[13px] leading-6 text-slate-600">
            حساب «{session.cashierName}» لا يملك صلاحية «كاشير الطلبات». فعّلها من لوحة التحكم ← الكاشيرية ← الصلاحيات.
          </p>
          <div className="flex justify-center gap-2">
            {onBack && <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-[13px] font-bold" onClick={onBack}>رجوع للكاشير</button>}
            <button type="button" className="rounded-xl bg-slate-800 px-4 py-2 text-[13px] font-bold text-white" onClick={onLogout}>خروج</button>
          </div>
        </div>
      </div>
    );
  }

  const counts = queue?.counts ?? {};
  const filterKey = queueFilter.trim().toUpperCase();
  const rows: QueueRow[] = (queue && tab !== 'posting' ? queue[tab] ?? [] : []).filter(r =>
    !filterKey
    || r.orderNumber.toUpperCase().includes(filterKey)
    || (r.customer ?? '').toUpperCase().includes(filterKey)
    || (r.governorate ?? '').toUpperCase().includes(filterKey));

  /** شريط الانقطاع — في الصفحة وفي نافذة الطلب. */
  const connBanner = offline ? (
          <div className="shrink-0 bg-[#D64545] px-4 py-2 text-center text-white" role="alert">
            <div className="text-[14px] font-bold">
              {netDown
                ? '⚠ هذا الجهاز غير متصل بالشبكة — تحقق من كابل الشبكة أو الواي فاي'
                : shopDown
                  ? '⚠ انقطع الاتصال بسيرفر المحل — تحقق من تشغيله ومن الشبكة الداخلية'
                  : `⚠ انقطع الإنترنت: ${siteDown}`}
            </div>
            <div className="text-[12px] font-semibold opacity-95">
              الفوترة والتعديل متوقفة حتى يعود الاتصال — ما حُفظ قبل الانقطاع محفوظ، ولا تتكرر فاتورة عند إعادة المحاولة. يُعاد الفحص تلقائياً كل 5 ثوانٍ.
            </div>
          </div>
  ) : null;

  return (
    // .pos-app يفرض flex-direction: row (CSS عادي يغلب أدوات Tailwind) — الاتجاه هنا صريح.
    <div className="pos-app" style={{ flexDirection: 'column' }} dir="rtl">
      <TopBar
        session={session}
        offline={offline}
        shopDown={shopDown}
        siteDown={siteDown}
        manualCode={manualCode}
        setManualCode={setManualCode}
        onSubmitCode={v => {
          if (parseOrderCode(v) || !orderRef.current) void openOrder(v);
          else onScan(v);
        }}
        onRefresh={() => { void refreshStatus(); void refreshQueue(); if (order) void openOrder(order.order.code); }}
        onPrinters={() => setPrintersOpen(true)}
        onBack={onBack}
        onLogout={onLogout}
        salesman={salesmanChip}
      />

      {connBanner}
      {status && !status.enabled && !offline && (
        <div className="shrink-0 bg-amber-500 px-4 py-2 text-center text-[13px] font-bold text-white">
          كاشير الطلبات متوقف من لوحة التحكم ← الإعدادات ← طلبات التطبيق
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* ── الطابور ── */}
        <aside className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={{ width: 'clamp(250px, 21vw, 340px)' }}>
          <div className="grid grid-cols-2 gap-1 border-b border-slate-100 p-2">
            {TABS.map(t => {
              const n = t.id === 'posting' ? held?.length ?? 0 : counts[t.id] ?? 0;
              const alert = t.id === 'posting' && n > 0 && tab !== t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  onClick={() => setTab(t.id)}
                  className={`flex min-w-0 items-center justify-between gap-1 rounded-lg px-2.5 py-2 text-[12px] font-bold transition ${
                    tab === t.id ? 'bg-[#0f9f76] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span className="truncate">{t.label}</span>
                  <span className={`num shrink-0 rounded-full px-2 text-[11px] ${tab === t.id ? 'bg-white/25' : alert ? 'bg-amber-500 text-white' : 'bg-white text-slate-700'}`}>
                    {formatNum(n)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-b border-slate-100 px-2 py-1.5">
            <input
              value={queueFilter}
              onChange={e => setQueueFilter(e.target.value)}
              placeholder="بحث برقم الطلب أو الاسم أو المحافظة"
              className="pos-field w-full text-[12px]"
            />
          </div>
          {tab === 'posting' ? (
            <HeldList
              held={(held ?? []).filter(h => !filterKey || (h.orderNumber ?? '').toUpperCase().includes(filterKey) || String(h.receiptNumber ?? '').includes(filterKey))}
              loading={held === null}
              picked={heldPick}
              setPicked={setHeldPick}
              activeOrderId={order?.order.id ?? null}
              disabled={busy}
              onOpen={h => void openOrder(h.orderNumber ?? h.orderId)}
              onPost={ids => void postInvoices(ids)}
            />
          ) : (
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {!queue && <div className="p-6 text-center text-[13px] text-slate-400">جاري التحميل…</div>}
            {queue && rows.length === 0 && (
              <div className="p-6 text-center text-[13px] text-slate-400">{filterKey ? 'لا نتائج للبحث' : 'لا توجد طلبات هنا'}</div>
            )}
            {rows.map(r => (
              <QueueCard
                key={r.id}
                row={r}
                tab={tab}
                active={order?.order.id === r.id}
                loading={loadingCode === r.code}
                disabled={busy}
                onOpen={() => void openOrder(r.code)}
                onLabel={() => void reprint(r.code, 'label')}
              />
            ))}
          </div>
          )}
          <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">يتحدث كل 15 ثانية · امسح QR الطلب لفتحه</div>
        </aside>

        {/* ── بلا طلب مفتوح: حقل المسح (المؤشر عليه دائماً) — الطلب يُفتح في نافذة بحجم الشاشة ── */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!order && (
            <div className="p-3 pb-0">
              <ScanBar
                onScan={onScan}
                onAdd={code => void openAdd(code)}
                canAdd={false}
                doubleCheck={false}
                active={!order && !loadingCode && !busy && !add && !printersOpen && !salesmanOpen}
                busy={busy || !!loadingCode}
                note={null}
              />
            </div>
          )}
          {!loadingCode && orderError && (
            <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-4 text-[14px] font-bold text-red-700">{orderError}</div>
          )}
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl border-4 border-dashed border-slate-300 text-[30px] font-bold">QR</div>
            <div className="text-[17px] font-bold text-slate-600">امسح QR الطلب لفتحه</div>
            <div className="text-[13px]">أو اختر طلباً من القائمة — يُفتح في نافذة كاملة، ويُغلق بزر «إغلاق» أو Esc</div>
          </div>
        </main>
      </div>

      {/* ── نافذة الطلب بحجم الشاشة: من أي قسم (جاهزة، بانتظار الترحيل، الإرجاع…) ── */}
      {(order || loadingCode) && (
        <div className="fixed inset-0 z-30 flex flex-col bg-slate-100" role="dialog" aria-modal="true" aria-label="نافذة الطلب" dir="rtl">
          <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
            <SalesmanChip {...salesmanChip} />
            <div className="min-w-0 flex-1 text-center">
              <div className="truncate font-mono text-[17px] font-bold text-slate-900" dir="ltr">{order?.order.orderNumber ?? loadingCode}</div>
              <div className="truncate text-[12px] font-bold text-slate-500">
                {order ? (order.invoiced ? `مُفوتر — إيصال ${order.invoiced.receiptNumber ?? ''}` : order.order.deliveryOption === 'PICKUP' ? 'استلام من المحل' : 'جاهز للفوترة') : 'جاري الفتح…'}
                {pendingEdits > 0 ? ' · يُحفظ…' : ''}
              </div>
            </div>
            <span className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold sm:flex ${offline ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
              <span className={`h-2 w-2 rounded-full ${offline ? 'bg-red-500' : 'bg-emerald-500'}`} />
              {offline ? 'غير متصل' : 'متصل'}
            </span>
            <button
              type="button"
              onClick={closeOrderWindow}
              disabled={busy}
              className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-5 text-[16px] font-bold text-white shadow-sm hover:bg-slate-700 disabled:opacity-50"
              title="إغلاق الطلب (Esc)"
              aria-label="إغلاق الطلب"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              إغلاق
              <kbd className="rounded bg-white/15 px-1.5 text-[11px] font-bold">Esc</kbd>
            </button>
          </header>
          {connBanner}
          <div className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {!order ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#0f9f76]" />
                <div className="text-[15px] font-bold">جاري فتح الطلب {loadingCode}…</div>
              </div>
            ) : returnMode ? (
              <>
                <div className="p-3 pb-0">
                  <ScanBar
                    onScan={onScan}
                    onAdd={code => void openAdd(code)}
                    canAdd={false}
                    doubleCheck={false}
                    active={!busy && !add && !reasonAsk && !discountOpen && !printersOpen && !priceLine && !giftOpen && !salesmanOpen}
                    busy={busy || !!loadingCode}
                    note={null}
                  />
                </div>
                <ReturnView
                  order={order}
                  lines={deliveredLines}
                  returned={returned}
                  setReturned={setReturned}
                  includeDelivery={includeDelivery}
                  setIncludeDelivery={setIncludeDelivery}
                  canReturn={px.onlineOrdersReturns}
                  busy={busy}
                  offline={offline}
                  error={actionError}
                  onCreate={() => void createReturn()}
                  onReprint={() => void reprint(order.order.code, 'return')}
                />
              </>
            ) : (
              <OrderView
                order={order}
                status={status}
                result={result}
                checked={checked}
                editable={editable}
                editingLine={editingLine}
                flash={flash}
                busy={busy}
                offline={offline}
                error={actionError}
                onAddBarcode={code => void openAdd(code)}
                onScan={onScan}
                scanActive={!busy && !add && !reasonAsk && !discountOpen && !printersOpen && !priceLine && !giftOpen && !salesmanOpen}
                scanNote={scanNote}
                onChangeLine={changeLine}
                onToggleCharge={line => void applyLine(line, line.pickedQty, { charge: line.charge === 'FREE' ? 'PAID' : 'FREE' })}
                onVerify={verifyLine}
                onUnverify={unverifyLine}
                onFinalize={() => void finalize()}
                onReprint={what => void reprint(order.order.code, what)}
                onSlip={printSlip}
                post={{
                  needsReprint,
                  onReprintAll: () => void reprintAfterEdit(),
                  onSyncReceipt: () => void syncReceipt(),
                  onSaveCourier: saveCourierOptions,
                  canDiscount: px.makeDiscount,
                  onDiscount: () => setDiscountOpen(true),
                  canPrice: px.allowPriceChange,
                  onPrice: line => setPriceLine(line),
                  canGift: px.allowGiftReceipt,
                  onGift: () => setGiftOpen(true),
                  pendingEdits,
                }}
              />
            )}
          </div>
        </div>
      )}

      {add && (
        <AddItemDialog
          state={add}
          order={order}
          onChange={setAdd}
          onCancel={() => setAdd(null)}
          onConfirm={() => void confirmAdd()}
        />
      )}
      {discountOpen && order && (
        <DiscountDialog
          order={order}
          limit={px.userDiscountLimit}
          onClose={() => setDiscountOpen(false)}
          onApply={async (amount, reason) => {
            const ok = await applyDiscount(amount, reason);
            if (ok) setDiscountOpen(false);
            return ok;
          }}
        />
      )}
      {priceLine && order && (
        <PriceDialog
          order={order}
          line={priceLine}
          onClose={() => setPriceLine(null)}
          onApply={async (unitPrice, reason) => {
            const ok = await applyEdit(
              { code: order.order.code, op: 'price', lineId: priceLine.id, unitPrice, reason: reason.trim() || undefined, clientEditId: newEditId() },
              fresh => `سعر ${priceLine.name}: ${formatIqd(unitPrice)} — المبلغ الآن ${formatIqd(fresh.receipt.total)}`,
            );
            if (ok) setPriceLine(null);
            return ok;
          }}
        />
      )}
      {salesmanOpen && (
        <SalesmanPicker
          title={invoicedHere ? 'بائع الفاتورة' : 'بائع الفاتورة'}
          subtitle={invoicedHere ? `يُطبَّق على كل بنود الفاتورة ${order?.invoiced?.receiptNumber ?? ''} — حتى ترحيلها` : 'يُطبَّق على كل بنود الفاتورة عند «إتمام وطباعة»'}
          salesmen={salesmen}
          onPick={sm => void pickSalesman(sm.id)}
          onClear={() => void pickSalesman(0)}
          onClose={() => setSalesmanOpen(false)}
        />
      )}
      {giftOpen && order && (
        <GiftDialog
          order={order}
          onClose={() => setGiftOpen(false)}
          onApply={async (gift, reason) => {
            const ok = await applyEdit(
              { code: order.order.code, op: 'gift', gift, reason: reason.trim() || undefined, clientEditId: newEditId() },
              fresh => (gift ? `فاتورة هدية — يُحصّل ${formatIqd(fresh.money.codAmount)} فقط` : `أُلغيت الهدية — المبلغ الآن ${formatIqd(fresh.receipt.total)}`),
            );
            if (ok) setGiftOpen(false);
            return ok;
          }}
        />
      )}
      {printersOpen && <PrintersDialog fallbackLabelPrinter={printCfg?.labelPrinterName ?? null} onClose={() => setPrintersOpen(false)} />}
      {reasonAsk && (
        <ReasonDialog
          state={reasonAsk}
          onChange={setReasonAsk}
          onCancel={() => setReasonAsk(null)}
          onConfirm={() => void confirmReason()}
        />
      )}

      {busy && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40">
          <div className="rounded-2xl bg-white px-8 py-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#0f9f76]" />
            <div className="text-[15px] font-bold text-slate-800">{busyText || 'جاري التنفيذ…'}</div>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-xl px-5 py-3 text-center text-[14px] font-bold text-white shadow-xl ${
            toast.tone === 'err' ? 'bg-[#D64545]' : 'bg-slate-900'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── الرأس ─────────────────────────

/** البائع أعلى اليمين — نفس عنصر الكاشير الأصلي (أخضر مع بائع، برتقالي «اختر بائع الفاتورة» بدونه). */
function SalesmanChip({ name, disabled, hint, onPick }: { name: string | null; disabled?: boolean; hint: string; onPick: () => void }) {
  return (
    <div className="pos-context-item min-w-[200px] max-w-[320px] shrink-0" style={{ flexBasis: 'clamp(200px, 22vw, 320px)' }}>
      <span>البائع</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (name) speakSalesmanName(name);
          onPick();
        }}
        className={`pos-cart-group-seller w-full rounded-md disabled:cursor-not-allowed disabled:opacity-60 ${name ? 'has-seller' : 'needs-seller'}`}
        title={hint}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        </svg>
        <span className="truncate">{name || 'اختر بائع الفاتورة'}</span>
      </button>
    </div>
  );
}

function TopBar({
  session,
  offline,
  shopDown,
  siteDown,
  manualCode,
  setManualCode,
  onSubmitCode,
  onRefresh,
  onPrinters,
  onBack,
  onLogout,
  salesman,
}: {
  session: PosSessionDto;
  offline: boolean;
  shopDown: boolean;
  siteDown: string | null;
  manualCode: string;
  setManualCode: (v: string) => void;
  onSubmitCode: (v: string) => void;
  onRefresh: () => void;
  onPrinters: () => void;
  onBack?: () => void;
  onLogout: () => void;
  /** البائع أعلى اليمين كالكاشير الأصلي. */
  salesman: { name: string | null; disabled?: boolean; hint: string; onPick: () => void };
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm">
      <SalesmanChip {...salesman} />
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0f9f76] text-[11px] font-bold text-white">FOT</div>
        <div className="min-w-0">
          <div className="text-[15px] font-bold leading-5 text-slate-900">كاشير الطلبات</div>
          <div className="truncate text-[11px] text-slate-500">{session.cashierName}{session.sectionName ? ` · ${session.sectionName}` : ''}</div>
        </div>
      </div>
      <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${offline ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
        <span className={`h-2 w-2 rounded-full ${offline ? 'bg-red-500' : 'bg-emerald-500'}`} />
        {shopDown ? 'سيرفر المحل غير متصل' : siteDown ? 'الموقع غير متاح' : 'متصل بالموقع'}
      </span>
      <form
        className="ms-auto flex min-w-0 items-center gap-2"
        onSubmit={e => {
          e.preventDefault();
          // الماسح قد يكتب هنا بلوحة عربية — نفك الأحرف كما في الالتقاط العام
          const v = collapseRepeatedScan(decodeScannerText(manualCode)).trim();
          setManualCode('');
          (document.activeElement as HTMLElement | null)?.blur();
          if (v) onSubmitCode(v);
        }}
      >
        <input
          value={manualCode}
          onChange={e => setManualCode(e.target.value)}
          placeholder="رقم الطلب ORD-… أو باركود صنف"
          className="pos-field w-[clamp(170px,20vw,260px)] text-[13px]"
          dir="ltr"
        />
        <button type="submit" className="shrink-0 rounded-xl bg-slate-800 px-3 py-2 text-[12px] font-bold text-white">فتح</button>
      </form>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold" onClick={onRefresh}>
          تحديث
        </button>
        <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold" onClick={onPrinters} title="الطابعة الحرارية وطابعة الملصقات لهذا الجهاز">
          الطابعات
        </button>
        {onBack && (
          <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold" onClick={onBack}>
            رجوع للكاشير
          </button>
        )}
        <button type="button" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700" onClick={onLogout}>
          خروج
        </button>
      </div>
    </header>
  );
}

// ───────────────────────── الطابور ─────────────────────────

function QueueCard({
  row,
  tab,
  active,
  loading,
  disabled,
  onOpen,
  onLabel,
}: {
  row: QueueRow;
  tab: Tab;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  onOpen: () => void;
  onLabel: () => void;
}) {
  const tracking = row.shipment?.trackingNumber;
  const units = row.units ?? row.orderedUnits;
  return (
    <div className={`rounded-xl border p-2.5 transition ${active ? 'border-[#0f9f76] bg-emerald-50/70 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <button type="button" className="block w-full text-right" onClick={onOpen} disabled={disabled}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[13px] font-bold text-slate-900" dir="ltr">{row.orderNumber}</span>
          <span className="num shrink-0 text-[13px] font-bold text-slate-800">{formatIqd(row.finalTotal ?? row.total)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-slate-600">
          <span className="min-w-0 truncate">{row.customer ?? '—'}{row.governorate ? ` · ${row.governorate}` : ''}</span>
          {row.adjusted && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] font-bold text-[#DB8B12]">معدّل</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
          {units != null && (
            <span className="num font-bold text-slate-700">
              {unitsLabel(units)}{row.lines != null ? ` · ${linesLabel(row.lines)}` : ''}
            </span>
          )}
          {(row.missingUnits ?? 0) > 0 && <span className="num font-bold text-[#D64545]">ناقص {row.missingUnits}</span>}
          {(row.extraUnits ?? 0) > 0 && <span className="num font-bold text-[#DB8B12]">+{row.extraUnits} إضافي</span>}
          {(row.parcelCount ?? 1) > 1 && <span>· {row.parcelCount} طرود</span>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-slate-400">
          <span className="truncate">{STAGE_LABELS[row.stage] ?? row.stage}{row.pickerName ? ` · ${row.pickerName}` : ''}</span>
          {loading && <span className="shrink-0 text-[#0f9f76]">· جاري الفتح…</span>}
        </div>
      </button>
      {tab === 'awaitingCourier' && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className="min-w-0 truncate text-[11px]">
            {row.shipment ? (
              <span className={row.shipment.state === 'FAILED' ? 'font-bold text-[#D64545]' : 'text-slate-600'}>
                {SHIPMENT_STATE_LABELS[row.shipment.state ?? ''] ?? row.shipment.state}
                {tracking ? <span className="font-mono" dir="ltr"> · {tracking}</span> : ''}
              </span>
            ) : (
              <span className="text-slate-400">لا شحنة بعد</span>
            )}
          </span>
          <button
            type="button"
            disabled={!tracking || disabled}
            title={tracking ? 'إعادة طباعة — لا تنشئ شيئاً' : 'رقم التتبع لم يصل بعد'}
            onClick={onLabel}
            className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            طباعة الملصق
          </button>
        </div>
      )}
      {row.shipment?.lastError && tab === 'awaitingCourier' && (
        <div className="mt-1 text-[11px] text-[#D64545]">{row.shipment.lastError}</div>
      )}
    </div>
  );
}

/** فواتير طلبات التطبيق بانتظار «ترحيل» يدوي إلى الإداري — تحديد وترحيل. */
function HeldList({
  held,
  loading,
  picked,
  setPicked,
  activeOrderId,
  disabled,
  onOpen,
  onPost,
}: {
  held: HeldInvoice[];
  loading: boolean;
  picked: Set<string>;
  setPicked: (s: Set<string>) => void;
  activeOrderId: string | null;
  disabled: boolean;
  onOpen: (h: HeldInvoice) => void;
  onPost: (ids: string[] | 'all') => void;
}) {
  const total = held.reduce((s, h) => s + h.total, 0);
  const all = held.length > 0 && held.every(h => picked.has(h.orderId));
  return (
    <>
      <div className="border-b border-slate-100 bg-amber-50/60 px-3 py-2 text-[12px] leading-5 text-amber-900">
        لا تُرحَّل فواتير طلبات التطبيق إلى الإداري تلقائياً. افتح الفاتورة لتعديلها، ثم رحّلها حين تتأكد.
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <label className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
          <input
            type="checkbox"
            checked={all}
            disabled={!held.length}
            onChange={e => setPicked(e.target.checked ? new Set(held.map(h => h.orderId)) : new Set())}
          />
          تحديد الكل
        </label>
        <span className="num text-[12px] font-bold text-slate-700">{formatIqd(total)}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {loading && <div className="p-6 text-center text-[13px] text-slate-400">جاري التحميل…</div>}
        {!loading && held.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">لا توجد فواتير بانتظار الترحيل</div>}
        {held.map(h => (
          <div
            key={h.clientReceiptId}
            className={`flex items-start gap-2 rounded-xl border p-2.5 ${activeOrderId === h.orderId ? 'border-[#0f9f76] bg-emerald-50/70' : 'border-slate-200 bg-white'}`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={picked.has(h.orderId)}
              onChange={e => {
                const next = new Set(picked);
                if (e.target.checked) next.add(h.orderId);
                else next.delete(h.orderId);
                setPicked(next);
              }}
            />
            <button type="button" className="min-w-0 flex-1 text-right" onClick={() => onOpen(h)} disabled={disabled}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[13px] font-bold text-slate-900" dir="ltr">{h.orderNumber ?? h.orderId}</span>
                <span className="num shrink-0 text-[13px] font-bold">{formatIqd(h.total)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                <span>إيصال <b className="num text-slate-700">{h.receiptNumber ?? '—'}</b></span>
                <span>{new Date(h.createdAt).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                {h.edits > 0 && <span className="font-bold text-[#DB8B12]">عُدّلت {h.edits === 1 ? 'مرة' : `${h.edits} مرات`}</span>}
                {h.cashierName && <span className="truncate">{h.cashierName}</span>}
              </div>
            </button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-2">
        <button
          type="button"
          disabled={disabled || picked.size === 0}
          onClick={() => onPost([...picked])}
          className="rounded-xl bg-[#0f9f76] py-2 text-[12px] font-bold text-white disabled:bg-slate-300"
        >
          ترحيل المحدد ({picked.size})
        </button>
        <button
          type="button"
          disabled={disabled || held.length === 0}
          onClick={() => onPost('all')}
          className="rounded-xl border border-[#0f9f76] bg-white py-2 text-[12px] font-bold text-[#0b7d5d] disabled:border-slate-300 disabled:text-slate-400"
        >
          ترحيل الكل
        </button>
      </div>
    </>
  );
}

/** طابعات هذا الجهاز: الحرارية للإيصالات، وطابعة الملصقات لملصق هاي إكسبريس. */
function PrintersDialog({ fallbackLabelPrinter, onClose }: { fallbackLabelPrinter: string | null; onClose: () => void }) {
  const [printers, setPrinters] = useState<{ name: string; displayName?: string; isDefault?: boolean }[] | null>(null);
  const [receipt, setReceipt] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [paperW, setPaperW] = useState('100');
  const [paperH, setPaperH] = useState('150');
  const [brand, setBrand] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = !!window.fotDesktop?.listPrinters;

  useEffect(() => {
    void (async () => {
      try {
        const [list, cfg] = await Promise.all([
          window.fotDesktop?.listPrinters?.() ?? Promise.resolve([]),
          window.fotDesktop?.getPrintConfig?.() ?? Promise.resolve(null),
        ]);
        setPrinters(list as { name: string; displayName?: string; isDefault?: boolean }[]);
        setReceipt(cfg?.printerName ?? '');
        setLabel(cfg?.labelPrinterName ?? '');
        if (cfg?.labelWidthMm) setPaperW(String(cfg.labelWidthMm));
        if (cfg?.labelHeightMm) setPaperH(String(cfg.labelHeightMm));
        setBrand(cfg?.labelBrand !== false);
      } catch (e) {
        setError(errorText(e));
        setPrinters([]);
      }
    })();
  }, []);

  async function save() {
    const w = Number(paperW);
    const h = Number(paperH);
    if (!(w >= 30 && w <= 300 && h >= 30 && h <= 300)) {
      setError('مقاس ورق الملصق بين 30 و300 ملم');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await window.fotDesktop?.setPrintConfig?.({ printerName: receipt || null, labelPrinterName: label || null, labelWidthMm: w, labelHeightMm: h, labelBrand: brand });
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const select = (value: string, onChange: (v: string) => void, empty: string) => (
    <select value={value} onChange={e => onChange(e.target.value)} className="pos-field w-full text-[13px]">
      <option value="">{empty}</option>
      {(printers ?? []).map(p => (
        <option key={p.name} value={p.name}>{p.displayName || p.name}{p.isDefault ? ' (الافتراضية)' : ''}</option>
      ))}
    </select>
  );

  return (
    <Modal onClose={onClose} width={480}>
      <h2 className="mb-1 text-[17px] font-bold text-slate-900">إعدادات الطباعة لهذا الجهاز</h2>
      <p className="mb-4 text-[12px] leading-5 text-slate-500">
        الإيصال والفاتورة على الطابعة الحرارية. ملصق الشحن يُطبع كما تصممه هاي إكسبريس على طابعة الملصقات فقط.
      </p>
      {!desktop ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          اختيار الطابعات متاح في تطبيق «FOT POS كاشير الطلبات» على الجهاز.
        </div>
      ) : printers === null ? (
        <div className="py-6 text-center text-[13px] text-slate-500">جاري قراءة الطابعات…</div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold text-slate-700">الطابعة الحرارية (الإيصال والفاتورة)</span>
            {select(receipt, setReceipt, 'الطابعة الافتراضية لويندوز')}
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold text-slate-700">طابعة الملصقات (ملصق هاي إكسبريس)</span>
            {select(label, setLabel, fallbackLabelPrinter ? `من لوحة التحكم: ${fallbackLabelPrinter}` : '— اختر طابعة الملصقات —')}
            {!label && !fallbackLabelPrinter && (
              <span className="mt-1 block text-[12px] font-bold text-[#D64545]">بلا طابعة ملصقات لا يُطبع ملصق الشحن.</span>
            )}
            {label && label === receipt && (
              <span className="mt-1 block text-[12px] font-bold text-[#DB8B12]">نفس الطابعة الحرارية — تأكد أنها طابعة ملصقات.</span>
            )}
          </label>
          <div>
            <span className="mb-1 block text-[13px] font-bold text-slate-700">مقاس ورق الملصق (ملم)</span>
            <div className="flex items-center gap-2" dir="ltr">
              <input value={paperW} onChange={e => setPaperW(e.target.value.replace(/[^\d.]/g, ''))} className="pos-field num w-20 text-center text-[13px]" />
              <span className="text-slate-500">×</span>
              <input value={paperH} onChange={e => setPaperH(e.target.value.replace(/[^\d.]/g, ''))} className="pos-field num w-20 text-center text-[13px]" />
            </div>
            <span className="mt-1 block text-[12px] leading-5 text-slate-500">
              العرض × الطول. ملصق هاي إكسبريس 105×148.5 ملم يُصغَّر ليدخل كاملاً (الشائع 100×150).
            </span>
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-2">
            <input type="checkbox" className="mt-0.5" checked={brand} onChange={e => setBrand(e.target.checked)} />
            <span className="text-[13px] leading-5">
              <b className="text-slate-800">شعار ديما الحياة أسفل الملصق</b>
              <span className="block text-[12px] text-slate-500">شريط صغير تحت ملصق هاي إكسبريس: الشعار والاسم والموقع — لا يغطي أي بيانات للشحنة.</span>
            </span>
          </label>
        </div>
      )}
      {error && <div className="mt-3 text-[13px] font-bold text-[#D64545]">{error}</div>}
      <div className="mt-5 grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white py-2.5 text-[14px] font-bold text-slate-700">
          إغلاق
        </button>
        <button type="button" onClick={() => void save()} disabled={!desktop || saving} className="rounded-xl bg-[#0f9f76] py-2.5 text-[14px] font-bold text-white disabled:bg-slate-300">
          {saving ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      </div>
    </Modal>
  );
}

// ───────────────────────── أجزاء الطلب ─────────────────────────

function Card({ title, children, tone, right }: { title: string; children: ReactNode; tone?: 'gift' | 'warn' | 'plain'; right?: ReactNode }) {
  const border = tone === 'gift' ? 'border-pink-200 bg-pink-50/60' : tone === 'warn' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white';
  return (
    <section className={`rounded-xl border p-3 ${border}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[12px] font-bold text-slate-500">{title}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

function MoneyRow({ label, value, tone, strong }: { label: string; value: number; tone?: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-0.5 ${strong ? 'text-[16px] font-bold' : 'text-[13px]'}`} style={tone ? { color: tone } : undefined}>
      <span className="min-w-0">{label}</span>
      <span className="num shrink-0" dir="ltr">{formatIqd(value)}</span>
    </div>
  );
}

function Pill({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${className}`}>{children}</span>;
}

function OrderHeader({ order }: { order: LookupResult }) {
  const o = order.order;
  const pickup = o.deliveryOption === 'PICKUP';
  const t = orderTotals(order);
  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-[21px] font-bold leading-7 text-slate-900" dir="ltr">{o.orderNumber}</h1>
        <Pill className="bg-slate-800 text-white">{STAGE_LABELS[o.stage] ?? o.stage}</Pill>
        <Pill className={pickup ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'}>{pickup ? 'استلام من المحل' : 'توصيل هاي إكسبريس'}</Pill>
        <Pill className={o.prepaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>
          {o.prepaid ? 'مدفوع مسبقاً' : pickup ? 'الدفع في المحل' : 'الدفع عند الاستلام'}
        </Pill>
        {o.isGift && <Pill className="bg-pink-100 text-pink-800">هدية</Pill>}
        {o.cashierGift && <Pill className="bg-pink-600 text-white">فاتورة هدية</Pill>}
        {(o.parcelCount ?? 1) > 1 && <Pill className="bg-slate-200 text-slate-800">{o.parcelCount} طرود</Pill>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
        <span className="num">
          <b className="text-slate-900">{unitsLabel(t.units)}</b> في {linesLabel(t.lines)}
          {(t.units !== t.orderedUnits || t.lines !== t.orderedLines) && (
            <span className="text-slate-400"> (الطلب الأصلي: {unitsLabel(t.orderedUnits)} في {linesLabel(t.orderedLines)})</span>
          )}
        </span>
        {t.missingUnits > 0 && <span className="num font-bold text-[#D64545]">✕ ناقص {unitsLabel(t.missingUnits)}</span>}
        {t.extraUnits > 0 && <span className="num font-bold text-[#DB8B12]">+ إضافي {unitsLabel(t.extraUnits)}</span>}
        {o.pickerName && <span>جهّزه: <b className="text-slate-800">{o.pickerName}</b></span>}
      </div>
    </div>
  );
}

function CustomerCard({ order }: { order: LookupResult }) {
  const c = order.customer;
  return (
    <Card title="الزبونة والعنوان">
      <div className="text-[15px] font-bold text-slate-900">{c.name ?? '—'}</div>
      {c.phone && <div className="font-mono text-[14px] text-slate-700" dir="ltr">{c.phone}</div>}
      <div className="mt-1 text-[13px] leading-6 text-slate-700">{c.addressLine ?? [c.governorate, c.area, c.street].filter(Boolean).join(' — ')}</div>
      {c.landmark && <div className="text-[12px] text-slate-500">أقرب نقطة دالة: {c.landmark}</div>}
    </Card>
  );
}

function NotesCards({ order }: { order: LookupResult }) {
  const o = order.order;
  if (!o.isGift && !o.notes) return null;
  return (
    <>
      {o.isGift && (
        <Card title="هدية" tone="gift">
          <div className="whitespace-pre-wrap text-[13px] text-slate-800">{o.giftMessage || 'بلا رسالة'}</div>
          {o.giftHidePrices && <div className="mt-1 text-[12px] font-bold text-pink-800">تُطبع فاتورة الزبونة بلا أسعار</div>}
        </Card>
      )}
      {o.notes && (
        <Card title="ملاحظات الطلب" tone="warn">
          <div className="whitespace-pre-wrap text-[13px] text-slate-800">{o.notes}</div>
        </Card>
      )}
    </>
  );
}

function Legend({ color, glyph, text }: { color: string; glyph: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white" style={{ background: color }}>{glyph}</span>
      {text}
    </span>
  );
}

/** نص الحقل باركود أو رمز طلب (لا اسم صنف): بعد فك تخطيط لوحة المفاتيح العربية يبقى رموزاً لاتينية بلا مسافات وفيه رقم. */
function looksLikeCode(text: string) {
  const v = collapseRepeatedScan(decodeScannerText(text)).trim();
  if (!v) return false;
  if (parseOrderCode(v)) return true;
  return /^[\x21-\x7e]+$/.test(v) && /\d/.test(v);
}

/**
 * حقل المسح الرئيسي: عريض، والمؤشر عليه دائماً. كل باركود يُمسح هنا (أو يُكتب ثم Enter) يمرّ بالمسار نفسه
 * للماسح: رمز الطلب يفتحه، وقطعة من الطلب تُطابَق، وغير ذلك يُضاف للطلب. الكتابة باسم الصنف تبحث في كتالوج المحل.
 */
function ScanBar({
  onScan,
  onAdd,
  canAdd,
  doubleCheck,
  active,
  busy,
  note,
}: {
  onScan: (code: string) => void;
  onAdd: (code: string) => void;
  canAdd: boolean;
  doubleCheck: boolean;
  /** لا نافذة مفتوحة: الحقل يستعيد المؤشر بعد أي نقرة. */
  active: boolean;
  busy: boolean;
  note: { text: string; ok: boolean } | null;
}) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ id: number; seq: number; name: string | null; barcode: string | null; price: number; stock: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = text.trim();
  // نص فيه حروف وليس باركوداً = بحث بالاسم بعد توقف الكتابة (للإضافة فقط).
  const isName = canAdd && q.length >= 2 && !looksLikeCode(q);

  // المؤشر دائماً على الحقل — إلا إن انتقل المستخدم لحقل كتابة آخر (ملاحظة المندوب مثلاً) أو يحدّد نصاً.
  useEffect(() => {
    if (!active) return;
    const refocus = () => {
      const el = inputRef.current;
      if (!el || el.disabled) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== el && a !== document.body && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
      if (window.getSelection()?.toString()) return;
      el.focus({ preventScroll: true });
    };
    refocus();
    const later = () => window.setTimeout(refocus, 120);
    document.addEventListener('mouseup', later);
    document.addEventListener('focusout', later);
    window.addEventListener('focus', later);
    return () => {
      document.removeEventListener('mouseup', later);
      document.removeEventListener('focusout', later);
      window.removeEventListener('focus', later);
    };
  }, [active]);

  useEffect(() => {
    if (!isName) {
      setResults([]);
      return;
    }
    const my = ++seqRef.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const list = await api.searchProducts(q);
        if (my !== seqRef.current) return;
        setResults(
          (list as unknown as { id: number; seq: number; name: string | null; barcode: string | null; price: number; stock: number }[]).slice(0, 8),
        );
        setOpen(true);
      } catch {
        if (my === seqRef.current) setResults([]);
      } finally {
        if (my === seqRef.current) setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, isName]);

  const reset = () => {
    setText('');
    setResults([]);
    setOpen(false);
  };
  const pick = (code: string) => {
    reset();
    onAdd(code);
  };

  return (
    <div className="relative">
      <form
        className={`flex items-center gap-2 rounded-xl border-2 px-2 py-1.5 transition-colors ${
          busy ? 'border-slate-200 bg-slate-50' : 'border-[#0f9f76] bg-white shadow-[0_0_0_3px_rgba(15,159,118,0.12)]'
        }`}
        onSubmit={e => {
          e.preventDefault();
          if (busy || !q) return; // يبقى النص في الحقل — Enter مرة أخرى بعد انتهاء العملية
          if (isName) {
            if (results[0]) pick(results[0].barcode || `POS:${results[0].seq}`);
            return;
          }
          const raw = text;
          reset();
          onScan(raw);
        }}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0f9f76] text-white" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
          </svg>
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 180)}
          placeholder={
            doubleCheck
              ? 'امسح كل قطعة هنا للمطابقة — قطعة ليست في الطلب تُضاف'
              : canAdd
                ? 'امسح الباركود هنا — أو اكتب الباركود / اسم الصنف للإضافة'
                : 'امسح الباركود أو QR الطلب هنا'
          }
          className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[16px] font-bold text-slate-900 outline-none placeholder:text-[13.5px] placeholder:font-normal placeholder:text-slate-400"
          autoComplete="off"
          spellCheck={false}
          aria-label="حقل المسح"
        />
        <button type="submit" disabled={busy || !q} className="shrink-0 rounded-lg bg-[#0f9f76] px-3 py-2 text-[12px] font-bold text-white disabled:bg-slate-300">
          {isName ? 'إضافة' : 'إدخال'}
        </button>
      </form>
      {note && (
        <div className={`mt-1 truncate px-1 text-[12px] font-bold ${note.ok ? 'text-emerald-700' : 'text-red-700'}`} title={note.text}>
          آخر مسح: {note.text}
        </div>
      )}
      {open && isName && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-[320px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {searching && !results.length && <div className="p-3 text-center text-[12px] text-slate-400">جاري البحث…</div>}
          {!searching && !results.length && <div className="p-3 text-center text-[12px] text-slate-400">لا نتائج لـ «{q}»</div>}
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(p.barcode || `POS:${p.seq}`)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-right hover:bg-emerald-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-slate-800">{p.name ?? '—'}</span>
                <span className="block font-mono text-[11px] text-slate-400" dir="ltr">{p.barcode || `#${p.seq}`}</span>
              </span>
              <span className="num shrink-0 text-[12px] font-bold text-slate-700">{formatIqd(p.price)}</span>
              <span className={`num shrink-0 rounded px-1.5 text-[11px] font-bold ${p.stock > 0 ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-[#D64545]'}`}>
                {p.stock > 0 ? `مخزون ${formatNum(p.stock)}` : 'نفد'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** حالة السطر كما تُعرض: مطابق، ناقص جزئي (برتقالي)، مُزال (أحمر مشطوب)، زيادة (أزرق)، إضافي (أصفر). */
type LineLook = { color: string; glyph: string; label: string; removed: boolean };

/** صف في الجدول: سطر الطلب، ومعه قطع الزيادة بنفس الباركود (تُعرض في الصف نفسه بالأزرق). */
type TableRow = { main: SiteLine; over: SiteLine | null };

function LinesTable({
  order,
  editable,
  editingLine,
  flash,
  doubleCheck,
  checked,
  onChangeLine,
  onToggleCharge,
  onPrice,
  onVerify,
  onUnverify,
}: {
  order: LookupResult;
  editable: boolean;
  editingLine: string | null;
  flash: string | null;
  /** المراجعة المزدوجة: الصف باهت حتى تُمسح قطعه أو تُعدّ بـ«+»، ثم «مطابق». */
  doubleCheck: boolean;
  checked: Record<string, number>;
  onChangeLine: (line: SiteLine, qty: number) => void;
  onToggleCharge: (line: SiteLine) => void;
  /** تعديل سعر القطعة (بصلاحية «تغيير السعر») — ضغطة على السعر. */
  onPrice?: (line: SiteLine) => void;
  onVerify: (line: SiteLine) => void;
  onUnverify: (line: SiteLine) => void;
}) {
  const byId = new Map(order.lines.map(l => [l.id, l]));
  const unresolved = new Set(order.local.lines.filter(l => !l.resolved).map(l => normBarcode(l.barcode)));
  // قطع زائدة لصنف من الطلب (إضافي مدفوع بنفس باركود سطر مطلوب) = «زيادة» في صف الصنف نفسه بالأزرق.
  const orderedByCode = new Map<string, SiteLine>();
  for (const l of order.lines) if (l.kind === 'ORDERED' && l.barcode && !orderedByCode.has(normBarcode(l.barcode))) orderedByCode.set(normBarcode(l.barcode), l);
  const overOf = (l: SiteLine) =>
    l.kind === 'EXTRA' && l.charge === 'PAID' && !l.substituteForLineId && !!l.barcode ? orderedByCode.get(normBarcode(l.barcode)) ?? null : null;
  const overByMain = new Map<string, SiteLine>();
  for (const l of order.lines) {
    const main = overOf(l);
    if (main && !overByMain.has(main.id)) overByMain.set(main.id, l);
  }
  const merged = new Set([...overByMain.values()].map(l => l.id));
  const rows: TableRow[] = order.lines.filter(l => !merged.has(l.id)).map(l => ({ main: l, over: overByMain.get(l.id) ?? null }));

  // سعر القطعة على الزبونة كما في إيصال الموقع: الهدية بصفر، والبديل بالأرخص.
  const chargeOf = (l: SiteLine) => {
    if (l.kind === 'EXTRA' && l.charge === 'FREE') return 0;
    if (l.kind === 'EXTRA' && l.substituteForLineId) return Math.min(l.unitPrice, byId.get(l.substituteForLineId)?.unitPrice ?? l.unitPrice);
    return l.unitPrice;
  };
  const verifiedOf = (l: SiteLine | null) => (l ? Math.min(checked[l.id] ?? 0, deliveredQty(l)) : 0);
  const rowTotal = (r: TableRow) => deliveredQty(r.main) + (r.over ? deliveredQty(r.over) : 0);
  const rowVerified = (r: TableRow) => verifiedOf(r.main) + verifiedOf(r.over);
  const rowPending = (r: TableRow) => doubleCheck && rowTotal(r) > 0 && rowVerified(r) < rowTotal(r);
  const lookOf = (r: TableRow): LineLook => {
    const l = r.main;
    const delivered = deliveredQty(l);
    const overQty = r.over ? deliveredQty(r.over) : 0;
    if (l.kind === 'ORDERED' && l.orderedQty > 0 && delivered === 0 && overQty === 0) return { color: LINE_COLORS.red, glyph: '✕', label: 'مُزال', removed: true };
    if (overQty > 0) return { color: OVER_BLUE, glyph: '+', label: `زيادة ${formatNum(overQty)}`, removed: false };
    if (l.kind === 'ORDERED' && delivered < l.orderedQty) return { color: SHORT_ORANGE, glyph: '−', label: `ناقص ${formatNum(l.orderedQty - delivered)}`, removed: false };
    if (l.kind === 'EXTRA') return { color: LINE_COLORS.yellow, glyph: '+', label: l.charge === 'FREE' ? 'هدية' : 'جديد', removed: false };
    return { color: LINE_COLORS.green, glyph: '✓', label: 'مطابق', removed: false };
  };
  const pendingCount = doubleCheck ? rows.filter(rowPending).length : 0;
  const showEdit = editable || doubleCheck;
  // صف واحد بارتفاع صغير: الحالة | الصنف | الكمية | المبلغ | الأزرار في سطر واحد.
  const cols = showEdit
    ? 'grid-cols-[52px_minmax(0,1fr)_72px_88px_max-content]'
    : 'grid-cols-[52px_minmax(0,1fr)_72px_88px]';
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/40">
      {doubleCheck && (
        <div className={`flex items-center justify-between gap-2 border-b px-3 py-1.5 text-[12px] font-bold ${pendingCount ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          <span>{pendingCount ? 'المراجعة: امسح كل قطعة أو اضغط «+» حتى يطابق — الناقص «ناقص»، والمحذوف «إزالة»' : 'كل الأصناف مطابقة ✓'}</span>
          <span className="num shrink-0">{formatNum(rows.length - pendingCount)} / {formatNum(rows.length)}</span>
        </div>
      )}
      <div className={`grid ${cols} items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] font-bold text-slate-500`}>
        <span className="text-center">الحالة</span>
        <span>الصنف</span>
        <span className="text-center">الكمية</span>
        <span className="text-center">المبلغ</span>
        {showEdit && <span className="text-center">{doubleCheck ? 'مطابقة / تعديل' : 'تعديل'}</span>}
      </div>
      {rows.map(r => {
        const l = r.main;
        const over = r.over;
        const look = lookOf(r);
        const sub = l.substituteForLineId ? byId.get(l.substituteForLineId) : null;
        const missingHere = l.barcode && unresolved.has(normBarcode(l.barcode));
        const delivered = deliveredQty(l);
        const overQty = over ? deliveredQty(over) : 0;
        const total = rowTotal(r);
        const free = l.kind === 'EXTRA' && l.charge === 'FREE';
        const unit = chargeOf(l);
        const amount = unit * delivered + (over ? chargeOf(over) * overQty : 0);
        const busyHere = editingLine === l.id || (!!over && editingLine === over.id);
        const verified = rowVerified(r);
        const pending = rowPending(r);
        // لون الصف: الباهت ينتظر المطابقة؛ المطابق يرتفع قليلاً بظل ولون حالته.
        const color = pending ? '#94A3B8' : look.color;
        const lifted = doubleCheck && !pending && !look.removed;
        const glyph = pending ? (verified > 0 ? formatNum(verified) : '') : look.glyph;
        const label = pending ? 'لم يطابق' : look.label;
        const detail = [
          l.kind === 'EXTRA' ? (free ? 'هدية مجانية' : sub ? null : 'صنف جديد ليس في الطلب') : null,
          sub ? `بديل عن ${sub.name}${sub.shadeName ? ` — ${sub.shadeName}` : ''}` : null,
          l.reason ? `السبب: ${l.reason}` : null,
        ].filter(Boolean).join(' · ');
        const detailColor = look.removed ? look.color : l.reason && l.kind === 'ORDERED' ? SHORT_ORANGE : LINE_COLORS.yellow;
        // «+»: قطعة تُطابَق (في المراجعة)، أو إرجاع قطعة ناقصة، أو قطعة زائدة في الصف نفسه.
        const plus = () => {
          if (pending) return onVerify(verifiedOf(l) < delivered ? l : over ?? l);
          onChangeLine(l, delivered + 1);
        };
        // «−»: في المراجعة تراجع عن قطعة مُطابَقة (الزيادة أولاً)؛ وإلا تنقص الزيادة أولاً ثم الصنف.
        const minus = () => {
          if (doubleCheck) return onUnverify(over && verifiedOf(over) > 0 ? over : l);
          if (over && overQty > 0) return onChangeLine(over, overQty - 1);
          onChangeLine(l, delivered - 1);
        };
        return (
          <div
            key={l.id}
            className={`relative grid ${cols} items-center gap-2 border-b border-slate-100 px-2 py-1 transition-all duration-300 last:border-b-0 ${
              flash === l.id || (over && flash === over.id) ? 'bg-emerald-50' : look.removed ? 'bg-red-50/60' : 'bg-white'
            } ${lifted ? 'z-[1] -translate-y-px shadow-[0_2px_6px_rgba(15,23,42,0.10)]' : ''}`}
            style={{ borderInlineStart: `5px solid ${color}` }}
          >
            <div className={`flex flex-col items-center gap-0.5 ${pending ? 'opacity-60' : ''}`} style={{ color }}>
              <span
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[12px] font-bold"
                style={pending ? { border: `2px dashed ${color}`, color } : { background: color, color: '#fff' }}
              >
                {glyph}
              </span>
              <span className="whitespace-nowrap text-center text-[9.5px] font-bold leading-[11px]">{label}</span>
            </div>
            <div className={`min-w-0 ${pending ? 'opacity-55' : ''}`}>
              <div className={`truncate text-[13px] font-bold leading-[18px] ${look.removed ? 'text-[#B42318] line-through decoration-2' : 'text-slate-900'}`} title={l.name}>
                {l.name}{l.shadeName ? <span className="font-normal text-slate-600"> — {l.shadeName}</span> : null}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
                <span className="shrink-0 font-mono text-slate-400" dir="ltr">{l.barcode ?? '—'}</span>
                {detail && (
                  <span className="truncate font-bold" style={{ color: detailColor }} title={detail}>
                    {detail}
                  </span>
                )}
                {missingHere && <span className="shrink-0 font-bold text-[#D64545]">غير موجود في كتالوج المحل</span>}
              </div>
            </div>
            <div className={`num text-center text-[12px] leading-4 ${pending ? 'opacity-80' : ''}`}>
              {doubleCheck && total > 0 ? (
                <div>
                  <b className="text-[14px]" style={{ color: pending ? '#334155' : LINE_COLORS.green }}>{formatNum(verified)}</b>
                  <span className="text-slate-400"> / {formatNum(total)}</span>
                </div>
              ) : l.kind === 'ORDERED' ? (
                <div>
                  <b className="text-[14px]" style={overQty > 0 ? { color: OVER_BLUE } : undefined}>{formatNum(total)}</b>{' '}
                  <span className="text-slate-400">/ {formatNum(l.orderedQty)}</span>
                </div>
              ) : (
                <div><b className="text-[14px]">{formatNum(total)}</b></div>
              )}
              {overQty > 0 ? (
                <div className="text-[10px] font-bold" style={{ color: OVER_BLUE }}>+{formatNum(overQty)} زيادة · مطلوب {formatNum(l.orderedQty)}</div>
              ) : doubleCheck && l.kind === 'ORDERED' && delivered !== l.orderedQty ? (
                <div className="text-[10px] text-slate-400">من {formatNum(l.orderedQty)} مطلوب</div>
              ) : null}
            </div>
            <div className={`num text-center leading-4 ${pending ? 'opacity-55' : ''}`}>
              <div className={`text-[12.5px] font-bold ${look.removed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{formatIqd(amount)}</div>
              {onPrice && !free && !look.removed ? (
                <button
                  type="button"
                  disabled={busyHere}
                  onClick={() => onPrice(l)}
                  title="تعديل سعر القطعة"
                  className="mx-auto flex items-center gap-0.5 rounded px-1 text-[10.5px] text-slate-500 underline decoration-dotted underline-offset-2 hover:bg-slate-100 hover:text-slate-800"
                >
                  × {formatIqd(unit)} <span aria-hidden>✎</span>
                </button>
              ) : (
                <div className="text-[10.5px] text-slate-500">{free ? 'مجاناً' : `× ${formatIqd(unit)}`}</div>
              )}
            </div>
            {showEdit && (
              <div className="flex items-center justify-end gap-1">
                <QtyButton
                  label="−"
                  className="!h-7 w-8"
                  title={
                    doubleCheck
                      ? 'تراجع عن قطعة مُطابَقة'
                      : over && overQty > 0
                        ? 'إنقاص قطعة من الزيادة'
                        : l.kind === 'ORDERED' ? 'إنقاص قطعة (يُسأل عن السبب)' : delivered <= 1 ? 'حذف الصنف الجديد' : 'إنقاص قطعة'
                  }
                  disabled={busyHere || (doubleCheck ? verified === 0 : total === 0 || !editable)}
                  onClick={minus}
                />
                <QtyButton
                  label="+"
                  className={`!h-7 ${doubleCheck ? 'w-9' : 'w-8'} ${pending ? '!border-emerald-500 !bg-emerald-50 !text-emerald-700' : ''}`}
                  title={pending ? 'مطابقة قطعة (كالمسح)' : l.kind === 'ORDERED' && delivered < l.orderedQty ? 'إرجاع قطعة ناقصة' : 'قطعة زائدة (زيادة في الصف نفسه)'}
                  disabled={busyHere || (!pending && (!editable || (l.kind === 'ORDERED' && delivered >= l.orderedQty && !l.barcode)))}
                  onClick={plus}
                />
                {editable && l.kind === 'ORDERED' && (
                  <>
                    {over && overQty > 0 ? (
                      <SmallAction tone="blue" disabled={busyHere} title="إلغاء كل القطع الزائدة" onClick={() => onChangeLine(over, 0)}>
                        إلغاء الزيادة
                      </SmallAction>
                    ) : (
                      <>
                        {doubleCheck && pending && (
                          <SmallAction
                            tone="orange"
                            disabled={busyHere}
                            title={verified > 0 ? `ناقص: يُسلَّم ${formatNum(verified)} فقط (يُسأل عن السبب)` : 'ناقص كله — يُزال (يُسأل عن السبب)'}
                            onClick={() => onChangeLine(l, verified)}
                          >
                            ناقص
                          </SmallAction>
                        )}
                        {delivered > 0 ? (
                          <SmallAction tone="red" disabled={busyHere} title="إزالة الصنف من الطلب (يُسأل عن السبب)" onClick={() => onChangeLine(l, 0)}>
                            إزالة
                          </SmallAction>
                        ) : (
                          <SmallAction tone="slate" disabled={busyHere} title="إرجاع الصنف للطلب" onClick={() => onChangeLine(l, l.orderedQty)}>
                            إرجاع
                          </SmallAction>
                        )}
                      </>
                    )}
                  </>
                )}
                {editable && l.kind === 'EXTRA' && (
                  <>
                    <SmallAction tone="amber" disabled={busyHere} title={free ? 'جعله مدفوعاً' : 'جعله هدية مجانية'} onClick={() => onToggleCharge(l)}>
                      {free ? 'مدفوع' : 'هدية'}
                    </SmallAction>
                    <SmallAction tone="red" disabled={busyHere} title="حذف الصنف من الطلب" onClick={() => onChangeLine(l, 0)}>
                      حذف
                    </SmallAction>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50 px-3 py-1 text-[10.5px] font-bold text-slate-600">
        {doubleCheck && <Legend color="#94A3B8" glyph="" text="لم يطابق بعد (باهت)" />}
        <Legend color={LINE_COLORS.green} glyph="✓" text="مطابق" />
        <Legend color={SHORT_ORANGE} glyph="−" text="ناقص" />
        <Legend color={LINE_COLORS.red} glyph="✕" text="مُزال (مشطوب)" />
        <Legend color={OVER_BLUE} glyph="+" text="زيادة في العدد" />
        <Legend color={LINE_COLORS.yellow} glyph="+" text="صنف جديد" />
      </div>
    </div>
  );
}

const ACTION_TONES = {
  orange: 'border-orange-300 bg-orange-50 text-[#C2410C]',
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-300 bg-amber-50 text-[#a8650a]',
  slate: 'border-slate-300 bg-white text-slate-600',
  blue: 'border-blue-300 bg-blue-50 text-[#1D4ED8]',
} as const;

function SmallAction({ tone, disabled, title, onClick, children }: { tone: keyof typeof ACTION_TONES; disabled: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`h-7 shrink-0 rounded-md border px-2 text-[11px] font-bold disabled:opacity-40 ${ACTION_TONES[tone]}`}
    >
      {children}
    </button>
  );
}

function QtyButton({ label, title, disabled, onClick, className = 'w-full' }: { label: string; title: string; disabled: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-8 ${className} items-center justify-center rounded-md border border-slate-300 bg-white text-[17px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-30`}
    >
      {label}
    </button>
  );
}

function AmountsCard({ order, onDiscount, onGift, pending = false }: { order: LookupResult; onDiscount?: () => void; onGift?: () => void; pending?: boolean }) {
  const m = order.money;
  const r = order.receipt;
  const gift = !!order.order.cashierGift;
  const manual = m.manualDiscount ?? order.order.cashierDiscount ?? 0;
  const otherDiscount = Math.max(0, r.discount - manual);
  return (
    <Card
      title={pending ? 'المبالغ · يُحدَّث…' : 'المبالغ'}
      right={
        onDiscount || onGift ? (
          <span className="flex gap-1.5">
            {onGift && (
              <button
                type="button"
                onClick={onGift}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-bold ${gift ? 'border-pink-600 bg-pink-600 text-white' : 'border-pink-400 bg-white text-pink-700 hover:bg-pink-50'}`}
                title="فاتورة هدية كالكاشير الأصلي"
              >
                {gift ? 'هدية ✓' : 'هدية'}
              </button>
            )}
            {onDiscount && (
              <button
                type="button"
                onClick={onDiscount}
                className="rounded-lg border border-[#0f9f76] bg-white px-2.5 py-1 text-[12px] font-bold text-[#0b7d5d] hover:bg-emerald-50"
              >
                {manual > 0 ? 'تعديل الخصم' : '+ خصم'}
              </button>
            )}
          </span>
        ) : undefined
      }
    >
      {gift && (
        <div className="mb-1.5 rounded-lg bg-pink-50 px-2 py-1.5 text-[12.5px] font-bold text-pink-800">
          فاتورة هدية — الأصناف بلا مقابل، وتُحفظ «هدية» في المحل والإداري
        </div>
      )}
      <div className={`transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <MoneyRow label="قيمة الأصناف المطلوبة" value={m.orderedSubtotal} />
      {m.shortageValue > 0 && <MoneyRow label="الناقص" value={-m.shortageValue} tone={LINE_COLORS.red} />}
      {m.extrasValue > 0 && <MoneyRow label="الإضافات المدفوعة" value={m.extrasValue} tone={LINE_COLORS.yellow} />}
      {m.freeExtrasValue > 0 && <MoneyRow label="هدايا مجانية (غير محسوبة)" value={m.freeExtrasValue} tone={LINE_COLORS.yellow} />}
      {r.shipping > 0 && <MoneyRow label={(order.local.shippingOutside ?? 0) > 0 ? 'التوصيل (خارج فاتورة المحل)' : 'التوصيل'} value={r.shipping} />}
      {r.giftWrap > 0 && <MoneyRow label={(order.local.giftWrapOutside ?? 0) > 0 ? 'تغليف الهدية (خارج فاتورة المحل)' : 'تغليف الهدية'} value={r.giftWrap} />}
      {otherDiscount > 0 && <MoneyRow label="خصومات الطلب" value={-otherDiscount} />}
      {manual > 0 && gift && <MoneyRow label="هدية (الأصناف بلا مقابل)" value={-manual} tone="#be185d" />}
      {manual > 0 && !gift && (
        <MoneyRow
          label={`خصم الكاشير${order.order.cashierDiscountNote ? ` — ${order.order.cashierDiscountNote}` : ''}`}
          value={-manual}
          tone="#7c3aed"
        />
      )}
      <div className="my-1.5 border-t border-slate-200" />
      <MoneyRow label="المبلغ النهائي" value={r.total} strong />
      {!order.order.prepaid && order.order.deliveryOption !== 'PICKUP' && (
        <MoneyRow label="تحصّله هاي إكسبريس" value={m.codAmount} strong tone="#0b7d5d" />
      )}
      {order.order.prepaid && <div className="text-[13px] font-bold text-emerald-700">مدفوع مسبقاً بالبطاقة</div>}
      {m.refundAmount > 0 && <MoneyRow label="يُسترجع للبطاقة" value={m.refundAmount} tone={LINE_COLORS.red} />}
      </div>
      {((order.local.shippingOutside ?? 0) > 0 || (order.local.giftWrapOutside ?? 0) > 0) && (
        <div className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
          <MoneyRow label={gift ? 'فاتورة المحل (هدية — قيمة الأصناف)' : 'فاتورة المحل (المنتجات فقط)'} value={gift ? order.local.receiptTotal ?? 0 : order.local.computedTotal} />
          <div className="text-[11px] leading-5 text-slate-500">
            أجور التوصيل والتغليف لا تدخل فاتورة المحل ولا الإداري — تحصّلها هاي إكسبريس مع الطلب.
          </div>
        </div>
      )}
      <div className="mt-1.5 text-[11px] leading-5 text-slate-500">
        إيصال المحل: {order.local.paymentLabel}{order.local.accountName ? ` — حساب «${order.local.accountName}»` : ''}
      </div>
    </Card>
  );
}

function OrderView({
  order,
  status,
  result,
  checked,
  editable,
  editingLine,
  flash,
  busy,
  offline,
  error,
  onAddBarcode,
  onScan,
  scanActive,
  scanNote,
  onChangeLine,
  onToggleCharge,
  onVerify,
  onUnverify,
  onFinalize,
  onReprint,
  onSlip,
  post,
}: {
  order: LookupResult;
  status: OnlineOrdersStatus | null;
  result: FinalizeResult | null;
  checked: Record<string, number>;
  editable: boolean;
  editingLine: string | null;
  flash: string | null;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onAddBarcode: (code: string) => void;
  /** حقل المسح: نفس مسار الماسح (رمز طلب / مطابقة / إضافة). */
  onScan: (code: string) => void;
  scanActive: boolean;
  scanNote: { text: string; ok: boolean } | null;
  onChangeLine: (line: SiteLine, qty: number) => void;
  onToggleCharge: (line: SiteLine) => void;
  onVerify: (line: SiteLine) => void;
  onUnverify: (line: SiteLine) => void;
  onFinalize: () => void;
  onReprint: (what: 'receipt' | 'invoice' | 'label') => void;
  onSlip: () => void;
  post: PostControls;
}) {
  const pickup = order.order.deliveryOption === 'PICKUP';
  const invoiced = order.invoiced;
  const blockers = [...order.blockers, ...order.local.problems];
  const doubleCheck = !!status?.print.doubleCheck && !invoiced;
  // كل سطر يُسلَّم منه شيء يجب أن يطابق (مسح أو «+»)، أو يُعلَّم «ناقص»/«إزالة».
  const checkMissing = doubleCheck ? order.lines.filter(l => deliveredQty(l) > 0 && (checked[l.id] ?? 0) < deliveredQty(l)) : [];
  let disabledReason: string | null = null;
  if (offline) disabledReason = 'لا اتصال بالموقع';
  else if (status && !status.enabled) disabledReason = 'كاشير الطلبات متوقف من لوحة التحكم';
  else if (invoiced) disabledReason = `مُفوتر بالإيصال ${invoiced.receiptNumber ?? ''}`;
  else if (!order.canInvoice) disabledReason = order.blockers[0] ?? 'الطلب غير جاهز للفوترة';
  else if (order.local.problems.length) disabledReason = order.local.problems[0];
  else if (checkMissing.length) disabledReason = `المراجعة المزدوجة: ${linesLabel(checkMissing.length)} لم تطابق بعد — امسحها أو اختر «ناقص»/«إزالة»`;
  const tracking = order.shipment?.trackingNumber ?? result?.shipment?.trackingNumber;
  const shipmentState = result?.shipment?.state ?? order.shipment?.state;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OrderHeader order={order} />
      {/* شاشة عريضة: عمودان يتمرّر كل منهما وحده. شاشة أضيق: عمود واحد يتمرّر كله (بلا تداخل). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto min-[1180px]:grid-cols-[minmax(0,1fr)_clamp(290px,24vw,370px)] min-[1180px]:content-stretch min-[1180px]:overflow-hidden">
        {/* الأصناف */}
        <div className="space-y-3 p-3 min-[1180px]:min-h-0 min-[1180px]:overflow-y-auto">
          {/* شاشة ضيقة: زر الإتمام أعلى الأصناف (في العريضة يبقى في العمود الجانبي). */}
          <div className="min-[1180px]:hidden">
            <ActionPanel
              order={order}
              pickup={pickup}
              invoiced={invoiced}
              blockers={blockers}
              disabledReason={disabledReason}
              tracking={tracking}
              shipmentState={shipmentState}
              busy={busy}
              error={error}
              onFinalize={onFinalize}
              onReprint={onReprint}
            />
          </div>
          <EdariPanel order={order} busy={busy} post={post} editable={editable} />
          <ScanBar
            onScan={onScan}
            onAdd={onAddBarcode}
            canAdd={editable}
            doubleCheck={doubleCheck}
            active={scanActive}
            busy={busy}
            note={scanNote}
          />
          {!editable && !invoiced && !EDITABLE_STAGES.includes(order.order.stage) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-800">
              {order.order.stage === 'PICKING' ? 'الطلب قيد التجهيز الآن — يُعدّل ويُفوتر بعد أن ينهيه الموظف.' : 'الطلب لم يُجهَّز بعد.'}
            </div>
          )}
          <LinesTable
            order={order}
            editable={editable}
            editingLine={editingLine}
            flash={flash}
            doubleCheck={doubleCheck}
            checked={checked}
            onChangeLine={onChangeLine}
            onToggleCharge={onToggleCharge}
            onPrice={editable && post.canPrice ? post.onPrice : undefined}
            onVerify={onVerify}
            onUnverify={onUnverify}
          />
        </div>

        {/* الزبونة والمبلغ والإجراء */}
        <aside className="space-y-3 border-t border-slate-100 bg-slate-50/50 p-3 min-[1180px]:min-h-0 min-[1180px]:overflow-y-auto min-[1180px]:border-s min-[1180px]:border-t-0">
          <div className="hidden min-[1180px]:block">
          <ActionPanel
            order={order}
            pickup={pickup}
            invoiced={invoiced}
            blockers={blockers}
            disabledReason={disabledReason}
            tracking={tracking}
            shipmentState={shipmentState}
            busy={busy}
            error={error}
            onFinalize={onFinalize}
            onReprint={onReprint}
          />
          </div>
          <CourierCard order={order} busy={busy} offline={offline} onSave={post.onSaveCourier} />
          <AmountsCard
            order={order}
            onDiscount={editable && post.canDiscount && !order.order.cashierGift ? post.onDiscount : undefined}
            onGift={editable && !invoiced && post.canGift && !order.order.prepaid ? post.onGift : undefined}
            pending={post.pendingEdits > 0}
          />
          <CustomerCard order={order} />
          <NotesCards order={order} />
          <button type="button" onClick={onSlip} disabled={busy} className="w-full rounded-xl border border-slate-300 bg-white py-2 text-[12px] font-bold text-slate-600">
            طباعة قائمة التجهيز (بلا أسعار)
          </button>
        </aside>
      </div>
    </div>
  );
}

type PostControls = {
  needsReprint: boolean;
  onReprintAll: () => void;
  onSyncReceipt: () => void;
  /** خيارات التوصيل: تُحفظ في الموقع (وتصل هاي إكسبريس بعد الفوترة). */
  onSaveCourier: (opts: CourierOptionsInput) => Promise<boolean>;
  /** خصم يدوي كالكاشير الأصلي (بصلاحية «خصم»). */
  canDiscount: boolean;
  onDiscount: () => void;
  /** تعديل سعر صنف كالكاشير الأصلي (بصلاحية «تغيير السعر»). */
  canPrice: boolean;
  onPrice: (line: SiteLine) => void;
  /** «فاتورة هدية» كالكاشير الأصلي (بصلاحية «الهدايا») — قبل الفوترة. */
  canGift: boolean;
  onGift: () => void;
  /** تعديلات لم يرد بها السيرفر بعد — المبالغ تقديرية لحظات. */
  pendingEdits: number;
};

type CourierOptionsInput = { typeId: number | null; parcelCount: number; note: string; phone2: string };

/** الفاتورة والإداري: بانتظار الترحيل (تُعدّل) أو رُحّلت، وتنبيه إعادة الطباعة بعد التعديل. */
function EdariPanel({ order, busy, post, editable }: { order: LookupResult; busy: boolean; post: PostControls; editable: boolean }) {
  const e = order.local.edari;
  if (!order.invoiced || !e) return null;
  if (e.posted || e.releasedAt) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12px] leading-5 text-slate-600">
        <b className="text-slate-800">{e.posted ? 'رُحّلت إلى الإداري' : 'أُرسلت للترحيل'}</b>
        {e.releasedByName ? ` — ${e.releasedByName}` : ''}{e.releasedAt ? ` · ${new Date(e.releasedAt).toLocaleString('en-GB', { hour12: false })}` : ''}
        <div>لا تُعدّل الفاتورة بعد الترحيل؛ أي تغيير يكون بإيصال إرجاع.</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {post.needsReprint && (
        <div className="rounded-xl border-2 border-[#DB8B12] bg-amber-50 p-3">
          <div className="text-[14px] font-bold text-[#a8650a]">عُدّلت الفاتورة — اطبعها من جديد</div>
          <div className="mb-2 text-[12px] leading-5 text-amber-900">
            عُدّل الطلب في الموقع{order.order.deliveryOption !== 'PICKUP' ? ' وعند هاي إكسبريس' : ''}. الإيصال والملصق المطبوعان قديمان — استبدلهما في الكيس.
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={post.onReprintAll}
            className="h-12 w-full rounded-xl bg-[#DB8B12] text-[15px] font-bold text-white disabled:bg-slate-300"
          >
            طباعة الإيصال والفاتورة والملصق
          </button>
        </div>
      )}
      {e.outOfSync && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] leading-5 text-red-800">
          <b>إيصال المحل لا يطابق الطلب</b> ({formatIqd(e.receiptTotal)} بدل {formatIqd(order.receipt.total)}) — تعديل لم يكتمل في المحل.
          <button type="button" disabled={busy} onClick={post.onSyncReceipt} className="mt-2 w-full rounded-lg bg-[#D64545] py-2 text-[13px] font-bold text-white disabled:bg-slate-300">
            مزامنة إيصال المحل
          </button>
        </div>
      )}
      {/* الترحيل نفسه من تبويب «بانتظار الترحيل» أو لوحة التحكم — هنا تنبيه صغير فقط. */}
      <div className="rounded-lg bg-sky-50 px-3 py-1.5 text-[12px] leading-5 text-sky-900">
        {editable
          ? 'الفاتورة لم تُرحَّل بعد — يمكن تعديلها، ويتعدّل الموقع وهاي إكسبريس معها.'
          : 'الفاتورة لم تُرحَّل بعد.'}
        {e.edits > 0 ? ` عُدّلت ${e.edits === 1 ? 'مرة' : `${e.edits} مرات`}.` : ''}
      </div>
    </div>
  );
}

/** خيارات التوصيل عند هاي إكسبريس: نوع الشحنة (كمربعات ملصقهم)، الطرود، ملاحظة للمندوب، هاتف ثانٍ. */
/**
 * خيارات التوصيل عند هاي إكسبريس: نوع الشحنة (كمربعات ملصقهم)، الطرود، ملاحظة للمندوب، هاتف ثانٍ.
 * قبل الفوترة: تُحفظ فور اختيارها (لا زر حفظ يُنسى) وتُرسل مع إنشاء الشحنة.
 * بعد الفوترة: «حفظ وإرسال» صريح — يعدّل الشحنة عند هاي إكسبريس ويطبع الملصق الجديد.
 */
function CourierCard({ order, busy, offline, onSave }: { order: LookupResult; busy: boolean; offline: boolean; onSave: (o: CourierOptionsInput) => Promise<boolean> }) {
  const c = order.courier;
  const initial = useMemo<CourierOptionsInput>(
    () => ({
      typeId: c?.typeId ?? null,
      parcelCount: Math.max(1, c?.parcelCount ?? order.order.parcelCount ?? 1),
      note: c?.note ?? '',
      phone2: c?.phone2 ?? '',
    }),
    [c?.typeId, c?.parcelCount, c?.note, c?.phone2, order.order.parcelCount],
  );
  const [form, setForm] = useState(initial);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef(0);
  // من الخادم عند فتح طلب آخر فقط — لا يُمسح ما يكتبه الكاشير أثناء الحفظ التلقائي.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial), [order.order.id, !!order.invoiced]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!c || order.order.deliveryOption === 'PICKUP') return null;
  const invoiced = !!order.invoiced;
  const locked = invoiced && !INVOICED_EDIT_STAGES.includes(order.order.stage);
  const auto = !invoiced;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const effective = form.typeId != null ? (form.typeId > 0 ? form.typeId : null) : c.defaultTypeId;
  const sentType = invoiced ? c.effectiveTypeId : null;
  const defaultName = c.types.find(t => t.id === c.defaultTypeId)?.name;
  const disabled = busy || offline || locked;

  /** قبل الفوترة: حفظ فوري (النوع والطرود) أو بعد التوقف عن الكتابة (الملاحظة والهاتف). */
  const commit = (next: CourierOptionsInput, delayMs = 0) => {
    setForm(next);
    if (!auto) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      if (JSON.stringify(next) === JSON.stringify(initial)) return;
      setSaveState('saving');
      const ok = await onSave(next);
      setSaveState(ok ? 'saved' : 'error');
    }, delayMs);
  };

  return (
    <Card
      title="خيارات التوصيل — هاي إكسبريس"
      right={
        locked ? <span className="text-[11px] font-bold text-slate-400">بعد استلام المندوب لا تُعدّل</span>
        : auto && saveState === 'saving' ? <span className="text-[11px] font-bold text-slate-500">جاري الحفظ…</span>
        : auto && saveState === 'saved' && !dirty ? <span className="text-[11px] font-bold text-[#1F9D63]">✓ حُفظت</span>
        : auto && saveState === 'error' ? <span className="text-[11px] font-bold text-[#D64545]">لم تُحفظ — أعد المحاولة</span>
        : undefined
      }
    >
      <div className="mb-1 text-[12px] font-bold text-slate-600">نوع الشحنة (يظهر على ملصق هاي إكسبريس)</div>
      <div className="grid grid-cols-2 gap-1.5">
        {c.types.map(t => {
          const on = effective === t.id;
          // هاي إكسبريس لا تقبل إلغاء نوع أُرسل لها — يُغيَّر لنوع آخر فقط.
          const cannotClear = on && sentType === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled || cannotClear}
              title={cannotClear ? 'أُرسل لهاي إكسبريس — يُغيَّر لنوع آخر ولا يُلغى' : undefined}
              onClick={() => commit({ ...form, typeId: on ? 0 : t.id })}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[12.5px] font-bold transition disabled:cursor-not-allowed ${
                on ? 'border-[#0f9f76] bg-emerald-50 text-[#0b7d5d]' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              } ${disabled && !on ? 'opacity-50' : ''}`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${on ? 'border-[#0f9f76] bg-[#0f9f76] text-white' : 'border-slate-400'}`}>
                {on ? '✓' : ''}
              </span>
              {t.name}
            </button>
          );
        })}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-slate-500">
        {form.typeId == null
          ? defaultName ? `الافتراضي من الإعدادات: ${defaultName}` : 'بلا نوع'
          : form.typeId === 0 ? 'بلا نوع لهذا الطلب' : 'مختار لهذا الطلب'}
        {sentType ? ' · بعد إرساله لهاي إكسبريس يُغيَّر لنوع آخر فقط' : ''}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-slate-600">عدد الطرود (ملصق لكل طرد)</span>
        <div className="flex items-center gap-1.5">
          <QtyButton className="w-8" label="−" title="أقل" disabled={disabled || form.parcelCount <= 1} onClick={() => commit({ ...form, parcelCount: Math.max(1, form.parcelCount - 1) }, 500)} />
          <span className="num w-7 text-center text-[16px] font-bold">{form.parcelCount}</span>
          <QtyButton className="w-8" label="+" title="أكثر" disabled={disabled || form.parcelCount >= 20} onClick={() => commit({ ...form, parcelCount: Math.min(20, form.parcelCount + 1) }, 500)} />
        </div>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[12px] font-bold text-slate-600">ملاحظة للمندوب</span>
        <input
          value={form.note}
          disabled={disabled}
          maxLength={300}
          onChange={e => commit({ ...form, note: e.target.value }, 1200)}
          onBlur={() => commit(form)}
          placeholder="مثلاً: اتصل قبل الوصول بساعة"
          className="pos-field w-full text-[13px]"
        />
      </label>
      <label className="mt-2 block">
        <span className="mb-1 block text-[12px] font-bold text-slate-600">هاتف ثانٍ للزبونة</span>
        <input
          value={form.phone2}
          disabled={disabled}
          onChange={e => commit({ ...form, phone2: e.target.value.replace(/[^\d+]/g, '') }, 1500)}
          onBlur={() => commit(form)}
          placeholder="07xxxxxxxxx"
          className="pos-field w-full text-[13px]"
          dir="ltr"
        />
      </label>

      {!auto && dirty && (
        <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" disabled={busy} onClick={() => setForm(initial)} className="rounded-lg border border-slate-300 bg-white py-2 text-[12px] font-bold text-slate-600">
            تراجع
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onSave(form)}
            className="rounded-lg bg-[#0f9f76] py-2 text-[13px] font-bold text-white disabled:bg-slate-300"
          >
            حفظ وإرسال لهاي إكسبريس وطباعة الملصق
          </button>
        </div>
      )}
    </Card>
  );
}

function ActionPanel({
  order,
  pickup,
  invoiced,
  blockers,
  disabledReason,
  tracking,
  shipmentState,
  busy,
  error,
  onFinalize,
  onReprint,
}: {
  order: LookupResult;
  pickup: boolean;
  invoiced: LookupResult['invoiced'];
  blockers: string[];
  disabledReason: string | null;
  tracking: string | null | undefined;
  shipmentState: string | null | undefined;
  busy: boolean;
  error: string | null;
  onFinalize: () => void;
  onReprint: (what: 'receipt' | 'invoice' | 'label') => void;
}) {
  return (
    <div className="space-y-2">
      {!invoiced && blockers.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="mb-1 text-[13px] font-bold text-[#D64545]">موانع الفوترة</div>
          <ul className="list-inside list-disc space-y-0.5 text-[13px] leading-5 text-red-800">
            {blockers.map(b => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] font-bold leading-5 text-[#D64545]">{error}</div>}

      {invoiced ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-[14px] font-bold text-emerald-800">
            {pickup ? 'سُلّم للزبونة' : 'مُفوتر'} — إيصال المحل <span className="font-mono" dir="ltr">{invoiced.receiptNumber}</span>
          </div>
          <div className="text-[12px] text-emerald-900/70">{invoiced.cashierName ?? ''}{invoiced.at ? ` · ${new Date(invoiced.at).toLocaleString('en-GB', { hour12: false })}` : ''}</div>
          {!pickup && (
            <div className="mt-1 text-[12px] leading-5">
              الشحنة: <b>{SHIPMENT_STATE_LABELS[shipmentState ?? ''] ?? shipmentState ?? 'لم تُنشأ بعد'}</b>
              {tracking ? <span className="font-mono" dir="ltr"> · {tracking}</span> : ''}
              {shipmentState && shipmentState !== 'CREATED' && (
                <div className="text-amber-700">رقم التتبع لم يصل — الطلب في «بانتظار التوصيل»، اطبع الملصق من هناك حين يصل.</div>
              )}
              {order.shipment?.lastError && <div className="text-[#D64545]">{order.shipment.lastError}</div>}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ReprintButton onClick={() => onReprint('receipt')} disabled={busy}>طباعة الإيصال</ReprintButton>
            <ReprintButton onClick={() => onReprint('invoice')} disabled={busy}>طباعة الفاتورة</ReprintButton>
            {!pickup && <ReprintButton onClick={() => onReprint('label')} disabled={busy || !tracking} wide>طباعة الملصق</ReprintButton>}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">إعادة الطباعة لا تنشئ إيصالاً ولا شحنة.</div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={onFinalize}
            disabled={busy || !!disabledReason}
            className="flex h-[72px] w-full flex-col items-center justify-center rounded-2xl bg-[#0f9f76] text-white shadow-[0_10px_24px_rgba(15,159,118,0.35)] transition hover:bg-[#0b7d5d] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            <span className="text-[20px] font-bold leading-6">{pickup ? 'تسليم للزبونة' : 'إتمام وطباعة'}</span>
            <span className="num text-[13px] font-bold opacity-90">{formatIqd(order.receipt.total)}</span>
          </button>
          {disabledReason ? (
            <div className="mt-1.5 text-center text-[13px] font-bold leading-5 text-[#D64545]">{disabledReason}</div>
          ) : (
            <div className="mt-1.5 text-center text-[12px] leading-5 text-slate-500">
              {pickup ? 'يُحفظ الإيصال ويُطبع وتُسجّل الزبونة «استلمت».' : 'يُحفظ الإيصال، تُنشأ شحنة هاي إكسبريس، ثم يُطبع الإيصال والفاتورة والملصق.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReprintButton({ children, onClick, disabled, wide }: { children: ReactNode; onClick: () => void; disabled?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg bg-slate-800 px-3 py-2 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${wide ? 'col-span-2' : ''}`}
    >
      {children}
    </button>
  );
}

// ───────────────────────── النوافذ ─────────────────────────

function Modal({ children, onClose, width = 460 }: { children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" style={{ maxWidth: width }} dir="rtl">
        {children}
      </div>
    </div>
  );
}

function AddItemDialog({
  state,
  order,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: AddState;
  order: LookupResult | null;
  onChange: (s: AddState) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const p = state.product;
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  // Enter يؤكد وEsc يلغي (خارج حقل السبب؛ الماسح يُرسل Enter بعد الباركود فيُلتقط هناك أولاً).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Enter الماسح يلتقطه useBarcodeCapture أولاً (ويمنعه) — مسحة أخرى تزيد الكمية ولا تؤكد.
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === 'Escape') { e.preventDefault(); cancelRef.current(); }
      else if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault();
        confirmRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const inOrder = useMemo(() => {
    if (!order || !p) return null;
    const keys = [normBarcode(p.siteBarcode), normBarcode(p.barcode), normBarcode(state.barcode)].filter(Boolean);
    return order.lines.find(l => keys.some(k => lineMatches(order, l, k))) ?? null;
  }, [order, p, state.barcode]);
  const fillsShortage = !!inOrder && inOrder.kind === 'ORDERED' && inOrder.pickedQty < inOrder.orderedQty && state.charge === 'PAID';
  const unit = state.charge === 'FREE' ? 0 : p?.price ?? 0;
  // الناقص يُكمل بسعر الطلب، والباقي إضافي (بسعر التطبيق إن وُجد الصنف فيه، وإلا سعر المحل).
  const fill = fillsShortage && inOrder ? Math.min(state.qty, inOrder.orderedQty - inOrder.pickedQty) : 0;
  const addedValue = fill * (inOrder?.unitPrice ?? 0) + (state.qty - fill) * unit;

  return (
    <Modal onClose={onCancel}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">إضافة صنف للطلب</h2>
        <span className="font-mono text-[12px] text-slate-400" dir="ltr">{state.barcode}</span>
      </div>
      {state.loading || !p ? (
        <div className="flex items-center gap-3 py-8 text-[14px] text-slate-500">
          <span className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-[#0f9f76]" />
          جاري البحث في كتالوج المحل…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[16px] font-bold leading-6 text-slate-900">{p.name ?? state.barcode}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
              <span>السعر: <b className="num text-slate-900">{formatIqd(p.price)}</b>{p.originalPrice > p.price ? <span className="num text-slate-400 line-through"> {formatIqd(p.originalPrice)}</span> : null}</span>
              <span className={p.stock > 0 ? '' : 'font-bold text-[#D64545]'}>المخزون: <b className="num">{formatNum(p.stock)}</b></span>
              {p.offerName && <span className="text-emerald-700">{p.offerName}</span>}
            </div>
            {inOrder && (
              <div className="mt-2 rounded-lg bg-white px-2 py-1.5 text-[12px] font-bold text-slate-700">
                {inOrder.kind === 'ORDERED'
                  ? `موجود في الطلب: طُلب ${inOrder.orderedQty}، جُهّز ${Math.min(inOrder.pickedQty, inOrder.orderedQty)}`
                  : `مضاف كإضافي (${inOrder.pickedQty})`}
                {fillsShortage && <span className="text-[#1F9D63]"> — سيكمل الناقص أولاً</span>}
              </div>
            )}
            <div className="mt-1 text-[11px] text-slate-500">
              إن كان الصنف في التطبيق يُحسب بسعر التطبيق، وإلا بسعر المحل.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-slate-600">الكمية</span>
              <QtyButton className="w-9" label="−" title="أقل" disabled={state.qty <= 1} onClick={() => onChange({ ...state, qty: Math.max(1, state.qty - 1) })} />
              <span className="num w-10 text-center text-[20px] font-bold">{state.qty}</span>
              <QtyButton className="w-9" label="+" title="أكثر (أو امسح الباركود مرة أخرى)" disabled={state.qty >= 999} onClick={() => onChange({ ...state, qty: Math.min(999, state.qty + 1) })} />
            </div>
            <div className="flex overflow-hidden rounded-xl border border-slate-300 text-[13px] font-bold">
              <button
                type="button"
                onClick={() => onChange({ ...state, charge: 'PAID' })}
                className={`px-3 py-1.5 ${state.charge === 'PAID' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
              >
                مدفوع
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...state, charge: 'FREE' })}
                className={`px-3 py-1.5 ${state.charge === 'FREE' ? 'bg-[#DB8B12] text-white' : 'bg-white text-slate-600'}`}
              >
                هدية مجانية
              </button>
            </div>
          </div>

          <input
            value={state.reason}
            onChange={e => onChange({ ...state, reason: e.target.value })}
            placeholder="السبب (اختياري) — مثلاً: طلبته الزبونة هاتفياً"
            className="pos-field w-full text-[13px]"
          />

          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-[14px]">
            <span className="font-bold text-slate-700">يُضاف للمبلغ تقريباً</span>
            <span className="num text-[17px] font-bold text-[#0b7d5d]">{formatIqd(addedValue)}</span>
          </div>
          {state.error && <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-[13px] font-bold text-[#D64545]">{state.error}</div>}
        </div>
      )}
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 bg-white py-3 text-[14px] font-bold text-slate-700">
          إلغاء
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!p || state.saving}
          className="rounded-xl bg-[#0f9f76] py-3 text-[15px] font-bold text-white disabled:bg-slate-300"
        >
          {state.saving ? 'جاري الإضافة…' : 'إضافة للطلب (Enter)'}
        </button>
      </div>
    </Modal>
  );
}

/** خصم يدوي كما في الكاشير الأصلي: مبلغ أو نسبة، أزرار سريعة، سبب، وحد الخصم من الصلاحيات. */
function DiscountDialog({
  order,
  limit,
  onClose,
  onApply,
}: {
  order: LookupResult;
  limit: number;
  onClose: () => void;
  onApply: (amount: number, reason: string) => Promise<boolean>;
}) {
  const current = order.money.manualDiscount ?? order.order.cashierDiscount ?? 0;
  // أساس الخصم: قيمة الأصناف بعد خصومها، بلا التوصيل (كما يحسبه الموقع).
  const base = Math.max(0, order.receipt.itemsTotal - Math.max(0, order.receipt.discount - current));
  const [mode, setMode] = useState<'amount' | 'percent'>('amount');
  const [input, setInput] = useState(current > 0 ? String(current) : '');
  const [reason, setReason] = useState(order.order.cashierDiscountNote ?? '');
  const [saving, setSaving] = useState(false);
  const n = Number(input.replace(/[^\d.]/g, '')) || 0;
  const raw = mode === 'percent' ? Math.round((base * Math.min(100, n)) / 100) : Math.round(n);
  const amount = capUserDiscount(raw, limit, base);
  const capped = amount < raw;
  const after = Math.max(0, order.receipt.total + current - amount);

  async function submit(value: number) {
    if (saving) return;
    setSaving(true);
    const ok = await onApply(value, reason);
    if (!ok) setSaving(false);
  }

  return (
    <Modal onClose={onClose} width={440}>
      <h2 className="mb-1 text-[17px] font-bold text-slate-900">خصم على الطلب</h2>
      <p className="mb-3 text-[12px] leading-5 text-slate-500">
        على الأصناف ({formatIqd(base)}) — التوصيل لا يُخصم. {limit > 0 ? `حدّك ${formatIqd(limit)}.` : ''}
      </p>
      <div className="mb-2 flex overflow-hidden rounded-xl border border-slate-300 text-[13px] font-bold">
        <button type="button" onClick={() => setMode('amount')} className={`flex-1 py-1.5 ${mode === 'amount' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>
          مبلغ (د.ع)
        </button>
        <button type="button" onClick={() => setMode('percent')} className={`flex-1 py-1.5 ${mode === 'percent' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>
          نسبة %
        </button>
      </div>
      <input
        autoFocus
        value={input}
        onChange={e => setInput(e.target.value.replace(/[^\d.]/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(amount); } }}
        placeholder={mode === 'percent' ? 'مثلاً 10' : 'مثلاً 5000'}
        className="pos-field num w-full text-center text-[22px] font-bold"
        dir="ltr"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(mode === 'percent' ? [5, 10, 15, 20] : [1000, 2000, 5000, 10000]).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setInput(String(v))}
            className="num rounded-full border border-slate-300 bg-white px-3 py-1 text-[12px] font-bold text-slate-700 hover:border-[#0f9f76]"
          >
            {mode === 'percent' ? `${v}%` : formatNum(v)}
          </button>
        ))}
      </div>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="السبب (اختياري) — مثلاً: زبونة دائمة"
        className="pos-field mt-3 w-full text-[13px]"
      />
      <div className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[13px]">
        <div className="flex justify-between"><span>الخصم</span><b className="num" dir="ltr">{formatIqd(amount)}</b></div>
        <div className="flex justify-between text-[15px]"><span className="font-bold">المبلغ بعد الخصم</span><b className="num text-[#0b7d5d]" dir="ltr">{formatIqd(after)}</b></div>
        {capped && <div className="text-[12px] font-bold text-[#DB8B12]">خُفّض للحد المسموح</div>}
        {order.invoiced && <div className="text-[12px] text-slate-500">الفاتورة مُفوترة: يتعدّل المبلغ عند هاي إكسبريس، ثم اطبع الإيصال والملصق من جديد.</div>}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_1fr_2fr] gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white py-2.5 text-[13px] font-bold text-slate-700">
          إغلاق
        </button>
        <button
          type="button"
          disabled={saving || current === 0}
          onClick={() => void submit(0)}
          className="rounded-xl border border-red-200 bg-red-50 py-2.5 text-[13px] font-bold text-red-700 disabled:opacity-40"
        >
          إلغاء الخصم
        </button>
        <button
          type="button"
          disabled={saving || amount <= 0 || amount === current}
          onClick={() => void submit(amount)}
          className="rounded-xl bg-[#0f9f76] py-2.5 text-[14px] font-bold text-white disabled:bg-slate-300"
        >
          {saving ? 'جاري التطبيق…' : 'تطبيق الخصم'}
        </button>
      </div>
    </Modal>
  );
}

/** تعديل سعر القطعة لصنف (بصلاحية «تغيير السعر» كالكاشير الأصلي). */
function PriceDialog({
  order,
  line,
  onClose,
  onApply,
}: {
  order: LookupResult;
  line: SiteLine;
  onClose: () => void;
  onApply: (unitPrice: number, reason: string) => Promise<boolean>;
}) {
  const [input, setInput] = useState(String(line.unitPrice));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const price = Math.round(Number(input.replace(/[^\d]/g, '')) || 0);
  const qty = deliveredQty(line);
  const diff = (price - line.unitPrice) * qty;
  const valid = input.trim() !== '' && price >= 0 && price <= 100_000_000;

  async function submit() {
    if (saving || !valid || price === line.unitPrice) return;
    setSaving(true);
    const ok = await onApply(price, reason);
    if (!ok) setSaving(false);
  }

  return (
    <Modal onClose={onClose} width={440}>
      <h2 className="mb-1 text-[17px] font-bold text-slate-900">تعديل سعر الصنف</h2>
      <p className="mb-3 truncate text-[13px] font-bold text-slate-600" title={line.name}>
        {line.name}{line.shadeName ? ` — ${line.shadeName}` : ''}
      </p>
      <div className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-[13px]">
        <span>السعر الحالي للقطعة</span>
        <b className="num" dir="ltr">{formatIqd(line.unitPrice)}</b>
      </div>
      <input
        autoFocus
        value={input}
        onFocus={e => e.currentTarget.select()}
        onChange={e => setInput(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        placeholder="السعر الجديد للقطعة"
        className="pos-field num w-full text-center text-[22px] font-bold"
        dir="ltr"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[5, 10, 15, 20].map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setInput(String(Math.round((line.unitPrice * (100 - p)) / 100 / 250) * 250))}
            className="num rounded-full border border-slate-300 bg-white px-3 py-1 text-[12px] font-bold text-slate-700 hover:border-[#0f9f76]"
          >
            −{p}%
          </button>
        ))}
      </div>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="السبب (اختياري) — مثلاً: سعر المحل"
        className="pos-field mt-3 w-full text-[13px]"
      />
      <div className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[13px]">
        <div className="flex justify-between"><span>× {formatNum(qty)} قطعة</span><b className="num" dir="ltr">{formatIqd(price * qty)}</b></div>
        <div className="flex justify-between text-[15px]">
          <span className="font-bold">المبلغ بعد التعديل</span>
          <b className="num text-[#0b7d5d]" dir="ltr">{formatIqd(Math.max(0, order.receipt.total + diff))}</b>
        </div>
        {order.invoiced && <div className="text-[12px] text-slate-500">الفاتورة مُفوترة: يتعدّل المبلغ عند هاي إكسبريس، ثم اطبع الإيصال والملصق من جديد.</div>}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white py-2.5 text-[13px] font-bold text-slate-700">
          إغلاق
        </button>
        <button
          type="button"
          disabled={saving || !valid || price === line.unitPrice}
          onClick={() => void submit()}
          className="rounded-xl bg-[#0f9f76] py-2.5 text-[14px] font-bold text-white disabled:bg-slate-300"
        >
          {saving ? 'جاري الحفظ…' : 'حفظ السعر'}
        </button>
      </div>
    </Modal>
  );
}

/** «فاتورة هدية» كالكاشير الأصلي: الأصناف بلا مقابل وإيصال المحل هدية — قبل الفوترة. */
function GiftDialog({
  order,
  onClose,
  onApply,
}: {
  order: LookupResult;
  onClose: () => void;
  onApply: (gift: boolean, reason: string) => Promise<boolean>;
}) {
  const on = !!order.order.cashierGift;
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const fees = order.receipt.shipping + order.receipt.giftWrap;
  const pickup = order.order.deliveryOption === 'PICKUP';

  async function submit(gift: boolean) {
    if (saving) return;
    setSaving(true);
    const ok = await onApply(gift, reason);
    if (!ok) setSaving(false);
  }

  return (
    <Modal onClose={onClose} width={440}>
      <h2 className="mb-1 text-[17px] font-bold text-slate-900">{on ? 'إلغاء فاتورة الهدية' : 'فاتورة هدية'}</h2>
      <p className="mb-3 text-[13px] leading-6 text-slate-600">
        {on
          ? 'يعود الطلب فاتورة بيع عادية بمبلغه كاملاً.'
          : 'كالكاشير الأصلي: تُحفظ الفاتورة «هدية» في المحل والإداري، والأصناف بلا مقابل على الزبونة.'}
      </p>
      {!on && (
        <div className="space-y-1 rounded-xl bg-pink-50 px-3 py-2 text-[13px] text-pink-900">
          <div className="flex justify-between"><span>قيمة الأصناف (هدية)</span><b className="num" dir="ltr">{formatIqd(order.receipt.itemsTotal)}</b></div>
          <div className="flex justify-between text-[15px]">
            <span className="font-bold">{pickup ? 'تدفعه الزبونة' : 'تحصّله هاي إكسبريس'}</span>
            <b className="num" dir="ltr">{formatIqd(fees)}</b>
          </div>
          <div className="text-[11.5px] text-pink-800">{fees > 0 ? 'أجور التوصيل/التغليف فقط.' : 'لا يُحصّل أي مبلغ.'}</div>
        </div>
      )}
      {!on && (
        <input
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="السبب (اختياري) — مثلاً: هدية من الإدارة"
          className="pos-field mt-3 w-full text-[13px]"
        />
      )}
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white py-2.5 text-[13px] font-bold text-slate-700">
          إغلاق
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit(!on)}
          className={`rounded-xl py-2.5 text-[14px] font-bold text-white disabled:bg-slate-300 ${on ? 'bg-slate-700' : 'bg-pink-600'}`}
        >
          {saving ? 'جاري الحفظ…' : on ? 'إلغاء الهدية' : 'تحويل لفاتورة هدية'}
        </button>
      </div>
    </Modal>
  );
}

function ReasonDialog({
  state,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: ReasonState;
  onChange: (s: ReasonState) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const quick = ['نفد من المحل', 'قطعة تالفة', 'الزبونة ألغت الصنف', 'تاريخ قريب الانتهاء'];
  const l = state.line;
  return (
    <Modal onClose={onCancel} width={420}>
      <h2 className="mb-1 text-[17px] font-bold text-slate-900">سبب النقص</h2>
      <div className="mb-3 text-[13px] leading-6 text-slate-600">
        {l.name}{l.shadeName ? ` — ${l.shadeName}` : ''}: يُسلَّم <b className="num">{state.qty}</b> من <b className="num">{l.orderedQty}</b>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {quick.map(q => (
          <button
            key={q}
            type="button"
            onClick={() => onChange({ ...state, reason: q, error: null })}
            className={`rounded-full border px-3 py-1 text-[12px] font-bold ${state.reason === q ? 'border-[#D64545] bg-red-50 text-[#D64545]' : 'border-slate-300 bg-white text-slate-600'}`}
          >
            {q}
          </button>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); onConfirm(); }}>
        <input
          autoFocus
          value={state.reason}
          onChange={e => onChange({ ...state, reason: e.target.value, error: null })}
          placeholder="اكتب السبب"
          className="pos-field w-full text-[13px]"
        />
        {state.error && <div className="mt-2 text-[13px] font-bold text-[#D64545]">{state.error}</div>}
        <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 bg-white py-2.5 text-[14px] font-bold text-slate-700">
            إلغاء
          </button>
          <button type="submit" disabled={state.saving} className="rounded-xl bg-[#D64545] py-2.5 text-[14px] font-bold text-white disabled:bg-slate-300">
            {state.saving ? 'جاري الحفظ…' : 'تأكيد النقص'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────── المرتجعات ─────────────────────────

function ReturnView({
  order,
  lines,
  returned,
  setReturned,
  includeDelivery,
  setIncludeDelivery,
  canReturn,
  busy,
  offline,
  error,
  onCreate,
  onReprint,
}: {
  order: LookupResult;
  lines: { key: string; barcode: string; name: string; qty: number; free: boolean }[];
  returned: Record<string, number>;
  setReturned: (next: Record<string, number>) => void;
  includeDelivery: boolean;
  setIncludeDelivery: (v: boolean) => void;
  canReturn: boolean;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onCreate: () => void;
  onReprint: () => void;
}) {
  const done = order.local.return;
  const scannedUnits = Object.values(returned).reduce((s, n) => s + n, 0);
  const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
  let disabledReason: string | null = null;
  if (!canReturn) disabledReason = 'ليست لديك صلاحية «مرتجعات الطلبات»';
  else if (offline) disabledReason = 'لا اتصال بالموقع';
  else if (!done && scannedUnits === 0) disabledReason = 'امسح الأصناف الراجعة';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OrderHeader order={order} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-6 text-amber-900">
          طرد راجع — إيصال البيع <span className="font-mono" dir="ltr">{order.invoiced?.receiptNumber}</span>.
          امسح كل قطعة رجعت سليمة إلى المحل، ثم أنشئ إيصال الإرجاع المربوط بفاتورة البيع.
        </div>
        <div className="grid gap-3 min-[1180px]:grid-cols-[minmax(0,1fr)_clamp(300px,27vw,380px)]">
          <Card title={`الأصناف الراجعة — ${scannedUnits} من ${totalUnits}`}>
            <div className="space-y-1">
              {lines.map(l => {
                const n = returned[l.key] ?? 0;
                const color = n >= l.qty ? LINE_COLORS.green : n > 0 ? LINE_COLORS.yellow : LINE_COLORS.grey;
                return (
                  <div key={l.key} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5" style={{ borderInlineStart: `5px solid ${color}` }}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: color }}>
                      {n >= l.qty ? '✓' : n > 0 ? '…' : '–'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{l.name}{l.free ? ' (هدية مجانية)' : ''}</span>
                    <span className="hidden font-mono text-[11px] text-slate-400 sm:inline" dir="ltr">{l.barcode}</span>
                    <span className="num w-14 shrink-0 text-center text-[13px] font-bold">{n} / {l.qty}</span>
                    <button
                      type="button"
                      disabled={!!done || n === 0}
                      onClick={() => setReturned({ ...returned, [l.key]: Math.max(0, n - 1) })}
                      className="shrink-0 rounded-md border border-slate-300 px-2 text-[13px] disabled:opacity-40"
                    >
                      −
                    </button>
                  </div>
                );
              })}
            </div>
            {!done && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-[12px] font-bold"
                  onClick={() => setReturned(Object.fromEntries(lines.map(l => [l.key, l.qty])))}
                >
                  كل الطرد راجع
                </button>
                <label className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
                  <input type="checkbox" checked={includeDelivery} onChange={e => setIncludeDelivery(e.target.checked)} />
                  إرجاع أجور التوصيل أيضاً
                </label>
              </div>
            )}
          </Card>

          <div className="space-y-3">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] font-bold text-[#D64545]">{error}</div>}
            {done ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[14px] font-bold text-emerald-800">
                  أُنشئ إيصال الإرجاع <span className="font-mono" dir="ltr">{done.receiptNumber}</span>
                  {done.reportedOk ? ' وسُجّل في الموقع' : ''}
                </div>
                {!done.reportedOk && (
                  <div className="mt-1 text-[12px] text-[#D64545]">
                    لم يُسجّل في الموقع بعد{done.lastError ? `: ${done.lastError}` : ''} — اضغط «تسجيل في الموقع» (لن يتكرر الإيصال).
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <ReprintButton onClick={onReprint} disabled={busy}>طباعة إيصال الإرجاع</ReprintButton>
                  {!done.reportedOk && <ReprintButton onClick={onCreate} disabled={busy || offline || !canReturn}>تسجيل في الموقع</ReprintButton>}
                </div>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={onCreate}
                  disabled={busy || !!disabledReason}
                  className="h-16 w-full rounded-2xl bg-[#0f9f76] text-[19px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  إنشاء إيصال الإرجاع
                </button>
                {disabledReason && <div className="mt-1.5 text-center text-[13px] font-bold text-[#D64545]">{disabledReason}</div>}
              </div>
            )}
            <CustomerCard order={order} />
          </div>
        </div>
      </div>
    </div>
  );
}
