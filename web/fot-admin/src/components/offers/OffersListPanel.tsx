import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDto } from '@/api/types';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import {
  matchesTypeFilter,
  OfferStatusPill,
  OffersEmptyIllustration,
  offerTypeMeta,
  OfferTypeBadge,
  OfferTypeIcon,
  PriorityBadge,
  ProductCountBar,
  StatCard,
  type OfferTypeFilter,
} from '@/components/offers/offerVisuals';
import {
  IconGrid,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconTag,
} from '@/components/icons';
import { Btn, Input, Loading } from '@/components/ui';
import { FilterChip } from '@/components/workspace';

const VIEW_KEY = 'fot_offers_view_v1';

type ViewMode = 'cards' | 'table';

function loadViewMode(): ViewMode {
  try {
    return sessionStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm">
      <button
        type="button"
        title="عرض بطاقات"
        onClick={() => onChange('cards')}
        className={`rounded-lg px-2.5 py-1.5 transition ${
          value === 'cards' ? 'bg-header text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
        }`}
      >
        <IconGrid size={15} />
      </button>
      <button
        type="button"
        title="عرض جدول"
        onClick={() => onChange('table')}
        className={`rounded-lg px-2.5 py-1.5 transition ${
          value === 'table' ? 'bg-header text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
        }`}
      >
        <IconTag size={15} />
      </button>
    </div>
  );
}

