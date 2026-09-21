import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money, moneyIq } from './api';

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
export function IconFloor() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h16v12H4z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /><path d="M4 12h16" />
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

const STROKE: Record<string, string> = {
  teal: '#0d9488', ok: '#15803d', goal: '#4338ca', warn: '#d97706', gold: '#0f766e',
};

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

export function SectionHead({ title, kicker, to, link }: { title: string; kicker?: string; to?: string; link?: string }) {
  return (
    <div className="section-head">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2>{title}</h2>
      </div>
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
  cur, prev,
}: {
  cur?: { salesAmount: number; commissionAmount: number };
  prev?: { salesAmount: number; commissionAmount: number };
}) {
  if (!cur || !prev) return null;
  return (
    <section className="card compare-card">
      <SectionHead title="مقارنة بالأسبوع السابق" kicker="مبيعات وعمولة" />
      <div className="compare-cols">
        <div>
          <p className="text-[11px] font-extrabold text-goal">هذا الأسبوع</p>
          <p className="num mt-1 text-xl font-extrabold">{moneyIq(cur.salesAmount)}</p>
          <p className="num mt-1 text-sm font-extrabold text-gold">{moneyIq(cur.commissionAmount)}</p>
        </div>
        <div>
          <p className="text-[11px] font-extrabold text-muted">الأسبوع السابق</p>
          <p className="num mt-1 text-xl font-extrabold">{moneyIq(prev.salesAmount)}</p>
          <p className="num mt-1 text-sm font-extrabold text-muted">{moneyIq(prev.commissionAmount)}</p>
        </div>
      </div>
    </section>
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
