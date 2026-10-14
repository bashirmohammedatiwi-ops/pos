import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { SalesmanCommissionSummaryDto, SalesmanDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, EmptyState } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { IconCoins, IconSliders, IconUsers } from '@/components/icons';
import { fixEdariName } from '@/lib/text';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { ReportAppWindow, ReportAside } from './ReportAppWindow';
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
  ReportSplit,
  useChartDock,
  useReportPeriod,
} from './ReportKit';

const PIN_KEY = 'fot_report_commissions_pinned';

function loadPinned(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map(Number).filter(n => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function savePinned(ids: number[]) {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(ids));
  } catch { /* تجاهل */ }
}

type Row = SalesmanCommissionSummaryDto & { sortIndex: number };

function columns(): GridColumn<Row>[] {
  return [
    {
      key: 'sortIndex',
      header: '#',
      width: 56,
      align: 'center',
      mono: true,
      render: r => r.sortIndex,
    },
    {
      key: 'salesmanName',
      header: 'البائع',
      width: 240,
      exportValue: r => fixEdariName(r.salesmanName) || `#${r.salesmanId}`,
      render: r => <span className="font-semibold text-header">{fixEdariName(r.salesmanName) || `#${r.salesmanId}`}</span>,
    },
    {
      key: 'totalCommission',
      header: 'عمولة الفترة',
      width: 160,
      mono: true,
      footer: 'sum',
      render: r => <span className="font-bold text-brand-800">{formatCurrency(r.totalCommission)}</span>,
    },
    {
      key: 'transactionCount',
      header: 'الحركات',
      width: 110,
      mono: true,
      footer: 'sum',
      align: 'center',
    },
    {
      key: 'paidOutTotal',
      header: 'مدفوع',
      width: 140,
      mono: true,
      footer: 'sum',
      render: r => formatCurrency(r.paidOutTotal),
    },
    {
      key: 'balanceDue',
      header: 'المستحق',
      width: 140,
      mono: true,
      footer: 'sum',
      render: r => (
        <span className={r.balanceDue > 0 ? 'font-bold text-amber-700' : 'text-slate-500'}>
          {formatCurrency(r.balanceDue)}
        </span>
      ),
    },
  ];
}

