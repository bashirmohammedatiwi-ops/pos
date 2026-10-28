/* ─────────────────────────────────────────────────────────────────────────────
 * إعدادات التشغيل — نفس الكود يعمل كموقع ويب وكتطبيق هاتف (Capacitor).
 *  · الويب: الطلبات نسبية على نفس الموقع (nginx يوصلها للخادم).
 *  · التطبيق: الطلبات تذهب لعنوان خادم الفريق (VITE_API_BASE وقت البناء).
 * ───────────────────────────────────────────────────────────────────────────── */

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

export function isNative(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export function platform(): 'android' | 'ios' | 'web' {
  try {
    const p = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.();
    return p === 'android' || p === 'ios' ? p : 'web';
  } catch {
    return 'web';
  }
}

/** عنوان خادم الفريق داخل التطبيق؛ فارغ في الويب (طلبات نسبية). */
export const API_BASE: string = (isNative() ? (import.meta.env.VITE_API_BASE as string | undefined) || 'http://187.124.23.65:4700' : '').replace(/\/$/, '');

/** تطبيق المدراء: داخل الهاتف ملف مدمج، وعلى الويب رابطه المنشور. */
export const MANAGER_URL: string = isNative()
  ? './manager/index.html'
  : (import.meta.env.VITE_MANAGER_URL as string | undefined) || `${location.protocol}//${location.hostname}:4703/`;

export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.0.0';

/** الإشعارات عبر Firebase تُفعَّل فقط في بناء فيه google-services.json */
export const PUSH_ENABLED: boolean = isNative() && import.meta.env.VITE_PUSH === '1';

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}
