import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { Input } from '@/components/ui';
import { IconSearch } from '@/components/icons';
import { CommissionGroupPills } from '@/components/commissions/CommissionGroupPills';

export function ProductCommissionSearch({
  onOpenGroup,
}: {
  onOpenGroup: (groupId: number) => void;
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" dir="rtl">
      <h2 className="text-[15px] font-bold text-header">بحث عن منتج في العمولات</h2>
      <p className="mt-0.5 text-[12px] text-slate-500">
        ابحث بالاسم أو الباركود لمعرفة إن كان المنتج داخل مجموعة عمولات، وأي مجموعة بالضبط.
      </p>
      <div className="relative mt-3">
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400">
          <IconSearch size={15} />
        </span>
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="اسم المنتج أو الباركود…"
          className="ps-8"
        />
      </div>

      {term.length >= 2 && (
        <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
          {lookupQ.isFetching && <p className="py-4 text-center text-[12px] text-slate-400">جاري البحث…</p>}
          {!lookupQ.isFetching && items.length === 0 && (
            <p className="py-4 text-center text-[12px] text-slate-400">لا منتج بهذا الاسم أو الباركود</p>
          )}
          {items.map(p => (
            <article key={p.seq} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-semibold text-header">{p.name || p.barcode}</p>
                <p className="text-[11px] text-slate-500">
                  {p.barcode ? `${p.barcode} · ` : ''}
                  {p.price > 0 ? formatNum(p.price) : ''}
                </p>
              </div>
              {p.groups.length === 0 ? (
                <p className="mt-1.5 text-[12px] text-slate-500">غير موجود في أي مجموعة عمولات</p>
              ) : (
                <CommissionGroupPills groups={p.groups} onOpenGroup={onOpenGroup} />
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
