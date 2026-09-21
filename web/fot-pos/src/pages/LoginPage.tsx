import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/api/client';
import { getApiBase, hydrateApiBase, persistApiBase } from '@/lib/apiBase';
import { LoginServerSettings } from '@/components/LoginServerSettings';
import { NumPad } from '@/components/NumPad';

export function LoginPage({
  onLogin,
  canResumeOffline,
}: {
  onLogin: (username: string, password: string) => Promise<string | null>;
  onResumeOffline?: (username: string, password: string) => Promise<string | null>;
  canResumeOffline: () => Promise<boolean>;
}) {
  const [username, setUsername] = useState(() => localStorage.getItem('fot_pos_last_user') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [apiUrl, setApiUrl] = useState(() => getApiBase() || 'http://127.0.0.1:5000');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = await hydrateApiBase();
      if (cancelled) return;
      setApiUrl(url);
      const ok = await api.health();
      const ready = await canResumeOffline();
      if (cancelled) return;
      setOnline(ok);
      setOfflineReady(ready);
    })();
    return () => { cancelled = true; };
  }, [canResumeOffline]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    await persistApiBase(apiUrl);
    const fail = await onLogin(username, password);
    setLoading(false);
    if (fail) setError(fail.includes('Unauthorized') ? 'اسم المستخدم أو الرمز غير صحيح' : fail);
    else localStorage.setItem('fot_pos_last_user', username.trim());
  }

  const statusText = online ? 'متصل بالخادم' : online === false
    ? offlineReady ? 'غير متصل — الدخول والعمل محلياً جاهزان' : 'غير متصل — ادخل مرة والخادم يعمل لحفظ البيانات'
    : '…';

  return (
    <div className="pos-app items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-sm">
        <div className="pos-login-hero mb-4 text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f9f76] text-xs font-bold text-white shadow-[0_6px_16px_rgba(15,159,118,0.35)]">
            FOT
          </div>
          <h1 className="text-lg font-bold">نقطة البيع</h1>
          <p className={`mt-0.5 text-[12px] ${online ? 'text-emerald-600' : online === false ? 'text-amber-600' : 'text-slate-400'}`}>
            {statusText}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400" dir="ltr">{apiUrl}</p>
        </div>

        {showSettings ? (
          <div className="pos-login-card">
            <LoginServerSettings
              initialUrl={apiUrl}
              onSaved={(url, ok) => {
                setApiUrl(url);
                setOnline(ok);
              }}
              onClose={() => setShowSettings(false)}
            />
          </div>
        ) : (
          <form onSubmit={e => void onSubmit(e)} className="pos-login-form pos-login-card">
            {error && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>
            )}

            {online === false && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-6 text-amber-800">
                {offlineReady
                  ? 'الخادم غير متاح. سيتم الدخول بالبيانات المحفوظة من لوحة التحكم، والفواتير تُخزَّن محلياً حتى يعود الاتصال.'
                  : 'الخادم غير متاح ولا توجد نسخة محلية بعد. افتح إعدادات الاتصال أو أعد المحاولة عند توفر الشبكة.'}
              </div>
            )}

            <label className="mb-3 block">
              <span className="mb-1 block text-[12px] font-medium text-slate-600">اسم الكاشير</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="pos-field h-12 w-full text-[15px]"
                autoComplete="username"
                autoFocus
                required
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-[12px] font-medium text-slate-600">رمز الدخول</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="pos-field h-12 w-full text-[15px]"
                autoComplete="current-password"
                inputMode="numeric"
                required
              />
            </label>

            <div className="mb-4">
              <NumPad
                onDigit={d => setPassword(v => `${v}${d}`)}
                onBack={() => setPassword(v => v.slice(0, -1))}
                onClear={() => setPassword('')}
              />
            </div>

            <button type="submit" disabled={loading} className="pos-btn-primary">
              {loading ? 'جاري الدخول…' : online === false && offlineReady ? 'دخول (محلي)' : 'دخول'}
            </button>

            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="mt-4 w-full text-center text-[11px] text-slate-400 hover:text-slate-600"
            >
              إعدادات الاتصال
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
