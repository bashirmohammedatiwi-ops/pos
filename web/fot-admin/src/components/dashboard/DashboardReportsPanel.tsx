import { Link } from 'react-router-dom';

import { formatCurrency, formatNum } from '@/api/client';

import { formatPeriodRange } from '@/lib/businessPeriod';

import { IconChart, IconCoins, IconPackage, IconTrendUp } from '@/components/icons';



export function DashboardReportsPanel({

  today,

  weekFrom,

  weekTo,

  monthFrom,

  monthTo,

  weekTotal,

  weekReceipts,

  sales,

  receipts,

  prevWeekTotal,

  pace,

}: {

  today: string;

  weekFrom: string;

  weekTo: string;

  monthFrom: string;

  monthTo: string;

  weekTotal: number;

  weekReceipts: number;

  sales: number;

  receipts: number;

  prevWeekTotal?: number;

  pace?: number;

}) {

  const weekDelta = prevWeekTotal && prevWeekTotal > 0

    ? Math.round(((weekTotal - prevWeekTotal) / prevWeekTotal) * 100)

    : null;



  const cards = [

    {

      title: 'مبيعات أسبوع العمل',

      desc: formatPeriodRange(weekFrom, weekTo),

      href: `/reports?from=${weekFrom}&to=${weekTo}&tab=1`,

      metric: formatCurrency(weekTotal),

      tag: weekDelta != null ? `${weekDelta >= 0 ? '+' : ''}${weekDelta}%` : 'أسبوع',

      icon: IconTrendUp,

      accent: 'border-brand-200 bg-brand-50/30',

    },

    {

      title: 'تقرير نقد اليوم',

      desc: `${formatNum(receipts)} فاتورة · وتيرة ${formatNum(pace ?? 0)}%`,

      href: `/reports?from=${today}&to=${today}&tab=3`,

      metric: formatCurrency(sales),

      tag: 'اليوم',

      icon: IconChart,

      accent: 'border-slate-200 bg-white',

    },

    {

      title: 'أداء البائعين',

      desc: `${formatNum(weekReceipts)} فاتورة هذا الأسبوع`,

      href: `/reports?from=${weekFrom}&to=${weekTo}&tab=2`,

      metric: 'أسبوعي',

      tag: 'فريق',

      icon: IconCoins,

      accent: 'border-slate-200 bg-white',

    },

    {

      title: 'حركة المنتجات',

      desc: 'أكثر المنتجات مبيعاً',

      href: `/reports?from=${today}&to=${today}&tab=0`,

      metric: 'اليوم',

      tag: 'منتجات',

      icon: IconPackage,

      accent: 'border-slate-200 bg-white',

    },

    {

      title: 'ملخص الشهر',

      desc: formatPeriodRange(monthFrom, monthTo),

      href: `/reports?from=${monthFrom}&to=${monthTo}&tab=1`,

      metric: 'شهري',

      tag: 'ملخص',

      icon: IconChart,

      accent: 'border-slate-200 bg-white',

    },

    {

      title: 'تقرير العمولات',

      desc: 'مستحقات وعمولات الأسبوع',

      href: '/reports',

      metric: 'الفريق',

      tag: 'عمولات',

      icon: IconCoins,

      accent: 'border-slate-200 bg-white',

    },

  ];



  return (

    <div className="space-y-3">

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">

        {cards.map(card => {

          const Icon = card.icon;

          return (

            <Link

              key={card.title}

              to={card.href}

              className={`rounded-lg border px-3 py-3 transition hover:border-brand-300 hover:shadow-sm ${card.accent}`}

            >

              <div className="flex items-start justify-between gap-2">

                <span className="icon-tile h-8 w-8 bg-white text-brand-600 ring-1 ring-slate-100">

                  <Icon size={15} />

                </span>

                <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{card.tag}</span>

              </div>

              <p className="mt-2 text-[13px] font-bold text-header">{card.title}</p>

              <p className="mt-0.5 text-[11px] text-slate-500">{card.desc}</p>

              <p className="mt-2 text-[15px] font-bold tabular-nums text-brand-700">{card.metric}</p>

            </Link>

          );

        })}

      </div>



      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">

        <Link to="/reports" className="rounded-md bg-brand-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700">

          كل التقارير

        </Link>

        <Link to="/activity" className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-header hover:bg-slate-50">

          سجل النشاط

        </Link>

        <Link to={`/reports?from=${today}&to=${today}&tab=3`} className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-header hover:bg-slate-50">

          نقد اليوم

        </Link>

      </div>

    </div>

  );

}

