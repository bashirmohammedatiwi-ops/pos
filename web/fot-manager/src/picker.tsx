import { useMemo, useState } from 'react';
import { dayLabel, deltaPct, moneyIq, todayKey, weekRange, type WeekSummary } from './api';
import { officialDays } from './insights';
import { addDays, yesterdayKey } from './period';
import { useManager } from './store';
import { Delta, Sheet } from './ui';

export function shortIq(n: number) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} مليون`;
  if (v >= 1000) return `${Math.round(n / 1000)} ألف`;
  return String(Math.round(n));
}

export function fullDay(key: string) {
  const d = new Date(`${key.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });
}

function weekKeyOf(w: WeekSummary) {
  return w.weekStart.slice(0, 10);
}

function weekFor(weeks: WeekSummary[], day: string) {
  return weeks.find(w => day >= w.weekStart.slice(0, 10) && day <= w.weekEnd.slice(0, 10));
}

function weekTitle(w: WeekSummary) {
  return w.isCurrent ? 'هذا الأسبوع' : `أسبوع ${dayLabel(w.weekStart)}`;
}

function useJump() {
  const { weeks, weekStart, setWeek, setCustom, setPeriodKind } = useManager();
  const currentKey = weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
  const activeWeek = weekStart || currentKey;

  function openDay(day: string) {
    const w = weekFor(weeks, day);
    if (w && weekKeyOf(w) !== activeWeek) setWeek(w.isCurrent ? undefined : weekKeyOf(w));
    if (day === todayKey()) {
      setPeriodKind('today');
      return;
    }
    setCustom(day, day);
    setPeriodKind('custom');
  }

  function openWeek(w: WeekSummary) {
    setWeek(w.isCurrent ? undefined : weekKeyOf(w));
    setPeriodKind(w.isCurrent ? 'wtd' : 'week');
  }

  return { openDay, openWeek, activeWeek };
}

