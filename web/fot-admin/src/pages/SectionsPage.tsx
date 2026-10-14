import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { api, formatNum, todayIso } from '@/api/client';
import type { SectionDetailDto, SectionSummaryDto, UpdateSectionRequest } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
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
  AssignedCashBoxesEditor,
  fromSectionCashBoxes,
  toCashBoxAssignments,
  type AssignedSectionCashBox,
} from '@/components/CashBoxPicker';
import {
  IconAlert,
  IconCloud,
  IconDownload,
  IconExternal,
  IconLayers,
  IconMonitor,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWallet,
} from '@/components/icons';
import { HwIdLabel, PulseDot, SearchBox, readLocal, terminalTitle, timeAgo, writeLocal } from '@/components/system/systemUi';
import { downloadCsv } from '@/utils/exportCsv';

type View = 'table' | 'cards';
type Quick = 'all' | 'active' | 'inactive' | 'noBox';

// v2: العرض الافتراضي أصبح «جدول» مع توسيع الصف بدل لوحة جانبية
const SECTIONS_KEY = 'fot_admin_sections_v2';

/**
 * حقل رقمي يحتفظ بالنص أثناء الكتابة (يمكن مسحه ثم كتابة رقم جديد).
 * الرقم الصالح يُطبَّق فوراً؛ الفارغ/غير الصالح يعود لآخر قيمة صالحة عند مغادرة الحقل.
 */
function NumField({
  value,
  onValue,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValue: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <Input
      {...rest}
      type="number"
      value={draft}
      onFocus={e => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(n)) onValue(n);
      }}
      onBlur={e => {
        focused.current = false;
        setDraft(String(value));
        rest.onBlur?.(e);
      }}
    />
  );
}

function sectionFormFromDetail(d: SectionDetailDto): UpdateSectionRequest {
  return {
    name: d.name,
    state: d.state,
    sellPrice: d.sellPrice,
    edariBranchId: d.edariBranchId,
    edariWarehouseNumber: d.edariWarehouseNumber,
    groupsColumnsCount: d.groupsColumnsCount,
    groupsItemSize: d.groupsItemSize,
    roundTotalTo: d.roundTotalTo,
    roundItemTo: d.roundItemTo,
    fastSaving: d.fastSaving,
    collectivePrinting: d.collectivePrinting,
    displayArticleQuantity: d.displayArticleQuantity,
    cashBoxes: toCashBoxAssignments(fromSectionCashBoxes(d.cashBoxes)),
  };
}

