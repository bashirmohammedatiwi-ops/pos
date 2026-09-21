import { Link } from 'react-router-dom';
import { formatCurrency } from '@/api/client';
import { weekdayShort } from './dashboardUtils';

export function DashboardWeekCompare({
  currentDays,
  prevDays,
  today,
  currentTotal,
  prevTotal,
}: {
  currentDays: { date: string; total: number }[];
  prevDays: { date: string; total: number }[];
  today: string;
  currentTotal: number;
  prevTotal: number;
}) {
  const max = Math.max(
    ...currentDays.map(d => d.total),
    ...prevDays.map(d => d.total),
    1,
  );

  return (
    <div className="rounded-lg border border-slate-200/90 bg-white p-2 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold text-header">مقارنة الأسابيع</p>
          <p className="text-[9px] text-slate-400">هذا الأسبوع vs السابق</p>
        </div>
        <Link to="/reports?tab=1" className="text-[9px] font-semibold text-brand-700 hover:underline">تفاصيل</Link>
      </div>

      <div className="mb-2 flex gap-3 text-[10px]">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="text-slate-600">الحالي</span>
          <span className="font-bold tabular-nums text-header">{formatCurrency(currentTotal)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="text-slate-600">السابق</span>
          <span className="font-bold tabular-nums text-slate-500">{formatCurrency(prevTotal)}</span>
        </div>
      </div>

      <div className="space-y-1">
        {currentDays.map((day, i) => {
          const prev = prevDays[i];
          const isToday = day.date.slice(0, 10) === today;
          const curPct = Math.max(2, Math.round((day.total / max) * 100));
          const prevPct = prev ? Math.max(2, Math.round((prev.total / max) * 100)) : 0;
          return (
            <div key={day.date} className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 ${isToday ? 'bg-brand-50' : ''}`}>
              <span className={`w-7 shrink-0 text-[9px] font-medium ${isToday ? 'text-brand-700' : 'text-slate-500'}`}>
                {weekdayShort(day.date)}
              </span>
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${isToday ? 'bg-brand-500' : 'bg-brand-300'}`} style={{ width: `${curPct}%` }} />
                </div>
                {prev && (
                  <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-300" style={{ width: `${prevPct}%` }} />
                  </div>
                )}
              </div>
              <span className={`w-16 shrink-0 text-left text-[10px] font-bold tabular-nums ${isToday ? 'text-brand-700' : 'text-header'}`}>
                {day.total > 0 ? formatCurrency(day.total) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
