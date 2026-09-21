import { useMemo, useState } from 'react';
import { money, moneyIq, pct } from '../api';
import { useSeller } from '../store';
import { Bar, Empty, ErrorBox, Sheet, Skeleton } from '../ui';
import { WeekBar } from '../week';
import type { MallRow } from '../api';

type SortKey = 'sales' | 'commission' | 'receipts';

export function Malls() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useSeller();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('sales');
  const [open, setOpen] = useState<MallRow | null>(null);
  const rows = dash?.malls ?? [];

  const list = useMemo(() => {
    const needle = q.trim();
    const filtered = needle
      ? rows.filter(r => r.sectionName.includes(needle) || (r.branchName ?? '').includes(needle))
      : rows;
    return [...filtered].sort((a, b) => {
      if (sort === 'commission') return b.commissionAmount - a.commissionAmount;
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      return b.salesAmount - a.salesAmount;
    });
  }, [rows, q, sort]);

  const totalSales = rows.reduce((s, r) => s + r.salesAmount, 0);
  const totalComm = rows.reduce((s, r) => s + r.commissionAmount, 0);
  const max = Math.max(...list.map(r => sort === 'commission' ? r.commissionAmount : sort === 'receipts' ? r.receiptCount : r.salesAmount), 1);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <header>
        <h1 className="text-[26px] font-extrabold">مولاتي</h1>
        <p className="mt-1 text-sm font-bold text-muted">{rows.length} مول · {moneyIq(totalSales)} · عمولة {moneyIq(totalComm)}</p>
      </header>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث باسم المول" className="field" />
      <div className="flex gap-2">
        {([['sales', 'مبيعات'], ['commission', 'عمولة'], ['receipts', 'فواتير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {loading && !rows.length && <Skeleton />}
      <div className="space-y-3">
        {list.map((r, i) => {
          const share = totalSales > 0 ? (r.salesAmount / totalSales) * 100 : 0;
          const barVal = sort === 'commission' ? r.commissionAmount : sort === 'receipts' ? r.receiptCount : r.salesAmount;
          return (
            <button key={`${r.sectionId}-${r.sectionName}`} type="button" className="card w-full p-4 text-start" onClick={() => setOpen(r)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold text-gold">#{String(i + 1).padStart(2, '0')}</p>
                  <h2 className="text-lg font-extrabold">{r.sectionName}</h2>
                  {r.branchName && <p className="text-sm font-bold text-muted">{r.branchName}</p>}
                </div>
                <p className="text-sm font-extrabold text-muted">{Math.round(share)}%</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Metric label="مبيعات" value={money(r.salesAmount)} />
                <Metric label="عمولة" value={money(r.commissionAmount)} accent />
                <Metric label="فواتير" value={String(r.receiptCount)} />
              </div>
              <div className="mt-3"><Bar value={barVal} max={max} tone={sort === 'commission' ? 'ok' : 'gold'} /></div>
            </button>
          );
        })}
        {!loading && !list.length && <Empty title="لا مبيعات هذا الأسبوع" hint="غيّر الأسبوع أو ابحث باسم مول آخر" />}
      </div>

      <Sheet open={!!open} title={open?.sectionName || 'المول'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-4">
            {open.branchName && <p className="text-sm font-bold text-muted">{open.branchName}</p>}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">المبيعات</p>
                <p className="num mt-1 text-xl font-extrabold">{moneyIq(open.salesAmount)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">العمولة</p>
                <p className="num mt-1 text-xl font-extrabold text-ok">{moneyIq(open.commissionAmount)}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">الفواتير</p>
                <p className="num mt-1 text-xl font-extrabold">{open.receiptCount}</p>
              </div>
              <div className="card p-3.5">
                <p className="text-[11px] font-extrabold text-gold">حصة الأسبوع</p>
                <p className="num mt-1 text-xl font-extrabold">{pct(totalSales ? (open.salesAmount / totalSales) * 100 : 0)}</p>
              </div>
            </div>
            <p className="text-sm font-bold text-muted">
              نسبة العمولة {pct(open.salesAmount ? (open.commissionAmount / open.salesAmount) * 100 : 0)}
              {open.receiptCount ? ` · متوسط الفاتورة ${money(open.salesAmount / open.receiptCount)}` : ''}
            </p>
            <Bar value={open.salesAmount} max={topMaxSafe(rows)} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

function topMaxSafe(rows: MallRow[]) {
  return Math.max(...rows.map(r => r.salesAmount), 1);
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-muted">{label}</div>
      <div className={`num text-base font-extrabold ${accent ? 'text-ok' : ''}`}>{value}</div>
    </div>
  );
}
