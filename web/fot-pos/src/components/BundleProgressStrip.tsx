import { useMemo } from 'react';
import { bundleProgress, type BundleOfferRule } from '@/lib/bundleOffers';
import type { CartLine } from '@/lib/sale';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

/**
 * شريط تقدّم العروض المشروطة: يُري الكاشير العروض المفعّلة في الفاتورة
 * والعروض القريبة من التفعيل (كم مادة/قطعة أو قيمة متبقية).
 */
export function BundleProgressStrip({ cart, rules }: { cart: CartLine[]; rules: BundleOfferRule[] }) {
  const list = useMemo(() => bundleProgress(cart, rules).slice(0, 3), [cart, rules]);
  if (!list.length) return null;

  return (
    <div className="pos-bundle-strip" role="status" aria-live="polite">
      {list.map(p => {
        const countLeft = Math.max(0, p.need - p.have);
        const amountLeft = Math.max(0, p.amountNeed - p.amountHave);
        const pct = p.satisfied
          ? 100
          : Math.min(99, Math.round((Math.min(p.have, p.need) / Math.max(1, p.need)) * (p.amountNeed > 0 ? 50 : 100)
            + (p.amountNeed > 0 ? Math.min(1, p.amountHave / p.amountNeed) * 50 : 0)));
        return (
          <div key={p.id} className={`pos-bundle-chip ${p.satisfied ? 'is-on' : ''}`} title={p.name}>
            <span className="pos-bundle-dot" aria-hidden>{p.satisfied ? '✓' : '%'}</span>
            <span className="pos-bundle-text">
              <strong>{p.name}</strong>
              <small>
                {p.satisfied
                  ? 'العرض مفعّل على هذه الفاتورة'
                  : [
                      countLeft > 0 ? `أضف ${fmt(countLeft)} ${p.unit} لتفعيله` : null,
                      amountLeft > 0 ? `قيمة متبقية ${fmt(amountLeft)}` : null,
                    ].filter(Boolean).join(' · ')}
                {!p.satisfied && <span className="num" dir="ltr"> ({fmt(Math.min(p.have, p.need))}/{fmt(p.need)})</span>}
              </small>
            </span>
            <span className="pos-bundle-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}
