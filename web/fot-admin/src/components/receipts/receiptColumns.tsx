import {
  formatCurrency,
  formatDate,
  formatNum,
  receiptDisplayNumber,
  receiptGross,
  receiptKindLabel,
  receiptSyncLabel,
} from '@/api/client';
import type { ReceiptSummary } from '@/api/types';
import type { GridColumn } from '@/components/grid/DataGrid';

function dash(v?: string | null) {
  return v && v.trim() ? v : '—';
}

function kindChip(kind: number | undefined) {
  if (kind === 1) return <span className="text-red-700">مرتجع</span>;
  if (kind === 2) return <span className="text-violet-700">هدية</span>;
  return <span className="text-emerald-700">مبيعات</span>;
}

/** Cash box the sale was rung into — the account number leads, the name explains it. */
function CashBoxCell({ receipt }: { receipt: ReceiptSummary }) {
  const num = receipt.cashBoxNum?.trim();
  const name = receipt.cashBoxName?.trim();
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" title={name || undefined}>
      <span className="font-bold tabular-nums text-header">{num || `#${receipt.masterAccount}`}</span>
      {name && <span className="truncate text-[11px] text-slate-500">{name}</span>}
    </span>
  );
}

const baseColumns: GridColumn<ReceiptSummary>[] = [
  {
    key: 'number',
    header: 'رقم الإيصال',
    width: 100,
    pinned: 'start',
    mono: true,
    render: r => (
      <span className="inline-flex items-center gap-1">
        <span className="font-bold text-header">{receiptDisplayNumber(r)}</span>
        {r.wasEdited && (
          <span className="rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">معدّلة</span>
        )}
        {r.printedNumber && r.printedNumber !== r.number && (
          <span className="rounded bg-sky-100 px-1 text-[10px] font-bold text-sky-800" title="الرقم المطبوع على الورق">
            ورق {r.printedNumber}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'creationDate',
    header: 'التاريخ',
    width: 138,
    sortValue: r => r.creationDate,
    render: r => <span className="text-slate-600">{formatDate(r.creationDate)}</span>,
  },
  { key: 'cashierName', header: 'الكاشير', width: 88, render: r => r.cashierName ?? '—' },
  {
    key: 'grossAmount',
    header: 'المبلغ الكلي',
    width: 98,
    mono: true,
    sortValue: r => receiptGross(r),
    footer: 'sum',
    render: r => formatCurrency(receiptGross(r)),
  },
  {
    key: 'payment',
    header: 'المدفوع',
    width: 88,
    mono: true,
    footer: 'sum',
    render: r => formatCurrency(r.payment),
  },
  {
    key: 'cashBack',
    header: 'مرتجع',
    width: 78,
    mono: true,
    footer: 'sum',
    render: r => (r.cashBack > 0 ? formatCurrency(r.cashBack) : '—'),
  },
  {
    key: 'offersDiscount',
    header: 'خصم عروض',
    width: 86,
    mono: true,
    footer: 'sum',
    render: r => (r.offersDiscount > 0 ? formatCurrency(r.offersDiscount) : '—'),
  },
  {
    key: 'userDiscount',
    header: 'خصم مستخدم',
    width: 90,
    mono: true,
    footer: 'sum',
    render: r => (r.userDiscount > 0 ? formatCurrency(r.userDiscount) : '—'),
  },
  {
    key: 'discountQrPersonName',
    header: 'خصم بواسطة',
    width: 120,
    sortValue: r => r.discountQrPersonName ?? '',
    render: r => (r.discountQrPersonName?.trim()
      ? <span className="font-semibold text-amber-800">{r.discountQrPersonName}</span>
      : '—'),
  },
  {
    key: 'netAmount',
    header: 'الصافي',
    width: 88,
    mono: true,
    footer: 'sum',
    render: r => <span className="font-bold text-header">{formatCurrency(r.netAmount ?? r.totalAmount)}</span>,
  },
  {
    key: 'itemCount',
    header: 'أقلام',
    width: 58,
    align: 'center',
    mono: true,
    footer: 'sum',
    render: r => formatNum(r.itemCount),
  },
  {
    key: 'kind',
    header: 'النوع',
    width: 72,
    align: 'center',
    sortable: false,
    render: r => kindChip(r.kind),
  },
  { key: 'accountName', header: 'الحساب', width: 110, render: r => dash(r.accountName) },
  {
    key: 'cashBoxNum',
    header: 'الصندوق',
    width: 130,
    sortValue: r => r.cashBoxNum ?? '',
    render: r => (r.masterAccount ? <CashBoxCell receipt={r} /> : '—'),
  },
  { key: 'sectionName', header: 'القسم', width: 88, render: r => dash(r.sectionName) },
  {
    key: 'salesmanName',
    header: 'البائع',
    width: 112,
    sortValue: r => r.salesmanName ?? '',
    render: r =>
      (r.salesmanCount ?? 0) > 1 ? (
        <span className="font-semibold text-amber-700" title="افتح الفاتورة لرؤية بائع كل صنف">
          {r.salesmanCount} باعة
        </span>
      ) : (
        dash(r.salesmanName)
      ),
  },
  {
    key: 'synced',
    header: 'رقم الإداري',
    width: 88,
    align: 'center',
    sortable: false,
    render: r => (
      <span className={r.synced ? 'font-semibold text-sky-700' : 'text-slate-400'}>
        {receiptSyncLabel(r)}
      </span>
    ),
  },
];

const cardColumns: GridColumn<ReceiptSummary>[] = [
  { key: 'cardAccNo', header: 'رقم البطاقة', width: 120, mono: true, render: r => dash(r.cardAccNo) },
  { key: 'cardType', header: 'نوع البطاقة', width: 90, render: r => dash(r.cardType) },
  { key: 'cardRrn', header: 'رقم الوصل', width: 95, mono: true, render: r => dash(r.cardRrn) },
  { key: 'cardRefNo', header: 'رقم الحركة', width: 95, mono: true, render: r => dash(r.cardRefNo) },
  { key: 'cardTerminalId', header: 'رقم الجهاز', width: 100, mono: true, render: r => dash(r.cardTerminalId) },
  {
    key: 'cardTransTime',
    header: 'تاريخ الحركة',
    width: 118,
    render: r => (r.cardTransTime ? formatDate(r.cardTransTime) : '—'),
  },
  { key: 'cardName', header: 'اسم الكارت', width: 90, render: r => dash(r.cardName) },
  {
    key: 'cardAmount',
    header: 'قيمة الفاتورة',
    width: 98,
    mono: true,
    render: r => (r.cardAmount != null ? formatCurrency(r.cardAmount) : '—'),
  },
  { key: 'cardAcquirer', header: 'المصرف', width: 110, render: r => dash(r.cardAcquirer) },
  { key: 'cardAuthCode', header: 'رمز الموافقة', width: 95, mono: true, render: r => dash(r.cardAuthCode) },
];

export function buildReceiptColumns(showCardInfo: boolean): GridColumn<ReceiptSummary>[] {
  return showCardInfo ? [...baseColumns, ...cardColumns] : baseColumns;
}

export { receiptKindLabel };
