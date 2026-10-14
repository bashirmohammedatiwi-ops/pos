import type { ReactNode, SVGProps } from 'react';
import { formatNum } from '@/api/client';

/* ─────────────────────────────────────────────────────────────────────────────
 * أدوات صغيرة مشتركة لقسمي العمولات والأهداف (أيقونات إضافية، تحكم مقسّم،
 * شريط تقدّم، حفظ تفضيلات العرض).
 * ───────────────────────────────────────────────────────────────────────────── */

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

export const IconPause = (p: IconProps) => (
  <Ic {...p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Ic>
);
export const IconPlay = (p: IconProps) => (
  <Ic {...p}><path d="M7 5v14l11-7z" /></Ic>
);
export const IconViewGrid = (p: IconProps) => (
  <Ic {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Ic>
);
export const IconViewList = (p: IconProps) => (
  <Ic {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Ic>
);
export const IconSort = (p: IconProps) => (
  <Ic {...p}><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></Ic>
);

/** قراءة/حفظ تفضيل محلي بأمان (قد يفشل التخزين في وضع التصفح الخاص). */
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* تجاهل */
  }
}

/** تحكم مقسّم مدمج (فلاتر الحالة، نوع العرض…). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  items: { id: T; label: ReactNode; count?: number; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {items.map(it => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={it.title}
            onClick={() => onChange(it.id)}
            className={`inline-flex items-center gap-1.5 rounded-md font-semibold transition ${
              size === 'sm' ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-3 text-[12.5px]'
            } ${active ? 'bg-white text-header shadow-[var(--shadow-soft)] ring-1 ring-slate-200' : 'text-slate-500 hover:text-header'}`}
          >
            {it.label}
            {it.count != null && (
              <span className={`num rounded-full px-1.5 text-[10.5px] font-bold ${active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/70 text-slate-500'}`}>
                {formatNum(it.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** لون شريط التقدّم حسب النسبة — نفس دلالات تطبيق المدير: تحقق / قريب / تركيز. */
export function progressTone(pct: number) {
  if (pct >= 100) return { bar: 'bg-emerald-500', text: 'text-emerald-700', label: 'تحقق', badge: 'ok' as const };
  if (pct >= 80) return { bar: 'bg-brand-500', text: 'text-brand-700', label: 'قريب', badge: 'brand' as const };
  if (pct >= 40) return { bar: 'bg-sky-500', text: 'text-sky-700', label: 'في الطريق', badge: 'info' as const };
  return { bar: 'bg-amber-500', text: 'text-amber-700', label: 'يحتاج تركيز', badge: 'warn' as const };
}

export function ProgressBar({ value, className = '', thin }: { value: number; className?: string; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const tone = progressTone(value);
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-slate-100 ${thin ? 'h-1.5' : 'h-2'} ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full transition-[width] duration-500 ${tone.bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** دوائر الأحرف الأولى للبائعين (حتى ٤ ثم +العدد). */
export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  return (
    <div className="flex items-center" title={names.join('، ')}>
      {shown.map((n, i) => (
        <span
          key={`${n}-${i}`}
          className={`${i > 0 ? '-ms-1.5 ' : ''}flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10.5px] font-bold text-slate-600 ring-2 ring-white`}
        >
          {n.trim().charAt(0) || '؟'}
        </span>
      ))}
      {names.length > max && (
        <span className="num -ms-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-200 px-1 text-[10.5px] font-bold text-slate-600 ring-2 ring-white">
          +{formatNum(names.length - max)}
        </span>
      )}
    </div>
  );
}

/** هل الحدث صادر من حقل كتابة؟ (لتجاهل اختصارات لوحة المفاتيح) */
export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}
