import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import type { TeamDirStaffDto, TeamHoursRowDto, TeamPermKey, TeamPlan, TeamSupervisorDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { IconRefresh } from '@/components/icons';
import { Badge, Btn, Checkbox, Field, Input, Modal, Select, Switch, TableSkeleton, useConfirm } from '@/components/ui';
import { ErrorBlock, SearchBox } from '@/components/people/PeopleKit';
import { downloadXlsxFile, type XlsxRowInput } from '@/lib/xlsxBuilder';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← نوع دوام كل موظف (عطلة أسبوعية / إجازات شهرية / بالساعات)،
 * كشف الدوام بالساعات والرواتب، ومسؤولو الفرق من الموظفين وصلاحياتهم.
 * ───────────────────────────────────────────────────────────────────────────── */

const iraqDate = (offset = 0) => new Date(Date.now() + 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
/** الأسبوع يبدأ السبت كما في الخادم */
const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 1) % 7));
const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const hoursNum = (min: number) => Math.round((min / 60) * 100) / 100;

export function planBadge(d?: TeamDirStaffDto) {
  if (!d) return <span className="text-slate-300">—</span>;
  if (d.plan === 'hourly') return <Badge tone="violet">بالساعات · {formatNum(d.hourlyRate ?? 0)}</Badge>;
  if (d.plan === 'monthly') return <Badge tone="info">{d.monthlyDays ?? 0} إجازة بالشهر</Badge>;
  return <Badge>عطلة أسبوعية</Badge>;
}

