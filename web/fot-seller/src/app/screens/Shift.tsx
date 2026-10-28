import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, ErrorLine, Fab, I, Screen, Sheet, Skeleton, toast } from '../kit';
import { haptic } from '../native';
import { BackBtn, LEAVE_ICON, Lightbox, StatusBadge } from '../parts';
import { AttendCard, AttendHistory } from './Attend';
import { LeaveRequest } from './LeaveRequest';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
import { LEAVE_LABEL, dateShort, leaveWhen, offNames, relTime, staffApi, useLoad, type DayState, type LeaveReq } from '../work';

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
        <Fab
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          }
          label="طلب جديد"
          onClick={() => setForm(true)}
        />
      )}

      {data && (
        <LeaveRequest
          open={form}
          days={data.days}
          weeklyOff={data.weeklyOff}
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
