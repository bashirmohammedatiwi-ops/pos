import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum, receiptDisplayNumber, todayIso } from '@/api/client';
import { offerTypeLabel } from '@/lib/offers';
import { NAV_GROUPS } from '@/navigation/routes';
import { useIncentiveAlerts } from '@/hooks/useIncentiveAlerts';
import { ICONS, IconGrid, IconSearch, type IconKey } from '@/components/icons';

type CmdItem = { key: string; iconKey: IconKey; label: string; group: string; hint?: string; path: string; offerId?: number };

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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
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

  const { atRiskCount } = useIncentiveAlerts();

  const items = useMemo<CmdItem[]>(() => {
    const today = todayIso();
    const work: CmdItem[] = [
      { key: 'w-today', iconKey: 'receipts', label: 'فواتير اليوم', group: 'عمل اليوم', path: `/receipts?from=${today}&to=${today}` },
      { key: 'w-holds', iconKey: 'receipts', label: 'فواتير معلّقة', group: 'عمل اليوم', path: '/receipts?hold=1' },
      { key: 'w-edari', iconKey: 'edari', label: 'ترحيل Edari', group: 'عمل اليوم', path: '/edari' },
      { key: 'w-activity', iconKey: 'activity', label: 'حركات الكاشير', group: 'عمل اليوم', path: '/activity' },
      { key: 'w-reports', iconKey: 'reports', label: 'التقارير', group: 'عمل اليوم', path: '/reports' },
      { key: 'w-comm-report', iconKey: 'commissions', label: 'تقرير العمولات', group: 'عمل اليوم', path: '/reports?app=commissions' },
      { key: 'w-target-report', iconKey: 'targets', label: 'تقرير الأهداف', group: 'عمل اليوم', path: '/reports?app=targets' },
      { key: 'w-product-inquiry', iconKey: 'products', label: 'استعلام مادة', group: 'عمل اليوم', path: '/reports?app=product-inquiry' },
      { key: 'w-offer', iconKey: 'offers', label: 'إنشاء عرض', group: 'عمل اليوم', path: '/offers?new=1' },
      { key: 'w-comm', iconKey: 'commissions', label: 'مجاميع العمولة', group: 'عمل اليوم', path: '/commissions' },
      { key: 'w-salesmen', iconKey: 'salesmen', label: 'تقارير البائعين', group: 'عمل اليوم', path: '/salesmen?tab=reports' },
      { key: 'w-targets', iconKey: 'targets', label: 'إدارة الأهداف', group: 'عمل اليوم', path: '/targets' },
    ];
    if (atRiskCount > 0) {
      work.unshift({
        key: 'w-risk',
        iconKey: 'targets',
        label: `أهداف تحتاج متابعة (${formatNum(atRiskCount)})`,
        group: 'عمل اليوم',
        path: '/targets',
      });
    }
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
    const workHits = s
      ? work.filter(i => i.label.includes(term) || i.group.includes(term))
      : work;
    return [...workHits, ...pageHits, ...offers, ...groups, ...targets, ...salesmen, ...cashiers, ...products, ...receipts];
  }, [term, productsQ.data, receiptsQ.data, offersQ.data, cashiersQ.data, groupsQ.data, targetsQ.data, salesmenQ.data, atRiskCount]);

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
    const el = listRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const recents = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('fot_admin_cmd_recent') || '[]') as CmdItem[];
      return Array.isArray(raw) ? raw.slice(0, 5) : [];
    } catch {
      return [];
    }
  }, [open]);

  const searching = term.length >= 2 && (productsQ.isFetching || receiptsQ.isFetching);

  function go(item: CmdItem) {
    if (item.offerId) sessionStorage.setItem('fot_admin_offer', String(item.offerId));
    try {
      const prev = JSON.parse(localStorage.getItem('fot_admin_cmd_recent') || '[]') as CmdItem[];
      const next = [item, ...prev.filter(x => x.key !== item.key)].slice(0, 6);
      localStorage.setItem('fot_admin_cmd_recent', JSON.stringify(next));
    } catch { /* ignore */ }
    nav(item.path);
    onClose();
    setQ('');
  }

  if (!open) return null;

  const groupTints: Record<string, string> = {
    'عمل اليوم': 'bg-brand-50 text-brand-600',
    الصفحات: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <span className="text-slate-400"><IconSearch size={17} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx(i => Math.min(items.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx(i => Math.max(0, i - 1));
              }
              if (e.key === 'Enter' && items[idx]) go(items[idx]);
            }}
            placeholder="صفحة، عرض، كاشير، منتج، أو فاتورة…"
            className="w-full bg-transparent py-4 text-[14.5px] outline-none placeholder:text-slate-400"
          />
          {searching && (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          )}
        </div>
        {!term && recents.length > 0 && (
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="mb-1.5 text-[10px] font-bold text-slate-400">الأخيرة</p>
            <div className="flex flex-wrap gap-1.5">
              {recents.map(r => {
                const Rico = ICONS[r.iconKey] ?? IconGrid;
                return (
                  <button
                    key={`recent-${r.key}`}
                    type="button"
                    onClick={() => go(r)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200"
                  >
                    <Rico size={12} />
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ul ref={listRef} className="max-h-[380px] overflow-y-auto py-1.5">
          {items.map((item, i) => {
            const showGroup = i === 0 || items[i - 1].group !== item.group;
            const Ico = ICONS[item.iconKey] ?? IconGrid;
            const tint = groupTints[item.group] ?? 'bg-slate-100 text-slate-500';
            return (
              <li key={item.key}>
                {showGroup && (
                  <div className="px-4 pb-1 pt-2.5 text-[10px] font-bold tracking-wide text-slate-400">{item.group}</div>
                )}
                <button
                  type="button"
                  onClick={() => go(item)}
                  onMouseEnter={() => setIdx(i)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2 text-right text-[13px] transition ${
                    i === idx ? 'bg-brand-50/80 text-header' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className={`icon-tile h-7 w-7 ${i === idx ? 'bg-brand-100 text-brand-700' : tint}`}>
                    <Ico size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {item.hint && <span className="max-w-[240px] truncate text-[11px] text-slate-400">{item.hint}</span>}
                  {i === idx && (
                    <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-400">↵</kbd>
                  )}
                </button>
              </li>
            );
          })}
          {!items.length && <li className="px-4 py-10 text-center text-[13px] text-slate-400">لا نتائج</li>}
        </ul>
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-slate-400">
          <span>حرفان للبحث في المنتجات والفواتير والعروض والعمولات والأهداف</span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold">Ctrl K</kbd>
            <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold">↑↓</kbd>
            <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold">↵</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