export function CommissionReportApp({ onClose }: { onClose: () => void }) {
  const period = useReportPeriod({
    storageKey: 'commissions',
    presets: ['week', 'lastWeek', 'month', 'lastMonth', 'custom'],
    fallback: 'week',
  });
  const range = period.range;
  const [pinned, setPinned] = useState<number[]>(loadPinned);
  const [settingsOpen, setSettingsOpen] = useState(pinned.length === 0);

  const salesmenQ = useQuery({
    queryKey: ['salesmen', true],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });
  const salesmen = salesmenQ.data?.items ?? [];

  const summaryQ = useQuery({
    queryKey: ['commission-summary', range.from, range.to],
    queryFn: () => api.commissionSummary(range.from, range.to),
    enabled: pinned.length > 0 && !!range.from && !!range.to,
  });

  const byId = useMemo(() => {
    const map = new Map<number, SalesmanCommissionSummaryDto>();
    for (const s of summaryQ.data ?? []) map.set(s.salesmanId, s);
    return map;
  }, [summaryQ.data]);

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of salesmen) map.set(s.id, fixEdariName(s.name) || `#${s.id}`);
    return map;
  }, [salesmen]);

  const rows: Row[] = useMemo(() => {
    return pinned.map((id, i) => {
      const hit = byId.get(id);
      return {
        salesmanId: id,
        salesmanName: hit?.salesmanName ? fixEdariName(hit.salesmanName) : (nameById.get(id) ?? `#${id}`),
        currencyCode: hit?.currencyCode ?? 'IQD',
        openingBalance: hit?.openingBalance ?? 0,
        paidOutTotal: hit?.paidOutTotal ?? 0,
        totalCommission: hit?.totalCommission ?? 0,
        transactionCount: hit?.transactionCount ?? 0,
        balanceDue: hit?.balanceDue ?? 0,
        notes: hit?.notes,
        sortIndex: i + 1,
      };
    });
  }, [pinned, byId, nameById]);

  const totals = useMemo(() => ({
    earned: rows.reduce((s, r) => s + r.totalCommission, 0),
    paid: rows.reduce((s, r) => s + r.paidOutTotal, 0),
    due: rows.reduce((s, r) => s + Math.max(0, r.balanceDue), 0),
    dueCount: rows.filter(r => r.balanceDue > 0).length,
    tx: rows.reduce((s, r) => s + r.transactionCount, 0),
  }), [rows]);

  function updatePinned(ids: number[]) {
    setPinned(ids);
    savePinned(ids);
  }

  function sheets(): ReportExcelSheet[] {
    return [{
      name: 'العمولات',
      title: 'تقرير العمولات',
      subtitle: `${range.from} → ${range.to}`,
      headers: ['#', 'البائع', 'عمولة الفترة', 'الحركات', 'مدفوع', 'المستحق'],
      columnWidths: [36, 160, 96, 72, 96, 96],
      rows: rows.map(r => [r.sortIndex, r.salesmanName, r.totalCommission, r.transactionCount, r.paidOutTotal, r.balanceDue]),
    }];
  }

  const loading = summaryQ.isLoading;
  const hasRows = pinned.length > 0;
  const dock = useChartDock();

  const chart = !loading && totals.earned + totals.paid > 0 ? (
    <ChartBlock title="العمولة مقابل المدفوع" subtitle="لكل بائع مثبت — مرّر للتفاصيل">
      <HBarChart
        series={[
          { key: 'earned', label: 'عمولة الفترة' },
          { key: 'paid', label: 'المدفوع' },
        ]}
        format={n => formatCurrency(n)}
        items={[...rows]
          .sort((a, b) => b.totalCommission - a.totalCommission)
          .slice(0, 12)
          .map(r => ({
            id: r.salesmanId,
            label: r.salesmanName || `#${r.salesmanId}`,
            values: [r.totalCommission, r.paidOutTotal],
            sub: r.balanceDue > 0 ? `المستحق ${formatCurrency(r.balanceDue)}` : undefined,
          }))}
      />
    </ChartBlock>
  ) : null;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #fbbf24 0%, #b45309 100%)"
      title="تقرير العمولات"
      subtitle={`${period.label} · ${formatNum(pinned.length)} بائع مثبت`}
      icon={<IconCoins size={16} />}
      toolbar={<PeriodSelector state={period} />}
      actions={
        <>
          <Btn
            size="sm"
            variant={settingsOpen ? 'soft' : 'ghost'}
            icon={<IconSliders size={14} />}
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(v => !v)}
          >
            البائعون
          </Btn>
          <ExcelBtn fileName={`عمولات-${range.from}_${range.to}`} getSheets={sheets} disabled={!hasRows || loading} />
          <PrintBtn title={`تقرير العمولات (${range.from} — ${range.to})`} getSheets={sheets} disabled={!hasRows || loading} />
        </>
      }
      aside={settingsOpen ? (
        <PinSettings
          salesmen={salesmen}
          pinned={pinned}
          onChange={updatePinned}
          onDone={() => setSettingsOpen(false)}
        />
      ) : undefined}
      onClose={onClose}
    >
      {!hasRows ? (
        <ReportCenter>
          <EmptyState
            icon={<IconUsers size={24} />}
            title="ثبّت البائعين مرة واحدة"
            description="اختر من يظهر في هذا التقرير. الاختيار يُحفظ على هذا الجهاز ويبقى عند كل فتح، ويمكن تعديله من «البائعون»."
            action={<Btn icon={<IconSliders size={14} />} onClick={() => setSettingsOpen(true)}>اختيار البائعين</Btn>}
          />
        </ReportCenter>
      ) : (
        <ReportFill>
          {summaryQ.isError && (
            <ReportBanner><ReportError error={summaryQ.error} onRetry={() => void summaryQ.refetch()} /></ReportBanner>
          )}

          <SummaryStrip
            loading={loading}
            cells={[
              { label: 'عمولة الفترة', value: <Money value={totals.earned} />, tone: 'brand', hint: `${formatNum(totals.tx)} حركة` },
              { label: 'المدفوع', value: <Money value={totals.paid} />, tone: 'ok' },
              {
                label: 'المستحق للصرف',
                value: <Money value={totals.due} />,
                tone: totals.due > 0 ? 'warn' : undefined,
                hint: totals.dueCount ? `${formatNum(totals.dueCount)} بائع لديهم مستحق` : 'لا مستحقات',
              },
              { label: 'متوسط العمولة / بائع', value: <Money value={rows.length ? totals.earned / rows.length : 0} /> },
              { label: 'بائعون مثبتون', value: formatNum(rows.length), hint: period.label },
            ]}
          />

          <ReportSplit chart={chart} open={dock.open}>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={columns()}
              rows={rows}
              getRowId={r => r.salesmanId}
              loading={loading}
              storageKey="commission-report-excel"
              exportName={`عمولات-${range.from}_${range.to}`}
              counterLabel="بائع"
              emptyText="لا عمولات في هذه الفترة — البائعون المثبتون يظهرون بصفر"
              rowTone={r => (r.balanceDue > 0 ? 'bg-amber-50/60' : undefined)}
              toolbar={chart ? <ChartToggle dock={dock} /> : undefined}
            />
          </ReportSplit>
        </ReportFill>
      )}
    </ReportAppWindow>
  );
}

function PinSettings({
  salesmen,
  pinned,
  onChange,
  onDone,
}: {
  salesmen: SalesmanDto[];
  pinned: number[];
  onChange: (ids: number[]) => void;
  onDone: () => void;
}) {
  return (
    <ReportAside
      title="البائعون الظاهرون"
      description="يُحفظ الاختيار على هذا الجهاز ويبقى عند كل فتح — عدّله متى شئت."
      footer={
        <>
          <span className="text-[12px] text-slate-500"><span className="num font-semibold">{formatNum(pinned.length)}</span> مثبت</span>
          <Btn size="sm" onClick={onDone}>تم</Btn>
        </>
      }
    >
      <SalesmanMultiSelect
        salesmen={salesmen.map(s => ({ id: s.id, name: fixEdariName(s.name) || `#${s.id}` }))}
        selectedIds={pinned}
        onChange={onChange}
        emptyLabel="لم يُختر أحد بعد"
      />
    </ReportAside>
  );
}
