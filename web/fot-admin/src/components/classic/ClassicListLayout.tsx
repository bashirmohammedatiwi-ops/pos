import { useCallback, useState, type ReactNode } from 'react';
import { formatNum } from '@/api/client';
import { Btn } from '@/components/ui';
import { IconRefresh } from '@/components/icons';

/** حقل فلتر موسّم — مثل التطبيق القديم */
export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className ?? ''}`.trim()}>
      <span className="mb-1 block text-[11.5px] font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function ClassicResultBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-9 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-center text-[12.5px] font-bold text-brand-800 num">
      {children}
    </span>
  );
}

export function ClassicGridHeader({
  title,
  hint,
  actions,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
      <div>
        <h2 className="text-[14px] font-bold text-header">{title}</h2>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ClassicSummaryFooter({
  title = 'ملخص النتائج',
  items,
  total,
  totalLabel = 'إجمالي السجلات',
  loading,
}: {
  title?: string;
  items: { label: string; value: string; accent?: boolean }[];
  total?: number;
  totalLabel?: string;
  loading?: boolean;
}) {
  const dash = loading ? '…' : '—';
  return (
    <div className="shrink-0 border-t border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-2">
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="flex min-w-[110px] flex-col justify-center rounded-lg bg-slate-900 px-3 py-1.5 text-white">
          <p className="text-[10.5px] font-medium text-slate-400">{title}</p>
          {total != null ? (
            <p className="text-[15px] font-bold leading-6 num" title={totalLabel}>
              {formatNum(total)} <span className="text-[10.5px] font-medium text-slate-400">سجل</span>
            </p>
          ) : (
            <p className="text-[12px] font-semibold text-slate-200">—</p>
          )}
        </div>
        {items.map(item => (
          <div
            key={item.label}
            className={`min-w-[110px] flex-1 rounded-lg border px-3 py-1.5 ${item.accent ? 'border-brand-200 bg-brand-50/70' : 'border-slate-200 bg-white'}`}
          >
            <p className="truncate text-[10.5px] font-medium text-slate-500">{item.label}</p>
            <p className={`truncate text-[14.5px] font-bold leading-6 num ${item.accent ? 'text-brand-800' : 'text-header'}`}>
              {item.value || dash}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClassicTabBar({
  items,
  value,
  onChange,
}: {
  items: { id: number | string; label: string; count?: number }[];
  value: number | string;
  onChange: (id: number | string) => void;
}) {
  return (
    <div className="flex gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-1">
      {items.map(t => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-[13px] transition ${
              active
                ? 'border-brand-600 font-semibold text-brand-800'
                : 'border-transparent text-slate-500 hover:text-header'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className="ms-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 num">
                {formatNum(t.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ClassicListShell({
  banner,
  filters,
  tabs,
  header,
  children,
  pagination,
  footer,
  onRefresh,
  refreshing,
}: {
  banner?: ReactNode;
  filters: ReactNode;
  tabs?: ReactNode;
  header?: { title: string; hint?: string; actions?: ReactNode };
  children: ReactNode;
  pagination?: ReactNode;
  footer?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      {banner}
      <div className="shrink-0 border-b border-slate-200 bg-slate-50/60 px-3 py-3">{filters}</div>
      {tabs}
      {header && (
        <ClassicGridHeader title={header.title} hint={header.hint} actions={
          <div className="flex items-center gap-2">
            {header.actions}
            {onRefresh && (
              <Btn variant="secondary" size="sm" onClick={onRefresh} title="تحديث">
                <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} />
              </Btn>
            )}
          </div>
        } />
      )}
      <div className="min-h-0 flex-1">{children}</div>
      {(pagination || footer) && (
        <div className="shrink-0">
          {pagination && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-2 py-1.5">
              {pagination}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}

/** فلاتر مسودة / مطبّقة — زر استعراض قبل التحميل */
export function useClassicFilters<T extends Record<string, unknown>>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const [applied, setApplied] = useState<T>(initial);

  const apply = useCallback((patch?: Partial<T>) => {
    setDraft(prev => {
      const next = { ...prev, ...patch };
      setApplied(next);
      return next;
    });
  }, []);

  const clear = useCallback((defaults: T) => {
    setDraft(defaults);
    setApplied(defaults);
  }, []);

  const patchDraft = useCallback((patch: Partial<T>) => {
    setDraft(prev => ({ ...prev, ...patch }));
  }, []);

  return { draft, setDraft, patchDraft, applied, apply, clear };
}

export function ClassicFilterActions({
  onApply,
  onClear,
  applyLabel = 'استعراض',
  extra,
}: {
  onApply: () => void;
  onClear: () => void;
  applyLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Btn onClick={onApply}>{applyLabel}</Btn>
      <Btn variant="secondary" onClick={onClear}>مسح</Btn>
      {extra}
    </div>
  );
}
