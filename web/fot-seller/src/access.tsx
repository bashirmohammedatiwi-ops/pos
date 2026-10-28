import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ACCESS_EVENT, api, getSeller, getToken, publishAccess, refreshSession, setSeller, setToken, type SellerAccess } from './api';
import { apiUrl } from './config';

/* ─────────────────────────────────────────────────────────────────────────────
 * بوابة أوقات الفتح — صارمة وفورية:
 *  · الجدول (البداية/النهاية/الأيام) يُحفظ على الجهاز ويُحسب محلياً كل ثانية بساعة الخادم،
 *    فيُقفل التطبيق لحظة انتهاء الوقت حتى دون إنترنت، ولا يظهر أي محتوى قبل التحقق.
 *  · قناة حية (SSE) من الخادم: أي تعديل من لوحة التحكم يصل خلال ثانية.
 *  · أثناء الإغلاق لا يُركّب التطبيق إطلاقاً (لا بيانات في الصفحة) وتُمسح البيانات المخزنة.
 * ───────────────────────────────────────────────────────────────────────────── */

export const IRAQ_OFFSET_MS = 3 * 3600_000;
const SCHED_KEY = 'fot_seller_sched_';
const BRANDS_EVENT = 'fot-seller-brands-changed';

export type Schedule = { restricted: boolean; fromMin: number | null; toMin: number | null; daysMask: number; skew: number; from?: string; to?: string; days?: string };

export function two(n: number) {
  return String(n).padStart(2, '0');
}

