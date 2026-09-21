import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatCommissionLabel,
  formatCurrency,
  formatDate,
} from '@/api/client';
import type { SalesmanCommissionSummaryDto, CommissionCalculationDto, BusinessPeriodSettingsDto } from '@/api/types';
import { downloadCsv } from '@/utils/exportCsv';
import { DatePresets } from '@/components/DatePresets';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useClientSort } from '@/components/grid/DataGrid';
import {
  Btn,
  Field,
  Input,
  Loading,
  Select,
} from '@/components/ui';
import { useToast } from '@/components/Toast';
import { CommissionHealthBanner, CommissionPipelinePanel } from '@/components/CommissionPipelinePanel';
import { FilterChip, FilterFields, InfoNote, SegmentedTabs, SoftChip } from '@/components/workspace';

type ViewTab = 'salesmen' | 'ledger' | 'tools';

/* أعمدة جدول ملخص البائعين — DataGrid موحد */
const summaryColumns: GridColumn<SalesmanCommissionSummaryDto>[] = [
  { key: 'salesmanName', header: 'البائع', width: 180, render: s => <span className="font-semibold text-header">{s.salesmanName ?? `#${s.salesmanId}`}</span> },
  { key: 'totalCommission', header: 'عمولة الفترة', width: 140, mono: true, footer: 'sum', render: s => <span className="font-bold text-brand-700">{formatCurrency(s.totalCommission, s.currencyCode)}</span> },
  { key: 'paidOutTotal', header: 'مدفوع', width: 130, mono: true, footer: 'sum', render: s => formatCurrency(s.paidOutTotal, s.currencyCode) },
  { key: 'balanceDue', header: 'المستحق', width: 140, mono: true, footer: 'sum', render: s => <span className={`font-bold ${s.balanceDue > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{formatCurrency(s.balanceDue, s.currencyCode)}</span> },
  { key: 'transactionCount', header: 'حركات', width: 90, mono: true, footer: 'sum' },
];

/* أعمدة سجل حركات العمولة */
const ledgerColumns: GridColumn<CommissionCalculationDto>[] = [
  { key: 'date', header: 'التاريخ', width: 140, sortValue: c => c.saleDate ?? c.calculatedAt, render: c => <span className="text-[11px] text-slate-500">{formatDate(c.saleDate ?? c.calculatedAt)}</span> },
  { key: 'salesmanName', header: 'البائع', width: 140, render: c => <span className="font-medium text-header">{c.salesmanName ?? '—'}</span> },
  { key: 'productName', header: 'المنتج', width: 220, render: c => <span className="block max-w-[220px] truncate">{c.productName ?? `#${c.articleId}`}</span> },
  { key: 'rule', header: 'القاعدة', width: 180, sortValue: c => c.commissionGroupName ?? '', render: c => <span className="text-[11px] text-slate-500">{c.commissionGroupName ?? 'قاعدة فردية'} · {formatCommissionLabel(c.commissionType, c.commissionValue)}</span> },
  { key: 'commissionAmount', header: 'العمولة', width: 130, mono: true, footer: 'sum', render: c => <span className="font-bold text-emerald-700">{formatCurrency(c.commissionAmount)}</span> },
  {
    key: 'receiptId',
    header: 'الفاتورة',
    width: 100,
    align: 'center',
    sortValue: c => c.receiptId,
    render: c => (
      <Link to={`/receipts?highlight=${c.receiptId}`} className="font-semibold text-brand-700 hover:underline">
        #{c.receiptNumber ?? c.receiptId}
      </Link>
    ),
  },
];

export function CommissionReportsPanel({
  from,
  to,
  onFromChange,
  onToChange,
  filterSalesman,
  onFilterSalesmanChange,
  onOpenProfile,
  periodSettings,
  embedded,
}: {
  from: string;
  to: string;
  onFromChange?: (v: string) => void;
  onToChange?: (v: string) => void;
  filterSalesman: string;
  onFilterSalesmanChange: (v: string) => void;
  onOpenProfile: (s: SalesmanCommissionSummaryDto) => void;
  periodSettings?: BusinessPeriodSettingsDto | null;
  /** الفلاتر في الشريط العلوي للصفحة — لا تكرار التاريخ هنا */
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<ViewTab>('salesmen');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const salesmanId = filterSalesman ? Number(filterSalesman) : undefined;

  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen() });
  const summaryQ = useQuery({
    queryKey: ['commission-summary', from, to],
    queryFn: () => api.commissionSummary(from, to),
  });
  const ledgerQ = useQuery({
    queryKey: ['commission-ledger', from, to, filterSalesman],
    queryFn: () => api.commissionCalculations(from, to, salesmanId, 500),
    enabled: view === 'ledger' || !!filterSalesman,
  });
  const healthQ = useQuery({
    queryKey: ['commission-health', from, to],
    queryFn: () => api.commissionHealth(from, to),
    enabled: view === 'tools',
  });

  const recalc = useMutation({
    mutationFn: () => api.recalculateCommissions({ from, to }),
    onSuccess: res => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['commission'] });
      qc.invalidateQueries({ queryKey: ['commission-health'] });
      qc.invalidateQueries({ queryKey: ['commission-summary'] });
      qc.invalidateQueries({ queryKey: ['commission-ledger'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل إعادة الحساب'),
  });

  const summary = summaryQ.data ?? [];

  const salesmanRows = useMemo(() => {
    let rows = summary.filter(s => s.transactionCount > 0 || s.balanceDue !== 0 || s.paidOutTotal !== 0);
    if (dueOnly) rows = rows.filter(s => s.balanceDue > 0);
    return rows;
  }, [summary, dueOnly]);

  const accessors = useMemo(() => ({
    name: (s: SalesmanCommissionSummaryDto) => s.salesmanName ?? '',
    earned: (s: SalesmanCommissionSummaryDto) => s.totalCommission,
    due: (s: SalesmanCommissionSummaryDto) => s.balanceDue,
    paid: (s: SalesmanCommissionSummaryDto) => s.paidOutTotal,
    tx: (s: SalesmanCommissionSummaryDto) => s.transactionCount,
  }), []);
  const sort = useClientSort(salesmanRows, accessors, 'due', 'desc');

  const filteredLedger = useMemo(() => {
    let rows = ledgerQ.data ?? [];
    if (salesmanId) rows = rows.filter(c => c.salesmanId === salesmanId);
    const q = ledgerSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(c =>
      (c.productName || '').toLowerCase().includes(q)
      || (c.salesmanName || '').toLowerCase().includes(q)
      || String(c.receiptId).includes(q),
    );
  }, [ledgerQ.data, ledgerSearch, salesmanId]);

  const selectedSummary = filterSalesman
    ? summary.find(s => String(s.salesmanId) === filterSalesman)
    : undefined;
  const selectedName = selectedSummary?.salesmanName
    ?? (filterSalesman ? salesmenQ.data?.items.find(s => String(s.id) === filterSalesman)?.name : null);

  function exportSalesmen() {
    downloadCsv(
      `commission-salesmen_${from}_${to}.csv`,
      ['البائع', 'عمولة الفترة', 'مدفوع', 'المستحق', 'حركات'],
      sort.sorted.map(s => [
        s.salesmanName ?? s.salesmanId,
        s.totalCommission,
        s.paidOutTotal,
        s.balanceDue,
        s.transactionCount,
      ]),
    );
  }

  function exportLedger() {
    downloadCsv(
      `commission-ledger_${from}_${to}.csv`,
      ['التاريخ', 'البائع', 'المنتج', 'العمولة', 'فاتورة'],
      filteredLedger.map(c => [
        formatDate(c.saleDate ?? c.calculatedAt),
        c.salesmanName ?? '',
        c.productName ?? c.articleId,
        c.commissionAmount,
        c.receiptId,
      ]),
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${embedded ? '' : 'space-y-4 p-4'}`}>
      <div className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-2 py-1.5 ${embedded ? '' : 'rounded-lg border border-slate-200'}`}>
        <SegmentedTabs
          compact
          value={view}
          onChange={setView}
          items={[
            { id: 'salesmen' as ViewTab, label: 'البائعون' },
            { id: 'ledger' as ViewTab, label: 'الحركات' },
            { id: 'tools' as ViewTab, label: 'أدوات' },
          ]}
        />
        {view === 'ledger' && (
          <Input
            value={ledgerSearch}
            onChange={e => setLedgerSearch(e.target.value)}
            placeholder="منتج، بائع، فاتورة…"
            className="!w-44 !py-1 !text-[12px]"
          />
        )}
        {view === 'salesmen' && (
          <FilterChip compact active={dueOnly} onClick={() => setDueOnly(d => !d)}>مستحق فقط</FilterChip>
        )}
        <div className="flex-1" />
        {view === 'salesmen' && (
          <Btn size="sm" variant="secondary" onClick={exportSalesmen} disabled={!sort.sorted.length}>CSV</Btn>
        )}
        {view === 'ledger' && (
          <Btn size="sm" variant="secondary" onClick={exportLedger} disabled={!filteredLedger.length}>CSV</Btn>
        )}
        {!embedded && onFromChange && onToChange && (
          <FilterFields>
            <Field label="من">
              <Input type="date" value={from} onChange={e => onFromChange(e.target.value)} className="min-w-[130px]" />
            </Field>
            <Field label="إلى">
              <Input type="date" value={to} onChange={e => onToChange(e.target.value)} className="min-w-[130px]" />
            </Field>
            <Field label="البائع">
              <Select value={filterSalesman} onChange={e => onFilterSalesmanChange(e.target.value)} className="min-w-[160px]">
                <option value="">كل البائعين</option>
                {(salesmenQ.data?.items ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <DatePresets mode="commissions" periodSettings={periodSettings} onPick={(a, b) => { onFromChange(a); onToChange(b); }} />
          </FilterFields>
        )}
      </div>

      {selectedName && (
        <InfoNote>
          عرض بائع: <span className="font-semibold">{selectedName}</span>
          {' · '}
          <button type="button" className="font-semibold underline" onClick={() => onFilterSalesmanChange('')}>الكل</button>
          {' · '}
          <button type="button" className="font-semibold underline" onClick={() => setView('ledger')}>حركاته</button>
          {selectedSummary && (
            <>
              {' · '}
              <button type="button" className="font-semibold underline" onClick={() => onOpenProfile(selectedSummary)}>صرف</button>
            </>
          )}
        </InfoNote>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2">
          {view === 'salesmen' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {summaryQ.isLoading && <Loading />}
              {!summaryQ.isLoading && (
                <DataGrid
                  embedded
                  fillHeight={embedded}
                  columns={summaryColumns}
                  rows={sort.sorted}
                  getRowId={s => s.salesmanId}
                  exportName={`عمولات-البائعين-${from}_${to}`}
                  counterLabel="بائع"
                  emptyText="لا عمولات — غيّر الفترة واضغط «استعراض» أو راجع تبويب أدوات"
                  initialSort={{ key: 'balanceDue', dir: 'desc' }}
                  badge={filterSalesman ? <SoftChip tone="brand">مُصفّى ببائع</SoftChip> : undefined}
                />
              )}
              <p className="shrink-0 text-[11px] text-slate-500">
                المستحق = رصيد + عمولة الفترة − مدفوع · الصرف من تبويب «الصرف»
              </p>
            </div>
          )}

          {view === 'ledger' && (
            <div className="min-h-0 flex-1">
              {ledgerQ.isLoading && <Loading />}
              {!ledgerQ.isLoading && (
                <DataGrid
                  embedded
                  fillHeight={embedded}
                  columns={ledgerColumns}
                  rows={filteredLedger}
                  getRowId={c => c.id}
                  exportName={`سجل-العمولات-${from}_${to}`}
                  counterLabel="حركة"
                  emptyText="لا حركات — وسّع الفترة أو أعد الحساب من «أدوات»"
                  initialSort={{ key: 'date', dir: 'desc' }}
                />
              )}
            </div>
          )}

          {view === 'tools' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="flex-1 text-[13px] text-slate-600">
                  إذا لم تظهر عمولات بعد البيع، أعد حساب الفترة المحددة أعلاه.
                </p>
                <Btn onClick={() => recalc.mutate()} disabled={recalc.isPending}>
                  {recalc.isPending ? 'جاري الحساب…' : 'إعادة حساب الفترة'}
                </Btn>
              </div>
              <CommissionHealthBanner
                health={healthQ.data}
                onRecalc={() => recalc.mutate()}
                recalcPending={recalc.isPending}
              />
              <CommissionPipelinePanel
                from={from}
                to={to}
                onRecalc={() => recalc.mutate()}
                recalcPending={recalc.isPending}
              />
            </div>
          )}
      </div>
    </div>
  );
}
