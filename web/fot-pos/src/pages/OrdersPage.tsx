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
  parseOrderCode,
  type FinalizeResult,
  type LookupResult,
  type OnlineOrdersStatus,
  type QueueResult,
  type QueueRow,
  type SiteLine,
} from '@/lib/onlineOrders';
import {
  loadShopPrintSettings,
  playNewOrderChime,
  printOrderInvoice,
  printOrderLabels,
  printOrderReceipt,
  printOrderSlip,
} from '@/lib/orderPrint';
import { resolveCashierPermissions } from '@/lib/permissions';
import { collapseRepeatedScan } from '@/lib/scanGuard';
import { decodeScannerText } from '@/lib/scannerKey';
import { playErrorBeep } from '@/lib/sound';

type Tab = 'ready' | 'pickup' | 'awaitingCourier' | 'picking' | 'returns';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ready', label: 'جاهزة للفوترة' },
  { id: 'pickup', label: 'استلام من المحل' },
  { id: 'awaitingCourier', label: 'بانتظار شركة التوصيل' },
  { id: 'picking', label: 'قيد التجهيز' },
  { id: 'returns', label: 'مرتجعات' },
];

const RETURN_STAGES = ['RETURNING', 'RETURNED', 'PARTIALLY_DELIVERED', 'DELIVERY_ISSUE', 'CANCELLED'];

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

