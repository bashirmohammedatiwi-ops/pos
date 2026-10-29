import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate, formatNum } from '@/api/client';
import type { TeamAttendDto, TeamAttendSettingsDto, TeamBoardDto, TeamBoardStatus, TeamNetworkDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { FilterActions, FilterBar, FilterLabel, SegmentedFilter, SummaryStrip, WorkspaceBody, WorkspaceCard, WorkspacePage } from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import { IconPlus, IconRefresh } from '@/components/icons';
import { Badge, Btn, Field, IconButton, Input, Modal, Select, Switch, TableSkeleton, useConfirm } from '@/components/ui';
import { ErrorBlock, SearchBox } from '@/components/people/PeopleKit';
import { WifiScanModal, saveNetworkSmart } from './TeamWifiScan';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← الحضور: اللوحة الحيّة، السجل والتصدير، التصحيح والإضافة اليدوية،
 * الشبكات المسموحة وقواعد الدوام والورديات، وسجل التدقيق.
 * ───────────────────────────────────────────────────────────────────────────── */

const KIND: Record<string, string> = { seller: 'بائع', cashier: 'كاشير', supervisor: 'مشرف', other: 'موظف' };
const STATUS: Record<TeamBoardStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'default' | 'info' | 'violet' }> = {
  in: { label: 'في الدوام', tone: 'ok' },
  break: { label: 'في استراحة', tone: 'warn' },
  over: { label: 'تجاوز الاستراحة', tone: 'danger' },
  out: { label: 'انصرف', tone: 'default' },
  off: { label: 'عطلة/إجازة', tone: 'violet' },
  soon: { label: 'لم يبدأ دوامه', tone: 'default' },
  missing: { label: 'لم يحضر', tone: 'danger' },
  absent: { label: 'غائب', tone: 'danger' },
};
const iraqDate = (offsetDays = 0) => new Date(Date.now() + 3 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ar-IQ-u-nu-latn', { hour: 'numeric', minute: '2-digit' }) : '—');
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const dur = (min: number) => (min < 60 ? `${min} د` : `${Math.floor(min / 60)} س${min % 60 ? ` ${min % 60} د` : ''}`);
const toLocal = (iso?: string | null) => (iso ? new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 16) : '');
/** قائمة BSSID من نص: كل سطر أو فاصلة أو مسافة نقطة بث */
const splitBssids = (text: string) => [...new Set(text.split(/[\s,،;]+/).map(x => x.trim().toLowerCase().replace(/-/g, ':')).filter(Boolean))];
const fromLocal = (v: string) => (v ? new Date(`${v}:00+03:00`).toISOString() : undefined);

/* ═════════════ الحضور: اللوحة والسجل ═════════════ */
type AttendView = 'board' | 'log';

