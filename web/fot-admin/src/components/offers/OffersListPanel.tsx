import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDto } from '@/api/types';
import { DataGrid, type GridColumn, type GridSort } from '@/components/grid/DataGrid';
import {
  daysLeft,
  EXPIRING_SOON_DAYS,
  matchesTypeFilter,
  offerLiveState,
  OfferStatusPill,
  offerTypeMeta,
  OfferTypeBadge,
  OfferTypeIcon,
  periodText,
  PriorityBadge,
  priorityLabel,
  type OfferLiveState,
  type OfferPeriod,
  type OfferTypeFilter,
} from '@/components/offers/offerVisuals';
import {
  IconCalendar,
  IconCopy,
  IconFolderClosed,
  IconGrid,
  IconLayers,
  IconPackage,
  IconPercent,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from '@/components/icons';
import { Alert, Btn, EmptyState, IconButton, Input, Kbd, Select, Skeleton, TableSkeleton } from '@/components/ui';
import { OfferFoldersSidebar, type OfferFolderFilter } from '@/components/offers/OfferFoldersSidebar';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceCard,
  WorkspacePage,
} from '@/components/listWorkspace';

const VIEW_KEY = 'fot_offers_view_v2';
const SORT_KEY = 'fot_offers_sort_v1';
const FOLDERS_COLLAPSED_KEY = 'fot_offers_folders_collapsed';

type ViewMode = 'cards' | 'table';
type SortMode = 'recent' | 'name' | 'priority' | 'products' | 'ending';

export type OfferStatusFilter = 'all' | 'active' | 'expiring' | 'expired' | 'off';

/** مطابقة فلتر الحالة مع مراعاة فترة العرض إن كانت معروفة. */
export function matchesStatusFilter(o: OfferDto, filter: OfferStatusFilter, period?: OfferPeriod | null) {
  if (filter === 'all') return true;
  const state = offerLiveState(o.enabled, period);
  if (filter === 'off') return state === 'off';
  if (filter === 'expired') return state === 'expired';
  if (filter === 'expiring') return state === 'expiring';
  return state === 'active' || state === 'expiring';
}

function readStore<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = sessionStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch { /* ignore */ }
}

function readLocalFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeLocalFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch { /* ignore */ }
}

const STATE_TONE: Partial<Record<OfferLiveState, string>> = {
  off: 'bg-slate-50/90 text-slate-500',
  expired: 'bg-red-50/50',
  expiring: 'bg-amber-50/50',
};

