import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Btn, Field, Input } from '@/components/ui';
import { IconSearch, IconX } from '@/components/icons';

/** Standard vertical spacing for admin pages */
export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-4 ${className ?? ''}`.trim()}>{children}</div>;
}

/**
 * تخطيط صفحات القوائم: شريط فلاتر مضغوط أعلى · محتوى (جدول) يملأ المساحة · تذييل إحصاءات أسفل.
 */
export function ListPageShell({
  filter,
  banner,
  children,
  footer,
  className,
}: {
  filter?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`list-page-shell flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white ${className ?? ''}`.trim()}>
      {banner}
      {filter && (
        <div className="shrink-0 border-b border-slate-200 bg-white px-2 py-1.5">
          {filter}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      {footer && (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50/95">
          {footer}
        </div>
      )}
    </div>
  );
}

/** إحصاءات مدمجة في سطر واحد أسفل الصفحة */
export function CompactStatsBar({
  items,
}: {
  items: { label: string; value: string | number; tone?: 'default' | 'brand' | 'ok' | 'warn' }[];
}) {
  const tones: Record<string, string> = {
    brand: 'text-brand-700',
    ok: 'text-emerald-700',
    warn: 'text-amber-700',
    default: 'text-slate-800',
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1 text-[10.5px]">
      {items.map((item, i) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {i > 0 && <span className="text-slate-300 select-none">·</span>}
          <span className="text-slate-500">{item.label}</span>
          <span className={`font-bold num ${tones[item.tone ?? 'default']}`}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/** حقول مضغوطة لشريط الفلاتر */
export const COMPACT_CTRL =
  'rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 outline-none transition hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15';

/** شريط فلاتر علوي مضغوط — بحث + شرائح + حقول + أزرار في صف أو صفين */
export function FilterStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-1.5 ${className ?? ''}`.trim()}>{children}</div>;
}

/** تذييل صفحة قائمة: إحصاءات يسار + ترقيم يمين */
export function ListPageFooter({ stats, pagination }: { stats?: ReactNode; pagination?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 flex-1">{stats}</div>
      {pagination}
    </div>
  );
}

/** صف فلاتر مضغوط بدون تسميات كبيرة */
export function CompactFilterRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

/** Inline row of date/select filters */
export function FilterFields({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'flex flex-wrap items-end gap-3'}>
      {children}
    </div>
  );
}

