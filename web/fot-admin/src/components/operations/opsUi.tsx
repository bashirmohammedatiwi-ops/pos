import type { ReactNode } from 'react';
import { IconSearch, IconX } from '@/components/icons';

/* ─────────────────────────────────────────────────────────────────────────────
 * عناصر صغيرة لصفحات التشغيل والإعدادات (الأداري، صحة النظام، الإعدادات):
 * شريط حالة رفيع · رأس لوحة جدول · حقل بعنوان صغير · بحث مدمج.
 * ───────────────────────────────────────────────────────────────────────────── */

export type OpsTone = 'ok' | 'warn' | 'danger' | 'off';

const STATUS_BG: Record<OpsTone, string> = {
  ok: 'bg-emerald-50/70',
  warn: 'bg-amber-50/70',
  danger: 'bg-red-50/70',
  off: 'bg-slate-50',
};

const STATUS_TITLE: Record<OpsTone, string> = {
  ok: 'text-emerald-800',
  warn: 'text-amber-900',
  danger: 'text-red-800',
  off: 'text-slate-700',
};

/** شريط حالة بسطر واحد: نقطة · عنوان · شارات · تفصيل مختصر · أزرار في النهاية. */
export function StatusLine({
  tone,
  dot,
  title,
  badges,
  detail,
  actions,
}: {
  tone: OpsTone;
  dot?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-200 px-3 py-1.5 ${STATUS_BG[tone]}`}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {dot}
        <span className={`shrink-0 text-[13.5px] font-bold ${STATUS_TITLE[tone]}`}>{title}</span>
        {badges && <span className="flex shrink-0 items-center gap-1">{badges}</span>}
        {detail && (
          <span className="min-w-0 truncate text-[12px] text-slate-600" title={detail} dir="auto">
            · {detail}
          </span>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** رأس رفيع للوحة جدول: عنوان + عدّاد + أدوات. */
export function PaneHeader({
  icon,
  title,
  meta,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {icon && <span className="shrink-0 text-slate-500">{icon}</span>}
        <h3 className="truncate text-[13px] font-bold text-header">{title}</h3>
        {meta && <span className="shrink-0 text-[11.5px] text-slate-500 num">{meta}</span>}
      </div>
      {children && <div className="ms-auto flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}

/** حاوية بعنوان صغير فوق محتوى غير حقلي (مبدّلات/أزرار) — بلا <label> كي لا ينقر الزر الأول. */
export function FieldBox({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </div>
  );
}

/** بحث مدمج بأيقونة وزر مسح — Escape يمسح. */
export function CompactSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <IconSearch size={15} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        aria-label={ariaLabel ?? placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pe-8 ps-8 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15"
      />
      {value && (
        <button
          type="button"
          aria-label="مسح البحث"
          onClick={() => onChange('')}
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <IconX size={13} />
        </button>
      )}
    </div>
  );
}

/** نص مختصر بسطر واحد مع تلميح كامل. */
export function Clip({ text, className = '', dir = 'auto' }: { text?: string | null; className?: string; dir?: 'auto' | 'ltr' | 'rtl' }) {
  if (!text) return <span className="text-slate-300">—</span>;
  return (
    <span className={`block truncate ${className}`} title={text} dir={dir}>
      {text}
    </span>
  );
}
