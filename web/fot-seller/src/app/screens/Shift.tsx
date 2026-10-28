import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, ErrorLine, I, Screen, Sheet, Skeleton, toast } from '../kit';
import { haptic } from '../native';
import { BackBtn, ImagePicker, LEAVE_ICON, Lightbox, StatusBadge } from '../parts';
import { AttendCard, AttendHistory } from './Attend';
import { LEAVE_LABEL, dateShort, leaveWhen, offNames, relTime, staffApi, time12, useLoad, type DayState, type LeaveReq, type LeaveType } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * دوامي — حالة اليوم، تقويم ثلاثة أسابيع (العطل، الإجازات، التبديلات، الاستئذان)،
 * طلباتي وحالتها، ونموذج طلب جديد يصل للمدراء فوراً.
 * ───────────────────────────────────────────────────────────────────────────── */

const WD_SHORT = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];

function cellLabel(d: DayState) {
  switch (d.reason) {
    case 'weekly':
      return 'عطلة';
    case 'swap':
      return 'بديل';
    case 'swapped-in':
      return 'دوام';
    case 'day':
      return 'إجازة';
    case 'urgent':
      return 'طارئة';
    case 'sick':
      return 'مرضية';
    case 'hours':
      return 'استئذان';
    default:
      return '';
  }
}
function cellClass(d: DayState, today: string) {
  const c = ['t-day'];
  if (d.date < today) c.push('past');
  if (d.date === today) c.push('today');
  if (d.off) c.push(d.reason === 'sick' ? 'sick' : d.reason === 'day' || d.reason === 'urgent' ? 'leave' : 'off');
  if (d.reason === 'hours') c.push('hours');
  return c.join(' ');
}

