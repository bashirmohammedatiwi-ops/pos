import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { CashierPerformanceRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { IconUsers } from '@/components/icons';
import { SummaryStrip } from '@/components/listWorkspace';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import {
  ChartBlock,
  ChartToggle,
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
  useChartDock,
  useReportPeriod,
} from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * أداء الكاشير — مقارنة الكاشيرات في المدة: صافي المبيعات، الفواتير، المتوسط،
 * المرتجعات، الخصم اليدوي، البطاقة، أيام العمل ومعدل اليوم.
 * ───────────────────────────────────────────────────────────────────────────── */

const avgTicket = (r: CashierPerformanceRowDto) => (r.receiptCount > 0 ? (r.netSales + r.returnsTotal) / r.receiptCount : 0);
const perDay = (r: CashierPerformanceRowDto) => (r.daysWorked > 0 ? r.netSales / r.daysWorked : 0);
const returnRate = (r: CashierPerformanceRowDto) => {
  const gross = r.netSales + r.returnsTotal;
  return gross > 0 ? (r.returnsTotal / gross) * 100 : 0;
};
const cardShare = (r: CashierPerformanceRowDto) => {
  const gross = r.netSales + r.returnsTotal;
  return gross > 0 ? (r.cardTotal / gross) * 100 : 0;
};
const nameOf = (r: CashierPerformanceRowDto) => fixEdariName(r.name) || `#${r.cashierId}`;

export function CashierPerformanceApp({ onClose }: { onClose: () => void }) {
  const period = useReportPeriod({
    storageKey: 'cashier-performance',
    presets: ['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'last30', 'all', 'custom'],
    fallback: 'week',
  });
  const range = period.range;
  const dock = useChartDock();

  const q = useQuery({
    queryKey: ['report-cashier-performance', range.from, range.to],
    queryFn: () => api.cashierPerformance(range.from, range.to),
    placeholderData: prev => prev,
  });
  const rows = (q.data ?? []).filter(r => r.receiptCount > 0 || r.returnsCount > 0 || r.giftCount > 0);
  const totalNet = rows.reduce((s, r) => s + r.netSales, 0);
  const totalReceipts = rows.reduce((s, r) => s + r.receiptCount, 0);
  const totalReturns = rows.reduce((s, r) => s + r.returnsTotal, 0);
  const totalManual = rows.reduce((s, r) => s + r.manualDiscount, 0);
  const top = rows[0];

  const columns: GridColumn<CashierPerformanceRowDto>[] = [
    {
      key: 'name',
      header: 'الكاشير',
      width: 170,
      pinned: 'start',
      exportValue: nameOf,
      footer: 'text',
      footerText: 'المجموع',
      render: r => (
        <span>
          <span className="font-bold text-header">{nameOf(r)}</span>
          {r.sectionName && <span className="ms-1.5 text-[11px] text-slate-400">{fixEdariName(r.sectionName)}</span>}
        </span>
      ),
    },
    { key: 'netSales', header: 'صافي المبيعات', width: 140, mono: true, footer: 'sum', render: r => <span className="font-extrabold text-brand-800">{formatCurrency(r.netSales)}</span> },
    {
      key: 'share',
      header: 'الحصة',
      width: 120,
      sortValue: r => r.netSales,
      exportValue: r => (totalNet > 0 ? `${((r.netSales / totalNet) * 100).toFixed(1)}%` : ''),
      render: r => {
        const p = totalNet > 0 ? (r.netSales / totalNet) * 100 : 0;
        return (
          <span className="flex items-center gap-2">
            <span className="block h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, p))}%` }} />
            </span>
            <span className="num text-[11.5px] font-semibold text-slate-600">{p.toFixed(1)}%</span>
          </span>
        );
      },
    },
    { key: 'receiptCount', header: 'فواتير البيع', width: 100, mono: true, footer: 'sum' },
    { key: 'avg', header: 'متوسط الفاتورة', width: 120, mono: true, sortValue: avgTicket, exportValue: r => Math.round(avgTicket(r)), render: r => formatCurrency(avgTicket(r)) },
    { key: 'daysWorked', header: 'أيام العمل', width: 90, mono: true },
    { key: 'perDay', header: 'معدل اليوم', width: 130, mono: true, sortValue: perDay, exportValue: r => Math.round(perDay(r)), render: r => formatCurrency(perDay(r)) },
    {
      key: 'returnsTotal',
      header: 'المرتجعات',
      width: 150,
      mono: true,
      footer: 'sum',
      render: r =>
        r.returnsCount > 0 ? (
          <span>
            <span className="font-semibold text-rose-600">{formatCurrency(r.returnsTotal)}</span>
            <span className="ms-1 text-[11px] text-slate-400">({formatNum(r.returnsCount)} · {returnRate(r).toFixed(1)}%)</span>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    { key: 'manualDiscount', header: 'خصم يدوي', width: 120, mono: true, footer: 'sum', render: r => (r.manualDiscount > 0 ? <span className="text-amber-700">{formatCurrency(r.manualDiscount)}</span> : <span className="text-slate-300">—</span>) },
    {
      key: 'cardTotal',
      header: 'بطاقة',
      width: 140,
      mono: true,
      footer: 'sum',
      render: r => (r.cardTotal > 0 ? <span>{formatCurrency(r.cardTotal)} <span className="text-[11px] text-slate-400">{cardShare(r).toFixed(0)}%</span></span> : <span className="text-slate-300">—</span>),
    },
    { key: 'giftCount', header: 'هدايا', width: 70, mono: true, footer: 'sum', render: r => (r.giftCount ? formatNum(r.giftCount) : <span className="text-slate-300">—</span>) },
  ];

  function sheets(): ReportExcelSheet[] {
    if (!rows.length) return [];
    return [
      {
        name: 'أداء الكاشير',
        title: 'أداء الكاشير',
        subtitle: `${range.from} — ${range.to}`,
        headers: ['الكاشير', 'القسم', 'صافي المبيعات', 'فواتير البيع', 'متوسط الفاتورة', 'أيام العمل', 'معدل اليوم', 'المرتجعات', 'عدد المرتجعات', 'خصم يدوي', 'بطاقة', 'هدايا'],
        columnWidths: [120, 100, 100, 70, 90, 60, 90, 90, 60, 80, 90, 50],
        rows: rows.map(r => [
          nameOf(r),
          fixEdariName(r.sectionName) || '',
          r.netSales,
          r.receiptCount,
          Math.round(avgTicket(r)),
          r.daysWorked,
          Math.round(perDay(r)),
          r.returnsTotal,
          r.returnsCount,
          r.manualDiscount,
          r.cardTotal,
          r.giftCount,
        ]),
      },
    ];
  }

  const chart = rows.length ? (
    <ChartBlock title="صافي المبيعات لكل كاشير" subtitle={period.label}>
      <HBarChart
        items={rows.map(r => ({ id: r.cashierId, label: nameOf(r), values: [r.netSales], sub: `${formatNum(r.receiptCount)} فاتورة` }))}
        series={[{ key: 'net', label: 'صافي المبيعات' }]}
        format={n => formatCurrency(n)}
      />
    </ChartBlock>
  ) : null;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #60a5fa 0%, #1d4ed8 100%)"
      title="أداء الكاشير"
      subtitle={`مقارنة الكاشيرات · ${period.label}`}
      icon={<IconUsers size={20} />}
      toolbar={
        <>
          <PeriodSelector state={period} />
          <ChartToggle dock={dock} />
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`cashier-performance_${range.from}_${range.to}`} getSheets={sheets} disabled={!rows.length} />
          <PrintBtn title={`أداء الكاشير (${range.from} — ${range.to})`} getSheets={sheets} disabled={!rows.length} />
        </>
      }
      onClose={onClose}
    >
      <ReportFill>
        {q.isError && (
          <ReportBanner>
            <ReportError error={q.error} onRetry={() => void q.refetch()} />
          </ReportBanner>
        )}
        <SummaryStrip
          loading={q.isLoading}
          cells={[
            { label: 'صافي المبيعات', value: <Money value={totalNet} />, tone: 'brand' },
            { label: 'فواتير البيع', value: formatNum(totalReceipts) },
            { label: 'متوسط الفاتورة', value: <Money value={totalReceipts > 0 ? (totalNet + totalReturns) / totalReceipts : 0} /> },
            { label: 'المرتجعات', value: <Money value={totalReturns} />, tone: totalReturns > 0 ? 'warn' : undefined },
            { label: 'الخصم اليدوي', value: <Money value={totalManual} /> },
            { label: 'الأعلى مبيعاً', value: top ? nameOf(top) : '—', tone: 'ok', hint: top ? formatCurrency(top.netSales) : undefined },
          ]}
        />
        <ReportNote bar>صافي المبيعات بعد طرح المرتجعات · المتوسط ومعدل اليوم لفواتير البيع وأيام العمل الفعلية لكل كاشير.</ReportNote>
        <ReportSplit chart={chart} open={dock.open}>
          <DataGrid
            variant="sheet"
            embedded
            fillHeight
            columns={columns}
            rows={rows}
            getRowId={r => r.cashierId}
            loading={q.isLoading}
            storageKey="cashier-performance"
            exportName={`cashier-performance_${range.from}_${range.to}`}
            counterLabel="كاشير"
            emptyText="لا فواتير في هذه المدة"
          />
        </ReportSplit>
      </ReportFill>
    </ReportAppWindow>
  );
}
