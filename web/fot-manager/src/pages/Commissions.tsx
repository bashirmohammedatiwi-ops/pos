import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { commissionCsv, type PeriodKind } from '../period';
import { downloadText, moneyIq, pct, shareOf } from '../api';
import { useManager } from '../store';
import {
  Empty, ErrorBox, Medal, Podium, SearchField, Skeleton, Track, useToast,
} from '../ui';
import { PayPeriodBar } from '../week';

type Sort = 'commission' | 'sales' | 'receipts';

export function Commissions() {
  const {
    paySellers, payPeriod, payKind, setPayKind, customFrom, customTo, setCustom,
    payTotals, periodTotals, err, loading, reload,
  } = useManager();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('commission');
  const [hideZero, setHideZero] = useState(true);

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

  const top = rows.slice(0, 3);
  const totalComm = payTotals.commission || rows.reduce((s, r) => s + r.commissionAmount, 0);
  const totalSales = payTotals.sales || rows.reduce((s, r) => s + r.salesAmount, 0);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading && !rows.length) return <Skeleton rows={6} />;

  return (
    <div className="dash mobile-layout fade-up">
      <section className="hero compact command comm-hero">
        <p className="kicker">أجور البائعين · {payPeriod.label}</p>
        <h1 className="display text-[26px] font-black">العمولات</h1>
        <p className="mt-2 text-sm font-bold text-muted">
          {rows.length} موظفاً · {payTotals.receipts} فاتورة · مبيعات {moneyIq(totalSales)}
        </p>
        <p className="comm-total num">{moneyIq(totalComm)}</p>
        <div className="dash-kpis mt-3">
          <div className="dash-kpi"><p>متوسط عمولة</p><strong className="num">{moneyIq(rows.length ? totalComm / rows.length : 0)}</strong></div>
          <div className="dash-kpi"><p>أعلى عمولة</p><strong className="num">{moneyIq(rows[0]?.commissionAmount ?? 0)}</strong></div>
          <div className="dash-kpi"><p>نسبة من المبيعات</p><strong className="num">{totalSales > 0 ? pct((totalComm / totalSales) * 100) : '—'}</strong></div>
          <div className="dash-kpi"><p>مبيعات المدة</p><strong className="num">{moneyIq(periodTotals.sales)}</strong></div>
        </div>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`عمولات-${payPeriod.from}.csv`, commissionCsv(rows));
            toast('تم تنزيل العمولات');
          }}
        >
          تصدير CSV
        </button>
      </section>

      <section className="panel pay-board">
        <PayPeriodBar
          period={payPeriod}
          kind={payKind}
          setKind={setPayKind as (k: PeriodKind) => void}
          customFrom={customFrom}
          customTo={customTo}
          setCustom={setCustom}
        />
      </section>

      {top.length >= 2 && (
        <section className="panel">
          <p className="kicker mb-3">أعلى ثلاثة</p>
          <Podium
            items={top.map(s => ({
              id: String(s.salesmanId),
              name: s.name,
              value: moneyIq(s.commissionAmount),
              hint: `${s.receiptCount} فاتورة · مبيعات ${moneyIq(s.salesAmount)}`,
            }))}
          />
        </section>
      )}

      <SearchField value={q} onChange={setQ} placeholder="ابحث بالاسم" />
      <div className="sort-bar">
        {([['commission', 'العمولة'], ['sales', 'المبيعات'], ['receipts', 'الفواتير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
        ))}
        <button type="button" className={hideZero ? 'on muted' : 'muted'} onClick={() => setHideZero(v => !v)}>
          {hideZero ? 'إخفاء الصفر' : 'إظهار الكل'}
        </button>
      </div>

      <div className="comm-list stagger">
        {rows.map((s, i) => {
          const share = shareOf(s.commissionAmount, totalComm || 1);
          return (
            <Link
              key={s.salesmanId}
              to={`/team?q=${encodeURIComponent(s.name)}`}
              className="comm-row stat-link"
            >
              <Medal rank={i + 1} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{s.name}</p>
                <p className="text-xs font-bold text-muted">
                  {s.receiptCount} فاتورة · مبيعات {moneyIq(s.salesAmount)} · {pct(share)} من العمولات
                </p>
                <div className="mt-2"><Track value={share} tone="goal" /></div>
              </div>
              <div className="text-end">
                <p className="num text-base font-black text-goal">{moneyIq(s.commissionAmount)}</p>
                {s.goalCount > 0 && (
                  <p className="mt-1 text-[11px] font-extrabold text-muted">{Math.round(s.goalPercent)}٪ أهداف</p>
                )}
              </div>
            </Link>
          );
        })}
        {!rows.length && (
          <Empty title="لا عمولات في هذه المدة" hint="جرّب مدة أوسع أو أزل فلتر الصفر" />
        )}
      </div>
    </div>
  );
}
