import { useMemo, useState } from 'react';
import { KIND_LABEL } from '../../team';
import { Badge, Empty, ErrorLine, I, Screen, Segmented, Skeleton, toast } from '../kit';
import { haptic } from '../native';
import { BackBtn } from '../parts';
import { dur, hhmm } from '../screens/Attend';
import { WEEK_DAYS, managerAttendApi, shortDay, useLoad, type SummaryRow } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * تقارير المدير: ملخص الشهر لكل موظف (حضور، غياب، تأخير، أوفر تايم ومبلغه)
 * وجدول الفريق الأسبوعي (من في الدوام ومن في عطلة/إجازة) — حسب أقسام المدير.
 * ───────────────────────────────────────────────────────────────────────────── */

const iraqDate = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
/** اسم اليوم المختصر من التاريخ (السبت = 0 كما في الخادم) */
const dayName = (d: string) => shortDay(WEEK_DAYS[(new Date(`${d}T12:00:00Z`).getUTCDay() + 1) % 7]);
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const monthEnd = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const shiftMonth = (d: string, n: number) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const monthLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ar-IQ-u-nu-latn', { month: 'long', year: 'numeric' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const OFF_REASON: Record<string, string> = { weekly: 'عطلة', swap: 'تبديل', day: 'إجازة', sick: 'مرضية', urgent: 'طارئة', hours: 'استئذان' };

type View = 'month' | 'week';

