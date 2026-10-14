import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { formatNum } from '@/api/client';
import { IconCheck, IconCopy, IconSearch, IconX } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { Alert, Btn } from '@/components/ui';
import { copyText } from '@/lib/clipboard';

/* ─────────────────────────────────────────────────────────────
 * أدوات مشتركة لصفحات الأشخاص: الكاشير، رموز الخصم، البائعون، حسابات الويب.
 * ───────────────────────────────────────────────────────────── */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Ic({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconMore = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></Ic>
);
export const IconEyeOff = (p: IconProps) => (
  <Ic {...p}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><path d="m2 2 20 20" /></Ic>
);
export const IconPower = (p: IconProps) => (
  <Ic {...p}><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></Ic>
);
export const IconKey = (p: IconProps) => (
  <Ic {...p}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></Ic>
);
export const IconDice = (p: IconProps) => (
  <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 8h.01" /><path d="M16 8h.01" /><path d="M12 12h.01" /><path d="M8 16h.01" /><path d="M16 16h.01" /></Ic>
);
export const IconUserPlus = (p: IconProps) => (
  <Ic {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></Ic>
);
export const IconSort = (p: IconProps) => (
  <Ic {...p}><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="m21 8-4-4-4 4" /><path d="M17 4v16" /></Ic>
);
export const IconDuplicate = (p: IconProps) => (
  <Ic {...p}><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M4 16V5a2 2 0 0 1 2-2h11" /><path d="M14.5 11.5v6" /><path d="M11.5 14.5h6" /></Ic>
);
export const IconGlobe = (p: IconProps) => (
  <Ic {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Ic>
);
export const IconImage = (p: IconProps) => (
  <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></Ic>
);

/* ── الصورة الرمزية بالأحرف الأولى ── */

const AVATAR_TONES = [
  'bg-brand-50 text-brand-800 ring-brand-100',
  'bg-sky-50 text-sky-800 ring-sky-100',
  'bg-violet-50 text-violet-800 ring-violet-100',
  'bg-amber-50 text-amber-800 ring-amber-100',
  'bg-slate-100 text-slate-700 ring-slate-200',
];

export function initialsOf(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name, size = 34, muted }: { name: string; size?: number; muted?: boolean }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = muted ? 'bg-slate-100 text-slate-400 ring-slate-200' : AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ring-1 ring-inset ${tone}`}
      style={{ width: size, height: size, fontSize: Math.max(10.5, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

/* ── صندوق بحث بأيقونة وزر مسح، والاختصار "/" يركّز عليه ── */

export function SearchBox({
  value,
  onChange,
  placeholder = 'بحث…',
  className = '',
  hotkey = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  hotkey?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable=true]')) return;
      if (document.querySelector('[role=dialog], [role=alertdialog]')) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  return (
    <div className={`relative min-w-0 ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
        <IconSearch size={15} />
      </span>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white ps-8 pe-14 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="absolute inset-y-0 end-2 flex items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => { onChange(''); ref.current?.focus(); }}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="مسح البحث"
            title="مسح (Esc)"
          >
            <IconX size={13} />
          </button>
        ) : hotkey ? (
          <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 text-[10.5px] font-semibold text-slate-400 sm:inline">/</kbd>
        ) : null}
      </span>
    </div>
  );
}

/* ── أزرار تبديل مجزأة (فلاتر الحالة) ── */

