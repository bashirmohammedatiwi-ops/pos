import { useMemo, useState } from 'react';
import { moneyIq, pieces } from '../api';
import { useManager } from '../store';
import { Empty, ErrorBox, Medal, Skeleton } from '../ui';
import { WeekBar } from '../week';

type Tab = 'cashiers' | 'malls';

export function Floor() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useManager();
  const [tab, setTab] = useState<Tab>('cashiers');

  const cashiers = useMemo(
    () => [...(dash?.cashiers ?? [])].sort((a, b) => b.salesAmount - a.salesAmount),
    [dash],
  );
  const malls = useMemo(
    () => [...(dash?.malls ?? [])].sort((a, b) => b.salesAmount - a.salesAmount),
    [dash],
  );

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">أرض المحل</p>
        <h1 className="display text-[28px] font-black">الكاشير والمولات</h1>
        <p className="mt-2 text-sm font-bold text-muted">أداء كل كاشير وكل مول حسب المبيعات والقطع</p>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <div className="toolbar">
        <button type="button" className={`chip ${tab === 'cashiers' ? 'chip-on' : ''}`} onClick={() => setTab('cashiers')}>الكاشير {cashiers.length}</button>
        <button type="button" className={`chip ${tab === 'malls' ? 'chip-on' : ''}`} onClick={() => setTab('malls')}>المولات {malls.length}</button>
      </div>
      {loading && !dash && <Skeleton />}

      {tab === 'cashiers' && (
        <div className="stack-grid stagger">
          {cashiers.map((c, i) => (
            <article key={`${c.cashierId}-${c.name}`} className="card p-4">
              <div className="flex items-start gap-3">
                <Medal rank={i + 1} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold">{c.name}</h2>
                  <div className="goal-metrics">
                    <div>
                      <p className="text-[11px] font-extrabold text-muted">المبيعات</p>
                      <p className="num mt-1 text-lg font-black">{moneyIq(c.salesAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-extrabold text-muted">العمولة</p>
                      <p className="num mt-1 text-lg font-black text-gold">{moneyIq(c.commissionAmount)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-extrabold text-goal">{pieces(c.pieceCount)} · {c.receiptCount} فاتورة</p>
                </div>
              </div>
            </article>
          ))}
          {!loading && !cashiers.length && <Empty title="لا كاشير هذا الأسبوع" />}
        </div>
      )}

      {tab === 'malls' && (
        <div className="stack-grid stagger">
          {malls.map((m, i) => (
            <article key={`${m.sectionId}-${m.sectionName}`} className="card p-4">
              <div className="flex items-start gap-3">
                <Medal rank={i + 1} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold">{m.sectionName}</h2>
                  {m.branchName && <p className="text-xs font-bold text-muted">{m.branchName}</p>}
                  <div className="goal-metrics">
                    <div>
                      <p className="text-[11px] font-extrabold text-muted">المبيعات</p>
                      <p className="num mt-1 text-lg font-black">{moneyIq(m.salesAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-extrabold text-muted">العمولة</p>
                      <p className="num mt-1 text-lg font-black text-gold">{moneyIq(m.commissionAmount)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-extrabold text-goal">{pieces(m.pieceCount)} · {m.receiptCount} فاتورة</p>
                </div>
              </div>
            </article>
          ))}
          {!loading && !malls.length && <Empty title="لا مولات هذا الأسبوع" />}
        </div>
      )}
    </div>
  );
}
