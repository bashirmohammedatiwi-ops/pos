import { useEffect, useMemo, useState } from 'react';
import type { TeamDirStaffDto, TeamShiftDto } from '@/api/types';
import { Btn, Field, Input, Modal, Select, Switch } from '@/components/ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * وقت دوام الموظف لكل يوم من الأسبوع: بداية ونهاية ليوم أو عطلته الأسبوعية،
 * مع الاستراحة والأوفر تايم. الأيام بترتيب السبت … الجمعة كما في خادم الفريق.
 * ───────────────────────────────────────────────────────────────────────────── */

export const SHIFT_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

type DayRow = { start: string; end: string; off: boolean };
export type ShiftSave = {
  start: string;
  end: string;
  week: ({ start: string; end: string } | null)[] | null;
  weeklyOff: number;
  breakMinutes: number;
  maxBreaks: number;
  overtime: boolean;
  overtimeRate: number | null;
};

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
/** مدة الدوام بالدقائق؛ النهاية قبل البداية تعني أنه ينتهي في اليوم التالي */
const spanMin = (start: string, end: string) => {
  const d = toMin(end) - toMin(start);
  return d <= 0 ? d + 1440 : d;
};
const dur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} س ${m} د` : `${h} س`;
};
const daysFrom = (sh: TeamShiftDto, mask: number): DayRow[] =>
  SHIFT_DAYS.map((_, i) => ({
    start: sh.week?.[i]?.start ?? sh.baseStart ?? sh.start,
    end: sh.week?.[i]?.end ?? sh.baseEnd ?? sh.end,
    off: ((mask >> i) & 1) === 1,
  }));

/** ملخص الأسبوع بجمع الأيام المتتالية ذات الوقت نفسه: «السبت – الأربعاء 10:00–18:00 · الجمعة عطلة» */
export function shiftWeekLines(sh: TeamShiftDto, staff: Pick<TeamDirStaffDto, 'weeklyOff' | 'plan'>): string[] {
  const mask = (staff.plan ?? 'weekly') === 'weekly' ? staff.weeklyOff : 0;
  const texts = daysFrom(sh, mask).map(d => (d.off ? 'عطلة' : `${d.start}–${d.end}`));
  const lines: string[] = [];
  for (let i = 0; i < 7; ) {
    let k = i;
    while (k < 6 && texts[k + 1] === texts[i]) k++;
    if (i === 0 && k === 6) return [`كل الأيام ${texts[i]}`];
    lines.push(`${i === k ? SHIFT_DAYS[i] : `${SHIFT_DAYS[i]} – ${SHIFT_DAYS[k]}`} ${texts[i]}`);
    i = k + 1;
  }
  return lines;
}

export function TeamShiftModal({
  staff,
  shift,
  others,
  saving,
  onSave,
  onReset,
  onClose,
}: {
  staff: TeamDirStaffDto | null;
  shift?: TeamShiftDto;
  others: { staff: TeamDirStaffDto; shift: TeamShiftDto }[];
  saving: boolean;
  onSave: (v: ShiftSave) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [breakMinutes, setBreakMinutes] = useState('');
  const [maxBreaks, setMaxBreaks] = useState('');
  const [overtime, setOvertime] = useState(false);
  const [overtimeRate, setOvertimeRate] = useState('');
  const plan = staff?.plan ?? 'weekly';
  const hasOff = plan === 'weekly';

  useEffect(() => {
    if (!staff || !shift) return;
    setDays(daysFrom(shift, hasOff ? staff.weeklyOff : 0));
    setBreakMinutes(String(shift.breakMinutes));
    setMaxBreaks(String(shift.maxBreaks));
    setOvertime(!!shift.overtime);
    setOvertimeRate(shift.overtimeRate ? String(shift.overtimeRate) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff?.id]);

  const patch = (i: number, p: Partial<DayRow>) => setDays(list => list.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const working = days.filter(d => !d.off);

  // نفس فحص الخادم، ليظهر عند اليوم قبل الحفظ
  const errors = useMemo(
    () =>
      days.map((d, i) => {
        if (d.off) return '';
        if (!d.start || !d.end) return 'حدّد البداية والنهاية';
        if (d.start === d.end) return 'البداية والنهاية متساويتان';
        const next = days[(i + 1) % 7];
        const nextName = SHIFT_DAYS[(i + 1) % 7];
        if (!next.off && next.start && spanMin(d.start, d.end) + toMin(d.start) - 1440 > toMin(next.start)) return `ينتهي بعد بداية دوام ${nextName}`;
        return '';
      }),
    [days],
  );
  const net = (d: DayRow) => Math.max(0, spanMin(d.start, d.end) - (Number(breakMinutes) || 0));
  const weekTotal = working.every(d => d.start && d.end) ? working.reduce((x, d) => x + net(d), 0) : 0;

  function save() {
    const counts = new Map<string, number>();
    for (const d of working) counts.set(`${d.start}-${d.end}`, (counts.get(`${d.start}-${d.end}`) ?? 0) + 1);
    // الوقت الأكثر تكراراً هو وردية الموظف، فيرجع إليه يوم العطلة إذا حضر فيه
    const [start, end] = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `${days[0].start}-${days[0].end}`).split('-');
    const week = counts.size > 1 ? days.map(d => (d.off ? null : { start: d.start, end: d.end })) : null;
    const weeklyOff = days.reduce((m, d, i) => (d.off ? m | (1 << i) : m), 0);
    onSave({ start, end, week, weeklyOff, breakMinutes: Number(breakMinutes) || 0, maxBreaks: Number(maxBreaks) || 0, overtime, overtimeRate: overtimeRate ? Number(overtimeRate) : null });
  }

  return (
    <Modal
      open={!!staff}
      onClose={onClose}
      size="lg"
      title={`وقت دوام ${staff?.name ?? ''}`}
      subtitle="التأخير والأوفر تايم والإغلاق التلقائي تُحسب من وقت كل يوم"
      footer={
        <>
          <Btn variant="ghost" onClick={onReset}>
            الرجوع للافتراضي
          </Btn>
          <Btn variant="secondary" onClick={onClose}>
            إلغاء
          </Btn>
          <Btn loading={saving} disabled={plan !== 'hourly' && errors.some(Boolean)} onClick={save}>
            حفظ
          </Btn>
        </>
      }
    >
      {staff && days.length === 7 && (
        <div className="space-y-3">
          {plan === 'hourly' ? (
            <div className="rounded-lg bg-violet-50 p-3 text-[12.5px] font-semibold text-violet-800">حسابه بالساعات، فلا وقت دوام له ولا تأخير. نوع الدوام يُغيَّر من صفحة الموظفين.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12.5px] text-slate-500">
                  {working.length} أيام دوام{weekTotal > 0 && <> · <b className="num text-slate-700">{dur(weekTotal)}</b> صافي في الأسبوع</>}
                </div>
                {others.length > 0 && (
                  <div className="w-52">
                    <Select
                      aria-label="نسخ الدوام من موظف آخر"
                      value=""
                      onChange={e => {
                        const o = others.find(x => x.staff.id === Number(e.target.value));
                        if (o) setDays(daysFrom(o.shift, hasOff && (o.staff.plan ?? 'weekly') === 'weekly' ? o.staff.weeklyOff : 0));
                      }}
                    >
                      <option value="">نسخ من موظف آخر…</option>
                      {others.map(o => (
                        <option key={o.staff.id} value={o.staff.id}>
                          {o.staff.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {days.map((d, i) => (
                  <div key={i} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-16 shrink-0 text-[13px] font-bold text-slate-800">{SHIFT_DAYS[i]}</div>
                      {hasOff && (
                        <Switch
                          label={d.off ? 'عطلة' : 'دوام'}
                          checked={!d.off}
                          onChange={v => patch(i, { off: !v })}
                        />
                      )}
                      {d.off ? (
                        <span className="text-[12.5px] text-slate-400">لا دوام في هذا اليوم</span>
                      ) : (
                        <>
                          <div className="w-[7.5rem]">
                            <Input type="time" aria-label={`بداية ${SHIFT_DAYS[i]}`} value={d.start} onChange={e => patch(i, { start: e.target.value })} />
                          </div>
                          <span className="text-slate-400">إلى</span>
                          <div className="w-[7.5rem]">
                            <Input type="time" aria-label={`نهاية ${SHIFT_DAYS[i]}`} value={d.end} onChange={e => patch(i, { end: e.target.value })} />
                          </div>
                          {d.start && d.end && d.start !== d.end && (
                            <span className="num text-[11.5px] text-slate-500">
                              {dur(spanMin(d.start, d.end))}
                              {toMin(d.end) < toMin(d.start) && ' · ينتهي في اليوم التالي'}
                            </span>
                          )}
                          <Btn
                            size="xs"
                            variant="ghost"
                            className="ms-auto"
                            onClick={() => setDays(list => list.map(x => (x.off ? x : { ...x, start: d.start, end: d.end })))}
                          >
                            لكل الأيام
                          </Btn>
                        </>
                      )}
                    </div>
                    {errors[i] && <div className="mt-1 text-[11.5px] font-semibold text-red-600">{errors[i]}</div>}
                  </div>
                ))}
              </div>
              {!hasOff && <p className="text-[11.5px] text-slate-500">حسابه بإجازات شهرية، فلا عطلة أسبوعية له، ووقت كل يوم يبقى ساري المفعول إلا في أيام إجازته.</p>}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="دقائق الاستراحة">
              <Input inputMode="numeric" value={breakMinutes} onChange={e => setBreakMinutes(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="عدد الاستراحات">
              <Input inputMode="numeric" value={maxBreaks} onChange={e => setMaxBreaks(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <Switch
              label="احتساب الأوفر تايم لهذا الموظف"
              description="الوقت الزائد على دوام ذلك اليوم الصافي يُسجَّل أوفر تايم ويظهر في الملخص الشهري وفي تطبيقه"
              checked={overtime}
              onChange={setOvertime}
            />
            {overtime && (
              <Field label="أجر ساعة الأوفر تايم (دينار) — اختياري" hint="لحساب مبلغ الأوفر تايم في الملخص الشهري">
                <Input inputMode="numeric" value={overtimeRate} onChange={e => setOvertimeRate(e.target.value.replace(/\D/g, ''))} placeholder="مثال: 5000" />
              </Field>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
