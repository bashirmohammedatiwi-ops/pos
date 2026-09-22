import { useCallback, useRef, useState, type TouchEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, deltaPct, moneyIq, moneyK, todayKey, weekRange, type WeekSummary } from './api';
import { Delta } from './ui';
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

function weekIndex(weeks: WeekSummary[], weekStart?: string) {
  const key = weekStart || weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
  return Math.max(0, weeks.findIndex(w => w.weekStart.slice(0, 10) === key || w.weekStart === weekStart));
}

export function WeekStepper({
  weeks,
  weekStart,
  setWeek,
  kicker = 'الأسبوع',
  showSales = true,
  showDelta = true,
}: {
  weeks: WeekSummary[];
  weekStart?: string;
  setWeek: (w?: string) => void;
  kicker?: string;
  showSales?: boolean;
  showDelta?: boolean;
}) {
  if (!weeks.length) return null;
  const idx = weekIndex(weeks, weekStart);
  const cur = weeks[idx];
  const prev = weeks[idx + 1];
  const older = prev;
  const newer = weeks[idx - 1];
  const salesDelta = prev ? deltaPct(cur.salesAmount, prev.salesAmount) : 0;
  const commDelta = prev ? deltaPct(cur.commissionAmount, prev.commissionAmount) : 0;

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
    <section className="week-stepper card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button type="button" className="week-stepper-arrow" disabled={!newer} onClick={() => pick(newer)} aria-label="الأسبوع الأحدث">
        ‹
      </button>
      <div className="week-stepper-body">
        <p className="kicker">{kicker}</p>
        <p className="week-stepper-title">
          {cur.isCurrent ? 'هذا الأسبوع' : dayLabel(cur.weekStart)}
        </p>
        <p className="week-stepper-range">{weekRange(cur.weekStart, cur.weekEnd)}</p>
        {showSales && (
          <>
            <p className="week-stepper-sales num">{cur.salesAmount > 0 ? moneyIq(cur.salesAmount) : '—'}</p>
            {cur.commissionAmount > 0 && (
              <p className="week-stepper-comm num">{moneyIq(cur.commissionAmount)} عمولات</p>
            )}
            {showDelta && prev && (cur.salesAmount > 0 || prev.salesAmount > 0) && (
              <div className="week-stepper-deltas">
                <Delta value={salesDelta} />
                {cur.commissionAmount > 0 && <span className="text-xs font-extrabold text-muted">عمولات <Delta value={commDelta} /></span>}
              </div>
            )}
          </>
        )}
      </div>
      <button type="button" className="week-stepper-arrow" disabled={!older} onClick={() => pick(older)} aria-label="الأسبوع الأقدم">
        ›
      </button>
    </section>
  );
}

export function WeekBar({
  weeks, weekStart, setWeek,
}: {
  weeks: WeekSummary[];
  weekStart?: string;
  setWeek: (w?: string) => void;
}) {
  if (!weeks.length) return null;
  const idx = weekIndex(weeks, weekStart);
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
    <div className="week-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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

export function WeekDayPills({
  days,
  active,
  today,
  onSelect,
}: {
  days: { key: string; weekday: string; label: string; sales: number }[];
  active?: string;
  today?: string;
  onSelect: (key: string) => void;
}) {
  if (!days.length) return null;
  const max = Math.max(...days.map(d => d.sales), 1);
  return (
    <div className="week-day-pills">
      {days.map(d => {
        const h = Math.max(28, Math.round((d.sales / max) * 100));
        return (
          <button
            key={d.key}
            type="button"
            className={`week-day-pill ${active === d.key ? 'on' : ''} ${today === d.key ? 'today' : ''}`}
            onClick={() => onSelect(d.key)}
          >
            <span className="week-day-bar" style={{ height: `${h}%` }} />
            <span className="week-day-val num">{d.sales > 0 ? moneyK(d.sales) : '—'}</span>
            <span className="week-day-name">{d.weekday || d.label}</span>
          </button>
        );
      })}
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
  showWeekPicker = true,
  days,
  activeDay,
  today,
  onDaySelect,
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
  showWeekPicker?: boolean;
  days?: { key: string; weekday: string; label: string; sales: number }[];
  activeDay?: string;
  today?: string;
  onDaySelect?: (key: string) => void;
}) {
  const [weeksOpen, setWeeksOpen] = useState(false);
  const current = weeks.find(w => w.isCurrent);
  const currentKey = current?.weekStart.slice(0, 10);

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
    <section className="period-card card">
      <div className="period-chips">
        {chips.map(c => (
          <button key={c.id} type="button" className={`period-chip ${kind === c.id ? 'on' : ''}`} onClick={() => pickKind(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="period-nav">
        <button type="button" className="period-nav-btn" onClick={() => stepDay(-1)} aria-label="اليوم السابق">‹</button>
        <div className="period-nav-label">
          <p className="kicker">{period.singleDay ? 'اليوم' : 'المدة'}</p>
          <p className="font-extrabold">{period.label}</p>
        </div>
        <button
          type="button"
          className="period-nav-btn"
          disabled={period.to >= todayKey()}
          onClick={() => stepDay(1)}
          aria-label="اليوم التالي"
        >›</button>
      </div>

      {days && days.length > 0 && onDaySelect && (
        <WeekDayPills days={days} active={activeDay} today={today} onSelect={onDaySelect} />
      )}

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

      {showWeekPicker && weeks.length > 1 && (
        <>
          <button type="button" className="period-week-toggle" onClick={() => setWeeksOpen(v => !v)}>
            {weeksOpen ? 'إخفاء الأسابيع' : 'تغيير الأسبوع'}
          </button>
          {weeksOpen && <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />}
        </>
      )}
    </section>
  );
}

export function WeekTimeline({
  weeks,
  weekStart,
  setWeek,
}: {
  weeks: WeekSummary[];
  weekStart?: string;
  setWeek: (w?: string) => void;
}) {
  if (!weeks.length) return null;
  const max = Math.max(...weeks.map(w => w.salesAmount), 1);
  const list = weeks.slice(0, 10);
  return (
    <div className="week-timeline">
      {list.map(w => {
        const wk = w.weekStart.slice(0, 10);
        const active = (!weekStart && w.isCurrent) || weekStart === wk || weekStart === w.weekStart;
        const h = Math.max(16, Math.round((w.salesAmount / max) * 100));
        return (
          <button
            key={wk}
            type="button"
            className={`week-timeline-col ${active ? 'on' : ''}`}
            onClick={() => setWeek(w.isCurrent ? undefined : wk)}
          >
            <div className="week-timeline-bar-wrap">
              <div className="week-timeline-bar" style={{ height: `${h}%` }} />
            </div>
            <span className="week-timeline-val num">{w.salesAmount > 0 ? moneyK(w.salesAmount) : '—'}</span>
            <span className="week-timeline-label">{w.isCurrent ? 'الحالي' : dayLabel(w.weekStart)}</span>
          </button>
        );
      })}
    </div>
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
