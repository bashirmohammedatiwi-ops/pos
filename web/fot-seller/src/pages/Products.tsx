import { useMemo, useState } from 'react';
import { commissionLabel } from '../api';
import { useSeller } from '../store';
import { Badge, Empty, ErrorBox, Skeleton } from '../ui';

const PAGE = 40;

export function Products() {
  const { groups, products, err, loading, reload } = useSeller();
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState<number | 'all'>('all');
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => {
    const needle = q.trim();
    return products.filter(p => {
      if (groupId !== 'all' && p.groupId !== groupId) return false;
      if (!needle) return true;
      return `${p.name ?? ''} ${p.barcode ?? ''} ${p.groupName}`.includes(needle);
    });
  }, [products, q, groupId]);

  const visible = list.slice(0, shown);
  const selected = groups.find(g => g.id === groupId);

  if (err && !products.length && !groups.length) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <header>
        <h1 className="text-[26px] font-extrabold">عمولتي</h1>
        <p className="mt-1 text-sm font-bold text-muted">{groups.length} مجموعة · {list.length} منتج</p>
      </header>

      <input
        value={q}
        onChange={e => { setQ(e.target.value); setShown(PAGE); }}
        placeholder="ابحث بالاسم أو الباركود"
        className="field"
      />

      <div className="week-scroll">
        <button type="button" className={`chip ${groupId === 'all' ? 'chip-on' : ''}`} onClick={() => { setGroupId('all'); setShown(PAGE); }}>الكل</button>
        {groups.map(g => (
          <button
            key={g.id}
            type="button"
            className={`chip ${groupId === g.id ? 'chip-on' : ''}`}
            onClick={() => { setGroupId(g.id); setShown(PAGE); }}
          >
            {g.name} · {commissionLabel(g.commissionType, g.commissionValue)}
          </button>
        ))}
      </div>

      {selected && (
        <div className="banner">
          <div>
            <p className="font-extrabold">{selected.name}</p>
            <p className="mt-1 text-sm font-bold text-muted">{selected.productCount} منتج في المجموعة</p>
          </div>
          <Badge tone={selected.commissionType === 'percentage' ? 'gold' : 'ok'}>
            {commissionLabel(selected.commissionType, selected.commissionValue)}
          </Badge>
        </div>
      )}

      {loading && !products.length && <Skeleton />}
      <div className="space-y-2.5">
        {visible.map((p, i) => (
          <article key={`${p.groupId}-${p.barcode || p.articleId || i}`} className="card px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-extrabold leading-6">{p.name || p.barcode || 'منتج'}</h2>
                <p className="mt-1 text-sm font-bold text-muted">{p.groupName}{p.barcode ? ` · ${p.barcode}` : ''}</p>
              </div>
              <Badge tone={p.commissionType === 'percentage' ? 'gold' : 'ok'}>
                {commissionLabel(p.commissionType, p.commissionValue)}
              </Badge>
            </div>
          </article>
        ))}
        {!loading && !list.length && <Empty title="لا مواد مطابقة" hint="جرّب بحثاً آخر أو مجموعة مختلفة" />}
      </div>
      {list.length > shown && (
        <button type="button" className="w-full rounded-2xl bg-paper py-3 font-extrabold" onClick={() => setShown(n => n + PAGE)}>
          عرض المزيد ({list.length - shown})
        </button>
      )}
    </div>
  );
}
