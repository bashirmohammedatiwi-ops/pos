import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatDate, formatNum } from '@/api/client';
import type { TargetReceiptRowDto, TargetRuleDto, TargetSalesmanRowDto } from '@/api/types';
import { DatePresets } from '@/components/DatePresets';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { useClientSort } from '@/components/grid/DataGrid';
import {
  Btn,
  Field,
  Input,
  Loading,
} from '@/components/ui';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { FilterChip, FilterFields, ProgressCell, SegmentedTabs, SoftChip, StatusChip } from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';

type ViewTab = 'salesmen' | 'target';
type CompareMode = 'daily' | 'weekly' | 'monthly';

const COMPARE_LABELS: Record<CompareMode, string> = {
  daily: 'يومي',
  weekly: 'أسبوعي',
  monthly: 'شهري',
};

function pctBar(p: number) {
  return Math.min(100, Math.max(0, p));
}

function comparePercent(row: TargetSalesmanRowDto, mode: CompareMode) {
  if (mode === 'daily') return row.dailyPercent;
  if (mode === 'weekly') return row.weeklyPercent;
  return row.monthlyPercent;
}

function compareTarget(row: TargetSalesmanRowDto, mode: CompareMode) {
  if (mode === 'daily') return row.dailyTarget;
  if (mode === 'weekly') return row.weeklyTarget;
  return row.monthlyTarget;
}

type SalesmanAgg = {
  salesmanId: number;
  salesmanName?: string;
  totalQty: number;
  targetsHit: number;
  targetsTotal: number;
  avgPercent: number;
};

/* أعمدة تقارير الأهداف — DataGrid موحد */
const salesmenTargetColumns: GridColumn<SalesmanAgg>[] = [
  {
    key: 'salesmanName',
    header: 'البائع',
    width: 180,
    render: s => (
      <Link to="/reports" className="font-semibold text-brand-700 hover:underline">
        {s.salesmanName ?? `#${s.salesmanId}`}
      </Link>
    ),
  },
  { key: 'totalQty', header: 'مباع', width: 110, mono: true, footer: 'sum', render: s => <span className="font-bold text-brand-700">{formatNum(s.totalQty)}</span> },
  { key: 'hit', header: 'أهداف محققة', width: 130, align: 'center', sortValue: s => s.targetsHit, render: s => <span className="font-semibold text-emerald-700">{s.targetsTotal ? `${s.targetsHit} / ${s.targetsTotal}` : '—'}</span> },
  { key: 'avgPercent', header: 'التقدم', width: 190, sortable: false, render: s => (s.targetsTotal ? <ProgressCell percent={pctBar(s.avgPercent)} tone={s.targetsHit === s.targetsTotal ? 'ok' : 'brand'} /> : '—') },
  {
    key: 'status',
    header: 'الحالة',
    width: 110,
    align: 'center',
    sortable: false,
    exportable: false,
    render: s =>
      !s.targetsTotal ? (
        <span className="text-[11px] text-slate-400">بدون هدف</span>
      ) : (
        <StatusChip active={s.targetsHit === s.targetsTotal} onLabel="حقق" offLabel="لم يحقق" />
      ),
  },
];

function targetDetailColumns(mode: CompareMode, isAmount: boolean): GridColumn<TargetSalesmanRowDto>[] {
  const unit = isAmount ? ' د.ع' : '';
  const fmt = (v: number) => `${formatNum(v)}${unit}`;
  return [
    { key: 'rank', header: '#', width: 56, align: 'center', mono: true },
    { key: 'salesmanName', header: 'البائع', width: 170, render: r => <span className="font-semibold text-header">{r.salesmanName ?? `#${r.salesmanId}`}</span> },
    { key: 'sold', header: 'مباع', width: 130, mono: true, footer: 'sum', sortValue: r => (isAmount ? r.amount ?? 0 : r.quantity), render: r => <span className="font-bold">{fmt(isAmount ? r.amount ?? 0 : r.quantity)}</span> },
    { key: 'target', header: `الهدف (${COMPARE_LABELS[mode]})`, width: 140, mono: true, render: r => <span className="text-slate-500">{compareTarget(r, mode) > 0 ? fmt(compareTarget(r, mode)) : '—'}</span> },
    {
      key: 'remain',
      header: 'المتبقي',
      width: 130,
      mono: true,
      sortValue: r => Math.max(0, compareTarget(r, mode) - (isAmount ? r.amount ?? 0 : r.quantity)),
      render: r => {
        const t = compareTarget(r, mode);
        const sold = isAmount ? r.amount ?? 0 : r.quantity;
        return <span className="text-slate-500">{t > 0 ? (t - sold > 0 ? fmt(t - sold) : 'تم') : '—'}</span>;
      },
    },
    {
      key: 'progress',
      header: 'التقدم',
      width: 190,
      sortable: false,
      render: r => (compareTarget(r, mode) > 0 ? <ProgressCell percent={pctBar(comparePercent(r, mode))} tone={comparePercent(r, mode) >= 100 ? 'ok' : 'brand'} /> : '—'),
    },
  ];
}