/* ═════════════ نافذة نوع الدوام ═════════════ */
export function PlanDialog({ name, staffId, current, onClose, onSaved }: { name: string; staffId: number; current?: TeamDirStaffDto; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<TeamPlan>(current?.plan ?? 'weekly');
  const [days, setDays] = useState(String(current?.monthlyDays ?? 2));
  const [rate, setRate] = useState(current?.hourlyRate ? String(current.hourlyRate) : '');
  const [from, setFrom] = useState(iraqDate());
  const rateChanged = plan === 'hourly' && Number(rate) !== (current?.hourlyRate ?? 0);
  const save = useMutation({
    mutationFn: () => api.saveTeamPlan(staffId, { plan, monthlyDays: plan === 'monthly' ? Number(days) : undefined, hourlyRate: plan === 'hourly' ? Number(rate) : undefined, rateFrom: rateChanged ? from : undefined }),
    onSuccess: () => {
      toast.success(`حُفظ نوع دوام ${name} — وصل التبليغ لهاتفه`);
      onSaved();
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const OPTIONS: { id: TeamPlan; title: string; desc: string }[] = [
    { id: 'weekly', title: 'عطلة أسبوعية', desc: 'وردية ثابتة ويوم عطلة محدد كل أسبوع' },
    { id: 'monthly', title: 'إجازات شهرية', desc: 'وردية ثابتة وعدد إجازات في الشهر يختارها الموظف ويوافق عليها مديره' },
    { id: 'hourly', title: 'بالساعات', desc: 'بلا وقت محدد ولا عطلة: يسجل حضوره وانصرافه ويُحسب راتبه من ساعاته' },
  ];
  return (
    <Modal
      open
      title={`نوع دوام ${name}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn loading={save.isPending} onClick={() => save.mutate()}>حفظ</Btn>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-2">
          {OPTIONS.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => setPlan(o.id)}
              className={`rounded-lg border p-3 text-right transition ${plan === o.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <div className="text-[13.5px] font-bold text-slate-800">{o.title}</div>
              <div className="mt-0.5 text-[12px] text-slate-500">{o.desc}</div>
            </button>
          ))}
        </div>
        {plan === 'monthly' && (
          <Field label="عدد الإجازات في الشهر" hint="المرضية والطارئة لا تُخصم، وغير المستخدم لا يُرحَّل للشهر التالي">
            <Input type="number" min={0} max={31} value={days} dir="ltr" onChange={e => setDays(e.target.value)} />
          </Field>
        )}
        {plan === 'hourly' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="راتب الساعة (دينار)">
              <Input type="number" min={1} value={rate} dir="ltr" onChange={e => setRate(e.target.value)} />
            </Field>
            <Field label="يسري من" hint="الأيام الأقدم تبقى بسعرها السابق">
              <Input type="date" value={from} disabled={!rateChanged} onChange={e => setFrom(e.target.value)} />
            </Field>
          </div>
        )}
        {plan === 'hourly' && !!current?.rates?.length && (
          <div className="text-[12px] text-slate-500">
            الأسعار السابقة:{' '}
            {current.rates.map(r => `${formatNum(r.rate)} من ${r.fromDate}`).join(' · ')}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ═════════════ كشف الدوام بالساعات ═════════════ */
type Preset = 'week' | 'last' | 'month' | 'custom';

export function TeamHoursPage() {
  const today = iraqDate();
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState({ from: weekStart(today), to: today });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const range = useMemo(() => {
    const start = weekStart(today);
    if (preset === 'last') return { from: addDays(start, -7), to: addDays(start, -1) };
    if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
    if (preset === 'custom') return custom;
    return { from: start, to: today };
  }, [preset, custom, today]);
  const hoursQ = useQuery({ queryKey: ['team-hours', range.from, range.to], queryFn: () => api.teamHours(range.from, range.to), retry: 0, refetchInterval: 60_000 });
  const rows = useMemo(() => (hoursQ.data?.rows ?? []).filter(r => !q.trim() || r.name.includes(q.trim()) || (r.sectionName ?? '').includes(q.trim())), [hoursQ.data, q]);
  const totals = useMemo(() => ({ min: rows.reduce((s, r) => s + r.minutes, 0), pay: rows.reduce((s, r) => s + (r.pay ?? 0), 0) }), [rows]);

  function exportExcel() {
    const head = ['الموظف', 'القسم', 'أيام الحضور', 'الساعات', 'سعر الساعة', 'المستحق', 'نسي الانصراف', 'سجلات معدّلة'];
    const data: XlsxRowInput[] = rows.map((r, i) => {
      const st = i % 2 ? 'zebraC' : 'plainC';
      return {
        cells: [
          { value: r.name, style: i % 2 ? 'zebra' : 'plain' },
          { value: r.sectionName ?? '', style: st },
          { value: r.days, style: st },
          { value: hoursNum(r.minutes), style: st },
          { value: r.rate ?? '', style: st },
          { value: r.pay ?? '', style: st },
          { value: r.autoClosed, style: st },
          { value: r.edited, style: st },
        ],
      };
    });
    const weekly: XlsxRowInput[] = rows.flatMap(r => r.weeks.map((w, i) => {
      const st = i % 2 ? 'zebraC' : 'plainC';
      return { cells: [{ value: r.name, style: i % 2 ? 'zebra' : 'plain' }, { value: w.from, style: st }, { value: w.to, style: st }, { value: w.days, style: st }, { value: hoursNum(w.minutes), style: st }, { value: w.pay ?? '', style: st }] };
    }));
    const weekHead = ['الموظف', 'من السبت', 'إلى الجمعة', 'الأيام', 'الساعات', 'المستحق'];
    downloadXlsxFile(`الدوام-بالساعات_${range.from}`, [
      {
        name: 'الرواتب',
        rtl: true,
        columnWidths: [170, 110, 80, 80, 90, 110, 90, 90],
        rows: [
          { cells: [{ value: `الدوام بالساعات — من ${range.from} إلى ${range.to}`, style: 'hero', mergeAcross: head.length - 1 }], height: 28 },
          { cells: head.map(h => ({ value: h, style: 'head' })), height: 30 },
          ...data,
          { cells: [{ value: 'المجموع', style: 'section', mergeAcross: 2 }, { value: hoursNum(totals.min), style: 'section' }, { value: '', style: 'section' }, { value: totals.pay, style: 'section' }, { value: '', style: 'section', mergeAcross: 1 }] },
        ],
      },
      {
        name: 'أسبوعياً',
        rtl: true,
        columnWidths: [170, 100, 100, 70, 80, 110],
        rows: [{ cells: weekHead.map(h => ({ value: h, style: 'head' })), height: 30 }, ...weekly],
      },
    ]);
  }

  if (hoursQ.isError) return <ErrorBlock error={hoursQ.error} onRetry={() => void hoursQ.refetch()} />;
  const needReview = rows.filter(r => r.autoClosed || r.noRate);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="card flex shrink-0 flex-wrap items-center gap-2 p-2">
        <Select value={preset} onChange={e => setPreset(e.target.value as Preset)} aria-label="الفترة" className="!w-auto">
          <option value="week">هذا الأسبوع</option>
          <option value="last">الأسبوع الماضي</option>
          <option value="month">هذا الشهر</option>
          <option value="custom">فترة محددة</option>
        </Select>
        {preset === 'custom' && (
          <>
            <Input type="date" className="!w-auto" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
            <Input type="date" className="!w-auto" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
          </>
        )}
        <span className="text-[12px] text-slate-500" dir="ltr">{range.from} → {range.to}</span>
        <SearchBox value={q} onChange={setQ} placeholder="بحث بالاسم أو القسم" />
        <div className="ms-auto flex items-center gap-3">
          <span className="text-[13px] font-bold text-slate-800">
            {hhmm(totals.min)} ساعة · <span className="num">{formatNum(totals.pay)}</span> دينار
          </span>
          <Btn size="sm" variant="ghost" icon={<IconRefresh size={14} />} onClick={() => void hoursQ.refetch()}>تحديث</Btn>
          <Btn size="sm" disabled={!rows.length} onClick={exportExcel}>تصدير Excel</Btn>
        </div>
      </div>
      {needReview.length > 0 && (
        <div className="card shrink-0 border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          راجع قبل دفع الرواتب: {needReview.map(r => `${r.name}${r.autoClosed ? ` (نسي الانصراف ${r.autoClosed})` : ''}${r.noRate ? ' (أيام قبل تحديد السعر)' : ''}`).join('، ')} — صحّح الأوقات من «الحضور».
        </div>
      )}
      <div className="card min-h-0 flex-1 overflow-auto">
        {hoursQ.isLoading ? (
          <div className="p-3"><TableSkeleton rows={6} /></div>
        ) : !rows.length ? (
          <div className="p-8 text-center text-[13px] text-slate-500">لا موظفين بالساعات — حدّد نوع الدوام من «الموظفون» ← قائمة الموظف ← «نوع الدوام والراتب».</div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[12px] text-slate-500">
              <tr>
                <th className="px-4 py-2 text-right font-semibold">الموظف</th>
                <th className="px-2 py-2 text-center font-semibold">أيام الحضور</th>
                <th className="px-2 py-2 text-center font-semibold">الساعات</th>
                <th className="px-2 py-2 text-center font-semibold">سعر الساعة</th>
                <th className="px-2 py-2 text-center font-semibold">المستحق</th>
                <th className="px-2 py-2 text-center font-semibold">ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => <HoursRow key={r.staffId} r={r} open={open === r.staffId} onToggle={() => setOpen(o => (o === r.staffId ? null : r.staffId))} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function HoursRow({ r, open, onToggle }: { r: TeamHoursRowDto; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/60" onClick={onToggle}>
        <td className="px-4 py-2">
          <div className="font-semibold text-slate-800">{r.name}</div>
          {r.sectionName && <div className="text-[11px] text-slate-400">{r.sectionName}</div>}
        </td>
        <td className="num px-2 py-2 text-center">{r.days}</td>
        <td className="num px-2 py-2 text-center font-bold" dir="ltr">{hhmm(r.minutes)}</td>
        <td className="num px-2 py-2 text-center">{r.rate != null ? formatNum(r.rate) : '—'}</td>
        <td className="num px-2 py-2 text-center font-bold text-slate-800">{r.pay != null ? formatNum(r.pay) : '—'}</td>
        <td className="px-2 py-2 text-center">
          <span className="inline-flex flex-wrap justify-center gap-1">
            {r.open > 0 && <Badge tone="ok" dot>في الدوام</Badge>}
            {r.autoClosed > 0 && <Badge tone="warn">نسي الانصراف {r.autoClosed}</Badge>}
            {r.edited > 0 && <Badge>معدّل {r.edited}</Badge>}
            {r.noRate > 0 && <Badge tone="danger">بلا سعر</Badge>}
          </span>
        </td>
      </tr>
      {open &&
        r.weeks.map(w => (
          <tr key={w.from} className="bg-slate-50/70 text-[12.5px] text-slate-600">
            <td className="px-8 py-1.5" dir="ltr" style={{ textAlign: 'right' }}>{w.from} → {w.to}</td>
            <td className="num px-2 py-1.5 text-center">{w.days}</td>
            <td className="num px-2 py-1.5 text-center" dir="ltr">{hhmm(w.minutes)}</td>
            <td />
            <td className="num px-2 py-1.5 text-center">{w.pay != null ? formatNum(w.pay) : '—'}</td>
            <td />
          </tr>
        ))}
    </>
  );
}

/* ═════════════ مسؤولو الفرق ═════════════ */
const PERMS: { key: TeamPermKey; label: string; hint: string }[] = [
  { key: 'approveLeave', label: 'الموافقة على الإجازات', hint: 'قبول ورفض طلبات فريقه وتعديل عطلهم الأسبوعية' },
  { key: 'viewAttendance', label: 'رؤية الحضور', hint: 'لوحة حضور فريقه وسجله وتقاريره وساعاتهم' },
  { key: 'editAttendance', label: 'تعديل الحضور', hint: 'تصحيح أوقات فريقه وورديّاتهم' },
  { key: 'sendPosts', label: 'الإعلانات والتبليغات', hint: 'نشر إعلان وإرسال تبليغ لفريقه فقط' },
  { key: 'manageChat', label: 'إنشاء المجموعات', hint: 'إنشاء مجموعات المحادثة وإدارتها' },
  { key: 'viewPay', label: 'المبالغ والرواتب', hint: 'مستحقات ساعات فريقه وأوفر تايمهم' },
  { key: 'viewSales', label: 'مبيعات المحل', hint: 'مبيعات المحل كله مباشرة والأيام السابقة' },
  { key: 'viewInvoices', label: 'الفواتير', hint: 'كل فواتير المحل بتفاصيلها وتصديرها PDF — تشمل المبالغ' },
];

function SupervisorCard({ sv, staff, onSaved }: { sv: TeamSupervisorDto; staff: TeamDirStaffDto[]; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [perms, setPerms] = useState(sv.perms);
  const [members, setMembers] = useState<number[]>(sv.members);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  useEffect(() => {
    setPerms(sv.perms);
    setMembers(sv.members);
  }, [sv]);
  const others = useMemo(() => staff.filter(s => s.id !== sv.staffId && s.isActive), [staff, sv.staffId]);
  const sections = useMemo(() => [...new Set(others.map(s => s.sectionName).filter(Boolean))] as string[], [others]);
  const shown = others.filter(s => (!section || s.sectionName === section) && (!q.trim() || s.name.includes(q.trim()) || s.code.includes(q.trim())));
  const dirty = JSON.stringify(perms) !== JSON.stringify(sv.perms) || JSON.stringify([...members].sort()) !== JSON.stringify([...sv.members].sort());
  const save = useMutation({
    mutationFn: () => api.saveTeamSupervisor(sv.staffId, { perms, members }),
    onSuccess: () => {
      toast.success(`حُفظت صلاحيات ${sv.name} — تُطبَّق فوراً على هاتفه`);
      onSaved();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const remove = useMutation({
    mutationFn: () => api.saveTeamSupervisor(sv.staffId, { remove: true }),
    onSuccess: () => {
      toast.success(`لم يعد ${sv.name} مسؤولاً`);
      onSaved();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const allShown = shown.length > 0 && shown.every(s => members.includes(s.id));
  return (
    <section className={`card flex flex-col gap-3 p-4 ${sv.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold text-slate-800">{sv.name}</div>
          {sv.sectionName && <div className="text-[12px] text-slate-400">{sv.sectionName}</div>}
        </div>
        <Badge tone={members.length ? 'info' : 'warn'}>{members.length ? `مسؤول عن ${members.length}` : 'لم يُحدَّد فريقه'}</Badge>
      </div>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {PERMS.map(p => (
          <div key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <div className="text-[13px] font-semibold text-slate-700">{p.label}</div>
              <div className="text-[11.5px] text-slate-400">{p.hint}</div>
            </div>
            <Switch checked={!!perms[p.key]} onChange={v => setPerms(x => ({ ...x, [p.key]: v }))} />
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-slate-600">الموظفون المسؤول عنهم</span>
          <SearchBox value={q} onChange={setQ} placeholder="بحث" />
          {sections.length > 0 && (
            <Select value={section} onChange={e => setSection(e.target.value)} className="!w-auto" aria-label="القسم">
              <option value="">كل الأقسام</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}
          <Btn
            size="sm"
            variant="ghost"
            disabled={!shown.length}
            onClick={() => setMembers(m => (allShown ? m.filter(id => !shown.some(s => s.id === id)) : [...new Set([...m, ...shown.map(s => s.id)])]))}
          >
            {allShown ? 'إلغاء تحديد الظاهرين' : 'تحديد الظاهرين'}
          </Btn>
        </div>
        <div className="grid max-h-56 gap-1.5 overflow-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
          {shown.map(s => (
            <Checkbox
              key={s.id}
              label={
                <span>
                  {s.name} {s.sectionName && <span className="text-[11px] text-slate-400">({s.sectionName})</span>}
                </span>
              }
              checked={members.includes(s.id)}
              onChange={v => setMembers(m => (v ? [...m, s.id] : m.filter(id => id !== s.id)))}
            />
          ))}
          {!shown.length && <span className="text-[12px] text-slate-400">لا نتائج</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Btn loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>حفظ</Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            if (await confirm({ title: 'إزالة المسؤول؟', message: `يعود ${sv.name} موظفاً عادياً وتتوقف صلاحياته فوراً.`, confirmLabel: 'إزالة' })) remove.mutate();
          }}
        >
          إزالة المسؤولية
        </Btn>
      </div>
    </section>
  );
}

export function TeamSupervisorsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['team-supervisors'], queryFn: api.teamSupervisors, retry: 0 });
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const [pick, setPick] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['team-supervisors'] });
    void qc.invalidateQueries({ queryKey: ['team-directory'] });
  };
  const add = useMutation({
    mutationFn: (id: number) => api.saveTeamSupervisor(id, { perms: { approveLeave: true }, members: [] }),
    onSuccess: () => {
      setPick('');
      toast.success('أُضيف المسؤول — حدّد موظفيه وصلاحياته ثم احفظ');
      refresh();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإضافة'),
  });
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (dirQ.isError) return <ErrorBlock error={dirQ.error} onRetry={() => void dirQ.refetch()} />;
  if (q.isLoading || dirQ.isLoading || !q.data || !dirQ.data) return <TableSkeleton rows={6} />;
  const taken = new Set(q.data.supervisors.map(s => s.staffId));
  const candidates = dirQ.data.filter(s => s.isActive && !taken.has(s.id));
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <p className="mb-3 text-[12.5px] leading-6 text-slate-500">
        موظف يدخل بحسابه العادي، وتظهر له «إدارة الفريق» داخل التطبيق. لا يرى ولا يتصرف إلا بالموظفين الذين تحددهم هنا، ولا يوافق على طلباته هو — طلبه يذهب للمدير. الشبكات وإعدادات الدوام تبقى للإدارة دائماً.
      </p>
      <div className="card mb-3 flex flex-wrap items-center gap-2 p-3">
        <span className="text-[13px] font-semibold text-slate-700">إضافة مسؤول:</span>
        <Select value={pick} onChange={e => setPick(e.target.value)} className="!w-auto" aria-label="الموظف">
          <option value="">— اختر الموظف —</option>
          {candidates.map(s => <option key={s.id} value={s.id}>{s.name}{s.sectionName ? ` (${s.sectionName})` : ''}</option>)}
        </Select>
        <Btn loading={add.isPending} disabled={!pick} onClick={() => add.mutate(Number(pick))}>إضافة</Btn>
      </div>
      {!q.data.supervisors.length ? (
        <div className="card p-8 text-center text-[13px] text-slate-500">لا مسؤولين بعد — اختر موظفاً من الأعلى.</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {q.data.supervisors.map(s => <SupervisorCard key={s.staffId} sv={s} staff={dirQ.data!} onSaved={refresh} />)}
        </div>
      )}
    </div>
  );
}
