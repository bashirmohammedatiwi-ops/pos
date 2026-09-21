import { Link } from 'react-router-dom';
import { formatCurrency, formatNum } from '@/api/client';
import { fixEdariName } from '@/lib/text';

export function DashboardTopProducts({
  products,
  today,
}: {
  products: { articleId: number; name?: string; soldAmount: number; soldQty: number }[];
  today: string;
}) {
  if (!products.length) return null;

  const max = Math.max(...products.map(p => p.soldAmount), 1);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold text-header">أكثر مبيعاً اليوم</p>
        <Link to={`/reports?from=${today}&to=${today}&tab=0`} className="text-[10px] font-semibold text-brand-700 hover:underline">
          الكل
        </Link>
      </div>
      <ul className="space-y-2">
        {products.slice(0, 5).map((p, i) => (
          <li key={p.articleId}>
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[9px] font-bold text-slate-500">
                  {i + 1}
                </span>
                <span className="truncate font-medium text-header">{fixEdariName(p.name) || `#${p.articleId}`}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums text-brand-700">{formatCurrency(p.soldAmount)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.max(6, (p.soldAmount / max) * 100)}%` }} />
            </div>
            <p className="mt-0.5 text-[9px] text-slate-400">{formatNum(p.soldQty)} قطعة</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
