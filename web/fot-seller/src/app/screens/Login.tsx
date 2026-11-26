import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccessClosedError, api, publishAccess, setLastId, setSeller, setToken } from '../../api';
import { APP_VERSION, apiUrl, isNative } from '../../config';
import { KIND_LABEL, getLastCode, registerPush, getTeamToken, setLastCode, setTeamMe, setTeamToken, teamApi } from '../../team';
import { I, Mark } from '../kit';
import { haptic, statusOnHero } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * الدخول — نافذتان: «موظف» (الكود ← الاسم ← الرمز) و«مدير» (المستخدم وكلمة المرور).
 * ───────────────────────────────────────────────────────────────────────────── */

type Who = 'staff' | 'manager';
const PIN_MAX = 6;

/** الساعة الآن بتوقيت بغداد، تتحدث كل نصف دقيقة */
function useBaghdadNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', hour12: false }).format(now));
  const time = now.toLocaleTimeString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', hour: 'numeric', minute: '2-digit', hour12: true });
  const date = now.toLocaleDateString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', weekday: 'long', day: 'numeric', month: 'long' });
  const greet = hour < 5 ? 'مساء الخير' : hour < 12 ? 'صباح الخير' : hour < 17 ? 'نهارك سعيد' : 'مساء الخير';
  return { time, date, greet };
}

/** في سفاري الآيفون (لا التطبيق المثبّت): كيف يُضاف الموقع للشاشة الرئيسية */
function InstallTip() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('fot_install_tip') === 'no';
    } catch {
      return false;
    }
  });
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  if (isNative() || !ios || standalone || hidden) return null;
  return (
    <div className="lg-tip">
      <span className="lg-tip-ico" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M8 7l4-4 4 4" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
      </span>
      <span>
        ثبّت ديما على شاشتك: اضغط <b>مشاركة</b> في الأسفل ثم <b>«إضافة إلى الشاشة الرئيسية»</b>.
      </span>
      <button
        type="button"
        aria-label="إخفاء"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem('fot_install_tip', 'no');
          } catch {
            /* تخزين غير متاح */
          }
        }}
      >
        <I.close size={16} />
      </button>
    </div>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const [who, setWho] = useState<Who>(params.get('as') === 'manager' ? 'manager' : 'staff');
  const { time, date, greet } = useBaghdadNow();

  useEffect(() => {
    statusOnHero(true);
    return () => statusOnHero(false);
  }, []);

  return (
    <div className="t-login lg">
      <section className="t-login-top lg-top">
        <div className="lg-brand">
          <span className="t-mark lg-mark">
            <Mark size={28} />
          </span>
          <span>
            <b>ديما الحياة</b>
            <small>تطبيق الفريق</small>
          </span>
        </div>
        <div className="lg-clock">
          <span className="lg-greet">{who === 'staff' ? greet : 'دخول المدراء'}</span>
          <b className="num">{time}</b>
          <small>{date}</small>
        </div>
      </section>
      <section className="t-login-sheet lg-sheet">
        <div key={who} style={{ animation: 'page-in .35s var(--ease) both' }}>
          {who === 'staff' ? <StaffLogin /> : <ManagerLogin />}
        </div>
        <InstallTip />
        <div className="lg-foot">
          <button type="button" className="lg-switch press" onClick={() => (haptic('select'), setWho(who === 'staff' ? 'manager' : 'staff'))}>
            {who === 'staff' ? (
              <>
                <I.shield size={16} /> أنت مدير؟ <b>دخول المدراء</b>
              </>
            ) : (
              <>
                <I.user size={16} /> <b>دخول الموظفين</b>
              </>
            )}
          </button>
          <small className="num">الإصدار {APP_VERSION}</small>
        </div>
      </section>
    </div>
  );
}

