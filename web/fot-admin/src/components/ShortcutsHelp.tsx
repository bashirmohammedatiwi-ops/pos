import { useEffect, useState } from 'react';

const ROWS = [
  ['Ctrl + K', 'بحث في النظام (صفحات، منتجات، فواتير، عروض)'],
  ['Ctrl + S', 'حفظ التعديلات في الصفحة الحالية إن وُجدت'],
  ['F1', 'عرض أو إخفاء اختصارات العمل'],
  ['Enter', 'تطبيق البحث أو الفلتر في الحقل النشط'],
  ['Esc', 'إغلاق النوافذ والقوائم'],
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">اختصارات العمل</h2>
          <button type="button" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <ul className="space-y-2 text-[13px]">
          {ROWS.map(([key, label]) => (
            <li key={key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-slate-600">{label}</span>
              <kbd className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">{key}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
