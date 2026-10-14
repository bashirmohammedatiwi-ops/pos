import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatCurrency,
  formatNum,
  monthStartIso,
  todayIso,
} from '@/api/client';
import type { SalesmanCommissionSummaryDto, SalesmanSalesRowDto } from '@/api/types';
import { DataGrid, useClientSort, type GridColumn } from '@/components/grid/DataGrid';
import { fixEdariName } from '@/lib/text';
import { DatePresets } from '@/components/DatePresets';
import { Badge, Btn, Input, Select } from '@/components/ui';
import { IconSearch, IconX } from '@/components/icons';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceCard,
} from '@/components/listWorkspace';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { downloadCsv } from '@/utils/exportCsv';
import {
  ChartBlock,
  ChartToggle,
  ExcelBtn,
  HBarChart,
  Money,
  PrintBtn,
  ReportBanner,
  ReportError,
  ReportNote,
  ReportSplit,
  deltaText,
  pctDelta,
  useChartDock,
} from '@/components/reports/ReportKit';

const REPORT_KEY = 'fot_salesmen_reports_sub';

type ReportTab = 0 | 1 | 2 | 3;

function loadSubTab(): ReportTab {
  try {
    const n = Number(sessionStorage.getItem(REPORT_KEY));
    if (n >= 0 && n <= 3) return n as ReportTab;
  } catch { /* ignore */ }
  return 0;
}

function prevRange(from: string, to: string) {
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
}

function MiniBar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'ok' | 'amber' }) {
  const w = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  const color = tone === 'ok' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100">
      <div className={`h-full rounded ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/** قيمة + شريط صغير في سطر واحد (لا يضاعف ارتفاع الصف). */
function BarValue({ value, max, tone, children }: { value: number; max: number; tone?: 'brand' | 'ok' | 'amber'; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="hidden w-16 shrink-0 md:block"><MiniBar value={value} max={max} tone={tone} /></span>
      <span className="ms-auto font-bold">{children}</span>
    </span>
  );
}

type TargetAgg = {
  salesmanId: number;
  name: string;
  avgPercent: number;
  rulesHit: number;
  rulesTotal: number;
};

/** صف «نظرة عامة»: مبيعات + عمولات + أهداف لكل بائع في جدول واحد. */
type OverviewRow = {
  salesmanId: number;
  name: string;
  sales: number;
  receipts: number;
  commission: number;
  paid: number;
  due: number;
  targetPct: number | null;
};

/* أعمدة تقارير البائعين — DataGrid موحد */
function salesReportColumns(max: number, from: string, to: string, onFilter: (id: number) => void): GridColumn<SalesmanSalesRowDto>[] {
  return [
    { key: 'name', header: 'البائع', width: 200, exportValue: s => fixEdariName(s.name) || `#${s.salesmanId}`, render: s => <span className="font-semibold text-header">{fixEdariName(s.name) || `#${s.salesmanId}`}</span> },
    { key: 'total', header: 'المبلغ', width: 220, mono: true, footer: 'sum', render: s => (
      <BarValue value={s.total} max={max}>{formatCurrency(s.total)}</BarValue>
    ) },
    { key: 'count', header: 'الفواتير', width: 100, mono: true, footer: 'sum' },
    { key: 'lineCount', header: 'الأصناف', width: 100, mono: true, footer: 'sum', render: s => formatNum(s.lineCount ?? 0) },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 150,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex justify-center gap-3">
          <Link to={`/receipts?search=${encodeURIComponent(s.name ?? '')}&from=${from}&to=${to}`} className="text-[12px] font-semibold text-brand-700 hover:underline">الفواتير</Link>
          <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline" onClick={() => onFilter(s.salesmanId)}>تصفية</button>
        </div>
      ),
    },
  ];
}

