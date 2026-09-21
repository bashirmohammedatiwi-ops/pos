import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { money } from './api';

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

export function Avatar({ name, dark, onClick }: { name: string; dark?: boolean; onClick?: () => void }) {
  const cls = `grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-base font-extrabold ${dark ? 'bg-white/10 text-[#f8efe3]' : 'bg-gold-soft text-ink'}`;
  const letter = (name || 'ب').trim().charAt(0);
  if (onClick) {
    return <button type="button" onClick={onClick} className={cls} aria-label="حسابي">{letter}</button>;
  }
  return <span className={cls}>{letter}</span>;
}

export function Badge({ tone = 'gold', children }: { tone?: 'gold' | 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const map = {
    gold: 'bg-gold-soft text-gold',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    muted: 'bg-paper text-muted',
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${map[tone]}`}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card px-6 py-14 text-center">
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
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel h-24" />)}
    </div>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  const w = 320;
  const h = 72;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - 8 - ((v - min) / span) * (h - 16);
    return `${x},${y}`;
  });
  const last = values[values.length - 1] ?? 0;
  const fill = `0,${h} ${pts.join(' ')} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" preserveAspectRatio="none">
      <polygon fill="rgba(196,154,69,0.18)" points={fill} />
      <polyline fill="none" stroke="#c49a45" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" points={pts.join(' ')} />
      {values.length > 0 && (
        <circle cx={w} cy={h - 8 - ((last - min) / span) * (h - 16)} r="3.6" fill="#c45c3e" />
      )}
    </svg>
  );
}

export function Bar({ value, max, tone = 'gold' }: { value: number; max: number; tone?: 'gold' | 'ok' | 'terracotta' }) {
  const width = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const color = tone === 'ok' ? 'bg-ok' : tone === 'terracotta' ? 'bg-terracotta' : 'bg-gold';
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-paper">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Ring({ value, size = 76 }: { value: number; size?: number }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 76 76">
      <circle cx="38" cy="38" r={r} stroke="#efe6d8" strokeWidth="8" fill="none" />
      <circle
        cx="38" cy="38" r={r} fill="none" stroke={v >= 100 ? '#1f7a4d' : '#c45c3e'}
        strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`}
        transform="rotate(-90 38 38)"
      />
      <text x="38" y="43" textAnchor="middle" fontSize="15" fontWeight="800" fill="#14100c">{Math.round(v)}%</text>
    </svg>
  );
}

export function Delta({ value, dark }: { value: number; dark?: boolean }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) {
    return <span className={`text-xs font-extrabold ${dark ? 'text-[#d8c4a8]' : 'text-muted'}`}>ثابت</span>;
  }
  const up = value > 0;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${up ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
      {up ? '▲' : '▼'} {money(Math.abs(value))}%
    </span>
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
