import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { OfferSalesDailyRowDto, OfferSalesProductDayRowDto, OfferSalesProductRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import {
  IconCalendar,
  IconDownload,
  IconPercent,
  IconSearch,
  IconTag,
} from '@/components/icons';
import { Badge, Btn, EmptyState, Input, Loading, Skeleton, Tabs } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import { downloadOfferSalesExcel } from '@/lib/offerSalesExcel';
import { offerTypeLabel } from '@/lib/offers';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import {
  ChartBlock,
  ChartToggle,
  ColumnChart,
  HBarChart,
  Money,
  PrintBtn,
  ReportBanner,
  ReportCenter,
  ReportError,
  ReportFill,
  ReportSplit,
  useChartDock,
} from './ReportKit';

type TabId = 'products' | 'product-dates' | 'daily';

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function shortDay(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'numeric' });
}

function periodLabel(from: string, to: string) {
  return `${fmtDate(from)} — ${fmtDate(to)}`;
}

function pct(n: number, digits = 1) {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function productSoldDateText(p: OfferSalesProductRowDto): string {
  const f = p.firstSoldDate ? p.firstSoldDate.slice(0, 10) : null;
  const l = p.lastSoldDate ? p.lastSoldDate.slice(0, 10) : null;
  const days = p.activeDaysCount ?? 0;
  if (!f && !l) return '—';
  if (!l || f === l) return fmtDate(f);
  return `${shortDay(f)} ← ${shortDay(l)}${days > 1 ? ` (${formatNum(days)} أيام)` : ''}`;
}

type ProductRow = OfferSalesProductRowDto & { rank: number; soldDatesText: string };

const productColumns: GridColumn<ProductRow>[] = [
  { key: 'rank', header: '#', width: 52, align: 'center', mono: true },
  { key: 'barcode', header: 'الباركود', width: 135, mono: true, render: p => p.barcode ?? '—' },
  {
    key: 'name',
    header: 'المادة',
    width: 250,
    sortValue: p => fixEdariName(p.name ?? ''),
    exportValue: p => fixEdariName(p.name ?? ''),
    render: p => <span className="font-medium text-header">{fixEdariName(p.name ?? '')}</span>,
  },
  {
    key: 'soldDatesText',
    header: 'تواريخ البيع',
    width: 155,
    sortValue: p => p.lastSoldDate ?? p.firstSoldDate ?? '',
    exportValue: p => p.soldDatesText,
    render: p => <span className="num text-[12px] text-slate-600">{p.soldDatesText}</span>,
  },
  { key: 'quantity', header: 'الكمية', width: 95, mono: true, footer: 'sum' },
  { key: 'listAmount', header: 'قبل الخصم', width: 125, mono: true, footer: 'sum', render: p => formatCurrency(p.listAmount) },
  { key: 'amount', header: 'الصافي', width: 125, mono: true, footer: 'sum', render: p => <span className="font-semibold text-header">{formatCurrency(p.amount)}</span> },
  { key: 'discountAmount', header: 'الخصم', width: 115, mono: true, footer: 'sum', render: p => <span className="text-amber-700">{formatCurrency(p.discountAmount)}</span> },
  { key: 'sharePercent', header: 'الحصة', width: 85, mono: true, render: p => <span className="text-slate-500">{pct(p.sharePercent)}</span> },
];

type ProductDayGridRow = OfferSalesProductDayRowDto & { rowKey: string; rank: number };

const productDayColumns: GridColumn<ProductDayGridRow>[] = [
  { key: 'rank', header: '#', width: 52, align: 'center', mono: true },
  {
    key: 'date',
    header: 'تاريخ البيع',
    width: 135,
    sortValue: d => d.date,
    exportValue: d => d.date.slice(0, 10),
    render: d => <span className="num font-semibold text-slate-700">{fmtDate(d.date)}</span>,
  },
  { key: 'barcode', header: 'الباركود', width: 135, mono: true, render: d => d.barcode ?? '—' },
  {
    key: 'name',
    header: 'المادة',
    width: 250,
    sortValue: d => fixEdariName(d.name ?? ''),
    exportValue: d => fixEdariName(d.name ?? ''),
    render: d => <span className="font-medium text-header">{fixEdariName(d.name ?? '')}</span>,
  },
  { key: 'quantity', header: 'الكمية', width: 95, mono: true, footer: 'sum' },
  { key: 'listAmount', header: 'قبل الخصم', width: 125, mono: true, footer: 'sum', render: d => formatCurrency(d.listAmount) },
  { key: 'amount', header: 'الصافي', width: 125, mono: true, footer: 'sum', render: d => <span className="font-semibold text-header">{formatCurrency(d.amount)}</span> },
  { key: 'discountAmount', header: 'الخصم', width: 115, mono: true, footer: 'sum', render: d => <span className="text-amber-700">{formatCurrency(d.discountAmount)}</span> },
];

const dailyColumns: GridColumn<OfferSalesDailyRowDto>[] = [
  { key: 'date', header: 'اليوم', width: 160, render: d => fmtDate(d.date) },
  { key: 'quantity', header: 'الكمية', width: 110, mono: true, footer: 'sum' },
  { key: 'amount', header: 'المبيعات', width: 150, mono: true, footer: 'sum', render: d => <span className="font-semibold">{formatCurrency(d.amount)}</span> },
  { key: 'receiptCount', header: 'العمليات', width: 110, mono: true, footer: 'sum' },
];

export function OfferSalesReportApp({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [listQuery, setListQuery] = useState('');
  const [tab, setTab] = useState<TabId>('products');
  const listRef = useRef<HTMLUListElement>(null);
  const dock = useChartDock();

  const closuresQ = useQuery({
    queryKey: ['offer-sales-closures'],
    queryFn: () => api.offerSalesClosures(),
  });

  const closures = Array.isArray(closuresQ.data) ? closuresQ.data : [];
  const [offerId, setOfferId] = useState<number | null>(null);
  const activeOfferId = offerId ?? closures[0]?.offerId ?? null;

  const filteredClosures = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return closures;
    return closures.filter(c =>
      fixEdariName(c.offerName).toLowerCase().includes(q)
      || c.offerName.toLowerCase().includes(q),
    );
  }, [closures, listQuery]);

  const selectedClosure = useMemo(
    () => closures.find(c => c.offerId === activeOfferId) ?? null,
    [closures, activeOfferId],
  );

  const reportQ = useQuery({
    queryKey: ['offer-sales-report', activeOfferId],
    queryFn: () => api.offerSalesReport(activeOfferId!),
    enabled: activeOfferId != null,
  });

  const report = reportQ.data;

  const productRows: ProductRow[] = useMemo(
    () =>
      (report?.products ?? []).map((p, i) => ({
        ...p,
        rank: i + 1,
        soldDatesText: productSoldDateText(p),
      })),
    [report],
  );

  const productDayRows: ProductDayGridRow[] = useMemo(
    () =>
      (report?.productDaily ?? []).map((pd, i) => ({
        ...pd,
        rank: i + 1,
        rowKey: `${pd.date.slice(0, 10)}-${pd.articleSeq}-${i}`,
      })),
    [report],
  );

  function selectOffer(id: number) {
    setOfferId(id);
    setTab('products');
  }

  function onListKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-offer]') ?? []);
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
    items[next]?.focus();
  }

  function sheets(): ReportExcelSheet[] {
    if (!report) return [];
    const sub = `${fixEdariName(report.offerName)} · ${periodLabel(report.periodFrom, report.periodTo)}`;
    return [
      {
        name: 'المواد المباعة',
        title: 'مبيعات العرض — المواد المباعة',
        subtitle: sub,
        headers: ['#', 'الباركود', 'المادة', 'تواريخ البيع', 'الكمية', 'قبل الخصم', 'الصافي', 'الخصم', 'الحصة %'],
        rows: productRows.map(p => [
          p.rank,
          p.barcode ?? '',
          fixEdariName(p.name ?? ''),
          p.soldDatesText,
          p.quantity,
          p.listAmount,
          p.amount,
          p.discountAmount,
          Number(p.sharePercent.toFixed(1)),
        ]),
      },
      {
        name: 'مبيعات المواد بالتاريخ',
        title: 'مبيعات العرض — تفصيل المواد بالتاريخ',
        subtitle: sub,
        headers: ['#', 'التاريخ', 'الباركود', 'المادة', 'الكمية', 'قبل الخصم', 'الصافي', 'الخصم'],
        rows: productDayRows.map(pd => [
          pd.rank,
          pd.date.slice(0, 10),
          pd.barcode ?? '',
          fixEdariName(pd.name ?? ''),
          pd.quantity,
          pd.listAmount,
          pd.amount,
          pd.discountAmount,
        ]),
      },
    ];
  }

  const aside = (
    <aside className="flex w-[230px] shrink-0 flex-col border-l border-slate-200 bg-white xl:w-[280px]" onKeyDown={onListKey}>
      <div className="space-y-1.5 border-b border-slate-100 p-2">
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={listQuery}
            onChange={e => setListQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                listRef.current?.querySelector<HTMLButtonElement>('button[data-offer]')?.focus();
              }
            }}
            placeholder="بحث باسم العرض…"
            className="!h-8 !ps-8 text-[12.5px]"
            aria-label="بحث في العروض"
          />
        </div>
        <p className="px-0.5 text-[11px] font-semibold text-slate-500">
          عروض منتهية <span className="num">({formatNum(filteredClosures.length)})</span>
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {closuresQ.isLoading && (
          <div className="space-y-1.5 p-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
          </div>
        )}
        {closuresQ.isError && (
          <div className="p-2">
            <ReportError error={closuresQ.error} title="تعذّر تحميل القائمة" onRetry={() => void closuresQ.refetch()} />
          </div>
        )}
        {!closuresQ.isLoading && !closuresQ.isError && filteredClosures.length === 0 && (
          <EmptyState
            compact
            icon={<IconTag size={18} />}
            title={closures.length === 0 ? 'لا توجد تقارير بعد' : 'لا نتائج للبحث'}
            description={closures.length === 0 ? 'تُنشأ تلقائياً عند انتهاء عرض له تاريخ بداية ونهاية.' : undefined}
          />
        )}
        <ul ref={listRef} className="divide-y divide-slate-100">
          {filteredClosures.map(c => {
            const active = c.offerId === activeOfferId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  data-offer
                  onClick={() => selectOffer(c.offerId)}
                  aria-current={active || undefined}
                  title={`${fixEdariName(c.offerName)} · ${periodLabel(c.periodFrom, c.periodTo)}`}
                  className={`block w-full px-3 py-1.5 text-right transition focus-visible:bg-brand-50/60 focus-visible:outline-none ${
                    active ? 'bg-brand-50 shadow-[inset_-3px_0_0_var(--color-brand-500)]' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className="block truncate text-[12.5px] font-semibold text-header">{fixEdariName(c.offerName)}</span>
                  <span className="flex items-center gap-2 text-[11px]">
                    <span className="truncate text-slate-500">{shortDay(c.periodFrom)} — {shortDay(c.periodTo)}</span>
                    <span className="ms-auto shrink-0 font-semibold text-brand-800 num">{formatCurrency(c.totalAmount)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );

  const chart = report && (report.daily.length > 0 || report.products.length > 0) ? (
    <>
      {report.daily.length > 0 && (
        <ChartBlock title="منحنى المبيعات اليومية" subtitle="مرّر على العمود للتفاصيل">
          <ColumnChart
            height={120}
            seriesLabel="المبيعات"
            format={n => formatCurrency(Math.round(n))}
            points={report.daily.map(d => ({
              id: d.date,
              label: shortDay(d.date),
              value: d.amount,
              tooltip: (
                <p>
                  <span className="num">{formatNum(d.quantity)}</span> قطعة · <span className="num">{formatNum(d.receiptCount)}</span> عملية
                </p>
              ),
            }))}
          />
        </ChartBlock>
      )}
      {report.products.length > 0 && (
        <ChartBlock title="أعلى المواد مبيعاً" subtitle="حسب صافي المبيعات">
          <HBarChart
            series={[{ key: 'amount', label: 'الصافي' }]}
            format={n => formatCurrency(n)}
            items={report.products.slice(0, 8).map(p => ({
              id: p.articleSeq,
              label: fixEdariName(p.name ?? '') || p.barcode || `#${p.articleSeq}`,
              values: [p.amount],
              sub: `${formatNum(p.quantity)} قطعة · حصة ${pct(p.sharePercent)}`,
            }))}
          />
        </ChartBlock>
      )}
    </>
  ) : null;

  const chartToggle = chart ? <ChartToggle dock={dock} /> : undefined;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #f472b6 0%, #9d174d 100%)"
      title="مبيعات العروض"
      subtitle={report ? `${fixEdariName(report.offerName)} · ${periodLabel(report.periodFrom, report.periodTo)}` : 'تحليل كامل لكل عرض منتهٍ · إكسل تنفيذي للشركة الأم'}
      icon={<IconPercent size={16} />}
      actions={
        <>
          <Btn
            size="sm"
            variant="secondary"
            icon={<IconDownload size={14} />}
            disabled={!report?.products.length}
            onClick={() => {
              if (!report) return;
              downloadOfferSalesExcel(report);
              toast.success('تم تنزيل ملف Excel');
            }}
          >
            إكسل للشركة الأم
          </Btn>
          <PrintBtn title={report ? `مبيعات العرض — ${fixEdariName(report.offerName)}` : 'مبيعات العرض'} getSheets={sheets} disabled={!report} />
        </>
      }
      aside={aside}
      onClose={onClose}
    >
      {activeOfferId == null && (
        <ReportCenter>
          <EmptyState
            icon={<IconTag size={24} />}
            title="اختر عرضاً من القائمة"
            description="ستظهر مؤشرات الأداء، المبيعات اليومية، وتفاصيل المواد المباعة وتواريخ بيعها — مع تصدير إكسل شامل مزوّد بمنحنى المبيعات."
          />
        </ReportCenter>
      )}
      {activeOfferId != null && reportQ.isLoading && (
        <ReportFill>
          <SummaryStrip loading cells={[{ label: 'صافي المبيعات', value: '' }, { label: 'الخصم', value: '' }, { label: 'الكمية', value: '' }, { label: 'المواد المباعة', value: '' }]} />
          <ReportCenter><Loading /></ReportCenter>
        </ReportFill>
      )}
      {activeOfferId != null && reportQ.isError && (
        <ReportBanner>
          <ReportError error={reportQ.error} onRetry={() => void reportQ.refetch()} />
        </ReportBanner>
      )}
      {report && (
        <ReportFill>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-1.5 text-[11.5px] text-slate-500">
            <Badge tone="brand">{offerTypeLabel(report.offerType)}{report.offerType === 0 && report.discountPercent > 0 ? ` · ${formatNum(report.discountPercent)}%` : ''}</Badge>
            <span className="inline-flex items-center gap-1"><IconCalendar size={13} /> <span className="num">{report.periodDays}</span> يوم</span>
            {report.storeLabel && <span>· {fixEdariName(report.storeLabel)}</span>}
            <span className="ms-auto text-[11px] text-slate-400">
              آخر حساب: {new Date(report.generatedAt).toLocaleString('ar-IQ')}
              {selectedClosure ? ` · أُنشئ التقرير ${fmtDate(selectedClosure.closedAt)}` : ''}
            </span>
          </div>

          <SummaryStrip
            cells={[
              { label: 'صافي المبيعات', value: <Money value={report.totalAmount} />, tone: 'brand', hint: `قبل الخصم ${formatCurrency(report.totalListAmount)}` },
              {
                label: 'إجمالي الخصم',
                value: <Money value={report.totalDiscountAmount} />,
                tone: 'warn',
                hint: report.totalListAmount > 0 ? `${pct((report.totalDiscountAmount / report.totalListAmount) * 100)} من قيمة القائمة` : undefined,
              },
              { label: 'الكمية المباعة', value: formatNum(report.totalQuantity), hint: `${formatNum(report.receiptCount)} عملية بيع` },
              {
                label: 'المواد المباعة',
                value: formatNum(report.products.length),
                tone: 'ok',
                hint: 'مادة مباعة خلال العرض',
              },
              { label: 'متوسط يومي', value: <Money value={report.averageDailyAmount} /> },
              { label: 'متوسط العملية', value: <Money value={report.averageTicketAmount} />, hint: 'داخل التطبيق فقط' },
            ]}
          />

          <div className="shrink-0 bg-white px-2">
            <Tabs
              items={[
                { id: 'products' as TabId, label: 'المواد المباعة', count: report.products.length },
                { id: 'product-dates' as TabId, label: 'مبيعات المواد بالتاريخ', count: productDayRows.length },
                { id: 'daily' as TabId, label: 'منحنى الأيام', count: report.daily.length },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>

          <ReportSplit chart={chart} open={dock.open}>
            {tab === 'products' && (
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                columns={productColumns}
                rows={productRows}
                getRowId={p => p.articleSeq}
                filters
                storageKey="offer-sales-products-v2"
                exportName={`مواد-العرض-${report.offerId}`}
                counterLabel="مادة"
                emptyText="لا مبيعات لمواد هذا العرض"
                toolbar={chartToggle}
              />
            )}

            {tab === 'product-dates' && (
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                columns={productDayColumns}
                rows={productDayRows}
                getRowId={d => d.rowKey}
                filters
                storageKey="offer-sales-product-dates"
                exportName={`مواد-العرض-بالتاريخ-${report.offerId}`}
                counterLabel="سطر"
                emptyText="لا توجد تفاصيل يومية للمواد"
                toolbar={chartToggle}
              />
            )}

            {tab === 'daily' && (
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                columns={dailyColumns}
                rows={report.daily}
                getRowId={d => d.date}
                storageKey="offer-sales-daily"
                exportName={`يومي-العرض-${report.offerId}`}
                counterLabel="يوم"
                emptyText="لا بيانات يومية"
                toolbar={chartToggle}
              />
            )}
          </ReportSplit>
        </ReportFill>
      )}
    </ReportAppWindow>
  );
}
