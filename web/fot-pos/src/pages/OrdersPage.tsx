import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatIqd, formatNum, type PrintSettingsDto } from '@fot/shared';
import { ApiError, api, onlineOrdersApi } from '@/api/client';
import type { PosSessionDto } from '@/api/types';
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
import type { HeldInvoice } from '@/lib/onlineOrders';
import { resolveCashierPermissions } from '@/lib/permissions';
import { capUserDiscount } from '@/lib/sale';
import { collapseRepeatedScan } from '@/lib/scanGuard';
import { decodeScannerText } from '@/lib/scannerKey';
import { playErrorBeep } from '@/lib/sound';

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

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 0 || e.status === 408) return 'سيرفر المحل غير متصل — تحقق من الشبكة';
    return e.message;
  }
  return e instanceof Error ? e.message : 'حدث خطأ غير متوقع';
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

function lineGlyph(state: SiteLine['state']) {
  if (state === 'MATCHED') return '✓';
  if (state === 'SHORT') return '✕';
  if (state === 'EXTRA') return '+';
  return '…';
}

/** سطر الطلب يطابق الباركود الممسوح؟ (باركود الموقع أو باركود مادة المحل المقابلة). */
function lineMatches(order: LookupResult, line: SiteLine, key: string) {
  if (!key) return false;
  if (normBarcode(line.barcode) === key) return true;
  const plan = order.local.lines.find(p => normBarcode(p.barcode) === normBarcode(line.barcode));
  return !!plan && normBarcode(plan.posBarcode) === key;
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
  const [flash, setFlash] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldInvoice[] | null>(null);
  const [heldPick, setHeldPick] = useState<Set<string>>(new Set());
  /** عُدّلت فاتورة مُفوترة: الإيصال والملصق المطبوعان قديمان. */
  const [needsReprint, setNeedsReprint] = useState(false);
  const [printersOpen, setPrintersOpen] = useState(false);
  const courierSaveRef = useRef<Promise<boolean> | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
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
      setSiteDown(s.reachable ? null : s.error || 'موقع الطلبات غير متاح');
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
    await printCourierLabel(lbl.pdfBase64, { copies: perParcel * Math.max(1, parcels ?? lbl.parcelCount ?? 1), printerName: printer });
  }, [printCfg?.labelCopies, printCfg?.labelPrinterName]);

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

  const offline = shopDown || !!siteDown;
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

  async function confirmAdd() {
    const a = addRef.current;
    const o = orderRef.current;
    if (!a || !a.product || !o || a.saving) return;
    setAdd({ ...a, saving: true, error: null });
    try {
      const fresh = await onlineOrdersApi.edit({
        code: o.order.code,
        op: 'add',
        barcode: a.product.siteBarcode || a.barcode,
        qty: a.qty,
        charge: a.charge,
        reason: a.reason.trim() || undefined,
        clientEditId: newEditId(),
      });
      setOrder(fresh);
      setResult(null);
      setAdd(null);
      afterEdit(fresh);
      const hit = fresh.lines.find(l => lineMatches(fresh, l, normBarcode(a.product!.siteBarcode)) && (a.charge === 'FREE' ? l.charge === 'FREE' : true));
      flashLine(hit?.id ?? null);
      showToast(`أُضيف ${a.product.name ?? a.barcode} × ${a.qty}${a.charge === 'FREE' ? ' (هدية)' : ''} — المبلغ الآن ${formatIqd(fresh.receipt.total)}`);
      void refreshQueue();
    } catch (e) {
      playErrorBeep();
      setAdd(prev => (prev ? { ...prev, saving: false, error: errorText(e) } : prev));
    }
  }

  /** خصم يدوي على الطلب (0 يلغيه) — يتعدّل المبلغ في الموقع وعند هاي إكسبريس بعد الفوترة. */
  async function applyDiscount(amount: number, reason: string): Promise<boolean> {
    const o = orderRef.current;
    if (!o) return false;
    try {
      const fresh = await onlineOrdersApi.edit({
        code: o.order.code,
        op: 'discount',
        amount: Math.max(0, Math.round(amount)),
        reason: reason.trim() || undefined,
        clientEditId: newEditId(),
      });
      setOrder(fresh);
      setResult(null);
      afterEdit(fresh);
      showToast(amount > 0 ? `خصم ${formatIqd(amount)} — المبلغ الآن ${formatIqd(fresh.receipt.total)}` : `أُلغي الخصم — المبلغ الآن ${formatIqd(fresh.receipt.total)}`);
      void refreshQueue();
      return true;
    } catch (e) {
      playErrorBeep();
      showToast(errorText(e), 'err');
      return false;
    }
  }

  async function addOver(line: SiteLine) {
    const o = orderRef.current;
    if (!o || !line.barcode) return;
    setEditingLine(line.id);
    try {
      const fresh = await onlineOrdersApi.edit({
        code: o.order.code,
        op: 'add',
        barcode: line.barcode,
        qty: 1,
        charge: 'PAID',
        reason: 'زيادة على الكمية المطلوبة',
        clientEditId: newEditId(),
      });
      setOrder(fresh);
      setResult(null);
      afterEdit(fresh);
      void refreshQueue();
    } catch (e) {
      playErrorBeep();
      showToast(errorText(e), 'err');
    } finally {
      setEditingLine(null);
    }
  }

  /** تعديل على فاتورة مُفوترة: اطلب إعادة الطباعة، وأظهر إن لم يصل التعديل لهاي إكسبريس. */
  function afterEdit(fresh: LookupResult) {
    if (fresh.reprint) setNeedsReprint(true);
    if (fresh.courierUpdate && !fresh.courierUpdate.ok) {
      playErrorBeep();
      showToast(`عُدّلت الفاتورة لكن لم يصل التعديل لهاي إكسبريس: ${fresh.courierUpdate.error ?? ''} — راجع الطلب في لوحة الإدارة`, 'err');
    }
  }

  // ── تعديل كمية سطر ──
  async function applyLine(line: SiteLine, qty: number, opts: { reason?: string; charge?: 'PAID' | 'FREE' } = {}) {
    const o = orderRef.current;
    if (!o) return false;
    setEditingLine(line.id);
    try {
      const fresh = await onlineOrdersApi.edit({
        code: o.order.code,
        op: 'set',
        lineId: line.id,
        qty,
        charge: opts.charge,
        reason: opts.reason,
        clientEditId: newEditId(),
      });
      setOrder(fresh);
      setResult(null);
      afterEdit(fresh);
      flashLine(fresh.lines.some(l => l.id === line.id) ? line.id : null);
      void refreshQueue();
      return true;
    } catch (e) {
      playErrorBeep();
      showToast(errorText(e), 'err');
      return false;
    } finally {
      setEditingLine(null);
    }
  }

  function changeLine(line: SiteLine, qty: number) {
    // «+» على صنف مكتمل: قطعة زائدة (أزرق «زيادة») بنفس الباركود — بلا نافذة.
    if (line.kind === 'ORDERED' && qty > line.orderedQty && line.barcode) {
      void addOver(line);
      return;
    }
    if (line.kind === 'ORDERED' && qty < line.orderedQty) {
      // إرجاع قطعة لسطر ناقص سببه مسجّل: لا داعي لسؤال جديد.
      if (qty > line.pickedQty && line.reason) {
        void applyLine(line, qty, { reason: line.reason });
        return;
      }
      setReasonAsk({ line, qty, reason: line.reason ?? '', saving: false, error: null });
      return;
    }
    void applyLine(line, qty);
  }

  async function confirmReason() {
    const r = reasonAsk;
    if (!r || r.saving) return;
    if (!r.reason.trim()) {
      setReasonAsk({ ...r, error: 'اكتب سبب النقص' });
      return;
    }
    setReasonAsk({ ...r, saving: true, error: null });
    const ok = await applyLine(r.line, r.qty, { reason: r.reason.trim() });
    setReasonAsk(ok ? null : prev => (prev ? { ...prev, saving: false } : prev));
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
    // المراجعة المزدوجة: قطعة من الطلب لم تكتمل مراجعتها تُعدّ أولاً.
    if (status?.print.doubleCheck && !current.invoiced && line) {
      const n = (checkedRef.current[line.key] ?? 0) + 1;
      if (n <= line.qty) {
        const next = { ...checkedRef.current, [line.key]: n };
        checkedRef.current = next;
        setChecked(next);
        return;
      }
    }
    if (editableRef.current) {
      void openAdd(normalized);
      return;
    }
    playErrorBeep();
    showToast(current.invoiced ? 'الطلب مُفوتر — لا تُضاف أصناف بعد الفوترة' : 'لا يمكن تعديل هذا الطلب الآن', 'err');
  }, [openAdd, openOrder, showToast, status?.print.doubleCheck]);

  useBarcodeCapture(!busy && !reasonAsk && !discountOpen && !printersOpen, onScan);

  // ── الطباعة ──
  async function runPrints(fin: FinalizeResult, opts: { label: boolean }) {
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
    if (errors.length) showToast(errors.join(' — '), 'err');
  }

  /** بعد تعديل فاتورة مُفوترة: الإيصال والفاتورة وملصق هاي إكسبريس من جديد (لا ينشئ شيئاً). */
  async function reprintAfterEdit() {
    const o = orderRef.current;
    if (!o) return;
    setBusy(true);
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
      const body = {
        code: order.order.code,
        posId: session.posTerminalId,
        hwId: getHwId() || undefined,
        expectedTotal: order.receipt.total,
      };
      const fin = pickup ? await onlineOrdersApi.pickup(body) : await onlineOrdersApi.finalize(body);
      setResult(fin);
      setBusyText('جاري الطباعة…');
      await runPrints(fin, { label: !pickup });
      showToast(fin.alreadyInvoiced ? `الطلب مُفوتر من قبل بالإيصال ${fin.receipt.number}` : `تم — الإيصال ${fin.receipt.number}`);
      const fresh = await onlineOrdersApi.lookup(order.order.code).catch(() => null);
      if (fresh) setOrder(fresh);
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
      />

      {offline && (
        <div className="shrink-0 bg-[#D64545] px-4 py-2 text-center text-[13px] font-bold text-white">
          {shopDown
            ? 'سيرفر المحل غير متصل — كاشير الطلبات يعمل متصلاً فقط. تحقق من الشبكة.'
            : `تعذر الوصول إلى موقع الطلبات: ${siteDown} — لا يمكن الفوترة حتى يعود الاتصال.`}
        </div>
      )}
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

        {/* ── الطلب ── */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loadingCode && <div className="p-10 text-center text-[14px] text-slate-500">جاري فتح الطلب {loadingCode}…</div>}
          {!loadingCode && orderError && (
            <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-[14px] font-bold text-red-700">{orderError}</div>
          )}
          {!loadingCode && !order && !orderError && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl border-4 border-dashed border-slate-300 text-[30px] font-bold">QR</div>
              <div className="text-[17px] font-bold text-slate-600">امسح QR الطلب من قائمة التجهيز</div>
              <div className="text-[13px]">أو اختر طلباً من الطابور، أو اكتب رقمه في الأعلى</div>
            </div>
          )}
          {!loadingCode && order && (
            returnMode ? (
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
            ) : (
              <OrderView
                order={order}
                status={status}
                result={result}
                checked={checked}
                deliveredLines={deliveredLines}
                editable={editable}
                editingLine={editingLine}
                flash={flash}
                busy={busy}
                offline={offline}
                error={actionError}
                onAddBarcode={code => void openAdd(code)}
                onChangeLine={changeLine}
                onToggleCharge={line => void applyLine(line, line.pickedQty, { charge: line.charge === 'FREE' ? 'PAID' : 'FREE' })}
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
                }}
              />
            )
          )}
        </main>
      </div>

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
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm">
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

