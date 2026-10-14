import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { Alert, Badge, Btn, EmptyState, Input, Skeleton } from '@/components/ui';
import { IconSearch, IconX } from '@/components/icons';
import { CommissionGroupPills } from '@/components/commissions/CommissionGroupPills';

/** بحث سريع: هل المنتج داخل مجموعة عمولات؟ وأيّها؟ */
export function ProductCommissionSearch({
  onOpenGroup,
  embedded,
}: {
  onOpenGroup: (groupId: number) => void;
  /** داخل لوحة أخرى — بلا إطار أو عنوان خاص. */
  embedded?: boolean;
}) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 280);
    return () => window.clearTimeout(t);
  }, [q]);

  const lookupQ = useQuery({
    queryKey: ['commission-lookup', term],
    queryFn: () => api.lookupProductCommissions(term, 20),
    enabled: term.length >= 2,
  });

  const items = lookupQ.data ?? [];

  const body = (
    <>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
          <IconSearch size={15} />
        </span>
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && q) {
              e.stopPropagation();
              setQ('');
            }
            if (e.key === 'Enter') setTerm(q.trim());
          }}
          placeholder="اسم المنتج أو الباركود…"
          className="ps-9 pe-9"
          aria-label="بحث عن منتج في العمولات"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute inset-y-0 left-2 flex items-center px-1 text-slate-400 hover:text-slate-700"
            aria-label="مسح البحث"
          >
            <IconX size={14} />
          </button>
        )}
      </div>

      {term.length < 2 && (
        <p className="mt-2 text-[11.5px] text-slate-500">اكتب حرفين على الأقل — النتيجة تُظهر المجموعة وقيمة العمولة لكل منتج.</p>
      )}

      {term.length >= 2 && (
        <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
          {lookupQ.isFetching && !items.length && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          )}
          {lookupQ.isError && (
            <Alert title="تعذر البحث">
              <Btn size="xs" variant="secondary" className="mt-1" onClick={() => lookupQ.refetch()}>إعادة المحاولة</Btn>
            </Alert>
          )}
          {!lookupQ.isFetching && !lookupQ.isError && items.length === 0 && (
            <EmptyState compact title="لا منتج بهذا الاسم أو الباركود" icon={<IconSearch size={18} />} />
          )}
          {items.map(p => (
            <article key={p.seq} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-semibold text-header">{p.name || p.barcode}</p>
                <p className="num text-[11.5px] text-slate-500">
                  {p.barcode ? `${p.barcode}` : ''}
                  {p.price > 0 && <> · {formatNum(p.price)} <span className="text-slate-400">IQD</span></>}
                </p>
              </div>
              {p.groups.length === 0 ? (
                <div className="mt-1.5"><Badge>بلا عمولة</Badge></div>
              ) : (
                <CommissionGroupPills groups={p.groups} onOpenGroup={onOpenGroup} />
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );

  if (embedded) return <div dir="rtl">{body}</div>;

  return (
    <section className="card p-4" dir="rtl">
      <h2 className="text-[14px] font-bold text-header">بحث عن منتج في العمولات</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-slate-500">
        ابحث بالاسم أو الباركود لمعرفة إن كان المنتج داخل مجموعة عمولات، وأي مجموعة بالضبط.
      </p>
      {body}
    </section>
  );
}
