import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconAlert, IconCheckCircle, IconInfo, IconX } from '@/components/icons';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  text: string;
}

interface ToastContextValue {
  toast: (text: string, type?: ToastType) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// الأخطاء تبقى أطول قليلاً ليتمكن المستخدم من قراءتها
const DURATION: Record<ToastType, number> = { success: 4000, info: 5000, error: 7000 };

const STYLES: Record<ToastType, { icon: string; bar: string; tile: string; title: string }> = {
  success: { icon: 'text-emerald-600', tile: 'bg-emerald-50', bar: 'bg-emerald-500', title: 'تم بنجاح' },
  error: { icon: 'text-red-600', tile: 'bg-red-50', bar: 'bg-red-500', title: 'حدث خطأ' },
  info: { icon: 'text-sky-600', tile: 'bg-sky-50', bar: 'bg-sky-500', title: 'تنبيه' },
};
const GLYPH = { success: IconCheckCircle, error: IconAlert, info: IconInfo };

function ToastCard({
  item,
  paused,
  onClose,
  onHover,
}: {
  item: ToastItem;
  paused: boolean;
  onClose: () => void;
  onHover: (v: boolean) => void;
}) {
  const total = DURATION[item.type];
  const remaining = useRef(total);
  const startedAt = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const t = window.setTimeout(() => closeRef.current(), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused]);

  const s = STYLES[item.type];
  const G = GLYPH[item.type];
  return (
    <div
      className="pointer-events-auto relative w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop"
      style={{ animation: 'slide-side 0.25s cubic-bezier(0.21,1.02,0.73,1) backwards' }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      role={item.type === 'error' ? 'alert' : 'status'}
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className={`icon-tile mt-0.5 h-7 w-7 shrink-0 rounded-lg ${s.tile} ${s.icon}`}><G size={15} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold text-header">{s.title}</p>
          <p className="mt-0.5 break-words text-[12.5px] leading-5 text-slate-600">{item.text}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
          aria-label="إغلاق"
        >
          <IconX size={13} />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100">
        <div
          className={`h-full origin-right ${s.bar} opacity-70`}
          style={{
            animation: `toast-progress ${total}ms linear forwards`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [hovered, setHovered] = useState(false);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((text: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setItems(prev => {
      // تجاهل التكرار المتتالي لنفس الرسالة
      const last = prev[prev.length - 1];
      if (last && last.text === text && last.type === type) return [...prev.slice(0, -1), { id, type, text }];
      return [...prev.slice(-3), { id, type, text }];
    });
  }, []);

  useEffect(() => {
    if (!items.length) setHovered(false);
  }, [items.length]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: t => push(t, 'success'),
      error: t => push(t, 'error'),
      info: t => push(t, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <style>{'@keyframes toast-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }'}</style>
      {/* أسفل اليسار: بعيداً عن القائمة الجانبية وأزرار الحفظ */}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[200] flex flex-col gap-2">
        {items.map(t => (
          <ToastCard key={t.id} item={t} paused={hovered} onClose={() => { setHovered(false); remove(t.id); }} onHover={setHovered} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
