import { useQuery } from '@tanstack/react-query';
import {
  api,
  formatCurrency,
  formatDate,
  formatNum,
  receiptDisplayNumber,
  receiptKindLabel,
  receiptSyncLabel,
} from '@/api/client';
import type { ReceiptDetailDto, ReceiptItemDto, ReceiptSummary } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, Loading } from '@/components/ui';
import { copyText } from '@/lib/clipboard';
import { printReceipt } from '@/lib/print';
import { printReceiptA4, receiptTotals } from '@/lib/receiptPrint';
import { useToast } from '@/components/Toast';

const itemColumns: GridColumn<ReceiptItemDto>[] = [
  { key: 'idx', header: '#', width: 42, align: 'center', sortable: false, exportable: false, render: (_r, i) => formatNum(i + 1) },
  { key: 'name', header: 'المادة', width: 220, render: r => r.name ?? `#${r.articleId}` },
  { key: 'barcode', header: 'الباركود', width: 124, mono: true },
  { key: 'quantity', header: 'الكمية', width: 72, mono: true, footer: 'sum' },
  {
    key: 'originalPrice',
    header: 'الإفرادي',
    width: 92,
    mono: true,
    render: r => formatCurrency(r.originalPrice > 0 ? r.originalPrice : r.price),
  },
  {
    key: 'discount',
    header: 'الخصم',
    width: 80,
    mono: true,
    footer: 'sum',
    render: r => (r.discount > 0 ? formatCurrency(r.discount) : '—'),
  },
  { key: 'lineTotal', header: 'الإجمالي', width: 96, mono: true, footer: 'sum', render: r => formatCurrency(r.lineTotal) },
  {
    key: 'salesmanName',
    header: 'البائع',
    width: 130,
    sortValue: r => r.salesmanName ?? '',
    render: r => ((r.salesmanId ?? 0) > 0 ? (r.salesmanName ?? `#${r.salesmanId}`) : 'بدون بائع'),
  },
  { key: 'groupLabel', header: 'المجموعة', width: 100, render: r => r.groupLabel || '—' },
];

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <td className="border border-[#c5c5c5] p-0">
      <div className="grid grid-cols-[88px_minmax(0,1fr)]">
        <div className="border-e border-[#c5c5c5] bg-[#ededed] px-2 py-1 text-[11px] font-bold text-slate-600">{label}</div>
        <div className="bg-white px-2 py-1 text-[12px] font-semibold text-slate-800">{value}</div>
      </div>
    </td>
  );
}

export function ReceiptDetailSheet({
  receipt,
  detail,
  loadingDetail,
  onComplete,
}: {
  receipt: ReceiptSummary;
  detail?: ReceiptDetailDto;
  loadingDetail: boolean;
  onComplete?: () => void;
}) {
  const toast = useToast();
  const printQ = useQuery({ queryKey: ['print-settings'], queryFn: api.printSettings });
  const t = receiptTotals(receipt, detail);
  const discount = t.offers + t.user + t.items;

  async function printThermal() {
    if (!printQ.data || !detail) return;
    try {
      await printReceipt(receipt, detail, printQ.data);
      toast.success('أُرسلت الفاتورة للطباعة');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    }
  }

  async function printA4() {
    if (!detail) return;
    try {
      await printReceiptA4(receipt, detail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    }
  }

  return (
    <div className="space-y-2 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-header">
          فاتورة <span className="num">{receiptDisplayNumber(receipt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {onComplete && <Btn size="sm" onClick={onComplete}>إكمال التعليق</Btn>}
          <Btn
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await copyText(receiptDisplayNumber(receipt));
                toast.success('تم نسخ رقم الفاتورة');
              } catch {
                toast.error('تعذر النسخ');
              }
            }}
          >
            نسخ الرقم
          </Btn>
          <Btn size="sm" variant="secondary" disabled={!detail} onClick={() => void printThermal()}>
            طباعة حرارية
          </Btn>
          <Btn size="sm" disabled={!detail} onClick={() => void printA4()}>
            طباعة A4
          </Btn>
        </div>
      </div>

      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <tbody>
          <tr>
            <InfoCell label="الرقم" value={receiptDisplayNumber(receipt)} />
            <InfoCell label="التاريخ" value={formatDate(receipt.creationDate)} />
            <InfoCell label="النوع" value={receiptKindLabel(receipt)} />
            <InfoCell label="الكاشير" value={receipt.cashierName ?? '—'} />
          </tr>
          <tr>
            <InfoCell label="البائع" value={(receipt.salesmanCount ?? 0) > 1 ? `${receipt.salesmanCount} باعة` : (receipt.salesmanName ?? '—')} />
            <InfoCell label="الصندوق" value={receipt.cashBoxName || receipt.cashBoxNum || '—'} />
            <InfoCell label="القسم" value={receipt.sectionName ?? '—'} />
            <InfoCell label="الإداري" value={receiptSyncLabel(receipt)} />
          </tr>
          {(receipt.discountQrPersonName || detail?.discountQrPersonName) && (
            <tr>
              <InfoCell label="خصم بواسطة" value={receipt.discountQrPersonName || detail?.discountQrPersonName || '—'} />
              <InfoCell label="خصم الفاتورة" value={formatCurrency(receipt.userDiscount)} />
              <InfoCell label="الحساب" value={receipt.accountName ?? '—'} />
              <InfoCell label="الصافي" value={formatCurrency(receipt.netAmount ?? receipt.totalAmount)} />
            </tr>
          )}
        </tbody>
      </table>

      {loadingDetail && <Loading />}
      {!loadingDetail && detail && (
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
          <DataGrid
            variant="sheet"
            embedded
            columns={itemColumns}
            rows={detail.items}
            getRowId={r => r.id}
            maxHeight="280px"
            exportName={`فاتورة-${receiptDisplayNumber(receipt)}`}
            counterLabel="بند"
            emptyText="لا بنود في هذه الفاتورة"
            filters
          />
          <table className="h-fit w-full border-separate border-spacing-0 text-[12px]">
            <tbody>
              <TotalRow label="الإجمالي" value={t.sub} />
              <TotalRow label="الخصم" value={discount} negative={discount > 0} />
              <TotalRow label="الصافي للدفع" value={t.total} strong />
              <TotalRow label="الدفعة" value={t.paid} />
              <TotalRow label="المبلغ المرتجع" value={t.back} />
            </tbody>
          </table>
        </div>
      )}
      {!loadingDetail && !detail && (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">تعذّر تحميل التفاصيل</p>
      )}
    </div>
  );
}

function TotalRow({ label, value, strong, negative }: { label: string; value: number; strong?: boolean; negative?: boolean }) {
  return (
    <tr>
      <th className={`w-[58%] border border-[#b4b4b4] bg-[#ededed] px-2 py-1.5 text-right font-bold ${strong ? 'text-header' : 'text-slate-600'}`}>
        {label}
      </th>
      <td className={`border border-[#b4b4b4] px-2 py-1.5 text-left num font-bold ${strong ? 'bg-[#fff2cc] text-header' : 'bg-white text-slate-800'}`}>
        {negative ? `-${formatCurrency(value)}` : formatCurrency(value)}
      </td>
    </tr>
  );
}
