import { useEffect } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FullScreenEditor — صفحة تحرير كاملة تُفتح فوق الصفحة الرئيسية.
 *
 * ليست نافذة منبثقة صغيرة: احتلال كامل للشاشة (100dvh) مع شريط علوي
 * احترافي (زر «← رجوع» + العنوان + الحالة + الأدوات) وجسم يتنفس
 * بعرض كبير وتمرير مستقل — تُغلق بـ Escape أو زر الرجوع فقط.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function FullScreenEditor({
  open,
  onClose,
  title,
  subtitle,
  status,
  actions,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** شارة الحالة (نشط/متوقف…) بجانب العنوان. */
  status?: React.ReactNode;
  /** أزرار الأدوات في أقصى يسار الشريط العلوي. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** عرض أوسع للمحتوى (للمحررات ذات العمودين). */
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[60] flex flex-col bg-slate-100"
    >
      {/* الشريط العلوي */}
      <header className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="group flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-white hover:text-header hover:ring-slate-300"
          title="العودة للقائمة (Escape)"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="transition group-hover:translate-x-0.5">
            <path d="M9 6l6 6-6 6" />
          </svg>
          رجوع
        </button>

        <div className="h-8 w-px shrink-0 bg-slate-200" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate text-[17px] font-extrabold leading-7 text-header">{title}</h2>
            {status}
          </div>
          {subtitle && <div className="mt-0.5 truncate text-[12px] leading-5 text-slate-500">{subtitle}</div>}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>

      {/* الجسم — تمرير مستقل وعرض مريح */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto w-full p-4 sm:p-6 ${wide ? 'max-w-[1500px]' : 'max-w-[1200px]'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
