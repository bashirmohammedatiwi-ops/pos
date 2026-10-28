import { APP_VERSION, PUSH_ENABLED, apiUrl, isNative, platform } from './config';

/* ─────────────────────────────────────────────────────────────────────────────
 * حساب الموظف في تطبيق الفريق (كل الأنواع). البائع يحصل أيضاً على رمز البائع
 * فتعمل العمولة والأهداف و«براندي» كما هي.
 * ───────────────────────────────────────────────────────────────────────────── */

const TEAM_TOKEN = 'fot_team_token';
const TEAM_ME = 'fot_team_me';
const LAST_CODE = 'fot_team_last_code';

export interface TeamStaff {
  id: number;
  code: string;
  name: string;
  kind: 'seller' | 'cashier' | 'supervisor' | 'other' | string;
  jobTitle?: string | null;
  photoUrl?: string | null;
  sectionId?: number | null;
  sectionName?: string | null;
  salesmanId?: number | null;
}

export function getTeamToken() {
  return localStorage.getItem(TEAM_TOKEN);
}
export function setTeamToken(t: string | null) {
  if (t) localStorage.setItem(TEAM_TOKEN, t);
  else localStorage.removeItem(TEAM_TOKEN);
}
export function getTeamMe(): TeamStaff | null {
  try {
    const raw = localStorage.getItem(TEAM_ME);
    return raw ? (JSON.parse(raw) as TeamStaff) : null;
  } catch {
    return null;
  }
}
export function setTeamMe(s: TeamStaff | null) {
  if (s) localStorage.setItem(TEAM_ME, JSON.stringify(s));
  else localStorage.removeItem(TEAM_ME);
}
export function getLastCode() {
  return localStorage.getItem(LAST_CODE) ?? '';
}
export function setLastCode(c: string) {
  if (c) localStorage.setItem(LAST_CODE, c);
}

export const KIND_LABEL: Record<string, string> = { seller: 'بائع', cashier: 'كاشير', supervisor: 'مشرف', other: 'موظف' };

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error || 'تعذر الاتصال') as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

/** هوية الجهاز داخل التطبيق فقط (الويب بلا ربط). */
export async function deviceInfo(): Promise<{ deviceId?: string; deviceLabel?: string }> {
  if (!isNative()) return {};
  try {
    const { Device } = await import('@capacitor/device');
    const [id, info] = await Promise.all([Device.getId(), Device.getInfo()]);
    return { deviceId: id.identifier, deviceLabel: [info.manufacturer, info.model].filter(Boolean).join(' ') };
  } catch {
    return {};
  }
}

export const teamApi = {
  lookup: async (code: string) => {
    const s = await fetch(apiUrl(`/auth/team-lookup?code=${encodeURIComponent(code)}`)).then(r => json<{ name?: string; kind?: string }>(r));
    // خادم أقدم يعيد صفحة HTML بدل الرد — نعامله كـ«غير موجود» ليرجع الدخول القديم
    if (!s?.name) throw Object.assign(new Error('لا موظف بهذا الكود'), { status: 404 });
    return { name: s.name, kind: s.kind ?? 'other' };
  },
  login: async (code: string, pin: string) => {
    const dev = await deviceInfo();
    const res = await fetch(apiUrl('/auth/team-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, pin, ...dev, platform: platform(), appVersion: APP_VERSION }),
    });
    return json<{ token: string; staff: TeamStaff; sellerToken?: string | null; access?: unknown }>(res);
  },
};

const PUSH_PATH = { staff: '/api/team/push-token', manager: '/api/team/m/push-token' } as const;
let pushValue: string | null = null;

/**
 * تسجيل الهاتف لإشعارات Firebase (يُتجاهل بهدوء إن لم تُفعَّل في البناء).
 * onOpen: الضغط على الإشعار يفتح الصفحة المرتبطة به (رابط داخل التطبيق).
 */
export async function registerPush(role: 'staff' | 'manager', bearer: string | null, onOpen?: (link: string) => void) {
  if (!PUSH_ENABLED || !bearer) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;
    await PushNotifications.removeAllListeners();
    if (platform() === 'android') {
      await PushNotifications.createChannel({ id: 'team', name: 'تنبيهات الفريق', description: 'الطلبات والإعلانات والمحادثات والحضور', importance: 5, visibility: 1, vibration: true }).catch(() => undefined);
    }
    await PushNotifications.addListener('registration', async t => {
      pushValue = t.value;
      const dev = await deviceInfo();
      await fetch(apiUrl(PUSH_PATH[role]), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ token: t.value, platform: platform(), deviceId: dev.deviceId }),
      }).catch(() => undefined);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', a => {
      const link = String((a.notification.data as { link?: string } | undefined)?.link || '');
      if (link && onOpen) onOpen(link);
    });
    await PushNotifications.register();
  } catch {
    /* الإشعارات اختيارية */
  }
}

/** عند الخروج: يتوقف وصول إشعارات هذا الحساب إلى الهاتف */
export async function unregisterPush(role: 'staff' | 'manager', bearer: string | null) {
  if (!PUSH_ENABLED || !bearer) return;
  try {
    const dev = await deviceInfo();
    await fetch(apiUrl(PUSH_PATH[role]), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ token: pushValue, deviceId: dev.deviceId }),
    });
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllListeners();
  } catch {
    /* بلا شبكة: يُنظَّف الرمز لاحقاً عند فشل الإرسال */
  }
}

/** تجديد جلسة الفريق (ومعها رمز البائع إن كان بائعاً). يعيد false إذا انتهى الحساب. */
export async function refreshTeam(): Promise<{ ok: boolean; staff?: TeamStaff; sellerToken?: string | null }> {
  const token = getTeamToken();
  if (!token) return { ok: false };
  try {
    const res = await fetch(apiUrl('/auth/team-refresh'), { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) {
      clearTeam();
      return { ok: false };
    }
    const data = await json<{ token: string; staff: TeamStaff; sellerToken?: string | null }>(res);
    if (!data.token) return { ok: true };
    setTeamToken(data.token);
    setTeamMe(data.staff);
    return { ok: true, staff: data.staff, sellerToken: data.sellerToken };
  } catch {
    // بلا شبكة أو خادم أقدم: نبقي الجلسة كما هي
    return { ok: true };
  }
}

export function clearTeam() {
  setTeamToken(null);
  setTeamMe(null);
}