function lineGlyph(state: SiteLine['state']) {
  if (state === 'MATCHED') return '✓';
  if (state === 'SHORT') return '✕';
  if (state === 'EXTRA') return '+';
  return '…';
}

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
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef(0);
  const knownReady = useRef<Set<string> | null>(null);
  const orderRef = useRef<LookupResult | null>(null);
  orderRef.current = order;

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
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
      else if (isSiteDown(e)) setSiteDown(errorText(e));
      else setSiteDown(errorText(e));
    }
  }, [printCfg?.autoPrintNewSlips, showToast]);

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
    setLoadingCode(code);
    setOrderError(null);
    setActionError(null);
    setResult(null);
    setChecked({});
    setReturned({});
    setIncludeDelivery(true);
    try {
      const d = await onlineOrdersApi.lookup(code);
      setOrder(d);
      if (RETURN_STAGES.includes(d.order.stage) && d.invoiced) setTab('returns');
      else if (d.order.stage === 'INVOICED') setTab('awaitingCourier');
      else if (d.order.deliveryOption === 'PICKUP') setTab('pickup');
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

  const returnMode = !!order && !!order.invoiced && RETURN_STAGES.includes(order.order.stage);

  /** الأصناف المسلّمة فعلاً (أسطر إيصال الموقع) بباركوداتها كما في الموقع وفي كتالوج المحل. */
  const deliveredLines = useMemo(() => {
    if (!order) return [];
    // local.lines يطابق receipt.items بالترتيب نفسه — نأخذ الفهرس قبل التصفية.
    return order.receipt.items
      .map((i, idx) => ({ i, plan: order.local.lines[idx] }))
      .filter(({ i }) => i.qty > 0 && i.barcode)
      .map(({ i, plan }) => {
        return {
          key: normBarcode(i.barcode),
          barcode: i.barcode!,
          aliases: [normBarcode(i.barcode), normBarcode(plan?.posBarcode)].filter(Boolean),
          name: i.name,
          qty: i.qty,
          free: !!i.free,
        };
      })
      .reduce<{ key: string; barcode: string; aliases: string[]; name: string; qty: number; free: boolean }[]>((acc, l) => {
        const same = acc.find(a => a.key === l.key);
        if (same) same.qty += l.qty;
        else acc.push({ ...l });
        return acc;
      }, []);
  }, [order]);

  // ── الماسح: رمز الطلب قبل أي شيء ──
  const onScan = useCallback((rawCode: string) => {
    const normalized = collapseRepeatedScan(decodeScannerText(rawCode));
    if (!normalized) return;
    const orderCode = parseOrderCode(normalized);
    if (orderCode) {
      void openOrder(orderCode);
      return;
    }
    const current = orderRef.current;
    if (!current) {
      playErrorBeep();
      showToast('امسح رمز الطلب (QR) أولاً', 'err');
      return;
    }
    const key = normBarcode(normalized);
    const line = deliveredLines.find(l => l.aliases.includes(key));
    if (!line) {
      playErrorBeep();
      showToast(`الباركود ${normalized} ليس من أصناف هذا الطلب`, 'err');
      return;
    }
    const inReturn = !!current.invoiced && RETURN_STAGES.includes(current.order.stage);
    if (inReturn) {
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
    if (status?.print.doubleCheck && !current.invoiced) {
      setChecked(prev => {
        const n = (prev[line.key] ?? 0) + 1;
        if (n > line.qty) {
          playErrorBeep();
          showToast(`${line.name}: الكمية المطلوبة ${line.qty} فقط`, 'err');
          return prev;
        }
        return { ...prev, [line.key]: n };
      });
      return;
    }
    showToast('الطلب مفتوح — امسح QR طلب آخر لفتحه');
  }, [deliveredLines, openOrder, showToast, status?.print.doubleCheck]);

  useBarcodeCapture(!busy, onScan);

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
        await printOrderLabels({ ...fin.print, shipment: { ...fin.print.shipment, ...fin.shipment, trackingNumber: tracking } },
          copies.labelCopies, copies.labelPrinterName);
      } catch (e) {
        errors.push(`ملصق الشحن: ${errorText(e)}`);
      }
    }
    if (errors.length) showToast(errors.join(' — '), 'err');
  }

  async function finalize() {
    if (!order) return;
    const pickup = order.order.deliveryOption === 'PICKUP';
    setBusy(true);
    setBusyText(pickup ? 'جاري التسليم والطباعة…' : 'جاري الفوترة وإنشاء الشحنة…');
    setActionError(null);
    try {
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
        await printOrderLabels(d, Math.max(1, copies.labelCopies), copies.labelPrinterName);
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

  const rows: QueueRow[] = queue ? queue[tab] ?? [] : [];
  const counts = queue?.counts ?? {};
  const offline = shopDown || !!siteDown;

  return (
    <div className="pos-app flex-col" dir="rtl">
      {/* ── الرأس ── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0f9f76] text-[11px] font-bold text-white">FOT</div>
          <div>
            <div className="text-[15px] font-bold text-slate-900">كاشير الطلبات</div>
            <div className="text-[11px] text-slate-500">{session.cashierName}{session.sectionName ? ` · ${session.sectionName}` : ''}</div>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${offline ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {shopDown ? 'سيرفر المحل غير متصل' : siteDown ? 'الموقع غير متاح' : 'متصل بالموقع'}
        </span>
        <form
          className="ms-auto flex items-center gap-2"
          onSubmit={e => {
            e.preventDefault();
            // الماسح قد يكتب هنا بلوحة عربية — نفك الأحرف كما في الالتقاط العام
            const v = collapseRepeatedScan(decodeScannerText(manualCode)).trim();
            setManualCode('');
            (document.activeElement as HTMLElement | null)?.blur();
            if (!v) return;
            if (parseOrderCode(v) || !orderRef.current) void openOrder(v);
            else onScan(v);
          }}
        >
          <input
            value={manualCode}
            onChange={e => setManualCode(e.target.value)}
            placeholder="رقم الطلب ORD-…"
            className="pos-field w-56 text-[13px]"
            dir="ltr"
          />
          <button type="submit" className="rounded-xl bg-slate-800 px-3 py-2 text-[12px] font-bold text-white">فتح</button>
        </form>
        <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold" onClick={() => { void refreshStatus(); void refreshQueue(); }}>
          تحديث
        </button>
        {onBack && (
          <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold" onClick={onBack}>
            رجوع للكاشير
          </button>
        )}
        <button type="button" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700" onClick={onLogout}>
          خروج
        </button>
      </header>

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
        <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition ${
                  tab === t.id ? 'bg-[#0f9f76] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 text-[11px] ${tab === t.id ? 'bg-white/25' : 'bg-white text-slate-700'}`}>
                  {formatNum(counts[t.id] ?? 0)}
                </span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
            {!queue && <div className="p-6 text-center text-[13px] text-slate-400">جاري التحميل…</div>}
            {queue && rows.length === 0 && <div className="p-6 text-center text-[13px] text-slate-400">لا توجد طلبات هنا</div>}
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
          <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">يتحدث كل 15 ثانية · امسح QR الطلب لفتحه</div>
        </aside>

        {/* ── الطلب ── */}
        <main className="min-w-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {loadingCode && <div className="p-10 text-center text-[14px] text-slate-500">جاري فتح الطلب {loadingCode}…</div>}
          {!loadingCode && orderError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[14px] font-bold text-red-700">{orderError}</div>
          )}
          {!loadingCode && !order && !orderError && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400">
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl border-4 border-dashed border-slate-300 text-[30px] font-bold">QR</div>
              <div className="text-[16px] font-bold text-slate-600">امسح QR الطلب من قائمة التجهيز</div>
              <div className="text-[13px]">أو اختر طلباً من الطابور</div>
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
                busy={busy}
                offline={offline}
                error={actionError}
                onFinalize={() => void finalize()}
                onReprint={what => void reprint(order.order.code, what)}
                onSlip={() =>
                  void printOrderSlip({
                    orderNumber: order.order.orderNumber,
                    code: order.order.code,
                    customerName: order.customer.name,
                    governorate: order.customer.governorate,
                    deliveryOption: order.order.deliveryOption,
                    isGift: order.order.isGift,
                    notes: order.order.notes,
                    lines: order.receipt.items.map(i => ({ name: i.name, qty: i.qty, barcode: i.barcode })),
                  }).catch(e => showToast(errorText(e), 'err'))}
              />
            )
          )}
        </main>
      </div>

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
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-[14px] font-bold text-white shadow-xl ${
            toast.tone === 'err' ? 'bg-[#D64545]' : 'bg-slate-900'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

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
  return (
    <div className={`rounded-xl border p-2.5 transition ${active ? 'border-[#0f9f76] bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <button type="button" className="block w-full text-right" onClick={onOpen} disabled={disabled}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[13px] font-bold text-slate-900" dir="ltr">{row.orderNumber}</span>
          <span className="num text-[13px] font-bold text-slate-800">{formatIqd(row.finalTotal ?? row.total)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-slate-500">
          <span className="truncate">{row.customer ?? '—'}{row.governorate ? ` · ${row.governorate}` : ''}</span>
          {row.adjusted && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] font-bold text-[#DB8B12]">معدّل</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
          <span>{STAGE_LABELS[row.stage] ?? row.stage}</span>
          {row.pickerName && <span>· {row.pickerName}</span>}
          {(row.parcelCount ?? 1) > 1 && <span>· {row.parcelCount} طرود</span>}
          {loading && <span className="text-[#0f9f76]">· جاري الفتح…</span>}
        </div>
      </button>
      {tab === 'awaitingCourier' && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className="text-[11px]">
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
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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

function Card({ title, children, tone }: { title: string; children: ReactNode; tone?: 'gift' | 'warn' }) {
  const border = tone === 'gift' ? 'border-pink-200 bg-pink-50/50' : tone === 'warn' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-slate-50/40';
  return (
    <section className={`rounded-xl border p-3 ${border}`}>
      <div className="mb-1.5 text-[12px] font-bold text-slate-500">{title}</div>
      {children}
    </section>
  );
}

function MoneyRow({ label, value, tone, strong }: { label: string; value: number; tone?: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${strong ? 'text-[15px] font-bold' : 'text-[13px]'}`} style={tone ? { color: tone } : undefined}>
      <span>{label}</span>
      <span className="num" dir="ltr">{formatIqd(value)}</span>
    </div>
  );
}