export function Shift({ back }: { back?: string }) {
  const { data, err, loading, reload } = useLoad(() => staffApi.leave(), ['leave']);
  const [form, setForm] = useState(false);
  const [detail, setDetail] = useState<LeaveReq | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [params, setParams] = useSearchParams();

  // «طلب إجازة» من الرئيسية يفتح النموذج مباشرة
  useEffect(() => {
    if (params.get('new') !== '1' || !data) return;
    setForm(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = data?.today ?? '';
  const todayState = data?.days.find(d => d.date === today);
  const nextOff = data?.days.find(d => d.date > today && d.off);
  const offList = data ? offNames(data.weeklyOff) : [];
  const pending = data?.requests.filter(r => r.status === 'pending').length ?? 0;

  async function cancel() {
    if (!detail) return;
    setCancelling(true);
    try {
      await staffApi.cancelLeave(detail.id);
      haptic('success');
      toast('أُلغي الطلب');
      setDetail(null);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الإلغاء');
    } finally {
      setCancelling(false);
    }
  }

  const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86_400_000);
  const inDays = (n: number) => (n === 1 ? 'غداً' : n === 2 ? 'بعد يومين' : n <= 10 ? `بعد ${n} أيام` : `بعد ${n} يوماً`);
  // أيام عليها طلب معلّق تظهر بإطار متقطع
  const pendingDates = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.requests ?? []) {
      if (r.status !== 'pending') continue;
      if (r.type === 'swap') {
        if (r.swapFrom) set.add(r.swapFrom);
        if (r.swapTo) set.add(r.swapTo);
      } else if (r.dateFrom) {
        for (let d = r.dateFrom; d <= (r.dateTo || r.dateFrom); d = addDays(d, 1)) set.add(d);
      }
    }
    return set;
  }, [data]);

  return (
    <Screen
      title="دوامي"
      subtitle={data ? (offList.length ? `عطلتك الأسبوعية: ${offList.join(' و')}` : 'لم تُحدَّد عطلتك الأسبوعية بعد') : 'العطل والإجازات والطلبات'}
      onRefresh={reload}
      start={back ? <BackBtn to={back} /> : undefined}
    >
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <>
          <Skeleton h={120} r={26} />
          <Skeleton h={260} r={20} mt={14} />
        </>
      ) : data ? (
        <>
          <section className="t-hero">
            <div className="t-today">
              <span className="big">{todayState?.off ? <I.sun size={28} /> : <I.store size={28} />}</span>
              <div>
                <p className="kicker" style={{ margin: 0 }}>
                  {dateShort(today)}
                </p>
                <h2>
                  {!todayState
                    ? 'اليوم'
                    : todayState.off
                      ? todayState.reason === 'weekly'
                        ? 'اليوم عطلتك — استمتع'
                        : `اليوم ${cellLabel(todayState)}`
                      : todayState.reason === 'hours'
                        ? 'اليوم دوام مع استئذان'
                        : 'اليوم يوم دوام'}
                </h2>
                <p>
                  {nextOff
                    ? `أقرب يوم راحة: ${nextOff.weekday} ${dateShort(nextOff.date).split('، ').pop()} · ${inDays(daysUntil(nextOff.date))}`
                    : 'لا عطلة خلال الأسابيع الثلاثة القادمة'}
                </p>
              </div>
            </div>
          </section>

          <div style={{ marginTop: 14 }}>
            <AttendCard />
          </div>

          <section className="t-card pad" style={{ marginTop: 14 }}>
            <div className="t-cal">
              {WD_SHORT.map(w => (
                <span key={w} className="wd">
                  {w}
                </span>
              ))}
              {data.days.map(d => (
                <div key={d.date} className={`${cellClass(d, today)} ${pendingDates.has(d.date) ? 'pending' : ''}`} title={`${d.weekday} ${d.date}`}>
                  <span className="num">{Number(d.date.slice(8))}</span>
                  <small>{d.date === today && !cellLabel(d) ? 'اليوم' : cellLabel(d)}</small>
                </div>
              ))}
            </div>
            <div className="t-legend">
              <span>
                <i style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)' }} /> عطلة
              </span>
              <span>
                <i style={{ background: 'var(--ok-soft)', border: '1px solid var(--ok)' }} /> إجازة
              </span>
              <span>
                <i style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} /> مرضية
              </span>
              <span>
                <i style={{ background: 'var(--brand)', borderRadius: 99, width: 7, height: 7 }} /> استئذان
              </span>
              <span>
                <i style={{ border: '1.5px dashed var(--warn)' }} /> طلب معلّق
              </span>
            </div>
          </section>

          <AttendHistory />

          <section className="t-section">
            <div className="t-section-head">
              <h2>طلباتي</h2>
              {pending > 0 && <Badge tone="warn">{pending} بانتظار الموافقة</Badge>}
            </div>
            {data.requests.length === 0 ? (
              <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, lineHeight: 1.8 }}>
                لم ترفع أي طلب بعد.
                <br />
                تبديل يوم العطلة، إجازة، استئذان بالساعات… كلها من زر «طلب جديد».
              </div>
            ) : (
              <div className="t-list">
                {data.requests.map(r => (
                  <button key={r.id} type="button" className="t-req press-soft" onClick={() => setDetail(r)}>
                    <span className={`t-tile ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : r.status === 'pending' ? 'accent' : 'mute'}`}>{LEAVE_ICON[r.type]}</span>
                    <div className="body">
                      <div className="title">
                        {LEAVE_LABEL[r.type]}
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="when">{leaveWhen(r)}</div>
                      <div className="who">{relTime(r.createdAt)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
          <div style={{ height: 70 }} />
        </>
      ) : null}

      {data && (
        <button
          type="button"
          className="t-fab press"
          onClick={() => {
            haptic('tap');
            setForm(true);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          طلب جديد
        </button>
      )}

      {data && (
        <RequestSheet
          open={form}
          days={data.days}
          today={today}
          onClose={() => setForm(false)}
          onDone={() => {
            setForm(false);
            void reload();
          }}
        />
      )}

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? LEAVE_LABEL[detail.type] : ''} subtitle={detail ? leaveWhen(detail) : ''}>
        {detail && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusBadge status={detail.status} />
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>رُفع {relTime(detail.createdAt)}</span>
            </div>
            {detail.reason && (
              <div className="t-card pad">
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>السبب</div>
                <div style={{ marginTop: 4, lineHeight: 1.7 }}>{detail.reason}</div>
              </div>
            )}
            {detail.attachment && (
              <button type="button" className="t-row t-card press" onClick={() => setViewer(detail.attachment!)}>
                <span className="t-tile">
                  <I.sheet size={19} />
                </span>
                <div className="body">
                  <div className="title">التقرير المرفق</div>
                  <div className="sub">اضغط للعرض</div>
                </div>
              </button>
            )}
            {detail.status !== 'pending' && detail.status !== 'cancelled' && (
              <div className="t-card pad">
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {detail.status === 'approved' ? 'وافق' : 'رفض'} {detail.decidedBy?.replace(/^manager:/, '') || 'الإدارة'} · {detail.decidedAt ? relTime(detail.decidedAt) : ''}
                </div>
                {detail.decidedNote && <div style={{ marginTop: 4, lineHeight: 1.7 }}>{detail.decidedNote}</div>}
              </div>
            )}
            {detail.status === 'pending' && (
              <button type="button" className="t-btn plain block press" disabled={cancelling} onClick={() => void cancel()} style={{ color: 'var(--bad)' }}>
                {cancelling ? 'جارٍ الإلغاء…' : 'إلغاء الطلب'}
              </button>
            )}
          </div>
        )}
      </Sheet>
      {viewer && <Lightbox images={[viewer]} start={0} onClose={() => setViewer(null)} />}
    </Screen>
  );
}

/* ═════════════ نموذج الطلب ═════════════ */
const TYPES: LeaveType[] = ['swap', 'day', 'hours', 'sick', 'urgent'];

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function DayPills({ days, value, onPick, alt }: { days: DayState[]; value: string; onPick: (d: string) => void; alt?: boolean }) {
  if (!days.length) return <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>لا أيام متاحة</p>;
  return (
    <div className="t-scroller">
      {days.map(d => (
        <button
          key={d.date}
          type="button"
          className={`t-pill press ${value === d.date ? 'on' : ''}`}
          style={value === d.date && alt ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' } : undefined}
          onClick={() => {
            haptic('select');
            onPick(d.date);
          }}
        >
          {d.weekday}
          <small className="num">{dateShort(d.date).split('، ').pop()}</small>
        </button>
      ))}
    </div>
  );
}

function RequestSheet({ open, days, today, onClose, onDone }: { open: boolean; days: DayState[]; today: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<LeaveType>('swap');
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [tFrom, setTFrom] = useState('14:00');
  const [tTo, setTTo] = useState('16:00');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const upcoming = useMemo(() => days.filter(d => d.date >= today), [days, today]);
  const offDays = upcoming.filter(d => d.off && d.reason === 'weekly');
  const workDays = upcoming.filter(d => !d.off);
  const minDate = type === 'sick' ? addDays(today, -7) : today;

  async function submit() {
    setErr('');
    const body: Record<string, unknown> = { type, reason: reason.trim() || undefined };
    if (type === 'swap') {
      if (!swapFrom || !swapTo) return setErr('اختر يوم عطلتك واليوم البديل');
      Object.assign(body, { swapFrom, swapTo });
    } else if (type === 'hours') {
      if (tFrom >= tTo) return setErr('وقت العودة يجب أن يكون بعد وقت الخروج');
      Object.assign(body, { dateFrom: from, timeFrom: tFrom, timeTo: tTo });
    } else {
      if (to < from) return setErr('تاريخ النهاية قبل البداية');
      Object.assign(body, { dateFrom: from, dateTo: to, attachment: files[0] });
    }
    if (type === 'urgent' && !reason.trim()) return setErr('اكتب سبب الإجازة الطارئة');
    setBusy(true);
    try {
      await staffApi.requestLeave(body);
      haptic('success');
      toast('أُرسل طلبك للمدير — سيصلك الرد هنا');
      setReason('');
      setFiles([]);
      setSwapFrom('');
      setSwapTo('');
      onDone();
    } catch (e) {
      haptic('error');
      setErr(e instanceof Error ? e.message : 'تعذر إرسال الطلب');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="طلب جديد" subtitle="يصل لمديرك فوراً ويصلك الرد في التبليغات">
      <div className="t-form">
        <div className="t-choices">
          {TYPES.map(t => (
            <button
              key={t}
              type="button"
              className={`t-choice press ${type === t ? 'on' : ''}`}
              onClick={() => {
                haptic('select');
                setType(t);
                setErr('');
              }}
            >
              {LEAVE_ICON[t]}
              {LEAVE_LABEL[t]}
            </button>
          ))}
        </div>

        {type === 'swap' && (
          <>
            <div className="t-field">
              <span>يوم عطلتك الذي تريد العمل فيه</span>
              <DayPills days={offDays} value={swapFrom} onPick={setSwapFrom} />
            </div>
            <div className="t-field">
              <span>اليوم البديل للراحة</span>
              <DayPills days={workDays} value={swapTo} onPick={setSwapTo} alt />
            </div>
          </>
        )}

        {type === 'hours' && (
          <>
            <label className="t-field">
              <span>اليوم</span>
              <input className="t-input sm" type="date" min={today} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
            </label>
            <div className="t-row-2">
              <label className="t-field">
                <span>من الساعة</span>
                <input className="t-input sm" type="time" value={tFrom} onChange={e => setTFrom(e.target.value)} />
              </label>
              <label className="t-field">
                <span>إلى الساعة</span>
                <input className="t-input sm" type="time" value={tTo} onChange={e => setTTo(e.target.value)} />
              </label>
            </div>
            <p style={{ marginTop: -6, fontSize: 12.5, color: 'var(--ink-3)' }}>
              خروج {time12(tFrom)} والعودة {time12(tTo)}
            </p>
          </>
        )}

        {(type === 'day' || type === 'sick' || type === 'urgent') && (
          <div className="t-row-2">
            <label className="t-field">
              <span>من</span>
              <input
                className="t-input sm"
                type="date"
                min={minDate}
                value={from}
                onChange={e => {
                  if (!e.target.value) return;
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                }}
              />
            </label>
            <label className="t-field">
              <span>إلى</span>
              <input className="t-input sm" type="date" min={from} value={to} onChange={e => e.target.value && setTo(e.target.value)} />
            </label>
          </div>
        )}

        {type === 'sick' && (
          <div className="t-field">
            <span>صورة التقرير الطبي (اختياري)</span>
            <ImagePicker value={files} onChange={setFiles} upload={staffApi.upload} max={1} />
          </div>
        )}

        <label className="t-field">
          <span>{type === 'urgent' ? 'السبب (مطلوب)' : 'ملاحظة للمدير (اختياري)'}</span>
          <textarea className="t-textarea" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="اكتب باختصار…" />
        </label>

        {err && (
          <p className="t-hint bad" role="alert" style={{ marginTop: -6 }}>
            {err}
          </p>
        )}
        <button type="button" className="t-btn block press" disabled={busy} onClick={() => void submit()}>
          {busy ? <span className="spinner" /> : 'إرسال الطلب'}
        </button>
      </div>
    </Sheet>
  );
}
