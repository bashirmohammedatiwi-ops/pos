import { Link } from 'react-router-dom';
import type { ProductOfferMembershipDto } from '@/api/types';
import { offerTypeLabel } from '@/lib/offers';

export function otherOfferMemberships(
  offers: ProductOfferMembershipDto[] | undefined,
  currentOfferId?: number,
) {
  return (offers ?? []).filter(o =>
    !o.excluded && (currentOfferId == null || o.offerId !== currentOfferId));
}

export function OfferMembershipPills({
  offers,
  currentOfferId,
  mode = 'all',
}: {
  offers?: ProductOfferMembershipDto[];
  currentOfferId?: number;
  mode?: 'all' | 'others';
}) {
  const list = mode === 'others'
    ? otherOfferMemberships(offers, currentOfferId)
    : (offers ?? []);

  if (list.length === 0) return null;

  return (
    <div className="mt-1.5 min-w-0">
      {mode === 'others' && (
        <p className="mb-0.5 text-[10.5px] font-semibold text-amber-700">
          موجود أيضاً في:
        </p>
      )}
      <ul className="flex flex-wrap gap-1">
        {list.map(o => (
          <li key={o.offerId} className="min-w-0 max-w-full">
            <Link
              to={`/offers?id=${o.offerId}`}
              onClick={e => e.stopPropagation()}
              className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition ${
                mode === 'others'
                  ? 'bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100'
                  : o.isWinning
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100'
                    : o.enabled
                      ? 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                      : 'bg-slate-100 text-slate-500 ring-slate-200'
              }`}
              title={`${offerTypeLabel(o.offerType)} — ${o.offerName}`}
            >
              <span className="shrink-0 text-[10.5px] font-medium opacity-70">{offerTypeLabel(o.offerType)}</span>
              <span className="truncate">{o.offerName}</span>
              {!o.enabled && <span className="shrink-0 text-[10.5px] opacity-80">· متوقف</span>}
              {mode === 'all' && o.isWinning && <span className="shrink-0 text-[10.5px]">· المطبَّق</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
