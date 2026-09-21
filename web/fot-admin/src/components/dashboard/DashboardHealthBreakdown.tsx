import { formatNum } from '@/api/client';
import { healthLabel } from './dashboardUtils';

export function DashboardHealthBreakdown({
  score,
  items,
}: {
  score: number;
  items: { id: string; label: string; score: number; max: number; tone: string }[];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3">
        <p className="text-[12px] font-semibold text-header">صحة النظام</p>
        <p className="mt-0.5 text-[13px] text-slate-500">{healthLabel(score)} · {formatNum(score)}/100</p>
      </div>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id}>
            <div className="mb-0.5 flex justify-between text-[12px]">
              <span className="text-slate-600">{item.label}</span>
              <span className="tabular-nums text-slate-500">{formatNum(item.score)}/{formatNum(item.max)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${item.tone}`}
                style={{ width: `${Math.max(4, (item.score / item.max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
