import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatNum, monthStartIso, todayIso } from '@/api/client';
import type { SalesmanDto } from '@/api/types';
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
import { SalesmenReportsPanel } from '@/components/SalesmenReportsPanel';
import { useToast } from '@/components/Toast';
import {
  IconChart,
  IconCoins,
  IconCopy,
  IconReceipt,
  IconRefresh,
  IconTarget,
  IconUsers,
} from '@/components/icons';
import { Badge, Btn, EmptyState, IconButton, Input, Select, TableSkeleton, Tabs } from '@/components/ui';
import { DatePresets } from '@/components/DatePresets';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import {
  ErrorBlock,
  IconKey,
  RowIconButton,
  RowMenu,
  SearchBox,
  useCopy,
} from '@/components/people/PeopleKit';

const SEARCH_KEY = 'fot_admin_salesmen';
const TAB_KEY = 'fot_admin_salesmen_tab';
const SORT_KEY = 'fot_admin_salesmen_sort';

type PageTab = 0 | 1;
type Scope = 'edari' | 'active' | 'archive';

function loadTab(): PageTab {
  try {
    const n = Number(sessionStorage.getItem(TAB_KEY));
    if (n === 0 || n === 1) return n;
  } catch { /* تجاهل */ }
  return 0;
}

function loadSort(): GridSort | null {
  try {
    return JSON.parse(localStorage.getItem(SORT_KEY) || 'null') as GridSort | null;
  } catch {
    return null;
  }
}

const SORT_PRESETS = ['sales:desc', 'commission:desc', 'due:desc', 'name:asc', 'id:asc'];

interface Row extends SalesmanDto {
  sales: number;
  receipts: number;
  /** متوسط الفاتورة — 0 بلا فواتير. */
  avg: number;
  /** نسبة من مبيعات الفترة. */
  share: number;
  commission: number | null;
  due: number | null;
}

const dash = <span className="text-slate-300">—</span>;

