import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { OfferDto, OfferScopeDto } from '@/api/types';
import { api, formatNum } from '@/api/client';
import { OFFER_TYPE, offerTypeLabel } from '@/lib/offers';
import { Badge, type Tone } from '@/components/ui';
import { IconPercent, IconShield, IconTag } from '@/components/icons';

export type OfferTypeFilter = 'all' | 'percent' | 'bundle' | 'priced';

export function offerTypeKey(type: number): OfferTypeFilter {
  if (type === OFFER_TYPE.bundle) return 'bundle';
  if (type === OFFER_TYPE.pricedGroup) return 'priced';
  return 'percent';
}

export function matchesTypeFilter(offer: OfferDto, filter: OfferTypeFilter) {
  if (filter === 'all') return true;
  return offerTypeKey(offer.type) === filter;
}

/** ألوان هادئة لكل نوع — أيقونة وشارة فقط، بلا تدرّجات. */
export function offerTypeMeta(type: number) {
  if (type === OFFER_TYPE.bundle) {
    return {
      label: offerTypeLabel(type),
      short: 'مشروط',
      Icon: IconShield,
      tone: 'info' as Tone,
      iconBg: 'bg-sky-50 text-sky-700',
      hint: 'خصم يُفعَّل عند وجود أصناف محددة في الفاتورة',
    };
  }
  if (type === OFFER_TYPE.pricedGroup) {
    return {
      label: offerTypeLabel(type),
      short: 'أسعار فردية',
      Icon: IconTag,
      tone: 'violet' as Tone,
      iconBg: 'bg-violet-50 text-violet-700',
      hint: 'لكل منتج سعر أو نسبة مستقلة',
    };
  }
  return {
    label: offerTypeLabel(type),
    short: 'خصم %',
    Icon: IconPercent,
    tone: 'brand' as Tone,
    iconBg: 'bg-brand-50 text-brand-700',
    hint: 'نسبة خصم موحّدة على أشجار أو منتجات',
  };
}

export function OfferTypeBadge({ type }: { type: number; large?: boolean }) {
  const meta = offerTypeMeta(type);
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone}>
      <Icon size={12} />
      {meta.label}
    </Badge>
  );
}

export function OfferTypeIcon({ type, size = 'md' }: { type: number; size?: 'sm' | 'md' | 'lg' }) {
  const meta = offerTypeMeta(type);
  const Icon = meta.Icon;
  const box = size === 'lg' ? 'h-11 w-11' : size === 'md' ? 'h-9 w-9' : 'h-7 w-7';
  const iconSize = size === 'lg' ? 20 : size === 'md' ? 16 : 13;
  return (
    <span className={`icon-tile shrink-0 rounded-xl ${box} ${meta.iconBg}`}>
      <Icon size={iconSize} />
    </span>
  );
}

export function priorityLabel(priority: number) {
  return priority >= 200 ? 'عالية' : priority >= 100 ? 'متوسطة' : 'منخفضة';
}

export function PriorityBadge({ priority }: { priority: number }) {
  const tone: Tone = priority >= 200 ? 'danger' : priority >= 100 ? 'warn' : 'default';
  return (
    <Badge tone={tone} className="num">
      {priorityLabel(priority)} · {priority}
    </Badge>
  );
}

export function ProductCountBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex min-w-[88px] flex-col gap-1">
      <span className="num text-[12px] font-bold text-header">{formatNum(count)}</span>
      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-500"
          style={{ width: `${Math.max(pct, count > 0 ? 6 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/* ── فترة العرض وحالته ── */

export type OfferPeriod = {
  unlimited: boolean;
  fromDate: string | null;
  toDate: string | null;
};

export function periodFromScope(scope: Pick<OfferScopeDto, 'unlimited' | 'fromDate' | 'toDate'>): OfferPeriod {
  return {
    unlimited: scope.unlimited !== false,
    fromDate: scope.fromDate ? scope.fromDate.slice(0, 10) : null,
    toDate: scope.toDate ? scope.toDate.slice(0, 10) : null,
  };
}

/** عدد الأيام المتبقية حتى نهاية العرض (0 = ينتهي اليوم، سالب = انتهى). */
export function daysLeft(period: OfferPeriod | null | undefined): number | null {
  if (!period || period.unlimited || !period.toDate) return null;
  const end = new Date(`${period.toDate}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  return Math.round((endDay.getTime() - today.getTime()) / 86_400_000);
}

export function notStartedYet(period: OfferPeriod | null | undefined) {
  if (!period || period.unlimited || !period.fromDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return period.fromDate > today;
}

export const EXPIRING_SOON_DAYS = 7;

export type OfferLiveState = 'active' | 'off' | 'expired' | 'expiring' | 'scheduled';

export function offerLiveState(enabled: boolean, period: OfferPeriod | null | undefined): OfferLiveState {
  if (!enabled) return 'off';
  const left = daysLeft(period);
  if (left != null && left < 0) return 'expired';
  if (notStartedYet(period)) return 'scheduled';
  if (left != null && left <= EXPIRING_SOON_DAYS) return 'expiring';
  return 'active';
}

export function OfferStatusPill({ enabled, period }: { enabled: boolean; period?: OfferPeriod | null }) {
  const state = offerLiveState(enabled, period);
  const left = daysLeft(period);
  if (state === 'off') return <Badge tone="default" dot>متوقف</Badge>;
  if (state === 'expired') return <Badge tone="danger" dot>منتهي</Badge>;
  if (state === 'scheduled') return <Badge tone="info" dot>مجدول</Badge>;
  if (state === 'expiring') {
    return (
      <Badge tone="warn" dot>
        {left === 0 ? 'ينتهي اليوم' : `ينتهي خلال ${formatNum(left ?? 0)} يوم`}
      </Badge>
    );
  }
  return <Badge tone="ok" dot>نشط</Badge>;
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}

export function periodText(period: OfferPeriod | null | undefined) {
  if (!period) return '—';
  if (period.unlimited) return 'دائم — بدون تاريخ';
  const from = period.fromDate ? fmtDate(period.fromDate) : '…';
  const to = period.toDate ? fmtDate(period.toDate) : '…';
  return `${from} ← ${to}`;
}

/**
 * فترات العروض — الخادم الحديث يرسل التواريخ ضمن قائمة العروض مباشرة؛
 * مع خادم أقدم (بلا الحقل unlimited) تُقرأ من نطاق كل عرض (مخزّنة 5 دقائق).
 */
export function useOfferPeriods(offers: OfferDto[]) {
  const listHasDates = offers.length > 0 && offers[0].unlimited !== undefined;
  const results = useQueries({
    queries: offers.map(o => ({
      queryKey: ['offer-period', o.id],
      queryFn: async () => periodFromScope(await api.offerScope(o.id)),
      staleTime: 5 * 60_000,
      retry: 0,
      enabled: !listHasDates,
    })),
  });
  const key = results.map(r => r.dataUpdatedAt).join(',');
  const loading = !listHasDates && results.some(r => r.isLoading);
  const periods = useMemo(() => {
    const map = new Map<number, OfferPeriod>();
    offers.forEach((o, i) => {
      const d = listHasDates
        ? periodFromScope({ unlimited: o.unlimited ?? true, fromDate: o.fromDate ?? undefined, toDate: o.toDate ?? undefined })
        : results[i]?.data;
      if (d) map.set(o.id, d);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers, key, listHasDates]);
  return { periods, loading };
}

export function OffersEmptyIllustration() {
  return (
    <span className="icon-tile h-14 w-14 rounded-2xl bg-brand-50 text-brand-600">
      <IconPercent size={24} />
    </span>
  );
}
