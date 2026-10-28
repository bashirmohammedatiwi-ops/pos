import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AccessGate, wipeSellerData } from '../access';
import { getToken, refreshSession, setSeller, setToken } from '../api';
import { clearBrandCache, useBrandList } from '../brands';
import { useSeller, SellerProvider } from '../store';
import { clearTeam, getTeamToken, refreshTeam, registerPush } from '../team';
import { setFileSaver } from '../xlsx';
import { I, ToastHost, toast } from './kit';
import { ManagerApp } from './manager/ManagerApp';
import { handleBack, haptic, hideSplash, onNativeBack, onResume, shareFile, watchSystemTheme } from './native';
import { Account } from './screens/Account';
import { Alerts } from './screens/Alerts';
import { Brands } from './screens/Brands';
import { Commission } from './screens/Commission';
import { Lock, Splash } from './screens/Gate';
import { Goals } from './screens/Goals';
import { SellerHome, StaffHome } from './screens/Home';
import { Login } from './screens/Login';
import { More, type MoreItem } from './screens/More';
import { Posts } from './screens/Posts';
import { Shift } from './screens/Shift';
import { getManagerToken, onLive, useLiveChannel, useUnread } from './work';

/* ─────────────────────────────────────────────────────────────────────────────
 * جذر تطبيق «ديما · الفريق»: الجلسة، بوابة الأوقات، التبويبات حسب الدور، القناة الحية،
 * زر الرجوع، وواجهة المدير (/m).
 * ───────────────────────────────────────────────────────────────────────────── */

type Tab = { to: string; label: string; icon: (p: { filled?: boolean }) => ReactNode; badge?: number };

const MoreIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
  </svg>
);

/** صفحات تُفتح من «المزيد» تُحسب لتبويب «المزيد» في الشريط. */
const MORE_CHILDREN = ['/goals', '/brands', '/account', '/posts'];

