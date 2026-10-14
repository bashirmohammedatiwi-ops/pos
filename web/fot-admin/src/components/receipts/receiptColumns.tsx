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
import { Badge, type Tone } from '@/components/ui';

function dash(v?: string | null) {
  return v && v.trim() ? v : '—';
}

/** لون ونص نوع الفاتورة — المعلّقة (رقم 0) تتقدم لأنها تحتاج إكمالاً. */
export function receiptKindTone(r: Pick<ReceiptSummary, 'kind' | 'number' | 'kindLabel'>): { label: string; tone: Tone } {
  if (r.number === 0) return { label: 'معلّقة', tone: 'warn' };
  if (r.kind === 1) return { label: r.kindLabel ?? 'مرتجع', tone: 'danger' };
  if (r.kind === 2) return { label: r.kindLabel ?? 'هدية', tone: 'violet' };
  return { label: r.kindLabel ?? 'مبيعات', tone: 'ok' };
}

export function ReceiptKindBadge({ receipt, className }: { receipt: ReceiptSummary; className?: string }) {
  const k = receiptKindTone(receipt);
  return <Badge tone={k.tone} dot className={className}>{k.label}</Badge>;
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
    header: 'رقم الفاتورة',
    width: 120,
    pinned: 'start',
    mono: true,
    exportValue: r => (r.number === 0 && !r.displayNumber ? `#${r.id}` : receiptDisplayNumber(r)),
    render: r => (
      <span className="inline-flex items-center gap-1.5">
        <span className={`text-[13.5px] font-extrabold tabular-nums ${r.number === 0 ? 'text-amber-700' : 'text-header'}`}>
          {r.number === 0 && !r.displayNumber ? `#${r.id}` : receiptDisplayNumber(r)}
        </span>
        {r.wasEdited && (
          <span
            className="rounded-full bg-amber-50 px-1.5 text-[10.5px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200"
            title="عُدّلت بعد الحفظ — افتحها لرؤية قبل/بعد"
          >
            معدّلة
          </span>
        )}
        {r.printedNumber && r.printedNumber !== r.number && (
          <span
            className="rounded-full bg-sky-50 px-1.5 text-[10.5px] font-bold text-sky-800 ring-1 ring-inset ring-sky-200"
            title="الرقم المطبوع على الورق"
          >
            ورق {r.printedNumber}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'kind',
    header: 'النوع',
    width: 88,
    align: 'center',
    sortValue: r => (r.number === 0 ? -1 : r.kind),
    filterValue: r => receiptKindTone(r).label,
    exportValue: r => receiptKindTone(r).label,
    render: r => <ReceiptKindBadge receipt={r} />,
  },
  {
    key: 'creationDate',
    header: 'التاريخ',
    width: 138,
    sortValue: r => r.creationDate,
    render: r => <span className="text-slate-600">{formatDate(r.creationDate)}</span>,
  },
  { key: 'cashierName', header: 'الكاشير', width: 96, render: r => r.cashierName ?? '—' },
  {
    key: 'grossAmount',
    header: 'المبلغ الكلي',
    width: 104,
    mono: true,
    sortValue: r => receiptGross(r),
    footer: 'sum',
    render: r => formatCurrency(receiptGross(r)),
  },
  {
    key: 'offersDiscount',
    header: 'خصم العروض',
    width: 92,
    mono: true,
    footer: 'sum',
    render: r => (r.offersDiscount > 0 ? <span className="text-red-600">{formatCurrency(r.offersDiscount)}</span> : '—'),
  },
  {
    key: 'userDiscount',
    header: 'خصم يدوي',
    width: 90,
    mono: true,
    footer: 'sum',
    render: r => (r.userDiscount > 0 ? <span className="text-red-600">{formatCurrency(r.userDiscount)}</span> : '—'),
  },
  {
    key: 'netAmount',
    header: 'الصافي',
    width: 104,
    mono: true,
    footer: 'sum',
    sortValue: r => r.netAmount ?? r.totalAmount,
    render: r => <span className="font-bold text-header">{formatCurrency(r.netAmount ?? r.totalAmount)}</span>,
  },
  {
    key: 'payment',
    header: 'المدفوع',
    width: 96,
    mono: true,
    footer: 'sum',
    render: r => formatCurrency(r.payment),
  },
  {
    key: 'cashBack',
    header: 'الباقي للزبون',
    width: 92,
    mono: true,
    footer: 'sum',
    render: r => (r.cashBack > 0 ? formatCurrency(r.cashBack) : '—'),
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
    key: 'itemCount',
    header: 'الأصناف',
    width: 64,
    align: 'center',
    mono: true,
    footer: 'sum',
    render: r => formatNum(r.itemCount),
  },
  {
    key: 'salesmanName',
    header: 'البائع',
    width: 116,
    sortValue: r => r.salesmanName ?? '',
    exportValue: r => ((r.salesmanCount ?? 0) > 1 ? `${r.salesmanCount} باعة` : dash(r.salesmanName)),
    render: r =>
      (r.salesmanCount ?? 0) > 1 ? (
        <span className="font-semibold text-amber-700" title="افتح الفاتورة لرؤية بائع كل صنف">
          {r.salesmanCount} باعة
        </span>
      ) : (
        dash(r.salesmanName)
      ),
  },
  { key: 'sectionName', header: 'القسم', width: 92, render: r => dash(r.sectionName) },
  {
    key: 'posName',
    header: 'نقطة البيع',
    width: 110,
    // معرّف الجهاز الخام (win:…) طويل — نعرض آخر 6 خانات فقط
    sortValue: r => posLabel(r.posName),
    exportValue: r => posLabel(r.posName),
    render: r => <span className="block max-w-[150px] truncate" title={r.posName ?? ''}>{posLabel(r.posName)}</span>,
  },
  { key: 'accountName', header: 'الحساب', width: 110, render: r => dash(r.accountName) },
  {
    key: 'cashBoxNum',
    header: 'الصندوق',
    width: 130,
    sortValue: r => r.cashBoxNum ?? '',
    exportValue: r => {
      if (!r.masterAccount) return '—';
      const num = r.cashBoxNum?.trim() || `#${r.masterAccount}`;
      const name = r.cashBoxName?.trim();
      return name ? `${num} ${name}` : num;
    },
    render: r => (r.masterAccount ? <CashBoxCell receipt={r} /> : '—'),
  },
  {
    key: 'synced',
    header: 'رقم الإداري',
    width: 92,
    align: 'center',
    sortValue: r => (r.synced ? (r.edrNum ?? 1) : 0),
    filterValue: r => receiptSyncLabel(r),
    exportValue: r => receiptSyncLabel(r),
    render: r => (
      <span
        className={r.synced ? 'font-semibold tabular-nums text-sky-700' : 'text-slate-400'}
        title={r.synced ? 'رُحّلت للإداري' : 'لم تُرحَّل للإداري بعد'}
      >
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
    header: 'مبلغ البطاقة',
    width: 98,
    mono: true,
    render: r => (r.cardAmount != null ? formatCurrency(r.cardAmount) : '—'),
  },
  { key: 'cardAcquirer', header: 'المصرف', width: 110, render: r => dash(r.cardAcquirer) },
  { key: 'cardAuthCode', header: 'رمز الموافقة', width: 95, mono: true, render: r => dash(r.cardAuthCode) },
];

function posLabel(name?: string | null) {
  const n = (name ?? '').trim();
  if (!n) return '—';
  if (/^win:|^[0-9a-f-]{20,}$/i.test(n)) return `جهاز ${n.replace(/-/g, '').slice(-6).toUpperCase()}`;
  return n;
}

export function buildReceiptColumns(showCardInfo: boolean): GridColumn<ReceiptSummary>[] {
  return showCardInfo ? [...baseColumns, ...cardColumns] : baseColumns;
}

export { receiptKindLabel };
