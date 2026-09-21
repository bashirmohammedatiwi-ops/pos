import { Link } from 'react-router-dom';
import { goalLabel, goalTone, goalValue, greeting, moneyIq, pieces, weekRange } from '../api';
import { useManager, useWeekCompare } from '../store';
import { Delta, ErrorBox, Medal, Ring, SectionHead, Skeleton, Track, WeekCompare } from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useManager();
  const compare = useWeekCompare(weeks, weekStart);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={7} />;

  const week = dash.week;
  const sellers = [...dash.sellers].sort((a, b) => b.commissionAmount - a.commissionAmount);
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const avg = dash.goals.length ? dash.goals.reduce((s, g) => s + g.percent, 0) / dash.goals.length : 0;
  const late = [...dash.goals].sort((a, b) => a.percent - b.percent)[0];

  return (
    <div className="fade-up space-y-4">
      <section className="hero">
        <p className="kicker">{greeting()}</p>
        <h1 className="display mt-1 text-[28px] font-black leading-tight">{dash.manager.displayName}</h1>
        <p className="mt-1 text-sm font-bold text-muted">أسبوع {weekRange(week.weekStart, week.weekEnd)}</p>
        <div className="mt-5">
          <p className="text-sm font-extrabold text-goal">مبيعات الأسبوع</p>
          <p className="hero-num num text-goal">{moneyIq(week.salesAmount)}</p>
          <div className="mt-3">{compare.prev && <Delta value={compare.salesDelta} />}</div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <p className="kicker">العمولة</p>
            <p className="num display text-[22px] font-black text-gold">{moneyIq(week.commissionAmount)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">القطع</p>
            <p className="num display text-[22px] font-black">{pieces(week.pieceCount)}</p>
          </div>
        </div>
        <div className="hero-pills">
          <span className="pill">{week.receiptCount} فاتورة</span>
          <span className="pill">{week.sellerCount} بائع</span>
          <span className="pill">{week.cashierCount} كاشير</span>
          <span className="pill">{dash.goals.length ? `${hit}/${dash.goals.length} أهداف` : 'لا أهداف'}</span>
        </div>
      </section>

      <Link to="/moves" className="piece-board stat-link">
        <div className="piece-board-main">
          <p className="kicker">قطع الفريق هذا الأسبوع</p>
          <p className="piece-num num">{Math.round(week.pieceCount)}</p>
          <p className="piece-unit">قطعة مباعة</p>
        </div>
        <div className="piece-board-side">
          <div>
            <p>الفواتير</p>
            <strong className="num">{week.receiptCount}</strong>
          </div>
          <div>
            <p>الحركات</p>
            <strong className="num">{lines.length}</strong>
          </div>
        </div>
      </Link>

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <WeekCompare cur={compare.cur} prev={compare.prev} />

      <section className="card p-4">
        <SectionHead title="أقوى البائعين" kicker="حسب العمولة" to="/team" link="الفريق" />
        {sellers.slice(0, 5).map((s, i) => (
          <Link key={s.salesmanId} to="/team" className="rank-row stat-link">
            <Medal rank={i + 1} />
            <div className="min-w-0">
              <p className="truncate font-extrabold">{s.name}</p>
              <p className="text-xs font-bold text-muted">{pieces(s.pieceCount)} · {s.receiptCount} فاتورة</p>
            </div>
            <div className="text-end">
              <p className="num text-sm font-extrabold">{moneyIq(s.salesAmount)}</p>
              <p className="num text-xs font-extrabold text-gold">{moneyIq(s.commissionAmount)}</p>
            </div>
          </Link>
        ))}
        {!sellers.length && <p className="text-sm font-bold text-muted">لا حركة هذا الأسبوع</p>}
      </section>

      <section className="card board">
        <SectionHead title="أهداف الفريق" kicker="الإنجاز" to="/goals" link="التفاصيل" />
        {dash.goals.length ? (
          <div className="board-body">
            <div className="board-ring">
              <Ring value={avg} size={118} tone="goal" label="متوسط" />
              <p className="mt-2 text-sm font-extrabold">{hit} من {dash.goals.length} تحقق</p>
              {late && late.percent < 100 && (
                <p className="mt-1 text-xs font-bold text-muted">أضعف: {late.salesmanName}</p>
              )}
            </div>
            <div>
              {dash.goals.slice(0, 4).map(g => (
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

      {dash.products.length > 0 && (
        <section className="card p-4">
          <SectionHead title="أقوى المنتجات" kicker="حسب العمولة" to="/moves" link="الحركات" />
          {dash.products.slice(0, 5).map((p, i) => (
            <div key={p.name} className="rank-row">
              <Medal rank={i + 1} />
              <div className="min-w-0">
                <p className="truncate font-extrabold">{p.name}</p>
                <p className="text-xs font-bold text-muted">{pieces(p.quantity)} · {p.count} حركة</p>
              </div>
              <div className="text-end">
                <p className="num text-sm font-extrabold">{moneyIq(p.salesAmount)}</p>
                <p className="num text-xs font-extrabold text-gold">{moneyIq(p.commissionAmount)}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