function commReportColumns(max: number): GridColumn<SalesmanCommissionSummaryDto>[] {
  return [
    { key: 'salesmanName', header: 'البائع', width: 200, exportValue: s => fixEdariName(s.salesmanName) || `#${s.salesmanId}`, render: s => <span className="font-semibold text-header">{fixEdariName(s.salesmanName) || `#${s.salesmanId}`}</span> },
    { key: 'totalCommission', header: 'عمولة الفترة', width: 230, mono: true, footer: 'sum', render: s => (
      <BarValue value={s.totalCommission} max={max} tone={s.balanceDue > 0 ? 'amber' : 'ok'}>{formatCurrency(s.totalCommission)}</BarValue>
    ) },
    { key: 'paidOutTotal', header: 'مصروف', width: 130, mono: true, footer: 'sum', render: s => formatCurrency(s.paidOutTotal) },
    { key: 'balanceDue', header: 'مستحق', width: 130, mono: true, footer: 'sum', render: s => <span className={s.balanceDue > 0 ? 'font-bold text-amber-700' : ''}>{formatCurrency(s.balanceDue)}</span> },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 160,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex justify-center gap-3">
          <Link to="/reports?app=commissions" className="text-[12px] font-semibold text-brand-700 hover:underline">تقرير العمولات</Link>
          {s.balanceDue > 0 && (
            <Link to="/reports?app=settlement" className="text-[12px] font-semibold text-brand-700 hover:underline">تسليم</Link>
          )}
        </div>
      ),
    },
  ];
}

const targetsReportColumns: GridColumn<TargetAgg>[] = [
  { key: 'name', header: 'البائع', width: 200, render: t => <span className="font-semibold text-header">{t.name}</span> },
  {
    key: 'avgPercent',
    header: 'متوسط الإنجاز',
    width: 230,
    mono: true,
    render: t => (
      <BarValue value={t.avgPercent} max={100} tone={t.avgPercent < 70 ? 'amber' : 'ok'}>
        <span className={t.avgPercent < 70 ? 'text-amber-700' : 'text-emerald-700'}>{formatNum(t.avgPercent, 0)}%</span>
      </BarValue>
    ),
  },
  { key: 'rulesHit', header: 'أهداف محققة', width: 130, align: 'center', exportValue: t => `${formatNum(t.rulesHit)} / ${formatNum(t.rulesTotal)}`, render: t => `${formatNum(t.rulesHit)} / ${formatNum(t.rulesTotal)}` },
  {
    key: 'actions',
    header: 'إجراءات',
    width: 100,
    align: 'center',
    sortable: false,
    exportable: false,
    render: () => <Link to="/targets" className="text-[12px] font-semibold text-brand-700 hover:underline">الأهداف</Link>,
  },
];

