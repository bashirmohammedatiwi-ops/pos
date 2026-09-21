import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, isPermanentReceiptError } from '@/api/client';
import type {
  AccountSummaryDto,
  ArticleGroupDto,
  ArticleGroupItemDto,
  CardPaymentDto,
  PosSessionDto,
  PrintSettingsDto,
  ProductDto,
  ReceiptPrintPreviewDto,
  ReceiptReturnSourceDto,
  SaleKind,
  SalesmanDto,
} from '@/api/types';
import type { DiscountQrPerson, PrinterInfo } from '@fot/shared';
import { isDiscountQrCode, normalizeDiscountQrCode } from '@fot/shared';
import { totalRoundingDiscount, totalRoundingStep } from '@fot/shared';
import type { OutboxRow } from '@/lib/db';
import {
  cacheReferenceData,
  enqueueReceipt,
  findDiscountQr,
  findProductSmart,
  flushOutbox,
  outboxStats,
  removeLocalReceipt,
  resetDeadReceipt,
  syncCatalog,
  transferDeferred,
  updateDeferredPayload,
} from '@/lib/catalogSync';
import { QueueOverlay } from '@/components/QueueOverlay';
import { DeferredEditor, type EditorPayload } from '@/components/DeferredEditor';
import { getProductAttribution, refreshAttributionCache, resolveGroupSalesman } from '@/lib/attribution';
import { CARD_APPROVED_HOLD_MS, chargeCard, cardPayDelay, formatCardError } from '@/lib/cardPay';
import { CardPayOverlay, type CardPayOverlayState } from '@/components/CardPayOverlay';
import { CreditAccountPicker } from '@/components/CreditAccountPicker';
import { CartGroupBar } from '@/components/CartGroupBar';
import { CartTable } from '@/components/CartTable';
import { ArticleGroupsBar } from '@/components/ArticleGroupsBar';
import { SalesmanPicker } from '@/components/SalesmanPicker';
import { CashBoxPicker, cashBoxLabel } from '@/components/CashBoxPicker';
import { PosSidebar } from '@/components/PosSidebar';
import { canUseServer } from '@/lib/connectionGate';
import { db } from '@/lib/db';
import { focusInputVisualRight, onInputClickVisualRight, onInputFocusVisualRight } from '@/lib/focusInput';
import { useBarcodeCapture } from '@/hooks/useBarcodeCapture';
import { useFullscreen } from '@/hooks/useFullscreen';
import { useLanConnection } from '@/hooks/useLanConnection';
import { usePosHub } from '@/hooks/usePosHub';
import { createDebouncedSync } from '@/lib/syncSchedule';
import { formatIqd, formatNum } from '@/lib/money';
import { printReceipt } from '@/lib/printReceipt';
import { isDarkRgb, winCss } from '@/lib/winColor';
import {
  buildReceiptPayload,
  capUserDiscount,
  cardBlockedReason,
  cartCommission,
  cartSubtotal,
  emptyGroups,
  emptySlot,
  lineCommissionAmount,
  lineTotal,
  parseScan,
  sameLine,
  slotAmount,
  type CartGroupState,
  type CartLine,
  type InvoiceSlot,
} from '@/lib/sale';
import type { ReceiptSummaryDto } from '@/api/types';
import { NumPad } from '@/components/NumPad';
import { PosTile } from '@/components/PosTile';
import { resolveCashierPermissions } from '@/lib/permissions';
import {
  looksLikeReceiptNumber,
  matchReturnProduct,
  parseInvoiceNumber,
  remainingForSourceItem,
  sourceLinesToCart,
} from '@/lib/invoiceReturn';
import { collapseRepeatedScan, createScanEchoGuard } from '@/lib/scanGuard';
import { localDateTimeIso } from '@/lib/text';
import type { CashReportDto } from '@/api/types';

type SortMode = 'seq' | 'name' | 'price';
type Overlay = 'none' | 'pay' | 'price' | 'line-price' | 'qty' | 'discount' | 'cash-report' | 'salesman' | 'line-salesman' | 'add-salesman' | 'print' | 'receipts' | 'queue' | 'deferred-edit' | 'return-invoice';
type DiscountMode = 'amount' | 'percent';
/** Receipts summary + local flag for invoices still sitting in the offline queue. */
type TodayReceiptRow = ReceiptSummaryDto & { local?: boolean };

function toProduct(item: ArticleGroupItemDto): ProductDto {
  return {
    id: item.productId,
    seq: item.seq,
    num: item.barcode,
    name: item.name,
    barcode: item.barcode,
    originalPrice: item.originalPrice,
    price: item.price,
    stock: 0,
    discountPercent: 0,
    offerName: null,
  };
}

function kindLabel(kind: SaleKind) {
  if (kind === 1) return 'مرتجع';
  if (kind === 2) return 'هدية';
  return 'بيع';
}

