import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatNum, receiptDisplayNumber } from '@/api/client';
import type { ReceiptSummary } from '@/api/types';
import { EmptyState, Skeleton } from '@/components/ui';
import { fixEdariName } from '@/lib/text';
import { timeAgo, weekdayShort } from './dashboardUtils';

/* ── بطاقة قسم في الرئيسية ── */
export function HomeCard({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card flex min-w-0 flex-col ${className}`}>
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-header">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-brand-700 transition hover:bg-brand-50">
      {children} ←
    </Link>
  );
}

/* ── مخطط الأسبوع: أعمدة هذا الأسبوع مقابل الأسبوع السابق ── */
type Day = { date: string; total: number; receiptCount?: number };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function compact(v: number) {
  if (v >= 1_000_000) return `${formatNum(v / 1_000_000, 1)}M`;
  if (v >= 1_000) return `${formatNum(v / 1_000, 0)}K`;
  return formatNum(v);
}

export function WeekBarsChart({ days, prev, today, loading }: { days: Day[]; prev: Day[]; today: string; loading?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(1, ...days.map(d => d.total), ...prev.map(d => d.total))), [days, prev]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);

  if (loading) {
    return (
      <div className="flex h-[240px] items-end gap-3 px-4 pb-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="w-full" />
        ))}
      </div>
    );
  }

  const H = 200;
  return (
    <div className="relative px-4 pb-3">
      <div className="mb-2 flex items-center gap-4 text-[11.5px] text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />هذا الأسبوع</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />الأسبوع السابق</span>
      </div>
      <div className="flex gap-2">
        {/* محور القيم */}
        <div className="relative w-10 shrink-0" style={{ height: H }}>
          {ticks.map(t => (
            <span key={t} className="absolute left-0 -translate-y-1/2 text-[10px] text-slate-400 num" style={{ bottom: `${(t / max) * 100}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative" style={{ height: H }}>
            {ticks.map(t => (
              <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? 'border-slate-300' : 'border-dashed border-slate-100'}`} style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end justify-around gap-1">
              {days.map((d, i) => {
                const p = prev[i];
                const isToday = d.date.slice(0, 10) === today;
                const future = d.date.slice(0, 10) > today;
                return (
                  <div
                    key={d.date}
                    className={`relative flex h-full flex-1 cursor-default items-end justify-center gap-[3px] rounded-md transition ${hover === i ? 'bg-slate-50' : ''}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div className="w-[38%] max-w-[22px] rounded-t-[4px] bg-slate-200" style={{ height: `${((p?.total ?? 0) / max) * 100}%` }} />
                    <div
                      className={`w-[38%] max-w-[22px] rounded-t-[4px] transition-[height] duration-500 ${isToday ? 'bg-brand-600' : future ? 'bg-brand-200' : 'bg-brand-500'}`}
                      style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total > 0 ? 2 : 0 }}
                    />
                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full z-10 mb-2 w-44 animate-fade-in rounded-lg bg-slate-900 px-3 py-2 text-[11.5px] text-white shadow-pop">
                        <p className="mb-1 font-bold">{weekdayShort(d.date)} · {d.date.slice(5, 10)}</p>
                        <p className="flex justify-between gap-2"><span className="text-slate-400">هذا الأسبوع</span><span className="num font-semibold">{formatNum(d.total)}</span></p>
                        <p className="flex justify-between gap-2"><span className="text-slate-400">السابق</span><span className="num">{formatNum(p?.total ?? 0)}</span></p>
                        <p className="flex justify-between gap-2"><span className="text-slate-400">الفواتير</span><span className="num">{formatNum(d.receiptCount ?? 0)}</span></p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1.5 flex justify-around gap-1">
            {days.map(d => {
              const isToday = d.date.slice(0, 10) === today;
              return (
                <span key={d.date} className={`flex-1 text-center text-[11px] ${isToday ? 'font-bold text-brand-700' : 'text-slate-500'}`}>
                  {isToday ? 'اليوم' : weekdayShort(d.date)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── قائمة ترتيب بأشرطة نسبية ── */
export function RankList({
  rows,
  loading,
  empty,
  unit,
}: {
  rows: { key: string | number; label: string; value: number; sub?: string }[];
  loading?: boolean;
  empty: string;
  unit?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-3 px-4 pb-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  if (!rows.length) return <EmptyState compact title={empty} />;
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ol className="space-y-2.5 px-4 pb-4">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center gap-3">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold num ${
              i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[12.5px] font-semibold text-slate-800" title={r.label}>{r.label}</p>
              <p className="shrink-0 text-[12.5px] font-bold text-header num">
                {formatNum(r.value)}
                {unit && <span className="ms-1 text-[10px] font-medium text-slate-400">{unit}</span>}
              </p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-700" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
              {r.sub && <span className="shrink-0 text-[10.5px] text-slate-400 num">{r.sub}</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── آخر الفواتير ── */
function prettyPos(name?: string, section?: string) {
  const n = (name ?? '').trim();
  if (!n) return section || '—';
  if (/^win:|^[0-9a-f-]{20,}$/i.test(n)) return section ? `${section} · جهاز ${n.slice(-4)}` : `جهاز ${n.slice(-4)}`;
  return n;
}

const KIND: Record<number, { label: string; cls: string }> = {
  0: { label: 'بيع', cls: 'bg-emerald-50 text-emerald-700' },
  1: { label: 'مرتجع', cls: 'bg-red-50 text-red-700' },
  2: { label: 'هدية', cls: 'bg-violet-50 text-violet-700' },
};

export function RecentReceiptsList({ rows, loading }: { rows: ReceiptSummary[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2 px-4 pb-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }
  if (!rows.length) return <EmptyState compact title="لا توجد فواتير بعد اليوم" description="ستظهر هنا فور تسجيل أول عملية بيع." />;
  return (
    <div className="overflow-x-auto px-2 pb-2">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[11px] text-slate-400">
            <th className="px-2 py-1.5 text-right font-semibold">الفاتورة</th>
            <th className="px-2 py-1.5 text-right font-semibold">النوع</th>
            <th className="px-2 py-1.5 text-right font-semibold">الكاشير / البائع</th>
            <th className="px-2 py-1.5 text-right font-semibold">نقطة البيع</th>
            <th className="px-2 py-1.5 text-left font-semibold">المبلغ</th>
            <th className="px-2 py-1.5 text-left font-semibold">الوقت</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const k = KIND[r.kind ?? 0] ?? KIND[0];
            return (
              <tr key={r.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                <td className="px-2 py-2">
                  <Link to={`/receipts?search=${encodeURIComponent(receiptDisplayNumber(r))}&highlight=${r.id}`} className="font-bold text-slate-800 num hover:text-brand-700">
                    #{receiptDisplayNumber(r)}
                  </Link>
                </td>
                <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${k.cls}`}>{k.label}</span></td>
                <td className="max-w-[180px] truncate px-2 py-2 text-slate-600">
                  {r.cashierName || '—'}
                  {r.salesmanName ? <span className="text-slate-400"> · {fixEdariName(r.salesmanName)}</span> : null}
                </td>
                <td className="max-w-[140px] truncate px-2 py-2 text-slate-500">{prettyPos(r.posName, r.sectionName)}</td>
                <td className={`px-2 py-2 text-left font-bold num ${r.kind === 1 ? 'text-red-600' : 'text-header'}`}>{formatNum(r.totalAmount)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-left text-[11.5px] text-slate-400">{timeAgo(r.creationDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── مؤشر صحة دائري ── */
export function HealthRing({ score, label }: { score: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? '#0f9f76' : score >= 70 ? '#0ea5e9' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="#eef2f6" strokeWidth="8" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-bold leading-none text-header num">{score}</span>
        <span className="mt-0.5 text-[10px] font-semibold text-slate-500">{label}</span>
      </div>
    </div>
  );
}

/* ── سطر حالة نظام ── */
export function StatusLine({
  icon,
  label,
  value,
  tone,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  to?: string;
}) {
  const dot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', idle: 'bg-slate-300' }[tone];
  const inner = (
    <>
      <span className="icon-tile h-8 w-8 rounded-lg bg-slate-100 text-slate-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-slate-800">{label}</span>
        <span className="block truncate text-[11.5px] text-slate-500">{value}</span>
      </span>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
    </>
  );
  return to ? (
    <Link to={to} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50">{inner}</Link>
  ) : (
    <div className="flex items-center gap-3 px-2 py-2">{inner}</div>
  );
}

/* ── مبيعات اليوم بالساعة مقابل أمس ── */
export function HourBarsChart({
  today,
  prev,
  loading,
}: {
  today: { hour: number; total: number; count: number }[];
  prev: { hour: number; total: number; count: number }[];
  loading?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const byHour = useMemo(() => new Map(today.map(h => [h.hour, h])), [today]);
  const prevByHour = useMemo(() => new Map(prev.map(h => [h.hour, h])), [prev]);
  const nowHour = new Date().getHours();
  const hours = useMemo(() => {
    const all = [...today, ...prev].map(h => h.hour);
    const lo = Math.min(9, ...all);
    const hi = Math.max(22, ...all);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [today, prev]);
  const max = useMemo(
    () => niceMax(Math.max(1, ...today.map(h => h.total), ...prev.map(h => h.total))),
    [today, prev],
  );
  const ticks = [0, 0.5, 1].map(t => t * max);
  const H = 170;

  if (loading) {
    return (
      <div className="flex h-[200px] items-end gap-1.5 px-4 pb-6">
        {Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className="w-full" />)}
      </div>
    );
  }

  return (
    <div className="relative px-4 pb-3">
      <div className="mb-2 flex items-center gap-4 text-[11.5px] text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />اليوم</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />أمس بنفس الساعة</span>
      </div>
      <div className="flex gap-2">
        <div className="relative w-10 shrink-0" style={{ height: H }}>
          {ticks.map(t => (
            <span key={t} className="absolute left-0 -translate-y-1/2 text-[10px] text-slate-400 num" style={{ bottom: `${(t / max) * 100}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative" style={{ height: H }}>
            {ticks.map(t => (
              <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? 'border-slate-300' : 'border-dashed border-slate-100'}`} style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end justify-around gap-[3px]">
              {hours.map(h => {
                const d = byHour.get(h);
                const p = prevByHour.get(h);
                const future = h > nowHour;
                return (
                  <div
                    key={h}
                    className={`relative flex h-full flex-1 items-end justify-center gap-[2px] rounded transition ${hover === h ? 'bg-slate-50' : ''}`}
                    onMouseEnter={() => setHover(h)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div className="w-[40%] max-w-[14px] rounded-t-[3px] bg-slate-200" style={{ height: `${((p?.total ?? 0) / max) * 100}%` }} />
                    <div
                      className={`w-[40%] max-w-[14px] rounded-t-[3px] ${h === nowHour ? 'bg-brand-600' : future ? 'bg-brand-200' : 'bg-brand-500'}`}
                      style={{ height: `${((d?.total ?? 0) / max) * 100}%`, minHeight: d && d.total > 0 ? 2 : 0 }}
                    />
                    {hover === h && (
                      <div className="pointer-events-none absolute bottom-full z-10 mb-2 w-40 animate-fade-in rounded-lg bg-slate-900 px-3 py-2 text-[11.5px] text-white shadow-pop">
                        <p className="mb-1 font-bold num">{String(h).padStart(2, '0')}:00 – {String(h + 1).padStart(2, '0')}:00</p>
                        <p className="flex justify-between gap-2"><span className="text-slate-400">اليوم</span><span className="num font-semibold">{formatNum(d?.total ?? 0)}</span></p>
                        <p className="flex justify-between gap-2"><span className="text-slate-400">فواتير</span><span className="num">{formatNum(d?.count ?? 0)}</span></p>
                        <p className="flex justify-between gap-2"><span className="text-slate-400">أمس</span><span className="num">{formatNum(p?.total ?? 0)}</span></p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1.5 flex justify-around gap-[3px]">
            {hours.map(h => (
              <span key={h} className={`flex-1 text-center text-[10px] num ${h === nowHour ? 'font-bold text-brand-700' : 'text-slate-400'}`}>
                {h}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── توزيع بنسب (قسم/نقطة بيع/كاشير) ── */
export function ShareList({
  rows,
  loading,
  empty,
  prettyName,
}: {
  rows: { id: number; name: string; sub?: string | null; total: number; count: number }[];
  loading?: boolean;
  empty: string;
  prettyName?: (name: string, sub?: string | null) => string;
}) {
  if (loading) {
    return (
      <div className="space-y-2.5 px-4 pb-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
      </div>
    );
  }
  if (!rows.length) return <EmptyState compact title={empty} />;
  const sum = rows.reduce((n, r) => n + Math.max(0, r.total), 0) || 1;
  return (
    <ul className="space-y-2.5 px-4 pb-4">
      {rows.slice(0, 6).map(r => {
        const pctV = (Math.max(0, r.total) / sum) * 100;
        return (
          <li key={`${r.id}-${r.name}`}>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate font-semibold text-slate-800" title={r.name}>
                {prettyName ? prettyName(r.name, r.sub) : r.name}
              </span>
              <span className="shrink-0 font-bold text-header num">
                {formatNum(r.total)}
                <span className="ms-1.5 text-[10.5px] font-medium text-slate-400">{formatNum(pctV, 0)}%</span>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${pctV}%` }} />
              </div>
              <span className="w-16 shrink-0 text-left text-[10.5px] text-slate-400 num">{formatNum(r.count)} فاتورة</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export { prettyPos };