export function Segmented<T extends string | number>({
  items,
  value,
  onChange,
  size = 'md',
}: {
  items: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup">
      {items.map(it => {
        const active = it.id === value;
        return (
          <button
            key={String(it.id)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.id)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition ${
              size === 'sm' ? 'h-7 px-2.5 text-[11.5px]' : 'h-8 px-3 text-[12px]'
            } ${active ? 'bg-white text-header shadow-[var(--shadow-soft)] ring-1 ring-slate-200' : 'text-slate-500 hover:text-header'}`}
          >
            {it.label}
            {it.count != null && (
              <span className={`rounded-full px-1.5 text-[10.5px] font-bold num ${active ? 'bg-brand-50 text-brand-800' : 'bg-slate-200/70 text-slate-600'}`}>
                {formatNum(it.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── قائمة إجراءات منسدلة (⋮) — تُرسم في body كي لا يقصّها الجدول ── */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function RowMenu({ items, label = 'إجراءات أخرى' }: { items: (MenuItem | null | false)[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const list = items.filter(Boolean) as MenuItem[];

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = 210;
    const h = menuRef.current?.offsetHeight ?? list.length * 36 + 8;
    // RTL: محاذاة الحافة اليسرى للقائمة مع يسار الزر
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ top, left });
  }, [open, list.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [open, pos]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${
          open ? 'bg-slate-100 text-header' : 'text-slate-500 hover:bg-slate-100 hover:text-header'
        }`}
      >
        <IconMore size={16} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          dir="rtl"
          className="fixed z-[90] w-[210px] animate-pop-in rounded-xl border border-slate-200 bg-white p-1 shadow-pop"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const btns = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
            const i = btns.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
            btns[next]?.focus();
          }}
        >
          {list.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.hint}
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[12.5px] font-medium outline-none transition disabled:opacity-40 ${
                it.danger
                  ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
                  : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-50'
              }`}
            >
              <span className={it.danger ? 'text-red-500' : 'text-slate-400'}>{it.icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── زر أيقونة صغير داخل صفوف الجداول ── */

export function RowIconButton({
  label,
  children,
  onClick,
  tone = 'default',
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'brand' | 'danger';
  disabled?: boolean;
}) {
  const cls = {
    default: 'text-slate-500 hover:bg-slate-100 hover:text-header',
    brand: 'text-brand-700 hover:bg-brand-50',
    danger: 'text-slate-500 hover:bg-red-50 hover:text-red-600',
  }[tone];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}

/* ── نسخ نص مع إشعار ── */

export function useCopy() {
  const toast = useToast();
  return async (value: string, what = 'النص') => {
    try {
      await copyText(value);
      toast.success(`تم نسخ ${what}`);
      return true;
    } catch {
      toast.error('تعذّر النسخ');
      return false;
    }
  };
}

export function CopyButton({
  value,
  what,
  label,
  size = 'xs',
  variant = 'secondary',
}: {
  value: string;
  what?: string;
  label?: string;
  size?: 'xs' | 'sm';
  variant?: 'secondary' | 'ghost' | 'soft';
}) {
  const copy = useCopy();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(id);
  }, [done]);
  return (
    <Btn
      size={size}
      variant={variant}
      title={`نسخ ${what ?? ''}`.trim()}
      aria-label={`نسخ ${what ?? ''}`.trim()}
      icon={done ? <IconCheck size={13} className="text-emerald-600" /> : <IconCopy size={13} />}
      onClick={async e => {
        e.stopPropagation();
        if (await copy(value, what)) setDone(true);
      }}
    >
      {label}
    </Btn>
  );
}

/* ── حالة خطأ موحدة مع زر إعادة ── */

export function ErrorBlock({ error, title = 'تعذّر تحميل البيانات', onRetry }: { error: unknown; title?: string; onRetry: () => void }) {
  return (
    <div className="p-3">
      <Alert type="error" title={title}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{error instanceof Error ? error.message : 'حدث خطأ غير متوقع'}</span>
          <Btn size="xs" variant="secondary" onClick={onRetry}>إعادة المحاولة</Btn>
        </div>
      </Alert>
    </div>
  );
}

/* ── رقم سري عشوائي ── */

export function randomPin(len = 6) {
  const out: number[] = [];
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out.push(buf[i] % 10);
  // تجنّب أن يبدأ بصفر حتى لا يضيع عند النسخ في إكسل
  if (out[0] === 0) out[0] = 1 + (buf[0] % 9);
  return out.join('');
}

/* ── حفظ قيمة بسيطة في localStorage ── */

export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* تجاهل */
    }
  }, [key, v]);
  return [v, setV];
}

/** تنفيذ دالة عند الضغط على مفتاح بلا تعديل خارج الحقول. */
export function useHotkey(key: string, fn: () => void, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // نطابق الحرف أو موضع المفتاح (يعمل مع لوحة المفاتيح العربية)
      const byCode = key.length === 1 && /[a-z]/i.test(key) && e.code === `Key${key.toUpperCase()}`;
      if ((e.key.toLowerCase() !== key.toLowerCase() && !byCode) || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable=true]')) return;
      if (document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')) return;
      e.preventDefault();
      fnRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}
