import { useMemo, useState } from 'react';
import { moneyIq, moneyK, pct } from '../api';
import { useSeller } from '../store';
import { Bar, Donut, Empty, ErrorBox, Legend, Sheet, Skeleton } from '../ui';
import { WeekBar } from '../week';
import type { MallRow } from '../api';

type SortKey = 'commission' | 'receipts';

export function Malls() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useSeller();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('commission');
  const [open, setOpen] = useState<MallRow | null>(null);
  const rows = dash?.malls ?? [];

  const list = useMemo(() => {
    const needle = q.trim();
    const filtered = needle
      ? rows.filter(r => r.sectionName.includes(needle) || (r.branchName ?? '').includes(needle))
      : rows;
    return [...filtered].sort((a, b) => {
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      return b.commissionAmount - a.commissionAmount;
    });
  }, [rows, q, sort]);

  const totalComm = rows.reduce((s, r) => s + r.commissionAmount, 0);
  const max = Math.max(...list.map(r => sort === 'receipts' ? r.receiptCount : r.commissionAmount), 1);
  const donutItems = [...rows]
    .sort((a, b) => b.commissionAmount - a.commissionAmount)
    .slice(0, 6)
    .map(r => ({ label: r.sectionName, value: r.commissionAmount }));
  const legendItems = donutItems.map(r => ({
    label: r.label,
    value: moneyK(r.value),
    share: totalComm > 0 ? (r.value / totalComm) * 100 : 0,
  }));

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <header>
        <p className="kicker">توزيع العمولة</p>
        <h1 className="text-[26px] font-extrabold">مولاتي</h1>
        <p className="mt-1 text-sm font-bold text-muted">{rows.length} مول · عمولة {moneyIq(totalComm)}</p>
      </header>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      {rows.length > 0 && (
        <section className="card mall-overview">
          <Donut items={donutItems} size={150} center={moneyK(totalComm)} />
          <Legend items={legendItems} />
        </section>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث باسم المول" className="field" />
      <div className="flex gap-2">
        {([['commission', 'عمولة'], ['receipts', 'حركة']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {loading && !rows.length && <Skeleton />}
      <div className="stack-grid">
        {list.map((r, i) => {
          const share = totalComm > 0 ? (r.commissionAmount / totalComm) * 100 : 0;
          const barVal = sort === 'receipts' ? r.receiptCount : r.commissionAmount;
          return (
            <button key={`${r.sectionId}-${r.sectionName}`} type="button" className="card mall-card" onClick={() => setOpen(r)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold text-gold">#{String(i + 1).padStart(2, '0')}</p>
                  <h2 className="text-lg font-extrabold">{r.sectionName}</h2>
                  {r.branchName && <p className="text-sm font-bold text-muted">{r.branchName}</p>}
                </div>
                <p className="text-sm font-extrabold text-goal">{Math.round(share)}%</p>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold text-muted">عمولة</p>
                  <p className="num text-lg font-extrabold text-gold">{moneyIq(r.commissionAmount)}</p>
                </div>
                <div className="text-end">
                  <p className="text-[11px] font-bold text-muted">حركة</p>
                  <p className="num text-lg font-extrabold">{r.receiptCount}</p>
                </div>
              </div>
              <div className="mt-3"><Bar value={barVal} max={max} tone="gold" /></div>
            </button>
          );
        })}
        {!loading && !list.length && <Empty title="لا عمولة هذا الأسبوع" hint="غيّر الأسبوع أو ابحث باسم مول آخر" />}
      </div>

      <Sheet open={!!open} title={open?.sectionName || 'المول'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-4">
            {open.branchName && <p className="text-sm font-bold text-muted">{open.branchName}</p>}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">العمولة</p>
                <p className="num mt-1 text-xl font-extrabold text-ok">{moneyIq(open.commissionAmount)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">حصة العمولة</p>
                <p className="num mt-1 text-xl font-extrabold">{pct(totalComm ? (open.commissionAmount / totalComm) * 100 : 0)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">الحركة</p>
                <p className="num mt-1 text-xl font-extrabold">{open.receiptCount}</p>
              </div>
            </div>
            <Bar value={open.commissionAmount} max={Math.max(...rows.map(r => r.commissionAmount), 1)} />
          </div>
        )}
      </Sheet>
    </div>
  );
}
