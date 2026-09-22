import { Link } from 'react-router-dom';
import { groupGoalsBySeller, lastSyncMs, moneyIq, pct, resolveWeekSales } from '../api';
import { buildAlerts, shopHealth } from '../insights';
import { useManager, useWeekCompare } from '../store';
import { Empty, ErrorBox, HealthMeter, Skeleton } from '../ui';
import { WeekBar } from '../week';

export function Watch() {
  const { weekStart, setWeek, dash, prevDash, weeks, cashiers, err, loading, reload } = useManager();
  const stale = lastSyncMs(dash?.lastSyncAt) != null && Date.now() - (lastSyncMs(dash?.lastSyncAt) ?? 0) > 15 * 60 * 1000;
  const compare = useWeekCompare(weeks, weekStart);
  const alerts = buildAlerts(dash, prevDash, cashiers, stale);
  const groups = groupGoalsBySeller(dash?.goals);
  const avg = groups.length ? groups.reduce((s, g) => s + g.avg, 0) / groups.length : 0;
  const health = shopHealth({
    goalAvg: avg,
    goalCount: groups.reduce((s, g) => s + g.goals.length, 0),
    salesDelta: compare.prev ? compare.salesDelta : undefined,
    stale,
    hasSales: resolveWeekSales(dash) > 0,
  });
  const late = (dash?.goals ?? []).filter(g => g.percent < 80).sort((a, b) => a.percent - b.percent);
  const drops = (dash?.sellers ?? []).flatMap(s => {
    const prev = prevDash?.sellers.find(x => x.salesmanId === s.salesmanId);
    if (!prev || prev.salesAmount <= 0) return [];
    const change = ((s.salesAmount - prev.salesAmount) / Math.abs(prev.salesAmount)) * 100;
    return change <= -15 ? [{ s, change, prev: prev.salesAmount }] : [];
  }).sort((a, b) => a.change - b.change);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton />;

  return (
    <div className="dash fade-up">
      <section className="hero compact command">
        <p className="kicker">يحتاج متابعة</p>
        <h1 className="display text-[28px] font-black">التنبيهات</h1>
        <p className="mt-2 text-sm font-bold text-muted">
          {alerts.length ? `${alerts.length} نقطة تحتاج نظرك هذا الأسبوع` : 'لا تنبيهات — الفريق في وضع جيد'}
        </p>
      </section>
      <HealthMeter score={health.score} label={health.label} tone={health.tone} />
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      {alerts.map(a => (
        <Link key={a.id} to={a.to} className={`card alert-card ${a.tone} stat-link`}>
          <p className="kicker">{a.tone === 'warn' ? 'تركيز' : 'ملاحظة'}</p>
          <h2 className="mt-1 text-lg font-extrabold">{a.title}</h2>
          <p className="mt-1 text-sm font-bold text-muted">{a.hint}</p>
        </Link>
      ))}
      {!alerts.length && <Empty title="لا تنبيهات" hint="عندما يتأخر هدف أو تنخفض مبيعات بائع تظهر هنا" />}

      {late.length > 0 && (
        <section className="card p-4">
          <p className="kicker">أهداف متأخرة</p>
          {late.map(g => (
            <Link key={`${g.ruleId}-${g.salesmanId}`} to={`/goals?q=${encodeURIComponent(g.salesmanName)}`} className="rank-row stat-link">
              <div className="min-w-0">
                <p className="font-extrabold">{g.salesmanName}</p>
                <p className="text-xs font-bold text-muted">{g.ruleName}</p>
              </div>
              <p className="num font-extrabold text-warn">{pct(g.percent)}</p>
            </Link>
          ))}
        </section>
      )}

      {drops.length > 0 && (
        <section className="card p-4">
          <p className="kicker">انخفاض عن الأسبوع السابق</p>
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
