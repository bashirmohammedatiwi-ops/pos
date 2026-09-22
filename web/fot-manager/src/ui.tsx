import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { avgTicket, money, moneyIq, moneyK, pct, shareOf } from './api';
import type { HourBand, PersonShare, ReceiptGroup } from './insights';
import type { PeriodBounds, PeriodKind } from './period';

export function IconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
export function IconTeam() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" /><circle cx="16" cy="9" r="2.4" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6S14 16 14.6 19" />
      <path d="M15 14.6c2.2 0 4 1.2 4.6 3.4" />
    </svg>
  );
}
export function IconCashier() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M7 8V6a5 5 0 0 1 10 0v2" />
      <path d="M8 14h8M8 17h5" />
    </svg>
  );
}
export function IconGoal() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}
export function IconBox() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8.5 12 4l9 4.5-9 4.5L3 8.5z" /><path d="M3 8.5V16l9 4.5 9-4.5V8.5" /><path d="M12 13v7.5" />
    </svg>
  );
}
export function IconRefresh() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M20 12a8 8 0 1 1-2.2-5.5" /><path d="M20 4v5h-5" />
    </svg>
  );
}
export function IconOut() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M10 7V5a1 1 0 0 1 1-1h8v16h-8a1 1 0 0 1-1-1v-2" /><path d="M15 12H4m0 0 3-3M4 12l3 3" />
    </svg>
  );
}
export function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}
export function IconWatch() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 8v5l3 2" /><circle cx="12" cy="13" r="8" />
    </svg>
  );
}
export function IconReport() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v6h6M8 13h8M8 17h5" />
    </svg>
  );
}
export function IconBag() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
export function IconComm() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9 11h6" />
    </svg>
  );
}

const STROKE: Record<string, string> = {
  teal: '#0d9488', ok: '#15803d', goal: '#4338ca', warn: '#d97706', gold: '#0f766e',
};
const DONUT = ['#0f766e', '#4338ca', '#14b8a6', '#7c3aed', '#0ea5e9', '#c9a227', '#94a3b8'];

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3730a3" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#bm)" />
      <path d="M18 40 V24 l14-8 14 8 v16" fill="none" stroke="#ffffff" strokeWidth="3.2" />
      <circle cx="32" cy="34" r="6" fill="#fbbf24" />
    </svg>
  );
}

export function Avatar({ name, onClick }: { name: string; onClick?: () => void }) {
  const cls = 'grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-goal-soft text-base font-extrabold text-goal';
  const letter = (name || 'م').trim().charAt(0);
  if (onClick) return <button type="button" onClick={onClick} className={cls} aria-label="حسابي">{letter}</button>;
  return <span className={cls}>{letter}</span>;
}

