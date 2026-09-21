import type { ReactNode } from 'react';

import { formatNum } from '@/api/client';

import type { DashboardTab } from '@/hooks/useDashboardData';

import { IconChart, IconCloud, IconCoins, IconTrendUp } from '@/components/icons';



const TABS: { id: DashboardTab; label: string; icon: ReactNode; shortcut: string }[] = [

  { id: 'sales', label: 'المبيعات', icon: <IconTrendUp size={14} />, shortcut: '1' },

  { id: 'team', label: 'الفريق', icon: <IconCoins size={14} />, shortcut: '2' },

  { id: 'system', label: 'النظام', icon: <IconCloud size={14} />, shortcut: '3' },

  { id: 'reports', label: 'التقارير', icon: <IconChart size={14} />, shortcut: '4' },

];



export function DashboardTabs({

  tab,

  onTabChange,

  teamBadge,

  systemBadge,

}: {

  tab: DashboardTab;

  onTabChange: (t: DashboardTab) => void;

  teamBadge?: number;

  systemBadge?: number;

}) {

  const badges: Partial<Record<DashboardTab, number>> = { team: teamBadge, system: systemBadge };



  return (

    <nav className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/50 px-2" aria-label="أقسام لوحة التحكم">

      <div className="flex gap-0.5 overflow-x-auto">

        {TABS.map(t => {

          const active = tab === t.id;

          const badge = badges[t.id];

          return (

            <button

              key={t.id}

              type="button"

              onClick={() => onTabChange(t.id)}

              aria-current={active ? 'page' : undefined}

              title={`${t.label} (${t.shortcut})`}

              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] transition ${

                active

                  ? 'border-brand-600 bg-white font-semibold text-brand-800'

                  : 'border-transparent text-slate-500 hover:bg-white/60 hover:text-header'

              }`}

            >

              {t.icon}

              {t.label}

              {badge != null && badge > 0 && (

                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold num ${active ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-700'}`}>

                  {formatNum(badge)}

                </span>

              )}

            </button>

          );

        })}

      </div>

      <p className="hidden shrink-0 pe-1 text-[10px] text-slate-400 lg:block">1–4 للتبديل</p>

    </nav>

  );

}

