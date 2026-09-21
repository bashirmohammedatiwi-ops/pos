import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ago, avgTicket, cashierCsv, deltaPct, downloadText, goalLabel, goalTone, goalValue, greeting,
  groupGoalsBySeller, lastSyncMs, moneyIq, pct, resolveWeekSales, shareOf, shareText,
  teamCsv, todayKey, weekRange, weekReport,
} from '../api';
import { buildAlerts, cashierShares, prevDay, sellerShares, shopHealth, weekPace } from '../insights';
import { useManager, useShopInsights, useWeekCompare } from '../store';
import {
  AreaChart, CommandRail, CountMoney, DayStrip, Delta, Donut, ErrorBox, HealthMeter, HourBands,
  InsightTile, Legend, LiveDot, Medal, Podium, QuickJump, Ring, SectionHead, ShareRow, Skeleton,
  Track, WeekCompare, useToast,
} from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, prevDash, weeks, cashiers, err, loading, cached, reload } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const insights = useShopInsights();
  const toast = useToast();
  const nav = useNavigate();
  const [day, setDay] = useState<string>();
  const [period, setPeriod] = useState<'day' | 'week'>('week');
  const due = useMemo(() => (dash?.sellers ?? []).filter(s => s.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue), [dash]);
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;
  const alerts = useMemo(() => buildAlerts(dash, prevDash, cashiers, stale), [dash, prevDash, cashiers, stale]);
  const spark = useMemo(() => [...weeks].reverse().map(w => w.salesAmount), [weeks]);
  const weekSales = resolveWeekSales(dash);
  const sellers = useMemo(() => sellerShares(dash?.sellers ?? [], weekSales || 1), [dash, weekSales]);
  const cashierRows = useMemo(() => cashierShares(cashiers, weekSales || 1), [cashiers, weekSales]);
  const goalGroups = useMemo(() => groupGoalsBySeller(dash?.goals), [dash]);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={8} />;

  const week = dash.week;
  const ticket = avgTicket(weekSales, week.receiptCount);
  const today = todayKey();
  const inWeek = insights.days.some(d => d.key === today);
  const focusDay = day || (inWeek ? today : [...insights.days].reverse().find(d => d.sales > 0)?.key);
  const dayRow = insights.days.find(d => d.key === focusDay);
  const yest = prevDay(insights.days, focusDay);
  const daySales = dayRow?.sales ?? 0;
  const dayReceipts = dayRow?.receipts ?? 0;
  const showingDay = period === 'day';
  const heroSales = showingDay ? daySales : weekSales;
  const heroReceipts = showingDay ? dayReceipts : week.receiptCount;
  const heroTicket = avgTicket(heroSales, heroReceipts);
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
    hasSales: weekSales > 0,
  });
  const dayVsYest = yest ? deltaPct(daySales, yest.sales) : 0;

  return (
    <div className="fade-up space-y-4">
      <section className="hero command">
        <div className="hero-orbs" aria-hidden><i /><i /><i /></div>
        <div className="hero-top">
          <div>
            <p className="kicker">{greeting()} · متابعة المحل</p>
            <h1 className="display mt-1 text-[28px] font-black leading-tight">{dash.manager.displayName}</h1>
            <p className="mt-1 text-sm font-bold text-muted">أسبوع {weekRange(week.weekStart, week.weekEnd)}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LiveDot stale={stale} />
            <Link to="/report" className="pill">التقرير</Link>
            <button
              type="button"
              className="pill"
              onClick={async () => {
                const extra = [
                  insights.topCashier ? `أقوى كاشير: ${insights.topCashier.name} — ${moneyIq(insights.topCashier.salesAmount)}` : '',
                  insights.bestDay ? `أقوى يوم: ${insights.bestDay.label} — ${moneyIq(insights.bestDay.sales)}` : '',
                  `إيقاع الأسبوع: متوقع ${moneyIq(pace.projected)}`,
                ].filter(Boolean);
                const result = await shareText('تقرير الأسبوع', weekReport(dash, extra));
                if (result === 'copied') toast('تم نسخ التقرير');
                else if (result === 'shared') toast('تمت المشاركة');
                else if (result === 'fail') toast('تعذر النسخ');
              }}
            >
              مشاركة
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => {
                downloadText(`فريق-${week.weekStart.slice(0, 10)}.csv`, teamCsv(dash.sellers, weekSales));
                toast('تم تنزيل تقرير البائعين');
              }}
            >
              تصدير
            </button>
          </div>
        </div>

        <div className="period-toggle">
          <button type="button" className={showingDay ? '' : 'on'} onClick={() => setPeriod('week')}>الأسبوع</button>
          <button type="button" className={showingDay ? 'on' : ''} onClick={() => setPeriod('day')}>اليوم</button>
        </div>

        <div className="hero-comm">
          <p className="text-sm font-extrabold text-goal">{showingDay ? `مبيعات ${dayRow?.label || 'اليوم'}` : 'إجمالي مبيعات الأسبوع'}</p>
          <p className="hero-num text-goal"><CountMoney value={heroSales} /></p>
          <div className="mt-3">
            {showingDay
              ? (yest ? <Delta value={dayVsYest} /> : <span className="text-xs font-extrabold text-muted">أول يوم ظاهر</span>)
              : (compare.prev && <Delta value={compare.salesDelta} />)}
          </div>
        </div>
        {spark.length > 1 && !showingDay && (
          <div className="mt-4">
            <AreaChart values={spark} height={88} />
            <p className="mt-1 text-[11px] font-bold text-muted">منحنى المبيعات عبر الأسابيع</p>
          </div>
        )}
        <div className="hero-stats kpi-mosaic">
          <div className="hero-stat">
            <p className="kicker">الفواتير</p>
            <p className="num display text-[22px] font-black">{heroReceipts}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">متوسط الفاتورة</p>
            <p className="num display text-[20px] font-black">{moneyIq(heroTicket)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">بائعون</p>
            <p className="num display text-[22px] font-black">{week.sellerCount || sellers.filter(s => s.sales > 0).length}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">كاشير</p>
            <p className="num display text-[22px] font-black">{cashiers.length || week.cashierCount}</p>
          </div>
        </div>
        <div className="hero-pills">
          <span className="pill">{goalCount ? `${hit}/${goalCount} أهداف` : 'لا أهداف مربوطة'}</span>
          {syncMs && <span className="pill">{stale ? 'المزامنة قديمة' : `مزامنة ${ago(syncMs)}`}</span>}
          <span className="pill">يوم {pace.elapsedDays} من {pace.totalDays}</span>
        </div>
        {stale && <p className="mt-3 text-sm font-extrabold text-warn">بيانات المزامنة قديمة — افتح لوحة التحكم حتى تُرفع من جديد</p>}
      </section>

      <CommandRail items={[
        {
          kicker: 'اليوم مقابل أمس',
          value: moneyIq(daySales),
          hint: yest ? `${yest.label} كان ${moneyIq(yest.sales)}` : 'لا يوم سابق في هذا الأسبوع',
          tone: daySales >= (yest?.sales ?? 0) ? 'gold' : 'warn',
        },
        {
          kicker: 'إيقاع الأسبوع',
          value: moneyIq(pace.projected),
          hint: `متوسط اليوم ${moneyIq(pace.dailyAvg)}`,
          tone: 'goal',
        },
        {
          kicker: 'المتبقي من الأسبوع',
          value: pace.remainingDays ? `${pace.remainingDays} يوم` : 'اليوم الأخير',
          hint: `مرّ ${pace.elapsedDays} من ${pace.totalDays}`,
          tone: pace.remainingDays <= 1 ? 'warn' : 'ok',
        },
        {
          kicker: 'صحة المحل',
          value: `${health.score}`,
          hint: health.label,
          tone: health.tone === 'gold' ? 'gold' : health.tone,
        },
      ]} />

      <div className="period-grid">
        <button type="button" className={`period-card ${showingDay ? 'on' : ''}`} onClick={() => setPeriod('day')}>
          <p className="kicker">إحصاء اليوم</p>
          <p className="num mt-1 text-[22px] font-black text-goal">{moneyIq(daySales)}</p>
          <p className="mt-1 text-xs font-extrabold text-muted">{dayReceipts} فاتورة · متوسط {moneyIq(avgTicket(daySales, dayReceipts))}</p>
        </button>
        <button type="button" className={`period-card ${showingDay ? '' : 'on'}`} onClick={() => setPeriod('week')}>
          <p className="kicker">إحصاء الأسبوع</p>
          <p className="num mt-1 text-[22px] font-black text-goal">{moneyIq(weekSales)}</p>
          <p className="mt-1 text-xs font-extrabold text-muted">{week.receiptCount} فاتورة · متوسط {moneyIq(ticket)}</p>
        </button>
      </div>

      <HealthMeter score={health.score} label={health.label} tone={health.tone} />

      {(cached || alerts.length > 0) && (
        <div className="space-y-2">
          {cached && <p className="text-sm font-extrabold text-muted">تُعرض بيانات محفوظة حتى تكتمل المزامنة</p>}
          {alerts.slice(0, 3).map(a => (
            <Link key={a.id} to={a.to === '/' ? '/watch' : a.to} className={`card alert-card ${a.tone} stat-link`}>
              <p className="font-extrabold">{a.title}</p>
              <p className="mt-1 text-sm font-bold text-muted">{a.hint}</p>
            </Link>
          ))}
          {alerts.length > 3 && <Link to="/watch" className="section-link">كل التنبيهات</Link>}
        </div>
      )}

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <WeekCompare cur={compare.cur} prev={compare.prev} salesDelta={compare.salesDelta} receiptDelta={compare.receiptDelta} />

      {sellers.some(s => s.sales > 0) && (
        <section className="card p-4">
          <SectionHead title="منصة الأقوى" kicker="أعلى ثلاثة بائعين" to="/team" link="كل الفريق" />
          <Podium
            items={sellers.filter(s => s.sales > 0).slice(0, 3).map(s => ({
              id: s.id,
              name: s.name,
              value: moneyIq(s.sales),
              hint: `${s.receipts} فاتورة · ${pct(s.share)}`,
            }))}
            onPick={item => nav(`/team?q=${encodeURIComponent(item.name)}`)}
          />
        </section>
      )}

      <div className="insight-grid">
        {insights.topSeller && (
          <Link to={`/team?q=${encodeURIComponent(insights.topSeller.name)}`} className="stat-link">
            <InsightTile kicker="أقوى بائع" title={insights.topSeller.name} value={moneyIq(insights.topSeller.salesAmount)} hint={`${pct(shareOf(insights.topSeller.salesAmount, weekSales))} من المبيعات`} tone="goal" />
          </Link>
        )}
        {insights.topCashier && (
          <Link to={`/cashiers?q=${encodeURIComponent(insights.topCashier.name)}`} className="stat-link">
            <InsightTile kicker="أقوى كاشير" title={insights.topCashier.name} value={moneyIq(insights.topCashier.salesAmount)} hint={`${insights.topCashier.receiptCount} فاتورة`} />
          </Link>
        )}
        {insights.bestDay && (
          <button type="button" className="stat-link" onClick={() => { setDay(insights.bestDay?.key); setPeriod('day'); }}>
            <InsightTile kicker="أقوى يوم" title={insights.bestDay.label} value={moneyIq(insights.bestDay.sales)} hint={`${insights.bestDay.receipts} فاتورة`} tone="amber" />
          </button>
        )}
        {insights.bestProduct && (
          <Link to={`/moves?q=${encodeURIComponent(insights.bestProduct.name)}`} className="stat-link">
            <InsightTile kicker="أقوى منتج" title={insights.bestProduct.name} value={moneyIq(insights.bestProduct.sales)} hint={`${insights.bestProduct.count} حركة`} />
          </Link>
        )}
      </div>

      {insights.days.length > 0 && (
        <section className="card p-4">
          <SectionHead title="المبيعات يوماً بيوم" kicker={day ? `يوم ${insights.days.find(d => d.key === day)?.label || ''}` : 'كل أيام الأسبوع'} />
          <DayStrip
            days={insights.days}
            today={today}
            active={day || (showingDay ? focusDay : undefined)}
            onSelect={key => {
              setDay(d => d === key ? undefined : key);
              setPeriod('day');
            }}
          />
          {(day || showingDay) && dayRow && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-extrabold">مبيعات {dayRow.label} {moneyIq(dayRow.sales)} · {dayRow.receipts} فاتورة</p>
              <Link to={`/moves?day=${dayRow.key}`} className="section-link">فواتير اليوم</Link>
            </div>
          )}
        </section>
      )}

      {insights.hours.some(h => h.sales) && (
        <section>
          <SectionHead title="أوقات الذروة" kicker="صباح / ظهر / مساء / ليل" />
          <HourBands rows={insights.hours} />
        </section>
      )}

      <div className="page-grid">
        <section className="card p-4">
          <SectionHead title="حصة كل بائع" kicker="من إجمالي المبيعات" to="/team" link="كل الفريق" />
          {sellers.slice(0, 6).map((s, i) => (
            <ShareRow key={s.id} rank={i + 1} row={s} onClick={() => nav(`/team?q=${encodeURIComponent(s.name)}`)} />
          ))}
          {!sellers.length && <p className="text-sm font-bold text-muted">لا بائعون هذا الأسبوع</p>}
        </section>
        <section className="card p-4">
          <div className="flex justify-center">{sellers.length > 0 && <Donut items={sellers.slice(0, 6).map(s => ({ label: s.name, value: s.sales }))} center="بائعون" />}</div>
          {sellers.length > 0 && (
            <Legend items={sellers.slice(0, 6).map(s => ({ label: s.name, value: pct(s.share) }))} />
          )}
        </section>
      </div>

      <section className="card p-4">
        <SectionHead
          title="أداء كل كاشير"
          kicker="إجمالي ما باعه كل كاشير"
          to="/cashiers"
          link="التفاصيل"
          action={(
            <button
              type="button"
              className="section-link"
              onClick={() => {
                downloadText(`كاشير-${week.weekStart.slice(0, 10)}.csv`, cashierCsv(cashiers, weekSales));
                toast('تم تنزيل تقرير الكاشير');
              }}
            >
              تصدير
            </button>
          )}
        />
        {cashierRows.length > 2 && (
          <div className="mb-3">
            <Podium
              items={cashierRows.slice(0, 3).map(c => ({
                id: c.id,
                name: c.name,
                value: moneyIq(c.sales),
                hint: `${c.receipts} فاتورة`,
              }))}
              onPick={item => nav(`/cashiers?q=${encodeURIComponent(item.name)}`)}
            />
          </div>
        )}
        {cashierRows.slice(0, 6).map((c, i) => (
          <ShareRow key={c.id} rank={i + 1} row={c} onClick={() => nav(`/cashiers?q=${encodeURIComponent(c.name)}`)} />
        ))}
        {!cashierRows.length && <p className="text-sm font-bold text-muted">لم تُرفع أسماء الكاشير بعد</p>}
      </section>

      <section className="card board">
        <SectionHead title="التاركت حسب البائع" kicker="المربوطون فقط" to="/goals" link="الكل" />
        {goalGroups.length ? (
          <div className="board-body">
            <div className="board-ring">
              <Ring value={avg} size={118} tone="goal" label="متوسط" />
              <p className="mt-2 text-sm font-extrabold">{hit} من {goalCount} تحقق</p>
              {late && late.avg < 100 && (
                <p className="mt-1 text-xs font-bold text-muted">أضعف: {late.salesmanName}</p>
              )}
            </div>
            <div>
              {goalGroups.slice(0, 5).map(group => (
                <Link key={group.salesmanId} to={`/goals?q=${encodeURIComponent(group.salesmanName)}`} className="board-row stat-link">
                  <Ring value={group.avg} size={52} tone={goalTone(group.avg)} />
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{group.salesmanName}</p>
                    <p className="truncate text-xs font-bold text-muted">{group.goals.length} تاركت · {group.hit} تحقق</p>
                    <p className="mt-1 text-xs font-extrabold text-gold">
                      {goalValue(group.goals[0].targetType, group.goals[0].sold)} من {goalValue(group.goals[0].targetType, group.goals[0].weeklyTarget)}
                    </p>
                    <div className="mt-2"><Track value={group.avg} tone={goalTone(group.avg)} /></div>
                  </div>
                  <span className="text-xs font-extrabold text-muted">{goalLabel(group.avg)}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm font-bold text-muted">لا تاركت مربوط على بائع هذا الأسبوع</p>
        )}
      </section>

      <QuickJump links={[
        { to: '/watch', label: 'المتابعة', hint: alerts.length ? `${alerts.length} تنبيه` : 'لا تنبيهات' },
        { to: '/products', label: 'المنتجات', hint: insights.products[0]?.name || 'ماذا يُباع' },
        { to: '/report', label: 'التقرير', hint: 'يومي وأسبوعي' },
        { to: '/moves', label: 'الفواتير', hint: showingDay && dayRow ? dayRow.label : 'كل الحركات' },
      ]} />

      <Link to="/report" className="card banner stat-link">
        <div>
          <p className="kicker">تقرير كامل</p>
          <p className="font-extrabold">أيام الأسبوع ومقارنة كل بائع بالأسبوع السابق</p>
        </div>
        <span className="section-link">افتح</span>
      </Link>

      {due.length > 0 && (
        <section className="card p-4">
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

      {insights.products.length > 0 && (
        <section className="card p-4">
          <SectionHead title="أقوى المنتجات" kicker="حسب المبيعات" to="/moves" link="الفواتير" />
          {insights.products.slice(0, 8).map((p, i) => (
            <div key={p.name} className="rank-row">
              <Medal rank={i + 1} />
              <div className="min-w-0">
                <p className="truncate font-extrabold">{p.name}</p>
                <p className="text-xs font-bold text-muted">{p.count} حركة · {pct(shareOf(p.sales, weekSales))}</p>
              </div>
              <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
