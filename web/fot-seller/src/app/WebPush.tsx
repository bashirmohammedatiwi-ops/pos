import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiUrl, isNative } from '../config';
import { getTeamToken } from '../team';
import { I, Sheet, toast } from './kit';
import { haptic } from './native';
import { getManagerToken, pushTest, supervisorMode } from './work';

/* ─────────────────────────────────────────────────────────────────────────────
 * إشعارات الموقع (Web Push): الموقع يطلب تفعيلها دائماً ما دامت غير مفعّلة.
 *   · نافذة عند كل فتح للموقع (أو عودة إليه بعد نصف ساعة) + شريط ثابت أعلى الصفحة حتى تُفعَّل.
 *   · مرفوضة سابقاً: الشريط يشرح كيف تُفعَّل من الإعدادات (لا يستطيع الموقع طلبها مجدداً).
 *   · الآيفون: الإشعارات للموقع المضاف للشاشة الرئيسية فقط — يُطلب ذلك أولاً.
 *   · رابط غير آمن (http): الإشعارات تحتاج الرابط الآمن — زر يفتحه.
 * مفعّلة: يُجدَّد الاشتراك على الخادم عند كل فتح (يتبع الحساب الحالي على هذا المتصفح).
 * ───────────────────────────────────────────────────────────────────────────── */

const SECURE_URL = 'https://team.deemaalhayat.com/staff/';
type Role = 'staff' | 'manager';
type State = 'unsupported' | 'insecure' | 'ios-install' | 'old-ios' | 'default' | 'denied' | 'granted';

