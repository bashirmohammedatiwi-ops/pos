import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS } from '@/navigation/routes';
import { useAuth } from '@/auth/AuthContext';
import { formatNum } from '@/api/client';
import { useNavBadges } from '@/hooks/useNavBadges';
import { prefetchRoute } from '@/lib/prefetchNav';
import { userDisplayLabel } from '@/lib/text';
import { ICONS, IconLogout, IconX } from '@/components/icons';

function itemBadge(path: string, holdCount: number, edariWork: number) {
  if (path === '/receipts' && holdCount > 0) return holdCount;
  if (path === '/edari' && edariWork > 0) return edariWork;
  return null;
}

export function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
  onCloseMobile,
  showClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
  showClose?: boolean;
}) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const userLabel = userDisplayLabel(user);
  const { holds: holdCount, unsynced, failed } = useNavBadges();
  const edariWork = unsynced + failed;

  return (
    <aside className={`sidebar-shell flex h-full shrink-0 flex-col ${collapsed ? 'w-[56px]' : 'w-[220px]'}`}>
      <div className={`flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-2 ${collapsed ? 'justify-center' : ''}`}>
        <NavLink
          to="/"
          onClick={onNavigate}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-[11px] font-bold text-white"
          title="لوحة التحكم"
        >
          FOT
        </NavLink>
        {!collapsed && <div className="min-w-0 flex-1 truncate text-[13px] font-bold text-header">لوحة التحكم</div>}
        {showClose ? (
          <button type="button" onClick={onCloseMobile} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" title="إغلاق">
            <IconX size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:inline"
            title={collapsed ? 'توسيع' : 'طي'}
          >
            {collapsed ? '«' : '»'}
          </button>
        )}
      </div>

      <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {NAV_GROUPS.map(group => (
          <div key={group.id} className="mb-2">
            {!collapsed && group.id !== 'home' && (
              <div className="px-2 py-1 text-[10px] font-semibold text-slate-400">{group.label}</div>
            )}
            {group.items.map(item => {
              const badge = itemBadge(item.path, holdCount, edariWork);
              const Ico = ICONS[item.iconKey] ?? ICONS.dashboard;
              const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(`${item.path}/`));
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  title={item.label}
                  onMouseEnter={() => prefetchRoute(item.path)}
                  onClick={onNavigate}
                  className={`mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                    active
                      ? 'bg-brand-50 font-semibold text-brand-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-header'
                  } ${collapsed ? 'justify-center px-1.5' : ''}`}
                >
                  <Ico size={15} />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && badge != null && (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 num">
                      {formatNum(badge)}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-2">
        {!collapsed && userLabel && (
          <div className="mb-2 truncate px-1 text-[12px] text-slate-500" title={userLabel}>
            {userLabel}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            if (window.confirm('تسجيل الخروج من لوحة التحكم؟')) logout();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-slate-600 hover:bg-red-50 hover:text-red-700"
        >
          <IconLogout size={14} />
          {!collapsed && <span>خروج</span>}
        </button>
      </div>
    </aside>
  );
}
