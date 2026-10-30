import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { I, toast } from '../kit';
import { haptic, pushBack } from '../native';
import { ImagePicker, LEAVE_ICON } from '../parts';
import { WEEK_DAYS, attendApi, staffApi, time12, useLoad, type DayState, type LeaveType, type MonthBalance } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * طلب جديد — شاشة كاملة بخطوتين مصممة للهاتف:
 *  1) نوع الطلب: بطاقات كبيرة واضحة مع شرح سطر واحد.
 *  2) التفاصيل: تقويم شهري يُختار عليه اليوم أو المدة بلمستين، وأزرار وقت سريعة للاستئذان،
 *     وبطاقات أيام للتبديل، وأسباب جاهزة. ملخص الطلب وزر الإرسال ثابتان أسفل الشاشة.
 * ───────────────────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
/** السبت = 0 كما في الخادم */
const dayIdx = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 1) % 7;
const WD_SHORT = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const dm = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const dayLabel = (iso: string) => `${WEEK_DAYS[dayIdx(iso)]} ${dm(iso)}`;
const daysWord = (n: number) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يوماً`);
const hmToMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const minToHm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const durLabel = (m: number) => (m < 60 ? `${m} دقيقة` : m === 60 ? 'ساعة' : m === 120 ? 'ساعتان' : m % 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m / 60} ساعات`);

type TypeInfo = { type: LeaveType; title: string; desc: string; tone: string };
const TYPES: TypeInfo[] = [
  { type: 'day', title: 'إجازة', desc: 'يوم واحد أو عدة أيام', tone: 'brand' },
  { type: 'hours', title: 'استئذان', desc: 'خروج لساعات خلال الدوام', tone: 'accent' },
  { type: 'swap', title: 'تبديل العطلة', desc: 'تعمل يوم عطلتك وترتاح يوماً آخر', tone: 'ok' },
  { type: 'sick', title: 'إجازة مرضية', desc: 'مع صورة التقرير الطبي — حتى 7 أيام سابقة', tone: 'bad' },
  { type: 'urgent', title: 'إجازة طارئة', desc: 'ظرف مفاجئ — اذكر السبب', tone: 'warn' },
];
const REASONS: Partial<Record<LeaveType, string[]>> = {
  day: ['ظرف عائلي', 'سفر', 'مناسبة', 'معاملة رسمية'],
  hours: ['مراجعة طبية', 'معاملة رسمية', 'ظرف عائلي', 'توصيل الأطفال'],
  swap: ['ظرف عائلي', 'مناسبة', 'موعد مهم'],
  sick: ['حمّى', 'مراجعة طبيب', 'عملية/علاج'],
  urgent: ['حالة طارئة في العائلة', 'وفاة', 'حادث', 'ظرف صحي'],
};

/* ═════════════ تقويم شهري لاختيار يوم أو مدة ═════════════ */
function RangeCalendar({
  from,
  to,
  min,
  max,
  isOff,
  onPick,
}: {
  from: string | null;
  to: string | null;
  min: string;
  max: string;
  isOff: (d: string) => 'weekly' | 'leave' | null;
  onPick: (d: string) => void;
}) {
  const [month, setMonth] = useState(() => (from ?? min).slice(0, 7));
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = dayIdx(first);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const prevOk = first > min.slice(0, 7) + '-01' || month > min.slice(0, 7);
  const nextOk = month < max.slice(0, 7);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
    haptic('select');
  };
  const end = to ?? from;
  return (
    <div className="t-cal2">
      <div className="t-cal2-head">
        <button type="button" className="press flip" aria-label="الشهر السابق" disabled={!prevOk || month <= min.slice(0, 7)} onClick={() => shift(-1)}>
          <I.chevron size={18} />
        </button>
        <b>
          {MONTHS[m - 1]} <span className="num">{y}</span>
        </b>
        <button type="button" className="press" aria-label="الشهر التالي" disabled={!nextOk} onClick={() => shift(1)}>
          <I.chevron size={18} />
        </button>
      </div>
      <div className="t-cal2-grid" role="grid">
        {WD_SHORT.map(w => (
          <span key={w} className="wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const disabled = d < min || d > max;
          const off = isOff(d);
          const inRange = !!from && !!end && d >= from && d <= end;
          const edge = d === from || d === end;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-selected={inRange}
              disabled={disabled}
              className={`d ${inRange ? 'in' : ''} ${edge ? 'edge' : ''} ${d === from ? 'start' : ''} ${d === end ? 'end' : ''} ${off ? `off ${off}` : ''}`}
              onClick={() => {
                haptic('select');
                onPick(d);
              }}
            >
              <span className="num">{Number(d.slice(8))}</span>
              {off && <i />}
            </button>
          );
        })}
      </div>
      <div className="t-cal2-legend">
        <span>
          <i className="weekly" /> عطلتك
        </span>
        <span>
          <i className="leave" /> إجازة سابقة
        </span>
      </div>
    </div>
  );
}

