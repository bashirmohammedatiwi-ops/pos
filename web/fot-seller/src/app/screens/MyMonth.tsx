import { useState } from 'react';
import { Badge, Empty, ErrorLine, I, Ring, Screen, Skeleton, clockLabel } from '../kit';
import { BackBtn } from '../parts';
import { LEAVE_LABEL, attendApi, dateTiny, useLoad } from '../work';
import { dur, hhmm } from './Attend';

/* ─────────────────────────────────────────────────────────────────────────────
 * تقريري الشهري: نسبة الحضور، الساعات، التأخير، الأوفر تايم، الاستراحات،
 * يوم بيوم، وإجازات السنة المعتمدة.
 * ───────────────────────────────────────────────────────────────────────────── */

const REASON: Record<string, string> = { weekly: 'عطلة أسبوعية', swap: 'تبديل', day: 'إجازة', sick: 'مرضية', urgent: 'طارئة', hours: 'استئذان' };
const iraqMonth = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('ar-IQ-u-nu-latn', { month: 'long', year: 'numeric' });

export function MyMonth({ back = '/shift' }: { back?: string }) {
  const [month, setMonth] = useState(iraqMonth);
  const { data, err, reload } = useLoad(() => attendApi.month(month), ['attend'], [month]);
  const isCurrent = month === iraqMonth();
  const r = data?.row;
  return (
    <Screen title="تقريري الشهري" subtitle="حضوري وساعاتي وأوفر تايم" start={<BackBtn to={back} />} onRefresh={reload}>
      <div className="t-month-nav">
        <button type="button" className="press flip" aria-label="الشهر السابق" onClick={() => setMonth(m => shiftMonth(m, -1))}>
          <I.chevron size={18} />
        </button>
        <b>{monthLabel(month)}</b>
        <button type="button" className="press" aria-label="الشهر التالي" disabled={isCurrent} onClick={() => setMonth(m => shiftMonth(m, 1))}>
          <I.chevron size={18} />
        </button>
      </div>
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {!data && !err ? (
        <Skeleton h={320} r={22} />
      ) : !r ? (
        data && <Empty icon={<I.calendar size={30} />} title="لا بيانات لهذا الشهر" />
      ) : (
        <>
          <section className="t-card pad m-head">
            <Ring value={r.attendanceRate ?? 0} size={78} stroke={8} tone={(r.attendanceRate ?? 0) >= 90 ? 'ok' : undefined} label={r.attendanceRate == null ? '—' : `${r.attendanceRate}%`} />
            <div>
              <b className="num">
                {r.presentDays} <small>من {r.scheduledDays} يوم دوام</small>
              </b>
              <span>
                {r.absentDays ? `${r.absentDays} يوم غياب` : 'بلا غياب 👏'}
                {r.leaveDays ? ` · ${r.leaveDays} إجازة` : ''}
                {r.offDays ? ` · ${r.offDays} عطلة` : ''}
              </span>
            </div>
          </section>

          <div className="t-stats two" style={{ marginTop: 12 }}>
            <div className="t-stat">
              <span>ساعات العمل</span>
              <b className="num ltr">{hhmm(r.workedMinutes)}</b>
              <em className="num">معدل اليوم {hhmm(r.avgMinutes)}</em>
            </div>
            <div className="t-stat">
              <span>التأخير</span>
              <b className="num" style={r.lateMinutes ? { color: 'var(--warn)' } : undefined}>
                {r.lateMinutes ? dur(r.lateMinutes) : '—'}
              </b>
              <em>{r.lateDays ? `في ${r.lateDays} يوم` : 'في الموعد دائماً'}</em>
            </div>
            <div className="t-stat">
              <span>الأوفر تايم</span>
              <b className="num ltr">{r.overtimeEnabled ? hhmm(r.overtimeMinutes) : '—'}</b>
              <em>{r.overtimeEnabled ? (r.overtimePay ? `${r.overtimePay.toLocaleString('en-US')} د.ع` : `${r.overtimeDays} يوم`) : 'غير مفعّل لك'}</em>
            </div>
            <div className="t-stat">
              <span>الاستراحات</span>
              <b className="num">{dur(r.breakMinutes)}</b>
              <em>{r.overMinutes ? `تجاوز ${dur(r.overMinutes)}` : 'بلا تجاوز'}</em>
            </div>
          </div>

          {data!.leaves.length > 0 && (
            <section className="t-section">
              <div className="t-section-head">
                <h2>إجازاتي المعتمدة هذه السنة</h2>
              </div>
              <div className="t-chips">
                {data!.leaves.map(l => (
                  <span key={l.type} className="t-chip">
                    {LEAVE_LABEL[l.type as keyof typeof LEAVE_LABEL] ?? l.type} <b className="num">{l.n}</b>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="t-section">
            <div className="t-section-head">
              <h2>يوم بيوم</h2>
            </div>
            <div className="t-list flat m-days">
              {data!.days.map(d => (
                <div key={d.date} className="t-row">
                  <div className="body">
                    <div className="title">{dateTiny(d.date)}</div>
                    <div className="sub">
                      {d.checkIn ? (
                        <>
                          <span className="num">{clockLabel(d.checkIn)}</span> ← <span className="num">{d.checkOut ? clockLabel(d.checkOut) : 'لم يُسجَّل الانصراف'}</span>
                        </>
                      ) : d.off ? (
                        REASON[d.reason ?? ''] ?? 'عطلة'
                      ) : (
                        'لا حضور'
                      )}
                    </div>
                  </div>
                  <div className="end">
                    {d.checkIn ? <b className="num ltr">{hhmm(d.workedMinutes)}</b> : d.off ? <Badge tone="mute">{REASON[d.reason ?? ''] ?? 'عطلة'}</Badge> : <Badge tone="bad">غياب</Badge>}
                    {d.lateMinutes > 0 && <small className="num">تأخير {dur(d.lateMinutes)}</small>}
                    {d.overtimeMinutes > 0 && <small className="num">إضافي {dur(d.overtimeMinutes)}</small>}
                    {d.autoClosed && <small>أُغلق تلقائياً</small>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </Screen>
  );
}
