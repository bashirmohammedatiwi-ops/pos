import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { isNative } from '../config';
import { InstallButton } from './Install';
import { I, Mark } from './kit';
import { haptic } from './native';

/* ─────────────────────────────────────────────────────────────────────────────
 * القائمة الجانبية للموقع على الحاسبة: التبويبات الرئيسية + كل صفحات «المزيد» مجمّعة.
 * تظهر فقط على شاشة عريضة في المتصفح (web.css)؛ الهاتف والتطبيق يبقيان على الشريط السفلي.
 * ───────────────────────────────────────────────────────────────────────────── */

export type SideLink = { to: string; label: string; icon: ReactNode; badge?: number };
export type SideGroup = { title: string; items: SideLink[] };

export function SideNav({ main, groups, user, role, home }: { main: SideLink[]; groups: SideGroup[]; user?: string | null; role?: string; home: string }) {
  const loc = useLocation();
  if (isNative()) return null;
  const all = [...main, ...groups.flatMap(g => g.items)];
  // الأطول تطابقاً يفوز: /m/cash/flow تتبع «الصناديق» لا «الرئيسية»
  const best = all
    .filter(l => (l.to === home ? loc.pathname === home || loc.pathname === `${home}/` : loc.pathname === l.to || loc.pathname.startsWith(`${l.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const link = (l: SideLink) => (
    <NavLink key={l.to} to={l.to} end={l.to === home} className={`w-side-link ${best === l.to ? 'on' : ''}`} onClick={() => haptic('select')}>
      <span className="ico">{l.icon}</span>
      <span className="lbl">{l.label}</span>
      {!!l.badge && <span className="w-side-badge num">{l.badge > 99 ? '99+' : l.badge}</span>}
    </NavLink>
  );
  return (
    <aside className="w-side" aria-label="القائمة">
      <div className="w-side-brand">
        <span className="w-side-mark">
          <Mark size={24} />
        </span>
        <span>
          <b>ديما الحياة</b>
          <small>تطبيق الفريق</small>
        </span>
      </div>
      {user && (
        <div className="w-side-user">
          <span className="w-side-avatar" aria-hidden>
            <I.user size={18} />
          </span>
          <span>
            <b>{user}</b>
            {role && <small>{role}</small>}
          </span>
        </div>
      )}
      <nav className="w-side-nav">
        {main.map(link)}
        {groups
          .filter(g => g.items.length)
          .map(g => (
            <div key={g.title} className="w-side-group">
              <h3>{g.title}</h3>
              {g.items.map(link)}
            </div>
          ))}
      </nav>
      <div className="w-side-foot">
        <InstallButton variant="side" />
      </div>
    </aside>
  );
}
