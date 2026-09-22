import { useCallback, useRef, useState, type TouchEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, moneyIq, todayKey, type WeekSummary } from './api';
import { PAY_CHIPS, SALES_CHIPS, addDays, type PeriodBounds, type PeriodKind } from './period';

const WEEK_KEY = 'fot_manager_week';

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

  const touchX = useRef(0);
  function onTouchStart(e: TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) < 48) return;
    if (dx > 0) pick(newer);
    else pick(older);
  }

  return (
    <div className="week-wrap sticky-week" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button type="button" className="week-arrow" disabled={!newer} onClick={() => pick(newer)} aria-label="الأحدث">‹</button>
      <div className="week-scroll">
        {weeks.map(w => {
          const wk = w.weekStart.slice(0, 10);
          const active = (!weekStart && w.isCurrent) || weekStart === wk || weekStart === w.weekStart;
          return (
            <button key={wk} type="button" onClick={() => setWeek(w.isCurrent ? undefined : wk)} className={`week-chip ${active ? 'on' : ''}`}>
              <div className="text-[13px] font-extrabold">{w.isCurrent ? 'هذا الأسبوع' : dayLabel(w.weekStart)}</div>
              <div className="num mt-1 text-[11px] opacity-80">
                {w.salesAmount > 0 ? moneyIq(w.salesAmount) : '—'}
              </div>
            </button>
          );
        })}
      </div>
      <button type="button" className="week-arrow" disabled={!older} onClick={() => pick(older)} aria-label="الأقدم">›</button>
    </div>
  );
}

export function PeriodBar({
  weeks,
  weekStart,
  setWeek,
  period,
  kind,
  setKind,
  customFrom,
  customTo,
  setCustom,
  chips = SALES_CHIPS,
  compact = false,
}: {
  weeks: WeekSummary[];
  weekStart?: string;
  setWeek: (w?: string) => void;
  period: PeriodBounds;
  kind: PeriodKind;
  setKind: (k: PeriodKind) => void;
  customFrom: string;
  customTo: string;
  setCustom: (from: string, to: string) => void;
  chips?: { id: PeriodKind; label: string }[];
  compact?: boolean;
}) {
  const [weeksOpen, setWeeksOpen] = useState(false);
  const current = weeks.find(w => w.isCurrent);
  const currentKey = current?.weekStart.slice(0, 10);
  const showWeeks = weeksOpen || kind === 'week';

  function pickKind(next: PeriodKind) {
    if (next === 'today' || next === 'yesterday' || next === 'wtd') {
      if (weekStart && currentKey && weekStart !== currentKey) setWeek(undefined);
    }
    setKind(next);
  }

  function stepDay(delta: number) {
    const next = addDays(period.from, delta);
    setCustom(next, next);
    setKind('custom');
  }

  return (
    <section className={`range-bar mobile-period ${compact ? 'compact' : ''}`}>
      <div className="range-chips">
        {chips.map(c => (
          <button key={c.id} type="button" className={kind === c.id ? 'on' : ''} onClick={() => pickKind(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="range-meta">
        <div className="range-step">
          <button type="button" className="week-arrow" onClick={() => stepDay(-1)} aria-label="اليوم السابق">‹</button>
          <div>
            <p className="kicker">{period.singleDay ? 'اليوم المعروض' : 'المدة المعروضة'}</p>
            <p className="font-extrabold">{period.label}</p>
          </div>
          <button
            type="button"
            className="week-arrow"
            disabled={period.to >= todayKey()}
            onClick={() => stepDay(1)}
            aria-label="اليوم التالي"
          >›</button>
        </div>
        {kind === 'custom' && (
          <div className="range-dates">
            <label>
              من
              <input type="date" value={customFrom} onChange={e => setCustom(e.target.value, customTo || e.target.value)} />
            </label>
            <label>
              إلى
              <input type="date" value={customTo} onChange={e => setCustom(customFrom || e.target.value, e.target.value)} />
            </label>
          </div>
        )}
        {!compact && weeks.length > 1 && (
          <button type="button" className="range-more" onClick={() => setWeeksOpen(v => !v)}>
            {showWeeks ? 'إخفاء الأسابيع' : 'أسابيع سابقة'}
          </button>
        )}
      </div>
      {!compact && showWeeks && <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />}
    </section>
  );
}

export function PayPeriodBar({
  period,
  kind,
  setKind,
  customFrom,
  customTo,
  setCustom,
}: {
  period: PeriodBounds;
  kind: PeriodKind;
  setKind: (k: PeriodKind) => void;
  customFrom: string;
  customTo: string;
  setCustom: (from: string, to: string) => void;
}) {
  return (
    <div className="pay-range">
      <div className="range-chips slim">
        {PAY_CHIPS.map(c => (
          <button key={c.id} type="button" className={kind === c.id ? 'on' : ''} onClick={() => setKind(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs font-extrabold text-muted">{period.label}</p>
      {kind === 'custom' && (
        <div className="range-dates mt-2">
          <label>
            من
            <input type="date" value={customFrom} onChange={e => setCustom(e.target.value, customTo || e.target.value)} />
          </label>
          <label>
            إلى
            <input type="date" value={customTo} onChange={e => setCustom(customFrom || e.target.value, e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
