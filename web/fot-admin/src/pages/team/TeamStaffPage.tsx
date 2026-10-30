import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate, formatDateOnly, formatNum } from '@/api/client';
import type { CashierDto, SalesmanDto, SectionSummaryDto, StaffDto, StaffSaveRequest, TeamHubStatusDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { FilterActions, FilterBar, FilterLabel, SegmentedFilter, SummaryStrip, WorkspaceBody, WorkspaceCard, WorkspacePage } from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import { IconLock, IconPlus, IconRefresh, IconUsers } from '@/components/icons';
import { Badge, Btn, Field, IconButton, Input, Modal, Select, TableSkeleton, useConfirm } from '@/components/ui';
import { CopyButton, ErrorBlock, RowMenu, SearchBox } from '@/components/people/PeopleKit';
import { fixEdariName } from '@/lib/text';
import { PlanDialog, planBadge } from './TeamPlanPages';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← الموظفون: كل من يستخدم التطبيق (بائع، كاشير، مشرف، آخر).
 * المصدر هنا في المحل، والتعديل يصل للتطبيق خلال ثانية. الهاتف المربوط وحالة الإشعارات
 * تأتي من خادم الفريق مباشرة.
 * ───────────────────────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = { seller: 'بائع', cashier: 'كاشير', supervisor: 'مشرف', other: 'موظف' };
const KIND_TONE: Record<string, 'brand' | 'info' | 'violet' | 'default'> = { seller: 'brand', cashier: 'info', supervisor: 'violet', other: 'default' };

type Filter = 'all' | 'active' | 'stopped' | 'nopin' | 'nodevice';

const EMPTY: StaffSaveRequest = {
  code: '',
  name: '',
  kind: 'seller',
  jobTitle: '',
  phone: '',
  salesmanId: null,
  cashierId: null,
  sectionId: null,
  hireDate: null,
  notes: '',
  isActive: true,
};

export function TeamStaffPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<StaffDto | 'new' | null>(null);
  const [planFor, setPlanFor] = useState<StaffDto | null>(null);

  const staffQ = useQuery({ queryKey: ['team-staff'], queryFn: api.teamStaff });
  const hubQ = useQuery({ queryKey: ['team-hub-status'], queryFn: api.teamHubStatus, retry: 0, refetchInterval: 60_000 });
  const hub = hubQ.data;
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const dirOf = useMemo(() => new Map((dirQ.data ?? []).map(d => [d.id, d])), [dirQ.data]);
  const deviceOf = useMemo(() => new Map((hub?.devices ?? []).map(d => [d.staffId, d])), [hub]);
  const pushOf = useMemo(() => new Set((hub?.push ?? []).map(p => p.staffId)), [hub]);

  const all = staffQ.data ?? [];
  const rows = useMemo(() => {
    const q = search.trim();
    return all.filter(s => {
      if (filter === 'active' && !s.isActive) return false;
      if (filter === 'stopped' && s.isActive) return false;
      if (filter === 'nopin' && s.hasPin) return false;
      if (filter === 'nodevice' && deviceOf.has(s.id)) return false;
      if (!q) return true;
      return s.name.includes(q) || s.code.includes(q) || (s.sectionName ?? '').includes(q) || (s.jobTitle ?? '').includes(q);
    });
  }, [all, search, filter, deviceOf]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['team-staff'] });
    void qc.invalidateQueries({ queryKey: ['team-hub-status'] });
  };

  const issuePin = useMutation({
    mutationFn: (id: number) => api.issueStaffPin(id),
    onSuccess: row => {
      refresh();
      toast.success(`رمز ${row.name} الجديد: ${row.pinDisplay}`);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر توليد الرمز'),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setStaffActive(id, active),
    onSuccess: refresh,
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const resetDevice = useMutation({
    mutationFn: (id: number) => api.resetStaffDevice(id),
    onSuccess: () => {
      refresh();
      toast.success('فُك ربط الهاتف — يستطيع الموظف الدخول من هاتف جديد');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر فك الربط'),
  });
  const importCashiers = useMutation({
    mutationFn: api.importStaffCashiers,
    onSuccess: r => {
      refresh();
      toast.success(r.added ? `أُضيف ${r.added} كاشير كموظفين — ولّد لهم رموز الدخول` : 'كل الكاشيرية مضافون مسبقاً');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الاستيراد'),
  });

  const counts = {
    all: all.length,
    active: all.filter(s => s.isActive).length,
    stopped: all.filter(s => !s.isActive).length,
    nopin: all.filter(s => !s.hasPin).length,
    nodevice: all.filter(s => s.isActive && !deviceOf.has(s.id)).length,
  };

  const columns: GridColumn<StaffDto>[] = [
    { key: 'code', header: 'الكود', width: 80, mono: true },
    {
      key: 'name',
      header: 'الموظف',
      width: 220,
      render: s => (
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate font-semibold ${s.isActive ? 'text-header' : 'text-slate-400 line-through'}`}>{s.name}</span>
          {s.jobTitle && <span className="truncate text-[11px] text-slate-400">{s.jobTitle}</span>}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'النوع',
      width: 90,
      sortValue: s => KIND_LABEL[s.kind] ?? s.kind,
      filterValue: s => KIND_LABEL[s.kind] ?? s.kind,
      render: s => <Badge tone={KIND_TONE[s.kind] ?? 'default'}>{KIND_LABEL[s.kind] ?? s.kind}</Badge>,
    },
    {
      key: 'plan',
      header: 'نوع الدوام',
      width: 130,
      sortValue: s => dirOf.get(s.id)?.plan ?? 'weekly',
      exportValue: s => dirOf.get(s.id)?.plan ?? 'weekly',
      render: s => (
        <button
          type="button"
          title="نوع الدوام والراتب"
          onClick={e => {
            e.stopPropagation();
            setPlanFor(s);
          }}
        >
          {planBadge(dirOf.get(s.id))}
        </button>
      ),
    },
    { key: 'sectionName', header: 'القسم', width: 140, render: s => (s.sectionName ? fixEdariName(s.sectionName) : <span className="text-slate-300">—</span>) },
    {
      key: 'pinDisplay',
      header: 'رمز الدخول',
      width: 130,
      sortable: false,
      render: s =>
        s.pinDisplay ? (
          <span className="flex items-center gap-1">
            <span className="num rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] font-bold tracking-wider">{s.pinDisplay}</span>
            <CopyButton value={s.pinDisplay} what="الرمز" variant="ghost" />
          </span>
        ) : (
          <span className="text-[11.5px] text-amber-600">بلا رمز</span>
        ),
    },
    {
      key: 'device',
      header: 'الهاتف المربوط',
      width: 190,
      sortValue: s => deviceOf.get(s.id)?.lastSeen ?? '',
      exportValue: s => deviceOf.get(s.id)?.label ?? '',
      render: s => {
        const d = deviceOf.get(s.id);
        if (!hub) return <span className="text-[11px] text-slate-300">{hubQ.isError ? 'الخادم لا يرد' : '…'}</span>;
        if (!d) return <span className="text-[11.5px] text-slate-400">لم يدخل من التطبيق</span>;
        return (
          <span className="block leading-4">
            <span className="block truncate text-[12px] font-semibold text-slate-700">
              {d.label || d.platform || 'هاتف'} {pushOf.has(s.id) && <span title="الإشعارات مفعّلة">🔔</span>}
            </span>
            <span className="block text-[10.5px] text-slate-400">آخر ظهور {formatDate(d.lastSeen)}</span>
          </span>
        );
      },
    },
    {
      key: 'isActive',
      header: 'الحالة',
      width: 90,
      sortValue: s => (s.isActive ? 1 : 0),
      render: s => (s.isActive ? <Badge tone="ok" dot>نشط</Badge> : <Badge tone="default">متوقف</Badge>),
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'end',
      sortable: false,
      exportable: false,
      render: s => (
        <div onClick={e => e.stopPropagation()}>
          <RowMenu
            items={[
              { label: 'تعديل', icon: <IconUsers size={15} />, onClick: () => setEditing(s) },
              { label: 'نوع الدوام والراتب', icon: <IconRefresh size={15} />, onClick: () => setPlanFor(s) },
              { label: s.hasPin ? 'رمز دخول جديد' : 'توليد رمز الدخول', icon: <IconLock size={15} />, onClick: () => issuePin.mutate(s.id) },
              deviceOf.has(s.id)
                ? {
                    label: 'فك ربط الهاتف',
                    icon: <IconRefresh size={15} />,
                    onClick: async () => {
                      if (await confirm({ title: 'فك ربط الهاتف؟', message: `سيستطيع ${s.name} الدخول من هاتف جديد، وسيتوقف الهاتف الحالي عن استلام الإشعارات.`, confirmLabel: 'فك الربط' }))
                        resetDevice.mutate(s.id);
                    },
                  }
                : null,
              s.isActive
                ? { label: 'إيقاف الحساب', icon: <IconRefresh size={15} />, danger: true, onClick: () => setActive.mutate({ id: s.id, active: false }) }
                : { label: 'تفعيل الحساب', icon: <IconRefresh size={15} />, onClick: () => setActive.mutate({ id: s.id, active: true }) },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar>
          <FilterLabel label="بحث">
            <SearchBox value={search} onChange={setSearch} placeholder="الاسم، الكود، القسم…" />
          </FilterLabel>
          <FilterActions>
            <IconButton label="تحديث" onClick={refresh}>
              <IconRefresh size={15} className={staffQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn variant="secondary" loading={importCashiers.isPending} onClick={() => importCashiers.mutate()}>
              استيراد الكاشيرية
            </Btn>
            <Btn icon={<IconPlus size={15} />} onClick={() => setEditing('new')}>
              موظف جديد
            </Btn>
          </FilterActions>
        </FilterBar>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <SegmentedFilter<Filter>
            label="تصفية الموظفين"
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: 'الكل', count: counts.all },
              { id: 'active', label: 'نشط', count: counts.active },
              { id: 'stopped', label: 'متوقف', count: counts.stopped },
              { id: 'nopin', label: 'بلا رمز', count: counts.nopin },
              { id: 'nodevice', label: 'لم يدخل من التطبيق', count: counts.nodevice },
            ]}
          />
          {hubQ.isError && <span className="text-[11.5px] font-semibold text-amber-700">خادم الفريق لا يرد — حالة الهواتف غير متاحة الآن</span>}
        </div>
        <SummaryStrip
          loading={staffQ.isLoading}
          cells={[
            { label: 'الموظفون', value: formatNum(counts.all), tone: 'brand' },
            { label: 'نشطون', value: formatNum(counts.active), tone: 'ok' },
            { label: 'دخلوا من التطبيق', value: hub ? formatNum(hub.devices.length) : '—' },
            { label: 'الإشعارات مفعّلة', value: hub ? formatNum(hub.push.length) : '—' },
            { label: 'بلا رمز', value: formatNum(counts.nopin), tone: counts.nopin ? 'warn' : undefined },
          ]}
        />
        <WorkspaceBody>
          {staffQ.isError ? (
            <ErrorBlock error={staffQ.error} title="تعذر تحميل الموظفين" onRetry={() => staffQ.refetch()} />
          ) : staffQ.isLoading ? (
            <div className="p-3"><TableSkeleton rows={10} cols={7} /></div>
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              rows={rows}
              columns={columns}
              getRowId={r => r.id}
              onRowDoubleClick={r => setEditing(r)}
              storageKey="team-staff"
              exportName="موظفو-التطبيق"
              counterLabel="موظف"
              emptyText="لا موظفين — أضف موظفاً أو استورد الكاشيرية"
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      {planFor && <PlanDialog name={planFor.name} staffId={planFor.id} current={dirOf.get(planFor.id)} onClose={() => setPlanFor(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ['team-directory'] })} />}
      {editing && <StaffEditor staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </WorkspacePage>
  );
}

function StaffEditor({ staff, onClose, onSaved }: { staff: StaffDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<StaffSaveRequest>(() =>
    staff
      ? {
          code: staff.code,
          name: staff.name,
          kind: staff.kind,
          jobTitle: staff.jobTitle ?? '',
          phone: staff.phone ?? '',
          salesmanId: staff.salesmanId ?? null,
          cashierId: staff.cashierId ?? null,
          sectionId: staff.sectionId ?? null,
          hireDate: staff.hireDate ? staff.hireDate.slice(0, 10) : null,
          notes: staff.notes ?? '',
          isActive: staff.isActive,
        }
      : EMPTY,
  );
  const set = <K extends keyof StaffSaveRequest>(k: K, v: StaffSaveRequest[K]) => setForm(f => ({ ...f, [k]: v }));

  const salesmenQ = useQuery({ queryKey: ['salesmen', true], queryFn: () => api.salesmen(true), staleTime: 300_000 });
  const cashiersQ = useQuery({ queryKey: ['cashiers-all'], queryFn: () => api.cashiers(), staleTime: 300_000 });
  const sectionsQ = useQuery({ queryKey: ['sections', true], queryFn: () => api.sections(true), staleTime: 300_000 });
  const salesmen = (salesmenQ.data?.items ?? []) as SalesmanDto[];
  const cashiers = (cashiersQ.data?.items ?? []) as CashierDto[];
  const sections = (sectionsQ.data ?? []) as SectionSummaryDto[];

  const save = useMutation({
    mutationFn: () => (staff ? api.updateStaff(staff.id, form) : api.createStaff(form)),
    onSuccess: row => {
      onSaved();
      toast.success(staff ? 'حُفظ الموظف ووصل للتطبيق' : `أُضيف ${row.name} — ولّد له رمز الدخول`);
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  return (
    <Modal
      open
      title={staff ? `تعديل ${staff.name}` : 'موظف جديد'}
      subtitle="يدخل التطبيق بالكود ورمز الدخول · الربط بالبائع يُظهر عمولته وأهدافه وبراندته"
      icon={<IconUsers size={18} />}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn loading={save.isPending} onClick={() => save.mutate()}>حفظ</Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم *">
          <Input value={form.name ?? ''} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="كود الدخول *" hint="رقم أو حروف قصيرة يكتبها الموظف عند الدخول">
          <Input value={form.code ?? ''} dir="ltr" className="font-mono" onChange={e => set('code', e.target.value)} />
        </Field>
        <Field label="النوع">
          <Select value={form.kind ?? 'other'} onChange={e => set('kind', e.target.value)}>
            <option value="seller">بائع</option>
            <option value="cashier">كاشير</option>
            <option value="supervisor">مشرف</option>
            <option value="other">موظف آخر</option>
          </Select>
        </Field>
        <Field label="المسمى الوظيفي">
          <Input value={form.jobTitle ?? ''} onChange={e => set('jobTitle', e.target.value)} />
        </Field>
        <Field label="القسم">
          <Select value={form.sectionId ?? ''} onChange={e => set('sectionId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— بلا قسم —</option>
            {sections.map(s => (
              <option key={s.id} value={s.id}>{fixEdariName(s.name)}</option>
            ))}
          </Select>
        </Field>
        <Field label="الهاتف">
          <Input value={form.phone ?? ''} dir="ltr" onChange={e => set('phone', e.target.value)} />
        </Field>
        <Field label="ربط بالبائع (الإداري)" hint="لإظهار العمولة والأهداف والبراندات">
          <Select value={form.salesmanId ?? ''} onChange={e => set('salesmanId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— غير مربوط —</option>
            {salesmen.map(s => (
              <option key={s.id} value={s.id}>{fixEdariName(s.name)} #{s.id}</option>
            ))}
          </Select>
        </Field>
        <Field label="ربط بالكاشير">
          <Select value={form.cashierId ?? ''} onChange={e => set('cashierId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— غير مربوط —</option>
            {cashiers.map(c => (
              <option key={c.id} value={c.id}>{c.accountName || c.username}</option>
            ))}
          </Select>
        </Field>
        <Field label="تاريخ التعيين">
          <Input type="date" value={form.hireDate ?? ''} onChange={e => set('hireDate', e.target.value || null)} />
        </Field>
        <Field label="الحالة">
          <Select value={form.isActive === false ? '0' : '1'} onChange={e => set('isActive', e.target.value === '1')}>
            <option value="1">نشط</option>
            <option value="0">متوقف</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات">
            <Input value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {staff && (
          <p className="text-[11.5px] text-slate-500 sm:col-span-2">
            أُضيف {formatDateOnly(staff.createdAt)}
            {staff.lastLoginAt ? ` · آخر دخول للويب ${formatDate(staff.lastLoginAt)}` : ''}
          </p>
        )}
      </div>
    </Modal>
  );
}

export type { TeamHubStatusDto };
export default TeamStaffPage;