function OrderHeader({ order }: { order: LookupResult }) {
  const o = order.order;
  const pickup = o.deliveryOption === 'PICKUP';
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h1 className="font-mono text-[22px] font-bold text-slate-900" dir="ltr">{o.orderNumber}</h1>
      <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[12px] font-bold text-white">{STAGE_LABELS[o.stage] ?? o.stage}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${pickup ? 'bg-sky-100 text-sky-800' : 'bg-indigo-100 text-indigo-800'}`}>
        {pickup ? 'استلام من المحل' : 'توصيل'}
      </span>
      <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${o.prepaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
        {o.prepaid ? 'مدفوع مسبقاً' : pickup ? 'الدفع في المحل' : 'الدفع عند الاستلام'}
      </span>
      {o.isGift && <span className="rounded-full bg-pink-100 px-2.5 py-0.5 text-[12px] font-bold text-pink-800">هدية</span>}
      {o.pickerName && <span className="text-[12px] text-slate-500">جهّزه: {o.pickerName}</span>}
      {(o.parcelCount ?? 1) > 1 && <span className="text-[12px] font-bold text-slate-700">{o.parcelCount} طرود</span>}
    </div>
  );
}

function CustomerBlock({ order }: { order: LookupResult }) {
  const c = order.customer;
  const o = order.order;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card title="الزبونة والعنوان">
        <div className="text-[15px] font-bold text-slate-900">{c.name ?? '—'}</div>
        <div className="font-mono text-[14px] text-slate-700" dir="ltr">{c.phone ?? ''}</div>
        <div className="mt-1 text-[13px] text-slate-700">{c.addressLine ?? [c.governorate, c.area, c.street].filter(Boolean).join(' — ')}</div>
        {c.landmark && <div className="text-[12px] text-slate-500">أقرب نقطة دالة: {c.landmark}</div>}
      </Card>
      <div className="space-y-3">
        {o.isGift && (
          <Card title="هدية" tone="gift">
            <div className="whitespace-pre-wrap text-[13px] text-slate-800">{o.giftMessage || 'بلا رسالة'}</div>
            {o.giftHidePrices && <div className="mt-1 text-[12px] font-bold text-pink-800">تُطبع بطاقة هدية بلا أسعار</div>}
          </Card>
        )}
        {o.notes && (
          <Card title="ملاحظات الطلب" tone="warn">
            <div className="whitespace-pre-wrap text-[13px] text-slate-800">{o.notes}</div>
          </Card>
        )}
      </div>
    </div>
  );
}

