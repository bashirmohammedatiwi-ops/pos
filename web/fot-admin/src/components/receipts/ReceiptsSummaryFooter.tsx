import { formatCurrency, formatNum } from '@/api/client';
import type { ReceiptTotalsSummary } from '@/api/types';

export function ReceiptsSummaryFooter({
  summary,
  total,
  loading,
}: {
  summary?: ReceiptTotalsSummary;
  total?: number;
  loading?: boolean;
}) {
  const dash = loading ? '…' : '—';
  const s = summary;
  const totalDiscount = (s?.totalOffersDiscount ?? 0) + (s?.totalUserDiscount ?? 0) + (s?.totalItemsDiscount ?? 0);
  const cells = [
    { label: 'عدد الفواتير', value: s ? formatNum(s.receiptCount) : dash },
    { label: 'السجلات', value: total != null ? formatNum(total) : dash },
    { label: 'الإجمالي', value: s ? formatCurrency(s.grossTotal) : dash },
    { label: 'الخصم', value: s ? formatCurrency(totalDiscount) : dash },
    { label: 'الصافي', value: s ? formatCurrency(s.netTotal) : dash, strong: true },
    { label: 'الدفعة', value: s ? formatCurrency(s.totalPayment) : dash },
    { label: 'المرتجع', value: s ? formatCurrency(s.totalCashBack) : dash },
  ];

  return (
    <div className="shrink-0 overflow-x-auto border-t border-[#b4b4b4] bg-[#ededed]">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            {cells.map(c => (
              <th key={c.label} className="border border-[#b4b4b4] bg-[#e2e2e2] px-2 py-1 text-right font-bold text-slate-600">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cells.map(c => (
              <td
                key={c.label}
                className={`border border-[#b4b4b4] px-2 py-1.5 text-left num font-bold ${
                  c.strong ? 'bg-[#fff2cc] text-header' : 'bg-white text-slate-800'
                }`}
              >
                {c.value}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
