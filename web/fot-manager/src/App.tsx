import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { ago, getMe, getToken, moneyIq, pieces, setMe, setToken, weekRange } from './api';
import { ManagerProvider, useManager } from './store';
import { Avatar, BrandMark, IconBox, IconFloor, IconGoal, IconHome, IconOut, IconRefresh, IconTeam, Sheet } from './ui';
import { Floor } from './pages/Floor';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Moves } from './pages/Moves';
import { Team } from './pages/Team';

const links = [
  { to: '/', label: 'أسبوعي', icon: IconHome, end: true },
  { to: '/team', label: 'الفريق', icon: IconTeam },
  { to: '/floor', label: 'الأرض', icon: IconFloor },
  { to: '/goals', label: 'أهداف', icon: IconGoal },
  { to: '/moves', label: 'حركات', icon: IconBox },
] as const;

const titles: Record<string, string> = {
  '/': 'الأسبوع',
  '/team': 'الفريق',
  '/floor': 'الأرض',
  '/goals': 'الأهداف',
  '/moves': 'الحركات',
};

function NavItems({ badges }: { badges?: Partial<Record<string, number>> }) {
  return (
    <>
      {links.map(l => (
        <NavLink key={l.to} to={l.to} end={'end' in l ? l.end : false} className={({ isActive }) => isActive ? 'on' : ''}>
          <span className="nav-ico">
            <l.icon />
            {!!badges?.[l.to] && <span className="nav-badge">{badges[l.to]}</span>}
          </span>
          {l.label}
        </NavLink>
      ))}
    </>
  );
}

function Shell() {
  const nav = useNavigate();
  const loc = useLocation();
  const me = getMe();
  const { dash, reload, loading, err, updatedAt } = useManager();
  const badges = {
    '/goals': dash?.goals.filter(g => g.percent < 100).length || undefined,
    '/team': dash?.week.sellerCount || undefined,
  };
  const [askOut, setAskOut] = useState(false);
  const [profile, setProfile] = useState(false);
  const [pull, setPull] = useState(0);
  const startY = useRef(0);

  useEffect(() => {
    if (err.includes('انتهت الجلسة')) {
      setToken(null);
      setMe(null);
      nav('/login', { replace: true });
    }
  }, [err, nav]);

  function logout() {
    setToken(null);
    setMe(null);
    sessionStorage.removeItem('fot_manager_week');
    nav('/login');
  }

  function onTouchStart(e: TouchEvent) {
    if (window.scrollY > 2) return;
    startY.current = e.touches[0].clientY;
  }
  function onTouchMove(e: TouchEvent) {
    if (!startY.current) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0 && window.scrollY <= 0) setPull(Math.min(72, dy * 0.4));
  }
  function onTouchEnd() {
    if (pull > 48) void reload();
    setPull(0);
    startY.current = 0;
  }

  return (
    <div className="app" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="app-body">
        <aside className="side">
          <div className="side-brand">
            <BrandMark />
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.22em] text-goal">FOT MANAGER</p>
              <p className="text-sm font-extrabold">{me?.displayName || 'المدير'}</p>
            </div>
          </div>
          {dash && (
            <div className="card seller-mini">
              <p className="kicker">مبيعات الأسبوع</p>
              <p className="num mt-1 text-xl font-extrabold">{moneyIq(dash.week.salesAmount)}</p>
              <p className="mt-1 text-sm font-extrabold text-gold">{moneyIq(dash.week.commissionAmount)}</p>
              <p className="mt-2 text-sm font-extrabold text-goal">{pieces(dash.week.pieceCount)}</p>
              <p className="mt-1 text-[11px] font-bold text-muted">{weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
            </div>
          )}
          <NavItems badges={badges} />
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <Avatar name={me?.displayName || 'مدير'} onClick={() => setProfile(true)} />
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.22em] text-goal">FOT MANAGER</p>
                <p className="text-sm font-extrabold">{titles[loc.pathname] || me?.displayName || 'المدير'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {updatedAt && (
                <span className="hidden items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-muted sm:flex">
                  <span className="sync-dot" />
                  {ago(updatedAt)}
                </span>
              )}
              <button type="button" disabled={loading} className={`icon-btn ${loading ? 'spin' : ''}`} aria-label="تحديث" onClick={() => void reload()}>
                <IconRefresh />
              </button>
              <button type="button" className="icon-btn" aria-label="خروج" onClick={() => setAskOut(true)}>
                <IconOut />
              </button>
            </div>
          </header>

          <div className="pull" style={{ height: pull }}>{pull > 48 ? 'أفلت للتحديث' : 'اسحب للتحديث'}</div>

          <main className="main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/team" element={<Team />} />
              <Route path="/floor" element={<Floor />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/moves" element={<Moves />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>

      <nav className="dock">
        <NavItems badges={badges} />
      </nav>

      <Sheet open={profile} title={me?.displayName || 'حسابي'} onClose={() => setProfile(false)}>
        <div className="space-y-3">
          <p className="text-sm font-bold text-muted">الدخول <span className="font-extrabold text-ink">{me?.username}</span></p>
          {dash && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-goal">المبيعات</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(dash.week.salesAmount)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">العمولة</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(dash.week.commissionAmount)}</p>
              </div>
              <div className="card p-3.5 col-span-2">
                <p className="text-[11px] font-extrabold text-gold">القطع</p>
                <p className="num mt-1 text-lg font-extrabold">{pieces(dash.week.pieceCount)}</p>
              </div>
            </div>
          )}
          <button type="button" className="w-full rounded-2xl bg-goal py-3 font-extrabold text-white" onClick={() => { setProfile(false); setAskOut(true); }}>
            تسجيل الخروج
          </button>
        </div>
      </Sheet>

      {askOut && (
        <div className="sheet-bg" onClick={() => setAskOut(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <p className="text-lg font-extrabold">تأكيد الخروج؟</p>
            <p className="mt-1 text-sm font-bold text-muted">ستحتاج كلمة المرور للدخول مرة أخرى.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="rounded-2xl bg-paper py-3 font-extrabold" onClick={() => setAskOut(false)}>بقاء</button>
              <button type="button" className="rounded-2xl bg-goal py-3 font-extrabold text-white" onClick={logout}>خروج</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Guard() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <ManagerProvider><Shell /></ManagerProvider>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Guard />} />
    </Routes>
  );
}
