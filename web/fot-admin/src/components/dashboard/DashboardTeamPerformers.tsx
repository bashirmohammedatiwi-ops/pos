import { Link } from 'react-router-dom';
import { formatCurrency, formatNum } from '@/api/client';
import { fixEdariName } from '@/lib/text';

export function DashboardTeamPerformers({
  weekTopSalesmen,
  topCommDue,
  onTrackCount,
  atRiskCount,
}: {
  weekTopSalesmen: { salesmanId: number; name?: string; total: number; count?: number }[];
  topCommDue: { salesmanId: number; salesmanName?: string; balanceDue: number }[];
  onTrackCount: number;
  atRiskCount: number;
}) {
  const maxSales = Math.max(...weekTopSalesmen.map(s => s.total), 1);

  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <p className="text-[11px] font-bold text-header">ملخص الأهداف</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-center">
            <p className="text-[16px] font-bold tabular-nums text-emerald-700">{formatNum(onTrackCount)}</p>
            <p className="text-[9px] text-emerald-600">على المسار ≥70%</p>
          </div>
          <div className="rounded-md bg-amber-50 px-2 py-1.5 text-center">
            <p className="text-[16px] font-bold tabular-nums text-amber-700">{formatNum(atRiskCount)}</p>
            <p className="text-[9px] text-amber-600">تحتاج متابعة</p>
          </div>
        </div>
        <Link to="/targets" className="mt-1.5 block text-center text-[10px] font-semibold text-brand-700 hover:underline">
          كل الأهداف ←
        </Link>
      </div>

      {weekTopSalesmen.length > 0 && (
        <div className="rounded-lg border border-slate-200/90 bg-white p-2 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-header">البائعون — الأسبوع</p>
            <Link to="/salesmen" className="text-[9px] font-semibold text-brand-700 hover:underline">الإداري</Link>
          </div>
          <ul className="max-h-[320px] space-y-1.5 overflow-y-auto pe-1">
            {weekTopSalesmen.map((s, i) => (
              <li key={s.salesmanId}>
                <Link to="/reports" className="group block">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                        {i + 1}
                      </span>
                      <span className="truncate font-medium group-hover:text-brand-700">
                        {fixEdariName(s.name) || `#${s.salesmanId}`}
                      </span>
                    </span>
                    <span className={`shrink-0 font-bold tabular-nums ${s.total > 0 ? 'text-header' : 'text-slate-400'}`}>
                      {formatCurrency(s.total)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${s.total > 0 ? 'bg-brand-500' : 'bg-slate-200'}`}
                      style={{ width: `${s.total > 0 ? Math.max(8, (s.total / maxSales) * 100) : 0}%` }}
                    />
                  </div>
                  {s.count != null && (
                    <p className="mt-0.5 text-[9px] text-slate-400">{formatNum(s.count)} فاتورة</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topCommDue.length > 0 && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/30 p-2">
          <p className="mb-1 text-[10px] font-semibold text-amber-800">مستحقات عاجلة</p>
          <ul className="space-y-1">
            {topCommDue.slice(0, 3).map(c => (
              <li key={c.salesmanId} className="flex items-center justify-between gap-2 text-[11px]">
                <Link to="/reports" className="truncate font-medium hover:text-brand-700">
                  {fixEdariName(c.salesmanName) || `#${c.salesmanId}`}
                </Link>
                <span className="font-bold tabular-nums text-amber-700">{formatCurrency(c.balanceDue)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
