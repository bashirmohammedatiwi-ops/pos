import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { api, formatDate, formatNum, todayIso } from '@/api/client';
import type { CashierActivityDto, PosTerminalDetailDto, PosTerminalMonitorDto, UpdateTerminalRequest } from '@/api/types';
import { DataGrid, type GridColumn, type GridSort } from '@/components/grid/DataGrid';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
  type SummaryCell,
} from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  TableSkeleton,
  useConfirm,
} from '@/components/ui';
import {
  IconActivity,
  IconAlert,
  IconCopy,
  IconDownload,
  IconExternal,
  IconLayers,
  IconMonitor,
  IconPencil,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconWifi,
} from '@/components/icons';
import {
  HwIdLabel,
  OnlineBadge,
  PulseDot,
  SearchBox,
  readLocal,
  terminalHasCustomName,
  terminalTitle,
  timeAgo,
  writeLocal,
} from '@/components/system/systemUi';
import { copyText } from '@/lib/clipboard';
import { downloadCsv } from '@/utils/exportCsv';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';

type View = 'table' | 'grid' | 'monitor';
type Filter = 'all' | 'online' | 'offline' | 'attention';
type Sort = 'status' | 'name' | 'sales' | 'seen';

/** خيارات «الترتيب» = فرز أعمدة الجدول نفسه — رأس الجدول والقائمة متزامنان. */
const SORT_PRESETS: Record<Sort, GridSort> = {
  status: { key: 'isOnline', dir: 'asc' },
  name: { key: 'name', dir: 'asc' },
  sales: { key: 'todaySales', dir: 'desc' },
  seen: { key: 'lastConnection', dir: 'desc' },
};
const sortToken = (s: GridSort | null) => (s ? `${s.key}:${s.dir}` : '');
const PRESET_TOKENS = Object.values(SORT_PRESETS).map(sortToken);

// v2: العرض الافتراضي أصبح «جدول» بدل البطاقات
const TERMINALS_KEY = 'fot_admin_terminals_v2';

type OfflineInfo = { pending: number; dead: number };
type TerminalRow = PosTerminalDetailDto & OfflineInfo;

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

const todayReceiptsLink = (id: number) => `/receipts?posId=${id}&from=${todayIso()}&to=${todayIso()}`;

