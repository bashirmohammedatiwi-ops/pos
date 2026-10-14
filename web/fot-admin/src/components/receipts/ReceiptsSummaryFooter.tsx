import { formatNum } from '@/api/client';
import type { ReceiptTotalsSummary } from '@/api/types';
import { IconAlert } from '@/components/icons';

/** شريط مجاميع رفيع أسفل جدول الفواتير — يبقى مقروءاً بعد التمرير الطويل. */
export function ReceiptsSummaryFooter({
  summary,
  total,
  loading,
  truncated,
}: {
  summary?: ReceiptTotalsSummary;
  total?: number;
  loading?: boolean;
  truncated?: boolean;
}) {
  const s = summary;
  const totalDiscount = (s?.totalOffersDiscount ?? 0) + (s?.totalUserDiscount ?? 0) + (s?.totalItemsDiscount ?? 0);
  const cell = (v: number | undefined) => (loading ? '…' : v == null ? '—' : formatNum(v));

  const items: { label: string; value: string; strong?: boolean }[] = [
    { label: 'الفواتير', value: cell(s?.receiptCount) },
    { label: 'الإجمالي', value: cell(s?.grossTotal) },
    { label: 'الخصومات', value: s ? cell(totalDiscount) : cell(undefined) },
    { label: 'الصافي', value: cell(s?.netTotal), strong: true },
    { label: 'المدفوع', value: cell(s?.totalPayment) },
    { label: 'الباقي للزبائن', value: cell(s?.totalCashBack) },
  ];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-200 bg-slate-50/80 px-4 py-2 text-[12px]">
      {truncated ? (
        <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
          <IconAlert size={14} />
          يُعرض {total != null ? formatNum(total) : '—'} سجل فقط — المجاميع تشمل كل النتائج
        </span>
      ) : (
        <span className="font-semibold text-slate-500">
          {total != null ? formatNum(total) : '—'} سجل معروض
        </span>
      )}
      <span className="hidden h-4 w-px bg-slate-200 sm:block" />
      {items.map(it => (
        <span key={it.label} className="inline-flex items-baseline gap-1.5">
          <span className="text-slate-500">{it.label}</span>
          <span className={`num font-bold ${it.strong ? 'text-brand-800' : 'text-header'}`}>{it.value}</span>
        </span>
      ))}
      <span className="ms-auto text-[11px] text-slate-400">المبالغ بالدينار العراقي</span>
    </div>
  );
}
