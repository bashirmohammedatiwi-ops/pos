import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatDate, formatNum } from '@/api/client';
import type {
  CommissionGapRow,
  CommissionHealthDto,
  CommissionLineDiagnoseDto,
  CommissionReceiptDiagnoseDto,
  CommissionReceiptReportRow,
} from '@/api/types';
import { useToast } from '@/components/Toast';
import { Btn, Field, Input, Loading } from '@/components/ui';
import { CompactStatsBar } from '@/components/workspace';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';

/**
 * خط أنابيب العمولات — جداول DataGrid موحدة + تشخيص فاتورة بتوسيع الصف داخل الجدول.
 */


export function CommissionHealthBanner({
  health,
  onRecalc,
  recalcPending,
}: {
  health?: CommissionHealthDto;
  onRecalc: () => void;
  recalcPending: boolean;
}) {
  if (!health) return null;
  const missing = health.missingCalculations;
  if (missing <= 0) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-[13px] font-semibold text-emerald-800">
        ✓ كل الأسطر المؤهلة محسوبة في هذه الفترة ({formatNum(health.calculatedLines)} سطراً)
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3">
      <p className="flex-1 text-[13px] font-semibold text-amber-900">
        {formatNum(missing)} سطراً مؤهلاً بلا حساب — {formatNum(health.linesWithoutSalesman)} منها بلا مندوب
      </p>
      <Btn size="sm" onClick={onRecalc} disabled={recalcPending}>
        {recalcPending ? 'جاري…' : 'إعادة حساب الفترة'}
      </Btn>
    </div>
  );
}

const STATUS_AR: Record<string, string> = {
  ok: 'محسوب',
  pending: 'مطابق لم يُحفظ',
  'no-match': 'لا مطابقة',
  'no-salesman': 'لا مندوب',
  'salesman-mismatch': 'المندوب لا يطابق',
  zero: 'ناتج صفر',
  skip: 'مستبعد',
};

