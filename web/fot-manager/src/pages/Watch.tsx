import { Link } from 'react-router-dom';
import { groupGoalsByRule, lastSyncMs, pct, resolveWeekSales } from '../api';
import { buildAlerts, shopHealth } from '../insights';
import { useManager, useWeekCompare } from '../store';
import { ErrorBox, HealthMeter, PageHero, Skeleton } from '../ui';

export function Watch() {
  const { weekStart, dash, prevDash, weeks, cashiers, err, loading, reload } = useManager();
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
    return change <= -15 ? [{ s, change }] : [];
  }).sort((a, b) => a.change - b.change);

  if (err && !dash) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton />;

  const total = alerts.length + lateRules.length + drops.length;

  return (
    <div className="page-flow fade-up">
      <PageHero
        kicker="هذا الأسبوع"
        title="التنبيهات"
        value={String(total)}
        hint={total ? 'أمور تحتاج نظرك — اضغط على أي بند لفتح التفاصيل' : 'لا شيء يحتاج انتباهك — كل شيء يسير بشكل طبيعي'}
        stale={stale}
      />

      <HealthMeter score={health.score} label={health.label} tone={health.tone} />

      <section className="s-card">
        <div className="s-card-head"><h2>تنبيهات المحل</h2></div>
        {alerts.length ? (
          <div className="s-alerts">
            {alerts.map(a => (
              <Link key={a.id} to={a.to === '/' ? '/' : a.to} className={`s-alert ${a.tone}`}>
                <strong>{a.title}</strong>
                <span>{a.hint}</span>
              </Link>
            ))}
          </div>
        ) : <p className="s-empty">لا تنبيهات — عندما يتأخر هدف أو تتوقف المزامنة يظهر ذلك هنا</p>}
      </section>

      {lateRules.length > 0 && (
        <section className="s-card">
          <div className="s-card-head">
            <h2>أهداف متأخرة</h2>
            <Link to="/goals">كل الأهداف</Link>
          </div>
          <div className="s-rows">
            {lateRules.map(rule => (
              <Link key={rule.ruleId} to={`/goals?rule=${rule.ruleId}`} className="s-row">
                <span className="s-row-main">
                  <strong>{rule.ruleName}</strong>
                  <small>{rule.hit} من {rule.total} حققوا الهدف</small>
                </span>
                <span className="s-row-end">
                  <strong className="num text-warn">{pct(rule.avg)}</strong>
                  <small>متوسط الإنجاز</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {drops.length > 0 && (
        <section className="s-card">
          <div className="s-card-head">
            <h2>بائعون انخفضوا عن الأسبوع السابق</h2>
            <Link to="/team">البائعون</Link>
          </div>
          <div className="s-rows">
            {drops.map(row => (
              <Link key={row.s.salesmanId} to={`/team?q=${encodeURIComponent(row.s.name)}`} className="s-row">
                <span className="s-row-main">
                  <strong>{row.s.name}</strong>
                  <small>{row.s.receiptCount} فاتورة هذا الأسبوع</small>
                </span>
                <span className="s-row-end">
                  <strong className="num text-danger">{Math.round(row.change)}%</strong>
                  <small>عن السابق</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
