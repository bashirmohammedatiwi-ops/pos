import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getLastUser, setLastUser, setMe, setToken, tick } from '../api';
import { BrandMark } from '../ui';

export function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState(getLastUser);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = username.trim();
    if (u.length < 2) { setName(''); setLookErr(''); setLooking(false); return; }
    setLooking(true);
    setLookErr('');
    const t = setTimeout(() => {
      api.lookup(u)
        .then(s => { setName(s.displayName); setLooking(false); })
        .catch((ex) => {
          setName('');
          setLookErr(ex instanceof Error ? ex.message : 'تعذر التعرّف');
          setLooking(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [username]);

  async function enter(e: FormEvent) {
    e.preventDefault();
    if (!name || password.length < 4) return;
    setErr('');
    setBusy(true);
    try {
      const res = await api.login(username.trim(), password);
      setToken(res.token);
      setMe(res.manager);
      setLastUser(res.manager.username);
      nav('/');
    } catch (ex) {
      tick(30);
      setPassword('');
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
          <p className="mt-6 text-[11px] font-extrabold tracking-[0.32em] text-indigo-100">FOT MANAGER</p>
          <h2 className="display mt-3 text-4xl font-black leading-tight">متابعة المحل<br />من أي مكان</h2>
          <p className="mt-4 max-w-sm text-sm font-bold leading-7 text-white/80">
            مبيعات الفريق، القطع، الكاشير، المولات، العمولات، وأهداف كل بائع — أسبوعاً بأسبوع.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-2 text-center">
            {['مبيعات', 'فريق', 'أهداف'].map(x => (
              <div key={x} className="rounded-2xl bg-white/10 px-2 py-3 text-xs font-extrabold">{x}</div>
            ))}
          </div>
        </section>

        <div className="login-card">
          <p className="text-center text-[11px] font-extrabold tracking-[0.32em] text-goal">FOT MANAGER</p>
          <h1 className="display mt-2 text-center text-[30px] font-black leading-tight">
            {name ? `أهلاً ${name.split(' ')[0]}` : 'لوحة المدير'}
          </h1>
          <p className="mt-2 text-center text-sm font-bold leading-6 text-muted">
            اسم الدخول وكلمة المرور من لوحة التحكم
          </p>
          <form onSubmit={enter} className="mt-7">
            <label className="mb-2 block text-sm font-extrabold text-goal">اسم الدخول</label>
            <input
              dir="ltr"
              autoComplete="username"
              autoFocus
              className="field"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
            <p className={`mb-4 mt-2 min-h-6 text-sm font-extrabold ${name ? 'text-ok' : lookErr ? 'text-danger' : 'text-muted'}`}>
              {name ? `● ${name}` : !username.trim() ? 'أدخل اسم الدخول ليظهر اسمك' : looking ? 'جاري التعرّف…' : lookErr || 'لا مدير بهذا الاسم'}
            </p>
            <label className="mb-2 block text-sm font-extrabold text-goal">كلمة المرور</label>
            <input
              dir="ltr"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            {err && <p className="mt-3 text-center text-sm font-extrabold text-danger">{err}</p>}
            <button
              disabled={busy || !name || password.length < 4}
              className="mt-5 w-full rounded-2xl bg-goal py-4 text-lg font-extrabold text-white disabled:opacity-45"
            >
              {busy ? 'جارٍ الدخول…' : 'دخول'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
