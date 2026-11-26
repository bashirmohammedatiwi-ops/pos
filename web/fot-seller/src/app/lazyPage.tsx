import { Suspense, lazy, type ComponentType } from 'react';
import { Skeleton } from './kit';

/* ─────────────────────────────────────────────────────────────────────────────
 * صفحات تُحمَّل عند فتحها فقط (أسرع أول فتح على الهاتف): المدراء، المحادثات، العمولات، الكتالوج…
 * تُجلب في الخلفية بعد أن يهدأ التطبيق، فيبقى التنقل إليها فورياً.
 * ───────────────────────────────────────────────────────────────────────────── */

function PageLoading() {
  return (
    <div className="t-page lazy-wait" aria-busy="true" aria-label="جارٍ التحميل">
      <Skeleton h={34} r={12} mt={28} />
      <Skeleton h={16} r={8} mt={10} />
      <Skeleton h={120} r={22} mt={22} />
      <Skeleton h={72} r={18} mt={12} />
      <Skeleton h={72} r={18} mt={12} />
    </div>
  );
}

const loaders: (() => Promise<unknown>)[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<P extends Record<string, any>>(load: () => Promise<ComponentType<P>>, opts: { prefetch?: boolean } = {}) {
  let promise: Promise<{ default: ComponentType<P> }> | null = null;
  const get = () => (promise ??= load().then(C => ({ default: C })));
  if (opts.prefetch !== false) loaders.push(get);
  const Lazy = lazy(get);
  return function Page(props: P) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

/** بعد أول عرض وهدوء الشبكة: تُجلب بقية الصفحات بهدوء */
let started = false;
export function prefetchPages() {
  if (started) return;
  started = true;
  const idle = (cb: () => void) => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 4000 });
    else window.setTimeout(cb, 1500);
  };
  // بيانات الهاتف المحدودة: لا جلب مسبق
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return;
  window.setTimeout(() => {
    const queue = [...loaders];
    const next = () => {
      const f = queue.shift();
      if (!f) return;
      idle(() => {
        void f()
          .catch(() => undefined)
          .finally(next);
      });
    };
    next();
  }, 2500);
}
