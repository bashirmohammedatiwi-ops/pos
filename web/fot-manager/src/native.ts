/* ─────────────────────────────────────────────────────────────────────────────
 * تشغيل المدير داخل تطبيق الفريق (Capacitor): الملفات محلية والطلبات لخادم الفريق.
 * على الويب لا يتغير شيء — الطلبات نسبية كما كانت.
 * ───────────────────────────────────────────────────────────────────────────── */

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNative(): boolean {
  try {
    return !!(window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

const API_BASE: string = (isNative() ? (import.meta.env.VITE_API_BASE as string | undefined) || 'http://187.124.23.65:4700' : '').replace(/\/$/, '');

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

/** العودة لنافذة دخول الموظفين داخل التطبيق. */
export const STAFF_LOGIN_URL = '../index.html#/login?as=manager';
