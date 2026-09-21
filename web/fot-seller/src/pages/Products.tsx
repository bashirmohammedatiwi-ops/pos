import { useMemo, useState } from 'react';
import { commissionLabel, moneyIq } from '../api';
import type { CommissionLine } from '../api';
import { CommissionList, CommissionSheet } from '../lines';
import { useSeller } from '../store';
import { ErrorBox, Skeleton } from '../ui';
import { WeekBar } from '../week';

export function Products() {
  const { weekStart, setWeek, dash, weeks, lines, groups, err, loading, reload } = useSeller();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<CommissionLine | null>(null);
  const [showRates, setShowRates] = useState(false);

  const list = useMemo(() => {
    const needle = q.trim();
    if (!needle) return lines;
    return lines.filter(l =>
      l.productName.includes(needle) ||
      (l.groupName ?? '').includes(needle) ||
      (l.mallName ?? '').includes(needle) ||
      String(l.receiptNumber ?? '').includes(needle));
  }, [lines, q]);

  const total = list.reduce((s, l) => s + l.commissionAmount, 0);

  if (err && !dash) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">عمولتك كاملة</p>
        <h1 className="text-[26px] font-extrabold">كل المنتجات</h1>
        <p className="num mt-3 text-[34px] font-extrabold text-gold">{moneyIq(total)}</p>
        <p className="mt-1 text-sm font-bold text-muted">{list.length} حركة هذا الأسبوع — اضغط أي سطر للتفاصيل</p>
      </section>

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالمنتج أو الفاتورة أو المول" className="field" />

      {loading && !lines.length && <Skeleton />}
      <CommissionList lines={list} onOpen={setOpen} />

      {groups.length > 0 && (
        <div>
          <button type="button" className="chip" onClick={() => setShowRates(v => !v)}>
            {showRates ? 'إخفاء النسب المعتمدة' : 'عرض النسب المعتمدة'}
          </button>
          {showRates && (
            <div className="group-mosaic mt-3">
              {groups.map(g => (
                <article key={g.id} className="card group-tile">
                  <p className="truncate text-sm font-extrabold">{g.name}</p>
                  <p className="mt-2 text-xl font-extrabold text-gold">{commissionLabel(g.commissionType, g.commissionValue)}</p>
                  <p className="mt-1 text-[11px] font-bold text-muted">{g.productCount} منتج</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      <CommissionSheet line={open} onClose={() => setOpen(null)} />
    </div>
  );
}
