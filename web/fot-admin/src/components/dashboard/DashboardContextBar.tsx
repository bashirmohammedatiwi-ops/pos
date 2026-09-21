import { Link } from 'react-router-dom';
import { formatNum } from '@/api/client';
import { greeting, todayLabel } from './dashboardUtils';

export function DashboardContextBar({
  edariConnected,
  onlineTerminals,
  terminalCount,
  updatedAt,
  weekLabel,
}: {
  edariConnected?: boolean;
  onlineTerminals: number;
  terminalCount: number;
  updatedAt?: string | null;
  weekLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-header">{greeting()}</p>
        <p className="text-[11px] text-slate-500">{todayLabel()}{weekLabel ? ` · ${weekLabel}` : ''}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          on={!!edariConnected}
          onLabel="Edari متصل"
          offLabel="Edari منقطع"
          href="/edari"
        />
        <StatusPill
          on={terminalCount > 0 && onlineTerminals === terminalCount}
          onLabel={`${formatNum(onlineTerminals)} جهاز`}
          offLabel={terminalCount ? `${formatNum(onlineTerminals)}/${formatNum(terminalCount)} أجهزة` : 'لا أجهزة'}
          href="/terminals"
          warn={terminalCount > 0 && onlineTerminals < terminalCount}
        />
        {updatedAt && (
          <span className="rounded-md bg-slate-50 px-2 py-1 text-[10px] text-slate-400">
            تحديث {updatedAt}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusPill({
  on,
  onLabel,
  offLabel,
  href,
  warn,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  href: string;
  warn?: boolean;
}) {
  const tone = on ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : warn ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600';
  const dot = on ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-slate-400';

  return (
    <Link to={href} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition hover:opacity-90 ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {on ? onLabel : offLabel}
    </Link>
  );
}
