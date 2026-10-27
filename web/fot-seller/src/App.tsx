import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { ago, getSeller, getToken, moneyIq, refreshSession, setSeller, setToken, shownWeekAmount, shownWeekLabel, weekRange } from './api';
import { SellerProvider, useSeller } from './store';
import { Avatar, BrandMark, IconBox, IconGoal, IconHome, IconOut, IconRefresh, IconSearch, Sheet } from './ui';
const Goals = lazy(() => import('./pages/Goals').then(m => ({ default: m.Goals })));
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { AccessGate } from './access';
const Products = lazy(() => import('./pages/Products').then(m => ({ default: m.Products })));
const Brands = lazy(() => import('./pages/Brands').then(m => ({ default: m.Brands })));
import { clearBrandCache, useBrandList } from './brands';

function IconBrand() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

/**
 * وحدات التطبيق — كل ميزة جديدة تُضاف هنا (مسار، اسم، أيقونة، شرط الظهور) فتظهر في القائمة والشريط.
 */
type Module = { to: string; label: string; title: string; icon: () => React.JSX.Element; end?: boolean; visible?: (ctx: { brandCount: number }) => boolean };

const MODULES: Module[] = [
  { to: '/', label: 'أسبوعي', title: 'الأسبوع', icon: IconHome, end: true },
  { to: '/brands', label: 'براندي', title: 'براندي', icon: IconBrand, visible: c => c.brandCount > 0 },
  { to: '/goals', label: 'أهدافي', title: 'الأهداف', icon: IconGoal },
  { to: '/products', label: 'عمولتي', title: 'العمولة', icon: IconBox },
];

const titles: Record<string, string> = Object.fromEntries(MODULES.map(m => [m.to, m.title]));

function NavItems({ badges, brandCount = 0 }: { badges?: Partial<Record<string, number>>; brandCount?: number }) {
  const links = MODULES.filter(m => !m.visible || m.visible({ brandCount }));
  return (
    <>
      {links.map(l => (
        <NavLink key={l.to} to={l.to} end={!!l.end} className={({ isActive }) => isActive ? 'on' : ''}>
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

type Hit = { id: string; title: string; hint: string; to: string };

function Finder({
  open, onClose, hits, onPick,
}: {
  open: boolean; onClose: () => void; hits: Hit[]; onPick: (hit: Hit) => void;
}) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useMemo(() => {
    const needle = q.trim();
    if (!needle) return hits.slice(0, 12);
    return hits.filter(h => h.title.includes(needle) || h.hint.includes(needle)).slice(0, 12);
  }, [hits, q]);

  useEffect(() => { setI(0); }, [q, open]);

  if (!open) return null;
  return (
    <div className="finder-bg" onClick={onClose}>
      <div className="finder" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          className="search-field"
          placeholder="ابحث عن منتج أو هدف أو فاتورة"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(list.length - 1, v + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(0, v - 1)); }
            if (e.key === 'Enter' && list[i]) onPick(list[i]);
          }}
        />
        <div className="finder-list">
          {list.map((hit, idx) => (
            <button key={hit.id} type="button" className={`finder-item ${idx === i ? 'on' : ''}`} onClick={() => onPick(hit)}>
              <span>
                <span className="block font-extrabold">{hit.title}</span>
                <span className="text-xs font-bold text-muted">{hit.hint}</span>
              </span>
            </button>
          ))}
          {!list.length && <p className="px-2 py-6 text-center text-sm font-bold text-muted">لا نتيجة</p>}
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const nav = useNavigate();
  const loc = useLocation();
  const seller = getSeller();
  const { dash, lines, reload, loading, err, updatedAt } = useSeller();
  const badges = useMemo(() => ({
    '/goals': dash?.goals.filter(g => g.percent < 100).length || undefined,
    '/products': lines.length || undefined,
  }), [dash, lines]);
  const { list: brandList } = useBrandList();
  const brandCount = brandList?.length ?? 0;
  const [askOut, setAskOut] = useState(false);
  const [profile, setProfile] = useState(false);
  const [finder, setFinder] = useState(false);
  const [pull, setPull] = useState(0);
  const startY = useRef(0);

  useEffect(() => {
    if (err.includes('انتهت الجلسة')) {
      clearBrandCache();
      setToken(null);
      setSeller(null);
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

  const hits = useMemo<Hit[]>(() => {
    const goals = (dash?.goals ?? []).map(g => ({
      id: `g-${g.ruleId}`,
      title: g.ruleName,
      hint: `هدف · ${Math.round(g.percent)}٪ إنجاز`,
      to: '/goals',
    }));
    const items = lines.slice(0, 80).map(l => ({
      id: `l-${l.id}`,
      title: l.productName,
      hint: `${l.receiptNumber ? `فاتورة #${l.receiptNumber}` : 'فاتورة'} · ${l.quantity} قطعة · ${moneyIq(l.commissionAmount)}`,
      to: '/products',
    }));
    return [...goals, ...items];
  }, [dash, lines]);

  function logout() {
    clearBrandCache();
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
    <div className="app" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="app-body">
        <aside className="side">
          <div className="side-brand">
            <BrandMark />
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.22em] text-gold">DEEMA · TEAM</p>
              <p className="text-sm font-extrabold">{seller?.name || 'البائع'}</p>
            </div>
          </div>
          {dash?.week && (
            <div className="card seller-mini">
              <p className="kicker">{shownWeekLabel(dash.week)}</p>
              <p className="num mt-1 text-xl font-extrabold text-gold">{moneyIq(shownWeekAmount(dash.week))}</p>
              <p className="mt-1 text-sm font-extrabold text-muted">{dash.week.receiptCount} فاتورة</p>
              <p className="mt-1 text-[11px] font-bold text-muted">{weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
            </div>
          )}
          <NavItems badges={badges} brandCount={brandCount} />
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <Avatar name={seller?.name || 'بائع'} onClick={() => setProfile(true)} />
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.22em] text-gold">DEEMA · TEAM</p>
                <p className="text-sm font-extrabold">{titles[loc.pathname] || seller?.name || 'البائع'}</p>
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
            <Suspense fallback={<div className="page-loading" aria-hidden><span /><span /><span /></div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/brands" element={<Brands />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/products" element={<Products />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </main>
        </div>
      </div>

      <nav className="dock">
        <NavItems badges={badges} brandCount={brandCount} />
      </nav>

      <Finder
        open={finder}
        onClose={() => setFinder(false)}
        hits={hits}
        onPick={hit => {
          setFinder(false);
          const next = new URLSearchParams(loc.search);
          if (hit.to === '/products') next.set('q', hit.title);
          else next.delete('q');
          const qs = next.toString();
          nav(qs ? `${hit.to}?${qs}` : hit.to);
        }}
      />

      <Sheet open={profile} title={seller?.name || 'حسابي'} onClose={() => setProfile(false)}>
        <div className="space-y-3">
          <p className="text-sm font-bold text-muted">رقم البائع <span className="num font-extrabold text-ink">{seller?.id}</span></p>
          {dash?.week && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">{shownWeekLabel(dash.week)} {weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(shownWeekAmount(dash.week))}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">الفواتير</p>
                <p className="num mt-1 text-lg font-extrabold">{dash.week.receiptCount}</p>
              </div>
              <div className="card p-3.5 col-span-2">
                <p className="text-[11px] font-extrabold text-gold">لم يُصرف بعد</p>
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
      <AccessGate>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Guard />} />
        </Routes>
      </AccessGate>
    </>
  );
}
