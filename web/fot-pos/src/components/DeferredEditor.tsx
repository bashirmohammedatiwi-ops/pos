import { useEffect, useMemo, useRef, useState } from 'react';
import { totalRoundingDiscount } from '@fot/shared';
import { capUserDiscount } from '@/lib/sale';
import { db } from '@/lib/db';
import { findProductSmart, searchProductsSmart } from '@/lib/catalogSync';
import type { ProductDto, SalesmanDto, SectionCashBoxDto } from '@/api/types';
import { formatIqd, formatNum } from '@/lib/money';
import type { ResolvedCashierPermissions } from '@/lib/permissions';
import { CashBoxPicker } from '@/components/CashBoxPicker';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SalesmanPicker } from '@/components/SalesmanPicker';
import { playErrorBeep } from '@/lib/sound';
import type { ReceiptEditHistory } from '@/lib/receiptHistory';

type EditorItem = {
  articleId: number;
  name?: string;
  barcode?: string | null;
  quantity: number;
  price: number;
  originalPrice: number;
  discount: number;
  salesmanId?: number;
  salesmanName?: string | null;
  groupKey?: number | null;
  groupLabel?: string | null;
};

export type EditorPayload = {
  cashierId: number;
  salesmanId: number;
  salesmanName?: string;
  posId: number | null;
  payment: number;
  kind: number;
  isPending: boolean;
  userDiscount: number;
  accountId?: number;
  masterAccount: number;
  clientReceiptId: string;
  card?: unknown;
  number?: number;
  soldAt?: string;
  editHistory?: ReceiptEditHistory;
  items: EditorItem[];
};

function kindLabel(kind: number) {
  if (kind === 1) return 'مرتجع';
  if (kind === 2) return 'هدية';
  return 'بيع';
}

/**
 * Full invoice editor for locally deferred invoices — everything the new-sale screen
 * offers: add products by barcode/search, edit qty/price/discounts per line, delete
 * lines, invoice discount, then save or discard the whole invoice. Every control is
 * gated by the cashier's permissions exactly like the live cart.
 */
