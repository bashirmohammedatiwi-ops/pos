import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ago, avgTicket, cashierCsv, downloadText, goalLabel, goalTone, goalValue, greeting, lastSyncMs, moneyIq, pieces, pct, shareOf, shareText, teamCsv, weekRange, weekReport } from '../api';
import { buildAlerts, cashierShares, sellerShares } from '../insights';
import { useManager, useShopInsights, useWeekCompare } from '../store';
import {
  AreaChart, CountMoney, DayStrip, Delta, Donut, ErrorBox, HourBands, InsightTile, Legend, Medal,
  Ring, SectionHead, ShareRow, Skeleton, Track, WeekCompare, useToast,
} from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, prevDash, weeks, lines, cashiers, err, loading, cached, reload } = useManager();
  const compare = useWeekCompare(weeks, weekStart);
  const insights = useShopInsights();
  const toast = useToast();
  const nav = useNavigate();
  const [day, setDay] = useState<string>();
  const due = useMemo(() => (dash?.sellers ?? []).filter(s => s.balanceDue > 0).sort((a, b) => b.balanceDue - a.balanceDue), [dash]);
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;
  const alerts = useMemo(() => buildAlerts(dash, prevDash, cashiers, stale), [dash, prevDash, cashiers, stale]);

  const spark = useMemo(() => [...weeks].reverse().map(w => w.salesAmount || w.commissionAmount), [weeks]);
  const sellers = useMemo(() => sellerShares(dash?.sellers ?? [], dash?.week.salesAmount || 1), [dash]);
  const cashierRows = useMemo(() => cashierShares(cashiers, dash?.week.salesAmount || 1), [cashiers, dash]);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={8} />;

  const week = dash.week;
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const avg = dash.goals.length ? dash.goals.reduce((s, g) => s + g.percent, 0) / dash.goals.length : 0;
  const late = [...dash.goals].sort((a, b) => a.percent - b.percent)[0];
  const ticket = avgTicket(week.salesAmount, week.receiptCount);
  const dayLines = day ? lines.filter(l => l.occurredAt.slice(0, 10) === day) : lines;
  const daySales = dayLines.reduce((s, l) => s + l.salesAmount, 0);

  return (
    <div className="fade-up space-y-4">
      <section className="hero">
        <div className="hero-orbs" aria-hidden><i /><i /><i /></div>
        <div className="hero-top">
          <div>
            <p className="kicker">{greeting()} · متابعة المحل</p>
            <h1 className="display mt-1 text-[28px] font-black leading-tight">{dash.manager.displayName}</h1>
            <p className="mt-1 text-sm font-bold text-muted">أسبوع {weekRange(week.weekStart, week.weekEnd)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/report" className="pill">التقرير</Link>
            <button
              type="button"
              className="pill"
              onClick={async () => {
                const extra = [
                  insights.topCashier ? `أقوى كاشير: ${insights.topCashier.name} — ${moneyIq(insights.topCashier.salesAmount)}` : '',
                  insights.bestDay ? `أقوى يوم: ${insights.bestDay.label} — ${moneyIq(insights.bestDay.sales)}` : '',
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
                downloadText(`فريق-${week.weekStart.slice(0, 10)}.csv`, teamCsv(dash.sellers, week.salesAmount));
                toast('تم تنزيل تقرير البائعين');
              }}
            >
              تصدير
            </button>
          </div>
        </div>
        <div className="hero-comm">
          <p className="text-sm font-extrabold text-goal">إجمالي مبيعات الأسبوع</p>
          <p className="hero-num text-goal"><CountMoney value={week.salesAmount} /></p>
          <div className="mt-3">{compare.prev && <Delta value={compare.salesDelta} />}</div>
        </div>
        {spark.length > 1 && (
          <div className="mt-4">
            <AreaChart values={spark} height={88} />
            <p className="mt-1 text-[11px] font-bold text-muted">منحنى المبيعات عبر الأسابيع المرفوعة</p>
          </div>
        )}
        <div className="hero-stats kpi-mosaic">
          <div className="hero-stat">
            <p className="kicker">العمولة</p>
            <p className="num display text-[22px] font-black text-gold">{moneyIq(week.commissionAmount)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">القطع</p>
            <p className="num display text-[22px] font-black">{pieces(week.pieceCount)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">الفواتير</p>
            <p className="num display text-[22px] font-black">{week.receiptCount}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">متوسط الفاتورة</p>
            <p className="num display text-[20px] font-black">{moneyIq(ticket)}</p>
          </div>
        </div>
        <div className="hero-pills">
          <span className="pill">{week.sellerCount} بائع</span>
          <span className="pill">{cashiers.length || week.cashierCount} كاشير</span>
          <span className="pill">{insights.invoiceCount} فاتورة مفصّلة</span>
          <span className="pill">{dash.goals.length ? `${hit}/${dash.goals.length} أهداف` : 'لا أهداف'}</span>
          {syncMs && <span className="pill">{stale ? 'المزامنة قديمة' : `مزامنة ${ago(syncMs)}`}</span>}
        </div>
        {stale && <p className="mt-3 text-sm font-extrabold text-warn">بيانات المزامنة قديمة — افتح لوحة التحكم حتى تُرفع من جديد</p>}
        {week.salesAmount <= 0 && week.commissionAmount > 0 && (
          <p className="mt-3 text-sm font-bold text-muted">إجمالي المبيعات يظهر بالكامل بعد تحديث سيرفر المحل 2.2.68</p>
        )}
      </section>

      <Link to="/moves" className="piece-board stat-link">
        <div>
          <p className="kicker">قطع الفريق هذا الأسبوع</p>
          <p className="piece-num num">{Math.round(week.pieceCount)}</p>
          <p className="piece-unit">قطعة مباعة</p>
        </div>
        <div className="piece-board-side">
          <div>
            <p>الحركات</p>
            <strong className="num">{lines.length}</strong>
          </div>
          <div>
            <p>منتجات</p>
            <strong className="num">{insights.products.length}</strong>
          </div>
        </div>
      </Link>

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
      <WeekCompare cur={compare.cur} prev={compare.prev} salesDelta={compare.salesDelta} commDelta={compare.commDelta} pieceDelta={compare.pieceDelta} />

      <div className="insight-grid">
        {insights.topSeller && (
          <Link to={`/team?q=${encodeURIComponent(insights.topSeller.name)}`} className="stat-link">
            <InsightTile kicker="أقوى بائع" title={insights.topSeller.name} value={moneyIq(insights.topSeller.salesAmount)} hint={`${pct(shareOf(insights.topSeller.salesAmount, week.salesAmount))} من المبيعات`} tone="goal" />
          </Link>
        )}
        {insights.topCashier && (
          <Link to={`/cashiers?q=${encodeURIComponent(insights.topCashier.name)}`} className="stat-link">
            <InsightTile kicker="أقوى كاشير" title={insights.topCashier.name} value={moneyIq(insights.topCashier.salesAmount)} hint={`${pieces(insights.topCashier.pieceCount)} · ${insights.topCashier.receiptCount} فاتورة`} />
          </Link>
        )}
        {insights.bestDay && (
          <Link to="/report" className="stat-link">
            <InsightTile kicker="أقوى يوم" title={insights.bestDay.label} value={moneyIq(insights.bestDay.sales)} hint={`${insights.bestDay.receipts} فاتورة`} tone="amber" />
          </Link>
        )}
        {insights.bestProduct && (
          <Link to={`/moves?q=${encodeURIComponent(insights.bestProduct.name)}`} className="stat-link">
            <InsightTile kicker="أقوى منتج" title={insights.bestProduct.name} value={moneyIq(insights.bestProduct.sales)} hint={pieces(insights.bestProduct.qty)} />
          </Link>
        )}
      </div>

      {insights.days.length > 0 && (
        <section className="card p-4">
          <SectionHead title="المبيعات يوماً بيوم" kicker={day ? `يوم ${insights.days.find(d => d.key === day)?.label || ''}` : 'كل أيام الأسبوع'} />
          <DayStrip days={insights.days} active={day} onSelect={key => setDay(d => d === key ? undefined : key)} />
          {day && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-extrabold">مبيعات اليوم {moneyIq(daySales)} · {dayLines.length} حركة</p>
              <Link to={`/moves?day=${day}`} className="section-link">فواتير اليوم</Link>
            </div>
          )}
        </section>
      )}

      {insights.hours.some(h => h.sales || h.commission) && (
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
                downloadText(`كاشير-${week.weekStart.slice(0, 10)}.csv`, cashierCsv(cashiers, week.salesAmount));
                toast('تم تنزيل تقرير الكاشير');
              }}
            >
              تصدير
            </button>
          )}
        />
        {cashierRows.slice(0, 6).map((c, i) => (
          <ShareRow key={c.id} rank={i + 1} row={c} onClick={() => nav(`/cashiers?q=${encodeURIComponent(c.name)}`)} />
        ))}
        {!cashierRows.length && <p className="text-sm font-bold text-muted">لم تُرفع أسماء الكاشير بعد — تظهر بعد مزامنة السيرفر 2.2.67</p>}
      </section>

      <section className="card board">
        <SectionHead title="أهداف الفريق" kicker="الإنجاز" to="/goals" link="المتابعة" />
        {dash.goals.length ? (
          <div className="board-body">
            <div className="board-ring">
              <Ring value={avg} size={118} tone="goal" label="متوسط" />
              <p className="mt-2 text-sm font-extrabold">{hit} من {dash.goals.length} تحقق</p>
              {late && late.percent < 100 && (
                <p className="mt-1 text-xs font-bold text-muted">أضعف: {late.salesmanName} · {goalLabel(late.percent)}</p>
              )}
            </div>
            <div>
              {dash.goals.slice(0, 5).map(g => (
                <Link key={`${g.ruleId}-${g.salesmanId}`} to="/goals" className="board-row stat-link">
                  <Ring value={g.percent} size={52} tone={goalTone(g.percent)} />
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{g.salesmanName}</p>
                    <p className="truncate text-xs font-bold text-muted">{g.ruleName}</p>
                    <p className="mt-1 text-xs font-extrabold text-gold">
                      {goalValue(g.targetType, g.sold)} من {goalValue(g.targetType, g.weeklyTarget)}
                    </p>
                    <div className="mt-2"><Track value={g.percent} tone={goalTone(g.percent)} /></div>
                  </div>
                  <span className="text-xs font-extrabold text-muted">{goalLabel(g.percent)}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm font-bold text-muted">لا أهداف مربوطة هذا الأسبوع</p>
        )}
      </section>

      <div className="toolbar">
        <Link to="/watch" className="pill">المتابعة</Link>
        <Link to="/products" className="pill">المنتجات</Link>
        <Link to="/report" className="pill">التقرير</Link>
      </div>
      <Link to="/report" className="card banner stat-link">
        <div>
          <p className="kicker">تقرير كامل</p>
          <p className="font-extrabold">جدول الأسابيع ومقارنة كل بائع بالأسبوع السابق</p>
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
                <p className="text-xs font-bold text-muted">{pieces(p.qty)} · {p.count} حركة · {pct(shareOf(p.sales, week.salesAmount))}</p>
              </div>
              <div className="text-end">
                <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
                <p className="num text-xs font-extrabold text-gold">{moneyIq(p.commission)}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
