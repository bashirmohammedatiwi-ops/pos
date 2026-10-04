import type { ReactNode } from 'react';
import type { OfferDto } from '@/api/types';
import { OFFER_TYPE, offerTypeLabel } from '@/lib/offers';
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

export function offerTypeMeta(type: number) {
  if (type === OFFER_TYPE.bundle) {
    return {
      label: offerTypeLabel(type),
      short: 'مجموعة',
      Icon: IconShield,
      gradient: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
      stripe: 'from-sky-400 to-blue-700',
      chip: 'bg-sky-50 text-sky-800 ring-sky-200/80',
      iconBg: 'bg-sky-100 text-sky-700',
      glow: 'shadow-[0_8px_24px_rgba(14,165,233,0.22)]',
    };
  }
  if (type === OFFER_TYPE.pricedGroup) {
    return {
      label: offerTypeLabel(type),
      short: 'أسعار',
      Icon: IconTag,
      gradient: 'linear-gradient(135deg, #a78bfa 0%, #6d28d9 100%)',
      stripe: 'from-violet-400 to-purple-800',
      chip: 'bg-violet-50 text-violet-800 ring-violet-200/80',
      iconBg: 'bg-violet-100 text-violet-700',
      glow: 'shadow-[0_8px_24px_rgba(139,92,246,0.22)]',
    };
  }
  return {
    label: offerTypeLabel(type),
    short: 'خصم %',
    Icon: IconPercent,
    gradient: 'linear-gradient(135deg, #34d399 0%, #0b7d5d 100%)',
    stripe: 'from-emerald-400 to-brand-800',
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
    iconBg: 'bg-emerald-100 text-emerald-700',
    glow: 'shadow-[0_8px_24px_rgba(15,159,118,0.22)]',
  };
}

export function OfferTypeBadge({ type, large }: { type: number; large?: boolean }) {
  const meta = offerTypeMeta(type);
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold ring-1 ${meta.chip} ${
        large ? 'px-3 py-1 text-[12px]' : 'px-2 py-0.5 text-[10.5px]'
      }`}
    >
      <Icon size={large ? 14 : 12} />
      {meta.label}
    </span>
  );
}

export function OfferTypeIcon({ type, size = 'md' }: { type: number; size?: 'sm' | 'md' | 'lg' }) {
  const meta = offerTypeMeta(type);
  const Icon = meta.Icon;
  const box = size === 'lg' ? 'h-12 w-12' : size === 'md' ? 'h-9 w-9' : 'h-7 w-7';
  const iconSize = size === 'lg' ? 22 : size === 'md' ? 16 : 13;
  return (
    <span className={`icon-tile shrink-0 ${box} ${meta.iconBg}`}>
      <Icon size={iconSize} />
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: number }) {
  const tone =
    priority >= 200
      ? 'bg-rose-50 text-rose-700 ring-rose-200/80'
      : priority >= 100
        ? 'bg-amber-50 text-amber-800 ring-amber-200/80'
        : 'bg-slate-100 text-slate-600 ring-slate-200/80';
  const label = priority >= 200 ? 'عالية' : priority >= 100 ? 'متوسطة' : 'منخفضة';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 tabular-nums ${tone}`}>
      {label}
      <span className="opacity-70">·</span>
      {priority}
    </span>
  );
}

export function ProductCountBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex min-w-[88px] flex-col gap-1">
      <span className="text-[12px] font-bold tabular-nums text-header">{count.toLocaleString('ar-IQ')}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-l from-brand-400 to-brand-600 transition-all duration-500"
          style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function OfferStatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${
        enabled
          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200/80'
          : 'bg-slate-100 text-slate-500 ring-slate-200/70'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${enabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-slate-400'}`} />
      {enabled ? 'نشط على نقاط البيع' : 'متوقف'}
    </span>
  );
}

export function OffersEmptyIllustration() {
  return (
    <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
      <div className="absolute inset-0 rounded-[28px] bg-gradient-to-br from-brand-100 to-emerald-50" />
      <div className="absolute -left-2 top-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-emerald-100">
        <IconPercent size={18} className="text-emerald-600" />
      </div>
      <div className="absolute -right-1 bottom-1 flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-md ring-1 ring-sky-100">
        <IconShield size={16} className="text-sky-600" />
      </div>
      <div className="relative flex h-14 w-14 items-center justify-center rounded-[20px] bg-white shadow-lg ring-1 ring-violet-100">
        <IconTag size={24} className="text-violet-600" />
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border px-4 py-3.5 transition ${
        accent
          ? 'border-white/20 bg-white/15 text-white backdrop-blur-sm'
          : 'border-slate-200/80 bg-white/90 text-header shadow-sm hover:border-brand-200 hover:shadow-md'
      }`}
    >
      {!accent && icon && (
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          {icon}
        </div>
      )}
      <p className={`text-[11px] font-semibold ${accent ? 'text-white/75' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-1 font-extrabold tabular-nums ${accent ? 'text-[26px] text-white' : 'text-[22px] text-header'}`}>
        {value}
      </p>
      {hint && <p className={`mt-0.5 text-[10px] ${accent ? 'text-white/65' : 'text-slate-400'}`}>{hint}</p>}
    </div>
  );
}
