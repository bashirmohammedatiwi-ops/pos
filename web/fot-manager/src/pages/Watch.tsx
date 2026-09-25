import { Link } from 'react-router-dom';
import {
  groupGoalsByRule, lastSyncMs, moneyIq, pct, resolveWeekSales, todayKey,
} from '../api';
import { buildAlerts, groupReceipts, shopHealth } from '../insights';
import { useManager, useShopInsights, useWeekCompare } from '../store';
import {
  Empty, ErrorBox, HealthMeter, LiveDot, Medal, RecentFeed, SectionHead, Skeleton,
} from '../ui';
import { WeekBar } from '../week';

export function Watch() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, cashiers, lines, scopedCashiers,
    periodTotals,
    err, loading, reload,
  } = useManager();
  const insights = useShopInsights();
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;
  const compare = useWeekCompare(weeks, weekStart);
  const alerts = buildAlerts(dash, prevDash, cashiers, stale);
  const rules = groupGoalsByRule(dash?.goals);
  const avg = rules.length ? rules.reduce((s, g) => s + g.avg, 0) / rules.length : 0;
  const health = shopHealth({
    goalAvg: avg,
    goalCount: rules.reduce((s, g) => s + g.total, 0),
    salesDelta: compare.prev ? compare.salesDelta : undefined,
    stale,
    hasSales: resolveWeekSales(dash) > 0,
  });
  const lateRules = rules.filter(r => r.avg < 80).sort((a, b) => a.avg - b.avg);
  const drops = (dash?.sellers ?? []).flatMap(s => {
    const prev = prevDash?.sellers.find(x => x.salesmanId === s.salesmanId);
    if (!prev || prev.salesAmount <= 0) return [];
    const change = ((s.salesAmount - prev.salesAmount) / Math.abs(prev.salesAmount)) * 100;
    return change <= -15 ? [{ s, change, prev: prev.salesAmount }] : [];
  }).sort((a, b) => a.change - b.change);

  const today = todayKey();
  const todayLines = lines.filter(l => l.occurredAt.slice(0, 10) === today);
  const todaySales = todayLines.reduce((s, l) => s + l.salesAmount, 0);
  const todayReceipts = new Set(todayLines.map(l => l.receiptNumber ?? l.id)).size;

  const todayCashiers = (dash?.cashierDays ?? [])
    .filter(row => String(row.day || '').slice(0, 10) === today && (row.salesAmount !== 0 || row.receiptCount > 0))
    .map(row => [row.name, row.salesAmount] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topTodaySellers = (() => {
    const map = new Map<string, number>();
    for (const l of todayLines) {
      map.set(l.salesmanName, (map.get(l.salesmanName) ?? 0) + l.salesAmount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  })();

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton />;

  const todayRow = insights.days.find(d => d.key === today);

  return (
    <div className="page-flow fade-up">
      <section className="card home-section surface-hero">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">متابعة مباشرة</p>
            <h1 className="display text-[28px] font-black">التنبيهات والحركة</h1>
            <p className="mt-2 text-sm font-bold text-muted">
              {alerts.length ? `${alerts.length} نقطة تحتاج نظرك` : 'الفريق في وضع جيد'}
            </p>
          </div>
          <LiveDot stale={stale} />
        </div>
        <div className="dash-kpis mt-4">
          <div className="dash-kpi"><p>اليوم</p><strong className="num">{moneyIq(todaySales || todayRow?.sales || 0)}</strong></div>
          <div className="dash-kpi"><p>فواتير اليوم</p><strong className="num">{todayReceipts || todayRow?.receipts || 0}</strong></div>
          <div className="dash-kpi"><p>الكاشير</p><strong className="num">{scopedCashiers.length}</strong></div>
          <div className="dash-kpi"><p>صحة المحل</p><strong className="num">{health.score}٪</strong></div>
        </div>
      </section>

      <HealthMeter score={health.score} label={health.label} tone={health.tone} />
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      <RecentFeed receipts={insights.receipts.length ? insights.receipts : groupReceipts(lines)} limit={10} title="آخر الفواتير" />

      {(todayCashiers.length > 0 || topTodaySellers.length > 0) && (
        <div className="dash-split">
          {todayCashiers.length > 0 && (
            <section className="panel">
              <SectionHead title="كاشير اليوم" kicker="مباشر" to="/cashiers" link="الكل" />
              {todayCashiers.map(([name, sales], i) => (
                <Link key={name} to={`/cashiers?q=${encodeURIComponent(name)}`} className="rank-row stat-link">
                  <Medal rank={i + 1} />
                  <p className="font-extrabold">{name}</p>
                  <p className="num font-extrabold">{moneyIq(sales)}</p>
                </Link>
              ))}
            </section>
          )}
          {topTodaySellers.length > 0 && (
            <section className="panel">
              <SectionHead title="بائعون اليوم" kicker="مباشر" to="/team" link="الكل" />
              {topTodaySellers.map(([name, sales], i) => (
                <Link key={name} to={`/team?q=${encodeURIComponent(name)}`} className="rank-row stat-link">
                  <Medal rank={i + 1} />
                  <p className="font-extrabold">{name}</p>
                  <p className="num font-extrabold">{moneyIq(sales)}</p>
                </Link>
              ))}
            </section>
          )}
        </div>
      )}

      {alerts.map(a => (
        <Link key={a.id} to={a.to} className={`card alert-card ${a.tone} stat-link`}>
          <p className="kicker">{a.tone === 'warn' ? 'تركيز' : 'ملاحظة'}</p>
          <h2 className="mt-1 text-lg font-extrabold">{a.title}</h2>
          <p className="mt-1 text-sm font-bold text-muted">{a.hint}</p>
        </Link>
      ))}
      {!alerts.length && <Empty title="لا تنبيهات" hint="عندما يتأخر هدف أو تنخفض مبيعات بائع تظهر هنا" />}

      {lateRules.length > 0 && (
        <section className="card p-4">
          <SectionHead title="أهداف تحتاج تركيز" kicker={`${lateRules.length} هدف`} to="/goals" link="الكل" />
          {lateRules.map(rule => (
            <Link key={rule.ruleId} to={`/goals?rule=${rule.ruleId}`} className="rank-row stat-link">
              <div className="min-w-0">
                <p className="font-extrabold">{rule.ruleName}</p>
                <p className="text-xs font-bold text-muted">{rule.hit}/{rule.total} حققوا</p>
              </div>
              <p className="num font-extrabold text-warn">{pct(rule.avg)}</p>
            </Link>
          ))}
        </section>
      )}

      {drops.length > 0 && (
        <section className="card p-4">
          <SectionHead title="انخفاض عن الأسبوع السابق" kicker="البائعون" to="/team" link="الفريق" />
          {drops.map(row => (
            <Link key={row.s.salesmanId} to={`/team?q=${encodeURIComponent(row.s.name)}`} className="rank-row stat-link">
              <div className="min-w-0">
                <p className="font-extrabold">{row.s.name}</p>
                <p className="text-xs font-bold text-muted">{moneyIq(row.s.salesAmount)} مقابل {moneyIq(row.prev)}</p>
              </div>
              <p className="num font-extrabold text-danger">{Math.round(row.change)}%</p>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
