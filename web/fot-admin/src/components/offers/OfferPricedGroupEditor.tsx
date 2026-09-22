import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDetailDto, ProductOfferLookupDto } from '@/api/types';
import { DISCOUNT_TYPE, OFFER_PRICE_STEP, offerPercent, offerSalePrice } from '@/lib/offers';
import { roundToStep } from '@fot/shared';
import { Btn, Input } from '@/components/ui';
import { IconPackage, IconPlus, IconSearch, IconX } from '@/components/icons';
import { OfferMembershipPills } from '@/components/offers/OfferMembershipPills';

export type PricedLine = {
  seq: number;
  name: string;
  barcode?: string;
  originalPrice: number;
  discount: number;
  discountType: number;
};

export interface PricedGroupOps {
  addProducts: PricedLine[];
  removeRowIds: number[];
  detailPricings: { detailId: number; discount: number; discountType: number }[];
}

export function emptyPricedGroupOps(): PricedGroupOps {
  return { addProducts: [], removeRowIds: [], detailPricings: [] };
}

export function pricedGroupOpsCount(ops: PricedGroupOps) {
  return ops.addProducts.length + ops.removeRowIds.length + ops.detailPricings.length;
}

type Mode = 'percent' | 'price';

function modeOf(discountType: number): Mode {
  return discountType === DISCOUNT_TYPE.percent ? 'percent' : 'price';
}

function valueOf(original: number, discount: number, discountType: number) {
  return modeOf(discountType) === 'percent'
    ? String(discount)
    : String(offerSalePrice(original, discount, discountType));
}

function toDiscount(_original: number, mode: Mode, raw: string) {
  const n = Number(raw);
  if (mode === 'percent') {
    const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    return { discount: pct, discountType: DISCOUNT_TYPE.percent };
  }
  const sale = Number.isFinite(n) ? roundToStep(Math.max(0, n)) : 0;
  return { discount: sale, discountType: DISCOUNT_TYPE.salePrice };
}

