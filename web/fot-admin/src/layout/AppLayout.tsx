import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { NotificationsMenu } from './NotificationsMenu';
import { CommandPalette } from '@/components/CommandPalette';
import { ShortcutsHelp } from '@/components/ShortcutsHelp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WorkPills } from '@/components/WorkPills';
import { isDenseListPage, NAV_GROUPS, PAGE_META } from '@/navigation/routes';
import { ICONS, IconMaximize, IconMenu, IconMinimize, IconRefresh, IconUpload } from '@/components/icons';
import { usePosHub } from '@/hooks/usePosHub';
import { useEdariAutoRefresh } from '@/hooks/useEdariAutoRefresh';
import { useLanConnection } from '@/hooks/useLanConnection';
import { invalidateLiveData, warmupAfterLogin } from '@/lib/queryClient';
import { useNavBadges } from '@/hooks/useNavBadges';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/Toast';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';
import { resetTransientUiState } from '@/lib/uiReset';

function groupOf(pathname: string) {
  return NAV_GROUPS.find(g => g.items.some(i => i.path === pathname));
}

export function AppLayout() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const { token } = useAuth();
  const toast = useToast();
  const meta = PAGE_META[pathname] ?? { title: 'FOT POS', subtitle: '', iconKey: 'dashboard' as const };
  const group = groupOf(pathname);
  const PageIcon = ICONS[meta.iconKey] ?? ICONS.dashboard;
  const denseList = isDenseListPage(pathname);
  const qc = useQueryClient();
  const { connected } = usePosHub();
  const { online: apiOnline, reconnecting, apiBase } = useLanConnection();
  const [collapsed, setCollapsed] = useState(() => {
    // تفضيل المستخدم أولاً؛ وإلا تُطوى القائمة تلقائياً على شاشات اللابتوب الضيقة
    const saved = localStorage.getItem('fot_admin_nav');
    if (saved === '1' || saved === '0') return saved === '1';
    return typeof window !== 'undefined' && window.innerWidth < 1280;
  });
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const { push: pushToPos, pushing } = usePushPosUpdates();

  useEdariAutoRefresh(apiOnline, connected);

  useEffect(() => {
    if (token) warmupAfterLogin();
  }, [token]);

  useEffect(() => {
    setMobileOpen(false);
    setCmdOpen(false);
    resetTransientUiState();
    // كل صفحة تُفتح من أعلاها — منطقة المحتوى نفسها تبقى بين الصفحات فيبقى موضع تمريرها القديم
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    document.title = pathname === '/' ? 'FOT POS — لوحة التحكم' : `${meta.title} · FOT POS`;
  }, [pathname, meta.title]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleNav() {
    setCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('fot_admin_nav', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Ctrl+B يصغّر/يوسّع القائمة الجانبية لتكبير مساحة العمل
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.code !== 'KeyB' && e.key.toLowerCase() !== 'b') return;
      e.preventDefault();
      toggleNav();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  const refreshAll = async () => {
    setRefreshing(true);
    invalidateLiveData();
    qc.invalidateQueries({ queryKey: ['offers'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['hold-receipts'] });
    qc.invalidateQueries({ queryKey: ['report-movement'] });
    qc.invalidateQueries({ queryKey: ['edari-status'] });
    try {
      await qc.refetchQueries({ type: 'active' });
      toast.success('تم تحديث البيانات');
    } catch {
      toast.error('تعذّر التحديث');
    } finally {
      setRefreshing(false);
    }
  };

  const statusLabel = !apiOnline ? (reconnecting ? 'إعادة الاتصال…' : 'غير متصل') : connected ? 'متصل مباشر' : 'متصل بالخادم';
  const statusDot = !apiOnline ? (reconnecting ? 'bg-amber-500' : 'bg-red-500') : connected ? 'bg-emerald-500' : 'bg-sky-500';
  const statusBox = !apiOnline
    ? 'border-red-200 bg-red-50 text-red-700'
    : connected
      ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800'
      : 'border-sky-200 bg-sky-50 text-sky-800';

  return (
    <div className="flex h-full overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 animate-fade-in bg-slate-950/50 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <div className={`${mobileOpen ? 'fixed inset-y-0 right-0 z-50 animate-slide-in-start shadow-pop' : 'hidden'} lg:static lg:z-auto lg:block`}>
        <Sidebar
          collapsed={mobileOpen ? false : collapsed}
          onToggle={toggleNav}
          onNavigate={() => setMobileOpen(false)}
          onCloseMobile={() => setMobileOpen(false)}
          showClose={mobileOpen}
          onSearch={() => setCmdOpen(true)}
        />
      </div>
      <div className="app-canvas flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-3 backdrop-blur lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="القائمة"
            >
              <IconMenu size={17} />
            </button>
            <span className="icon-tile hidden h-9 w-9 rounded-xl bg-brand-50 text-brand-700 sm:inline-flex">
              <PageIcon size={18} />
            </span>
            <div className="min-w-0 leading-tight">
              <nav className="hidden items-center gap-1 text-[11px] text-slate-400 sm:flex" aria-label="مسار التنقل">
                <Link to="/" className="hover:text-brand-700">الرئيسية</Link>
                {group && group.id !== 'home' && (
                  <>
                    <span>/</span>
                    <span>{group.label}</span>
                  </>
                )}
              </nav>
              <h1 className="truncate text-[15px] font-bold text-header" title={meta.subtitle}>{meta.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <WorkPills className="hidden xl:flex" />
            <span
              className={`hidden h-9 items-center gap-2 rounded-lg border px-2.5 text-[11.5px] font-semibold md:inline-flex ${statusBox}`}
              title={`الخادم: ${apiBase || '—'}`}
            >
              <span className="relative flex h-2 w-2">
                {apiOnline && connected && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${statusDot}`} />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${statusDot}`} />
              </span>
              {statusLabel}
              <EdariLiveDot />
            </span>
            <NotificationsMenu />
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={refreshing}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              title="تحديث البيانات"
              aria-label="تحديث البيانات"
            >
              <IconRefresh size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 lg:inline-flex"
              title={fullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
              aria-label="ملء الشاشة"
            >
              {fullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
            </button>
            <button
              type="button"
              onClick={() => void pushToPos()}
              disabled={pushing || !apiOnline}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[12.5px] font-semibold text-white shadow-[0_1px_2px_rgba(13,138,103,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
              title="إرسال الحسابات والعروض والكتالوج إلى نقاط البيع المتصلة"
            >
              <IconUpload size={15} className={pushing ? 'animate-bounce' : ''} />
              <span className="hidden sm:inline">{pushing ? 'جاري الرفع…' : 'رفع لنقاط البيع'}</span>
            </button>
          </div>
        </header>
        {!apiOnline && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            {reconnecting ? 'انقطع الاتصال بالخادم — جاري إعادة الاتصال تلقائياً…' : 'لا يوجد اتصال بالخادم. تحقق من الشبكة أو من تشغيل الخادم.'}
          </div>
        )}
        <WorkPills className="border-b border-slate-200 bg-white px-3 py-1.5 xl:hidden" />
        <main
          ref={mainRef}
          className={
            denseList
              ? 'flex min-h-0 flex-1 flex-col overflow-auto p-2 sm:p-3'
              : 'min-h-0 flex-1 overflow-auto p-3 lg:p-4'
          }
        >
          <div key={pathname} className={`page-enter ${denseList ? 'flex min-h-0 flex-1 flex-col' : 'w-full'}`}>
            <ErrorBoundary compact resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onOpen={() => setCmdOpen(true)} />
      <ShortcutsHelp />
    </div>
  );
}

function EdariLiveDot() {
  const { edariStatus: s } = useNavBadges();
  const stamp = s?.lastHeartbeatAt ?? s?.lastDataPullAt;
  const ageSec = stamp ? Math.max(0, Math.round((Date.now() - new Date(stamp).getTime()) / 1000)) : null;
  const live = !!(s?.autoSyncEnabled && (s.liveWatching || (ageSec != null && ageSec < 45)));
  if (!s) return null;
  return (
    <span className="hidden items-center gap-1.5 xl:inline-flex" title={s.liveMessage ?? 'ارتباط الإداري'}>
      <span className="opacity-30">|</span>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-teal-500' : 'bg-slate-300'}`} />
      الإداري
    </span>
  );
}