/**
 * إضافة صنف للطلب: امسح الباركود (في أي مكان من الشاشة)، أو اكتبه، أو ابحث باسم الصنف في كتالوج المحل.
 */
function AddBar({ onAdd, disabled }: { onAdd: (code: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<{ id: number; seq: number; name: string | null; barcode: string | null; price: number; stock: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);
  const q = text.trim();
  // نص فيه حروف (ليس باركوداً) = بحث بالاسم بعد توقف الكتابة.
  const isName = q.length >= 2 && /[^\d\s-]/.test(q);

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

  const pick = (code: string) => {
    setText('');
    setResults([]);
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
    onAdd(code);
  };

  return (
    <div className="relative">
      <form
        className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#0f9f76]/50 bg-emerald-50/50 px-3 py-2"
        onSubmit={e => {
          e.preventDefault();
          if (isName) {
            if (results[0]) pick(results[0].barcode || `POS:${results[0].seq}`);
            return;
          }
          const v = collapseRepeatedScan(decodeScannerText(text)).trim();
          if (v) pick(v);
        }}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0f9f76] text-[18px] font-bold text-white">+</span>
        <div className="min-w-[150px] flex-1 text-[13px] leading-5">
          <div className="font-bold text-slate-800">إضافة صنف للطلب</div>
          <div className="text-[12px] text-slate-500">امسح الباركود، أو اكتبه، أو ابحث باسم الصنف — من كل أصناف المحل</div>
        </div>
        <input
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 180)}
          placeholder="باركود أو اسم الصنف"
          className="pos-field w-[clamp(170px,18vw,260px)] text-[13px]"
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !q} className="shrink-0 rounded-xl bg-[#0f9f76] px-3 py-2 text-[12px] font-bold text-white disabled:bg-slate-300">
          إضافة
        </button>
      </form>
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

