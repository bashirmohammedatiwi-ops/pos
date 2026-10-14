import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatDateOnly, formatNum } from '@/api/client';
import type { CommissionGroupDetailDto, CommissionGroupDto } from '@/api/types';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Loading,
  Modal,
  Select,
  TableSkeleton,
  Tabs,
  useConfirm,
} from '@/components/ui';
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
} from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import {
  TreeScopeEditor,
  type ScopeStandaloneItem,
  type ScopeTreeCard,
  type ScopeTreeProduct,
} from '@/components/scope/TreeScopeEditor';
import { ScopePickerModal, type ScopePickerOps } from '@/components/scope/ScopePickerModal';
import { FullScreenEditor } from '@/components/scope/FullScreenEditor';
import {
  IconAlert,
  IconCheck,
  IconCoins,
  IconLayers,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUsers,
  IconX,
  IconZap,
} from '@/components/icons';
import { ProductCommissionSearch } from '@/components/commissions/ProductCommissionSearch';
import { CommissionOverlapsSection } from '@/components/commissions/CommissionOverlapsSection';
import { otherCommissionMemberships } from '@/components/commissions/CommissionGroupPills';
import { CommissionPreviewCard } from '@/components/CommissionPreviewCard';
import {
  IconPause,
  IconPlay,
  IconViewGrid,
  IconViewList,
  Segmented,
  isTypingTarget,
  readPref,
  writePref,
} from '@/components/incentives/kit';

const GROUP_COLORS = ['#0f9f76', '#0ea5e9', '#7c3aed', '#d97706', '#e11d48', '#db2777', '#475569', '#0f172a'];

function accentOf(hex?: string | null) {
  const raw = (hex ?? '').trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(raw)) return raw.startsWith('#') ? raw : `#${raw}`;
  return '#0f9f76';
}

const isPct = (type?: string | null) => (type ?? '').toLowerCase() === 'percentage';

function commissionLabel(type: string, value: number) {
  if (isPct(type)) return `${formatNum(value)}٪`;
  return `${formatNum(value)} IQD`;
}

function commissionKind(type: string) {
  return isPct(type) ? 'نسبة من قيمة البيع' : 'مبلغ لكل قطعة';
}

function groupSalesmenNames(g: Pick<CommissionGroupDto, 'salesmen' | 'salesmanId' | 'salesmanName'>) {
  const names = (g.salesmen ?? []).map(s => s.salesmanName).filter(Boolean) as string[];
  if (names.length) return names;
  if (g.salesmanName) return [g.salesmanName];
  return [];
}

function groupSalesmenLabel(g: Pick<CommissionGroupDto, 'salesmen' | 'salesmanId' | 'salesmanName'>) {
  const names = groupSalesmenNames(g);
  if (names.length > 2) return `${names.slice(0, 2).join('، ')} +${formatNum(names.length - 2)}`;
  if (names.length) return names.join('، ');
  return 'كل البائعين';
}

/** خطأ قيمة العمولة (أو null إن كانت سليمة). */
function valueError(type: string, raw: string) {
  if (raw.trim() === '') return 'أدخل قيمة العمولة';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'قيمة غير صالحة';
  if (n < 0) return 'لا تكون العمولة سالبة';
  if (isPct(type) && n > 100) return 'النسبة لا تتجاوز 100٪';
  return null;
}

type StatusFilter = 'all' | 'on' | 'off';
type TypeFilter = 'all' | 'fixed' | 'percentage';
type SortKey = 'order' | 'name' | 'value' | 'products';
type ViewMode = 'grid' | 'table';
type ToolTab = 'lookup' | 'simulate' | 'overlaps';

const VIEW_KEY = 'fot.commissions.view.v2';
const SORT_KEY = 'fot.commissions.sort';

/**
 * مجاميع العمولة — إنشاء وإدارة.
 * مساحة عمل بعرض وارتفاع كاملين: فلاتر · شريط مجاميع · جدول يملأ الشاشة.
 * التعديل في محرر كامل فوق الصفحة (?group=ID) بلا تقارير.
 */
