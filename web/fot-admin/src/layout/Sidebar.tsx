import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS, type NavItem } from '@/navigation/routes';
import { useAuth } from '@/auth/AuthContext';
import { formatNum } from '@/api/client';
import { useNavBadges } from '@/hooks/useNavBadges';
import { prefetchRoute } from '@/lib/prefetchNav';
import { userDisplayLabel } from '@/lib/text';
import { useConfirm } from '@/components/ui';
import {
  ICONS,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconLogout,
  IconSearch,
  IconStar,
  IconX,
} from '@/components/icons';

const GROUPS_KEY = 'fot_admin_nav_groups';
const FAV_KEY = 'fot_admin_nav_favs';

/** لون مميّز لكل مجموعة — يظهر في أيقونة العنصر النشط والعنوان. */
const GROUP_ACCENT: Record<string, { tile: string; soft: string; text: string; bar: string; dot: string }> = {
  home: { tile: 'bg-brand-600', soft: 'bg-brand-50', text: 'text-brand-800', bar: 'bg-brand-500', dot: 'bg-brand-500' },
  ops: { tile: 'bg-sky-600', soft: 'bg-sky-50', text: 'text-sky-800', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  sales: { tile: 'bg-emerald-600', soft: 'bg-emerald-50', text: 'text-emerald-800', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  people: { tile: 'bg-violet-600', soft: 'bg-violet-50', text: 'text-violet-800', bar: 'bg-violet-500', dot: 'bg-violet-500' },
  system: { tile: 'bg-slate-700', soft: 'bg-slate-100', text: 'text-slate-800', bar: 'bg-slate-500', dot: 'bg-slate-400' },
};

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

type Tip = { label: string; hint?: string; badge?: number; top: number } | null;

export function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
  onCloseMobile,
  showClose,
  onSearch,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
  showClose?: boolean;
  onSearch?: () => void;
}) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const userLabel = userDisplayLabel(user) || 'مدير النظام';
  const { holds: holdCount, unsynced, failed } = useNavBadges();
  const [closed, setClosed] = useState<Set<string>>(() => readSet(GROUPS_KEY));
  const [favs, setFavs] = useState<Set<string>>(() => readSet(FAV_KEY));
  const [tip, setTip] = useState<Tip>(null);

  const groupOfPath = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of NAV_GROUPS) for (const i of g.items) m.set(i.path, g.id);
    return m;
  }, []);

  const favItems = useMemo(
    () => NAV_GROUPS.flatMap(g => g.items).filter(i => favs.has(i.path)),
    [favs],
  );

  function toggleGroup(id: string) {
    setClosed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeSet(GROUPS_KEY, next);
      return next;
    });
  }

  function toggleFav(path: string, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      writeSet(FAV_KEY, next);
      return next;
    });
  }

  function badgeFor(path: string): { n: number; cls: string } | null {
    if (path === '/receipts' && holdCount > 0) return { n: holdCount, cls: 'bg-amber-100 text-amber-800 ring-amber-200' };
    if (path === '/edari' && failed > 0) return { n: failed + unsynced, cls: 'bg-red-100 text-red-700 ring-red-200' };
    if (path === '/edari' && unsynced > 0) return { n: unsynced, cls: 'bg-sky-100 text-sky-800 ring-sky-200' };
    return null;
  }

  async function onLogout() {
    const ok = await confirm({
      title: 'تسجيل الخروج؟',
      message: 'ستحتاج إلى إدخال اسم المستخدم وكلمة المرور للدخول مجدداً.',
      confirmLabel: 'خروج',
      danger: true,
    });
    if (ok) logout();
  }

  function showTip(e: ReactMouseEvent<HTMLElement>, item: { label: string; hint?: string }, badge?: number) {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label: item.label, hint: item.hint, badge, top: r.top + r.height / 2 });
  }

  function renderItem(item: NavItem, groupId: string, keyPrefix = '') {
    const accent = GROUP_ACCENT[groupId] ?? GROUP_ACCENT.system;
    const badge = badgeFor(item.path);
    const Ico = ICONS[item.iconKey] ?? ICONS.dashboard;
    const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(`${item.path}/`));
    const fav = favs.has(item.path);
    return (
      <NavLink
        key={keyPrefix + item.path}
        to={item.path}
        end={item.path === '/'}
        title={collapsed ? undefined : item.hint}
        onMouseEnter={e => {
          prefetchRoute(item.path);
          showTip(e, item, badge?.n);
        }}
        onMouseLeave={() => setTip(null)}
        onFocus={() => prefetchRoute(item.path)}
        onClick={() => {
          setTip(null);
          onNavigate?.();
        }}
        className={`group/item relative flex items-center rounded-xl transition-colors ${
          collapsed ? 'mx-auto mb-1 h-11 w-11 justify-center' : 'mb-0.5 gap-2.5 px-2 py-1.5'
        } ${active ? `${accent.soft} ${accent.text} font-bold` : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'}`}
      >
        {active && !collapsed && <span className={`absolute -right-3 top-2 bottom-2 w-1 rounded-full ${accent.bar}`} />}
        <span
          className={`icon-tile shrink-0 rounded-lg transition ${collapsed ? 'h-9 w-9' : 'h-8 w-8'} ${
            active
              ? `${accent.tile} text-white shadow-[0_4px_10px_-4px_rgba(15,23,42,0.35)]`
              : 'bg-white text-slate-500 ring-1 ring-slate-200/80 group-hover/item:text-slate-800 group-hover/item:ring-slate-300'
          }`}
        >
          <Ico size={collapsed ? 18 : 16} />
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-[13px]">{item.label}</span>}
        {!collapsed && badge && (
          <span className={`rounded-full px-1.5 py-px text-[10.5px] font-bold ring-1 ring-inset num ${badge.cls}`}>{formatNum(badge.n)}</span>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={e => toggleFav(item.path, e)}
            className={`shrink-0 rounded-md p-0.5 transition ${
              fav ? 'text-amber-500' : 'text-slate-300 opacity-0 hover:text-amber-500 group-hover/item:opacity-100'
            }`}
            title={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
            aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
          >
            <IconStar size={13} fill={fav ? 'currentColor' : 'none'} />
          </button>
        )}
        {collapsed && badge && <span className="absolute left-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />}
      </NavLink>
    );
  }

  return (
    <aside
      className={`sidebar-shell relative flex h-full shrink-0 flex-col ${collapsed ? 'w-[76px]' : 'w-[264px]'}`}
      onMouseLeave={() => setTip(null)}
    >
      {/* الشعار */}
      <div className={`flex h-16 shrink-0 items-center gap-2.5 px-3.5 ${collapsed ? 'justify-center' : ''}`}>
        <NavLink
          to="/"
          onClick={onNavigate}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 text-[11px] font-extrabold tracking-wide text-white shadow-[0_8px_18px_-8px_rgba(13,138,103,0.8)]"
          title="الرئيسية"
        >
          FOT
          <span className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
        </NavLink>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-extrabold tracking-tight text-header">FOT POS</p>
            <p className="truncate text-[11px] font-medium text-slate-400">لوحة الإدارة</p>
          </div>
        )}
        {showClose ? (
          <button type="button" onClick={onCloseMobile} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden" title="إغلاق">
            <IconX size={16} />
          </button>
        ) : !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-400 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-700 lg:inline-flex"
            title="تصغير القائمة (Ctrl+B)"
            aria-label="تصغير القائمة"
          >
            <IconChevronRight size={16} />
          </button>
        )}
      </div>

      {/* زر التوسيع في الوضع المصغّر — على حافة القائمة */}
      {collapsed && !showClose && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute -left-3 top-[22px] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-[var(--shadow-lift)] transition hover:border-brand-300 hover:text-brand-700 lg:flex"
          title="توسيع القائمة (Ctrl+B)"
          aria-label="توسيع القائمة"
        >
          <IconChevronLeft size={14} />
        </button>
      )}

      {/* البحث السريع */}
      {onSearch && (
        <div className={`shrink-0 px-3 pb-2 ${collapsed ? 'flex justify-center' : ''}`}>
          <button
            type="button"
            onClick={onSearch}
            onMouseEnter={e => showTip(e, { label: 'بحث وانتقال سريع', hint: 'Ctrl+K' })}
            onMouseLeave={() => setTip(null)}
            title={collapsed ? undefined : 'بحث سريع (Ctrl+K)'}
            className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-[12.5px] text-slate-500 shadow-[var(--shadow-soft)] transition hover:border-brand-300 hover:text-slate-800 ${
              collapsed ? 'h-11 w-11 justify-center' : 'h-10 w-full px-3'
            }`}
          >
            <IconSearch size={15} />
            {!collapsed && (
              <>
                <span className="flex-1 text-right">بحث وانتقال…</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 font-sans text-[10px] font-semibold text-slate-500">Ctrl K</kbd>
              </>
            )}
          </button>
        </div>
      )}

      <nav className={`sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        {/* المفضلة */}
        {favItems.length > 0 && (
          <div className="mb-2">
            {!collapsed ? (
              <p className="mb-1 flex items-center gap-1.5 px-2 pt-1 text-[10.5px] font-bold tracking-wide text-amber-600">
                <IconStar size={11} fill="currentColor" />
                المفضلة
              </p>
            ) : (
              <div className="mx-auto mb-1.5 mt-1 flex h-4 w-8 items-center justify-center text-amber-500"><IconStar size={11} fill="currentColor" /></div>
            )}
            {favItems.map(i => renderItem(i, groupOfPath.get(i.path) ?? 'system', 'fav-'))}
            <div className={`my-2 h-px bg-slate-200/80 ${collapsed ? 'mx-2' : 'mx-1'}`} />
          </div>
        )}

        {NAV_GROUPS.map(group => {
          const isHome = group.id === 'home';
          const accent = GROUP_ACCENT[group.id] ?? GROUP_ACCENT.system;
          const groupActive = group.items.some(i => i.path === pathname || (i.path !== '/' && pathname.startsWith(`${i.path}/`)));
          const isClosed = !collapsed && !isHome && closed.has(group.id) && !groupActive;
          return (
            <div key={group.id} className={isHome ? 'mb-1' : 'mt-2.5'}>
              {!collapsed && !isHome && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                  <span className="flex-1 text-right">{group.label}</span>
                  {isClosed && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] num">{formatNum(group.items.length)}</span>}
                  <IconChevronDown size={13} className={`transition-transform ${isClosed ? 'rotate-90' : ''}`} />
                </button>
              )}
              {collapsed && !isHome && <div className="mx-auto my-2 flex items-center justify-center"><span className={`h-1 w-6 rounded-full ${accent.dot} opacity-40`} /></div>}
              {!isClosed && group.items.map(item => renderItem(item, group.id))}
            </div>
          );
        })}
      </nav>

      {/* المستخدم */}
      <div className={`shrink-0 border-t border-slate-200/80 p-3 ${collapsed ? 'px-2' : ''}`}>
        <div className={`flex items-center gap-2.5 rounded-xl ${collapsed ? 'flex-col' : 'bg-slate-50/80 p-2 ring-1 ring-slate-200/70'}`}>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[12px] font-bold text-white ring-2 ring-white"
            title={userLabel}
          >
            {initials(userLabel)}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12.5px] font-bold text-slate-800">{userLabel}</p>
              <p className="truncate text-[10.5px] text-slate-400">مدير النظام</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => void onLogout()}
            onMouseEnter={e => showTip(e, { label: 'تسجيل الخروج' })}
            onMouseLeave={() => setTip(null)}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            title={collapsed ? undefined : 'تسجيل الخروج'}
            aria-label="تسجيل الخروج"
          >
            <IconLogout size={16} />
          </button>
        </div>
      </div>

      {/* تلميح القائمة المصغّرة — موضع ثابت كي لا يُقص */}
      {collapsed && tip && (
        <div
          className="pointer-events-none fixed z-[80] -translate-y-1/2 animate-fade-in rounded-lg bg-slate-900 px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-pop"
          style={{ top: tip.top, right: 76 + 10 }}
          role="tooltip"
        >
          <span className="flex items-center gap-1.5">
            {tip.label}
            {tip.badge ? <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900 num">{formatNum(tip.badge)}</span> : null}
          </span>
          {tip.hint && <span className="block text-[10.5px] font-normal text-slate-400">{tip.hint}</span>}
        </div>
      )}
    </aside>
  );
}
