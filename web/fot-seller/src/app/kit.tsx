import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic, pushBack } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * مكوّنات تطبيق الفريق — أيقونات، شاشة بعنوان قابل للطي، ورقة سفلية بالسحب،
 * مفتاح مقسّم متحرك، حلقة ونسبة، عدّاد رقمي، إشعارات مؤقتة، السحب للتحديث.
 * ───────────────────────────────────────────────────────────────────────────── */

/* ═════════════ الأيقونات ═════════════ */
type IconProps = { size?: number; filled?: boolean };
function Svg({ size = 22, children, fill = 'none' }: { size?: number; children: ReactNode; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const I = {
  home: ({ size, filled }: IconProps) => (
    <Svg size={size}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.16 : 0} />
    </Svg>
  ),
  wallet: ({ size, filled }: IconProps) => (
    <Svg size={size}>
      <rect x="3" y="6" width="18" height="13.5" rx="3" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.16 : 0} />
      <path d="M3 10h18M16.5 14.5h1.5M7 3.8 15.5 6" />
    </Svg>
  ),
  target: ({ size, filled }: IconProps) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8.5" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.16 : 0} />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </Svg>
  ),
  tag: ({ size, filled }: IconProps) => (
    <Svg size={size}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.16 : 0} />
      <circle cx="7.6" cy="7.6" r="1.4" />
    </Svg>
  ),
  user: ({ size, filled }: IconProps) => (
    <Svg size={size}>
      <circle cx="12" cy="8.2" r="4" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.16 : 0} />
      <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </Svg>
  ),
  refresh: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M20 11.5A8 8 0 0 0 5.6 7M4 12.5A8 8 0 0 0 18.4 17" />
      <path d="M5 3v4.2h4.2M19 21v-4.2h-4.2" />
    </Svg>
  ),
  /** للأمام في الواجهة العربية (يشير لليسار) */
  chevron: ({ size = 18 }: IconProps) => (
    <Svg size={size}>
      <path d="m14.5 6-6 6 6 6" />
    </Svg>
  ),
  back: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  ),
  search: ({ size = 18 }: IconProps) => (
    <Svg size={size}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  ),
  close: ({ size = 18 }: IconProps) => (
    <Svg size={size}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  lock: ({ size }: IconProps) => (
    <Svg size={size}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.6" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  ),
  clock: ({ size }: IconProps) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  calendar: ({ size }: IconProps) => (
    <Svg size={size}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  ),
  bell: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </Svg>
  ),
  chat: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z" />
      <path d="M9 11h.01M12.5 11h.01M16 11h.01" />
    </Svg>
  ),
  megaphone: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l6 4V4.5l-6 4H5.5A1.5 1.5 0 0 0 4 10z" />
      <path d="M17 9a4 4 0 0 1 0 6M8 15.5l1 4.5" />
    </Svg>
  ),
  receipt: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Svg>
  ),
  box: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </Svg>
  ),
  out: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M14 4h3.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8 6 12l4 4M6 12h9" />
    </Svg>
  ),
  sun: ({ size }: IconProps) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Svg>
  ),
  phone: ({ size }: IconProps) => (
    <Svg size={size}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.8" />
      <path d="M10.5 18.5h3" />
    </Svg>
  ),
  vibrate: ({ size }: IconProps) => (
    <Svg size={size}>
      <rect x="7.5" y="4" width="9" height="16" rx="2.2" />
      <path d="M4 8v8M20 8v8M1.8 10.5v3M22.2 10.5v3" />
    </Svg>
  ),
  share: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
      <path d="M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6" />
    </Svg>
  ),
  sheet: ({ size }: IconProps) => (
    <Svg size={size}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 9h16M4 15h16M10 3v18" />
    </Svg>
  ),
  shield: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Svg>
  ),
  check: ({ size = 16 }: IconProps) => (
    <Svg size={size}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  sparkle: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M12 3.5 13.8 9.2 19.5 11 13.8 12.8 12 18.5 10.2 12.8 4.5 11 10.2 9.2z" />
      <path d="M19 3.5v3M17.5 5h3" />
    </Svg>
  ),
  info: ({ size }: IconProps) => (
    <Svg size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </Svg>
  ),
  store: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8.5h13V12M10 20.5v-5h4v5" />
    </Svg>
  ),
  coffee: ({ size }: IconProps) => (
    <Svg size={size}>
      <path d="M5 9h11v5.5A5.5 5.5 0 0 1 10.5 20h0A5.5 5.5 0 0 1 5 14.5z" />
      <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v2.5M12 3.5v2.5" />
    </Svg>
  ),
};

/** الشعار: حلقة مفتوحة ونقطة زعفرانية — «الفريق في دائرة واحدة». */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M24 7a17 17 0 1 0 16.2 11.8" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="37.6" cy="11.2" r="4.6" fill="#F0B04F" />
      <circle cx="24" cy="24" r="5.2" fill="#fff" fillOpacity="0.92" />
    </svg>
  );
}

