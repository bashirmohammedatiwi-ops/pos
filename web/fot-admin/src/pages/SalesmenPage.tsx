import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatCurrency, formatNum, monthStartIso, todayIso } from '@/api/client';
import type { SalesmanDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { SalesmenReportsPanel } from '@/components/SalesmenReportsPanel';
import { useToast } from '@/components/Toast';
import { Btn, Alert, Input, Loading } from '@/components/ui';
import { DatePresets } from '@/components/DatePresets';
import {
  ClassicFilterActions,
  ClassicListShell,
  ClassicSummaryFooter,
  ClassicTabBar,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { FilterChip, InfoNote } from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';

const SEARCH_KEY = 'fot_admin_salesmen';
const TAB_KEY = 'fot_admin_salesmen_tab';

type PageTab = 0 | 1;

function loadTab(): PageTab {
  try {
    const n = Number(sessionStorage.getItem(TAB_KEY));
    if (n === 0 || n === 1) return n;
  } catch { /* ignore */ }
  return 0;
}

/* أعمدة قائمة البائعين — DataGrid موحد */
function salesmenPageColumnsBuilder(
  commById: Map<number, { totalCommission: number; balanceDue: number }>,
  actions: { report: (id: number) => void; from: string; to: string },
): GridColumn<SalesmanDto>[] {
  return [
    { key: 'id', header: '#', width: 70, mono: true },
    { key: 'name', header: 'الاسم', width: 220, render: s => <span className="font-semibold text-header">{s.name}</span> },
    { key: 'totalCommission', header: 'عمولة الفترة', width: 150, mono: true, render: s => { const c = commById.get(s.id); return c ? formatCurrency(c.totalCommission) : '—'; } },
    { key: 'balanceDue', header: 'مستحق', width: 150, mono: true, render: s => { const c = commById.get(s.id); return c ? <span className={c.balanceDue > 0 ? 'font-bold text-amber-700' : ''}>{formatCurrency(c.balanceDue)}</span> : '—'; } },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 190,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="text-[12px] text-brand-600 hover:underline" onClick={() => actions.report(s.id)}>
            تقرير
          </button>
          <Link to={`/receipts?search=${encodeURIComponent(s.name)}&from=${actions.from}&to=${actions.to}`} className="text-[12px] text-brand-600 hover:underline">
            فواتير
          </Link>
        </div>
      ),
    },
  ];
}