export function PeriodBar() {
  const { period, periodKind, setPeriodKind, setWeek, weekStart, weeks, dash } = useManager();
  const { openDay, openWeek, activeWeek } = useJump();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(period.from);
  const today = todayKey();
  const currentKey = weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
  const viewingPast = !!weekStart && !!currentKey && weekStart !== currentKey;

  const days = useMemo(
    () => officialDays(dash?.days, [], dash?.week?.weekStart, dash?.week?.weekEnd).filter(d => d.key <= today),
    [dash, today],
  );
  const maxDay = Math.max(1, ...days.map(d => d.sales));

  const chips = [
    { id: 'today', label: 'اليوم', on: periodKind === 'today' || (period.singleDay && period.from === today) },
    { id: 'yesterday', label: 'أمس', on: period.singleDay && period.from === yesterdayKey() },
    { id: 'wtd', label: 'الأسبوع', on: !viewingPast && periodKind === 'wtd' },
  ] as const;
  const otherOn = !chips.some(c => c.on);

  function pick(id: 'today' | 'yesterday' | 'wtd') {
    if (id === 'yesterday') {
      openDay(yesterdayKey());
      return;
    }
    if (viewingPast) setWeek(undefined);
    setPeriodKind(id);
  }

  const canStep = period.singleDay;
  const label = period.singleDay ? fullDay(period.from) : period.from === period.to ? fullDay(period.from) : `${dayLabel(period.from)} — ${dayLabel(period.to)}`;

  return (
    <section className="s-period">
      <div className="s-seg" role="tablist" aria-label="المدة">
        {chips.map(c => (
          <button key={c.id} type="button" role="tab" aria-selected={c.on} className={c.on ? 'on' : ''} onClick={() => pick(c.id)}>
            {c.label}
          </button>
        ))}
        <button type="button" className={otherOn ? 'on' : ''} onClick={() => { setPicked(period.from); setOpen(true); }}>
          {otherOn ? 'يوم آخر ✓' : 'يوم آخر'}
        </button>
      </div>
      <div className="s-period-line">
        <button type="button" className="s-step" disabled={!canStep} onClick={() => openDay(addDays(period.from, -1))} aria-label="اليوم السابق">›</button>
        <button type="button" className="s-period-label" onClick={() => { setPicked(period.from); setOpen(true); }}>
          <span>{label}</span>
          {viewingPast && <small>أسبوع سابق</small>}
        </button>
        <button type="button" className="s-step" disabled={!canStep || period.from >= today} onClick={() => openDay(addDays(period.from, 1))} aria-label="اليوم التالي">‹</button>
      </div>

      <Sheet open={open} title="اختر اليوم أو الأسبوع" onClose={() => setOpen(false)}>
        <div className="s-pick">
          {days.length > 0 && (
            <>
              <p className="s-pick-title">أيام {weeks.find(w => weekKeyOf(w) === activeWeek)?.isCurrent === false ? 'الأسبوع المختار' : 'هذا الأسبوع'}</p>
              <div className="s-days">
                {days.map(d => {
                  const on = period.singleDay && period.from === d.key;
                  return (
                    <button key={d.key} type="button" className={`s-day ${on ? 'on' : ''} ${d.key === today ? 'today' : ''}`} onClick={() => { openDay(d.key); setOpen(false); }}>
                      <span className="s-day-name">{d.key === today ? 'اليوم' : d.weekday}</span>
                      <span className="s-day-bar"><i style={{ height: `${Math.max(6, (d.sales / maxDay) * 100)}%` }} /></span>
                      <span className="s-day-val">{d.sales > 0 ? shortIq(d.sales) : '—'}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <p className="s-pick-title">يوم محدد</p>
          <div className="s-date-row">
            <input type="date" value={picked} max={today} onChange={e => setPicked(e.target.value)} />
            <button
              type="button"
              className="s-btn primary"
              disabled={!picked}
              onClick={() => { openDay(picked); setOpen(false); }}
            >
              عرض
            </button>
          </div>

          {weeks.length > 0 && (
            <>
              <p className="s-pick-title">الأسابيع</p>
              <div className="s-weeks">
                {weeks.slice(0, 8).map((w, i) => {
                  const prev = weeks[i + 1];
                  const on = weekKeyOf(w) === activeWeek && (periodKind === 'week' || periodKind === 'wtd');
                  return (
                    <button key={weekKeyOf(w)} type="button" className={`s-week ${on ? 'on' : ''}`} onClick={() => { openWeek(w); setOpen(false); }}>
                      <span>
                        <strong>{weekTitle(w)}</strong>
                        <small>{weekRange(w.weekStart, w.weekEnd)}</small>
                      </span>
                      <span className="s-week-val">
                        <strong className="num">{w.salesAmount > 0 ? moneyIq(w.salesAmount) : '—'}</strong>
                        {prev && prev.salesAmount > 0 && w.salesAmount > 0 && <Delta value={deltaPct(w.salesAmount, prev.salesAmount)} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Sheet>
    </section>
  );
}

export function WeekPicker({ title = 'الأسبوع' }: { title?: string }) {
  const { weeks, weekStart, setWeek } = useManager();
  const [open, setOpen] = useState(false);
  if (!weeks.length) return null;
  const key = weekStart || weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
  const idx = Math.max(0, weeks.findIndex(w => weekKeyOf(w) === key));
  const cur = weeks[idx];
  const older = weeks[idx + 1];
  const newer = weeks[idx - 1];
  const go = (w?: WeekSummary) => { if (w) setWeek(w.isCurrent ? undefined : weekKeyOf(w)); };

  return (
    <section className="s-period">
      <div className="s-period-line">
        <button type="button" className="s-step" disabled={!older} onClick={() => go(older)} aria-label="الأسبوع السابق">›</button>
        <button type="button" className="s-period-label" onClick={() => setOpen(true)}>
          <small>{title}</small>
          <span>{weekTitle(cur)}</span>
          <small className="muted">{weekRange(cur.weekStart, cur.weekEnd)}</small>
        </button>
        <button type="button" className="s-step" disabled={!newer} onClick={() => go(newer)} aria-label="الأسبوع التالي">‹</button>
      </div>
      {!cur.isCurrent && (
        <button type="button" className="s-back" onClick={() => setWeek(undefined)}>العودة إلى هذا الأسبوع</button>
      )}
      <Sheet open={open} title="اختر الأسبوع" onClose={() => setOpen(false)}>
        <div className="s-weeks">
          {weeks.slice(0, 12).map((w, i) => {
            const prev = weeks[i + 1];
            return (
              <button key={weekKeyOf(w)} type="button" className={`s-week ${w === cur ? 'on' : ''}`} onClick={() => { go(w); setOpen(false); }}>
                <span>
                  <strong>{weekTitle(w)}</strong>
                  <small>{weekRange(w.weekStart, w.weekEnd)}</small>
                </span>
                <span className="s-week-val">
                  <strong className="num">{w.salesAmount > 0 ? moneyIq(w.salesAmount) : '—'}</strong>
                  {prev && prev.salesAmount > 0 && w.salesAmount > 0 && <Delta value={deltaPct(w.salesAmount, prev.salesAmount)} />}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </section>
  );
}