/* ═════════════ أدوات ═════════════ */
export function initials(name?: string | null) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  // «الكاشير» ← «ك» لا «ا»
  const lead = (w: string) => (w.startsWith('ال') && w.length > 3 ? w[2] : w[0]);
  return parts.length === 1 ? parts[0].slice(0, 2) : `${lead(parts[0])} ${lead(parts[1])}`.replace(' ', '‌');
}

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number) => nf.format(Math.round(Number(n) || 0));

/* التواريخ: أسماء الأشهر العراقية بأرقام لاتينية موحّدة مع المبالغ في كل التطبيق. */
const LOC = 'ar-IQ-u-nu-latn';

function at(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function clockLabel(iso?: string | null) {
  const d = at(iso);
  return d ? d.toLocaleTimeString(LOC, { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
}
export function dayLabel(iso?: string | null) {
  const d = at(iso);
  return d ? d.toLocaleDateString(LOC, { day: 'numeric', month: 'long' }) : '';
}
export function weekdayLong(iso?: string | null) {
  const d = at(iso);
  return d ? d.toLocaleDateString(LOC, { weekday: 'long' }) : '';
}
export function weekRange(a?: string | null, b?: string | null) {
  const x = at(a);
  const y = at(b);
  if (!x || !y) return '';
  const sameMonth = x.getMonth() === y.getMonth();
  return sameMonth
    ? `${x.getDate()} – ${y.toLocaleDateString(LOC, { day: 'numeric', month: 'long' })}`
    : `${dayLabel(a)} – ${dayLabel(b)}`;
}
export function shortDate(iso?: string | null) {
  const d = at(iso);
  return d ? d.toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
}
export function longDate(iso?: string | null) {
  const d = at(iso);
  return d ? d.toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** تاريخ اليوم بتوقيت العراق، بأسماء الأشهر العراقية. */
export function iraqToday() {
  try {
    return new Date().toLocaleDateString(LOC, { timeZone: 'Asia/Baghdad', weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return new Date().toLocaleDateString('ar');
  }
}

export function iraqHour() {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', hour: 'numeric', hour12: false }).format(new Date())) % 24;
  } catch {
    return new Date().getHours();
  }
}

export function greet() {
  const h = iraqHour();
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'نهارك سعيد';
  return 'مساء الخير';
}

/* ═════════════ عناصر بسيطة ═════════════ */
export function Avatar({ name, size }: { name?: string | null; size?: 'sm' | 'xl' }) {
  return <span className={`t-avatar ${size ?? ''}`}>{initials(name)}</span>;
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'bad' | 'accent' | 'mute'; children: ReactNode }) {
  return <span className={`t-badge ${tone ?? ''}`}>{children}</span>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="t-empty">
      <div className="art">{icon ?? <I.sparkle size={30} />}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 60, r, mt }: { h?: number; r?: number; mt?: number }) {
  return <div className="t-skel" style={{ height: h, borderRadius: r, marginTop: mt }} />;
}

export function ErrorLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="t-error" role="alert">
      <I.info size={18} />
      <span>{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          إعادة
        </button>
      )}
    </div>
  );
}

export function Delta({ now, prev, glass }: { now: number; prev: number; glass?: boolean }) {
  if (!prev && !now) return null;
  const p = prev ? ((now - prev) / Math.abs(prev)) * 100 : 100;
  const dir = Math.abs(p) < 0.5 ? 'flat' : p > 0 ? 'up' : 'down';
  const text = dir === 'flat' ? 'مثل السابق' : `${dir === 'up' ? '▲' : '▼'} ${Math.abs(p) >= 10 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1)}%`;
  return <span className={glass ? `t-chip-glass ${dir}` : `t-delta ${dir}`}>{text}</span>;
}

