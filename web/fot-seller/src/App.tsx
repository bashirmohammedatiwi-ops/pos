import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { getSeller, getToken, moneyIq, setSeller, setToken, weekRange } from './api';
import { SellerProvider, useSeller } from './store';
import { Avatar, IconBox, IconGoal, IconHome, IconMall, IconOut, IconRefresh, Sheet } from './ui';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Malls } from './pages/Malls';
import { Products } from './pages/Products';

const links = [
  { to: '/', label: 'أسبوعي', icon: IconHome, end: true },
  { to: '/malls', label: 'مولاتي', icon: IconMall },
  { to: '/goals', label: 'أهدافي', icon: IconGoal },
  { to: '/products', label: 'عمولتي', icon: IconBox },
] as const;

const titles: Record<string, string> = {
  '/': 'الأسبوع',
  '/malls': 'المولات',
  '/goals': 'الأهداف',
  '/products': 'العمولة',
};

function Shell() {
  const nav = useNavigate();
  const loc = useLocation();
  const seller = getSeller();
  const { dash, reload, loading, err } = useSeller();
  const [askOut, setAskOut] = useState(false);
  const [profile, setProfile] = useState(false);
  const [pull, setPull] = useState(0);
  const startY = useRef(0);

  useEffect(() => {
    if (err.includes('انتهت الجلسة')) {
      setToken(null);
      setSeller(null);
      nav('/login', { replace: true });
    }
  }, [err, nav]);

  function logout() {
    setToken(null);
    setSeller(null);
    sessionStorage.removeItem('fot_seller_week');
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
    <div className="phone pb-24" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <header className="topbar">
        <div className="flex items-center gap-3">
          <Avatar name={seller?.name || 'بائع'} dark onClick={() => setProfile(true)} />
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.28em] text-gold">FOT SELLER</p>
            <p className="text-sm font-extrabold">{titles[loc.pathname] || seller?.name || 'البائع'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={loading} className="icon-btn" aria-label="تحديث" onClick={() => void reload()}>
            <IconRefresh />
          </button>
          <button type="button" className="icon-btn" aria-label="خروج" onClick={() => setAskOut(true)}>
            <IconOut />
          </button>
        </div>
      </header>

      <div className="pull" style={{ height: pull }}>{pull > 48 ? 'أفلت للتحديث' : 'اسحب للتحديث'}</div>

      <main className="px-4 py-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/malls" element={<Malls />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/products" element={<Products />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="dock">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={'end' in l ? l.end : false} className={({ isActive }) => isActive ? 'on' : ''}>
            <l.icon />
            {l.label}
          </NavLink>
        ))}
      </nav>

      <Sheet open={profile} title={seller?.name || 'حسابي'} onClose={() => setProfile(false)}>
        <div className="space-y-3">
          <p className="text-sm font-bold text-muted">رقم البائع <span className="num font-extrabold text-ink">{seller?.id}</span></p>
          {dash && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">أسبوع {weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(dash.week.salesAmount)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">المستحق</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(dash.balanceDue)}</p>
              </div>
            </div>
          )}
          <button type="button" className="w-full rounded-2xl bg-terracotta py-3 font-extrabold text-white" onClick={() => { setProfile(false); setAskOut(true); }}>
            تسجيل الخروج
          </button>
        </div>
      </Sheet>

      {askOut && (
        <div className="sheet-bg" onClick={() => setAskOut(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <p className="text-lg font-extrabold">تأكيد الخروج؟</p>
            <p className="mt-1 text-sm font-bold text-muted">ستحتاج الرمز للدخول مرة أخرى.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="rounded-2xl bg-paper py-3 font-extrabold" onClick={() => setAskOut(false)}>بقاء</button>
              <button type="button" className="rounded-2xl bg-terracotta py-3 font-extrabold text-white" onClick={logout}>خروج</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Guard() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <SellerProvider><Shell /></SellerProvider>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Guard />} />
    </Routes>
  );
}