function LinesTable({
  order,
  editable,
  editingLine,
  flash,
  onChangeLine,
  onToggleCharge,
}: {
  order: LookupResult;
  editable: boolean;
  editingLine: string | null;
  flash: string | null;
  onChangeLine: (line: SiteLine, qty: number) => void;
  onToggleCharge: (line: SiteLine) => void;
}) {
  const byId = new Map(order.lines.map(l => [l.id, l]));
  const unresolved = new Set(order.local.lines.filter(l => !l.resolved).map(l => normBarcode(l.barcode)));
  // كمية زائدة لصنف من الطلب (إضافي بنفس باركود سطر مطلوب) = أزرق «زيادة»؛ صنف جديد = أصفر «إضافي».
  const orderedCodes = new Set(order.lines.filter(l => l.kind === 'ORDERED' && l.barcode).map(l => normBarcode(l.barcode)));
  const isOver = (l: SiteLine) => l.kind === 'EXTRA' && l.charge === 'PAID' && !l.substituteForLineId && !!l.barcode && orderedCodes.has(normBarcode(l.barcode));
  // سعر القطعة على الزبونة كما في إيصال الموقع: الهدية بصفر، والبديل بالأرخص.
  const chargeOf = (l: SiteLine) => {
    if (l.kind === 'EXTRA' && l.charge === 'FREE') return 0;
    if (l.kind === 'EXTRA' && l.substituteForLineId) return Math.min(l.unitPrice, byId.get(l.substituteForLineId)?.unitPrice ?? l.unitPrice);
    return l.unitPrice;
  };
  // الاسم يأخذ ما يبقى: الحالة أيقونة، والسعر تحت المجموع، والتعديل سطران.
  const cols = editable
    ? 'grid-cols-[46px_minmax(0,1fr)_62px_100px_104px]'
    : 'grid-cols-[46px_minmax(0,1fr)_62px_100px]';
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className={`grid ${cols} items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-bold text-slate-500`}>
        <span className="text-center">الحالة</span>
        <span>الصنف</span>
        <span className="text-center">الكمية</span>
        <span className="text-center">المبلغ</span>
        {editable && <span className="text-center">تعديل</span>}
      </div>
      {order.lines.map(l => {
        const over = isOver(l);
        const color = over ? OVER_BLUE : LINE_COLORS[l.color] ?? LINE_COLORS.grey;
        const sub = l.substituteForLineId ? byId.get(l.substituteForLineId) : null;
        const missingHere = l.barcode && unresolved.has(normBarcode(l.barcode));
        const delivered = l.kind === 'ORDERED' ? Math.min(l.pickedQty, l.orderedQty) : l.pickedQty;
        const free = l.kind === 'EXTRA' && l.charge === 'FREE';
        const unit = chargeOf(l);
        const busyHere = editingLine === l.id;
        return (
          <div
            key={l.id}
            className={`grid ${cols} items-center gap-2 border-b border-slate-100 px-2 py-2 transition-colors last:border-b-0 ${flash === l.id ? 'bg-emerald-50' : ''} ${busyHere ? 'opacity-60' : ''}`}
            style={{ borderInlineStart: `6px solid ${color}` }}
          >
            <div className="flex flex-col items-center gap-0.5" style={{ color }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: color }}>
                {lineGlyph(l.state)}
              </span>
              <span className="text-center text-[10.5px] font-bold leading-3">{over ? 'زيادة' : l.label}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold leading-5 text-slate-900">
                {l.name}{l.shadeName ? <span className="font-normal text-slate-600"> — {l.shadeName}</span> : null}
              </div>
              <div className="font-mono text-[11px] text-slate-400" dir="ltr">{l.barcode ?? '—'}</div>
              {l.kind === 'EXTRA' && (
                <div className="text-[12px] font-bold" style={{ color: over ? OVER_BLUE : LINE_COLORS.yellow }}>
                  {over ? 'زيادة على الكمية المطلوبة' : free ? 'هدية مجانية' : 'إضافي مدفوع'}
                  {sub ? ` · بديل عن ${sub.name}${sub.shadeName ? ` — ${sub.shadeName}` : ''}` : ''}
                </div>
              )}
              {l.reason && <div className="text-[12px] text-slate-600">السبب: {l.reason}</div>}
              {missingHere && <div className="text-[12px] font-bold text-[#D64545]">الباركود غير موجود في كتالوج المحل</div>}
            </div>
            <div className="num text-center text-[13px] leading-5">
              {l.kind === 'ORDERED' ? (
                <>
                  <div><b className="text-[15px]">{formatNum(delivered)}</b> <span className="text-slate-400">/ {formatNum(l.orderedQty)}</span></div>
                  {l.missingQty > 0 && <div className="text-[11px] font-bold text-[#D64545]">ناقص {formatNum(l.missingQty)}</div>}
                </>
              ) : (
                <div><b className="text-[15px]">{formatNum(delivered)}</b></div>
              )}
            </div>
            <div className="num text-center leading-5">
              <div className="text-[13px] font-bold text-slate-900">{formatIqd(unit * delivered)}</div>
              <div className="text-[11px] text-slate-500">{free ? 'هدية مجانية' : `× ${formatIqd(unit)}`}</div>
            </div>
            {editable && (
              <div className="grid grid-cols-2 place-items-center gap-1">
                <QtyButton
                  label="−"
                  title={l.kind === 'ORDERED' ? 'إنقاص قطعة (يُسأل عن السبب)' : delivered <= 1 ? 'حذف الإضافي' : 'إنقاص قطعة'}
                  disabled={busyHere || delivered === 0}
                  onClick={() => onChangeLine(l, delivered - 1)}
                />
                <QtyButton
                  label="+"
                  title={l.kind === 'ORDERED' ? (l.pickedQty >= l.orderedQty ? 'قطعة زائدة (زيادة)' : 'إرجاع قطعة ناقصة') : 'قطعة أخرى'}
                  disabled={busyHere || (l.kind === 'ORDERED' && l.pickedQty >= l.orderedQty && !l.barcode)}
                  onClick={() => onChangeLine(l, delivered + 1)}
                />
                {l.kind === 'EXTRA' ? (
                  <>
                    <button
                      type="button"
                      disabled={busyHere}
                      onClick={() => onToggleCharge(l)}
                      className="w-full rounded-md border border-amber-300 bg-amber-50 px-1 py-1 text-[11px] font-bold text-[#a8650a] disabled:opacity-40"
                      title={free ? 'جعله مدفوعاً' : 'جعله هدية مجانية'}
                    >
                      {free ? 'مدفوع' : 'هدية'}
                    </button>
                    <button
                      type="button"
                      disabled={busyHere}
                      onClick={() => onChangeLine(l, 0)}
                      className="w-full rounded-md border border-red-200 bg-red-50 px-1 py-1 text-[11px] font-bold text-red-700 disabled:opacity-40"
                      title="حذف الصنف الإضافي"
                    >
                      حذف
                    </button>
                  </>
                ) : (
                  delivered > 0 && (
                    <button
                      type="button"
                      disabled={busyHere}
                      onClick={() => onChangeLine(l, 0)}
                      className="col-span-2 w-full rounded-md border border-red-200 bg-red-50 px-1 py-1 text-[11px] font-bold text-red-700 disabled:opacity-40"
                      title="إزالة الصنف من الطلب (يُسأل عن السبب)"
                    >
                      إزالة
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
        <Legend color={LINE_COLORS.green} glyph="✓" text="مطابق" />
        <Legend color={LINE_COLORS.red} glyph="✕" text="ناقص" />
        <Legend color={OVER_BLUE} glyph="+" text="زيادة" />
        <Legend color={LINE_COLORS.yellow} glyph="+" text="إضافي" />
      </div>
    </div>
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

function AmountsCard({ order, onDiscount }: { order: LookupResult; onDiscount?: () => void }) {
  const m = order.money;
  const r = order.receipt;
  const manual = m.manualDiscount ?? order.order.cashierDiscount ?? 0;
  const otherDiscount = Math.max(0, r.discount - manual);
  return (
    <Card
      title="المبالغ"
      right={
        onDiscount ? (
          <button
            type="button"
            onClick={onDiscount}
            className="rounded-lg border border-[#0f9f76] bg-white px-2.5 py-1 text-[12px] font-bold text-[#0b7d5d] hover:bg-emerald-50"
          >
            {manual > 0 ? 'تعديل الخصم' : '+ خصم'}
          </button>
        ) : undefined
      }
    >
      <MoneyRow label="قيمة الأصناف المطلوبة" value={m.orderedSubtotal} />
      {m.shortageValue > 0 && <MoneyRow label="الناقص" value={-m.shortageValue} tone={LINE_COLORS.red} />}
      {m.extrasValue > 0 && <MoneyRow label="الإضافات المدفوعة" value={m.extrasValue} tone={LINE_COLORS.yellow} />}
      {m.freeExtrasValue > 0 && <MoneyRow label="هدايا مجانية (غير محسوبة)" value={m.freeExtrasValue} tone={LINE_COLORS.yellow} />}
      {r.shipping > 0 && <MoneyRow label="التوصيل" value={r.shipping} />}
      {r.giftWrap > 0 && <MoneyRow label="تغليف الهدية" value={r.giftWrap} />}
      {otherDiscount > 0 && <MoneyRow label="خصومات الطلب" value={-otherDiscount} />}
      {manual > 0 && (
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
  deliveredLines,
  editable,
  editingLine,
  flash,
  busy,
  offline,
  error,
  onAddBarcode,
  onChangeLine,
  onToggleCharge,
  onFinalize,
  onReprint,
  onSlip,
  post,
}: {
  order: LookupResult;
  status: OnlineOrdersStatus | null;
  result: FinalizeResult | null;
  checked: Record<string, number>;
  deliveredLines: { key: string; name: string; qty: number }[];
  editable: boolean;
  editingLine: string | null;
  flash: string | null;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onAddBarcode: (code: string) => void;
  onChangeLine: (line: SiteLine, qty: number) => void;
  onToggleCharge: (line: SiteLine) => void;
  onFinalize: () => void;
  onReprint: (what: 'receipt' | 'invoice' | 'label') => void;
  onSlip: () => void;
  post: PostControls;
}) {
  const pickup = order.order.deliveryOption === 'PICKUP';
  const invoiced = order.invoiced;
  const blockers = [...order.blockers, ...order.local.problems];
  const doubleCheck = !!status?.print.doubleCheck && !invoiced;
  const checkMissing = doubleCheck ? deliveredLines.filter(l => (checked[l.key] ?? 0) < l.qty) : [];
  let disabledReason: string | null = null;
  if (offline) disabledReason = 'لا اتصال بالموقع';
  else if (status && !status.enabled) disabledReason = 'كاشير الطلبات متوقف من لوحة التحكم';
  else if (invoiced) disabledReason = `مُفوتر بالإيصال ${invoiced.receiptNumber ?? ''}`;
  else if (!order.canInvoice) disabledReason = order.blockers[0] ?? 'الطلب غير جاهز للفوترة';
  else if (order.local.problems.length) disabledReason = order.local.problems[0];
  else if (checkMissing.length) disabledReason = `المراجعة المزدوجة: امسح ${linesLabel(checkMissing.length)} بعد`;
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
          {editable && <AddBar onAdd={onAddBarcode} disabled={busy} />}
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
            onChangeLine={onChangeLine}
            onToggleCharge={onToggleCharge}
          />
          {doubleCheck && (
            <Card title="المراجعة المزدوجة — امسح كل قطعة قبل الإتمام">
              <div className="grid gap-1 sm:grid-cols-2">
                {deliveredLines.map(l => {
                  const n = checked[l.key] ?? 0;
                  const done = n >= l.qty;
                  return (
                    <div key={l.key} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[13px]" style={{ background: done ? '#1F9D6318' : '#94A3B818' }}>
                      <span className="min-w-0 truncate">{l.name}</span>
                      <span className="num shrink-0 font-bold" style={{ color: done ? LINE_COLORS.green : '#475569' }}>{done ? '✓ ' : ''}{n} / {l.qty}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
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
          <AmountsCard order={order} onDiscount={editable && post.canDiscount ? post.onDiscount : undefined} />
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
