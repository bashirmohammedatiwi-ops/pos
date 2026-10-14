import { Portal } from '@/components/ui';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconX } from '@/components/icons';
import { useScrollLock } from '@/hooks/useScrollLock';

/**
 * نافذة تقرير بملء الشاشة: رأس واحد مضغوط (أيقونة · عنوان · الفترة/الفلاتر · تصدير/طباعة · إغلاق)،
 * لوحة جانبية اختيارية، ثم المحتوى (شريط مجاميع + جدول يملأ باقي الارتفاع).
 * Escape يغلق ما لم يكن التركيز في حقل أو كانت نافذة أخرى مفتوحة فوقها.
 */
export function ReportAppWindow({
  title,
  subtitle,
  icon,
  accent,
  actions,
  toolbar,
  aside,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  /** لون رأس النافذة (تدرّج CSS) — هوية لكل تقرير. */
  accent?: string;
  actions?: ReactNode;
  /** الفترة والفلاتر — تُعرض داخل الرأس نفسه. */
  toolbar?: ReactNode;
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useScrollLock(true);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      // نافذة أو تأكيد فوق التقرير — يتعامل معها أولاً
      if (document.querySelector('[role="alertdialog"], [role="dialog"]:not([data-report-window])')) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Portal>
    <div className="fixed inset-0 z-[55] flex bg-white animate-fade-in" dir="rtl">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-report-window
        className="flex min-h-0 w-full flex-col overflow-hidden bg-white outline-none"
      >
        <header
          className="relative flex shrink-0 items-center gap-3 overflow-hidden px-4 py-3 text-white"
          style={{ background: accent || 'linear-gradient(135deg, #10b981 0%, #047857 100%)' }}
          data-print-hide
        >
          <span aria-hidden className="pointer-events-none absolute -top-10 left-24 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
          <div className="relative min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-[17px] font-extrabold leading-6">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-[12px] font-medium text-white/85">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative inline-flex h-9 items-center gap-2 rounded-xl bg-white/12 px-3 text-[12.5px] font-bold text-white ring-1 ring-white/20 transition hover:bg-white/25"
            title="إغلاق (Esc)"
            aria-label="إغلاق التقرير"
          >
            <span className="hidden text-[11px] font-semibold text-white/75 sm:inline">Esc</span>
            <IconX size={16} />
          </button>
        </header>
        {(toolbar || actions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2" data-print-hide>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
            {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
          </div>
        )}
        <div className="flex min-h-0 flex-1 overflow-hidden bg-white">
          {aside}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </div>
    </div>
    </Portal>
  );
}

/** لوحة إعداد جانبية داخل نافذة التقرير (البائعون المثبتون، نسبة التخفيض…). */
export function ReportAside({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside
      className="flex w-[min(100%,300px)] shrink-0 animate-slide-in-start flex-col border-l border-slate-200 bg-white"
      data-keep-escape
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <h3 className="text-[13px] font-bold text-header">{title}</h3>
        {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{description}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{children}</div>
      {footer && <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">{footer}</div>}
    </aside>
  );
}
