import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { commissionCsv, deltaPct, downloadText, goalValue, greeting, goalLabel, goalTone, moneyIq, pieces, shareText, weekRange, weekReport } from '../api';
import type { CommissionLine } from '../api';
import { buildInsights, fillWeekDays, prevDay, weekPace } from '../insights';
import { CommissionList, CommissionSheet } from '../lines';
import { useSeller, useWeekCompare } from '../store';
import {
  AreaChart, CommandRail, CountMoney, DayStrip, Delta, ErrorBox, HeroArt, HourBands, IconShare,
  InsightTile, LiveDot, Medal, Podium, QuickJump, Ring, SectionHead, Skeleton, Track, WeekCompare, useToast,
} from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useSeller();
  const compare = useWeekCompare(weeks, weekStart);
  const toast = useToast();
  const [open, setOpen] = useState<CommissionLine | null>(null);
  const [period, setPeriod] = useState<'day' | 'week'>('week');
  const [day, setDay] = useState<string>();
  const spark = useMemo(() => [...weeks].reverse().map(w => w.commissionAmount), [weeks]);
  const totals = useMemo(() => ({
    comm: weeks.reduce((s, w) => s + w.commissionAmount, 0),
    best: weeks.reduce((a, b) => a.commissionAmount >= b.commissionAmount ? a : b, weeks[0]),
  }), [weeks]);
  const weekInsights = useMemo(() => buildInsights(lines), [lines]);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const weekDays = useMemo(
    () => fillWeekDays(weekInsights.days, dash?.week.weekStart, dash?.week.weekEnd),
    [weekInsights.days, dash],
  );
  const focusDay = day
    || (weekDays.some(d => d.key === today) ? today : [...weekDays].reverse().find(d => d.commission > 0)?.key);
  const scopedLines = useMemo(() => {
    if (period !== 'day' || !focusDay) return lines;
    return lines.filter(l => l.occurredAt.slice(0, 10) === focusDay);
  }, [lines, period, focusDay]);
  const insights = useMemo(
    () => (period === 'day' ? buildInsights(scopedLines) : weekInsights),
    [period, scopedLines, weekInsights],
  );

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={7} />;

  const commission = dash.week.commissionAmount;
  const dayRow = weekDays.find(d => d.key === focusDay);
  const yest = prevDay(weekDays, focusDay);
  const dayComm = dayRow?.commission ?? 0;
  const showingDay = period === 'day';
  const heroComm = showingDay ? dayComm : commission;
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const goalAvg = dash.goals.length ? dash.goals.reduce((s, g) => s + g.percent, 0) / dash.goals.length : 0;
  const focus = [...dash.goals].sort((a, b) => a.percent - b.percent)[0];
  const preview = scopedLines.slice(0, 6);
  const allGoals = dash.goals.length > 0 && hit === dash.goals.length;
  const pace = weekPace(dash.week.weekStart, dash.week.weekEnd, commission, today);
  const remainGoal = focus && focus.percent < 100 ? Math.max(0, focus.weeklyTarget - focus.sold) : 0;
  const dayVsYest = yest ? deltaPct(dayComm, yest.commission) : 0;

  async function share() {
    const extra = [
      insights.bestProduct ? `أفضل منتج: ${insights.bestProduct.name} — ${moneyIq(insights.bestProduct.commission)}` : '',
      insights.bestDay ? `أقوى يوم: ${insights.bestDay.label} — ${moneyIq(insights.bestDay.commission)}` : '',
    ].filter(Boolean);
    const result = await shareText('تقرير الأسبوع', weekReport(dash!, extra));
    if (result === 'copied') toast('تم نسخ التقرير');
    else if (result === 'shared') toast('تمت المشاركة');
    else if (result === 'fail') toast('تعذر النسخ');
  }

  return (
    <div className="fade-up space-y-4">
      <section className="hero command">
        <div className="hero-orbs" aria-hidden><i /><i /><i /></div>
        <HeroArt />
        <div className="hero-top">
          <div>
            <p className="kicker">{greeting()}</p>
            <h1 className="display mt-1 text-[28px] font-black leading-tight">{dash.seller.name}</h1>
            <p className="mt-1 text-sm font-bold text-muted">أسبوع {weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LiveDot />
            <button type="button" onClick={() => void share()} className="pill">
              <IconShare /> مشاركة
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => {
                downloadText(`عمولة-${dash.week.weekStart.slice(0, 10)}.csv`, commissionCsv(lines));
                toast('تم تنزيل ملف العمولة');
              }}
            >
              تصدير
            </button>
          </div>
        </div>
        <div className="period-toggle">
          <button type="button" className={showingDay ? '' : 'on'} onClick={() => { setPeriod('week'); setDay(undefined); }}>الأسبوع</button>
          <button type="button" className={showingDay ? 'on' : ''} onClick={() => setPeriod('day')}>اليوم</button>
        </div>
        <Link to="/products" className="hero-comm stat-link">
          <p className="text-sm font-extrabold text-gold">{showingDay ? `عمولة ${dayRow?.label || 'اليوم'}` : 'عمولة الأسبوع'}</p>
          <div className="hero-num"><CountMoney value={heroComm} /></div>
          <div className="mt-3">
            {showingDay
              ? (yest ? <Delta value={dayVsYest} /> : <span className="text-xs font-extrabold text-muted">أول يوم ظاهر</span>)
              : (compare.prev && <Delta value={compare.commDelta} />)}
          </div>
          <p className="mt-2 text-xs font-extrabold text-muted">
            {showingDay ? `${dayRow?.count || 0} حركة · ${dayRow?.qty ? Math.round(dayRow.qty) : 0} قطعة` : `${insights.itemCount} حركة · ${insights.invoiceCount} فاتورة`}
          </p>
        </Link>
        <div className="hero-pills">
          <span className="pill">{dash.goals.length ? `${hit}/${dash.goals.length} أهداف` : 'لا أهداف'}</span>
          {dash.balanceDue > 0 && <span className="pill">مستحق {moneyIq(dash.balanceDue)}</span>}
          <span className="pill">يوم {pace.elapsedDays} من {pace.totalDays}</span>
        </div>
      </section>

      <CommandRail items={[
        {
          kicker: 'اليوم مقابل أمس',
          value: moneyIq(dayComm),
          hint: yest ? `${yest.label} كان ${moneyIq(yest.commission)}` : 'لا يوم سابق',
          tone: dayComm >= (yest?.commission ?? 0) ? 'gold' : 'warn',
        },
        {
          kicker: 'إيقاع العمولة',
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
          kicker: 'أقرب هدف',
          value: focus ? `${Math.round(focus.percent)}٪` : '—',
          hint: focus
            ? (remainGoal > 0 ? `متبقي ${goalValue(focus.targetType, remainGoal)}` : 'مكتمل')
            : 'لا هدف مربوط',
          tone: focus ? (focus.percent >= 100 ? 'ok' : focus.percent >= 80 ? 'goal' : 'warn') : 'gold',
        },
      ]} />

      <div className="period-grid">
        <button type="button" className={`period-card ${showingDay ? 'on' : ''}`} onClick={() => setPeriod('day')}>
          <p className="kicker">إحصاء اليوم</p>
          <p className="num mt-1 text-[22px] font-black text-gold">{moneyIq(dayComm)}</p>
          <p className="mt-1 text-xs font-extrabold text-muted">{dayRow?.count || 0} حركة · {dayRow?.qty ? Math.round(dayRow.qty) : 0} قطعة</p>
        </button>
        <button type="button" className={`period-card ${showingDay ? '' : 'on'}`} onClick={() => { setPeriod('week'); setDay(undefined); }}>
          <p className="kicker">إحصاء الأسبوع</p>
          <p className="num mt-1 text-[22px] font-black text-gold">{moneyIq(commission)}</p>
          <p className="mt-1 text-xs font-extrabold text-muted">{weekInsights.invoiceCount} فاتورة · {weekInsights.itemCount} حركة</p>
        </button>
      </div>

      {dash.seller.mustChangePin && (
        <div className="card border-warn/30 bg-warn-soft px-4 py-3 text-sm font-extrabold text-warn">
          الرمز مؤقت — اطلب من الإدارة تثبيته
        </div>
      )}

      {allGoals && (
        <div className="win-banner">
          <Ring value={100} size={52} tone="ok" />
          <div>
            <p className="text-sm font-extrabold text-ok">كل أهداف الأسبوع تحققت</p>
            <p className="text-xs font-bold text-muted">استمر بنفس الإيقاع — العمولة تُحسب كاملة</p>
          </div>
        </div>
      )}

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <WeekCompare cur={compare.cur} prev={compare.prev} />

      {insights.products.length > 0 && (
        <section className="card p-4">
          <SectionHead title="أقوى منتجاتك" kicker="حسب العمولة" to="/products" link="التفاصيل" />
          <Podium
            items={insights.products.slice(0, 3).map(p => ({
              id: p.name,
              name: p.name,
              value: moneyIq(p.commission),
              hint: `${p.count} حركة · ${pieces(p.qty)}`,
            }))}
          />
        </section>
      )}

      <div className="insight-grid stagger">
        <InsightTile
          kicker="ذروة الوقت"
          title={insights.peakHour?.label || '—'}
          value={insights.peakHour ? moneyIq(insights.peakHour.commission) : '—'}
        />
        <InsightTile
          kicker="أفضل منتج"
          title={insights.bestProduct?.name || '—'}
          value={insights.bestProduct ? moneyIq(insights.bestProduct.commission) : '—'}
          tone="goal"
        />
        <InsightTile
          kicker="أقوى يوم"
          title={insights.bestDay?.label || '—'}
          value={insights.bestDay ? moneyIq(insights.bestDay.commission) : '—'}
          hint={insights.bestDay?.weekday}
          tone="amber"
        />
        <InsightTile
          kicker={showingDay ? 'فواتير اليوم' : 'فواتير الأسبوع'}
          title={`${insights.invoiceCount} فاتورة`}
          value={`${insights.itemCount} حركة`}
        />
      </div>

      {dash.balanceDue > 0 && (
        <div className="due-card">
          <div>
            <p className="kicker">لم يُصرف بعد</p>
            <p className="num mt-1 text-[26px] font-extrabold">{moneyIq(dash.balanceDue)}</p>
          </div>
          <Ring value={goalAvg} tone="goal" size={76} />
        </div>
      )}

      {weekDays.length > 1 && (
        <section className="card p-4">
          <SectionHead title="إيقاع الأسبوع" kicker="عمولة كل يوم" />
          <DayStrip
            days={weekDays}
            today={today}
            active={showingDay ? focusDay : undefined}
            onSelect={key => {
              setDay(d => d === key ? undefined : key);
              setPeriod('day');
            }}
          />
        </section>
      )}

      {lines.length > 0 && (
        <section>
          <SectionHead title="أوقات النشاط" kicker="حسب وقت الفاتورة" />
          <HourBands rows={insights.hours} />
        </section>
      )}

      <section className="card p-4">
        <SectionHead title="آخر العمولات" kicker="منتج · فاتورة · وقت" to="/products" link="الكل" />
        <CommissionList lines={preview} onOpen={setOpen} empty="لا عمولة بعد هذا الأسبوع" />
      </section>

      {insights.products.length > 0 && (
        <section className="card p-4">
          <SectionHead title="أقوى المنتجات" kicker="حسب العمولة" to="/products" link="التفاصيل" />
          {insights.products.slice(0, 5).map((p, i) => (
            <div key={p.name} className="rank-row">
              <Medal rank={i + 1} />
              <div className="min-w-0">
                <p className="truncate font-extrabold">{p.name}</p>
                <p className="text-xs font-bold text-muted">{p.count} حركة · {pieces(p.qty)}</p>
              </div>
              <p className="num text-sm font-extrabold text-gold">{moneyIq(p.commission)}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card board">
        <SectionHead title="أهداف الأسبوع" kicker="الإنجاز" to="/goals" link="التفاصيل" />
        {dash.goals.length ? (
          <div className="board-body">
            <div className="board-ring">
              <Ring value={goalAvg} size={118} tone="goal" label="متوسط" />
              <p className="mt-2 text-sm font-extrabold">{hit} من {dash.goals.length} تحقق</p>
              {focus && focus.percent < 100 && (
                <p className="mt-1 text-xs font-bold text-muted">ركّز على {focus.ruleName}</p>
              )}
            </div>
            <div>
              {dash.goals.slice(0, 4).map(g => (
                <Link key={g.ruleId} to="/goals" className="board-row stat-link">
                  <Ring value={g.percent} size={52} tone={goalTone(g.percent)} />
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{g.ruleName}</p>
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
          <p className="text-sm font-bold text-muted">لا أهداف مربوطة باسمك بعد</p>
        )}
      </section>

      <QuickJump links={[
        { to: '/goals', label: 'أهدافي', hint: dash.goals.length ? `${hit} من ${dash.goals.length} تحقق` : 'لا أهداف' },
        { to: '/products', label: 'عمولتي', hint: `${insights.itemCount} حركة` },
      ]} />

      {spark.some(v => v > 0) && (
        <section className="card p-4">
          <SectionHead title="مسار العمولة" kicker="١٢ أسبوعاً" />
          <AreaChart values={spark} />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] font-bold text-muted">مجموع الفترة</p>
              <p className="num font-extrabold text-gold">{moneyIq(totals.comm)}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-muted">أقوى أسبوع</p>
              <p className="num font-extrabold">{totals.best ? moneyIq(totals.best.commissionAmount) : '—'}</p>
            </div>
          </div>
        </section>
      )}

      <CommissionSheet line={open} lines={lines} onClose={() => setOpen(null)} onOpen={setOpen} />
    </div>
  );
}
