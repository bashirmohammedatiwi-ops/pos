import { Link } from 'react-router-dom';
import { formatCurrency, formatNum } from '@/api/client';
import { weekdayShort } from './dashboardUtils';

export function DashboardWeekChart({
  days,
  today,
  weekLabel,
}: {
  days: { date: string; total: number; receiptCount?: number }[];
  today: string;
  weekLabel?: string;
}) {
  const max = Math.max(...days.map(d => d.total), 1);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold text-header">أسبوع العمل</p>
          {weekLabel && <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{weekLabel}</p>}
        </div>
        <Link to="/reports?tab=1" className="shrink-0 text-[10px] font-semibold text-brand-700 hover:underline">
          التقرير
        </Link>
      </div>
      <div className="space-y-1">
        {days.map(d => {
          const day = d.date.slice(0, 10);
          const isToday = day === today;
          const pct = Math.max(2, Math.round((d.total / max) * 100));
          return (
            <Link
              key={day}
              to={`/receipts?from=${day}&to=${day}`}
              className={`group flex items-center gap-2 rounded-md px-1.5 py-1 transition ${isToday ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
            >
              <span className={`w-8 shrink-0 text-[10px] font-medium ${isToday ? 'text-brand-700' : 'text-slate-500'}`}>
                {weekdayShort(d.date)}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${isToday ? 'bg-brand-500' : 'bg-brand-300'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`w-20 shrink-0 text-left text-[11px] font-bold tabular-nums ${isToday ? 'text-brand-700' : 'text-header'}`}>
                {d.total > 0 ? formatCurrency(d.total) : '—'}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[10px] text-slate-400">
        {formatNum(days.reduce((n, d) => n + (d.receiptCount ?? 0), 0))} فاتورة هذا الأسبوع
      </p>
    </div>
  );
}
