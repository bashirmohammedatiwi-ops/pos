import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ago, avgTicket, deltaPct, downloadText, goalLabel, goalTone, greeting,
  groupGoalsByRule, lastSyncMs, moneyIq, resolveWeekSales, shareText,
  teamCsv, todayKey, weekRange, weekReport,
} from '../api';
import { buildAlerts, cashierShares, prevDay, sellerShares } from '../insights';
import { useManager, useShopInsights } from '../store';
import {
  AreaChart, CountMoney, Delta, ErrorBox, LeaderCard, LiveDot, LiveTicker,
  MetricStrip, NavHub, Ring, SectionCard, Skeleton, Track, useToast,
} from '../ui';
import { PeriodBar, WeekStepper } from '../week';

export function Home() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, scopedSellers, scopedCashiers, paySellers,
    period, periodKind, setPeriodKind, payPeriod, payTotals, customFrom, customTo, setCustom,
    periodTotals, shareBase, linesTruncated, err, loading, cached, reload,
  } = useManager();
  const insights = useShopInsights();
  const toast = useToast();
  const nav = useNavigate();
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;
  const alerts = useMemo(() => buildAlerts(dash, prevDash, scopedCashiers, stale), [dash, prevDash, scopedCashiers, stale]);
  const weekSales = resolveWeekSales(dash);
  const sellers = useMemo(() => sellerShares(scopedSellers, shareBase), [scopedSellers, shareBase]);
  const cashierRows = useMemo(() => cashierShares(scopedCashiers, shareBase), [scopedCashiers, shareBase]);
  const goalRules = useMemo(() => groupGoalsByRule(dash?.goals), [dash]);
  const payRows = useMemo(
    () => [...paySellers].filter(s => s.commissionAmount > 0).sort((a, b) => b.commissionAmount - a.commissionAmount),
    [paySellers],
  );
  const chartValues = useMemo(() => insights.days.map(d => d.sales), [insights.days]);
  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={6} />;

  const week = dash.week;
  const today = todayKey();
  const focusDay = period.singleDay ? period.from : today;
  const dayRow = insights.days.find(d => d.key === focusDay);
  const yest = prevDay(insights.days, focusDay);
  const daySales = dayRow?.sales ?? (period.singleDay ? periodTotals.sales : 0);
  const hit = goalRules.reduce((s, r) => s + r.hit, 0);
  const goalCount = goalRules.reduce((s, r) => s + r.total, 0);
  const avg = goalRules.length ? goalRules.reduce((s, r) => s + r.avg, 0) / goalRules.length : 0;
  const dayVsYest = yest ? deltaPct(daySales, yest.sales) : 0;
  const liveSellers = sellers.filter(s => s.sales > 0);

  function pickDay(key: string) {
    setCustom(key, key);
    setPeriodKind('custom');
  }

  async function share() {
    const extra = [
      `المدة: ${period.label} — ${moneyIq(periodTotals.sales)}`,
      insights.topCashier ? `أقوى كاشير: ${insights.topCashier.name} — ${moneyIq(insights.topCashier.salesAmount)}` : '',
      `عمولات: ${moneyIq(payTotals.commission)} (${payPeriod.label})`,
    ].filter(Boolean);
    const result = await shareText('تقرير المتابعة', weekReport(dash!, extra));
    if (result === 'copied') toast('تم نسخ التقرير');
    else if (result === 'shared') toast('تمت المشاركة');
    else if (result === 'fail') toast('تعذر النسخ');
  }

  return (
    <div className="page-flow home-flow fade-up">
      <WeekStepper weeks={weeks} weekStart={weekStart} setWeek={setWeek} kicker="أسبوع العمل" />

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
        showWeekPicker={false}
        days={insights.days}
        activeDay={period.singleDay ? period.from : undefined}
        today={today}
        onDaySelect={pickDay}
      />

      {linesTruncated && (
        <p className="data-note">تُعرض آخر 1200 حركة — الإجماليات من السيرفر دقيقة.</p>
      )}

      <div className="bento">
        <section className="bento-hero card home-hero-v5 surface-hero">
          <div className="bento-hero-top">
            <div>
              <p className="kicker">{greeting()} · {dash.manager.displayName}</p>
              <h1 className="display bento-hero-title">مبيعات {period.label}</h1>
            </div>
            <LiveDot stale={stale} />
          </div>
          <p className="bento-hero-num num"><CountMoney value={periodTotals.sales} /></p>
          <div className="mt-2">
            {period.singleDay && yest
              ? <Delta value={dayVsYest} />
              : <span className="text-xs font-extrabold text-muted">{periodTotals.receipts} فاتورة · متوسط {moneyIq(periodTotals.ticket)}</span>}
          </div>
          <MetricStrip
            items={[
              { label: 'فواتير', value: String(periodTotals.receipts), tone: 'goal' },
              { label: 'بائعون', value: String(liveSellers.length), tone: 'ok' },
              { label: 'كاشير', value: String(scopedCashiers.filter(c => c.salesAmount > 0).length), tone: 'gold' },
              { label: 'عمولات', value: moneyIq(payTotals.commission), tone: 'warn' },
            ]}
          />
          <div className="bento-hero-week">
            <span className="bento-hero-week-label">مبيعات الأسبوع</span>
            <strong className="num">{moneyIq(weekSales)}</strong>
            <span className="bento-hero-week-meta">{week.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(weekSales, week.receiptCount))}</span>
          </div>
          <div className="bento-hero-actions">
            <button type="button" className="pill pill-primary" onClick={() => void share()}>مشاركة</button>
            <button
              type="button"
              className="pill"
              onClick={() => {
                downloadText(`فريق-${period.from}.csv`, teamCsv(scopedSellers, periodTotals.sales));
                toast('تم تنزيل التقرير');
              }}
            >
              تصدير
            </button>
          </div>
          <p className="bento-hero-foot">
            {weekRange(week.weekStart, week.weekEnd)}
            {syncMs && ` · ${stale ? 'مزامنة قديمة' : `مزامنة ${ago(syncMs)}`}`}
          </p>
          {stale && <p className="mt-2 text-sm font-extrabold text-warn">افتح لوحة التحكم لتحديث البيانات</p>}
          {cached && <p className="mt-1 text-sm font-extrabold text-muted">بيانات محفوظة مؤقتاً</p>}
        </section>

        {chartValues.some(v => v > 0) && (
          <section className="bento-chart card chart-panel-v5">
            <p className="kicker">منحنى الأسبوع</p>
            <h2 className="text-base font-black">مبيعات يوم بيوم</h2>
            {dayRow && (
              <p className="mt-1 text-xs font-bold text-muted">
                {dayRow.label} · {moneyIq(dayRow.sales)} · {dayRow.receipts} فاتورة
              </p>
            )}
            <AreaChart values={chartValues} height={140} />
          </section>
        )}

        <div className="bento-nav">
          <NavHub />
        </div>

        {insights.receipts.length > 0 && (
          <SectionCard kicker="مباشر" title="آخر الفواتير" to="/moves" linkLabel="كل الفواتير" className="bento-live">
            <LiveTicker receipts={insights.receipts} limit={6} />
          </SectionCard>
        )}

        {alerts.length > 0 && (
          <div className="bento-alerts alert-strip">
            {alerts.slice(0, 3).map(a => (
              <Link key={a.id} to={a.to === '/' ? '/watch' : a.to} className={`alert-lite ${a.tone}`}>
                <strong>{a.title}</strong>
                <span>{a.hint}</span>
              </Link>
            ))}
          </div>
        )}

        <SectionCard kicker={period.label} title="البائعون" to="/team" linkLabel="كل البائعين" className="bento-sellers">
          <div className="leader-list">
            {sellers.slice(0, 5).map((s, i) => {
              const seller = scopedSellers.find(x => x.name === s.name);
              const meta = seller && seller.commissionAmount > 0
                ? `عمولة ${moneyIq(seller.commissionAmount)}`
                : seller && seller.goalCount > 0
                  ? `تاركت ${Math.round(seller.goalPercent)}%`
                  : 'اضغط للتفاصيل';
              return (
                <LeaderCard
                  key={s.id}
                  rank={i + 1}
                  name={s.name}
                  meta={meta}
                  showSales={false}
                  tone="goal"
                  onClick={() => nav(`/team?q=${encodeURIComponent(s.name)}`)}
                />
              );
            })}
          </div>
          {!sellers.length && <p className="empty-line">لا حركة بائعين في هذه المدة</p>}
        </SectionCard>

        <SectionCard kicker={period.label} title="الكاشير" to="/cashiers" linkLabel="كل الكاشير" className="bento-cashiers">
          <div className="leader-list">
            {cashierRows.slice(0, 5).map((c, i) => (
              <LeaderCard
                key={c.id}
                rank={i + 1}
                name={c.name}
                sales={c.sales}
                meta={`${c.receipts} فاتورة`}
                tone="gold"
                onClick={() => nav(`/cashiers?q=${encodeURIComponent(c.name)}`)}
              />
            ))}
          </div>
          {!cashierRows.length && <p className="empty-line">لا حركة كاشير في هذه المدة</p>}
        </SectionCard>

        <Link to="/commissions" className="bento-comm card section-card stat-link">
          <div className="section-card-head">
            <div>
              <p className="kicker">{payPeriod.label}</p>
              <h2 className="section-card-title">العمولات</h2>
            </div>
            <span className="section-more">التفاصيل ←</span>
          </div>
          <p className="bento-stat-num num">{moneyIq(payTotals.commission)}</p>
          <p className="mt-2 text-sm font-bold text-muted">{payRows.length} موظف · أعلى {moneyIq(payRows[0]?.commissionAmount ?? 0)}</p>
        </Link>

        <Link to="/goals" className="bento-goals card section-card stat-link">
          <div className="section-card-head">
            <div>
              <p className="kicker">هذا الأسبوع</p>
              <h2 className="section-card-title">الأهداف</h2>
            </div>
            <span className="section-more">التفاصيل ←</span>
          </div>
          {goalRules.length ? (
            <>
              <div className="flex items-center gap-3">
                <Ring value={avg} size={68} tone="goal" label="متوسط" />
                <p className="text-sm font-extrabold">{hit} من {goalCount} حققوا</p>
              </div>
              {goalRules.slice(0, 2).map(rule => (
                <div key={rule.ruleId} className="mt-3">
                  <p className="font-extrabold text-sm">{rule.ruleName}</p>
                  <div className="mt-2"><Track value={rule.avg} tone={goalTone(rule.avg)} /></div>
                  <p className="mt-1 text-xs font-bold text-muted">{goalLabel(rule.avg)}</p>
                </div>
              ))}
            </>
          ) : (
            <p className="empty-line">لا أهداف هذا الأسبوع</p>
          )}
        </Link>

      </div>
    </div>
  );
}
