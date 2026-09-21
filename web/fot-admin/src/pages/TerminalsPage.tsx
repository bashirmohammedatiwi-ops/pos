import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, formatDate, formatNum, todayIso } from '@/api/client';
import type { CashierActivityDto, PosTerminalDetailDto, PosTerminalMonitorDto, UpdateTerminalRequest } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Btn,
  Checkbox,
  Field,
  Input,
  Loading,
  Modal,
  Select,
} from '@/components/ui';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  ClassicTabBar,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { FilterChip } from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';

type Tab = 'grid' | 'monitor' | 'table';
type Filter = 'all' | 'online' | 'offline';

const TERMINALS_KEY = 'fot_admin_terminals';

function loadTerminalsUi() {
  try {
    return JSON.parse(sessionStorage.getItem(TERMINALS_KEY) || 'null') as {
      tab?: Tab;
      filter?: Filter;
      sectionFilter?: number | 'all';
      selectedId?: number | null;
      query?: string;
    } | null;
  } catch {
    return null;
  }
}

function terminalForm(t: PosTerminalDetailDto): UpdateTerminalRequest {
  return {
    name: t.name ?? '',
    sectionId: t.sectionId ?? null,
    active: t.active,
    allowOfflineMode: t.allowOfflineMode,
    remarks: t.remarks ?? '',
    vfdFirstLine: t.vfdFirstLine ?? '',
    vfdSecondLine: t.vfdSecondLine ?? '',
  };
}

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return formatDate(iso);
}

