import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate, formatNum } from '@/api/client';
import type { TeamAudience, TeamDirStaffDto, TeamLeaveDto, TeamPostDto, TeamPostSave } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { FilterActions, FilterBar, FilterLabel, SegmentedFilter, SummaryStrip, WorkspaceBody, WorkspaceCard, WorkspacePage } from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import { IconPlus, IconRefresh } from '@/components/icons';
import { Badge, Btn, Checkbox, Field, IconButton, Input, Modal, Select, Switch, TableSkeleton, Textarea, useConfirm } from '@/components/ui';
import { ErrorBlock, SearchBox } from '@/components/people/PeopleKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← الإجازات والعطل، الإعلانات، التبليغات.
 * كل شيء يُدار على خادم الفريق عبر سيرفر المحل، ويصل لهواتف الموظفين فوراً.
 * ───────────────────────────────────────────────────────────────────────────── */

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const KIND_LABEL: Record<string, string> = { seller: 'بائع', cashier: 'كاشير', supervisor: 'مشرف', other: 'موظف' };
const LEAVE_LABEL: Record<string, string> = { swap: 'تبديل العطلة', day: 'إجازة', sick: 'إجازة مرضية', urgent: 'إجازة طارئة', hours: 'استئذان' };
const STATUS: Record<TeamLeaveDto['status'], { label: string; tone: 'warn' | 'ok' | 'danger' | 'default' }> = {
  pending: { label: 'بانتظار الموافقة', tone: 'warn' },
  approved: { label: 'مقبول', tone: 'ok' },
  rejected: { label: 'مرفوض', tone: 'danger' },
  cancelled: { label: 'ملغى', tone: 'default' },
};
const POST_KIND: Record<string, { label: string; tone: 'brand' | 'warn' | 'default' | 'ok' | 'danger' }> = {
  news: { label: 'خبر', tone: 'brand' },
  offer: { label: 'عرض', tone: 'warn' },
  instruction: { label: 'تعليمات', tone: 'default' },
  congrats: { label: 'تهنئة', tone: 'ok' },
  alert: { label: 'تنبيه', tone: 'danger' },
};
const REASON: Record<string, string> = { weekly: 'عطلة أسبوعية', swap: 'تبديل', day: 'إجازة', sick: 'مرضية', urgent: 'طارئة' };

function dateAr(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' });
}
function leaveWhen(r: TeamLeaveDto) {
  if (r.type === 'swap') return `${dateAr(r.swapFrom)} ← ${dateAr(r.swapTo)}`;
  if (r.type === 'hours') return `${dateAr(r.dateFrom)} · ${r.timeFrom}–${r.timeTo}`;
  return !r.dateTo || r.dateFrom === r.dateTo ? dateAr(r.dateFrom) : `${dateAr(r.dateFrom)} – ${dateAr(r.dateTo)}`;
}

/** صورة من خادم الفريق (تُجلب عبر الوكيل بصلاحية المدير). */
const imgCache = new Map<string, Promise<string>>();
function HubImage({ url, className, onClick }: { url: string; className?: string; onClick?: () => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!imgCache.has(url)) imgCache.set(url, api.teamMediaObjectUrl(url));
    imgCache
      .get(url)!
      .then(u => alive && setSrc(u))
      .catch(() => imgCache.delete(url));
    return () => {
      alive = false;
    };
  }, [url]);
  return src ? <img src={src} alt="" className={className} onClick={onClick} /> : <div className={`${className ?? ''} animate-pulse bg-slate-100`} />;
}

