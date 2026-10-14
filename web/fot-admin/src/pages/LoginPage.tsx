import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Navigate } from 'react-router-dom';
import type { LanServer } from '@fot/shared';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import type { ServerInfoDto } from '@/api/types';
import { getApiBase, hydrateApiBase, persistApiBase } from '@/lib/apiBase';
import { copyText } from '@/lib/clipboard';
import {
  IconAlert,
  IconChart,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconCoins,
  IconCopy,
  IconEye,
  IconLock,
  IconMonitor,
  IconRefresh,
  IconSearch,
  IconShield,
  IconUser,
  IconWifi,
  IconX,
} from '@/components/icons';

const LOCAL_SERVER = 'http://127.0.0.1:5000';
const LAST_USER_KEY = 'fot_admin_last_user';
const REMEMBER_KEY = 'fot_admin_remember_user';
const RECENT_SERVERS_KEY = 'fot_admin_recent_servers';

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

function readRecentServers(): string[] {
  try {
    const raw = JSON.parse(readStore(RECENT_SERVERS_KEY) || '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
  } catch {
    return [];
  }
}

function IconEyeOff({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6" />
      <path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

const VALUE_POINTS = [
  { icon: IconChart, title: 'مبيعات لحظية', text: 'متابعة الفواتير والكاشير والتقارير لحظة بلحظة' },
  { icon: IconCoins, title: 'عمولات وأهداف', text: 'حساب عمولات البائعين وتسوية الأسبوع بدقة' },
  { icon: IconShield, title: 'صلاحيات آمنة', text: 'تحكم كامل بالحسابات ونقاط البيع والأقسام' },
];

export function LoginPage() {
  const { login, token } = useAuth();
  const [remember, setRemember] = useState(() => readStore(REMEMBER_KEY) !== '0');
  const [username, setUsername] = useState(() => (readStore(REMEMBER_KEY) !== '0' ? readStore(LAST_USER_KEY) : null) || 'admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [apiUrl, setApiUrl] = useState(() => getApiBase() || LOCAL_SERVER);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerInfoDto | null>(null);
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const [apiMessage, setApiMessage] = useState('');
  const [isServerEdition, setIsServerEdition] = useState(false);
  const [servers, setServers] = useState<LanServer[]>([]);
  const [recentServers, setRecentServers] = useState<string[]>(readRecentServers);
  const [scanning, setScanning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

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
    setChecking(true);
    try {
      const info = await api.serverInfo();
      setServerInfo(info);
      setApiReady(true);
      setApiMessage('');
    } catch {
      setServerInfo(null);
      setApiReady(prev => prev ?? false);
    } finally {
      setChecking(false);
    }
  }

  async function scanLan() {
    if (!window.fotDesktop?.discoverServers) {
      setError('البحث التلقائي متاح من تطبيق سطح المكتب فقط — أدخل عنوان الخادم يدوياً');
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

  function pickServer(url: string) {
    setError('');
    setApiUrl(url);
    persistApiBase(url);
  }

  function rememberServer(url: string) {
    const clean = url.replace(/\/$/, '');
    if (!clean || clean === LOCAL_SERVER) return;
    const next = [clean, ...readRecentServers().filter(x => x !== clean)].slice(0, 4);
    writeStore(RECENT_SERVERS_KEY, JSON.stringify(next));
    setRecentServers(next);
  }

  function forgetServer(url: string) {
    const next = recentServers.filter(x => x !== url);
    writeStore(RECENT_SERVERS_KEY, JSON.stringify(next));
    setRecentServers(next);
  }

  function onPasswordKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'));
  }

  async function copyUrl(url: string) {
    try {
      await copyText(url);
      setCopied(url);
      window.setTimeout(() => setCopied(c => (c === url ? null : c)), 1600);
    } catch { /* ignore */ }
  }

  if (token) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!username.trim()) {
      setError('أدخل اسم المستخدم');
      return;
    }
    if (!password) {
      setError('أدخل كلمة المرور');
      passwordRef.current?.focus();
      return;
    }
    setError('');
    setLoading(true);
    const url = isServerEdition ? LOCAL_SERVER : apiUrl;
    persistApiBase(url);
    const ok = await login(username, password);
    setLoading(false);
    if (!ok) {
      setError(isServerEdition
        ? 'اسم المستخدم أو كلمة المرور غير صحيحة — تأكد من تشغيل خدمة الخادم'
        : apiReady === false
          ? 'تعذّر الوصول إلى الخادم — تحقق من العنوان وأن الجهاز الرئيسي يعمل'
          : 'اسم المستخدم أو كلمة المرور غير صحيحة');
      setPassword('');
      passwordRef.current?.focus();
    } else {
      writeStore(REMEMBER_KEY, remember ? '1' : '0');
      writeStore(LAST_USER_KEY, remember ? username.trim() : null);
      if (!isServerEdition) rememberServer(url);
    }
  }

  const lanUrls = serverInfo?.lanAddresses.map(ip => `http://${ip}:${serverInfo.apiPort}`) ?? [];
  const statusTone = apiReady ? 'ok' : apiReady === false ? 'warn' : 'idle';
  const statusLabel = isServerEdition
    ? apiReady ? 'متصل' : apiReady === false ? 'جاري التشغيل…' : 'فحص…'
    : checking && apiReady !== true ? 'جاري الفحص…' : apiReady ? 'متصل' : apiReady === false ? 'غير متصل' : 'جاري الفحص…';
  const statusCls = {
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    idle: 'bg-slate-100 text-slate-500 ring-slate-200',
  }[statusTone];
  const dotCls = { ok: 'bg-emerald-500', warn: 'bg-amber-500', idle: 'bg-slate-400' }[statusTone];

  const otherRecents = recentServers.filter(u => !servers.some(s => s.url === u));

  const inputCls =
    'h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10';
  const labelCls = 'mb-1.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-slate-600';

  return (
    <div className="flex min-h-full bg-canvas">
      {/* جانب الهوية */}
      <aside className="relative hidden w-[44%] max-w-[560px] shrink-0 flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 h-80 w-80 rounded-full bg-brand-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
            maskImage: 'radial-gradient(ellipse at 70% 30%, black 20%, transparent 70%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-[12px] font-extrabold tracking-wide text-white shadow-[0_8px_24px_-6px_rgba(52,211,153,0.55)]">
            FOT
          </div>
          <div className="leading-tight">
            <p className="text-[16px] font-bold">FOT POS</p>
            <p className="text-[12px] text-slate-400">لوحة الإدارة</p>
          </div>
        </div>

        <div className="relative">
          <h2 className="text-[26px] font-extrabold leading-[1.35] tracking-tight">
            إدارة متجرك
            <br />
            <span className="text-brand-300">من مكان واحد.</span>
          </h2>
          <p className="mt-3 max-w-sm text-[13px] leading-6 text-slate-400">
            الفواتير، العروض، البائعون والتقارير — كل ما تحتاجه لعمل اليوم في لوحة واحدة سريعة.
          </p>
          <ul className="mt-8 space-y-4">
            {VALUE_POINTS.map(p => (
              <li key={p.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-brand-300 ring-1 ring-inset ring-white/10">
                  <p.icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-white">{p.title}</span>
                  <span className="block text-[12px] leading-5 text-slate-400">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11.5px] text-slate-500">
          © {new Date().getFullYear()} Future of Technology
        </p>
      </aside>

      {/* جانب النموذج */}
      <main className="flex min-w-0 flex-1 items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-[420px] animate-slide-up">
          {/* شعار مختصر للشاشات الضيقة */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-[11px] font-extrabold tracking-wide text-white shadow-[0_6px_16px_-6px_rgba(52,211,153,0.6)]">
              FOT
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-bold text-header">FOT POS</p>
              <p className="text-[11.5px] text-slate-500">لوحة الإدارة</p>
            </div>
          </div>

          <h1 className="text-[22px] font-extrabold tracking-tight text-header">تسجيل الدخول</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {isServerEdition
              ? 'الجهاز الرئيسي — خدمة FOT POS تعمل محلياً على هذا الجهاز'
              : 'أدخل بيانات حسابك للوصول إلى لوحة الإدارة'}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {error && (
              <div role="alert" className="flex animate-fade-in items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 px-3.5 py-3 text-[12.5px] leading-5 text-red-800">
                <IconAlert size={15} className="mt-0.5 shrink-0 text-red-500" />
                <span className="min-w-0 flex-1">{error}</span>
                <button type="button" onClick={() => setError('')} className="shrink-0 rounded p-0.5 text-red-400 hover:bg-red-100 hover:text-red-700" aria-label="إغلاق">
                  <IconX size={13} />
                </button>
              </div>
            )}

            {isServerEdition ? (
              <div className="card flex items-start gap-3 p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <IconMonitor size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold text-header">الخادم الرئيسي</span>
                    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ring-1 ring-inset ${statusCls}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${dotCls} ${apiReady ? '' : 'animate-pulse'}`} />
                      {statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-slate-500">لا حاجة لإدخال عنوان — الخدمة المحلية على المنفذ 5000</p>
                  {apiMessage && <p className="mt-1 text-[11.5px] text-amber-700">{apiMessage}</p>}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <label htmlFor="login-server" className={labelCls}>
                    <span>عنوان الخادم</span>
                    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ring-1 ring-inset ${statusCls}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${dotCls} ${apiReady ? '' : 'animate-pulse'}`} />
                      {statusLabel}
                    </span>
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <IconWifi size={16} />
                    </span>
                    <input
                      id="login-server"
                      value={apiUrl}
                      onChange={e => setApiUrl(e.target.value)}
                      className={`${inputCls} pr-10 pl-10 font-mono text-[13px]`}
                      dir="ltr"
                      placeholder="http://192.168.1.10:5000"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => void refreshInfo()}
                      className="absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      title="إعادة فحص الاتصال"
                      aria-label="إعادة فحص الاتصال"
                    >
                      <IconRefresh size={15} className={checking ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-slate-400">
                    على جهاز إدارة إضافي: أدخل عنوان IP للحاسبة الرئيسية
                  </p>
                  {apiReady === false && (
                    <p className="mt-1 text-[11.5px] text-amber-700">
                      {apiMessage || 'أدخل عنوان الجهاز الرئيسي أو اضغط «بحث على الشبكة»'}
                    </p>
                  )}
                </div>

                {(servers.length > 0 || otherRecents.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {servers.map(s => {
                      const active = apiUrl === s.url;
                      return (
                        <button
                          key={s.url}
                          type="button"
                          onClick={() => pickServer(s.url)}
                          title={s.url}
                          className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold ring-1 ring-inset transition ${
                            active
                              ? 'bg-brand-50 text-brand-700 ring-brand-300'
                              : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
                          }`}
                        >
                          {active ? <IconCheck size={12} /> : <IconWifi size={12} className="text-slate-400" />}
                          <span className="truncate">{s.hostName || 'خادم FOT POS'}</span>
                          <span className="truncate font-mono text-[10.5px] font-normal text-slate-400" dir="ltr">{s.url.replace(/^https?:\/\//, '')}</span>
                        </button>
                      );
                    })}
                    {otherRecents.map(u => {
                      const active = apiUrl === u;
                      return (
                        <span
                          key={`recent-${u}`}
                          className={`group inline-flex h-7 max-w-full items-center rounded-full ring-1 ring-inset transition ${
                            active ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300'
                          }`}
                        >
                          <button type="button" onClick={() => pickServer(u)} className="inline-flex h-full items-center gap-1.5 ps-2.5 pe-1 text-[11.5px] font-semibold" title="آخر خادم مستخدم">
                            {active ? <IconCheck size={12} /> : <IconClock size={12} className="text-slate-400" />}
                            <span className="truncate font-mono text-[10.5px]" dir="ltr">{u.replace(/^https?:\/\//, '')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => forgetServer(u)}
                            className="me-1 rounded-full p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                            aria-label="إزالة من القائمة"
                            title="إزالة من القائمة"
                          >
                            <IconX size={11} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {window.fotDesktop?.discoverServers && (
                  <button
                    type="button"
                    onClick={() => void scanLan()}
                    disabled={scanning}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-60"
                  >
                    <IconSearch size={14} className={scanning ? 'animate-pulse' : ''} />
                    {scanning ? 'جاري البحث على الشبكة…' : 'بحث عن الخادم على الشبكة'}
                  </button>
                )}
              </div>
            )}

            <div>
              <label htmlFor="login-user" className={labelCls}>اسم المستخدم</label>
              <div className="relative">
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <IconUser size={16} />
                </span>
                <input
                  id="login-user"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className={`${inputCls} pr-10`}
                  autoComplete="username"
                  spellCheck={false}
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-pass" className={labelCls}>كلمة المرور</label>
              <div className="relative">
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <IconLock size={16} />
                </span>
                <input
                  id="login-pass"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={onPasswordKey}
                  onKeyUp={onPasswordKey}
                  onBlur={() => setCapsLock(false)}
                  className={`${inputCls} pr-10 pl-11`}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
              {capsLock && (
                <p className="mt-1.5 flex animate-fade-in items-center gap-1.5 text-[11.5px] font-semibold text-amber-700">
                  <IconAlert size={13} />
                  زر Caps Lock مفعّل
                </p>
              )}
            </div>

            <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-slate-600">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              />
              تذكّر اسم المستخدم على هذا الجهاز
            </label>

            <button
              type="submit"
              disabled={loading || (!isServerEdition && apiReady === false)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-[14px] font-bold text-white shadow-[0_1px_2px_rgba(13,138,103,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:bg-brand-700 active:translate-y-px disabled:pointer-events-none disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  جاري الدخول…
                </>
              ) : (
                'تسجيل الدخول'
              )}
            </button>
          </form>

          {lanUrls.length > 0 && (
            <div className="card mt-6 p-3.5">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">
                <IconCheckCircle size={13} className="text-brand-600" />
                {isServerEdition
                  ? 'عناوين الشبكة للأجهزة الأخرى'
                  : serverInfo?.hostName
                    ? `هذا الخادم: ${serverInfo.hostName}`
                    : 'افتح من أي جهاز على الشبكة'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr">
                {lanUrls.map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => void copyUrl(u)}
                    title="نسخ العنوان"
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-slate-50 px-2.5 font-mono text-[11.5px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200"
                  >
                    {copied === u ? <IconCheck size={12} className="text-brand-600" /> : <IconCopy size={12} className="text-slate-400" />}
                    {u}
                  </button>
                ))}
              </div>
              {isServerEdition && (
                <p className="mt-2 text-[11.5px] text-slate-400">ثبّت لوحة الإدارة أو الكاشير على الأجهزة الأخرى واختر هذا العنوان</p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
