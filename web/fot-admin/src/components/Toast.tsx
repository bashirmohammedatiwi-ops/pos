import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, type: ToastType = 'info') => {
      const id = Date.now() + Math.random();
      setItems(prev => [...prev.slice(-4), { id, type, text }]);
      window.setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: t => push(t, 'success'),
      error: t => push(t, 'error'),
      info: t => push(t, 'info'),
    }),
    [push],
  );

  const styles: Record<ToastType, { box: string; icon: string }> = {
    success: { box: 'border-emerald-200 bg-white text-emerald-900', icon: 'text-emerald-500' },
    error: { box: 'border-red-200 bg-white text-red-900', icon: 'text-red-500' },
    info: { box: 'border-slate-200 bg-white text-slate-800', icon: 'text-sky-500' },
  };
  const Glyph = { success: IconCheckCircle, error: IconAlert, info: IconInfo };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-sm flex-col gap-2">
        {items.map(t => {
          const s = styles[t.type];
          const G = Glyph[t.type];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px] shadow-pop ${s.box}`}
              style={{ animation: 'slide-side 0.25s cubic-bezier(0.21,1.02,0.73,1) both' }}
              role="status"
            >
              <span className={`mt-0.5 shrink-0 ${s.icon}`}><G size={17} /></span>
              <p className="min-w-0 flex-1 leading-6">{t.text}</p>
              <button
                type="button"
                className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() => remove(t.id)}
                aria-label="إغلاق"
              >
                <IconX size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
