import { useEffect, useState } from 'react';
import { isNative } from '../config';
import { I } from './kit';
import { haptic } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * تحديث الموقع تلقائياً (الموقع المثبّت على الشاشة الرئيسية خصوصاً):
 * الآيفون يُبقي الموقع المثبّت مفتوحاً في الذاكرة أياماً فلا يعيد تحميله بعد نشر نسخة جديدة.
 * كل بناء يكتب رقمه في version.json؛ الموقع يقارنه برقمه عند الفتح، وعند العودة إليه، وكل 5 دقائق.
 *   · عاد المستخدم للموقع للتو (أو فتحه) ← يُحدَّث فوراً قبل أن يبدأ العمل.
 *   · وهو يعمل ← شريط صغير «نسخة جديدة» بزر تحديث، ويُحدَّث وحده عند العودة التالية.
 * التحديث بعنوان جديد (?v=) فيتجاوز أي نسخة محفوظة من الصفحة. داخل تطبيق الهاتف لا يعمل (له تحديثه).
 * ───────────────────────────────────────────────────────────────────────────── */

declare const __BUILD_ID__: string;
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const TRIED = 'fot_web_update_tried';

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const v = (await res.json()) as { build?: string };
    return typeof v.build === 'string' ? v.build : null;
  } catch {
    return null;
  }
}

function reloadTo(build: string) {
  try {
    // محاولة واحدة لكل نسخة: إن بقيت الصفحة قديمة بعد التحديث لا ندخل في حلقة
    if (sessionStorage.getItem(TRIED) === build) return false;
    sessionStorage.setItem(TRIED, build);
  } catch {
    /* تخزين غير متاح */
  }
  const url = new URL(location.href);
  url.searchParams.set('v', build);
  location.replace(url.toString());
  return true;
}

export function WebUpdate() {
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    if (isNative() || BUILD_ID === 'dev') return;
    let alive = true;
    let pending: string | null = null;
    const check = async (fresh: boolean) => {
      const build = await latestBuild();
      if (!alive || !build || build === BUILD_ID) return;
      // فتح الموقع أو العودة إليه: التحديث فوراً
      if (fresh && reloadTo(build)) return;
      pending = build;
      setReady(build);
    };
    void check(true);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (pending && reloadTo(pending)) return;
      void check(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('focus', onVisible);
    const id = window.setInterval(() => void check(false), 5 * 60_000);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(id);
    };
  }, []);

  if (!ready) return null;
  return (
    <div className="w-update" role="status">
      <I.sparkle size={17} />
      <span>نسخة جديدة من الموقع جاهزة</span>
      <button
        type="button"
        className="press"
        onClick={() => {
          haptic('tap');
          try {
            sessionStorage.removeItem(TRIED);
          } catch {
            /* تخزين غير متاح */
          }
          reloadTo(ready);
        }}
      >
        تحديث الآن
      </button>
    </div>
  );
}