/* أعمدة الأقسام — الجدول هو العرض الافتراضي */
function buildColumns(onEdit: (s: SectionSummaryDto) => void): GridColumn<SectionSummaryDto>[] {
  return [
    {
      key: 'name',
      header: 'القسم',
      width: 180,
      render: s => <span className="block max-w-[260px] truncate font-semibold text-header" title={s.name}>{s.name}</span>,
    },
    {
      key: 'state',
      header: 'الحالة',
      width: 85,
      align: 'center',
      sortValue: s => (s.state ? 1 : 0),
      filterValue: s => (s.state ? 'نشط' : 'متوقف'),
      render: s => (s.state ? <Badge tone="ok">نشط</Badge> : <Badge>متوقف</Badge>),
    },
    {
      key: 'branchName',
      header: 'الفرع',
      width: 140,
      sortValue: s => s.branchName ?? String(s.branchId),
      filterValue: s => s.branchName ?? String(s.branchId),
      render: s => <span className="block max-w-[200px] truncate">{s.branchName ?? s.branchId}</span>,
    },
    {
      key: 'edari',
      header: 'الأداري: فرع / مستودع',
      width: 150,
      align: 'center',
      sortValue: s => s.edariBranchId,
      filterValue: s => `${s.edariBranchId} ${s.edariWarehouseNumber}`,
      exportValue: s => `${s.edariBranchId} / ${s.edariWarehouseNumber}`,
      render: s => <span className="num">{s.edariBranchId} / {s.edariWarehouseNumber}</span>,
    },
    {
      key: 'cashBoxCount',
      header: 'صناديق',
      width: 95,
      align: 'center',
      sortValue: s => s.cashBoxCount ?? 0,
      exportValue: s => ((s.cashBoxCount ?? 0) > 0 ? s.cashBoxCount : 'بلا صندوق'),
      render: s => ((s.cashBoxCount ?? 0) > 0 ? <span className="num font-semibold">{s.cashBoxCount}</span> : <Badge tone="warn"><IconAlert size={11} /> بلا صندوق</Badge>),
    },
    {
      key: 'terminalCount',
      header: 'نقاط البيع',
      width: 110,
      align: 'center',
      footer: 'sum',
      sortValue: s => s.terminalCount,
      filterValue: s => `${s.onlineTerminals}/${s.terminalCount}`,
      render: s => (
        <span className="inline-flex items-center gap-1.5">
          <PulseDot
            online={s.onlineTerminals > 0}
            size="sm"
            tone={s.terminalCount === 0 ? 'off' : s.onlineTerminals === s.terminalCount ? 'ok' : s.onlineTerminals > 0 ? 'warn' : 'off'}
          />
          <span className="num font-semibold">
            {s.onlineTerminals}<span className="text-slate-300">/</span>{s.terminalCount}
          </span>
        </span>
      ),
    },
    { key: 'onlineTerminals', header: 'متصل', width: 70, mono: true, footer: 'sum' },
    { key: 'todayReceipts', header: 'فواتير اليوم', width: 100, mono: true, footer: 'sum' },
    { key: 'todaySales', header: 'مبيعات اليوم', width: 130, mono: true, footer: 'sum' },
    { key: 'sellPrice', header: 'سعر البيع', width: 85, mono: true },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 90,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <span className="inline-flex items-center gap-0.5">
          <button
            type="button"
            title="تعديل"
            aria-label="تعديل"
            onClick={e => {
              e.stopPropagation();
              onEdit(s);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <IconPencil size={13} />
          </button>
          <Link
            to={`/receipts?sectionId=${s.id}&from=${todayIso()}&to=${todayIso()}`}
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

export function SectionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const saved = readLocal<{ view?: View; selectedId?: number | null; expandedId?: number | null; query?: string; quick?: Quick }>(SECTIONS_KEY, 'session');
  const [view, setView] = useState<View>(saved?.view ?? 'table');
  const savedTable = (saved?.view ?? 'table') === 'table';
  // في الجدول: الصف المحدد (↑↓) · في البطاقات: نافذة التفاصيل
  const [selectedId, setSelectedId] = useState<number | null>(savedTable ? saved?.selectedId ?? null : null);
  // في الجدول: الصف المفتوح (Enter/النقر) — منفصل عن التحديد حتى لا يُفتح كل صف تمر عليه الأسهم
  const [expandedId, setExpandedId] = useState<number | null>(savedTable ? saved?.expandedId ?? null : null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState(saved?.query ?? '');
  const [quick, setQuick] = useState<Quick>(saved?.quick ?? 'all');
  const [form, setForm] = useState<UpdateSectionRequest | null>(null);
  const [newName, setNewName] = useState('');
  const [newWh, setNewWh] = useState('1');
  const [newBranch, setNewBranch] = useState('');
  const [newPrice, setNewPrice] = useState('1');
  const [newActive, setNewActive] = useState(true);
  const [newBoxes, setNewBoxes] = useState<AssignedSectionCashBox[]>([]);
  const [editBoxes, setEditBoxes] = useState<AssignedSectionCashBox[]>([]);
  const [createTried, setCreateTried] = useState(false);

  useEffect(() => {
    writeLocal(SECTIONS_KEY, { view, selectedId, expandedId, query, quick }, 'session');
  }, [view, selectedId, expandedId, query, quick]);

  // القسم الذي تُجلب تفاصيله: الصف المفتوح في الجدول، أو نافذة التفاصيل في البطاقات
  const detailId = view === 'table' ? expandedId : selectedId;

  const listQ = useQuery({ queryKey: ['sections-summary'], queryFn: () => api.sections(true) });
  const branchesQ = useQuery({ queryKey: ['edari-branches'], queryFn: api.edariBranches });
  const detailQ = useQuery({
    queryKey: ['section-detail', detailId],
    queryFn: () => api.sectionDetail(detailId!),
    enabled: detailId != null,
  });

  const allSections = (listQ.data ?? []) as SectionSummaryDto[];
  const sections = useMemo(() => {
    let list = allSections;
    if (quick === 'active') list = list.filter(x => x.state);
    if (quick === 'inactive') list = list.filter(x => !x.state);
    if (quick === 'noBox') list = list.filter(x => (x.cashBoxCount ?? 0) === 0);
    const s = query.trim().toLowerCase();
    if (!s) return list;
    return list.filter(x =>
      x.name.toLowerCase().includes(s)
      || (x.branchName ?? '').toLowerCase().includes(s)
      || String(x.edariBranchId).includes(s)
      || String(x.id).includes(s),
    );
  }, [allSections, query, quick]);

  const stats = useMemo(() => {
    const active = allSections.filter(s => s.state).length;
    const terminals = allSections.reduce((a, s) => a + s.terminalCount, 0);
    const online = allSections.reduce((a, s) => a + s.onlineTerminals, 0);
    const sales = allSections.reduce((a, s) => a + s.todaySales, 0);
    const receipts = allSections.reduce((a, s) => a + s.todayReceipts, 0);
    const noBox = allSections.filter(s => (s.cashBoxCount ?? 0) === 0).length;
    return { active, terminals, online, sales, receipts, noBox, total: allSections.length };
  }, [allSections]);

  const save = useMutation({
    mutationFn: () => {
      if (!form?.name.trim()) throw new Error('اسم القسم مطلوب');
      const cashBoxes = toCashBoxAssignments(editBoxes);
      if (cashBoxes.length === 0) throw new Error('أضف صندوقاً واحداً على الأقل');
      return api.updateSection(editId!, { ...form!, cashBoxes });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['section-detail', editId] });
      qc.invalidateQueries({ queryKey: ['terminal-monitor'] });
      qc.invalidateQueries({ queryKey: ['pos-terminals'] });
      setEditId(null);
      toast.success('تم حفظ إعدادات القسم');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const create = useMutation({
    mutationFn: () => {
      if (!newName.trim()) throw new Error('اسم القسم مطلوب');
      const cashBoxes = toCashBoxAssignments(newBoxes);
      if (cashBoxes.length === 0) throw new Error('أضف صندوقاً واحداً على الأقل');
      return api.createSection({
        name: newName.trim(),
        edariWarehouseNumber: Number(newWh) || 1,
        edariBranchId: newBranch ? Number(newBranch) : null,
        state: newActive,
        sellPrice: Number(newPrice) || 1,
        cashBoxes,
      });
    },
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setCreateOpen(false);
      setNewName('');
      setNewBoxes([]);
      setView('table');
      setSelectedId(r.id);
      setExpandedId(r.id);
      toast.success(r.edariMessage || 'تم إنشاء القسم');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الإنشاء'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteSection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections-summary'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      qc.invalidateQueries({ queryKey: ['section-detail'] });
      setSelectedId(null);
      setExpandedId(null);
      setEditId(null);
      toast.success('تم حذف القسم');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحذف'),
  });

  function openEdit(d: SectionDetailDto) {
    setForm(sectionFormFromDetail(d));
    setEditBoxes(fromSectionCashBoxes(d.cashBoxes));
    setEditId(d.id);
  }

  /** تعديل من صف الجدول: يجلب التفاصيل (صناديق وإعدادات الواجهة) أولاً. */
  async function editById(id: number) {
    setEditLoadingId(id);
    try {
      const d = await qc.fetchQuery({ queryKey: ['section-detail', id], queryFn: () => api.sectionDetail(id) });
      openEdit(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل بيانات القسم');
    } finally {
      setEditLoadingId(null);
    }
  }

  // فتح/إغلاق الصف — الإغلاق يُبقي التحديد (↑↓ تتابع من نفس الصف)
  function toggleSection(id: number) {
    setSelectedId(id);
    setExpandedId(prev => (prev === id ? null : id));
  }

  function openCreate() {
    setNewBoxes([]);
    setCreateTried(false);
    setCreateOpen(true);
  }

  async function askDelete(d: SectionDetailDto) {
    const ok = await confirm({
      title: `حذف القسم «${d.name}»؟`,
      message:
        d.terminals.length > 0
          ? `يرتبط بهذا القسم ${d.terminals.length} نقطة بيع ستبقى بدون قسم. لا يمكن التراجع.`
          : 'لا يمكن التراجع عن الحذف.',
      confirmLabel: 'حذف القسم',
      danger: true,
    });
    if (ok) remove.mutate(d.id);
  }

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreateTried(true);
    if (!create.isPending) create.mutate();
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  }

  function exportCsv() {
    downloadCsv(
      'sections.csv',
      ['القسم', 'الفرع', 'فرع الأداري', 'مستودع', 'صناديق', 'حساب', 'أجهزة', 'متصل', 'فواتير اليوم', 'مبيعات اليوم', 'الحالة'],
      sections.map(s => [
        s.name,
        s.branchName ?? s.branchId ?? '',
        s.edariBranchId,
        s.edariWarehouseNumber,
        s.cashBoxCount ?? 0,
        s.masterAccount,
        s.terminalCount,
        s.onlineTerminals,
        s.todayReceipts,
        s.todaySales,
        s.state ? 'نشط' : 'متوقف',
      ]),
    );
  }

  const columns = useMemo(() => buildColumns(s => void editById(s.id)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = listQ.isLoading;
  const isFiltered = quick !== 'all' || !!query.trim();
  const detail = detailQ.data && detailQ.data.id === detailId ? detailQ.data : undefined;

  const stripCells: SummaryCell[] = [
    { label: 'الأقسام', value: formatNum(stats.total), hint: isFiltered ? `المعروض ${formatNum(sections.length)}` : undefined, onClick: () => setQuick('all'), active: quick === 'all' },
    { label: 'نشطة', value: formatNum(stats.active), tone: 'ok', hint: stats.total - stats.active > 0 ? `${formatNum(stats.total - stats.active)} متوقف` : undefined, onClick: () => setQuick('active'), active: quick === 'active' },
    { label: 'بلا صندوق', value: formatNum(stats.noBox), tone: stats.noBox > 0 ? 'warn' : undefined, hint: stats.noBox > 0 ? 'لا يمكن البيع عليها' : 'كل الأقسام مربوطة', onClick: () => setQuick('noBox'), active: quick === 'noBox' },
    { label: 'نقاط بيع متصلة', value: <>{formatNum(stats.online)} <span className="text-slate-300">/</span> {formatNum(stats.terminals)}</> },
    { label: 'فواتير اليوم', value: formatNum(stats.receipts) },
    { label: 'مبيعات اليوم (IQD)', value: formatNum(stats.sales), tone: 'brand' },
  ];

  const detailBody = (
    <>
      {detailId != null && !detail && detailQ.isLoading && (
        <div className="space-y-2 p-1">
          <Skeleton className="h-5 w-48" />
          <div className="grid grid-cols-4 gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          <Skeleton className="h-20" />
        </div>
      )}
      {detailId != null && !detail && detailQ.isError && (
        <Alert title="تعذر تحميل تفاصيل القسم">
          <Btn size="xs" variant="secondary" onClick={() => detailQ.refetch()}>إعادة المحاولة</Btn>
        </Alert>
      )}
      {detail && (
        <SectionDetail
          detail={detail}
          refreshing={detailQ.isFetching}
          onEdit={() => openEdit(detail)}
          onRefresh={() => detailQ.refetch()}
          onDelete={() => void askDelete(detail)}
          stacked={view !== 'table'}
        />
      )}
    </>
  );

  return (
    <WorkspacePage>
      <WorkspaceCard>
        <FilterBar
          footer={
            <>
              <SegmentedFilter<Quick>
                label="حالة القسم"
                value={quick}
                onChange={setQuick}
                items={[
                  { id: 'all', label: 'الكل', count: stats.total },
                  { id: 'active', label: 'نشطة', count: stats.active },
                  { id: 'inactive', label: 'متوقفة', count: stats.total - stats.active },
                  { id: 'noBox', label: 'بلا صندوق', count: stats.noBox, tone: 'warn' },
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
                  { id: 'cards', label: 'بطاقات' },
                ]}
              />
              <span className="ms-auto hidden text-[11px] text-slate-400 md:inline">كل قسم يُربط بفرع ومستودع في الأداري وبصناديق الكاشير · انقر الصف للتفاصيل</span>
            </>
          }
        >
          <FilterLabel label="بحث" grow>
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="اسم القسم أو الفرع أو رقم الأداري…"
              icon={<IconSearch size={15} />}
            />
          </FilterLabel>
          <FilterActions>
            <Link to="/terminals">
              <Btn variant="ghost" icon={<IconMonitor size={15} />}>نقاط البيع</Btn>
            </Link>
            <Btn variant="secondary" icon={<IconDownload size={15} />} disabled={!sections.length} onClick={exportCsv}>
              CSV
            </Btn>
            <Btn icon={<IconPlus size={15} />} onClick={openCreate}>قسم جديد</Btn>
            <IconButton label="تحديث" onClick={() => listQ.refetch()}>
              <IconRefresh size={16} className={listQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
          </FilterActions>
        </FilterBar>

        <SummaryStrip cells={stripCells} loading={loading} />

        {listQ.isError && (
          <div className="shrink-0 p-2">
            <Alert title="تعذر تحميل الأقسام">
              <Btn size="xs" variant="secondary" icon={<IconRefresh size={12} />} onClick={() => listQ.refetch()}>إعادة المحاولة</Btn>
            </Alert>
          </div>
        )}

        <WorkspaceBody>
          {loading && <div className="p-3"><TableSkeleton rows={6} cols={8} /></div>}

          {!loading && !listQ.isError && sections.length === 0 && (
            <EmptyState
              icon={<IconLayers size={24} />}
              title={allSections.length ? 'لا أقسام مطابقة' : 'لا توجد أقسام بعد'}
              description={allSections.length ? 'غيّر البحث أو الفلتر.' : 'أنشئ قسماً واربطه بفرع الأداري وصندوق كاشير ليبدأ البيع عليه.'}
              action={
                allSections.length ? (
                  <Btn size="sm" variant="secondary" onClick={() => { setQuery(''); setQuick('all'); }}>مسح الفلاتر</Btn>
                ) : (
                  <Btn size="sm" icon={<IconPlus size={14} />} onClick={openCreate}>قسم جديد</Btn>
                )
              }
            />
          )}

          {!loading && view === 'table' && sections.length > 0 && (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              columns={columns}
              rows={sections}
              getRowId={s => s.id}
              exportName="الأقسام"
              counterLabel="قسم"
              emptyText="لا أقسام تطابق فلتر الأعمدة"
              rowTone={s => ((s.cashBoxCount ?? 0) === 0 ? 'bg-amber-50/60' : undefined)}
              storageKey="sections-v2"
              badge={editLoadingId != null ? <span className="text-[11px] text-slate-400">جاري تحميل القسم…</span> : undefined}
              selectedId={selectedId ?? undefined}
              onSelect={s => setSelectedId(s.id)}
              onEnter={s => toggleSection(s.id)}
              expansion={{
                isExpanded: s => expandedId === s.id,
                onToggle: s => toggleSection(s.id),
                render: () => detailBody,
              }}
            />
          )}

          {!loading && view === 'cards' && sections.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {sections.map(s => {
                  const boxes = s.cashBoxCount ?? 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={`flex flex-col rounded-xl border bg-white p-3 text-right transition hover:border-brand-200 hover:bg-slate-50/50 ${boxes === 0 ? 'border-amber-200' : 'border-slate-200'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="truncate text-[13.5px] font-bold text-header">{s.name}</h3>
                            {s.state ? <Badge tone="ok">نشط</Badge> : <Badge>متوقف</Badge>}
                          </div>
                          <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                            {s.branchName ?? `فرع ${s.branchId}`} · سعر البيع {s.sellPrice}
                          </p>
                        </div>
                        <div className="shrink-0 text-center">
                          <p className="text-[16px] font-bold leading-6 text-header num">
                            {s.onlineTerminals}<span className="text-slate-300">/</span>{s.terminalCount}
                          </p>
                          <p className="text-[10.5px] text-slate-500">متصل</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge tone="default">الأداري: فرع {s.edariBranchId} · مستودع {s.edariWarehouseNumber}</Badge>
                        {boxes > 0 ? <Badge tone="brand">{boxes} صندوق</Badge> : <Badge tone="warn"><IconAlert size={11} /> بلا صندوق</Badge>}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-50 px-2.5 py-1">
                          <p className="text-[10.5px] text-slate-500">فواتير اليوم</p>
                          <p className="text-[14px] font-bold text-header num">{formatNum(s.todayReceipts)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2.5 py-1">
                          <p className="text-[10.5px] text-slate-500">مبيعات اليوم</p>
                          <p className="text-[14px] font-bold text-header num">
                            {formatNum(s.todaySales)} <span className="text-[10.5px] font-medium text-slate-400">IQD</span>
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      {/* ── تفاصيل القسم (عرض البطاقات) ── */}
      <Modal
        open={view !== 'table' && selectedId != null}
        title={detail?.name ?? allSections.find(s => s.id === selectedId)?.name ?? 'القسم'}
        subtitle={detail ? `${detail.branchName ?? `فرع #${detail.branchId}`} · سعر البيع ${detail.sellPrice}` : undefined}
        icon={<IconLayers size={18} />}
        onClose={() => setSelectedId(null)}
        wide
      >
        {detailBody}
      </Modal>

      <Modal
        open={createOpen}
        title="قسم جديد"
        subtitle="يُنشأ له فرع في الأداري تلقائياً إن لم تختر فرعاً"
        icon={<IconLayers size={18} />}
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <span className="text-[11.5px] text-slate-500">Enter للإنشاء · Esc للإغلاق</span>
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setCreateOpen(false)}>إلغاء</Btn>
              <Btn type="submit" form="section-create-form" loading={create.isPending}>إنشاء القسم</Btn>
            </div>
          </>
        }
      >
        <form id="section-create-form" onSubmit={submitCreate} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم القسم" hint={createTried && !newName.trim() ? <span className="text-red-600">اسم القسم مطلوب</span> : undefined}>
              <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="مثل: العطور" />
            </Field>
            <Field label="سعر البيع" hint="رقم قائمة السعر المستخدمة في هذا القسم.">
              <Input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
            </Field>
            <Field label="فرع الأداري" hint="اتركه «إنشاء تلقائي» لإنشاء فرع جديد.">
              <Select value={newBranch} onChange={e => setNewBranch(e.target.value)}>
                <option value="">إنشاء تلقائي / افتراضي</option>
                {(branchesQ.data ?? []).map(b => (
                  <option key={b.seq} value={b.seq}>{b.name ?? b.seq}</option>
                ))}
              </Select>
            </Field>
            <Field label="مستودع الأداري">
              <Input type="number" value={newWh} onChange={e => setNewWh(e.target.value)} />
            </Field>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-header"><IconWallet size={15} className="text-slate-400" /> صناديق القسم</p>
            <AssignedCashBoxesEditor
              boxes={newBoxes}
              onChange={setNewBoxes}
              hint="ابحث في حسابات الأداري وأضف صندوق الكاشير. الصندوق الافتراضي يُستخدم عند الدخول لنقطة البيع."
            />
            {createTried && newBoxes.length === 0 && <p className="mt-1.5 text-[12px] text-red-600">أضف صندوقاً واحداً على الأقل.</p>}
          </div>
          <Switch label="قسم نشط" description="يمكن للكاشير العمل عليه فوراً." checked={newActive} onChange={setNewActive} />
        </form>
      </Modal>

      <Modal
        open={editId != null}
        title="تعديل القسم"
        subtitle={form?.name}
        icon={<IconPencil size={18} />}
        onClose={() => setEditId(null)}
        wide
        footer={
          <>
            <span className="text-[11.5px] text-slate-500">Enter للحفظ · Esc للإغلاق</span>
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => setEditId(null)}>إلغاء</Btn>
              <Btn type="submit" form="section-edit-form" loading={save.isPending}>حفظ</Btn>
            </div>
          </>
        }
      >
        {form && (
          <form id="section-edit-form" onSubmit={submitEdit} className="space-y-5">
            <EditGroup title="الأساسي">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="اسم القسم" hint={!form.name.trim() ? <span className="text-red-600">اسم القسم مطلوب</span> : undefined}>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="سعر البيع">
                  <NumField value={form.sellPrice} onValue={n => setForm(f => (f ? { ...f, sellPrice: n } : f))} />
                </Field>
              </div>
              <div className="mt-3">
                <Switch label="قسم نشط" checked={form.state} onChange={v => setForm({ ...form, state: v })} />
              </div>
            </EditGroup>

            <EditGroup title="ربط الأداري" description="يحدد أين تُرحَّل فواتير هذا القسم.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="فرع الأداري">
                  <NumField value={form.edariBranchId} onValue={n => setForm(f => (f ? { ...f, edariBranchId: n } : f))} />
                </Field>
                <Field label="رقم المستودع">
                  <NumField value={form.edariWarehouseNumber} onValue={n => setForm(f => (f ? { ...f, edariWarehouseNumber: n } : f))} />
                </Field>
              </div>
            </EditGroup>

            <EditGroup title="صناديق الكاشير" description="بدون صندوق مرتبط لا يمكن الدخول إلى نقطة البيع. الصندوق الافتراضي يظهر أولاً للكاشير.">
              <AssignedCashBoxesEditor boxes={editBoxes} onChange={setEditBoxes} />
            </EditGroup>

            <EditGroup title="واجهة نقطة البيع">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="أعمدة المجموعات">
                  <NumField value={form.groupsColumnsCount} onValue={n => setForm(f => (f ? { ...f, groupsColumnsCount: n } : f))} />
                </Field>
                <Field label="حجم الزر">
                  <NumField value={form.groupsItemSize} onValue={n => setForm(f => (f ? { ...f, groupsItemSize: n } : f))} />
                </Field>
                <Field label="تقريب الإجمالي">
                  <NumField step="0.01" value={form.roundTotalTo} onValue={n => setForm(f => (f ? { ...f, roundTotalTo: n } : f))} />
                </Field>
                <Field label="تقريب السطر">
                  <NumField step="0.01" value={form.roundItemTo} onValue={n => setForm(f => (f ? { ...f, roundItemTo: n } : f))} />
                </Field>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Switch label="حفظ سريع" checked={form.fastSaving} onChange={v => setForm({ ...form, fastSaving: v })} />
                <Switch label="طباعة جماعية" checked={form.collectivePrinting} onChange={v => setForm({ ...form, collectivePrinting: v })} />
                <Switch label="عرض كمية المادة" checked={form.displayArticleQuantity} onChange={v => setForm({ ...form, displayArticleQuantity: v })} />
              </div>
            </EditGroup>
          </form>
        )}
      </Modal>
    </WorkspacePage>
  );
}

function EditGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <p className="text-[13px] font-bold text-header">{title}</p>
      {description && <p className="mb-3 mt-0.5 text-[12px] text-slate-500">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  );
}

/** تفاصيل القسم: الصناديق ونقاط البيع وربط الأداري — داخل صف الجدول الموسّع أو نافذة. */
function SectionDetail({
  detail: d,
  onEdit,
  onRefresh,
  onDelete,
  refreshing,
  stacked,
}: {
  detail: SectionDetailDto;
  onEdit: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  refreshing: boolean;
  stacked?: boolean;
}) {
  return (
    <div className={`space-y-2.5 ${stacked ? '' : 'rounded-lg border border-slate-200 bg-white p-3'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[12px] text-slate-500">
          ربط الأداري: <span className="font-semibold text-header num">فرع {d.edariBranchId} · مستودع {d.edariWarehouseNumber}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
          <IconCloud size={13} /> الحساب الرئيسي: <span className="font-semibold text-header num">{d.masterAccount > 0 ? d.masterAccount : '—'}</span>
        </span>
        <span className="text-[12px] text-slate-500">
          واجهة POS: <span className="num font-semibold text-header">{d.groupsColumnsCount}</span> أعمدة · حجم <span className="num font-semibold text-header">{d.groupsItemSize}</span>
          {' '}· تقريب <span className="num font-semibold text-header">{d.roundTotalTo}</span>/<span className="num font-semibold text-header">{d.roundItemTo}</span>
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          <Btn size="xs" icon={<IconPencil size={13} />} onClick={onEdit}>تعديل</Btn>
          <IconButton label="تحديث" className="!h-7 !w-7" onClick={onRefresh}>
            <IconRefresh size={13} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
          <Btn size="xs" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<IconTrash size={13} />} onClick={onDelete}>
            حذف
          </Btn>
        </div>
      </div>

      <div className={`grid gap-3 ${stacked ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'}`}>
        <div className="min-w-0">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-header">
            <IconWallet size={14} className="text-slate-400" /> صناديق القسم
            <span className="text-[11px] font-semibold text-slate-400 num">({formatNum(d.cashBoxes?.length ?? 0)})</span>
          </p>
          {(d.cashBoxes?.length ?? 0) === 0 ? (
            <Alert type="warning">
              لا صناديق مرتبطة — الكاشير في هذا القسم لا يستطيع الدخول إلى نقطة البيع حتى تضيف صندوقاً من «تعديل».
            </Alert>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-[12px]">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-2.5 py-1 text-start font-bold">الصندوق</th>
                  <th className="w-20 px-2.5 py-1 text-end font-bold">Seq</th>
                  <th className="w-20 px-2.5 py-1 text-center font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.cashBoxes.map(b => (
                  <tr key={b.masterAccount}>
                    <td className="max-w-0 truncate px-2.5 py-1 font-semibold text-header">
                      {b.masterAccountNum ? `${b.masterAccountNum} — ${b.masterAccountName ?? ''}` : b.masterAccountName || `#${b.masterAccount}`}
                    </td>
                    <td className="px-2.5 py-1 text-end text-slate-500 num">{b.masterAccount}</td>
                    <td className="px-2.5 py-1 text-center">{b.isDefault && <Badge tone="ok">افتراضي</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-header">
              <IconMonitor size={14} className="text-slate-400" /> نقاط البيع في هذا القسم
              <span className="text-[11px] font-semibold text-slate-400 num">({formatNum(d.terminals.length)})</span>
            </p>
            <Link to="/terminals" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:underline">
              مراقبة الأجهزة <IconExternal size={11} />
            </Link>
          </div>
          {d.terminals.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-[12px] text-slate-400">لا أجهزة مسجّلة في هذا القسم — اربط نقطة بيع من صفحة نقاط البيع.</p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-slate-200 text-[12px]">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-2.5 py-1 text-start font-bold">نقطة البيع</th>
                  <th className="w-24 px-2.5 py-1 text-center font-bold">الحالة</th>
                  <th className="w-24 px-2.5 py-1 text-start font-bold">آخر ظهور</th>
                  <th className="w-20 px-2.5 py-1 text-start font-bold">الإصدار</th>
                  <th className="w-20 px-2.5 py-1 text-center font-bold">المعرّف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.terminals.map(t => {
                  const online = !!t.lastConnection && Date.now() - new Date(t.lastConnection).getTime() < 5 * 60 * 1000;
                  return (
                    <tr key={t.id}>
                      <td className="max-w-0 px-2.5 py-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <PulseDot online={online} size="sm" />
                          <span className="truncate font-semibold text-header">{terminalTitle({ ...t, sectionName: d.name })}</span>
                          {!t.active && <Badge>موقوف</Badge>}
                        </span>
                      </td>
                      <td className="px-2.5 py-1 text-center">
                        <Badge tone={online ? 'ok' : 'default'}>{online ? 'متصل' : 'غير متصل'}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1 text-slate-500">{timeAgo(t.lastConnection)}</td>
                      <td className="px-2.5 py-1 text-slate-500 num">{t.exeVersion ?? '—'}</td>
                      <td className="px-2.5 py-1 text-center"><HwIdLabel hwId={t.hwId} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