/** زر إجراء صغير داخل صف الجدول — لا يفتح/يغلق الصف. */
function RowAction({ label, onClick, children, tone }: { label: string; onClick: () => void; children: ReactNode; tone?: 'danger' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
        tone === 'danger' ? 'text-slate-400 hover:bg-red-50 hover:text-red-600' : 'text-slate-500 hover:bg-brand-50 hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  );
}

/* أعمدة نقاط البيع — الجدول هو العرض الافتراضي */
function buildColumns(onEdit: (t: TerminalRow) => void): GridColumn<TerminalRow>[] {
  return [
    {
      key: 'name',
      header: 'نقطة البيع',
      width: 220,
      sortValue: t => terminalTitle(t),
      filterValue: t => `${terminalTitle(t)} ${t.hwId ?? ''} ${t.remarks ?? ''}`,
      exportValue: t => terminalTitle(t),
      render: t => (
        <span className="flex min-w-0 max-w-[300px] items-center gap-2">
          <PulseDot online={t.isOnline} size="sm" tone={t.dead > 0 ? 'danger' : undefined} />
          <span className={`truncate font-semibold ${terminalHasCustomName(t) ? 'text-header' : 'text-slate-500'}`} title={t.remarks ? `${terminalTitle(t)} — ${t.remarks}` : terminalTitle(t)}>
            {terminalTitle(t)}
          </span>
        </span>
      ),
    },
    {
      key: 'sectionName',
      header: 'القسم',
      width: 130,
      exportValue: t => t.sectionName || 'بلا قسم',
      render: t => (t.sectionName ?<span className="block max-w-[180px] truncate">{t.sectionName}</span> : <Badge tone="warn">بلا قسم</Badge>),
    },
    {
      key: 'isOnline',
      header: 'الحالة',
      width: 120,
      align: 'center',
      sortValue: t => (t.dead > 0 ? 0 : t.isOnline ? 1 : 2),
      filterValue: t => `${t.isOnline ? 'متصل' : 'غير متصل'} ${t.active ? '' : 'موقوف'}`,
      exportValue: t => (t.isOnline ? 'متصل' : 'غير متصل') + (t.active ? '' : ' · موقوف'),
      render: t => (
        <span className="inline-flex items-center gap-1">
          <OnlineBadge online={t.isOnline} />
          {!t.active && <Badge tone="warn">موقوف</Badge>}
        </span>
      ),
    },
    {
      key: 'lastConnection',
      header: 'آخر ظهور',
      width: 110,
      sortValue: t => t.lastConnection ?? '',
      filterValue: t => timeAgo(t.lastConnection),
      render: t => (
        <span className={`text-[12px] ${t.isOnline ? 'text-slate-600' : 'font-semibold text-slate-500'}`} title={t.lastConnection ? formatDate(t.lastConnection) : ''}>
          {timeAgo(t.lastConnection)}
        </span>
      ),
    },
    { key: 'exeVersion', header: 'الإصدار', width: 90, render: t => <span className="num text-[12px] text-slate-600">{t.exeVersion ?? '—'}</span> },
    { key: 'todayReceipts', header: 'فواتير اليوم', width: 100, mono: true, footer: 'sum' },
    { key: 'todaySales', header: 'مبيعات اليوم', width: 130, mono: true, footer: 'sum' },
    {
      key: 'pending',
      header: 'بانتظار الرفع',
      width: 105,
      align: 'center',
      footer: 'sum',
      render: t => (t.pending > 0 ? <Badge tone="info">{formatNum(t.pending)}</Badge> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'dead',
      header: 'متوقفة',
      width: 90,
      align: 'center',
      footer: 'sum',
      render: t => (t.dead > 0 ? <Badge tone="danger"><IconAlert size={11} /> {formatNum(t.dead)}</Badge> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'allowOfflineMode',
      header: 'أوفلاين',
      width: 80,
      align: 'center',
      sortValue: t => (t.allowOfflineMode ? 1 : 0),
      filterValue: t => (t.allowOfflineMode ? 'مسموح' : 'ممنوع'),
      render: t => (t.allowOfflineMode ? <span className="text-[11.5px] font-semibold text-sky-700">مسموح</span> : <span className="text-[11.5px] text-slate-400">ممنوع</span>),
    },
    {
      key: 'hwId',
      header: 'المعرّف',
      width: 90,
      align: 'center',
      filterValue: t => t.hwId ?? '',
      render: t => <HwIdLabel hwId={t.hwId} />,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 90,
      align: 'center',
      sortable: false,
      exportable: false,
      render: t => (
        <span className="inline-flex items-center gap-0.5">
          <RowAction label="تعديل" onClick={() => onEdit(t)}><IconPencil size={13} /></RowAction>
          <Link
            to={todayReceiptsLink(t.id)}
            onClick={e => e.stopPropagation()}
            title="فواتير اليوم"
            aria-label="فواتير اليوم"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <IconReceipt size={13} />
          </Link>
        </span>
      ),
    },
  ];
}

export function TerminalsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { push: pushToPos, pushing } = usePushPosUpdates();
  const saved = readLocal<{
    view?: View;
    filter?: Filter;
    sectionFilter?: number | 'all';
    selectedId?: number | null;
    expandedId?: number | null;
    query?: string;
    sort?: Sort | GridSort | null;
  }>(TERMINALS_KEY, 'session');
  const [view, setView] = useState<View>(saved?.view ?? 'table');
  const [filter, setFilter] = useState<Filter>(saved?.filter ?? 'all');
  const [sectionFilter, setSectionFilter] = useState<number | 'all'>(saved?.sectionFilter ?? 'all');
  const [query, setQuery] = useState(saved?.query ?? '');
  const [sort, setSort] = useState<GridSort | null>(() => {
    const s = saved?.sort;
    if (s === null) return null;
    if (typeof s === 'string') return SORT_PRESETS[s] ?? SORT_PRESETS.status; // قيمة قديمة
    return s?.key ? s : SORT_PRESETS.status;
  });
  const savedTable = (saved?.view ?? 'table') === 'table';
  // في الجدول: الصف المحدد (↑↓) · في البطاقات/الأقسام: نافذة التفاصيل
  const [selectedId, setSelectedId] = useState<number | null>(savedTable ? saved?.selectedId ?? null : null);
  // في الجدول: الصف المفتوح (Enter/النقر) — منفصل عن التحديد حتى لا يُفتح كل صف تمر عليه الأسهم
  const [expandedId, setExpandedId] = useState<number | null>(savedTable ? saved?.expandedId ?? null : null);
  const [editTarget, setEditTarget] = useState<PosTerminalDetailDto | null>(null);
  const [form, setForm] = useState<UpdateTerminalRequest | null>(null);

  useEffect(() => {
    writeLocal(TERMINALS_KEY, { view, filter, sectionFilter, selectedId, expandedId, query, sort }, 'session');
  }, [view, filter, sectionFilter, selectedId, expandedId, query, sort]);

  // الجهاز الذي تُجلب تفاصيله: الصف المفتوح في الجدول، أو نافذة التفاصيل في العروض الأخرى
  const detailId = view === 'table' ? expandedId : selectedId;

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
    queryKey: ['pos-terminal', detailId],
    queryFn: () => api.posTerminal(detailId!),
    enabled: detailId != null,
  });
  const activityQ = useQuery({
    queryKey: ['terminal-activity', detailId],
    queryFn: () => api.terminalActivity(detailId!, 25),
    enabled: detailId != null,
  });

  const sections = sectionsQ.data ?? [];

  // فواتير الأوفلاين (بانتظار الرفع / متوقفة) تأتي من شاشة المراقبة
  const offlineById = useMemo(() => {
    const m = new Map<number, OfflineInfo>();
    for (const g of monitorQ.data ?? []) {
      for (const t of g.terminals) m.set(t.id, { pending: t.pendingOffline ?? 0, dead: t.deadOffline ?? 0 });
    }
    return m;
  }, [monitorQ.data]);

  const terminals: TerminalRow[] = useMemo(
    () => (terminalsQ.data ?? []).map(t => ({ ...t, ...(offlineById.get(t.id) ?? { pending: 0, dead: 0 }) })),
    [terminalsQ.data, offlineById],
  );

  const needsAttention = (t: TerminalRow) => t.dead > 0 || t.pending > 0 || (t.active && !t.isOnline);

  const filtered = useMemo(() => {
    let list = terminals;
    if (filter === 'online') list = list.filter(t => t.isOnline);
    if (filter === 'offline') list = list.filter(t => !t.isOnline);
    if (filter === 'attention') list = list.filter(needsAttention);
    if (sectionFilter !== 'all') list = list.filter(t => t.sectionId === sectionFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        terminalTitle(t).toLowerCase().includes(q)
        || (t.name ?? '').toLowerCase().includes(q)
        || (t.hwId ?? '').toLowerCase().includes(q)
        || String(t.id).includes(q)
        || (t.sectionName ?? '').toLowerCase().includes(q),
      );
    }
    // ترتيب أولي للبطاقات/الأقسام (والجدول يعيد الفرز بنفس المفتاح مع ثبات التعادل)
    const sorted = [...list];
    const mul = sort?.dir === 'desc' ? -1 : 1;
    const byTitle = (a: TerminalRow, b: TerminalRow) => terminalTitle(a).localeCompare(terminalTitle(b), 'ar');
    // الحالة: يحتاج انتباه ← متصل ← غير متصل
    const rank = (t: TerminalRow) => (t.dead > 0 ? 0 : t.isOnline ? 1 : 2);
    sorted.sort((a, b) => {
      if (sort?.key === 'name') return byTitle(a, b) * mul;
      if (sort?.key === 'todaySales') return (a.todaySales - b.todaySales) * mul;
      if (sort?.key === 'lastConnection') return (a.lastConnection ?? '').localeCompare(b.lastConnection ?? '') * mul;
      if (sort?.key === 'isOnline') return (rank(a) - rank(b)) * mul || byTitle(a, b);
      return rank(a) - rank(b) || byTitle(a, b);
    });
    return sorted;
  }, [terminals, filter, sectionFilter, query, sort]);

  const stats = useMemo(() => {
    const online = terminals.filter(t => t.isOnline).length;
    const sales = terminals.reduce((a, t) => a + t.todaySales, 0);
    const receipts = terminals.reduce((a, t) => a + t.todayReceipts, 0);
    const pending = terminals.reduce((a, t) => a + t.pending, 0);
    const dead = terminals.reduce((a, t) => a + t.dead, 0);
    const attention = terminals.filter(needsAttention).length;
    return { total: terminals.length, online, offline: terminals.length - online, sales, receipts, pending, dead, attention };
  }, [terminals]);

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTerminal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos-terminals'] });
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      setSelectedId(null);
      setExpandedId(null);
      setEditTarget(null);
      toast.success('تم حذف نقطة البيع');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحذف'),
  });

  const save = useMutation({
    mutationFn: () => api.updateTerminal(editTarget!.id, form!),
    onSuccess: () => {
      const id = editTarget?.id;
      qc.invalidateQueries({ queryKey: ['pos-terminals'] });
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
      qc.invalidateQueries({ queryKey: ['pos-terminal', id] });
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      setEditTarget(null);
      toast.success('تم حفظ إعدادات نقطة البيع');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  // فتح/إغلاق الصف — الإغلاق يُبقي التحديد (↑↓ تتابع من نفس الصف)
  function toggleTerminal(id: number) {
    setSelectedId(id);
    setExpandedId(prev => (prev === id ? null : id));
  }

  function openEdit(t: PosTerminalDetailDto) {
    // بيانات التفاصيل أحدث إن كانت محمّلة لنفس الجهاز
    const fresh = detailQ.data && detailQ.data.id === t.id ? detailQ.data : t;
    setForm(terminalForm(fresh));
    setEditTarget(fresh);
  }

  async function askDelete(t: PosTerminalDetailDto) {
    const ok = await confirm({
      title: `حذف «${terminalTitle(t)}»؟`,
      message: 'سيُزال الجهاز من القائمة. إذا اتصل مجدداً سيُسجَّل كجهاز جديد بدون اسم أو قسم.',
      confirmLabel: 'حذف نقطة البيع',
      danger: true,
    });
    if (ok) remove.mutate(t.id);
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  }

  function clearFilters() {
    setQuery('');
    setFilter('all');
    setSectionFilter('all');
  }

  function exportCsv() {
    downloadCsv(
      'terminals.csv',
      ['نقطة البيع', 'المعرّف', 'القسم', 'الحالة', 'آخر اتصال', 'الإصدار', 'فواتير اليوم', 'مبيعات اليوم', 'بانتظار الرفع', 'متوقفة'],
      filtered.map(t => [
        terminalTitle(t),
        t.hwId ?? '',
        t.sectionName ?? '',
        t.isOnline ? 'متصل' : 'غير متصل',
        t.lastConnection ?? '',
        t.exeVersion ?? '',
        t.todayReceipts,
        t.todaySales,
        t.pending,
        t.dead,
      ]),
    );
  }

  const columns = useMemo(() => buildColumns(openEdit), [detailQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = terminalsQ.isLoading;
  const selectedRow = terminals.find(t => t.id === selectedId);
  const isFiltered = filter !== 'all' || sectionFilter !== 'all' || !!query.trim();

  function detailFor(row: TerminalRow | undefined) {
    const base = detailQ.data && detailQ.data.id === (row?.id ?? detailId) ? detailQ.data : row;
    return base;
  }

  const stripCells: SummaryCell[] = [
    { label: 'الأجهزة', value: formatNum(stats.total), hint: isFiltered ? `المعروض ${formatNum(filtered.length)}` : 'تحديث تلقائي كل دقيقة', onClick: () => setFilter('all'), active: filter === 'all' },
    { label: 'متصل', value: formatNum(stats.online), tone: 'ok', onClick: () => setFilter('online'), active: filter === 'online' },
    { label: 'غير متصل', value: formatNum(stats.offline), tone: stats.offline > 0 ? 'warn' : undefined, onClick: () => setFilter('offline'), active: filter === 'offline' },
    {
      label: 'أوفلاين بانتظار / متوقفة',
      value: <>{formatNum(stats.pending)} <span className="text-slate-300">/</span> <span className={stats.dead > 0 ? 'text-red-700' : ''}>{formatNum(stats.dead)}</span></>,
      hint: stats.attention > 0 ? `${formatNum(stats.attention)} جهاز يحتاج انتباه` : 'لا مشاكل',
      tone: stats.dead > 0 ? 'danger' : stats.pending > 0 ? 'warn' : undefined,
      onClick: () => setFilter('attention'),
      active: filter === 'attention',
    },
    { label: 'فواتير اليوم', value: formatNum(stats.receipts) },
    { label: 'مبيعات اليوم (IQD)', value: formatNum(stats.sales), tone: 'brand' },
  ];

  const modalTerminal = view !== 'table' && selectedId != null ? detailFor(selectedRow) : undefined;

  return (
    <WorkspacePage>
      {!loading && stats.dead > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50/70 px-3 py-1.5 text-[12.5px]">
          <IconAlert size={15} className="text-red-600" />
          <span className="font-bold text-red-800">{formatNum(stats.dead)} فاتورة أوفلاين متوقفة على الأجهزة</span>
          <span className="text-red-700/80">فشل رفعها بعد عدة محاولات — تأكد من اتصال الجهاز بالخادم ثم راجع الفواتير.</span>
          <Btn size="xs" variant="secondary" className="ms-auto" onClick={() => setFilter('attention')}>عرض الأجهزة</Btn>
        </div>
      )}

      <WorkspaceCard>
        <FilterBar
          footer={
            <>
              <SegmentedFilter<Filter>
                label="حالة الاتصال"
                value={filter}
                onChange={setFilter}
                items={[
                  { id: 'all', label: 'الكل', count: stats.total },
                  { id: 'online', label: 'متصل', count: stats.online },
                  { id: 'offline', label: 'غير متصل', count: stats.offline },
                  { id: 'attention', label: 'تحتاج انتباه', count: stats.attention, tone: 'warn' },
                ]}
              />
              <SegmentedFilter<View>
                label="طريقة العرض"
                value={view}
                onChange={v => {
                  setView(v);
                  setSelectedId(null);
                  setExpandedId(null);
                }}
                items={[
                  { id: 'table', label: 'جدول' },
                  { id: 'grid', label: 'بطاقات' },
                  { id: 'monitor', label: 'حسب القسم' },
                ]}
              />
              {isFiltered && (
                <button type="button" onClick={clearFilters} className="text-[12px] font-semibold text-brand-700 hover:underline">
                  مسح الفلاتر
                </button>
              )}
              <span className="ms-auto hidden text-[11px] text-slate-400 md:inline">انقر الصف لعرض التفاصيل والنشاط · تحديث تلقائي كل دقيقة</span>
            </>
          }
        >
          <FilterLabel label="بحث" grow>
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="اسم الجهاز أو القسم أو المعرّف…"
              icon={<IconSearch size={15} />}
            />
          </FilterLabel>
          <FilterLabel label="القسم" className={sectionFilter !== 'all' ? '[&_select]:border-brand-300 [&_select]:bg-brand-50/40 [&_select]:font-semibold' : ''}>
            <Select
              aria-label="القسم"
              value={sectionFilter === 'all' ? '' : String(sectionFilter)}
              onChange={e => setSectionFilter(e.target.value ? Number(e.target.value) : 'all')}
            >
              <option value="">كل الأقسام</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </FilterLabel>
          <FilterLabel label="الترتيب">
            <Select
              aria-label="الترتيب"
              value={sortToken(sort)}
              onChange={e => {
                const [key, dir] = e.target.value.split(':');
                setSort(key ? { key, dir: dir as GridSort['dir'] } : null);
              }}
            >
              <option value={sortToken(SORT_PRESETS.status)}>الحالة</option>
              <option value={sortToken(SORT_PRESETS.name)}>الاسم</option>
              <option value={sortToken(SORT_PRESETS.sales)}>مبيعات اليوم</option>
              <option value={sortToken(SORT_PRESETS.seen)}>آخر اتصال</option>
              {sort && !PRESET_TOKENS.includes(sortToken(sort)) && (
                <option value={sortToken(sort)}>مخصص (من الجدول)</option>
              )}
              {!sort && <option value="">بلا ترتيب</option>}
            </Select>
          </FilterLabel>
          <FilterActions>
            <Link to="/sections">
              <Btn variant="ghost" icon={<IconLayers size={15} />}>الأقسام</Btn>
            </Link>
            <Btn variant="secondary" icon={<IconDownload size={15} />} disabled={!filtered.length} onClick={exportCsv}>
              CSV
            </Btn>
            <Btn
              icon={<IconUpload size={15} />}
              loading={pushing}
              onClick={() => void pushToPos()}
              title="إرسال آخر التحديثات (الأسعار، الأصناف، الإعدادات) إلى كل نقاط البيع المتصلة"
            >
              إرسال التحديثات للأجهزة
            </Btn>
            <IconButton
              label="تحديث"
              onClick={() => {
                void terminalsQ.refetch();
                void monitorQ.refetch();
              }}
            >
              <IconRefresh size={16} className={terminalsQ.isFetching || monitorQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </FilterActions>
        </FilterBar>

        <SummaryStrip cells={stripCells} loading={loading} />

        {terminalsQ.isError && (
          <div className="shrink-0 p-2">
            <Alert title="تعذر تحميل نقاط البيع">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{terminalsQ.error instanceof Error ? terminalsQ.error.message : 'خطأ غير معروف'}</span>
                <Btn size="xs" variant="secondary" icon={<IconRefresh size={12} />} onClick={() => terminalsQ.refetch()}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}

        <WorkspaceBody>
          {loading && <div className="p-3"><TableSkeleton rows={8} cols={8} /></div>}

          {!loading && !terminalsQ.isError && filtered.length === 0 && view !== 'monitor' && (
            <EmptyState
              icon={<IconMonitor size={24} />}
              title={terminals.length ? 'لا أجهزة مطابقة' : 'لا توجد نقاط بيع مسجلة'}
              description={
                terminals.length
                  ? 'غيّر البحث أو الفلتر لعرض أجهزة أخرى.'
                  : 'تُسجَّل نقطة البيع تلقائياً عند أول تشغيل لتطبيق الكاشير واتصاله بهذا الخادم.'
              }
              action={terminals.length ? <Btn size="sm" variant="secondary" onClick={clearFilters}>مسح الفلاتر</Btn> : undefined}
            />
          )}

          {!loading && !terminalsQ.isError && view === 'table' && filtered.length > 0 && (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              filters={false}
              columns={columns}
              rows={filtered}
              getRowId={t => t.id}
              exportName="نقاط-البيع"
              counterLabel="جهاز"
              emptyText="لا أجهزة تطابق فلتر الأعمدة"
              rowTone={t => (t.dead > 0 ? 'bg-red-50/60' : !t.isOnline && t.active ? 'bg-amber-50/40' : undefined)}
              storageKey="terminals-v2"
              sort={sort}
              onSortChange={setSort}
              selectedId={selectedId ?? undefined}
              onSelect={t => setSelectedId(t.id)}
              onEnter={t => toggleTerminal(t.id)}
              expansion={{
                isExpanded: t => expandedId === t.id,
                onToggle: t => toggleTerminal(t.id),
                render: t => {
                  const d = detailFor(t);
                  return d ? (
                    <TerminalDetail
                      terminal={d}
                      offline={{ pending: t.pending, dead: t.dead }}
                      activity={activityQ.data ?? []}
                      activityLoading={activityQ.isLoading}
                      onEdit={() => openEdit(d)}
                      onDelete={() => void askDelete(d)}
                      refreshing={detailQ.isFetching || activityQ.isFetching}
                      onRefresh={() => {
                        void detailQ.refetch();
                        void activityQ.refetch();
                      }}
                      onCopied={ok => (ok ? toast.success('تم نسخ معرّف الجهاز') : toast.error('تعذر النسخ'))}
                    />
                  ) : null;
                },
              }}
            />
          )}

          {!loading && !terminalsQ.isError && view === 'grid' && filtered.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filtered.map(t => (
                  <TerminalCard key={t.id} terminal={t} onClick={() => setSelectedId(t.id)} selected={selectedId === t.id} />
                ))}
              </div>
            </div>
          )}

          {!loading && !terminalsQ.isError && view === 'monitor' && (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {monitorQ.isLoading && <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>}
              {!monitorQ.isLoading && (monitorQ.data ?? []).length === 0 && (
                <EmptyState icon={<IconLayers size={24} />} title="لا أقسام بها أجهزة" />
              )}
              <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {(monitorQ.data ?? []).map(group => {
                  const online = group.terminals.filter(t => t.isOnline).length;
                  return (
                    <section key={group.sectionId} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-[13.5px] font-bold text-header">{group.sectionName}</h3>
                          <p className="text-[11px] text-slate-500 num">{formatNum(online)} متصل من {formatNum(group.terminals.length)}</p>
                        </div>
                        <Badge tone={group.terminals.length && online === group.terminals.length ? 'ok' : online ? 'warn' : 'default'}>
                          {online}/{group.terminals.length}
                        </Badge>
                      </header>
                      <ul className="divide-y divide-slate-100">
                        {group.terminals.map(t => (
                          <MonitorRow key={t.id} t={t} onClick={() => setSelectedId(t.id)} />
                        ))}
                        {group.terminals.length === 0 && (
                          <li className="px-3 py-5 text-center text-[12px] text-slate-400">لا أجهزة في هذا القسم</li>
                        )}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      {/* ── تفاصيل الجهاز (عرض البطاقات/الأقسام) ── */}
      <Modal
        open={view !== 'table' && selectedId != null}
        title={modalTerminal ? terminalTitle(modalTerminal) : 'نقطة البيع'}
        subtitle={modalTerminal?.sectionName ?? undefined}
        icon={<IconMonitor size={18} />}
        onClose={() => setSelectedId(null)}
        wide
      >
        {selectedId != null && !modalTerminal && detailQ.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          </div>
        )}
        {selectedId != null && detailQ.isError && !modalTerminal && (
          <Alert title="تعذر تحميل تفاصيل الجهاز">
            <Btn size="xs" variant="secondary" onClick={() => detailQ.refetch()}>إعادة المحاولة</Btn>
          </Alert>
        )}
        {modalTerminal && (
          <TerminalDetail
            terminal={modalTerminal}
            offline={selectedRow ? { pending: selectedRow.pending, dead: selectedRow.dead } : { pending: 0, dead: 0 }}
            activity={activityQ.data ?? []}
            activityLoading={activityQ.isLoading}
            onEdit={() => openEdit(modalTerminal)}
            onDelete={() => void askDelete(modalTerminal)}
            refreshing={detailQ.isFetching || activityQ.isFetching}
            onRefresh={() => {
              void detailQ.refetch();
              void activityQ.refetch();
            }}
            onCopied={ok => (ok ? toast.success('تم نسخ معرّف الجهاز') : toast.error('تعذر النسخ'))}
            stacked
          />
        )}
      </Modal>

      {/* ── تعديل الجهاز ── */}
      <Modal
        open={editTarget != null}
        title="تعديل نقطة البيع"
        subtitle={editTarget ? <span dir="ltr" className="font-mono text-[11px]">{editTarget.hwId}</span> : undefined}
        icon={<IconPencil size={18} />}
        onClose={() => setEditTarget(null)}
        wide
        footer={
          <>
            <span className="text-[11.5px] text-slate-500">Enter للحفظ · Esc للإغلاق</span>
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setEditTarget(null)}>إلغاء</Btn>
              <Btn type="submit" form="terminal-edit-form" loading={save.isPending}>حفظ</Btn>
            </div>
          </>
        }
      >
        {form && editTarget && (
          <form id="terminal-edit-form" onSubmit={submitEdit} className="space-y-5">
            <div>
              <p className="mb-2 text-[12px] font-bold text-slate-500">التعريف</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="اسم نقطة البيع" hint="اسم واضح يظهر بدل معرّف الجهاز، مثل «كاشير 1 — المدخل».">
                  <Input
                    autoFocus
                    value={form.name ?? ''}
                    placeholder={terminalTitle({ ...editTarget, name: '' })}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field label="القسم" hint="يحدد الصناديق والأسعار التي يعمل بها الجهاز.">
                  <Select
                    value={form.sectionId ?? ''}
                    onChange={e => setForm({ ...form, sectionId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">— بدون قسم —</option>
                    {sections.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="mt-4">
                <Field label="ملاحظات">
                  <Input value={form.remarks ?? ''} onChange={e => setForm({ ...form, remarks: e.target.value })} placeholder="مكان الجهاز، رقم الطابعة…" />
                </Field>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-[12px] font-bold text-slate-500">شاشة الزبون (VFD)</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="السطر الأول">
                  <Input value={form.vfdFirstLine ?? ''} onChange={e => setForm({ ...form, vfdFirstLine: e.target.value })} />
                </Field>
                <Field label="السطر الثاني">
                  <Input value={form.vfdSecondLine ?? ''} onChange={e => setForm({ ...form, vfdSecondLine: e.target.value })} />
                </Field>
              </div>
            </div>

            <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <Switch
                label="نقطة بيع نشطة"
                description="عند الإيقاف لا يستطيع الكاشير تسجيل الدخول على هذا الجهاز."
                checked={form.active}
                onChange={v => setForm({ ...form, active: v })}
              />
              <Switch
                label="السماح بالعمل دون اتصال"
                description="يحفظ الفواتير محلياً عند انقطاع الشبكة ويرفعها لاحقاً."
                checked={form.allowOfflineMode}
                onChange={v => setForm({ ...form, allowOfflineMode: v })}
              />
            </div>
          </form>
        )}
      </Modal>
    </WorkspacePage>
  );
}

function MonitorRow({ t, onClick }: { t: PosTerminalMonitorDto; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-right transition hover:bg-slate-50">
        <PulseDot online={t.isOnline} size="sm" tone={(t.deadOffline ?? 0) > 0 ? 'danger' : undefined} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-header">{terminalTitle(t)}</span>
        <span className="shrink-0 text-[11px] text-slate-500" title={t.lastConnection ? formatDate(t.lastConnection) : ''}>{timeAgo(t.lastConnection)}</span>
        {t.exeVersion && <span className="hidden shrink-0 text-[11px] text-slate-400 num sm:inline">v{t.exeVersion}</span>}
        {(t.deadOffline ?? 0) > 0 && <Badge tone="danger">{formatNum(t.deadOffline!)} متوقفة</Badge>}
        {(t.pendingOffline ?? 0) > 0 && <Badge tone="info">{formatNum(t.pendingOffline!)} بانتظار</Badge>}
      </button>
    </li>
  );
}

function TerminalCard({
  terminal: t,
  onClick,
  selected,
}: {
  terminal: TerminalRow;
  onClick: () => void;
  selected: boolean;
}) {
  const custom = terminalHasCustomName(t);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col rounded-xl border bg-white p-3 text-right transition ${
        selected ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-brand-200 hover:bg-slate-50/50'
      } ${t.dead > 0 ? '!border-red-200' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PulseDot online={t.isOnline} tone={t.dead > 0 ? 'danger' : undefined} />
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] font-bold text-header">{terminalTitle(t)}</h3>
            <p className="truncate text-[11.5px] text-slate-500">
              {custom ? (t.sectionName ?? 'بدون قسم') : t.sectionName ? 'بدون اسم — اضغط «تعديل» لتسميته' : 'بدون قسم أو اسم'}
            </p>
          </div>
        </div>
        <OnlineBadge online={t.isOnline} />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-50 px-2.5 py-1">
          <p className="text-[10.5px] text-slate-500">فواتير اليوم</p>
          <p className="text-[14px] font-bold text-header num">{formatNum(t.todayReceipts)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-2.5 py-1">
          <p className="text-[10.5px] text-slate-500">مبيعات اليوم</p>
          <p className="text-[14px] font-bold text-header num">
            {formatNum(t.todaySales)} <span className="text-[10.5px] font-medium text-slate-400">IQD</span>
          </p>
        </div>
      </div>

      {(t.dead > 0 || t.pending > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {t.dead > 0 && <Badge tone="danger"><IconAlert size={11} /> {formatNum(t.dead)} متوقفة</Badge>}
          {t.pending > 0 && <Badge tone="info">{formatNum(t.pending)} بانتظار الرفع</Badge>}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[11.5px] text-slate-500">
        <span className="inline-flex items-center gap-1" title={t.lastConnection ? formatDate(t.lastConnection) : ''}>
          <IconWifi size={12} /> {timeAgo(t.lastConnection)}
        </span>
        <span className="text-slate-300">·</span>
        <span className="num">v{t.exeVersion ?? '—'}</span>
        {!t.active && <Badge tone="warn">موقوف</Badge>}
        {t.allowOfflineMode && <Badge tone="info">أوفلاين مسموح</Badge>}
      </div>
    </button>
  );
}

function DetailItem({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <p className="truncate text-[10.5px] font-semibold text-slate-500">{label}</p>
      <p className="truncate text-[12.5px] font-semibold text-header">{children}</p>
    </div>
  );
}

/** تفاصيل الجهاز: تُعرض داخل صف الجدول الموسّع أو في نافذة (البطاقات/الأقسام). */
function TerminalDetail({
  terminal: t,
  offline,
  activity,
  activityLoading,
  onEdit,
  onDelete,
  onRefresh,
  onCopied,
  refreshing,
  stacked,
}: {
  terminal: PosTerminalDetailDto;
  offline: OfflineInfo;
  activity: CashierActivityDto[];
  activityLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onCopied: (ok: boolean) => void;
  refreshing: boolean;
  /** داخل نافذة: عمود واحد. */
  stacked?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${stacked ? '' : 'rounded-lg border border-slate-200 bg-white p-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'}`}>
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <OnlineBadge online={t.isOnline} />
          {t.active ? <Badge tone="ok">نشط</Badge> : <Badge tone="warn">موقوف</Badge>}
          {t.allowOfflineMode && <Badge tone="info">العمل دون اتصال مسموح</Badge>}
          {t.hwId && (
            <span className="inline-flex items-center gap-1">
              <HwIdLabel hwId={t.hwId} />
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title={`نسخ المعرّف الكامل: ${t.hwId}`}
                onClick={async e => {
                  e.stopPropagation();
                  try {
                    await copyText(t.hwId!);
                    onCopied(true);
                  } catch {
                    onCopied(false);
                  }
                }}
              >
                <IconCopy size={12} />
              </button>
            </span>
          )}
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <Btn size="xs" icon={<IconPencil size={13} />} onClick={onEdit}>تعديل</Btn>
            <Link to={todayReceiptsLink(t.id)}>
              <Btn size="xs" variant="secondary" icon={<IconReceipt size={13} />}>فواتير اليوم</Btn>
            </Link>
            <IconButton label="تحديث" className="!h-7 !w-7" onClick={onRefresh}>
              <IconRefresh size={13} className={refreshing ? 'animate-spin' : ''} />
            </IconButton>
            <Btn size="xs" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<IconTrash size={13} />} onClick={onDelete}>
              حذف
            </Btn>
          </div>
        </div>

        {offline.dead > 0 && (
          <Alert type="error" title={`${formatNum(offline.dead)} فاتورة أوفلاين متوقفة`}>
            لم تُرفع من هذا الجهاز بعد عدة محاولات — تأكد من اتصاله بالخادم.
          </Alert>
        )}
        {offline.pending > 0 && (
          <Alert type="info">{formatNum(offline.pending)} فاتورة محفوظة على الجهاز بانتظار الرفع.</Alert>
        )}
        {!t.isOnline && (
          <Alert type="warning">الجهاز غير متصل — آخر ظهور {timeAgo(t.lastConnection)}.</Alert>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50/80 px-3 py-2 sm:grid-cols-3">
          <DetailItem label="فواتير اليوم"><span className="num">{formatNum(t.todayReceipts)}</span></DetailItem>
          <DetailItem label="مبيعات اليوم (IQD)"><span className="num">{formatNum(t.todaySales)}</span></DetailItem>
          <DetailItem label="القسم">{t.sectionName ?? '—'}</DetailItem>
          <DetailItem label="الإصدار"><span className="num">{t.exeVersion ?? '—'}</span></DetailItem>
          <DetailItem label="آخر اتصال" title={t.lastConnection ? formatDate(t.lastConnection) : undefined}>{timeAgo(t.lastConnection)}</DetailItem>
          <DetailItem label="آخر مزامنة" title={t.lastSync ? formatDate(t.lastSync) : undefined}>{timeAgo(t.lastSync)}</DetailItem>
        </div>

        {(t.vfdFirstLine || t.vfdSecondLine || t.remarks) && (
          <div className="flex flex-wrap items-stretch gap-2">
            {(t.vfdFirstLine || t.vfdSecondLine) && (
              <div className="min-w-[200px] rounded-lg bg-slate-900 px-3 py-1.5 font-mono text-[12px] leading-5 text-emerald-300" dir="auto" title="شاشة الزبون">
                <p className="truncate">{t.vfdFirstLine || ' '}</p>
                <p className="truncate">{t.vfdSecondLine || ' '}</p>
              </div>
            )}
            {t.remarks && (
              <div className="min-w-0 flex-1 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-1.5 text-[12px]">
                <p className="font-semibold text-slate-500">ملاحظات</p>
                <p className="mt-0.5 text-slate-700">{t.remarks}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-header">
          <IconActivity size={14} className="text-slate-400" />
          آخر النشاط
        </div>
        {activityLoading && (
          <div className="space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
          </div>
        )}
        {!activityLoading && activity.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[12px] text-slate-400">لا نشاط مسجّل</p>
        )}
        {!activityLoading && activity.length > 0 && (
          <ol className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {activity.map(a => (
              <li key={a.id} className="flex h-7 items-center gap-2 px-2.5 text-[12px]">
                <span className="w-[68px] shrink-0 text-[11px] text-slate-400" title={formatDate(a.createdAt)}>{timeAgo(a.createdAt)}</span>
                <span className="shrink-0 font-semibold text-slate-700">{a.eventLabel ?? 'حدث'}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500" title={a.message ?? ''}>
                  {a.cashierName ? `${a.cashierName} · ` : ''}{a.message ?? ''}
                </span>
                {a.receiptId && (
                  <Link
                    to={`/receipts?highlight=${a.receiptId}`}
                    onClick={e => e.stopPropagation()}
                    className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-brand-700 hover:underline"
                  >
                    <span className="num">{a.receiptNum ?? a.receiptId}</span> <IconExternal size={10} />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