export function Badge({ tone = 'gold', children }: { tone?: 'gold' | 'ok' | 'warn' | 'muted' | 'goal'; children: ReactNode }) {
  const map = {
    gold: 'bg-gold-soft text-gold',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    muted: 'bg-paper text-muted',
    goal: 'bg-goal-soft text-goal',
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${map[tone]}`}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card empty-card">
      <p className="text-lg font-extrabold">{title}</p>
      {hint && <p className="mt-2 text-sm leading-7 text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-danger/20 bg-danger-soft px-5 py-8 text-center">
      <p className="font-extrabold text-danger">{message}</p>
      {onRetry && (
        <button type="button" className="mt-4 rounded-full bg-ink px-5 py-2.5 text-sm font-extrabold text-paper" onClick={onRetry}>
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel h-24" />)}</div>;
}

export function SectionHead({ title, kicker, to, link, action }: { title: string; kicker?: string; to?: string; link?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2>{title}</h2>
      </div>
      {action}
      {to && link && <Link to={to} className="section-link">{link}</Link>}
    </div>
  );
}

export function Track({ value, tone = 'goal' }: { value: number; tone?: 'ok' | 'goal' | 'warn' | 'gold' }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className="track">
      <span className="track-mark" style={{ right: '50%' }} />
      <div className={`track-fill tone-${tone}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Bar({ value, max, tone = 'gold' }: { value: number; max: number; tone?: 'gold' | 'ok' | 'goal' }) {
  const width = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const color = tone === 'ok' ? 'bg-ok' : tone === 'goal' ? 'bg-goal' : 'bg-gold';
  return (
    <div className="bar">
      <div className={`bar-fill ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Ring({
  value, size = 88, tone = 'goal', label,
}: {
  value: number; size?: number; tone?: 'teal' | 'ok' | 'goal' | 'warn' | 'gold'; label?: string;
}) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  const color = STROKE[tone] || STROKE.goal;
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="34" fill="#f8fafc" />
      <circle cx="40" cy="40" r={r} stroke="#e2e8f0" strokeWidth="8" fill="none" />
      <circle
        cx="40" cy="40" r={r} fill="none" stroke={color}
        strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y={label ? 38 : 45} textAnchor="middle" fontSize="15" fontWeight="800" fill="#0f172a">{Math.round(v)}%</text>
      {label && <text x="40" y="52" textAnchor="middle" fontSize="8" fontWeight="700" fill="#64748b">{label}</text>}
    </svg>
  );
}

export function Donut({
  items, size = 168, center,
}: {
  items: { label: string; value: number }[];
  size?: number;
  center?: string;
}) {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const r = 56;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="donut" width={size} height={size} viewBox="0 0 160 160">
      <circle cx="80" cy="80" r={r} fill="none" stroke="#f1f5f9" strokeWidth="20" />
      {total > 0 && items.map((item, i) => {
        const dash = (Math.max(0, item.value) / total) * c;
        const el = (
          <circle
            key={`${item.label}-${i}`}
            cx="80" cy="80" r={r} fill="none"
            stroke={DONUT[i % DONUT.length]}
            strokeWidth="20"
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 80 80)"
          />
        );
        offset += dash;
        return el;
      })}
      <circle cx="80" cy="80" r="38" fill="#ffffff" />
      {center && (
        <text x="80" y="85" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0f172a">{center}</text>
      )}
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; value: string }[] }) {
  return (
    <ul className="legend">
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`}>
          <span className="legend-dot" style={{ background: DONUT[i % DONUT.length] }} />
          <span className="legend-name">{item.label}</span>
          <span className="legend-val num">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Medal({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : 'rn';
  return <span className={`medal ${cls}`}>{String(rank).padStart(2, '0')}</span>;
}

export function Delta({ value }: { value: number }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) {
    return <span className="text-xs font-extrabold text-muted">ثابت عن السابق</span>;
  }
  const up = value > 0;
  return <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {money(Math.abs(value))}% عن السابق</span>;
}

export function CountMoney({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 720);
      setN(value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{moneyIq(n)}</span>;
}

export function AreaChart({ values, height = 128 }: { values: number[]; height?: number }) {
  const uid = useId().replace(/:/g, '');
  const w = 400;
  const h = height;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - 10 - (v / max) * (h - 22);
    return { x, y, v };
  });
  const line = pts.map(p => `${p.x},${p.y}`).join(' ');
  const fill = `0,${h} ${line} ${w},${h}`;
  const last = pts[pts.length - 1];
  const peak = pts.reduce((a, b) => (b.v >= a.v ? b : a), pts[0] ?? { x: 0, y: h, v: 0 });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="area-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`ag-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4338ca" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#0f766e" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(p => (
        <line key={p} x1="0" x2={w} y1={10 + p * (h - 22)} y2={10 + p * (h - 22)} stroke="#e2e8f0" strokeDasharray="3 6" />
      ))}
      <polygon fill={`url(#ag-${uid})`} points={fill} />
      <polyline fill="none" stroke="#4338ca" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={line} />
      {peak && <circle cx={peak.x} cy={peak.y} r="4.5" fill="#0f766e" />}
      {last && <circle cx={last.x} cy={last.y} r="5" fill="#4338ca" stroke="#ffffff" strokeWidth="2" />}
    </svg>
  );
}

export function DayStrip({
  days, active, onSelect, metric = 'sales', today,
}: {
  days: { key: string; weekday: string; label: string; sales: number; commission: number }[];
  active?: string;
  onSelect?: (key: string) => void;
  metric?: 'sales' | 'commission';
  today?: string;
}) {
  const max = Math.max(...days.map(d => metric === 'sales' ? d.sales : d.commission), 1);
  return (
    <div className="day-strip">
      {days.map(d => {
        const v = metric === 'sales' ? d.sales : d.commission;
        return (
          <button
            key={d.key}
            type="button"
            className={`day-col ${active === d.key ? 'on' : ''} ${today === d.key ? 'today' : ''}`}
            onClick={() => onSelect?.(d.key)}
          >
            <span className="num text-[10px] font-extrabold text-goal">{v ? moneyK(v) : '—'}</span>
            <div className="day-bar-wrap">
              <div className="day-bar" style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
            </div>
            <small>{d.weekday || d.label}</small>
          </button>
        );
      })}
    </div>
  );
}

