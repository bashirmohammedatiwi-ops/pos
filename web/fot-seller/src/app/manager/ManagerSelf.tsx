import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, clockLabel, toast } from '../kit';
import { haptic, readWifi } from '../native';
import { BackBtn } from '../parts';
import { hhmm } from '../screens/Attend';
import { byName, dateTiny, getManagerMe, managerSelfApi, shortDay, useLoad, usePerms, type MgrDay, type MgrReportRow, type MgrSelf, type MgrSession } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * بصمة المدراء — بالساعات: دخول وخروج (أكثر من مرة في اليوم)، بلا وردية ولا تأخير.
 *   · بطاقة البصمة في الرئيسية، وصفحة «بصمتي» بساعات اليوم والأسبوع والشهر.
 *   · مخطط زمني: كل يوم سطر، والأشرطة هي فترات الحضور على محور الساعات.
 *   · «دوام المدراء»: ساعات كل مدير ومخططه، وتصحيح السجلات (لا أحد يصحّح سجله بنفسه).
 * ───────────────────────────────────────────────────────────────────────────── */

const two = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const iraqToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 1) % 7));
const dayStart = (date: string) => Date.parse(`${date}T00:00:00+03:00`);
const hourTick = (h: number) => {
  const x = ((h % 24) + 24) % 24;
  return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? 'ص' : 'م'}`;
};
/** الدقائق الجارية لفترة مفتوحة تُحسب من ساعة الخادم */
const liveMinutes = (s: MgrSession, nowMs: number) => (s.checkOut ? s.minutes : Math.max(0, Math.round((nowMs - Date.parse(s.checkIn)) / 60_000)));

function useTick(ms: number, active = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => set(x => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

/* ═════════════ المخطط الزمني ═════════════ */
/**
 * كل يوم سطر: شريط لكل فترة حضور على محور الساعات (من اليسار إلى اليمين)، والمجموع في آخر السطر.
 * المحور يتسع تلقائياً لأبكر حضور وآخر انصراف في الفترة. الضغط على يوم يعرض فتراته بالتفصيل.
 */
export function Timeline({
  days,
  today,
  nowMs,
  selected,
  onSelect,
}: {
  days: MgrDay[];
  today: string;
  nowMs: number;
  selected?: string | null;
  onSelect?: (date: string) => void;
}) {
  const { lo, hi, ticks } = useMemo(() => {
    let lo = 10;
    let hi = 22;
    for (const d of days) {
      for (const s of d.sessions) {
        const a = (Date.parse(s.checkIn) - dayStart(d.date)) / 3600e3;
        const b = ((s.checkOut ? Date.parse(s.checkOut) : nowMs) - dayStart(d.date)) / 3600e3;
        lo = Math.min(lo, Math.floor(a));
        hi = Math.max(hi, Math.ceil(b));
      }
    }
    lo = Math.max(0, lo);
    hi = Math.min(36, Math.max(hi, lo + 4));
    const span = hi - lo;
    const step = span <= 8 ? 2 : span <= 16 ? 3 : span <= 24 ? 4 : 6;
    const ticks: number[] = [];
    for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) ticks.push(h);
    return { lo, hi, ticks };
  }, [days, nowMs]);
  const span = hi - lo;
  const pct = (h: number) => `${Math.max(0, Math.min(100, ((h - lo) / span) * 100))}%`;
  const hasAuto = days.some(d => d.sessions.some(s => s.autoClosed));
  const hasOpen = days.some(d => d.sessions.some(s => !s.checkOut));
  const nowH = (nowMs - dayStart(today)) / 3600e3;

  return (
    <div className="m-tl" role="img" aria-label="مخطط أوقات الدوام: كل سطر يوم، والأشرطة فترات الحضور">
      <div className="m-tl-axis" aria-hidden>
        <span />
        <div className="m-tl-ticks">
          {ticks.map(h => (
            <span key={h} style={{ left: pct(h) }}>
              {hourTick(h)}
            </span>
          ))}
        </div>
        <span />
      </div>
      {days.map(d => {
        const minutes = d.sessions.reduce((x, s) => x + liveMinutes(s, nowMs), 0);
        const isToday = d.date === today;
        const cls = `m-tl-row ${isToday ? 'today' : ''} ${selected === d.date ? 'sel' : ''}`;
        const label = `${d.weekday} ${Number(d.date.slice(8))}/${Number(d.date.slice(5, 7))}: ${minutes ? `${hhmm(minutes)} ساعة` : 'بلا حضور'}`;
        const inner = (
          <>
            <span className="day">
              {isToday ? 'اليوم' : shortDay(d.weekday)}
              <small className="num">{Number(d.date.slice(8))}</small>
            </span>
            <div className="m-tl-track" style={{ ['--tl-step' as string]: `${(100 / span) * (ticks[1] - ticks[0] || span)}%`, backgroundPositionX: pct(ticks[0] ?? lo) }}>
              {d.sessions.map(s => {
                const a = (Date.parse(s.checkIn) - dayStart(d.date)) / 3600e3;
                const b = ((s.checkOut ? Date.parse(s.checkOut) : nowMs) - dayStart(d.date)) / 3600e3;
                return (
                  <i
                    key={s.id}
                    className={`m-tl-bar ${!s.checkOut ? 'open' : s.autoClosed ? 'auto' : ''}`}
                    style={{ left: pct(a), width: `calc(${Math.max(0, ((Math.min(b, hi) - Math.max(a, lo)) / span) * 100)}% - 1px)` }}
                    title={`${clockLabel(s.checkIn)} – ${s.checkOut ? clockLabel(s.checkOut) : 'الآن'}`}
                  />
                );
              })}
              {isToday && nowH >= lo && nowH <= hi && <i className="m-tl-now" style={{ left: pct(nowH) }} />}
            </div>
            <span className={`total num ${minutes ? '' : 'zero'}`}>{minutes ? hhmm(minutes) : '—'}</span>
          </>
        );
        return onSelect ? (
          <button
            key={d.date}
            type="button"
            className={cls}
            aria-label={label}
            aria-pressed={selected === d.date}
            onClick={() => {
              haptic('select');
              onSelect(d.date);
            }}
          >
            {inner}
          </button>
        ) : (
          <div key={d.date} className={cls} aria-label={label}>
            {inner}
          </div>
        );
      })}
      <div className="m-tl-legend" aria-hidden>
        <span>
          <i /> فترة حضور
        </span>
        {hasOpen && (
          <span>
            <i className="open" /> في الدوام الآن
          </span>
        )}
        {hasAuto && (
          <span>
            <i className="auto" /> أُغلقت تلقائياً
          </span>
        )}
        <span>
          <i className="now" /> الآن
        </span>
      </div>
    </div>
  );
}

/** فترات يوم واحد بالتفصيل (بديل «التلميح» على الهاتف) */
function DaySessions({ day, nowMs, onEdit }: { day: MgrDay; nowMs: number; onEdit?: (s: MgrSession) => void }) {
  if (!day.sessions.length)
    return (
      <p className="muted" style={{ fontSize: 13, padding: '6px 2px' }}>
        لا حضور في {dateTiny(day.date)}.
      </p>
    );
  return (
    <div>
      {day.sessions.map(s => {
        const body = (
          <>
            <span className={`t-tile ${!s.checkOut ? 'ok' : s.autoClosed ? 'warn' : 'mute'}`} style={{ width: 34, height: 34 }}>
              <I.clock size={17} />
            </span>
            <span className="times">
              {clockLabel(s.checkIn)} – {s.checkOut ? clockLabel(s.checkOut) : 'مستمر الآن'}
              {(s.autoClosed || s.edited || s.note) && (
                <small>
                  {[s.autoClosed ? 'أُغلق تلقائياً' : '', s.edited ? `عدّله ${byName(s.editedBy)}` : '', s.note || ''].filter(Boolean).join(' · ')}
                </small>
              )}
            </span>
            <b className="num">{hhmm(liveMinutes(s, nowMs))}</b>
          </>
        );
        return onEdit ? (
          <button key={s.id} type="button" className="m-sess press-soft" onClick={() => onEdit(s)}>
            {body}
          </button>
        ) : (
          <div key={s.id} className="m-sess">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/* ═════════════ بطاقة البصمة ═════════════ */
export function SelfAttendCard({ link = true }: { link?: boolean }) {
  const { data, err, reload, setData } = useLoad(() => managerSelfApi.state(), ['mattend']);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'in' | 'out' | null>(null);
  const [fail, setFail] = useState('');
  const lastAsk = useRef<'in' | 'out'>('in');
  if (ask) lastAsk.current = ask;
  // العداد يتبع ساعة الخادم حتى لو كانت ساعة الهاتف خاطئة
  const skew = useRef(0);
  useEffect(() => {
    if (data?.now) skew.current = Date.parse(data.now) - Date.now();
  }, [data]);
  useTick(1000, !!data?.open);

  async function act(action: 'in' | 'out') {
    if (busy) return;
    setBusy(true);
    setFail('');
    try {
      const w = await readWifi();
      const next = await managerSelfApi.act(action, w.bssid);
      setData(next);
      haptic('success');
      toast(action === 'in' ? 'سُجّل حضورك — بدأت ساعاتك' : `سُجّل انصرافك — اليوم ${hhmm(next.todayMinutes)} ساعة`);
    } catch (e) {
      haptic('error');
      const msg = e instanceof Error ? e.message : 'تعذر التسجيل';
      setFail(msg);
      toast(msg);
    } finally {
      setBusy(false);
    }
  }

  // خادم أقدم لا يعرف بصمة المدراء: لا بطاقة
  if (err && !data) return /الخادم لا يدعم|not found/i.test(err) ? null : <ErrorLine text={err} onRetry={() => void reload()} />;
  if (!data) return <Skeleton h={128} r={26} />;

  const open = data.open;
  const now = Date.now() + skew.current;
  const sec = open ? Math.max(0, Math.floor((now - Date.parse(open.checkIn)) / 1000)) : 0;
  const todayMin = data.days[0]?.date === data.today ? data.days[0].sessions.reduce((x, s) => x + liveMinutes(s, now), 0) : data.todayMinutes;
  const weekMin = data.week.minutes + (open ? Math.max(0, liveMinutes(open, now) - open.minutes) : 0);
  const a = lastAsk.current;
  const nowText = new Date().toLocaleTimeString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <section className={`m-punch ${open ? 'live' : ''}`}>
      <div className="top">
        <span className="label">
          {open && <i className="pulse" />}
          {open ? `في الدوام منذ ${clockLabel(open.checkIn)}` : 'بصمتي'}
        </span>
        {link && (
          <Link to="/m/self" className="more" onClick={() => haptic('tap')}>
            ساعاتي والمخطط
          </Link>
        )}
      </div>
      <div className="mid">
        <div>
          {open ? (
            <div className="clock num ltr" style={{ textAlign: 'right' }}>
              {Math.floor(sec / 3600)}:{two((sec % 3600) / 60)}:{two(sec % 60)}
            </div>
          ) : (
            <div className="clock num">
              <span className="ltr">{hhmm(todayMin)}</span>
              <small>اليوم</small>
            </div>
          )}
          <div className="sub">
            {open ? `اليوم ${hhmm(todayMin)} · الأسبوع ` : 'هذا الأسبوع '}
            <b className="num ltr">{hhmm(weekMin)}</b>
            {open ? '' : ' ساعة'}
          </div>
        </div>
        <button type="button" className={`t-btn press ${open ? 'white' : ''}`} disabled={busy} onClick={() => (haptic('tap'), setAsk(open ? 'out' : 'in'))}>
          {busy ? <span className="spinner" style={open ? { borderTopColor: '#241245' } : undefined} /> : open ? 'تسجيل الانصراف' : 'تسجيل الحضور'}
        </button>
      </div>
      {fail && <div className="err">{fail}</div>}

      <Sheet open={!!ask} onClose={() => setAsk(null)}>
        <div className="t-confirm">
          <span className={`t-tile lg ${a === 'in' ? 'ok' : 'bad'}`}>{a === 'in' ? <I.store size={24} /> : <I.out size={24} />}</span>
          <h3>{a === 'in' ? 'تأكيد تسجيل الحضور' : 'تأكيد الانصراف'}</h3>
          <p>
            {a === 'in'
              ? `سيُسجَّل حضورك الآن الساعة ${nowText} وتبدأ ساعات دوامك.`
              : `سيُسجَّل انصرافك الآن الساعة ${nowText} وتتوقف ساعاتك. إن عدت اليوم سجّل حضورك من جديد.`}
          </p>
          <div className="t-actions">
            <button type="button" className="t-btn plain press" onClick={() => setAsk(null)}>
              إلغاء
            </button>
            <button
              type="button"
              className={`t-btn press ${a === 'out' ? 'danger' : ''}`}
              onClick={() => {
                setAsk(null);
                void act(a);
              }}
            >
              {a === 'in' ? 'نعم، سجّل حضوري' : 'نعم، سجّل انصرافي'}
            </button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}

/* ═════════════ بصمتي ═════════════ */
export function MSelf() {
  const { data, err, loading, reload } = useLoad<MgrSelf>(() => managerSelfApi.state(), ['mattend']);
  const [sel, setSel] = useState<string | null>(null);
  useTick(30_000, !!data?.open);
  const skew = data?.now ? Date.parse(data.now) - Date.now() : 0;
  const now = Date.now() + skew;
  const day = data?.days.find(d => d.date === (sel ?? data.today)) ?? null;
  const liveExtra = data?.open ? Math.max(0, liveMinutes(data.open, now) - data.open.minutes) : 0;

  return (
    <Screen title="بصمتي" subtitle="دوامك بالساعات — سجّل حضورك وانصرافك من المحل" start={<BackBtn to="/m" />} onRefresh={reload}>
      <SelfAttendCard link={false} />
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={320} r={20} mt={14} />
      ) : data ? (
        <>
          <div className="t-stats" style={{ marginTop: 14 }}>
            <div className="t-stat">
              <span>هذا الأسبوع</span>
              <b className="num ltr">{hhmm(data.week.minutes + liveExtra)}</b>
              <em>{data.week.days} يوم حضور</em>
            </div>
            <div className="t-stat">
              <span>الأسبوع الماضي</span>
              <b className="num ltr">{hhmm(data.lastWeek.minutes)}</b>
              <em>{data.lastWeek.days} يوم حضور</em>
            </div>
            <div className="t-stat">
              <span>هذا الشهر</span>
              <b className="num ltr">{hhmm(data.month.minutes + liveExtra)}</b>
              <em>{data.month.days ? `معدل ${hhmm(Math.round((data.month.minutes + liveExtra) / data.month.days))} يومياً` : 'لا حضور بعد'}</em>
            </div>
          </div>

          <section className="t-section">
            <div className="t-section-head">
              <h2>أوقات دوامي</h2>
              <small>آخر 14 يوماً · اضغط يوماً لتفاصيله</small>
            </div>
            <Timeline days={data.days} today={data.today} nowMs={now} selected={sel ?? data.today} onSelect={setSel} />
            {day && (
              <div className="t-card pad m-day-detail">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <b style={{ fontSize: 14.5 }}>{day.date === data.today ? 'اليوم' : dateTiny(day.date)}</b>
                  <span className="num" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    {day.sessions.length ? `${day.sessions.length} فترة · ${hhmm(day.sessions.reduce((x, s) => x + liveMinutes(s, now), 0))} ساعة` : ''}
                  </span>
                </div>
                <DaySessions day={day} nowMs={now} />
              </div>
            )}
          </section>
          <p className="t-hint" style={{ marginTop: 12, lineHeight: 1.8 }}>
            إن نسيت تسجيل الانصراف يُغلق حضورك تلقائياً على وقت إغلاق المحل. تصحيح أي سجل يتم من مدير آخر أو من الإدارة.
          </p>
        </>
      ) : null}
    </Screen>
  );
}

/* ═════════════ دوام المدراء ═════════════ */
type Period = 'week' | 'last' | 'month';
const toHm = (iso?: string | null) => (iso ? new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(11, 16) : '');

export function MManagers() {
  const perms = usePerms();
  const meId = getManagerMe()?.id;
  const [period, setPeriod] = useState<Period>('week');
  const [openId, setOpenId] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ row: MgrReportRow; session: MgrSession | null; date: string } | null>(null);
  const range = useMemo(() => {
    const today = iraqToday();
    const start = weekStart(today);
    if (period === 'last') return { from: addDays(start, -7), to: addDays(start, -1) };
    if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
    return { from: start, to: today };
  }, [period]);
  const { data, err, loading, reload } = useLoad(() => managerSelfApi.report(range.from, range.to), ['mattend'], [range.from, range.to]);
  useTick(30_000, !!data?.presentNow);
  const now = Date.now();
  const top = Math.max(1, ...(data?.rows ?? []).map(r => r.minutes));

  return (
    <Screen
      title="دوام المدراء"
      subtitle={data ? `${hhmm(data.totalMinutes)} ساعة في الفترة · ${data.presentNow ? `${data.presentNow} في الدوام الآن` : 'لا أحد في الدوام الآن'}` : 'ساعات كل مدير ومخطط حضوره'}
      start={<BackBtn to="/m/more" />}
      onRefresh={reload}
    >
      <Segmented
        items={[
          { id: 'week', label: 'هذا الأسبوع' },
          { id: 'last', label: 'الأسبوع الماضي' },
          { id: 'month', label: 'هذا الشهر' },
        ]}
        value={period}
        onChange={v => {
          setPeriod(v);
          setSel(null);
        }}
      />
      {err && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={280} r={20} mt={14} />
      ) : !data?.rows.length ? (
        <div className="t-card pad" style={{ marginTop: 14, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
          لا مدراء بعد.
        </div>
      ) : (
        <div className="m-todo" style={{ marginTop: 14 }}>
          {data.rows.map(r => {
            const expanded = openId === r.managerId;
            const canEdit = !!perms.editAttendance && r.managerId !== meId;
            const day = expanded ? r.daily.find(d => d.date === (sel ?? r.daily[0]?.date)) ?? null : null;
            return (
              <div key={r.managerId} className="m-req">
                <button
                  type="button"
                  className="head press-soft"
                  aria-expanded={expanded}
                  onClick={() => {
                    haptic('tap');
                    setOpenId(expanded ? null : r.managerId);
                    setSel(null);
                  }}
                >
                  <i className="m-dot" style={{ marginTop: 6, background: r.open ? 'var(--ok)' : 'var(--ink-4)' }} />
                  <div className="body">
                    <div className="name">
                      {r.name}
                      {r.managerId === meId && <Badge tone="mute">أنت</Badge>}
                      {r.open && <Badge tone="ok">في الدوام الآن</Badge>}
                    </div>
                    <div className="meta">
                      {r.open && r.openSince ? `منذ ${clockLabel(r.openSince)} · ` : ''}
                      {r.days} يوم حضور
                      {r.days ? ` · معدل ${hhmm(Math.round(r.minutes / r.days))} يومياً` : ''}
                      {r.autoClosed ? ` · ${r.autoClosed} نسي الانصراف` : ''}
                    </div>
                    <div className="t-stat-line" style={{ marginTop: 8 }}>
                      <div className="t-track">
                        <i style={{ width: `${(r.minutes / top) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <b className="num ltr" style={{ fontSize: 18, fontWeight: 750 }}>
                      {hhmm(r.minutes)}
                    </b>
                    <small style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)' }}>ساعة</small>
                  </div>
                </button>
                {expanded && (
                  <div style={{ marginTop: 12 }}>
                    <Timeline days={r.daily} today={data.today} nowMs={now} selected={sel ?? r.daily[0]?.date} onSelect={setSel} />
                    {day && (
                      <div className="m-day-detail">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 2px' }}>
                          <b style={{ fontSize: 14 }}>{day.date === data.today ? 'اليوم' : dateTiny(day.date)}</b>
                          {canEdit && (
                            <button type="button" className="t-btn soft sm press" onClick={() => setEdit({ row: r, session: null, date: day.date })}>
                              + إضافة فترة
                            </button>
                          )}
                        </div>
                        <DaySessions day={day} nowMs={now} onEdit={canEdit ? s => setEdit({ row: r, session: s, date: day.date }) : undefined} />
                        {r.managerId === meId && <p className="t-hint" style={{ marginTop: 6 }}>سجلّك يعدّله مدير آخر أو الإدارة.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <SessionSheet
        edit={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void reload();
        }}
      />
    </Screen>
  );
}

function SessionSheet({ edit, onClose, onSaved }: { edit: { row: MgrReportRow; session: MgrSession | null; date: string } | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ in: '', out: '', note: '' });
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!edit) return;
    setForm({ in: toHm(edit.session?.checkIn), out: toHm(edit.session?.checkOut), note: '' });
    setConfirm(false);
  }, [edit]);

  async function save() {
    if (!edit) return;
    if (!form.in) return toast('حدّد وقت الحضور');
    setBusy('save');
    try {
      const inMs = Date.parse(`${edit.date}T${form.in}:00+03:00`);
      // انصراف بساعة أصغر من الحضور = بعد منتصف الليل
      let outMs = form.out ? Date.parse(`${edit.date}T${form.out}:00+03:00`) : null;
      if (outMs != null && outMs <= inMs) outMs += 86_400_000;
      await managerSelfApi.save(
        { managerId: edit.row.managerId, checkIn: new Date(inMs).toISOString(), checkOut: outMs != null ? new Date(outMs).toISOString() : edit.session ? null : undefined, note: form.note.trim() || undefined },
        edit.session?.id,
      );
      haptic('success');
      toast(edit.session ? 'صُحّح السجل — وصل تبليغ للمدير' : 'أُضيفت الفترة');
      onSaved();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy('');
    }
  }
  async function remove() {
    if (!edit?.session) return;
    setBusy('del');
    try {
      await managerSelfApi.remove(edit.session.id);
      haptic('success');
      toast('حُذف السجل');
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الحذف');
    } finally {
      setBusy('');
    }
  }

  return (
    <Sheet open={!!edit} onClose={onClose} title={edit ? (edit.session ? 'تصحيح فترة الحضور' : 'إضافة فترة حضور') : ''} subtitle={edit ? `${edit.row.name} · ${dateTiny(edit.date)}` : ''}>
      {edit && (
        <div className="t-form">
          <div className="t-row-2">
            <label className="t-field">
              <span>الحضور</span>
              <input className="t-input sm" type="time" value={form.in} onChange={e => setForm(f => ({ ...f, in: e.target.value }))} />
            </label>
            <label className="t-field">
              <span>الانصراف</span>
              <input className="t-input sm" type="time" value={form.out} onChange={e => setForm(f => ({ ...f, out: e.target.value }))} />
            </label>
          </div>
          <label className="t-field">
            <span>السبب</span>
            <input className="t-input sm" maxLength={300} placeholder="مثال: نسي تسجيل الانصراف" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </label>
          <button type="button" className="t-btn block press" disabled={!!busy} onClick={() => void save()}>
            {busy === 'save' ? <span className="spinner" /> : edit.session ? 'حفظ التصحيح' : 'إضافة الفترة'}
          </button>
          {edit.session &&
            (confirm ? (
              <button type="button" className="t-btn danger block press" disabled={!!busy} onClick={() => void remove()}>
                {busy === 'del' ? <span className="spinner" /> : 'تأكيد حذف السجل'}
              </button>
            ) : (
              <button type="button" className="t-btn plain block press" style={{ color: 'var(--bad)' }} onClick={() => setConfirm(true)}>
                حذف السجل
              </button>
            ))}
        </div>
      )}
    </Sheet>
  );
}
