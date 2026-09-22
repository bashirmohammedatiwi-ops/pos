import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  avgTicket, cashierCsv, daysCsv, deltaPct, downloadText, goalLabel, goalTone, goalValue,
  groupGoalsByRule, moneyIq, resolveWeekSales, teamCsv, todayKey, weekRange, weeksCsv,
} from '../api';
import { cashierShares, sellerShares } from '../insights';
import { commissionCsv } from '../period';
import { useManager, useShopInsights, useWeekCompare } from '../store';
import {
  AreaChart, CommandRail, DayStrip, Delta, Empty, ErrorBox, HourBands, Medal,
  Ring, SectionHead, Skeleton, Track, useToast,
} from '../ui';
import { PeriodBar } from '../week';

export function Report() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, cashiers, scopedSellers, scopedCashiers, paySellers,
    period, periodKind, setPeriodKind, customFrom, customTo, setCustom,     periodTotals, payTotals, payPeriod, shareBase,
    err, loading, reload,
  } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const insights = useShopInsights();
  const toast = useToast();

  const spark = useMemo(() => [...weeks].reverse().map(w => w.salesAmount), [weeks]);
  const weekSales = resolveWeekSales(dash);
  const sellers = useMemo(() => sellerShares(scopedSellers, shareBase), [scopedSellers, shareBase]);
  const cashierRows = useMemo(() => cashierShares(scopedCashiers, shareBase), [scopedCashiers, shareBase]);
  const due = useMemo(() => (dash?.sellers ?? []).filter(s => s.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue), [dash]);
  const prevById = useMemo(() => new Map((prevDash?.sellers ?? []).map(s => [s.salesmanId, s])), [prevDash]);
  const goalRules = useMemo(() => groupGoalsByRule(dash?.goals), [dash]);
  const todayRow = insights.days.find(d => d.key === todayKey());

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={7} />;

  const week = dash.week;
  const totalDue = due.reduce((s, x) => s + x.balanceDue, 0);
  return (
    <div className="page-flow fade-up">
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

      <section className="card home-section">
        <p className="kicker">تقرير المتابعة · {period.label}</p>
        <h1 className="display text-[28px] font-black">يومي · أسبوعي · دقيق</h1>
        <p className="mt-2 text-sm font-bold text-muted">أسبوع {weekRange(week.weekStart, week.weekEnd)}</p>
        <div className="hero-pills">
          <span className="pill">{moneyIq(periodTotals.sales)}</span>
          <span className="pill">{periodTotals.receipts} فاتورة</span>
          <span className="pill">متوسط {moneyIq(periodTotals.ticket)}</span>
          <span className="pill">عمولات {moneyIq(payTotals.commission)}</span>
          {compare.prev && <Delta value={compare.salesDelta} />}
        </div>
        <div className="toolbar mt-4">
          <button type="button" className="pill" onClick={() => { downloadText(`أسابيع.csv`, weeksCsv(weeks)); toast('تم تنزيل الأسابيع'); }}>الأسابيع</button>
          <button type="button" className="pill" onClick={() => { downloadText(`أيام.csv`, daysCsv(insights.days)); toast('تم تنزيل الأيام'); }}>الأيام</button>
          <button type="button" className="pill" onClick={() => { downloadText(`بائعون.csv`, teamCsv(dash.sellers, weekSales)); toast('تم تنزيل البائعين'); }}>البائعون</button>
          <button type="button" className="pill" onClick={() => { downloadText(`كاشير.csv`, cashierCsv(cashiers, weekSales)); toast('تم تنزيل الكاشير'); }}>الكاشير</button>
          <button type="button" className="pill" onClick={() => { downloadText(`عمولات.csv`, commissionCsv(paySellers)); toast('تم تنزيل العمولات'); }}>العمولات</button>
          <button type="button" className="pill" onClick={() => window.print()}>طباعة</button>
        </div>
      </section>

      <CommandRail items={[
        { kicker: period.label, value: moneyIq(periodTotals.sales), hint: `${periodTotals.receipts} فاتورة`, tone: 'gold' },
        { kicker: 'مبيعات الأسبوع', value: moneyIq(weekSales), hint: `${week.receiptCount} فاتورة`, tone: 'goal' },
        { kicker: 'مبيعات اليوم', value: moneyIq(todayRow?.sales ?? 0), hint: todayRow ? `${todayRow.receipts} فاتورة` : 'لا حركة', tone: 'gold' },
        { kicker: 'متوسط الفاتورة', value: moneyIq(periodTotals.ticket), hint: period.label, tone: 'ok' },
        { kicker: 'العمولات', value: moneyIq(payTotals.commission), hint: payPeriod.label, tone: 'amber' },
      ]} />

      {insights.days.length > 0 && (
        <section className="card p-4">
          <SectionHead title="إحصاء الأيام" kicker="اضغط يوماً للتفاصيل" />
          <DayStrip
            days={insights.days}
            today={todayKey()}
            active={period.singleDay ? period.from : undefined}
            onSelect={key => {
              setCustom(key, key);
              setPeriodKind('custom');
            }}
          />
          <div className="mt-3 space-y-1 report-cards">
            {insights.days.map(d => (
              <div key={d.key} className="day-report-actions">
                <button
                  type="button"
                  className={`rank-row stat-link day-report-row ${period.from === d.key && period.singleDay ? 'on' : ''}`}
                  onClick={() => {
                    setCustom(d.key, d.key);
                    setPeriodKind('custom');
                  }}
                >
                  <div className="min-w-0 text-start">
                    <p className="font-extrabold">{d.label}</p>
                    <p className="text-xs font-bold text-muted">{d.receipts} فاتورة · متوسط {moneyIq(avgTicket(d.sales, d.receipts))}</p>
                  </div>
                  <p className="num font-extrabold">{moneyIq(d.sales)}</p>
                </button>
                <Link to={`/moves?day=${d.key}`} className="day-report-link">فواتير</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {insights.hours.some(h => h.sales) && (
        <section className="card p-4">
          <SectionHead title="أوقات الذروة" kicker={period.label} />
          <HourBands rows={insights.hours} />
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
      </section>

      <div className="dash-split">
        <section className="card p-4">
          <SectionHead title="العمولات" kicker={payPeriod.label} to="/commissions" link="التفاصيل" />
          {[...paySellers].filter(s => s.commissionAmount > 0).sort((a, b) => b.commissionAmount - a.commissionAmount).slice(0, 6).map((s, i) => (
            <Link key={s.salesmanId} to={`/team?q=${encodeURIComponent(s.name)}`} className="rank-row stat-link">
              <Medal rank={i + 1} />
              <div className="min-w-0">
                <p className="truncate font-extrabold">{s.name}</p>
                <p className="text-xs font-bold text-muted">{s.receiptCount} فاتورة · مبيعات {moneyIq(s.salesAmount)}</p>
              </div>
              <p className="num text-sm font-extrabold text-goal">{moneyIq(s.commissionAmount)}</p>
            </Link>
          ))}
          {!paySellers.some(s => s.commissionAmount > 0) && <Empty title="لا عمولات" />}
        </section>

        <section className="card p-4">
          <SectionHead title="الأهداف" kicker="حسب الهدف" to="/goals" link="الكل" />
          {goalRules.length ? goalRules.slice(0, 5).map(rule => (
            <Link key={rule.ruleId} to={`/goals?rule=${rule.ruleId}`} className="board-row stat-link">
              <Ring value={rule.avg} size={46} tone={goalTone(rule.avg)} />
              <div className="min-w-0">
                <p className="truncate font-extrabold">{rule.ruleName}</p>
                <p className="truncate text-xs font-bold text-muted">{rule.hit}/{rule.total} · {goalValue(rule.targetType, rule.weeklyTarget)}</p>
                <div className="mt-2"><Track value={rule.avg} tone={goalTone(rule.avg)} /></div>
              </div>
              <span className="text-xs font-extrabold text-muted">{goalLabel(rule.avg)}</span>
            </Link>
          )) : <Empty title="لا أهداف" />}
        </section>
      </div>

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
                <p className="text-xs font-bold text-muted">{s.receipts} فاتورة</p>
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
        <SectionHead title="الكاشير" kicker="ترتيب الكاشير" to="/cashiers" link="التفاصيل" />
        {cashierRows.length ? cashierRows.map((c, i) => (
          <Link key={c.id} to={`/cashiers?q=${encodeURIComponent(c.name)}`} className="rank-row stat-link">
            <Medal rank={i + 1} />
            <div className="min-w-0">
              <p className="truncate font-extrabold">{c.name}</p>
              <p className="text-xs font-bold text-muted">{c.receipts} فاتورة</p>
            </div>
            <p className="num text-sm font-extrabold">{moneyIq(c.sales)}</p>
          </Link>
        )) : <Empty title="لا كاشير" hint="تظهر الأسماء بعد مزامنة لوحة التحكم" />}
      </section>

      {due.length > 0 && (
        <section className="card p-4">
          <SectionHead title="مستحقات الفريق" kicker={moneyIq(totalDue)} />
          {due.map((s, i) => (
            <Link key={s.salesmanId} to={`/team?q=${encodeURIComponent(s.name)}`} className="rank-row stat-link">
              <Medal rank={i + 1} />
              <p className="font-extrabold">{s.name}</p>
              <p className="num font-extrabold">{moneyIq(s.balanceDue)}</p>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
