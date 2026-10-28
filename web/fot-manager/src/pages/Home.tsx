import { useMemo, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ago, avgTicket, clockLabel, deltaPct, greeting, groupGoalsByRule, lastSyncMs, money, moneyIq,
  shareText, todayKey, weekReport,
} from '../api';
import { buildAlerts, groupReceipts, officialDays } from '../insights';
import { ExportMenu } from '../ExportMenu';
import { addDays, yesterdayKey } from '../period';
import { PeriodBar, fullDay, shortIq } from '../picker';
import { useManager, useShopInsights } from '../store';
import {
  ErrorBox, IconBag, IconBox, IconCashier, IconComm, IconGoal, IconTeam, PersonAvatar, Skeleton, useToast,
} from '../ui';

type Tile = {
  to: string;
  title: string;
  value: string;
  hint: string;
  Icon: ComponentType;
  tone: 'goal' | 'gold' | 'ok' | 'warn' | 'ink';
};

function compareText(delta: number, against: string) {
  const v = Math.round(Math.abs(delta));
  if (v < 1) return { text: `مثل ${against} تقريباً`, tone: 'flat' as const };
  return delta > 0
    ? { text: `أعلى من ${against} بـ ${v}٪`, tone: 'up' as const }
    : { text: `أقل من ${against} بـ ${v}٪`, tone: 'down' as const };
}

