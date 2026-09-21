import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { greeting, goalLabel, goalTone, moneyIq, shareText, weekRange, weekReport } from '../api';
import type { CommissionLine } from '../api';
import { CommissionList, CommissionSheet } from '../lines';
import { useSeller, useWeekCompare } from '../store';
import { AreaChart, Delta, Donut, ErrorBox, HeroArt, IconShare, Legend, Ring, SectionHead, Skeleton, Track, useToast } from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useSeller();
  const compare = useWeekCompare(weeks, weekStart);
  const toast = useToast();
  const [open, setOpen] = useState<CommissionLine | null>(null);
  const spark = useMemo(() => [...weeks].reverse().map(w => w.commissionAmount), [weeks]);
  const totals = useMemo(() => ({
    comm: weeks.reduce((s, w) => s + w.commissionAmount, 0),
    best: weeks.reduce((a, b) => a.commissionAmount >= b.commissionAmount ? a : b, weeks[0]),
  }), [weeks]);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={6} />;

  const commission = dash.week.commissionAmount;
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const goalAvg = dash.goals.length ? dash.goals.reduce((s, g) => s + g.percent, 0) / dash.goals.length : 0;
  const focus = [...dash.goals].sort((a, b) => a.percent - b.percent)[0];
  const topMalls = [...dash.malls].sort((a, b) => b.commissionAmount - a.commissionAmount).slice(0, 5);
  const mallTotal = topMalls.reduce((s, m) => s + m.commissionAmount, 0);
  const donutItems = topMalls.map(m => ({ label: m.sectionName, value: m.commissionAmount }));
  const legendItems = topMalls.map(m => ({
    label: m.sectionName,
    value: moneyIq(m.commissionAmount),
    share: mallTotal > 0 ? (m.commissionAmount / mallTotal) * 100 : 0,
  }));
  const preview = lines.slice(0, 5);

  async function share() {
    const result = await shareText('تقرير الأسبوع', weekReport(dash!));
    if (result === 'copied') toast('تم نسخ التقرير');
    else if (result === 'shared') toast('تمت المشاركة');
    else if (result === 'fail') toast('تعذر النسخ');
  }

  return (
    <div className="fade-up space-y-4">
      <section className="hero">
        <HeroArt />
        <div className="hero-top">
          <div>
            <p className="kicker">{greeting()}</p>
            <h1 className="mt-1 text-[26px] font-extrabold leading-tight">{dash.seller.name}</h1>
            <p className="mt-1 text-sm font-bold text-muted">أسبوع {weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
          </div>
          <button type="button" onClick={() => void share()} className="pill">
            <IconShare /> مشاركة
          </button>
        </div>
        <Link to="/products" className="hero-comm stat-link">
          <p className="text-sm font-extrabold text-gold">عمولة الأسبوع كاملة</p>
          <div className="hero-num num">{moneyIq(commission)}</div>
          <div className="mt-3">{compare.prev && <Delta value={compare.commDelta} />}</div>
          <p className="mt-2 text-xs font-extrabold text-muted">{lines.length} منتج/فاتورة — اضغط للتفاصيل</p>
        </Link>
        <div className="hero-pills">
          <span className="pill">{dash.week.mallCount || dash.malls.length} مول</span>
          <span className="pill">{dash.goals.length ? `${hit}/${dash.goals.length} أهداف` : 'لا أهداف'}</span>
          {dash.balanceDue > 0 && <span className="pill">مستحق {moneyIq(dash.balanceDue)}</span>}
        </div>
      </section>

      {dash.seller.mustChangePin && (
        <div className="card border-warn/30 bg-warn-soft px-4 py-3 text-sm font-extrabold text-warn">
          الرمز مؤقت — اطلب من الإدارة تثبيته
        </div>
      )}

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      {dash.balanceDue > 0 && (
        <div className="due-card">
          <div>
            <p className="kicker">لم يُصرف بعد</p>
            <p className="num mt-1 text-[26px] font-extrabold">{moneyIq(dash.balanceDue)}</p>
          </div>
          <Ring value={goalAvg} tone="goal" size={76} />
        </div>
      )}

      <section className="card p-4">
        <SectionHead title="آخر العمولات" kicker="منتج · فاتورة · وقت" to="/products" link="الكل" />
        <CommissionList lines={preview} onOpen={setOpen} empty="لا عمولة بعد هذا الأسبوع" />
      </section>

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

      <div className="page-grid">
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

        <section className="card p-4">
          <SectionHead title="حصة العمولة" kicker="المولات" to="/malls" link="الكل" />
          {topMalls.length ? (
            <div className="grid items-center gap-3 sm:grid-cols-[auto_1fr]">
              <Donut items={donutItems} size={150} center="حصة" />
              <Legend items={legendItems} />
            </div>
          ) : (
            <p className="text-sm font-bold text-muted">لا عمولة هذا الأسبوع</p>
          )}
        </section>
      </div>

      <CommissionSheet line={open} onClose={() => setOpen(null)} />
    </div>
  );
}