export function DashCard({
  title,
  action,
  children,
  icon,
  compact,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`overflow-hidden border border-border bg-white ${compact ? 'rounded-lg' : 'rounded-lg'}`}>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white ${
          compact ? 'px-2 py-1.5' : 'px-4 py-3'
        }`}
      >
        <h2 className={`flex min-w-0 items-center gap-2 font-bold text-header ${compact ? 'gap-1.5 text-[11px]' : 'gap-2.5 text-[13px]'}`}>
          {icon && <span className={`icon-tile bg-slate-100 text-slate-600 ${compact ? 'h-5 w-5' : 'h-7 w-7'}`}>{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MetricBar({
  items,
}: {
  items: { label: string; value: string | number; tone?: 'default' | 'brand' | 'ok' | 'warn'; hint?: string; icon?: ReactNode }[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item, i) => {
          const tones: Record<string, string> = {
            brand: 'text-brand-700',
            ok: 'text-emerald-700',
            warn: 'text-amber-700',
            default: 'text-header',
          };
          const iconTones: Record<string, string> = {
            brand: 'bg-brand-50 text-brand-600',
            ok: 'bg-emerald-50 text-emerald-600',
            warn: 'bg-amber-50 text-amber-600',
            default: 'bg-slate-100 text-slate-500',
          };
          return (
            <div
              key={item.label}
              className={`relative px-4 py-3.5 ${i ? 'border-t border-slate-100 sm:border-t-0 sm:border-r sm:border-slate-100' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11.5px] font-medium text-slate-500">{item.label}</p>
                {item.icon && <span className={`icon-tile h-7 w-7 ${iconTones[item.tone ?? 'default']}`}>{item.icon}</span>}
              </div>
              <p className={`mt-1.5 text-[21px] font-bold leading-none num ${tones[item.tone ?? 'default']}`}>{item.value}</p>
              {item.hint && <p className="mt-1.5 text-[10.5px] text-slate-400">{item.hint}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SegmentedTabs<T extends string | number>({
  items,
  value,
  onChange,
  compact,
}: {
  items: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`inline-flex max-w-full flex-wrap gap-0.5 border border-slate-200 bg-slate-100/70 p-0.5 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] ${
        compact ? 'rounded-md' : 'rounded-md p-0.5'
      }`}
    >
      {items.map(item => (
        <button
          key={String(item.id)}
          type="button"
          onClick={() => onChange(item.id)}
          className={`relative font-semibold ${
            compact ? 'rounded-md px-2.5 py-1 text-[10.5px]' : 'rounded-xl px-4 py-1.5 text-[13px]'
          } ${
            value === item.id
              ? 'bg-white text-header shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {item.label}
          {item.count != null && item.count > 0 && (
            <span
              className={`ms-1 inline-flex items-center justify-center rounded-full px-1 font-bold num ${
                compact ? 'h-[15px] min-w-[15px] text-[9px]' : 'h-[17px] min-w-[17px] text-[10px]'
              } ${value === item.id ? 'bg-brand-100 text-brand-700' : 'bg-slate-200/80 text-slate-600'}`}
            >
              {item.count > 99 ? '99+' : item.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function SplitWorkspace({ rail, children, compact, fill }: { rail: ReactNode; children: ReactNode; compact?: boolean; fill?: boolean }) {
  return (
    <div
      className={`grid gap-2 lg:grid-cols-[minmax(200px,240px)_minmax(0,1fr)] lg:items-stretch ${
        fill ? 'h-full min-h-0' : compact ? 'min-h-[calc(100vh-300px)]' : 'min-h-[calc(100vh-220px)]'
      }`}
    >
      {rail}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

export function RailCard({ title, actions, children, compact, icon }: { title: string; actions?: ReactNode; children: ReactNode; compact?: boolean; icon?: ReactNode }) {
  return (
    <aside className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-white ${compact ? 'lg:max-h-[calc(100vh-300px)]' : 'lg:max-h-[calc(100vh-220px)]'}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <h3 className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-header">
          {icon && <span className="icon-tile h-6 w-6 bg-brand-50 text-brand-600">{icon}</span>}
          <span className="truncate">{title}</span>
        </h3>
        {actions}
      </div>
      {children}
    </aside>
  );
}

export function RailTools({ children }: { children: ReactNode }) {
  return <div className="shrink-0 space-y-2 border-b border-slate-100 bg-slate-50/50 p-2.5">{children}</div>;
}

export function RailList({ children }: { children: ReactNode }) {
  return <ul className="min-h-0 flex-1 overflow-y-auto">{children}</ul>;
}

export function SettingsStrip({ children }: { children: ReactNode }) {
  return <div className="shrink-0 space-y-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">{children}</div>;
}

export function RailItem({
  active,
  title,
  meta,
  badge,
  leading,
  trailing,
  onClick,
}: {
  active?: boolean;
  title: string;
  meta?: ReactNode;
  badge?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <div className={`flex items-stretch border-b border-slate-100/80 transition-colors last:border-b-0 ${active ? 'bg-brand-50/50' : 'hover:bg-slate-50/60'}`}>
      {leading && <div className="flex shrink-0 items-center px-2">{leading}</div>}
      <button
        type="button"
        onClick={onClick}
        className={`min-w-0 flex-1 border-r-[3px] px-3 py-2.5 text-right transition-all ${
          active ? 'border-brand-600' : 'border-transparent'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-[13px] ${active ? 'font-bold text-header' : 'font-medium text-slate-800'}`}>
            {title}
          </span>
          {badge}
        </div>
        {meta && <div className="mt-1 text-[11px] text-slate-500">{meta}</div>}
      </button>
      {trailing && (
        <div className="flex shrink-0 items-center gap-0.5 px-1" onClick={e => e.stopPropagation()}>
          {trailing}
        </div>
      )}
    </div>
  );
}

/** Main panel in SplitWorkspace — title bar + scrollable body */
export function WorkspacePanel({
  title,
  subtitle,
  actions,
  children,
  className,
  flush,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  icon?: ReactNode;
}) {
  return (
    <section className={`flex h-full min-h-[calc(100vh-260px)] flex-col overflow-hidden rounded-lg border border-border bg-white ${className ?? ''}`}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="icon-tile h-8 w-8 bg-brand-50 text-brand-600">{icon}</span>}
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold text-header">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[12px] text-slate-500">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${flush ? '' : 'p-4'}`}>{children}</div>
    </section>
  );
}

export function ProgressCell({ percent, tone = 'brand' }: { percent: number; tone?: 'brand' | 'ok' }) {
  const p = Math.min(100, Math.max(0, percent));
  const bar = tone === 'ok' || p >= 100 ? 'bg-emerald-500' : 'bg-brand-600';
  return (
    <div className="flex min-w-[100px] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${p}%` }} />
      </div>
      <span className="w-9 text-[11px] font-semibold num text-slate-500">{p.toFixed(0)}%</span>
    </div>
  );
}

export function EditorChrome({
  title,
  subtitle,
  actions,
  children,
  flush,
  icon,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  icon?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="icon-tile h-8 w-8 bg-brand-50 text-brand-600">{icon}</span>}
            <div className="min-w-0">
              {title && <div className="text-[15px] font-bold text-header">{title}</div>}
              {subtitle && <div className="mt-0.5 text-[12px] text-slate-500">{subtitle}</div>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'bg-slate-50/60 p-4' : ''}>{children}</div>
    </section>
  );
}

export function EmptyWorkspace({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-8 py-12 text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        {icon ?? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        )}
      </div>
      <h2 className="text-[17px] font-bold text-header">{title}</h2>
      <p className="mt-2 max-w-md text-[13px] leading-6 text-slate-500">{hint}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function UnsavedBar({
  text,
  onSave,
  pending,
  disabled,
}: {
  text: string;
  onSave: () => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-lg bg-header px-4 py-2.5 text-white shadow-pop">
      <span className="flex items-center gap-2 text-[13px]">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        {text}
      </span>
      <Btn size="sm" onClick={onSave} disabled={pending || disabled}>
        {pending ? 'جاري الحفظ…' : 'حفظ'}
      </Btn>
    </div>
  );
}

export function StatusChip({ active, onLabel = 'نشط', offLabel = 'متوقف' }: { active: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ${
        active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/70' : 'bg-slate-100 text-slate-500 ring-slate-200/70'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? onLabel : offLabel}
    </span>
  );
}

export function SoftChip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'brand' | 'ok' | 'warn' }) {
  const styles = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-200/50',
    brand: 'bg-brand-50 text-brand-800 ring-brand-100',
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    warn: 'bg-amber-50 text-amber-800 ring-amber-100',
  };
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${styles[tone]}`}>{children}</span>;
}

export function InfoNote({ children, strip }: { children: ReactNode; strip?: boolean }) {
  if (strip) {
    return (
      <div className="border-b border-brand-100/80 bg-brand-50/50 px-2 py-1 text-[10.5px] leading-5 text-brand-950">
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-[13px] leading-6 text-brand-950">
      <span className="mt-0.5 shrink-0 text-brand-500">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SettingsDrawer({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="shrink-0 rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex-1 text-[13px] text-slate-700">{summary}</div>
        <Btn size="sm" variant="secondary" onClick={() => setOpen(o => !o)}>
          {open ? 'إخفاء' : 'تعديل'}
        </Btn>
      </div>
      {open && <div className="max-h-[40vh] space-y-3 overflow-y-auto border-t border-slate-100 bg-slate-50/40 p-3.5">{children}</div>}
    </div>
  );
}

export function FormSection({
  step,
  title,
  hint,
  children,
  actions,
  grow,
  compact,
}: {
  step?: string | number;
  title: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
  grow?: boolean;
  compact?: boolean;
}) {
  return (
    <section
      className={`border border-border bg-white rounded-lg ${grow ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : ''}`}
    >
      <header
        className={`flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 bg-white ${
          compact ? 'px-2.5 py-2' : 'px-4 py-3'
        }`}
      >
        <div className="flex min-w-0 items-start gap-2">
          {step != null && (
            <span
              className={`mt-0.5 flex shrink-0 items-center justify-center rounded-md bg-slate-800 font-bold text-white ${
                compact ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-[12px]'
              }`}
            >
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h4 className={`font-bold text-header ${compact ? 'text-[12px]' : 'text-[14px]'}`}>{title}</h4>
            {hint && <p className={`mt-0.5 leading-5 text-slate-500 ${compact ? 'text-[10.5px]' : 'text-[12px]'}`}>{hint}</p>}
          </div>
        </div>
        {actions}
      </header>
      <div className={grow ? `flex min-h-0 flex-1 flex-col overflow-hidden ${compact ? 'p-2' : 'p-4'}` : compact ? 'p-2' : 'p-4'}>{children}</div>
    </section>
  );
}

export function EntityCard({
  title,
  eyebrow,
  status,
  metrics,
  chips,
  actions,
}: {
  title: string;
  eyebrow?: ReactNode;
  status?: ReactNode;
  metrics?: { label: string; value: ReactNode }[];
  chips?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article className="flex flex-col rounded-lg border border-border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-[11px] font-semibold text-slate-400">{eyebrow}</div>}
          <h3 className="truncate text-[15px] font-bold text-header">{title}</h3>
        </div>
        {status}
      </div>
      {!!metrics?.length && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50/70 p-3 text-[12px]">
          {metrics.map(m => (
            <div key={m.label} className="min-w-0">
              <dt className="text-slate-400">{m.label}</dt>
              <dd className="mt-0.5 truncate font-bold num text-slate-800">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {chips && <div className="mt-3 flex flex-wrap gap-1">{chips}</div>}
      {actions && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {actions}
        </div>
      )}
    </article>
  );
}

export function ListToolbar({
  search,
  onSearch,
  searchLabel = 'بحث',
  searchPlaceholder,
  searchOnKeyDown,
  filters,
  actions,
  nested,
  strip,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  searchOnKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  filters?: ReactNode;
  actions?: ReactNode;
  /** Lighter style when placed inside EditorChrome */
  nested?: boolean;
  /** داخل ListPageShell — صف مضغوط بلا إطار */
  strip?: boolean;
}) {
  const hasValue = !!(search && search.length);
  const compact = strip || nested;
  return (
    <div
      className={
        strip
          ? 'flex flex-wrap items-center justify-between gap-1.5'
          : nested
            ? 'flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3'
            : 'flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-white p-3.5'
      }
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {onSearch && (
          compact ? (
            <div className={`relative ${strip ? 'min-w-[160px] max-w-[220px]' : 'min-w-[200px] max-w-xs flex-1'}`}>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-slate-400">
                <IconSearch size={strip ? 12 : 14} />
              </span>
              <Input
                value={search ?? ''}
                onChange={e => onSearch(e.target.value)}
                onKeyDown={searchOnKeyDown}
                placeholder={searchPlaceholder ?? searchLabel}
                className={strip ? 'py-1 pe-2 ps-7 text-[11px]' : 'py-1.5 pe-3 ps-8'}
              />
            </div>
          ) : (
            <div className="min-w-[220px] flex-1">
              <Field label={searchLabel}>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                    <IconSearch size={15} />
                  </span>
                  <Input
                    value={search ?? ''}
                    onChange={e => onSearch(e.target.value)}
                    onKeyDown={searchOnKeyDown}
                    placeholder={searchPlaceholder}
                    className="pe-3 ps-9"
                  />
                  {hasValue && (
                    <button
                      type="button"
                      onClick={() => onSearch('')}
                      className="absolute inset-y-0 left-2 my-auto flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      aria-label="مسح البحث"
                    >
                      <IconX size={13} />
                    </button>
                  )}
                </div>
              </Field>
            </div>
          )
        )}
        {filters && <div className="flex flex-wrap items-center gap-1">{filters}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterChip({
  active,
  children,
  onClick,
  tone,
  compact,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'brand' | 'danger' | 'warn';
  compact?: boolean;
}) {
  const activeTones = {
    default: 'bg-header text-white ring-header',
    brand: 'bg-brand-600 text-white ring-brand-600',
    danger: 'bg-red-600 text-white ring-red-600',
    warn: 'bg-amber-500 text-white ring-amber-500',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md font-semibold ring-1 ${
        compact ? 'px-2 py-0.5 text-[10.5px]' : 'px-3 py-1 text-[12px]'
      } ${
        active
          ? activeTones[tone ?? 'default']
          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
