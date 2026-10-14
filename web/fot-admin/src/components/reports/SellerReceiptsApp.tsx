import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { SalesmanSalesRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { IconReceipt, IconUser } from '@/components/icons';
import { EmptyState, Select } from '@/components/ui';
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
  ReportCenter,
  ReportError,
  ReportFill,
  ReportNote,
  ReportSplit,
  useChartDock,
  useReportPeriod,
} from './ReportKit';

const SELLER_KEY = 'fot_report_seller_receipts_salesman';

function loadSeller() {
  try {
    return localStorage.getItem(SELLER_KEY) ?? '';
  } catch {
    return '';
  }
}

type RankRow = SalesmanSalesRowDto & { rank: number; share: number; label: string };

const rankColumns: GridColumn<RankRow>[] = [
  { key: 'rank', header: '#', width: 52, align: 'center', mono: true },
  { key: 'label', header: 'البائع', width: 220, render: r => <span className="font-semibold text-header">{r.label}</span> },
  { key: 'count', header: 'الفواتير', width: 110, mono: true, footer: 'sum' },
  { key: 'total', header: 'قيمة المبيعات', width: 150, mono: true, footer: 'sum', render: r => <span className="font-bold text-header">{formatCurrency(r.total)}</span> },
  {
    key: 'avg',
    header: 'متوسط الفاتورة',
    width: 140,
    mono: true,
    sortValue: r => (r.count ? r.total / r.count : 0),
    render: r => formatCurrency(r.count ? Math.round(r.total / r.count) : 0),
  },
  { key: 'share', header: 'الحصة من الفواتير', width: 130, mono: true, render: r => `${formatNum(Math.round(r.share))}%` },
];

