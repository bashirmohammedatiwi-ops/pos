import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatNum, receiptDisplayNumber, todayIso } from '@/api/client';
import { offerTypeLabel } from '@/lib/offers';
import { NAV_GROUPS } from '@/navigation/routes';
import { useIncentiveAlerts } from '@/hooks/useIncentiveAlerts';
import { ICONS, IconClock, IconCloud, IconGrid, IconHelp, IconRefresh, IconSearch, IconUpload, IconX, IconZap, type IconKey } from '@/components/icons';
import { Kbd } from '@/components/ui';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';
import { useToast } from '@/components/Toast';

type ActionId = 'help' | 'refresh' | 'push-pos' | 'pull-edari' | 'sync-edari' | 'create-backup';
type CmdItem = {
  key: string;
  iconKey: IconKey;
  label: string;
  group: string;
  hint?: string;
  path: string;
  offerId?: number;
  action?: ActionId;
};

const RECENT_KEY = 'fot_admin_cmd_recent';
const RECENT_GROUP = 'الأخيرة';
const WORK_GROUP = 'عمل اليوم';
const ACTION_GROUP = 'إجراءات سريعة';

const ACTION_ICONS: Record<ActionId, (p: { size?: number }) => ReactNode> = {
  help: IconHelp,
  refresh: IconRefresh,
  'push-pos': IconUpload,
  'pull-edari': IconCloud,
  'sync-edari': IconCloud,
  'create-backup': ICONS.database,
};

