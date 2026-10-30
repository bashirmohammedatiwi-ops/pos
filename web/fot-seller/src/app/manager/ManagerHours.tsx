import { useMemo, useState } from 'react';
import { ErrorLine, I, Screen, Segmented, Skeleton } from '../kit';
import { BackBtn } from '../parts';
import { hhmm } from '../screens/Attend';
import { dateTiny, managerAttendApi, useLoad } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * الدوام بالساعات — ساعات كل موظف بالساعات في الفترة، أسبوعاً بأسبوع (من السبت إلى الجمعة).
 * المبالغ تظهر فقط لمن يملك صلاحية «المبالغ والرواتب».
 * ───────────────────────────────────────────────────────────────────────────── */

type Period = 'week' | 'last' | 'month';
const iraqToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 1) % 7));
const money = (n: number) => n.toLocaleString('en-US');

export function MHours() {
  const [period, setPeriod] = useState<Period>('week');
  const [open, setOpen] = useState<number | null>(null);
  const range = useMemo(() => {
    const today = iraqToday();
    const start = weekStart(today);
    if (period === 'last') return { from: addDays(start, -7), to: addDays(start, -1) };
    if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
    return { from: start, to: today };
  }, [period]);
  const { data, err, loading, reload } = useLoad(() => managerAttendApi.hours(range.from, range.to), ['attend'], [range.from, range.to]);

  return (
    <Screen title="الدوام بالساعات" subtitle={data ? `${hhmm(data.totalMinutes)} ساعة${data.totalPay != null ? ` · ${money(data.totalPay)} دينار` : ''}` : 'الساعات والمستحقات'} start={<BackBtn to="/m/more" />} onRefresh={reload}>
      <Segmented
        items={[
          { id: 'week', label: 'هذا الأسبوع' },
          { id: 'last', label: 'الأسبوع الماضي' },
          { id: 'month', label: 'هذا الشهر' },
        ]}
        value={period}
        onChange={v => setPeriod(v)}
      />
      {err && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={240} r={20} mt={14} />
      ) : !data?.rows.length ? (
        <div className="t-card pad" style={{ marginTop: 14, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.8 }}>
          لا موظفين بالساعات ضمن فريقك.
        </div>
      ) : (
        <div className="t-list" style={{ marginTop: 14 }}>
          {data.rows.map(r => (
            <div key={r.staffId}>
              <button type="button" className="t-row press-soft" style={{ width: '100%' }} onClick={() => setOpen(o => (o === r.staffId ? null : r.staffId))}>
                <span className="t-tile accent">
                  <I.clock size={18} />
                </span>
                <div className="body">
                  <div className="title">{r.name}</div>
                  <div className="sub">
                    {r.days} يوم
                    {r.rate != null ? ` · ${money(r.rate)} للساعة` : ''}
                    {r.open ? ' · في الدوام الآن' : ''}
                    {r.autoClosed ? ` · ${r.autoClosed} نسي الانصراف` : ''}
                  </div>
                </div>
                <div className="end">
                  <b className="num ltr">{hhmm(r.minutes)}</b>
                  {r.pay != null && <small className="num">{money(r.pay)} د.ع</small>}
                </div>
              </button>
              {open === r.staffId &&
                r.weeks.map(w => (
                  <div key={w.from} className="t-row" style={{ paddingInlineStart: 28 }}>
                    <div className="body">
                      <div className="sub">
                        {dateTiny(w.from)} – {dateTiny(w.to)} · {w.days} يوم
                      </div>
                    </div>
                    <div className="end">
                      <b className="num ltr">{hhmm(w.minutes)}</b>
                      {w.pay != null && <small className="num">{money(w.pay)} د.ع</small>}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
