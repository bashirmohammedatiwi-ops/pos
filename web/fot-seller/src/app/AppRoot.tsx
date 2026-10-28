import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AccessGate, wipeSellerData } from '../access';
import { getToken, refreshSession, setSeller, setToken } from '../api';
import { clearBrandCache, useBrandList } from '../brands';
import { useSeller, SellerProvider } from '../store';
import { clearTeam, getTeamToken, refreshTeam, registerPush } from '../team';
import { setFileSaver } from '../xlsx';
import { I, ToastHost } from './kit';
import { handleBack, haptic, hideSplash, onNativeBack, onResume, shareFile, watchSystemTheme } from './native';
import { Account } from './screens/Account';
import { Brands } from './screens/Brands';
import { Commission } from './screens/Commission';
import { Lock, Splash } from './screens/Gate';
import { Goals } from './screens/Goals';
import { SellerHome, StaffHome } from './screens/Home';
import { Login } from './screens/Login';

/* ─────────────────────────────────────────────────────────────────────────────
 * جذر تطبيق «ديما · الفريق»: الجلسة، بوابة الأوقات، التبويبات حسب الدور، زر الرجوع.
 * ───────────────────────────────────────────────────────────────────────────── */

type Tab = { to: string; label: string; icon: (p: { filled?: boolean }) => ReactNode; badge?: number };

function TabBar({ tabs }: { tabs: Tab[] }) {
  const loc = useLocation();
  return (
    <nav className="t-tabs" aria-label="التنقل">
      {tabs.map(t => {
        const on = t.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(t.to);
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={`t-tab ${on ? 'on' : ''}`}
            onClick={() => {
              if (on) window.scrollTo({ top: 0, behavior: 'smooth' });
              else haptic('select');
            }}
          >
            <span className="ico">
              {t.icon({ filled: on })}
              {!!t.badge && <span className="dot num">{t.badge > 9 ? '9+' : t.badge}</span>}
            </span>
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** يحفظ موضع التمرير لكل تبويب ويعيده عند الرجوع إليه. */
function useTabScroll() {
  const loc = useLocation();
  const saved = useRef(new Map<string, number>());
  const prev = useRef(loc.pathname);
  useLayoutEffect(() => {
    if (prev.current === loc.pathname) return;
    saved.current.set(prev.current, window.scrollY);
    prev.current = loc.pathname;
    const y = saved.current.get(loc.pathname) ?? 0;
    window.scrollTo(0, y);
  }, [loc.pathname]);
}

/** زر الرجوع في أندرويد: يغلق الورقة المفتوحة، ثم يعود للرئيسية، ثم يصغّر التطبيق. */
function useBackButton() {
  const nav = useNavigate();
  const loc = useLocation();
  const path = useRef(loc.pathname);
  path.current = loc.pathname;
  useEffect(() => {
    let off: (() => void) | undefined;
    void onNativeBack(() =>
      handleBack(() => {
        if (path.current !== '/' && path.current !== '/login') {
          nav('/', { replace: true });
          return true;
        }
        return false;
      }),
    ).then(f => (off = f));
    return () => off?.();
  }, [nav]);
}

function SellerShell({ onLogout }: { onLogout: () => void }) {
  const { err, dash, reload } = useSeller();
  const { list } = useBrandList();
  useTabScroll();

  useEffect(() => {
    if (err.includes('انتهت الجلسة')) onLogout();
  }, [err, onLogout]);

  useEffect(() => {
    let off: (() => void) | undefined;
    void onResume(() => void reload()).then(f => (off = f));
    return () => off?.();
  }, [reload]);

  const openGoals = dash?.goals.filter(g => g.percent < 100).length ?? 0;
  const tabs: Tab[] = [
    { to: '/', label: 'الرئيسية', icon: p => <I.home {...p} /> },
    { to: '/commission', label: 'عمولتي', icon: p => <I.wallet {...p} /> },
    { to: '/goals', label: 'أهدافي', icon: p => <I.target {...p} />, badge: openGoals || undefined },
    ...(list?.length ? [{ to: '/brands', label: 'براندي', icon: (p: { filled?: boolean }) => <I.tag {...p} /> }] : []),
    { to: '/account', label: 'حسابي', icon: p => <I.user {...p} /> },
  ];

  return (
    <div className="t-app">
      <Routes>
        <Route path="/" element={<SellerHome />} />
        <Route path="/commission" element={<Commission />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/brands" element={<Brands />} />
        <Route path="/account" element={<Account onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar tabs={tabs} />
    </div>
  );
}

function StaffShell({ onLogout }: { onLogout: () => void }) {
  useTabScroll();
  const tabs: Tab[] = [
    { to: '/', label: 'الرئيسية', icon: p => <I.home {...p} /> },
    { to: '/account', label: 'حسابي', icon: p => <I.user {...p} /> },
  ];
  return (
    <div className="t-app">
      <Routes>
        <Route path="/" element={<StaffHome />} />
        <Route path="/account" element={<Account onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar tabs={tabs} />
    </div>
  );
}

function Guard({ onLogout }: { onLogout: () => void }) {
  if (getToken())
    return (
      <SellerProvider>
        <SellerShell onLogout={onLogout} />
      </SellerProvider>
    );
  if (getTeamToken()) return <StaffShell onLogout={onLogout} />;
  return <Navigate to="/login" replace />;
}

export function TeamApp() {
  const nav = useNavigate();
  useBackButton();

  const logout = useCallback(() => {
    haptic('tap');
    clearBrandCache();
    wipeSellerData();
    setToken(null);
    setSeller(null);
    clearTeam();
    nav('/login', { replace: true });
  }, [nav]);

  useEffect(() => {
    setFileSaver(shareFile);
    void hideSplash();
    const offTheme = watchSystemTheme();
    if (getTeamToken()) {
      // جلسة الفريق تجدد رمز البائع أيضاً؛ مع خادم أقدم نرجع للتجديد القديم
      void refreshTeam().then(r => {
        if (!r.ok) {
          if (!getToken()) nav('/login', { replace: true });
          return;
        }
        if (r.sellerToken) setToken(r.sellerToken);
        else if (getToken()) void refreshSession();
        void registerPush();
      });
    } else if (getToken()) void refreshSession();
    return () => {
      setFileSaver(null);
      offTheme();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <AccessGate renderSplash={offline => <Splash offline={offline} />} renderLock={p => <Lock {...p} onLogout={logout} />} onLogout={clearTeam}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Guard onLogout={logout} />} />
        </Routes>
      </AccessGate>
      <ToastHost />
    </>
  );
}
