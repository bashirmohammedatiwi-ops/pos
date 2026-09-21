import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { CommissionGroupPills } from '@/components/commissions/CommissionGroupPills';

export function CommissionOverlapsSection({
  onOpenGroup,
}: {
  onOpenGroup: (groupId: number) => void;
}) {
  const overlapsQ = useQuery({
    queryKey: ['commission-overlaps'],
    queryFn: api.commissionOverlaps,
  });

  const items = overlapsQ.data ?? [];
  if (overlapsQ.isLoading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" dir="rtl">
        <h2 className="text-[15px] font-bold text-header">منتجات مكررة في أكثر من مجموعة</h2>
        <p className="mt-2 text-[12px] text-slate-400">جاري الفحص…</p>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm" dir="rtl">
      <h2 className="text-[15px] font-bold text-header">منتجات مكررة في أكثر من مجموعة</h2>
      <p className="mt-0.5 text-[12px] text-slate-600">
        {formatNum(items.length)} صنف موجود في مجموعتين أو أكثر — افتح المجموعة لإزالة التكرار.
      </p>
      <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
        {items.map(p => (
          <article key={p.articleId} className="rounded-xl border border-amber-100 bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-[13px] font-semibold text-header">{p.name || p.barcode || `#${p.articleId}`}</p>
              <p className="text-[11px] text-slate-500">
                {p.barcode ? `${p.barcode} · ` : ''}
                {p.price > 0 ? formatNum(p.price) : ''}
                {` · ${formatNum(p.groups.length)} مجموعات`}
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
      </div>
    </section>
  );
}