const ios = () => /iPhone|iPad/.test(navigator.userAgent);
const standalone = () => (navigator as unknown as { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;

function pushState(): State {
  if (isNative()) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (ios() && !standalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return ios() ? 'old-ios' : 'unsupported';
  return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'default';
}

function roleNow(path: string): { role: Role; token: string } | null {
  try {
    const mgr = localStorage.getItem('fot_manager_token');
    if (path.startsWith('/m') && mgr && !supervisorMode()) return { role: 'manager', token: mgr };
    const staff = getTeamToken();
    if (staff) return { role: 'staff', token: staff };
    if (mgr) return { role: 'manager', token: getManagerToken() || mgr };
  } catch {
    /* تخزين غير متاح */
  }
  return null;
}

const endpointOf = (role: Role) => apiUrl(role === 'manager' ? '/api/team/m/web-push' : '/api/team/web-push');
async function api<T>(role: Role, token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(endpointOf(role), {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'تعذر الاتصال');
  return (await res.json()) as T;
}

const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));

async function registration() {
  return navigator.serviceWorker.register('team-sw.js', { scope: './' });
}

/** يشترك (أو يجدّد الاشتراك) ويرسله للخادم باسم الحساب الحالي */
async function ensureSubscribed(role: Role, token: string) {
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { key } = await api<{ key: string; subscribed: boolean }>(role, token, 'GET');
  let sub = await reg.pushManager.getSubscription();
  // مفتاح الخادم تغيّر: اشتراك جديد
  const current = sub?.options?.applicationServerKey;
  if (sub && current) {
    const a = new Uint8Array(current);
    const b = keyBytes(key);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('fot_web_device') || '';
  } catch {
    /* تخزين غير متاح */
  }
  await api(role, token, 'POST', { subscription: sub.toJSON(), deviceId, userAgent: navigator.userAgent.slice(0, 200) });
}

/** عطل في خطوة من خطوات التفعيل: يُسجَّل في سجل الخادم لنعرف ما حدث على هاتف الموظف */
function report(stage: string, detail: unknown) {
  try {
    const body = JSON.stringify({
      stage,
      detail: detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail ?? ''),
      state: pushState(),
      permission: 'Notification' in window ? Notification.permission : 'none',
      standalone: standalone(),
      ua: navigator.userAgent.slice(0, 180),
      at: location.href.slice(0, 120),
    });
    void fetch(apiUrl('/api/team/web-push-diag'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* لا شيء */
  }
}

export type EnableResult = { ok: boolean; message: string };
/** تفعيل إشعارات هذا المتصفح (من ضغطة المستخدم نفسها) — نتيجة واضحة في كل حالة */
export async function enableWebPush(role: Role, token: string): Promise<EnableResult> {
  const s = pushState();
  if (s === 'insecure') {
    location.href = SECURE_URL;
    return { ok: false, message: 'يُفتح الرابط الآمن…' };
  }
  if (s === 'ios-install') return { ok: false, message: 'أضف الموقع للشاشة الرئيسية أولاً، ثم افتحه من الأيقونة وفعّل الإشعارات' };
  if (s === 'old-ios') return { ok: false, message: 'حدّث الآيفون إلى iOS 16.4 أو أحدث لتصلك إشعارات المواقع' };
  if (s === 'unsupported') return { ok: false, message: 'هذا المتصفح لا يدعم إشعارات المواقع — استخدم Chrome أو Safari' };
  if (s === 'denied') return { ok: false, message: 'الإشعارات مرفوضة في إعدادات المتصفح — فعّلها من الإعدادات ثم أعد فتح الموقع' };
  let perm: NotificationPermission = Notification.permission;
  if (perm !== 'granted') {
    try {
      perm = await Notification.requestPermission();
    } catch (e) {
      report('permission', e);
      return { ok: false, message: 'تعذر طلب الإذن من المتصفح' };
    }
  }
  if (perm === 'denied') {
    report('permission', 'denied by user');
    return { ok: false, message: 'رُفض الإذن — يمكن تفعيله لاحقاً من إعدادات المتصفح' };
  }
  if (perm !== 'granted') {
    report('permission', 'dismissed or hidden');
    return { ok: false, message: 'لم يظهر طلب الإذن أو أُغلق — اضغط رمز القفل أو الجرس بجانب عنوان الموقع واختر «السماح» للإشعارات، ثم اضغط «تفعيل» مجدداً' };
  }
  try {
    await ensureSubscribed(role, token);
  } catch (e) {
    report('subscribe', e);
    return { ok: false, message: `تعذر تسجيل المتصفح للإشعارات: ${e instanceof Error ? e.message : 'خطأ غير معروف'}` };
  }
  return { ok: true, message: 'تم تفعيل الإشعارات ✅' };
}

/** عند الخروج: هذا المتصفح لا يستقبل إشعارات الحساب بعد الآن */
export async function webPushLogout(role: Role, token: string | null) {
  if (isNative() || !token || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await api(role, token, 'DELETE', { endpoint: sub.endpoint });
  } catch {
    /* بلا شبكة: الخادم يحذف الاشتراك عند أول فشل */
  }
}

const ASKED = 'fot_push_asked_at';

export function WebPush() {
  const loc = useLocation();
  const nav = useNavigate();
  const [state, setState] = useState<State>(() => pushState());
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  // الشريط يُخفى لهذه الزيارة فقط بزر ×، ويعود عند فتح الموقع من جديد (حتى تُفعَّل الإشعارات)
  const [barHidden, setBarHidden] = useState(() => {
    try {
      return sessionStorage.getItem('fot_wp_bar') === '0';
    } catch {
      return false;
    }
  });
  const who = loc.pathname === '/login' ? null : roleNow(loc.pathname);

  // نقر إشعار والموقع مفتوح: عامل الخدمة يطلب فتح الصفحة
  useEffect(() => {
    if (isNative() || !('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const url = (e.data as { type?: string; url?: string })?.url;
      if ((e.data as { type?: string })?.type === 'fot-open' && url) {
        const hash = url.split('#')[1];
        if (hash) nav(hash);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [nav]);

  // عند الفتح والعودة: الحالة، والنافذة إن لم تُفعَّل (مرة كل نصف ساعة على الأكثر)
  useEffect(() => {
    if (!who) return;
    const check = () => {
      const s = pushState();
      setState(s);
      if (s === 'granted') {
        void ensureSubscribed(who.role, who.token).catch(() => undefined);
        setSheet(false);
        return;
      }
      if (s === 'unsupported') return;
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(ASKED) || 0);
      } catch {
        /* تخزين غير متاح */
      }
      if (Date.now() - last > 30 * 60_000) {
        try {
          sessionStorage.setItem(ASKED, String(Date.now()));
        } catch {
          /* تخزين غير متاح */
        }
        setSheet(true);
      }
    };
    check();
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [who?.role, who?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!who || state === 'unsupported' || state === 'granted') return null;

  async function enable() {
    if (!who || busy) return;
    setBusy(true);
    try {
      // يجب أن يكون الطلب من ضغطة المستخدم نفسها
      const r = await enableWebPush(who.role, who.token);
      setState(pushState());
      haptic(r.ok ? 'success' : 'error');
      toast(r.message);
      if (r.ok) setSheet(false);
    } finally {
      setBusy(false);
    }
  }

  const text: Record<Exclude<State, 'unsupported' | 'granted'>, { title: string; body: string; action?: string }> = {
    default: { title: 'فعّل الإشعارات', body: 'تصلك تبليغات الإدارة، الرسائل، الموافقات، وتنبيهات الحضور على هاتفك حتى والموقع مغلق.', action: 'تفعيل الإشعارات' },
    denied: {
      title: 'الإشعارات مرفوضة',
      body: ios()
        ? 'فعّلها من: الإعدادات ← الإشعارات ← ديما الفريق ← السماح بالإشعارات، ثم ارجع للموقع.'
        : 'فعّلها من: رمز القفل بجانب عنوان الموقع ← الأذونات ← الإشعارات ← سماح، ثم أعد فتح الموقع.',
    },
    'ios-install': { title: 'لتصلك الإشعارات على الآيفون', body: 'أضف الموقع للشاشة الرئيسية: زر المشاركة في الأسفل ← «إضافة إلى الشاشة الرئيسية»، ثم افتحه من الأيقونة وفعّل الإشعارات.' },
    'old-ios': { title: 'حدّث نظام الآيفون', body: 'إشعارات المواقع تحتاج iOS 16.4 أو أحدث: الإعدادات ← عام ← تحديث البرنامج.' },
    insecure: { title: 'الإشعارات من الرابط الآمن', body: 'افتح الفريق من team.deemaalhayat.com لتعمل الإشعارات والتسجيل الصوتي.', action: 'فتح الرابط الآمن' },
  };
  const t = text[state];

  return (
    <>
      {!barHidden && (
        <div className="wp-bar" role="status">
          <button type="button" className="wp-bar-main press" onClick={() => (haptic('tap'), setSheet(true))}>
            <I.bell size={16} />
            <span>{state === 'denied' ? 'الإشعارات مرفوضة — كيف أفعّلها؟' : state === 'default' ? 'فعّل الإشعارات لتصلك التبليغات' : t.title}</span>
          </button>
          <button
            type="button"
            className="wp-bar-x press"
            aria-label="إخفاء حتى الفتح القادم"
            title="إخفاء حتى الفتح القادم"
            onClick={() => {
              haptic('tap');
              setBarHidden(true);
              try {
                sessionStorage.setItem('fot_wp_bar', '0');
              } catch {
                /* تخزين غير متاح */
              }
            }}
          >
            <I.close size={15} />
          </button>
        </div>
      )}
      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <div className="t-confirm">
          <span className={`t-tile lg ${state === 'denied' ? 'bad' : 'accent'}`}>
            <I.bell size={24} />
          </span>
          <h3>{t.title}</h3>
          <p>{t.body}</p>
          <div className="t-actions">
            <button type="button" className="t-btn plain press" onClick={() => setSheet(false)}>
              لاحقاً
            </button>
            {t.action && (
              <button type="button" className="t-btn press" disabled={busy} onClick={() => void enable()}>
                {busy ? <span className="spinner" /> : t.action}
              </button>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** «حسابي» في الموقع: حالة إشعارات هذا المتصفح، زر التفعيل، وإشعار تجريبي حقيقي */
export function WebPushCard({ role }: { role: Role }) {
  const [state, setState] = useState<State>(() => pushState());
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const token = () => (role === 'manager' ? getManagerToken() : getTeamToken());

  useEffect(() => {
    const t = token();
    if (!t || isNative()) return;
    void api<{ subscribed: boolean }>(role, t, 'GET')
      .then(r => setSubscribed(r.subscribed))
      .catch(() => setSubscribed(null));
  }, [role, state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isNative()) return null;
  const on = state === 'granted' && subscribed === true;

  async function run() {
    const t = token();
    if (!t || busy) return;
    haptic('tap');
    setBusy(true);
    try {
      if (!on) {
        const r = await enableWebPush(role, t);
        setState(pushState());
        toast(r.message);
        if (r.ok) setSubscribed(true);
        return;
      }
      const r = await pushTest(role);
      const web = (r as { web?: number }).web ?? 0;
      toast(web > 0 ? 'أُرسل إشعار تجريبي — يصلك خلال ثوانٍ' : 'لم يُسجَّل هذا المتصفح بعد — اضغط «تفعيل» مرة أخرى');
      if (!web) setSubscribed(false);
    } catch (e) {
      report('test', e);
      toast(e instanceof Error ? e.message : 'تعذرت التجربة');
    } finally {
      setBusy(false);
    }
  }

  const hint: Record<State, string> = {
    granted: subscribed === false ? 'الإذن ممنوح لكن المتصفح غير مسجّل — اضغط «تفعيل»' : 'تصلك الإشعارات على هذا المتصفح حتى والموقع مغلق',
    default: 'غير مفعّلة — لن تصلك الطلبات والرسائل والتنبيهات',
    denied: ios() ? 'مرفوضة — فعّلها من: الإعدادات ← الإشعارات ← ديما الفريق' : 'مرفوضة — فعّلها من رمز القفل بجانب عنوان الموقع ← الإشعارات ← سماح',
    'ios-install': 'على الآيفون: أضف الموقع للشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحه من الأيقونة',
    'old-ios': 'تحتاج iOS 16.4 أو أحدث',
    insecure: 'تعمل من الرابط الآمن team.deemaalhayat.com فقط',
    unsupported: 'هذا المتصفح لا يدعم الإشعارات',
  };
  const canAct = on || state === 'default' || state === 'insecure' || (state === 'granted' && subscribed !== true);
  return (
    <section className="t-section">
      <div className="t-section-head">
        <h2>الإشعارات</h2>
      </div>
      <div className="t-card pad" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`t-tile ${on ? 'ok' : state === 'denied' ? 'bad' : 'accent'}`}>
            <I.bell size={19} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 620 }}>{on ? 'مفعّلة على هذا المتصفح' : 'الإشعارات غير مفعّلة'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>{hint[state]}</div>
          </div>
        </div>
        {canAct && (
          <button type="button" className="t-btn soft sm press" disabled={busy} onClick={() => void run()}>
            {busy ? <span className="spinner" style={{ borderTopColor: 'var(--brand)' }} /> : on ? 'إرسال إشعار تجريبي' : state === 'insecure' ? 'فتح الرابط الآمن' : 'تفعيل الإشعارات'}
          </button>
        )}
      </div>
    </section>
  );
}
