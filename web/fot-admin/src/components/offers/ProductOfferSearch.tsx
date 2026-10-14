import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import { Badge, Input, Skeleton } from '@/components/ui';
import { IconAlert, IconBarcode, IconPackage, IconSearch, IconX } from '@/components/icons';
import { OfferMembershipPills } from '@/components/offers/OfferMembershipPills';

/** بحث سريع: هل المنتج داخل أي عرض؟ — يُستخدم في الرئيسية. */
export function ProductOfferSearch() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const lookupQ = useQuery({
    queryKey: ['offer-lookup', term],
    queryFn: () => api.lookupProductOffers(term, 20),
    enabled: term.length >= 2,
  });

  const items = lookupQ.data ?? [];
  const searching = term.length >= 2;

  return (
    <section className="card flex h-full min-w-0 flex-col p-4" dir="rtl">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-header">المنتج في العروض</h2>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            ابحث بالاسم أو امسح الباركود لمعرفة العروض التي تشمل المنتج وسعره بعد الخصم.
          </p>
        </div>
        <Link to="/offers" className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-brand-700 transition hover:bg-brand-50">
          كل العروض ←
        </Link>
      </header>

      <div className="relative mt-3">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
          <IconSearch size={15} />
        </span>
        <Input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && q) {
              e.stopPropagation();
              setQ('');
            }
          }}
          placeholder="اسم المنتج أو الباركود…"
          className="!ps-9 !pe-9"
          aria-label="بحث عن منتج في العروض"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); inputRef.current?.focus(); }}
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="مسح"
          >
            <IconX size={14} />
          </button>
        )}
      </div>

      {!searching && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] text-slate-500">
          <IconBarcode size={16} className="shrink-0 text-slate-400" />
          اكتب حرفين على الأقل — تظهر النتائج تلقائياً.
        </div>
      )}

      {searching && (
        <div className="mt-3 max-h-[360px] min-h-0 flex-1 space-y-2 overflow-y-auto">
          {lookupQ.isFetching && items.length === 0 && (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          )}
          {lookupQ.isError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
              <IconAlert size={15} className="shrink-0" />
              تعذّر البحث —
              <button type="button" onClick={() => void lookupQ.refetch()} className="font-semibold underline">إعادة المحاولة</button>
            </div>
          )}
          {!lookupQ.isFetching && !lookupQ.isError && items.length === 0 && (
            <p className="py-6 text-center text-[12px] text-slate-400">لا منتج بهذا الاسم أو الباركود</p>
          )}
          {items.map(p => {
            const discounted = p.price < p.originalPrice;
            return (
              <article key={p.seq} className="rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-slate-300">
                <div className="flex items-start gap-2.5">
                  <span className="icon-tile mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-slate-100 text-slate-500">
                    <IconPackage size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-header" title={p.name || p.barcode}>{p.name || p.barcode}</p>
                    {p.barcode && <p className="num text-[11px] text-slate-400" dir="ltr">{p.barcode}</p>}
                  </div>
                  <div className="shrink-0 text-left">
                    <p className={`num text-[13px] font-bold ${discounted ? 'text-emerald-700' : 'text-header'}`}>
                      {formatNum(discounted ? p.price : p.originalPrice)} <span className="text-[10.5px] font-medium text-slate-400">IQD</span>
                    </p>
                    {discounted && (
                      <p className="num text-[11px] text-slate-400">
                        <span className="line-through">{formatNum(p.originalPrice)}</span>
                        {p.discountPercent > 0 && <Badge tone="ok" className="ms-1 !px-1.5 !py-0">-{formatNum(p.discountPercent)}%</Badge>}
                      </p>
                    )}
                  </div>
                </div>
                {p.offers.length === 0 ? (
                  <p className="mt-1.5 text-[11.5px] text-slate-400">لا يدخل في أي عرض</p>
                ) : (
                  <OfferMembershipPills offers={p.offers} mode="all" />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