export function SalesmenPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const copy = useCopy();
  const navigate = useNavigate();
  const { settings: periodSettings } = useBusinessPeriod();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<PageTab>(() => {
    const p = params.get('tab');
    if (p === 'reports') return 1;
    return loadTab();
  });
  const [search, setSearchState] = useState(() => {
    try { return sessionStorage.getItem(SEARCH_KEY) ?? ''; } catch { return ''; }
  });
  const [dueOnly, setDueOnly] = useState(false);
  const [scope, setScope] = useState<Scope>('edari');
  const includeAll = scope === 'archive';
  const activeOnly = scope === 'active';
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [sort, setSort] = useState<GridSort | null>(() => loadSort() ?? { key: 'sales', dir: 'desc' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterSalesmanId, setFilterSalesmanId] = useState<number | ''>(() => {
    const s = params.get('salesman');
    return s ? Number(s) : '';
  });

  function setSearch(v: string) {
    setSearchState(v);
    try { sessionStorage.setItem(SEARCH_KEY, v); } catch { /* تجاهل */ }
  }

  useEffect(() => {
    try { sessionStorage.setItem(TAB_KEY, String(tab)); } catch { /* تجاهل */ }
    const next = new URLSearchParams(params);
    if (tab === 1) next.set('tab', 'reports');
    else next.delete('tab');
    if (filterSalesmanId !== '') next.set('salesman', String(filterSalesmanId));
    else next.delete('salesman');
    setParams(next, { replace: true });
  }, [tab, filterSalesmanId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* تجاهل */ }
  }, [sort]);

  const q = useQuery({
    queryKey: ['salesmen', includeAll],
    queryFn: () => api.salesmen(includeAll),
    staleTime: 0,
  });

  const commQ = useQuery({
    queryKey: ['commission-summary', from, to],
    queryFn: () => api.commissionSummary(from, to),
    staleTime: 60_000,
  });

  // مبيعات الفترة لكل بائع — نفس مفتاح لوحة التقارير لمشاركة الكاش
  const salesQ = useQuery({
    queryKey: ['report-salesman', from, to],
    queryFn: () => api.salesBySalesman(from, to),
    placeholderData: p => p,
    enabled: tab === 0,
  });

  const sync = useMutation({
    mutationFn: api.syncEdariSalesmen,
    onSuccess: async r => {
      await qc.invalidateQueries({ queryKey: ['salesmen'] });
      await qc.refetchQueries({ queryKey: ['salesmen'] });
      qc.invalidateQueries({ queryKey: ['commission-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success(r.message);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل المزامنة'),
  });

  const commById = useMemo(() => new Map((commQ.data ?? []).map(c => [c.salesmanId, c])), [commQ.data]);
  const salesById = useMemo(() => new Map((salesQ.data ?? []).map(s => [s.salesmanId, s])), [salesQ.data]);

  const periodSales = (salesQ.data ?? []).reduce((s, r) => s + r.total, 0);
  const periodReceipts = (salesQ.data ?? []).reduce((s, r) => s + r.count, 0);
  const monthEarned = (commQ.data ?? []).reduce((s, c) => s + c.totalCommission, 0);
  const monthDue = (commQ.data ?? []).reduce((s, c) => s + Math.max(0, c.balanceDue), 0);
  const dueCount = (commQ.data ?? []).filter(c => c.balanceDue > 0).length;
  const withSales = (salesQ.data ?? []).filter(s => s.count > 0).length;

  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const rows = useMemo<Row[]>(() => {
    const s = search.trim().toLowerCase();
    const out: Row[] = [];
    for (const x of all) {
      const c = commById.get(x.id);
      const sale = salesById.get(x.id);
      const hasActivity = (c?.transactionCount ?? 0) > 0 || (c?.balanceDue ?? 0) !== 0 || (c?.paidOutTotal ?? 0) > 0 || (sale?.count ?? 0) > 0;
      const hasName = Boolean(x.name?.trim()) && x.name.trim() !== `${x.id}-` && x.name.trim() !== `${x.id}`;
      if (activeOnly && (!hasActivity || !hasName)) continue;
      if (s && !x.name.toLowerCase().includes(s) && !String(x.id).includes(s)) continue;
      if (dueOnly && (c?.balanceDue ?? 0) <= 0) continue;
      const sales = sale?.total ?? 0;
      const receipts = sale?.count ?? 0;
      out.push({
        ...x,
        sales,
        receipts,
        avg: receipts > 0 ? Math.round(sales / receipts) : 0,
        share: periodSales > 0 ? Math.round((sales / periodSales) * 1000) / 10 : 0,
        commission: c ? c.totalCommission : null,
        due: c ? c.balanceDue : null,
      });
    }
    return out;
  }, [all, search, dueOnly, activeOnly, commById, salesById, periodSales]);

  const openReport = (id: number) => {
    setFilterSalesmanId(id);
    setTab(1);
  };

  const columns = useMemo<GridColumn<Row>[]>(() => [
    { key: 'id', header: '#', width: 60, mono: true, footer: 'text', footerText: 'المجموع' },
    {
      key: 'name',
      header: 'البائع',
      width: 220,
      render: s => <span className="block truncate font-semibold text-header" title={s.name}>{s.name}</span>,
    },
    {
      key: 'sales',
      header: 'مبيعات الفترة',
      width: 140,
      mono: true,
      footer: 'sum',
      render: s => (s.sales ? <span className="font-bold">{formatNum(s.sales)}</span> : dash),
    },
    {
      key: 'receipts',
      header: 'فواتير',
      width: 80,
      mono: true,
      footer: 'sum',
      render: s => (s.receipts ? formatNum(s.receipts) : dash),
    },
    {
      key: 'avg',
      header: 'متوسط الفاتورة',
      width: 120,
      mono: true,
      render: s => (s.avg ? formatNum(s.avg) : dash),
    },
    {
      key: 'share',
      header: 'الحصة %',
      width: 110,
      mono: true,
      render: s => (s.share ? (
        <span className="flex items-center justify-end gap-1.5">
          <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 xl:inline-block">
            <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, s.share)}%` }} />
          </span>
          <span>{s.share.toLocaleString('en-US', { maximumFractionDigits: 1 })}%</span>
        </span>
      ) : dash),
    },
    {
      key: 'commission',
      header: 'عمولة الفترة',
      width: 130,
      mono: true,
      footer: 'sum',
      sortValue: s => s.commission ?? -1,
      render: s => (s.commission != null ? formatNum(s.commission) : dash),
    },
    {
      key: 'due',
      header: 'مستحق',
      width: 130,
      mono: true,
      footer: 'sum',
      sortValue: s => s.due ?? -1,
      render: s =>
        s.due == null ? dash : s.due > 0 ? (
          <span className="font-bold text-amber-700">{formatNum(s.due)}</span>
        ) : (
          formatNum(s.due)
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'end',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex items-center justify-end gap-0.5" onClick={e => e.stopPropagation()}>
          <RowIconButton label="تقرير البائع" tone="brand" onClick={() => openReport(s.id)}>
            <IconChart size={15} />
          </RowIconButton>
          <RowIconButton
            label="فواتير الفترة"
            onClick={() => navigate(`/receipts?search=${encodeURIComponent(s.name)}&from=${from}&to=${to}`)}
          >
            <IconReceipt size={15} />
          </RowIconButton>
          <RowMenu
            items={[
              { label: 'العمولات', icon: <IconCoins size={15} />, onClick: () => navigate('/commissions') },
              { label: 'الأهداف', icon: <IconTarget size={15} />, onClick: () => navigate('/targets') },
              { label: 'حساب الويب', icon: <IconKey size={15} />, onClick: () => navigate('/portal-accounts') },
              { label: 'نسخ الاسم', icon: <IconCopy size={15} />, onClick: () => void copy(s.name, 'الاسم') },
            ]}
          />
        </div>
      ),
    },
  ], [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = !!search.trim() || dueOnly || scope !== 'edari';
  const loadingFigures = commQ.isLoading || salesQ.isLoading;
  const sortValue = sort ? `${sort.key}:${sort.dir}` : '';

  function clearFilters() {
    setSearch('');
    setDueOnly(false);
    setScope('edari');
  }

  const tabs = (
    <div className="card shrink-0 px-3">
      <Tabs<PageTab>
        className="border-b-0"
        value={tab}
        onChange={setTab}
        items={[
          { id: 0, label: 'قائمة البائعين', icon: <IconUsers size={15} />, count: all.length || undefined },
          { id: 1, label: 'التقارير', icon: <IconChart size={15} /> },
        ]}
      />
    </div>
  );

  if (tab === 1) {
    return (
      <WorkspacePage>
        {tabs}
        <div className="min-h-0 flex-1 overflow-auto">
          <SalesmenReportsPanel
            from={from}
            to={to}
            onFromChange={setFrom}
            onToChange={setTo}
            filterSalesmanId={filterSalesmanId}
            onFilterSalesmanIdChange={setFilterSalesmanId}
          />
        </div>
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage>
      {tabs}
      <WorkspaceCard>
        <FilterBar
          footer={
            <>
              <SegmentedFilter<Scope>
                label="نطاق البائعين"
                value={scope}
                onChange={setScope}
                items={[
                  { id: 'edari', label: 'بائعو الأداري' },
                  { id: 'active', label: 'لهم حركة' },
                  { id: 'archive', label: 'مع الأرشيف' },
                ]}
              />
              <button
                type="button"
                onClick={() => setDueOnly(v => !v)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition ${
                  dueOnly ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                aria-pressed={dueOnly}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dueOnly ? 'bg-amber-500' : 'bg-slate-300'}`} />
                مستحق فقط
                {dueCount > 0 && <span className="num text-[10.5px] opacity-80">({formatNum(dueCount)})</span>}
              </button>
              {hasFilters && (
                <Btn size="xs" variant="ghost" onClick={clearFilters}>مسح الفلاتر</Btn>
              )}
              <p className="ms-auto hidden text-[11.5px] text-slate-500 lg:block">
                الأسماء من الأداري — إن ظهرت خاطئة نفّذ «مزامنة الأداري».
                <Link to="/commissions" className="mx-1 font-semibold text-brand-700 hover:underline">العمولات</Link>·
                <Link to="/targets" className="mx-1 font-semibold text-brand-700 hover:underline">الأهداف</Link>·
                <Link to="/portal-accounts" className="ms-1 font-semibold text-brand-700 hover:underline">حسابات الويب</Link>
              </p>
            </>
          }
        >
          <FilterLabel label="بحث بالاسم أو الرقم" grow>
            <SearchBox value={search} onChange={setSearch} placeholder="اكتب للبحث…" />
          </FilterLabel>
          <div className="min-w-0">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">الفترة</span>
            <div className="flex items-center gap-1.5">
              <DatePresets
                variant="menu"
                periodSettings={periodSettings}
                from={from}
                to={to}
                onPick={(f, t) => { setFrom(f); setTo(t); }}
              />
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="!w-[140px] text-[12.5px]" aria-label="من تاريخ" title="من تاريخ" />
              <span className="text-slate-400">—</span>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="!w-[140px] text-[12.5px]" aria-label="إلى تاريخ" title="إلى تاريخ" />
            </div>
          </div>
          <FilterLabel label="الترتيب">
            <Select
              value={sortValue}
              onChange={e => {
                const [key, dir] = e.target.value.split(':');
                setSort(key ? { key, dir: dir as GridSort['dir'] } : null);
              }}
            >
              <option value="sales:desc">الأعلى مبيعاً</option>
              <option value="commission:desc">الأعلى عمولة</option>
              <option value="due:desc">الأعلى مستحقاً</option>
              <option value="name:asc">الاسم أ–ي</option>
              <option value="id:asc">الرقم</option>
              {sort && !SORT_PRESETS.includes(sortValue) && (
                <option value={sortValue}>مخصص (من الجدول)</option>
              )}
              {!sort && <option value="">بلا ترتيب</option>}
            </Select>
          </FilterLabel>
          <FilterActions>
            <IconButton
              label="تحديث"
              onClick={() => { void q.refetch(); void commQ.refetch(); void salesQ.refetch(); }}
            >
              <IconRefresh size={15} className={q.isFetching || commQ.isFetching || salesQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn
              icon={<IconRefresh size={15} />}
              loading={sync.isPending}
              onClick={() => sync.mutate()}
              title="جلب أسماء البائعين (1–250) من الأداري"
            >
              مزامنة الأداري
            </Btn>
          </FilterActions>
        </FilterBar>

        <SummaryStrip
          cells={[
            {
              label: 'البائعون',
              value: q.isLoading ? '…' : formatNum(q.data?.total ?? all.length),
              hint: `${formatNum(withSales)} باع في الفترة`,
              tone: 'brand',
              onClick: () => { setScope(scope === 'active' ? 'edari' : 'active'); setDueOnly(false); },
              active: scope === 'active' && !dueOnly,
            },
            {
              label: 'مبيعات الفترة',
              value: salesQ.isLoading ? '…' : formatNum(periodSales),
              hint: periodReceipts > 0 ? `متوسط الفاتورة ${formatNum(Math.round(periodSales / periodReceipts))}` : 'IQD',
              tone: 'brand',
            },
            {
              label: 'فواتير الفترة',
              value: salesQ.isLoading ? '…' : formatNum(periodReceipts),
            },
            {
              label: 'عمولات الفترة',
              value: commQ.isLoading ? '…' : formatNum(monthEarned),
              hint: 'فتح العمولات',
              onClick: () => navigate('/commissions'),
            },
            {
              label: 'مستحق للصرف',
              value: commQ.isLoading ? '…' : formatNum(monthDue),
              hint: dueCount ? `${formatNum(dueCount)} بائع بانتظار الصرف` : 'لا مستحقات',
              tone: dueCount ? 'warn' : undefined,
              onClick: dueCount ? () => setDueOnly(v => !v) : undefined,
              active: dueOnly,
            },
          ]}
        />

        <WorkspaceBody>
          {q.isError ? (
            <ErrorBlock error={q.error} title="تعذّر تحميل البائعين" onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <div className="p-3"><TableSkeleton rows={10} cols={8} /></div>
          ) : !all.length ? (
            <EmptyState
              icon={<IconUsers size={24} />}
              title={includeAll ? 'لا بائعين في الأرشيف' : 'لا يوجد بائعون بعد'}
              description="اجلب أسماء البائعين من الأداري لتظهر في شاشة البيع والتقارير."
              action={<Btn icon={<IconRefresh size={15} />} loading={sync.isPending} onClick={() => sync.mutate()}>مزامنة الأداري</Btn>}
            />
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              filters
              columns={columns}
              rows={rows}
              getRowId={s => s.id}
              sort={sort}
              onSortChange={setSort}
              selectedId={selectedId ?? undefined}
              onSelect={s => setSelectedId(s.id)}
              onRowDoubleClick={s => openReport(s.id)}
              onEnter={s => openReport(s.id)}
              exportName={`البائعون-${from}_${to}`}
              counterLabel="بائع"
              emptyText={hasFilters ? 'لا نتائج — جرّب مسح الفلاتر' : 'لا بائعين'}
              storageKey="salesmen-v2"
              rowTone={s => (!s.receipts && !loadingFigures ? 'text-slate-500' : undefined)}
              badge={dueCount > 0 && !dueOnly ? (
                <button type="button" onClick={() => setDueOnly(true)} title="عرض من لهم مستحق فقط">
                  <Badge tone="warn" dot>{formatNum(dueCount)} مستحق</Badge>
                </button>
              ) : (
                <span className="hidden text-[11px] text-slate-400 md:inline">نقرة مزدوجة أو Enter لفتح تقرير البائع</span>
              )}
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>
    </WorkspacePage>
  );
}