export function SalesmenPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<PageTab>(() => {
    const p = params.get('tab');
    if (p === 'reports') return 1;
    return loadTab();
  });
  const [search, setSearch] = useState(() => sessionStorage.getItem(SEARCH_KEY) ?? '');
  const [dueOnly, setDueOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [includeAll, setIncludeAll] = useState(false);
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [filterSalesmanId, setFilterSalesmanId] = useState<number | ''>(() => {
    const s = params.get('salesman');
    return s ? Number(s) : '';
  });

  useEffect(() => {
    sessionStorage.setItem(TAB_KEY, String(tab));
    const next = new URLSearchParams(params);
    if (tab === 1) next.set('tab', 'reports');
    else next.delete('tab');
    if (filterSalesmanId !== '') next.set('salesman', String(filterSalesmanId));
    else next.delete('salesman');
    setParams(next, { replace: true });
  }, [tab, filterSalesmanId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const commById = useMemo(
    () => new Map((commQ.data ?? []).map(c => [c.salesmanId, c])),
    [commQ.data],
  );

  const all = q.data?.items ?? [];
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter(x => {
      const c = commById.get(x.id);
      const hasActivity = (c?.transactionCount ?? 0) > 0 || (c?.balanceDue ?? 0) !== 0 || (c?.paidOutTotal ?? 0) > 0;
      const hasName = Boolean(x.name?.trim()) && x.name.trim() !== `${x.id}-` && x.name.trim() !== `${x.id}`;
      if (activeOnly && !hasActivity) return false;
      if (activeOnly && !hasName) return false;
      if (s && !x.name.toLowerCase().includes(s) && !String(x.id).includes(s)) return false;
      if (dueOnly) {
        const due = c?.balanceDue ?? 0;
        if (due <= 0) return false;
      }
      return true;
    });
  }, [all, search, dueOnly, activeOnly, commById]);

  const monthEarned = (commQ.data ?? []).reduce((s, c) => s + c.totalCommission, 0);
  const monthDue = (commQ.data ?? []).reduce((s, c) => s + Math.max(0, c.balanceDue), 0);
  const dueCount = (commQ.data ?? []).filter(c => c.balanceDue > 0).length;
  const activeWithSales = (commQ.data ?? []).filter(c => c.transactionCount > 0).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        banner={
          tab === 0 ? (
            <InfoNote strip>
              بائعو Edari (1–250) — إن كانت الأسماء خاطئة نفّذ ↻ Edari.
              <Link to="/commissions" className="mx-1 font-semibold underline">عمولات</Link>
              <Link to="/targets" className="font-semibold underline">أهداف</Link>
            </InfoNote>
          ) : undefined
        }
        filters={
          tab === 0 ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px_140px_auto] lg:items-end">
              <FilterField label="بحث">
                <Input
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    sessionStorage.setItem(SEARCH_KEY, e.target.value);
                  }}
                  placeholder="الاسم أو الرقم"
                />
              </FilterField>
              <FilterField label="من">
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </FilterField>
              <FilterField label="إلى">
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
              </FilterField>
              <ClassicFilterActions
                applyLabel="استعراض"
                onApply={() => commQ.refetch()}
                onClear={() => { setSearch(''); setDueOnly(false); setActiveOnly(false); setIncludeAll(false); }}
                extra={<DatePresets onPick={(f, t) => { setFrom(f); setTo(t); }} />}
              />
            </div>
          ) : (
            <p className="text-[12px] text-slate-500">تقارير البائعين — اختر الفترة من لوحة التقارير</p>
          )
        }
        tabs={
          <ClassicTabBar
            items={[
              { id: 0, label: 'القائمة', count: all.length },
              { id: 1, label: 'التقارير' },
            ]}
            value={tab}
            onChange={id => setTab(Number(id) as PageTab)}
          />
        }
        header={{
          title: tab === 0 ? 'المندوبون النشطون' : 'تقارير البائعين',
          hint: tab === 0 ? 'للاختيار في شاشة البيع' : undefined,
          actions: tab === 0 ? (
            <>
              <FilterChip compact active={!dueOnly} onClick={() => setDueOnly(false)}>الكل</FilterChip>
              <FilterChip compact active={dueOnly} onClick={() => setDueOnly(true)}>مستحق</FilterChip>
              <FilterChip compact active={!includeAll && !activeOnly} onClick={() => { setIncludeAll(false); setActiveOnly(false); }}>Edari</FilterChip>
              <FilterChip compact active={!includeAll && activeOnly} onClick={() => { setIncludeAll(false); setActiveOnly(true); }}>نشطون</FilterChip>
              <FilterChip compact active={includeAll} onClick={() => { setIncludeAll(true); setActiveOnly(false); }}>أرشيف</FilterChip>
              <Btn size="sm" variant="secondary" disabled={!items.length} onClick={() => downloadCsv('salesmen.csv', ['الرقم', 'الاسم', 'عمولة', 'مستحق'], items.map(s => { const c = commById.get(s.id); return [s.id, s.name, c?.totalCommission ?? 0, c?.balanceDue ?? 0]; }))}>CSV</Btn>
              <Btn size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? '…' : '↻ Edari'}</Btn>
            </>
          ) : undefined,
        }}
        onRefresh={() => { void q.refetch(); void commQ.refetch(); }}
        refreshing={q.isFetching || commQ.isFetching}
        footer={
          <ClassicSummaryFooter
            total={items.length}
            items={[
              { label: 'بائعون', value: formatNum(q.data?.total ?? items.length) },
              { label: 'نشطون', value: formatNum(activeWithSales), accent: true },
              { label: 'عمولات', value: formatCurrency(monthEarned) },
              { label: 'مستحق', value: formatCurrency(monthDue) },
              ...(dueCount ? [{ label: 'للصرف', value: formatNum(dueCount) }] : []),
            ]}
          />
        }
      >
        {tab === 1 ? (
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <SalesmenReportsPanel
              from={from}
              to={to}
              onFromChange={setFrom}
              onToChange={setTo}
              filterSalesmanId={filterSalesmanId}
              onFilterSalesmanIdChange={setFilterSalesmanId}
            />
          </div>
        ) : (
          <>
            {q.isError && (
              <div className="p-2">
                <Alert type="error">
                  {q.error instanceof Error ? q.error.message : 'تعذّر تحميل البائعين'}
                </Alert>
              </div>
            )}
            {q.isLoading ? (
              <Loading />
            ) : !q.isError ? (
              <DataGrid
                embedded
                fillHeight
                columns={salesmenPageColumnsBuilder(commById, {
                  report: id => {
                    setFilterSalesmanId(id);
                    setTab(1);
                  },
                  from,
                  to,
                })}
                rows={items}
                getRowId={s => s.id}
                exportName="البائعون"
                counterLabel="بائع"
                emptyText={includeAll ? 'لا بائعين في الأرشيف' : 'لا بائعين — نفّذ مزامنة Edari'}
                storageKey="salesmen"
              />
            ) : null}
          </>
        )}
      </ClassicListShell>
    </div>
  );
}
