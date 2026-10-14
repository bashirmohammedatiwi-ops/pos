import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { Alert, Btn, EmptyState, Input, Skeleton } from '@/components/ui';
import { IconCheckCircle, IconSearch } from '@/components/icons';
import { CommissionGroupPills } from '@/components/commissions/CommissionGroupPills';

/** منتجات داخلة في أكثر من مجموعة عمولات — قد تُحسب عمولتها مرتين أو بقيمة غير متوقعة. */
export function CommissionOverlapsSection({
  onOpenGroup,
  embedded,
}: {
  onOpenGroup: (groupId: number) => void;
  /** داخل لوحة أخرى — يعرض حالة «لا تكرار» بدل الإخفاء. */
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const overlapsQ = useQuery({
    queryKey: ['commission-overlaps'],
    queryFn: api.commissionOverlaps,
  });

  const items = overlapsQ.data ?? [];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(p =>
      (p.name ?? '').toLowerCase().includes(q)
      || (p.barcode ?? '').toLowerCase().includes(q)
      || p.groups.some(g => g.groupName.toLowerCase().includes(q)));
  }, [items, filter]);

  if (overlapsQ.isLoading) {
    const sk = (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
    return embedded ? sk : <section className="card p-4" dir="rtl">{sk}</section>;
  }

  if (overlapsQ.isError) {
    return (
      <Alert title="تعذر فحص التكرار">
        <Btn size="xs" variant="secondary" className="mt-1" onClick={() => overlapsQ.refetch()}>إعادة المحاولة</Btn>
      </Alert>
    );
  }

  if (items.length === 0) {
    if (!embedded) return null;
    return (
      <EmptyState
        compact
        icon={<IconCheckCircle size={18} />}
        title="لا تكرار"
        description="كل منتج موجود في مجموعة عمولات واحدة على الأكثر."
      />
    );
  }

  const list = (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[12px] text-slate-600">
          <span className="num font-bold text-amber-700">{formatNum(items.length)}</span> صنف موجود في مجموعتين أو أكثر — افتح المجموعة لإزالة التكرار.
        </p>
        {items.length > 6 && (
          <div className="relative w-56">
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400"><IconSearch size={14} /></span>
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="تصفية…" className="!h-8 ps-8" />
          </div>
        )}
      </div>
      <div className="max-h-[420px] space-y-2 overflow-y-auto">
        {shown.map(p => (
          <article key={p.articleId} className="rounded-lg border border-amber-100 bg-amber-50/30 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[13px] font-semibold text-header">{p.name || p.barcode || `#${p.articleId}`}</p>
              <p className="num text-[11.5px] text-slate-500">
                {p.barcode ? `${p.barcode} · ` : ''}
                {p.price > 0 ? `${formatNum(p.price)} IQD · ` : ''}
                {formatNum(p.groups.length)} مجموعات
              </p>
            </div>
            <CommissionGroupPills
              groups={p.groups.map(g => ({
                groupId: g.groupId,
                groupName: g.groupName,
                isActive: g.isActive,
                commissionType: g.commissionType,
                commissionValue: g.commissionValue,
                sourceTreeSeq: g.sourceTreeSeq,
                sourceTreeName: g.sourceTreeName,
                excluded: false,
              }))}
              onOpenGroup={onOpenGroup}
            />
          </article>
        ))}
        {shown.length === 0 && <EmptyState compact title="لا نتائج للتصفية" />}
      </div>
    </>
  );

  if (embedded) return <div dir="rtl">{list}</div>;

  return (
    <section className="card border-amber-200 p-4" dir="rtl">
      <h2 className="mb-1 text-[14px] font-bold text-header">منتجات مكررة في أكثر من مجموعة</h2>
      {list}
    </section>
  );
}
