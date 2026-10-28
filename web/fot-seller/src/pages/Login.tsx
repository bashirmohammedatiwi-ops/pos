import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessClosedError, api, getToken, publishAccess, setLastId, setSeller, setToken, tick } from '../api';
import { MANAGER_URL } from '../config';
import { getLastCode, getTeamToken, setLastCode, setTeamMe, setTeamToken, teamApi, KIND_LABEL, registerPush } from '../team';
import { BrandMark, Keypad, LoginArt, PinDots } from '../ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * الدخول — نافذتان: «موظف» (الكود ثم الرمز) و«مدير» (تطبيق المدراء).
 * الموظف يدخل عبر خادم الفريق؛ إن كان الخادم أقدم نرجع تلقائياً لدخول البائع القديم.
 * ───────────────────────────────────────────────────────────────────────────── */

type Who = 'staff' | 'manager';
type Mode = 'team' | 'legacy';

export function Login() {
  const nav = useNavigate();
  const [who, setWho] = useState<Who>('staff');
  const [step, setStep] = useState<'id' | 'pin'>('id');
  const [code, setCode] = useState(getLastCode);
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [mode, setMode] = useState<Mode>('team');
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getToken() || getTeamToken()) nav('/', { replace: true });
  }, [nav]);

  useEffect(() => {
    const c = code.trim();
    if (!c) {
      setName('');
      setLookErr('');
      setLooking(false);
      return;
    }
    setLooking(true);
    setLookErr('');
    const t = setTimeout(async () => {
      try {
        const s = await teamApi.lookup(c);
        setName(s.name);
        setKind(s.kind);
        setMode('team');
      } catch (ex) {
        // خادم أقدم بلا تطبيق الفريق: دخول البائع برقمه
        const status = (ex as { status?: number }).status;
        const legacy = /^\d+$/.test(c) && (status === 404 || status === 502 || status === undefined);
        if (legacy) {
          try {
            const s = await api.lookup(Number(c));
            setName(s.name);
            setKind('seller');
            setMode('legacy');
            setLooking(false);
            return;
          } catch {
            /* fallthrough */
          }
        }
        setName('');
        setLookErr(ex instanceof Error ? ex.message : 'تعذر التعرّف');
      } finally {
        setLooking(false);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [code]);

  function addDigit(d: string) {
    tick();
    setErr('');
    setPin(p => (p + d).slice(0, 8));
  }

  async function enter(e?: FormEvent) {
    e?.preventDefault();
    if (step === 'id') {
      if (!name) return;
      setPin('');
      setErr('');
      setStep('pin');
      return;
    }
    if (pin.length < 4) return;
    setErr('');
    setBusy(true);
    try {
      if (mode === 'team') {
        const res = await teamApi.login(code.trim(), pin);
        setTeamToken(res.token);
        setTeamMe(res.staff);
        if (res.sellerToken && res.staff.salesmanId) {
          setToken(res.sellerToken);
          setSeller({ id: res.staff.salesmanId, name: res.staff.name, mustChangePin: false });
          setLastId(String(res.staff.salesmanId));
        }
        setLastCode(code.trim());
        if (res.access) publishAccess(res.access as never);
        void registerPush('staff', getTeamToken());
      } else {
        const res = await api.login(Number(code), pin);
        setToken(res.token);
        setSeller(res.seller);
        setLastId(String(res.seller.id));
        setLastCode(code.trim());
        publishAccess(res.access);
      }
      nav('/');
    } catch (ex) {
      const body = (ex as { body?: { code?: string; access?: unknown } }).body;
      if (ex instanceof AccessClosedError || body?.code === 'outside_hours') {
        if (body?.access) publishAccess(body.access as never);
        setPin('');
        setErr(ex instanceof Error ? ex.message : 'خارج وقت العمل');
        return;
      }
      tick(30);
      setPin('');
      setErr(ex instanceof Error ? ex.message : 'فشل الدخول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-stage fade-up">
        <section className="login-brand">
          <BrandMark size={56} />
          <p className="mt-6 text-[11px] font-extrabold tracking-[0.32em] text-teal-100">DEEMA · TEAM</p>
          <h2 className="display mt-3 text-4xl font-black leading-tight">تطبيق فريق<br />ديما الحياة</h2>
          <p className="mt-4 max-w-sm text-sm font-bold leading-7 text-white/80">عملك اليومي في مكان واحد: العمولة والأهداف والبراندات، والمزيد قريباً.</p>
        </section>

        <div className="login-card">
          <LoginArt />
          <p className="text-center text-[11px] font-extrabold tracking-[0.32em] text-gold">DEEMA · TEAM</p>

          <div className="login-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={who === 'staff'} className={who === 'staff' ? 'on' : ''} onClick={() => setWho('staff')}>
              موظف
            </button>
            <button type="button" role="tab" aria-selected={who === 'manager'} className={who === 'manager' ? 'on' : ''} onClick={() => setWho('manager')}>
              مدير
            </button>
          </div>

          {who === 'manager' ? (
            <div className="mt-6 text-center">
              <h1 className="display text-[26px] font-black leading-tight">دخول المدراء</h1>
              <p className="mt-2 text-sm font-bold leading-6 text-muted">لوحة الفريق، المبيعات، الأهداف، والموافقات — باسم المستخدم وكلمة المرور.</p>
              <button
                type="button"
                className="mt-6 w-full rounded-2xl bg-terracotta py-4 text-lg font-extrabold text-white"
                onClick={() => {
                  window.location.href = MANAGER_URL;
                }}
              >
                فتح تطبيق المدراء
              </button>
            </div>
          ) : (
            <>
              <h1 className="display mt-4 text-center text-[28px] font-black leading-tight">
                {step === 'id' ? 'أهلاً بك' : `أهلاً ${name.split(' ')[0]}`}
              </h1>
              <p className="mt-2 text-center text-sm font-bold leading-6 text-muted">
                {step === 'id' ? 'أدخل كود الدخول الخاص بك' : 'أدخل الرمز السرّي من الإدارة'}
              </p>

              {step === 'id' ? (
                <form onSubmit={enter} className="mt-6">
                  <label className="mb-2 block text-sm font-extrabold text-gold">كود الدخول</label>
                  <input
                    dir="ltr"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoFocus
                    className="field num"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\s/g, '').slice(0, 20))}
                  />
                  <p className={`mb-6 mt-2 min-h-6 text-sm font-extrabold ${name ? 'text-ok' : lookErr ? 'text-danger' : 'text-muted'}`}>
                    {name ? `● ${name}${kind ? ` · ${KIND_LABEL[kind] ?? ''}` : ''}` : !code ? 'يظهر اسمك بعد كتابة الكود' : looking ? 'جاري التعرّف…' : lookErr || 'لا موظف بهذا الكود'}
                  </p>
                  <button disabled={!name} className="w-full rounded-2xl bg-terracotta py-4 text-lg font-extrabold text-white disabled:opacity-45">
                    التالي
                  </button>
                  <p className="mt-5 text-center text-sm font-bold leading-7 text-muted">الكود والرمز من الإدارة. إذا نسيتهما اطلبهما من مديرك.</p>
                </form>
              ) : (
                <form onSubmit={enter} className="mt-6">
                  <PinDots length={pin.length} />
                  <p className="mb-4 mt-3 text-center text-sm font-bold text-muted">{pin.length ? `${pin.length} أرقام` : '٤ أرقام على الأقل'}</p>
                  {err && <p className="mb-3 text-center text-sm font-extrabold text-danger">{err}</p>}
                  <Keypad
                    onDigit={addDigit}
                    onDelete={() => {
                      tick();
                      setPin(p => p.slice(0, -1));
                    }}
                  />
                  <button disabled={busy || pin.length < 4} className="mt-4 w-full rounded-2xl bg-terracotta py-4 text-lg font-extrabold text-white disabled:opacity-45">
                    {busy ? 'جارٍ الدخول…' : 'دخول'}
                  </button>
                  <button
                    type="button"
                    className="mt-3 w-full rounded-2xl bg-paper py-3 font-extrabold"
                    onClick={() => {
                      setStep('id');
                      setPin('');
                      setErr('');
                    }}
                  >
                    كود آخر
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
