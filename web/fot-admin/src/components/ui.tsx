import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatNum } from '@/api/client';
import { IconAlert, IconCheckCircle, IconChevronDown, IconInfo, IconInbox, IconX } from '@/components/icons';
import { useScrollLock } from '@/hooks/useScrollLock';

/* ─────────────────────────────────────────────────────────────────────────────
 * مكوّنات الواجهة الموحدة — كل صفحات لوحة التحكم تبني عليها.
 * ───────────────────────────────────────────────────────────────────────────── */

export type Tone = 'default' | 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'violet';

export function Panel({
  title,
  subtitle,
  children,
  actions,
  icon,
  className = '',
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="icon-tile h-8 w-8 bg-brand-50 text-brand-700">{icon}</span>}
            <div className="min-w-0">
              <h2 className="truncate text-[13.5px] font-bold text-header">{title}</h2>
              {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
    </section>
  );
}

/** بطاقة بسيطة بحواف وظل موحّد. */
export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`card ${padded ? 'p-4' : ''} ${className}`}>{children}</div>;
}

/** رأس صفحة موحّد: أيقونة · عنوان · وصف · أزرار. */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="icon-tile h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[var(--shadow-glow-brand)]">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-bold leading-7 text-header">{title}</h1>
          {subtitle && <p className="truncate text-[12.5px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </div>
  );
}

const STAT_TONES: Record<Tone, { icon: string; value: string }> = {
  default: { icon: 'bg-slate-100 text-slate-600', value: 'text-header' },
  brand: { icon: 'bg-brand-50 text-brand-700', value: 'text-header' },
  ok: { icon: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700' },
  warn: { icon: 'bg-amber-50 text-amber-600', value: 'text-amber-700' },
  danger: { icon: 'bg-red-50 text-red-600', value: 'text-red-700' },
  info: { icon: 'bg-sky-50 text-sky-600', value: 'text-header' },
  violet: { icon: 'bg-violet-50 text-violet-600', value: 'text-header' },
};

/** بطاقة مؤشر رقمي (KPI). */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  delta,
  onClick,
  loading,
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** فرق مئوي (موجب/سالب) يظهر كشارة. */
  delta?: { value: number; label?: string } | null;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const t = STAT_TONES[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`card group relative flex min-w-0 flex-col gap-2 p-4 text-right ${
        onClick ? 'transition hover:-translate-y-px hover:border-brand-200 hover:shadow-[var(--shadow-lift)]' : ''
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold text-slate-500">{label}</p>
        {icon && <span className={`icon-tile h-9 w-9 rounded-xl ${t.icon}`}>{icon}</span>}
      </div>
      {loading ? (
        <div className="skeleton h-7 w-28" />
      ) : (
        <p className={`text-[22px] font-bold leading-none tracking-tight num ${t.value}`}>{value}</p>
      )}
      {(hint || delta) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
          {delta && <DeltaBadge value={delta.value} />}
          {delta?.label && <span>{delta.label}</span>}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </Tag>
  );
}

export function DeltaBadge({ value }: { value: number }) {
  if (!Number.isFinite(value)) return null;
  const up = value > 0.5;
  const down = value < -0.5;
  const cls = up ? 'bg-emerald-50 text-emerald-700' : down ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold num ${cls}`} dir="ltr">
      {up ? '▲' : down ? '▼' : '•'} {Math.abs(value).toFixed(0)}%
    </span>
  );
}

