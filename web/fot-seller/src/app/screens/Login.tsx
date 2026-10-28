import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccessClosedError, api, publishAccess, setLastId, setSeller, setToken } from '../../api';
import { apiUrl } from '../../config';
import { KIND_LABEL, getLastCode, registerPush, setLastCode, setTeamMe, setTeamToken, teamApi } from '../../team';
import { Avatar, I, Mark, Segmented } from '../kit';
import { haptic, statusOnHero } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * الدخول — نافذتان: «موظف» (الكود ← الاسم ← الرمز) و«مدير» (المستخدم وكلمة المرور).
 * ───────────────────────────────────────────────────────────────────────────── */

type Who = 'staff' | 'manager';
const PIN_MAX = 6;

export function Login() {
  const [params] = useSearchParams();
  const [who, setWho] = useState<Who>(params.get('as') === 'manager' ? 'manager' : 'staff');

  useEffect(() => {
    statusOnHero(true);
    return () => statusOnHero(false);
  }, []);

  return (
    <div className="t-login">
      <section className="t-login-top">
        <div className="t-mark">
          <Mark size={34} />
        </div>
        <h1>
          ديما · الفريق
        </h1>
        <p>{who === 'staff' ? 'يومك في العمل، في مكان واحد: عمولتك، أهدافك، وبراندك.' : 'إدارة الفريق والمبيعات والموافقات من هاتفك.'}</p>
      </section>
      <section className="t-login-sheet">
        <Segmented
          items={[
            { id: 'staff', label: 'موظف' },
            { id: 'manager', label: 'مدير' },
          ]}
          value={who}
          onChange={setWho}
        />
        <div key={who} style={{ animation: 'page-in .35s var(--ease) both' }}>
          {who === 'staff' ? <StaffLogin /> : <ManagerLogin />}
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
        void registerPush();
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

  if (step === 'code') {
    return (
      <form
        style={{ marginTop: 22 }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!name) return;
          haptic('tap');
          setPin('');
          setErr('');
          setStep('pin');
        }}
      >
        <label className="t-field">
          <span>كود الدخول</span>
          <input
            className="t-input num ltr"
            style={{ textAlign: 'center', letterSpacing: '.12em' }}
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\s/g, '').slice(0, 20))}
          />
        </label>

        <div style={{ minHeight: 86, marginTop: 14 }}>
          {name ? (
            <div className="t-who">
              <Avatar name={name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">{name}</div>
                <div className="role">{KIND_LABEL[kind] ?? 'موظف'} · كود {code.trim()}</div>
              </div>
              <span className="t-badge ok">
                <I.check size={14} />
                معروف
              </span>
            </div>
          ) : (
            <p className={`t-hint ${lookErr ? 'bad' : ''}`}>
              {!code.trim() ? 'اكتب الكود الذي أعطتك إياه الإدارة ليظهر اسمك' : looking ? 'جارٍ التعرّف…' : lookErr || 'لا موظف بهذا الكود'}
            </p>
          )}
        </div>

        <button className="t-btn block press" disabled={!name}>
          متابعة
          <I.chevron />
        </button>
        <p className="t-hint" style={{ textAlign: 'center', marginTop: 16 }}>
          نسيت الكود أو الرمز؟ اطلبه من مديرك.
        </p>
      </form>
    );
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div className="t-who">
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
        <Avatar name={name} size="sm" />
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
    <form style={{ marginTop: 22, display: 'grid', gap: 14 }} onSubmit={submit}>
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
