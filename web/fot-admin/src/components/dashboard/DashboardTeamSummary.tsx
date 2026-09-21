import { Link } from 'react-router-dom';

import { formatCurrency, formatNum } from '@/api/client';

import { businessWeekLabel } from '@/lib/businessPeriod';

import type { BusinessPeriodSettingsDto } from '@/api/types';



function TargetRing({ pct, name, href }: { pct: number; name: string; href: string }) {

  const r = 16;

  const size = 40;

  const cx = size / 2;

  const c = 2 * Math.PI * r;

  const offset = c - (Math.min(100, pct) / 100) * c;

  const color = pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';



  return (

    <Link

      to={href}

      className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 transition hover:border-brand-200 hover:bg-brand-50/30"

    >

      <div className="relative shrink-0" style={{ width: size, height: size }}>

        <svg width={size} height={size} className="-rotate-90">

          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e2e8f0" strokeWidth={3.5} />

          <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />

        </svg>

        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums text-header">

          {formatNum(pct, 0)}%

        </span>

      </div>

      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-header">{name}</span>

    </Link>

  );

}



export function DashboardTeamSummary({

  periodSettings,

  weekFrom,

  weekTo,

  commDue,

  commDueCount,

  weekCommission,

  atRiskCount,

  onTrackCount,

  activeOffers,

  inactiveOffers,

  topCommDue,

  atRiskTargets,

  embedded = false,

}: {

  periodSettings?: BusinessPeriodSettingsDto | null;

  weekFrom: string;

  weekTo: string;

  commDue: number;

  commDueCount: number;

  weekCommission: number;

  atRiskCount: number;

  onTrackCount?: number;

  activeOffers: number;

  inactiveOffers: number;

  topCommDue: { salesmanId: number; salesmanName?: string; balanceDue: number }[];

  atRiskTargets: { key: string; name: string; ruleId: number; salesmanId: number; pct: number }[];

  embedded?: boolean;

}) {

  const cards = [

    {

      to: '/reports',

      label: 'مستحق صرف',

      value: formatCurrency(commDue),

      sub: `${formatNum(commDueCount)} بائع`,

      accent: commDue ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200',

      valueTone: commDue ? 'text-amber-700' : 'text-header',

    },

    {

      to: '/reports',

      label: 'عمولات الأسبوع',

      value: formatCurrency(weekCommission),

      sub: 'إجمالي الفترة',

      accent: 'border-emerald-200 bg-emerald-50/40',

      valueTone: 'text-emerald-700',

    },

    {

      to: '/targets',

      label: 'على المسار',

      value: formatNum(onTrackCount ?? 0),

      sub: `${formatNum(atRiskCount)} تحتاج متابعة`,

      accent: atRiskCount ? 'border-orange-200 bg-orange-50/30' : 'border-emerald-200 bg-emerald-50/40',

      valueTone: atRiskCount ? 'text-amber-700' : 'text-emerald-700',

    },

    {

      to: '/offers',

      label: 'عروض نشطة',

      value: formatNum(activeOffers),

      sub: inactiveOffers > 0 ? `${formatNum(inactiveOffers)} متوقفة` : 'كلها نشطة',

      accent: 'border-brand-200 bg-brand-50/30',

      valueTone: 'text-header',

    },

  ];



  return (

    <div className="space-y-3">

      {embedded && (

        <p className="text-[11px] text-slate-500">

          {weekFrom} → {weekTo} · {businessWeekLabel(periodSettings)}

        </p>

      )}



      <div className={`grid gap-2 ${embedded ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>

        {cards.map(card => (

          <Link

            key={card.label}

            to={card.to}

            className={`rounded-lg border p-3 transition hover:shadow-sm ${card.accent}`}

          >

            <p className="text-[11px] font-medium text-slate-500">{card.label}</p>

            <p className={`mt-1 text-[18px] font-bold tabular-nums leading-none ${card.valueTone}`}>{card.value}</p>

            <p className="mt-1 text-[10px] text-slate-400">{card.sub}</p>

          </Link>

        ))}

      </div>



      {atRiskTargets.length > 0 && (

        <div>

          <p className="mb-2 text-[11px] font-semibold text-slate-500">أهداف تحت 70%</p>

          <div className="grid gap-2 sm:grid-cols-2">

            {atRiskTargets.map(t => (

              <TargetRing

                key={t.key}

                pct={t.pct}

                name={t.name}

                href="/reports"

              />

            ))}

          </div>

        </div>

      )}



      {!embedded && topCommDue.length > 0 && (

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">

          <div className="mb-2 flex items-center justify-between">

            <p className="text-[12px] font-bold text-amber-900">أعلى مستحقات صرف</p>

            <Link to="/reports" className="text-[11px] font-semibold text-brand-700 hover:underline">الكل</Link>

          </div>

          <ul className="space-y-1.5">

            {topCommDue.map((c, i) => (

              <li key={c.salesmanId}>

                <Link to="/reports" className="flex items-center gap-2 rounded-md bg-white/70 px-2.5 py-2 transition hover:bg-white">

                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-800">

                    {i + 1}

                  </span>

                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{c.salesmanName || `#${c.salesmanId}`}</span>

                  <span className="font-bold tabular-nums text-amber-700">{formatCurrency(c.balanceDue)}</span>

                </Link>

              </li>

            ))}

          </ul>

        </div>

      )}

    </div>

  );

}