export function to12(min: number | null | undefined) {
  if (min == null) return '';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h < 12 ? 'ص' : 'م';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${two(m)} ${suffix}`;
}

function hmToMin(hm?: string) {
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** نفس منطق الخادم: مفتوح الآن؟ ومتى يفتح/يغلق — بتوقيت العراق. */
export function evalSchedule(s: Schedule, nowMs: number): { open: boolean; opensAt: number | null; closesAt: number | null } {
  if (!s.restricted) return { open: true, opensAt: null, closesAt: null };
  const timed = s.fromMin != null && s.toMin != null && s.fromMin !== s.toMin;
  const fromM = timed ? s.fromMin! : 0;
  const toM = timed ? s.toMin! : 1440;
  const days = s.daysMask > 0 ? s.daysMask & 127 : 127;
  const iraq = new Date(nowMs + IRAQ_OFFSET_MS);
  const mins = iraq.getUTCHours() * 60 + iraq.getUTCMinutes();
  const dayIdx = (iraq.getUTCDay() + 1) % 7;
  const allowed = (d: number) => ((days >> (((d % 7) + 7) % 7)) & 1) === 1;
  const midnight = Date.UTC(iraq.getUTCFullYear(), iraq.getUTCMonth(), iraq.getUTCDate()) - IRAQ_OFFSET_MS;
  const at = (k: number, minute: number) => midnight + k * 86_400_000 + minute * 60_000;
  const overnight = fromM > toM;
  if (!overnight) {
    if (allowed(dayIdx) && mins >= fromM && mins < toM) return { open: true, opensAt: null, closesAt: at(0, toM) };
  } else if (mins >= fromM && allowed(dayIdx)) {
    return { open: true, opensAt: null, closesAt: at(1, toM) };
  } else if (mins < toM && allowed(dayIdx - 1)) {
    return { open: true, opensAt: null, closesAt: at(0, toM) };
  }
  for (let k = 0; k <= 7; k++) {
    if (!allowed(dayIdx + k)) continue;
    if (k === 0 && mins >= fromM) continue;
    return { open: false, opensAt: at(k, fromM), closesAt: null };
  }
  return { open: false, opensAt: null, closesAt: null };
}

function scheduleFrom(a: SellerAccess): Schedule {
  const server = Date.parse(a.serverNow);
  return {
    restricted: !!a.restricted,
    fromMin: a.fromMin ?? hmToMin(a.from),
    toMin: a.toMin ?? (a.to === '24:00' ? 1440 : hmToMin(a.to)),
    daysMask: a.daysMask ?? 127,
    skew: Number.isFinite(server) ? server - Date.now() : 0,
    from: a.from,
    to: a.to,
    days: a.days,
  };
}

function loadSchedule(): Schedule | null {
  const id = getSeller()?.id;
  if (!id) return null;
  try {
    const raw = localStorage.getItem(SCHED_KEY + id);
    return raw ? (JSON.parse(raw) as Schedule) : null;
  } catch {
    return null;
  }
}

function saveSchedule(s: Schedule) {
  const id = getSeller()?.id;
  if (!id) return;
  try {
    localStorage.setItem(SCHED_KEY + id, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** يمسح كل ما يُعرض من بيانات البائع على الجهاز (أثناء الإغلاق أو الخروج). */
export function wipeSellerData() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === 'fot_seller_cache' || k.startsWith('fot_seller_brand_')) localStorage.removeItem(k);
    }
    sessionStorage.removeItem('fot_seller_week');
  } catch {
    /* ignore */
  }
}

export function onBrandsChanged(fn: () => void) {
  window.addEventListener(BRANDS_EVENT, fn);
  return () => window.removeEventListener(BRANDS_EVENT, fn);
}

export type LockProps = { schedule: Schedule; opensAt: number | null; now: number };

/**
 * تطبيق الهاتف يمرّر واجهاته الخاصة (شاشة البدء والقفل) — المنطق نفسه في الويب والتطبيق.
 */
export function AccessGate({
  children,
  renderSplash,
  renderLock,
  onLogout,
}: {
  children: ReactNode;
  renderSplash?: (offline: boolean) => ReactNode;
  renderLock?: (p: LockProps) => ReactNode;
  onLogout?: () => void;
}) {
  const nav = useNavigate();
  const [schedule, setSchedule] = useState<Schedule | null>(() => (getToken() ? loadSchedule() : null));
  const [checked, setChecked] = useState(() => !getToken() || loadSchedule() != null);
  const [offline, setOffline] = useState(false);
  const [, setTick] = useState(0);
  const token = getToken();
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  // أي رد يحمل حالة الوصول (تسجيل الدخول، 423، /access، القناة الحية)
  useEffect(() => {
    const onAccess = (e: Event) => {
      const a = (e as CustomEvent<SellerAccess>).detail;
      if (!a) return;
      const s = scheduleFrom(a);
      setSchedule(s);
      saveSchedule(s);
      setChecked(true);
      setOffline(false);
    };
    window.addEventListener(ACCESS_EVENT, onAccess);
    return () => window.removeEventListener(ACCESS_EVENT, onAccess);
  }, []);

  // القناة الحية + احتياط بالسؤال الدوري
  useEffect(() => {
    if (!token) return;
    let es: EventSource | null = null;
    let live = false;
    let stopped = false;
    const ask = () =>
      api
        .access()
        .then(a => publishAccess(a))
        .catch(e => {
          // 423 يُنشر داخل request؛ غير ذلك = لا اتصال
          if (!(e && typeof e === 'object' && 'access' in e)) {
            setOffline(true);
            setChecked(true);
          }
        });
    void ask();
    const connect = () => {
      if (stopped || typeof EventSource === 'undefined') return;
      es = new EventSource(apiUrl(`/api/seller/events?token=${encodeURIComponent(token)}`));
      es.addEventListener('open', () => {
        live = true;
      });
      es.addEventListener('access', ev => {
        try {
          publishAccess(JSON.parse((ev as MessageEvent).data) as SellerAccess);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('brands', () => window.dispatchEvent(new Event(BRANDS_EVENT)));
      es.addEventListener('logout', () => {
        wipeSellerData();
        setToken(null);
        setSeller(null);
        onLogoutRef.current?.();
        nav('/login', { replace: true });
      });
      es.onerror = () => {
        live = false;
      };
    };
    connect();
    // احتياط: كل 30 ثانية حين لا تكون القناة الحية متصلة، وعند العودة للتطبيق
    const poll = window.setInterval(() => {
      if (!live) void ask();
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      stopped = true;
      es?.close();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [token, nav]);

  const now = Date.now() + (schedule?.skew ?? 0);
  const state = useMemo(() => (schedule ? evalSchedule(schedule, now) : null), [schedule, now]);
  const locked = !!schedule?.restricted && state != null && !state.open;

  // نبضة كل ثانية عند وجود جدول (إغلاق لحظي / عدّاد)
  useEffect(() => {
    if (!schedule?.restricted) return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [schedule?.restricted]);

  // عند الإغلاق: نمسح البيانات المخزنة، وعند الفتح: نجدد الجلسة
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (locked) wipeSellerData();
    if (wasLocked.current && !locked && getToken()) void refreshSession();
    wasLocked.current = locked;
  }, [locked]);

  if (token && !checked) return <>{renderSplash ? renderSplash(false) : <Splash />}</>;
  if (locked && state) {
    const p = { schedule: schedule!, opensAt: state.opensAt, now };
    return <>{renderLock ? renderLock(p) : <LockScreen {...p} />}</>;
  }
  if (token && offline && !schedule) return <>{renderSplash ? renderSplash(true) : <Splash offline />}</>;
  return <>{children}</>;
}

function Splash({ offline }: { offline?: boolean }) {
  return (
    <div className="gate-splash">
      <div className="gate-logo">
        <span>d</span>
      </div>
      {offline ? <p>لا اتصال بالإنترنت — نحاول مجدداً…</p> : <div className="gate-spinner" aria-label="جارٍ التحقق" />}
    </div>
  );
}

function LockScreen({ schedule, opensAt, now }: { schedule: Schedule; opensAt: number | null; now: number }) {
  const left = opensAt != null ? Math.max(0, Math.floor((opensAt - now) / 1000)) : null;
  const d = left != null ? Math.floor(left / 86400) : 0;
  const h = left != null ? Math.floor((left % 86400) / 3600) : 0;
  const m = left != null ? Math.floor((left % 3600) / 60) : 0;
  const s = left != null ? left % 60 : 0;
  const iraq = new Date(now + IRAQ_OFFSET_MS);
  const opens = opensAt != null ? new Date(opensAt + IRAQ_OFFSET_MS) : null;
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const timed = schedule.fromMin != null && schedule.toMin != null;
  return (
    <div className="lock" role="alertdialog" aria-modal="true" aria-labelledby="lock-title">
      <div className="lock-glow" aria-hidden />
      <div className="lock-card">
        <div className="lock-ring" aria-hidden>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
          </svg>
        </div>
        <h1 id="lock-title">التطبيق مغلق الآن</h1>
        <p className="lock-text">
          {timed ? (
            <>
              وقت عملك من <b>{to12(schedule.fromMin)}</b> إلى <b>{to12(schedule.toMin)}</b>
            </>
          ) : (
            'متاح لك في الأيام المحددة فقط'
          )}
          <br />
          <span>{schedule.days || 'كل الأيام'}</span> · بتوقيت العراق
        </p>
        {left != null ? (
          <>
            <div className="lock-sub">يُفتح بعد</div>
            <div className="lock-timer" dir="ltr">
              {d > 0 && (
                <>
                  <span className="cell"><b>{d}</b><small>يوم</small></span>
                  <i>:</i>
                </>
              )}
              <span className="cell"><b>{two(h)}</b><small>ساعة</small></span>
              <i>:</i>
              <span className="cell"><b>{two(m)}</b><small>دقيقة</small></span>
              <i>:</i>
              <span className="cell"><b>{two(s)}</b><small>ثانية</small></span>
            </div>
            {opens && (
              <div className="lock-when">
                {DAYS[opens.getUTCDay()]} · {to12(opens.getUTCHours() * 60 + opens.getUTCMinutes())}
              </div>
            )}
          </>
        ) : (
          <div className="lock-sub">لا موعد فتح قادم — راجع الإدارة</div>
        )}
        <div className="lock-now">
          الساعة في العراق <b dir="ltr">{to12(iraq.getUTCHours() * 60 + iraq.getUTCMinutes())}</b>
        </div>
      </div>
    </div>
  );
}
