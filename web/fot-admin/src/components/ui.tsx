import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { formatNum } from '@/api/client';
import { IconAlert, IconCheckCircle, IconChevronDown, IconInfo, IconX } from '@/components/icons';

export function Panel({
  title,
  children,
  actions,
  icon,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-header">
            {icon && <span className="icon-tile h-6 w-6 bg-slate-100 text-slate-600">{icon}</span>}
            <span className="truncate">{title}</span>
          </h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 rounded-lg border border-border bg-white" />
        <div className="h-48 rounded-lg border border-border bg-white" />
      </div>
    </div>
  );
}

export function Btn({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  loading,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft';
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  const base =
    'inline-flex select-none items-center justify-center gap-1.5 rounded-md font-semibold disabled:pointer-events-none disabled:opacity-50';
  const sizes = size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3.5 py-2 text-[13px]';
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  };
  return (
    <button
      type="button"
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />
      )}
      {loading ? <span>جاري…</span> : children}
    </button>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-2">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="h-9 flex-1 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 pe-8 text-[13px] text-slate-800 outline-none hover:border-slate-300 focus:border-brand-500 ${props.className ?? ''}`}
      />
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-slate-400">
        <IconChevronDown size={14} />
      </span>
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">
      {children}
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-slate-700">
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border transition ${
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
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
}: {
  label?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full ${
          checked ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
            checked ? 'right-0.5' : 'right-[calc(100%-1.375rem)]'
          }`}
        />
      </button>
      {label && <span className="text-[13px] font-medium text-slate-700">{label}</span>}
    </label>
  );
}

export function Alert({ type = 'error', children }: { type?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const styles = {
    error: { box: 'border-red-200 bg-red-50 text-red-800', icon: 'text-red-500' },
    success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: 'text-emerald-500' },
    info: { box: 'border-sky-200 bg-sky-50 text-sky-800', icon: 'text-sky-500' },
    warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-500' },
  }[type];
  const Glyph = type === 'success' ? IconCheckCircle : type === 'info' ? IconInfo : IconAlert;
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] leading-6 ${styles.box}`}>
      <span className={`mt-0.5 shrink-0 ${styles.icon}`}><Glyph size={16} /></span>
      <div className="min-w-0 flex-1">{children}</div>
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
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  xl?: boolean;
  size?: 'md' | 'lg' | 'xl' | 'full';
  full?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closingRef = useRef(false);
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

  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  const width =
    isFull
      ? ''
      : size === 'xl' || xl
        ? 'max-w-6xl'
        : size === 'lg' || wide
          ? 'max-w-3xl'
          : 'max-w-lg';
  return (
    <div className={`fixed inset-0 z-[60] ${isFull ? '' : 'flex items-center justify-center p-3 sm:p-5'}`}>
      {!isFull && (
        <div
          className="absolute inset-0 bg-slate-950/45"
          onClick={requestClose}
        />
      )}
      <div
        className={`relative flex flex-col overflow-hidden bg-white shadow-pop ${
          isFull
            ? 'h-[100dvh] w-full'
            : `max-h-[92vh] w-full rounded-lg ${width}`
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold leading-6 text-header">{title}</h3>
            {subtitle && <div className="mt-1 text-[12px] leading-5 text-slate-500">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              requestClose();
            }}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
            aria-label="إغلاق"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className={`min-h-0 flex-1 ${isFull ? 'flex flex-col overflow-hidden p-4' : 'overflow-y-auto p-5'}`}>
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function TableWrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto ${className}`}>{children}</div>;
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500 ${className}`}>
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
  return <td colSpan={colSpan} className={`px-3 py-2 text-[13px] ${className}`} onClick={onClick}>{children}</td>;
}

export function EmptyRow({ cols, text = 'لا توجد بيانات' }: { cols: number; text?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-12 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <p className="text-[13px] text-muted">{text}</p>
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
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1">
        <span className="text-[10.5px] text-muted">
          <span className="font-bold text-slate-700 num">{formatNum(total)}</span> سجل
          <span className="mx-1 text-slate-300">·</span>
          <span className="num">{page}</span>/<span className="num">{totalPages || 1}</span>
        </span>
        <div className="flex gap-1">
          <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ‹
          </Btn>
          <Btn variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            ›
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white px-4 py-2.5">
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

export function Loading() {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-[13px] text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      جاري التحميل…
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white px-4 py-3.5 ${className}`}>
      {children}
    </div>
  );
}