const receiptsColumns: GridColumn<TargetReceiptRowDto>[] = [
  {
    key: 'receiptId',
    header: 'الفاتورة',
    width: 110,
    render: r => (
      <Link to={`/receipts?highlight=${r.receiptId}`} className="font-semibold text-brand-700 hover:underline">
        #{r.receiptNumber ?? r.receiptId}
      </Link>
    ),
  },
  { key: 'saleDate', header: 'التاريخ', width: 150, sortValue: r => r.saleDate, render: r => <span className="text-[11px] text-slate-500">{formatDate(r.saleDate)}</span> },
  { key: 'salesmanName', header: 'البائع', width: 150 },
  { key: 'quantity', header: 'الكمية', width: 100, mono: true, footer: 'sum' },
  { key: 'lineAmount', header: 'المبلغ', width: 130, mono: true, footer: 'sum', render: r => formatCurrency(r.lineAmount) },
];

export function TargetReportsPanel({
  from,
  to,
  onFromChange,
  onToChange,
  filterTargetId,
  onFilterTargetIdChange,
  compareMode,
  onCompareModeChange,
  rules,
  onOpenEdit,
  embedded,
}: {
  from: string;
  to: string;
  onFromChange?: (v: string) => void;
  onToChange?: (v: string) => void;
  filterTargetId: number | '';
  onFilterTargetIdChange: (v: number | '') => void;
  compareMode: CompareMode;
  onCompareModeChange?: (v: CompareMode) => void;
  rules: TargetRuleDto[];
  onOpenEdit: (rule: TargetRuleDto) => void;
  embedded?: boolean;
}) {
  const { settings: periodSettings, periods } = useBusinessPeriod();
  const [view, setView] = useState<ViewTab>('salesmen');
  const [search, setSearch] = useState('');
  const [reachFilter, setReachFilter] = useState<'all' | 'hit' | 'miss'>('all');

  const activeTargetId = filterTargetId !== '' ? filterTargetId : rules.find(r => r.isActive)?.id;

  const allBreakdownsQ = useQuery({
    queryKey: ['target-breakdowns', from, to],
    queryFn: () => api.targetBreakdowns(from, to),
  });

  const detailQ = useQuery({
    queryKey: ['target-breakdown', activeTargetId, from, to],
    queryFn: () => api.targetBreakdown(activeTargetId!, from, to),
    enabled: activeTargetId != null && activeTargetId > 0 && view === 'target',
  });

  const receiptsQ = useQuery({
    queryKey: ['target-receipts', activeTargetId, from, to],
    queryFn: () => api.targetReceipts(activeTargetId!, from, to),
    enabled: activeTargetId != null && activeTargetId > 0 && view === 'target',
  });

  const allBreakdowns = allBreakdownsQ.data ?? [];
  const breakdown = detailQ.data;
  const activeRule = rules.find(r => r.id === activeTargetId);

  const { reached, withTarget, missed } = useMemo(() => {
    let hit = 0;
    let total = 0;
    let miss = 0;
    for (const b of allBreakdowns) {
      for (const row of b.salesmen) {
        const target = compareTarget(row, compareMode);
        if (target <= 0) continue;
        total++;
        if (comparePercent(row, compareMode) >= 100) hit++;
        else miss++;
      }
    }
    return { reached: hit, withTarget: total, missed: miss };
  }, [allBreakdowns, compareMode]);

  const aggregatedSalesmen = useMemo((): SalesmanAgg[] => {
    const map = new Map<number, SalesmanAgg>();
    for (const b of allBreakdowns) {
      for (const row of b.salesmen) {
        const target = compareTarget(row, compareMode);
        const percent = comparePercent(row, compareMode);
        const ex = map.get(row.salesmanId) ?? {
          salesmanId: row.salesmanId,
          salesmanName: row.salesmanName,
          totalQty: 0,
          targetsHit: 0,
          targetsTotal: 0,
          avgPercent: 0,
        };
        ex.totalQty += row.quantity;
        if (target > 0) {
          ex.targetsTotal++;
          if (percent >= 100) ex.targetsHit++;
          ex.avgPercent = ((ex.avgPercent * (ex.targetsTotal - 1)) + percent) / ex.targetsTotal;
        }
        map.set(row.salesmanId, ex);
      }
    }
    return [...map.values()].sort((a, b) => b.totalQty - a.totalQty);
  }, [allBreakdowns, compareMode]);

  const salesmenAccessors = useMemo(() => ({
    name: (s: SalesmanAgg) => s.salesmanName ?? '',
    qty: (s: SalesmanAgg) => s.totalQty,
    hit: (s: SalesmanAgg) => s.targetsHit,
    avg: (s: SalesmanAgg) => s.avgPercent,
  }), []);
  const salesmenSort = useClientSort(aggregatedSalesmen, salesmenAccessors, 'qty', 'desc');

  const filteredSalesmen = useMemo(() => {
    const q = search.trim().toLowerCase();
    return salesmenSort.sorted.filter(s => {
      if (q && !(s.salesmanName ?? '').toLowerCase().includes(q) && !String(s.salesmanId).includes(q)) return false;
      if (reachFilter === 'hit') return s.targetsTotal > 0 && s.targetsHit === s.targetsTotal;
      if (reachFilter === 'miss') return s.targetsTotal > 0 && s.targetsHit < s.targetsTotal;
      return true;
    });
  }, [salesmenSort.sorted, search, reachFilter]);

  const targetRows = useMemo(() => {
    const rows = breakdown?.salesmen ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (q && !(row.salesmanName ?? String(row.salesmanId)).toLowerCase().includes(q)) return false;
      if (reachFilter === 'all') return true;
      const target = compareTarget(row, compareMode);
      if (target <= 0) return reachFilter === 'miss';
      const hit = comparePercent(row, compareMode) >= 100;
      return reachFilter === 'hit' ? hit : !hit;
    });
  }, [breakdown?.salesmen, search, reachFilter, compareMode]);

  function exportSalesmen() {
    downloadCsv(
      `targets-salesmen_${from}_${to}.csv`,
      ['البائع', 'مباع', 'أهداف محققة', 'إجمالي أهداف', 'متوسط تقدم%'],
      filteredSalesmen.map(s => [
        s.salesmanName ?? s.salesmanId,
        s.totalQty,
        s.targetsHit,
        s.targetsTotal,
        s.avgPercent.toFixed(0),
      ]),
    );
  }

  function exportTarget() {
    if (!breakdown) return;
    downloadCsv(
      `target_${breakdown.ruleName}_${from}_${to}.csv`,
      ['البائع', 'مباع', 'هدف', 'تقدم%'],
      targetRows.map(row => [
        row.salesmanName ?? row.salesmanId,
        row.quantity,
        compareTarget(row, compareMode),
        comparePercent(row, compareMode).toFixed(0),
      ]),
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${embedded ? '' : 'space-y-4 p-4'}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-2 py-1.5">
        <SegmentedTabs
          compact
          value={view}
          onChange={id => {
            setView(id);
            if (id === 'target' && filterTargetId === '' && rules[0]) {
              onFilterTargetIdChange(rules.find(r => r.isActive)?.id ?? rules[0].id);
            }
          }}
          items={[
            { id: 'salesmen' as ViewTab, label: 'البائعون' },
            { id: 'target' as ViewTab, label: 'تفصيل هدف' },
          ]}
        />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بائع…"
          className="!w-36 !py-1 !text-[12px]"
        />
        {view === 'salesmen' && (
          <>
            <FilterChip compact active={reachFilter === 'all'} onClick={() => setReachFilter('all')}>الكل</FilterChip>
            <FilterChip compact active={reachFilter === 'hit'} onClick={() => setReachFilter('hit')}>حققوا {withTarget ? formatNum(reached) : ''}</FilterChip>
            <FilterChip compact active={reachFilter === 'miss'} onClick={() => setReachFilter('miss')}>لم يحققوا {missed ? formatNum(missed) : ''}</FilterChip>
          </>
        )}
        {view === 'target' && allBreakdowns.length > 0 && (
          <div className="flex max-w-[50%] flex-wrap gap-1 overflow-x-auto">
            {allBreakdowns.map(b => (
              <FilterChip
                key={b.ruleId}
                compact
                active={filterTargetId === b.ruleId}
                onClick={() => onFilterTargetIdChange(b.ruleId)}
              >
                {b.ruleName} · {formatNum(b.totalQuantity)}
              </FilterChip>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <Btn
          size="sm"
          variant="secondary"
          onClick={view === 'salesmen' ? exportSalesmen : exportTarget}
          disabled={view === 'salesmen' ? !filteredSalesmen.length : !targetRows.length}
        >
          CSV
        </Btn>
        {!embedded && onFromChange && onToChange && onCompareModeChange && (
          <FilterFields>
            <Field label="من">
              <Input type="date" value={from} onChange={e => onFromChange(e.target.value)} className="min-w-[130px]" />
            </Field>
            <Field label="إلى">
              <Input type="date" value={to} onChange={e => onToChange(e.target.value)} className="min-w-[130px]" />
            </Field>
            <SegmentedTabs
              value={compareMode}
              onChange={mode => {
                onCompareModeChange(mode);
                if (mode === 'daily') {
                  const d = new Date().toISOString().slice(0, 10);
                  onFromChange(d);
                  onToChange(d);
                } else if (mode === 'weekly') {
                  onFromChange(periods.currentWeek.from);
                  onToChange(periods.currentWeek.to);
                } else {
                  onFromChange(periods.currentMonth.from);
                  onToChange(periods.currentMonth.to);
                }
              }}
              items={[
                { id: 'daily' as CompareMode, label: 'يومي' },
                { id: 'weekly' as CompareMode, label: 'أسبوعي' },
                { id: 'monthly' as CompareMode, label: 'شهري' },
              ]}
            />
            <DatePresets mode="targets" periodSettings={periodSettings} onPick={(a, b) => { onFromChange(a); onToChange(b); }} />
          </FilterFields>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2 space-y-3">

          {view === 'salesmen' && (
            <>
              {allBreakdownsQ.isLoading && <Loading />}
              {!allBreakdownsQ.isLoading && (
                <DataGrid
                  embedded
                  fillHeight={embedded}
                  columns={salesmenTargetColumns}
                  rows={filteredSalesmen}
                  getRowId={s => s.salesmanId}
                  exportName={`أداء-البائعين-أهداف-${from}_${to}`}
                  counterLabel="بائع"
                  emptyText="لا بيانات — غيّر الفترة واضغط «استعراض»"
                  rowTone={s => (s.targetsTotal > 0 && s.targetsHit === s.targetsTotal ? 'bg-emerald-50/50' : undefined)}
                />
              )}

            </>
          )}

          {view === 'target' && (
            <>
              {!activeTargetId && (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-[13px] text-slate-500">
                  اختر هدفاً من القائمة أعلاه
                </p>
              )}

              {breakdown && activeRule && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-header">{breakdown.ruleName}</span>
                      {breakdown.trees.slice(0, 3).map(t => (
                        <SoftChip key={t.treeSeq}>{t.treeName ?? t.treeSeq}</SoftChip>
                      ))}
                      <SoftChip tone="brand">
                        {breakdown.targetType === 'amount'
                          ? `${formatNum(breakdown.totalAmount ?? 0)} د.ع مباع`
                          : `${formatNum(breakdown.totalQuantity)} مباع`}
                      </SoftChip>
                    </div>
                    <Btn size="sm" variant="secondary" onClick={() => onOpenEdit(activeRule)}>تعديل</Btn>
                  </div>

                  {detailQ.isLoading && <Loading />}

                  {!detailQ.isLoading && (
                    <DataGrid
                      embedded
                      fillHeight={embedded}
                      columns={targetDetailColumns(compareMode, breakdown.targetType === 'amount')}
                      rows={targetRows}
                      getRowId={r => r.salesmanId}
                      exportName={`تفصيل-الهدف-${breakdown.ruleName}`}
                      counterLabel="بائع"
                      emptyText="لا مبيعات مطابقة لهذا الهدف في الفترة"
                      rowTone={r => (compareTarget(r, compareMode) > 0 && comparePercent(r, compareMode) >= 100 ? 'bg-emerald-50/60' : undefined)}
                    />
                  )}

                  {(receiptsQ.data?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-[13px] font-bold text-header">فواتير مرتبطة ({formatNum(receiptsQ.data!.length)})</h3>
                      <DataGrid
                        columns={receiptsColumns}
                        rows={receiptsQ.data!.slice(0, 20)}
                        getRowId={r => `${r.receiptId}-${r.salesmanId}`}
                        maxHeight="300px"
                        exportName="فواتير-الهدف"
                        counterLabel="فاتورة"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
      </div>
    </div>
  );
}
