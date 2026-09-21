import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, moneyK, type WeekSummary } from './api';

const WEEK_KEY = 'fot_seller_week';

export function useWeek() {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('week');
  const weekStart = fromUrl || sessionStorage.getItem(WEEK_KEY) || undefined;
  const setWeek = useCallback((w?: string) => {
    const next = new URLSearchParams(params);
    if (w) {
      next.set('week', w);
      sessionStorage.setItem(WEEK_KEY, w);
    } else {
      next.delete('week');
      sessionStorage.removeItem(WEEK_KEY);
    }
    setParams(next, { replace: true });
  }, [params, setParams]);
  return { weekStart, setWeek };
}

export function WeekBar({
  weeks, weekStart, setWeek,
}: {
  weeks: WeekSummary[];
  weekStart?: string;
  setWeek: (w?: string) => void;
}) {
  if (!weeks.length) return null;
  return (
    <div className="week-scroll">
      {weeks.map(w => {
        const key = w.weekStart.slice(0, 10);
        const active = (!weekStart && w.isCurrent) || weekStart === key || weekStart === w.weekStart;
        return (
          <button key={key} type="button" onClick={() => setWeek(w.isCurrent ? undefined : key)} className={`week-chip ${active ? 'on' : ''}`}>
            <div className="text-[13px] font-extrabold">{w.isCurrent ? 'هذا الأسبوع' : dayLabel(w.weekStart)}</div>
            <div className="num mt-1 text-[11px] opacity-70">
              {w.commissionAmount > 0 ? moneyK(w.commissionAmount) : '—'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
