import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import type { LanServer } from '@fot/shared';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import type { ServerInfoDto } from '@/api/types';
import { getApiBase, hydrateApiBase, persistApiBase } from '@/lib/apiBase';
import { copyText } from '@/lib/clipboard';
import { IconCheckCircle, IconCopy, IconSearch, IconWifi } from '@/components/icons';

const LOCAL_SERVER = 'http://127.0.0.1:5000';

export function LoginPage() {
  const { login, token } = useAuth();
  const [username, setUsername] = useState(() => localStorage.getItem('fot_admin_last_user') || 'admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [apiUrl, setApiUrl] = useState(() => getApiBase() || LOCAL_SERVER);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerInfoDto | null>(null);
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const [apiMessage, setApiMessage] = useState('');
  const [isServerEdition, setIsServerEdition] = useState(false);
  const [servers, setServers] = useState<LanServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await window.fotDesktop?.info?.();
      const serverHost = Boolean(info?.isServerEdition);
      if (cancelled) return;
      setIsServerEdition(serverHost);

      const saved = serverHost ? LOCAL_SERVER : await hydrateApiBase();
      if (cancelled) return;
      if (serverHost) {
        setApiUrl(LOCAL_SERVER);
        persistApiBase(LOCAL_SERVER);
      } else if (saved && saved !== apiUrl) {
        setApiUrl(saved);
      }

      const preferred = serverHost ? LOCAL_SERVER : (saved || apiUrl);
      persistApiBase(preferred);
      if (window.fotDesktop?.ensureApi) {
        const result = await window.fotDesktop.ensureApi(preferred);
        if (cancelled) return;
        const url = serverHost ? LOCAL_SERVER : (result.url || preferred);
        if (url !== apiUrl) setApiUrl(url);
        setApiReady(result.ok);
        setApiMessage(result.message || '');
        if (result.ok && url) persistApiBase(url);
      }

      await refreshInfo();
      if (!cancelled && !serverHost && window.fotDesktop?.discoverServers) {
        const found = await window.fotDesktop.discoverServers({ timeoutMs: 2500, httpScan: false });
        if (!cancelled && found.length) setServers(found);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on mount
  }, []);

  useEffect(() => {
    if (!hydrated || isServerEdition) return;
    const t = window.setTimeout(() => {
      persistApiBase(apiUrl);
      void refreshInfo();
    }, 400);
    return () => window.clearTimeout(t);
  }, [apiUrl, hydrated, isServerEdition]);

  async function refreshInfo() {
    try {
      const info = await api.serverInfo();
      setServerInfo(info);
      setApiReady(true);
      setApiMessage('');
    } catch {
      setServerInfo(null);
      setApiReady(prev => prev ?? false);
    }
  }

  async function scanLan() {
    if (!window.fotDesktop?.discoverServers) {
      setError('البحث التلقائي متاح من تطبيق سطح المكتب فقط — أدخل عنوان API يدوياً');
      return;
    }
    setScanning(true);
    setError('');
    try {
      const found = await window.fotDesktop.discoverServers({ timeoutMs: 5000, httpScan: true });
      setServers(found);
      if (found[0] && !apiReady) {
        setApiUrl(found[0].url);
        persistApiBase(found[0].url);
      }
      if (found.length === 0) setApiMessage('لم يُعثر على خادم على هذه الشبكة');
    } finally {
      setScanning(false);
    }
  }

  if (token) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const url = isServerEdition ? LOCAL_SERVER : apiUrl;
    persistApiBase(url);
    const ok = await login(username, password);
    setLoading(false);
    if (!ok) {
      setError(isServerEdition
        ? 'اسم المستخدم أو كلمة المرور غير صحيحة — تأكد من تشغيل خدمة الخادم'
        : 'اسم المستخدم أو كلمة المرور غير صحيحة — تأكد من عنوان الخادم');
    } else localStorage.setItem('fot_admin_last_user', username.trim());
  }

  const lanUrls = serverInfo?.lanAddresses.map(ip => `http://${ip}:${serverInfo.apiPort}`) ?? [];

  const inputCls =
    'w-full rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500';

  return (
    <div className="app-canvas flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-600 text-[12px] font-bold text-white">
              FOT
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-header">FOT POS</div>
              <div className="text-[11px] text-slate-500">لوحة التحكم</div>
            </div>
          </div>

          <h1 className="text-[19px] font-extrabold tracking-tight text-header">تسجيل الدخول</h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            {isServerEdition
              ? 'الجهاز الرئيسي — خدمة FOT POS تعمل محلياً'
              : 'أدخل بيانات حسابك للوصول إلى لوحة التحكم'}
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-red-700">
                <span className="mt-0.5 text-red-400">⚠</span>
                {error}
              </div>
            )}

            {isServerEdition ? (
              <div className="rounded-md border border-brand-100 bg-brand-50 px-4 py-3.5 text-[13px] text-brand-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-bold">
                    <IconCheckCircle size={15} className="text-brand-600" />
                    الخادم الرئيسي
                  </span>
                  <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${apiReady ? 'text-brand-700' : apiReady === false ? 'text-amber-700' : 'text-slate-500'}`}>
                    <span className={`h-2 w-2 rounded-full ${apiReady ? 'bg-brand-500' : apiReady === false ? 'bg-amber-400' : 'bg-slate-300'}`} />
                    {apiReady ? 'متصل' : apiReady === false ? 'جاري التشغيل…' : 'فحص…'}
                  </span>
                </div>
                <p className="mt-1.5 text-[11.5px] text-brand-900/70">
                  لا حاجة لإدخال عنوان — الخدمة المحلية على المنفذ 5000
                </p>
                {apiMessage && <p className="mt-1 text-[11.5px] text-amber-800">{apiMessage}</p>}
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold text-slate-500">
                    <span>عنوان الخادم</span>
                    <span className={`flex items-center gap-1.5 ${apiReady ? 'text-brand-700' : apiReady === false ? 'text-amber-600' : 'text-slate-400'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${apiReady ? 'bg-brand-500' : apiReady === false ? 'bg-amber-400' : 'bg-slate-300'}`} />
                      {apiReady ? 'متصل' : apiReady === false ? 'غير متصل' : 'جاري الفحص…'}
                    </span>
                  </span>
                  <input
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    className={inputCls}
                    dir="ltr"
                    placeholder="http://192.168.1.10:5000"
                  />
                  <span className="mt-1.5 block text-[11px] text-slate-400">
                    على جهاز إدارة إضافي: عنوان IP للحاسبة الرئيسية
                  </span>
                </label>

                {window.fotDesktop?.discoverServers && (
                  <button
                    type="button"
                    onClick={() => void scanLan()}
                    disabled={scanning}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-[12px] font-bold text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-60"
                  >
                    <IconSearch size={14} className={scanning ? 'animate-pulse' : ''} />
                    {scanning ? 'جاري البحث على الشبكة…' : 'بحث عن الخادم على الشبكة'}
                  </button>
                )}

                {servers.length > 0 && (
                  <div className="space-y-1.5">
                    {servers.map(s => (
                      <button
                        key={s.url}
                        type="button"
                        onClick={() => {
                          setApiUrl(s.url);
                          persistApiBase(s.url);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-right text-[12px] transition ${
                          apiUrl === s.url
                            ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-center gap-2 font-bold">
                          <IconWifi size={13} className="text-slate-400" />
                          {s.hostName || 'خادم FOT POS'}
                        </span>
                        <span className="dir-ltr font-mono text-[11px] text-slate-500" dir="ltr">{s.url}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">اسم المستخدم</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={inputCls}
                autoComplete="username"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">كلمة المرور</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={`${inputCls} pl-16`}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  onClick={() => setShowPassword(v => !v)}
                >
                  {showPassword ? 'إخفاء' : 'إظهار'}
                </button>
              </div>
            </label>
            <button
              type="submit"
              disabled={loading || (!isServerEdition && apiReady === false)}
              className="h-11 w-full rounded-md bg-brand-600 text-[14px] font-bold text-white hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-60"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  جاري الدخول…
                </span>
              ) : (
                'تسجيل الدخول'
              )}
            </button>
          </form>

          {apiReady === false && !isServerEdition && (
            <p className="mt-3 text-center text-[11.5px] text-amber-700">
              {apiMessage || 'أدخل عنوان الجهاز الرئيسي أو اضغط بحث على الشبكة'}
            </p>
          )}

          {(isServerEdition || !isServerEdition) && lanUrls.length > 0 && (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-center">
              <p className="text-[11px] font-semibold text-slate-500">
                {isServerEdition
                  ? 'عناوين الشبكة للأجهزة الأخرى'
                  : serverInfo?.hostName
                    ? `هذا الخادم: ${serverInfo.hostName}`
                    : 'افتح من أي جهاز على الشبكة'}
              </p>
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-bold text-brand-700 transition hover:text-brand-800"
                onClick={() => void copyText(lanUrls[0]).catch(() => undefined)}
                dir="ltr"
              >
                <IconCopy size={13} className="text-slate-400" />
                {lanUrls[0]}
              </button>
              {lanUrls.length > 1 && <p className="mt-1 text-[11px] text-slate-400" dir="ltr">{lanUrls.slice(1).join(' · ')}</p>}
              {isServerEdition && (
                <p className="mt-2 text-[11px] text-slate-400">ثبّت لوحة التحكم أو الكاشير على الأجهزة الأخرى واختر هذا العنوان</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
