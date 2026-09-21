import type { CartGroupState } from '@/lib/sale';
import { formatNum } from '@/lib/money';

export type CartGroupStats = { count: number; total: number };

export function CartGroupBar({
  groups,
  activeKey,
  stats,
  onSelect,
  onAdd,
  onRemove,
  onPickSalesman,
}: {
  groups: CartGroupState[];
  activeKey: number;
  stats: Map<number, CartGroupStats>;
  onSelect: (key: number) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
  onPickSalesman: (key: number) => void;
}) {
  return (
    <div className="pos-cart-groups">
      <div className="pos-cart-groups-track">
        {groups.map(g => {
          const on = g.key === activeKey;
          const st = stats.get(g.key) ?? { count: 0, total: 0 };
          const empty = st.count === 0;
          const canRemove = groups.length > 1 && empty;

          return (
            <div key={g.key} className={`pos-cart-group-card ${on ? 'is-active' : ''} ${empty ? 'is-empty' : ''}`}>
              <button
                type="button"
                onClick={() => onSelect(g.key)}
                className="pos-cart-group-main"
              >
                <span className="pos-cart-group-badge">م{g.key}</span>
                <span className="pos-cart-group-body">
                  <span className="pos-cart-group-meta num">
                    {st.count > 0 ? (
                      <>{formatNum(st.count)} {st.count === 1 ? 'بند' : 'بنود'}</>
                    ) : (
                      'فارغة — جاهزة للإضافة'
                    )}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onSelect(g.key);
                  onPickSalesman(g.key);
                }}
                className={`pos-cart-group-seller ${g.salesmanName ? 'has-seller' : 'needs-seller'}`}
                title="تعيين بائع للمجموعة"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                </svg>
                <span className="truncate">{g.salesmanName || 'تعيين بائع'}</span>
              </button>

              {canRemove && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemove(g.key); }}
                  className="pos-cart-group-remove"
                  aria-label={`حذف مجموعة ${g.key}`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={onAdd} className="pos-cart-group-add" title="مجموعة جديدة">
        <span aria-hidden>+</span>
        <span className="hidden lg:inline">مجموعة</span>
      </button>
    </div>
  );
}
