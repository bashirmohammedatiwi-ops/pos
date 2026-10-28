import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate, formatNum } from '@/api/client';
import type { TeamSummaryRowDto } from '@/api/types';
import { downloadXlsxFile, type XlsxRowInput } from '@/lib/xlsxBuilder';
import { useToast } from '@/components/Toast';
import { IconRefresh } from '@/components/icons';
import { Badge, Btn, Field, Input, Select, Switch, TableSkeleton, useConfirm } from '@/components/ui';
import { ErrorBlock, SearchBox } from '@/components/people/PeopleKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← التقارير: الملخص الشهري لكل موظف (حضور، غياب، تأخير، استراحات،
 * أوفر تايم ومبلغه) مع تصدير Excel، وجدول الفريق الأسبوعي (من في الدوام ومن في عطلة).
 * تطبيق الفريق ← التطبيق: إصدارات التطبيق (تحديث تلقائي للهواتف) وحالة الإشعارات.
 * ───────────────────────────────────────────────────────────────────────────── */

const KIND: Record<string, string> = { seller: 'بائع', cashier: 'كاشير', supervisor: 'مشرف', other: 'موظف' };
const iraqDate = (offsetDays = 0) => new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const hours = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
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
const DAY_SHORT = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
const dayIdx = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 1) % 7;
const OFF_REASON: Record<string, string> = { weekly: 'عطلة', swap: 'تبديل', day: 'إجازة', sick: 'مرضية', emergency: 'طارئة', annual: 'سنوية' };

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'brand' | 'warn' | 'ok' }) {
  const color = tone === 'brand' ? 'text-brand-700' : tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-800';
  return (
    <div className="card min-w-[140px] flex-1 px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-slate-500">{label}</div>
      <div className={`num mt-0.5 text-[20px] font-extrabold leading-tight ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

/* ═════════════ الملخص الشهري والأوفر تايم ═════════════ */
type ReportView = 'summary' | 'roster';

export function TeamReportPage() {
  const [view, setView] = useState<ReportView>('summary');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 gap-1">
        {(
          [
            ['summary', 'الملخص الشهري والأوفر تايم'],
            ['roster', 'جدول الفريق الأسبوعي'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${view === id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'summary' ? <SummaryView /> : <RosterView />}
    </div>
  );
}

function SummaryView() {
  const [month, setMonth] = useState(() => monthStart(iraqDate()));
  const [q, setQ] = useState('');
  const [onlyOt, setOnlyOt] = useState(false);
  const [sort, setSort] = useState<'name' | 'worked' | 'overtime' | 'late' | 'absent'>('name');
  const from = month;
  const to = monthEnd(month);
  const sumQ = useQuery({ queryKey: ['team-summary', from, to], queryFn: () => api.teamAttendSummary(from, to), retry: 0 });

  const rows = useMemo(() => {
    let list = sumQ.data?.rows ?? [];
    if (onlyOt) list = list.filter(r => r.overtimeEnabled);
    const t = q.trim();
    if (t) list = list.filter(r => r.name.includes(t) || (r.sectionName ?? '').includes(t));
    const by: Record<typeof sort, (a: TeamSummaryRowDto, b: TeamSummaryRowDto) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'ar'),
      worked: (a, b) => b.workedMinutes - a.workedMinutes,
      overtime: (a, b) => b.overtimeMinutes - a.overtimeMinutes,
      late: (a, b) => b.lateMinutes - a.lateMinutes,
      absent: (a, b) => b.absentDays - a.absentDays,
    };
    return [...list].sort(by[sort]);
  }, [sumQ.data, q, onlyOt, sort]);

  const totals = useMemo(() => {
    const r = sumQ.data?.rows ?? [];
    const rated = r.filter(x => x.attendanceRate != null);
    return {
      worked: r.reduce((s, x) => s + x.workedMinutes, 0),
      ot: r.reduce((s, x) => s + x.overtimeMinutes, 0),
      otPay: r.reduce((s, x) => s + (x.overtimePay ?? 0), 0),
      otStaff: r.filter(x => x.overtimeEnabled).length,
      late: r.reduce((s, x) => s + x.lateMinutes, 0),
      absent: r.reduce((s, x) => s + x.absentDays, 0),
      rate: rated.length ? Math.round(rated.reduce((s, x) => s + (x.attendanceRate ?? 0), 0) / rated.length) : null,
    };
  }, [sumQ.data]);

  function exportExcel() {
    if (!sumQ.data) return;
    const head = ['الموظف', 'النوع', 'القسم', 'أيام الدوام', 'حضر', 'غياب', 'عطلة', 'إجازة', 'ساعات العمل', 'متوسط اليوم', 'أيام تأخير', 'دقائق التأخير', 'دقائق الاستراحة', 'تجاوز الاستراحة', 'الأوفر تايم', 'أيام أوفر تايم', 'أجر الساعة', 'مبلغ الأوفر تايم', 'نسبة الحضور', 'إغلاق تلقائي', 'سجلات معدّلة'];
    const data: XlsxRowInput[] = rows.map((r, i) => {
      const st = i % 2 ? 'zebraC' : 'plainC';
      return {
        cells: [
          { value: r.name, style: i % 2 ? 'zebra' : 'plain' },
          { value: KIND[r.kind] ?? r.kind, style: st },
          { value: r.sectionName ?? '', style: st },
          { value: r.scheduledDays, style: st },
          { value: r.presentDays, style: st },
          { value: r.absentDays, style: st },
          { value: r.offDays, style: st },
          { value: r.leaveDays, style: st },
          { value: hours(r.workedMinutes), style: st },
          { value: hours(r.avgMinutes), style: st },
          { value: r.lateDays, style: st },
          { value: r.lateMinutes, style: st },
          { value: r.breakMinutes, style: st },
          { value: r.overMinutes, style: st },
          { value: r.overtimeEnabled ? hours(r.overtimeMinutes) : '—', style: st },
          { value: r.overtimeEnabled ? r.overtimeDays : '—', style: st },
          { value: r.overtimeRate ?? '', style: st },
          { value: r.overtimePay ?? '', style: st },
          { value: r.attendanceRate != null ? `${r.attendanceRate}%` : '—', style: st },
          { value: r.autoClosed, style: st },
          { value: r.edited, style: st },
        ],
      };
    });
    downloadXlsxFile(`حضور-الفريق_${from.slice(0, 7)}`, [
      {
        name: 'الملخص',
        rtl: true,
        columnWidths: [150, 60, 90, 70, 50, 50, 50, 50, 80, 75, 70, 80, 85, 85, 80, 85, 75, 100, 75, 75, 80],
        rows: [
          { cells: [{ value: `ملخص حضور الفريق — ${monthLabel(from)}`, style: 'hero', mergeAcross: head.length - 1 }], height: 28 },
          { cells: [{ value: `من ${from} إلى ${to} · ساعات العمل بعد خصم الاستراحات · الأوفر تايم للمفعّل لهم فقط`, style: 'heroSub', mergeAcross: head.length - 1 }], height: 20 },
          { cells: head.map(h => ({ value: h, style: 'head' })), height: 32 },
          ...data,
          {
            cells: [
              { value: 'المجموع', style: 'section', mergeAcross: 7 },
              { value: hours(totals.worked), style: 'section' },
              { value: '', style: 'section', mergeAcross: 5 },
              { value: hours(totals.ot), style: 'section' },
              { value: '', style: 'section', mergeAcross: 1 },
              { value: totals.otPay || '', style: 'section' },
              { value: '', style: 'section', mergeAcross: 2 },
            ],
          },
        ],
        autoFilter: { fromRow: 3, toRow: 3 + data.length, cols: head.length },
      },
    ]);
  }

  if (sumQ.isError) return <ErrorBlock error={sumQ.error} onRetry={() => void sumQ.refetch()} />;
  const isCurrent = month === monthStart(iraqDate());
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="card flex shrink-0 flex-wrap items-center gap-2 p-2">
        <div className="flex items-center gap-1">
          <Btn size="sm" variant="ghost" aria-label="الشهر السابق" onClick={() => setMonth(m => shiftMonth(m, -1))}>
            ›
          </Btn>
          <span className="min-w-[120px] text-center text-[14px] font-bold text-slate-800">{monthLabel(month)}</span>
          <Btn size="sm" variant="ghost" aria-label="الشهر التالي" disabled={isCurrent} onClick={() => setMonth(m => shiftMonth(m, 1))}>
            ‹
          </Btn>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="بحث بالاسم أو القسم" />
        <Select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="الترتيب" className="!w-auto">
          <option value="name">ترتيب: الاسم</option>
          <option value="worked">الأكثر ساعات</option>
          <option value="overtime">الأكثر أوفر تايم</option>
          <option value="late">الأكثر تأخيراً</option>
          <option value="absent">الأكثر غياباً</option>
        </Select>
        <Switch label="المفعّل لهم الأوفر تايم فقط" checked={onlyOt} onChange={setOnlyOt} />
        <div className="ms-auto flex gap-1.5">
          <Btn size="sm" variant="ghost" icon={<IconRefresh size={14} />} onClick={() => void sumQ.refetch()}>
            تحديث
          </Btn>
          <Btn size="sm" disabled={!sumQ.data?.rows.length} onClick={exportExcel}>
            تصدير Excel
          </Btn>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Kpi label="ساعات عمل الفريق" value={hours(totals.worked)} hint={`${sumQ.data?.days ?? 0} يوم حتى الآن`} />
        <Kpi label="الأوفر تايم" value={hours(totals.ot)} hint={`${totals.otStaff} موظف مفعّل لهم`} tone="brand" />
        <Kpi label="مبلغ الأوفر تايم" value={totals.otPay ? `${formatNum(totals.otPay)} د.ع` : '—'} hint="لمن حُدّد أجر ساعته" tone="brand" />
        <Kpi label="نسبة الحضور" value={totals.rate != null ? `${totals.rate}%` : '—'} tone="ok" />
        <Kpi label="أيام الغياب" value={formatNum(totals.absent)} tone={totals.absent ? 'warn' : undefined} />
        <Kpi label="التأخير" value={hours(totals.late)} tone={totals.late ? 'warn' : undefined} />
      </div>

      <div className="card min-h-0 flex-1 overflow-auto">
        {sumQ.isLoading ? (
          <TableSkeleton rows={8} />
        ) : !rows.length ? (
          <div className="p-8 text-center text-[13px] text-slate-500">{onlyOt ? 'لا موظفين مفعّل لهم الأوفر تايم — فعّله من «الشبكات وقواعد الدوام» ← ورديات الموظفين.' : 'لا موظفين.'}</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11.5px] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right">الموظف</th>
                <th className="px-2 py-2">حضر / الدوام</th>
                <th className="px-2 py-2">غياب</th>
                <th className="px-2 py-2">عطلة · إجازة</th>
                <th className="px-2 py-2">ساعات العمل</th>
                <th className="px-2 py-2">متوسط اليوم</th>
                <th className="px-2 py-2">التأخير</th>
                <th className="px-2 py-2">تجاوز الاستراحة</th>
                <th className="bg-brand-50 px-2 py-2 text-brand-700">الأوفر تايم</th>
                <th className="bg-brand-50 px-2 py-2 text-brand-700">المبلغ</th>
                <th className="px-2 py-2">الحضور</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.staffId} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-1.5">
                    <div className="font-semibold text-slate-800">{r.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {KIND[r.kind] ?? r.kind}
                      {r.sectionName ? ` · ${r.sectionName}` : ''}
                      {r.edited ? ` · ${r.edited} معدّل` : ''}
                    </div>
                  </td>
                  <td className="num px-2 py-1.5 text-center">
                    {r.presentDays} / {r.scheduledDays}
                  </td>
                  <td className={`num px-2 py-1.5 text-center ${r.absentDays ? 'font-bold text-red-600' : 'text-slate-400'}`}>{r.absentDays || '—'}</td>
                  <td className="num px-2 py-1.5 text-center text-slate-500">
                    {r.offDays} · {r.leaveDays}
                  </td>
                  <td className="num px-2 py-1.5 text-center font-semibold">{hours(r.workedMinutes)}</td>
                  <td className="num px-2 py-1.5 text-center text-slate-500">{r.presentDays ? hours(r.avgMinutes) : '—'}</td>
                  <td className={`num px-2 py-1.5 text-center ${r.lateMinutes ? 'text-amber-700' : 'text-slate-400'}`}>
                    {r.lateMinutes ? `${hours(r.lateMinutes)} (${r.lateDays} يوم)` : '—'}
                  </td>
                  <td className={`num px-2 py-1.5 text-center ${r.overMinutes ? 'text-red-600' : 'text-slate-400'}`}>{r.overMinutes ? `${r.overMinutes} د` : '—'}</td>
                  <td className="num bg-brand-50/40 px-2 py-1.5 text-center">
                    {r.overtimeEnabled ? (
                      <span className={r.overtimeMinutes ? 'font-bold text-brand-700' : 'text-slate-400'}>
                        {hours(r.overtimeMinutes)}
                        {r.overtimeDays ? <span className="text-[11px] font-normal text-slate-400"> · {r.overtimeDays} يوم</span> : null}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300">غير مفعّل</span>
                    )}
                  </td>
                  <td className="num bg-brand-50/40 px-2 py-1.5 text-center font-semibold text-brand-700">{r.overtimePay ? formatNum(r.overtimePay) : '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {r.attendanceRate == null ? (
                      '—'
                    ) : (
                      <Badge tone={r.attendanceRate >= 95 ? 'ok' : r.attendanceRate >= 80 ? 'warn' : 'danger'}>{r.attendanceRate}%</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RosterView() {
  const [from, setFrom] = useState(() => iraqDate());
  const rQ = useQuery({ queryKey: ['team-roster', from], queryFn: () => api.teamRoster(from, 7), retry: 0 });
  const today = iraqDate();
  if (rQ.isError) return <ErrorBlock error={rQ.error} onRetry={() => void rQ.refetch()} />;
  const d = rQ.data;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="card flex shrink-0 flex-wrap items-center gap-2 p-2">
        <Btn size="sm" variant="ghost" onClick={() => setFrom(f => new Date(Date.parse(`${f}T12:00:00Z`) - 7 * 86400e3).toISOString().slice(0, 10))}>
          › الأسبوع السابق
        </Btn>
        <Input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className="!w-auto" aria-label="بداية الأسبوع" />
        <Btn size="sm" variant="ghost" onClick={() => setFrom(f => new Date(Date.parse(`${f}T12:00:00Z`) + 7 * 86400e3).toISOString().slice(0, 10))}>
          الأسبوع التالي ‹
        </Btn>
        {from !== today && (
          <Btn size="sm" variant="secondary" onClick={() => setFrom(today)}>
            اليوم
          </Btn>
        )}
        <span className="ms-auto text-[12px] text-slate-500">العطل الأسبوعية والتبديلات والإجازات المقبولة — يُعدَّل من «الإجازات والعطل»</span>
      </div>
      <div className="card min-h-0 flex-1 overflow-auto">
        {!d ? (
          <TableSkeleton rows={8} />
        ) : (
          <table className="w-full border-separate border-spacing-0 text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 text-right text-[11.5px] text-slate-500">الموظف</th>
                {d.dates.map((dt, i) => (
                  <th key={dt} className={`border-b border-slate-200 px-1 py-1.5 text-center ${dt === today ? 'bg-brand-50' : ''}`}>
                    <div className={`text-[12px] font-bold ${dt === today ? 'text-brand-700' : 'text-slate-700'}`}>{DAY_SHORT[dayIdx(dt)]}</div>
                    <div className="num text-[10.5px] font-normal text-slate-400">{dt.slice(5).replace('-', '/')}</div>
                    <div className="num mt-0.5 text-[10.5px] font-semibold text-emerald-700">{d.working[i]} بالدوام</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => (
                <tr key={r.staffId}>
                  <td className="whitespace-nowrap border-b border-slate-100 px-3 py-1">
                    <span className="font-semibold text-slate-800">{r.name}</span> <span className="text-[11px] text-slate-400">{r.sectionName ?? KIND[r.kind] ?? ''}</span>
                  </td>
                  {r.cells.map(c => (
                    <td key={c.date} className={`border-b border-slate-100 p-0.5 text-center ${c.date === today ? 'bg-brand-50/50' : ''}`}>
                      {c.off ? (
                        <span
                          className={`block rounded-md px-1 py-1 text-[11px] font-semibold ${c.reason === 'weekly' || c.reason === 'swap' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-800'}`}
                        >
                          {OFF_REASON[c.reason ?? ''] ?? 'إجازة'}
                        </span>
                      ) : (
                        <span className="block py-1 text-[11px] text-emerald-600">●</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ═════════════ التطبيق: الإصدارات والإشعارات ═════════════ */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('تعذر قراءة الملف'));
    r.readAsDataURL(file);
  });
}

