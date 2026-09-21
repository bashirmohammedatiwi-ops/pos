import { Link, useNavigate } from 'react-router-dom';
import type { ReceiptSummary } from '@/api/types';
import {
  formatCurrency,
  formatNum,
  receiptDisplayNumber,
  receiptKindLabel,
} from '@/api/client';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { kindClass } from './dashboardUtils';
import { FilterChip } from '@/components/workspace';

type KindFilter = 'all' | 0 | 1 | 2;

const recentColumns: GridColumn<ReceiptSummary>[] = [
  {
    key: 'number',
    header: 'الرقم',
    width: 110,
    mono: true,
    render: r => (
      <Link to={`/receipts?highlight=${r.id}`} className="font-bold text-header hover:text-brand-700 hover:underline">
        {receiptDisplayNumber(r)}
      </Link>
    ),
  },
  {
    key: 'kind',
    header: 'النوع',
    width: 90,
    align: 'center',
    sortable: false,
    render: r => (
      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${kindClass(r.kind)}`}>
        {receiptKindLabel(r)}
      </span>
    ),
  },
  { key: 'cashierName', header: 'الكاشير', width: 110 },
  { key: 'posName', header: 'نقطة البيع', width: 110, render: r => r.posName ?? '—' },
  { key: 'payment', header: 'المدفوع', width: 120, mono: true, footer: 'sum', render: r => formatCurrency(r.payment) },
  {
    key: 'netAmount',
    header: 'الصافي',
    width: 130,
    mono: true,
    footer: 'sum',
    render: r => <span className="font-bold text-header">{formatCurrency(r.netAmount ?? r.totalAmount)}</span>,
  },
  {
    key: 'synced',
    header: 'الإداري',
    width: 90,
    align: 'center',
    sortable: false,
    render: r => (r.synced ? <span className="text-sky-600">مزامن</span> : <span className="text-amber-600">محلي</span>),
  },
];

export function DashboardRecentReceipts({
  today,
  recent,
  loading,
  kindFilter,
  onKindFilterChange,
  kindCounts,
}: {
  today: string;
  recent: ReceiptSummary[];
  loading: boolean;
  kindFilter: KindFilter;
  onKindFilterChange: (v: KindFilter) => void;
  kindCounts?: { sale: number; return: number; gift: number };
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip compact active={kindFilter === 'all'} onClick={() => onKindFilterChange('all')}>
            الكل{kindCounts ? ` ${formatNum(kindCounts.sale + kindCounts.return + kindCounts.gift)}` : ''}
          </FilterChip>
          <FilterChip compact active={kindFilter === 0} onClick={() => onKindFilterChange(0)}>
            بيع{kindCounts ? ` ${formatNum(kindCounts.sale)}` : ''}
          </FilterChip>
          <FilterChip compact active={kindFilter === 1} onClick={() => onKindFilterChange(1)}>
            مرتجع{kindCounts ? ` ${formatNum(kindCounts.return)}` : ''}
          </FilterChip>
          <FilterChip compact active={kindFilter === 2} onClick={() => onKindFilterChange(2)}>
            هدية{kindCounts ? ` ${formatNum(kindCounts.gift)}` : ''}
          </FilterChip>
        </div>
        <Link to="/receipts" className="text-[12px] font-semibold text-brand-700 hover:underline">كل الفواتير</Link>
      </div>

      <DataGrid
        embedded
        fillHeight
        columns={recentColumns}
        rows={recent}
        getRowId={r => r.id}
        loading={loading}
        maxHeight="min(480px, 52vh)"
        storageKey="dashboard-recent"
        exportName={`أحدث-الفواتير-${today}`}
        counterLabel="فاتورة"
        emptyText="لا فواتير اليوم"
        onRowClick={r => navigate(`/receipts?highlight=${r.id}`)}
      />
    </div>
  );
}
