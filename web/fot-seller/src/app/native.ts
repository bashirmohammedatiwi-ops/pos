import { isNative } from '../config';

/* ─────────────────────────────────────────────────────────────────────────────
 * طبقة الهاتف: الاهتزاز، شريط الحالة، زر الرجوع، المظهر، مشاركة الملفات.
 * كل شيء يعمل في المتصفح أيضاً (بدائل هادئة) لتجربة التطبيق أثناء التطوير.
 * ───────────────────────────────────────────────────────────────────────────── */

const THEME_KEY = 'fot_team_theme';
const HAPTIC_KEY = 'fot_team_haptics';

export type ThemePref = 'system' | 'light' | 'dark';

/* ── الاهتزاز ── */
export function hapticsOn() {
  try {
    return localStorage.getItem(HAPTIC_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setHapticsOn(on: boolean) {
  try {
    localStorage.setItem(HAPTIC_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

type HapticKind = 'tap' | 'select' | 'success' | 'warning' | 'error' | 'heavy';

export function haptic(kind: HapticKind = 'tap') {
  if (!hapticsOn()) return;
  if (!isNative()) {
    try {
      navigator.vibrate?.(kind === 'error' ? [18, 40, 18] : kind === 'success' ? [10, 30, 10] : 8);
    } catch {
      /* ignore */
    }
    return;
  }
  void import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      if (kind === 'select') return Haptics.selectionChanged();
      if (kind === 'success') return Haptics.notification({ type: NotificationType.Success });
      if (kind === 'warning') return Haptics.notification({ type: NotificationType.Warning });
      if (kind === 'error') return Haptics.notification({ type: NotificationType.Error });
      return Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Medium : ImpactStyle.Light });
    })
    .catch(() => undefined);
}

/* ── المظهر ── */
export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolved(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** عدد الشاشات البنفسجية المفتوحة (الدخول، القفل، عارض الصور) — لها الأولوية على لون المظهر. */
let heroDepth = 0;

export function applyTheme(pref: ThemePref = getThemePref()) {
  const mode = resolved(pref);
  document.documentElement.dataset.theme = mode;
  const bg = mode === 'dark' ? '#0e0c13' : '#f5f3ef';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', heroDepth > 0 ? '#241245' : bg);
  if (heroDepth > 0) void paintStatusBar('dark', '#241245');
  else void paintStatusBar(mode, bg);
  return mode;
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* ignore */
  }
  applyTheme(pref);
}

/** الشاشات بخلفية بنفسجية (الدخول، القفل) تطلب شريط حالة داكن مؤقتاً. */
export function statusOnHero(on: boolean) {
  heroDepth = Math.max(0, heroDepth + (on ? 1 : -1));
  applyTheme();
}

// الطلبات تُنفَّذ بالترتيب: آخر لون مطلوب هو ما يبقى (لا سباق بين استدعاءين)
let paintChain: Promise<void> = Promise.resolve();
function paintStatusBar(mode: 'light' | 'dark', color: string) {
  if (!isNative()) return Promise.resolve();
  paintChain = paintChain.then(async () => {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: mode === 'dark' ? Style.Dark : Style.Light });
      await StatusBar.setBackgroundColor({ color });
    } catch {
      /* ignore */
    }
  });
  return paintChain;
}

export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const on = () => {
    if (getThemePref() === 'system') applyTheme('system');
  };
  mq?.addEventListener?.('change', on);
  return () => mq?.removeEventListener?.('change', on);
}

/* ── زر الرجوع (أندرويد): الأوراق المفتوحة أولاً ثم التنقل ── */
const backStack: (() => void)[] = [];

export function pushBack(fn: () => void) {
  backStack.push(fn);
  return () => {
    const i = backStack.lastIndexOf(fn);
    if (i >= 0) backStack.splice(i, 1);
  };
}

export function handleBack(fallback: () => boolean) {
  const top = backStack[backStack.length - 1];
  if (top) {
    top();
    return;
  }
  if (fallback()) return;
  if (isNative()) void import('@capacitor/app').then(({ App }) => App.minimizeApp()).catch(() => undefined);
}

export async function onNativeBack(fn: () => void) {
  if (!isNative()) return () => undefined;
  const { App } = await import('@capacitor/app');
  const sub = await App.addListener('backButton', () => fn());
  return () => void sub.remove();
}

/** عند عودة التطبيق للواجهة (من الخلفية). */
export async function onResume(fn: () => void) {
  if (!isNative()) {
    const h = () => document.visibilityState === 'visible' && fn();
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }
  const { App } = await import('@capacitor/app');
  const sub = await App.addListener('resume', fn);
  return () => void sub.remove();
}

export async function hideSplash() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* ignore */
  }
}

