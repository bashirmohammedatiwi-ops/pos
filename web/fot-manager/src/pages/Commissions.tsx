import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { moneyIq, weekRange } from '../api';
import { ExportMenu } from '../ExportMenu';
import { useManager, useWeekCompare } from '../store';
import {
  Empty, ErrorBox, Medal, MetricStrip, PageHero, SearchField, Skeleton, WeekCompare,
} from '../ui';
import { WeekPicker } from '../picker';

type Sort = 'commission' | 'sales' | 'receipts';

export function Commissions() {
  const {
    weekStart, weeks, dash, prevDash, paySellers, payKind, setPayKind,
    payTotals, err, loading, reload,
  } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('commission');
  const [hideZero, setHideZero] = useState(true);

  useEffect(() => {
    if (payKind !== 'week') setPayKind('week');
  }, [payKind, setPayKind]);

  const rows = useMemo(() => {
    const list = paySellers.filter(s => {
      if (hideZero && s.commissionAmount <= 0) return false;
      if (q.trim() && !s.name.includes(q.trim())) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'sales') return b.salesAmount - a.salesAmount;
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      return b.commissionAmount - a.commissionAmount;
    });
  }, [paySellers, q, sort, hideZero]);

  const totalComm = payTotals.commission || rows.reduce((s, r) => s + r.commissionAmount, 0);
  const totalSales = payTotals.sales || rows.reduce((s, r) => s + r.salesAmount, 0);
  const week = dash?.week;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading && !rows.length) return <Skeleton rows={6} />;

  return (
    <div className="page-flow fade-up">
      <WeekPicker title="عمولات أسبوع" />

      <PageHero
        kicker="أجور البائعين"
        title="العمولات"
        value={moneyIq(totalComm)}
        hint={week ? weekRange(week.weekStart, week.weekEnd) : undefined}
      >
        <MetricStrip
          items={[
            { label: 'موظفون', value: String(rows.length), tone: 'goal' },
            { label: 'فواتير', value: String(payTotals.receipts), tone: 'ok' },
            { label: 'مبيعات', value: moneyIq(totalSales), tone: 'gold' },
            { label: 'متوسط', value: moneyIq(rows.length ? totalComm / rows.length : 0), tone: 'warn' },
          ]}
        />
        <div className="mt-4"><ExportMenu title="تقرير العمولات" pay /></div>
      </PageHero>

      {compare.cur && compare.prev && (
        <WeekCompare
          cur={compare.cur}
          prev={compare.prev}
          salesDelta={compare.salesDelta}
          receiptDelta={compare.receiptDelta}
        />
      )}

      <section className="people-toolbar card">
        <SearchField value={q} onChange={setQ} placeholder="ابحث بالاسم" />
        <div className="sort-bar">
          {([['commission', 'العمولة'], ['sales', 'المبيعات'], ['receipts', 'الفواتير']] as const).map(([k, label]) => (
            <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
          ))}
          <button type="button" className={hideZero ? 'muted' : 'on muted'} onClick={() => setHideZero(v => !v)}>
            {hideZero ? 'إظهار الجميع' : 'أصحاب العمولة فقط'}
          </button>
        </div>
      </section>

      <div className="leader-list stagger">
        {rows.map((s, i) => (
            <Link
              key={s.salesmanId}
              to={`/team?q=${encodeURIComponent(s.name)}`}
              className="comm-row stat-link card"
            >
              <Medal rank={i + 1} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{s.name}</p>
                <p className="text-xs font-bold text-muted">
                  مبيعات {moneyIq(s.salesAmount)}
                </p>
              </div>
              <div className="text-end">
                <p className="num text-base font-black text-goal">{moneyIq(s.commissionAmount)}</p>
                {prevDash && (() => {
                  const prev = prevDash.sellers.find(x => x.salesmanId === s.salesmanId);
                  return prev && prev.commissionAmount > 0
                    ? <p className="mt-1 text-[10px] font-bold text-muted">سابق {moneyIq(prev.commissionAmount)}</p>
                    : null;
                })()}
              </div>
            </Link>
        ))}
        {!rows.length && (
          <Empty title="لا عمولات في هذا الأسبوع" hint="اضغط على الأسبوع في الأعلى لاختيار أسبوع آخر" />
        )}
      </div>
    </div>
  );
}
