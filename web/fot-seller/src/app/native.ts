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

export function applyTheme(pref: ThemePref = getThemePref()) {
  const mode = resolved(pref);
  document.documentElement.dataset.theme = mode;
  const bg = mode === 'dark' ? '#0e0c13' : '#f5f3ef';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  void paintStatusBar(mode, bg);
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
  const mode = resolved(getThemePref());
  if (on) void paintStatusBar('dark', '#241245');
  else void paintStatusBar(mode, mode === 'dark' ? '#0e0c13' : '#f5f3ef');
}

async function paintStatusBar(mode: 'light' | 'dark', color: string) {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: mode === 'dark' ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color });
  } catch {
    /* ignore */
  }
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
