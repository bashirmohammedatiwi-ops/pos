import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatDateOnly, formatNum } from '@/api/client';
import type { DailySalesRowDto, MovementRowDto, SalesmanSalesRowDto } from '@/api/types';
import { DataGrid, useClientSort, type GridColumn } from '@/components/grid/DataGrid';
import { IconChart, IconRefresh, IconSearch } from '@/components/icons';
import { Btn, IconButton, Input, Tabs } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import { type ReportExcelSheet } from '@/lib/reportExcel';
import { downloadCsv } from '@/utils/exportCsv';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import {
  ChartBlock,
  ChartToggle,
  ColumnChart,
  ExcelBtn,
  HBarChart,
  Money,
  PeriodSelector,
  PrintBtn,
  ReportBanner,
  ReportError,
  ReportFill,
  ReportNote,
  ReportSplit,
  deltaText,
  pctDelta,
  useChartDock,
  useReportPeriod,
} from './ReportKit';

const REPORTS_KEY = 'fot_admin_reports';

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(REPORTS_KEY) || 'null') as {
      search?: string; tab?: number;
    } | null;
  } catch {
    return null;
  }
}

function shortDay(iso: string) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'numeric' });
}

/* أعمدة تقارير الصفحة — DataGrid موحد */

type AbcInfo = { cls: 'A' | 'B' | 'C'; cum: number; share: number };

/**
 * تصنيف ABC حسب صافي المبلغ: A = المواد التي تصنع أول 80% من الإيراد، B = حتى 95%، C = الباقي.
 * يُحسب على كل مواد الفترة (لا على نتيجة البحث وحدها حين يكون البحث فارغاً).
 */
function abcClassify(rows: MovementRowDto[]): Map<number, AbcInfo> {
  const positive = rows.filter(r => r.soldAmount > 0).sort((a, b) => b.soldAmount - a.soldAmount);
  const total = positive.reduce((s, r) => s + r.soldAmount, 0);
  const out = new Map<number, AbcInfo>();
  let run = 0;
  for (const r of positive) {
    const before = run;
    run += r.soldAmount;
    const cls = total <= 0 ? 'C' : before / total < 0.8 ? 'A' : before / total < 0.95 ? 'B' : 'C';
    out.set(r.articleId, { cls, cum: total > 0 ? (run / total) * 100 : 0, share: total > 0 ? (r.soldAmount / total) * 100 : 0 });
  }
  return out;
}

