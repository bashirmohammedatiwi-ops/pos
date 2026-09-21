import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getLastId, setLastId, setSeller, setToken, tick } from '../api';
import { Keypad, LoginArt, PinDots } from '../ui';

export function Login() {
  const nav = useNavigate();
  const [step, setStep] = useState<'id' | 'pin'>('id');
  const [id, setId] = useState(getLastId);
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = Number(id);
    if (!n) { setName(''); setLookErr(''); setLooking(false); return; }
    setLooking(true);
    setLookErr('');
    const t = setTimeout(() => {
      api.lookup(n)
        .then(s => { setName(s.name); setLooking(false); })
        .catch((ex) => {
          setName('');
          setLookErr(ex instanceof Error ? ex.message : 'تعذر التعرّف');
          setLooking(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [id]);

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
      const res = await api.login(Number(id), pin);
      setToken(res.token);
      setSeller(res.seller);
      setLastId(String(res.seller.id));
      nav('/');
    } catch (ex) {
      tick(30);
      setPin('');
      setErr(ex instanceof Error ? ex.message : 'فشل الدخول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card fade-up">
        <LoginArt />
        <p className="text-center text-[11px] font-extrabold tracking-[0.32em] text-gold">FOT SELLER</p>
        <h1 className="mt-2 text-center text-[30px] font-extrabold leading-tight">
          {step === 'id' ? 'مساحة البائع' : `أهلاً ${name.split(' ')[0]}`}
        </h1>
        <p className="mt-2 text-center text-sm font-bold leading-6 text-muted">
          {step === 'id' ? 'عمولتك كاملة · أهدافك · تفاصيل الفاتورة والوقت' : 'أدخل الرمز السرّي من الإدارة'}
        </p>

        {step === 'id' ? (
          <form onSubmit={enter} className="mt-7">
            <label className="mb-2 block text-sm font-extrabold text-gold">رقم البائع</label>
            <input
              dir="ltr"
              inputMode="numeric"
              autoComplete="username"
              autoFocus
              className="field num"
              value={id}
              onChange={e => setId(e.target.value.replace(/\D/g, ''))}
            />
            <p className={`mb-6 mt-2 min-h-6 text-sm font-extrabold ${name ? 'text-ok' : lookErr ? 'text-danger' : 'text-muted'}`}>
              {name ? `● ${name}` : !id ? 'أدخل رقمك ليظهر اسمك' : looking ? 'جاري التعرّف…' : lookErr || 'لا بائع بهذا الرقم'}
            </p>
            <button disabled={!name} className="w-full rounded-2xl bg-terracotta py-4 text-lg font-extrabold text-white disabled:opacity-45">
              التالي
            </button>
            <p className="mt-5 text-center text-sm font-bold leading-7 text-muted">
              الرمز من لوحة التحكم. إذا نسيته اطلبه من الإدارة.
            </p>
          </form>
        ) : (
          <form onSubmit={enter} className="mt-7">
            <PinDots length={pin.length} />
            <p className="mt-3 mb-4 text-center text-sm font-bold text-muted">
              {pin.length ? `${pin.length} أرقام` : '٤ أرقام على الأقل'}
            </p>
            {err && <p className="mb-3 text-center text-sm font-extrabold text-danger">{err}</p>}
            <Keypad
              onDigit={addDigit}
              onDelete={() => { tick(); setPin(p => p.slice(0, -1)); }}
            />
            <button
              disabled={busy || pin.length < 4}
              className="mt-4 w-full rounded-2xl bg-terracotta py-4 text-lg font-extrabold text-white disabled:opacity-45"
            >
              {busy ? 'جارٍ الدخول…' : 'دخول'}
            </button>
            <button
              type="button"
              className="mt-3 w-full rounded-2xl bg-paper py-3 font-extrabold"
              onClick={() => { setStep('id'); setPin(''); setErr(''); }}
            >
              رقم آخر
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
