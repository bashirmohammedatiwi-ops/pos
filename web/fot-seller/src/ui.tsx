import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money, moneyIq, moneyK } from './api';
import type { DayBucket, HourBand } from './insights';

export function IconHome() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
export function IconMall() {
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
export function IconShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5" />
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
export function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

const STROKE: Record<string, string> = {
  teal: '#0d9488',
  ok: '#15803d',
  goal: '#4338ca',
  warn: '#d97706',
  gold: '#0f766e',
};

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f766e" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#bm)" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" strokeWidth="3.2" opacity="0.28" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#99f6e4" strokeWidth="3.2" strokeDasharray="70 113" strokeLinecap="round" transform="rotate(-90 32 32)" />
      <circle cx="32" cy="32" r="6" fill="#fbbf24" />
    </svg>
  );
}

export function Avatar({ name, dark, onClick }: { name: string; dark?: boolean; onClick?: () => void }) {
  const cls = `grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-base font-extrabold ${dark ? 'bg-white/10 text-white' : 'bg-gold-soft text-gold'}`;
  const letter = (name || 'ب').trim().charAt(0);
  if (onClick) {
    return <button type="button" onClick={onClick} className={cls} aria-label="حسابي">{letter}</button>;
  }
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
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
        <circle cx="44" cy="44" r="36" fill="#f0fdfa" />
        <circle cx="44" cy="44" r="22" fill="none" stroke="#99f6e4" strokeWidth="3" strokeDasharray="8 7" />
        <circle cx="44" cy="44" r="7" fill="#0d9488" />
        <rect x="58" y="18" width="14" height="14" rx="4" fill="#c7d2fe" transform="rotate(18 65 25)" />
      </svg>
      <p className="mt-3 text-lg font-extrabold">{title}</p>
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
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel h-24" />)}
    </div>
  );
}

export function SectionHead({
  title, kicker, to, link,
}: {
  title: string; kicker?: string; to?: string; link?: string;
}) {
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

export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 220 220" aria-hidden>
      <defs>
        <linearGradient id="ha" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4338ca" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <circle cx="78" cy="86" r="70" fill="url(#ha)" />
      <circle cx="78" cy="86" r="52" fill="none" stroke="#99f6e4" strokeWidth="10" />
      <circle cx="78" cy="86" r="52" fill="none" stroke="#0d9488" strokeWidth="10" strokeDasharray="220 327" strokeLinecap="round" transform="rotate(-90 78 86)" />
      <circle cx="78" cy="86" r="28" fill="#ffffff" />
      <circle cx="78" cy="86" r="10" fill="#4338ca" />
      <polygon points="168,38 182,62 158,62" fill="#c7d2fe" />
      <rect x="154" y="128" width="28" height="28" rx="8" fill="#ccfbf1" transform="rotate(18 168 142)" />
      <circle cx="186" cy="96" r="7" fill="#5eead4" />
      <circle cx="148" cy="168" r="5" fill="#818cf8" />
    </svg>
  );
}

export function LoginArt() {
  return (
    <svg className="login-art" viewBox="0 0 120 120" aria-hidden>
      <circle cx="60" cy="60" r="54" fill="#f0fdfa" />
      <circle cx="60" cy="60" r="38" fill="none" stroke="#99f6e4" strokeWidth="8" />
      <circle cx="60" cy="60" r="38" fill="none" stroke="#0d9488" strokeWidth="8" strokeDasharray="160 239" strokeLinecap="round" transform="rotate(-90 60 60)" />
      <circle cx="60" cy="60" r="16" fill="#4338ca" />
      <circle cx="60" cy="60" r="6" fill="#ffffff" />
      <circle cx="92" cy="28" r="5" fill="#fbbf24" />
    </svg>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  return <AreaChart values={values} height={72} />;
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
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(p => (
        <line key={p} x1="0" x2={w} y1={10 + p * (h - 22)} y2={10 + p * (h - 22)} stroke="#e2e8f0" strokeDasharray="3 6" />
      ))}
      <polygon fill={`url(#ag-${uid})`} points={fill} />
      <polyline fill="none" stroke="#0f766e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={line} />
      {peak && <circle cx={peak.x} cy={peak.y} r="4.5" fill="#4338ca" />}
      {last && <circle cx={last.x} cy={last.y} r="5" fill="#0f766e" stroke="#ffffff" strokeWidth="2" />}
    </svg>
  );
}