async function compress(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('تعذر قراءة الصورة'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function useHub<T>(key: string[], fn: () => Promise<T>) {
  return useQuery({ queryKey: key, queryFn: fn, retry: 0, refetchInterval: 30_000 });
}

/* ═════════════ الإجازات والعطل ═════════════ */
type LeaveView = 'pending' | 'approved' | 'rejected' | 'all' | 'weekly';

export function TeamLeavePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<LeaveView>('pending');
  const [open, setOpen] = useState<TeamLeaveDto | null>(null);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');

  const overview = useHub(['team-overview'], api.teamOverview);
  const leaveQ = useQuery({ queryKey: ['team-leave', view], queryFn: () => api.teamLeave(view === 'weekly' ? 'pending' : view), enabled: view !== 'weekly', retry: 0, refetchInterval: 30_000 });
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, enabled: view === 'weekly', retry: 0 });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) => api.decideTeamLeave(id, approve, note.trim() || undefined),
    onSuccess: r => {
      toast.success(r.status === 'approved' ? `وافقت على طلب ${r.staffName}` : `رُفض طلب ${r.staffName}`);
      setOpen(null);
      void qc.invalidateQueries({ queryKey: ['team-leave'] });
      void qc.invalidateQueries({ queryKey: ['team-overview'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const weekly = useMutation({
    mutationFn: ({ id, mask }: { id: number; mask: number }) => api.setTeamWeeklyOff(id, mask),
    onSuccess: () => {
      toast.success('حُفظت العطلة ووصل التبليغ للموظف');
      void qc.invalidateQueries({ queryKey: ['team-directory'] });
      void qc.invalidateQueries({ queryKey: ['team-overview'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const rows = useMemo(() => {
    const q = search.trim();
    const all = leaveQ.data ?? [];
    return q ? all.filter(r => r.staffName.includes(q) || (r.reason ?? '').includes(q)) : all;
  }, [leaveQ.data, search]);
  const staff = useMemo(() => {
    const q = search.trim();
    const all = (dirQ.data ?? []).filter(s => s.isActive);
    return q ? all.filter(s => s.name.includes(q) || s.code.includes(q)) : all;
  }, [dirQ.data, search]);

  const columns: GridColumn<TeamLeaveDto>[] = [
    { key: 'staffName', header: 'الموظف', width: 170, render: r => <span className="font-semibold text-slate-800">{r.staffName}</span> },
    { key: 'staffKind', header: 'النوع', width: 80, render: r => KIND_LABEL[r.staffKind ?? ''] ?? '—' },
    { key: 'type', header: 'الطلب', width: 120, sortValue: r => r.typeLabel, render: r => LEAVE_LABEL[r.type] ?? r.typeLabel },
    { key: 'when', header: 'الموعد', width: 230, sortValue: r => r.dateFrom ?? r.swapFrom ?? '', exportValue: r => leaveWhen(r), render: r => leaveWhen(r) },
    { key: 'reason', header: 'السبب', width: 220, render: r => <span className="truncate text-slate-600">{r.reason || '—'}</span> },
    { key: 'status', header: 'الحالة', width: 120, sortValue: r => r.status, exportValue: r => STATUS[r.status].label, render: r => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    { key: 'createdAt', header: 'رُفع', width: 140, render: r => formatDate(r.createdAt) },
    { key: 'decidedBy', header: 'بتّ فيه', width: 150, render: r => (r.decidedBy ? `${r.decidedBy.replace(/^manager:/, '')}` : '—') },
  ];

  const ov = overview.data;
  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar>
          <FilterLabel label="العرض">
            <SegmentedFilter
              label="العرض"
              value={view}
              onChange={setView}
              items={[
                { id: 'pending', label: 'معلّقة', count: ov?.pending, tone: ov?.pending ? 'warn' : undefined },
                { id: 'approved', label: 'مقبولة' },
                { id: 'rejected', label: 'مرفوضة' },
                { id: 'all', label: 'الكل' },
                { id: 'weekly', label: 'العطل الأسبوعية' },
              ]}
            />
          </FilterLabel>
          <FilterLabel label="بحث">
            <SearchBox value={search} onChange={setSearch} placeholder="الاسم أو السبب…" />
          </FilterLabel>
          <FilterActions>
            <IconButton
              label="تحديث"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ['team-leave'] });
                void qc.invalidateQueries({ queryKey: ['team-overview'] });
                void qc.invalidateQueries({ queryKey: ['team-directory'] });
              }}
            >
              <IconRefresh size={15} className={leaveQ.isFetching || dirQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </FilterActions>
        </FilterBar>
        <SummaryStrip
          loading={overview.isLoading}
          cells={[
            { label: `اليوم · ${ov?.weekday ?? ''}`, value: ov ? `${formatNum(ov.staffCount - ov.offToday.length)} في الدوام` : '—', tone: 'brand' },
            { label: 'في عطلة أو إجازة', value: ov ? formatNum(ov.offToday.length) : '—' },
            { label: 'استئذان اليوم', value: ov ? formatNum(ov.partial.length) : '—' },
            { label: 'طلبات معلّقة', value: ov ? formatNum(ov.pending) : '—', tone: ov?.pending ? 'warn' : undefined, onClick: () => setView('pending') },
            { label: 'هواتف مربوطة', value: ov ? `${formatNum(ov.devices)} / ${formatNum(ov.staffCount)}` : '—' },
          ]}
        />
        {ov && (ov.offToday.length > 0 || ov.partial.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-amber-50/40 px-4 py-2 text-[12px]">
            <span className="font-semibold text-slate-600">غائبون اليوم:</span>
            {ov.offToday.map(p => (
              <Badge key={p.staffId} tone="warn">
                {p.name} · {REASON[p.reason] ?? p.reason}
              </Badge>
            ))}
            {ov.partial.map(p => (
              <Badge key={`p${p.staffId}`} tone="info">
                {p.name} · استئذان {p.timeFrom}–{p.timeTo}
              </Badge>
            ))}
          </div>
        )}
        <WorkspaceBody>
          {view === 'weekly' ? (
            dirQ.isError ? (
              <ErrorBlock error={dirQ.error} onRetry={() => void dirQ.refetch()} />
            ) : dirQ.isLoading ? (
              <TableSkeleton rows={8} />
            ) : (
              <WeeklyTable staff={staff} saving={weekly.isPending} onSave={(id, mask) => weekly.mutate({ id, mask })} />
            )
          ) : leaveQ.isError ? (
            <ErrorBlock error={leaveQ.error} onRetry={() => void leaveQ.refetch()} />
          ) : leaveQ.isLoading ? (
            <TableSkeleton rows={8} />
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              rows={rows}
              columns={columns}
              getRowId={r => r.id}
              onRowClick={r => {
                setNote('');
                setOpen(r);
              }}
              storageKey="team-leave"
              exportName="طلبات-الإجازة"
              counterLabel="طلب"
              emptyText={view === 'pending' ? 'لا طلبات معلّقة 👌' : 'لا طلبات'}
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${LEAVE_LABEL[open.type]} — ${open.staffName}` : ''}
        subtitle={open ? leaveWhen(open) : ''}
        footer={
          open?.status === 'pending' ? (
            <>
              <Btn variant="secondary" onClick={() => setOpen(null)}>
                إغلاق
              </Btn>
              <Btn variant="danger" loading={decide.isPending && decide.variables?.approve === false} onClick={() => open && decide.mutate({ id: open.id, approve: false })}>
                رفض
              </Btn>
              <Btn loading={decide.isPending && decide.variables?.approve === true} onClick={() => open && decide.mutate({ id: open.id, approve: true })}>
                موافقة
              </Btn>
            </>
          ) : (
            <Btn variant="secondary" onClick={() => setOpen(null)}>
              إغلاق
            </Btn>
          )
        }
      >
        {open && (
          <div className="space-y-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Badge>
              <span className="text-slate-500">
                {KIND_LABEL[open.staffKind ?? ''] ?? 'موظف'}
                {open.sectionName ? ` · ${open.sectionName}` : ''} · رُفع {formatDate(open.createdAt)}
              </span>
            </div>
            {open.reason && <div className="rounded-lg bg-slate-50 p-3 leading-7 text-slate-700">{open.reason}</div>}
            {open.attachment && <HubImage url={open.attachment} className="max-h-72 w-full rounded-lg object-contain ring-1 ring-slate-200" />}
            {open.status === 'pending' ? (
              <Field label="ملاحظة للموظف (اختياري)">
                <Textarea rows={3} maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
              </Field>
            ) : (
              open.decidedAt && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[12px] text-slate-500">
                    {open.decidedBy?.replace(/^manager:/, '')} · {formatDate(open.decidedAt)}
                  </div>
                  {open.decidedNote && <div className="mt-1 text-slate-700">{open.decidedNote}</div>}
                </div>
              )
            )}
          </div>
        )}
      </Modal>
    </WorkspacePage>
  );
}

function WeeklyTable({ staff, saving, onSave }: { staff: TeamDirStaffDto[]; saving: boolean; onSave: (id: number, mask: number) => void }) {
  const [draft, setDraft] = useState<Record<number, number>>({});
  const perDay = DAYS.map((_, i) => staff.filter(s => ((draft[s.id] ?? s.weeklyOff) >> i) & 1).length);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[12px] text-slate-500">
          <tr>
            <th className="px-4 py-2 text-right font-semibold">الموظف</th>
            {DAYS.map((d, i) => (
              <th key={d} className="px-1 py-2 text-center font-semibold">
                {d}
                <div className="text-[10.5px] font-normal text-slate-400">{perDay[i] ? `${perDay[i]} في عطلة` : '—'}</div>
              </th>
            ))}
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>
          {staff.map(s => {
            const mask = draft[s.id] ?? s.weeklyOff;
            const dirty = mask !== s.weeklyOff;
            return (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-1.5">
                  <div className="font-semibold text-slate-800">{s.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {KIND_LABEL[s.kind] ?? s.kind}
                    {s.sectionName ? ` · ${s.sectionName}` : ''}
                    {!s.weeklyOff && <span className="text-amber-600"> · بلا عطلة محددة</span>}
                  </div>
                </td>
                {DAYS.map((d, i) => {
                  const on = ((mask >> i) & 1) === 1;
                  return (
                    <td key={d} className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${d} — ${s.name}`}
                        onClick={() => setDraft(x => ({ ...x, [s.id]: mask ^ (1 << i) }))}
                        className={`h-8 w-full max-w-[64px] rounded-md text-[11.5px] font-semibold transition ${on ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                      >
                        {on ? 'عطلة' : '·'}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-left">
                  {dirty && (
                    <span className="flex gap-1">
                      <Btn size="xs" loading={saving} onClick={() => onSave(s.id, mask)}>
                        حفظ
                      </Btn>
                      <Btn size="xs" variant="ghost" onClick={() => setDraft(x => ({ ...x, [s.id]: s.weeklyOff }))}>
                        تراجع
                      </Btn>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═════════════ الجمهور ═════════════ */
function AudienceField({ value, onChange, staff }: { value: TeamAudience; onChange: (a: TeamAudience) => void; staff: TeamDirStaffDto[] }) {
  const kinds = value.kinds ?? [];
  const picked = value.staff ?? [];
  const all = !!value.all || (!kinds.length && !picked.length);
  const active = staff.filter(s => s.isActive);
  const count = all ? active.length : active.filter(s => kinds.includes(s.kind) || picked.includes(s.id)).length;
  const set = (k: string[], p: number[]) => onChange(k.length || p.length ? { kinds: k, staff: p } : { all: true });
  return (
    <Field label={`الجمهور · ${count} موظف`}>
      <div className="flex flex-wrap gap-3">
        <Checkbox label="كل الموظفين" checked={all} onChange={() => onChange({ all: true })} />
        {(
          [
            ['seller', 'البائعون'],
            ['cashier', 'الكاشيرية'],
            ['supervisor', 'المشرفون'],
          ] as const
        ).map(([k, l]) => (
          <Checkbox key={k} label={l} checked={!all && kinds.includes(k)} onChange={v => set(v ? [...kinds, k] : kinds.filter(x => x !== k), picked)} />
        ))}
      </div>
      <div className="mt-2 max-h-36 overflow-auto rounded-lg border border-slate-200 p-2">
        <div className="mb-1 text-[11.5px] text-slate-400">أو موظفون محددون:</div>
        <div className="grid grid-cols-2 gap-1.5">
          {active.map(s => (
            <Checkbox key={s.id} label={s.name} checked={picked.includes(s.id)} onChange={v => set(kinds, v ? [...picked, s.id] : picked.filter(x => x !== s.id))} />
          ))}
        </div>
      </div>
    </Field>
  );
}

function ImagesField({ value, onChange, max = 6 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(0);
  async function pick(files: FileList | null) {
    if (!files) return;
    const list = [...files].slice(0, max - value.length);
    setBusy(list.length);
    const added: string[] = [];
    for (const f of list) {
      try {
        added.push((await api.uploadTeamMedia(await compress(f))).url);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'تعذر رفع الصورة');
      } finally {
        setBusy(b => b - 1);
      }
    }
    onChange([...value, ...added]);
    if (input.current) input.current.value = '';
  }
  return (
    <div className="flex flex-wrap gap-2">
      {value.map(u => (
        <div key={u} className="relative h-20 w-20 overflow-hidden rounded-lg ring-1 ring-slate-200">
          <HubImage url={u} className="h-full w-full object-cover" />
          <button type="button" className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[11px] text-white" onClick={() => onChange(value.filter(x => x !== u))}>
            ✕
          </button>
        </div>
      ))}
      {Array.from({ length: busy }, (_, i) => (
        <div key={i} className="h-20 w-20 animate-pulse rounded-lg bg-slate-100" />
      ))}
      {value.length + busy < max && (
        <button
          type="button"
          className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-[12px] text-slate-500 hover:bg-slate-50"
          onClick={() => input.current?.click()}
        >
          + صورة
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple={max > 1} hidden onChange={e => void pick(e.target.files)} />
    </div>
  );
}

/* ═════════════ الإعلانات ═════════════ */
const EMPTY_POST: TeamPostSave = { kind: 'news', title: '', body: '', images: [], audience: { all: true }, pinned: false, requiresAck: false, expiresAt: null, notify: true };

export function TeamPostsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const postsQ = useHub(['team-posts'], api.teamPosts);
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const [edit, setEdit] = useState<{ id?: number; form: TeamPostSave } | null>(null);
  const [readers, setReaders] = useState<TeamPostDto | null>(null);
  const readersQ = useQuery({ queryKey: ['team-post-readers', readers?.id], queryFn: () => api.teamPostReaders(readers!.id), enabled: !!readers });

  const save = useMutation({
    mutationFn: () => api.saveTeamPost({ ...edit!.form, expiresAt: edit!.form.expiresAt ? `${edit!.form.expiresAt.slice(0, 10)}T23:59:00+03:00` : null }, edit!.id),
    onSuccess: () => {
      toast.success(edit?.id ? 'حُفظ الإعلان' : 'نُشر الإعلان ووصل للفريق');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['team-posts'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر النشر'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTeamPost(id),
    onSuccess: () => {
      toast.success('حُذف الإعلان');
      void qc.invalidateQueries({ queryKey: ['team-posts'] });
    },
  });

  const posts = postsQ.data ?? [];
  const f = edit?.form;
  const setF = (p: Partial<TeamPostSave>) => setEdit(e => (e ? { ...e, form: { ...e.form, ...p } } : e));

  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar>
          <FilterLabel label="الإعلانات">
            <span className="text-[12.5px] text-slate-500">أخبار وعروض وتعليمات تظهر في تطبيق الفريق مع تبليغ فوري</span>
          </FilterLabel>
          <FilterActions>
            <IconButton label="تحديث" onClick={() => void postsQ.refetch()}>
              <IconRefresh size={15} className={postsQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn icon={<IconPlus size={15} />} onClick={() => setEdit({ form: { ...EMPTY_POST } })}>
              إعلان جديد
            </Btn>
          </FilterActions>
        </FilterBar>
        <SummaryStrip
          loading={postsQ.isLoading}
          cells={[
            { label: 'الإعلانات', value: formatNum(posts.length), tone: 'brand' },
            { label: 'مثبّتة', value: formatNum(posts.filter(p => p.pinned).length) },
            { label: 'تتطلب تأكيداً', value: formatNum(posts.filter(p => p.requiresAck).length) },
            { label: 'منتهية', value: formatNum(posts.filter(p => p.expired).length) },
          ]}
        />
        <WorkspaceBody>
          {postsQ.isError ? (
            <ErrorBlock error={postsQ.error} onRetry={() => void postsQ.refetch()} />
          ) : postsQ.isLoading ? (
            <TableSkeleton rows={6} />
          ) : !posts.length ? (
            <div className="p-10 text-center text-[13px] text-slate-500">لا إعلانات بعد — انشر أول إعلان للفريق.</div>
          ) : (
            <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-auto p-4 md:grid-cols-2 xl:grid-cols-3">
              {posts.map(p => {
                const pct = p.targetCount ? Math.round((p.readCount / p.targetCount) * 100) : 0;
                return (
                  <article key={p.id} className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${p.expired ? 'opacity-60' : ''}`}>
                    {p.images[0] && <HubImage url={p.images[0]} className="h-40 w-full object-cover" />}
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={POST_KIND[p.kind]?.tone ?? 'default'}>{POST_KIND[p.kind]?.label ?? p.kind}</Badge>
                        {p.pinned && <Badge tone="warn">مثبّت</Badge>}
                        {p.requiresAck && <Badge tone="info">تأكيد اطلاع</Badge>}
                        {p.expired && <Badge>منتهي</Badge>}
                        {p.images.length > 1 && <span className="text-[11px] text-slate-400">{p.images.length} صور</span>}
                      </div>
                      <h3 className="text-[14.5px] font-bold leading-6 text-slate-800">{p.title}</h3>
                      {p.body && <p className="line-clamp-3 whitespace-pre-line text-[12.5px] leading-6 text-slate-600">{p.body}</p>}
                      <div className="mt-auto space-y-1 pt-2 text-[11.5px] text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="w-10">قرأه</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="num w-12 text-left">
                            {p.readCount}/{p.targetCount}
                          </span>
                        </div>
                        {p.requiresAck && (
                          <div className="flex items-center gap-2">
                            <span className="w-10">أكّد</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-amber-500" style={{ width: `${p.targetCount ? (p.ackCount / p.targetCount) * 100 : 0}%` }} />
                            </div>
                            <span className="num w-12 text-left">
                              {p.ackCount}/{p.targetCount}
                            </span>
                          </div>
                        )}
                        <div>
                          {p.audienceLabel} · {p.createdBy?.replace(/^manager:/, '')} · {formatDate(p.createdAt)}
                        </div>
                      </div>
                      <div className="flex gap-1.5 border-t border-slate-100 pt-2">
                        <Btn size="xs" variant="soft" onClick={() => setReaders(p)}>
                          من قرأ؟
                        </Btn>
                        <Btn
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            setEdit({
                              id: p.id,
                              form: { kind: p.kind, title: p.title, body: p.body ?? '', images: p.images, audience: p.audience, pinned: p.pinned, requiresAck: p.requiresAck, expiresAt: p.expiresAt?.slice(0, 10) ?? null },
                            })
                          }
                        >
                          تعديل
                        </Btn>
                        <Btn
                          size="xs"
                          variant="ghost"
                          className="!text-red-600"
                          onClick={async () => {
                            if (await confirm({ title: 'حذف الإعلان؟', message: `سيختفي «${p.title}» من تطبيق الفريق.`, confirmLabel: 'حذف' })) remove.mutate(p.id);
                          }}
                        >
                          حذف
                        </Btn>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        wide
        title={edit?.id ? 'تعديل الإعلان' : 'إعلان جديد'}
        subtitle="يظهر في تطبيق الفريق فوراً"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setEdit(null)}>
              إلغاء
            </Btn>
            <Btn loading={save.isPending} disabled={!f?.title.trim()} onClick={() => save.mutate()}>
              {edit?.id ? 'حفظ' : 'نشر'}
            </Btn>
          </>
        }
      >
        {f && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="النوع">
                <Select value={f.kind} onChange={e => setF({ kind: e.target.value })}>
                  {Object.entries(POST_KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="col-span-2">
                <Field label="العنوان">
                  <Input maxLength={160} value={f.title} onChange={e => setF({ title: e.target.value })} />
                </Field>
              </div>
            </div>
            <Field label="التفاصيل">
              <Textarea rows={4} maxLength={6000} value={f.body ?? ''} onChange={e => setF({ body: e.target.value })} />
            </Field>
            <Field label="الصور (حتى 6 — تُضغط تلقائياً)">
              <ImagesField value={f.images} onChange={images => setF({ images })} />
            </Field>
            <AudienceField value={f.audience} onChange={audience => setF({ audience })} staff={dirQ.data ?? []} />
            <div className="flex flex-wrap items-center gap-5">
              <Switch label="تثبيت أعلى القائمة" checked={f.pinned} onChange={pinned => setF({ pinned })} />
              <Switch label="يتطلب تأكيد «اطّلعت»" checked={f.requiresAck} onChange={requiresAck => setF({ requiresAck })} />
              {!edit?.id && <Switch label="إرسال تبليغ" checked={f.notify !== false} onChange={notify => setF({ notify })} />}
            </div>
            <Field label="ينتهي في (اختياري)">
              <Input type="date" value={f.expiresAt?.slice(0, 10) ?? ''} onChange={e => setF({ expiresAt: e.target.value || null })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!readers} onClose={() => setReaders(null)} title={readers ? `من قرأ «${readers.title}»؟` : ''} subtitle={readers?.audienceLabel}>
        {readersQ.isLoading ? (
          <TableSkeleton rows={5} />
        ) : (
          <div className="divide-y divide-slate-100 text-[13px]">
            {(readersQ.data ?? []).map(r => (
              <div key={r.staffId} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-semibold">{r.name}</span> <span className="text-[11.5px] text-slate-400">{KIND_LABEL[r.kind] ?? r.kind}</span>
                </span>
                {r.ackAt ? (
                  <Badge tone="ok">أكّد · {formatDate(r.ackAt)}</Badge>
                ) : r.readAt ? (
                  <Badge tone="info">قرأ · {formatDate(r.readAt)}</Badge>
                ) : (
                  <Badge>لم يقرأ</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </WorkspacePage>
  );
}

/* ═════════════ التبليغات ═════════════ */
export function TeamNotifyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const logQ = useHub(['team-notify-log'], api.teamNotifyLog);
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string[]>([]);
  const [audience, setAudience] = useState<TeamAudience>({ all: true });

  const send = useMutation({
    mutationFn: () => api.teamNotify({ title: title.trim(), body: body.trim() || undefined, image: image[0] ?? null, audience }),
    onSuccess: r => {
      toast.success(`وصل التبليغ إلى ${r.count} موظف`);
      setTitle('');
      setBody('');
      setImage([]);
      void qc.invalidateQueries({ queryKey: ['team-notify-log'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإرسال'),
  });

  return (
    <WorkspacePage>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[420px_1fr]">
        <section className="card space-y-3 p-4">
          <h2 className="text-[15px] font-bold text-slate-800">تبليغ جديد</h2>
          <p className="text-[12.5px] text-slate-500">رسالة فورية تظهر في مركز التبليغات بتطبيق الفريق.</p>
          <Field label="العنوان">
            <Input maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: اجتماع الساعة 9 صباحاً" />
          </Field>
          <Field label="النص (اختياري)">
            <Textarea rows={4} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} />
          </Field>
          <Field label="صورة (اختياري)">
            <ImagesField value={image} onChange={setImage} max={1} />
          </Field>
          <AudienceField value={audience} onChange={setAudience} staff={dirQ.data ?? []} />
          <Btn className="w-full" loading={send.isPending} disabled={!title.trim()} onClick={() => send.mutate()}>
            إرسال الآن
          </Btn>
        </section>
        <WorkspaceCard>
          <FilterBar>
            <FilterLabel label="سجل الإرسال">
              <span className="text-[12.5px] text-slate-500">آخر 100 تبليغ ونسبة القراءة</span>
            </FilterLabel>
          </FilterBar>
          <WorkspaceBody>
            {logQ.isError ? (
              <ErrorBlock error={logQ.error} onRetry={() => void logQ.refetch()} />
            ) : logQ.isLoading ? (
              <TableSkeleton rows={6} />
            ) : (
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                dense
                rows={logQ.data ?? []}
                getRowId={r => r.id}
                storageKey="team-notify-log"
                exportName="سجل-التبليغات"
                counterLabel="تبليغ"
                emptyText="لم تُرسل تبليغات بعد"
                columns={[
                  { key: 'title', header: 'العنوان', width: 260, render: r => <span className="font-semibold text-slate-800">{r.title}</span> },
                  { key: 'audienceLabel', header: 'الجمهور', width: 160 },
                  {
                    key: 'read',
                    header: 'القراءة',
                    width: 170,
                    sortValue: r => (r.targetCount ? r.readCount / r.targetCount : 0),
                    exportValue: r => `${r.readCount}/${r.targetCount}`,
                    render: r => (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${r.targetCount ? (r.readCount / r.targetCount) * 100 : 0}%` }} />
                        </span>
                        <span className="num text-[12px]">
                          {r.readCount}/{r.targetCount}
                        </span>
                      </span>
                    ),
                  },
                  { key: 'createdBy', header: 'المرسل', width: 140, render: r => r.createdBy?.replace(/^manager:/, '') ?? '—' },
                  { key: 'createdAt', header: 'الوقت', width: 150, render: r => formatDate(r.createdAt) },
                ]}
              />
            )}
          </WorkspaceBody>
        </WorkspaceCard>
      </div>
    </WorkspacePage>
  );
}