export function Ring({ value, size = 54, stroke = 6, tone, label }: { value: number; size?: number; stroke?: number; tone?: 'ok' | 'accent'; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(v));
    return () => cancelAnimationFrame(id);
  }, [v]);
  return (
    <div className={`t-ring ${tone ?? ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="val" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100} />
      </svg>
      <span className="label num">{label ?? `${Math.round(v)}%`}</span>
    </div>
  );
}

export function Track({ value, tone }: { value: number; tone?: 'ok' | 'accent' }) {
  return (
    <div className={`t-track ${tone ?? ''}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** عدّاد رقمي ينساب للقيمة الجديدة. */
export function CountUp({ value }: { value: number }) {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{fmt(v)}</span>;
}

/* ═════════════ المفتاح المقسّم ═════════════ */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  glass,
}: {
  items: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  glass?: boolean;
}) {
  const i = Math.max(0, items.findIndex(x => x.id === value));
  const w = 100 / items.length;
  return (
    <div className={`t-seg ${glass ? 'glass' : ''}`} role="tablist">
      <span className="t-seg-thumb" style={{ insetInlineStart: `calc(${i * w}% + 4px)`, width: `calc(${w}% - 8px)` }} />
      {items.map(x => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={x.id === value}
          className={x.id === value ? 'on' : ''}
          onClick={() => {
            if (x.id !== value) haptic('select');
            onChange(x.id);
          }}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`t-switch ${on ? 'on' : ''}`}
      onClick={() => {
        haptic('select');
        onChange(!on);
      }}
    />
  );
}

/* ═════════════ الشاشة: شريط علوي يظهر مع التمرير + عنوان كبير + سحب للتحديث ═════════════ */
export function Screen({
  title,
  subtitle,
  start,
  end,
  onRefresh,
  hideLarge,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  start?: ReactNode;
  end?: ReactNode;
  onRefresh?: () => Promise<unknown> | void;
  hideLarge?: boolean;
  children: ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const pull = usePull(onRefresh);

  return (
    <>
      <header className={`t-bar ${scrolled ? 'scrolled' : ''}`}>
        <div className="t-bar-side">{start}</div>
        <div className="t-bar-title">{title}</div>
        <div className="t-bar-side end">{end}</div>
      </header>
      {pull}
      <div className="t-page">
        <div ref={sentinel} className={hideLarge ? '' : 't-large'}>
          {!hideLarge && (
            <>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </>
          )}
        </div>
        {children}
      </div>
    </>
  );
}

/** السحب للتحديث من أعلى الصفحة (بالاهتزاز عند الوصول للحد). */
export function usePull(onRefresh?: () => Promise<unknown> | void) {
  const [h, setH] = useState(0);
  const [state, setState] = useState<'idle' | 'dragging' | 'ready' | 'loading'>('idle');
  const startY = useRef<number | null>(null);
  const ready = useRef(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!onRefresh) return;
    const down = (e: TouchEvent) => {
      if (window.scrollY > 0 || document.querySelector('.t-sheet')) return;
      startY.current = e.touches[0].clientY;
      ready.current = false;
    };
    const move = (e: TouchEvent) => {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        setH(0);
        return;
      }
      const hh = Math.min(84, dy * 0.42);
      setH(hh);
      const isReady = hh >= 62;
      if (isReady !== ready.current) {
        ready.current = isReady;
        if (isReady) haptic('tap');
      }
      setState(isReady ? 'ready' : 'dragging');
    };
    const up = async () => {
      if (startY.current == null) return;
      startY.current = null;
      if (ready.current && cb.current) {
        setState('loading');
        setH(56);
        try {
          await cb.current();
        } finally {
          setState('idle');
          setH(0);
        }
      } else {
        setState('idle');
        setH(0);
      }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [!!onRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!onRefresh) return null;
  return (
    <div className={`t-pull ${state}`} style={{ height: h }} aria-hidden>
      <span className="ring" style={{ transform: state === 'dragging' ? `rotate(${h * 5}deg)` : undefined }} />
    </div>
  );
}

/* ═════════════ الورقة السفلية ═════════════ */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setDrag(0);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 230);
      return () => clearTimeout(t);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const off = pushBack(() => close.current());
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      off();
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted) return null;
  // داخل body مباشرة: الحاويات المتحركة تكسر position: fixed
  return createPortal(
    <>
      <div className={`t-sheet-bg ${closing ? 'closing' : ''}`} onClick={() => close.current()} />
      <div
        className={`t-sheet ${closing ? 'closing' : ''}`}
        role="dialog"
        aria-modal="true"
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <div
          className="t-sheet-grab"
          onTouchStart={e => {
            startY.current = e.touches[0].clientY;
          }}
          onTouchMove={e => {
            if (startY.current == null) return;
            setDrag(Math.max(0, e.touches[0].clientY - startY.current));
          }}
          onTouchEnd={() => {
            startY.current = null;
            if (drag > 90) close.current();
            else setDrag(0);
          }}
        />
        {(title || subtitle) && (
          <div className="t-sheet-head">
            <div>
              {title && <h3>{title}</h3>}
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" className="t-icon-btn ghost press" aria-label="إغلاق" onClick={() => close.current()}>
              <I.close />
            </button>
          </div>
        )}
        <div className="t-sheet-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/* ═════════════ إشعار مؤقت ═════════════ */
const TOAST_EVENT = 'fot-team-toast';
export function toast(text: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }));
}
export function ToastHost() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      setMsg({ text: (e as CustomEvent<string>).detail, id: Date.now() });
      window.clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      window.clearTimeout(t);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className="t-toast" role="status">
      <div key={msg.id}>{msg.text}</div>
    </div>
  );
}

/** يعيد دالة ثابتة تشغّل آخر نسخة من callback. */
export function useEvent<A extends unknown[], R>(fn: (...a: A) => R) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current(...a), []);
}
