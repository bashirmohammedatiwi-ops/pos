import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  avgTicket, cashierCsv, dayLabel, daysCsv, deltaPct, downloadText, moneyIq, pct,
  resolveWeekSales, teamCsv, todayKey, weekRange, weeksCsv,
} from '../api';
import { cashierShares, sellerShares, weekPace } from '../insights';
import { useManager, useShopInsights, useWeekCompare } from '../store';
import { AreaChart, CommandRail, DayStrip, Delta, Empty, ErrorBox, Medal, SectionHead, Skeleton, useToast } from '../ui';
import { PeriodBar } from '../week';

export function Report() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, cashiers, scopedSellers, scopedCashiers,
    period, periodKind, setPeriodKind, customFrom, customTo, setCustom, periodTotals, payTotals,
    err, loading, reload,
  } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const insights = useShopInsights();
  const toast = useToast();

  const spark = useMemo(() => [...weeks].reverse().map(w => w.salesAmount), [weeks]);
  const weekSales = resolveWeekSales(dash);
  const sellers = useMemo(() => sellerShares(scopedSellers, periodTotals.sales || weekSales || 1), [scopedSellers, periodTotals.sales, weekSales]);
  const cashierRows = useMemo(() => cashierShares(scopedCashiers, periodTotals.sales || weekSales || 1), [scopedCashiers, periodTotals.sales, weekSales]);
  const due = useMemo(() => (dash?.sellers ?? []).filter(s => s.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue), [dash]);
  const prevById = useMemo(() => new Map((prevDash?.sellers ?? []).map(s => [s.salesmanId, s])), [prevDash]);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={7} />;

  const week = dash.week;
  const totalDue = due.reduce((s, x) => s + x.balanceDue, 0);
  const pace = weekPace(week.weekStart, week.weekEnd, weekSales, todayKey());
  const today = insights.days.find(d => d.key === todayKey());

  return (
    <div className="dash fade-up">
      <section className="hero compact command">
        <p className="kicker">تقرير المتابعة · {period.label}</p>
        <h1 className="display text-[28px] font-black">يومي ثم أسبوعي</h1>
        <p className="mt-2 text-sm font-bold text-muted">المدة المعروضة أولاً، ثم مقارنة الأسبوع {weekRange(week.weekStart, week.weekEnd)}</p>
        <div className="hero-pills">
          <span className="pill">{moneyIq(periodTotals.sales)}</span>
          <span className="pill">{periodTotals.receipts} فاتورة</span>
          <span className="pill">متوسط {moneyIq(periodTotals.ticket)}</span>
          <span className="pill">عمولات {moneyIq(payTotals.commission)}</span>
          {compare.prev && <Delta value={compare.salesDelta} />}
        </div>
        <div className="toolbar mt-4">
          <button type="button" className="pill" onClick={() => { downloadText(`أسابيع.csv`, weeksCsv(weeks)); toast('تم تنزيل الأسابيع'); }}>تصدير الأسابيع</button>
          <button type="button" className="pill" onClick={() => { downloadText(`أيام.csv`, daysCsv(insights.days)); toast('تم تنزيل الأيام'); }}>تصدير الأيام</button>
          <button type="button" className="pill" onClick={() => { downloadText(`بائعون.csv`, teamCsv(dash.sellers, weekSales)); toast('تم تنزيل البائعين'); }}>تصدير البائعين</button>
          <button type="button" className="pill" onClick={() => { downloadText(`كاشير.csv`, cashierCsv(cashiers, weekSales)); toast('تم تنزيل الكاشير'); }}>تصدير الكاشير</button>
          <button type="button" className="pill" onClick={() => window.print()}>طباعة</button>
        </div>
      </section>
      <PeriodBar
        weeks={weeks}
        weekStart={weekStart}
        setWeek={setWeek}
        period={period}
        kind={periodKind}
        setKind={setPeriodKind}
        customFrom={customFrom}
        customTo={customTo}
        setCustom={setCustom}
      />
      <CommandRail items={[
        { kicker: period.label, value: moneyIq(periodTotals.sales), hint: `${periodTotals.receipts} فاتورة`, tone: 'gold' },
        { kicker: 'مبيعات الأسبوع', value: moneyIq(weekSales), hint: `${week.receiptCount} فاتورة`, tone: 'goal' },
        { kicker: 'مبيعات اليوم', value: moneyIq(today?.sales ?? 0), hint: today ? `${today.receipts} فاتورة` : 'لا حركة اليوم', tone: 'gold' },
        { kicker: 'إيقاع متوقع', value: moneyIq(pace.projected), hint: `متوسط ${moneyIq(pace.dailyAvg)} / يوم`, tone: 'ok' },
        { kicker: 'تقدم الأسبوع', value: `${Math.round(pace.progress)}٪`, hint: `يوم ${pace.elapsedDays} من ${pace.totalDays}`, tone: 'amber' },
      ]} />

      {insights.days.length > 0 && (
        <section className="card p-4">
          <SectionHead title="إحصاء الأيام" kicker="مبيعات الفواتير لكل يوم" />
          <DayStrip days={insights.days} today={todayKey()} />
          <div className="mt-3 space-y-1 report-cards">
            {insights.days.map(d => (
              <Link key={d.key} to={`/moves?day=${d.key}`} className="rank-row stat-link">
                <div className="min-w-0">
                  <p className="font-extrabold">{d.label}</p>
                  <p className="text-xs font-bold text-muted">{d.receipts} فاتورة · متوسط {moneyIq(avgTicket(d.sales, d.receipts))}</p>
                </div>
                <p className="num font-extrabold">{moneyIq(d.sales)}</p>
              </Link>
            ))}
          </div>
          <div className="desk-table">
            <table>
              <thead>
                <tr>
                  <th>اليوم</th><th>المبيعات</th><th>فواتير</th><th>متوسط</th>
                </tr>
              </thead>
              <tbody>
                {insights.days.map(d => (
                  <tr key={d.key}>
                    <td className="font-extrabold">{d.label || dayLabel(d.key)}</td>
                    <td className="num">{moneyIq(d.sales)}</td>
                    <td className="num">{d.receipts}</td>
                    <td className="num">{moneyIq(avgTicket(d.sales, d.receipts))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {spark.length > 1 && (
        <section className="card p-4">
          <SectionHead title="منحنى الأسابيع" kicker="مبيعات مرفوعة" />
          <AreaChart values={spark} height={120} />
        </section>
      )}

      <section className="card p-4">
        <SectionHead title="جدول الأسابيع" kicker={`${weeks.length} أسبوع`} />
        <div className="space-y-1 report-cards">
          {weeks.map(w => (
            <button
              key={w.weekStart}
              type="button"
              className="rank-row stat-link"
              onClick={() => setWeek(w.isCurrent ? undefined : w.weekStart.slice(0, 10))}
            >
              <div className="min-w-0 text-start">
                <p className="font-extrabold">{w.isCurrent ? 'هذا الأسبوع' : weekRange(w.weekStart, w.weekEnd)}</p>
                <p className="text-xs font-bold text-muted">{w.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(w.salesAmount, w.receiptCount))}</p>
              </div>
              <p className="num font-extrabold">{moneyIq(w.salesAmount)}</p>
            </button>
          ))}
        </div>
        <div className="desk-table">
          <table>
            <thead>
              <tr>
                <th>الأسبوع</th><th>المبيعات</th><th>فواتير</th><th>متوسط</th><th>بائعون</th><th>كاشير</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map(w => (
                <tr key={w.weekStart} onClick={() => setWeek(w.isCurrent ? undefined : w.weekStart.slice(0, 10))}>
                  <td className="font-extrabold">{w.isCurrent ? 'هذا الأسبوع' : weekRange(w.weekStart, w.weekEnd)}</td>
                  <td className="num">{moneyIq(w.salesAmount)}</td>
                  <td className="num">{w.receiptCount}</td>
                  <td className="num">{moneyIq(avgTicket(w.salesAmount, w.receiptCount))}</td>
                  <td className="num">{w.sellerCount}</td>
                  <td className="num">{w.cashierCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <p className="text-xs font-bold text-muted">{pct(s.share)} · {s.receipts} فاتورة</p>
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
              <p className="text-xs font-bold text-muted">{pct(c.share)} · {c.receipts} فاتورة</p>
            </div>
            <div className="text-end">
              <p className="num text-sm font-extrabold">{moneyIq(c.sales)}</p>
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