/** كشف الحضور الشهري بصيغة Excel (يُشارك من الهاتف) */
async function exportMonth(label: string, rows: SummaryRow[]) {
  const { downloadXlsxFile } = await import('../../xlsx');
  const head = ['الموظف', 'القسم', 'أيام الدوام', 'حضر', 'غياب', 'إجازات', 'عطل', 'الساعات', 'تأخير (د)', 'استراحة (د)', 'تجاوز (د)', 'أوفر تايم (د)', 'مبلغ الأوفر تايم'];
  downloadXlsxFile(
    `حضور-الفريق-${label}`,
    [
      {
        name: 'الحضور',
        rtl: true,
        columnWidths: [170, 110, 70, 60, 60, 60, 60, 70, 70, 80, 70, 90, 110],
        rows: [
          { height: 28, cells: [{ value: `حضور الفريق — ${label}`, style: 'title', mergeAcross: head.length - 1 }] },
          { height: 22, cells: head.map(value => ({ value, style: 'head' })) },
          ...rows.map(r => ({
            cells: [
              { value: r.name, style: 'text' },
              { value: r.sectionName ?? '', style: 'text' },
              ...[r.scheduledDays, r.presentDays, r.absentDays, r.leaveDays, r.offDays].map(value => ({ value, style: 'num', type: 'Number' as const })),
              { value: hhmm(r.workedMinutes), style: 'num' },
              ...[r.lateMinutes, r.breakMinutes, r.overMinutes, r.overtimeMinutes, r.overtimePay ?? 0].map(value => ({ value, style: 'num', type: 'Number' as const })),
            ],
          })),
        ],
      },
    ],
    [
      { id: 'title', fontSize: 14, bold: true, color: 'FFFFFF', bg: '4C2A85', align: 'center', valign: 'center' },
      { id: 'head', fontSize: 10, bold: true, color: 'FFFFFF', bg: '6D45C9', align: 'center', valign: 'center', wrap: true, border: 'thin' },
      { id: 'text', fontSize: 10, valign: 'center', border: 'thin' },
      { id: 'num', fontSize: 10, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
    ],
  );
}

export function MReports() {
  const [view, setView] = useState<View>('month');
  return (
    <Screen title="تقارير الفريق" subtitle={view === 'month' ? 'الحضور والأوفر تايم لكل موظف' : 'من في الدوام هذا الأسبوع'} start={<BackBtn to="/m/more" />}>
      <Segmented
        items={[
          { id: 'month', label: 'ملخص الشهر' },
          { id: 'week', label: 'جدول الأسبوع' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'month' ? <MonthView /> : <WeekView />}
    </Screen>
  );
}

function MonthView() {
  const [month, setMonth] = useState(() => monthStart(iraqDate()));
  const [sort, setSort] = useState<'ot' | 'absent' | 'name'>('absent');
  const { data, err, reload } = useLoad(() => managerAttendApi.summary(month, monthEnd(month)), ['attend'], [month]);
  const isCurrent = month === monthStart(iraqDate());

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    if (sort === 'ot') list.sort((a, b) => b.overtimeMinutes - a.overtimeMinutes || a.name.localeCompare(b.name, 'ar'));
    else if (sort === 'absent') list.sort((a, b) => Number(a.joined === false) - Number(b.joined === false) || b.absentDays - a.absentDays || b.lateMinutes - a.lateMinutes);
    else list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return list;
  }, [data, sort]);
  const t = useMemo(() => {
    const r = data?.rows ?? [];
    return {
      worked: r.reduce((s, x) => s + x.workedMinutes, 0),
      ot: r.reduce((s, x) => s + x.overtimeMinutes, 0),
      pay: r.reduce((s, x) => s + (x.overtimePay ?? 0), 0),
      absent: r.reduce((s, x) => s + x.absentDays, 0),
      otStaff: r.filter(x => x.overtimeEnabled).length,
    };
  }, [data]);

  return (
    <>
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
      {!data ? (
        <Skeleton h={320} r={22} />
      ) : (
        <>
          <div className="t-stats" style={{ marginTop: 12 }}>
            <div className="t-stat">
              <span>ساعات الفريق</span>
              <b className="num ltr">{hhmm(t.worked)}</b>
            </div>
            <div className="t-stat">
              <span>الأوفر تايم</span>
              <b className="num ltr" style={{ color: 'var(--brand-2)' }}>
                {hhmm(t.ot)}
              </b>
              <em>{t.pay ? `${t.pay.toLocaleString('en-US')} د.ع` : `${t.otStaff} مفعّل لهم`}</em>
            </div>
            <div className="t-stat">
              <span>أيام الغياب</span>
              <b className="num" style={t.absent ? { color: 'var(--bad)' } : undefined}>
                {t.absent}
              </b>
            </div>
          </div>

          <button
            type="button"
            className="t-btn soft block sm press"
            style={{ marginTop: 12 }}
            onClick={() => {
              haptic('tap');
              void exportMonth(monthLabel(month), rows).catch(() => toast('تعذر تجهيز الكشف'));
            }}
          >
            <I.sheet size={18} /> مشاركة كشف Excel
          </button>

          <div className="t-chips" style={{ marginTop: 14 }}>
            {(
              [
                ['ot', 'الأكثر أوفر تايم'],
                ['absent', 'الغياب والتأخير'],
                ['name', 'بالاسم'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className={`t-chip press ${sort === id ? 'on' : ''}`} onClick={() => setSort(id)}>
                {label}
              </button>
            ))}
          </div>

          {!rows.length ? (
            <Empty title="لا موظفين" text="لا موظفين ضمن أقسامك." />
          ) : (
            <div className="t-list" style={{ marginTop: 10 }}>
              {rows.map(r => (
                <SummaryItem key={r.staffId} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function SummaryItem({ r }: { r: SummaryRow }) {
  const rate = r.attendanceRate;
  return (
    <div className="t-row t-sum-row">
      <div className="body">
        <div className="title">
          {r.name} <small className="muted">{r.sectionName ?? KIND_LABEL[r.kind] ?? ''}</small>
        </div>
        <div className="sub">
          {r.joined === false ? 'لم يدخل التطبيق بعد' : r.hourly ? `حضر ${r.presentDays} يوم بالساعات` : `حضر ${r.presentDays} من ${r.scheduledDays}`}
          {r.absentDays ? <span style={{ color: 'var(--bad)' }}> · غياب {r.absentDays}</span> : null}
          {r.lateDays ? ` · تأخير ${dur(r.lateMinutes)}` : ''}
          {r.leaveDays ? ` · إجازة ${r.leaveDays}` : ''}
        </div>
        {r.overtimeEnabled && (
          <div className={`t-sum-ot ${r.overtimeMinutes ? 'on' : ''}`}>
            أوفر تايم <b className="num ltr">{hhmm(r.overtimeMinutes)}</b>
            {r.overtimeDays ? ` · ${r.overtimeDays} يوم` : ''}
            {r.overtimePay ? <span className="num"> · {r.overtimePay.toLocaleString('en-US')} د.ع</span> : null}
          </div>
        )}
      </div>
      <div className="end">
        <b className="num ltr">{hhmm(r.workedMinutes)}</b>
        {rate == null ? <small>—</small> : <Badge tone={rate >= 95 ? 'ok' : rate >= 80 ? 'warn' : 'bad'}>{rate}%</Badge>}
      </div>
    </div>
  );
}

function WeekView() {
  const today = iraqDate();
  const [from, setFrom] = useState(today);
  const { data, err, reload } = useLoad(() => managerAttendApi.roster(from, 7), ['leave'], [from]);
  return (
    <>
      <div className="t-month-nav">
        <button type="button" className="press flip" aria-label="الأسبوع السابق" onClick={() => setFrom(f => addDays(f, -7))}>
          <I.chevron size={18} />
        </button>
        <b>
          {from === today ? 'من اليوم' : `من ${from.slice(5).replace('-', '/')}`} · 7 أيام
        </b>
        <button type="button" className="press" aria-label="الأسبوع التالي" onClick={() => setFrom(f => addDays(f, 7))}>
          <I.chevron size={18} />
        </button>
      </div>
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {!data ? (
        <Skeleton h={320} r={22} />
      ) : !data.rows.length ? (
        <Empty title="لا موظفين" text="لا موظفين ضمن أقسامك." />
      ) : (
        <div className="t-roster" role="table" aria-label="جدول الفريق الأسبوعي">
          <div className="t-roster-row head" role="row">
            <span className="name" role="columnheader" />
            {data.dates.map((d, i) => (
              <span key={d} className={`cell ${d === today ? 'today' : ''}`} role="columnheader">
                <b>{dayName(d)}</b>
                <small className="num">{d.slice(8)}</small>
                <em className="num">{data.working[i]}</em>
              </span>
            ))}
          </div>
          {data.rows.map(r => (
            <div key={r.staffId} className="t-roster-row" role="row">
              <span className="name" role="rowheader">
                {r.name}
              </span>
              {r.cells.map(c => (
                <span key={c.date} className={`cell ${c.date === today ? 'today' : ''}`} role="cell">
                  {c.off ? <i className={c.reason === 'weekly' || c.reason === 'swap' ? 'off' : 'leave'}>{OFF_REASON[c.reason ?? ''] ?? 'إجازة'}</i> : <i className="on" aria-label="دوام" />}
                </span>
              ))}
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            الرقم تحت كل يوم = عدد من في الدوام. العطل والإجازات تُعدَّل من «الموافقات» و«الفريق والعطل».
          </p>
        </div>
      )}
    </>
  );
}