export function DeferredEditor({
  localNumber,
  createdAt,
  payload,
  px,
  online,
  cashBoxes,
  salesmen,
  roundStep,
  onSave,
  onReprint,
  onTransfer,
  onDelete,
  onClose,
  busy = false,
}: {
  localNumber: number;
  createdAt: string;
  payload: EditorPayload;
  px: ResolvedCashierPermissions;
  online: boolean;
  cashBoxes: SectionCashBoxDto[];
  salesmen: SalesmanDto[];
  roundStep: number;
  onSave: (payload: EditorPayload) => void;
  onReprint: (payload: EditorPayload) => void;
  onTransfer: (payload: EditorPayload) => void;
  onDelete: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [items, setItems] = useState<EditorItem[]>(() => payload.items.map(i => ({ ...i })));
  const [masterAccount, setMasterAccount] = useState(payload.masterAccount);
  const [userDiscount, setUserDiscount] = useState(payload.userDiscount ?? 0);
  const [discountInput, setDiscountInput] = useState(payload.userDiscount ? String(payload.userDiscount) : '');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ProductDto[]>([]);
  const [products, setProducts] = useState<Map<number, ProductDto>>(() => new Map());
  const [pctDrafts, setPctDrafts] = useState<Record<number, string>>({});
  const [addBusy, setAddBusy] = useState(false);
  const [confirm, setConfirm] = useState<'none' | 'delete' | 'transfer'>('none');
  const [lineAsk, setLineAsk] = useState<{ idx: number; name: string } | null>(null);
  const [missCode, setMissCode] = useState<string | null>(null);
  const [salesmanId, setSalesmanId] = useState(payload.salesmanId ?? 0);
  const [salesmanName, setSalesmanName] = useState(
    payload.salesmanName || salesmen.find(s => s.id === payload.salesmanId)?.name || '',
  );
  const [pickFor, setPickFor] = useState<'invoice' | number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function sellerLabel(id?: number, name?: string | null) {
    if (name && name.trim()) return name;
    if (id && id > 0) return salesmen.find(s => s.id === id)?.name || `#${id}`;
    return 'بدون';
  }

  function applyInvoiceSalesman(nextId: number, nextName: string) {
    setSalesmanId(nextId);
    setSalesmanName(nextName);
    setItems(prev => prev.map(i => ({ ...i, salesmanId: nextId, salesmanName: nextName || null })));
  }

  function applyLineSalesman(idx: number, nextId: number, nextName: string) {
    setItems(prev => {
      const next = prev.map((it, i) => (i === idx ? { ...it, salesmanId: nextId, salesmanName: nextName || null } : it));
      const ids = Array.from(new Set(next.map(i => i.salesmanId ?? 0).filter(id => id > 0)));
      if (ids.length === 1) {
        setSalesmanId(ids[0]!);
        setSalesmanName(next.find(i => (i.salesmanId ?? 0) === ids[0])?.salesmanName || nextName);
      } else if (ids.length === 0) {
        setSalesmanId(0);
        setSalesmanName('');
      }
      return next;
    });
  }

  // Resolve display names/stock for every line from the local catalog.
  useEffect(() => {
    const ids = Array.from(new Set(items.map(i => i.articleId).filter(id => id > 0)));
    if (ids.length === 0) {
      setProducts(new Map());
      return;
    }
    let cancelled = false;
    void db.productsByIds(ids.slice(0, 800)).then(list => {
      if (cancelled) return;
      const map = new Map<number, ProductDto>();
      for (const p of list ?? []) map.set(p.id, p);
      setProducts(map);
    }).catch(() => { /* names resolve to fallbacks */ });
    return () => { cancelled = true; };
  }, [items.map(i => i.articleId).join(',')]);

  // Live search over the local catalog (works offline).
  useEffect(() => {
    const term = search.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchProductsSmart(term, online).then(list => {
        if (!cancelled) setResults((list ?? []).slice(0, 8));
      }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [search, online]);

  const subtotal = useMemo(() => {
    const raw = items.reduce((s, i) => s + i.quantity * i.price, 0);
    return payload.kind === 1 ? Math.abs(raw) : raw;
  }, [items, payload.kind]);
  // Editing the lines can pull the total off a cash step, so rounding is
  // recalculated here. The stored discount already carries the previous
  // rounding, which makes a reopen without edits a no-op.
  const rawTotal = Math.max(0, subtotal - userDiscount);
  const rounding = totalRoundingDiscount(rawTotal, roundStep);
  const total = Math.max(0, rawTotal - rounding);

  function minUnitPrice(item: EditorItem) {
    return px.itemDiscountLimit > 0
      ? Math.max(0, item.originalPrice - px.itemDiscountLimit)
      : 0;
  }

  function updateItem(idx: number, patch: Partial<EditorItem>) {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function setItemPrice(idx: number, nextPrice: number) {
    const item = items[idx];
    if (!item) return;
    updateItem(idx, { price: Math.max(minUnitPrice(item), Math.max(0, nextPrice)) });
  }

  function removeItem(idx: number) {
    if (!px.deleteItem) return;
    const item = items[idx];
    const name = products.get(item?.articleId ?? 0)?.name || item?.barcode || 'البند';
    setLineAsk({ idx, name });
  }

  function confirmRemoveItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
    setLineAsk(null);
  }

  function addItem(p: ProductDto) {
    setItems(prev => {
      const existing = prev.find(i => i.articleId === p.id);
      if (existing) {
        return prev.map(i => (i.articleId === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, {
        articleId: p.id,
        barcode: p.barcode ?? null,
        quantity: 1,
        price: Number(p.price),
        originalPrice: Number(p.originalPrice || p.price),
        discount: 0,
        salesmanId: salesmanId || 0,
        salesmanName: salesmanName || null,
        name: p.name || undefined,
      }];
    });
    setSearch('');
    setResults([]);
  }

  async function addByInput() {
    const term = search.trim();
    if (!term) return;
    setAddBusy(true);
    try {
      const p = await findProductSmart(term, online);
      if (p) addItem(p);
      else {
        playErrorBeep();
        setMissCode(term);
      }
    } finally {
      setAddBusy(false);
    }
  }

  function applyInvoiceDiscount(value: number) {
    if (!px.makeDiscount) return;
    setUserDiscount(capUserDiscount(value, px.userDiscountLimit, subtotal));
  }

  function currentPayload(): EditorPayload {
    return {
      ...payload,
      salesmanId,
      salesmanName: salesmanName || undefined,
      masterAccount,
      userDiscount: userDiscount + rounding,
      items: items.map(i => ({
        ...i,
        name: i.name || products.get(i.articleId)?.name || undefined,
        salesmanId: i.salesmanId ?? salesmanId,
        salesmanName: i.salesmanName
          || salesmanName
          || salesmen.find(s => s.id === (i.salesmanId ?? salesmanId))?.name
          || null,
        discount: Math.max(0, i.originalPrice - i.price),
      })),
    };
  }

  function save() {
    if (items.length === 0) return;
    onSave(currentPayload());
  }

  return (
    <div className="pos-overlay" onClick={onClose}>
      <div className="pos-dialog pos-dialog-wide p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold">تعديل فاتورة مؤجلة #{formatNum(localNumber)}</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {kindLabel(payload.kind)} · {new Date(createdAt).toLocaleString('en-GB')} — تبقى محلية حتى الترحيل
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPickFor('invoice')}
              className="pos-chip h-9 px-3"
              title="تغيير بائع الفاتورة"
            >
              البائع: {sellerLabel(salesmanId, salesmanName)}
            </button>
            <div className="pos-pay-cashbox">
              <span className="pos-pay-cashbox-label">صندوق</span>
              <CashBoxPicker boxes={cashBoxes} value={masterAccount} onChange={setMasterAccount} />
            </div>
            <button type="button" onClick={onClose} className="text-[12px] text-slate-500">إغلاق</button>
          </div>
        </div>

        {/* إضافة منتجات — باركود أو بحث */}
        <div className="pos-deferred-add">
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (results.length === 1) addItem(results[0]);
                else void addByInput();
              }
              if (e.key === 'Escape') {
                setSearch('');
                setResults([]);
              }
            }}
            placeholder="امسح الباركود أو ابحث باسم المنتج لإضافته…"
            className="pos-field h-10 w-full"
            dir="rtl"
          />
          <button type="button" disabled={addBusy || !search.trim()} onClick={() => void addByInput()} className="pos-add h-10 shrink-0">
            إضافة
          </button>
          {results.length > 0 && (
            <div className="pos-deferred-results">
              {results.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addItem(p)}
                  className="pos-deferred-result"
                >
                  <span className="num text-[11px] text-slate-500" dir="ltr">{p.barcode || p.num || '—'}</span>
                  <span className="truncate font-semibold">{p.name || '—'}</span>
                  <span className="num text-[12px] font-bold text-teal-700">{formatIqd(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* بنود الفاتورة */}
        <div className="pos-cart-sheet max-h-[58vh] overflow-hidden rounded-xl border border-slate-200">
          <div className="pos-cart-sheet-scroll">
          <table className="pos-cart-table pos-cart-excel">
            <thead>
              <tr>
                <th className="pos-td-idx">#</th>
                <th className="pos-td-code">الباركود</th>
                <th className="pos-td-name">المنتج</th>
                <th className="pos-td-price">السعر</th>
                <th className="pos-td-disc">خصم%</th>
                <th className="pos-td-qty">الكمية</th>
                <th className="pos-td-seller">البائع</th>
                <th className="pos-td-total">الإجمالي</th>
                {px.deleteItem && <th className="pos-td-del" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const product = products.get(item.articleId);
                const stock = product ? Number(product.stock) : null;
                const discPct = item.originalPrice > item.price && item.originalPrice > 0
                  ? Math.round((1 - item.price / item.originalPrice) * 100)
                  : 0;
                return (
                  <tr key={`${item.articleId}-${idx}`} className={idx % 2 ? 'is-alt' : ''}>
                    <td className="pos-td-idx">{idx + 1}</td>
                    <td className="pos-td-code">
                      <span className="pos-cart-barcode num" dir="ltr">{item.barcode || product?.barcode || product?.num || '—'}</span>
                    </td>
                    <td className="pos-td-name">
                      <span className="pos-cart-name">{product?.name || item.barcode || `#${item.articleId}`}</span>
                    </td>
                    <td className="pos-td-price">
                      {px.allowPriceChange ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={String(item.price)}
                          onChange={e => setItemPrice(idx, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                          className="pos-field num h-8 w-20 text-center"
                        />
                      ) : (
                        <span className="num font-bold">{formatIqd(item.price)}</span>
                      )}
                      {item.originalPrice > item.price && (
                        <div className="pos-cart-old-price num">{formatIqd(item.originalPrice)}</div>
                      )}
                    </td>
                    <td className="pos-td-disc">
                      <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={pctDrafts[idx] ?? (discPct > 0 ? String(discPct) : '')}
                        onChange={e => {
                          const clean = e.target.value.replace(/[^\d.]/g, '');
                          setPctDrafts(p => ({ ...p, [idx]: clean }));
                          const pct = Math.min(100, Math.max(0, Number(clean) || 0));
                          const min = minUnitPrice(item);
                          const price = Math.max(min, Math.round(item.originalPrice * (1 - pct / 100)));
                          setItemPrice(idx, price);
                        }}
                        className="pos-field num h-8 w-16 text-center"
                        placeholder="0"
                        title="خصم % — يتعدّل السعر تلقائياً"
                      />
                    </td>
                    <td className="pos-td-qty">
                      <div className="pos-sheet-qty">
                        <button type="button" onClick={() => updateItem(idx, { quantity: Math.max(0, item.quantity - 1) })}>−</button>
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={String(item.quantity)}
                          onChange={e => updateItem(idx, { quantity: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0) })}
                          className="num"
                        />
                        <button type="button" onClick={() => updateItem(idx, { quantity: item.quantity + 1 })}>+</button>
                      </div>
                      {stock != null && (
                        <div className={`text-[10px] ${stock <= 0 ? 'pos-prod-zero' : 'text-slate-400'}`}>
                          مخزون: {formatNum(stock)}
                        </div>
                      )}
                    </td>
                    <td className="pos-td-seller">
                      <button
                        type="button"
                        onClick={() => setPickFor(idx)}
                        className="pos-chip px-2 py-1 text-[11px]"
                        title="تغيير بائع هذا البند"
                      >
                        {sellerLabel(item.salesmanId ?? salesmanId, item.salesmanName || salesmanName)}
                      </button>
                    </td>
                    <td className="pos-td-total num">{formatIqd(item.quantity * item.price)}</td>
                    {px.deleteItem && (
                      <td className="pos-td-del">
                        <button type="button" onClick={() => removeItem(idx)} className="pos-cart-del">×</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={px.deleteItem ? 9 : 8} className="py-6 text-center text-slate-400">لا توجد بنود — أضف منتجات من الأعلى</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* الخصم والإجماليات */}
        <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="flex justify-between"><span className="text-slate-500">المجموع</span><span className="num font-semibold">{formatIqd(subtotal)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-slate-500">الخصم</span><span className="num text-amber-600">{formatIqd(userDiscount)}</span></div>
            {rounding > 0 && (
              <div className="mt-1 flex justify-between">
                <span className="text-slate-500">تقريب {formatNum(roundStep)}</span>
                <span className="num text-amber-600">−{formatIqd(rounding)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
              <span className="font-semibold">الإجمالي</span>
              <span className="num text-[15px] font-bold text-teal-700">{formatIqd(total)}</span>
            </div>
            {items.reduce((s, i) => s + i.quantity * (i.originalPrice || i.price), 0) > subtotal + 0.005 && (
              <div className="mt-1 flex justify-between text-slate-400">
                <span>قبل العروض</span>
                <span className="num line-through">{formatIqd(items.reduce((s, i) => s + i.quantity * (i.originalPrice || i.price), 0))}</span>
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-slate-400">
              {formatNum(items.length)} بند · الدفع ونوع الفاتورة يبقيان كما حُفظا — الصندوق قابل للتغيير
            </p>
          </div>
          {px.makeDiscount && (
            <div>
              <span className="mb-1 block text-[12px] text-slate-500">
                خصم الفاتورة
                {px.userDiscountLimit > 0 && <span className="text-slate-400"> (حد {formatIqd(px.userDiscountLimit)})</span>}
              </span>
              <div className="flex gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={discountInput}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^\d.]/g, '');
                    setDiscountInput(raw);
                    const n = Number(raw) || 0;
                    applyInvoiceDiscount(discountMode === 'percent' ? subtotal * n / 100 : n);
                  }}
                  className="pos-field num h-9 min-w-0 flex-1"
                  placeholder={discountMode === 'percent' ? '%' : 'مبلغ'}
                />
                <button type="button" onClick={() => setDiscountMode('percent')} className={`pos-chip px-2 ${discountMode === 'percent' ? 'pos-chip-on' : ''}`}>%</button>
                <button type="button" onClick={() => setDiscountMode('amount')} className={`pos-chip px-2 ${discountMode === 'amount' ? 'pos-chip-on' : ''}`}>مبلغ</button>
              </div>
            </div>
          )}
        </div>

        {/* أزرار الحفظ والترحيل والحذف */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onReprint(currentPayload())}
            className="pos-chip h-11 px-4"
          >
            طباعة
          </button>
          {px.discardReceipt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm('delete')}
              className="h-11 rounded-lg bg-red-600 px-5 text-[13px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              حذف الفاتورة
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose} className="pos-chip h-11 px-4">إلغاء</button>
          <button
            type="button"
            disabled={busy || items.length === 0}
            onClick={() => setConfirm('transfer')}
            className="h-11 rounded-lg bg-teal-700 px-5 text-[13px] font-bold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            ترحيل
          </button>
          <button
            type="button"
            disabled={busy || items.length === 0}
            onClick={save}
            className="h-11 rounded-lg bg-[#0f9f76] px-6 text-[13px] font-bold text-white disabled:opacity-50"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>
      {confirm === 'transfer' && (
        <ConfirmDialog
          title="ترحيل الفاتورة؟"
          message={`هل تريد ترحيل الفاتورة #${formatNum(localNumber)} بمبلغ ${formatIqd(total)} إلى الإدارة؟`}
          busy={busy}
          onConfirm={() => { setConfirm('none'); onTransfer(currentPayload()); }}
          onCancel={() => setConfirm('none')}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="حذف الفاتورة؟"
          message={`هل تريد حذف الفاتورة #${formatNum(localNumber)}؟ لا يمكن التراجع بعد الحذف.`}
          danger
          busy={busy}
          onConfirm={() => { setConfirm('none'); onDelete(); }}
          onCancel={() => setConfirm('none')}
        />
      )}
      {lineAsk && (
        <ConfirmDialog
          title="حذف البند"
          message={`هل تريد حذف «${lineAsk.name}» من الفاتورة؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => confirmRemoveItem(lineAsk.idx)}
          onCancel={() => setLineAsk(null)}
        />
      )}
      {pickFor !== null && (
        <SalesmanPicker
          title={pickFor === 'invoice' ? 'بائع الفاتورة' : 'بائع هذا البند'}
          subtitle={pickFor === 'invoice' ? 'يُطبَّق على كل البنود' : undefined}
          salesmen={salesmen}
          onPick={s => {
            if (pickFor === 'invoice') applyInvoiceSalesman(s.id, s.name);
            else applyLineSalesman(pickFor, s.id, s.name);
            setPickFor(null);
          }}
          onClear={() => {
            if (pickFor === 'invoice') applyInvoiceSalesman(0, '');
            else applyLineSalesman(pickFor, 0, '');
            setPickFor(null);
          }}
          onClose={() => setPickFor(null)}
        />
      )}
      {missCode && (
        <ConfirmDialog
          alert
          title="المادة غير موجودة"
          message={`لا توجد مادة للباركود ${missCode}`}
          confirmLabel="حسناً"
          onConfirm={() => setMissCode(null)}
          onCancel={() => setMissCode(null)}
        />
      )}
    </div>
  );
}
