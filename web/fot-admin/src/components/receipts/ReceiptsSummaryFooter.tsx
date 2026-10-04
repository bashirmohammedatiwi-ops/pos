import { formatCurrency, formatNum } from '@/api/client';
import type { ReceiptTotalsSummary } from '@/api/types';
import { ClassicSummaryFooter } from '@/components/classic/ClassicListLayout';

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
  const dash = loading ? '…' : '—';
  const s = summary;
  const totalDiscount = (s?.totalOffersDiscount ?? 0) + (s?.totalUserDiscount ?? 0) + (s?.totalItemsDiscount ?? 0);

  return (
    <ClassicSummaryFooter
      title={truncated ? 'ملخص النتائج — يُعرض جزء من السجلات فقط' : 'ملخص النتائج'}
      total={total}
      totalLabel="سجلات معروضة"
      loading={loading}
      items={[
        { label: 'عدد الفواتير', value: s ? formatNum(s.receiptCount) : dash, accent: true },
        { label: 'الإجمالي', value: s ? formatCurrency(s.grossTotal) : dash },
        { label: 'الخصومات', value: s ? formatCurrency(totalDiscount) : dash },
        { label: 'الصافي', value: s ? formatCurrency(s.netTotal) : dash, accent: true },
        { label: 'المدفوع', value: s ? formatCurrency(s.totalPayment) : dash },
        { label: 'المرتجع', value: s ? formatCurrency(s.totalCashBack) : dash },
      ]}
    />
  );
}
