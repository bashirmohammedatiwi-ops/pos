import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { goalLabel, goalTone, goalValue, greeting, moneyIq, pieces, shownWeekAmount, shownWeekLabel, weekIsPaid, weekRange } from '../api';
import type { CommissionLine } from '../api';
import { buildInsights, fillWeekDays } from '../insights';
import { CommissionList, CommissionSheet } from '../lines';
import { useSeller } from '../store';
import { CountMoney, DayStrip, ErrorBox, Ring, SectionHead, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useSeller();
  const [open, setOpen] = useState<CommissionLine | null>(null);
  const insights = useMemo(() => buildInsights(lines), [lines]);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const weekDays = useMemo(
    () => fillWeekDays(insights.days, dash?.week.weekStart, dash?.week.weekEnd),
    [insights.days, dash],
  );

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={5} />;

  const paid = weekIsPaid(dash.week);
  const weekFigure = shownWeekAmount(dash.week);
  const weekLabel = shownWeekLabel(dash.week);
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const openGoals = dash.goals.filter(g => g.percent < 100);
  const doneGoals = dash.goals.filter(g => g.percent >= 100);
  const homeGoals = openGoals.length ? openGoals : doneGoals;
  const goalAvg = dash.goals.length ? dash.goals.reduce((s, g) => s + g.percent, 0) / dash.goals.length : 0;
  const focus = openGoals[0];

  return (
    <div className="fade-up space-y-4">
      <section className="hero">
        <p className="kicker">{greeting()}</p>
        <h1 className="display mt-1 text-[28px] font-black leading-tight">{dash.seller.name}</h1>
        <p className="mt-1 text-sm font-bold text-muted">
          {dash.week.isCurrent ? 'هذا الأسبوع' : 'أسبوع سابق'} · {weekRange(dash.week.weekStart, dash.week.weekEnd)}
        </p>
        <div className="hero-comm">
          <p className="text-sm font-extrabold text-gold">{weekLabel}</p>
          <div className="hero-num"><CountMoney value={weekFigure} /></div>
          <p className="mt-3 text-sm font-extrabold text-muted">
            {paid
              ? 'صُرف بالكامل. هذا هو المبلغ الذي استلمته، وليس عمولة الأسبوع المسجّلة.'
              : `${insights.invoiceCount} فاتورة · ${insights.itemCount} حركة`}
          </p>
        </div>
      </section>

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      <section className="due-card">
        <div>
          <p className="kicker">لم يُصرف بعد</p>
          <p className="num mt-1 text-[28px] font-extrabold">{moneyIq(dash.balanceDue)}</p>
          <p className="mt-2 text-xs font-bold text-muted">
            الأسبوع الحالي، وأي أسبوع سابق لم يُؤشَّر استلامه. الأسبوع المؤشَّر يُغلق بمبلغ الصرف.
          </p>
        </div>
      </section>

      {!paid && weekDays.length > 1 && (
        <section className="card p-4">
          <SectionHead title="أيام الأسبوع" kicker="عمولة كل يوم" />
          <DayStrip days={weekDays} today={today} />
        </section>
      )}

      <section className="card board">
        <SectionHead title="أهداف الأسبوع" kicker={dash.goals.length ? `${hit} من ${dash.goals.length}` : 'الإنجاز'} to="/goals" link="التفاصيل" />
        {dash.goals.length ? (
          <div className="board-body">
            <div className="board-ring">
              <Ring value={goalAvg} size={96} tone="goal" label="متوسط" />
            </div>
            <div>
              {homeGoals.map(g => (
                <Link key={g.ruleId} to="/goals" className="board-row stat-link">
                  <Ring value={g.percent} size={46} tone={goalTone(g.percent)} />
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
              {openGoals.length > 0 && doneGoals.length > 0 && (
                <p className="mt-2 text-xs font-bold text-muted">تحقق هذا الأسبوع: {doneGoals.length}</p>
              )}
              {focus && (
                <p className="mt-2 text-xs font-bold text-muted">الأقرب للإكمال: {focus.ruleName}</p>
              )}
              {!openGoals.length && doneGoals.length > 0 && (
                <p className="mt-2 text-xs font-bold text-ok">أتممت أهداف هذا الأسبوع. تبدأ من جديد مع الأسبوع القادم.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm font-bold text-muted">لا أهداف مربوطة باسمك بعد</p>
        )}
      </section>

      {!paid && (
        <section className="card p-4">
          <SectionHead
            title="حركات العمولة"
            kicker={insights.products[0] ? `أقواها ${insights.products[0].name} · ${pieces(insights.products[0].qty)}` : 'هذا الأسبوع'}
            to="/products"
            link="الكل"
          />
          <CommissionList lines={lines.slice(0, 6)} onOpen={setOpen} empty="لا عمولة بعد هذا الأسبوع" />
        </section>
      )}

      {dash.seller.mustChangePin && (
        <div className="card border-warn/30 bg-warn-soft px-4 py-3 text-sm font-extrabold text-warn">
          الرمز مؤقت — اطلب من الإدارة تثبيته
        </div>
      )}

      <CommissionSheet line={open} lines={lines} onClose={() => setOpen(null)} onOpen={setOpen} />
    </div>
  );
}