function DockGlyph({ kind }: { kind: 'sale' | 'gift' | 'out' | 'card' | 'cash' }) {
  const common = { viewBox: '0 0 24 24', className: 'pos-dock-glyph', 'aria-hidden': true } as const;
  if (kind === 'gift') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" />
        <path d="M3 8h18v4H3z" />
        <path d="M12 8v13M12 8c0-2.2-1.3-4-3.2-4S6 6.2 6 8M12 8c0-2.2 1.3-4 3.2-4S18 6.2 18 8" />
      </svg>
    );
  }
  if (kind === 'out') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3" />
        <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" />
      </svg>
    );
  }
  if (kind === 'card') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </svg>
    );
  }
  if (kind === 'cash') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="7" />
        <path d="M12 8v8M9.5 10.2c.7-.8 1.6-1.1 2.5-1.1 1.5 0 2.6.8 2.6 2 0 2.6-5.1 1.4-5.1 3.6 0 1.1 1.1 2 2.7 2 1 0 1.9-.4 2.5-1" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 7h15l-1.4 8.2A2 2 0 0 1 17.6 17H8.4a2 2 0 0 1-2-1.6L5 4H3" />
      <circle cx="9" cy="20" r="1.2" fill="currentColor" />
      <circle cx="17" cy="20" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function SalesPage({
  session,
  onLogout,
}: {
  session: PosSessionDto;
  onLogout: () => void;
}) {
  const scanRef = useRef<HTMLInputElement>(null);
  const scanValueRef = useRef('');
  const isEchoScan = useRef(createScanEchoGuard()).current;
  const overlayRef = useRef<Overlay>('none');
  const qtyDraftRef = useRef<{ key: string; text: string } | null>(null);
  const scanMissTimer = useRef(0);
  const priceScanRef = useRef<HTMLInputElement>(null);
  const cardPayErrorRef = useRef(false);
  const cardRetryRef = useRef<(() => void) | null>(null);
  const [scan, setScan] = useState('');
  useEffect(() => { scanValueRef.current = scan; }, [scan]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [flashGen, setFlashGen] = useState(0);
  const [groups, setGroups] = useState<ArticleGroupDto[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupItems, setGroupItems] = useState<ArticleGroupItemDto[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('seq');
  const [productsOpen, setProductsOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1100));
  const [liveUpdating, setLiveUpdating] = useState(false);
  const liveTimer = useRef(0);
  const [salesmen, setSalesmen] = useState<SalesmanDto[]>([]);
  const [salesmanId, setSalesmanId] = useState(session.salesmanId);
  const [accounts, setAccounts] = useState<AccountSummaryDto[]>([]);
  const [accountId, setAccountId] = useState(0);
  const [creditPickerOpen, setCreditPickerOpen] = useState(false);
  const [masterAccount, setMasterAccount] = useState(session.activeMasterAccount);
  const [saleKind, setSaleKind] = useState<SaleKind>(0);
  const [cartGroups, setCartGroups] = useState<CartGroupState[]>(() => emptyGroups());
  const [activeGroupKey, setActiveGroupKey] = useState(1);
  const [slots, setSlots] = useState<InvoiceSlot[]>(() => [0, 1, 2].map(() => emptySlot(session.salesmanId)));
  const [activeSlot, setActiveSlot] = useState(0);
  const { online, reconnecting } = useLanConnection();
  const fullscreen = useFullscreen();
  const [busy, setBusy] = useState(false);
  const [cardPay, setCardPay] = useState<CardPayOverlayState>({ phase: 'idle' });
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [cashGiven, setCashGiven] = useState('');
  const [userDiscount, setUserDiscount] = useState(0);
  const [lastSale, setLastSale] = useState<string | null>(null);
  const [lastProduct, setLastProduct] = useState<ProductDto | null>(null);
  const [pendingAdd, setPendingAdd] = useState<{ product: ProductDto; qty: number } | null>(null);
  const [addSalesmanReason, setAddSalesmanReason] = useState<string | undefined>();
  const [pendingAllowed, setPendingAllowed] = useState<SalesmanDto[] | null>(null);
  const [lineSellerLine, setLineSellerLine] = useState<CartLine | null>(null);
  const [lineAllowed, setLineAllowed] = useState<SalesmanDto[] | null>(null);
  const [qtyDraft, setQtyDraft] = useState<{ key: string; text: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [returnSource, setReturnSource] = useState<ReceiptReturnSourceDto | null>(null);
  const [discountQr, setDiscountQr] = useState<DiscountQrPerson | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState('');
  const [priceScan, setPriceScan] = useState('');
  const [priceHit, setPriceHit] = useState<ProductDto | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [deferredCount, setDeferredCount] = useState(0);
  const [deadCount, setDeadCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [printSettings, setPrintSettings] = useState<PrintSettingsDto | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [askBeforePrint, setAskBeforePrint] = useState(false);
  const [todayReceipts, setTodayReceipts] = useState<TodayReceiptRow[]>([]);
  const [queueRows, setQueueRows] = useState<OutboxRow[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [editingRow, setEditingRow] = useState<OutboxRow | null>(null);
  const [linePriceDraft, setLinePriceDraft] = useState('');
  const [lineDiscountDraft, setLineDiscountDraft] = useState('');
  const [cashReport, setCashReport] = useState<CashReportDto | null>(null);
  const [cashReportLoading, setCashReportLoading] = useState(false);

  const px = useMemo(() => resolveCashierPermissions(session.permissions), [session.permissions]);
  const slotCount = px.invoiceSlotCount;
  const cashBoxes = session.cashBoxes ?? [];
  const selectedLine = cart.find(l => l.key === selectedKey) ?? null;
  // Salesman groups hidden: one salesman covers the whole invoice instead of one per group.
  const singleSeller = px.hideSalesmanGroups;
  const invoiceSalesmanName = salesmanId > 0
    ? salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName
    : '';

  // The section's boxes are refreshed live, so the box picked earlier can disappear (unlinked
  // in the control panel). Fall back to the section default instead of posting to a box the
  // server would now reject.
  useEffect(() => {
    if (cashBoxes.length === 0) return;
    if (cashBoxes.some(b => b.masterAccount === masterAccount)) return;
    const fallback = cashBoxes.find(b => b.isDefault) ?? cashBoxes[0];
    setMasterAccount(fallback.masterAccount);
  }, [cashBoxes, masterAccount]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(liveTimer.current);
    window.clearTimeout(scanMissTimer.current);
  }, []);

  useEffect(() => {
    if (!flashKey) return;
    const t = window.setTimeout(() => setFlashKey(null), 1400);
    return () => window.clearTimeout(t);
  }, [flashKey, flashGen]);

  useEffect(() => {
    if (saleKind === 1 && !px.allowSalesReturn) {
      setSaleKind(0);
      setReturnSource(null);
    }
    if (saleKind === 1 && px.invoiceBoundReturn && !returnSource) setSaleKind(0);
    if (saleKind === 2 && !px.allowGiftReceipt) setSaleKind(0);
    if (accountId > 0 && !px.allowCreditReceipt) setAccountId(0);
    if (!px.allowSearchArticles && groupFilter) setGroupFilter('');
    if (!px.makeDiscount && !discountQr && userDiscount > 0) {
      setUserDiscount(0);
      setDiscountInput('');
    }
  }, [px, saleKind, accountId, groupFilter, userDiscount, returnSource, discountQr]);

  overlayRef.current = overlay;
  qtyDraftRef.current = qtyDraft;

  const focusScan = useCallback(() => {
    const run = () => {
      if (overlayRef.current !== 'none') return;
      focusInputVisualRight(scanRef.current);
    };
    window.setTimeout(run, 0);
    window.setTimeout(run, 80);
  }, []);

  const markScanMiss = useCallback((code: string) => {
    setScanError(code);
    showToast('الباركود غير موجود');
    focusScan();
    window.clearTimeout(scanMissTimer.current);
    scanMissTimer.current = window.setTimeout(() => {
      setScanError(prev => (prev === code ? null : prev));
    }, 5000);
  }, [focusScan, showToast]);

  useEffect(() => {
    if (overlay !== 'none') return;
    const t = window.setTimeout(() => focusScan(), 0);
    return () => window.clearTimeout(t);
  }, [overlay, focusScan]);

  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      window.setTimeout(() => {
        if (overlayRef.current !== 'none') return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('.pos-overlay, [role="dialog"], .pos-products, .pos-credit-picker, .pos-context')) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
          return;
        }
        focusScan();
      }, 40);
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, [focusScan]);

  const refreshLocal = useCallback(async () => {
    const stats = await outboxStats();
    setPendingCount(stats.queued);
    setDeferredCount(stats.deferred);
    setDeadCount(stats.dead);
    setCatalogCount(await db.productCount());
    const cachedPrint = await db.loadPrintSettings();
    if (cachedPrint) setPrintSettings(cachedPrint);
    const cachedAccounts = await db.loadAccounts();
    setAccounts(cachedAccounts);
    setAccountId(current => (current && !cachedAccounts.some(a => a.id === current) ? 0 : current));
  }, []);

  const applyReferenceUi = useCallback(async () => {
    const list = await db.loadGroups();
    setGroups(list);
    setGroupId(current => (current && list.some(g => g.id === current) ? current : list[0]?.id ?? null));
    const men = await db.loadSalesmen();
    setSalesmen(men);
    const acc = await db.loadAccounts();
    setAccounts(acc);
    setAccountId(current => (current && !acc.some(a => a.id === current) ? 0 : current));
    const print = await db.loadPrintSettings();
    if (print) setPrintSettings(print);
    return acc;
  }, []);

  const runQuickSync = useCallback(async (opts?: { announce?: boolean }) => {
    if (!canUseServer(online)) return;
    try {
      const before = (await db.loadAccounts()).map(a => a.id).join(',');
      await cacheReferenceData(true);
      await refreshAttributionCache(true);
      const acc = await applyReferenceUi();
      const after = acc.map(a => a.id).join(',');
      if (opts?.announce && before !== after) {
        showToast('تم تحديث الحسابات الآجلة');
      }
    } catch {
      /* quick sync is best-effort and must not block the cashier */
    }
  }, [online, applyReferenceUi, showToast]);

  const syncingRef = useRef(false);
  const runSync = useCallback(async () => {
    if (!canUseServer(online) || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const flushed = await flushOutbox();
      const catalog = await syncCatalog();
      await cacheReferenceData(true);
      await applyReferenceUi();
      await refreshLocal();
      await refreshAttributionCache(true);
      if (catalog.removed > 0) {
        showToast(`حُذف ${catalog.removed} منتج من الجهاز بعد حذفه من الإداري`);
      }
      if (flushed.renumbered.length > 0) {
        const note = flushed.renumbered.map(r => `#${r.localNumber} ← ${r.newNumber}`).join('، ');
        showToast(`تغيّر رقم فاتورة محلية بعد الرفع: ${note} — أعد طباعتها من الفواتير المحلية`);
      } else if (flushed.uploaded > 0) {
        showToast(`رُفعت ${flushed.uploaded} فاتورة معلّقة`);
      } else if (flushed.dead > 0) {
        showToast(`${flushed.dead} فاتورة معلّقة تحتاج مراجعة`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'فشلت المزامنة';
      showToast(msg.includes('Unauthorized') || msg.includes('الجلسة')
        ? 'تعذر المزامنة — البيع مستمر محلياً'
        : msg);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [online, applyReferenceUi, refreshLocal, showToast]);

  const scheduleFullSync = useMemo(() => createDebouncedSync(() => { void runSync(); }, 1500), [runSync]);
  usePosHub(canUseServer(online), scheduleFullSync, () => {
    setLiveUpdating(true);
    window.clearTimeout(liveTimer.current);
    void runQuickSync({ announce: true }).finally(() => {
      liveTimer.current = window.setTimeout(() => setLiveUpdating(false), 800);
    });
  });

  useEffect(() => {
    if (!window.fotDesktop?.listPrinters) return;
    void (async () => {
      const list = await window.fotDesktop!.listPrinters!();
      setPrinters(list);
      const config = await window.fotDesktop!.getPrintConfig?.();
      setPrinterName(config?.printerName || list.find(p => p.isDefault)?.name || '');
      setAskBeforePrint(Boolean(config?.askBeforePrint));
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const localGroups = await db.loadGroups();
      if (localGroups.length) {
        setGroups(localGroups);
        if (localGroups[0]) setGroupId(localGroups[0].id);
      }
      const men = await db.loadSalesmen();
      if (men.length) setSalesmen(men);
      await refreshAttributionCache(false);
      await refreshLocal();
      // Instant session context: today's receipts show from the local mirror right away.
      await loadTodayReceiptsData();
    })();
  }, [refreshLocal]);

  useEffect(() => {
    if (!canUseServer(online)) return;
    void runQuickSync();
    const full = window.setTimeout(() => { void runSync(); }, 5000);
    const t = window.setInterval(() => { void runSync(); }, 90_000);
    return () => {
      window.clearTimeout(full);
      window.clearInterval(t);
    };
  }, [online, runQuickSync, runSync]);

  // Queue watchdog: refresh the always-visible counter and retry failed uploads shortly
  // after connectivity returns instead of waiting for the next full sync cycle.
  useEffect(() => {
    const tick = async () => {
      try {
        if (!canUseServer(online)) {
          await refreshLocal();
          return;
        }
        const stats = await outboxStats();
        if (stats.queued > 0) {
          const flushed = await flushOutbox();
          await refreshLocal();
          if (flushed.uploaded > 0) showToast(`رُفعت ${flushed.uploaded} فاتورة معلّقة`);
        } else {
          await refreshLocal();
        }
      } catch {
        /* best-effort */
      }
    };
    void tick();
    const t = window.setInterval(() => { void tick(); }, 10_000);
    return () => window.clearInterval(t);
  }, [online, refreshLocal, showToast]);

  const groupsStamp = groups.map(g => `${g.id}:${g.itemCount}`).join(',');
  useEffect(() => {
    if (!groupId) {
      setGroupItems([]);
      return;
    }
    void (async () => {
      const local = await db.loadGroupItems(groupId);
      setGroupItems(local);
      if (!canUseServer(online)) return;
      try {
        setGroupItems(await api.groupItems(groupId));
      } catch {
        /* keep the local tiles */
      }
    })();
  }, [groupId, groupsStamp, online]);

  const snapshotSlot = useCallback((): InvoiceSlot => ({
    cart,
    userDiscount,
    saleKind,
    recalledHoldId: null,
    accountId,
    salesmanId,
    cartGroups,
    activeGroupKey,
    returnSource,
    discountQr,
  }), [accountId, activeGroupKey, cart, cartGroups, discountQr, returnSource, saleKind, salesmanId, userDiscount]);

  const applySlot = useCallback((slot: InvoiceSlot) => {
    setCart(slot.cart);
    setUserDiscount(slot.userDiscount);
    setSaleKind(slot.saleKind);
    setAccountId(slot.accountId);
    setSalesmanId(slot.salesmanId);
    setCartGroups(slot.cartGroups?.length ? slot.cartGroups : emptyGroups());
    setActiveGroupKey(slot.activeGroupKey || 1);
    setReturnSource(slot.returnSource ?? null);
    setDiscountQr(slot.discountQr ?? null);
    setSelectedKey(slot.cart[0]?.key ?? null);
    setDiscountMode('amount');
    setDiscountInput(slot.userDiscount ? String(slot.userDiscount) : '');
  }, []);

  const switchSlot = useCallback((next: number) => {
    if (next === activeSlot) return;
    const current = snapshotSlot();
    const nextList = slots.map((s, i) => (i === activeSlot ? current : s));
    setSlots(nextList);
    applySlot(nextList[next] ?? emptySlot(salesmanId));
    setActiveSlot(next);
    focusScan();
  }, [activeSlot, applySlot, focusScan, slots, snapshotSlot, salesmanId]);

  const cycleSlot = useCallback(
    () => { if (slotCount > 1) switchSlot((activeSlot + 1) % slotCount); },
    [activeSlot, slotCount, switchSlot],
  );

  const firstParkedSlot = useCallback(() => {
    const current = snapshotSlot();
    const live = slots.map((s, i) => (i === activeSlot ? current : s));
    const idx = live.findIndex((s, i) => i !== activeSlot && s.cart.length > 0);
    if (idx < 0) {
      showToast('لا توجد فاتورة أخرى بها بنود');
      return;
    }
    switchSlot(idx);
  }, [activeSlot, showToast, slots, snapshotSlot, switchSlot]);

  const applyCommissions = session.applyCommissions !== false;
  const applyTargets = session.applyTargets !== false;
  const attrFlags = { applyCommissions, applyTargets };

  const applyPreviewToKey = useCallback((key: string, articleId: number, barcode: string | null, salesmanId: number, price: number) => {
    if (!canUseServer(online) || salesmanId <= 0 || !applyCommissions) return;
    void api.previewCommission({ articleId, barcode, salesmanId, quantity: 1, price }).then(preview => {
      if (!preview.matched) return;
      setCart(prev => prev.map(l => {
        if (l.key !== key) return l;
        const next = {
          ...l,
          commissionType: preview.commissionType ?? undefined,
          commissionValue: preview.commissionValue,
        };
        return { ...next, commissionAmount: lineCommissionAmount(next) };
      }));
    });
  }, [online, applyCommissions]);

  const pushLine = useCallback((p: ProductDto, qty: number, sid: number, sname: string, gkey: number, glabel: string, extras?: {
    price?: number;
    originalPrice?: number;
    sourceItemId?: number;
    maxQty?: number;
  }) => {
    let targetKey = '';
    const price = extras?.price ?? Number(p.price);
    const originalPrice = extras?.originalPrice ?? Number(p.originalPrice || p.price);
    setCart(prev => {
      const existing = prev.find(l => sameLine(l, p.id, sid, gkey, extras?.sourceItemId));
      if (existing) {
        targetKey = existing.key;
        const nextQty = extras?.maxQty != null
          ? Math.min(existing.quantity + qty, extras.maxQty)
          : existing.quantity + qty;
        const next = { ...existing, quantity: nextQty };
        return prev.map(l => (l.key === existing.key ? { ...next, commissionAmount: lineCommissionAmount(next) } : l));
      }
      const line: CartLine = {
        key: `${p.id}-${gkey}-${sid}-${Date.now()}`,
        articleId: p.id,
        num: p.num ?? null,
        barcode: p.barcode,
        name: p.name || p.barcode || `#${p.id}`,
        quantity: extras?.maxQty != null ? Math.min(qty, extras.maxQty) : qty,
        price,
        originalPrice,
        discount: 0,
        salesmanId: sid,
        salesmanName: sname,
        groupKey: gkey,
        groupLabel: glabel,
        sourceItemId: extras?.sourceItemId,
      };
      targetKey = line.key;
      return [...prev, line];
    });
    setSelectedKey(targetKey);
    setFlashKey(targetKey);
    setFlashGen(n => n + 1);
    applyPreviewToKey(targetKey, p.id, p.barcode, sid, price);
    setLastProduct(p);
    setScan('');
    setScanError(null);
    focusScan();
  }, [applyPreviewToKey, focusScan]);

  const addProductDirect = useCallback((p: ProductDto, qty: number, sid: number, sname: string, gkey: number, glabel: string) => {
    pushLine(p, qty, sid, sname, gkey, glabel);
  }, [pushLine]);

  // مندوبو منتج العمولة المسموحون — null = غير مقيّد (كل المندوبين)
  const allowedCacheRef = useRef(new Map<number, SalesmanDto[] | null>());
  const loadAllowedSalesmen = useCallback(async (p: ProductDto): Promise<SalesmanDto[] | null> => {
    if (!canUseServer(online)) return null;
    const cached = allowedCacheRef.current.get(p.id);
    if (cached !== undefined) return cached;
    try {
      const res = await api.allowedSalesmen(p.id, p.barcode);
      const list = res.restricted ? res.items : null;
      allowedCacheRef.current.set(p.id, list);
      return list;
    } catch {
      return null;
    }
  }, [online]);

  const addProductWithAttribution = useCallback(async (p: ProductDto, qty = 1) => {
    if (px.invoiceBoundReturn && returnSource) {
      const match = matchReturnProduct(returnSource, cart, p, qty);
      if (!match.ok) {
        showToast(match.error);
        focusScan();
        return;
      }
      if (match.qty < qty) showToast(`المتبقي من هذا الصنف ${match.qty}`);
      pushLine(
        p,
        match.qty,
        match.line.salesmanId ?? 0,
        match.line.salesmanName ?? '',
        match.line.groupKey || 1,
        match.line.groupLabel || `مجموعة ${match.line.groupKey || 1}`,
        {
          price: match.line.price,
          originalPrice: match.line.originalPrice || match.line.price,
          sourceItemId: match.line.itemId,
          maxQty: match.line.remainingQty,
        },
      );
      return;
    }

    const group = cartGroups.find(g => g.key === activeGroupKey) ?? cartGroups[0];
    const gkey = group?.key ?? 1;
    const glabel = `مجموعة ${gkey}`;
    const resolved = resolveGroupSalesman(group, salesmen);
    // Single-salesman cashiers have no groups to resolve — the invoice salesman owns every line.
    const sid = singleSeller ? salesmanId : resolved?.id ?? 0;
    const sname = singleSeller
      ? salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName
      : resolved?.name ?? '';

    const attr = await getProductAttribution(p, canUseServer(online), attrFlags);
    if (attr.requiresSalesman && sid <= 0) {
      setScan('');
      setScanError(null);
      setPendingAdd({ product: p, qty });
      setAddSalesmanReason(attr.reason ?? 'عمولة أو هدف — اختر المندوب');
      setPendingAllowed(null);
      setOverlay('add-salesman');
      void loadAllowedSalesmen(p).then(list => {
        setPendingAllowed(list);
      });
      return;
    }

    addProductDirect(p, qty, sid, sname, gkey, glabel);
  }, [activeGroupKey, addProductDirect, attrFlags, cart, cartGroups, focusScan, loadAllowedSalesmen, online, px.invoiceBoundReturn, pushLine, returnSource, salesmanId, salesmen, session.salesmanName, showToast, singleSeller]);

  async function loadReturnInvoice(raw: string): Promise<boolean> {
    const number = parseInvoiceNumber(raw);
    if (!number) return false;
    if (!px.allowSalesReturn) {
      showToast('لا صلاحية للمرتجع');
      return true;
    }
    if (!canUseServer(online)) {
      showToast('البحث عن الفاتورة يحتاج اتصالاً بالخادم');
      return true;
    }
    try {
      const src = await api.receiptByNumber(number);
      if (src.kind !== 0) {
        showToast('لا يمكن الإرجاع إلا من فاتورة بيع');
        return true;
      }
      if (!src.items.some(item => item.remainingQty > 0)) {
        showToast('تم إرجاع هذه الفاتورة بالكامل');
        return true;
      }
      setReturnSource(src);
      setSaleKind(1);
      setCart([]);
      setInvoiceDraft('');
      setOverlay('none');
      setScan('');
      setScanError(null);
      focusScan();
      showToast(`مردود فاتورة #${src.number}`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return false;
      showToast(e instanceof Error ? e.message : 'تعذر تحميل الفاتورة');
      return true;
    }
  }

  async function handleScan(code: string, qty: number) {
    const normalized = collapseRepeatedScan(code);
    if (!normalized) return;
    if (isEchoScan(normalized, qty)) return;
    const askingInvoice = overlayRef.current === 'return-invoice'
      || (px.invoiceBoundReturn && looksLikeReceiptNumber(normalized));
    if (askingInvoice) {
      const loaded = await loadReturnInvoice(normalized);
      if (loaded) return;
      if (overlayRef.current === 'return-invoice') {
        showToast('الفاتورة غير موجودة');
        return;
      }
    }
    if (px.invoiceBoundReturn && !returnSource && overlayRef.current === 'return-invoice') {
      showToast('أدخل رقم فاتورة البيع');
      return;
    }
    if (isDiscountQrCode(normalized)) {
      const person = await findDiscountQr(normalizeDiscountQrCode(normalized), canUseServer(online));
      if (!person) {
        showToast('رمز الخصم غير معروف أو متوقف');
        focusScan();
        return;
      }
      setDiscountQr(person);
      showToast(`خصم غير محدود — معتمد من ${person.name}`);
      setScan('');
      setScanError(null);
      focusScan();
      return;
    }
    const p = await findProductSmart(normalized, canUseServer(online));
    if (!p) {
      markScanMiss(normalized);
      return;
    }
    setScanError(null);
    await addProductWithAttribution(p, qty);
  }

  useBarcodeCapture((overlay === 'none' || overlay === 'return-invoice') && !busy, code => {
    void (async () => {
      scanValueRef.current = '';
      setScan('');
      const parsed = parseScan(code);
      await handleScan(parsed.code, parsed.qty);
    })();
  });

  async function submitScan() {
    const raw = scanValueRef.current;
    scanValueRef.current = '';
    setScan('');
    focusScan();
    const { qty, code } = parseScan(raw);
    if (!code) return;
    await handleScan(code, qty);
  }

  function cappedQty(line: CartLine, qty: number) {
    if (!returnSource || line.sourceItemId == null) return qty;
    const others = cart.filter(l => l.key !== line.key);
    const max = remainingForSourceItem(returnSource, others, line.sourceItemId);
    return Math.min(qty, max);
  }

  function changeQty(key: string, delta: number) {
    setQtyDraft(null);
    setCart(prev =>
      prev
        .map(l => {
          if (l.key !== key) return l;
          const next = { ...l, quantity: Math.max(0, cappedQty(l, l.quantity + delta)) };
          return { ...next, commissionAmount: lineCommissionAmount(next) };
        })
        .filter(l => l.quantity > 0),
    );
  }

  function setLineQty(key: string, qty: number) {
    setQtyDraft(null);
    const line = cart.find(l => l.key === key);
    const q = Math.max(0, line ? cappedQty(line, qty) : qty);
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l;
      const next = { ...l, quantity: q };
      return { ...next, commissionAmount: lineCommissionAmount(next) };
    }).filter(l => l.quantity > 0));
  }

  function commitQtyDraft(key: string, text: string) {
    const n = Math.max(1, Number(text.replace(/\D/g, '')) || 1);
    setLineQty(key, n);
  }

  function focusLineQty(line: CartLine) {
    setSelectedKey(line.key);
    setQtyDraft({ key: line.key, text: String(line.quantity) });
    setOverlay('qty');
  }

  function commitQtyOverlay() {
    const draft = qtyDraftRef.current;
    if (draft) commitQtyDraft(draft.key, draft.text);
    setOverlay('none');
  }

  function removeLine(key: string) {
    if (!px.deleteItem) {
      showToast('لا صلاحية لحذف بند');
      return;
    }
    setCart(prev => prev.filter(l => l.key !== key));
  }

  function duplicateLine(key: string) {
    if (returnSource) {
      showToast('لا يمكن تكرار بند في مردود الفاتورة');
      return;
    }
    if (!px.duplicateItem) {
      showToast('لا صلاحية لتكرار بند');
      return;
    }
    const src = cart.find(l => l.key === key);
    if (!src) return;
    const copy: CartLine = { ...src, key: `${src.articleId}-${Date.now()}` };
    setCart(prev => [...prev, copy]);
    setSelectedKey(copy.key);
  }

  function resetCurrentSale() {
    const blank = emptySlot(salesmanId);
    applySlot(blank);
    setSlots(prev => prev.map((s, i) => (i === activeSlot ? blank : s)));
    setLastSale(null);
    setOverlay('none');
    setCashGiven('');
    setCardPay({ phase: 'idle' });
    cardPayErrorRef.current = false;
    focusScan();
  }

  function clearCart() {
    if (!px.discardReceipt) {
      showToast('لا صلاحية لإلغاء الفاتورة');
      return;
    }
    resetCurrentSale();
  }

  function toggleKind(next: SaleKind) {
    if (next === 1 && !px.allowSalesReturn) {
      showToast('لا صلاحية للمرتجع');
      return;
    }
    if (next === 2 && !px.allowGiftReceipt) {
      showToast('لا صلاحية للهدايا');
      return;
    }
    if (next === 1 && px.invoiceBoundReturn) {
      if (returnMode) {
        setReturnSource(null);
        setSaleKind(0);
        setCart([]);
        focusScan();
        return;
      }
      setInvoiceDraft('');
      setOverlay('return-invoice');
      return;
    }
    if (next !== 1) setReturnSource(null);
    setSaleKind(current => (current === next ? 0 : next));
    if (next === 2) setAccountId(0);
  }

  function enterSaleMode() {
    if (returnSource) setCart([]);
    setReturnSource(null);
    setSaleKind(0);
    focusScan();
  }

  function fillReturnAll() {
    if (!returnSource) return;
    const lines = sourceLinesToCart(returnSource);
    if (!lines.length) {
      showToast('لا توجد أصناف متبقية للإرجاع');
      return;
    }
    setCart(lines);
    setSelectedKey(lines[lines.length - 1]?.key ?? null);
    setFlashKey(lines[lines.length - 1]?.key ?? null);
    setFlashGen(n => n + 1);
    focusScan();
  }

  function completePendingAdd(s: SalesmanDto) {
    if (!pendingAdd) return;
    const group = cartGroups.find(g => g.key === activeGroupKey) ?? cartGroups[0];
    const gkey = group?.key ?? 1;
    const glabel = `مجموعة ${gkey}`;
    // اختيار المندوب هنا يخص هذا الصنف فقط — لا يُثبَّت على المجموعة ولا على باقي البنود.
    addProductDirect(pendingAdd.product, pendingAdd.qty, s.id, s.name, gkey, glabel);
    setPendingAdd(null);
    setAddSalesmanReason(undefined);
    setOverlay('none');
    focusScan();
  }

  function cancelPendingAdd() {
    setPendingAdd(null);
    setAddSalesmanReason(undefined);
    setScan('');
    setScanError(null);
    setOverlay('none');
    focusScan();
  }

  function assignLineSalesman(lineKey: string, sid: number, sname: string) {
    setCart(prev => prev.map(l => (l.key === lineKey ? { ...l, salesmanId: sid, salesmanName: sname } : l)));
    const line = cart.find(l => l.key === lineKey);
    if (line) applyPreviewToKey(lineKey, line.articleId, line.barcode, sid, line.price);
  }

  function openLineSeller(line: CartLine) {
    if (returnSource) {
      showToast('بائع المردود ثابت من الفاتورة الأصلية');
      return;
    }
    setSelectedKey(line.key);
    setLineSellerLine(line);
    // إن كان للبند عمولة مقيدة بمندوبين بعينهم اعرضهم فقط
    const pseudo = { id: line.articleId, barcode: line.barcode } as ProductDto;
    void loadAllowedSalesmen(pseudo).then(list => setLineAllowed(list));
    setOverlay('line-salesman');
  }

  function closeLineSeller() {
    setLineSellerLine(null);
    setOverlay('none');
    focusScan();
  }

  function openGroupSalesman(key: number) {
    setActiveGroupKey(key);
    setOverlay('salesman');
  }

  function addCartGroup() {
    const key = cartGroups.reduce((m, g) => Math.max(m, g.key), 0) + 1;
    setCartGroups(prev => [...prev, { key, salesmanId: 0, salesmanName: '' }]);
    setActiveGroupKey(key);
  }

  function removeCartGroup(key: number) {
    if (cartGroups.length <= 1) return;
    if (cart.some(l => l.groupKey === key)) {
      showToast('لا يمكن حذف مجموعة فيها بنود');
      return;
    }
    const next = cartGroups.filter(g => g.key !== key);
    setCartGroups(next);
    if (activeGroupKey === key) setActiveGroupKey(next[0]?.key ?? 1);
  }

  function pickSalesman(s: SalesmanDto) {
    if (singleSeller) {
      // One salesman owns the whole invoice: every line follows, including ones already scanned.
      setSalesmanId(s.id);
      setCartGroups(prev => prev.map(g => ({ ...g, salesmanId: s.id, salesmanName: s.name })));
      setCart(prev => prev.map(l => ({ ...l, salesmanId: s.id, salesmanName: s.name })));
    } else {
      setCartGroups(prev => prev.map(g => (g.key === activeGroupKey ? { ...g, salesmanId: s.id, salesmanName: s.name } : g)));
      setCart(prev => prev.map(l => (
        l.groupKey === activeGroupKey ? { ...l, salesmanId: s.id, salesmanName: s.name } : l
      )));
    }
    setOverlay('none');
    focusScan();
  }

  const subtotal = useMemo(() => cartSubtotal(cart, saleKind), [cart, saleKind]);
  // Iraqi cash settles on 250 IQD steps: the total drops to the next lower
  // multiple and the shaved amount rides along as part of the invoice discount.
  const roundStep = totalRoundingStep(printSettings);
  const rawTotal = Math.max(0, subtotal - userDiscount);
  const roundingDiscount = totalRoundingDiscount(rawTotal, roundStep);
  const total = Math.max(0, rawTotal - roundingDiscount);
  /** What the receipt records as the invoice discount — manual plus cash rounding. */
  const postedDiscount = userDiscount + roundingDiscount;
  const commissionTotal = useMemo(() => cartCommission(cart), [cart]);

  const cartGroupStats = useMemo(() => {
    const map = new Map<number, { count: number; total: number }>();
    for (const g of cartGroups) map.set(g.key, { count: 0, total: 0 });
    for (const l of cart) {
      const key = l.groupKey || 1;
      const cur = map.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += lineTotal(l);
      map.set(key, cur);
    }
    return map;
  }, [cart, cartGroups]);

  const cartGroupBreakdown = useMemo(() => {
    if (cartGroups.length <= 1) return [];
    return cartGroups
      .map(g => ({ ...g, ...(cartGroupStats.get(g.key) ?? { count: 0, total: 0 }) }))
      .filter(g => g.count > 0);
  }, [cartGroupStats, cartGroups]);

  useEffect(() => {
    if ((!px.makeDiscount && !discountQr) || discountMode !== 'percent') return;
    const n = Number(discountInput) || 0;
    setUserDiscount(capUserDiscount(subtotal * n / 100, discountQr ? 0 : px.userDiscountLimit, subtotal));
  }, [discountInput, discountMode, discountQr, px.makeDiscount, px.userDiscountLimit, subtotal]);
  const cash = Number(cashGiven || 0);
  const change = cash - total;
  const creditMode = accountId > 0;
  const giftMode = saleKind === 2;
  const returnMode = saleKind === 1;
  const selectedAccount = accounts.find(a => a.id === accountId);
  const needsCash = !giftMode && !creditMode;
  const cardBlocked = cardBlockedReason({ saleKind, accountId, recalledHoldId: null, total });

  const visibleItems = useMemo(() => {
    const q = px.allowSearchArticles ? groupFilter.trim().toLowerCase() : '';
    const list = groupItems.filter(item => {
      if (!q) return true;
      return (item.name || '').toLowerCase().includes(q) || (item.barcode || '').toLowerCase().includes(q);
    });
    list.sort((a, b) => {
      if (sortMode === 'name') return (a.name || '').localeCompare(b.name || '', 'ar');
      if (sortMode === 'price') return a.price - b.price;
      return (a.seq - b.seq) || (a.id - b.id);
    });
    return list;
  }, [groupFilter, groupItems, px.allowSearchArticles, sortMode]);

  const groupFallback = useMemo(() => {
    const group = groups.find(g => g.id === groupId);
    return {
      bg: winCss(group?.backColour, '#ffffff'),
      fg: winCss(group?.foreColour, '#0b1220'),
      dark: isDarkRgb(group?.backColour),
    };
  }, [groupId, groups]);

  const pickGroupItem = useCallback((item: ArticleGroupItemDto) => {
    void addProductWithAttribution(toProduct(item));
  }, [addProductWithAttribution]);

  function selectCreditAccount(id: number) {
    if (id > 0 && !px.allowCreditReceipt) {
      showToast('لا صلاحية للبيع الآجل');
      return;
    }
    setAccountId(id);
    if (id > 0) setSaleKind(k => (k === 2 ? 0 : k));
  }

  const salesmanPickerSubtitle = useMemo(() => {
    const g = cartGroups.find(x => x.key === activeGroupKey);
    return g ? `مجموعة م${g.key}${g.salesmanName ? ` · ${g.salesmanName}` : ''}` : undefined;
  }, [activeGroupKey, cartGroups]);

  const canInvoiceDiscount = px.makeDiscount || !!discountQr;
  const invoiceDiscountLimit = discountQr ? 0 : px.userDiscountLimit;

  function applyDiscount(value: number) {
    if (!canInvoiceDiscount) {
      showToast('لا صلاحية لخصم الفاتورة — امسح رمز الاعتماد');
      return 0;
    }
    const next = capUserDiscount(value, invoiceDiscountLimit, subtotal);
    setUserDiscount(next);
    return next;
  }

  function applyDiscountInput(raw: string, mode = discountMode) {
    if (!canInvoiceDiscount) return;
    setDiscountInput(raw);
    const n = Number(raw) || 0;
    applyDiscount(mode === 'percent' ? subtotal * n / 100 : n);
  }

  function openLinePrice(line: CartLine) {
    if (returnSource) {
      showToast('سعر المردود ثابت من الفاتورة الأصلية');
      return;
    }
    if (!px.allowPriceChange) {
      showToast('لا صلاحية لتغيير السعر');
      return;
    }
    setSelectedKey(line.key);
    setLinePriceDraft(String(line.price));
    const pct = line.originalPrice > line.price && line.originalPrice > 0
      ? Math.round((1 - line.price / line.originalPrice) * 100)
      : 0;
    setLineDiscountDraft(pct > 0 ? String(pct) : '');
    setOverlay('line-price');
  }

  /** الحقلان مرتبطان: تعديل السعر يعيد حساب الخصم، والخصم يعيد حساب السعر تلقائياً. */
  function onLinePriceDraftChange(raw: string) {
    const clean = raw.replace(/[^\d.]/g, '');
    setLinePriceDraft(clean);
    if (!selectedLine) return;
    const price = Number(clean) || 0;
    const pct = selectedLine.originalPrice > 0 && price < selectedLine.originalPrice
      ? Math.round((1 - price / selectedLine.originalPrice) * 100)
      : 0;
    setLineDiscountDraft(pct > 0 ? String(pct) : '');
  }

  function onLineDiscountDraftChange(raw: string) {
    const clean = raw.replace(/[^\d.]/g, '');
    setLineDiscountDraft(clean);
    if (!selectedLine) return;
    const pct = Math.min(100, Math.max(0, Number(clean) || 0));
    const minPrice = px.itemDiscountLimit > 0
      ? Math.max(0, selectedLine.originalPrice - px.itemDiscountLimit)
      : 0;
    const price = Math.max(minPrice, Math.round(selectedLine.originalPrice * (1 - pct / 100)));
    setLinePriceDraft(String(price));
  }

  function commitLinePrice() {
    if (!selectedLine || !px.allowPriceChange) return;
    const next = Math.max(0, Number(linePriceDraft.replace(/[^\d.]/g, '')) || 0);
    const minPrice = px.itemDiscountLimit > 0
      ? Math.max(0, selectedLine.originalPrice - px.itemDiscountLimit)
      : 0;
    const price = Math.max(minPrice, next);
    setCart(prev => prev.map(l => {
      if (l.key !== selectedLine.key) return l;
      const updated = { ...l, price };
      return { ...updated, commissionAmount: lineCommissionAmount(updated) };
    }));
    applyPreviewToKey(selectedLine.key, selectedLine.articleId, selectedLine.barcode, selectedLine.salesmanId, price);
    setOverlay('none');
    focusScan();
  }

  async function loadCashReport() {
    if (!px.cashReport) {
      showToast('لا صلاحية لتقرير الصندوق');
      return;
    }
    setCashReportLoading(true);
    setCashReport(null);
    try {
      const today = new Date();
      const from = new Date(today);
      from.setHours(0, 0, 0, 0);
      const report = await api.cashReport(localDateTimeIso(from), localDateTimeIso(today));
      setCashReport(report);
      setOverlay('cash-report');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر جلب تقرير الصندوق');
    } finally {
      setCashReportLoading(false);
    }
  }

  /** Printable name of a cash box id, so the receipt names the box that took the money. */
  function boxNameOf(id: number | null | undefined) {
    const box = cashBoxes.find(b => b.masterAccount === id);
    return box ? cashBoxLabel(box) : null;
  }

  function buildPrint(number: number, paid: number): ReceiptPrintPreviewDto {
    return {
      receiptNumber: number,
      printedAt: new Date().toISOString(),
      kind: saleKind,
      cashierName: session.cashierName,
      salesmanName: salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName,
      posLabel: session.sectionName,
      cashBoxName: boxNameOf(masterAccount),
      lines: cart.map(l => ({
        name: l.name,
        barcode: l.barcode ?? '',
        articleNumber: l.num ?? l.barcode ?? '',
        quantity: returnMode ? -Math.abs(l.quantity) : l.quantity,
        unitPrice: l.price,
        lineTotal: returnMode ? -Math.abs(lineTotal(l)) : lineTotal(l),
        originalPrice: l.originalPrice,
      })),
      subTotal: subtotal,
      userDiscount: postedDiscount,
      total,
      paid,
      change: Math.max(0, paid - total),
    };
  }

  async function maybePrint(data: ReceiptPrintPreviewDto) {
    const settings = printSettings ?? await db.loadPrintSettings() ?? {
      id: 0,
      showLogo: false,
      showBarcode: true,
      showArticleNumber: false,
      copies: 1,
      paperWidthMm: 80,
      fontSize: 13,
      fontWeight: 400,
      logoMaxHeightPx: 72,
      showQrCode: false,
      showCashier: true,
      showSalesman: true,
      showCashBox: true,
      showTotalQuantity: true,
      roundTotalTo: 250,
      showDiscountDetails: true,
      showItemTable: true,
      showSubtotal: true,
      showPaymentLines: true,
      autoPrint: true,
      receiptTemplate: 'classic',
    };
    await db.saveLastReceipt({ data, settings });
    if (settings.autoPrint !== false) {
      try { await printReceipt(data, settings); } catch { showToast('تعذرت الطباعة'); }
    }
  }

  /**
   * Printing and the local mirrors only need the snapshot taken when the sale closed, so they run
   * after the cashier is already free to scan the next customer instead of holding the button.
   */
  function runSaleSideEffects(
    printed: ReceiptPrintPreviewDto,
    summary: TodayReceiptRow,
    refreshQueue = false,
  ) {
    void (async () => {
      await maybePrint(printed);
      await recordTodayReceipt(summary);
      if (refreshQueue) await refreshLocal();
    })();
  }

  /** Appends a receipt to the local today-mirror so reopening the app shows it instantly. */
  async function recordTodayReceipt(summary: TodayReceiptRow) {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const cached = (await db.loadTodayReceipts()) as TodayReceiptRow[];
      const today = (cached ?? []).filter(r => new Date(r.creationDate) >= start);
      const merged = [...today.filter(r => r.number !== summary.number), summary];
      await db.saveTodayReceipts(merged);
    } catch {
      /* best-effort mirror */
    }
  }

  async function loadTodayReceiptsData() {
    // Local mirror first — instant, works offline, includes not-yet-uploaded invoices.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const cached = ((await db.loadTodayReceipts()) as TodayReceiptRow[])
      .filter(r => new Date(r.creationDate) >= start);
    setTodayReceipts(cached);
    if (!canUseServer(online)) return;
    try {
      const res = await api.receipts({
        cashierId: session.cashierId,
        posId: session.posTerminalId ?? undefined,
        from: localDateTimeIso(start),
        pageSize: 80,
        hold: false,
      });
      // Server rows + local pending rows that have not been uploaded yet.
      const server = (res.items ?? []) as TodayReceiptRow[];
      const localPending = cached.filter(r => r.local);
      const merged = [...server, ...localPending.filter(r => !server.some(s => s.number === r.number))];
      setTodayReceipts(merged);
      await db.saveTodayReceipts(merged);
    } catch {
      /* keep the cached mirror */
    }
  }

  async function loadTodayReceipts() {
    if (!px.viewReceipts) {
      showToast('لا صلاحية لعرض الفواتير');
      return;
    }
    await loadTodayReceiptsData();
  }

  async function loadQueue() {
    setQueueRows(await db.pending());
  }

  async function handleTransfer(ids?: number[]) {
    setQueueBusy(true);
    try {
      const moved = await transferDeferred(ids);
      if (moved === 0) {
        showToast('لا توجد فواتير مؤجلة للترحيل');
        return;
      }
      await refreshLocal();
      await loadQueue();
      if (!canUseServer(online)) {
        showToast('انقطع الاتصال — الفواتير في الطابور وستُرفع تلقائياً عند عودته');
        return;
      }
      const flushed = await flushOutbox();
      await refreshLocal();
      await loadQueue();
      if (flushed.renumbered.length > 0) {
        const note = flushed.renumbered.map(r => `#${r.localNumber} ← ${r.newNumber}`).join('، ');
        showToast(`رُحّلت ${moved} — تغيّر رقم: ${note}`);
      } else if (flushed.uploaded > 0) {
        showToast(`رُحّلت ${flushed.uploaded} فاتورة إلى الإدارة`);
      } else if (flushed.dead > 0) {
        showToast(`رُحّلت لكن ${flushed.dead} تحتاج مراجعة — راجع تبويب الفاشلة`);
      } else {
        showToast('تعذر الرفع الآن — الفواتير في الطابور وستُرفع تلقائياً');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر الترحيل');
    } finally {
      setQueueBusy(false);
    }
  }

  async function handleDeleteDeferred(row: OutboxRow) {
    if (row.id == null) return;
    await removeLocalReceipt(row.id);
    // Keep the today-mirror consistent — the deleted invoice must not reappear there.
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const cached = (await db.loadTodayReceipts()) as TodayReceiptRow[];
      await db.saveTodayReceipts(cached.filter(r => r.number !== row.localNumber));
    } catch { /* best-effort */ }
    await refreshLocal();
    await loadQueue();
    setEditingRow(null);
    setOverlay('queue');
    showToast(`حُذفت الفاتورة المؤجلة #${row.localNumber}`);
  }

  async function handleRetryDead(row: OutboxRow) {
    if (row.id == null) return;
    await resetDeadReceipt(row.id);
    await loadQueue();
    await handleTransfer([row.id]);
  }

  async function handleSaveDeferred(next: EditorPayload) {
    if (editingRow?.id == null) return;
    await updateDeferredPayload(editingRow.id, next);
    // Keep the today mirror in sync with the edited amounts.
    try {
      const raw = (next.items ?? []).reduce((s, i) => s + i.quantity * i.price, 0);
      const totalAmount = Math.max(0, (next.kind === 1 ? Math.abs(raw) : raw) - (next.userDiscount ?? 0));
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const cached = (await db.loadTodayReceipts()) as TodayReceiptRow[];
      await db.saveTodayReceipts(cached.map(r => (
        r.number === editingRow.localNumber
          ? { ...r, totalAmount, itemCount: next.items?.length ?? r.itemCount }
          : r
      )));
    } catch { /* best-effort mirror */ }
    // Thermal reprint of the corrected invoice right after saving.
    try {
      await reprintDeferredPayload(next, editingRow.localNumber);
    } catch { /* طباعة أفضل جهد */ }
    await loadQueue();
    setEditingRow(null);
    setOverlay('queue');
    showToast(`حُفظت تعديلات الفاتورة #${editingRow.localNumber} وطُبعت من جديد`);
  }

  async function handleTransferFromEditor(next: EditorPayload) {
    if (editingRow?.id == null) return;
    await updateDeferredPayload(editingRow.id, next);
    const id = editingRow.id;
    setEditingRow(null);
    setOverlay('queue');
    await handleTransfer([id]);
  }

  async function reprintDeferredPayload(payload: EditorPayload, localNumber: number) {
    const settings = printSettings ?? await db.loadPrintSettings();
    if (!settings) {
      showToast('لا توجد إعدادات طباعة');
      return;
    }
    const raw = (payload.items ?? []).reduce((s, i) => s + i.quantity * i.price, 0);
    const subtotal = payload.kind === 1 ? Math.abs(raw) : raw;
    const totalAmount = Math.max(0, subtotal - (payload.userDiscount ?? 0));
    const paid = payload.payment ?? 0;
    // Deferred payloads store only article ids, so product names come from the
    // local catalog — otherwise the reprint would show barcodes instead.
    const names = new Map<number, string>();
    const nums = new Map<number, string>();
    try {
      const ids = Array.from(new Set((payload.items ?? []).map(i => i.articleId).filter(id => id > 0)));
      for (const p of (await db.productsByIds(ids.slice(0, 800))) ?? []) {
        if (p?.name) names.set(p.id, p.name);
        if (p?.num) nums.set(p.id, p.num);
      }
    } catch { /* fall back to barcodes */ }
    await printReceipt({
      receiptNumber: localNumber,
      printedAt: new Date().toISOString(),
      kind: payload.kind ?? 0,
      cashierName: session.cashierName,
      salesmanName: session.salesmanName,
      posLabel: session.sectionName,
      cashBoxName: boxNameOf(payload.masterAccount),
      lines: (payload.items ?? []).map(i => ({
        name: names.get(i.articleId) || i.barcode || `#${i.articleId}`,
        barcode: i.barcode ?? '',
        articleNumber: nums.get(i.articleId) || i.barcode || '',
        quantity: payload.kind === 1 ? -Math.abs(i.quantity) : i.quantity,
        unitPrice: i.price,
        lineTotal: payload.kind === 1 ? -Math.abs(i.quantity * i.price) : i.quantity * i.price,
        originalPrice: i.originalPrice,
      })),
      subTotal: subtotal,
      userDiscount: payload.userDiscount ?? 0,
      total: totalAmount,
      paid,
      change: Math.max(0, paid - totalAmount),
    }, settings);
  }

  async function testPrint() {
    const settings = printSettings ?? await db.loadPrintSettings();
    if (!settings) {
      showToast('لا توجد إعدادات طباعة');
      return;
    }
    await printReceipt({
      receiptNumber: 20261000001,
      printedAt: new Date().toISOString(),
      kind: 0,
      cashierName: session.cashierName,
      salesmanName: session.salesmanName,
      posLabel: session.sectionName,
      cashBoxName: boxNameOf(masterAccount),
      lines: [{
        name: 'تجربة طباعة',
        barcode: '0000',
        articleNumber: '0000',
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1000,
        originalPrice: 1000,
      }],
      subTotal: 1000,
      userDiscount: 0,
      total: 1000,
      paid: 1000,
      change: 0,
    }, settings);
  }

  async function reprintLast() {
    const last = await db.loadLastReceipt<{ data: ReceiptPrintPreviewDto; settings: PrintSettingsDto }>();
    if (!last) {
      showToast('لا توجد فاتورة أخيرة للطباعة');
      return;
    }
    await printReceipt(last.data, last.settings);
  }

  async function reprintReceipt(row: TodayReceiptRow) {
    try {
      const detail = await api.receiptDetail(row.id);
      const settings = printSettings ?? await db.loadPrintSettings();
      if (!settings) {
        showToast('لا توجد إعدادات طباعة');
        return;
      }
      await printReceipt({
        receiptNumber: detail.number,
        printedAt: detail.creationDate,
        kind: row.kind ?? 0,
        cashierName: session.cashierName,
        salesmanName: detail.salesmanName ?? session.salesmanName,
        posLabel: session.sectionName,
        cashBoxName: row.cashBoxName ?? boxNameOf(row.masterAccount),
        lines: detail.items.map(item => ({
          name: item.name || item.barcode || `#${item.articleId}`,
          barcode: item.barcode ?? '',
          articleNumber: item.barcode ?? '',
          quantity: item.quantity,
          unitPrice: item.price,
          lineTotal: item.lineTotal,
          originalPrice: item.originalPrice,
        })),
        subTotal: detail.items.reduce((s, i) => s + i.lineTotal, 0),
        userDiscount: detail.userDiscount,
        total: detail.totalAmount,
        paid: detail.payment,
        change: detail.cashBack,
      }, settings);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذرت إعادة الطباعة');
    }
  }

  function finishSale(message: string, last: string, _amount?: number) {
    resetCurrentSale();
    setLastSale(last);
    showToast(message);
  }

  async function executeCardCharge(amount: number) {
    setCardPay({ phase: 'processing', amount });
    cardPayErrorRef.current = false;
    try {
      const charged = await chargeCard(amount, session.mposService, session.mposComPort);
      if (!charged.ok || !charged.payment) {
        const message = formatCardError(charged.message, charged.cancelledByDevice);
        setCardPay({ phase: 'error', amount, message });
        cardPayErrorRef.current = true;
        return null;
      }
      setCardPay({ phase: 'success', amount });
      await cardPayDelay(CARD_APPROVED_HOLD_MS);
      setCardPay({ phase: 'idle' });
      return charged.payment;
    } catch (e) {
      const message = formatCardError(e instanceof Error ? e.message : 'خطأ غير متوقع');
      setCardPay({ phase: 'error', amount, message });
      cardPayErrorRef.current = true;
      return null;
    }
  }

  function cancelCardPay() {
    cardPayErrorRef.current = false;
    setCardPay({ phase: 'idle' });
    setBusy(false);
    focusScan();
  }

  async function checkout(method: 'cash' | 'card' = 'cash', cardOverride?: CardPaymentDto) {
    if (cart.length === 0) {
      showToast('السلة فارغة');
      return;
    }
    if (creditMode && !px.allowCreditReceipt) {
      showToast('لا صلاحية للبيع الآجل');
      return;
    }
    if (returnMode && !px.allowSalesReturn) {
      showToast('لا صلاحية للمرتجع');
      return;
    }
    if (returnMode && px.invoiceBoundReturn && !returnSource) {
      showToast('امسح باركود الفاتورة أو أدخل رقمها لبدء المردود');
      return;
    }
    if (giftMode && !px.allowGiftReceipt) {
      showToast('لا صلاحية للهدايا');
      return;
    }
    if (userDiscount > 0 && !canInvoiceDiscount) {
      showToast('لا صلاحية لخصم الفاتورة — امسح رمز الاعتماد');
      return;
    }

    setBusy(true);
    try {
      let card: CardPaymentDto | undefined = cardOverride;
      const paid = giftMode || creditMode
        ? 0
        : method === 'card' ? total : Math.max(total, cash || total);

      if (method === 'card' && needsCash && !card) {
        if (cardBlocked) {
          showToast(cardBlocked);
          return;
        }
        if (!session.cardPaymentEnabled && !session.mposService) {
          showToast('جهاز الدفع غير مفعّل لهذه النقطة');
          return;
        }
        card = (await executeCardCharge(total)) ?? undefined;
        if (!card) return;
      }

      // Manual-transfer cashiers always park invoices locally (deferred) — printed with a
      // real number seeded from the server — until they press the transfer button.
      if (px.manualTransfer) {
        const localNumber = await db.nextLocalNumber(session.cashierReceiptNum ?? 0);
        const payload = buildReceiptPayload({
          session,
          cart,
          salesmanId,
          saleKind,
          userDiscount: postedDiscount,
          accountId,
          masterAccount,
          isHold: false,
          paid,
          card,
          number: localNumber,
          returnOfReceiptId: returnSource?.id,
          discountQr,
        });
        await enqueueReceipt(payload, session.cashierReceiptNum ?? 0, 'deferred', localNumber);
        const printed = buildPrint(localNumber, payload.payment);
        const summary: TodayReceiptRow = {
          id: -localNumber,
          number: localNumber,
          creationDate: new Date().toISOString(),
          totalAmount: total,
          payment: payload.payment,
          cashBack: 0,
          salesmanId,
          salesmanName: salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName,
          itemCount: cart.length,
          kind: saleKind,
          local: true,
        };
        finishSale(
          'حُفظت مؤجلة — بانتظار الترحيل',
          `مؤجلة #${localNumber} — تُرحَّل من الفواتير المحلية`,
          total,
        );
        runSaleSideEffects(printed, summary, true);
        return;
      }

      const payload = buildReceiptPayload({
        session,
        cart,
        salesmanId,
        saleKind,
        userDiscount: postedDiscount,
        accountId,
        masterAccount,
        isHold: false,
        paid,
        card,
        returnOfReceiptId: returnSource?.id,
        discountQr,
      });

      if (!canUseServer(online)) {
        const localNumber = await db.nextLocalNumber(session.cashierReceiptNum ?? 0);
        await enqueueReceipt(
          { ...payload, number: localNumber },
          session.cashierReceiptNum ?? 0,
          'queued',
          localNumber,
        );
        const printed = buildPrint(localNumber, payload.payment);
        const summary: TodayReceiptRow = {
          id: -localNumber,
          number: localNumber,
          creationDate: new Date().toISOString(),
          totalAmount: total,
          payment: payload.payment,
          cashBack: 0,
          salesmanId,
          salesmanName: salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName,
          itemCount: cart.length,
          kind: saleKind,
          local: true,
        };
        finishSale(
          card ? 'دُفع بالماستر وحُفظت الفاتورة محلياً' : 'حُفظت الفاتورة محلياً',
          `محلية #${localNumber} — ستُرفع عند الاتصال`,
          total,
        );
        runSaleSideEffects(printed, summary, true);
        return;
      }

      try {
        const res = await api.createReceipt(payload);
        const printed = buildPrint(res.number, payload.payment);
        const summary: TodayReceiptRow = {
          id: res.receiptId,
          number: res.number,
          creationDate: new Date().toISOString(),
          totalAmount: res.totalAmount,
          payment: payload.payment,
          cashBack: res.cashBack,
          salesmanId,
          salesmanName: salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName,
          itemCount: cart.length,
          kind: saleKind,
        };
        const done = giftMode
          ? 'تم حفظ الهدية'
          : returnMode
            ? 'تم حفظ المرتجع'
            : creditMode
              ? 'تم حفظ الفاتورة الآجلة'
              : method === 'card'
                ? 'تم الدفع بماستر كارد'
                : 'تم حفظ الفاتورة';
        const last = `${kindLabel(saleKind)} ${res.number} — ${formatIqd(res.totalAmount)}`;
        finishSale(done, last, res.totalAmount);
        runSaleSideEffects(printed, summary);
        return;
      } catch (e) {
        // A card sale is already charged on the reader, so it is queued even when the server
        // rejects it outright — losing it would take the customer's money with no invoice.
        const canQueue = !isPermanentReceiptError(e) || Boolean(card);
        if (!canQueue) throw e;
        const localNumber = await db.nextLocalNumber(session.cashierReceiptNum ?? 0);
        await enqueueReceipt(
          { ...payload, number: localNumber },
          session.cashierReceiptNum ?? 0,
          'queued',
          localNumber,
        );
        const printed = buildPrint(localNumber, payload.payment);
        const summary: TodayReceiptRow = {
          id: -localNumber,
          number: localNumber,
          creationDate: new Date().toISOString(),
          totalAmount: total,
          payment: payload.payment,
          cashBack: 0,
          salesmanId,
          salesmanName: salesmen.find(s => s.id === salesmanId)?.name ?? session.salesmanName,
          itemCount: cart.length,
          kind: saleKind,
          local: true,
        };
        finishSale(
          card ? 'دُفع بالماستر وحُفظت الفاتورة محلياً' : 'حُفظت الفاتورة محلياً بعد تعذر الخادم',
          `محلية #${localNumber} — ستُرفع عند الاتصال`,
        );
        runSaleSideEffects(printed, summary, true);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'فشل حفظ الفاتورة');
    } finally {
      if (!cardPayErrorRef.current) {
        setBusy(false);
        focusScan();
      }
    }
  }

  cardRetryRef.current = () => { void checkout('card'); };

  async function lookupPrice() {
    const { code } = parseScan(priceScan);
    if (!code) return;
    const p = await findProductSmart(code, canUseServer(online));
    setPriceHit(p);
    if (!p) showToast('الباركود غير موجود');
    setPriceScan('');
    requestAnimationFrame(() => focusInputVisualRight(priceScanRef.current));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (e.key === 'F1') { e.preventDefault(); void fullscreen.toggle(); }
      if (e.key === 'F2') { e.preventDefault(); focusScan(); }
      if (e.key === 'F3') { e.preventDefault(); if (cart.length) void checkout('cash'); }
      if (e.key === 'F4' && slotCount > 1) { e.preventDefault(); cycleSlot(); }
      if (e.key === 'F5' && slotCount > 1) { e.preventDefault(); firstParkedSlot(); }
      if (e.key === 'F6') { e.preventDefault(); addCartGroup(); }
      if (e.key === 'F7') { e.preventDefault(); void reprintLast(); }
      if (e.key === 'F8') { e.preventDefault(); setProductsOpen(v => !v); }
      if (e.key === 'F11') { e.preventDefault(); openGroupSalesman(activeGroupKey); }
      if (e.ctrlKey && !inField && e.key >= '1' && e.key <= '3') {
        const idx = Number(e.key) - 1;
        const g = cartGroups[idx];
        if (g) { e.preventDefault(); setActiveGroupKey(g.key); }
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (overlay !== 'none') return;
        const line = selectedKey ? cart.find(l => l.key === selectedKey) : null;
        if (line) focusLineQty(line);
      }
      if (e.key === 'F10') {
        e.preventDefault();
        if (!cart.length) return;
        if (cardBlocked) { showToast(cardBlocked); return; }
        void checkout('card');
      }
      if (e.key === 'F12') {
        e.preventDefault();
        if (lastProduct) void addProductWithAttribution(lastProduct);
        else showToast('لا يوجد منتج أخير للتكرار');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (overlay === 'add-salesman') {
          cancelPendingAdd();
          return;
        }
        if (overlay === 'qty') setQtyDraft(null);
        if (overlay === 'return-invoice') {
          setOverlay('none');
          setInvoiceDraft('');
          focusScan();
          return;
        }
        if (overlay !== 'none') setOverlay('none');
        else {
          setScan('');
          setScanError(null);
          focusScan();
        }
      }
      if (!inField && px.deleteItem && e.key === 'Delete' && selectedKey) { e.preventDefault(); removeLine(selectedKey); }
      if (!inField && (e.key === '+' || e.key === '=' ) && selectedKey) { e.preventDefault(); changeQty(selectedKey, 1); }
      if (!inField && (e.key === '-' || e.key === '_') && selectedKey) { e.preventDefault(); changeQty(selectedKey, -1); }
      const inScan = e.target === scanRef.current;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (!inField || inScan) && cart.length) {
        e.preventDefault();
        const idx = selectedKey ? cart.findIndex(l => l.key === selectedKey) : -1;
        if (idx < 0) {
          setSelectedKey(cart[cart.length - 1].key);
        } else if (e.key === 'ArrowDown') {
          setSelectedKey(cart[Math.min(cart.length - 1, idx + 1)].key);
        } else {
          setSelectedKey(cart[Math.max(0, idx - 1)].key);
        }
      }
      if (overlay === 'qty' && e.key === 'Enter') {
        e.preventDefault();
        commitQtyOverlay();
        return;
      }
      if (!inField && overlay === 'none' && e.key === 'Enter' && selectedKey) {
        const line = cart.find(l => l.key === selectedKey);
        if (line) { e.preventDefault(); focusLineQty(line); }
      }
      if (!inField && px.deleteItem && e.key === 'Backspace' && cart.length) {
        e.preventDefault();
        const last = cart[cart.length - 1];
        if (last) removeLine(last.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGroupKey, cardBlocked, cart, cartGroups, focusLineQty, focusScan, fullscreen, lastProduct, overlay, px.deleteItem, selectedKey, slotCount]);

  const modeName = returnMode ? 'مرتجع' : giftMode ? 'هدية' : creditMode ? 'آجل' : 'بيع';

  return (
    <div className={`pos-app ${returnMode ? 'is-return' : giftMode ? 'is-gift' : ''}`}>
      <div className="pos-stage">
      <div className="pos-context">
        {singleSeller ? (
          <div className="pos-context-item min-w-0 flex-[2.4]">
            <span>البائع</span>
            <button
              type="button"
              onClick={() => setOverlay('salesman')}
              className={`pos-cart-group-seller w-full ${invoiceSalesmanName ? 'has-seller' : 'needs-seller'}`}
              title="بائع الفاتورة كاملة"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
              </svg>
              <span className="truncate">{invoiceSalesmanName || 'اختر بائع الفاتورة'}</span>
            </button>
          </div>
        ) : (
          <div className="pos-context-item pos-context-groups min-w-0 flex-[2.4]">
            <span>مجموعة</span>
            <CartGroupBar
              groups={cartGroups}
              activeKey={activeGroupKey}
              stats={cartGroupStats}
              onSelect={setActiveGroupKey}
              onAdd={addCartGroup}
              onRemove={removeCartGroup}
              onPickSalesman={openGroupSalesman}
            />
          </div>
        )}
        {px.allowCreditReceipt && (
          <div className={`pos-context-item pos-context-credit min-w-[240px] flex-[1.3] ${creditPickerOpen ? 'is-open' : ''}`}>
            <span>آجل</span>
            <CreditAccountPicker
              accounts={accounts}
              value={accountId}
              onChange={selectCreditAccount}
              onOpenChange={setCreditPickerOpen}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => { void loadQueue(); setOverlay('queue'); }}
          className={`pos-context-item pos-context-queue min-w-[150px] cursor-pointer flex-none ${deadCount > 0 ? 'is-danger' : deferredCount > 0 ? 'is-warn' : pendingCount > 0 ? 'is-busy' : ''}`}
          title="الفواتير المحلية — الطابور والمؤجلة والفاشلة"
        >
          <span>الطابور</span>
          <div className="flex items-center gap-2 text-[13px] font-bold" dir="ltr">
            <span className="num">⇅ {formatNum(pendingCount)}</span>
            <span className="num text-amber-600">⏳ {formatNum(deferredCount)}</span>
            {deadCount > 0 && <span className="num text-red-600">⚠ {formatNum(deadCount)}</span>}
          </div>
        </button>
      </div>

      <div className={`pos-workspace ${productsOpen ? 'is-products' : ''}`}>
        <aside className="pos-panel pos-pay">
          <div className="pos-slot-tabs">
            {Array.from({ length: slotCount }, (_, i) => i).map(i => {
              const view = i === activeSlot ? { cart, userDiscount, saleKind } : slots[i];
              const count = view?.cart.length ?? 0;
              const amount = view ? slotAmount(view) : 0;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => switchSlot(i)}
                  className={`pos-slot ${activeSlot === i ? 'on' : ''} ${count > 0 ? 'has-items' : ''}`}
                >
                  <div className="pos-slot-label">فاتورة {i + 1}</div>
                  <div className="pos-slot-meta num">{count ? formatIqd(amount) : 'فارغة'}</div>
                </button>
              );
            })}
          </div>
          <div className="pos-pay-cashbox">
            <span className="pos-pay-cashbox-label">صندوق</span>
            <CashBoxPicker boxes={cashBoxes} value={masterAccount} onChange={setMasterAccount} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-between p-2">
            <div>
              <div className="pos-ticket">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                  <span>{returnMode ? 'قيمة المرتجع' : giftMode ? 'قيمة الهدية' : 'المبلغ المستحق'}</span>
                  <span>{formatNum(cart.length)} بند</span>
                </div>
                <div className="pos-ticket-total num">{formatIqd(total)}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <div className="text-slate-400">قبل الخصم</div>
                    <div className="num text-slate-200">{formatIqd(subtotal)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">الخصم</div>
                    <div className="num text-amber-300">{formatIqd(postedDiscount)}</div>
                  </div>
                </div>
                {roundingDiscount > 0 && (
                  <div className="mt-2 text-[12px] text-amber-300">
                    تقريب {formatNum(roundStep)} <span className="num font-bold">−{formatIqd(roundingDiscount)}</span>
                  </div>
                )}
                {commissionTotal > 0 && (
                  <div className="mt-2 text-[12px] text-teal-300">
                    عمولة السلة <span className="num font-bold">{formatIqd(commissionTotal)}</span>
                  </div>
                )}
                {lastSale && <div className="mt-2 truncate text-[11px] text-teal-300">{lastSale}</div>}
              </div>
              {cartGroupBreakdown.length > 0 && (
                <div className="pos-group-breakdown">
                  {cartGroupBreakdown.map(g => (
                    <div key={g.key} className={`pos-group-breakdown-row ${g.key === activeGroupKey ? 'is-active' : ''}`}>
                      <span>م{g.key}{g.salesmanName ? ` · ${g.salesmanName}` : ''}</span>
                      <span className="num">{formatNum(g.count)} · {formatIqd(g.total)}</span>
                    </div>
                  ))}
                </div>
              )}
              {creditMode && selectedAccount && (
                <div className="mt-2 rounded-xl bg-sky-50 px-2.5 py-1.5 text-[12px] text-sky-800">
                  آجل: {selectedAccount.name || selectedAccount.num}
                </div>
              )}
              {canInvoiceDiscount && !giftMode && (
                <button
                  type="button"
                  className="pos-sum-discount-open"
                  onClick={() => setOverlay('discount')}
                >
                  <span>
                    خصم الفاتورة
                    {discountQr
                      ? <small> (غير محدود · {discountQr.name})</small>
                      : px.userDiscountLimit > 0 && (
                        <small> (حد {formatIqd(px.userDiscountLimit)})</small>
                      )}
                  </span>
                  <b className="num">{userDiscount > 0 ? formatIqd(userDiscount) : 'بدون خصم'}</b>
                </button>
              )}
            </div>
          </div>
        </aside>

        <section className="pos-panel pos-panel-cart">
          {discountQr && (
            <div className="pos-mode-banner is-gift">
              خصم غير محدود — معتمد من {discountQr.name}
              <button
                type="button"
                className="ms-2 underline"
                onClick={() => {
                  setDiscountQr(null);
                  if (!px.makeDiscount) {
                    setUserDiscount(0);
                    setDiscountInput('');
                  }
                }}
              >
                إلغاء
              </button>
            </div>
          )}
          {giftMode && (
            <div className="pos-mode-banner is-gift">
              وضع الهدية — بدون تحصيل نقدي
            </div>
          )}
          <div className="pos-scan-stack">
            <div className="pos-scanbar">
              <div className={`pos-scan-wrap ${scanError ? 'is-miss' : ''}`}>
                <svg className="pos-scan-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2" />
                  <path d="M8 12h8" />
                </svg>
                <input
                  ref={scanRef}
                  value={scan}
                  disabled={overlay !== 'none'}
                  onChange={e => {
                    setScanError(null);
                    const value = e.currentTarget?.value ?? e.target?.value ?? '';
                    scanValueRef.current = value;
                    setScan(value);
                  }}
                  onFocus={onInputFocusVisualRight}
                  onClick={onInputClickVisualRight}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submitScan();
                    }
                  }}
                  placeholder="امسح الباركود أو 5*الباركود"
                  className={`pos-field pos-scan w-full ${scanError ? 'is-miss' : ''}`}
                  dir="ltr"
                  autoFocus
                />
              </div>
              <button type="button" className="pos-add shrink-0" onClick={() => void submitScan()}>إضافة</button>
              {cart.length > 0 && (
                <span className="pos-cart-count">{formatNum(cart.length)} بند</span>
              )}
            </div>
            {scanError && (
              <div className="pos-scan-miss" role="alert">
                المنتج غير موجود — <span className="num" dir="ltr">{scanError}</span>
              </div>
            )}
            {returnSource && (
              <div className="pos-return-source">
                <div>
                  <strong>مردود فاتورة <span className="num" dir="ltr">#{returnSource.number}</span></strong>
                  <span>نفس سعر البيع والبائع من الفاتورة الأصلية</span>
                </div>
                <button type="button" className="pos-chip" onClick={fillReturnAll}>استرجاع الكل</button>
              </div>
            )}
          </div>
          <div className="pos-cart-body">
            {cart.length === 0 && (
              <div className="pos-empty">
                <div className="pos-empty-icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2" />
                    <path d="M8 12h8" />
                  </svg>
                </div>
                <p className="text-[15px] font-semibold text-slate-600">
                  {returnSource
                    ? `امسح أصناف الفاتورة #${returnSource.number} للإرجاع`
                    : 'امسح الباركود للبدء'}
                </p>
                <p className="mt-1 text-[12px] text-slate-400">
                  {returnSource
                    ? 'يمكن إرجاع الفاتورة كلياً أو جزئياً بنفس السعر والبائع'
                    : 'كل منتج يظهر كصف في الجدول · ↑↓ للتنقل · F9 للكمية'}
                </p>
              </div>
            )}
            {cart.length > 0 && (
              <CartTable
                cart={cart}
                selectedKey={selectedKey}
                flashKey={flashKey}
                flashGen={flashGen}
                showGroups={cartGroups.length > 1}
                returnMode={returnMode}
                giftMode={giftMode}
                allowPriceChange={px.allowPriceChange && !returnSource}
                allowDelete={px.deleteItem}
                onSelect={setSelectedKey}
                onQtyDelta={changeQty}
                onQtyFocus={focusLineQty}
                onOpenPrice={openLinePrice}
                onOpenSeller={openLineSeller}
                onRemove={removeLine}
                onScanFocus={focusScan}
                footerActions={selectedLine ? (
                  <div className="pos-cart-excel-actions">
                    <span>F9 كمية</span>
                    {px.duplicateItem && (
                      <button type="button" onClick={() => duplicateLine(selectedLine.key)}>تكرار</button>
                    )}
                    {px.allowPriceChange && (
                      <button type="button" onClick={() => openLinePrice(selectedLine)}>سعر</button>
                    )}
                  </div>
                ) : null}
              />
            )}
          </div>
        </section>

        {productsOpen && (
          <section className="pos-panel pos-products">
            <ArticleGroupsBar
              groups={groups}
              selectedId={groupId}
              selectedGroup={groups.find(g => g.id === groupId) ?? null}
              query={groupFilter}
              onQueryChange={setGroupFilter}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
              visibleCount={visibleItems.length}
              totalInGroup={groupItems.length}
              onSelect={id => { setGroupId(id); setGroupFilter(''); }}
              searchEnabled={px.allowSearchArticles}
            />
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="pos-tiles">
                {visibleItems.map(item => (
                  <PosTile
                    key={item.id}
                    item={item}
                    fallbackBg={groupFallback.bg}
                    fallbackFg={groupFallback.fg}
                    fallbackDark={groupFallback.dark}
                    onPick={pickGroupItem}
                  />
                ))}
              </div>
              {visibleItems.length === 0 && (
                <div className="py-16 text-center text-[13px] text-slate-400">لا توجد منتجات في هذه المجموعة</div>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="pos-dock">
        <div className="pos-dock-modes">
          <button type="button" onClick={enterSaleMode} className={`pos-dock-mode ${saleKind === 0 ? 'on-sale' : ''}`}>
            <DockGlyph kind="sale" />
            <span>بيع</span>
          </button>
          {px.allowGiftReceipt && (
            <button type="button" onClick={() => toggleKind(2)} className={`pos-dock-mode ${giftMode ? 'on-gift' : ''}`}>
              <DockGlyph kind="gift" />
              <span>هدية</span>
            </button>
          )}
          {px.allowSalesReturn && (
            <button type="button" onClick={() => toggleKind(1)} className={`pos-dock-mode ${returnMode ? 'on-out' : ''}`}>
              <DockGlyph kind="out" />
              <span>مرتجع</span>
            </button>
          )}
        </div>
        <div className="pos-dock-total">
          <small>{modeName}</small>
          <b className="num">{formatIqd(total)}</b>
        </div>
        <div className="pos-dock-ops">
          {px.discardReceipt && (
            <button type="button" onClick={clearCart} className="pos-dock-side danger">إلغاء</button>
          )}
        </div>
        <div className="pos-dock-pays">
          <button
            type="button"
            onClick={() => void checkout('card')}
            disabled={busy || cart.length === 0 || Boolean(cardBlocked)}
            className="pos-dock-pay card"
          >
            <DockGlyph kind="card" />
            <span>ماستر</span>
            <small>F10</small>
          </button>
          <button
            type="button"
            onClick={() => {
              if (needsCash && !giftMode && !creditMode) setOverlay('pay');
              else void checkout('cash');
            }}
            disabled={busy || cart.length === 0}
            className="pos-dock-pay primary"
          >
            <DockGlyph kind="cash" />
            <span>{giftMode ? 'حفظ الهدية' : creditMode ? 'حفظ الآجل' : returnMode ? 'تأكيد المرتجع' : 'إتمام نقداً'}</span>
            <small>F3</small>
          </button>
        </div>
      </div>
      </div>

      <PosSidebar
        session={session}
        modeName={modeName}
        returnMode={returnMode}
        giftMode={giftMode}
        productsOpen={productsOpen}
        fullscreenActive={fullscreen.active}
        online={online}
        reconnecting={reconnecting}
        syncing={syncing}
        liveUpdating={liveUpdating}
        catalogCount={catalogCount}
        pendingCount={pendingCount}
        deferredCount={deferredCount}
        deadCount={deadCount}
        canViewReceipts={px.viewReceipts}
        canCashReport={px.cashReport}
        onToggleProducts={() => setProductsOpen(v => !v)}
        onToggleFullscreen={() => { void fullscreen.toggle(); }}
        onSync={() => { void runSync(); }}
        onPriceCheck={() => { setPriceScan(''); setPriceHit(null); setOverlay('price'); }}
        onTodayReceipts={() => { void loadTodayReceipts(); setOverlay('receipts'); }}
        onCashReport={() => { void loadCashReport(); }}
        onPrint={() => setOverlay('print')}
        onReprint={() => { void reprintLast(); }}
        onOutbox={() => { void loadQueue(); setOverlay('queue'); }}
        onSession={() => { if (px.viewReceipts) { void loadTodayReceipts(); setOverlay('receipts'); } }}
        onLogout={onLogout}
      />

      {toast && (
        <div className="pos-toast">{toast}</div>
      )}

      {cardPay.phase !== 'idle' && (
        <CardPayOverlay
          state={cardPay}
          onRetry={() => cardRetryRef.current?.()}
          onCancel={cancelCardPay}
        />
      )}

      {overlay === 'return-invoice' && (
        <div className="pos-overlay" onClick={() => { setOverlay('none'); setInvoiceDraft(''); }}>
          <div className="pos-dialog pos-pay-dialog" onClick={e => e.stopPropagation()}>
            <div className="pos-pay-head">
              <small>مردود مربوط بالفاتورة</small>
              <b>رقم الفاتورة أو باركودها</b>
            </div>
            <p className="mb-2 text-center text-[12px] text-slate-500">
              امسح باركود الفاتورة أو اكتب رقمها — يمكن الإرجاع كلياً أو جزئياً
            </p>
            <input
              autoFocus
              value={invoiceDraft}
              onChange={e => setInvoiceDraft(e.target.value.replace(/\D/g, ''))}
              onFocus={onInputFocusVisualRight}
              onClick={onInputClickVisualRight}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleScan(invoiceDraft, 1);
                }
              }}
              className="pos-pay-input num"
              dir="ltr"
              inputMode="numeric"
              placeholder="20261000001"
            />
            <NumPad
              onDigit={d => setInvoiceDraft(v => `${v}${d}`)}
              onBack={() => setInvoiceDraft(v => v.slice(0, -1))}
              onClear={() => setInvoiceDraft('')}
            />
            <div className="pos-pay-actions">
              <button type="button" onClick={() => { setOverlay('none'); setInvoiceDraft(''); }} className="pos-chip h-12">رجوع</button>
              <button type="button" onClick={() => void handleScan(invoiceDraft, 1)} className="pos-pay-confirm">فتح الفاتورة</button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'qty' && qtyDraft && (
        <div className="pos-overlay" onClick={() => { setQtyDraft(null); setOverlay('none'); }}>
          <div className="pos-dialog pos-pay-dialog" onClick={e => e.stopPropagation()}>
            <div className="pos-pay-head">
              <small>كمية المنتج</small>
              <b className="truncate text-[15px]">{cart.find(l => l.key === qtyDraft.key)?.name ?? 'الكمية'}</b>
            </div>
            <input
              autoFocus
              value={qtyDraft.text}
              onChange={e => setQtyDraft({ key: qtyDraft.key, text: e.target.value.replace(/\D/g, '') })}
              onFocus={onInputFocusVisualRight}
              onClick={onInputClickVisualRight}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitQtyOverlay(); } }}
              className="pos-pay-input num"
              dir="ltr"
              inputMode="numeric"
              placeholder="1"
            />
            <NumPad
              onDigit={d => setQtyDraft(q => q ? { ...q, text: q.text === '0' ? d : `${q.text}${d}` } : q)}
              onBack={() => setQtyDraft(q => q ? { ...q, text: q.text.slice(0, -1) } : q)}
              onClear={() => setQtyDraft(q => q ? { ...q, text: '' } : q)}
            />
            <div className="pos-pay-actions">
              <button type="button" onClick={() => { setQtyDraft(null); setOverlay('none'); }} className="pos-chip h-12">رجوع</button>
              <button type="button" onClick={commitQtyOverlay} className="pos-pay-confirm">تأكيد الكمية</button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'discount' && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog pos-pay-dialog" onClick={e => e.stopPropagation()}>
            <div className="pos-pay-head">
              <small>خصم الفاتورة</small>
              <b className="num">{formatIqd(userDiscount)}</b>
            </div>
            {discountQr ? (
              <p className="mb-2 text-center text-[12px] text-emerald-700">غير محدود · {discountQr.name}</p>
            ) : px.userDiscountLimit > 0 && (
              <p className="mb-2 text-center text-[12px] text-slate-500">الحد {formatIqd(px.userDiscountLimit)}</p>
            )}
            <input
              autoFocus
              value={discountInput}
              onChange={e => applyDiscountInput(e.target.value.replace(/[^\d.]/g, ''))}
              onFocus={onInputFocusVisualRight}
              onClick={onInputClickVisualRight}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setOverlay('none'); } }}
              className="pos-pay-input num"
              dir="ltr"
              inputMode="decimal"
              placeholder={discountMode === 'percent' ? '%' : 'مبلغ'}
            />
            <div className="pos-pay-presets">
              <button
                type="button"
                onClick={() => { setDiscountMode('percent'); applyDiscountInput(discountInput || '0', 'percent'); }}
                className={`pos-chip ${discountMode === 'percent' ? 'pos-chip-on' : ''}`}
              >
                نسبة %
              </button>
              <button
                type="button"
                onClick={() => { setDiscountMode('amount'); applyDiscountInput(discountInput || '0', 'amount'); }}
                className={`pos-chip ${discountMode === 'amount' ? 'pos-chip-on' : ''}`}
              >
                مبلغ
              </button>
            </div>
            <NumPad
              onDigit={d => applyDiscountInput(discountInput === '0' ? d : `${discountInput}${d}`)}
              onBack={() => applyDiscountInput(discountInput.slice(0, -1))}
              onClear={() => applyDiscountInput('')}
            />
            <div className="pos-pay-actions">
              <button type="button" onClick={() => { applyDiscountInput(''); setOverlay('none'); }} className="pos-chip h-12">بدون خصم</button>
              <button type="button" onClick={() => setOverlay('none')} className="pos-pay-confirm">تم</button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'pay' && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog pos-pay-dialog" onClick={e => e.stopPropagation()}>
            <div className="pos-pay-head">
              <small>المطلوب</small>
              <b className="num">{formatIqd(total)}</b>
            </div>
            <input
              autoFocus
              value={cashGiven}
              onChange={e => setCashGiven(e.target.value.replace(/[^\d.]/g, ''))}
              onFocus={onInputFocusVisualRight}
              onClick={onInputClickVisualRight}
              className="pos-pay-input num"
              dir="ltr"
              inputMode="decimal"
              placeholder="0"
            />
            <div className="pos-pay-presets">
              {[total, 10000, 25000, 50000, 100000].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCashGiven(String(n))}
                  className={`pos-chip ${cashGiven === String(n) ? 'pos-chip-on' : ''}`}
                >
                  {n === total ? 'المطلوب' : formatIqd(n)}
                </button>
              ))}
            </div>
            <NumPad
              onDigit={d => setCashGiven(v => (v === '0' ? d : `${v}${d}`))}
              onBack={() => setCashGiven(v => v.slice(0, -1))}
              onClear={() => setCashGiven('')}
            />
            <div className={`pos-pay-change ${change >= 0 ? 'ok' : 'bad'}`}>
              <span>الباقي</span>
              <b className="num">{formatIqd(change)}</b>
            </div>
            <div className="pos-pay-actions">
              <button type="button" onClick={() => setOverlay('none')} className="pos-chip h-12">رجوع</button>
              <button type="button" disabled={busy} onClick={() => void checkout('cash')} className="pos-pay-confirm">
                {busy ? 'جاري…' : 'تأكيد نقداً'}
              </button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'price' && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-[16px] font-bold">فحص السعر</h2>
            <input
              ref={priceScanRef}
              autoFocus
              value={priceScan}
              onChange={e => setPriceScan(e.target.value)}
              onFocus={onInputFocusVisualRight}
              onClick={onInputClickVisualRight}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lookupPrice(); } }}
              placeholder="امسح الباركود"
              className="pos-field mt-3 h-12 w-full"
              dir="ltr"
            />
            {priceHit && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-center">
                <div className="text-[14px] font-semibold">{priceHit.name}</div>
                <div className="num mt-2 text-3xl font-bold text-teal-700">{formatIqd(priceHit.price)}</div>
                {priceHit.offerName && <div className="mt-1 text-[12px] text-amber-700">{priceHit.offerName}</div>}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setOverlay('none')} className="pos-chip">إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'print' && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold">الطابعة المحلية</h2>
            <p className="mt-1 text-[12px] text-slate-500">شكل الفاتورة يُدار من لوحة الإدارة</p>
            <label className="mt-3 block text-[12px] font-medium text-slate-600">الطابعة</label>
            <select
              value={printerName}
              onChange={e => setPrinterName(e.target.value)}
              className="pos-field mt-1 h-9 w-full"
            >
              <option value="">الطابعة الافتراضية</option>
              {printers.map(p => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))}
            </select>
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={askBeforePrint}
                onChange={e => setAskBeforePrint(e.target.checked)}
              />
              السؤال قبل الطباعة
            </label>
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[12px] text-slate-500">
              {printSettings?.headerText || 'فاتورة نقطة البيع'} · {printSettings?.paperWidthMm || 80}مم · {printSettings?.copies || 1} نسخة
              {printSettings?.receiptTemplate === 'compact' ? ' · مضغوط' : printSettings?.receiptTemplate === 'branded' ? ' · مميز' : ' · كلاسيكي'}
              {printSettings?.autoPrint === false ? ' · الطباعة التلقائية متوقفة' : ' · طباعة تلقائية'}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => void testPrint()} className="pos-chip h-10">طباعة تجريبية</button>
              <button onClick={() => void reprintLast()} className="pos-chip h-10">إعادة آخر فاتورة</button>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setOverlay('none')} className="pos-chip">إلغاء</button>
              <button
                onClick={() => {
                  void window.fotDesktop?.setPrintConfig?.({ printerName: printerName || null, askBeforePrint });
                  setOverlay('none');
                  showToast('حُفظت إعدادات الطابعة');
                  focusScan();
                }}
                className="h-9 rounded-lg bg-[#0f9f76] px-4 text-[13px] font-bold text-white"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'line-price' && selectedLine && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-[16px] font-bold">تعديل السعر</h2>
            <p className="mt-1 truncate text-[13px] text-slate-500">{selectedLine.name}</p>
            <p className="text-[12px] text-slate-400">السعر الأصلي: {formatIqd(selectedLine.originalPrice)}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-slate-600">السعر</span>
                <input
                  autoFocus
                  value={linePriceDraft}
                  onChange={e => onLinePriceDraftChange(e.target.value)}
                  onFocus={onInputFocusVisualRight}
                  onClick={onInputClickVisualRight}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitLinePrice(); } }}
                  className="pos-field num h-12 w-full text-center text-xl font-bold"
                  dir="ltr"
                  inputMode="decimal"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-slate-600">
                  خصم %
                  <span className="font-normal text-slate-400"> — يتعدّل السعر تلقائياً</span>
                </span>
                <input
                  value={lineDiscountDraft}
                  onChange={e => onLineDiscountDraftChange(e.target.value)}
                  onFocus={onInputFocusVisualRight}
                  onClick={onInputClickVisualRight}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitLinePrice(); } }}
                  className="pos-field num h-12 w-full text-center text-xl font-bold"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
            </div>
            {px.itemDiscountLimit > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                أدنى سعر مسموح: {formatIqd(Math.max(0, selectedLine.originalPrice - px.itemDiscountLimit))}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOverlay('none')} className="pos-chip">إلغاء</button>
              <button type="button" onClick={commitLinePrice} className="h-9 rounded-lg bg-[#0f9f76] px-4 text-[13px] font-bold text-white">حفظ</button>
            </div>
          </div>
        </div>
      )}

      {overlay === 'cash-report' && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">تقرير الصندوق — اليوم</h2>
              <button type="button" onClick={() => setOverlay('none')} className="text-[12px] text-slate-500">إغلاق</button>
            </div>
            {cashReportLoading && <p className="py-8 text-center text-slate-400">جاري التحميل…</p>}
            {cashReport && (
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between"><span className="text-slate-500">عدد الفواتير</span><span className="num font-bold">{formatNum(cashReport.receiptCount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">إجمالي المبيعات</span><span className="num font-bold">{formatIqd(cashReport.totalSales)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">المدفوع</span><span className="num">{formatIqd(cashReport.totalPayment)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">الباقي</span><span className="num">{formatIqd(cashReport.totalCashBack)}</span></div>
                <div className="flex justify-between border-t border-slate-100 pt-2"><span className="text-slate-500">متوسط الفاتورة</span><span className="num font-bold">{formatIqd(cashReport.averageTicket)}</span></div>
              </div>
            )}
          </div>
        </div>
      )}

      {overlay === 'receipts' && px.viewReceipts && (
        <div className="pos-overlay" onClick={() => setOverlay('none')}>
          <div className="pos-dialog max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">فواتير اليوم</h2>
              <button onClick={() => setOverlay('none')} className="text-[12px] text-slate-500">إغلاق</button>
            </div>
            {!online && todayReceipts.length > 0 && (
              <p className="mb-2 text-[11px] text-amber-600">بدون اتصال — عرض من السجل المحلي</p>
            )}
            {todayReceipts.length === 0 && <p className="py-8 text-center text-slate-400">لا توجد فواتير اليوم</p>}
            <div className="max-h-80 space-y-1.5 overflow-auto">
              {todayReceipts.map(r => (
                <div key={`${r.local ? 'L' : 'S'}-${r.number}`} className={`flex items-center justify-between rounded-lg px-3 py-2 ${r.local ? 'bg-amber-50' : 'bg-slate-50'}`}>
                  <div>
                    <div className="text-[13px] font-semibold">
                      #{r.number} — {r.itemCount} بند
                      {r.local && <span className="mr-1.5 rounded bg-amber-200 px-1 text-[10px] font-bold text-amber-900">محلية</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {kindLabel((r.kind ?? 0) as SaleKind)} · {r.salesmanName || '—'} · {new Date(r.creationDate).toLocaleTimeString('en-GB')}
                      {r.cardAmount ? ' · ماستر' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="num text-[13px] font-semibold">{formatIqd(r.totalAmount)}</div>
                    {!r.local && <button onClick={() => void reprintReceipt(r)} className="pos-chip">طباعة</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {overlay === 'queue' && (
        <QueueOverlay
          rows={queueRows}
          px={px}
          busy={queueBusy}
          onTransfer={ids => { void handleTransfer(ids); }}
          onEdit={row => {
            if (!px.allowEditReceipt) {
              showToast('لا صلاحية لتعديل الفاتورة');
              return;
            }
            setEditingRow(row);
            setOverlay('deferred-edit');
          }}
          onDelete={row => { void handleDeleteDeferred(row); }}
          onRetry={row => { void handleRetryDead(row); }}
          onFlush={async () => {
            const flushed = await flushOutbox();
            await refreshLocal();
            await loadQueue();
            showToast(flushed.uploaded > 0 ? `رُفعت ${flushed.uploaded}` : 'لا شيء للرفع');
          }}
          onClose={() => { setOverlay('none'); focusScan(); }}
          onReprint={row => { void reprintDeferredPayload(row.payload as EditorPayload, row.localNumber); }}
        />
      )}

      {overlay === 'deferred-edit' && editingRow && (
        <DeferredEditor
          localNumber={editingRow.localNumber}
          createdAt={editingRow.createdAt}
          payload={editingRow.payload as EditorPayload}
          px={px}
          online={canUseServer(online)}
          cashBoxes={cashBoxes}
          roundStep={roundStep}
          onSave={next => { void handleSaveDeferred(next); }}
          onReprint={next => { void reprintDeferredPayload(next, editingRow.localNumber); }}
          onTransfer={next => { void handleTransferFromEditor(next); }}
          onDelete={() => { void (async () => { await handleDeleteDeferred(editingRow); })(); }}
          onClose={() => { setEditingRow(null); setOverlay('queue'); }}
          busy={queueBusy}
        />
      )}

      {overlay === 'add-salesman' && pendingAdd && (
        <SalesmanPicker
          title="بائع هذا الصنف"
          subtitle={
            pendingAdd.product.name
              ? `${addSalesmanReason ?? 'عمولة أو هدف'} · ${pendingAdd.product.name}`
              : (addSalesmanReason ?? pendingAdd.product.name ?? undefined)
          }
          salesmen={pendingAllowed ?? salesmen}
          idHint="لهذا الصنف فقط — لا يغيّر بائع المجموعة — 0 بدون بائع"
          onPick={completePendingAdd}
          onClear={() => completePendingAdd({ id: 0, name: '' })}
          onClose={cancelPendingAdd}
        />
      )}

      {overlay === 'salesman' && (
        <SalesmanPicker
          title={singleSeller ? 'بائع الفاتورة' : 'تعيين بائع المجموعة'}
          subtitle={singleSeller ? 'يُطبَّق على كل بنود الفاتورة' : salesmanPickerSubtitle}
          salesmen={salesmen}
          onPick={pickSalesman}
          onClear={() => pickSalesman({ id: 0, name: '' })}
          onClose={() => {
            setOverlay('none');
            focusScan();
          }}
        />
      )}

      {overlay === 'line-salesman' && lineSellerLine && (
        <SalesmanPicker
          title="بائع البند"
          subtitle={lineSellerLine.name}
          salesmen={lineAllowed ?? salesmen}
          idHint="رقم البائع أو الاسم — Enter"
          onPick={s => {
            assignLineSalesman(lineSellerLine.key, s.id, s.name);
            closeLineSeller();
          }}
          onClear={() => {
            assignLineSalesman(lineSellerLine.key, 0, '');
            closeLineSeller();
          }}
          onClose={closeLineSeller}
        />
      )}
    </div>
  );
}
