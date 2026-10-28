import { useMemo, useState } from 'react';
import { api, type ProductRow } from '../../api';
import { useSeller } from '../../store';
import { Badge, Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, fmt } from '../kit';
import { haptic } from '../native';
import { BackBtn, Lightbox } from '../parts';
import { mediaUrl, useLoad } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * منتجات عمولتي — كل منتج عليه عمولة لك مع صورته وقيمة العمولة،
 * بحث بالاسم أو الباركود، ومبيعاتك منه هذا الأسبوع.
 * ───────────────────────────────────────────────────────────────────────────── */

type Sort = 'value' | 'sold' | 'name';

export function commissionLabel(p: Pick<ProductRow, 'commissionType' | 'commissionValue'>) {
  const pct = /perc|pct|%/i.test(p.commissionType || '');
  return pct ? `${p.commissionValue}% من السعر` : `${fmt(p.commissionValue)} د.ع للقطعة`;
}

function Thumb({ p, big }: { p: ProductRow; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (p.image && !broken)
    return <img className={big ? 't-cat-big' : 't-cat-img'} src={mediaUrl(p.image)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
  const letters = (p.name || '؟').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  return (
    <span className={`${big ? 't-cat-big' : 't-cat-img'} t-cat-ph`} aria-hidden>
      {letters || <I.box size={big ? 40 : 22} />}
    </span>
  );
}

export function Catalog({ back, embedded }: { back?: string; embedded?: boolean }) {
  const { data, err, loading, reload } = useLoad(() => api.products(), []);
  const { lines } = useSeller();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('value');
  const [open, setOpen] = useState<ProductRow | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  // مبيعاتك من كل منتج هذا الأسبوع (بالاسم — السطور لا تحمل الباركود)
  const soldBy = useMemo(() => {
    const m = new Map<string, { qty: number; commission: number }>();
    for (const l of lines) {
      const k = l.productName.trim();
      const r = m.get(k) ?? { qty: 0, commission: 0 };
      r.qty += Number(l.quantity) || 0;
      r.commission += l.commissionAmount;
      m.set(k, r);
    }
    return m;
  }, [lines]);

  const list = useMemo(() => {
    const n = q.trim();
    const rows = (data ?? []).filter(p => !n || (p.name ?? '').includes(n) || (p.barcode ?? '').includes(n));
    const sold = (p: ProductRow) => soldBy.get((p.name ?? '').trim())?.qty ?? 0;
    return [...rows].sort((a, b) =>
      sort === 'name' ? (a.name ?? '').localeCompare(b.name ?? '', 'ar') : sort === 'sold' ? sold(b) - sold(a) : b.commissionValue - a.commissionValue,
    );
  }, [data, q, sort, soldBy]);
  const withImg = (data ?? []).filter(p => p.image).length;

  const body = (
    <>
      <label className="t-search" style={{ marginBottom: 10 }}>
        <I.search />
        <input placeholder="اسم المنتج أو الباركود" value={q} onChange={e => setQ(e.target.value)} inputMode="search" />
        {q && (
          <button type="button" aria-label="مسح" onClick={() => setQ('')}>
            <I.close size={16} />
          </button>
        )}
      </label>
      <Segmented
        items={[
          { id: 'value', label: 'الأعلى عمولة' },
          { id: 'sold', label: 'الأكثر بيعاً' },
          { id: 'name', label: 'بالاسم' },
        ]}
        value={sort}
        onChange={setSort}
      />
      <div style={{ marginTop: 12 }}>
        {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
        {loading && !data ? (
          <Skeleton h={320} r={20} />
        ) : !list.length ? (
          <Empty icon={<I.box size={30} />} title={q ? 'لا نتيجة' : 'لا منتجات بعمولة بعد'} text={q ? 'جرّب اسماً آخر أو جزءاً من الباركود.' : 'عندما تضيف الإدارة منتجات لمجموعات عمولتك تظهر هنا بصورها.'} />
        ) : (
          <div className="t-cat">
            {list.map(p => {
              const s = soldBy.get((p.name ?? '').trim());
              return (
                <button
                  key={`${p.barcode}-${p.articleId}`}
                  type="button"
                  className="t-cat-card press"
                  onClick={() => {
                    haptic('tap');
                    setOpen(p);
                  }}
                >
                  <Thumb p={p} />
                  <div className="t-cat-body">
                    <b>{p.name}</b>
                    <span className="t-cat-val num">{commissionLabel(p)}</span>
                    {s ? <small className="num">بعت {fmt(s.qty)} هذا الأسبوع</small> : <small className="num ltr">{p.barcode}</small>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {data && data.length > 0 && (
        <p className="t-foot">
          {fmt(data.length)} منتج · {fmt(withImg)} بصورة
        </p>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <div style={{ display: 'grid', gap: 14 }}>
            <button type="button" onClick={() => open.image && setViewer(open.image)} style={{ display: 'block' }}>
              <Thumb p={open} big />
            </button>
            <div>
              <h3 style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.4 }}>{open.name}</h3>
              <p className="muted num ltr" style={{ textAlign: 'right', marginTop: 4 }}>
                {open.barcode}
              </p>
            </div>
            <div className="t-stats two">
              <div className="t-stat">
                <span>عمولتك</span>
                <b className="num" style={{ fontSize: 16 }}>
                  {commissionLabel(open)}
                </b>
              </div>
              <div className="t-stat">
                <span>مبيعاتك هذا الأسبوع</span>
                <b className="num">{fmt(soldBy.get((open.name ?? '').trim())?.qty ?? 0)} قطعة</b>
                <em className="num">{fmt(soldBy.get((open.name ?? '').trim())?.commission ?? 0)} د.ع</em>
              </div>
            </div>
            {!open.image && <Badge tone="mute">لم تُرفع صورة لهذا المنتج بعد</Badge>}
          </div>
        )}
      </Sheet>
      {viewer && <Lightbox images={[viewer]} start={0} onClose={() => setViewer(null)} />}
    </>
  );

  if (embedded) return body;
  return (
    <Screen title="منتجات عمولتي" subtitle={data ? `${fmt(data.length)} منتج عليه عمولة لك` : 'مع صورة كل منتج'} onRefresh={reload} start={back ? <BackBtn to={back} /> : undefined}>
      {body}
    </Screen>
  );
}
