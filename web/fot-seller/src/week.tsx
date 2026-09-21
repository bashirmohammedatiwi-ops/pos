import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, moneyIq, type WeekSummary } from './api';

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
  const key = weekStart || weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
  const idx = Math.max(0, weeks.findIndex(w => w.weekStart.slice(0, 10) === key || w.weekStart === weekStart));
  const older = weeks[idx + 1];
  const newer = weeks[idx - 1];

  function pick(w?: WeekSummary) {
    if (!w) return;
    setWeek(w.isCurrent ? undefined : w.weekStart.slice(0, 10));
  }

  return (
    <div className="week-wrap">
      <button type="button" className="week-arrow" disabled={!newer} onClick={() => pick(newer)} aria-label="الأحدث">‹</button>
      <div className="week-scroll">
        {weeks.map(w => {
          const wk = w.weekStart.slice(0, 10);
          const active = (!weekStart && w.isCurrent) || weekStart === wk || weekStart === w.weekStart;
          return (
            <button key={wk} type="button" onClick={() => setWeek(w.isCurrent ? undefined : wk)} className={`week-chip ${active ? 'on' : ''}`}>
              <div className="text-[13px] font-extrabold">{w.isCurrent ? 'هذا الأسبوع' : dayLabel(w.weekStart)}</div>
              <div className="num mt-1 text-[11px] opacity-70">
                {w.commissionAmount > 0 ? moneyIq(w.commissionAmount) : '—'}
              </div>
            </button>
          );
        })}
      </div>
      <button type="button" className="week-arrow" disabled={!older} onClick={() => pick(older)} aria-label="الأقدم">›</button>
    </div>
  );
}
