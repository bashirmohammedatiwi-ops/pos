import type { FormEvent, ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
 * تخطيط «مساحة العمل» لصفحات القوائم — نفس نمط صفحة الفواتير:
 *   لوحة واحدة بعرض الشاشة: شريط فلاتر بعناوين · شريط مجاميع رفيع ·
 *   جدول يملأ باقي الارتفاع · تذييل اختياري.
 * الصفحة يجب أن تكون ضمن DENSE_LIST_PATHS ليحصل الجذر على ارتفاع كامل.
 * ───────────────────────────────────────────────────────────────────────────── */

/** الجذر: عمود يملأ الصفحة (شرائط تنبيه فوق اللوحة مسموحة). */
export function WorkspacePage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-2">{children}</div>;
}

/** اللوحة الرئيسية بعرض وارتفاع كاملين. */
export function WorkspaceCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card flex min-h-0 flex-1 flex-col overflow-hidden ${className}`}>{children}</section>;
}

/** شريط الفلاتر أعلى اللوحة. يُرسل onSubmit عند Enter إن وُجد. */
export function FilterBar({
  children,
  onSubmit,
  footer,
}: {
  children: ReactNode;
  onSubmit?: () => void;
  /** صف ثانٍ: مبدّلات (نوع/حالة) وروابط سريعة. */
  footer?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-end gap-2">{children}</div>
      {footer && <div className="mt-2 flex flex-wrap items-center gap-2">{footer}</div>}
    </>
  );
  const cls = 'shrink-0 border-b border-slate-200 bg-slate-50/70 px-3 pb-2.5 pt-2';
  return onSubmit ? (
    <form
      className={cls}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {body}
    </form>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** حقل فلتر بعنوان صغير فوقه. */
export function FilterLabel({
  label,
  children,
  className = '',
  grow,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** يتمدد ليأخذ المساحة المتبقية (حقل البحث). */
  grow?: boolean;
}) {
  return (
    <label className={`block min-w-0 ${grow ? 'min-w-[220px] flex-[2_1_260px]' : 'w-full sm:w-auto sm:min-w-[140px]'} ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/** أزرار الفلتر في نهاية الشريط (تُحاذى مع الحقول). */
export function FilterActions({ children }: { children: ReactNode }) {
  return <div className="ms-auto flex items-center gap-1.5">{children}</div>;
}

export type SummaryCell = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'brand' | 'ok' | 'warn' | 'danger';
  onClick?: () => void;
  active?: boolean;
};

const TONE_TEXT: Record<NonNullable<SummaryCell['tone']>, string> = {
  brand: 'text-brand-800',
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  danger: 'text-red-700',
};

/** شريط مجاميع رفيع بخلايا متساوية — بديل بطاقات المؤشرات الكبيرة. */
export function SummaryStrip({ cells, loading }: { cells: SummaryCell[]; loading?: boolean }) {
  const cols = Math.min(cells.length, 6);
  const lg = ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4', 'lg:grid-cols-5', 'lg:grid-cols-6'][cols];
  return (
    <div className={`grid shrink-0 grid-cols-2 divide-x divide-x-reverse divide-slate-100 border-b border-slate-200 bg-white sm:grid-cols-3 ${lg}`}>
      {cells.map(c => {
        const Tag = c.onClick ? 'button' : 'div';
        return (
          <Tag
            key={c.label}
            type={c.onClick ? 'button' : undefined}
            onClick={c.onClick}
            className={`min-w-0 px-3 py-1.5 text-right ${c.onClick ? 'transition hover:bg-slate-50' : ''} ${c.active ? 'bg-brand-50/60 shadow-[inset_0_-2px_0_var(--color-brand-500)]' : ''}`}
          >
            <p className="truncate text-[10.5px] font-semibold text-slate-500">{c.label}</p>
            {loading ? (
              <div className="skeleton mt-1 h-4 w-20" />
            ) : (
              <p className={`truncate text-[15px] font-bold leading-6 num ${c.tone ? TONE_TEXT[c.tone] : 'text-header'}`}>{c.value}</p>
            )}
            {c.hint && !loading && <p className="hidden truncate text-[10.5px] text-slate-400 num [@media(min-height:840px)]:block">{c.hint}</p>}
          </Tag>
        );
      })}
    </div>
  );
}

/** منطقة الجدول — تملأ الارتفاع المتبقي. ضع داخلها DataGrid بـ embedded + fillHeight. */
export function WorkspaceBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

/** تذييل رفيع (مجاميع/ترقيم). */
export function WorkspaceFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-200 bg-slate-50/80 px-4 py-1.5 text-[12px]">
      {children}
    </div>
  );
}

/** مقسّم صغير بعدّادات (نوع/حالة) لصف الفلاتر الثاني. */
export function SegmentedFilter<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { id: T; label: string; count?: number; tone?: 'warn' | 'danger' }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
      {items.map(it => {
        const on = it.id === value;
        const activeText = it.tone === 'warn' ? 'text-amber-800' : it.tone === 'danger' ? 'text-red-700' : 'text-brand-800';
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(it.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition ${
              on ? `bg-slate-100 ring-1 ring-slate-200 ${activeText}` : 'text-slate-500 hover:bg-slate-50 hover:text-header'
            }`}
          >
            {it.label}
            {it.count != null && (
              <span className={`rounded-full px-1.5 text-[10.5px] font-bold num ${on ? 'bg-white text-slate-700' : 'bg-slate-100 text-slate-500'}`}>
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
