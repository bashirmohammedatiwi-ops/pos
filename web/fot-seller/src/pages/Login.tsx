import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getLastId, setLastId, setSeller, setToken, tick } from '../api';
import { Keypad, PinDots } from '../ui';

export function Login() {
  const nav = useNavigate();
  const [step, setStep] = useState<'id' | 'pin'>('id');
  const [id, setId] = useState(getLastId);
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = Number(id);
    if (!n) { setName(''); setLooking(false); return; }
    setLooking(true);
    const t = setTimeout(() => {
      api.lookup(n).then(s => { setName(s.name); setLooking(false); }).catch(() => { setName(''); setLooking(false); });
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
    <div className="phone">
      <div className="hero mx-4 mt-[max(1rem,env(safe-area-inset-top))] rounded-[30px] px-6 py-9 text-center">
        <p className="text-[11px] font-extrabold tracking-[0.4em] text-gold">FOT SELLER</p>
        <h1 className="mt-3 text-[32px] font-extrabold leading-tight">
          {step === 'id' ? 'مساحة البائع' : `أهلاً ${name.split(' ')[0]}`}
        </h1>
        <p className="mt-2 text-sm font-bold leading-6 text-[#d8c4a8]">
          {step === 'id' ? 'مبيعاتك · مولاتك · أهدافك · عمولتك' : 'أدخل الرمز السرّي من الإدارة'}
        </p>
      </div>

      {step === 'id' ? (
        <form onSubmit={enter} className="fade-up px-5 pb-10 pt-6">
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
          <p className={`mb-6 mt-2 min-h-6 text-sm font-extrabold ${name ? 'text-ok' : 'text-muted'}`}>
            {name ? `● ${name}` : !id ? 'أدخل رقمك ليظهر اسمك' : looking ? 'جاري التعرّف…' : 'لا بائع بهذا الرقم'}
          </p>
          <button disabled={!name} className="w-full rounded-2xl bg-terracotta py-4 text-lg font-extrabold text-white disabled:opacity-45">
            التالي
          </button>
          <p className="mt-5 text-center text-sm font-bold leading-7 text-muted">
            الرمز من لوحة التحكم. إذا نسيته اطلبه من الإدارة.
          </p>
        </form>
      ) : (
        <form onSubmit={enter} className="fade-up px-5 pb-10 pt-6">
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
  );
}