export function TeamAttendPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<AttendView>('board');
  const [from, setFrom] = useState(iraqDate(-6));
  const [to, setTo] = useState(iraqDate());
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<{ rec?: TeamAttendDto; staffId?: number; checkIn: string; checkOut: string; note: string } | null>(null);

  const boardQ = useQuery({ queryKey: ['team-board'], queryFn: api.teamBoard, retry: 0, refetchInterval: 20_000, enabled: view === 'board' });
  const logQ = useQuery({ queryKey: ['team-attend-log', from, to], queryFn: () => api.teamAttendLog(from, to), retry: 0, enabled: view === 'log' });
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });

  const save = useMutation({
    mutationFn: async () => {
      if (!edit) return null;
      if (edit.rec) return api.correctTeamAttend(edit.rec.id, { checkIn: fromLocal(edit.checkIn), checkOut: edit.checkOut ? fromLocal(edit.checkOut) : null, note: edit.note || 'تصحيح من لوحة التحكم' });
      return api.manualTeamAttend({ staffId: edit.staffId!, checkIn: fromLocal(edit.checkIn)!, checkOut: edit.checkOut ? fromLocal(edit.checkOut) : null, note: edit.note || 'إضافة يدوية' });
    },
    onSuccess: () => {
      toast.success('حُفظ السجل — يظهر للموظف «معدّل»');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['team-attend-log'] });
      void qc.invalidateQueries({ queryKey: ['team-board'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const board: TeamBoardDto | undefined = boardQ.data;
  const boardRows = useMemo(() => {
    const q = search.trim();
    const order: TeamBoardStatus[] = ['over', 'missing', 'break', 'in', 'soon', 'out', 'off', 'absent'];
    return (board?.rows ?? []).filter(r => !q || r.name.includes(q)).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  }, [board, search]);
  const logRows = useMemo(() => {
    const q = search.trim();
    return (logQ.data ?? []).filter(r => !q || (r.staffName ?? '').includes(q));
  }, [logQ.data, search]);
  const totals = useMemo(() => {
    const rows = logRows;
    return {
      worked: rows.reduce((s, r) => s + r.workedMinutes, 0),
      late: rows.filter(r => r.lateMinutes > 0).length,
      over: rows.reduce((s, r) => s + r.overMinutes, 0),
      ot: rows.reduce((s, r) => s + (r.overtimeMinutes ?? 0), 0),
      auto: rows.filter(r => r.autoClosed).length,
    };
  }, [logRows]);

  const logCols: GridColumn<TeamAttendDto>[] = [
    { key: 'date', header: 'التاريخ', width: 110, render: r => r.date },
    { key: 'staffName', header: 'الموظف', width: 160, render: r => <span className="font-semibold">{r.staffName}</span> },
    { key: 'staffKind', header: 'النوع', width: 80, render: r => KIND[r.staffKind ?? ''] ?? '—' },
    { key: 'checkIn', header: 'الحضور', width: 90, exportValue: r => clock(r.checkIn), render: r => clock(r.checkIn) },
    { key: 'checkOut', header: 'الانصراف', width: 90, exportValue: r => clock(r.checkOut), render: r => (r.checkOut ? clock(r.checkOut) : <Badge tone="ok">مستمر</Badge>) },
    { key: 'workedMinutes', header: 'ساعات العمل', width: 100, exportValue: r => hm(r.workedMinutes), render: r => <span className="num font-semibold">{hm(r.workedMinutes)}</span> },
    {
      key: 'overtimeMinutes',
      header: 'أوفر تايم',
      width: 90,
      exportValue: r => (r.overtimeMinutes ? hm(r.overtimeMinutes) : ''),
      render: r => (r.overtimeMinutes ? <Badge tone="info">{hm(r.overtimeMinutes)}</Badge> : '—'),
    },
    { key: 'breakMinutes', header: 'الاستراحة', width: 90, exportValue: r => r.breakMinutes, render: r => `${r.breakMinutes} د` },
    { key: 'lateMinutes', header: 'التأخير', width: 90, exportValue: r => r.lateMinutes, render: r => (r.lateMinutes ? <Badge tone="warn">{dur(r.lateMinutes)}</Badge> : '—') },
    { key: 'overMinutes', header: 'تجاوز الاستراحة', width: 110, exportValue: r => r.overMinutes, render: r => (r.overMinutes ? <Badge tone="danger">{r.overMinutes} د</Badge> : '—') },
    {
      key: 'flags',
      header: 'ملاحظات',
      width: 190,
      exportValue: r => [r.autoClosed ? 'إغلاق تلقائي' : '', r.edited ? `معدّل (${r.editedBy ?? ''})` : '', r.note ?? ''].filter(Boolean).join(' · '),
      render: r => (
        <span className="flex flex-wrap gap-1">
          {r.autoClosed && <Badge tone="warn">إغلاق تلقائي</Badge>}
          {r.edited && <Badge tone="info">معدّل</Badge>}
          {r.note && <span className="truncate text-[11.5px] text-slate-500">{r.note}</span>}
        </span>
      ),
    },
    { key: 'inBssid', header: 'الشبكة', width: 160, render: r => <span className="num text-[11px] text-slate-400">{r.inBssid || r.inIp || '—'}</span> },
  ];

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
                { id: 'board', label: 'اللوحة الحيّة', count: board ? board.counts.over + board.counts.missing : undefined, tone: board && board.counts.over + board.counts.missing ? 'danger' : undefined },
                { id: 'log', label: 'السجل والتقرير' },
              ]}
            />
          </FilterLabel>
          {view === 'log' && (
            <>
              <FilterLabel label="من">
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </FilterLabel>
              <FilterLabel label="إلى">
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
              </FilterLabel>
            </>
          )}
          <FilterLabel label="بحث">
            <SearchBox value={search} onChange={setSearch} placeholder="اسم الموظف…" />
          </FilterLabel>
          <FilterActions>
            <IconButton
              label="تحديث"
              onClick={() => {
                void boardQ.refetch();
                void logQ.refetch();
              }}
            >
              <IconRefresh size={15} className={boardQ.isFetching || logQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn variant="secondary" icon={<IconPlus size={15} />} onClick={() => setEdit({ staffId: dirQ.data?.[0]?.id, checkIn: `${iraqDate()}T10:00`, checkOut: '', note: '' })}>
              إضافة يدوية
            </Btn>
          </FilterActions>
        </FilterBar>

        {view === 'board' ? (
          <SummaryStrip
            loading={boardQ.isLoading}
            cells={[
              { label: 'في الدوام', value: board ? formatNum(board.counts.in) : '—', tone: 'ok' },
              { label: 'في استراحة', value: board ? formatNum(board.counts.break) : '—', tone: board?.counts.over ? 'danger' : 'warn' },
              { label: 'لم يحضر', value: board ? formatNum(board.counts.missing) : '—', tone: board?.counts.missing ? 'danger' : undefined },
              { label: 'انصرف', value: board ? formatNum(board.counts.out) : '—' },
              { label: 'عطلة/إجازة', value: board ? formatNum(board.counts.off) : '—' },
              { label: 'متأخرون اليوم', value: board ? formatNum(board.counts.late) : '—', tone: board?.counts.late ? 'warn' : undefined },
            ]}
          />
        ) : (
          <SummaryStrip
            loading={logQ.isLoading}
            cells={[
              { label: 'سجلات', value: formatNum(logRows.length), tone: 'brand' },
              { label: 'ساعات العمل', value: hm(totals.worked) },
              { label: 'أيام تأخير', value: formatNum(totals.late), tone: totals.late ? 'warn' : undefined },
              { label: 'تجاوز الاستراحات', value: `${formatNum(totals.over)} د`, tone: totals.over ? 'danger' : undefined },
              { label: 'أوفر تايم', value: hm(totals.ot), tone: totals.ot ? 'brand' : undefined },
              { label: 'إغلاق تلقائي', value: formatNum(totals.auto) },
            ]}
          />
        )}
        {view === 'board' && board && board.network.enforced && board.network.count === 0 && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-[12.5px] font-semibold text-red-700">
            لم تُضبط شبكات المحل — الموظفون لا يستطيعون تسجيل الحضور. أضفها من «الشبكات وقواعد الدوام».
          </div>
        )}

        <WorkspaceBody>
          {view === 'board' ? (
            boardQ.isError ? (
              <ErrorBlock error={boardQ.error} onRetry={() => void boardQ.refetch()} />
            ) : boardQ.isLoading ? (
              <TableSkeleton rows={8} />
            ) : (
              <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
                {boardRows.map(r => {
                  const a = r.attendance;
                  const ob = a?.breaks.find(b => !b.endAt);
                  return (
                    <button
                      key={r.staffId}
                      type="button"
                      className={`rounded-xl border bg-white p-3 text-right shadow-sm transition hover:border-brand-300 ${r.status === 'over' || r.status === 'missing' ? 'border-red-200' : 'border-slate-200'}`}
                      onClick={() => a && setEdit({ rec: a, checkIn: toLocal(a.checkIn), checkOut: toLocal(a.checkOut), note: '' })}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-bold text-slate-800">{r.name}</span>
                        <Badge tone={STATUS[r.status].tone} dot>
                          {STATUS[r.status].label}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11.5px] text-slate-500">
                        {KIND[r.kind] ?? r.kind}
                        {r.sectionName ? ` · ${r.sectionName}` : ''} · الوردية {r.shift.start}–{r.shift.end}
                      </div>
                      <div className="mt-2 text-[12.5px] text-slate-700">
                        {a ? (
                          <>
                            حضر {clock(a.checkIn)}
                            {a.lateMinutes ? <span className="text-amber-700"> · متأخر {dur(a.lateMinutes)}</span> : ''}
                            {a.checkOut ? ` · انصرف ${clock(a.checkOut)}` : ''} · عمل {hm(a.workedMinutes)}
                            {ob ? <span className={ob.overMinutes ? 'text-red-600' : 'text-amber-700'}> · استراحة منذ {clock(ob.startAt)}{ob.overMinutes ? ` (تجاوز ${ob.overMinutes} د)` : ''}</span> : ''}
                          </>
                        ) : r.status === 'off' ? (
                          'لا دوام اليوم'
                        ) : (
                          'لم يسجّل حضوره'
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : logQ.isError ? (
            <ErrorBlock error={logQ.error} onRetry={() => void logQ.refetch()} />
          ) : logQ.isLoading ? (
            <TableSkeleton rows={10} />
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              rows={logRows}
              columns={logCols}
              getRowId={r => r.id}
              onRowClick={r => setEdit({ rec: r, checkIn: toLocal(r.checkIn), checkOut: toLocal(r.checkOut), note: r.note ?? '' })}
              storageKey="team-attend-log"
              exportName={`حضور-الفريق-${from}-${to}`}
              counterLabel="سجل"
              emptyText="لا سجلات في هذه المدة"
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.rec ? `تصحيح حضور ${edit.rec.staffName ?? ''}` : 'إضافة حضور يدوي'}
        subtitle={edit?.rec ? edit.rec.date : 'لموظف نسي البصمة أو تعطل هاتفه'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setEdit(null)}>
              إلغاء
            </Btn>
            <Btn loading={save.isPending} disabled={!edit?.checkIn || (!edit?.rec && !edit?.staffId)} onClick={() => save.mutate()}>
              حفظ
            </Btn>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            {!edit.rec && (
              <Field label="الموظف">
                <Select value={edit.staffId ?? ''} onChange={e => setEdit(x => (x ? { ...x, staffId: Number(e.target.value) } : x))}>
                  {(dirQ.data ?? [])
                    .filter(s => s.isActive)
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="الحضور">
                <Input type="datetime-local" value={edit.checkIn} onChange={e => setEdit(x => (x ? { ...x, checkIn: e.target.value } : x))} />
              </Field>
              <Field label="الانصراف (اختياري)">
                <Input type="datetime-local" value={edit.checkOut} onChange={e => setEdit(x => (x ? { ...x, checkOut: e.target.value } : x))} />
              </Field>
            </div>
            <Field label="السبب">
              <Input value={edit.note} onChange={e => setEdit(x => (x ? { ...x, note: e.target.value } : x))} placeholder="مثال: نسي تسجيل الانصراف" />
            </Field>
            {edit.rec && (
              <p className="text-[12px] text-slate-500">
                الأوقات بتوقيت العراق. يُحفظ اسمك في سجل التدقيق ويظهر للموظف أن السجل «معدّل».
              </p>
            )}
          </div>
        )}
      </Modal>
    </WorkspacePage>
  );
}

/* ═════════════ الشبكات وقواعد الدوام والورديات ═════════════ */
export function TeamRulesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const setQ = useQuery({ queryKey: ['team-attend-settings'], queryFn: api.teamAttendSettings, retry: 0 });
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const boardQ = useQuery({ queryKey: ['team-board'], queryFn: api.teamBoard, retry: 0 });
  const [form, setForm] = useState<TeamAttendSettingsDto | null>(null);
  const [net, setNet] = useState<(Partial<TeamNetworkDto> & { bssidText?: string }) | null>(null);
  const [shiftEdit, setShiftEdit] = useState<{ id: number; name: string; start: string; end: string; breakMinutes: string; maxBreaks: string; overtime: boolean; overtimeRate: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (setQ.data && !form) setForm(setQ.data.settings);
  }, [setQ.data, form]);

  const saveSettings = useMutation({
    mutationFn: () => api.saveTeamAttendSettings(form!),
    onSuccess: s => {
      setForm(s);
      toast.success('حُفظت قواعد الدوام');
      void qc.invalidateQueries({ queryKey: ['team-attend-settings'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const saveNet = useMutation({
    mutationFn: () =>
      saveNetworkSmart(
        { name: net?.name ?? '', ssid: net?.ssid ?? null, bssids: splitBssids(net?.bssidText ?? ''), ip: net?.ip?.trim() || null, isActive: net?.isActive !== false },
        { id: net?.id, legacy: legacyHub, known: legacyHub ? new Set(nets.filter(n => n.id !== net?.id).flatMap(n => n.bssids ?? (n.bssid ? [n.bssid] : []))) : undefined },
      ),
    onSuccess: () => {
      toast.success('حُفظت الشبكة');
      setNet(null);
      void qc.invalidateQueries({ queryKey: ['team-attend-settings'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });
  const delNet = useMutation({
    mutationFn: (id: number) => api.deleteTeamNetwork(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team-attend-settings'] }),
  });
  const saveShift = useMutation({
    mutationFn: async (reset?: boolean) => {
      const e = shiftEdit!;
      await api.setTeamShift(e.id, reset ? { reset: true } : { start: e.start, end: e.end, breakMinutes: Number(e.breakMinutes), maxBreaks: Number(e.maxBreaks) });
      return api.setTeamOvertime(e.id, e.overtime, e.overtimeRate ? Number(e.overtimeRate) : null);
    },
    onSuccess: () => {
      toast.success('حُفظت وردية الموظف');
      setShiftEdit(null);
      void qc.invalidateQueries({ queryKey: ['team-board'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const quickOvertime = useMutation({
    mutationFn: ({ id, on, rate }: { id: number; on: boolean; rate: number | null }) => api.setTeamOvertime(id, on, rate),
    onSuccess: (_, v) => {
      toast.success(v.on ? 'فُعّل الأوفر تايم — يُحتسب من اليوم' : 'أُوقف الأوفر تايم');
      void qc.invalidateQueries({ queryKey: ['team-board'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const nets = setQ.data?.networks ?? [];
  // خادم فريق قديم على الـ VPS لا يرسل عنوان المحل المتعلَّم ولا يفهم عدة نقاط بث للشبكة
  const legacyHub = !!setQ.data && !('shopIp' in setQ.data);
  const shiftOf = useMemo(() => new Map((boardQ.data?.rows ?? []).map(r => [r.staffId, r.shift])), [boardQ.data]);
  const f = form;
  const num = (k: keyof TeamAttendSettingsDto, v: string) => setForm(x => (x ? { ...x, [k]: Number(v.replace(/\D/g, '') || 0) } : x));

  if (setQ.isError) return <ErrorBlock error={setQ.error} onRetry={() => void setQ.refetch()} />;
  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-slate-800">شبكات المحل المسموحة</h2>
          <div className="flex gap-1.5">
            <Btn size="sm" icon={<IconRefresh size={14} />} onClick={() => setScanOpen(true)}>
              البحث عن الشبكات
            </Btn>
            <Btn size="sm" variant="secondary" icon={<IconPlus size={14} />} onClick={() => setNet({ name: '', bssidText: '', ip: '', isActive: true })}>
              يدوياً
            </Btn>
          </div>
        </div>
        <p className="text-[12.5px] leading-6 text-slate-500">
          البصمة تُقبل فقط من هذه الشبكات. «البحث عن الشبكات» يعرض شبكات الواي فاي حول هذا الجهاز فتختار شبكة المحل وتُضاف بكل نقاط بثها. عنوان الإنترنت يتبع عنوان المحل تلقائياً، فلا حاجة لإدخاله.
        </p>
        <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${setQ.data?.shopIp ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
          <span className="font-semibold">عنوان إنترنت المحل:</span>
          {setQ.data?.shopIp ? (
            <>
              <span className="num font-bold" dir="ltr">
                {setQ.data.shopIp.ip}
              </span>
              <span className="text-[11.5px] opacity-75">يتحدث تلقائياً · آخر تأكيد {formatDate(setQ.data.shopIp.at)}</span>
            </>
          ) : legacyHub ? (
            <span>خادم الفريق على الـ VPS بنسخة قديمة — حدّثه ليُعرف العنوان تلقائياً وتُحفظ كل شبكة بكل نقاط بثها</span>
          ) : (
            <span>لم يُعرف بعد — يُتعلَّم تلقائياً خلال دقيقة من اتصال سيرفر المحل بخادم الفريق</span>
          )}
        </div>
        {setQ.isLoading ? (
          <TableSkeleton rows={3} />
        ) : !nets.length ? (
          <div className="rounded-lg bg-amber-50 p-3 text-[12.5px] font-semibold text-amber-800">لا شبكات بعد — لن يستطيع أحد تسجيل الحضور ما دام الإلزام مفعّلاً.</div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {nets.map(n => (
              <div key={n.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800">
                    {n.name} {!n.isActive && <Badge>متوقفة</Badge>}{' '}
                    {(n.bssids?.length ?? (n.bssid ? 1 : 0)) > 0 && <Badge tone="info">{n.bssids?.length ?? 1} نقطة بث</Badge>}{' '}
                    {n.ip ? <Badge>عنوان ثابت</Badge> : legacyHub ? <Badge tone="warn">يُعرف العنوان بعد تحديث الخادم</Badge> : <Badge tone="ok">عنوان المحل تلقائياً</Badge>}
                  </div>
                  <div className="num text-[11.5px] leading-5 text-slate-500" dir="ltr" style={{ textAlign: 'right' }}>
                    {[...(n.bssids ?? (n.bssid ? [n.bssid] : [])), n.ip && `IP ${n.ip}`].filter(Boolean).join(' · ')}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {n.createdBy?.replace(/^manager:/, '')} · {formatDate(n.createdAt)}
                  </div>
                </div>
                <Btn size="xs" variant="ghost" onClick={() => setNet({ ...n, bssidText: (n.bssids ?? (n.bssid ? [n.bssid] : [])).join('\n') })}>
                  تعديل
                </Btn>
                <Btn
                  size="xs"
                  variant="ghost"
                  className="!text-red-600"
                  onClick={async () => {
                    if (await confirm({ title: 'حذف الشبكة؟', message: `لن تُقبل البصمة من «${n.name}» بعد الآن.`, confirmLabel: 'حذف' })) delNet.mutate(n.id);
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
        <h2 className="text-[15px] font-bold text-slate-800">قواعد الدوام والاستراحة</h2>
        {!f ? (
          <TableSkeleton rows={4} />
        ) : (
          <>
            <Switch label="إلزام البصمة من شبكة المحل" checked={f.enforceNetwork} onChange={v => setForm({ ...f, enforceNetwork: v })} />
            <Switch
              label="اشتراط عنوان إنترنت المحل"
              description="BSSID وحده يمكن تزويره من خارج المحل؛ مع العنوان لا تُقبل البصمة إلا من إنترنت المحل نفسه"
              checked={f.requireIp !== false}
              disabled={!f.enforceNetwork}
              onChange={v => setForm({ ...f, requireIp: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="بداية الدوام الافتراضي">
                <Input type="time" value={f.shiftStart} onChange={e => setForm({ ...f, shiftStart: e.target.value })} />
              </Field>
              <Field label="نهاية الدوام الافتراضي">
                <Input type="time" value={f.shiftEnd} onChange={e => setForm({ ...f, shiftEnd: e.target.value })} />
              </Field>
              <Field label="دقائق الاستراحة اليومية">
                <Input inputMode="numeric" value={f.breakMinutes} onChange={e => num('breakMinutes', e.target.value)} />
              </Field>
              <Field label="عدد مرات الاستراحة">
                <Input inputMode="numeric" value={f.maxBreaks} onChange={e => num('maxBreaks', e.target.value)} />
              </Field>
              <Field label="مهلة التأخير (دقيقة)" hint="التأخير يُحسب بعدها">
                <Input inputMode="numeric" value={f.graceMinutes} onChange={e => num('graceMinutes', e.target.value)} />
              </Field>
              <Field label="الحضور المبكر المسموح (دقيقة)">
                <Input inputMode="numeric" value={f.earlyMinutes} onChange={e => num('earlyMinutes', e.target.value)} />
              </Field>
              <Field label="تنبيه قبل نهاية الاستراحة (دقيقة)">
                <Input inputMode="numeric" value={f.breakWarnMinutes} onChange={e => num('breakWarnMinutes', e.target.value)} />
              </Field>
              <Field label="إغلاق الحضور المنسي بعد (ساعة)">
                <Input inputMode="numeric" value={f.autoCloseHours} onChange={e => num('autoCloseHours', e.target.value)} />
              </Field>
            </div>
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div>
                <div className="text-[13.5px] font-bold text-slate-800">الأوفر تايم</div>
                <p className="text-[11.5px] leading-5 text-slate-500">يُحتسب فقط للموظفين المفعّل لهم (من جدول الورديات أدناه): وقت العمل الفعلي بعد خصم الاستراحة ناقص الدوام الصافي.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="أقل مدة تُحتسب (دقيقة)" hint="أقل من ذلك = لا أوفر تايم">
                  <Input inputMode="numeric" value={f.otMinMinutes ?? 15} onChange={e => num('otMinMinutes', e.target.value)} />
                </Field>
                <Field label="التقريب لأقرب (دقيقة)" hint="للأسفل، مثلاً كل 15 دقيقة">
                  <Input inputMode="numeric" value={f.otRoundMinutes ?? 15} onChange={e => num('otRoundMinutes', e.target.value)} />
                </Field>
              </div>
              <Switch label="العمل في يوم العطلة كله أوفر تايم" checked={f.otCountDayOff !== false} onChange={v => setForm({ ...f, otCountDayOff: v })} />
            </div>
            <Btn loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
              حفظ القواعد
            </Btn>
          </>
        )}
      </section>

      <section className="card p-4 lg:col-span-2">
        <h2 className="mb-1 text-[15px] font-bold text-slate-800">ورديات الموظفين</h2>
        <p className="mb-3 text-[12.5px] text-slate-500">الافتراضي يُطبَّق على الجميع، ولكل موظف وردية خاصة عند الحاجة.</p>
        <div className="overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[12px] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right">الموظف</th>
                <th className="px-3 py-2 text-right">الوردية</th>
                <th className="px-3 py-2 text-right">الاستراحة</th>
                <th className="px-3 py-2 text-right">الأوفر تايم</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(dirQ.data ?? [])
                .filter(s => s.isActive)
                .map(s => {
                  const sh = shiftOf.get(s.id);
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        <span className="font-semibold">{s.name}</span> <span className="text-[11px] text-slate-400">{KIND[s.kind] ?? s.kind}</span>
                      </td>
                      <td className="num px-3 py-1.5">
                        {sh ? `${sh.start} – ${sh.end}` : '…'} {sh?.custom && <Badge tone="info">خاصة</Badge>}
                      </td>
                      <td className="px-3 py-1.5">{sh ? `${sh.breakMinutes} د · ${sh.maxBreaks} مرات` : '…'}</td>
                      <td className="px-3 py-1.5">
                        {sh && (
                          <span className="flex items-center gap-2">
                            <Switch
                              label=""
                              checked={!!sh.overtime}
                              disabled={quickOvertime.isPending}
                              onChange={v => quickOvertime.mutate({ id: s.id, on: v, rate: sh.overtimeRate ?? null })}
                            />
                            {sh.overtime && (
                              <span className="num text-[11.5px] text-slate-500">{sh.overtimeRate ? `${formatNum(sh.overtimeRate)} د.ع/ساعة` : 'بلا سعر'}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-left">
                        <Btn
                          size="xs"
                          variant="ghost"
                          disabled={!sh}
                          onClick={() =>
                            sh &&
                            setShiftEdit({
                              id: s.id,
                              name: s.name,
                              start: sh.start,
                              end: sh.end,
                              breakMinutes: String(sh.breakMinutes),
                              maxBreaks: String(sh.maxBreaks),
                              overtime: !!sh.overtime,
                              overtimeRate: sh.overtimeRate ? String(sh.overtimeRate) : '',
                            })
                          }
                        >
                          تعديل
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={!!net}
        onClose={() => setNet(null)}
        title={net?.id ? 'تعديل شبكة' : 'شبكة جديدة'}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setNet(null)}>
              إلغاء
            </Btn>
            <Btn loading={saveNet.isPending} disabled={!net?.name || (!splitBssids(net?.bssidText ?? '').length && !net?.ip?.trim())} onClick={() => saveNet.mutate()}>
              حفظ
            </Btn>
          </>
        }
      >
        {net && (
          <div className="space-y-3">
            <Field label="الاسم">
              <Input value={net.name ?? ''} onChange={e => setNet({ ...net, name: e.target.value })} placeholder="واي فاي الصالة" />
            </Field>
            <Field label={`نقاط البث (BSSID) — ${splitBssids(net.bssidText ?? '').length}`} hint="كل نقطة في سطر — الراوتر والمقويات والنطاقان 2.4/5 GHz لكل منها BSSID">
              <textarea
                dir="ltr"
                rows={5}
                value={net.bssidText ?? ''}
                onChange={e => setNet({ ...net, bssidText: e.target.value })}
                placeholder={'a4:2b:b0:12:34:56\na4:2b:b0:12:34:57'}
                className="num w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-brand-400"
              />
            </Field>
            <Field label="عنوان IP ثابت — اختياري" hint="اتركه فارغاً: يتبع عنوان إنترنت المحل تلقائياً (الأفضل). للمحلات بخطّي إنترنت ضع نطاقاً مثل 5.6.7.0/24">
              <Input dir="ltr" value={net.ip ?? ''} onChange={e => setNet({ ...net, ip: e.target.value })} placeholder="تلقائي" />
            </Field>
            <Switch label="مفعّلة" checked={net.isActive !== false} onChange={v => setNet({ ...net, isActive: v })} />
          </div>
        )}
      </Modal>

      <WifiScanModal open={scanOpen} onClose={() => setScanOpen(false)} existing={nets} shopIp={setQ.data?.shopIp?.ip ?? null} legacy={legacyHub} onAdded={() => void qc.invalidateQueries({ queryKey: ['team-attend-settings'] })} />

      <Modal
        open={!!shiftEdit}
        onClose={() => setShiftEdit(null)}
        title={`وردية ${shiftEdit?.name ?? ''}`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => saveShift.mutate(true)}>
              الرجوع للافتراضي
            </Btn>
            <Btn variant="secondary" onClick={() => setShiftEdit(null)}>
              إلغاء
            </Btn>
            <Btn loading={saveShift.isPending} onClick={() => saveShift.mutate(false)}>
              حفظ
            </Btn>
          </>
        }
      >
        {shiftEdit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="البداية">
              <Input type="time" value={shiftEdit.start} onChange={e => setShiftEdit({ ...shiftEdit, start: e.target.value })} />
            </Field>
            <Field label="النهاية">
              <Input type="time" value={shiftEdit.end} onChange={e => setShiftEdit({ ...shiftEdit, end: e.target.value })} />
            </Field>
            <Field label="دقائق الاستراحة">
              <Input inputMode="numeric" value={shiftEdit.breakMinutes} onChange={e => setShiftEdit({ ...shiftEdit, breakMinutes: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="عدد الاستراحات">
              <Input inputMode="numeric" value={shiftEdit.maxBreaks} onChange={e => setShiftEdit({ ...shiftEdit, maxBreaks: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <div className="col-span-2 space-y-3 rounded-lg border border-slate-200 p-3">
              <Switch
                label="احتساب الأوفر تايم لهذا الموظف"
                description="الوقت الزائد على دوامه الصافي يُسجَّل أوفر تايم ويظهر في الملخص الشهري وفي تطبيقه"
                checked={shiftEdit.overtime}
                onChange={v => setShiftEdit({ ...shiftEdit, overtime: v })}
              />
              {shiftEdit.overtime && (
                <Field label="أجر ساعة الأوفر تايم (دينار) — اختياري" hint="لحساب مبلغ الأوفر تايم في الملخص الشهري">
                  <Input inputMode="numeric" value={shiftEdit.overtimeRate} onChange={e => setShiftEdit({ ...shiftEdit, overtimeRate: e.target.value.replace(/\D/g, '') })} placeholder="مثال: 5000" />
                </Field>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ═════════════ سجل التدقيق ═════════════ */
const ACTION_LABEL: Record<string, string> = {
  login: 'دخول التطبيق',
  'device.bind': 'ربط هاتف',
  'device.reset': 'فك ربط هاتف',
  'attend.in': 'تسجيل حضور',
  'attend.out': 'تسجيل انصراف',
  'attend.correct': 'تصحيح حضور',
  'attend.autoclose': 'إغلاق حضور تلقائي',
  'attend.settings': 'تعديل قواعد الدوام',
  'break.start': 'بدء استراحة',
  'break.end': 'نهاية استراحة',
  'shift.set': 'تعديل وردية',
  'shift.reset': 'إرجاع الوردية للافتراضي',
  'network.create': 'إضافة شبكة',
  'network.update': 'تعديل شبكة',
  'network.delete': 'حذف شبكة',
  'leave.request': 'طلب إجازة',
  'leave.approved': 'موافقة على طلب',
  'leave.rejected': 'رفض طلب',
  'leave.cancel': 'إلغاء طلب',
  'weekly_off.set': 'تعديل عطلة أسبوعية',
  'post.create': 'نشر إعلان',
  'post.update': 'تعديل إعلان',
  'post.delete': 'حذف إعلان',
  'notify.broadcast': 'إرسال تبليغ',
  'media.upload': 'رفع صورة',
  'chat.group.create': 'إنشاء مجموعة محادثة',
  'chat.group.update': 'تعديل مجموعة',
  'chat.group.delete': 'حذف مجموعة',
  'chat.message.delete': 'حذف رسالة (إشراف)',
};

export function TeamAuditPage() {
  const q = useQuery({ queryKey: ['team-audit'], queryFn: () => api.teamAudit(500), retry: 0 });
  const dirQ = useQuery({ queryKey: ['team-directory'], queryFn: api.teamDirectory, retry: 0 });
  const [kind, setKind] = useState<'all' | 'attend' | 'leave' | 'admin'>('all');
  const names = useMemo(() => new Map((dirQ.data ?? []).map(s => [`staff:${s.id}`, s.name])), [dirQ.data]);
  const rows = useMemo(
    () =>
      (q.data ?? []).filter(r =>
        kind === 'all'
          ? r.action !== 'media.upload'
          : kind === 'attend'
            ? /^(attend|break|shift|network)/.test(r.action)
            : kind === 'leave'
              ? /^(leave|weekly_off)/.test(r.action)
              : !String(r.actor ?? '').startsWith('staff:'),
      ),
    [q.data, kind],
  );
  return (
    <WorkspaceCard>
      <FilterBar>
        <FilterLabel label="النوع">
          <SegmentedFilter
            label="النوع"
            value={kind}
            onChange={setKind}
            items={[
              { id: 'all', label: 'الكل' },
              { id: 'attend', label: 'الحضور' },
              { id: 'leave', label: 'الإجازات' },
              { id: 'admin', label: 'إجراءات الإدارة' },
            ]}
          />
        </FilterLabel>
        <FilterActions>
          <IconButton label="تحديث" onClick={() => void q.refetch()}>
            <IconRefresh size={15} className={q.isFetching ? 'animate-spin' : ''} />
          </IconButton>
        </FilterActions>
      </FilterBar>
      <WorkspaceBody>
        {q.isError ? (
          <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <TableSkeleton rows={10} />
        ) : (
          <DataGrid
            variant="sheet"
            embedded
            fillHeight
            dense
            rows={rows}
            getRowId={r => r.id}
            storageKey="team-audit"
            exportName="سجل-تدقيق-التطبيق"
            counterLabel="حدث"
            columns={[
              { key: 'at', header: 'الوقت', width: 160, render: r => formatDate(r.at) },
              { key: 'actor', header: 'من', width: 180, exportValue: r => names.get(r.actor ?? '') ?? r.actor ?? '', render: r => names.get(r.actor ?? '') ?? r.actor?.replace(/^manager:/, 'المدير ') ?? '—' },
              { key: 'action', header: 'الإجراء', width: 190, exportValue: r => ACTION_LABEL[r.action] ?? r.action, render: r => <span className="font-semibold">{ACTION_LABEL[r.action] ?? r.action}</span> },
              {
                key: 'target',
                header: 'الهدف',
                width: 140,
                // الهدف رقم موظف لإجراءات الحسابات والورديات فقط؛ غيرها رقم السجل
                render: r => (/^(login|device\.|shift\.|weekly_off)/.test(r.action) ? names.get(`staff:${r.target}`) ?? r.target : r.target ? `#${r.target}` : '—'),
              },
              { key: 'details', header: 'التفاصيل', width: 360, render: r => <span className="truncate font-mono text-[11px] text-slate-500">{r.details ?? ''}</span> },
            ]}
          />
        )}
      </WorkspaceBody>
    </WorkspaceCard>
  );
}

export function TeamOverviewPanel({ go }: { go: (tab: string) => void }) {
  const ov = useQuery({ queryKey: ['team-overview'], queryFn: api.teamOverview, retry: 0, refetchInterval: 30_000 });
  const board = useQuery({ queryKey: ['team-board'], queryFn: api.teamBoard, retry: 0, refetchInterval: 20_000 });
  const hub = useQuery({ queryKey: ['team-hub-status'], queryFn: api.teamHubStatus, retry: 0 });
  const posts = useQuery({ queryKey: ['team-posts'], queryFn: api.teamPosts, retry: 0 });
  const err = ov.error || board.error;
  if (err) return <ErrorBlock error={err} onRetry={() => void ov.refetch()} />;
  const c = board.data?.counts;
  const tiles: { label: string; value: string; hint: string; tab: string; tone?: string }[] = [
    { label: 'في الدوام الآن', value: c ? formatNum(c.in + c.break) : '—', hint: c ? `${c.break} في استراحة · ${c.out} انصرف` : '', tab: 'attend', tone: 'text-emerald-700' },
    { label: 'لم يحضروا', value: c ? formatNum(c.missing) : '—', hint: c?.late ? `${c.late} متأخر اليوم` : 'لا تأخير', tab: 'attend', tone: c?.missing ? 'text-red-600' : '' },
    { label: 'طلبات معلّقة', value: ov.data ? formatNum(ov.data.pending) : '—', hint: 'إجازات وتبديل واستئذان', tab: 'leave', tone: ov.data?.pending ? 'text-amber-700' : '' },
    { label: 'في عطلة اليوم', value: ov.data ? formatNum(ov.data.offToday.length) : '—', hint: ov.data?.weekday ?? '', tab: 'leave' },
    { label: 'هواتف مربوطة', value: hub.data ? `${formatNum(hub.data.devices.length)} / ${formatNum(hub.data.staffCount)}` : '—', hint: `${formatNum(ov.data?.active7 ?? 0)} نشط خلال أسبوع`, tab: 'staff' },
    { label: 'الإعلانات', value: posts.data ? formatNum(posts.data.length) : '—', hint: posts.data?.[0]?.title ?? '', tab: 'posts' },
  ];
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(t => (
          <button key={t.label} type="button" onClick={() => go(t.tab)} className="card p-4 text-right transition hover:border-brand-300 hover:shadow">
            <div className="text-[12px] text-slate-500">{t.label}</div>
            <div className={`num mt-1 text-[26px] font-bold ${t.tone ?? 'text-slate-800'}`}>{t.value}</div>
            <div className="mt-1 truncate text-[11.5px] text-slate-400">{t.hint}</div>
          </button>
        ))}
      </div>
      {board.data && board.data.network.enforced && board.data.network.count === 0 && (
        <button type="button" onClick={() => go('rules')} className="card w-full border-red-200 bg-red-50 p-3 text-right text-[13px] font-semibold text-red-700">
          ⚠ لم تُضبط شبكات المحل بعد — الموظفون لا يستطيعون تسجيل الحضور. اضغط للضبط.
        </button>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card p-4">
          <h3 className="mb-2 text-[14px] font-bold text-slate-800">من في عطلة أو إجازة اليوم</h3>
          {!ov.data ? (
            <TableSkeleton rows={3} />
          ) : !ov.data.offToday.length && !ov.data.partial.length ? (
            <p className="text-[12.5px] text-slate-500">الفريق كامل اليوم.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ov.data.offToday.map(p => (
                <Badge key={p.staffId} tone="violet">
                  {p.name}
                </Badge>
              ))}
              {ov.data.partial.map(p => (
                <Badge key={`p${p.staffId}`} tone="info">
                  {p.name} · استئذان {p.timeFrom}–{p.timeTo}
                </Badge>
              ))}
            </div>
          )}
        </section>
        <section className="card p-4">
          <h3 className="mb-2 text-[14px] font-bold text-slate-800">يحتاج انتباهك الآن</h3>
          {!board.data ? (
            <TableSkeleton rows={3} />
          ) : (
            <ul className="space-y-1 text-[12.5px]">
              {board.data.rows
                .filter(r => r.status === 'over' || r.status === 'missing')
                .map(r => (
                  <li key={r.staffId} className="flex items-center justify-between">
                    <span className="font-semibold">{r.name}</span>
                    <Badge tone="danger">{STATUS[r.status].label}</Badge>
                  </li>
                ))}
              {!board.data.rows.some(r => r.status === 'over' || r.status === 'missing') && <li className="text-slate-500">لا شيء — الدوام منتظم ✓</li>}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