export function CommissionPipelinePanel({
  from,
  to,
  onRecalc,
  recalcPending,
}: {
  from: string;
  to: string;
  onRecalc: () => void;
  recalcPending: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [receiptId, setReceiptId] = useState('');
  const [expandedReceipt, setExpandedReceipt] = useState<number | null>(null);

  const healthQ = useQuery({
    queryKey: ['commission-health', from, to],
    queryFn: () => api.commissionHealth(from, to),
  });
  const receiptsQ = useQuery({
    queryKey: ['commission-receipts', from, to],
    queryFn: () => api.commissionReceiptReport(from, to),
  });

  const diagnose = useMutation({
    mutationFn: (id: number) => api.commissionDiagnose(id),
    onSuccess: d => {
      setExpandedReceipt(d.receiptId);
      qc.invalidateQueries({ queryKey: ['commission-health'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التشخيص'),
  });

  const recalcOne = useMutation({
    mutationFn: (id: number) => api.recalculateCommissions({ receiptId: id }),
    onSuccess: () => {
      toast.success('أُعيد حساب الفاتورة');
      qc.invalidateQueries({ queryKey: ['commission-health'] });
      qc.invalidateQueries({ queryKey: ['commission-receipts'] });
      if (expandedReceipt != null) diagnose.mutate(expandedReceipt);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل إعادة الحساب'),
  });

  const health = healthQ.data;

  return (
    <div className="space-y-2 p-2">
      <CompactStatsBar
        items={[
          { label: 'مجاميع', value: formatNum(health?.activeGroups ?? 0) },
          { label: 'منتجات', value: formatNum(health?.linkedProducts ?? 0) },
          { label: 'أسطر', value: formatNum(health?.eligibleLines ?? 0), tone: 'brand' },
          {
            label: 'ناقص',
            value: formatNum(health?.missingCalculations ?? 0),
            tone: (health?.missingCalculations ?? 0) > 0 ? 'warn' : 'ok',
          },
        ]}
      />

      {healthQ.isLoading && <Loading />}

      {!!health?.hints.length && (
        <div className="space-y-2">
          {health.hints.map(h => (
            <p key={h} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700">{h}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="تشخيص فاتورة (رقم داخلي)">
          <Input
            value={receiptId}
            onChange={e => setReceiptId(e.target.value)}
            placeholder="مثال: 12045"
            className="w-40"
          />
        </Field>
        <Btn
          size="sm"
          variant="secondary"
          disabled={!Number(receiptId) || diagnose.isPending}
          onClick={() => diagnose.mutate(Number(receiptId))}
        >
          {diagnose.isPending ? 'جاري…' : 'افحص الفاتورة'}
        </Btn>
        <Btn size="sm" onClick={onRecalc} disabled={recalcPending}>
          {recalcPending ? 'جاري إعادة حساب الفترة…' : 'إعادة حساب كل فواتير الفترة'}
        </Btn>
      </div>

      {/* فواتير بعمولة — التشخيص يُفتح توسيعاً داخل الصف */}
      <DataGrid
        columns={receiptsColumns(from, to)}
        rows={receiptsQ.data ?? []}
        getRowId={r => r.receiptId}
        loading={receiptsQ.isLoading}
        maxHeight="480px"
        storageKey="commission-pipeline-receipts"
        exportName={`فواتير-العمولات-${from}_${to}`}
        counterLabel="فاتورة"
        emptyText="لا فواتير محسوبة — أعد الحساب أو راجع التشخيص"
        expansion={{
          isExpanded: r => expandedReceipt === r.receiptId,
          onToggle: r => {
            const next = expandedReceipt === r.receiptId ? null : r.receiptId;
            setExpandedReceipt(next);
            if (next != null && diagnose.data?.receiptId !== next) diagnose.mutate(next);
          },
          render: r => (
            <DiagnoseExpansion
              receiptId={r.receiptId}
              diag={diagnose.data?.receiptId === r.receiptId ? diagnose.data : undefined}
              loading={diagnose.isPending && diagnose.variables === r.receiptId}
              onRecalcOne={() => recalcOne.mutate(r.receiptId)}
              recalcPending={recalcOne.isPending}
            />
          ),
        }}
      />

      {/* أسطر ناقصة */}
      <DataGrid
        columns={gapsColumns()}
        rows={health?.gaps ?? []}
        getRowId={g => `${g.receiptId}-${g.articleId}-${g.reason}`}
        loading={healthQ.isLoading}
        maxHeight="320px"
        storageKey="commission-pipeline-gaps"
        exportName="أسطر-عمولة-ناقصة"
        counterLabel="سطر"
        emptyText="لا فجوات ظاهرة في الفترة"
        toolbar={
          <Btn
            size="sm"
            variant="secondary"
            disabled={recalcPending}
            onClick={onRecalc}
          >
            إعادة حساب الفترة
          </Btn>
        }
      />
    </div>
  );
}

/* ── توسيع التشخيص داخل صف الفاتورة ── */
function DiagnoseExpansion({
  receiptId: _receiptId,
  diag,
  loading,
  onRecalcOne,
  recalcPending,
}: {
  receiptId: number;
  diag?: CommissionReceiptDiagnoseDto;
  loading: boolean;
  onRecalcOne: () => void;
  recalcPending: boolean;
}) {
  return (
    <div className="space-y-2.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {diag && (
          <span className="text-[12px] text-slate-600">
            {diag.saleDate ? formatDate(diag.saleDate) : '—'} · مندوب الفاتورة {diag.receiptSalesmanId || 'غير محدد'} · {formatNum(diag.calculatedCount)}/{formatNum(diag.itemCount)} محسوب
          </span>
        )}
        <div className="flex-1" />
        <Btn size="sm" variant="secondary" disabled={recalcPending} onClick={onRecalcOne}>
          {recalcPending ? 'جاري…' : 'إعادة حساب هذه الفاتورة'}
        </Btn>
      </div>
      {loading && <Loading />}
      {!loading && diag && (
        <DataGrid
          columns={diagLinesColumns()}
          rows={diag.lines}
          getRowId={l => l.itemId}
          maxHeight="300px"
          exportName="تشخيص-العمولة"
          counterLabel="سطر"
          emptyText="لا أسطر في الفاتورة"
        />
      )}
    </div>
  );
}

/* ── الأعمدة ── */

function receiptsColumns(from: string, to: string): GridColumn<CommissionReceiptReportRow>[] {
  return [
    {
      key: 'receiptId',
      header: 'الفاتورة',
      width: 120,
      render: r => (
        <Link to={`/receipts?highlight=${r.receiptId}`} className="font-semibold text-brand-700 hover:underline">
          #{r.receiptNumber ?? r.receiptId}
        </Link>
      ),
    },
    { key: 'saleDate', header: 'التاريخ', width: 150, sortValue: r => r.saleDate ?? '', render: r => <span className="text-[11px] text-slate-500">{r.saleDate ? formatDate(r.saleDate) : '—'}</span> },
    { key: 'lineCount', header: 'الأسطر', width: 90, mono: true, footer: 'sum' },
    { key: 'totalCommission', header: 'العمولة', width: 140, mono: true, footer: 'sum', render: r => <span className="font-bold text-emerald-700">{formatCurrency(r.totalCommission)}</span> },
    { key: 'totalSales', header: 'المبيعات', width: 140, mono: true, footer: 'sum', render: r => <span className="text-slate-500">{formatCurrency(r.totalSales)}</span> },
    {
      key: 'actions',
      header: 'إجراء',
      width: 120,
      align: 'center',
      sortable: false,
      exportable: false,
      render: r => (
        <button
          type="button"
          className="text-[12px] font-semibold text-brand-700 hover:underline"
          onClick={e => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('fot-diagnose', { detail: r.receiptId }));
          }}
          title={`اضغط السهم لتوسيع التشخيص (${from} → ${to})`}
        >
          تشخيص
        </button>
      ),
    },
  ];
}

function diagLinesColumns(): GridColumn<CommissionLineDiagnoseDto>[] {
  return [
    { key: 'productName', header: 'المنتج', width: 220, render: l => <span className="block max-w-[220px] truncate font-semibold text-header">{l.productName ?? `#${l.articleId}`}</span> },
    { key: 'salesmanId', header: 'مندوب', width: 80, align: 'center', mono: true, render: l => l.salesmanId || '—' },
    { key: 'quantity', header: 'كمية', width: 80, mono: true, footer: 'sum' },
    {
      key: 'status',
      header: 'الحالة',
      width: 130,
      align: 'center',
      render: l => (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          l.status === 'ok' ? 'bg-emerald-100 text-emerald-800' : l.status === 'pending' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {STATUS_AR[l.status] ?? l.status}
        </span>
      ),
    },
    { key: 'commissionAmount', header: 'عمولة', width: 120, mono: true, footer: 'sum', render: l => (l.commissionAmount != null ? formatCurrency(l.commissionAmount) : '—') },
    { key: 'message', header: 'السبب', width: 300, render: l => <span className="text-[12px] text-slate-600">{l.message}</span> },
  ];
}

function gapsColumns(): GridColumn<CommissionGapRow>[] {
  return [
    {
      key: 'receiptId',
      header: 'الفاتورة',
      width: 110,
      render: g => (
        <Link to={`/receipts?highlight=${g.receiptId}`} className="font-semibold text-brand-700 hover:underline">
          #{g.receiptNumber ?? g.receiptId}
        </Link>
      ),
    },
    { key: 'productName', header: 'المنتج', width: 220, render: g => <span className="block max-w-[220px] truncate">{g.productName ?? `#${g.articleId}`}</span> },
    { key: 'salesmanName', header: 'المندوب', width: 140, render: g => g.salesmanName ?? (g.salesmanId ? `#${g.salesmanId}` : '—') },
    { key: 'reason', header: 'السبب', width: 320, render: g => <span className="text-[12px] text-slate-600">{g.reason}</span> },
  ];
}