export function Bar({ value, max, tone = 'gold' }: { value: number; max: number; tone?: 'gold' | 'ok' | 'terracotta' | 'goal' }) {
  const width = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const color = tone === 'ok' ? 'bg-ok' : tone === 'terracotta' ? 'bg-terracotta' : tone === 'goal' ? 'bg-goal' : 'bg-gold';
  return (
    <div className="bar">
      <div className={`bar-fill ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Track({ value, tone = 'goal' }: { value: number; tone?: 'ok' | 'goal' | 'warn' | 'gold' }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className="track">
      <span className="track-mark" style={{ right: '50%' }} />
      <span className="track-mark" style={{ right: '20%' }} />
      <div className={`track-fill tone-${tone}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Ring({
  value, size = 88, tone = 'teal', label,
}: {
  value: number; size?: number; tone?: 'teal' | 'ok' | 'goal' | 'warn' | 'gold'; label?: string;
}) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  const color = STROKE[tone] || STROKE.teal;
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

const DONUT = ['#0f766e', '#4338ca', '#14b8a6', '#7c3aed', '#0ea5e9', '#c9a227', '#94a3b8'];

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

export function Delta({ value, dark }: { value: number; dark?: boolean }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) {
    return <span className={`text-xs font-extrabold ${dark ? 'text-white/70' : 'text-muted'}`}>ثابت عن السابق</span>;
  }
  const up = value > 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'} {money(Math.abs(value))}% عن السابق
    </span>
  );
}

export function CountMoney({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const from = 0;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 720);
      const eased = 1 - (1 - p) ** 3;
      setN(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{moneyIq(n)}</span>;
}

export function Medal({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : 'rn';
  return <span className={`medal ${cls}`}>{String(rank).padStart(2, '0')}</span>;
}

export function DayStrip({
  days, active, onSelect,
}: {
  days: DayBucket[]; active?: string; onSelect?: (key: string) => void;
}) {
  const max = Math.max(...days.map(d => d.commission), 1);
  return (
    <div className="day-strip">
      {days.map(d => (
        <button
          key={d.key}
          type="button"
          className={`day-col ${active === d.key ? 'on' : ''}`}
          onClick={() => onSelect?.(d.key)}
        >
          <span className="num text-[10px] font-extrabold text-gold">{d.commission ? moneyK(d.commission) : '—'}</span>
          <div className="day-bar-wrap">
            <div className="day-bar" style={{ height: `${Math.max(8, (d.commission / max) * 100)}%` }} />
          </div>
          <small>{d.weekday || d.label}</small>
        </button>
      ))}
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
          <p className="num mt-2 text-lg font-extrabold text-gold">{moneyIq(r.commission)}</p>
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
      <p className="num mt-2 text-base font-extrabold text-gold">{value}</p>
      {hint && <p className="mt-1 text-[11px] font-bold text-muted">{hint}</p>}
    </article>
  );
}

export function SearchField({
  value, onChange, placeholder,
}: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="search-wrap">
      <IconSearch />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="search-field" />
    </div>
  );
}

export function Sheet({
  open, title, onClose, children,
}: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
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

export function PinDots({ length }: { length: number }) {
  const n = Math.max(4, Math.min(8, length || 4));
  return (
    <div className="pin-row" aria-hidden>
      {Array.from({ length: n }, (_, i) => <span key={i} className={`pin-dot ${i < length ? 'on' : ''}`} />)}
    </div>
  );
}

export function Keypad({
  onDigit, onDelete, onEmpty,
}: {
  onDigit: (d: string) => void; onDelete: () => void; onEmpty?: ReactNode;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="keys">
      {keys.map(k => (
        <button key={k} type="button" className="key num" onClick={() => onDigit(k)}>{k}</button>
      ))}
      <div className="key key-ghost">{onEmpty}</div>
      <button type="button" className="key num" onClick={() => onDigit('0')}>0</button>
      <button type="button" className="key key-ghost" onClick={onDelete}>حذف</button>
    </div>
  );
}

type ToastFn = (msg: string) => void;
const ToastCtx = createContext<ToastFn>(() => undefined);

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef(0);
  const show = useCallback<ToastFn>((m) => {
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
