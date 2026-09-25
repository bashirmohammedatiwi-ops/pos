import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { ago, getMe, getToken, lastSyncMs, moneyIq, refreshSession, setMe, setToken, weekRange } from './api';
import { lineCashier } from './insights';
import { ManagerProvider, useManager } from './store';
import { Avatar, BrandMark, Finder, IconBag, IconBox, IconCashier, IconComm, IconGoal, IconHome, IconOut, IconRefresh, IconReport, IconSearch, IconTeam, IconWatch, Sheet, type FinderHit } from './ui';
import { Cashiers } from './pages/Cashiers';
import { Commissions } from './pages/Commissions';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Moves } from './pages/Moves';
import { Products } from './pages/Products';
import { Report } from './pages/Report';
import { Team } from './pages/Team';
import { Watch } from './pages/Watch';

const links = [
  { to: '/', label: 'الرئيسية', icon: IconHome, end: true },
  { to: '/team', label: 'بائعون', icon: IconTeam },
  { to: '/cashiers', label: 'كاشير', icon: IconCashier },
  { to: '/commissions', label: 'عمولات', icon: IconComm },
  { to: '/goals', label: 'أهداف', icon: IconGoal },
] as const;

const extra = [
  { to: '/moves', label: 'الفواتير', icon: IconBox },
  { to: '/watch', label: 'المتابعة', icon: IconWatch },
  { to: '/products', label: 'المنتجات', icon: IconBag },
  { to: '/report', label: 'التقرير', icon: IconReport },
] as const;

const titles: Record<string, string> = {
  '/': 'الرئيسية',
  '/team': 'البائعون',
  '/cashiers': 'الكاشير',
  '/goals': 'الأهداف',
  '/commissions': 'العمولات',
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
  const { dash, cashiers, lines, paySellers, periodTotals, period, payTotals, reload, loading, err, updatedAt } = useManager();
  const badges = {
    '/goals': dash?.goals?.filter(g => g.percent < 100).length || undefined,
    '/team': dash?.sellers?.filter(s => s.salesAmount > 0 || s.receiptCount > 0).length || undefined,
    '/cashiers': cashiers.length || undefined,
    '/commissions': payTotals.commission > 0 ? Math.min(99, paySellers.length) : undefined,
  };
  const [askOut, setAskOut] = useState(false);
  const [profile, setProfile] = useState(false);
  const [finder, setFinder] = useState(false);
  const [more, setMore] = useState(false);
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
    try { sessionStorage.removeItem('fot_manager_week'); } catch { /* ignore */ }
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
        <aside className="side side-v5">
          <div className="side-brand">
            <BrandMark />
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.22em] text-goal">FOT MANAGER</p>
              <p className="text-sm font-extrabold">{me?.displayName || 'المدير'}</p>
            </div>
          </div>
          {dash && (
            <div className="card seller-mini">
              <p className="kicker">{period.label}</p>
              <p className="num mt-1 text-xl font-extrabold">{moneyIq(periodTotals.sales)}</p>
              <p className="mt-1 text-xs font-extrabold text-muted">{periodTotals.receipts} فاتورة</p>
              <div className="side-pulse">
                <p className="kicker">عمولات</p>
                <p className="num mt-1 text-sm font-extrabold">{moneyIq(payTotals.commission)}</p>
              </div>
              <p className="mt-2 text-[11px] font-bold text-muted">{weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
              {dash.lastSyncAt && (
                <p className="mt-1 text-[11px] font-bold text-muted">مزامنة {ago(lastSyncMs(dash.lastSyncAt) ?? Date.now())}</p>
              )}
            </div>
          )}
          <p className="side-label">المحل</p>
          <NavItems badges={badges} />
          <p className="side-label">المزيد</p>
          {extra.map(l => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => isActive ? 'on' : ''}>
              <span className="nav-ico"><l.icon /></span>
              {l.label}
            </NavLink>
          ))}
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <Avatar name={me?.displayName || 'مدير'} onClick={() => setProfile(true)} />
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.22em] text-goal">FOT MANAGER</p>
                <p className="text-sm font-extrabold">{titles[loc.pathname] || me?.displayName || 'المدير'}</p>
                {dash && (
                  <p className="top-sub">{period.label} · {moneyIq(periodTotals.sales)}</p>
                )}
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
              <button type="button" className="icon-btn top-logout" aria-label="خروج" onClick={() => setAskOut(true)}>
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
              <Route path="/commissions" element={<Commissions />} />
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
        {links.slice(0, 3).map(l => (
          <NavLink key={l.to} to={l.to} end={'end' in l ? l.end : false} className={({ isActive }) => isActive ? 'on' : ''}>
            <span className="nav-ico">
              <l.icon />
              {!!badges[l.to] && <span className="nav-badge">{badges[l.to]}</span>}
            </span>
            {l.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={more || extra.some(l => l.to === loc.pathname) || loc.pathname === '/goals' || loc.pathname === '/commissions' ? 'on' : ''}
          onClick={() => setMore(true)}
        >
          <span className="nav-ico more-dots" />
          المزيد
        </button>
      </nav>

      <Sheet open={more} title="أقسام المدير" onClose={() => setMore(false)}>
        <div className="phone-more">
          {[...links.slice(3), ...extra].map(l => (
            <button
              key={l.to}
              type="button"
              className={loc.pathname === l.to ? 'on' : ''}
              onClick={() => { setMore(false); nav(l.to); }}
            >
              <span className="nav-ico"><l.icon /></span>
              {l.label}
            </button>
          ))}
        </div>
      </Sheet>

      <Finder
        open={finder}
        onClose={() => setFinder(false)}
        hits={hits}
        onPick={hit => {
          setFinder(false);
          const next = new URLSearchParams(loc.search);
          if (hit.to === '/moves' || hit.to === '/team' || hit.to === '/cashiers' || hit.to === '/products' || hit.to === '/goals') {
            if (hit.to === '/goals') {
              const goal = dash?.goals?.find(g => `${g.salesmanName} · ${g.ruleName}` === hit.title);
              if (goal) {
                next.set('rule', String(goal.ruleId));
                next.set('q', goal.salesmanName);
              } else {
                next.set('q', hit.title.split(' · ')[0]);
              }
            } else {
              next.set('q', hit.title);
            }
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
                <p className="text-[11px] font-extrabold text-goal">{period.label}</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(periodTotals.sales)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-goal">الفواتير</p>
                <p className="num mt-1 text-lg font-extrabold">{periodTotals.receipts}</p>
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

function Boot() {
  useEffect(() => {
    if (getToken()) void refreshSession();
  }, []);
  return null;
}

export function App() {
  return (
    <>
      <Boot />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<Guard />} />
      </Routes>
    </>
  );
}