/* ── عناصر تحكم صغيرة ── */

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="طريقة العرض">
      {([
        ['table', 'جدول', <IconLayers key="t" size={15} />],
        ['cards', 'بطاقات', <IconGrid key="g" size={15} />],
      ] as const).map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          title={`عرض ${label}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`inline-flex h-full items-center gap-1 rounded-md px-2 text-[12px] font-semibold transition ${
            value === id ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-header'
          }`}
        >
          {icon}
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function MetaLine({ icon, children, muted }: { icon: ReactNode; children: ReactNode; muted?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 text-[12px] ${muted ? 'text-slate-400' : 'text-slate-600'}`}>
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/* ── بطاقة العرض (عرض البطاقات الاختياري) ── */

function OfferCard({
  offer,
  period,
  periodLoading,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
  busy,
}: {
  offer: OfferDto;
  period?: OfferPeriod;
  periodLoading: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  busy: boolean;
}) {
  const meta = offerTypeMeta(offer.type);
  const left = daysLeft(period);
  const state = offerLiveState(offer.enabled, period);
  return (
    <article
      tabIndex={0}
      onDoubleClick={onEdit}
      onKeyDown={e => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onEdit();
      }}
      className={`card group flex flex-col p-3.5 outline-none transition hover:border-brand-200 focus-visible:ring-2 focus-visible:ring-brand-500/30 ${
        offer.enabled ? '' : 'bg-slate-50/60'
      }`}
      aria-label={offer.name}
    >
      <div className="flex items-start gap-3">
        <OfferTypeIcon type={offer.type} size="md" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onEdit}
            className="block max-w-full truncate text-right text-[14px] font-bold text-header hover:text-brand-700"
            title={offer.name}
          >
            {offer.name}
          </button>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            {meta.label} <span className="num text-slate-400">· #{offer.id}</span>
          </p>
        </div>
        {periodLoading && !period ? <Skeleton className="h-5 w-14 rounded-full" /> : <OfferStatusPill enabled={offer.enabled} period={period} />}
      </div>

      <div className="mt-3 space-y-1.5">
        <MetaLine icon={<IconCalendar size={14} />} muted={!period}>
          {period ? (
            <>
              {periodText(period)}
              {left != null && left >= 0 && state !== 'off' && (
                <span className={`ms-1.5 ${left <= EXPIRING_SOON_DAYS ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
                  ({left === 0 ? 'آخر يوم' : `متبقٍ ${formatNum(left)} يوم`})
                </span>
              )}
            </>
          ) : periodLoading ? 'جارٍ قراءة الفترة…' : '—'}
        </MetaLine>
        <MetaLine icon={<IconPackage size={14} />}>
          <span className="num font-semibold text-header">{formatNum(offer.activeProductCount)}</span> صنف مشمول
          {offer.detailCount > 0 && <span className="text-slate-400"> · {formatNum(offer.detailCount)} سطر</span>}
        </MetaLine>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <PriorityBadge priority={offer.priority} />
          {offer.folderName && (
            <span className="inline-flex max-w-[160px] items-center gap-1 truncate text-[11.5px] text-slate-500">
              <IconFolderClosed size={12} className="shrink-0 text-slate-400" />
              <span className="truncate">{offer.folderName}</span>
            </span>
          )}
        </div>
      </div>

      <div className="min-h-3 flex-1" />
      <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2.5" onDoubleClick={e => e.stopPropagation()}>
        <Btn size="sm" variant="soft" icon={<IconPencil size={13} />} onClick={onEdit}>
          تعديل
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onToggle}
          className={offer.enabled ? 'text-slate-600' : 'text-emerald-700'}
        >
          {offer.enabled ? 'إيقاف' : 'تفعيل'}
        </Btn>
        <div className="flex-1" />
        {onDuplicate && (
          <IconButton label="نسخ العرض" className="!h-8 !w-8" disabled={busy} onClick={onDuplicate}>
            <IconCopy size={14} />
          </IconButton>
        )}
        {onDelete && (
          <IconButton label="حذف العرض" className="!h-8 !w-8 hover:!border-red-200 hover:!bg-red-50 hover:!text-red-600" disabled={busy} onClick={onDelete}>
            <IconTrash size={14} />
          </IconButton>
        )}
      </div>
    </article>
  );
}

/* ── اللوحة الرئيسية: مساحة عمل بعرض وارتفاع كاملين ── */

export function OffersListPanel({
  items,
  offers,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  loading,
  fetching,
  error,
  onRefresh,
  onCreate,
  onEdit,
  onToggle,
  toggling,
  folderFilter,
  onFolderFilterChange,
  periods,
  periodsLoading = false,
  onDuplicate,
  onDelete,
  busyIds,
}: {
  items: OfferDto[];
  offers: OfferDto[];
  search: string;
  setSearch: (v: string) => void;
  statusFilter: OfferStatusFilter;
  setStatusFilter: (v: OfferStatusFilter) => void;
  typeFilter: OfferTypeFilter;
  setTypeFilter: (v: OfferTypeFilter) => void;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (id: number) => void;
  onToggle: (offer: OfferDto) => void;
  toggling: boolean;
  folderFilter: OfferFolderFilter;
  onFolderFilterChange: (v: OfferFolderFilter) => void;
  periods?: Map<number, OfferPeriod>;
  periodsLoading?: boolean;
  onDuplicate?: (offer: OfferDto) => void;
  onDelete?: (offer: OfferDto) => void;
  /** العروض الجاري تنفيذ إجراء عليها (نسخ/حذف). */
  busyIds?: ReadonlySet<number>;
}) {
  const [view, setView] = useState<ViewMode>(() => readStore(VIEW_KEY, ['cards', 'table'] as const, 'table'));
  const [sort, setSort] = useState<SortMode>(() =>
    readStore(SORT_KEY, ['recent', 'name', 'priority', 'products', 'ending'] as const, 'recent'));
  // فرز رأس الجدول محكوم من اللوحة — تغيير قائمة «الترتيب» يلغيه حتى لا يطغى عليها فرز محفوظ
  const [gridSort, setGridSort] = useState<GridSort | null>(null);
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => readLocalFlag(FOLDERS_COLLAPSED_KEY));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const statsQ = useQuery({
    queryKey: ['offers-stats'],
    queryFn: api.offersStats,
    staleTime: 60_000,
  });
  const foldersQ = useQuery({
    queryKey: ['offer-folders'],
    queryFn: () => api.offerFolders(),
    staleTime: 30_000,
  });

  // «/» يركّز البحث
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== '/' && e.code !== 'Slash') || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const periodOf = (o: OfferDto) => periods?.get(o.id);

  const statusCounts = useMemo(() => {
    const base = items.filter(o => matchesTypeFilter(o, typeFilter));
    const count = (f: OfferStatusFilter) => base.filter(o => matchesStatusFilter(o, f, periods?.get(o.id))).length;
    return { all: base.length, active: count('active'), expiring: count('expiring'), expired: count('expired'), off: count('off') };
  }, [items, typeFilter, periods]);

  const typeCounts = useMemo(() => {
    const base = items.filter(o => matchesStatusFilter(o, statusFilter, periods?.get(o.id)));
    return {
      all: base.length,
      percent: base.filter(o => matchesTypeFilter(o, 'percent')).length,
      bundle: base.filter(o => matchesTypeFilter(o, 'bundle')).length,
      priced: base.filter(o => matchesTypeFilter(o, 'priced')).length,
    };
  }, [items, statusFilter, periods]);

  const kpi = useMemo(() => {
    let active = 0;
    let expiring = 0;
    let expired = 0;
    let off = 0;
    for (const o of items) {
      const st = offerLiveState(o.enabled, periods?.get(o.id));
      if (st === 'off') off++;
      else if (st === 'expired') expired++;
      else if (st !== 'scheduled') active++;
      if (st === 'expiring') expiring++;
    }
    return { active, expiring, expired, off };
  }, [items, periods]);

  const sorted = useMemo(() => {
    const list = [...offers];
    const byName = (a: OfferDto, b: OfferDto) => a.name.localeCompare(b.name, 'ar');
    switch (sort) {
      case 'name':
        return list.sort(byName);
      case 'priority':
        return list.sort((a, b) => b.priority - a.priority || byName(a, b));
      case 'products':
        return list.sort((a, b) => b.activeProductCount - a.activeProductCount || byName(a, b));
      case 'ending': {
        const key = (o: OfferDto) => {
          const d = daysLeft(periods?.get(o.id));
          return d == null ? Number.MAX_SAFE_INTEGER : d < 0 ? Number.MAX_SAFE_INTEGER - 1 : d;
        };
        return list.sort((a, b) => key(a) - key(b) || byName(a, b));
      }
      default:
        return list.sort((a, b) => b.id - a.id);
    }
  }, [offers, sort, periods]);

  function changeView(next: ViewMode) {
    setView(next);
    writeStore(VIEW_KEY, next);
  }

  function changeSort(next: SortMode) {
    setSort(next);
    setGridSort(null);
    writeStore(SORT_KEY, next);
  }

  function toggleFolders() {
    setFoldersCollapsed(c => {
      writeLocalFlag(FOLDERS_COLLAPSED_KEY, !c);
      return !c;
    });
  }

  const filtered = search.trim() !== '' || statusFilter !== 'all' || typeFilter !== 'all' || folderFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
    onFolderFilterChange('all');
  }

  const columns: GridColumn<OfferDto>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'العرض',
        width: 280,
        filterValue: o => `${o.name} ${o.id}`,
        sortValue: o => o.name,
        render: o => {
          const meta = offerTypeMeta(o.type);
          const Icon = meta.Icon;
          return (
            <div className="flex min-w-0 items-center gap-2" title={o.name}>
              <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${meta.iconBg}`}>
                <Icon size={12} />
              </span>
              <span className="min-w-0 truncate font-semibold text-header">{o.name}</span>
              <span className="num shrink-0 text-[11px] text-slate-400">#{o.id}</span>
            </div>
          );
        },
      },
      {
        key: 'type',
        header: 'النوع',
        width: 130,
        sortValue: o => o.type,
        filterValue: o => offerTypeMeta(o.type).label,
        render: o => <OfferTypeBadge type={o.type} />,
      },
      {
        key: 'enabled',
        header: 'الحالة',
        width: 150,
        sortValue: o => {
          const st = offerLiveState(o.enabled, periods?.get(o.id));
          return st === 'active' ? 4 : st === 'expiring' ? 3 : st === 'scheduled' ? 2 : st === 'expired' ? 1 : 0;
        },
        filterValue: o => {
          const st = offerLiveState(o.enabled, periods?.get(o.id));
          return st === 'off' ? 'متوقف' : st === 'expired' ? 'منتهي' : st === 'scheduled' ? 'مجدول' : st === 'expiring' ? 'ينتهي قريباً' : 'نشط';
        },
        // نفس نص شارة الحالة (OfferStatusPill)
        exportValue: o => {
          const p = periods?.get(o.id);
          const st = offerLiveState(o.enabled, p);
          if (st === 'expiring') {
            const left = daysLeft(p);
            return left === 0 ? 'ينتهي اليوم' : `ينتهي خلال ${formatNum(left ?? 0)} يوم`;
          }
          return st === 'off' ? 'متوقف' : st === 'expired' ? 'منتهي' : st === 'scheduled' ? 'مجدول' : 'نشط';
        },
        render: o => (periodsLoading && !periods?.get(o.id)
          ? <Skeleton className="h-4 w-14 rounded-full" />
          : <OfferStatusPill enabled={o.enabled} period={periods?.get(o.id)} />),
      },
      {
        key: 'period',
        header: 'الفترة',
        width: 220,
        sortValue: o => daysLeft(periods?.get(o.id)) ?? Number.MAX_SAFE_INTEGER,
        filterValue: o => periodText(periods?.get(o.id)),
        exportValue: o => {
          const p = periods?.get(o.id);
          if (p?.unlimited) return 'دائم';
          const left = daysLeft(p);
          const suffix = left != null && left >= 0 && o.enabled ? ` (${left === 0 ? 'آخر يوم' : `${formatNum(left)} يوم`})` : '';
          return `${periodText(p)}${suffix}`;
        },
        render: o => {
          const p = periods?.get(o.id);
          const left = daysLeft(p);
          return (
            <span className="text-[12px] text-slate-600">
              {periodText(p)}
              {left != null && left >= 0 && o.enabled && (
                <span className={`ms-1.5 num ${left <= EXPIRING_SOON_DAYS ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
                  ({left === 0 ? 'آخر يوم' : `${formatNum(left)} يوم`})
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: 'activeProductCount',
        header: 'الأصناف',
        width: 90,
        align: 'center',
        mono: true,
        footer: 'sum',
        sortValue: o => o.activeProductCount,
        render: o => <span className="num font-semibold text-header">{formatNum(o.activeProductCount)}</span>,
      },
      {
        key: 'priority',
        header: 'الأولوية',
        width: 120,
        align: 'center',
        sortValue: o => o.priority,
        exportValue: o => `${priorityLabel(o.priority)} · ${o.priority}`,
        render: o => <PriorityBadge priority={o.priority} />,
      },
      {
        key: 'folderName',
        header: 'المجلد',
        width: 140,
        filterValue: o => o.folderName ?? '',
        render: o => <span className="block truncate text-[12px] text-slate-500" title={o.folderName ?? undefined}>{o.folderName ?? '—'}</span>,
      },
      {
        key: 'actions',
        header: 'إجراءات',
        width: 196,
        align: 'center',
        pinned: 'end',
        sortable: false,
        exportable: false,
        render: o => {
          const busy = !!busyIds?.has(o.id);
          return (
            <div className="flex items-center justify-center gap-1" onDoubleClick={e => e.stopPropagation()}>
              <Btn size="xs" variant="soft" icon={<IconPencil size={12} />} onClick={e => { e.stopPropagation(); onEdit(o.id); }}>
                تعديل
              </Btn>
              <Btn
                size="xs"
                variant="ghost"
                disabled={toggling || busy}
                className={o.enabled ? '' : 'text-emerald-700'}
                onClick={e => { e.stopPropagation(); onToggle(o); }}
              >
                {o.enabled ? 'إيقاف' : 'تفعيل'}
              </Btn>
              {onDuplicate && (
                <IconButton
                  label="نسخ العرض"
                  className="!h-7 !w-7"
                  disabled={busy}
                  onClick={e => { e.stopPropagation(); onDuplicate(o); }}
                >
                  <IconCopy size={13} />
                </IconButton>
              )}
              {onDelete && (
                <IconButton
                  label="حذف العرض"
                  className="!h-7 !w-7 hover:!bg-red-50 hover:!text-red-600"
                  disabled={busy}
                  onClick={e => { e.stopPropagation(); onDelete(o); }}
                >
                  <IconTrash size={13} />
                </IconButton>
              )}
            </div>
          );
        },
      },
    ],
    [periods, periodsLoading, onEdit, onToggle, toggling, onDuplicate, onDelete, busyIds],
  );

  const stats = statsQ.data;
  const total = stats?.total ?? items.length;
  const discountedItems = stats?.discountedItems ?? items.reduce((s, o) => s + o.activeProductCount, 0);
  const periodsPending = periodsLoading && !periods?.size;
  const folders = foldersQ.data ?? [];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        {/* ── الفلاتر ── */}
        <FilterBar
          footer={
            <>
              <SegmentedFilter<OfferStatusFilter>
                label="الحالة"
                value={statusFilter}
                onChange={setStatusFilter}
                items={[
                  { id: 'all' as const, label: 'كل الحالات', count: statusCounts.all },
                  { id: 'active' as const, label: 'نشطة', count: statusCounts.active },
                  ...(statusCounts.expiring > 0 || statusFilter === 'expiring'
                    ? [{ id: 'expiring' as const, label: 'تنتهي قريباً', count: statusCounts.expiring, tone: 'warn' as const }]
                    : []),
                  ...(statusCounts.expired > 0 || statusFilter === 'expired'
                    ? [{ id: 'expired' as const, label: 'منتهية', count: statusCounts.expired, tone: 'danger' as const }]
                    : []),
                  { id: 'off' as const, label: 'متوقفة', count: statusCounts.off },
                ]}
              />
              <SegmentedFilter<OfferTypeFilter>
                label="نوع العرض"
                value={typeFilter}
                onChange={setTypeFilter}
                items={[
                  { id: 'all', label: 'كل الأنواع', count: typeCounts.all },
                  { id: 'percent', label: 'خصم %', count: typeCounts.percent },
                  { id: 'bundle', label: 'مشروط', count: typeCounts.bundle },
                  { id: 'priced', label: 'أسعار فردية', count: typeCounts.priced },
                ]}
              />
              {filtered && (
                <button type="button" onClick={clearFilters} className="text-[12px] font-semibold text-brand-700 hover:underline">
                  مسح الفلاتر
                </button>
              )}
              <span className="ms-auto hidden text-[11px] text-slate-400 xl:inline">
                نقرة مزدوجة أو Enter على الصف لفتح المحرر · ↑↓ للتنقل
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
                placeholder="اسم العرض أو رقمه أو المجلد…"
                className="!ps-9 !pe-9"
                aria-label="بحث في العروض"
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
          {/* المجلد: يظهر دائماً تحت lg، وفوقها فقط إن كان عمود المجلدات مطوياً */}
          <FilterLabel label="المجلد" className={foldersCollapsed ? '' : 'lg:hidden'}>
            <Select
              aria-label="المجلد"
              value={String(folderFilter)}
              onChange={e => {
                const v = e.target.value;
                onFolderFilterChange(v === 'all' || v === 'ungrouped' ? v : Number(v));
              }}
            >
              <option value="all">كل المجلدات</option>
              <option value="ungrouped">بدون مجلد</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </FilterLabel>
          <FilterLabel label="الترتيب">
            <Select
              value={gridSort && view === 'table' ? '__grid' : sort}
              onChange={e => {
                if (e.target.value !== '__grid') changeSort(e.target.value as SortMode);
              }}
              aria-label="ترتيب"
            >
              {gridSort && view === 'table' && <option value="__grid" disabled>حسب عمود الجدول</option>}
              <option value="recent">الأحدث أولاً</option>
              <option value="name">الاسم</option>
              <option value="priority">الأولوية</option>
              <option value="products">عدد الأصناف</option>
              <option value="ending">الأقرب انتهاءً</option>
            </Select>
          </FilterLabel>
          <FilterActions>
            <ViewToggle value={view} onChange={changeView} />
            <IconButton label="تحديث" onClick={onRefresh}>
              <IconRefresh size={15} className={fetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn icon={<IconPlus size={15} />} onClick={onCreate}>
              عرض جديد
            </Btn>
          </FilterActions>
        </FilterBar>

        {/* ── شريط المجاميع — النقر يطبّق فلتر الحالة ── */}
        <SummaryStrip
          loading={loading}
          cells={[
            {
              label: 'كل العروض',
              value: formatNum(total),
              tone: 'brand',
              onClick: () => setStatusFilter('all'),
              active: statusFilter === 'all',
            },
            {
              label: 'نشطة الآن',
              value: formatNum(kpi.active),
              hint: 'تُطبَّق على نقاط البيع',
              tone: 'ok',
              onClick: () => setStatusFilter('active'),
              active: statusFilter === 'active',
            },
            {
              label: 'تنتهي قريباً',
              value: periodsPending ? '…' : formatNum(kpi.expiring),
              hint: `خلال ${formatNum(EXPIRING_SOON_DAYS)} أيام`,
              tone: kpi.expiring > 0 ? 'warn' : undefined,
              onClick: () => setStatusFilter('expiring'),
              active: statusFilter === 'expiring',
            },
            {
              label: 'منتهية',
              value: periodsPending ? '…' : formatNum(kpi.expired),
              hint: kpi.expired > 0 ? 'مفعّلة لكن انتهت فترتها' : undefined,
              tone: kpi.expired > 0 ? 'danger' : undefined,
              onClick: () => setStatusFilter('expired'),
              active: statusFilter === 'expired',
            },
            {
              label: 'متوقفة',
              value: formatNum(kpi.off),
              hint: 'لا تُرسل للكاشير',
              onClick: () => setStatusFilter('off'),
              active: statusFilter === 'off',
            },
            {
              label: 'أصناف مشمولة',
              value: statsQ.isLoading ? '…' : formatNum(discountedItems),
              hint: 'في العروض النشطة',
            },
          ]}
        />

        {error && (
          <div className="shrink-0 p-2">
            <Alert title="تعذّر تحميل العروض">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>تحقق من الاتصال بالخادم ثم أعد المحاولة.</span>
                <Btn size="xs" variant="secondary" icon={<IconRefresh size={13} />} onClick={onRefresh}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}

        {/* ── المجلدات + الجدول ── */}
        <div className="flex min-h-0 flex-1">
          <OfferFoldersSidebar
            offers={items}
            value={folderFilter}
            onChange={onFolderFilterChange}
            collapsed={foldersCollapsed}
            onToggleCollapsed={toggleFolders}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {loading ? (
              <TableSkeleton rows={10} cols={7} />
            ) : !error && items.length === 0 ? (
              <EmptyState
                icon={<IconPercent size={24} />}
                title="لا توجد عروض بعد"
                description="أنشئ عرض خصم بنسبة، أو عرضاً مشروطاً، أو أسعاراً فردية — ثم أضف الأشجار والمنتجات من محرر العرض."
                action={<Btn icon={<IconPlus size={15} />} onClick={onCreate}>إنشاء أول عرض</Btn>}
              />
            ) : items.length > 0 && sorted.length === 0 ? (
              <EmptyState
                compact
                icon={<IconSearch size={18} />}
                title="لا عروض تطابق الفلاتر الحالية"
                description="جرّب تغيير البحث أو الحالة أو النوع أو المجلد."
                action={filtered ? <Btn size="sm" variant="secondary" onClick={clearFilters}>مسح الفلاتر</Btn> : undefined}
              />
            ) : sorted.length === 0 ? null : view === 'cards' ? (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {sorted.map(o => (
                    <OfferCard
                      key={o.id}
                      offer={o}
                      period={periodOf(o)}
                      periodLoading={periodsLoading}
                      onEdit={() => onEdit(o.id)}
                      onToggle={() => onToggle(o)}
                      onDuplicate={onDuplicate ? () => onDuplicate(o) : undefined}
                      onDelete={onDelete ? () => onDelete(o) : undefined}
                      busy={toggling || !!busyIds?.has(o.id)}
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
                rows={sorted}
                getRowId={o => o.id}
                exportName="العروض"
                counterLabel="عرض"
                badge={filtered ? (
                  <span className="text-[11px] text-slate-400">من أصل <span className="num">{formatNum(items.length)}</span></span>
                ) : undefined}
                emptyText="لا عروض تطابق فلتر الأعمدة"
                storageKey="offers-list-v2"
                sort={gridSort}
                onSortChange={setGridSort}
                rowTone={o => STATE_TONE[offerLiveState(o.enabled, periods?.get(o.id))]}
                selectedId={selectedId ?? undefined}
                onSelect={o => setSelectedId(o.id)}
                onRowDoubleClick={o => onEdit(o.id)}
                onEnter={o => onEdit(o.id)}
              />
            )}
          </div>
        </div>
      </WorkspaceCard>
    </WorkspacePage>
  );
}
