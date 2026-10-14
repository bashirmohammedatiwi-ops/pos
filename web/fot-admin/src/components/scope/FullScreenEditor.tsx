import { Portal } from '@/components/ui';
import { useEffect, useRef } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';
import { IconChevronRight } from '@/components/icons';

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
  useScrollLock(open);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // نافذة أخرى (منتقي/تأكيد) فوق المحرر تتولى Escape بنفسها
      const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== rootRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
    <div
      ref={rootRef}
      dir="rtl"
      className="fixed inset-0 z-[60] flex flex-col bg-slate-50"
      role="dialog"
      aria-modal="true"
    >
      {/* الشريط العلوي */}
      <header className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="group flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-header"
          title="العودة للقائمة (Escape)"
        >
          <IconChevronRight size={16} className="transition group-hover:translate-x-0.5" />
          رجوع
        </button>

        <div className="h-7 w-px shrink-0 bg-slate-200" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate text-[16px] font-bold leading-7 text-header">{title}</h2>
            {status}
          </div>
          {subtitle && <div className="truncate text-[12px] leading-5 text-slate-500">{subtitle}</div>}
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
    </Portal>
  );
}