const BADGE_TONES: Record<Tone, string> = {
  default: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

/** شارة حالة صغيرة. */
export function Badge({
  children,
  tone = 'default',
  dot,
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${BADGE_TONES[tone]} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/** حالة فارغة موحّدة. */
export function EmptyState({
  title = 'لا توجد بيانات',
  description,
  icon,
  action,
  compact,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12'}`}>
      <span className={`icon-tile rounded-2xl bg-slate-100 text-slate-400 ${compact ? 'h-10 w-10' : 'h-14 w-14'}`}>
        {icon ?? <IconInbox size={compact ? 18 : 24} />}
      </span>
      <p className={`font-bold text-slate-700 ${compact ? 'text-[12.5px]' : 'text-[14px]'}`}>{title}</p>
      {description && <p className="max-w-sm text-[12px] leading-5 text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[20px] items-center justify-center rounded border border-slate-200 bg-white px-1 font-sans text-[10px] font-semibold text-slate-500 shadow-[0_1px_0_#e2e8f0]">
      {children}
    </kbd>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton h-10 w-10 rounded-xl" />
        <div className="space-y-2">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-3 w-64" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="card space-y-2.5 p-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton h-8 w-full" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  );
}

export type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft' | 'outline' | 'dark';

export function Btn({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  loading,
  disabled,
  icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}) {
  const base =
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50';
  const sizes = {
    xs: 'h-7 px-2 text-[11.5px]',
    sm: 'h-8 px-2.5 text-[12px]',
    md: 'h-9 px-3.5 text-[13px]',
    lg: 'h-11 px-5 text-[14px]',
  }[size];
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-brand-600 text-white shadow-[0_1px_2px_rgba(13,138,103,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-brand-700',
    secondary: 'border border-slate-200 bg-white text-slate-700 shadow-[var(--shadow-soft)] hover:border-slate-300 hover:bg-slate-50',
    outline: 'border border-brand-200 bg-white text-brand-700 hover:border-brand-300 hover:bg-brand-50',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    danger: 'bg-red-600 text-white shadow-[0_1px_2px_rgba(220,38,38,0.35)] hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
    dark: 'bg-slate-900 text-white hover:bg-slate-800',
  };
  return (
    <button
      type="button"
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/** زر أيقونة مربع مع تلميح. */
export function IconButton({
  children,
  label,
  className = '',
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition disabled:pointer-events-none disabled:opacity-50 ${
        active
          ? 'border-brand-200 bg-brand-50 text-brand-700'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="skeleton h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

const FIELD_BASE =
  'w-full rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input {...props} ref={ref} className={`${FIELD_BASE} h-9 px-3 ${props.className ?? ''}`} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <textarea {...props} ref={ref} className={`${FIELD_BASE} px-3 py-2 leading-6 ${props.className ?? ''}`} />;
});

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${FIELD_BASE} h-9 appearance-none px-3 pe-8 ${props.className ?? ''}`} />
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">
        <IconChevronDown size={14} />
      </span>
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-semibold text-slate-600">
      {children}
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex select-none items-center gap-2 text-[13px] text-slate-700 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition ${
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white hover:border-slate-400'
        }`}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="sr-only" />
      </span>
      {label}
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
}) {
  return (
    <label className={`inline-flex items-center gap-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[right] duration-200 ${
            checked ? 'right-[3px]' : 'right-[21px]'
          }`}
        />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] font-medium text-slate-700">{label}</span>}
          {description && <span className="block text-[11.5px] text-slate-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Alert({ type = 'error', children, title }: { type?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode; title?: ReactNode }) {
  const styles = {
    error: { box: 'border-red-200 bg-red-50/70 text-red-800', icon: 'bg-red-100 text-red-600' },
    success: { box: 'border-emerald-200 bg-emerald-50/70 text-emerald-800', icon: 'bg-emerald-100 text-emerald-600' },
    info: { box: 'border-sky-200 bg-sky-50/70 text-sky-800', icon: 'bg-sky-100 text-sky-600' },
    warning: { box: 'border-amber-200 bg-amber-50/70 text-amber-900', icon: 'bg-amber-100 text-amber-600' },
  }[type];
  const Glyph = type === 'success' ? IconCheckCircle : type === 'info' ? IconInfo : IconAlert;
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-6 ${styles.box}`} role={type === 'error' ? 'alert' : 'status'}>
      <span className={`icon-tile mt-0.5 h-6 w-6 rounded-lg ${styles.icon}`}><Glyph size={14} /></span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  xl,
  size,
  full,
  icon,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  xl?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  full?: boolean;
  icon?: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const isFull = full || size === 'full';

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      closeRef.current();
    } finally {
      window.setTimeout(() => {
        closingRef.current = false;
      }, 350);
    }
  }

  useScrollLock(open);

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      // Esc أثناء الكتابة في حقل لا يغلق النافذة (حماية من فقدان المدخلات)
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      // نافذة أخرى مفتوحة فوق هذه (تأكيد/منتقي) تتولى Esc بنفسها
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current?.parentElement) return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // تركيز أول حقل عند الفتح لسرعة الإدخال من لوحة المفاتيح
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const first = panel.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([disabled]), textarea, select');
      first?.focus({ preventScroll: true });
      // النافذة تُفتح دائماً من أعلاها — لا تمرير بسبب حقل مُركّز في الأسفل
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    }, 30);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;
  const width = isFull
    ? ''
    : size === 'xl' || xl
      ? 'max-w-6xl'
      : size === 'lg' || wide
        ? 'max-w-3xl'
        : size === 'sm'
          ? 'max-w-md'
          : 'max-w-lg';
  // تُرسم على مستوى المستند (portal) — لا تتأثر بموضع التمرير أو تحويلات العناصر الأب
  return createPortal(
    <div className={`fixed inset-0 z-[60] ${isFull ? '' : 'flex items-center justify-center p-3 sm:p-6'}`} role="dialog" aria-modal="true">
      {!isFull && (
        <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" onClick={requestClose} />
      )}
      <div
        ref={panelRef}
        className={`relative flex flex-col overflow-hidden bg-white shadow-pop ${
          isFull ? 'h-[100dvh] w-full animate-fade-in' : `max-h-[92vh] w-full animate-pop-in rounded-2xl ${width}`
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="icon-tile h-9 w-9 rounded-xl bg-brand-50 text-brand-700">{icon}</span>}
            <div className="min-w-0">
              <h3 className="text-[16px] font-bold leading-6 text-header">{title}</h3>
              {subtitle && <div className="mt-0.5 text-[12px] leading-5 text-slate-500">{subtitle}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              requestClose();
            }}
            className="-m-1 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="إغلاق"
            title="إغلاق (Esc)"
          >
            <IconX size={16} />
          </button>
        </div>
        <div ref={bodyRef} className={`min-h-0 flex-1 ${isFull ? 'flex flex-col overflow-hidden p-4' : 'overflow-y-auto p-5'}`}>
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── نافذة تأكيد موحّدة بدل window.confirm ── */

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback<ConfirmFn>(opts => {
    const o = typeof opts === 'string' ? { title: opts } : opts;
    return new Promise<boolean>(resolve => setState({ ...o, resolve }));
  }, []);

  function close(v: boolean) {
    state?.resolve(v);
    setState(null);
  }

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      // Enter يُترك للزر المُركَّز (التأكيد مُركَّز افتراضياً) — كي لا يؤكد عند التركيز على «إلغاء»
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" onClick={() => close(false)} />
          <div className="relative w-full max-w-sm animate-pop-in rounded-2xl bg-white p-5 shadow-pop">
            <div className="flex items-start gap-3">
              <span className={`icon-tile h-10 w-10 rounded-xl ${state.danger ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}>
                {state.danger ? <IconAlert size={18} /> : <IconInfo size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold leading-6 text-header">{state.title}</h3>
                {state.message && <div className="mt-1 text-[12.5px] leading-6 text-slate-600">{state.message}</div>}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn variant="secondary" onClick={() => close(false)}>{state.cancelLabel ?? 'إلغاء'}</Btn>
              <Btn variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {state.confirmLabel ?? 'تأكيد'}
              </Btn>
            </div>
          </div>
        </div>
      , document.body)}
    </ConfirmContext.Provider>
  );
}

/** يعيد دالة تأكيد غير متزامنة: `if (!(await confirm({ title, danger: true }))) return;` */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async opts => window.confirm(typeof opts === 'string' ? opts : String(opts.title)));
}

/* ── تبويبات ── */

export function Tabs<T extends string | number>({
  items,
  value,
  onChange,
  className = '',
}: {
  items: { id: T; label: ReactNode; count?: number; icon?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 overflow-x-auto border-b border-slate-200 ${className}`} role="tablist">
      {items.map(t => {
        const active = t.id === value;
        return (
          <button
            key={String(t.id)}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] transition ${
              active ? 'border-brand-600 font-bold text-brand-800' : 'border-transparent font-medium text-slate-500 hover:text-header'
            }`}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold num ${active ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-600'}`}>
                {formatNum(t.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TableWrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto ${className}`}>{children}</div>;
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`whitespace-nowrap bg-slate-50/80 px-3 py-2.5 text-right text-[11.5px] font-bold text-slate-500 ${className}`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  colSpan,
  onClick,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  onClick?: (e: MouseEvent<HTMLTableCellElement>) => void;
}) {
  return <td colSpan={colSpan} className={`px-3 py-2.5 text-[13px] ${className}`} onClick={onClick}>{children}</td>;
}

export function EmptyRow({ cols, text = 'لا توجد بيانات' }: { cols: number; text?: string }) {
  return (
    <tr>
      <td colSpan={cols}>
        <EmptyState title={text} compact />
      </td>
    </tr>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
  compact,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1">
        <span className="text-[11.5px] text-muted">
          <span className="font-bold text-slate-700 num">{formatNum(total)}</span> سجل
          <span className="mx-1 text-slate-300">·</span>
          صفحة <span className="num font-semibold text-slate-700">{page}</span> / <span className="num">{totalPages || 1}</span>
        </span>
        <div className="flex gap-1">
          <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="السابق">
            ›
          </Btn>
          <Btn variant="secondary" size="xs" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="التالي">
            ‹
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <span className="text-[12px] text-muted">
        <span className="font-bold text-slate-700 num">{formatNum(total)}</span> سجل
        <span className="mx-1.5 text-slate-300">·</span>
        صفحة <span className="font-bold text-slate-700 num">{page}</span> من{' '}
        <span className="num">{totalPages || 1}</span>
      </span>
      <div className="flex gap-1.5">
        <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          السابق
        </Btn>
        {totalPages > 1 && page > 2 && (
          <Btn variant="ghost" size="sm" onClick={() => onPage(1)}>1</Btn>
        )}
        {totalPages > 1 && page > 3 && <span className="self-center text-slate-400">…</span>}
        {Array.from({ length: totalPages })
          .map((_, i) => i + 1)
          .filter(p => Math.abs(p - page) <= 1 && p !== 1 && p !== totalPages)
          .map(p => (
            <Btn key={p} variant={p === page ? 'primary' : 'ghost'} size="sm" onClick={() => onPage(p)}>
              {p}
            </Btn>
          ))}
        {totalPages > 1 && page < totalPages - 2 && <span className="self-center text-slate-400">…</span>}
        {totalPages > 1 && page < totalPages - 1 && (
          <Btn variant="ghost" size="sm" onClick={() => onPage(totalPages)}>{totalPages}</Btn>
        )}
        <Btn variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          التالي
        </Btn>
      </div>
    </div>
  );
}

export function Loading({ label = 'جاري التحميل…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-[13px] text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`card flex flex-wrap items-end gap-3 px-4 py-3.5 ${className}`}>
      {children}
    </div>
  );
}

/** يرسم المحتوى على مستوى المستند — للنوافذ ملء الشاشة كي لا تتأثر بموضع التمرير أو تحويلات العناصر الأب. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
