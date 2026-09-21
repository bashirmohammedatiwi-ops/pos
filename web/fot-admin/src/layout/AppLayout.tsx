import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { ShortcutsHelp } from '@/components/ShortcutsHelp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WorkPills } from '@/components/WorkPills';
import { isDenseListPage, PAGE_META } from '@/navigation/routes';
import { IconMenu, IconRefresh, IconSearch, IconUpload } from '@/components/icons';
import { usePosHub } from '@/hooks/usePosHub';
import { useEdariAutoRefresh } from '@/hooks/useEdariAutoRefresh';
import { useLanConnection } from '@/hooks/useLanConnection';
import { invalidateLiveData, warmupAfterLogin } from '@/lib/queryClient';
import { useNavBadges } from '@/hooks/useNavBadges';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/Toast';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';

export function AppLayout() {
  const { pathname } = useLocation();
  const { token } = useAuth();
  const toast = useToast();
  const meta = PAGE_META[pathname] ?? { title: 'FOT POS', subtitle: '', iconKey: 'dashboard' as const };
  const denseList = isDenseListPage(pathname);
  const qc = useQueryClient();
  const { connected } = usePosHub();
  const { online: apiOnline, reconnecting, apiBase } = useLanConnection();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fot_admin_nav') === '1');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { push: pushToPos, pushing } = usePushPosUpdates();

  useEdariAutoRefresh(apiOnline, connected);

  useEffect(() => {
    if (token) warmupAfterLogin();
  }, [token]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleNav() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('fot_admin_nav', next ? '1' : '0');
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

  const statusLabel = !apiOnline ? (reconnecting ? 'إعادة الاتصال' : 'منقطع') : connected ? 'متصل' : 'الخادم فقط';
  const statusColor = !apiOnline ? (reconnecting ? 'bg-amber-500' : 'bg-red-500') : connected ? 'bg-emerald-500' : 'bg-sky-500';

  return (
    <div className="flex h-full overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <div className={`${mobileOpen ? 'fixed inset-y-0 right-0 z-50 shadow-pop' : 'hidden'} lg:static lg:z-auto lg:block`}>
        <Sidebar
          collapsed={mobileOpen ? false : collapsed}
          onToggle={toggleNav}
          onNavigate={() => setMobileOpen(false)}
          onCloseMobile={() => setMobileOpen(false)}
          showClose={mobileOpen}
        />
      </div>
      <div className="app-canvas flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 lg:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="القائمة"
            >
              <IconMenu size={16} />
            </button>
            <h1 className="truncate text-[14px] font-bold text-header">{meta.title}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <WorkPills className="hidden md:flex" />
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="hidden items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-50 md:flex"
              title="Ctrl+K"
            >
              <IconSearch size={12} />
              بحث
              <kbd className="rounded border border-slate-200 px-1 text-[10px] text-slate-400">Ctrl K</kbd>
            </button>
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 md:hidden"
              aria-label="بحث"
            >
              <IconSearch size={15} />
            </button>
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={refreshing}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              title="تحديث البيانات"
            >
              <IconRefresh size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => void pushToPos()}
              disabled={pushing || !apiOnline}
              className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
              title="إرسال الحسابات والعروض والكتالوج إلى نقاط البيع المتصلة"
            >
              <IconUpload size={13} />
              <span className="hidden sm:inline">{pushing ? 'جاري الرفع…' : 'رفع لنقاط البيع'}</span>
            </button>
            <span
              className="hidden items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 sm:inline-flex"
              title={`الخادم: ${apiBase || '—'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
              <span className="text-[11px] text-slate-600">{statusLabel}</span>
              <EdariLiveDot />
            </span>
          </div>
        </header>
        <WorkPills className="border-b border-slate-200 bg-white px-3 py-1.5 md:hidden" />
        <main
          className={
            denseList
              ? 'flex min-h-0 flex-1 flex-col overflow-auto p-1.5 sm:p-2'
              : 'min-h-0 flex-1 overflow-auto p-3 lg:p-4'
          }
        >
          <div className={denseList ? 'flex min-h-0 flex-1 flex-col' : 'mx-auto max-w-[1400px]'}>
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
    <span className="hidden items-center gap-1 text-[11px] text-slate-500 xl:inline-flex" title={s.liveMessage ?? 'ارتباط الإداري'}>
      <span className="text-slate-300">·</span>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-teal-500' : 'bg-slate-300'}`} />
      إداري
    </span>
  );
}