function LinesTable({ order }: { order: LookupResult }) {
  const byId = new Map(order.lines.map(l => [l.id, l]));
  const unresolved = new Set(order.local.lines.filter(l => !l.resolved).map(l => normBarcode(l.barcode)));
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex flex-wrap gap-3 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
        <Legend color={LINE_COLORS.green} glyph="✓" text="مطابق" />
        <Legend color={LINE_COLORS.red} glyph="✕" text="ناقص" />
        <Legend color={LINE_COLORS.yellow} glyph="+" text="إضافي" />
      </div>
      {order.lines.map(l => {
        const color = LINE_COLORS[l.color] ?? LINE_COLORS.grey;
        const sub = l.substituteForLineId ? byId.get(l.substituteForLineId) : null;
        const missingHere = l.barcode && unresolved.has(normBarcode(l.barcode));
        return (
          <div key={l.id} className="flex items-stretch border-b border-slate-100 last:border-b-0" style={{ borderInlineStart: `6px solid ${color}` }}>
            <div className="flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 px-2 py-2" style={{ color }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: color }}>
                {lineGlyph(l.state)}
              </span>
              <span className="text-[11px] font-bold">{l.label}</span>
            </div>
            <div className="min-w-0 flex-1 py-2">
              <div className="text-[14px] font-bold text-slate-900">
                {l.name}{l.shadeName ? <span className="font-normal text-slate-600"> — {l.shadeName}</span> : null}
              </div>
              <div className="font-mono text-[11px] text-slate-400" dir="ltr">{l.barcode ?? '—'}</div>
              {l.kind === 'EXTRA' && (
                <div className="text-[12px] font-bold" style={{ color: LINE_COLORS.yellow }}>
                  {l.charge === 'FREE' ? 'هدية مجانية' : 'إضافي مدفوع'}
                  {sub ? ` · بديل عن ${sub.name}${sub.shadeName ? ` — ${sub.shadeName}` : ''}` : ''}
                </div>
              )}
              {l.reason && <div className="text-[12px] text-slate-600">السبب: {l.reason}</div>}
              {missingHere && <div className="text-[12px] font-bold text-[#D64545]">الباركود غير موجود في كتالوج المحل</div>}
            </div>
            <div className="flex w-36 shrink-0 flex-col items-end justify-center px-3 text-[12px]">
              <span className="num">
                {l.kind === 'ORDERED' ? <>طُلب {formatNum(l.orderedQty)} · </> : null}
                جُهّز <b>{formatNum(l.pickedQty)}</b>
              </span>
              {l.missingQty > 0 && <span className="num font-bold text-[#D64545]">ناقص {formatNum(l.missingQty)}</span>}
              <span className="num text-slate-500">{l.charge === 'FREE' ? 'مجاناً' : formatIqd(l.unitPrice)}</span>
            </div>
          </div>
        );
      })}
    </div>
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