/* ── شبكة الواي فاي (للحضور من شبكة المحل) ── */
export type WifiState = { bssid?: string | null; ssid?: string | null; permission?: 'granted' | 'denied'; locationEnabled?: boolean; wifiEnabled?: boolean };
export type WifiScanResult = {
  permission?: 'granted' | 'denied';
  locationEnabled?: boolean;
  wifiEnabled?: boolean;
  fresh?: boolean;
  networks: { ssid: string; bssid: string; level: number; frequency: number }[];
};
type WifiPlugin = {
  getInfo(): Promise<WifiState>;
  scan(): Promise<WifiScanResult>;
  checkPermissions(): Promise<{ location: string }>;
  requestPermissions(o: { permissions: string[] }): Promise<{ location: string }>;
  openLocationSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  openWifiSettings(): Promise<void>;
  openUrl(o: { url: string }): Promise<void>;
};
/** بعض هواتف شاومي لا تُظهر نافذة طلب الإذن فيبقى الطلب معلّقاً — لا ننتظر للأبد. */
const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>(r => window.setTimeout(() => r(null), ms))]);
async function locationGranted(plugin: WifiPlugin) {
  const perm = await within(plugin.checkPermissions(), 3000).catch(() => null);
  return perm?.location === 'granted';
}
let wifiPlugin: WifiPlugin | null = null;
/**
 * يُعاد الكائن داخل غلاف: كائن إضافة Capacitor لا يصح أن يكون قيمة Promise — انتظاره يستدعي
 * .then() كدالة أصلية غير موجودة فلا يكتمل أبداً (كان يعلّق «جارٍ فحص الشبكة…»).
 */
async function wifi(): Promise<{ plugin: WifiPlugin }> {
  if (!wifiPlugin) {
    const { registerPlugin } = await import('@capacitor/core');
    wifiPlugin = registerPlugin<WifiPlugin>('WifiInfo');
  }
  return { plugin: wifiPlugin };
}

/** يقرأ شبكة الواي فاي الحالية. في المتصفح (تطوير): fot_dev_bssid من التخزين المحلي. */
export async function readWifi(): Promise<WifiState> {
  if (!isNative()) {
    try {
      const dev = localStorage.getItem('fot_dev_bssid');
      return dev ? { bssid: dev, ssid: 'DEV', permission: 'granted', locationEnabled: true, wifiEnabled: true } : {};
    } catch {
      return {};
    }
  }
  try {
    const { plugin } = await wifi();
    // دون إذن الموقع لا نطلبه هنا (النافذة قد لا تظهر) — الواجهة تعرض زر «السماح»
    if (!(await locationGranted(plugin))) return { permission: 'denied' };
    return (await within(plugin.getInfo(), 8000)) ?? {};
  } catch {
    return {};
  }
}
/**
 * يطلب إذن الموقع بضغطة من المستخدم؛ إن لم تظهر النافذة أو رُفض نهائياً يفتح صفحة أذونات التطبيق.
 * يعيد true إن صار الإذن ممنوحاً.
 */
export async function allowLocation(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { plugin } = await wifi();
    if (await locationGranted(plugin)) return true;
    const res = await within(plugin.requestPermissions({ permissions: ['location'] }), 6000).catch(() => null);
    if (res?.location === 'granted') return true;
    await plugin.openAppSettings().catch(() => plugin.openLocationSettings());
    return false;
  } catch {
    return false;
  }
}
/** شبكات الواي فاي المحيطة بالهاتف (للمدير). في المتصفح (تطوير): نقاط تجريبية حول fot_dev_bssid. */
export async function scanWifi(): Promise<WifiScanResult> {
  if (!isNative()) {
    try {
      const dev = localStorage.getItem('fot_dev_bssid');
      if (!dev) return { networks: [] };
      const base = dev.slice(0, -2);
      return {
        permission: 'granted',
        locationEnabled: true,
        wifiEnabled: true,
        fresh: true,
        networks: [
          { ssid: 'DEV', bssid: dev, level: -45, frequency: 5180 },
          { ssid: 'DEV', bssid: `${base}99`, level: -62, frequency: 2437 },
          { ssid: 'Neighbour', bssid: '10:7b:44:21:9c:d0', level: -80, frequency: 2412 },
        ],
      };
    } catch {
      return { networks: [] };
    }
  }
  try {
    const { plugin } = await wifi();
    if (!(await locationGranted(plugin))) return { permission: 'denied', networks: [] };
    return (await within(plugin.scan(), 15000)) ?? { networks: [] };
  } catch {
    return { networks: [] };
  }
}
export async function openLocationSettings() {
  if (isNative()) await (await wifi()).plugin.openLocationSettings().catch(() => undefined);
}
/** فتح رابط خارج التطبيق (مثل تنزيل تحديث التطبيق) */
export async function openExternal(url: string) {
  if (isNative()) await (await wifi()).plugin.openUrl({ url }).catch(() => window.open(url, '_system'));
  else window.open(url, '_blank', 'noopener');
}
export async function openWifiSettings() {
  if (isNative()) await (await wifi()).plugin.openWifiSettings().catch(() => undefined);
}