function overviewColumns(maxSales: number, onFilter: (id: number) => void): GridColumn<OverviewRow>[] {
  return [
    { key: 'name', header: 'البائع', width: 200, render: r => <span className="font-semibold text-header">{r.name}</span> },
    { key: 'sales', header: 'المبيعات', width: 210, mono: true, footer: 'sum', render: r => <BarValue value={r.sales} max={maxSales}>{formatCurrency(r.sales)}</BarValue> },
    { key: 'receipts', header: 'الفواتير', width: 90, mono: true, footer: 'sum' },
    { key: 'commission', header: 'العمولة', width: 130, mono: true, footer: 'sum', render: r => <span className="font-semibold text-brand-800">{formatCurrency(r.commission)}</span> },
    { key: 'paid', header: 'مصروف', width: 120, mono: true, footer: 'sum', render: r => formatCurrency(r.paid) },
    { key: 'due', header: 'مستحق', width: 120, mono: true, footer: 'sum', render: r => <span className={r.due > 0 ? 'font-bold text-amber-700' : 'text-slate-500'}>{formatCurrency(r.due)}</span> },
    {
      key: 'targetPct',
      header: 'إنجاز الأهداف',
      width: 120,
      mono: true,
      sortValue: r => r.targetPct ?? -1,
      exportValue: r => (r.targetPct == null ? '—' : Number(r.targetPct.toFixed(0))),
      render: r => r.targetPct == null
        ? <span className="text-slate-300">—</span>
        : <span className={`font-bold ${r.targetPct < 70 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatNum(r.targetPct, 0)}%</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 70,
      align: 'center',
      sortable: false,
      exportable: false,
      render: r => (
        <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline" onClick={() => onFilter(r.salesmanId)}>تصفية</button>
      ),
    },
  ];
}

const TITLES = ['نظرة عامة — البائعون', 'مبيعات البائعين', 'عمولات البائعين', 'أهداف البائعين'];

export function SalesmenReportsPanel({
  from,
  to,
  onFromChange,
  onToChange,
  filterSalesmanId,
  onFilterSalesmanIdChange,
}: {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  filterSalesmanId: number | '';
  onFilterSalesmanIdChange: (v: number | '') => void;
}) {
  const [subTab, setSubTab] = useState<ReportTab>(loadSubTab);
  const [search, setSearch] = useState('');
  const dock = useChartDock();

  useEffect(() => {
    try {
      sessionStorage.setItem(REPORT_KEY, String(subTab));
    } catch { /* ignore */ }
  }, [subTab]);

  const prev = useMemo(() => prevRange(from, to), [from, to]);

  const salesQ = useQuery({
    queryKey: ['report-salesman', from, to],
    queryFn: () => api.salesBySalesman(from, to),
    placeholderData: p => p,
  });
  const prevSalesQ = useQuery({
    queryKey: ['report-salesman-prev', prev.from, prev.to],
    queryFn: () => api.salesBySalesman(prev.from, prev.to),
    placeholderData: p => p,
  });
  const commQ = useQuery({
    queryKey: ['commission-summary', from, to],
    queryFn: () => api.commissionSummary(from, to),
    placeholderData: p => p,
  });
  const targetsQ = useQuery({
    queryKey: ['target-breakdowns', from, to],
    queryFn: () => api.targetBreakdowns(from, to),
    staleTime: 90_000,
  });
  const salesmenQ = useQuery({
    queryKey: ['salesmen'],
    queryFn: () => api.salesmen(),
    staleTime: 60_000,
  });

  const sales = salesQ.data ?? [];
  const prevSales = prevSalesQ.data ?? [];
  const comm = commQ.data ?? [];

  const totalSales = sales.reduce((s, x) => s + x.total, 0);
  const prevTotalSales = prevSales.reduce((s, x) => s + x.total, 0);
  const totalReceipts = sales.reduce((s, x) => s + x.count, 0);
  const totalCommission = comm.reduce((s, x) => s + x.totalCommission, 0);
  const totalDue = comm.reduce((s, x) => s + Math.max(0, x.balanceDue), 0);
  const activeCount = sales.filter(s => s.total > 0).length;

  const salesAccessors = useMemo(() => ({
    name: (s: SalesmanSalesRowDto) => s.name ?? '',
    total: (s: SalesmanSalesRowDto) => s.total,
    count: (s: SalesmanSalesRowDto) => s.count,
    lines: (s: SalesmanSalesRowDto) => s.lineCount ?? 0,
  }), []);
  const salesSort = useClientSort(sales, salesAccessors, 'total', 'desc');

  const commAccessors = useMemo(() => ({
    name: (s: SalesmanCommissionSummaryDto) => s.salesmanName ?? '',
    earned: (s: SalesmanCommissionSummaryDto) => s.totalCommission,
    due: (s: SalesmanCommissionSummaryDto) => s.balanceDue,
    paid: (s: SalesmanCommissionSummaryDto) => s.paidOutTotal,
  }), []);
  const commSort = useClientSort(comm, commAccessors, 'earned', 'desc');

  // متوسط فعلي لنسب الإنجاز (مجموع ÷ عدد) لكل بائع
  const targetAgg = useMemo(() => {
    const map = new Map<number, TargetAgg & { sum: number; n: number }>();
    for (const b of targetsQ.data ?? []) {
      for (const m of b.salesmen) {
        const pct = m.dailyPercent;
        const hit = m.dailyTarget > 0 && pct >= 100 ? 1 : 0;
        const hasTarget = m.dailyTarget > 0 ? 1 : 0;
        const ex = map.get(m.salesmanId) ?? {
          salesmanId: m.salesmanId,
          name: fixEdariName(m.salesmanName) || `#${m.salesmanId}`,
          avgPercent: 0,
          rulesHit: 0,
          rulesTotal: 0,
          sum: 0,
          n: 0,
        };
        ex.rulesTotal += hasTarget;
        ex.rulesHit += hit;
        ex.sum += pct;
        ex.n += 1;
        ex.avgPercent = ex.sum / ex.n;
        map.set(m.salesmanId, ex);
      }
    }
    return [...map.values()]
      .map(({ sum: _s, n: _n, ...rest }) => rest)
      .sort((a, b) => a.avgPercent - b.avgPercent);
  }, [targetsQ.data]);

  const q = search.trim().toLowerCase();
  const filteredSales = useMemo(() => {
    let list = salesSort.sorted;
    if (filterSalesmanId !== '') list = list.filter(s => s.salesmanId === filterSalesmanId);
    if (!q) return list;
    return list.filter(s =>
      (s.name ?? '').toLowerCase().includes(q) || String(s.salesmanId).includes(q),
    );
  }, [salesSort.sorted, filterSalesmanId, q]);

  const filteredComm = useMemo(() => {
    let list = commSort.sorted;
    if (filterSalesmanId !== '') list = list.filter(s => s.salesmanId === filterSalesmanId);
    if (!q) return list;
    return list.filter(s =>
      (s.salesmanName ?? '').toLowerCase().includes(q) || String(s.salesmanId).includes(q),
    );
  }, [commSort.sorted, filterSalesmanId, q]);

  const filteredTargets = useMemo(() => {
    let list = targetAgg;
    if (filterSalesmanId !== '') list = list.filter(s => s.salesmanId === filterSalesmanId);
    if (!q) return list;
    return list.filter(s => s.name.toLowerCase().includes(q) || String(s.salesmanId).includes(q));
  }, [targetAgg, filterSalesmanId, q]);

  // نظرة عامة: صف واحد لكل بائع يجمع المبيعات والعمولات والأهداف
  const overviewRows = useMemo(() => {
    const map = new Map<number, OverviewRow>();
    const row = (id: number, name: string) => {
      let r = map.get(id);
      if (!r) {
        r = { salesmanId: id, name, sales: 0, receipts: 0, commission: 0, paid: 0, due: 0, targetPct: null };
        map.set(id, r);
      }
      return r;
    };
    for (const s of sales) {
      const r = row(s.salesmanId, fixEdariName(s.name) || s.name || `#${s.salesmanId}`);
      r.sales += s.total;
      r.receipts += s.count;
    }
    for (const c of comm) {
      const r = row(c.salesmanId, fixEdariName(c.salesmanName) || c.salesmanName || `#${c.salesmanId}`);
      r.commission += c.totalCommission;
      r.paid += c.paidOutTotal;
      r.due += c.balanceDue;
    }
    for (const t of targetAgg) {
      const r = map.get(t.salesmanId);
      if (r && t.rulesTotal > 0) r.targetPct = t.avgPercent;
    }
    let list = [...map.values()].sort((a, b) => b.sales - a.sales || b.commission - a.commission);
    if (filterSalesmanId !== '') list = list.filter(r => r.salesmanId === filterSalesmanId);
    if (q) list = list.filter(r => r.name.toLowerCase().includes(q) || String(r.salesmanId).includes(q));
    return list;
  }, [sales, comm, targetAgg, filterSalesmanId, q]);

  const maxSales = Math.max(...filteredSales.map(s => s.total), 1);
  const maxComm = Math.max(...filteredComm.map(s => s.totalCommission), 1);
  const maxOverview = Math.max(...overviewRows.map(r => r.sales), 1);

  const topSales = [...sales].sort((a, b) => b.total - a.total).slice(0, 8);
  const topComm = [...comm].sort((a, b) => b.totalCommission - a.totalCommission).slice(0, 8);
  const atRisk = targetAgg.filter(t => t.rulesTotal > 0 && t.avgPercent < 70).slice(0, 6);

  const alerts = useMemo(() => {
    const list: { tone: 'warn' | 'info'; text: string }[] = [];
    if (totalDue > 0) {
      const dueCount = comm.filter(c => c.balanceDue > 0).length;
      list.push({ tone: 'warn', text: `${formatNum(dueCount)} بائع لديهم مستحق صرف بقيمة ${formatCurrency(totalDue)}` });
    }
    if (atRisk.length) {
      list.push({ tone: 'warn', text: `${formatNum(atRisk.length)} بائع تحت 70% من أهدافهم` });
    }
    if (!activeCount && !salesQ.isLoading) {
      list.push({ tone: 'info', text: 'لا مبيعات للبائعين في الفترة المحددة' });
    }
    return list;
  }, [activeCount, atRisk.length, comm, salesQ.isLoading, totalDue]);

  const loading = (salesQ.isLoading && !salesQ.data) || (commQ.isLoading && !commQ.data);
  const loadError = salesQ.error ?? commQ.error;
  const filterName = filterSalesmanId === ''
    ? ''
    : fixEdariName((salesmenQ.data?.items ?? []).find(s => s.id === filterSalesmanId)?.name) || `#${filterSalesmanId}`;

  function sheet(): ReportExcelSheet {
    const period = `${from} → ${to}`;
    if (subTab === 1) {
      return {
        name: 'مبيعات',
        title: 'مبيعات البائعين',
        subtitle: period,
        headers: ['البائع', 'المبلغ', 'فواتير', 'أصناف'],
        rows: filteredSales.map(s => [fixEdariName(s.name) || s.name || s.salesmanId, s.total, s.count, s.lineCount ?? 0]),
      };
    }
    if (subTab === 2) {
      return {
        name: 'عمولات',
        title: 'عمولات البائعين',
        subtitle: period,
        headers: ['البائع', 'عمولة', 'مصروف', 'مستحق'],
        rows: filteredComm.map(s => [fixEdariName(s.salesmanName) || s.salesmanName || s.salesmanId, s.totalCommission, s.paidOutTotal, s.balanceDue]),
      };
    }
    if (subTab === 3) {
      return {
        name: 'أهداف',
        title: 'أهداف البائعين',
        subtitle: period,
        headers: ['البائع', 'متوسط%', 'أهداف محققة', 'أهداف'],
        rows: filteredTargets.map(t => [t.name, Number(t.avgPercent.toFixed(1)), t.rulesHit, t.rulesTotal]),
      };
    }
    // نفس صفوف وأعمدة جدول «نظرة عامة» (يحترم البحث وتصفية البائع)
    return {
      name: 'نظرة عامة',
      title: 'تقارير البائعين — نظرة عامة',
      subtitle: period,
      headers: ['البائع', 'المبيعات', 'الفواتير', 'العمولة', 'مصروف', 'مستحق', 'إنجاز الأهداف %'],
      rows: overviewRows.map(r => [
        r.name,
        r.sales,
        r.receipts,
        r.commission,
        r.paid,
        r.due,
        r.targetPct == null ? '—' : Number(r.targetPct.toFixed(0)),
      ]),
    };
  }

  function exportCsv() {
    const s = sheet();
    const names = ['salesmen-overview', 'salesmen-sales', 'salesmen-commissions', 'salesmen-targets'];
    downloadCsv(`${names[subTab]}_${from}_${to}.csv`, s.headers, s.rows.map(r => r.map(c => c ?? '')));
  }

  const salesDelta = pctDelta(totalSales, prevSalesQ.data ? prevTotalSales : null);
  const filtering = !!q || filterSalesmanId !== '';
  const pickSalesman = (id: number) => onFilterSalesmanIdChange(id);

  const overviewChart = (
    <>
      <ChartBlock title="أعلى مبيعات" subtitle="اضغط على بائع لتصفيته">
        <HBarChart
          series={[{ key: 'total', label: 'المبيعات' }]}
          format={n => formatCurrency(n)}
          emptyText="لا مبيعات"
          onSelect={item => pickSalesman(Number(item.id))}
          items={topSales.map(s => ({
            id: s.salesmanId,
            label: fixEdariName(s.name) || `#${s.salesmanId}`,
            values: [s.total],
            sub: `${formatNum(s.count)} فاتورة`,
          }))}
        />
      </ChartBlock>
      <ChartBlock title="أعلى عمولات" subtitle="العمولة مقابل المصروف">
        <HBarChart
          series={[
            { key: 'earned', label: 'العمولة' },
            { key: 'paid', label: 'المصروف' },
          ]}
          format={n => formatCurrency(n)}
          emptyText="لا عمولات"
          onSelect={item => pickSalesman(Number(item.id))}
          items={topComm.map(s => ({
            id: s.salesmanId,
            label: fixEdariName(s.salesmanName) || `#${s.salesmanId}`,
            values: [s.totalCommission, s.paidOutTotal],
            sub: s.balanceDue > 0 ? `مستحق ${formatCurrency(s.balanceDue)}` : undefined,
          }))}
        />
      </ChartBlock>
      <ChartBlock
        title="أهداف تحتاج متابعة"
        subtitle="تحت 70% من الإنجاز"
        actions={<Link to="/targets" className="text-[11.5px] font-semibold text-brand-700 hover:underline">الكل</Link>}
      >
        <ul className="divide-y divide-slate-100">
          {atRisk.map(t => (
            <li key={t.salesmanId} className="py-1.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-medium text-header">{t.name}</span>
                <Badge tone="warn">{formatNum(t.avgPercent, 0)}%</Badge>
              </div>
              <MiniBar value={t.avgPercent} max={100} tone="amber" />
            </li>
          ))}
          {!atRisk.length && <li className="py-4 text-center text-[12px] text-slate-400">الجميع على المسار</li>}
        </ul>
      </ChartBlock>
    </>
  );

  const salesChart = topSales.length > 0 ? (
    <ChartBlock title="أعلى مبيعات" subtitle="اضغط على بائع لتصفيته">
      <HBarChart
        series={[{ key: 'total', label: 'المبيعات' }]}
        format={n => formatCurrency(n)}
        onSelect={item => pickSalesman(Number(item.id))}
        items={topSales.map(s => ({ id: s.salesmanId, label: fixEdariName(s.name) || `#${s.salesmanId}`, values: [s.total], sub: `${formatNum(s.count)} فاتورة` }))}
      />
    </ChartBlock>
  ) : null;

  const commChart = topComm.length > 0 ? (
    <ChartBlock title="أعلى عمولات" subtitle="العمولة مقابل المصروف">
      <HBarChart
        series={[
          { key: 'earned', label: 'العمولة' },
          { key: 'paid', label: 'المصروف' },
        ]}
        format={n => formatCurrency(n)}
        onSelect={item => pickSalesman(Number(item.id))}
        items={topComm.map(s => ({
          id: s.salesmanId,
          label: fixEdariName(s.salesmanName) || `#${s.salesmanId}`,
          values: [s.totalCommission, s.paidOutTotal],
          sub: s.balanceDue > 0 ? `مستحق ${formatCurrency(s.balanceDue)}` : undefined,
        }))}
      />
    </ChartBlock>
  ) : null;

  const chartForTab = subTab === 0 ? overviewChart : subTab === 1 ? salesChart : subTab === 2 ? commChart : null;
  const chartToggle = chartForTab ? <ChartToggle dock={dock} /> : undefined;
  const emptyFiltered = 'لا نتائج مطابقة للبحث أو التصفية';

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <WorkspaceCard>
        <FilterBar
          footer={
            <>
              <SegmentedFilter<string>
                label="نوع التقرير"
                value={String(subTab)}
                onChange={id => setSubTab(Number(id) as ReportTab)}
                items={[
                  { id: '0', label: 'نظرة عامة' },
                  { id: '1', label: 'المبيعات', count: sales.length },
                  { id: '2', label: 'العمولات', count: comm.length },
                  { id: '3', label: 'الأهداف', count: targetAgg.length },
                ]}
              />
              {filterSalesmanId !== '' && (
                <button
                  type="button"
                  onClick={() => onFilterSalesmanIdChange('')}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 ps-2.5 pe-1.5 text-[12px] font-medium text-brand-800 hover:bg-brand-100"
                  title="إزالة التصفية"
                >
                  {filterName}
                  <IconX size={12} />
                </button>
              )}
              <Link to="/reports?app=settlement" className="ms-auto text-[12px] font-semibold text-brand-700 hover:underline">كشف التسليم ←</Link>
            </>
          }
        >
          <FilterLabel label="بحث" grow>
            <div className="relative">
              <IconSearch size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="بحث باسم البائع أو رقمه…"
                className="!h-8 !ps-8 text-[12.5px]"
                aria-label="بحث"
              />
            </div>
          </FilterLabel>
          <div className="min-w-0">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">الفترة</span>
            <div className="flex items-center gap-1.5">
              <DatePresets variant="menu" from={from} to={to} onPick={(f, t) => { onFromChange(f); onToChange(t); }} />
              <Input type="date" aria-label="من تاريخ" title="من تاريخ" value={from} onChange={e => onFromChange(e.target.value)} className="!h-8 !w-[140px] text-[12.5px]" />
              <span className="text-slate-400">—</span>
              <Input type="date" aria-label="إلى تاريخ" title="إلى تاريخ" value={to} onChange={e => onToChange(e.target.value)} className="!h-8 !w-[140px] text-[12.5px]" />
            </div>
          </div>
          <FilterLabel label="البائع">
            <Select
              value={filterSalesmanId === '' ? '' : String(filterSalesmanId)}
              onChange={e => onFilterSalesmanIdChange(e.target.value ? Number(e.target.value) : '')}
              className="!h-8 text-[12.5px]"
              aria-label="البائع"
            >
              <option value="">كل البائعين</option>
              {(salesmenQ.data?.items ?? []).map(s => (
                <option key={s.id} value={s.id}>{fixEdariName(s.name) || s.name}</option>
              ))}
            </Select>
          </FilterLabel>
          <FilterActions>
            <ExcelBtn fileName={`salesmen-report_${from}_${to}`} getSheets={() => [sheet()]} />
            <Btn size="sm" variant="ghost" onClick={exportCsv}>CSV</Btn>
            <PrintBtn title={`${TITLES[subTab]} (${from} — ${to})`} getSheets={() => [sheet()]} />
          </FilterActions>
        </FilterBar>

        <SummaryStrip
          loading={loading}
          cells={[
            { label: 'بائعون نشطون', value: formatNum(activeCount), tone: 'brand', hint: `من ${formatNum(salesmenQ.data?.total ?? sales.length)}` },
            { label: 'مبيعات الفترة', value: <Money value={totalSales} />, hint: deltaText(salesDelta, 'مقابل السابقة') },
            { label: 'الفواتير', value: formatNum(totalReceipts) },
            { label: 'العمولات', value: <Money value={totalCommission} /> },
            { label: 'مستحق صرف', value: <Money value={totalDue} />, tone: totalDue ? 'warn' : undefined, onClick: () => setSubTab(2), active: subTab === 2 },
            { label: 'متوسط / بائع', value: <Money value={activeCount ? totalSales / activeCount : 0} /> },
          ]}
        />

        {loadError && (
          <ReportBanner><ReportError error={loadError} onRetry={() => { void salesQ.refetch(); void commQ.refetch(); }} /></ReportBanner>
        )}

        {alerts.map(a => (
          <ReportNote key={a.text} bar tone={a.tone === 'warn' ? 'warn' : 'info'}>{a.text}</ReportNote>
        ))}

        <ReportSplit chart={chartForTab} open={dock.open}>
          {subTab === 0 && (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={overviewColumns(maxOverview, pickSalesman)}
              rows={overviewRows}
              getRowId={r => r.salesmanId}
              loading={loading}
              storageKey="salesmen-reports-overview"
              exportName={`نظرة-البائعين-${from}_${to}`}
              counterLabel="بائع"
              emptyText={filtering ? emptyFiltered : 'لا مبيعات ولا عمولات في هذه الفترة'}
              rowTone={r => (r.due > 0 ? 'bg-amber-50/50' : undefined)}
              toolbar={chartToggle}
            />
          )}

          {subTab === 1 && (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={salesReportColumns(maxSales, from, to, pickSalesman)}
              rows={filteredSales}
              getRowId={s => s.salesmanId}
              loading={loading}
              exportName={`مبيعات-البائعين-${from}_${to}`}
              counterLabel="بائع"
              emptyText={filtering ? emptyFiltered : 'لا مبيعات في هذه الفترة'}
              toolbar={chartToggle}
            />
          )}

          {subTab === 2 && (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={commReportColumns(maxComm)}
              rows={filteredComm}
              getRowId={s => s.salesmanId}
              loading={loading}
              exportName={`عمولات-البائعين-${from}_${to}`}
              counterLabel="بائع"
              emptyText={filtering ? emptyFiltered : 'لا عمولات في هذه الفترة'}
              toolbar={chartToggle}
            />
          )}

          {subTab === 3 && (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={targetsReportColumns}
              rows={filteredTargets}
              getRowId={t => t.salesmanId}
              loading={targetsQ.isLoading}
              exportName="أهداف-البائعين"
              counterLabel="بائع"
              emptyText="لا أهداف نشطة"
            />
          )}
        </ReportSplit>
      </WorkspaceCard>
    </div>
  );
}

export function defaultSalesmenRange() {
  return { from: monthStartIso(), to: todayIso() };
}
