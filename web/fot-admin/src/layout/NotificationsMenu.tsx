import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import { useNavBadges } from '@/hooks/useNavBadges';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { IconAlert, IconBell, IconCheckCircle, IconCloud, IconCoins, IconMonitor, IconReceipt, IconTarget } from '@/components/icons';

type Notice = { key: string; to: string; title: string; detail: string; tone: 'danger' | 'warn' | 'info'; icon: ReactNode };

const TONES = {
  danger: 'bg-red-50 text-red-600',
  warn: 'bg-amber-50 text-amber-600',
  info: 'bg-sky-50 text-sky-600',
};

/** مركز التنبيهات: كل ما يحتاج متابعة في مكان واحد. */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { holds, unsynced, failed, commDue, atRiskCount } = useNavBadges();
  const hubConnected = useSyncStatus();

  const terminalsQ = useQuery({
    queryKey: ['terminal-monitor'],
    queryFn: api.terminalMonitor,
    staleTime: 30_000,
    refetchInterval: hubConnected ? 120_000 : 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const terminals = (terminalsQ.data ?? []).flatMap(g => g.terminals ?? []).filter(t => t.active);
  const offline = terminals.filter(t => !t.isOnline);
  const deadOffline = terminals.reduce((n, t) => n + (t.deadOffline ?? 0), 0);

  const notices: Notice[] = [];
  if (failed > 0)
    notices.push({ key: 'failed', to: '/edari', title: `${formatNum(failed)} فاتورة فشل ترحيلها`, detail: 'راجع سجل الأخطاء في صفحة الأداري وأعد المحاولة', tone: 'danger', icon: <IconCloud size={15} /> });
  if (deadOffline > 0)
    notices.push({ key: 'dead', to: '/terminals', title: `${formatNum(deadOffline)} فاتورة عالقة على الأجهزة`, detail: 'فواتير لم تُرفع بعد عدة محاولات من نقاط البيع', tone: 'danger', icon: <IconAlert size={15} /> });
  if (holds > 0)
    notices.push({ key: 'holds', to: '/receipts?hold=1', title: `${formatNum(holds)} فاتورة معلّقة`, detail: 'فواتير محفوظة على الكاشير ولم تُكمَل', tone: 'warn', icon: <IconReceipt size={15} /> });
  if (offline.length > 0)
    notices.push({ key: 'offline', to: '/terminals', title: `${formatNum(offline.length)} نقطة بيع غير متصلة`, detail: offline.slice(0, 3).map(t => t.name || `#${t.id}`).join('، '), tone: 'warn', icon: <IconMonitor size={15} /> });
  if (unsynced > 0)
    notices.push({ key: 'unsynced', to: '/edari', title: `${formatNum(unsynced)} فاتورة بانتظار الترحيل`, detail: 'ستُرحّل تلقائياً للأداري', tone: 'info', icon: <IconCloud size={15} /> });
  if (atRiskCount > 0)
    notices.push({ key: 'targets', to: '/targets', title: `${formatNum(atRiskCount)} بائع متأخر عن الهدف`, detail: 'أقل من 70% من الهدف اليومي', tone: 'info', icon: <IconTarget size={15} /> });
  if (commDue.count > 0)
    notices.push({ key: 'comm', to: '/commissions', title: `عمولات مستحقة لـ ${formatNum(commDue.count)} بائع`, detail: `المجموع ${formatNum(commDue.total)} IQD`, tone: 'info', icon: <IconCoins size={15} /> });

  const urgent = notices.filter(n => n.tone !== 'info').length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
          open ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        }`}
        title="التنبيهات"
        aria-label="التنبيهات"
        aria-expanded={open}
      >
        <IconBell size={16} />
        {notices.length > 0 && (
          <span
            className={`absolute -left-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white num ${
              urgent ? 'bg-red-500' : 'bg-sky-500'
            }`}
          >
            {notices.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[340px] animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-[13.5px] font-bold text-header">التنبيهات</p>
            <span className="text-[11px] text-slate-500">{notices.length ? `${notices.length} بحاجة لمتابعة` : 'لا شيء جديد'}</span>
          </div>
          {notices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="icon-tile h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600"><IconCheckCircle size={22} /></span>
              <p className="text-[13px] font-bold text-slate-700">كل شيء على ما يرام</p>
              <p className="text-[11.5px] text-slate-500">لا توجد فواتير عالقة أو أجهزة منقطعة.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {notices.map(n => (
                <li key={n.key}>
                  <Link to={n.to} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50">
                    <span className={`icon-tile mt-0.5 h-8 w-8 rounded-lg ${TONES[n.tone]}`}>{n.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-bold text-slate-800">{n.title}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{n.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