export function CommissionGroupsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const editingId = Number(params.get('group') || 0) || null;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortKey>(() => readPref(SORT_KEY, ['order', 'name', 'value', 'products'] as const, 'order'));
  const [view, setView] = useState<ViewMode>(() => readPref(VIEW_KEY, ['grid', 'table'] as const, 'table'));
  // فرز رأس الجدول محكوم من اللوحة — تغيير قائمة «الترتيب» يلغيه حتى لا يطغى عليها فرز محفوظ
  const [gridSort, setGridSort] = useState<GridSort | null>(null);
  const [toolTab, setToolTab] = useState<ToolTab>('lookup');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const groupsQ = useQuery({ queryKey: ['commission-groups'], queryFn: api.commissionGroups });
  const overlapsQ = useQuery({ queryKey: ['commission-overlaps'], queryFn: api.commissionOverlaps });
  const all = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);

  useEffect(() => writePref(VIEW_KEY, view), [view]);
  useEffect(() => writePref(SORT_KEY, sort), [sort]);

  // «/» للبحث، «N» لمجموعة جديدة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId != null || creating || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ى') {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, creating]);

  const matchesType = (g: CommissionGroupDto, f: TypeFilter) =>
    f === 'all' ? true : f === 'percentage' ? isPct(g.commissionType) : !isPct(g.commissionType);
  const matchesStatus = (g: CommissionGroupDto, f: StatusFilter) =>
    f === 'all' ? true : f === 'on' ? g.isActive : !g.isActive;

  // عدّادات الحالة تتبع فلتر النوع، وعدّادات النوع تتبع فلتر الحالة
  const counts = useMemo(() => {
    const base = all.filter(g => matchesType(g, typeFilter));
    return {
      all: base.length,
      on: base.filter(g => g.isActive).length,
      off: base.filter(g => !g.isActive).length,
    };
  }, [all, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeCounts = useMemo(() => {
    const base = all.filter(g => matchesStatus(g, statusFilter));
    return {
      all: base.length,
      fixed: base.filter(g => !isPct(g.commissionType)).length,
      percentage: base.filter(g => isPct(g.commissionType)).length,
    };
  }, [all, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = all
      .filter(g => matchesStatus(g, statusFilter))
      .filter(g => matchesType(g, typeFilter))
      .filter(g =>
        !q
        || g.name.toLowerCase().includes(q)
        || (g.label ?? '').toLowerCase().includes(q)
        || groupSalesmenNames(g).some(n => n.toLowerCase().includes(q)));
    const sorted = list.slice();
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    else if (sort === 'value') {
      sorted.sort((a, b) =>
        Number(isPct(a.commissionType)) - Number(isPct(b.commissionType)) || b.commissionValue - a.commissionValue);
    } else if (sort === 'products') sorted.sort((a, b) => (b.productCount ?? 0) - (a.productCount ?? 0));
    else sorted.sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
    return sorted;
  }, [all, search, statusFilter, typeFilter, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const active = all.filter(g => g.isActive);
    const salesmen = new Set<number>();
    let openToAll = 0;
    for (const g of active) {
      const ids = (g.salesmen ?? []).map(s => s.salesmanId).filter(Boolean);
      if (ids.length) ids.forEach(id => salesmen.add(id));
      else if (g.salesmanId) salesmen.add(g.salesmanId);
      else openToAll++;
    }
    return {
      on: active.length,
      off: all.length - active.length,
      products: active.reduce((n, g) => n + (g.productCount ?? 0), 0),
      trees: active.reduce((n, g) => n + (g.treeCount ?? 0), 0),
      salesmen: salesmen.size,
      openToAll,
    };
  }, [all]);

  const overlapCount = overlapsQ.data?.length ?? 0;
  const filtersActive = !!search.trim() || statusFilter !== 'all' || typeFilter !== 'all';

  function resetFilters() {
    setSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
  }

  function setEditing(id: number | null) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('group', String(id));
      else next.delete('group');
      next.delete('tab');
      next.delete('salesman');
      return next;
    }, { replace: true });
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['commission-groups'] });
    await qc.invalidateQueries({ queryKey: ['commission-group'] });
    await qc.invalidateQueries({ queryKey: ['commission-overlaps'] });
    await qc.invalidateQueries({ queryKey: ['commission-lookup'] });
  }

  const toggle = useMutation({
    mutationFn: (g: CommissionGroupDto) => api.setCommissionGroupActive(g.id, !g.isActive),
    onSuccess: async (_, g) => {
      toast.success(g.isActive ? `توقّفت «${g.name}»` : `فُعّلت «${g.name}»`);
      await refresh();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  const remove = useMutation({
    mutationFn: (g: CommissionGroupDto) => api.deleteCommissionGroup(g.id),
    onSuccess: async (_, g) => {
      toast.success(`حُذفت «${g.name}»`);
      await refresh();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  async function askToggle(g: CommissionGroupDto) {
    if (g.isActive) {
      const ok = await confirm({
        title: `إيقاف «${g.name}»؟`,
        message: 'لن تُحسب عمولة هذه المجموعة على المبيعات الجديدة حتى تُفعّلها مرة أخرى. الأصناف والإعدادات تبقى كما هي.',
        confirmLabel: 'إيقاف',
        danger: true,
      });
      if (!ok) return;
    }
    toggle.mutate(g);
  }

  async function askDelete(g: CommissionGroupDto) {
    const ok = await confirm({
      title: `حذف «${g.name}» نهائياً؟`,
      message: `ستُزال المجموعة مع ${formatNum(g.productCount ?? 0)} صنف مرتبط بها. لإيقافها مؤقتاً استخدم «إيقاف» بدلاً من الحذف.`,
      confirmLabel: 'حذف نهائي',
      danger: true,
    });
    if (ok) remove.mutate(g);
  }

  function openTool(tab: ToolTab) {
    setToolTab(tab);
    setToolsOpen(true);
  }

  /** فتح مجموعة من داخل نافذة الأدوات: تُغلق النافذة أولاً ثم يُفتح المحرر. */
  function openGroupFromTools(id: number) {
    setToolsOpen(false);
    setEditing(id);
  }

  const busyId = (toggle.isPending ? toggle.variables?.id : undefined) ?? (remove.isPending ? remove.variables?.id : undefined);

  // بلا useMemo: الأعمدة تستدعي setParams ويجب أن تبقى حديثة
  const columns: GridColumn<CommissionGroupDto>[] = [
    {
      key: 'name',
      header: 'المجموعة',
      width: 240,
      sortValue: g => g.name,
      filterValue: g => `${g.name} ${g.label ?? ''}`,
      render: g => (
        <div className="flex min-w-0 items-center gap-2" title={g.label ? `${g.name} — ${g.label}` : g.name}>
          <ColorDot color={accentOf(g.colorHex)} />
          <span className="min-w-0 truncate font-semibold text-header">{g.name}</span>
          {g.label && <span className="min-w-0 truncate text-[11px] text-slate-400">{g.label}</span>}
        </div>
      ),
    },
    {
      key: 'commissionValue',
      header: 'العمولة',
      width: 130,
      sortValue: g => g.commissionValue,
      filterValue: g => commissionLabel(g.commissionType, g.commissionValue),
      render: g => <CommissionAmount type={g.commissionType} value={g.commissionValue} size="sm" />,
    },
    {
      key: 'commissionType',
      header: 'النوع',
      width: 130,
      sortValue: g => (isPct(g.commissionType) ? 1 : 0),
      filterValue: g => commissionKind(g.commissionType),
      exportValue: g => commissionKind(g.commissionType),
      render: g => <span className="text-[12px] text-slate-600">{commissionKind(g.commissionType)}</span>,
    },
    {
      key: 'treeCount',
      header: 'أشجار',
      width: 80,
      align: 'center',
      mono: true,
      footer: 'sum',
      sortValue: g => g.treeCount ?? 0,
      render: g => <span className="num">{formatNum(g.treeCount ?? 0)}</span>,
    },
    {
      key: 'productCount',
      header: 'أصناف',
      width: 110,
      align: 'center',
      mono: true,
      footer: 'sum',
      sortValue: g => g.productCount ?? 0,
      render: g => ((g.productCount ?? 0) === 0
        ? <Badge tone="warn">بلا أصناف</Badge>
        : <span className="num font-semibold text-header">{formatNum(g.productCount ?? 0)}</span>),
    },
    {
      key: 'salesmen',
      header: 'البائعون',
      width: 220,
      sortValue: g => groupSalesmenLabel(g),
      filterValue: g => groupSalesmenNames(g).join(' ') || 'كل البائعين',
      exportValue: g => groupSalesmenNames(g).join('، ') || 'كل البائعين',
      render: g => {
        const names = groupSalesmenNames(g);
        return (
          <span className={`block truncate text-[12px] ${names.length ? 'text-slate-600' : 'text-slate-400'}`} title={names.join('، ') || 'كل البائعين'}>
            {groupSalesmenLabel(g)}
          </span>
        );
      },
    },
    {
      key: 'effectiveFrom',
      header: 'منذ',
      width: 110,
      sortValue: g => g.effectiveFrom ?? '',
      filterValue: g => (g.effectiveFrom ? formatDateOnly(g.effectiveFrom) : ''),
      render: g => <span className="num text-[12px] text-slate-500">{g.effectiveFrom ? formatDateOnly(g.effectiveFrom) : '—'}</span>,
    },
    {
      key: 'isActive',
      header: 'الحالة',
      width: 100,
      sortValue: g => (g.isActive ? 1 : 0),
      filterValue: g => (g.isActive ? 'نشطة' : 'متوقفة'),
      exportValue: g => (g.isActive ? 'نشطة' : 'متوقفة'),
      render: g => <Badge tone={g.isActive ? 'ok' : 'default'} dot>{g.isActive ? 'نشطة' : 'متوقفة'}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 120,
      align: 'center',
      pinned: 'end',
      sortable: false,
      exportable: false,
      render: g => (
        <div className="flex justify-center" onDoubleClick={e => e.stopPropagation()}>
          <RowActions
            group={g}
            busy={busyId === g.id}
            compact
            onOpen={() => setEditing(g.id)}
            onToggle={() => void askToggle(g)}
            onDelete={() => void askDelete(g)}
          />
        </div>
      ),
    },
  ];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        {/* ── الفلاتر ── */}
        <FilterBar
          footer={
            <>
              <SegmentedFilter<StatusFilter>
                label="الحالة"
                value={statusFilter}
                onChange={setStatusFilter}
                items={[
                  { id: 'all', label: 'كل الحالات', count: counts.all },
                  { id: 'on', label: 'نشطة', count: counts.on },
                  { id: 'off', label: 'متوقفة', count: counts.off },
                ]}
              />
              <SegmentedFilter<TypeFilter>
                label="نوع العمولة"
                value={typeFilter}
                onChange={setTypeFilter}
                items={[
                  { id: 'all', label: 'كل الأنواع', count: typeCounts.all },
                  { id: 'fixed', label: 'مبلغ لكل قطعة', count: typeCounts.fixed },
                  { id: 'percentage', label: 'نسبة من البيع', count: typeCounts.percentage },
                ]}
              />
              {filtersActive && (
                <button type="button" onClick={resetFilters} className="text-[12px] font-semibold text-brand-700 hover:underline">
                  مسح التصفية
                </button>
              )}
              <span className="ms-auto hidden text-[11px] text-slate-400 xl:inline">
                نقرة مزدوجة أو Enter لفتح المجموعة · ↑↓ للتنقل · N مجموعة جديدة
              </span>
            </>
          }
        >
          <FilterLabel label="بحث" grow>
            <div className="relative">
              <IconSearch size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape' && search) {
                    e.stopPropagation();
                    setSearch('');
                  }
                }}
                placeholder="اسم المجموعة أو البائع…"
                className="!ps-9 !pe-9"
                aria-label="بحث في المجاميع"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="مسح البحث"
                >
                  <IconX size={14} />
                </button>
              ) : (
                <span className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>/</Kbd></span>
              )}
            </div>
          </FilterLabel>
          <FilterLabel label="الترتيب">
            <Select
              value={gridSort && view === 'table' ? '__grid' : sort}
              onChange={e => {
                if (e.target.value === '__grid') return;
                setSort(e.target.value as SortKey);
                setGridSort(null);
              }}
              aria-label="الترتيب"
            >
              {gridSort && view === 'table' && <option value="__grid" disabled>حسب عمود الجدول</option>}
              <option value="order">الافتراضي (النشطة أولاً)</option>
              <option value="name">الاسم</option>
              <option value="value">قيمة العمولة</option>
              <option value="products">عدد الأصناف</option>
            </Select>
          </FilterLabel>
          <FilterActions>
            <Segmented<ViewMode>
              ariaLabel="طريقة العرض"
              value={view}
              onChange={setView}
              items={[
                { id: 'table', label: <IconViewList size={15} />, title: 'جدول' },
                { id: 'grid', label: <IconViewGrid size={15} />, title: 'بطاقات' },
              ]}
            />
            <Btn variant="secondary" icon={<IconZap size={15} />} onClick={() => openTool(toolTab)} title="بحث عن منتج · محاكاة عمولة · أصناف مكررة">
              أدوات
            </Btn>
            <IconButton label="تحديث" onClick={() => void refresh()}>
              <IconRefresh size={15} className={groupsQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn icon={<IconPlus size={15} />} onClick={() => setCreating(true)} title="مجموعة جديدة (N)">
              مجموعة جديدة
            </Btn>
          </FilterActions>
        </FilterBar>

        {/* ── شريط المجاميع ── */}
        <SummaryStrip
          loading={groupsQ.isLoading}
          cells={[
            {
              label: 'المجاميع النشطة',
              value: formatNum(kpi.on),
              hint: `من ${formatNum(all.length)} مجموعة`,
              tone: 'brand',
              onClick: () => setStatusFilter(statusFilter === 'on' ? 'all' : 'on'),
              active: statusFilter === 'on',
            },
            {
              label: 'متوقفة',
              value: formatNum(kpi.off),
              hint: 'لا تُحسب عمولتها',
              onClick: () => setStatusFilter(statusFilter === 'off' ? 'all' : 'off'),
              active: statusFilter === 'off',
            },
            {
              label: 'أصناف عليها عمولة',
              value: formatNum(kpi.products),
              hint: `${formatNum(kpi.trees)} شجرة في النشطة`,
            },
            {
              label: 'بائعون مخصّصون',
              value: formatNum(kpi.salesmen),
              hint: kpi.openToAll ? `${formatNum(kpi.openToAll)} مجموعة لكل البائعين` : 'كل المجاميع مخصّصة',
            },
            {
              label: 'أصناف مكررة',
              value: overlapsQ.isLoading ? '…' : formatNum(overlapCount),
              hint: overlapCount ? 'في أكثر من مجموعة — راجعها' : 'لا تكرار بين المجاميع',
              tone: overlapCount ? 'warn' : 'ok',
              onClick: () => openTool('overlaps'),
            },
          ]}
        />

        {groupsQ.isError && (
          <div className="shrink-0 p-2">
            <Alert title="تعذر تحميل المجاميع">
              <div className="flex flex-wrap items-center gap-2">
                {groupsQ.error instanceof Error ? groupsQ.error.message : 'خطأ غير معروف'}
                <Btn size="xs" variant="secondary" icon={<IconRefresh size={13} />} onClick={() => groupsQ.refetch()}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}

        {/* ── الجدول ── */}
        <WorkspaceBody>
          {groupsQ.isLoading ? (
            <TableSkeleton rows={10} cols={8} />
          ) : groupsQ.isError && all.length === 0 ? null : groups.length === 0 ? (
            all.length > 0 ? (
              <EmptyState
                compact
                icon={<IconSearch size={18} />}
                title="لا مجاميع تطابق التصفية"
                description="جرّب كلمة أخرى أو اعرض كل المجاميع."
                action={<Btn variant="secondary" size="sm" onClick={resetFilters}>مسح التصفية</Btn>}
              />
            ) : (
              <EmptyState
                icon={<IconCoins size={24} />}
                title="لا مجاميع عمولة بعد"
                description="المجموعة تربط أصنافاً بعمولة ثابتة لكل قطعة أو نسبة من البيع. أنشئ واحدة ثم أضف الأشجار أو المنتجات."
                action={<Btn icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>مجموعة جديدة</Btn>}
              />
            )
          ) : view === 'grid' ? (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {groups.map(g => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    busy={busyId === g.id}
                    onOpen={() => setEditing(g.id)}
                    onToggle={() => void askToggle(g)}
                    onDelete={() => void askDelete(g)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              columns={columns}
              rows={groups}
              getRowId={g => g.id}
              exportName="مجاميع-العمولة"
              counterLabel="مجموعة"
              badge={filtersActive ? (
                <span className="text-[11px] text-slate-400">من أصل <span className="num">{formatNum(all.length)}</span></span>
              ) : undefined}
              emptyText="لا مجاميع تطابق فلتر الأعمدة"
              storageKey="commission-groups"
              sort={gridSort}
              onSortChange={setGridSort}
              rowTone={g => (busyId === g.id ? 'opacity-60' : g.isActive ? undefined : 'bg-slate-50/90 text-slate-500')}
              selectedId={selectedId ?? undefined}
              onSelect={g => setSelectedId(g.id)}
              onRowDoubleClick={g => setEditing(g.id)}
              onEnter={g => setEditing(g.id)}
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      {/* أدوات مساعدة — في نافذة حتى لا تقتطع مساحة الجدول */}
      <Modal
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        size="xl"
        icon={<IconZap size={18} />}
        title="أدوات العمولات"
        subtitle="ابحث عن منتج، جرّب حساب عمولة، أو راجع الأصناف المكررة"
      >
        <Tabs<ToolTab>
          value={toolTab}
          onChange={setToolTab}
          items={[
            { id: 'lookup', label: 'بحث عن منتج', icon: <IconSearch size={14} /> },
            { id: 'simulate', label: 'محاكاة عمولة', icon: <IconCoins size={14} /> },
            { id: 'overlaps', label: 'أصناف مكررة', icon: <IconAlert size={14} />, count: overlapCount || undefined },
          ]}
        />
        <div className="pt-4">
          {toolTab === 'lookup' && <ProductCommissionSearch embedded onOpenGroup={openGroupFromTools} />}
          {toolTab === 'simulate' && <CommissionPreviewCard embedded />}
          {toolTab === 'overlaps' && <CommissionOverlapsSection embedded onOpenGroup={openGroupFromTools} />}
        </div>
      </Modal>

      <CreateGroupModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async id => {
          setCreating(false);
          await refresh();
          setEditing(id);
        }}
      />

      {editingId != null && (
        <GroupEditorLoader
          groupId={editingId}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
    </WorkspacePage>
  );
}

/* ── بطاقة مجموعة ── */

function ColorDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full ring-2 ring-white shadow-[0_0_0_1px_rgba(15,23,42,0.08)]"
      style={{ background: color, width: size, height: size }}
      aria-hidden
    />
  );
}

function CommissionAmount({ type, value, size = 'md' }: { type: string; value: number; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`num font-bold text-header ${size === 'md' ? 'text-[20px] leading-none' : 'text-[13.5px]'}`}>{formatNum(value)}</span>
      <span className="text-[11.5px] font-semibold text-slate-400">{isPct(type) ? '٪' : 'IQD'}</span>
    </span>
  );
}

function RowActions({
  group,
  busy,
  onOpen,
  onToggle,
  onDelete,
  compact,
}: {
  group: CommissionGroupDto;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
  /** أزرار أصغر لصفوف الجدول. */
  compact?: boolean;
}) {
  const small = compact ? '!h-7 !w-7' : '!h-8 !w-8';
  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <IconButton label="تعديل" className={small} onClick={onOpen}>
        <IconPencil size={15} />
      </IconButton>
      <IconButton label={group.isActive ? 'إيقاف' : 'تفعيل'} className={small} disabled={busy} onClick={onToggle}>
        {group.isActive ? <IconPause size={14} /> : <IconPlay size={14} />}
      </IconButton>
      <IconButton
        label="حذف"
        className={`${small} hover:!border-red-200 hover:!bg-red-50 hover:!text-red-600`}
        disabled={busy}
        onClick={onDelete}
      >
        <IconTrash size={15} />
      </IconButton>
    </div>
  );
}

function GroupCard({
  group,
  busy,
  onOpen,
  onToggle,
  onDelete,
}: {
  group: CommissionGroupDto;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const color = accentOf(group.colorHex);
  return (
    <article
      className={`card group flex flex-col p-4 transition hover:border-brand-200 hover:shadow-[var(--shadow-lift)] ${
        group.isActive ? '' : 'bg-slate-50/70'
      } ${busy ? 'pointer-events-none opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[5px]"><ColorDot color={color} /></span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-right">
          <h3 className="truncate text-[14px] font-bold text-header transition group-hover:text-brand-700">{group.name}</h3>
          <p className="text-[11.5px] text-slate-500">{commissionKind(group.commissionType)}</p>
        </button>
        <Badge tone={group.isActive ? 'ok' : 'default'} dot>{group.isActive ? 'نشطة' : 'متوقفة'}</Badge>
      </div>

      <button type="button" onClick={onOpen} className="mt-3 text-right">
        <CommissionAmount type={group.commissionType} value={group.commissionValue} />
        <span className="ms-1.5 text-[11.5px] text-slate-400">{isPct(group.commissionType) ? 'من قيمة البيع' : 'لكل قطعة'}</span>
      </button>

      <div className="mt-3 space-y-1.5 text-[12px] text-slate-500">
        <p className="flex items-center gap-1.5">
          <IconLayers size={13} className="shrink-0 text-slate-400" />
          <span className="num">{formatNum(group.treeCount ?? 0)}</span> شجرة
          <span className="text-slate-300">·</span>
          <span className="num">{formatNum(group.productCount ?? 0)}</span> صنف
          {(group.productCount ?? 0) === 0 && <Badge tone="warn" className="ms-1">بلا أصناف</Badge>}
        </p>
        <p className="flex min-w-0 items-center gap-1.5">
          <IconUsers size={13} className="shrink-0 text-slate-400" />
          <span className="truncate">{groupSalesmenLabel(group)}</span>
        </p>
      </div>

      <footer className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
        <span className="me-auto truncate text-[11px] text-slate-400">
          {group.effectiveFrom ? `منذ ${formatDateOnly(group.effectiveFrom)}` : ''}
        </span>
        <RowActions group={group} busy={busy} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />
      </footer>
    </article>
  );
}

function GroupEditorLoader({
  groupId,
  onClose,
  onChanged,
}: {
  groupId: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const detailQ = useQuery({
    queryKey: ['commission-group', groupId],
    queryFn: () => api.commissionGroup(groupId),
  });
  const groupsQ = useQuery({ queryKey: ['commission-groups'], queryFn: api.commissionGroups });

  if (detailQ.isLoading || groupsQ.isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-slate-100/90">
        <Loading label="تحميل المجموعة…" />
      </div>
    );
  }

  if (!detailQ.data) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-100 p-4">
        <div className="card w-full max-w-sm">
          <EmptyState
            icon={<IconCoins size={22} />}
            title={detailQ.isError ? 'تعذر تحميل المجموعة' : 'المجموعة غير موجودة'}
            description={detailQ.isError ? 'تحقق من الاتصال ثم أعد المحاولة.' : 'ربما حُذفت من جهاز آخر.'}
            action={
              <div className="flex gap-2">
                {detailQ.isError && <Btn size="sm" onClick={() => detailQ.refetch()}>إعادة المحاولة</Btn>}
                <Btn size="sm" variant="secondary" onClick={onClose}>رجوع</Btn>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <GroupEditorModal
      key={detailQ.data.id}
      detail={detailQ.data}
      open
      onClose={onClose}
      onChanged={onChanged}
      onDeleted={onClose}
      allGroups={groupsQ.data ?? []}
    />
  );
}

/* ── محرر المجموعة ── */

function SideSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-header">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TypeToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="نوع العمولة">
      {([
        ['fixed', 'مبلغ لكل قطعة', 'IQD ثابت'],
        ['percentage', 'نسبة من البيع', '٪ من القيمة'],
      ] as const).map(([v, label, hint]) => {
        const active = (isPct(value) ? 'percentage' : 'fixed') === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={`rounded-lg border px-2.5 py-2 text-right transition ${
              active
                ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500/25'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className={`block text-[12.5px] font-bold ${active ? 'text-brand-800' : 'text-slate-700'}`}>{label}</span>
            <span className="block text-[11px] text-slate-500">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function ColorPicker({ value, onChange, size = 28 }: { value: string; onChange: (c: string) => void; size?: number }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="لون المجموعة">
      {GROUP_COLORS.map(c => {
        const active = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`اللون ${c}`}
            title={c}
            onClick={() => onChange(c)}
            className={`flex items-center justify-center rounded-full text-white ring-offset-2 transition ${
              active ? 'ring-2 ring-slate-400' : 'hover:scale-110'
            }`}
            style={{ background: c, width: size, height: size }}
          >
            {active && <IconCheck size={13} />}
          </button>
        );
      })}
    </div>
  );
}

/** معاينة ما سيحصل عليه البائع — مثال بسيط بسعر قابل للتعديل. */
function EarningPreview({ type, value }: { type: string; value: number }) {
  const [price, setPrice] = useState('25000');
  const [qty, setQty] = useState('1');
  const p = Math.max(0, Number(price) || 0);
  const q = Math.max(0, Number(qty) || 0);
  const earn = isPct(type) ? (p * q * value) / 100 : q * value;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_72px] gap-2">
        <Field label="سعر القطعة (IQD)">
          <Input type="number" min={0} value={price} onChange={e => setPrice(e.target.value)} className="num" />
        </Field>
        <Field label="الكمية">
          <Input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} className="num" />
        </Field>
      </div>
      <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
        <p className="text-[11.5px] text-slate-500">يحصل البائع على</p>
        <p className="mt-0.5 flex items-baseline gap-1">
          <span className="num text-[20px] font-bold text-brand-700">{formatNum(Math.round(earn))}</span>
          <span className="text-[11.5px] font-semibold text-slate-400">IQD</span>
        </p>
        <p className="mt-0.5 text-[11.5px] text-slate-500">
          {isPct(type)
            ? `${formatNum(value)}٪ × ${formatNum(p * q)} IQD قيمة البيع`
            : `${formatNum(value)} IQD × ${formatNum(q)} قطعة`}
        </p>
      </div>
    </div>
  );
}

export function GroupEditorModal({
  detail,
  open,
  onClose,
  onChanged,
  onDeleted,
  allGroups,
  autoOpenPicker,
}: {
  detail: CommissionGroupDetailDto;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  allGroups: CommissionGroupDto[];
  autoOpenPicker?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(!!autoOpenPicker);
  const [name, setName] = useState(detail.name);
  const [value, setValue] = useState(String(detail.commissionValue));
  const [type, setType] = useState(detail.commissionType || 'fixed');
  const [color, setColor] = useState(accentOf(detail.colorHex));
  const [salesmanIds, setSalesmanIds] = useState<number[]>(
    detail.salesmen?.map(s => s.salesmanId).filter(Boolean) ?? (detail.salesmanId ? [detail.salesmanId] : []),
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen() });
  const salesmen = salesmenQ.data?.items ?? [];

  const nameError = name.trim() ? null : 'الاسم مطلوب';
  const valErr = valueError(type, value);

  async function refreshDetail() {
    await qc.invalidateQueries({ queryKey: ['commission-group', detail.id] });
    await onChanged();
  }

  const deleteGroup = useMutation({
    mutationFn: () => api.deleteCommissionGroup(detail.id),
    onSuccess: async () => {
      toast.success('حُذفت المجموعة');
      await onChanged();
      onDeleted();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  const saveFields = useMutation({
    mutationFn: (patch?: {
      name?: string;
      type?: string;
      value?: number;
      salesmanIds?: number[];
      colorHex?: string;
    }) => {
      let nextType = patch?.type ?? type;
      let nextValue = patch?.value ?? (Number(value) || 0);
      // لا يُحفظ نوع/قيمة غير صالحين عبر حفظ حقل آخر (لون/بائعين) — نُبقي ما على الخادم
      if (valueError(nextType, String(patch?.value ?? value))) {
        nextType = detail.commissionType;
        nextValue = detail.commissionValue;
      }
      const nextIds = patch?.salesmanIds ?? salesmanIds;
      return api.updateCommissionGroup(detail.id, {
        name: (patch?.name ?? name).trim() || detail.name,
        description: detail.description ?? null,
        commissionType: nextType,
        commissionValue: nextValue,
        salesmanId: nextIds.length ? nextIds[0] : null,
        salesmanIds: nextIds,
        label: detail.label ?? null,
        sortOrder: detail.sortOrder ?? 0,
        colorHex: patch?.colorHex ?? color,
        isActive: detail.isActive,
        effectiveFrom: detail.effectiveFrom ?? null,
        effectiveTo: detail.effectiveTo ?? null,
      });
    },
    onSuccess: async () => {
      setSavedAt(Date.now());
      await onChanged();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const toggleActive = useMutation({
    mutationFn: () => api.setCommissionGroupActive(detail.id, !detail.isActive),
    onSuccess: async () => {
      toast.success(detail.isActive ? 'توقّفت المجموعة' : 'فُعّلت المجموعة');
      await refreshDetail();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  async function askToggleActive() {
    if (detail.isActive) {
      const ok = await confirm({
        title: 'إيقاف المجموعة؟',
        message: 'لن تُحسب عمولتها على المبيعات الجديدة حتى تُفعّلها مرة أخرى.',
        confirmLabel: 'إيقاف',
        danger: true,
      });
      if (!ok) return;
    }
    toggleActive.mutate();
  }

  async function askDelete() {
    const ok = await confirm({
      title: `حذف «${detail.name}» نهائياً؟`,
      message: 'تُزال المجموعة وكل أصنافها. لا يمكن التراجع.',
      confirmLabel: 'حذف نهائي',
      danger: true,
    });
    if (ok) deleteGroup.mutate();
  }

  function commitName() {
    if (nameError) return;
    if (name.trim() !== detail.name) saveFields.mutate({ name: name.trim() });
  }

  function commitValue() {
    if (valErr) return;
    const n = Number(value) || 0;
    if (n !== detail.commissionValue) saveFields.mutate({ value: n });
  }

  const trees: ScopeTreeCard[] = useMemo(
    () =>
      detail.trees.map(t => ({
        treeSeq: t.treeSeq,
        treeName: t.treeName ?? `شجرة #${t.treeSeq}`,
        count: t.productCount,
        excludedCount: t.excludedCount ?? 0,
        lastSyncedAt: t.lastSyncedAt ?? undefined,
      })),
    [detail.trees],
  );

  const treeSeqs = useMemo(() => new Set(detail.trees.map(t => t.treeSeq)), [detail.trees]);
  const standalone: ScopeStandaloneItem[] = useMemo(
    () =>
      detail.items
        .filter(i => i.sourceTreeSeq == null || !treeSeqs.has(i.sourceTreeSeq))
        .map(i => ({
          id: i.id,
          seq: i.articleId ?? undefined,
          name: i.articleName ?? i.barcode ?? `#${i.id}`,
          barcode: i.barcode ?? undefined,
          price: i.price ?? undefined,
        })),
    [detail.items, treeSeqs],
  );

  const pickerScope = useMemo(() => {
    const seqRowIds = new Map<number, number>();
    for (const i of detail.items) {
      if (i.articleId != null && !seqRowIds.has(i.articleId)) seqRowIds.set(i.articleId, i.id);
    }
    return { treeSeqs, seqRowIds };
  }, [detail.items, treeSeqs]);

  async function commitPicker(ops: ScopePickerOps) {
    for (const seq of ops.removeTreeSeqs) await api.deleteCommissionGroupTree(detail.id, seq);
    for (const rowId of ops.removeRowIds) await api.deleteCommissionGroupItem(detail.id, rowId);
    for (const seq of ops.excludeProductSeqs) await api.setCommissionArticleExcluded(detail.id, seq, true);
    let absorbed = 0;
    for (const t of ops.addTrees) {
      const r = await api.addCommissionGroupTree(detail.id, t.seq, t.name);
      absorbed += r.updated ?? 0;
    }
    for (const p of ops.addProducts) await api.addCommissionGroupProduct(detail.id, { articleId: p.seq, barcode: p.barcode });
    if (absorbed > 0) toast.success(`دُمجت ${formatNum(absorbed)} أصناف كانت مفردة داخل الشجرة`);
    await refreshDetail();
  }

  const totalScope = trees.reduce((n, t) => n + t.count, 0) + standalone.length;
  const totalExcluded = trees.reduce((n, t) => n + (t.excludedCount ?? 0), 0);
  const previewValue = valErr ? detail.commissionValue : Number(value) || 0;

  const saveState = saveFields.isPending ? (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      جاري الحفظ…
    </span>
  ) : savedAt ? (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700">
      <IconCheck size={13} /> حُفظ
    </span>
  ) : (
    <span className="text-[11.5px] text-slate-400">يُحفظ تلقائياً</span>
  );

  return (
    <>
      <FullScreenEditor
        open={open}
        onClose={onClose}
        wide
        title={
          <span className="inline-flex items-center gap-2">
            <ColorDot color={color} size={12} />
            {name.trim() || detail.name}
          </span>
        }
        subtitle={`${commissionLabel(type, previewValue)} ${isPct(type) ? 'من البيع' : 'لكل قطعة'} · ${formatNum(trees.length)} شجرة · ${formatNum(totalScope)} صنف`}
        status={
          <button
            type="button"
            onClick={() => void askToggleActive()}
            disabled={toggleActive.isPending}
            title={detail.isActive ? 'اضغط للإيقاف' : 'اضغط للتفعيل'}
            className="shrink-0 transition hover:opacity-80 disabled:opacity-50"
          >
            <Badge tone={detail.isActive ? 'ok' : 'default'} dot>{detail.isActive ? 'نشطة' : 'متوقفة'}</Badge>
          </button>
        }
        actions={
          <>
            <Btn
              variant="ghost"
              icon={<IconTrash size={15} />}
              className="!text-red-600 hover:!bg-red-50"
              loading={deleteGroup.isPending}
              onClick={() => void askDelete()}
            >
              حذف
            </Btn>
            <Btn variant="secondary" icon={detail.isActive ? <IconPause size={14} /> : <IconPlay size={14} />} loading={toggleActive.isPending} onClick={() => void askToggleActive()}>
              {detail.isActive ? 'إيقاف' : 'تفعيل'}
            </Btn>
            <Btn icon={<IconPlus size={15} />} onClick={() => setPickerOpen(true)}>
              إضافة أصناف
            </Btn>
          </>
        }
      >
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            {totalScope === 0 && (
              <Alert type="warning" title="المجموعة بلا أصناف">
                لن تُحسب أي عمولة حتى تضيف شجرة أو منتجاً — اضغط «إضافة أصناف».
              </Alert>
            )}
            <TreeScopeEditor
              trees={trees}
              standalone={standalone}
              loadTreeProducts={async (seq): Promise<ScopeTreeProduct[]> => {
                const rows = await api.commissionGroupTreeProducts(detail.id, seq);
                return rows.map(r => ({
                  seq: r.articleId,
                  name: r.name ?? `#${r.articleId}`,
                  barcode: r.barcode,
                  price: r.price ?? 0,
                  inScope: r.inGroup,
                  excluded: !!r.excluded,
                  rowId: r.itemId ?? undefined,
                }));
              }}
              loadTreeSize={async seq => (await api.commissionGroupTreeProducts(detail.id, seq)).length}
              onAddTree={async node => {
                const r = await api.addCommissionGroupTree(detail.id, node.seq, node.name);
                if ((r.updated ?? 0) > 0) toast.success(`دُمجت ${formatNum(r.updated ?? 0)} أصناف كانت مفردة داخل الشجرة`);
                await refreshDetail();
              }}
              onAddProduct={async p => {
                const mem = await api.commissionMemberships([p.seq]);
                const others = otherCommissionMemberships(mem[0]?.groups, detail.id);
                if (others.length) {
                  toast.info(`موجود مسبقاً في: ${others.map(g => g.groupName).join('، ')}`);
                }
                await api.addCommissionGroupProduct(detail.id, { articleId: p.seq, barcode: p.barcode });
                await refreshDetail();
              }}
              onRemoveTree={async seq => {
                await api.deleteCommissionGroupTree(detail.id, seq);
                await refreshDetail();
              }}
              onRemoveStandalone={async item => {
                await api.deleteCommissionGroupItem(detail.id, item.id);
                await refreshDetail();
              }}
              onRefreshTree={async seq => (await api.refreshCommissionTree(detail.id, seq)).added}
              onToggleExclude={async (_seq, product) => {
                await api.setCommissionArticleExcluded(detail.id, product.seq, !product.excluded);
                await refreshDetail();
              }}
              labels={{
                scopeTitle: 'منتجات المجموعة',
                emptyHint: 'اضغط «إضافة أصناف» — أشجار كاملة أو منتجات مفردة',
              }}
              hideBrowse
              renderTreeExtra={tree => {
                const targets = allGroups.filter(g => g.id !== detail.id);
                if (!targets.length) return null;
                return (
                  <select
                    defaultValue=""
                    onClick={e => e.stopPropagation()}
                    onChange={async e => {
                      const select = e.currentTarget;
                      const to = Number(select.value);
                      if (!to) return;
                      const ok = await confirm({
                        title: 'نقل الشجرة؟',
                        message: `ستُنقل شجرة «${tree.treeName}» بكل أصنافها إلى «${targets.find(g => g.id === to)?.name}».`,
                        confirmLabel: 'نقل',
                      });
                      if (!ok) {
                        select.value = '';
                        return;
                      }
                      try {
                        await api.moveCommissionGroupTree(detail.id, tree.treeSeq, to);
                        toast.success('نُقلت الشجرة');
                        await refreshDetail();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'تعذر النقل');
                      }
                      select.value = '';
                    }}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand-300"
                    title="نقل الشجرة إلى مجموعة أخرى"
                  >
                    <option value="">نقل إلى…</option>
                    {targets.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                );
              }}
            />
          </div>

          <aside className="space-y-3 lg:sticky lg:top-0">
            <SideSection title="إعداد المجموعة" aside={saveState}>
              <div className="space-y-3">
                <div>
                  <Field label="الاسم">
                    <Input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      onBlur={commitName}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      aria-invalid={!!nameError}
                      className={nameError ? '!border-red-300' : ''}
                    />
                  </Field>
                  {nameError && <p className="mt-1 text-[11.5px] text-red-600">{nameError}</p>}
                </div>
                <div>
                  <Label2>نوع العمولة</Label2>
                  <TypeToggle
                    value={type}
                    onChange={next => {
                      if (next === type) return;
                      setType(next);
                      if (!valueError(next, value)) saveFields.mutate({ type: next });
                    }}
                  />
                </div>
                <div>
                  <Label2>{isPct(type) ? 'النسبة' : 'المبلغ لكل قطعة'}</Label2>
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      max={isPct(type) ? 100 : undefined}
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      onBlur={commitValue}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      aria-invalid={!!valErr}
                      className={`num pe-12 ${valErr ? '!border-red-300' : ''}`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[11.5px] font-semibold text-slate-400">
                      {isPct(type) ? '٪' : 'IQD'}
                    </span>
                  </div>
                  {valErr && <p className="mt-1 text-[11.5px] text-red-600">{valErr}</p>}
                </div>
                <div>
                  <Label2>اللون</Label2>
                  <ColorPicker
                    value={color}
                    onChange={c => {
                      setColor(c);
                      saveFields.mutate({ colorHex: c });
                    }}
                  />
                </div>
              </div>
            </SideSection>

            <SideSection
              title="البائعون"
              aside={<Badge tone={salesmanIds.length ? 'brand' : 'default'}>{salesmanIds.length ? `${formatNum(salesmanIds.length)} محدد` : 'كل البائعين'}</Badge>}
            >
              <SalesmanMultiSelect
                salesmen={salesmen.map(s => ({ id: s.id, name: s.name ?? `#${s.id}` }))}
                selectedIds={salesmanIds}
                onChange={ids => {
                  setSalesmanIds(ids);
                  saveFields.mutate({ salesmanIds: ids });
                }}
                emptyLabel="كل البائعين"
              />
              <p className="mt-2 text-[11.5px] leading-5 text-slate-500">بلا تحديد = العمولة تُحسب لأي بائع يبيع هذه الأصناف.</p>
            </SideSection>

            <SideSection title="ما يحصل عليه البائع">
              <EarningPreview type={type} value={previewValue} />
            </SideSection>

            <div className="card grid grid-cols-3 divide-x divide-x-reverse divide-slate-100 text-center">
              <MiniStat label="أشجار" value={trees.length} />
              <MiniStat label="أصناف" value={totalScope} />
              <MiniStat label="مستبعد" value={totalExcluded} />
            </div>

            <p className="px-1 text-[11.5px] leading-5 text-slate-500">
              شجرة مضافة تدخل كل منتجاتها تلقائياً. استبعاد صنف يُخرجه من العمولة دون حذف الشجرة.
            </p>
          </aside>
        </div>
      </FullScreenEditor>

      <ScopePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="إضافة / إزالة أصناف المجموعة"
        scopeName={name.trim() || detail.name}
        trees={trees}
        standalone={standalone}
        inScope={pickerScope}
        onCommit={commitPicker}
        commissionGroupId={detail.id}
      />
    </>
  );
}

function Label2({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[12px] font-semibold text-slate-600">{children}</p>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2 py-2.5">
      <p className="num text-[15px] font-bold text-header">{formatNum(value)}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

/* ── إنشاء مجموعة ── */

function CreateGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState('fixed');
  const [value, setValue] = useState('1000');
  const [color, setColor] = useState(GROUP_COLORS[0]!);
  const [salesmanIds, setSalesmanIds] = useState<number[]>([]);
  const [showSalesmen, setShowSalesmen] = useState(false);
  const [touched, setTouched] = useState(false);

  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen(), enabled: open });

  useEffect(() => {
    if (open) {
      setName('');
      setType('fixed');
      setValue('1000');
      setColor(GROUP_COLORS[0]!);
      setSalesmanIds([]);
      setShowSalesmen(false);
      setTouched(false);
    }
  }, [open]);

  const nameError = name.trim() ? null : 'اكتب اسماً للمجموعة';
  const valErr = valueError(type, value);

  const create = useMutation({
    mutationFn: () => api.createCommissionGroup({
      name: name.trim(),
      description: null,
      commissionType: type,
      commissionValue: Number(value) || 0,
      colorHex: color,
      ...(salesmanIds.length ? { salesmanId: salesmanIds[0], salesmanIds } : {}),
    }),
    onSuccess: async r => {
      toast.success('أُنشئت المجموعة — أضف أصنافها الآن');
      await onCreated(r.id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإنشاء'),
  });

  function submit() {
    setTouched(true);
    if (nameError || valErr || create.isPending) return;
    create.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="مجموعة عمولة جديدة"
      subtitle="الاسم والعمولة الآن — الأصناف تُضاف بعد الإنشاء"
      icon={<IconCoins size={18} />}
      footer={
        <>
          <span className="text-[11.5px] text-slate-400"><Kbd>Enter</Kbd> للإنشاء</span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn loading={create.isPending} onClick={submit}>إنشاء ومتابعة</Btn>
          </div>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <Field label="اسم المجموعة">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="مثال: عمولة العطور"
              autoFocus
              aria-invalid={touched && !!nameError}
              className={touched && nameError ? '!border-red-300' : ''}
            />
          </Field>
          {touched && nameError && <p className="mt-1 text-[11.5px] text-red-600">{nameError}</p>}
        </div>
        <div>
          <Label2>نوع العمولة</Label2>
          <TypeToggle value={type} onChange={setType} />
        </div>
        <div>
          <Label2>{isPct(type) ? 'النسبة' : 'المبلغ لكل قطعة'}</Label2>
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={isPct(type) ? 100 : undefined}
              value={value}
              onChange={e => setValue(e.target.value)}
              aria-invalid={!!valErr}
              className={`num pe-12 ${valErr ? '!border-red-300' : ''}`}
            />
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[11.5px] font-semibold text-slate-400">
              {isPct(type) ? '٪' : 'IQD'}
            </span>
          </div>
          {valErr ? (
            <p className="mt-1 text-[11.5px] text-red-600">{valErr}</p>
          ) : (
            <p className="mt-1 text-[11.5px] text-slate-500">
              {isPct(type)
                ? `مثال: بيع بقيمة 100,000 IQD ⟵ ${formatNum(Math.round((Number(value) || 0) * 1000))} IQD للبائع`
                : `كل قطعة تُباع ⟵ ${formatNum(Number(value) || 0)} IQD للبائع`}
            </p>
          )}
        </div>
        <div>
          <Label2>اللون (للتمييز في القوائم)</Label2>
          <ColorPicker value={color} onChange={setColor} size={30} />
        </div>
        <div className="rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setShowSalesmen(v => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-right"
          >
            <span>
              <span className="block text-[12.5px] font-semibold text-slate-700">البائعون (اختياري)</span>
              <span className="block text-[11.5px] text-slate-500">
                {salesmanIds.length ? `${formatNum(salesmanIds.length)} بائع محدد` : 'بلا تحديد = كل البائعين'}
              </span>
            </span>
            {showSalesmen ? <IconX size={14} className="text-slate-400" /> : <IconUsers size={15} className="text-slate-400" />}
          </button>
          {showSalesmen && (
            <div className="border-t border-slate-100 p-3">
              <SalesmanMultiSelect
                salesmen={(salesmenQ.data?.items ?? []).map(s => ({ id: s.id, name: s.name ?? `#${s.id}` }))}
                selectedIds={salesmanIds}
                onChange={setSalesmanIds}
                emptyLabel="كل البائعين"
              />
            </div>
          )}
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
