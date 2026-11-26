import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { isNative } from '../config';
import { InstallButton } from './Install';
import { I, Mark, useWide } from './kit';
import { haptic, setThemePref } from './native';
import { Palette, isMac, usePaletteHotkey, type PaletteItem } from './Palette';
import { useLiveState } from './work';

/* ─────────────────────────────────────────────────────────────────────────────
 * القائمة الجانبية للموقع على الحاسبة: التبويبات الرئيسية + كل صفحات «المزيد» مجمّعة.
 * تظهر فقط على شاشة عريضة في المتصفح (web.css)؛ الهاتف والتطبيق يبقيان على الشريط السفلي.
 * فيها: البحث السريع (Ctrl+K)، تبديل المظهر، وحالة الاتصال المباشر.
 * ───────────────────────────────────────────────────────────────────────────── */

export type SideLink = { to: string; label: string; icon: ReactNode; badge?: number };
export type SideGroup = { title: string; items: SideLink[] };

// كلمات إضافية يفهمها البحث السريع لكل صفحة
const KEYWORDS: Record<string, string> = {
  '/': 'رئيسية بداية home',
  '/m': 'رئيسية بداية home',
  '/shift': 'اجازة عطلة جدول دوام طلب',
  '/attend': 'بصمة حضور انصراف استراحة',
  '/chat': 'رسائل محادثة دردشة',
  '/m/chat': 'رسائل محادثة دردشة',
  '/alerts': 'اشعارات تنبيهات',
  '/m/alerts': 'اشعارات تنبيهات',
  '/posts': 'اعلان تعليمات',
  '/m/posts': 'اعلان تعليمات نشر',
  '/m/cash': 'كاش نقد دولار خشن ناعم كي صندوق',
  '/m/invoices': 'فاتورة مبيعات وصل',
  '/m/performance': 'مبيعات تحليل ماركات اداء',
  '/m/reports': 'تقرير حضور غياب تاخير',
  '/m/hours': 'ساعات دوام',
  '/m/attend': 'حضور الان لوحة بصمة',
  '/m/approvals': 'طلبات موافقة اجازات',
  '/m/team': 'موظفين فريق عطل',
  '/m/notify': 'تبليغ ارسال اشعار',
  '/m/networks': 'واي فاي شبكة wifi',
  '/m/more': 'اعدادات حساب صلاحيات خروج',
  '/account': 'حسابي اعدادات خروج رمز',
  '/commission': 'عمولة اهداف',
};

function useThemeMode() {
  const [mode, setMode] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    // يتبع أي تغيير للمظهر (من الحساب، أو البحث السريع)
    const obs = new MutationObserver(() => setMode(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

export function SideNav({ main, groups, user, role, home }: { main: SideLink[]; groups: SideGroup[]; user?: string | null; role?: string; home: string }) {
  const loc = useLocation();
  const all = [...main, ...groups.flatMap(g => g.items)];
  const desktop = useWide(1024);
  const [pk, setPk] = useState(false);
  const live = useLiveState();
  const mode = useThemeMode();
  const openPk = useCallback(() => setPk(true), []);
  usePaletteHotkey(openPk, desktop && !isNative());

  // عنوان التبويب وشارة أيقونة التطبيق المثبّت: مجموع ما ينتظر (التبليغات، المحادثات، الطلبات)
  const total = all.reduce((n, l) => n + (l.badge || 0), 0);
  useEffect(() => {
    if (isNative()) return;
    document.title = total ? `(${total > 99 ? '99+' : total}) ديما · الفريق` : 'ديما · الفريق';
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      void (total ? nav.setAppBadge?.(total) : nav.clearAppBadge?.())?.catch(() => undefined);
    } catch {
      /* غير مدعوم */
    }
  }, [total]);

  const items = useMemo<PaletteItem[]>(
    () => [
      ...main.map(l => ({ id: l.to, label: l.label, group: 'الرئيسية', icon: l.icon, to: l.to, keys: KEYWORDS[l.to], hint: l.badge ? String(l.badge) : undefined })),
      ...groups.flatMap(g => g.items.map(l => ({ id: l.to, label: l.label, group: g.title, icon: l.icon, to: l.to, keys: KEYWORDS[l.to.split('?')[0]], hint: l.badge ? String(l.badge) : undefined }))),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(all.map(l => [l.to, l.label, l.badge]))],
  );

  if (isNative()) return null;
  // الأطول تطابقاً يفوز: /m/cash/flow تتبع «الصناديق» لا «الرئيسية»
  const best = all
    .filter(l => (l.to === home ? loc.pathname === home || loc.pathname === `${home}/` : loc.pathname === l.to || loc.pathname.startsWith(`${l.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const link = (l: SideLink) => (
    <NavLink key={l.to} to={l.to} end={l.to === home} className={`w-side-link ${best === l.to ? 'on' : ''}`} onClick={() => haptic('select')} title={l.label}>
      <span className="ico">{l.icon}</span>
      <span className="lbl">{l.label}</span>
      {!!l.badge && <span className="w-side-badge num">{l.badge > 99 ? '99+' : l.badge}</span>}
    </NavLink>
  );
  const liveText = live === 'on' ? 'متصل مباشرة' : live === 'offline' ? 'لا يوجد إنترنت' : 'يعيد الاتصال…';
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
      <button type="button" className="w-side-search" onClick={openPk} aria-keyshortcuts="Control+K">
        <I.search size={17} />
        <span>ابحث عن صفحة</span>
        <kbd>{isMac() ? '⌘' : 'Ctrl'} K</kbd>
      </button>
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
        <div className="w-side-tools">
          <span className={`w-live ${live}`} role="status" title={live === 'on' ? 'التبليغات والمحادثات تصلك لحظياً' : liveText}>
            <i aria-hidden />
            {liveText}
          </span>
          <button
            type="button"
            className="w-theme"
            onClick={() => {
              haptic('select');
              setThemePref(mode === 'dark' ? 'light' : 'dark');
            }}
            aria-label={mode === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن'}
            title={mode === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن'}
          >
            {mode === 'dark' ? (
              <I.sun size={17} />
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <Palette open={pk} onClose={() => setPk(false)} items={items} />
    </aside>
  );
}