function ProductPriceFields({
  original,
  mode,
  value,
  onChange,
}: {
  original: number;
  mode: Mode;
  value: string;
  onChange: (mode: Mode, value: string) => void;
}) {
  const n = Number(value);
  const preview = Number.isFinite(n)
    ? mode === 'percent'
      ? offerSalePrice(original, n, DISCOUNT_TYPE.percent)
      : offerPercent(original, n, DISCOUNT_TYPE.salePrice)
    : null;

  function switchMode(next: Mode) {
    if (next === mode) return;
    const current = Number(value);
    if (!Number.isFinite(current)) {
      onChange(next, '');
      return;
    }
    if (next === 'price') onChange(next, String(offerSalePrice(original, current, DISCOUNT_TYPE.percent)));
    else onChange(next, String(offerPercent(original, current, DISCOUNT_TYPE.salePrice)));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
        <button
          type="button"
          onClick={() => switchMode('price')}
          className={`rounded px-2 py-0.5 text-[10px] font-bold ${mode === 'price' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          سعر
        </button>
        <button
          type="button"
          onClick={() => switchMode('percent')}
          className={`rounded px-2 py-0.5 text-[10px] font-bold ${mode === 'percent' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          نسبة
        </button>
      </div>
      <Input
        type="number"
        min={0}
        max={mode === 'percent' ? 100 : undefined}
        value={value}
        onChange={e => onChange(mode, e.target.value)}
        onBlur={() => {
          if (mode !== 'price') return;
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          const snapped = String(roundToStep(Math.max(0, n)));
          if (snapped !== value) onChange(mode, snapped);
        }}
        placeholder={mode === 'price' ? String(original || '') : '%'}
        className="!w-[88px] !py-1 text-center font-bold"
      />
      {preview != null && (
        <span className="text-[10px] text-slate-400">
          {mode === 'percent' ? `${formatNum(preview)} · أقرب ${OFFER_PRICE_STEP}` : `${preview}%`}
        </span>
      )}
    </div>
  );
}

export function OfferPricedGroupEditor({
  offerId,
  standalone,
  onOpsChange,
}: {
  offerId?: number;
  standalone: OfferDetailDto[];
  onOpsChange: (ops: PricedGroupOps) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [addProducts, setAddProducts] = useState<Map<number, PricedLine>>(new Map());
  const [removeRowIds, setRemoveRowIds] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Map<number, { mode: Mode; value: string }>>(new Map());
  const [drafts, setDrafts] = useState<Map<number, { mode: Mode; value: string }>>(new Map());

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 280);
    return () => window.clearTimeout(t);
  }, [search]);

  const searchQ = useQuery({
    queryKey: ['priced-offer-lookup', debounced],
    queryFn: () => api.lookupProductOffers(debounced, 40),
    enabled: debounced.length >= 2,
  });

  const keepStandalone = useMemo(
    () => standalone.filter(d => d.itemId != null && !removeRowIds.has(d.id)),
    [standalone, removeRowIds],
  );

  const inGroupSeqs = useMemo(() => {
    const set = new Set<number>();
    for (const d of keepStandalone) {
      if (d.itemId != null) set.add(d.itemId);
    }
    for (const p of addProducts.values()) set.add(p.seq);
    return set;
  }, [keepStandalone, addProducts]);

  useEffect(() => {
    const detailPricings: PricedGroupOps['detailPricings'] = [];
    for (const d of standalone) {
      if (d.itemId == null || removeRowIds.has(d.id)) continue;
      const edit = edits.get(d.id);
      if (!edit) continue;
      const next = toDiscount(d.price ?? 0, edit.mode, edit.value);
      if (next.discount === d.discount && next.discountType === d.discountType) continue;
      detailPricings.push({ detailId: d.id, ...next });
    }
    onOpsChange({
      addProducts: [...addProducts.values()],
      removeRowIds: [...removeRowIds],
      detailPricings,
    });
  }, [addProducts, removeRowIds, edits, standalone, onOpsChange]);

  function existingFields(d: OfferDetailDto) {
    const edit = edits.get(d.id);
    if (edit) return edit;
    return {
      mode: modeOf(d.discountType),
      value: valueOf(d.price ?? 0, d.discount, d.discountType),
    };
  }

  function setExisting(d: OfferDetailDto, mode: Mode, value: string) {
    setEdits(m => new Map(m).set(d.id, { mode, value }));
  }

  function addFromSearch(p: ProductOfferLookupDto) {
    const seq = p.seq;
    if (inGroupSeqs.has(seq)) return;
    const draft = drafts.get(seq) ?? { mode: 'price' as Mode, value: '' };
    const raw = draft.value.trim() || String(p.originalPrice || 0);
    const next = toDiscount(p.originalPrice, draft.mode, raw);
    setAddProducts(m => new Map(m).set(seq, {
      seq,
      name: p.name || p.barcode || `#${seq}`,
      barcode: p.barcode,
      originalPrice: p.originalPrice,
      ...next,
    }));
    setDrafts(m => {
      const n = new Map(m);
      n.delete(seq);
      return n;
    });
  }

  function updateStaged(seq: number, mode: Mode, value: string, original: number) {
    const next = toDiscount(original, mode, value);
    setAddProducts(m => {
      const cur = m.get(seq);
      if (!cur) return m;
      const n = new Map(m);
      n.set(seq, { ...cur, ...next });
      return n;
    });
  }

  const results = searchQ.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="shrink-0 space-y-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400">
            <IconSearch size={14} />
          </span>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن منتج بالاسم أو الباركود — يظهر السعر لتكتب سعره الجديد أو النسبة"
            className="!py-1.5 pe-2 ps-8 text-[12px]"
          />
        </div>
        <p className="text-[10.5px] text-slate-500">
          كل منتج في هذه المجموعة له سعر أو نسبة مستقلة — لا توجد نسبة موحّدة للمجموعة.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col border-e border-slate-100">
          <div className="shrink-0 border-b border-slate-100 bg-emerald-50/50 px-3 py-1.5">
            <h3 className="text-[12px] font-bold text-emerald-800">نتائج البحث</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {debounced.length < 2 && (
              <p className="p-8 text-center text-[12px] text-slate-400">اكتب حرفين على الأقل للبحث عن المنتج</p>
            )}
            {searchQ.isFetching && <p className="p-3 text-center text-[11px] text-slate-400">جاري البحث…</p>}
            {debounced.length >= 2 && !searchQ.isFetching && results.length === 0 && (
              <p className="p-8 text-center text-[12px] text-slate-400">لا نتائج</p>
            )}
            {results.map(p => {
              const inGroup = inGroupSeqs.has(p.seq);
              const draft = drafts.get(p.seq) ?? { mode: 'price' as Mode, value: '' };
              return (
                <div key={p.seq} className={`border-b border-slate-50 px-2.5 py-2 ${inGroup ? 'bg-brand-50/40' : 'hover:bg-slate-50'}`}>
                  <div className="flex items-start gap-2">
                    <IconPackage size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-header">{p.name || p.barcode}</p>
                      <p className="text-[10.5px] text-slate-500">
                        {p.barcode ? `${p.barcode} · ` : ''}سعر {formatNum(p.originalPrice)}
                      </p>
                      <OfferMembershipPills offers={p.offers} currentOfferId={offerId} mode="others" />
                    </div>
                    {inGroup ? (
                      <span className="text-[10px] font-bold text-brand-700">مضاف</span>
                    ) : (
                      <Btn size="sm" onClick={() => addFromSearch(p)}>
                        <IconPlus size={12} /> إضافة
                      </Btn>
                    )}
                  </div>
                  {!inGroup && (
                    <div className="mt-1.5 ps-6">
                      <ProductPriceFields
                        original={p.originalPrice}
                        mode={draft.mode}
                        value={draft.value}
                        onChange={(mode, value) => setDrafts(m => new Map(m).set(p.seq, { mode, value }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-brand-50/20">
          <div className="shrink-0 border-b border-slate-100 bg-brand-50/60 px-3 py-1.5">
            <h3 className="text-[12px] font-bold text-brand-800">
              منتجات المجموعة ({formatNum(keepStandalone.length + addProducts.size)})
            </h3>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {keepStandalone.map(d => {
              const fields = existingFields(d);
              return (
                <article key={d.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <IconPackage size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-header">{d.itemName}</p>
                      <p className="text-[10.5px] text-slate-500">
                        {d.barcode ? `${d.barcode} · ` : ''}سعر {formatNum(d.price ?? 0)}
                      </p>
                    </div>
                    <Btn size="sm" variant="ghost" className="!text-red-500" onClick={() => setRemoveRowIds(s => new Set(s).add(d.id))}>
                      <IconX size={12} /> إزالة
                    </Btn>
                  </div>
                  <div className="mt-1.5">
                    <ProductPriceFields
                      original={d.price ?? 0}
                      mode={fields.mode}
                      value={fields.value}
                      onChange={(mode, value) => setExisting(d, mode, value)}
                    />
                  </div>
                </article>
              );
            })}

            {[...addProducts.values()].map(p => (
              <article key={`new-${p.seq}`} className="rounded-lg border border-amber-300 bg-amber-50/80 px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-amber-900">{p.name}</p>
                    <p className="text-[10.5px] text-amber-700">
                      {p.barcode ? `${p.barcode} · ` : ''}سعر {formatNum(p.originalPrice)} · سيُضاف
                    </p>
                  </div>
                  <Btn size="sm" variant="ghost" onClick={() => setAddProducts(m => { const n = new Map(m); n.delete(p.seq); return n; })}>
                    <IconX size={12} />
                  </Btn>
                </div>
                <div className="mt-1.5">
                  <ProductPriceFields
                    original={p.originalPrice}
                    mode={modeOf(p.discountType)}
                    value={valueOf(p.originalPrice, p.discount, p.discountType)}
                    onChange={(mode, value) => updateStaged(p.seq, mode, value, p.originalPrice)}
                  />
                </div>
              </article>
            ))}

            {keepStandalone.length === 0 && addProducts.size === 0 && (
              <p className="py-10 text-center text-[12px] text-slate-400">لا منتجات — ابحث عن صنف واكتب سعره أو نسبته ثم أضفه</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