/* ═════════════ الموظف ═════════════ */
function StaffLogin() {
  const nav = useNavigate();
  const [step, setStep] = useState<'code' | 'pin'>('code');
  const [code, setCode] = useState(getLastCode);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const c = code.trim();
    setName('');
    setLookErr('');
    if (!c) {
      setLooking(false);
      return;
    }
    setLooking(true);
    const t = setTimeout(async () => {
      try {
        const s = await teamApi.lookup(c);
        setName(s.name);
        setKind(s.kind);
        setLegacy(false);
        haptic('select');
      } catch (ex) {
        // خادم أقدم بلا تطبيق الفريق: دخول البائع برقمه
        const status = (ex as { status?: number }).status;
        if (/^\d+$/.test(c) && (status === 404 || status === 502 || status === undefined)) {
          try {
            const s = await api.lookup(Number(c));
            setName(s.name);
            setKind('seller');
            setLegacy(true);
            haptic('select');
            return;
          } catch {
            /* لا هذا ولا ذاك */
          }
        }
        setLookErr(ex instanceof Error ? ex.message : 'تعذر التعرّف');
      } finally {
        setLooking(false);
      }
    }, 260);
    return () => clearTimeout(t);
  }, [code]);

  function fail(message: string) {
    haptic('error');
    setErr(message);
    setShake(true);
    setTimeout(() => {
      setShake(false);
      setPin('');
    }, 450);
  }

  async function submit(value = pin) {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setErr('');
    try {
      if (!legacy) {
        const res = await teamApi.login(code.trim(), value);
        setTeamToken(res.token);
        setTeamMe(res.staff);
        if (res.sellerToken && res.staff.salesmanId) {
          setToken(res.sellerToken);
          setSeller({ id: res.staff.salesmanId, name: res.staff.name, mustChangePin: false });
          setLastId(String(res.staff.salesmanId));
        }
        if (res.access) publishAccess(res.access as never);
        void registerPush('staff', getTeamToken(), link => nav(link));
      } else {
        const res = await api.login(Number(code), value);
        setToken(res.token);
        setSeller(res.seller);
        setLastId(String(res.seller.id));
        publishAccess(res.access);
      }
      setLastCode(code.trim());
      haptic('success');
      nav('/', { replace: true });
    } catch (ex) {
      const body = (ex as { body?: { code?: string; access?: unknown } }).body;
      if (ex instanceof AccessClosedError || body?.code === 'outside_hours') {
        if (body?.access) publishAccess(body.access as never);
      }
      if (body?.code === 'device_bound') {
        fail('حسابك مربوط بهاتف آخر — اطلب من الإدارة إعادة تعيين الجهاز');
        return;
      }
      fail(ex instanceof Error ? ex.message : 'فشل الدخول');
    } finally {
      setBusy(false);
    }
  }

  // المرجع يحفظ الأرقام بين اللمسات السريعة، والدخول التلقائي يُطلق مرة واحدة فقط
  const pinRef = useRef('');
  pinRef.current = pin;
  function press(d: string) {
    if (busy || pinRef.current.length >= PIN_MAX) return;
    haptic('tap');
    setErr('');
    const next = pinRef.current + d;
    pinRef.current = next;
    setPin(next);
    if (next.length === PIN_MAX) setTimeout(() => void submit(next), 120);
  }

  const remembered = !!name && code.trim() === getLastCode() && !!getLastCode();
  const firstName = name.split(' ')[0];
  if (step === 'code') {
    return (
      <form
        className="lg-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!name) return;
          haptic('tap');
          setPin('');
          setErr('');
          setStep('pin');
        }}
      >
        <h2 className="lg-title">{remembered ? 'أهلاً بعودتك' : 'دخول الموظفين'}</h2>
        <p className="lg-sub">{remembered ? 'اضغط متابعة ثم أدخل رمزك السري' : 'اكتب كودك ليظهر اسمك، ثم رمزك السري'}</p>

        {remembered ? (
          <button type="submit" className="lg-me press">
            <span className="lg-me-ico" aria-hidden>
              <I.user size={22} />
            </span>
            <span className="lg-me-text">
              <b>{name}</b>
              <small>
                {KIND_LABEL[kind] ?? 'موظف'} · كود <span className="num ltr">{code.trim()}</span>
              </small>
            </span>
            <span className="lg-me-go" aria-hidden>
              <I.chevron size={18} />
            </span>
          </button>
        ) : (
          <>
            <label className="lg-code">
              <span className="lg-code-ico" aria-hidden>
                <I.lock size={19} />
              </span>
              <input
                className="num ltr"
                placeholder="كود الدخول"
                aria-label="كود الدخول"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                autoFocus={!code}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\s/g, '').slice(0, 20))}
              />
              {looking && <span className="spinner lg-code-spin" aria-hidden />}
            </label>
            <div className="lg-found">
              {name ? (
                <div className="lg-name">
                  <I.check size={16} />
                  <b>{name}</b>
                  <small>{KIND_LABEL[kind] ?? 'موظف'}</small>
                </div>
              ) : (
                <p className={`t-hint ${lookErr ? 'bad' : ''}`}>{!code.trim() ? 'الكود الذي أعطتك إياه الإدارة' : looking ? 'جارٍ التعرّف…' : lookErr || 'لا موظف بهذا الكود'}</p>
              )}
            </div>
          </>
        )}

        <button className="t-btn block press lg-go" disabled={!name}>
          {remembered ? `متابعة باسم ${firstName}` : 'متابعة'}
          <I.chevron />
        </button>
        {remembered ? (
          <button type="button" className="lg-link press" onClick={() => (haptic('select'), setCode(''))}>
            لست {firstName}؟ ادخل بكود آخر
          </button>
        ) : (
          <p className="t-hint" style={{ textAlign: 'center', marginTop: 14 }}>
            نسيت الكود أو الرمز؟ اطلبه من مديرك.
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="lg-form">
      <div className="t-who lg-pin-who">
        <button
          type="button"
          className="t-icon-btn ghost press"
          aria-label="رجوع"
          onClick={() => {
            setStep('code');
            setPin('');
            setErr('');
          }}
        >
          <I.back />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">أهلاً {name.split(' ')[0]}</div>
          <div className="role">أدخل رمزك السري</div>
        </div>
        <span className="lg-me-ico sm" aria-hidden>
          <I.lock size={18} />
        </span>
      </div>

      <div className={`t-pin ${shake ? 'shake' : ''}`} aria-label={`${pin.length} أرقام`}>
        {Array.from({ length: PIN_MAX }, (_, i) => (
          <i key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <p className={`t-hint ${err ? 'bad' : ''}`} style={{ textAlign: 'center' }} role={err ? 'alert' : undefined}>
        {busy ? 'جارٍ التحقق…' : err || (pin.length > 0 && pin.length < 4 ? 'أربعة أرقام على الأقل' : ' ')}
      </p>

      <div className="t-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <button key={d} type="button" className="t-key num" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="t-key ghost" disabled={pin.length < 4 || busy} onClick={() => void submit()} style={{ opacity: pin.length >= 4 && pin.length < PIN_MAX ? 1 : 0.35 }}>
          دخول
        </button>
        <button type="button" className="t-key num" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="t-key ghost"
          aria-label="حذف"
          onClick={() => {
            haptic('tap');
            setErr('');
            setPin(p => p.slice(0, -1));
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 6H9l-6 6 6 6h12z" />
            <path d="m17.5 9.5-5 5M12.5 9.5l5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ═════════════ المدير ═════════════ */
async function managerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const text = await res.text();
  let body: { error?: string } & Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error(path.includes('lookup') ? 'لا مدير بهذا الاسم' : 'تعذر الدخول');
    if (res.status === 401) throw new Error('كلمة المرور غير صحيحة');
    throw new Error(body.error || 'تعذر الاتصال بالخادم');
  }
  return body as T;
}

type ManagerMe = { id: number; username: string; displayName: string };

function ManagerLogin() {
  const nav = useNavigate();
  const [user, setUser] = useState(() => localStorage.getItem('fot_manager_last_user') ?? '');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = user.trim();
    setName('');
    setHint('');
    if (!u) return;
    const t = setTimeout(async () => {
      try {
        const me = await managerFetch<ManagerMe>(`/auth/manager-lookup?username=${encodeURIComponent(u)}`);
        setName(me.displayName || me.username);
      } catch (ex) {
        setHint(ex instanceof Error ? ex.message : '');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user.trim() || pass.length < 4 || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await managerFetch<{ token: string; manager: ManagerMe }>('/auth/manager-login', {
        method: 'POST',
        body: JSON.stringify({ username: user.trim(), password: pass }),
      });
      localStorage.setItem('fot_manager_token', res.token);
      localStorage.setItem('fot_manager_me', JSON.stringify(res.manager));
      localStorage.setItem('fot_manager_last_user', user.trim());
      haptic('success');
      nav('/m', { replace: true });
    } catch (ex) {
      haptic('error');
      setErr(ex instanceof Error ? ex.message : 'فشل الدخول');
      setPass('');
      passRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lg-form" style={{ display: 'grid', gap: 14 }} onSubmit={submit}>
      <div>
        <h2 className="lg-title">دخول المدراء</h2>
        <p className="lg-sub">نفس اسم المستخدم وكلمة المرور في لوحة التحكم</p>
      </div>
      <label className="t-field">
        <span>اسم المستخدم</span>
        <input
          className="t-input ltr"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          value={user}
          onChange={e => setUser(e.target.value.slice(0, 40))}
        />
      </label>
      <p className={`t-hint ${hint ? 'bad' : ''}`} style={{ marginTop: -6 }}>
        {name ? (
          <span style={{ color: 'var(--ok)', fontWeight: 600 }}>● {name}</span>
        ) : (
          hint || 'نفس حساب لوحة التحكم'
        )}
      </p>
      <label className="t-field">
        <span>كلمة المرور</span>
        <div className="t-input-wrap">
          <input
            ref={passRef}
            className="t-input ltr"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={pass}
            onChange={e => setPass(e.target.value)}
          />
          <button type="button" className="reveal" onClick={() => setShow(v => !v)}>
            {show ? 'إخفاء' : 'إظهار'}
          </button>
        </div>
      </label>
      {err && (
        <p className="t-hint bad" role="alert">
          {err}
        </p>
      )}
      <button className="t-btn block press" disabled={busy || !user.trim() || pass.length < 4} style={{ marginTop: 4 }}>
        {busy ? <span className="spinner" /> : 'دخول المدير'}
      </button>
    </form>
  );
}
