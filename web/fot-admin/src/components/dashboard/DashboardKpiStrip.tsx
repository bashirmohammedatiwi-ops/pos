import { Link } from 'react-router-dom';
import { formatCurrency, formatNum } from '@/api/client';
import { deltaArrow, deltaLabel, deltaTone } from './dashboardUtils';

type KpiItem = {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  featured?: boolean;
  delta?: { today: number; yesterday: number };
};

export function DashboardKpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map(item => {
        const body = (
          <div
            className={`rounded-lg border px-3 py-2.5 transition ${
              item.featured
                ? 'border-brand-200 bg-gradient-to-bl from-brand-50/80 to-white'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <p className="text-[11px] font-medium text-slate-500">{item.label}</p>
            <p className={`mt-1 font-bold tabular-nums text-header ${item.featured ? 'text-[20px]' : 'text-[16px]'}`}>
              {item.value}
            </p>
            {item.delta && (
              <p className={`mt-0.5 text-[10px] font-semibold ${deltaTone(item.delta.today, item.delta.yesterday)}`}>
                {deltaArrow(item.delta.today, item.delta.yesterday)} {deltaLabel(item.delta.today, item.delta.yesterday)} عن أمس
              </p>
            )}
            {item.hint && !item.delta && (
              <p className="mt-0.5 text-[10px] text-slate-400">{item.hint}</p>
            )}
          </div>
        );

        if (item.href) {
          return (
            <Link key={item.label} to={item.href} className="block">
              {body}
            </Link>
          );
        }
        return <div key={item.label}>{body}</div>;
      })}
    </div>
  );
}

export function buildDashboardKpis(input: {
  loading: boolean;
  sales: number;
  receipts: number;
  ySales: number;
  yReceipts: number;
  weekTotal: number;
  weekReceipts: number;
  onlineTerminals: number;
  terminalCount: number;
  today: string;
  weekFrom: string;
  weekTo: string;
}): KpiItem[] {
  const {
    loading,
    sales,
    receipts,
    ySales,
    yReceipts,
    weekTotal,
    weekReceipts,
    onlineTerminals,
    terminalCount,
    today,
    weekFrom,
    weekTo,
  } = input;

  return [
    {
      label: 'مبيعات اليوم',
      value: loading ? '…' : formatCurrency(sales),
      featured: true,
      delta: loading ? undefined : { today: sales, yesterday: ySales },
      href: `/reports?from=${today}&to=${today}&tab=3`,
    },
    {
      label: 'فواتير اليوم',
      value: loading ? '…' : formatNum(receipts),
      delta: loading ? undefined : { today: receipts, yesterday: yReceipts },
      href: `/receipts?from=${today}&to=${today}`,
    },
    {
      label: 'أسبوع العمل',
      value: loading ? '…' : formatCurrency(weekTotal),
      hint: loading ? undefined : `${formatNum(weekReceipts)} فاتورة`,
      href: `/reports?from=${weekFrom}&to=${weekTo}&tab=1`,
    },
    {
      label: 'نقاط البيع',
      value: loading ? '…' : `${formatNum(onlineTerminals)} / ${formatNum(terminalCount)}`,
      hint: terminalCount ? (onlineTerminals === terminalCount ? 'كلها متصلة' : 'بعضها متوقف') : 'لا أجهزة',
      href: '/terminals',
    },
  ];
}