function OfferCard({
  offer,
  maxProducts,
  onEdit,
  onToggle,
  toggling,
}: {
  offer: OfferDto;
  maxProducts: number;
  onEdit: () => void;
  onToggle: () => void;
  toggling: boolean;
}) {
  const meta = offerTypeMeta(offer.type);
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 ${meta.glow}`}
    >
      <div className={`h-1.5 bg-gradient-to-l ${meta.stripe}`} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <OfferTypeIcon type={offer.type} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-extrabold text-header">{offer.name}</h3>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                #{offer.id}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] text-slate-500">{meta.label}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50/90 px-3 py-2 ring-1 ring-slate-100">
            <p className="text-[10px] font-semibold text-slate-400">الأصناف</p>
            <ProductCountBar count={offer.activeProductCount} max={maxProducts} />
          </div>
          <div className="rounded-xl bg-slate-50/90 px-3 py-2 ring-1 ring-slate-100">
            <p className="text-[10px] font-semibold text-slate-400">الأولوية</p>
            <div className="mt-1.5">
              <PriorityBadge priority={offer.priority} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <OfferStatusPill enabled={offer.enabled} />
          <div className="flex items-center gap-1.5 opacity-90 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-brand-700"
            >
              تعديل
            </button>
            <button
              type="button"
              disabled={toggling}
              onClick={onToggle}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-bold ring-1 disabled:opacity-50 ${
                offer.enabled
                  ? 'bg-white text-rose-600 ring-rose-200 hover:bg-rose-50'
                  : 'bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50'
              }`}
            >
              {offer.enabled ? 'إيقاف' : 'تفعيل'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function OffersHero({
  loading,
  total,
  active,
  inactive,
  products,
  filtered,
  onCreate,
}: {
  loading: boolean;
  total: number;
  active: number;
  inactive: number;
  products: number;
  filtered: number;
  onCreate: () => void;
}) {
  const fmt = (n: number) => (loading ? '…' : formatNum(n));
  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-800/20 bg-gradient-to-bl from-brand-700 via-brand-800 to-slate-900 px-5 py-5 text-white shadow-[0_20px_50px_rgba(11,125,93,0.28)] sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-emerald-400/15 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold ring-1 ring-white/15">
            <IconSparkle size={13} />
            إدارة العروض والخصومات
          </div>
          <h1 className="text-[22px] font-extrabold leading-8 sm:text-[26px]">العروض الترويجية</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-white/75">
            أنشئ عروض الخصم والمجموعات والأسعار الفردية، ثم ارفعها لنقاط البيع بنقرة واحدة من شريط الأدوات العلوي.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-extrabold text-brand-800 shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-50"
        >
          <IconPlus size={16} />
          عرض جديد
        </button>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
        <StatCard label="إجمالي العروض" value={fmt(total)} accent />
        <StatCard label="نشطة الآن" value={fmt(active)} hint="تُطبَّق على الكاشير" accent />
        <StatCard label="متوقفة" value={fmt(inactive)} accent />
        <StatCard
          label="أصناف مشمولة"
          value={fmt(products)}
          hint={!loading && filtered !== total ? `${formatNum(filtered)} معروضة بالفلتر` : 'في كل العروض النشطة'}
          accent
        />
      </div>
    </section>
  );
}

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
}: {
  items: OfferDto[];
  offers: OfferDto[];
  search: string;
  setSearch: (v: string) => void;
  statusFilter: 'all' | 'active' | 'off';
  setStatusFilter: (v: 'all' | 'active' | 'off') => void;
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
}) {
  const [view, setView] = useState<ViewMode>(loadViewMode);

  const statsQ = useQuery({
    queryKey: ['offers-stats'],
    queryFn: api.offersStats,
    staleTime: 60_000,
  });

  const activeCount = items.filter(o => o.enabled).length;
  const maxProducts = useMemo(
    () => Math.max(1, ...offers.map(o => o.activeProductCount)),
    [offers],
  );

  const typeCounts = useMemo(() => {
    const base = items.filter(o =>
      statusFilter === 'all' ? true : statusFilter === 'active' ? o.enabled : !o.enabled,
    );
    return {
      all: base.length,
      percent: base.filter(o => matchesTypeFilter(o, 'percent')).length,
      bundle: base.filter(o => matchesTypeFilter(o, 'bundle')).length,
      priced: base.filter(o => matchesTypeFilter(o, 'priced')).length,
    };
  }, [items, statusFilter]);

  function changeView(next: ViewMode) {
    setView(next);
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch { /* ignore */ }
  }

  const columns: GridColumn<OfferDto>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'العرض',
        width: 280,
        render: o => (
          <div className="flex items-center gap-2.5 py-0.5">
            <OfferTypeIcon type={o.type} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-extrabold text-header">{o.name}</p>
              <p className="font-mono text-[10px] text-slate-400">#{o.id}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'النوع',
        width: 150,
        render: o => <OfferTypeBadge type={o.type} />,
      },
      {
        key: 'activeProductCount',
        header: 'الأصناف',
        width: 130,
        align: 'center',
        sortValue: o => o.activeProductCount,
        render: o => <ProductCountBar count={o.activeProductCount} max={maxProducts} />,
      },
      {
        key: 'priority',
        header: 'الأولوية',
        width: 120,
        align: 'center',
        sortValue: o => o.priority,
        render: o => <PriorityBadge priority={o.priority} />,
      },
      {
        key: 'enabled',
        header: 'الحالة',
        width: 160,
        align: 'center',
        render: o => <OfferStatusPill enabled={o.enabled} />,
      },
      {
        key: 'actions',
        header: '',
        width: 150,
        align: 'center',
        sortable: false,
        exportable: false,
        render: o => (
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-brand-700"
              onClick={e => {
                e.stopPropagation();
                onEdit(o.id);
              }}
            >
              تعديل
            </button>
            <button
              type="button"
              disabled={toggling}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 disabled:opacity-50 ${
                o.enabled ? 'text-rose-600 ring-rose-200 hover:bg-rose-50' : 'text-emerald-700 ring-emerald-200 hover:bg-emerald-50'
              }`}
              onClick={e => {
                e.stopPropagation();
                onToggle(o);
              }}
            >
              {o.enabled ? 'إيقاف' : 'تفعيل'}
            </button>
          </div>
        ),
      },
    ],
    [maxProducts, onEdit, onToggle, toggling],
  );

  const statsLoading = loading || statsQ.isLoading;
  const stats = statsQ.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error && (
        <div className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-800">
          تعذّر تحميل العروض
          <Btn size="sm" variant="secondary" onClick={onRefresh}>إعادة المحاولة</Btn>
        </div>
      )}

      <OffersHero
        loading={statsLoading}
        total={stats?.total ?? items.length}
        active={stats?.enabled ?? activeCount}
        inactive={stats?.disabled ?? items.length - activeCount}
        products={stats?.discountedItems ?? items.reduce((s, o) => s + o.activeProductCount, 0)}
        filtered={offers.length}
        onCreate={onCreate}
      />

      <ClassicListShell
        filters={
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <FilterField label="بحث سريع" className="min-w-[240px] flex-1">
                <div className="relative">
                  <IconSearch size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="اسم العرض أو الرقم…"
                    className="!py-2.5 !ps-9 !text-[14px] font-semibold"
                  />
                </div>
              </FilterField>
              <div className="flex items-center gap-2">
                <ViewToggle value={view} onChange={changeView} />
                <Btn variant="secondary" size="sm" onClick={onRefresh} title="تحديث">
                  <IconRefresh size={14} className={fetching ? 'animate-spin' : ''} />
                </Btn>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-bold text-slate-400">الحالة</span>
              <FilterChip compact active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                الكل ({formatNum(typeCounts.all)})
              </FilterChip>
              <FilterChip compact active={statusFilter === 'active'} tone="brand" onClick={() => setStatusFilter('active')}>
                نشطة ({formatNum(items.filter(o => o.enabled).length)})
              </FilterChip>
              <FilterChip compact active={statusFilter === 'off'} onClick={() => setStatusFilter('off')}>
                متوقفة ({formatNum(items.filter(o => !o.enabled).length)})
              </FilterChip>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2">
              <span className="text-[10.5px] font-bold text-slate-400">نوع العرض</span>
              {(
                [
                  ['all', 'الكل', typeCounts.all],
                  ['percent', 'خصم %', typeCounts.percent],
                  ['bundle', 'مجموعة', typeCounts.bundle],
                  ['priced', 'أسعار فردية', typeCounts.priced],
                ] as const
              ).map(([id, label, count]) => (
                <FilterChip
                  key={id}
                  compact
                  active={typeFilter === id}
                  onClick={() => setTypeFilter(id)}
                >
                  {label} ({formatNum(count)})
                </FilterChip>
              ))}
            </div>
          </div>
        }
        header={{
          title: view === 'cards' ? 'بطاقات العروض' : 'جدول العروض',
          hint: 'انقر مرتين أو Enter للتعديل · اسحب أعمدة الجدول لتغيير العرض',
          actions: (
            <Btn size="sm" onClick={onCreate}>
              <IconPlus size={14} />
              جديد
            </Btn>
          ),
        }}
        onRefresh={onRefresh}
        refreshing={fetching}
        footer={
          <ClassicSummaryFooter
            title="ملخص العروض"
            total={items.length}
            totalLabel="عروض مسجّلة"
            loading={statsLoading}
            items={[
              { label: 'نشطة', value: formatNum(stats?.enabled ?? activeCount), accent: true },
              { label: 'متوقفة', value: formatNum(stats?.disabled ?? items.length - activeCount) },
              { label: 'معروض', value: formatNum(offers.length) },
              {
                label: 'أصناف مشمولة',
                value: formatNum(stats?.discountedItems ?? items.reduce((s, o) => s + o.activeProductCount, 0)),
              },
            ]}
          />
        }
      >
        {loading && (
          <div className="flex min-h-[320px] items-center justify-center">
            <Loading />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
            <OffersEmptyIllustration />
            <h2 className="text-[18px] font-extrabold text-header">ابدأ أول عرض ترويجي</h2>
            <p className="mt-2 max-w-md text-[13px] leading-6 text-slate-500">
              أنشئ عرض خصم أو مجموعة مطلوبة أو أسعاراً فردية، ثم أضف الأشجار والمنتجات من محرر العرض.
            </p>
            <Btn className="mt-6" onClick={onCreate}>
              <IconPlus size={15} />
              إنشاء عرض جديد
            </Btn>
          </div>
        )}

        {!loading && items.length > 0 && offers.length === 0 && (
          <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[15px] font-bold text-header">لا نتائج لهذا الفلتر</p>
            <p className="mt-1 text-[12px] text-slate-500">جرّب تغيير البحث أو نوع العرض أو الحالة</p>
          </div>
        )}

        {!loading && offers.length > 0 && view === 'cards' && (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {offers.map(o => (
              <div
                key={o.id}
                role="button"
                tabIndex={0}
                className="cursor-pointer outline-none"
                onDoubleClick={() => onEdit(o.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onEdit(o.id);
                }}
              >
                <OfferCard
                  offer={o}
                  maxProducts={maxProducts}
                  onEdit={() => onEdit(o.id)}
                  onToggle={() => onToggle(o)}
                  toggling={toggling}
                />
              </div>
            ))}
          </div>
        )}

        {!loading && offers.length > 0 && view === 'table' && (
          <DataGrid
            embedded
            fillHeight
            columns={columns}
            rows={offers}
            getRowId={o => o.id}
            exportName="العروض"
            counterLabel="عرض"
            emptyText="لا نتائج لهذا الفلتر"
            onRowDoubleClick={o => onEdit(o.id)}
            onEnter={o => onEdit(o.id)}
          />
        )}
      </ClassicListShell>
    </div>
  );
}