export function TeamAppPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const relQ = useQuery({ queryKey: ['team-app-releases'], queryFn: api.teamAppReleases, retry: 0 });
  const pushQ = useQuery({ queryKey: ['team-push-status'], queryFn: api.teamPushStatus, retry: 0 });
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [required, setRequired] = useState(false);
  const [testId, setTestId] = useState('');

  const upload = useMutation({
    mutationFn: async () => api.uploadTeamAppRelease({ version: version.trim(), notes: notes.trim() || undefined, required, data: await readAsDataUrl(file!) }),
    onSuccess: r => {
      toast.success(`رُفع الإصدار ${r.version} — ستظهر رسالة التحديث في هواتف الفريق`);
      setFile(null);
      setVersion('');
      setNotes('');
      setRequired(false);
      if (fileRef.current) fileRef.current.value = '';
      void qc.invalidateQueries({ queryKey: ['team-app-releases'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الرفع'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.deleteTeamAppRelease(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team-app-releases'] }),
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });
  const test = useMutation({
    mutationFn: () => api.teamPushTest('staff', Number(testId)),
    onSuccess: s => {
      const last = s.log[0];
      if (last?.error) toast.error(last.error);
      else if (last && last.ok > 0) toast.success('أُرسل إشعار التجربة — يجب أن يصل للهاتف حتى والتطبيق مغلق');
      else toast.error('لم يُرسل: هذا الموظف لم يسجّل هاتفه للإشعارات بعد (يفتح التطبيق مرة ويسمح بالإشعارات)');
      void qc.setQueryData(['team-push-status'], s);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإرسال'),
  });

  const latest = relQ.data?.reduce<string | null>((top, r) => (!top || cmpVer(r.version, top) > 0 ? r.version : top), null);
  const versionOk = VERSION_RE.test(version.trim());
  const push = pushQ.data;
  const tokenCount = (k: string) => push?.tokens.find(t => t.kind === k)?.n ?? 0;

  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-[1.3fr_1fr]">
      <SyncKeyCard />
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-[15px] font-bold text-slate-800">إصدارات التطبيق</h2>
          <p className="text-[12.5px] leading-6 text-slate-500">
            ارفع ملف APK الجديد هنا فتظهر لكل هاتف عليه إصدار أقدم رسالة «تحديث متوفر» مع زر التنزيل. «إلزامي» يمنع استخدام التطبيق حتى يُحدَّث.
          </p>
        </div>
        <div className="grid gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3 sm:grid-cols-2">
          <Field label="ملف التطبيق (APK)" className="sm:col-span-2">
            <input
              ref={fileRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              className="block w-full text-[12.5px] file:me-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-white"
              onChange={e => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                const m = f?.name.match(/(\d+\.\d+\.\d+)/);
                if (m && !version) setVersion(m[1]);
              }}
            />
            {file && <div className="num mt-1 text-[11.5px] text-slate-500">{(file.size / 1048576).toFixed(1)} ميغابايت</div>}
          </Field>
          <Field label="رقم الإصدار" hint={latest ? `آخر إصدار مرفوع: ${latest}` : 'مثال: 1.4.0'}>
            <Input dir="ltr" value={version} onChange={e => setVersion(e.target.value)} placeholder="1.4.0" />
          </Field>
          <div className="flex items-end pb-1">
            <Switch label="تحديث إلزامي" checked={required} onChange={setRequired} />
          </div>
          <Field label="ما الجديد (يظهر للموظفين)" className="sm:col-span-2">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-brand-400"
              placeholder="• احتساب الأوفر تايم&#10;• إشعارات المحادثات"
            />
          </Field>
          <Btn
            className="sm:col-span-2 sm:justify-self-start"
            loading={upload.isPending}
            disabled={!file || !versionOk || (!!latest && cmpVer(version.trim(), latest) <= 0)}
            onClick={() => upload.mutate()}
          >
            رفع الإصدار
          </Btn>
          {versionOk && latest && cmpVer(version.trim(), latest) <= 0 && (
            <div className="text-[12px] font-semibold text-amber-700 sm:col-span-2">رقم الإصدار يجب أن يكون أحدث من {latest}</div>
          )}
        </div>

        {relQ.isError ? (
          <ErrorBlock error={relQ.error} onRetry={() => void relQ.refetch()} />
        ) : relQ.isLoading ? (
          <TableSkeleton rows={3} />
        ) : !relQ.data?.length ? (
          <div className="p-4 text-center text-[12.5px] text-slate-500">لم يُرفع أي إصدار بعد.</div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {[...relQ.data]
              .sort((a, b) => cmpVer(b.version, a.version))
              .map(r => (
                <div key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-[14px] font-bold text-slate-800" dir="ltr">
                        v{r.version}
                      </span>
                      {r.version === latest && <Badge tone="ok">الأحدث</Badge>}
                      {r.required && <Badge tone="danger">إلزامي</Badge>}
                      <span className="num text-[11.5px] text-slate-400">{(r.size / 1048576).toFixed(1)} MB</span>
                    </div>
                    {r.notes && <p className="mt-1 whitespace-pre-line text-[12.5px] leading-5 text-slate-600">{r.notes}</p>}
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {r.createdBy} · {formatDate(r.createdAt)}
                    </div>
                  </div>
                  <Btn
                    size="xs"
                    variant="ghost"
                    className="!text-red-600"
                    onClick={async () => {
                      if (await confirm({ title: `حذف الإصدار ${r.version}؟`, message: 'لن يُعرض للتنزيل بعد الآن.', confirmLabel: 'حذف' })) del.mutate(r.id);
                    }}
                  >
                    حذف
                  </Btn>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-slate-800">إشعارات الهواتف (Firebase)</h2>
          <Btn size="xs" variant="ghost" icon={<IconRefresh size={13} />} onClick={() => void pushQ.refetch()}>
            تحديث
          </Btn>
        </div>
        {pushQ.isError ? (
          <ErrorBlock error={pushQ.error} onRetry={() => void pushQ.refetch()} />
        ) : !push ? (
          <TableSkeleton rows={3} />
        ) : (
          <>
            <div className={`rounded-lg p-3 text-[12.5px] font-semibold leading-6 ${push.configured ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              {push.configured ? (
                <>
                  مفعّلة · مشروع <span dir="ltr">{push.projectId}</span> — الإشعارات تصل والتطبيق مغلق.
                </>
              ) : (
                <>غير مفعّلة بعد — الإشعارات تظهر داخل التطبيق فقط. لتفعيلها ضع ملف حساب خدمة Firebase باسم firebase-sa.json في مجلد بيانات خادم الفريق على الـ VPS.</>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 p-2.5 text-center">
                <div className="num text-[20px] font-extrabold text-slate-800">{tokenCount('staff')}</div>
                <div className="text-[11.5px] text-slate-500">هاتف موظف مسجّل</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5 text-center">
                <div className="num text-[20px] font-extrabold text-slate-800">{tokenCount('manager')}</div>
                <div className="text-[11.5px] text-slate-500">هاتف مدير مسجّل</div>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Field label="إشعار تجربة لموظف" className="flex-1">
                <Select value={testId} onChange={e => setTestId(e.target.value)}>
                  <option value="">اختر موظفاً…</option>
                  {(dirQ.data ?? [])
                    .filter(s => s.isActive)
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Btn loading={test.isPending} disabled={!testId || !push.configured} onClick={() => test.mutate()}>
                إرسال
              </Btn>
            </div>
            {!!push.log.length && (
              <div>
                <div className="mb-1 text-[12px] font-semibold text-slate-500">آخر الإرسالات</div>
                <div className="max-h-64 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 text-[12px]">
                  {push.log.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{l.title}</span>
                      {l.error ? <Badge tone="danger">خطأ</Badge> : <span className="num text-slate-500">{l.ok}/{l.count}</span>}
                      <span className="num text-[11px] text-slate-400">{formatDate(l.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** مفتاح الربط مع خادم الفريق: يُنسخ من رسالة تحديث الـ VPS ويُحفظ على سيرفر المحل (يبقى بعد تحديث المثبّت) */
function SyncKeyCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['team-sync-key'], queryFn: api.teamSyncKey, retry: 0 });
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: () => api.saveTeamSyncKey(key.trim()),
    onSuccess: () => {
      toast.success('حُفظ مفتاح الربط — عادت المزامنة مع خادم الفريق');
      setKey('');
      setOpen(false);
      void qc.invalidateQueries();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const s = q.data;
  const ok = !!s?.configured;
  return (
    <section className={`card space-y-2 p-4 lg:col-span-2 ${!ok && s ? 'ring-2 ring-amber-300' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold text-slate-800">الربط مع خادم الفريق</h2>
        {s && (ok ? <Badge tone="ok">مربوط</Badge> : <Badge tone="warn">المفتاح غير مضبوط — المزامنة متوقفة</Badge>)}
        {ok && (
          <span className="num text-[12px] text-slate-400" dir="ltr">
            {s.masked}
          </span>
        )}
        {s?.source !== 'settings' && (
          <Btn size="xs" variant="ghost" className="ms-auto" onClick={() => setOpen(o => !o)}>
            {ok ? 'تغيير المفتاح' : 'إدخال المفتاح'}
          </Btn>
        )}
      </div>
      {(open || (s && !ok)) && s?.source !== 'settings' && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="مفتاح المزامنة (FOT_HUB_SYNC_KEY)" hint="يظهر عند تشغيل التحديث على الـ VPS، أو في ملف deploy/.env هناك" className="min-w-[260px] flex-1">
            <Input dir="ltr" value={key} onChange={e => setKey(e.target.value)} placeholder="الصق المفتاح هنا" autoComplete="off" />
          </Field>
          <Btn loading={save.isPending} disabled={key.trim().length < 24} onClick={() => save.mutate()}>
            تجربة وحفظ
          </Btn>
        </div>
      )}
      {s?.source === 'settings' && <p className="text-[12px] text-slate-500">المفتاح مضبوط في appsettings.json على سيرفر المحل.</p>}
    </section>
  );
}

function cmpVer(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
