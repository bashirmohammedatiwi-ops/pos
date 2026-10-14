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
import { Alert, Badge, Btn, Field, Input, Loading } from '@/components/ui';
import { IconRefresh, IconSearch } from '@/components/icons';
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
      <Alert type="success">
        كل الأسطر المؤهلة محسوبة في هذه الفترة (<span className="num">{formatNum(health.calculatedLines)}</span> سطراً).
      </Alert>
    );
  }
  return (
    <Alert type="warning" title={`${formatNum(missing)} سطراً مؤهلاً بلا حساب`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{formatNum(health.linesWithoutSalesman)} منها بلا بائع على الفاتورة.</span>
        <Btn size="sm" icon={<IconRefresh size={14} />} onClick={onRecalc} loading={recalcPending}>
          إعادة حساب الفترة
        </Btn>
      </div>
    </Alert>
  );
}

const STATUS_AR: Record<string, string> = {
  ok: 'محسوب',
  pending: 'مطابق لم يُحفظ',
  'no-match': 'لا مطابقة',
  'no-salesman': 'بلا بائع',
  'salesman-mismatch': 'البائع لا يطابق',
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

      {healthQ.isError && (
        <Alert title="تعذر تحميل حالة العمولات">
          <Btn size="xs" variant="secondary" className="mt-1" onClick={() => healthQ.refetch()}>إعادة المحاولة</Btn>
        </Alert>
      )}

      {!!health?.hints.length && (
        <div className="space-y-2">
          {health.hints.map(h => (
            <Alert key={h} type="info">{h}</Alert>
          ))}
        </div>
      )}

      <form
        className="card flex flex-wrap items-end gap-2 p-3"
        onSubmit={e => {
          e.preventDefault();
          const id = Number(receiptId);
          if (id && !diagnose.isPending) diagnose.mutate(id);
        }}
      >
        <Field label="تشخيص فاتورة (رقم داخلي)">
          <Input
            value={receiptId}
            onChange={e => setReceiptId(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="مثال: 12045"
            inputMode="numeric"
            className="num w-40"
          />
        </Field>
        <Btn
          type="submit"
          variant="secondary"
          icon={<IconSearch size={14} />}
          disabled={!Number(receiptId)}
          loading={diagnose.isPending}
        >
          افحص الفاتورة
        </Btn>
        <div className="flex-1" />
        <Btn icon={<IconRefresh size={14} />} onClick={onRecalc} loading={recalcPending}>
          إعادة حساب كل فواتير الفترة
        </Btn>
      </form>

      {/* فواتير بعمولة — التشخيص يُفتح توسيعاً داخل الصف */}
      <DataGrid
        columns={receiptsColumns(id => {
          const next = expandedReceipt === id ? null : id;
          setExpandedReceipt(next);
          if (next != null && diagnose.data?.receiptId !== next) diagnose.mutate(next);
        }, expandedReceipt)}
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
            {diag.saleDate ? formatDate(diag.saleDate) : '—'} · بائع الفاتورة {diag.receiptSalesmanId || 'غير محدد'} · {formatNum(diag.calculatedCount)}/{formatNum(diag.itemCount)} محسوب
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

function receiptsColumns(
  onDiagnose: (receiptId: number) => void,
  expandedId: number | null,
): GridColumn<CommissionReceiptReportRow>[] {
  return [
    {
      key: 'receiptId',
      header: 'الفاتورة',
      width: 120,
      exportValue: r => `#${r.receiptNumber ?? r.receiptId}`,
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
        <Btn
          size="xs"
          variant={expandedId === r.receiptId ? 'soft' : 'ghost'}
          onClick={e => {
            e.stopPropagation();
            onDiagnose(r.receiptId);
          }}
          title="عرض تشخيص أسطر الفاتورة داخل الجدول"
        >
          {expandedId === r.receiptId ? 'إخفاء' : 'تشخيص'}
        </Btn>
      ),
    },
  ];
}

function diagLinesColumns(): GridColumn<CommissionLineDiagnoseDto>[] {
  return [
    { key: 'productName', header: 'المنتج', width: 220, render: l => <span className="block max-w-[220px] truncate font-semibold text-header">{l.productName ?? `#${l.articleId}`}</span> },
    { key: 'salesmanId', header: 'البائع', width: 80, align: 'center', mono: true, exportValue: l => l.salesmanId || '—', render: l => l.salesmanId || '—' },
    { key: 'quantity', header: 'كمية', width: 80, mono: true, footer: 'sum' },
    {
      key: 'status',
      header: 'الحالة',
      width: 130,
      align: 'center',
      exportValue: l => STATUS_AR[l.status] ?? l.status,
      render: l => (
        <Badge tone={l.status === 'ok' ? 'ok' : l.status === 'pending' ? 'info' : l.status === 'skip' ? 'default' : 'warn'}>
          {STATUS_AR[l.status] ?? l.status}
        </Badge>
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
      exportValue: g => `#${g.receiptNumber ?? g.receiptId}`,
      render: g => (
        <Link to={`/receipts?highlight=${g.receiptId}`} className="font-semibold text-brand-700 hover:underline">
          #{g.receiptNumber ?? g.receiptId}
        </Link>
      ),
    },
    { key: 'productName', header: 'المنتج', width: 220, render: g => <span className="block max-w-[220px] truncate">{g.productName ?? `#${g.articleId}`}</span> },
    { key: 'salesmanName', header: 'البائع', width: 140, render: g => g.salesmanName ?? (g.salesmanId ? `#${g.salesmanId}` : '—') },
    { key: 'reason', header: 'السبب', width: 320, render: g => <span className="text-[12px] text-slate-600">{g.reason}</span> },
  ];
}
