import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ReceiptSummary } from '@/api/types';
import { formatCurrency, receiptDisplayNumber, receiptKindLabel } from '@/api/client';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { kindClass, timeAgo } from './dashboardUtils';

/** النشاط المباشر — جدول مصغّر بأسلوب إكسل */
export function DashboardLiveFeed({
  receipts,
  loading,
}: {
  receipts: ReceiptSummary[];
  loading: boolean;
}) {
  const columns = useMemo<GridColumn<ReceiptSummary>[]>(() => [
    {
      key: 'number',
      header: 'الرقم',
      width: 88,
      mono: true,
      render: r => (
        <Link to={`/receipts?highlight=${r.id}`} className="text-[11px] font-bold text-header hover:text-brand-700 hover:underline">
          {receiptDisplayNumber(r)}
        </Link>
      ),
    },
    {
      key: 'kind',
      header: 'النوع',
      width: 64,
      align: 'center',
      sortable: false,
      render: r => (
        <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${kindClass(r.kind)}`}>
          {receiptKindLabel(r)}
        </span>
      ),
    },
    { key: 'netAmount', header: 'الصافي', width: 88, mono: true, footer: 'sum', render: r => <span className="text-[11px] font-bold">{formatCurrency(r.netAmount ?? r.totalAmount)}</span> },
    { key: 'when', header: 'قبل', width: 64, align: 'center', sortable: false, render: r => <span className="text-[9px] text-slate-400">{timeAgo(r.creationDate)}</span> },
  ], []);

  if (loading && !receipts.length) {
    return (
      <div className="space-y-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-7 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <DataGrid
      embedded
      columns={columns}
      rows={receipts.slice(0, 8)}
      getRowId={r => r.id}
      loading={loading}
      maxHeight="180px"
      exportName="النشاط-المباشر"
      counterLabel="حركة"
      emptyText="لا نشاط بعد"
    />
  );
}