export function SellerReceiptsApp({ onClose }: { onClose: () => void }) {
  const period = useReportPeriod({
    storageKey: 'seller-receipts',
    presets: ['today', 'yesterday', 'week', 'lastWeek', 'month', 'custom'],
    fallback: 'today',
  });
  const range = period.range;
  const [salesmanId, setSalesmanId] = useState(loadSeller);
  const dock = useChartDock();

  useEffect(() => {
    try {
      localStorage.setItem(SELLER_KEY, salesmanId);
    } catch { /* تجاهل */ }
  }, [salesmanId]);

  const salesmenQ = useQuery({
    queryKey: ['salesmen', 'receipt-app'],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });

  const salesQ = useQuery({
    queryKey: ['seller-receipts', range.from, range.to],
    queryFn: () => api.salesBySalesman(range.from, range.to),
    enabled: salesmanId !== '',
  });

  const salesmen = salesmenQ.data?.items ?? [];

  // البائع المحفوظ لم يعد موجوداً (حُذف/عُطّل) — نمسحه بعد تحميل القائمة
  useEffect(() => {
    if (!salesmenQ.data || salesmanId === '') return;
    if (!salesmenQ.data.items.some(s => String(s.id) === salesmanId)) setSalesmanId('');
  }, [salesmenQ.data, salesmanId]);

  const seller = salesmen.find(s => String(s.id) === salesmanId);
  const sellerName = seller ? (fixEdariName(seller.name) || seller.name || `#${seller.id}`) : '';
  const all = salesQ.data ?? [];
  const matched = all.filter(r => String(r.salesmanId) === salesmanId);
  const count = matched.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  const total = matched.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const ready = salesmanId !== '' && salesQ.isSuccess;
  const loading = salesmanId !== '' && salesQ.isLoading;

  // ترتيب البائع وحصته من فواتير الفترة
  const ranking = useMemo(() => {
    const sorted = [...all].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
    const pos = sorted.findIndex(r => String(r.salesmanId) === salesmanId);
    const allCount = sorted.reduce((s, r) => s + (Number(r.count) || 0), 0);
    return { sorted, pos, allCount };
  }, [all, salesmanId]);

  const rankRows: RankRow[] = useMemo(
    () => ranking.sorted.map((r, i) => ({
      ...r,
      count: Number(r.count) || 0,
      total: Number(r.total) || 0,
      rank: i + 1,
      share: ranking.allCount ? ((Number(r.count) || 0) / ranking.allCount) * 100 : 0,
      label: fixEdariName(r.name) || r.name || `#${r.salesmanId}`,
    })),
    [ranking],
  );

  function sheets(): ReportExcelSheet[] {
    if (!ready) return [];
    return [{
      name: 'فواتير البائع',
      title: 'فواتير البائع',
      subtitle: `${sellerName} · ${range.from}${range.from !== range.to ? ` → ${range.to}` : ''}`,
      headers: ['البائع', 'من', 'إلى', 'عدد الفواتير', 'قيمة المبيعات'],
      columnWidths: [160, 88, 88, 96, 120],
      rows: [[sellerName, range.from, range.to, count, total]],
    }];
  }

  const chart = ready && ranking.sorted.length > 1 ? (
    <ChartBlock title="مقارنة بالبائعين" subtitle="عدد الفواتير في نفس المدة — اضغط على بائع لعرضه">
      <HBarChart
        series={[{ key: 'count', label: 'الفواتير' }]}
        format={n => formatNum(n)}
        onSelect={item => setSalesmanId(String(item.id))}
        items={ranking.sorted.slice(0, 12).map(r => ({
          id: r.salesmanId,
          label: `${String(r.salesmanId) === salesmanId ? '● ' : ''}${fixEdariName(r.name) || r.name || `#${r.salesmanId}`}`,
          values: [Number(r.count) || 0],
          sub: formatCurrency(Number(r.total) || 0),
        }))}
      />
    </ChartBlock>
  ) : null;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #2dd4bf 0%, #0f766e 100%)"
      title="فواتير البائع"
      subtitle={sellerName ? `${sellerName} · ${period.label}` : 'اختر البائع والمدة لترى عدد فواتيره'}
      icon={<IconReceipt size={16} />}
      toolbar={
        <>
          <div className="w-full sm:w-[220px]">
            <Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)} className="!h-8 text-[12.5px]" aria-label="البائع">
              <option value="">اختر البائع…</option>
              {salesmen.map(s => (
                <option key={s.id} value={s.id}>{fixEdariName(s.name) || s.name || `#${s.id}`}</option>
              ))}
            </Select>
          </div>
          <PeriodSelector state={period} />
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`seller-receipts_${range.from}_${range.to}`} getSheets={sheets} disabled={!ready} />
          <PrintBtn title={`فواتير البائع — ${sellerName}`} getSheets={sheets} disabled={!ready} />
        </>
      }
      onClose={onClose}
    >
      {salesmanId === '' ? (
        <ReportCenter>
          <EmptyState
            icon={<IconUser size={24} />}
            title="اختر البائع"
            description="اختر بائعاً من القائمة أعلاه لترى عدد فواتيره وقيمة مبيعاته في المدة المحددة."
          />
        </ReportCenter>
      ) : (
        <ReportFill>
          {salesQ.isError && (
            <ReportBanner><ReportError error={salesQ.error} title="تعذّر جلب الفواتير" onRetry={() => void salesQ.refetch()} /></ReportBanner>
          )}

          <SummaryStrip
            loading={loading}
            cells={[
              { label: 'عدد الفواتير', value: formatNum(count), tone: 'brand', hint: sellerName },
              { label: 'قيمة المبيعات', value: <Money value={total} /> },
              { label: 'متوسط الفاتورة', value: <Money value={count ? total / count : 0} /> },
              {
                label: 'الترتيب بين البائعين',
                value: ranking.pos >= 0 ? `${formatNum(ranking.pos + 1)} / ${formatNum(ranking.sorted.length)}` : '—',
                hint: ranking.allCount ? `${formatNum(Math.round((count / ranking.allCount) * 100))}% من فواتير الفترة` : undefined,
              },
              { label: 'فواتير كل البائعين', value: formatNum(ranking.allCount) },
            ]}
          />

          {ready && count === 0 && (
            <ReportNote bar>لا فواتير لهذا البائع في هذه المدة — جرّب مدة أطول أو بائعاً آخر.</ReportNote>
          )}

          <ReportSplit chart={chart} open={dock.open}>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={rankColumns}
              rows={rankRows}
              getRowId={r => r.salesmanId}
              loading={loading}
              storageKey="seller-receipts-ranking"
              exportName={`فواتير-البائعين-${range.from}_${range.to}`}
              counterLabel="بائع"
              emptyText="لا فواتير لأي بائع في هذه المدة"
              selectedId={salesmanId ? Number(salesmanId) : undefined}
              onSelect={r => setSalesmanId(String(r.salesmanId))}
              badge={<span className="hidden text-[11px] text-slate-400 md:inline">اضغط على بائع لعرضه · ↑↓ للتنقل</span>}
              toolbar={chart ? <ChartToggle dock={dock} /> : undefined}
            />
          </ReportSplit>
        </ReportFill>
      )}
    </ReportAppWindow>
  );
}