/* أعمدة نقاط البيع — DataGrid موحد */
const terminalColumns: GridColumn<PosTerminalMonitorDto>[] = [
  { key: 'name', header: 'الجهاز', width: 160, render: t => <span className="font-semibold text-header">{t.name ?? '—'}</span> },
  { key: 'hwId', header: 'HW ID', width: 170, mono: true, render: t => <span className="text-xs">{t.hwId ?? '—'}</span> },
  { key: 'sectionName', header: 'القسم', width: 130, render: t => t.sectionName ?? '—' },
  {
    key: 'isOnline',
    header: 'الحالة',
    width: 110,
    align: 'center',
    render: t => (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${t.isOnline ? 'text-emerald-600' : 'text-slate-400'}`}>
        <span className={`h-2 w-2 rounded-full ${t.isOnline ? 'bg-emerald-400' : 'bg-slate-300'}`} />
        {t.isOnline ? 'متصل' : 'غير متصل'}
      </span>
    ),
  },
  { key: 'lastConnection', header: 'آخر اتصال', width: 130, sortValue: t => t.lastConnection ?? '', render: t => <span className="text-xs">{timeAgo(t.lastConnection)}</span> },
  { key: 'exeVersion', header: 'الإصدار', width: 100, render: t => <span className="text-xs">{t.exeVersion ?? '—'}</span> },
  { key: 'todaySales', header: 'اليوم', width: 100, mono: true },
  { key: 'active', header: 'مفعّل', width: 90, align: 'center', render: t => (t.active ? '✓' : '—') },
];

export function TerminalsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { push: pushToPos, pushing } = usePushPosUpdates();
  const saved = loadTerminalsUi();
  const [tab, setTab] = useState<Tab>(saved?.tab ?? 'grid');
  const [filter, setFilter] = useState<Filter>(saved?.filter ?? 'all');
  const [sectionFilter, setSectionFilter] = useState<number | 'all'>(saved?.sectionFilter ?? 'all');
  const [query, setQuery] = useState(saved?.query ?? '');
  const [selectedId, setSelectedId] = useState<number | null>(saved?.selectedId ?? null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<UpdateTerminalRequest | null>(null);

  useEffect(() => {
    sessionStorage.setItem(TERMINALS_KEY, JSON.stringify({ tab, filter, sectionFilter, selectedId, query }));
  }, [tab, filter, sectionFilter, selectedId, query]);

  const terminalsQ = useQuery({
    queryKey: ['pos-terminals'],
    queryFn: api.posTerminals,
    refetchInterval: 60_000,
  });
  const monitorQ = useQuery({
    queryKey: ['terminal-monitor'],
    queryFn: api.terminalMonitor,
    refetchInterval: 60_000,
  });
  const sectionsQ = useQuery({ queryKey: ['sections-summary'], queryFn: () => api.sections(true) });
  const detailQ = useQuery({
    queryKey: ['pos-terminal', selectedId],
    queryFn: () => api.posTerminal(selectedId!),
    enabled: selectedId != null,
  });
  const activityQ = useQuery({
    queryKey: ['terminal-activity', selectedId],
    queryFn: () => api.terminalActivity(selectedId!, 25),
    enabled: selectedId != null,
  });

  const terminals = terminalsQ.data ?? [];
  const sections = sectionsQ.data ?? [];

  const filtered = useMemo(() => {
    let list = terminals;
    if (filter === 'online') list = list.filter(t => t.isOnline);
    if (filter === 'offline') list = list.filter(t => !t.isOnline);
    if (sectionFilter !== 'all') list = list.filter(t => t.sectionId === sectionFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        (t.name ?? '').toLowerCase().includes(q)
        || String(t.id).includes(q)
        || (t.sectionName ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [terminals, filter, sectionFilter, query]);

  const stats = useMemo(() => {
    const online = terminals.filter(t => t.isOnline).length;
    const sales = terminals.reduce((a, t) => a + t.todaySales, 0);
    const receipts = terminals.reduce((a, t) => a + t.todayReceipts, 0);
    return { total: terminals.length, online, offline: terminals.length - online, sales, receipts };
  }, [terminals]);

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTerminal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-terminals'] });
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      setSelectedId(null);
      setEditOpen(false);
      toast.success('تم حذف نقطة البيع');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحذف'),
  });

  const save = useMutation({
    mutationFn: () => api.updateTerminal(selectedId!, form!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-terminals'] });
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
      qc.invalidateQueries({ queryKey: ['pos-terminal', selectedId] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      setEditOpen(false);
      toast.success('تم حفظ إعدادات الجهاز');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  function openTerminal(id: number) {
    setSelectedId(id);
    setTab('grid');
  }

  function openEdit(t: PosTerminalDetailDto) {
    setForm(terminalForm(t));
    setEditOpen(true);
  }

  const loading = terminalsQ.isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        filters={
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-end">
            <FilterField label="بحث">
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="جهاز / قسم…" />
            </FilterField>
            <FilterField label="القسم">
              <Select
                value={sectionFilter === 'all' ? '' : String(sectionFilter)}
                onChange={e => setSectionFilter(e.target.value ? Number(e.target.value) : 'all')}
              >
                <option value="">كل الأقسام</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </FilterField>
          </div>
        }
        tabs={
          <ClassicTabBar
            items={[
              { id: 'grid', label: 'بطاقات', count: filtered.length },
              { id: 'monitor', label: 'حسب القسم' },
              { id: 'table', label: 'جدول' },
            ]}
            value={tab}
            onChange={id => setTab(id as Tab)}
          />
        }
        header={{
          title: 'نقاط البيع',
          hint: `${formatNum(stats.online)} متصل من ${formatNum(stats.total)}`,
          actions: (
            <>
              {(['all', 'online', 'offline'] as Filter[]).map(f => (
                <FilterChip key={f} compact active={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'الكل' : f === 'online' ? 'متصل' : 'غير متصل'}
                </FilterChip>
              ))}
              <Link to="/sections"><Btn size="sm" variant="secondary">أقسام</Btn></Link>
              <Btn
                size="sm"
                variant="secondary"
                disabled={!filtered.length}
                onClick={() =>
                  downloadCsv(
                    'terminals.csv',
                    ['الجهاز', 'القسم', 'الحالة', 'فواتير اليوم', 'مبيعات اليوم', 'آخر اتصال'],
                    filtered.map(t => [
                      t.name ?? t.id,
                      t.sectionName ?? '',
                      t.isOnline ? 'متصل' : 'غير متصل',
                      t.todayReceipts,
                      t.todaySales,
                      t.lastConnection ?? '',
                    ]),
                  )
                }
              >
                CSV
              </Btn>
              <Btn size="sm" onClick={() => void pushToPos()} disabled={pushing}>
                {pushing ? '…' : 'رفع POS'}
              </Btn>
            </>
          ),
        }}
        onRefresh={() => terminalsQ.refetch()}
        refreshing={terminalsQ.isFetching}
        footer={
          <ClassicSummaryFooter
            total={stats.total}
            totalLabel="أجهزة"
            items={[
              { label: 'متصل', value: formatNum(stats.online), accent: true },
              { label: 'غير متصل', value: formatNum(stats.offline) },
              { label: 'فواتير اليوم', value: formatNum(stats.receipts) },
              { label: 'مبيعات اليوم', value: formatNum(stats.sales) },
            ]}
          />
        }
      >
        {loading && <Loading />}

        {!loading && tab === 'grid' && (
          <div className="grid min-h-0 flex-1 gap-2 overflow-auto p-2 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <div className="grid gap-4 sm:grid-cols-2">
                {filtered.map(t => (
                  <TerminalCard key={t.id} terminal={t} onClick={() => openTerminal(t.id)} selected={selectedId === t.id} />
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="col-span-full py-16 text-center text-[13px] text-slate-400">لا أجهزة مطابقة للفلتر</div>
              )}
            </div>

            <div className="xl:col-span-1">
              {!selectedId && (
                <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/50 text-[13px] text-slate-400">
                  اختر جهازاً لعرض التفاصيل
                </div>
              )}
              {selectedId && detailQ.isLoading && <Loading />}
              {selectedId && detailQ.data && (
                <TerminalSidePanel
                  terminal={detailQ.data}
                  activity={activityQ.data ?? []}
                  activityLoading={activityQ.isLoading}
                  onEdit={() => openEdit(detailQ.data)}
                  onDelete={() => {
                    if (confirm(`حذف نقطة البيع «${detailQ.data.name ?? detailQ.data.hwId}»؟`)) {
                      remove.mutate(detailQ.data.id);
                    }
                  }}
                  onRefresh={() => {
                    detailQ.refetch();
                    activityQ.refetch();
                  }}
                />
              )}
            </div>
          </div>
        )}

        {!loading && tab === 'monitor' && (
          <div className="grid gap-2 overflow-auto p-2 lg:grid-cols-2 xl:grid-cols-3">
            {(monitorQ.data ?? []).map(group => (
              <div key={group.sectionId} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h3 className="font-bold text-slate-900">{group.sectionName}</h3>
                    <p className="text-xs text-muted">{group.terminals.length} جهاز</p>
                  </div>
                  <Link to="/sections" className="text-xs text-brand-600 hover:underline">
                    القسم
                  </Link>
                </div>
                <ul className="divide-y divide-border">
                  {group.terminals.map(t => (
                    <li
                      key={t.id}
                      className="flex cursor-pointer items-center gap-3 px-5 py-4 hover:bg-slate-50"
                      onClick={() => openTerminal(t.id)}
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${t.isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{t.name ?? t.hwId ?? `#${t.id}`}</p>
                        <p className="text-xs text-muted">
                          {timeAgo(t.lastConnection)}
                          {t.exeVersion && ` · v${t.exeVersion}`}
                        </p>
                      </div>
                      <span className={`text-xs font-medium ${t.isOnline ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {t.isOnline ? 'متصل' : 'offline'}
                      </span>
                    </li>
                  ))}
                  {group.terminals.length === 0 && (
                    <li className="px-5 py-8 text-center text-sm text-muted">لا أجهزة</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        {!loading && tab === 'table' && (
          <DataGrid
            embedded
            fillHeight
            columns={terminalColumns}
            rows={filtered}
            getRowId={t => t.id}
            exportName="نقاط-البيع"
            counterLabel="جهاز"
            emptyText="لا أجهزة"
            onRowClick={t => openTerminal(t.id)}
            storageKey="terminals"
          />
        )}
      </ClassicListShell>

      <Modal open={editOpen} title="تعديل نقطة البيع" onClose={() => setEditOpen(false)} wide>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم الجهاز">
                <Input value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="القسم">
                <Select
                  value={form.sectionId ?? ''}
                  onChange={e => setForm({ ...form, sectionId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">—</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="ملاحظات">
              <Input value={form.remarks ?? ''} onChange={e => setForm({ ...form, remarks: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="VFD سطر 1">
                <Input value={form.vfdFirstLine ?? ''} onChange={e => setForm({ ...form, vfdFirstLine: e.target.value })} />
              </Field>
              <Field label="VFD سطر 2">
                <Input value={form.vfdSecondLine ?? ''} onChange={e => setForm({ ...form, vfdSecondLine: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Checkbox label="جهاز نشط" checked={form.active} onChange={v => setForm({ ...form, active: v })} />
              <Checkbox
                label="السماح بالعمل offline"
                checked={form.allowOfflineMode}
                onChange={v => setForm({ ...form, allowOfflineMode: v })}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Btn variant="secondary" onClick={() => setEditOpen(false)}>
                إلغاء
              </Btn>
              <Btn onClick={() => save.mutate()} disabled={save.isPending}>
                حفظ
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TerminalCard({
  terminal: t,
  onClick,
  selected,
}: {
  terminal: PosTerminalDetailDto;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-right ${
        selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                t.isOnline ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            />
            <h3 className="truncate font-bold text-slate-900">{t.name ?? t.hwId ?? `#${t.id}`}</h3>
          </div>
          <p className="mt-1 truncate text-xs text-muted">{t.sectionName ?? '—'}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
          {t.active ? 'نشط' : 'موقوف'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-muted">فواتير</p>
          <p className="font-bold">{formatNum(t.todayReceipts)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2">
          <p className="text-muted">مبيعات</p>
          <p className="font-bold text-emerald-800">{formatNum(t.todaySales)}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        {timeAgo(t.lastConnection)} · v{t.exeVersion ?? '—'}
        {t.allowOfflineMode && ' · offline ✓'}
      </p>
    </button>
  );
}

function TerminalSidePanel({
  terminal: t,
  activity,
  activityLoading,
  onEdit,
  onDelete,
  onRefresh,
}: {
  terminal: PosTerminalDetailDto;
  activity: CashierActivityDto[];
  activityLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="sticky top-3 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${t.isOnline ? 'bg-emerald-400' : 'bg-slate-300'}`} />
            <h3 className="font-bold">{t.name ?? t.hwId}</h3>
          </div>
          <p className="mt-1 font-mono text-xs text-muted">{t.hwId}</p>
        </div>
        <div className="flex gap-1">
          <Btn size="sm" variant="secondary" onClick={onRefresh}>
            ↻
          </Btn>
          <Btn size="sm" onClick={onEdit}>
            تعديل
          </Btn>
          <Btn size="sm" variant="danger" onClick={onDelete}>
            حذف
          </Btn>
        </div>
      </div>

      <Link
        to={`/receipts?posId=${t.id}&from=${todayIso()}&to=${todayIso()}`}
        className="block text-center text-[12px] font-medium text-brand-600 hover:underline"
      >
        فواتير اليوم لهذا الجهاز
      </Link>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Info label="القسم" value={t.sectionName ?? '—'} />
        <Info label="الإصدار" value={t.exeVersion ?? '—'} />
        <Info label="آخر اتصال" value={timeAgo(t.lastConnection)} />
        <Info label="آخر مزامنة" value={t.lastSync ? formatDate(t.lastSync) : '—'} />
        <Info label="فواتير اليوم" value={formatNum(t.todayReceipts)} />
        <Info label="مبيعات اليوم" value={formatNum(t.todaySales)} />
      </div>

      {!t.isOnline && (
        <Alert type="info">الجهاز غير متصل — آخر ظهور: {timeAgo(t.lastConnection)}</Alert>
      )}

      {t.remarks && (
        <div className="rounded-lg bg-slate-50 p-3 text-xs">
          <p className="font-medium text-muted">ملاحظات</p>
          <p className="mt-1">{t.remarks}</p>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">آخر النشاط</p>
        {activityLoading && <Loading />}
        {!activityLoading && activity.length === 0 && (
          <p className="text-xs text-muted">لا نشاط مسجّل</p>
        )}
        <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
          {activity.map(a => (
            <li key={a.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="font-medium">{a.eventLabel ?? 'حدث'}</p>
              <p className="text-muted">{a.message ?? '—'}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{formatDate(a.createdAt)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <p className="text-muted">{label}</p>
      <p className="font-medium truncate">{value}</p>
    </div>
  );
}