function TabBar({ tabs }: { tabs: Tab[] }) {
  const loc = useLocation();
  const hasMore = tabs.some(t => t.to === '/more');
  return (
    <nav className="t-tabs" aria-label="التنقل">
      {tabs.map(t => {
        const owned = tabs.some(x => x.to !== '/' && loc.pathname.startsWith(x.to));
        const on =
          t.to === '/'
            ? loc.pathname === '/'
            : loc.pathname.startsWith(t.to) || (t.to === '/more' && hasMore && !owned && MORE_CHILDREN.some(p => loc.pathname.startsWith(p)));
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

/** يحفظ موضع التمرير لكل صفحة ويعيده عند الرجوع إليها. */
function useTabScroll() {
  const loc = useLocation();
  const saved = useRef(new Map<string, number>());
  const prev = useRef(loc.pathname);
  useLayoutEffect(() => {
    if (prev.current === loc.pathname) return;
    saved.current.set(prev.current, window.scrollY);
    prev.current = loc.pathname;
    window.scrollTo(0, saved.current.get(loc.pathname) ?? 0);
  }, [loc.pathname]);
}

/** زر الرجوع في أندرويد: الورقة المفتوحة ← الصفحة السابقة ← تصغير التطبيق من الصفحة الرئيسية. */
function useBackButton() {
  const nav = useNavigate();
  const loc = useLocation();
  const path = useRef(loc.pathname);
  path.current = loc.pathname;
  useEffect(() => {
    let off: (() => void) | undefined;
    void onNativeBack(() =>
      handleBack(() => {
        const p = path.current;
        if (p === '/' || p === '/login' || p === '/m' || p === '/m/') return false;
        if (p.startsWith('/m/')) nav('/m', { replace: true });
        else nav('/', { replace: true });
        return true;
      }),
    ).then(f => (off = f));
    return () => off?.();
  }, [nav]);
}

/** القناة الحية للموظف: إشعار داخل التطبيق مع اهتزاز عند كل تبليغ جديد. */
function StaffLive() {
  useLiveChannel('staff');
  useEffect(
    () =>
      onLive(m => {
        if (m.event === 'notify' && m.data.item) {
          haptic('warning');
          toast(m.data.item.title);
        }
      }),
    [],
  );
  return null;
}

function SellerShell({ onLogout }: { onLogout: () => void }) {
  const { err, dash, reload } = useSeller();
  const { list } = useBrandList();
  const team = !!getTeamToken();
  const unread = useUnread(team ? 'staff' : null);
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
  const brands = !!list?.length;

  // مع حساب الفريق: الدوام والتبليغات في الشريط، والبقية في «المزيد»
  const tabs: Tab[] = team
    ? [
        { to: '/', label: 'الرئيسية', icon: p => <I.home {...p} /> },
        { to: '/commission', label: 'عمولتي', icon: p => <I.wallet {...p} /> },
        { to: '/shift', label: 'دوامي', icon: p => <I.calendar {...p} /> },
        { to: '/alerts', label: 'التبليغات', icon: p => <I.bell {...p} />, badge: unread },
        { to: '/more', label: 'المزيد', icon: () => <MoreIcon />, badge: openGoals || undefined },
      ]
    : [
        { to: '/', label: 'الرئيسية', icon: p => <I.home {...p} /> },
        { to: '/commission', label: 'عمولتي', icon: p => <I.wallet {...p} /> },
        { to: '/goals', label: 'أهدافي', icon: p => <I.target {...p} />, badge: openGoals || undefined },
        ...(brands ? [{ to: '/brands', label: 'براندي', icon: (p: { filled?: boolean }) => <I.tag {...p} /> }] : []),
        { to: '/account', label: 'حسابي', icon: p => <I.user {...p} /> },
      ];
  const moreItems: MoreItem[] = [
    { to: '/goals', label: 'أهدافي', icon: <I.target size={22} />, badge: openGoals || undefined },
    ...(brands ? [{ to: '/brands', label: 'براندي', icon: <I.tag size={22} />, tone: 'accent' }] : []),
    { to: '/posts', label: 'الإعلانات', icon: <I.megaphone size={22} />, tone: 'ok' },
    { to: '/shift', label: 'دوامي', icon: <I.calendar size={22} />, tone: 'accent' },
    { to: '/alerts', label: 'التبليغات', icon: <I.bell size={22} />, badge: unread, tone: 'mute' },
    { to: '/account', label: 'حسابي', icon: <I.user size={22} />, tone: 'mute' },
  ];
  const back = team ? '/more' : undefined;

  return (
    <div className="t-app">
      {team && <StaffLive />}
      <Routes>
        <Route path="/" element={<SellerHome />} />
        <Route path="/commission" element={<Commission />} />
        <Route path="/goals" element={<Goals back={back} />} />
        <Route path="/brands" element={<Brands back={back} />} />
        <Route path="/account" element={<Account onLogout={onLogout} back={back} />} />
        {team && <Route path="/shift" element={<Shift />} />}
        {team && <Route path="/alerts" element={<Alerts role="staff" />} />}
        {team && <Route path="/posts" element={<Posts back="/more" />} />}
        {team && <Route path="/more" element={<More items={moreItems} />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar tabs={tabs} />
    </div>
  );
}

function StaffShell({ onLogout }: { onLogout: () => void }) {
  useTabScroll();
  const unread = useUnread('staff');
  const tabs: Tab[] = [
    { to: '/', label: 'الرئيسية', icon: p => <I.home {...p} /> },
    { to: '/shift', label: 'دوامي', icon: p => <I.calendar {...p} /> },
    { to: '/posts', label: 'الإعلانات', icon: p => <I.megaphone {...p} /> },
    { to: '/alerts', label: 'التبليغات', icon: p => <I.bell {...p} />, badge: unread },
    { to: '/more', label: 'المزيد', icon: () => <MoreIcon /> },
  ];
  const moreItems: MoreItem[] = [
    { to: '/shift', label: 'دوامي', icon: <I.calendar size={22} />, tone: 'accent' },
    { to: '/posts', label: 'الإعلانات', icon: <I.megaphone size={22} />, tone: 'ok' },
    { to: '/alerts', label: 'التبليغات', icon: <I.bell size={22} />, badge: unread, tone: 'mute' },
    { to: '/account', label: 'حسابي', icon: <I.user size={22} />, tone: 'mute' },
  ];
  return (
    <div className="t-app">
      <StaffLive />
      <Routes>
        <Route path="/" element={<StaffHome />} />
        <Route path="/shift" element={<Shift />} />
        <Route path="/posts" element={<Posts />} />
        <Route path="/alerts" element={<Alerts role="staff" />} />
        <Route path="/more" element={<More items={moreItems} />} />
        <Route path="/account" element={<Account onLogout={onLogout} back="/more" />} />
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
  if (getManagerToken()) return <Navigate to="/m" replace />;
  return <Navigate to="/login" replace />;
}

function ManagerGuard() {
  if (!getManagerToken()) return <Navigate to="/login?as=manager" replace />;
  return <ManagerApp />;
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
          <Route path="/m/*" element={<ManagerGuard />} />
          <Route path="/*" element={<Guard onLogout={logout} />} />
        </Routes>
      </AccessGate>
      <ToastHost />
    </>
  );
}
