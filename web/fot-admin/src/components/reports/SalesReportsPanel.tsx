import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, daysAgoIso, formatCurrency, formatDateOnly, formatNum, todayIso } from '@/api/client';
import type { DailySalesRowDto, MovementRowDto, SalesmanSalesRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { downloadCsv } from '@/utils/exportCsv';
import { printHtmlDoc } from '@/lib/print';
import { DatePresets } from '@/components/DatePresets';
import { useClientSort } from '@/components/grid/DataGrid';
import { Btn, Input, Loading } from '@/components/ui';
import {
  ClassicFilterActions,
  ClassicListShell,
  ClassicResultBadge,
  ClassicSummaryFooter,
  ClassicTabBar,
  FilterField,
  useClassicFilters,
} from '@/components/classic/ClassicListLayout';

const REPORTS_KEY = 'fot_admin_reports';

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(REPORTS_KEY) || 'null') as {
      from?: string; to?: string; search?: string; tab?: number;
    } | null;
  } catch {
    return null;
  }
}

function vsPrev(now: number, prev: number) {
  if (!prev && !now) return 'كما الفترة السابقة';
  if (!prev) return 'بداية الفترة';
  const pct = ((now - prev) / prev) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}% مقابل السابقة`;
}

/* أعمدة تقارير الصفحة — DataGrid موحد */
const movementColumns: GridColumn<MovementRowDto>[] = [
  {
    key: 'name',
    header: 'المادة',
    width: 280,
    render: m => (
      <Link to={`/products?search=${encodeURIComponent(m.barcode || m.name || '')}`} className="font-semibold text-brand-700 hover:underline">
        {m.name}
      </Link>
    ),
  },
  { key: 'barcode', header: 'الباركود', width: 140, mono: true },
  { key: 'soldQty', header: 'الكمية', width: 100, mono: true, footer: 'sum' },
  { key: 'soldAmount', header: 'المبلغ', width: 140, mono: true, footer: 'sum', render: m => <span className="font-bold text-header">{formatCurrency(m.soldAmount)}</span> },
];

const dailyColumns: GridColumn<DailySalesRowDto>[] = [
  {
    key: 'date',
    header: 'التاريخ',
    width: 140,
    render: d => (
      <Link to={`/receipts?from=${String(d.date).slice(0, 10)}&to=${String(d.date).slice(0, 10)}`} className="font-semibold text-brand-700 hover:underline">
        {formatDateOnly(d.date)}
      </Link>
    ),
  },
  { key: 'total', header: 'المبلغ', width: 160, mono: true, footer: 'sum', render: d => <span className="font-bold text-header">{formatCurrency(d.total)}</span> },
  { key: 'receiptCount', header: 'الفواتير', width: 110, mono: true, footer: 'sum' },
];

const salesmanReportColumns: GridColumn<SalesmanSalesRowDto>[] = [
  {
    key: 'name',
    header: 'المندوب',
    width: 200,
    render: s => (
      <Link to={`/receipts?search=${encodeURIComponent(s.name ?? '')}`} className="font-semibold text-brand-700 hover:underline">
        {s.name}
      </Link>
    ),
  },
  { key: 'total', header: 'المبلغ', width: 150, mono: true, footer: 'sum', render: s => <span className="font-bold text-header">{formatCurrency(s.total)}</span> },
  { key: 'count', header: 'الفواتير', width: 110, mono: true, footer: 'sum' },
  { key: 'lineCount', header: 'الأصناف', width: 110, mono: true, footer: 'sum', render: s => (s.lineCount != null ? formatNum(s.lineCount) : '—') },
];

export function SalesReportsPanel() {
  const saved = loadSaved();
  const urlParams = new URLSearchParams(window.location.search);
  const urlFrom = urlParams.get('from');
  const urlTo = urlParams.get('to');
  const urlTab = urlParams.get('tab');
  const { draft, patchDraft, applied, apply, clear } = useClassicFilters({
    from: urlFrom ?? saved?.from ?? daysAgoIso(30),
    to: urlTo ?? saved?.to ?? todayIso(),
    search: saved?.search ?? '',
  });
  const [tab, setTab] = useState(urlTab != null && Number.isFinite(Number(urlTab)) ? Number(urlTab) : (saved?.tab ?? 0));
  const from = applied.from;
  const to = applied.to;
  const debouncedSearch = applied.search.trim();

  useEffect(() => {
    sessionStorage.setItem(REPORTS_KEY, JSON.stringify({ from, to, search: applied.search, tab }));
  }, [from, to, applied.search, tab]);

  const movementQ = useQuery({
    queryKey: ['report-movement', from, to, debouncedSearch],
    queryFn: () => api.movement(from, to, debouncedSearch || undefined),
    enabled: tab === 0,
    placeholderData: prev => prev,
  });
  const dailyQ = useQuery({
    queryKey: ['report-daily', from, to],
    queryFn: () => api.dailySales(from, to),
    enabled: tab === 1,
    placeholderData: prev => prev,
  });
  const salesmanQ = useQuery({
    queryKey: ['report-salesman', from, to],
    queryFn: () => api.salesBySalesman(from, to),
    enabled: tab === 2,
    placeholderData: prev => prev,
  });
  const cashQ = useQuery({
    queryKey: ['report-cash', from, to],
    queryFn: () => api.cashReport(from, to),
    placeholderData: prev => prev,
  });

  const prevRange = useMemo(() => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(prevStart), to: iso(prevEnd) };
  }, [from, to]);

  const prevCashQ = useQuery({
    queryKey: ['report-cash-prev', prevRange.from, prevRange.to],
    queryFn: () => api.cashReport(prevRange.from, prevRange.to),
    placeholderData: prev => prev,
  });

  const movementAccessors = useMemo(
    () => ({
      name: (m: MovementRowDto) => m.name ?? '',
      barcode: (m: MovementRowDto) => m.barcode ?? '',
      qty: (m: MovementRowDto) => m.soldQty,
      amount: (m: MovementRowDto) => m.soldAmount,
    }),
    [],
  );
  const movementSort = useClientSort(movementQ.data ?? [], movementAccessors, 'amount', 'desc');

  const salesmanAccessors = useMemo(
    () => ({
      name: (s: SalesmanSalesRowDto) => s.name ?? '',
      total: (s: SalesmanSalesRowDto) => s.total,
      count: (s: SalesmanSalesRowDto) => s.count,
      lines: (s: SalesmanSalesRowDto) => s.lineCount ?? 0,
    }),
    [],
  );
  const salesmanSort = useClientSort(salesmanQ.data ?? [], salesmanAccessors, 'total', 'desc');

  const loading =
    (tab === 0 && movementQ.isLoading && !movementQ.data)
    || (tab === 1 && dailyQ.isLoading && !dailyQ.data)
    || (tab === 2 && salesmanQ.isLoading && !salesmanQ.data)
    || (cashQ.isLoading && !cashQ.data);

  function exportCurrentTab() {
    const suffix = `${from}_${to}`;
    if (tab === 0 && movementSort.sorted.length) {
      downloadCsv(`movement_${suffix}.csv`, ['المادة', 'باركود', 'كمية', 'مبلغ'],
        movementSort.sorted.map(m => [m.name ?? '', m.barcode ?? '', m.soldQty, m.soldAmount]));
    } else if (tab === 1 && dailyQ.data) {
      downloadCsv(`daily-sales_${suffix}.csv`, ['التاريخ', 'المبلغ', 'فواتير'],
        dailyQ.data.map(d => [formatDateOnly(d.date), d.total, d.receiptCount]));
    } else if (tab === 2 && salesmanSort.sorted.length) {
      downloadCsv(`sales-by-salesman_${suffix}.csv`, ['المندوب', 'المبلغ', 'عدد', 'أصناف'],
        salesmanSort.sorted.map(s => [s.name ?? '', s.total, s.count, s.lineCount ?? '']));
    } else if (tab === 3 && cashQ.data) {
      const c = cashQ.data;
      downloadCsv(`cash-summary_${suffix}.csv`, ['البند', 'القيمة'], [
        ['مبيعات', c.totalSales], ['فواتير', c.receiptCount], ['مدفوع', c.totalPayment],
        ['مرتجع', c.totalCashBack], ['متوسط', c.averageTicket],
      ]);
    }
  }

  const canExport =
    (tab === 0 && movementSort.sorted.length > 0)
    || (tab === 1 && !!dailyQ.data?.length)
    || (tab === 2 && salesmanSort.sorted.length > 0)
    || (tab === 3 && !!cashQ.data);

  const cash = cashQ.data;
  const prev = prevCashQ.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        banner={
          cash && cash.receiptCount === 0 ? (
            <div className="border-b border-dashed border-slate-200 bg-slate-50 px-3 py-1.5 text-center text-[11px] text-slate-500">
              لا مبيعات في هذه الفترة —{' '}
              <Link to={`/receipts?from=${from}&to=${to}`} className="font-semibold text-brand-700 hover:underline">الفواتير</Link>
            </div>
          ) : undefined
        }
        filters={
          <div className="grid gap-3 lg:grid-cols-[140px_140px_minmax(0,1fr)_auto_auto] lg:items-end">
            <FilterField label="من تاريخ">
              <Input type="date" value={draft.from} onChange={e => patchDraft({ from: e.target.value })} />
            </FilterField>
            <FilterField label="إلى تاريخ">
              <Input type="date" value={draft.to} onChange={e => patchDraft({ to: e.target.value })} />
            </FilterField>
            {tab === 0 && (
              <FilterField label="بحث مادة">
                <Input
                  value={draft.search}
                  onChange={e => patchDraft({ search: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && apply()}
                  placeholder="اسم أو باركود"
                />
              </FilterField>
            )}
            <ClassicFilterActions
              applyLabel="عرض التقرير"
              onApply={() => apply()}
              onClear={() => clear({ from: daysAgoIso(30), to: todayIso(), search: '' })}
              extra={<DatePresets onPick={(f, t) => { patchDraft({ from: f, to: t }); apply({ from: f, to: t }); }} />}
            />
            <ClassicResultBadge>{['حركة', 'يومي', 'مندوب', 'صندوق'][tab]}</ClassicResultBadge>
          </div>
        }
        tabs={
          <ClassicTabBar
            items={[
              { id: 0, label: 'حركة مواد', count: movementQ.data?.length },
              { id: 1, label: 'مبيعات يومية', count: dailyQ.data?.length },
              { id: 2, label: 'حسب المندوب', count: salesmanQ.data?.length },
              { id: 3, label: 'ملخص صندوق' },
            ]}
            value={tab}
            onChange={id => setTab(Number(id))}
          />
        }
        header={{
          title: ['حركة المواد', 'المبيعات اليومية', 'مبيعات المندوبين', 'تقرير الصندوق'][tab],
          hint: 'اختر الفترة ثم اضغط «عرض التقرير»',
          actions: (
            <>
              {canExport && <Btn size="sm" variant="secondary" onClick={exportCurrentTab}>CSV</Btn>}
              {canExport && (
                <Btn
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const title = ['حركة مواد', 'مبيعات يومية', 'حسب المندوب', 'ملخص صندوق'][tab];
                    const rows = document.querySelector('.report-print')?.innerHTML ?? '';
                    void printHtmlDoc(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
                      <style>body{font-family:Tahoma,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px;text-align:right}</style>
                      </head><body><h2>${title} ${from} — ${to}</h2>${rows}</body></html>`);
                  }}
                >
                  طباعة
                </Btn>
              )}
            </>
          ),
        }}
        onRefresh={() => {
          void movementQ.refetch();
          void dailyQ.refetch();
          void salesmanQ.refetch();
          void cashQ.refetch();
        }}
        refreshing={loading}
        footer={
          cash ? (
            <ClassicSummaryFooter
              items={[
                { label: 'مبيعات', value: formatCurrency(cash.totalSales), accent: true },
                { label: 'فواتير', value: formatNum(cash.receiptCount) },
                { label: 'مدفوع', value: formatCurrency(cash.totalPayment) },
                { label: 'مرتجع', value: formatCurrency(cash.totalCashBack) },
                { label: 'متوسط', value: formatCurrency(cash.averageTicket) },
                ...(prev ? [{ label: 'مقارنة', value: vsPrev(cash.totalSales, prev.totalSales) }] : []),
              ]}
            />
          ) : undefined
        }
      >
        {loading && <Loading />}

        {tab === 0 && !loading && (
          <DataGrid
            embedded
            fillHeight
            columns={movementColumns}
            rows={movementSort.sorted}
            getRowId={m => m.articleId}
            exportName={`حركة-المواد-${from}_${to}`}
            counterLabel="مادة"
            emptyText="لا حركة مواد في هذه الفترة"
          />
        )}

        {tab === 1 && !loading && (
          <DataGrid
            embedded
            fillHeight
            columns={dailyColumns}
            rows={dailyQ.data ?? []}
            getRowId={d => String(d.date)}
            exportName={`تقرير-يومي-${from}_${to}`}
            counterLabel="يوم"
            emptyText="لا مبيعات في هذه الفترة"
          />
        )}

        {tab === 2 && !loading && (
          <DataGrid
            embedded
            fillHeight
            columns={salesmanReportColumns}
            rows={salesmanSort.sorted}
            getRowId={s => s.salesmanId}
            exportName={`تقرير-المندوبين-${from}_${to}`}
            counterLabel="مندوب"
            emptyText="لا مبيعات مندوبين في هذه الفترة"
          />
        )}

        {tab === 3 && cash && (
          <div className="report-print grid gap-1.5 overflow-auto p-2 text-[11px] sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-slate-200 px-2 py-1.5"><span className="text-slate-500">مبيعات:</span> <strong>{formatCurrency(cash.totalSales)}</strong></div>
            <div className="rounded-lg border border-border px-2 py-1.5"><span className="text-muted">فواتير:</span> <strong>{formatNum(cash.receiptCount)}</strong></div>
            <div className="rounded-lg border border-border px-2 py-1.5"><span className="text-muted">مدفوع:</span> <strong>{formatCurrency(cash.totalPayment)}</strong></div>
            <div className="rounded-lg border border-border px-2 py-1.5"><span className="text-muted">مرتجع:</span> <strong>{formatCurrency(cash.totalCashBack)}</strong></div>
            <div className="rounded-lg border border-border px-2 py-1.5"><span className="text-muted">متوسط:</span> <strong>{formatCurrency(cash.averageTicket)}</strong></div>
            {prev && (
              <div className="rounded-lg border border-border px-2 py-1.5">
                <span className="text-muted">سابق:</span> <strong>{formatCurrency(prev.totalSales)}</strong>
              </div>
            )}
          </div>
        )}
      </ClassicListShell>
    </div>
  );
}
