import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  avgTicket, cashierCsv, deltaPct, downloadText, moneyIq, pieces, pct,
  teamCsv, weekRange, weeksCsv,
} from '../api';
import { cashierShares, sellerShares } from '../insights';
import { useManager, useWeekCompare } from '../store';
import { AreaChart, Delta, Empty, ErrorBox, Medal, SectionHead, Skeleton, useToast } from '../ui';
import { WeekBar } from '../week';

export function Report() {
  const { weekStart, setWeek, dash, prevDash, weeks, cashiers, err, loading, reload } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const toast = useToast();

  const spark = useMemo(() => [...weeks].reverse().map(w => w.salesAmount || w.commissionAmount), [weeks]);
  const sellers = useMemo(() => sellerShares(dash?.sellers ?? [], dash?.week.salesAmount || 1), [dash]);
  const cashierRows = useMemo(() => cashierShares(cashiers, dash?.week.salesAmount || 1), [cashiers, dash]);
  const due = useMemo(() => (dash?.sellers ?? []).filter(s => s.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue), [dash]);
  const prevById = useMemo(() => new Map((prevDash?.sellers ?? []).map(s => [s.salesmanId, s])), [prevDash]);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={7} />;

  const week = dash.week;
  const totalDue = due.reduce((s, x) => s + x.balanceDue, 0);

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">تقرير المتابعة</p>
        <h1 className="display text-[28px] font-black">الأسابيع والأيقونات</h1>
        <p className="mt-2 text-sm font-bold text-muted">أسبوع {weekRange(week.weekStart, week.weekEnd)} · مقارنة كاملة لكل بائع وكاشير</p>
        <div className="hero-pills">
          <span className="pill">{moneyIq(week.salesAmount)}</span>
          <span className="pill">{moneyIq(week.commissionAmount)}</span>
          <span className="pill">{pieces(week.pieceCount)}</span>
          {compare.prev && <Delta value={compare.salesDelta} />}
        </div>
        <div className="toolbar mt-4">
          <button type="button" className="pill" onClick={() => { downloadText(`أسابيع.csv`, weeksCsv(weeks)); toast('تم تنزيل الأسابيع'); }}>تصدير الأسابيع</button>
          <button type="button" className="pill" onClick={() => { downloadText(`بائعون.csv`, teamCsv(dash.sellers, week.salesAmount)); toast('تم تنزيل البائعين'); }}>تصدير البائعين</button>
          <button type="button" className="pill" onClick={() => { downloadText(`كاشير.csv`, cashierCsv(cashiers, week.salesAmount)); toast('تم تنزيل الكاشير'); }}>تصدير الكاشير</button>
          <button type="button" className="pill" onClick={() => window.print()}>طباعة</button>
        </div>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      {spark.length > 1 && (
        <section className="card p-4">
          <SectionHead title="منحنى الأسابيع" kicker="مبيعات مرفوعة" />
          <AreaChart values={spark} height={120} />
        </section>
      )}

      <section className="desk-table card" style={{ display: 'block' }}>
        <SectionHead title="جدول الأسابيع" kicker={`${weeks.length} أسبوع`} />
        <table>
          <thead>
            <tr>
              <th>الأسبوع</th><th>المبيعات</th><th>العمولة</th><th>القطع</th><th>فواتير</th><th>بائعون</th><th>كاشير</th><th>متوسط</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.weekStart} onClick={() => setWeek(w.isCurrent ? undefined : w.weekStart.slice(0, 10))}>
                <td className="font-extrabold">{w.isCurrent ? 'هذا الأسبوع' : weekRange(w.weekStart, w.weekEnd)}</td>
                <td className="num">{moneyIq(w.salesAmount)}</td>
                <td className="num text-gold">{moneyIq(w.commissionAmount)}</td>
                <td className="num">{Math.round(w.pieceCount)}</td>
                <td className="num">{w.receiptCount}</td>
                <td className="num">{w.sellerCount}</td>
                <td className="num">{w.cashierCount}</td>
                <td className="num">{moneyIq(avgTicket(w.salesAmount, w.receiptCount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-4">
        <SectionHead title="البائع مقابل الأسبوع السابق" kicker="تغير المبيعات" to="/team" link="الفريق" />
        {sellers.length ? sellers.map((s, i) => {
          const prev = prevById.get(Number(s.id));
          const change = prev ? deltaPct(s.sales, prev.salesAmount) : 0;
          return (
            <Link key={s.id} to={`/team?q=${encodeURIComponent(s.name)}`} className="rank-row stat-link">
              <Medal rank={i + 1} />
              <div className="min-w-0">
                <p className="truncate font-extrabold">{s.name}</p>
                <p className="text-xs font-bold text-muted">{pct(s.share)} · {pieces(s.pieces)} · {s.receipts} فاتورة</p>
              </div>
              <div className="text-end">
                <p className="num text-sm font-extrabold">{moneyIq(s.sales)}</p>
                {prev ? <Delta value={change} /> : <p className="text-xs font-bold text-muted">لا سابق</p>}
              </div>
            </Link>
          );
        }) : <Empty title="لا بائعون" />}
      </section>

      <section className="card p-4">
        <SectionHead title="الكاشير" kicker="حصة كل واحد" to="/cashiers" link="التفاصيل" />
        {cashierRows.length ? cashierRows.map((c, i) => (
          <Link key={c.id} to={`/cashiers?q=${encodeURIComponent(c.name)}`} className="rank-row stat-link">
            <Medal rank={i + 1} />
            <div className="min-w-0">
              <p className="truncate font-extrabold">{c.name}</p>
              <p className="text-xs font-bold text-muted">{pct(c.share)} · {pieces(c.pieces)} · {c.receipts} فاتورة</p>
            </div>
            <div className="text-end">
              <p className="num text-sm font-extrabold">{moneyIq(c.sales)}</p>
              <p className="num text-xs font-extrabold text-gold">{moneyIq(c.commission)}</p>
            </div>
          </Link>
        )) : <Empty title="لا كاشير" hint="تظهر الأسماء بعد مزامنة لوحة التحكم" />}
      </section>

      {due.length > 0 && (
        <section className="card p-4">
          <SectionHead title="مستحقات الفريق" kicker={moneyIq(totalDue)} />
          {due.map((s, i) => (
            <div key={s.salesmanId} className="rank-row">
              <Medal rank={i + 1} />
              <p className="font-extrabold">{s.name}</p>
              <p className="num font-extrabold">{moneyIq(s.balanceDue)}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