export function HourBands({ rows }: { rows: HourBand[] }) {
  return (
    <div className="hour-grid">
      {rows.map(r => (
        <article key={r.key} className="card hour-card">
          <p className="kicker">{r.hint}</p>
          <h3 className="text-base font-extrabold">{r.label}</h3>
          <p className="num mt-2 text-lg font-extrabold">{moneyIq(r.sales)}</p>
          <p className="mt-1 text-xs font-bold text-muted">{r.count} حركة</p>
        </article>
      ))}
    </div>
  );
}

export function InsightTile({
  kicker, title, value, hint, tone = 'gold',
}: {
  kicker: string; title: string; value: string; hint?: string; tone?: 'gold' | 'goal' | 'amber';
}) {
  return (
    <article className={`card insight-tile ${tone}`}>
      <div className="mark">{kicker.slice(0, 1)}</div>
      <p className="text-[11px] font-extrabold text-muted">{kicker}</p>
      <p className="mt-1 truncate text-sm font-extrabold">{title}</p>
      <p className="num tile-value mt-2 text-base font-extrabold">{value}</p>
      {hint && <p className="mt-1 text-[11px] font-bold text-muted">{hint}</p>}
    </article>
  );
}

export function LiveDot({ stale }: { stale?: boolean }) {
  return (
    <span className={`live-pill ${stale ? 'stale' : ''}`}>
      <i className="live-dot" />
      {stale ? 'مزامنة قديمة' : 'مباشر'}
    </span>
  );
}

export function PeriodCompareStrip({
  todaySales,
  todayReceipts,
  period,
  periodTotals,
  periodKind,
  setPeriodKind,
  weekSales,
  weekReceipts,
  payCommission,
  payLabel,
}: {
  todaySales: number;
  todayReceipts: number;
  period: PeriodBounds;
  periodTotals: { sales: number; receipts: number };
  periodKind: PeriodKind;
  setPeriodKind: (k: PeriodKind) => void;
  weekSales: number;
  weekReceipts: number;
  payCommission: number;
  payLabel: string;
}) {
  return (
    <section className="stat-compare">
      <button
        type="button"
        className={`stat-compare-cell ${periodKind === 'today' ? 'on' : ''}`}
        onClick={() => setPeriodKind('today')}
      >
        <p>اليوم</p>
        <strong className="num">{moneyIq(todaySales)}</strong>
        <span>{todayReceipts} فاتورة</span>
      </button>
      <div className={`stat-compare-cell highlight ${periodKind !== 'today' && periodKind !== 'week' ? 'on' : ''}`}>
        <p>{period.label}</p>
        <strong className="num">{moneyIq(periodTotals.sales)}</strong>
        <span>{periodTotals.receipts} فاتورة</span>
      </div>
      <button
        type="button"
        className={`stat-compare-cell ${periodKind === 'week' ? 'on' : ''}`}
        onClick={() => setPeriodKind('week')}
      >
        <p>الأسبوع</p>
        <strong className="num">{moneyIq(weekSales)}</strong>
        <span>{weekReceipts} فاتورة</span>
      </button>
      <Link to="/commissions" className="stat-compare-cell comm">
        <p>العمولات</p>
        <strong className="num">{moneyIq(payCommission)}</strong>
        <span>{payLabel}</span>
      </Link>
    </section>
  );
}

