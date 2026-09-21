import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { ago, getMe, getToken, lastSyncMs, moneyIq, resolveWeekSales, setMe, setToken, todayKey, weekRange } from './api';
import { lineCashier } from './insights';
import { ManagerProvider, useManager } from './store';
import { Avatar, BrandMark, Finder, IconBox, IconCashier, IconGoal, IconHome, IconOut, IconRefresh, IconSearch, IconTeam, Sheet, type FinderHit } from './ui';
import { Cashiers } from './pages/Cashiers';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Moves } from './pages/Moves';
import { Products } from './pages/Products';
import { Report } from './pages/Report';
import { Team } from './pages/Team';
import { Watch } from './pages/Watch';

const links = [
  { to: '/', label: 'نظرة', icon: IconHome, end: true },
  { to: '/team', label: 'بائعون', icon: IconTeam },
  { to: '/cashiers', label: 'كاشير', icon: IconCashier },
  { to: '/goals', label: 'أهداف', icon: IconGoal },
  { to: '/moves', label: 'فواتير', icon: IconBox },
] as const;

const titles: Record<string, string> = {
  '/': 'نظرة الأسبوع',
  '/team': 'البائعون',
  '/cashiers': 'الكاشير',
  '/goals': 'الأهداف',
  '/moves': 'الفواتير',
  '/report': 'التقرير',
  '/products': 'المنتجات',
  '/watch': 'المتابعة',
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
  const { dash, cashiers, lines, reload, loading, err, updatedAt } = useManager();
  const badges = {
    '/goals': dash?.goals.filter(g => g.percent < 100).length || undefined,
    '/team': dash?.sellers.filter(s => s.salesAmount > 0 || s.receiptCount > 0).length || undefined,
    '/cashiers': cashiers.length || undefined,
    '/moves': lines.length || undefined,
  };
  const [askOut, setAskOut] = useState(false);
  const [profile, setProfile] = useState(false);
  const [finder, setFinder] = useState(false);
  const [pull, setPull] = useState(0);
  const startY = useRef(0);

  useEffect(() => {
    if (err.includes('انتهت الجلسة')) {
      setToken(null);
      setMe(null);
      nav('/login', { replace: true });
    }
  }, [err, nav]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setFinder(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hits = useMemo<FinderHit[]>(() => {
    const sellers = (dash?.sellers ?? []).map(s => ({
      id: `s-${s.salesmanId}`,
      title: s.name,
      hint: `بائع · ${moneyIq(s.salesAmount)} · ${s.receiptCount} فاتورة`,
      to: '/team',
    }));
    const cash = cashiers.map(c => ({
      id: `c-${c.cashierId}-${c.name}`,
      title: c.name,
      hint: `كاشير · ${moneyIq(c.salesAmount)} · ${c.receiptCount} فاتورة`,
      to: '/cashiers',
    }));
    const goals = (dash?.goals ?? []).map(g => ({
      id: `g-${g.ruleId}-${g.salesmanId}`,
      title: `${g.salesmanName} · ${g.ruleName}`,
      hint: `هدف · ${Math.round(g.percent)}٪ إنجاز`,
      to: '/goals',
    }));
    const products = [...new Set(lines.map(l => l.productName))].slice(0, 30).map(name => ({
      id: `p-${name}`,
      title: name,
      hint: 'منتج',
      to: '/products',
    }));
    const items = lines.slice(0, 80).map(l => ({
      id: `l-${l.id}`,
      title: l.productName,
      hint: `${l.salesmanName} · ${lineCashier(l) || 'كاشير'} · ${l.receiptNumber ? `#${l.receiptNumber}` : 'فاتورة'} · ${moneyIq(l.salesAmount)}`,
      to: '/moves',
    }));
    return [...sellers, ...cash, ...goals, ...products, ...items];
  }, [dash, cashiers, lines]);

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
              <p className="num mt-1 text-xl font-extrabold">{moneyIq(resolveWeekSales(dash))}</p>
              <p className="mt-1 text-sm font-extrabold text-muted">{dash.week.receiptCount} فاتورة</p>
              {!!dash.days?.length && (
                <div className="side-pulse">
                  <p className="kicker">اليوم</p>
                  <p className="num mt-1 text-sm font-extrabold">
                    {moneyIq(dash.days.find(d => String(d.day).slice(0, 10) === todayKey())?.salesAmount ?? 0)}
                  </p>
                </div>
              )}
              <p className="mt-1 text-[11px] font-bold text-muted">{weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
              {dash.lastSyncAt && (
                <p className="mt-2 text-[11px] font-bold text-muted">مزامنة {ago(lastSyncMs(dash.lastSyncAt) ?? Date.now())}</p>
              )}
            </div>
          )}
          <NavItems badges={badges} />
          <NavLink to="/watch" className={({ isActive }) => isActive ? 'on' : ''}>المتابعة</NavLink>
          <NavLink to="/products" className={({ isActive }) => isActive ? 'on' : ''}>المنتجات</NavLink>
          <NavLink to="/report" className={({ isActive }) => isActive ? 'on' : ''}>التقرير الكامل</NavLink>
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
              <button type="button" className="icon-btn" aria-label="بحث" onClick={() => setFinder(true)}>
                <IconSearch />
              </button>
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
              <Route path="/cashiers" element={<Cashiers />} />
              <Route path="/floor" element={<Navigate to="/cashiers" replace />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/moves" element={<Moves />} />
              <Route path="/products" element={<Products />} />
              <Route path="/watch" element={<Watch />} />
              <Route path="/report" element={<Report />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>

      <nav className="dock">
        <NavItems badges={badges} />
      </nav>

      <Finder
        open={finder}
        onClose={() => setFinder(false)}
        hits={hits}
        onPick={hit => {
          setFinder(false);
          const next = new URLSearchParams(loc.search);
          if (hit.to === '/moves' || hit.to === '/team' || hit.to === '/cashiers' || hit.to === '/products' || hit.to === '/goals') {
            next.set('q', hit.to === '/goals' ? hit.title.split(' · ')[0] : hit.title);
          }
          else next.delete('q');
          const qs = next.toString();
          nav(qs ? `${hit.to}?${qs}` : hit.to);
        }}
      />

      <Sheet open={profile} title={me?.displayName || 'حسابي'} onClose={() => setProfile(false)}>
        <div className="space-y-3">
          <p className="text-sm font-bold text-muted">الدخول <span className="font-extrabold text-ink">{me?.username}</span></p>
          {dash && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-goal">المبيعات</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(resolveWeekSales(dash))}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-goal">الفواتير</p>
                <p className="num mt-1 text-lg font-extrabold">{dash.week.receiptCount}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-goal">البائعون</p>
                <p className="num mt-1 text-lg font-extrabold">{dash.week.sellerCount}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-goal">الكاشير</p>
                <p className="num mt-1 text-lg font-extrabold">{cashiers.length}</p>
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
