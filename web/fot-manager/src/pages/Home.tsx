import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ago, cashierCsv, deltaPct, downloadText, goalLabel, goalTone, goalValue, greeting,
  groupGoalsBySeller, lastSyncMs, moneyIq, pct, resolveWeekSales, shareOf, shareText,
  teamCsv, todayKey, weekRange, weekReport,
} from '../api';
import { buildAlerts, cashierShares, prevDay, sellerShares, shopHealth, weekPace } from '../insights';
import { commissionCsv } from '../period';
import { useManager, useShopInsights, useWeekCompare } from '../store';
import {
  CountMoney, DayStrip, Delta, ErrorBox, HourBands, LiveDot, Medal, Podium, Ring,
  SectionHead, ShareRow, Skeleton, Track, useToast,
} from '../ui';
import { PayPeriodBar, PeriodBar } from '../week';

export function Home() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, cashiers, scopedSellers, scopedCashiers, paySellers,
    period, periodKind, setPeriodKind, payPeriod, payKind, setPayKind, customFrom, customTo, setCustom,
    periodTotals, payTotals, err, loading, cached, reload,
  } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const insights = useShopInsights();
  const toast = useToast();
  const nav = useNavigate();
  const due = useMemo(() => (dash?.sellers ?? []).filter(s => s.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue), [dash]);
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;
  const alerts = useMemo(() => buildAlerts(dash, prevDash, cashiers, stale), [dash, prevDash, cashiers, stale]);
  const weekSales = resolveWeekSales(dash);
  const sellers = useMemo(() => sellerShares(scopedSellers, periodTotals.sales || 1), [scopedSellers, periodTotals.sales]);
  const cashierRows = useMemo(() => cashierShares(scopedCashiers, periodTotals.sales || 1), [scopedCashiers, periodTotals.sales]);
  const goalGroups = useMemo(() => groupGoalsBySeller(dash?.goals), [dash]);
  const payRows = useMemo(
    () => [...paySellers].filter(s => s.commissionAmount > 0).sort((a, b) => b.commissionAmount - a.commissionAmount),
    [paySellers],
  );

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={6} />;

  const week = dash.week;
  const today = todayKey();
  const focusDay = period.singleDay ? period.from : today;
  const dayRow = insights.days.find(d => d.key === focusDay);
  const yest = prevDay(insights.days, focusDay);
  const daySales = dayRow?.sales ?? (period.singleDay ? periodTotals.sales : 0);
  const hit = goalGroups.reduce((s, g) => s + g.hit, 0);
  const goalCount = goalGroups.reduce((s, g) => s + g.goals.length, 0);
  const avg = goalGroups.length ? goalGroups.reduce((s, g) => s + g.avg, 0) / goalGroups.length : 0;
  const late = goalGroups[0];
  const pace = weekPace(week.weekStart, week.weekEnd, weekSales, today);
  const health = shopHealth({
    goalAvg: avg,
    goalCount,
    salesDelta: compare.prev ? compare.salesDelta : undefined,
    stale: !!stale,
    hasSales: weekSales > 0 || periodTotals.sales > 0,
  });
  const dayVsYest = yest ? deltaPct(daySales, yest.sales) : 0;
  const recentReceipts = insights.receipts.slice(0, 6);
  const liveSellers = sellers.filter(s => s.sales > 0);

  async function share() {
    const extra = [
      `المدة: ${period.label} — ${moneyIq(periodTotals.sales)}`,
      insights.topCashier ? `أقوى كاشير: ${insights.topCashier.name} — ${moneyIq(insights.topCashier.salesAmount)}` : '',
      `عمولات الموظفين: ${moneyIq(payTotals.commission)} (${payPeriod.label})`,
    ].filter(Boolean);
    const result = await shareText('تقرير المتابعة', weekReport(dash!, extra));
    if (result === 'copied') toast('تم نسخ التقرير');
    else if (result === 'shared') toast('تمت المشاركة');
    else if (result === 'fail') toast('تعذر النسخ');
  }

  return (
    <div className="dash fade-up">
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

      <section className="hero dash-hero">
        <div className="dash-hero-top">
          <div>
            <p className="kicker">{greeting()} · {dash.manager.displayName}</p>
            <h1 className="display mt-1 text-[26px] font-black leading-tight">مبيعات {period.label}</h1>
          </div>
          <div className="dash-hero-tools">
            <LiveDot stale={stale} />
            <button type="button" className="pill" onClick={() => void share()}>مشاركة</button>
            <button
              type="button"
              className="pill"
              onClick={() => {
                downloadText(`فريق-${period.from}.csv`, teamCsv(scopedSellers, periodTotals.sales));
                toast('تم تنزيل تقرير البائعين');
              }}
            >
              تصدير
            </button>
          </div>
        </div>

        <p className="hero-num text-goal"><CountMoney value={periodTotals.sales} /></p>
        <div className="mt-2">
          {period.singleDay
            ? (yest ? <Delta value={dayVsYest} /> : <span className="text-xs font-extrabold text-muted">لا مقارنة سابقة</span>)
            : (compare.prev && period.kind === 'week' ? <Delta value={compare.salesDelta} /> : <span className="text-xs font-extrabold text-muted">{periodTotals.receipts} فاتورة في هذه المدة</span>)}
        </div>

        <div className="dash-kpis">
          <div className="dash-kpi">
            <p>الفواتير</p>
            <strong className="num">{periodTotals.receipts}</strong>
          </div>
          <div className="dash-kpi">
            <p>متوسط الفاتورة</p>
            <strong className="num">{moneyIq(periodTotals.ticket)}</strong>
          </div>
          <div className="dash-kpi">
            <p>بائعون نشطون</p>
            <strong className="num">{liveSellers.length}</strong>
          </div>
          <div className="dash-kpi">
            <p>كاشير</p>
            <strong className="num">{scopedCashiers.length}</strong>
          </div>
        </div>

        <div className="dash-meta">
          <span>{goalCount ? `${hit}/${goalCount} أهداف هذا الأسبوع` : 'لا أهداف مربوطة'}</span>
          {syncMs && <span>{stale ? 'المزامنة قديمة' : `مزامنة ${ago(syncMs)}`}</span>}
          <span>أسبوع {weekRange(week.weekStart, week.weekEnd)}</span>
          <span>إيقاع متوقع {moneyIq(pace.projected)}</span>
        </div>
        {stale && <p className="mt-3 text-sm font-extrabold text-warn">افتح لوحة التحكم حتى تُرفع البيانات من جديد</p>}
        {cached && <p className="mt-2 text-sm font-extrabold text-muted">تُعرض بيانات محفوظة حتى تكتمل المزامنة</p>}
      </section>

      {insights.days.length > 0 && (
        <section className="panel">
          <SectionHead title="أيام الأسبوع" kicker="اضغط يوماً لعرضه" />
          <DayStrip
            days={insights.days}
            today={today}
            active={period.singleDay ? period.from : undefined}
            onSelect={key => {
              setCustom(key, key);
              setPeriodKind('custom');
            }}
          />
          {dayRow && (
            <div className="panel-foot">
              <p>{dayRow.label} · {moneyIq(dayRow.sales)} · {dayRow.receipts} فاتورة</p>
              <Link to={`/moves?day=${dayRow.key}`}>فواتير اليوم</Link>
            </div>
          )}
        </section>
      )}

      {alerts.length > 0 && (
        <div className="alert-strip">
          {alerts.slice(0, 2).map(a => (
            <Link key={a.id} to={a.to === '/' ? '/watch' : a.to} className={`alert-lite ${a.tone}`}>
              <strong>{a.title}</strong>
              <span>{a.hint}</span>
            </Link>
          ))}
          {alerts.length > 2 && <Link to="/watch" className="section-link">كل التنبيهات</Link>}
        </div>
      )}

      <div className="dash-split">
        <section className="panel">
          <SectionHead title="البائعون" kicker={period.label} to="/team" link="التفاصيل" />
          {liveSellers.length > 0 && (
            <Podium
              items={liveSellers.slice(0, 3).map(s => ({
                id: s.id,
                name: s.name,
                value: moneyIq(s.sales),
                hint: `${s.receipts} فاتورة · ${pct(s.share)}`,
              }))}
              onPick={item => nav(`/team?q=${encodeURIComponent(item.name)}`)}
            />
          )}
          <div className="mt-3">
            {sellers.slice(0, 5).map((s, i) => (
              <ShareRow key={s.id} rank={i + 1} row={s} onClick={() => nav(`/team?q=${encodeURIComponent(s.name)}`)} />
            ))}
            {!sellers.length && <p className="empty-line">لا حركة بائعين في هذه المدة</p>}
          </div>
        </section>

        <section className="panel">
          <SectionHead
            title="الكاشير"
            kicker={period.label}
            to="/cashiers"
            link="التفاصيل"
            action={(
              <button
                type="button"
                className="section-link"
                onClick={() => {
                  downloadText(`كاشير-${period.from}.csv`, cashierCsv(scopedCashiers, periodTotals.sales));
                  toast('تم تنزيل تقرير الكاشير');
                }}
              >
                تصدير
              </button>
            )}
          />
          {cashierRows.length > 2 && (
            <Podium
              items={cashierRows.slice(0, 3).map(c => ({
                id: c.id,
                name: c.name,
                value: moneyIq(c.sales),
                hint: `${c.receipts} فاتورة`,
              }))}
              onPick={item => nav(`/cashiers?q=${encodeURIComponent(item.name)}`)}
            />
          )}
          <div className="mt-3">
            {cashierRows.slice(0, 5).map((c, i) => (
              <ShareRow key={c.id} rank={i + 1} row={c} onClick={() => nav(`/cashiers?q=${encodeURIComponent(c.name)}`)} />
            ))}
            {!cashierRows.length && <p className="empty-line">لا حركة كاشير في هذه المدة</p>}
          </div>
        </section>
      </div>

      <section className="panel pay-board">
        <SectionHead
          title="عمولات الموظفين"
          kicker={payPeriod.label}
          action={(
            <button
              type="button"
              className="section-link"
              onClick={() => {
                downloadText(`عمولات-${payPeriod.from}.csv`, commissionCsv(paySellers));
                toast('تم تنزيل العمولات');
              }}
            >
              تصدير
            </button>
          )}
        />
        <PayPeriodBar
          period={payPeriod}
          kind={payKind}
          setKind={setPayKind}
          customFrom={customFrom}
          customTo={customTo}
          setCustom={setCustom}
        />
        <div className="pay-hero">
          <div>
            <p className="kicker">إجمالي العمولات</p>
            <p className="num mt-1 text-[26px] font-black text-goal">{moneyIq(payTotals.commission)}</p>
          </div>
          <p className="text-xs font-extrabold text-muted">{payRows.length} موظفاً · {payTotals.receipts} فاتورة</p>
        </div>
        {payRows.length ? payRows.slice(0, 6).map((s, i) => (
          <Link key={s.salesmanId} to={`/team?q=${encodeURIComponent(s.name)}`} className="rank-row stat-link">
            <Medal rank={i + 1} />
            <div className="min-w-0">
              <p className="truncate font-extrabold">{s.name}</p>
              <p className="text-xs font-bold text-muted">{s.receiptCount} فاتورة · مبيعات {moneyIq(s.salesAmount)}</p>
            </div>
            <p className="num text-sm font-extrabold">{moneyIq(s.commissionAmount)}</p>
          </Link>
        )) : <p className="empty-line">لا عمولات في هذه المدة</p>}
      </section>

      <div className="dash-split">
        <section className="panel">
          <SectionHead title="التاركت" kicker="هذا الأسبوع" to="/goals" link="الكل" />
          {goalGroups.length ? (
            <>
              <div className="goal-summary">
                <Ring value={avg} size={86} tone="goal" label="متوسط" />
                <div>
                  <p className="font-extrabold">{hit} من {goalCount} تحقق</p>
                  <p className="mt-1 text-xs font-bold text-muted">{late && late.avg < 100 ? `أضعف: ${late.salesmanName}` : health.label}</p>
                </div>
              </div>
              {goalGroups.slice(0, 4).map(group => (
                <Link key={group.salesmanId} to={`/goals?q=${encodeURIComponent(group.salesmanName)}`} className="board-row stat-link">
                  <Ring value={group.avg} size={46} tone={goalTone(group.avg)} />
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{group.salesmanName}</p>
                    <p className="truncate text-xs font-bold text-muted">{group.hit}/{group.goals.length} · {goalValue(group.goals[0].targetType, group.goals[0].sold)}</p>
                    <div className="mt-2"><Track value={group.avg} tone={goalTone(group.avg)} /></div>
                  </div>
                  <span className="text-xs font-extrabold text-muted">{goalLabel(group.avg)}</span>
                </Link>
              ))}
            </>
          ) : (
            <p className="empty-line">لا تاركت مربوط على بائع هذا الأسبوع</p>
          )}
        </section>

        <section className="panel">
          <SectionHead title="آخر الفواتير" kicker={`${insights.receipts.length} فاتورة`} to="/moves" link="الكل" />
          {recentReceipts.map(r => (
            <Link key={r.id} to={`/moves?q=${encodeURIComponent(String(r.receiptNumber || r.sellers[0] || ''))}`} className="rank-row stat-link">
              <div className="min-w-0">
                <p className="font-extrabold">{r.receiptNumber ? `#${r.receiptNumber}` : 'فاتورة'}</p>
                <p className="text-xs font-bold text-muted">{r.sellers.join(' · ') || '—'}{r.cashierName ? ` · ${r.cashierName}` : ''}</p>
              </div>
              <p className="num text-sm font-extrabold">{moneyIq(r.sales)}</p>
            </Link>
          ))}
          {!recentReceipts.length && <p className="empty-line">لا فواتير في هذه المدة</p>}
        </section>
      </div>

      {(insights.products.length > 0 || insights.hours.some(h => h.sales)) && (
        <div className="dash-split">
          {insights.products.length > 0 && (
            <section className="panel">
              <SectionHead title="أقوى المنتجات" kicker={period.label} to="/products" link="الكل" />
              {insights.products.slice(0, 6).map((p, i) => (
                <div key={p.name} className="rank-row">
                  <Medal rank={i + 1} />
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{p.name}</p>
                    <p className="text-xs font-bold text-muted">{p.count} حركة · {pct(shareOf(p.sales, periodTotals.sales))}</p>
                  </div>
                  <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
                </div>
              ))}
            </section>
          )}
          {insights.hours.some(h => h.sales) && (
            <section>
              <SectionHead title="أوقات الذروة" kicker={period.label} />
              <HourBands rows={insights.hours} />
            </section>
          )}
        </div>
      )}

      {due.length > 0 && (
        <section className="panel">
          <SectionHead title="مستحقات الفريق" kicker={moneyIq(due.reduce((s, x) => s + x.balanceDue, 0))} to="/report" link="التقرير" />
          {due.slice(0, 5).map((s, i) => (
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