export function QuickNav() {
  const items = [
    { to: '/', label: 'اليوم', ico: '🏠' },
    { to: '/team', label: 'بائعون', ico: '👥' },
    { to: '/cashiers', label: 'كاشير', ico: '🧾' },
    { to: '/commissions', label: 'عمولات', ico: '💰' },
    { to: '/goals', label: 'أهداف', ico: '🎯' },
    { to: '/moves', label: 'فواتير', ico: '📦' },
    { to: '/watch', label: 'مباشر', ico: '📡' },
    { to: '/report', label: 'تقرير', ico: '📊' },
  ];
  return (
    <nav className="quick-nav" aria-label="اختصارات">
      {items.map(item => (
        <Link key={item.to} to={item.to} className="quick-nav-item">
          <span className="quick-nav-ico">{item.ico}</span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function RecentFeed({
  receipts,
  limit = 8,
  title = 'آخر الفواتير',
  to = '/moves',
}: {
  receipts: ReceiptGroup[];
  limit?: number;
  title?: string;
  to?: string;
}) {
  const list = receipts.slice(0, limit);
  if (!list.length) return null;
  return (
    <section className="panel live-feed">
      <SectionHead title={title} kicker="مباشر" to={to} link="الكل" />
      <div className="live-feed-list">
        {list.map(r => (
          <Link
            key={r.id}
            to={`/moves?q=${encodeURIComponent(String(r.receiptNumber || r.sellers[0] || ''))}`}
            className="live-feed-row stat-link"
          >
            <span className="live-feed-dot" />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">{r.receiptNumber ? `#${r.receiptNumber}` : 'فاتورة'}</p>
              <p className="truncate text-xs font-bold text-muted">
                {r.sellers.join(' · ') || '—'}{r.cashierName ? ` · ${r.cashierName}` : ''}
              </p>
            </div>
            <p className="num text-sm font-extrabold">{moneyIq(r.sales)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function FilterStats({
  items,
  active,
  onPick,
}: {
  items: { key: string; count: number; label: string }[];
  active: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="filter-stats">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          className={`filter-stat ${active === item.key ? 'on' : ''}`}
          onClick={() => onPick(item.key)}
        >
          <strong className="num">{item.count}</strong>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function CommandRail({
  items,
}: {
  items: { kicker: string; value: string; hint?: string; tone?: 'goal' | 'gold' | 'ok' | 'warn' | 'amber' }[];
}) {
  if (!items.length) return null;
  return (
    <div className="command-rail">
      {items.map(item => (
        <article key={item.kicker} className={`command-tile ${item.tone || ''}`}>
          <p className="kicker">{item.kicker}</p>
          <p className="command-val num">{item.value}</p>
          {item.hint && <p className="command-hint">{item.hint}</p>}
        </article>
      ))}
    </div>
  );
}

export function Podium({
  items,
  onPick,
}: {
  items: { id: string; name: string; value: string; hint?: string }[];
  onPick?: (item: { id: string; name: string }) => void;
}) {
  if (!items.length) return null;
  const slots = [
    { rank: 2 as const, item: items[1] },
    { rank: 1 as const, item: items[0] },
    { rank: 3 as const, item: items[2] },
  ];
  return (
    <div className="podium">
      {slots.map(slot => {
        if (!slot.item) return <div key={`empty-${slot.rank}`} />;
        const item = slot.item;
        const cls = `podium-card r${slot.rank}`;
        const body = (
          <>
            <Medal rank={slot.rank} />
            <p className="podium-name">{item.name}</p>
            <p className="podium-val num">{item.value}</p>
            {item.hint && <p className="podium-hint">{item.hint}</p>}
          </>
        );
        if (onPick) {
          return (
            <button key={item.id} type="button" className={cls} onClick={() => onPick(item)}>
              {body}
            </button>
          );
        }
        return <article key={item.id} className={cls}>{body}</article>;
      })}
    </div>
  );
}

export function QuickJump({ links }: { links: { to: string; label: string; hint: string }[] }) {
  return (
    <div className="action-grid">
      {links.map(l => (
        <Link key={l.to} to={l.to} className="action-tile">
          <p className="font-extrabold">{l.label}</p>
          <p className="mt-1 text-xs font-bold text-muted">{l.hint}</p>
        </Link>
      ))}
    </div>
  );
}

export function HealthMeter({
  score, label, tone,
}: {
  score: number; label: string; tone: 'ok' | 'goal' | 'warn' | 'gold';
}) {
  return (
    <div className={`health-card tone-${tone}`}>
      <Ring value={score} size={76} tone={tone} label="صحة" />
      <div className="min-w-0">
        <p className="kicker">نبض المحل</p>
        <p className="font-extrabold">{label}</p>
        <div className="mt-2"><Track value={score} tone={tone} /></div>
      </div>
    </div>
  );
}

export function ShareRow({
  rank, row, onClick,
}: {
  rank: number; row: PersonShare; onClick?: () => void;
}) {
  const inner = (
    <>
      <Medal rank={rank} />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-extrabold">{row.name}</p>
          <p className="num shrink-0 text-sm font-extrabold">{moneyIq(row.sales)}</p>
        </div>
        <div className="mt-2"><Bar value={row.share} max={100} tone="goal" /></div>
        <p className="mt-1 text-xs font-bold text-muted">
          {pct(row.share)} من المبيعات · {row.receipts} فاتورة · متوسط {moneyIq(row.avg)}
        </p>
      </div>
    </>
  );
  if (onClick) {
    return <button type="button" className="share-row" onClick={onClick}>{inner}</button>;
  }
  return <div className="share-row">{inner}</div>;
}

export function StatGrid({
  sales, receipts, totalSales,
}: {
  sales: number; commission?: number; pieceCount?: number; receipts: number; totalSales?: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <div className="detail-cell"><p>المبيعات</p><strong className="num">{moneyIq(sales)}</strong></div>
      <div className="detail-cell"><p>الفواتير</p><strong className="num">{receipts}</strong></div>
      <div className="detail-cell"><p>متوسط الفاتورة</p><strong className="num">{moneyIq(avgTicket(sales, receipts))}</strong></div>
      <div className="detail-cell"><p>حصة الأسبوع</p><strong className="num">{pct(shareOf(sales, totalSales ?? sales))}</strong></div>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-wrap">
      <IconSearch />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="search-field" />
    </div>
  );
}

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-extrabold leading-7">{title}</h2>
          <button type="button" className="rounded-full bg-paper px-3 py-1.5 text-sm font-extrabold" onClick={onClose}>إغلاق</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function WeekCompare({
  cur, prev, salesDelta, receiptDelta,
}: {
  cur?: { salesAmount: number; commissionAmount?: number; pieceCount?: number; receiptCount: number };
  prev?: { salesAmount: number; commissionAmount?: number; pieceCount?: number; receiptCount: number };
  salesDelta?: number;
  commDelta?: number;
  pieceDelta?: number;
  receiptDelta?: number;
}) {
  if (!cur || !prev) return null;
  const max = Math.max(cur.salesAmount, prev.salesAmount, 1);
  return (
    <section className="card compare-card">
      <SectionHead title="مقارنة بالأسبوع السابق" kicker="مبيعات وفواتير" />
      <div className="compare-cols">
        <div>
          <p className="text-[11px] font-extrabold text-goal">هذا الأسبوع</p>
          <p className="num mt-1 text-xl font-extrabold">{moneyIq(cur.salesAmount)}</p>
          <p className="mt-1 text-xs font-extrabold text-muted">{cur.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(cur.salesAmount, cur.receiptCount))}</p>
          <div className="mt-2"><Bar value={cur.salesAmount} max={max} tone="goal" /></div>
        </div>
        <div>
          <p className="text-[11px] font-extrabold text-muted">الأسبوع السابق</p>
          <p className="num mt-1 text-xl font-extrabold">{moneyIq(prev.salesAmount)}</p>
          <p className="mt-1 text-xs font-extrabold text-muted">{prev.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(prev.salesAmount, prev.receiptCount))}</p>
          <div className="mt-2"><Bar value={prev.salesAmount} max={max} /></div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {salesDelta != null && <Delta value={salesDelta} />}
        {receiptDelta != null && <span className="text-xs font-extrabold text-muted">فواتير <Delta value={receiptDelta} /></span>}
      </div>
    </section>
  );
}

export type FinderHit = { id: string; title: string; hint: string; to: string };

export function Finder({
  open, onClose, hits, onPick,
}: {
  open: boolean; onClose: () => void; hits: FinderHit[]; onPick: (hit: FinderHit) => void;
}) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = hits.filter(h => !q.trim() || h.title.includes(q.trim()) || h.hint.includes(q.trim())).slice(0, 14);
  useEffect(() => { setI(0); }, [q, open]);
  if (!open) return null;
  return (
    <div className="finder-bg" onClick={onClose}>
      <div className="finder" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          className="search-field"
          placeholder="ابحث عن بائع أو كاشير أو منتج أو فاتورة"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(list.length - 1, v + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(0, v - 1)); }
            if (e.key === 'Enter' && list[i]) onPick(list[i]);
          }}
        />
        <div className="finder-list">
          {list.map((hit, idx) => (
            <button key={hit.id} type="button" className={`finder-item ${idx === i ? 'on' : ''}`} onClick={() => onPick(hit)}>
              <span>
                <span className="block font-extrabold">{hit.title}</span>
                <span className="text-xs font-bold text-muted">{hit.hint}</span>
              </span>
            </button>
          ))}
          {!list.length && <p className="px-2 py-6 text-center text-sm font-bold text-muted">لا نتيجة</p>}
        </div>
      </div>
    </div>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  const show = useCallback((m: string) => {
    setMsg(m);
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 1800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast ${on ? 'on' : ''}`}>{msg}</div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  return useContext(ToastCtx);
}
