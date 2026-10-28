import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Kbd } from '@/components/ui';
import { IconKeyboard, IconX } from '@/components/icons';

type Row = { keys: string[][]; label: string };

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'عام',
    rows: [
      { keys: [['Ctrl', 'K']], label: 'بحث سريع في النظام (صفحات، منتجات، فواتير، عروض)' },
      { keys: [['Ctrl', 'B']], label: 'تصغير أو توسيع القائمة الجانبية' },
      { keys: [['F1']], label: 'عرض أو إخفاء هذه القائمة' },
      { keys: [['Esc']], label: 'إغلاق النوافذ والقوائم' },
    ],
  },
  {
    title: 'لوحة التحكم الرئيسية',
    rows: [
      { keys: [['R']], label: 'تحديث جميع أرقام ومؤشرات اللوحة فوراً' },
      { keys: [['T']], label: 'العودة إلى أرقام اليوم المباشر' },
      { keys: [['Y']], label: 'التبديل السريع لاستعراض يوم أمس' },
      { keys: [['1'], ['7']], label: 'الانتقال السريع بين أقسام اللوحة السبعة' },
    ],
  },
  {
    title: 'النماذج والقوائم',
    rows: [
      { keys: [['Ctrl', 'S']], label: 'حفظ التعديلات في الصفحة الحالية إن وُجدت' },
      { keys: [['Enter']], label: 'تطبيق البحث أو الفلتر في الحقل النشط' },
      { keys: [['Tab'], ['Shift', 'Tab']], label: 'الانتقال بين الحقول' },
    ],
  },
  {
    title: 'داخل البحث السريع',
    rows: [
      { keys: [['↑'], ['↓']], label: 'التنقل بين النتائج' },
      { keys: [['Enter']], label: 'فتح النتيجة المحددة' },
      { keys: [['Esc']], label: 'مسح البحث ثم الإغلاق' },
    ],
  },
];

function Combo({ combo }: { combo: string[] }) {
  const parts: ReactNode[] = [];
  combo.forEach((k, i) => {
    if (i > 0) parts.push(<span key={`p-${i}`} className="text-[10px] text-slate-300">+</span>);
    parts.push(<Kbd key={k}>{k}</Kbd>);
  });
  return <span className="inline-flex items-center gap-1" dir="ltr">{parts}</span>;
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    function reset() {
      setOpen(false);
    }
    window.addEventListener('fot-admin-reset-overlays', reset);
    return () => window.removeEventListener('fot-admin-reset-overlays', reset);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F1') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    }
    function onHelp() {
      setOpen(v => !v);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('fot-admin-help', onHelp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('fot-admin-help', onHelp);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex animate-fade-in items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg animate-pop-in flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="icon-tile h-9 w-9 rounded-lg bg-brand-50 text-brand-600"><IconKeyboard size={17} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="shortcuts-title" className="text-[15px] font-bold text-header">اختصارات لوحة المفاتيح</h2>
            <p className="text-[12px] text-slate-500">اعمل أسرع دون الحاجة للفأرة</p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setOpen(false)}
            aria-label="إغلاق"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {SECTIONS.map(sec => (
            <section key={sec.title}>
              <h3 className="mb-1.5 text-[11px] font-bold text-slate-400">{sec.title}</h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {sec.rows.map(r => (
                  <li key={r.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                    <span className="text-slate-700">{r.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.keys.map((combo, i) => (
                        <span key={combo.join('+')} className="inline-flex items-center gap-1.5">
                          {i > 0 && <span className="text-[11px] text-slate-300">/</span>}
                          <Combo combo={combo} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[11.5px] text-slate-500">
          اضغط <Kbd>F1</Kbd> في أي وقت لإظهار هذه القائمة
        </div>
      </div>
    </div>
  );
}