const ABC_TONE: Record<AbcInfo['cls'], string> = {
  A: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  B: 'bg-sky-100 text-sky-800 ring-sky-200',
  C: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function abcColumns(abc: Map<number, AbcInfo>): GridColumn<MovementRowDto>[] {
  return [
    {
      key: 'abc',
      header: 'ABC',
      width: 70,
      align: 'center',
      sortValue: m => abc.get(m.articleId)?.cls ?? 'D',
      exportValue: m => abc.get(m.articleId)?.cls ?? '',
      render: m => {
        const a = abc.get(m.articleId);
        if (!a) return <span className="text-slate-300">—</span>;
        return (
          <span
            title={`حصة ${a.share.toFixed(2)}% · التراكمي ${a.cum.toFixed(1)}%`}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-extrabold ring-1 ring-inset ${ABC_TONE[a.cls]}`}
          >
            {a.cls}
          </span>
        );
      },
    },
    {
      key: 'shareOfSales',
      header: 'الحصة من الإيراد',
      width: 120,
      sortValue: m => abc.get(m.articleId)?.share ?? 0,
      exportValue: m => (abc.get(m.articleId) ? `${abc.get(m.articleId)!.share.toFixed(2)}%` : ''),
      render: m => {
        const a = abc.get(m.articleId);
        if (!a) return <span className="text-slate-300">—</span>;
        return <span className="num text-[12px] text-slate-600">{a.share.toFixed(2)}%</span>;
      },
    },
  ];
}
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
  { key: 'soldQty', header: 'صافي الكمية', width: 110, mono: true, footer: 'sum', render: m => <span className="font-bold text-header">{formatNum(m.soldQty)}</span> },
  { key: 'soldAmount', header: 'صافي المبلغ', width: 140, mono: true, footer: 'sum', render: m => <span className="font-bold text-header">{formatCurrency(m.soldAmount)}</span> },
  {
    key: 'returnedQty',
    header: 'مرتجع',
    width: 90,
    mono: true,
    footer: 'sum',
    sortValue: m => m.returnedQty ?? 0,
    render: m => (m.returnedQty ? <span className="font-semibold text-rose-600">{formatNum(m.returnedQty)}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'giftQty',
    header: 'هدايا',
    width: 80,
    mono: true,
    footer: 'sum',
    sortValue: m => m.giftQty ?? 0,
    render: m => (m.giftQty ? <span className="font-semibold text-violet-600">{formatNum(m.giftQty)}</span> : <span className="text-slate-300">—</span>),
  },
  { key: 'receiptCount', header: 'عدد الفواتير', width: 100, mono: true, sortValue: m => m.receiptCount ?? 0, render: m => formatNum(m.receiptCount ?? 0) },
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
    header: 'البائع',
    width: 200,
    render: s => (
      <Link to={`/receipts?search=${encodeURIComponent(s.name ?? '')}`} className="font-semibold text-brand-700 hover:underline">
        {fixEdariName(s.name) || s.name}
      </Link>
    ),
  },
  { key: 'total', header: 'المبلغ', width: 150, mono: true, footer: 'sum', render: s => <span className="font-bold text-header">{formatCurrency(s.total)}</span> },
  { key: 'count', header: 'الفواتير', width: 110, mono: true, footer: 'sum' },
  { key: 'lineCount', header: 'الأصناف', width: 110, mono: true, footer: 'sum', render: s => (s.lineCount != null ? formatNum(s.lineCount) : '—') },
];

const TAB_TITLES = ['حركة المواد', 'المبيعات اليومية', 'حسب البائع', 'ملخص الصندوق'];

/** تقرير المبيعات — نافذة كاملة: فترة · مؤشرات · تبويبات (حركة/يومي/بائع/صندوق). */
export function SalesReportsPanel({ onClose }: { onClose: () => void }) {
  const saved = loadSaved();
  const urlParams = new URLSearchParams(window.location.search);
  const urlFrom = urlParams.get('from');
  const urlTo = urlParams.get('to');
  const urlTab = urlParams.get('tab');

  const period = useReportPeriod({
    storageKey: 'sales',
    presets: ['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'last30', 'all', 'custom'],
    fallback: 'last30',
    initial: urlFrom && urlTo ? { from: urlFrom, to: urlTo } : null,
  });
  const { from, to } = period.range;

  const [tab, setTab] = useState(urlTab != null && Number.isFinite(Number(urlTab)) ? Number(urlTab) : (saved?.tab ?? 0));
  const [search, setSearch] = useState(saved?.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(search.trim());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    try {
      sessionStorage.setItem(REPORTS_KEY, JSON.stringify({ search, tab }));
    } catch { /* تجاهل */ }
  }, [search, tab]);

  const queryClient = useQueryClient();
  // نفس المفاتيح والدوال للتبويبات ولتصدير «كل الأوراق» (يُعاد استخدام الكاش)
  const movementOpts = { queryKey: ['report-movement', from, to, debouncedSearch], queryFn: () => api.movement(from, to, debouncedSearch || undefined) };
  const dailyOpts = { queryKey: ['report-daily', from, to], queryFn: () => api.dailySales(from, to) };
  const salesmanOpts = { queryKey: ['report-salesman', from, to], queryFn: () => api.salesBySalesman(from, to) };
  const cashOpts = { queryKey: ['report-cash', from, to], queryFn: () => api.cashReport(from, to) };

  const movementQ = useQuery({
    ...movementOpts,
    enabled: tab === 0,
    placeholderData: prev => prev,
  });
  const dailyQ = useQuery({
    ...dailyOpts,
    enabled: tab === 1,
    placeholderData: prev => prev,
  });
  const salesmanQ = useQuery({
    ...salesmanOpts,
    enabled: tab === 2,
    placeholderData: prev => prev,
  });
  const cashQ = useQuery({
    ...cashOpts,
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

  const prevCashOpts = {
    queryKey: ['report-cash-prev', prevRange.from, prevRange.to],
    queryFn: () => api.cashReport(prevRange.from, prevRange.to),
  };
  const prevCashQ = useQuery({
    ...prevCashOpts,
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
  // ABC على كل مواد الفترة فقط — نتيجة بحث جزئية تعطي حصصاً مضللة، فيُخفى أثناء البحث
  const movementAbc = useMemo(
    () => (debouncedSearch || movementQ.isPlaceholderData ? new Map<number, AbcInfo>() : abcClassify(movementQ.data ?? [])),
    [movementQ.data, movementQ.isPlaceholderData, debouncedSearch],
  );
  const movementGridColumns = useMemo(
    () => (movementAbc.size ? [...movementColumns, ...abcColumns(movementAbc)] : movementColumns),
    [movementAbc],
  );
  const abcCounts = useMemo(() => {
    const c = { A: 0, B: 0, C: 0 };
    for (const v of movementAbc.values()) c[v.cls]++;
    return c;
  }, [movementAbc]);
  const movementSort = useClientSort(movementQ.data ?? [], movementAccessors, 'qty', 'desc');

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

  const cash = cashQ.data;
  const prev = prevCashQ.data;
  const periodText = `${from} → ${to}`;

  type CashData = NonNullable<typeof cash>;

  function movementSheet(rows: MovementRowDto[]): ReportExcelSheet {
    const sheetAbc = debouncedSearch ? new Map<number, AbcInfo>() : abcClassify(rows);
    return {
      name: 'حركة المواد',
      title: 'تقرير المبيعات — حركة المواد',
      subtitle: periodText,
      headers: ['المادة', 'الباركود', 'صافي الكمية', 'صافي المبلغ', 'مرتجع', 'هدايا', 'عدد الفواتير', 'ABC', 'الحصة %'],
      columnWidths: [220, 120, 80, 100, 64, 64, 80, 44, 64],
      rows: rows.map(m => {
        const a = sheetAbc.get(m.articleId);
        return [m.name ?? '', m.barcode ?? '', m.soldQty, m.soldAmount, m.returnedQty ?? 0, m.giftQty ?? 0, m.receiptCount ?? 0, a?.cls ?? '', a ? Math.round(a.share * 100) / 100 : 0];
      }),
    };
  }

  function dailySheet(rows: DailySalesRowDto[]): ReportExcelSheet {
    return {
      name: 'مبيعات يومية',
      title: 'تقرير المبيعات — يومي',
      subtitle: periodText,
      headers: ['التاريخ', 'المبلغ', 'الفواتير'],
      columnWidths: [100, 96, 72],
      rows: rows.map(d => [formatDateOnly(d.date), d.total, d.receiptCount]),
    };
  }

  function salesmanSheet(rows: SalesmanSalesRowDto[]): ReportExcelSheet {
    return {
      name: 'البائعون',
      title: 'تقرير المبيعات — حسب البائع',
      subtitle: periodText,
      headers: ['البائع', 'المبلغ', 'الفواتير', 'الأصناف'],
      columnWidths: [160, 96, 72, 72],
      rows: rows.map(s => [fixEdariName(s.name) || s.name || '', s.total, s.count, s.lineCount ?? 0]),
    };
  }

  function cashSheet(c: CashData, p: CashData | undefined): ReportExcelSheet {
    return {
      name: 'ملخص الصندوق',
      title: 'تقرير المبيعات — ملخص الصندوق',
      subtitle: periodText,
      headers: ['البند', 'القيمة'],
      columnWidths: [140, 120],
      rows: [
        ['صافي المبيعات (بعد المرتجعات)', c.totalSales],
        ['عدد فواتير البيع', c.receiptCount],
        ['المرتجعات', c.returnsTotal ?? 0],
        ['عدد فواتير المرتجع', c.returnsCount ?? 0],
        ['المدفوع', c.totalPayment],
        ['الباقي للزبائن', c.totalCashBack],
        ['متوسط الفاتورة', c.averageTicket],
        ...(p ? [['مبيعات الفترة السابقة', p.totalSales] as (string | number)[]] : []),
      ],
    };
  }

  function sheetForTab(t: number): ReportExcelSheet | null {
    if (t === 0) return movementSheet(movementSort.sorted);
    if (t === 1) return dailySheet(dailyQ.data ?? []);
    if (t === 2) return salesmanSheet(salesmanSort.sorted);
    if (!cash) return null;
    return cashSheet(cash, prev);
  }

  /** كل الأوراق للفترة/البحث الحاليين — تُجلب (أو تُؤخذ من الكاش) بدل الاعتماد على بيانات تبويبات قديمة. */
  async function allSheets(): Promise<ReportExcelSheet[]> {
    const [movement, daily, salesmen, c, p] = await Promise.all([
      queryClient.fetchQuery({ ...movementOpts, staleTime: 60_000 }),
      queryClient.fetchQuery({ ...dailyOpts, staleTime: 60_000 }),
      queryClient.fetchQuery({ ...salesmanOpts, staleTime: 60_000 }),
      queryClient.fetchQuery({ ...cashOpts, staleTime: 60_000 }),
      queryClient.fetchQuery({ ...prevCashOpts, staleTime: 60_000 }).catch(() => undefined),
    ]);
    // نحافظ على ترتيب المستخدم إن كانت بيانات التبويب هي نفسها الحالية
    const movementRows = movement === movementQ.data && !movementQ.isPlaceholderData
      ? movementSort.sorted
      : [...movement].sort((a, b) => b.soldQty - a.soldQty || b.soldAmount - a.soldAmount);
    const salesmanRows = salesmen === salesmanQ.data && !salesmanQ.isPlaceholderData
      ? salesmanSort.sorted
      : [...salesmen].sort((a, b) => b.total - a.total);
    return [movementSheet(movementRows), dailySheet(daily), salesmanSheet(salesmanRows), cashSheet(c, p)]
      .filter(s => s.rows.length > 0);
  }

  function exportCurrentTabCsv() {
    const s = sheetForTab(tab);
    if (!s || !s.rows.length) return;
    const names = ['movement', 'daily-sales', 'sales-by-salesman', 'cash-summary'];
    downloadCsv(`${names[tab]}_${from}_${to}.csv`, s.headers, s.rows.map(r => r.map(c => c ?? '')));
  }

  const activeQ = [movementQ, dailyQ, salesmanQ, cashQ][tab] ?? cashQ;

  const currentSheet = sheetForTab(tab);
  // لا تصدير/طباعة لورقة التبويب وهي تعرض بيانات فترة سابقة أو أثناء الجلب
  const activeStale = activeQ.isPlaceholderData || activeQ.isFetching || (tab === 3 && (prevCashQ.isPlaceholderData || prevCashQ.isFetching));
  const canExport = !!currentSheet && currentSheet.rows.length > 0 && !activeStale;
  const tabLoading = activeQ.isLoading && !activeQ.data;
  const refreshing = activeQ.isFetching || cashQ.isFetching;

  function refreshAll() {
    void movementQ.refetch();
    void dailyQ.refetch();
    void salesmanQ.refetch();
    void cashQ.refetch();
    void prevCashQ.refetch();
  }

  const salesDelta = cash ? pctDelta(cash.totalSales, prev?.totalSales) : null;
  const receiptsDelta = cash ? pctDelta(cash.receiptCount, prev?.receiptCount) : null;

  const dock = useChartDock();
  const cashLoading = !cash && cashQ.isLoading;

  const dailyChart = (dailyQ.data?.length ?? 0) > 1 ? (
    <ChartBlock title="منحنى المبيعات اليومية" subtitle="مرّر على العمود لرؤية المبلغ وعدد الفواتير">
      <ColumnChart
        height={130}
        seriesLabel="المبيعات"
        format={n => formatCurrency(Math.round(n))}
        points={(dailyQ.data ?? []).map(d => ({
          id: String(d.date),
          label: shortDay(String(d.date)),
          value: d.total,
          tooltip: <p>الفواتير: <span className="num font-semibold">{formatNum(d.receiptCount)}</span></p>,
        }))}
      />
    </ChartBlock>
  ) : null;

  const salesmanChart = salesmanSort.sorted.length > 0 ? (
    <ChartBlock
      title="أعلى البائعين مبيعاً"
      subtitle={salesmanSort.sorted.length > 10 ? `أعلى 10 من ${formatNum(salesmanSort.sorted.length)}` : undefined}
    >
      <HBarChart
        series={[{ key: 'total', label: 'المبيعات' }]}
        format={n => formatCurrency(n)}
        items={[...salesmanSort.sorted]
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)
          .map(s => ({
            id: s.salesmanId,
            label: fixEdariName(s.name) || s.name || `#${s.salesmanId}`,
            values: [s.total],
            sub: `${formatNum(s.count)} فاتورة`,
          }))}
      />
    </ChartBlock>
  ) : null;

  const cashRows = cash
    ? [
        { k: 'صافي المبيعات', v: cash.totalSales, money: true, strong: true, hint: 'بعد طرح المرتجعات' },
        { k: 'عدد فواتير البيع', v: cash.receiptCount, money: false, strong: false, hint: '' },
        { k: 'المرتجعات', v: cash.returnsTotal ?? 0, money: true, strong: false, hint: `${formatNum(cash.returnsCount ?? 0)} فاتورة مرتجع` },
        { k: 'المدفوع', v: cash.totalPayment, money: true, strong: false, hint: '' },
        { k: 'الباقي للزبائن', v: cash.totalCashBack, money: true, strong: false, hint: 'المبلغ المُعاد للزبون من المدفوع' },
        { k: 'متوسط الفاتورة', v: cash.averageTicket, money: true, strong: false, hint: '' },
        ...(prev
          ? [{ k: 'مبيعات الفترة السابقة', v: prev.totalSales, money: true, strong: false, hint: `${prevRange.from} — ${prevRange.to}` }]
          : []),
      ]
    : [];

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #10b981 0%, #047857 100%)"
      title="تقرير المبيعات"
      subtitle={`${TAB_TITLES[tab]} · ${period.label}`}
      icon={<IconChart size={16} />}
      onClose={onClose}
      toolbar={
        <>
          <PeriodSelector state={period} />
          <IconButton label="تحديث" onClick={refreshAll} disabled={refreshing}>
            <IconRefresh size={15} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`sales-report_${from}_${to}`} getSheets={() => (currentSheet ? [currentSheet] : [])} disabled={!canExport} />
          <ExcelBtn
            fileName={`sales-report-all_${from}_${to}`}
            getSheets={allSheets}
            disabled={!cash}
            label="كل الأوراق"
            variant="ghost"
          />
          <Btn size="sm" variant="ghost" disabled={!canExport} onClick={exportCurrentTabCsv}>CSV</Btn>
          <PrintBtn title={`تقرير المبيعات — ${TAB_TITLES[tab]} (${from} — ${to})`} getSheets={() => (currentSheet ? [currentSheet] : [])} disabled={!canExport} />
        </>
      }
    >
      <ReportFill>
        {cashQ.isError && (
          <ReportBanner><ReportError error={cashQ.error} onRetry={() => void cashQ.refetch()} /></ReportBanner>
        )}

        <SummaryStrip
          loading={cashLoading}
          cells={[
            {
              label: 'صافي مبيعات الفترة',
              value: <Money value={cash?.totalSales ?? 0} />,
              tone: 'brand',
              hint: deltaText(salesDelta) ?? (prev ? `السابقة ${formatCurrency(prev.totalSales)}` : undefined),
            },
            { label: 'الفواتير', value: formatNum(cash?.receiptCount ?? 0), hint: deltaText(receiptsDelta) },
            { label: 'متوسط الفاتورة', value: <Money value={cash?.averageTicket ?? 0} /> },
            { label: 'المدفوع', value: <Money value={cash?.totalPayment ?? 0} /> },
            {
              label: 'المرتجعات',
              value: <Money value={cash?.returnsTotal ?? 0} />,
              tone: (cash?.returnsTotal ?? 0) > 0 ? 'warn' : undefined,
              hint: cash?.returnsCount ? `${formatNum(cash.returnsCount)} فاتورة · مطروحة` : undefined,
            },
            {
              label: 'الفترة السابقة',
              value: prev ? <Money value={prev.totalSales} /> : '—',
              hint: `${prevRange.from} — ${prevRange.to}`,
            },
          ]}
        />

        {cash && cash.receiptCount === 0 && (
          <ReportNote bar>
            لا مبيعات في هذه الفترة — جرّب فترة أخرى أو افتح{' '}
            <Link to={`/receipts?from=${from}&to=${to}`} className="font-semibold text-brand-700 hover:underline">الفواتير</Link>.
          </ReportNote>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-2">
          <Tabs
            className="border-b-0"
            items={[
              { id: 0, label: 'حركة المواد', count: movementQ.data?.length },
              { id: 1, label: 'المبيعات اليومية', count: dailyQ.data?.length },
              { id: 2, label: 'حسب البائع', count: salesmanQ.data?.length },
              { id: 3, label: 'ملخص الصندوق' },
            ]}
            value={tab}
            onChange={id => setTab(Number(id))}
          />
          {tab === 0 && (
            <div className="ms-auto flex items-center gap-2 py-1">
              {movementQ.isFetching && <span className="text-[11.5px] text-slate-400">جاري البحث…</span>}
              <div className="relative w-[min(320px,80vw)]">
                <IconSearch size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="بحث مادة بالاسم أو الباركود"
                  className="!h-8 !ps-8 text-[12.5px]"
                  aria-label="بحث مادة"
                />
              </div>
            </div>
          )}
        </div>

        {activeQ.isError && tab !== 3 && (
          <ReportBanner><ReportError error={activeQ.error} onRetry={() => void activeQ.refetch()} /></ReportBanner>
        )}

        {tab === 0 && movementAbc.size > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-slate-50/70 px-3 py-1.5 text-[11.5px] text-slate-600">
            <span className="font-bold text-slate-700">تصنيف ABC:</span>
            <span><b className="text-emerald-700">A</b> {formatNum(abcCounts.A)} مادة تصنع 80% من الإيراد</span>
            <span><b className="text-sky-700">B</b> {formatNum(abcCounts.B)} مادة للـ15% التالية</span>
            <span><b className="text-slate-500">C</b> {formatNum(abcCounts.C)} مادة للـ5% الأخيرة</span>
          </div>
        )}
        {tab === 0 && (
          <DataGrid
            variant="sheet"
            embedded
            fillHeight
            columns={movementGridColumns}
            rows={movementSort.sorted}
            getRowId={m => m.articleId}
            loading={tabLoading}
            storageKey="report-sales-movement"
            exportName={`حركة-المواد-${from}_${to}`}
            counterLabel="مادة"
            emptyText={debouncedSearch ? `لا مواد تطابق «${debouncedSearch}» في هذه الفترة` : 'لا حركة مواد في هذه الفترة'}
          />
        )}

        {tab === 1 && (
          <ReportSplit chart={dailyChart} open={dock.open}>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={dailyColumns}
              rows={dailyQ.data ?? []}
              getRowId={d => String(d.date)}
              loading={tabLoading}
              storageKey="report-sales-daily"
              exportName={`تقرير-يومي-${from}_${to}`}
              counterLabel="يوم"
              emptyText="لا مبيعات في هذه الفترة"
              toolbar={dailyChart ? <ChartToggle dock={dock} /> : undefined}
            />
          </ReportSplit>
        )}

        {tab === 2 && (
          <ReportSplit chart={salesmanChart} open={dock.open}>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={salesmanReportColumns}
              rows={salesmanSort.sorted}
              getRowId={s => s.salesmanId}
              loading={tabLoading}
              storageKey="report-sales-salesmen"
              exportName={`تقرير-البائعين-${from}_${to}`}
              counterLabel="بائع"
              emptyText="لا مبيعات بائعين في هذه الفترة"
              toolbar={salesmanChart ? <ChartToggle dock={dock} /> : undefined}
            />
          </ReportSplit>
        )}

        {tab === 3 && (
          <div className="min-h-0 flex-1 overflow-auto bg-slate-50/60 p-3">
            {cash ? (
              <div className="card max-w-2xl overflow-hidden">
                <div className="border-b border-slate-100 px-3 py-2 text-[12.5px] font-bold text-header">
                  ملخص الصندوق <span className="ms-2 text-[11.5px] font-normal text-slate-400 num">{from} — {to}</span>
                </div>
                <dl className="divide-y divide-slate-100">
                  {cashRows.map(row => (
                    <div key={row.k} className="flex items-center justify-between gap-3 px-3 py-2">
                      <dt className="text-[12.5px] text-slate-600">
                        {row.k}
                        {row.hint && <span className="ms-2 text-[11px] text-slate-400 num">{row.hint}</span>}
                      </dt>
                      <dd className={`text-[13.5px] ${row.strong ? 'font-bold text-header' : 'font-semibold text-slate-800'}`}>
                        {row.money ? <Money value={row.v} /> : <span className="num">{formatNum(row.v)}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : cashQ.isLoading ? (
              <div className="card max-w-2xl space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-6 w-full" />)}
              </div>
            ) : null}
          </div>
        )}
      </ReportFill>
    </ReportAppWindow>
  );
}

/** اسم بديل أوضح. */
export const SalesReportApp = SalesReportsPanel;
