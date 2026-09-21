import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { greeting, money, moneyIq, pct, shareText, weekRange, weekReport } from '../api';
import { useSeller, useWeekCompare } from '../store';
import { Bar, Delta, ErrorBox, Ring, Skeleton, Sparkline, useToast } from '../ui';
import { WeekBar } from '../week';

export function Home() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useSeller();
  const compare = useWeekCompare(weeks, weekStart);
  const toast = useToast();
  const spark = useMemo(() => [...weeks].reverse().map(w => w.salesAmount), [weeks]);
  const totals = useMemo(() => ({
    sales: weeks.reduce((s, w) => s + w.salesAmount, 0),
    comm: weeks.reduce((s, w) => s + w.commissionAmount, 0),
    best: weeks.reduce((a, b) => a.salesAmount >= b.salesAmount ? a : b, weeks[0]),
  }), [weeks]);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={6} />;

  const sales = dash.week.salesAmount;
  const commission = dash.week.commissionAmount;
  const receipts = dash.week.receiptCount;
  const avg = receipts > 0 ? sales / receipts : 0;
  const rate = sales > 0 ? (commission / sales) * 100 : 0;
  const hit = dash.goals.filter(g => g.percent >= 100).length;
  const goalAvg = dash.goals.length ? dash.goals.reduce((s, g) => s + g.percent, 0) / dash.goals.length : 0;
  const topMalls = [...dash.malls].sort((a, b) => b.salesAmount - a.salesAmount).slice(0, 3);
  const topMax = topMalls[0]?.salesAmount || 1;
  const focus = [...dash.goals].sort((a, b) => a.percent - b.percent)[0];

  async function share() {
    const result = await shareText('تقرير الأسبوع', weekReport(dash!));
    if (result === 'copied') toast('تم نسخ التقرير');
    else if (result === 'shared') toast('تمت المشاركة');
    else if (result === 'fail') toast('تعذر النسخ');
  }

  return (
    <div className="fade-up space-y-4">
      <div className="hero p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold tracking-wide text-gold">{greeting()}</p>
            <h1 className="mt-1 text-[26px] font-extrabold leading-tight">{dash.seller.name}</h1>
            <p className="mt-1 text-sm font-bold text-[#d8c4a8]">أسبوع {weekRange(dash.week.weekStart, dash.week.weekEnd)}</p>
          </div>
          <button type="button" onClick={() => void share()} className="rounded-full bg-white/10 px-3 py-2 text-xs font-extrabold text-[#f8efe3]">
            مشاركة
          </button>
        </div>
        <div className="mt-6">
          <div className="num text-[38px] font-extrabold leading-none">{money(sales)}</div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-sm font-bold text-[#d8c4a8]">مبيعات الأسبوع · د.ع</p>
            {compare.prev && <Delta value={compare.salesDelta} dark />}
          </div>
        </div>
      </div>

      {dash.seller.mustChangePin && (
        <div className="card border-warn/30 bg-warn-soft px-4 py-3 text-sm font-extrabold text-warn">
          الرمز مؤقت — اطلب من الإدارة تثبيته
        </div>
      )}

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      {dash.balanceDue > 0 && (
        <div className="banner">
          <div>
            <p className="text-[11px] font-extrabold text-gold">مستحقك الآن</p>
            <p className="num mt-1 text-[22px] font-extrabold">{moneyIq(dash.balanceDue)}</p>
          </div>
          <p className="text-xs font-bold leading-5 text-muted">عمولة غير مصروفة<br />نسبة الأسبوع {pct(rate)}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <Stat to="/products" label="العمولة" value={moneyIq(commission)} hint={compare.prev ? `${pct(compare.commDelta)} عن السابق` : 'هذا الأسبوع'} />
        <Stat label="الفواتير" value={String(receipts)} hint={avg ? `متوسط ${money(avg)}` : 'لا فواتير'} />
        <Stat to="/malls" label="المولات" value={String(dash.week.mallCount || dash.malls.length)} hint="فيها حركة" />
        <Stat to="/goals" label="الأهداف" value={dash.goals.length ? `${hit}/${dash.goals.length}` : '—'} hint={dash.goals.length ? `${pct(goalAvg)} متوسط` : 'غير مربوطة'} />
      </div>

      {compare.prev && (
        <section className="card p-4">
          <h2 className="font-extrabold">مقارنة بالأسبوع السابق</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Compare label="المبيعات" delta={compare.salesDelta} />
            <Compare label="العمولة" delta={compare.commDelta} />
          </div>
        </section>
      )}

      {spark.some(v => v > 0) && (
        <section className="card p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-extrabold">اتجاه 12 أسبوع</h2>
            <span className="text-xs font-bold text-muted">من الأقدم للأحدث</span>
          </div>
          <Sparkline values={spark} />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] font-bold text-muted">مجموع الفترة</p>
              <p className="num font-extrabold">{moneyIq(totals.sales)}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-muted">أقوى أسبوع</p>
              <p className="font-extrabold">{totals.best ? money(totals.best.salesAmount) : '—'}</p>
            </div>
          </div>
        </section>
      )}

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-extrabold">أقوى المولات</h2>
          <Link to="/malls" className="text-sm font-extrabold text-gold">الكل</Link>
        </div>
        <div className="space-y-3">
          {topMalls.map((m, i) => (
            <div key={`${m.sectionId}-${m.sectionName}`}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="font-extrabold">{['①', '②', '③'][i]} {m.sectionName}</span>
                <span className="num font-bold text-muted">{money(m.salesAmount)}</span>
              </div>
              <Bar value={m.salesAmount} max={topMax} />
            </div>
          ))}
          {!topMalls.length && <p className="text-sm font-bold text-muted">لا حركة هذا الأسبوع</p>}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-4">
              <h2 className="font-extrabold">الأهداف</h2>
              <Link to="/goals" className="text-sm font-extrabold text-gold">التفاصيل</Link>
            </div>
            {dash.goals.length
              ? <p className="text-sm font-bold text-muted">{hit} من {dash.goals.length} تحقق{focus && focus.percent < 100 ? ` · ركّز على ${focus.ruleName}` : ''}</p>
              : <p className="text-sm font-bold text-muted">لا أهداف مربوطة بك</p>}
          </div>
          {dash.goals.length > 0 && <Ring value={goalAvg} />}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint, to }: { label: string; value: string; hint: string; to?: string }) {
  const inner = (
    <div className="card p-3.5">
      <div className="text-[11px] font-extrabold text-gold">{label}</div>
      <div className="num mt-1 text-[20px] font-extrabold leading-tight">{value}</div>
      <div className="mt-1 text-[11px] font-bold leading-5 text-muted">{hint}</div>
    </div>
  );
  return to ? <Link to={to} className="stat-link">{inner}</Link> : inner;
}

function Compare({ label, delta }: { label: string; delta: number }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-muted">{label}</p>
      <div className="mt-1"><Delta value={delta} /></div>
    </div>
  );
}