export function Home() {
  const {
    dash, prevDash, scopedSellers, scopedCashiers, scopedLines, lines, period, periodKind, payPeriod, payTotals,
    periodTotals, setCustom, setPeriodKind, err, loading, cached, reload,
  } = useManager();
  const insights = useShopInsights();
  const toast = useToast();
  const nav = useNavigate();
  const today = todayKey();
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;
  const alerts = useMemo(() => buildAlerts(dash, prevDash, scopedCashiers, stale), [dash, prevDash, scopedCashiers, stale]);
  const goalRules = useMemo(() => groupGoalsByRule(dash?.goals), [dash]);
  const weekDays = useMemo(
    () => officialDays(dash?.days, [], dash?.week?.weekStart, dash?.week?.weekEnd),
    [dash],
  );
  const prevDays = useMemo(
    () => officialDays(prevDash?.days, [], prevDash?.week?.weekStart, prevDash?.week?.weekEnd),
    [prevDash],
  );

  const sellers = useMemo(
    () => [...scopedSellers]
      .filter(s => s.salesAmount > 0 || s.receiptCount > 0 || s.commissionAmount > 0)
      .sort((a, b) => b.commissionAmount - a.commissionAmount || b.receiptCount - a.receiptCount),
    [scopedSellers],
  );
  const cashierRows = useMemo(
    () => [...scopedCashiers].filter(c => c.salesAmount > 0 || c.receiptCount > 0).sort((a, b) => b.salesAmount - a.salesAmount),
    [scopedCashiers],
  );
  const receipts = useMemo(() => {
    const own = insights.receipts.length ? insights.receipts : groupReceipts(scopedLines.length ? scopedLines : lines);
    return [...own].sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 6);
  }, [insights.receipts, scopedLines, lines]);

  const compare = useMemo(() => {
    if (!dash) return null;
    if (period.singleDay) {
      const before = addDays(period.from, -1);
      const prevRow = weekDays.find(d => d.key === before) ?? prevDays.find(d => d.key === before);
      if (!prevRow || prevRow.sales <= 0) return null;
      const against = period.from === today ? 'أمس' : period.from === yesterdayKey() ? 'أول أمس' : 'اليوم السابق';
      return compareText(deltaPct(periodTotals.sales, prevRow.sales), against);
    }
    const span = weekDays.filter(d => d.key >= period.from && d.key <= period.to).length;
    const startIdx = weekDays.findIndex(d => d.key === period.from);
    if (!prevDays.length || span <= 0 || startIdx < 0) return null;
    const prevSum = prevDays.slice(startIdx, startIdx + span).reduce((s, d) => s + d.sales, 0);
    if (prevSum <= 0) return null;
    return compareText(deltaPct(periodTotals.sales, prevSum), 'نفس الأيام من الأسبوع السابق');
  }, [dash, period, weekDays, prevDays, periodTotals.sales, today]);

  if (err && !dash) return <ErrorBox message={err} onRetry={() => void reload()} />;
  if (loading || !dash) return <Skeleton rows={6} />;

  const hit = goalRules.reduce((s, r) => s + r.hit, 0);
  const goalCount = goalRules.reduce((s, r) => s + r.total, 0);
  const goalAvg = goalRules.length ? goalRules.reduce((s, r) => s + r.avg, 0) / goalRules.length : 0;
  const topCashier = cashierRows[0];
  const topSeller = sellers[0];
  const topProduct = insights.products[0];
  const lastReceipt = receipts[0];
  const salesTitle = period.singleDay
    ? (period.from === today ? 'مبيعات اليوم' : period.from === yesterdayKey() ? 'مبيعات أمس' : `مبيعات ${fullDay(period.from)}`)
    : periodKind === 'wtd' ? 'مبيعات الأسبوع حتى الآن' : `مبيعات ${period.label}`;
  const maxCashier = Math.max(1, ...cashierRows.map(c => c.salesAmount));
  const shownDays = weekDays.filter(d => d.key <= today);
  const maxDay = Math.max(1, ...shownDays.map(d => d.sales));

  const tiles: Tile[] = [
    {
      to: '/team', title: 'البائعون', Icon: IconTeam, tone: 'goal',
      value: `${sellers.length} نشط`,
      hint: topSeller ? `الأعلى عمولة: ${topSeller.name}` : 'لا حركة بعد',
    },
    {
      to: '/cashiers', title: 'الكاشير', Icon: IconCashier, tone: 'gold',
      value: `${cashierRows.length} على الصندوق`,
      hint: topCashier ? `الأعلى: ${topCashier.name} · ${shortIq(topCashier.salesAmount)}` : 'لا حركة بعد',
    },
    {
      to: '/moves', title: 'الفواتير', Icon: IconBox, tone: 'ink',
      value: `${money(periodTotals.receipts)} فاتورة`,
      hint: lastReceipt ? `آخر فاتورة ${ago(Date.parse(lastReceipt.at) || Date.now())}` : 'لا فواتير بعد',
    },
    {
      to: '/commissions', title: 'العمولات', Icon: IconComm, tone: 'ok',
      value: moneyIq(payTotals.commission),
      hint: payPeriod.label,
    },
    {
      to: '/goals', title: 'الأهداف', Icon: IconGoal, tone: goalAvg >= 80 || !goalCount ? 'ok' : 'warn',
      value: goalCount ? `${hit} من ${goalCount} حققوا` : 'لا أهداف',
      hint: goalCount ? `متوسط الإنجاز ${Math.round(goalAvg)}٪` : 'تُضاف من لوحة التحكم',
    },
    {
      to: '/products', title: 'المنتجات', Icon: IconBag, tone: 'gold',
      value: `${insights.products.length} منتج`,
      hint: topProduct ? `الأكثر: ${topProduct.name}` : 'لا مبيعات بعد',
    },
  ];

  function openDay(key: string) {
    if (key === today) { setPeriodKind('today'); return; }
    setCustom(key, key);
    setPeriodKind('custom');
  }

  async function share() {
    const extra = [
      `${salesTitle}: ${moneyIq(periodTotals.sales)} — ${periodTotals.receipts} فاتورة`,
      topCashier ? `أقوى كاشير: ${topCashier.name} — ${moneyIq(topCashier.salesAmount)}` : '',
      `العمولات (${payPeriod.label}): ${moneyIq(payTotals.commission)}`,
    ].filter(Boolean);
    const result = await shareText('تقرير المحل', weekReport(dash!, extra));
    if (result === 'copied') toast('تم نسخ التقرير — الصقه في واتساب');
    else if (result === 'shared') toast('تمت المشاركة');
    else if (result === 'fail') toast('تعذر النسخ');
  }

  return (
    <div className="s-home fade-up">
      <div className="s-hello">
        <div>
          <p className="s-hello-hi">{greeting()}، {dash.manager.displayName}</p>
          <p className="s-hello-sub">هذا ملخص المحل — اضغط على أي مربع لترى التفاصيل</p>
        </div>
        <span className={`s-sync ${stale ? 'warn' : ''}`}>
          <i />
          {stale ? 'البيانات قديمة' : syncMs ? `محدّث ${ago(syncMs)}` : 'متصل'}
        </span>
      </div>

      <PeriodBar />

      <section className="s-sales">
        <p className="s-sales-title">{salesTitle}</p>
        <p className="s-sales-num num">{money(periodTotals.sales)} <small>د.ع</small></p>
        {compare && <p className={`s-compare ${compare.tone}`}>{compare.tone === 'up' ? '▲' : compare.tone === 'down' ? '▼' : '●'} {compare.text}</p>}
        <div className="s-facts">
          <div><span>الفواتير</span><strong className="num">{money(periodTotals.receipts)}</strong></div>
          <div><span>متوسط الفاتورة</span><strong className="num">{moneyIq(avgTicket(periodTotals.sales, periodTotals.receipts))}</strong></div>
          <div><span>القطع</span><strong className="num">{money(periodTotals.pieces)}</strong></div>
        </div>
        <div className="s-sales-actions">
          <button type="button" className="s-btn primary" onClick={() => void share()}>مشاركة الملخص</button>
          <ExportMenu title="تقرير المدير" />
        </div>
        {(stale || cached) && (
          <p className="s-note">{stale ? 'آخر مزامنة قديمة — افتح لوحة التحكم في المحل لتحديث الأرقام.' : 'تُعرض آخر بيانات محفوظة إلى أن يكتمل التحديث.'}</p>
        )}
      </section>

      {alerts.length > 0 && (
        <section className="s-card">
          <div className="s-card-head">
            <h2>يحتاج انتباهك</h2>
            {alerts.length > 3 && <Link to="/watch">الكل ({alerts.length})</Link>}
          </div>
          <div className="s-alerts">
            {alerts.slice(0, 3).map(a => (
              <Link key={a.id} to={a.to === '/' ? '/watch' : a.to} className={`s-alert ${a.tone}`}>
                <strong>{a.title}</strong>
                <span>{a.hint}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <nav className="s-tiles" aria-label="أقسام المحل">
        {tiles.map(t => (
          <Link key={t.to} to={t.to} className={`s-tile tone-${t.tone}`}>
            <span className="s-tile-ico"><t.Icon /></span>
            <span className="s-tile-title">{t.title}</span>
            <strong className="s-tile-value">{t.value}</strong>
            <span className="s-tile-hint">{t.hint}</span>
          </Link>
        ))}
      </nav>

      <div className="s-two">
        <section className="s-card">
          <div className="s-card-head">
            <h2>الكاشير · {period.label}</h2>
            <Link to="/cashiers">التفاصيل</Link>
          </div>
          {cashierRows.length ? (
            <div className="s-rows">
              {cashierRows.slice(0, 5).map(c => (
                <button key={`${c.cashierId}-${c.name}`} type="button" className="s-row" onClick={() => nav(`/cashiers?q=${encodeURIComponent(c.name)}`)}>
                  <PersonAvatar name={c.name} tone="gold" size={38} />
                  <span className="s-row-main">
                    <strong>{c.name}</strong>
                    <span className="s-meter"><i style={{ width: `${(c.salesAmount / maxCashier) * 100}%` }} /></span>
                  </span>
                  <span className="s-row-end">
                    <strong className="num">{moneyIq(c.salesAmount)}</strong>
                    <small>{c.receiptCount} فاتورة</small>
                  </span>
                </button>
              ))}
            </div>
          ) : <p className="s-empty">لا حركة على الصناديق في هذه المدة</p>}
        </section>

        <section className="s-card">
          <div className="s-card-head">
            <h2>البائعون · {period.label}</h2>
            <Link to="/team">التفاصيل</Link>
          </div>
          {sellers.length ? (
            <div className="s-rows">
              {sellers.slice(0, 5).map(s => (
                <button key={s.salesmanId} type="button" className="s-row" onClick={() => nav(`/team?q=${encodeURIComponent(s.name)}`)}>
                  <PersonAvatar name={s.name} tone="goal" size={38} />
                  <span className="s-row-main">
                    <strong>{s.name}</strong>
                    <small>{s.receiptCount} فاتورة{s.goalCount > 0 ? ` · الهدف ${Math.round(s.goalPercent)}٪` : ''}</small>
                  </span>
                  <span className="s-row-end">
                    <strong className="num">{moneyIq(s.commissionAmount)}</strong>
                    <small>عمولة</small>
                  </span>
                </button>
              ))}
            </div>
          ) : <p className="s-empty">لا حركة بائعين في هذه المدة</p>}
        </section>
      </div>

      <div className="s-two">
        <section className="s-card">
          <div className="s-card-head">
            <h2>آخر الفواتير</h2>
            <Link to="/moves">كل الفواتير</Link>
          </div>
          {receipts.length ? (
            <div className="s-rows">
              {receipts.map(r => (
                <Link key={r.id} to={`/moves?q=${encodeURIComponent(String(r.receiptNumber || ''))}`} className="s-row">
                  <span className="s-receipt-no num">{r.receiptNumber ? `#${r.receiptNumber}` : '—'}</span>
                  <span className="s-row-main">
                    <strong>{r.sellers.slice(0, 2).join('، ') || 'بدون بائع'}</strong>
                    <small>{[r.cashierName, clockLabel(r.at)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="s-row-end">
                    <strong className="num">{moneyIq(r.sales)}</strong>
                    <small>{r.qty} قطعة</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="s-empty">لا فواتير في هذه المدة</p>}
        </section>

        {shownDays.some(d => d.sales > 0) && (
          <section className="s-card">
            <div className="s-card-head">
              <h2>أيام الأسبوع</h2>
              <span className="s-card-hint">اضغط على يوم لعرضه</span>
            </div>
            <div className="s-days wide">
              {shownDays.map(d => {
                const on = period.singleDay && period.from === d.key;
                return (
                  <button key={d.key} type="button" className={`s-day ${on ? 'on' : ''} ${d.key === today ? 'today' : ''}`} onClick={() => openDay(d.key)}>
                    <span className="s-day-val">{d.sales > 0 ? shortIq(d.sales) : '—'}</span>
                    <span className="s-day-bar"><i style={{ height: `${Math.max(6, (d.sales / maxDay) * 100)}%` }} /></span>
                    <span className="s-day-name">{d.key === today ? 'اليوم' : d.weekday}</span>
                  </button>
                );
              })}
            </div>
            <p className="s-days-foot">
              مجموع الأسبوع <strong className="num">{moneyIq(shownDays.reduce((s, d) => s + d.sales, 0))}</strong>
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
