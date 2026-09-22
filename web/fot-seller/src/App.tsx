import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { ago, getSeller, getToken, moneyIq, refreshSession, setSeller, setToken, weekRange } from './api';
import { SellerProvider, useSeller } from './store';
import { Avatar, BrandMark, IconBox, IconGoal, IconHome, IconOut, IconRefresh, IconSearch, Sheet } from './ui';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Products } from './pages/Products';

const links = [
  { to: '/', label: 'أسبوعي', icon: IconHome, end: true },
  { to: '/goals', label: 'أهدافي', icon: IconGoal },
  { to: '/products', label: 'عمولتي', icon: IconBox },
] as const;

const titles: Record<string, string> = {
  '/': 'الأسبوع',
  '/goals': 'الأهداف',
  '/products': 'العمولة',
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
  const [askOut, setAskOut] = useState(false);
  const [profile, setProfile] = useState(false);
  const [finder, setFinder] = useState(false);
  const [pull, setPull] = useState(0);
  const startY = useRef(0);

  useEffect(() => {
    if (err.includes('انتهت الجلسة')) {
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
              <p className="text-[11px] font-extrabold tracking-[0.22em] text-gold">FOT SELLER</p>
              <p className="text-sm font-extrabold">{seller?.name || 'البائع'}</p>
            </div>
          </div>
          {dash && (
            <div className="card seller-mini">
              <p className="kicker">عمولة الأسبوع</p>
              <p className="num mt-1 text-xl font-extrabold text-gold">{moneyIq(dash.week.commissionAmount)}</p>
              <p className="mt-1 text-sm font-extrabold text-muted">{dash.week.receiptCount} فاتورة</p>
              <p className="mt-1 text-[11px] font-bold text-muted">{weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
            </div>
          )}
          <NavItems badges={badges} />
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <Avatar name={seller?.name || 'بائع'} onClick={() => setProfile(true)} />
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.22em] text-gold">FOT SELLER</p>
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
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/products" element={<Products />} />
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
          if (hit.to === '/products') next.set('q', hit.title);
          else next.delete('q');
          const qs = next.toString();
          nav(qs ? `${hit.to}?${qs}` : hit.to);
        }}
      />

      <Sheet open={profile} title={seller?.name || 'حسابي'} onClose={() => setProfile(false)}>
        <div className="space-y-3">
          <p className="text-sm font-bold text-muted">رقم البائع <span className="num font-extrabold text-ink">{seller?.id}</span></p>
          {dash && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">عمولة {weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
                <p className="num mt-1 text-lg font-extrabold">{moneyIq(dash.week.commissionAmount)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">الفواتير</p>
                <p className="num mt-1 text-lg font-extrabold">{dash.week.receiptCount}</p>
              </div>
              <div className="card p-3.5 col-span-2">
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