/* ═════════════ الشاشة ═════════════ */
export function LeaveRequest({
  open,
  days,
  weeklyOff,
  monthly,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  days: DayState[];
  weeklyOff: number;
  /** من إجازاته شهرية: رصيد هذا الشهر والقادم (وليس له تبديل عطلة) */
  monthly?: MonthBalance[] | null;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<LeaveType | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [swapTo, setSwapTo] = useState<string | null>(null);
  const [hDay, setHDay] = useState<string | null>(null);
  const [tFrom, setTFrom] = useState('14:00');
  const [tTo, setTTo] = useState('16:00');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const shiftQ = useLoad(() => attendApi.state(), [], [open]);
  const shift = shiftQ.data?.shift;

  // حالة كل يوم: من جدول الخادم (21 يوماً) وإلا من نمط العطلة الأسبوعية
  const known = useMemo(() => new Map(days.map(d => [d.date, d])), [days]);
  const isOff = (d: string): 'weekly' | 'leave' | null => {
    const s = known.get(d);
    if (s) return s.off ? (s.reason === 'weekly' || s.reason === 'swap' ? 'weekly' : 'leave') : null;
    return (weeklyOff >> dayIdx(d)) & 1 ? 'weekly' : null;
  };

  // إغلاق بزر الرجوع، ومنع تمرير الصفحة خلف الشاشة
  const close = useRef(onClose);
  close.current = onClose;
  const stepRef = useRef(type);
  stepRef.current = type;
  useEffect(() => {
    if (!open) return;
    const off = pushBack(() => (stepRef.current ? setType(null) : close.current()));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      off();
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => {
    if (open) return;
    setType(null);
    setFrom(null);
    setTo(null);
    setSwapFrom(null);
    setSwapTo(null);
    setHDay(null);
    setReason('');
    setFiles([]);
    setErr('');
  }, [open]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    // كل نوع يبدأ بتفاصيل نظيفة (السبب والمرفق لا ينتقلان بين الأنواع)
    setErr('');
    setReason('');
    setFiles([]);
  }, [type]);

  if (!open) return null;

  const min = type === 'sick' ? addDays(today, -7) : today;
  const max = addDays(today, 60);
  const span = from ? diffDays(from, to ?? from) + 1 : 0;
  const offInRange = from ? Array.from({ length: span }, (_, i) => addDays(from, i)).filter(d => isOff(d) === 'weekly').length : 0;
  const upcoming = Array.from({ length: 30 }, (_, i) => addDays(today, i));
  const offDays = upcoming.filter(d => isOff(d) === 'weekly');
  const workDays = upcoming.filter(d => !isOff(d));
  const hoursDays = Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter(d => !isOff(d));
  const hFrom = hmToMin(tFrom);
  const hTo = hmToMin(tTo);
  const hDur = hTo - hFrom;

  function pickDay(d: string) {
    setErr('');
    if (!from || to) {
      setFrom(d);
      setTo(null);
    } else if (d < from) {
      setFrom(d);
    } else if (diffDays(from, d) > 30) {
      setErr('أقصى مدة للطلب 31 يوماً');
    } else {
      setTo(d);
    }
  }
  function setDuration(mins: number) {
    haptic('select');
    setTTo(minToHm(Math.min(hFrom + mins, 23 * 60 + 59)));
  }

  // ملخص الطلب وصلاحيته
  let summary: ReactNode = null;
  let valid = false;
  if (type === 'day' || type === 'sick' || type === 'urgent') {
    valid = !!from && (type !== 'urgent' || !!reason.trim());
    summary = from ? (
      <>
        <b>{daysWord(span)}</b> · {span === 1 ? dayLabel(from) : `${dayLabel(from)} ← ${dayLabel(to ?? from)}`}
        {offInRange > 0 && <small> (منها {offInRange === 1 ? 'يوم عطلة' : `${offInRange} أيام عطلة`})</small>}
      </>
    ) : (
      'اختر اليوم من التقويم — ولمدة أطول المس يوم البداية ثم يوم النهاية'
    );
  } else if (type === 'hours') {
    valid = !!hDay && hDur > 0;
    summary = hDay ? (
      <>
        <b>{hDur > 0 ? durLabel(hDur) : '—'}</b> · {dayLabel(hDay)} · {time12(tFrom)} ← {time12(tTo)}
      </>
    ) : (
      'اختر اليوم ثم وقت الخروج والعودة'
    );
  } else if (type === 'swap') {
    valid = !!swapFrom && !!swapTo;
    summary =
      swapFrom && swapTo ? (
        <>
          تعمل <b>{dayLabel(swapFrom)}</b> وترتاح <b>{dayLabel(swapTo)}</b>
        </>
      ) : swapFrom ? (
        'اختر اليوم الذي ترتاح فيه بدلاً منه'
      ) : (
        'اختر يوم العطلة الذي ستعمل فيه'
      );
  }

  async function submit() {
    if (!type || !valid || busy) return;
    setErr('');
    const body: Record<string, unknown> = { type, reason: reason.trim() || undefined };
    if (type === 'swap') Object.assign(body, { swapFrom, swapTo });
    else if (type === 'hours') Object.assign(body, { dateFrom: hDay, timeFrom: tFrom, timeTo: tTo });
    else Object.assign(body, { dateFrom: from, dateTo: to ?? from, attachment: files[0] });
    setBusy(true);
    try {
      await staffApi.requestLeave(body);
      haptic('success');
      toast('أُرسل طلبك للمدير — يصلك الرد في التبليغات');
      onDone();
    } catch (e) {
      haptic('error');
      setErr(e instanceof Error ? e.message : 'تعذر إرسال الطلب');
    } finally {
      setBusy(false);
    }
  }

  const info = TYPES.find(t => t.type === type);

  return createPortal(
    <div className="t-lr" role="dialog" aria-modal="true" aria-label="طلب جديد">
      <header className="t-lr-head">
        <button
          type="button"
          className="t-icon-btn press"
          aria-label={type ? 'رجوع' : 'إغلاق'}
          onClick={() => {
            haptic('tap');
            if (type) setType(null);
            else onClose();
          }}
        >
          {type ? <I.back size={20} /> : <I.close size={20} />}
        </button>
        <div className="title">
          <b>{info ? info.title : 'طلب جديد'}</b>
          <small>{type ? 'الخطوة 2 من 2 · التفاصيل' : 'الخطوة 1 من 2 · ماذا تحتاج؟'}</small>
        </div>
        <div className="steps" aria-hidden>
          <i className="on" />
          <i className={type ? 'on' : ''} />
        </div>
      </header>

      <div className="t-lr-body" ref={bodyRef}>
        {!type ? (
          <div className="t-lr-types">
            {TYPES.filter(t => !(monthly && t.type === 'swap')).map((t, i) => (
              <button
                key={t.type}
                type="button"
                className="t-lr-type press"
                style={{ animationDelay: `${i * 40}ms` }}
                onClick={() => {
                  haptic('tap');
                  setType(t.type);
                  if (t.type === 'hours' && !hDay) setHDay(hoursDays[0] ?? today);
                }}
              >
                <span className={`t-tile lg ${t.tone}`}>{LEAVE_ICON[t.type]}</span>
                <span className="txt">
                  <b>{t.title}</b>
                  <small>{monthly && t.type === 'day' ? `متبقي لك ${monthly[0].left} من ${monthly[0].allowance} هذا الشهر و${monthly[1].left} الشهر القادم` : t.desc}</small>
                </span>
                <span className="go">
                  <I.chevron size={18} />
                </span>
              </button>
            ))}
            <p className="t-lr-note">يصل طلبك لمديرك فوراً، ويصلك الرد في التبليغات. يمكنك إلغاء الطلب ما دام بانتظار الموافقة.</p>
          </div>
        ) : (
          <div className="t-lr-form">
            {(type === 'day' || type === 'sick' || type === 'urgent') && (
              <section>
                <h3>{type === 'sick' ? 'أيام المرض' : 'أيام الإجازة'}</h3>
                <RangeCalendar from={from} to={to} min={min} max={max} isOff={isOff} onPick={pickDay} />
              </section>
            )}

            {type === 'hours' && (
              <>
                <section>
                  <h3>اليوم</h3>
                  <div className="t-lr-days">
                    {hoursDays.map(d => (
                      <button key={d} type="button" className={`press ${hDay === d ? 'on' : ''}`} onClick={() => (haptic('select'), setHDay(d))}>
                        <small>{d === today ? 'اليوم' : d === addDays(today, 1) ? 'غداً' : WD_SHORT[dayIdx(d)]}</small>
                        <b className="num">{dm(d)}</b>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>الوقت</h3>
                  <div className="t-lr-times">
                    <label>
                      <small>الخروج</small>
                      <input type="time" value={tFrom} onChange={e => e.target.value && setTFrom(e.target.value)} />
                      <b>{time12(tFrom)}</b>
                    </label>
                    <span className="arrow" aria-hidden>
                      <I.chevron size={18} />
                    </span>
                    <label>
                      <small>العودة</small>
                      <input type="time" value={tTo} onChange={e => e.target.value && setTTo(e.target.value)} />
                      <b>{time12(tTo)}</b>
                    </label>
                  </div>
                  <div className="t-lr-chips">
                    {[30, 60, 120, 180].map(mm => (
                      <button key={mm} type="button" className={`press ${hDur === mm ? 'on' : ''}`} onClick={() => setDuration(mm)}>
                        {durLabel(mm)}
                      </button>
                    ))}
                    {shift?.end && (
                      <button type="button" className={`press ${tTo === shift.end ? 'on' : ''}`} onClick={() => (haptic('select'), setTTo(shift.end))}>
                        حتى نهاية الدوام
                      </button>
                    )}
                  </div>
                  {hDur <= 0 && <p className="t-hint bad">وقت العودة يجب أن يكون بعد وقت الخروج</p>}
                </section>
              </>
            )}

            {type === 'swap' && (
              <>
                <section>
                  <h3>1 · يوم عطلتك الذي ستعمل فيه</h3>
                  {offDays.length ? (
                    <div className="t-lr-days">
                      {offDays.map(d => (
                        <button
                          key={d}
                          type="button"
                          className={`press off ${swapFrom === d ? 'on' : ''}`}
                          onClick={() => {
                            haptic('select');
                            setSwapFrom(d);
                            if (swapTo && Math.abs(diffDays(d, swapTo)) > 30) setSwapTo(null);
                          }}
                        >
                          <small>{WD_SHORT[dayIdx(d)]}</small>
                          <b className="num">{dm(d)}</b>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="t-hint">لم تُحدَّد عطلتك الأسبوعية بعد — راجع مديرك.</p>
                  )}
                </section>
                <section className={swapFrom ? '' : 'dim'}>
                  <h3>2 · اليوم الذي ترتاح فيه بدلاً منه</h3>
                  <div className="t-lr-days wrap">
                    {workDays.map(d => (
                      <button key={d} type="button" disabled={!swapFrom} className={`press ${swapTo === d ? 'on' : ''}`} onClick={() => (haptic('select'), setSwapTo(d))}>
                        <small>{d === today ? 'اليوم' : WD_SHORT[dayIdx(d)]}</small>
                        <b className="num">{dm(d)}</b>
                      </button>
                    ))}
                  </div>
                </section>
                {swapFrom && swapTo && (
                  <div className="t-lr-swap">
                    <div>
                      <small>تعمل</small>
                      <b>{dayLabel(swapFrom)}</b>
                    </div>
                    <span aria-hidden>{LEAVE_ICON.swap}</span>
                    <div>
                      <small>ترتاح</small>
                      <b>{dayLabel(swapTo)}</b>
                    </div>
                  </div>
                )}
              </>
            )}

            {type === 'sick' && (
              <section>
                <h3>صورة التقرير الطبي</h3>
                <ImagePicker value={files} onChange={setFiles} upload={staffApi.uploadLeave} max={1} />
                <p className="t-hint">اختيارية لكنها تسرّع الموافقة. تظهر لمديرك والإدارة فقط.</p>
              </section>
            )}

            <section>
              <h3>{type === 'urgent' ? 'السبب (مطلوب)' : 'ملاحظة لمديرك (اختيارية)'}</h3>
              <div className="t-lr-chips">
                {(REASONS[type] ?? []).map(r => (
                  <button key={r} type="button" className={`press ${reason === r ? 'on' : ''}`} onClick={() => (haptic('select'), setReason(reason === r ? '' : r))}>
                    {r}
                  </button>
                ))}
              </div>
              <textarea className="t-textarea" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="أو اكتب بكلماتك…" />
            </section>
          </div>
        )}
      </div>

      {type && (
        <footer className="t-lr-foot">
          {err && (
            <p className="t-hint bad" role="alert">
              {err}
            </p>
          )}
          <div className="sum">{summary}</div>
          <button type="button" className="t-btn block press" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? <span className="spinner" /> : 'إرسال الطلب'}
          </button>
        </footer>
      )}
    </div>,
    document.body,
  );
}