/** تمييز جزء النص المطابق لكلمة البحث. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-brand-100/80 px-0.5 text-brand-800">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

function readRecents(): CmdItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as CmdItem[];
    return Array.isArray(raw) ? raw.filter(r => r && typeof r.path === 'string' && !r.action).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function CommandPalette({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { push: pushToPos } = usePushPosUpdates();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [recentsVersion, setRecentsVersion] = useState(0);
  const term = q.trim();

  const productsQ = useQuery({
    queryKey: ['cmd-offer-lookup', term],
    queryFn: () => api.lookupProductOffers(term, 8),
    enabled: open && term.length >= 2,
  });
  const receiptsQ = useQuery({
    queryKey: ['cmd-receipts', term],
    queryFn: () => api.searchReceipts({ page: 1, pageSize: 6, search: term }),
    enabled: open && term.length >= 2,
  });
  const offersQ = useQuery({
    queryKey: ['offers'],
    queryFn: () => api.offers(),
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });
  const cashiersQ = useQuery({
    queryKey: ['cashiers'],
    queryFn: () => api.cashiers(),
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });
  const groupsQ = useQuery({
    queryKey: ['commission-groups'],
    queryFn: api.commissionGroups,
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });
  const salesmenQ = useQuery({
    queryKey: ['salesmen'],
    queryFn: () => api.salesmen(),
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });
  const targetsQ = useQuery({
    queryKey: ['target-rules'],
    queryFn: api.targetRules,
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });
  const terminalsQ = useQuery({
    queryKey: ['terminals'],
    queryFn: api.terminals,
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });
  const sectionsQ = useQuery({
    queryKey: ['sections'],
    queryFn: () => api.sections(false),
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });

  const { atRiskCount } = useIncentiveAlerts();

  const recents = useMemo(() => (open ? readRecents() : []), [open, recentsVersion]);

  const items = useMemo<CmdItem[]>(() => {
    const today = todayIso();
    const work: CmdItem[] = [
      { key: 'w-today', iconKey: 'receipts', label: 'فواتير اليوم', group: WORK_GROUP, path: `/receipts?from=${today}&to=${today}` },
      { key: 'w-holds', iconKey: 'receipts', label: 'فواتير معلّقة', group: WORK_GROUP, path: '/receipts?hold=1' },
      { key: 'w-edari', iconKey: 'edari', label: 'ترحيل Edari', group: WORK_GROUP, path: '/edari' },
      { key: 'w-activity', iconKey: 'activity', label: 'حركات الكاشير', group: WORK_GROUP, path: '/activity' },
      { key: 'w-reports', iconKey: 'reports', label: 'التقارير', group: WORK_GROUP, path: '/reports' },
      { key: 'w-sales-report', iconKey: 'reports', label: 'تقرير المبيعات', group: WORK_GROUP, path: '/reports?app=sales' },
      { key: 'w-offer-sales', iconKey: 'offers', label: 'تقرير مبيعات العروض', group: WORK_GROUP, path: '/reports?app=offer-sales' },
      { key: 'w-comm-report', iconKey: 'commissions', label: 'تقرير العمولات', group: WORK_GROUP, path: '/reports?app=commissions' },
      { key: 'w-target-report', iconKey: 'targets', label: 'تقرير الأهداف', group: WORK_GROUP, path: '/reports?app=targets' },
      { key: 'w-product-inquiry', iconKey: 'products', label: 'استعلام مادة', group: WORK_GROUP, path: '/reports?app=product-inquiry' },
      { key: 'w-seller-receipts', iconKey: 'receipts', label: 'فواتير البائع', group: WORK_GROUP, path: '/reports?app=seller-receipts' },
      { key: 'w-daily-close', iconKey: 'receipts', label: 'تقرير نهاية اليوم', group: WORK_GROUP, path: '/reports?app=daily-close' },
      { key: 'w-compare', iconKey: 'reports', label: 'مقارنة فترتين', group: WORK_GROUP, path: '/reports?app=compare' },
      { key: 'w-peak-hours', iconKey: 'reports', label: 'أوقات الذروة', group: WORK_GROUP, path: '/reports?app=peak-hours' },
      { key: 'w-cashier-perf', iconKey: 'cashiers', label: 'أداء الكاشير', group: WORK_GROUP, path: '/reports?app=cashier-performance' },
      { key: 'w-reorder', iconKey: 'products', label: 'مواد ستنفد قريباً', group: WORK_GROUP, path: '/reports?app=reorder' },
      { key: 'w-slow-movers', iconKey: 'products', label: 'المواد الراكدة', group: WORK_GROUP, path: '/reports?app=slow-movers' },
      { key: 'w-settlement', iconKey: 'commissions', label: 'كشف التسليم', group: WORK_GROUP, path: '/reports?app=settlement' },
      { key: 'w-cashier-voids', iconKey: 'activity', label: 'حذف وإلغاء الكاشير', group: WORK_GROUP, path: '/reports?app=cashier-voids' },
      { key: 'w-offer', iconKey: 'offers', label: 'إنشاء عرض', group: WORK_GROUP, path: '/offers?new=1' },
      { key: 'w-comm', iconKey: 'commissions', label: 'مجاميع العمولة', group: WORK_GROUP, path: '/commissions' },
      { key: 'w-salesmen', iconKey: 'salesmen', label: 'تقارير البائعين', group: WORK_GROUP, path: '/salesmen?tab=reports' },
      { key: 'w-targets', iconKey: 'targets', label: 'إدارة الأهداف', group: WORK_GROUP, path: '/targets' },
      { key: 'w-backups', iconKey: 'database', label: 'النسخ الاحتياطي والاستعادة', group: WORK_GROUP, path: '/backups', hint: 'إنشاء وتنزيل ورفع نسخة .fotbackup' },
    ];
    if (atRiskCount > 0) {
      work.unshift({
        key: 'w-risk',
        iconKey: 'targets',
        label: `أهداف تحتاج متابعة (${formatNum(atRiskCount)})`,
        group: WORK_GROUP,
        path: '/targets',
      });
    }
    const actions: CmdItem[] = [
      { key: 'a-push-pos', iconKey: 'terminals', label: 'رفع التحديثات لنقاط البيع الآن', group: ACTION_GROUP, hint: 'إرسال الكتالوج والعروض والحسابات', path: '', action: 'push-pos' },
      { key: 'a-pull-edari', iconKey: 'edari', label: 'جلب البيانات من الأداري الآن', group: ACTION_GROUP, hint: 'مزامنة المواد والأسعار من Edari', path: '', action: 'pull-edari' },
      { key: 'a-sync-edari', iconKey: 'edari', label: 'ترحيل الفواتير المعلقة إلى الأداري', group: ACTION_GROUP, hint: 'تشغيل دفعة ترحيل فورية', path: '', action: 'sync-edari' },
      { key: 'a-backup', iconKey: 'database', label: 'إنشاء نسخة احتياطية فورية (.fotbackup)', group: ACTION_GROUP, hint: 'حفظ نسخة للنظام في الخزنة', path: '', action: 'create-backup' },
      { key: 'a-refresh', iconKey: 'dashboard', label: 'تحديث بيانات الصفحة', group: ACTION_GROUP, hint: 'إعادة جلب كل البيانات', path: '', action: 'refresh' },
      { key: 'a-help', iconKey: 'dashboard', label: 'اختصارات لوحة المفاتيح', group: ACTION_GROUP, hint: 'F1', path: '', action: 'help' },
    ];
    const pages = NAV_GROUPS.flatMap(g =>
      g.items.map(i => ({ key: i.path, iconKey: i.iconKey, label: i.label, group: g.label, hint: i.hint, path: i.path })),
    );
    const s = term.toLowerCase();
    const pageHits = s
      ? pages.filter(i => i.label.includes(term) || i.group.includes(term) || i.path.toLowerCase().includes(s))
      : pages;
    const products = (productsQ.data ?? []).slice(0, 6).map(p => {
      const winning = p.offers.find(o => o.isWinning) ?? p.offers.find(o => o.enabled) ?? p.offers[0];
      const offerHint = p.offers.length
        ? p.offers.map(o => `${offerTypeLabel(o.offerType)}: ${o.offerName}`).join(' · ')
        : 'بدون عرض';
      return {
        key: `p-${p.id}`,
        iconKey: 'products' as const,
        label: p.name || p.barcode || `#${p.id}`,
        group: 'منتجات',
        hint: offerHint,
        path: winning
          ? `/offers?id=${winning.offerId}`
          : `/products?search=${encodeURIComponent(p.barcode || p.name || '')}`,
        offerId: winning?.offerId,
      };
    });
    const receipts = (receiptsQ.data?.items ?? []).map(r => ({
      key: `r-${r.id}`,
      iconKey: 'receipts' as const,
      label: receiptDisplayNumber(r),
      group: 'فواتير',
      hint: r.cashierName,
      path: `/receipts?highlight=${r.id}`,
    }));
    const offers = (offersQ.data?.items ?? [])
      .filter(o => o.name.toLowerCase().includes(s) || String(o.id).includes(s))
      .slice(0, 5)
      .map(o => ({
        key: `o-${o.id}`,
        iconKey: 'offers' as const,
        label: o.name,
        group: 'عروض',
        hint: o.enabled ? 'نشط' : 'متوقف',
        path: `/offers?id=${o.id}`,
        offerId: o.id,
      }));
    const groups = (groupsQ.data ?? [])
      .filter(g => g.name.toLowerCase().includes(s) || String(g.id).includes(s))
      .slice(0, 5)
      .map(g => ({
        key: `g-${g.id}`,
        iconKey: 'commissions' as const,
        label: g.name,
        group: 'مجموعات العمولة',
        path: `/commissions?group=${g.id}`,
      }));
    const targets = (targetsQ.data ?? [])
      .filter(t => t.name.toLowerCase().includes(s) || String(t.id).includes(s))
      .slice(0, 5)
      .map(t => ({
        key: `t-${t.id}`,
        iconKey: 'targets' as const,
        label: t.name,
        group: 'أهداف',
        hint: t.isActive ? 'نشط' : 'متوقف',
        path: `/targets?id=${t.id}`,
      }));
    const salesmen = (salesmenQ.data?.items ?? [])
      .filter(m => m.name.toLowerCase().includes(s) || String(m.id).includes(s))
      .slice(0, 5)
      .map(m => ({
        key: `sm-${m.id}`,
        iconKey: 'salesmen' as const,
        label: m.name,
        group: 'بائعون',
        path: `/salesmen?tab=reports&salesman=${m.id}`,
      }));
    const cashiers = (cashiersQ.data?.items ?? [])
      .filter(c =>
        c.username.toLowerCase().includes(s)
        || (c.accountName ?? '').toLowerCase().includes(s)
        || (c.sectionName ?? '').toLowerCase().includes(s),
      )
      .slice(0, 5)
      .map(c => ({
        key: `c-${c.id}`,
        iconKey: 'cashiers' as const,
        label: c.accountName || c.username,
        group: 'كاشير',
        hint: c.sectionName ?? undefined,
        path: `/cashiers?highlight=${c.id}`,
      }));
    const terminals = (terminalsQ.data ?? [])
      .filter(t =>
        (t.name ?? '').toLowerCase().includes(s)
        || (t.sectionName ?? '').toLowerCase().includes(s)
        || String(t.id).includes(s),
      )
      .slice(0, 5)
      .map(t => ({
        key: `term-${t.id}`,
        iconKey: 'terminals' as const,
        label: t.name || `نقطة بيع #${t.id}`,
        group: 'نقاط البيع',
        hint: t.sectionName ?? undefined,
        path: '/terminals',
      }));
    const sections = (sectionsQ.data ?? [])
      .filter(sec => sec.name.toLowerCase().includes(s) || String(sec.id).includes(s))
      .slice(0, 5)
      .map(sec => ({
        key: `sec-${sec.id}`,
        iconKey: 'sections' as const,
        label: sec.name,
        group: 'الأقسام',
        hint: sec.state ? 'نشط' : 'متوقف',
        path: '/sections',
      }));
    const workHits = s
      ? work.filter(i => i.label.includes(term) || i.group.includes(term))
      : work;
    const actionHits = s ? actions.filter(i => i.label.includes(term) || (i.hint ?? '').includes(term)) : actions;
    const recentHits = s ? [] : recents.map(r => ({ ...r, key: `recent-${r.key}`, group: RECENT_GROUP }));
    return [
      ...recentHits,
      ...workHits,
      ...pageHits,
      ...offers,
      ...groups,
      ...targets,
      ...salesmen,
      ...cashiers,
      ...terminals,
      ...sections,
      ...products,
      ...receipts,
      ...actionHits,
    ];
  }, [term, recents, productsQ.data, receiptsQ.data, offersQ.data, cashiersQ.data, groupsQ.data, targetsQ.data, salesmenQ.data, terminalsQ.data, sectionsQ.data, atRiskCount]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
        else {
          setQ('');
          setIdx(0);
          onOpen();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onOpen]);

  useEffect(() => {
    if (open) {
      setIdx(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (idx > items.length - 1) setIdx(Math.max(0, items.length - 1));
  }, [items.length, idx]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const searching = term.length >= 2 && (
    productsQ.isFetching || receiptsQ.isFetching || offersQ.isFetching || cashiersQ.isFetching
    || groupsQ.isFetching || salesmenQ.isFetching || targetsQ.isFetching
  );

  function go(item: CmdItem) {
    if (item.action) {
      onClose();
      setQ('');
      if (item.action === 'help') window.setTimeout(() => window.dispatchEvent(new CustomEvent('fot-admin-help')), 0);
      if (item.action === 'refresh') {
        void qc.invalidateQueries();
        toast.success('تم تحديث البيانات');
      }
      if (item.action === 'push-pos') void pushToPos();
      if (item.action === 'pull-edari') {
        void api.syncEdariPull(false)
          .then(r => {
            void qc.invalidateQueries();
            toast.success(r.message || 'تم الجلب من الأداري');
          })
          .catch(e => toast.error(e instanceof Error ? e.message : 'فشل الجلب من الأداري'));
      }
      if (item.action === 'sync-edari') {
        void api.syncEdariReceipts(true, 50)
          .then(r => {
            void qc.invalidateQueries({ queryKey: ['edari-status'] });
            toast.success(r.message || 'تم ترحيل الفواتير');
          })
          .catch(e => toast.error(e instanceof Error ? e.message : 'فشل ترحيل الفواتير'));
      }
      if (item.action === 'create-backup') {
        void api.createBackup({ label: 'نسخة سريعة من البحث', includeCatalog: false })
          .then(b => {
            void qc.invalidateQueries({ queryKey: ['system-backups'] });
            void qc.invalidateQueries({ queryKey: ['system-backup-settings'] });
            toast.success(`تم حفظ النسخة الاحتياطية (${b.fileName})`);
          })
          .catch(e => toast.error(e instanceof Error ? e.message : 'تعذر إنشاء النسخة الاحتياطية'));
      }
      return;
    }
    if (item.offerId) sessionStorage.setItem('fot_admin_offer', String(item.offerId));
    try {
      const base = { ...item, key: item.key.replace(/^recent-/, '') };
      const prev = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as CmdItem[];
      const next = [base, ...(Array.isArray(prev) ? prev : []).filter(x => x.key !== base.key)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    nav(item.path);
    onClose();
    setQ('');
  }

  function clearRecents() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch { /* ignore */ }
    setRecentsVersion(v => v + 1);
    inputRef.current?.focus();
  }

  if (!open) return null;

  const groupCounts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.group] = (acc[it.group] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[80] flex animate-fade-in items-start justify-center bg-slate-900/45 p-4 pt-[9vh] backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[640px] animate-pop-in flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="بحث سريع"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <span className="text-slate-400"><IconSearch size={18} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (q) {
                  setQ('');
                  setIdx(0);
                } else onClose();
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx(i => (items.length ? (i + 1) % items.length : 0));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx(i => (items.length ? (i - 1 + items.length) % items.length : 0));
              }
              if (e.key === 'Home' && !q) {
                e.preventDefault();
                setIdx(0);
              }
              if (e.key === 'End' && !q) {
                e.preventDefault();
                setIdx(Math.max(0, items.length - 1));
              }
              if (e.key === 'Enter' && items[idx]) {
                e.preventDefault();
                go(items[idx]);
              }
            }}
            placeholder="ابحث عن صفحة، عرض، كاشير، بائع، منتج أو فاتورة…"
            className="h-14 w-full bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={items[idx] ? `cmd-item-${idx}` : undefined}
          />
          {searching && (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-label="جاري البحث" />
          )}
          {q ? (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setIdx(0);
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="مسح البحث"
            >
              <IconX size={14} />
            </button>
          ) : (
            <span className="hidden shrink-0 sm:inline-flex"><Kbd>Esc</Kbd></span>
          )}
        </div>

        <div ref={listRef} id="cmd-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {items.map((item, i) => {
            const showGroup = i === 0 || items[i - 1].group !== item.group;
            const active = i === idx;
            const isRecent = item.group === RECENT_GROUP;
            const ActionIco = item.action ? ACTION_ICONS[item.action] : null;
            const Ico = ICONS[item.iconKey] ?? IconGrid;
            return (
              <Fragment key={item.key}>
                {showGroup && (
                  <div className={`flex items-center justify-between px-2.5 pb-1 ${i === 0 ? 'pt-1' : 'pt-3'}`}>
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                      {isRecent && <IconClock size={11} />}
                      {item.group === ACTION_GROUP && <IconZap size={11} />}
                      {item.group}
                      <span className="num font-semibold text-slate-300">{formatNum(groupCounts[item.group] ?? 0)}</span>
                    </span>
                    {isRecent && (
                      <button
                        type="button"
                        onClick={clearRecents}
                        className="rounded px-1.5 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      >
                        مسح
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  id={`cmd-item-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={active}
                  onClick={() => go(item)}
                  onMouseMove={() => {
                    if (!active) setIdx(i);
                  }}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-right text-[13px] transition-colors ${
                    active ? 'bg-brand-50 text-header' : 'text-slate-700'
                  }`}
                >
                  {active && <span className="absolute inset-y-2 right-0 w-0.5 rounded-full bg-brand-500" aria-hidden />}
                  <span
                    className={`icon-tile h-8 w-8 shrink-0 rounded-lg ${
                      active
                        ? 'bg-brand-100 text-brand-700'
                        : item.group === WORK_GROUP
                          ? 'bg-brand-50 text-brand-600'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {ActionIco ? <ActionIco size={15} /> : <Ico size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      <Highlight text={item.label} term={term} />
                    </span>
                    {item.hint && <span className="block truncate text-[11.5px] font-normal text-slate-400">{item.hint}</span>}
                  </span>
                  {active ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-brand-600">
                      {item.action ? 'تنفيذ' : 'فتح'}
                      <Kbd>↵</Kbd>
                    </span>
                  ) : isRecent ? (
                    <span className="shrink-0 text-[11px] text-slate-300">{item.path.split('?')[0]}</span>
                  ) : null}
                </button>
              </Fragment>
            );
          })}
          {!items.length && (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <span className="icon-tile h-12 w-12 rounded-2xl bg-slate-100 text-slate-400"><IconSearch size={22} /></span>
              <p className="text-[13.5px] font-bold text-slate-700">
                {searching ? 'جاري البحث…' : `لا نتائج لـ «${term}»`}
              </p>
              {!searching && (
                <p className="max-w-xs text-[12px] text-slate-500">
                  جرّب كلمة أقصر، أو رقم الفاتورة، أو باركود المنتج.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-slate-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> تنقّل</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> فتح</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd> إغلاق</span>
          </span>
          <span className="hidden sm:inline">
            {term.length === 1
              ? 'اكتب حرفاً آخر للبحث في المنتجات والفواتير…'
              : term.length >= 2
                ? `${formatNum(items.length)} نتيجة`
                : 'حرفان للبحث في المنتجات والفواتير والعروض والعمولات والأهداف'}
          </span>
        </div>
      </div>
    </div>
  );
}