function AmountsBlock({ order }: { order: LookupResult }) {
  const m = order.money;
  const r = order.receipt;
  return (
    <Card title="المبالغ">
      <MoneyRow label="قيمة الأصناف المطلوبة" value={m.orderedSubtotal} />
      {m.shortageValue > 0 && <MoneyRow label="الناقص" value={-m.shortageValue} tone={LINE_COLORS.red} />}
      {m.extrasValue > 0 && <MoneyRow label="الإضافات المدفوعة" value={m.extrasValue} tone={LINE_COLORS.yellow} />}
      {m.freeExtrasValue > 0 && <MoneyRow label="هدايا مجانية (غير محسوبة)" value={m.freeExtrasValue} tone={LINE_COLORS.yellow} />}
      {r.shipping > 0 && <MoneyRow label="التوصيل" value={r.shipping} />}
      {r.giftWrap > 0 && <MoneyRow label="تغليف الهدية" value={r.giftWrap} />}
      {r.discount > 0 && <MoneyRow label="الخصم" value={-r.discount} />}
      <div className="my-1 border-t border-slate-200" />
      <MoneyRow label="المبلغ النهائي" value={r.total} strong />
      {!order.order.prepaid && order.order.deliveryOption !== 'PICKUP' && (
        <MoneyRow label="يُستلم عند التوصيل" value={m.codAmount} strong tone="#0b7d5d" />
      )}
      {order.order.prepaid && <div className="text-[13px] font-bold text-emerald-700">مدفوع مسبقاً بالبطاقة</div>}
      {m.refundAmount > 0 && <MoneyRow label="يُسترجع للبطاقة" value={m.refundAmount} tone={LINE_COLORS.red} />}
      <div className="mt-1 text-[11px] text-slate-500">
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
  busy,
  offline,
  error,
  onFinalize,
  onReprint,
  onSlip,
}: {
  order: LookupResult;
  status: OnlineOrdersStatus | null;
  result: FinalizeResult | null;
  checked: Record<string, number>;
  deliveredLines: { key: string; name: string; qty: number }[];
  busy: boolean;
  offline: boolean;
  error: string | null;
  onFinalize: () => void;
  onReprint: (what: 'receipt' | 'invoice' | 'label') => void;
  onSlip: () => void;
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
  else if (checkMissing.length) disabledReason = `المراجعة المزدوجة: امسح ${checkMissing.length} صنفاً بعد`;
  const tracking = order.shipment?.trackingNumber ?? result?.shipment?.trackingNumber;
  const shipmentState = result?.shipment?.state ?? order.shipment?.state;

  return (
    <div className="space-y-3">
      <OrderHeader order={order} />
      <CustomerBlock order={order} />
      <LinesTable order={order} />

      {doubleCheck && (
        <Card title="المراجعة المزدوجة — امسح كل قطعة قبل الإتمام">
          <div className="grid gap-1 md:grid-cols-2">
            {deliveredLines.map(l => {
              const n = checked[l.key] ?? 0;
              const done = n >= l.qty;
              return (
                <div key={l.key} className="flex items-center justify-between rounded-lg px-2 py-1 text-[13px]" style={{ background: done ? '#1F9D6318' : '#94A3B818' }}>
                  <span className="truncate">{l.name}</span>
                  <span className="num font-bold" style={{ color: done ? LINE_COLORS.green : '#475569' }}>{done ? '✓ ' : ''}{n} / {l.qty}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AmountsBlock order={order} />
        <div className="space-y-3">
          {!invoiced && blockers.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="mb-1 text-[13px] font-bold text-[#D64545]">موانع الفوترة</div>
              <ul className="list-inside list-disc space-y-0.5 text-[13px] text-red-800">
                {blockers.map(b => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] font-bold text-[#D64545]">{error}</div>}

          {invoiced ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[14px] font-bold text-emerald-800">
                {pickup ? 'سُلّم للزبونة' : 'مُفوتر'} — إيصال المحل <span className="font-mono" dir="ltr">{invoiced.receiptNumber}</span>
              </div>
              <div className="text-[12px] text-emerald-900/70">{invoiced.cashierName ?? ''}{invoiced.at ? ` · ${new Date(invoiced.at).toLocaleString('en-GB', { hour12: false })}` : ''}</div>
              {!pickup && (
                <div className="mt-1 text-[12px]">
                  الشحنة: <b>{SHIPMENT_STATE_LABELS[shipmentState ?? ''] ?? shipmentState ?? 'لم تُنشأ بعد'}</b>
                  {tracking ? <span className="font-mono" dir="ltr"> · {tracking}</span> : ''}
                  {shipmentState && shipmentState !== 'CREATED' && (
                    <div className="text-amber-700">رقم التتبع لم يصل — الطلب في «بانتظار شركة التوصيل» واطبع الملصق من هناك حين يصل.</div>
                  )}
                  {order.shipment?.lastError && <div className="text-[#D64545]">{order.shipment.lastError}</div>}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <ReprintButton onClick={() => onReprint('receipt')} disabled={busy}>طباعة الإيصال</ReprintButton>
                <ReprintButton onClick={() => onReprint('invoice')} disabled={busy}>طباعة الفاتورة</ReprintButton>
                {!pickup && <ReprintButton onClick={() => onReprint('label')} disabled={busy || !tracking}>طباعة الملصق</ReprintButton>}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">إعادة الطباعة لا تنشئ إيصالاً ولا شحنة.</div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={onFinalize}
                disabled={busy || !!disabledReason}
                className="h-20 w-full rounded-2xl bg-[#0f9f76] text-[22px] font-bold text-white shadow-[0_10px_24px_rgba(15,159,118,0.35)] transition hover:bg-[#0b7d5d] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {pickup ? 'تسليم للزبونة' : 'إتمام وطباعة'}
              </button>
              {disabledReason && <div className="mt-1.5 text-center text-[13px] font-bold text-[#D64545]">{disabledReason}</div>}
              {!disabledReason && (
                <div className="mt-1.5 text-center text-[12px] text-slate-500">
                  {pickup ? 'يُحفظ الإيصال ويُطبع وتُسجّل الزبونة «استلمت».' : 'يُحفظ الإيصال، تُنشأ شحنة هاي إكسبريس، ثم يُطبع الإيصال والفاتورة والملصق.'}
                </div>
              )}
            </div>
          )}
          <button type="button" onClick={onSlip} disabled={busy} className="w-full rounded-xl border border-slate-300 bg-white py-2 text-[12px] font-bold text-slate-600">
            طباعة قائمة الطلب (بلا أسعار)
          </button>
        </div>
      </div>
    </div>
  );
}

function ReprintButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {children}
    </button>
  );
}

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
    <div className="space-y-3">
      <OrderHeader order={order} />
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
        طرد راجع — إيصال البيع <span className="font-mono" dir="ltr">{order.invoiced?.receiptNumber}</span>.
        امسح كل قطعة رجعت سليمة إلى المحل، ثم أنشئ إيصال الإرجاع المربوط بفاتورة البيع.
      </div>
      <CustomerBlock order={order} />

      <Card title={`الأصناف الراجعة — ${scannedUnits} من ${totalUnits}`}>
        <div className="space-y-1">
          {lines.map(l => {
            const n = returned[l.key] ?? 0;
            const color = n >= l.qty ? LINE_COLORS.green : n > 0 ? LINE_COLORS.yellow : LINE_COLORS.grey;
            return (
              <div key={l.key} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5" style={{ borderInlineStart: `5px solid ${color}` }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: color }}>
                  {n >= l.qty ? '✓' : n > 0 ? '…' : '–'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{l.name}{l.free ? ' (هدية مجانية)' : ''}</span>
                <span className="font-mono text-[11px] text-slate-400" dir="ltr">{l.barcode}</span>
                <span className="num w-16 text-center text-[13px] font-bold">{n} / {l.qty}</span>
                <button
                  type="button"
                  disabled={!!done || n === 0}
                  onClick={() => setReturned({ ...returned, [l.key]: Math.max(0, n - 1) })}
                  className="rounded-md border border-slate-300 px-2 text-[13px] disabled:opacity-40"
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
          <div className="mt-2 flex gap-2">
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
    </div>
  );
}
