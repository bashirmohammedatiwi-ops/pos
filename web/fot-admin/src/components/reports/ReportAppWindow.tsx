import { useEffect, type ReactNode } from 'react';
import { IconX } from '@/components/icons';

/** نافذة تطبيق تقرير فوق الشبكة — إطار واضح، إغلاق بـ Escape. */
export function ReportAppWindow({
  title,
  subtitle,
  icon,
  accent,
  actions,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  accent?: string;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[55] flex items-stretch justify-center bg-slate-900/45 p-2 backdrop-blur-[2px] sm:p-4" dir="rtl">
      <div className="flex min-h-0 w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/10">
        <header
          className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 text-white"
          style={{ background: accent || 'linear-gradient(135deg, #0f9f76 0%, #0a6148 100%)' }}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-extrabold leading-6">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-[12px] text-white/80">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-white/10 p-2 text-white transition hover:bg-white/20"
              title="إغلاق (Escape)"
            >
              <IconX size={16} />
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">{children}</div>
      </div>
    </div>
  );
}