/* ── منبّهات محلية (تعمل والتطبيق مغلق ودون إنترنت) ── */
const ALARM = { warn: 9001, end: 9002, over: 9003, shiftIn: 9010, shiftOut: 9011 };
let channelReady = false;
// يُعاد داخل غلاف — انتظار كائن الإضافة مباشرة لا يكتمل (انظر wifi())
async function notifications() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if (!channelReady) {
    channelReady = true;
    await LocalNotifications.createChannel({ id: 'breaks', name: 'منبّه الاستراحة والدوام', description: 'تنبيه قبل نهاية الاستراحة وعند انتهائها', importance: 5, visibility: 1, vibration: true }).catch(() => undefined);
    const perm = await LocalNotifications.checkPermissions().catch(() => null);
    if (perm && perm.display !== 'granted') await LocalNotifications.requestPermissions().catch(() => undefined);
  }
  return { LN: LocalNotifications };
}

/** منبّه الاستراحة: قبل النهاية، عند النهاية، وبعد 5 دقائق تجاوز. */
export async function scheduleBreakAlarms(endsAtIso: string, warnMinutes: number) {
  if (!isNative()) return;
  try {
    const { LN } = await notifications();
    await LN.cancel({ notifications: [{ id: ALARM.warn }, { id: ALARM.end }, { id: ALARM.over }] });
    const end = Date.parse(endsAtIso);
    const list = [];
    const warnAt = end - warnMinutes * 60_000;
    if (warnMinutes > 0 && warnAt > Date.now() + 5000)
      list.push({ id: ALARM.warn, channelId: 'breaks', title: `تنتهي استراحتك بعد ${warnMinutes} دقيقة`, body: 'استعد للعودة لمكان عملك', schedule: { at: new Date(warnAt), allowWhileIdle: true } });
    if (end > Date.now() + 2000) list.push({ id: ALARM.end, channelId: 'breaks', title: 'انتهت استراحتك ⏰', body: 'سجّل عودتك من الاستراحة الآن', schedule: { at: new Date(end), allowWhileIdle: true } });
    list.push({ id: ALARM.over, channelId: 'breaks', title: 'تجاوزت وقت الاستراحة', body: 'يصل تنبيه لمديرك — سجّل عودتك فوراً', schedule: { at: new Date(Math.max(end, Date.now()) + 5 * 60_000), allowWhileIdle: true } });
    await LN.schedule({ notifications: list });
  } catch {
    /* المنبّه اختياري */
  }
}
export async function cancelBreakAlarms() {
  if (!isNative()) return;
  try {
    const { LN } = await notifications();
    await LN.cancel({ notifications: [{ id: ALARM.warn }, { id: ALARM.end }, { id: ALARM.over }] });
  } catch {
    /* ignore */
  }
}
/** تذكير ببداية الدوام (إن لم يُسجَّل الحضور) وبنهايته (إن لم يُسجَّل الانصراف). */
export async function scheduleShiftReminders(opt: { startAt?: number | null; endAt?: number | null }) {
  if (!isNative()) return;
  try {
    const { LN } = await notifications();
    await LN.cancel({ notifications: [{ id: ALARM.shiftIn }, { id: ALARM.shiftOut }] });
    const list = [];
    if (opt.startAt && opt.startAt > Date.now() + 60_000)
      list.push({ id: ALARM.shiftIn, channelId: 'breaks', title: 'يبدأ دوامك بعد قليل', body: 'سجّل حضورك من التطبيق عند وصولك للمحل', schedule: { at: new Date(opt.startAt), allowWhileIdle: true } });
    if (opt.endAt && opt.endAt > Date.now() + 60_000)
      list.push({ id: ALARM.shiftOut, channelId: 'breaks', title: 'انتهى دوامك', body: 'لا تنسَ تسجيل انصرافك قبل الخروج', schedule: { at: new Date(opt.endAt), allowWhileIdle: true } });
    if (list.length) await LN.schedule({ notifications: list });
  } catch {
    /* ignore */
  }
}

/* ── مشاركة الملفات (Excel وغيره) ── */
function toBase64(bytes: Uint8Array) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export async function shareFile(fileName: string, bytes: Uint8Array, mime: string) {
  if (!isNative()) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const res = await Filesystem.writeFile({ path: fileName, data: toBase64(bytes), directory: Directory.Cache, recursive: true });
  await Share.share({ title: fileName, url: res.uri, dialogTitle: 'مشاركة الكشف' });
}
