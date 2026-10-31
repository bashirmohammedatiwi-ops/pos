import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar, Delta, Empty, ErrorLine, I, Ring, Screen, Segmented, Sheet, Skeleton, Track, fmt, toast, weekRange } from '../kit';
import { haptic } from '../native';
import { BackBtn } from '../parts';
import { performanceApi, relTime, type PerfCashier, type PerfDash, type PerfGoal, type PerfLine, type PerfProduct, type PerfSeller, type PerfSellerDetail, type PerfWeek } from '../work';
import { compact } from './ManagerSales';

/* ─────────────────────────────────────────────────────────────────────────────
 * التحليلات داخل التطبيق، أسبوعاً بأسبوع مع المقارنة بالسابق:
 * الملخص والتنبيهات، البائعون، الكاشيرية، الفواتير، المنتجات، الأهداف، العمولات، وكشف Excel.
 * ───────────────────────────────────────────────────────────────────────────── */

type Tab = 'summary' | 'sellers' | 'cashiers' | 'invoices' | 'products' | 'goals' | 'commission';
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'الملخص' },
  { id: 'sellers', label: 'البائعون' },
  { id: 'cashiers', label: 'الكاشير' },
  { id: 'invoices', label: 'الفواتير' },
  { id: 'products', label: 'المنتجات' },
  { id: 'goals', label: 'الأهداف' },
  { id: 'commission', label: 'العمولات' },
];
const STALE_MS = 15 * 60_000;
const cleanName = (n?: string | null) => (n || '').replace(/^\d+\s*-\s*/, '') || '—';
const goalValue = (g: PerfGoal, v: number) => (g.targetType === 'amount' ? compact(v) : `${fmt(v)} قطعة`);
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
const WEEKDAY = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const weekdayOf = (iso: string) => WEEKDAY[(new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay() + 1) % 7];
const pctOf = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);
const goalsWord = (n: number) => (n === 1 ? 'هدف واحد' : n === 2 ? 'هدفان' : n <= 10 ? `${n} أهداف` : `${n} هدفاً`);
/** عدد الأيام التي مضت من الأسبوع الجاري (مع اليوم) */
function elapsedDays(week: PerfWeek) {
  if (!week.isCurrent) return 7;
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const n = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${week.weekStart.slice(0, 10)}T12:00:00Z`)) / 86_400_000) + 1;
  return Math.max(1, Math.min(7, n));
}
/**
 * المقارنة بالأسبوع السابق. الأسبوع الجاري يقارن أيامه المكتملة بنفس عددها (اليوم لم ينتهِ بعد)،
 * وفي يومه الأول لا مقارنة.
 */
function weekCompare(dash: PerfDash | null, prev: PerfDash | null): { now: number; base: number } | null {
  if (!dash || !prev) return null;
  if (!dash.week.isCurrent) return { now: dash.week.salesAmount, base: prev.week.salesAmount };
  const done = elapsedDays(dash.week) - 1;
  if (done < 1 || !dash.days?.length || !prev.days?.length) return null;
  const sum = (days: PerfDash['days']) => [...(days ?? [])].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(0, done).reduce((x, d) => x + d.salesAmount, 0);
  return { now: sum(dash.days), base: sum(prev.days) };
}

type Receipt = { key: string; number: number | null; at: string; seller: string; cashier: string; total: number; qty: number; commission: number; lines: PerfLine[] };
function groupReceipts(lines: PerfLine[]): Receipt[] {
  const map = new Map<string, Receipt>();
  for (const l of lines) {
    const key = l.receiptNumber != null ? `r${l.receiptNumber}` : `l${l.id}`;
    const r = map.get(key) ?? { key, number: l.receiptNumber ?? null, at: l.occurredAt, seller: cleanName(l.salesmanName), cashier: cleanName(l.cashierName), total: 0, qty: 0, commission: 0, lines: [] };
    r.total += l.salesAmount;
    r.qty += l.quantity;
    r.commission += l.commissionAmount;
    r.lines.push(l);
    if (l.occurredAt > r.at) r.at = l.occurredAt;
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}
/** تجميع الحركات حسب اسم (بائع أو كاشير أو منتج) */
function rollup(lines: PerfLine[], nameOf: (l: PerfLine) => string) {
  const map = new Map<string, { name: string; sales: number; qty: number; receipts: Set<string> }>();
  for (const l of lines) {
    const name = nameOf(l);
    if (!name || name === '—') continue;
    const r = map.get(name) ?? { name, sales: 0, qty: 0, receipts: new Set<string>() };
    r.sales += l.salesAmount;
    r.qty += l.quantity;
    r.receipts.add(String(l.receiptNumber ?? `l${l.id}`));
    map.set(name, r);
  }
  return [...map.values()].sort((a, b) => b.sales - a.sales);
}

function health(goalAvg: number, goalCount: number, delta: number | null, stale: boolean, hasSales: boolean) {
  let score = 48;
  if (hasSales) score += 12;
  if (goalCount) score += goalAvg >= 100 ? 28 : goalAvg >= 80 ? 20 : goalAvg >= 50 ? 10 : -8;
  if (delta != null) score += delta > 8 ? 16 : delta > 0 ? 8 : delta < -15 ? -16 : delta < -5 ? -8 : 0;
  if (stale) score -= 22;
  score = Math.max(8, Math.min(100, Math.round(score)));
  return { score, label: score >= 80 ? 'المحل في وضع قوي' : score >= 60 ? 'المحل يسير بشكل جيد' : score >= 40 ? 'يحتاج متابعة' : 'يحتاج انتباهاً عاجلاً' };
}

export function MPerformance() {
  const [weeks, setWeeks] = useState<PerfWeek[] | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [dash, setDash] = useState<PerfDash | null>(null);
  const [prev, setPrev] = useState<PerfDash | null>(null);
  const [products, setProducts] = useState<PerfProduct[]>([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('summary');
  const [pick, setPick] = useState<PerfSeller | null>(null);

  useEffect(() => {
    performanceApi
      .weeks()
      .then(w => {
        setWeeks(w);
        setWeek((w.find(x => x.isCurrent) ?? w[0])?.weekStart ?? null);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, []);

  const prevWeek = useMemo(() => {
    if (!weeks || !week) return null;
    const sorted = [...weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    const i = sorted.findIndex(x => x.weekStart === week);
    return i > 0 ? sorted[i - 1] : null;
  }, [weeks, week]);
  const cur = weeks?.find(x => x.weekStart === week) ?? null;

  async function load() {
    if (!week) return;
    try {
      const [d, p, pr] = await Promise.all([performanceApi.dashboard(week), performanceApi.products(week), prevWeek ? performanceApi.dashboard(prevWeek.weekStart) : Promise.resolve(null)]);
      setDash(d);
      setProducts(p);
      setPrev(pr);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    }
  }
  useEffect(() => {
    setDash(null);
    void load();
  }, [week]); // eslint-disable-line react-hooks/exhaustive-deps

  const compare = weekCompare(dash, prev);

  async function exportWeek() {
    if (!dash || !cur) return;
    haptic('tap');
    try {
      const { downloadXlsxFile } = await import('../../xlsx');
      const label = weekRange(cur.weekStart, cur.weekEnd);
      const sheet = (name: string, head: string[], rows: (string | number)[][], widths: number[]) => ({
        name,
        rtl: true,
        columnWidths: widths,
        rows: [
          { height: 28, cells: [{ value: `${name} — ${label}`, style: 'title', mergeAcross: head.length - 1 }] },
          { height: 22, cells: head.map(value => ({ value, style: 'head' })) },
          ...rows.map(r => ({ cells: r.map(value => (typeof value === 'number' ? { value: Math.round(value), style: 'num', type: 'Number' as const } : { value, style: 'text' })) })),
        ],
      });
      const active = dash.sellers.filter(s => s.salesAmount || s.receiptCount).sort((a, b) => b.salesAmount - a.salesAmount);
      downloadXlsxFile(
        `تحليلات-${cur.weekStart.slice(0, 10)}`,
        [
          sheet('البائعون', ['البائع', 'المبيعات', 'الفواتير', 'القطع', 'العمولة', 'المستحق', 'الأهداف'], active.map(s => [cleanName(s.name), s.salesAmount, s.receiptCount, s.pieceCount, s.commissionAmount, s.balanceDue, s.goalCount ? `${s.goalsHit}/${s.goalCount}` : '—']), [190, 110, 70, 70, 100, 100, 70]),
          sheet('الكاشير', ['الكاشير', 'المبيعات', 'الفواتير', 'القطع'], [...dash.cashiers].sort((a, b) => b.salesAmount - a.salesAmount).map(c => [cleanName(c.name), c.salesAmount, c.receiptCount, c.pieceCount]), [190, 110, 70, 70]),
          sheet('المنتجات', ['المنتج', 'المبيعات', 'القطع', 'العمولة'], products.map(p => [p.name, p.salesAmount, p.quantity, p.commissionAmount]), [300, 110, 70, 100]),
          sheet('الأهداف', ['الهدف', 'البائع', 'المتحقق', 'المطلوب', 'النسبة %'], dash.goals.map(g => [g.ruleName, cleanName(g.salesmanName), g.sold, g.weeklyTarget, g.percent]), [190, 170, 90, 90, 70]),
        ],
        [
          { id: 'title', fontSize: 14, bold: true, color: 'FFFFFF', bg: '4C2A85', align: 'center', valign: 'center' },
          { id: 'head', fontSize: 10, bold: true, color: 'FFFFFF', bg: '6D45C9', align: 'center', valign: 'center', wrap: true, border: 'thin' },
          { id: 'text', fontSize: 10, valign: 'center', border: 'thin' },
          { id: 'num', fontSize: 10, align: 'center', valign: 'center', border: 'thin', numFmt: '#,##0' },
        ],
      );
    } catch {
      toast('تعذر تجهيز الكشف');
    }
  }

  return (
    <Screen
      title="التحليلات"
      subtitle={cur ? weekRange(cur.weekStart, cur.weekEnd) : 'تحليل الأسبوع كاملاً'}
      start={<BackBtn to="/m/more" />}
      end={
        <button type="button" className="t-icon-btn press" aria-label="مشاركة كشف Excel" disabled={!dash} onClick={() => void exportWeek()}>
          <I.share size={20} />
        </button>
      }
      onRefresh={load}
    >
      {err && !weeks && <ErrorLine text={err} />}
      {weeks && (
        <div className="t-scroller" style={{ marginBottom: 12 }}>
          {[...weeks]
            .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
            .map(w => (
              <button
                key={w.weekStart}
                type="button"
                className={`t-pill press ${w.weekStart === week ? 'on' : ''}`}
                onClick={() => {
                  haptic('select');
                  setWeek(w.weekStart);
                }}
              >
                {w.isCurrent ? 'هذا الأسبوع' : weekRange(w.weekStart, w.weekEnd)}
                <small className="num">{compact(w.salesAmount)}</small>
              </button>
            ))}
        </div>
      )}

      {cur && (
        <section className="t-hero s-hero">
          <div className="t-hero-row">
            <p className="kicker">مبيعات الأسبوع</p>
            {compare && <Delta glass now={compare.now} prev={compare.base} />}
          </div>
          <div className="amount">
            <span className="num">{fmt(cur.salesAmount)}</span>
            <small>د.ع</small>
          </div>
          <div className="meta">
            <span>
              العمولات <b className="num">{compact(cur.commissionAmount)}</b>
            </span>
            <span>
              <b className="num">{fmt(cur.receiptCount)}</b> فاتورة
            </span>
            <span>
              <b className="num">{fmt(cur.pieceCount)}</b> قطعة
            </span>
          </div>
          {cur.isCurrent && compare && <p style={{ margin: '8px 0 0', fontSize: 11.5, opacity: 0.75 }}>مقارنة الأيام المكتملة بنفس عددها من الأسبوع السابق</p>}
        </section>
      )}

      <div className="t-scroller" style={{ margin: '14px 0 12px', gap: 6 }} role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`t-pill press ${tab === t.id ? 'on' : ''}`}
            onClick={() => {
              haptic('select');
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && weeks && <ErrorLine text={err} onRetry={() => void load()} />}
      {!dash ? (
        !err && <Skeleton h={320} r={20} />
      ) : tab === 'summary' ? (
        <SummaryTab dash={dash} prev={prev} products={products} go={setTab} onSeller={setPick} />
      ) : tab === 'sellers' ? (
        <SellersTab dash={dash} prev={prev} onPick={setPick} />
      ) : tab === 'cashiers' ? (
        <CashiersTab dash={dash} prev={prev} />
      ) : tab === 'invoices' ? (
        <InvoicesTab dash={dash} />
      ) : tab === 'products' ? (
        <ProductsTab dash={dash} products={products} />
      ) : tab === 'goals' ? (
        <GoalsTab goals={dash.goals} />
      ) : (
        <CommissionTab dash={dash} onPick={setPick} />
      )}

      <SellerSheet seller={pick} week={week} onClose={() => setPick(null)} />
    </Screen>
  );
}

/* ═════════════ الملخص ═════════════ */
function SummaryTab({ dash, prev, products, go, onSeller }: { dash: PerfDash; prev: PerfDash | null; products: PerfProduct[]; go: (t: Tab) => void; onSeller: (s: PerfSeller) => void }) {
  const stale = !!dash.lastSyncAt && Date.now() - Date.parse(dash.lastSyncAt) > STALE_MS && !!dash.week.isCurrent;
  const rules = useMemo(() => goalRules(dash.goals), [dash.goals]);
  const goalAvg = rules.length ? rules.reduce((s, r) => s + r.avg, 0) / rules.length : 0;
  const cmp = weekCompare(dash, prev);
  const delta = cmp?.base ? pctOf(cmp.now - cmp.base, cmp.base) : null;
  // الأهداف أسبوعية: في الأسبوع الجاري تُقاس بما يتوقع إنجازه حتى اليوم
  const expected = (elapsedDays(dash.week) / 7) * 100;
  const h = health(Math.min(100, (goalAvg / expected) * 100), dash.goals.length, delta, stale, dash.week.salesAmount > 0);

  const active = useMemo(() => dash.sellers.filter(s => s.salesAmount > 0).sort((a, b) => b.salesAmount - a.salesAmount), [dash.sellers]);
  const drops = useMemo(
    () =>
      active
        .flatMap(s => {
          // الأسبوع الجاري لم يكتمل: لا يقارَن البائع بأسبوع كامل
          if (dash.week.isCurrent) return [];
          const old = prev?.sellers.find(x => x.salesmanId === s.salesmanId);
          if (!old || old.salesAmount <= 0) return [];
          const change = pctOf(s.salesAmount - old.salesAmount, old.salesAmount);
          return change <= -20 ? [{ s, change }] : [];
        })
        .sort((a, b) => a.change - b.change),
    [active, prev, dash.week.isCurrent],
  );
  const lateRules = rules.filter(r => r.avg < expected * 0.8).sort((a, b) => a.avg - b.avg);
  const quiet = dash.cashiers.filter(c => c.salesAmount <= 0 && c.receiptCount <= 0);
  const days = dash.days ?? [];
  const peak = Math.max(1, ...days.map(d => d.salesAmount));
  const peakDay = days.find(d => d.salesAmount === peak);
  const ticket = dash.week.receiptCount ? dash.week.salesAmount / dash.week.receiptCount : 0;
  const topCashier = [...dash.cashiers].sort((a, b) => b.salesAmount - a.salesAmount)[0];
  const topProduct = products[0];
  const alerts = (stale ? 1 : 0) + lateRules.length + drops.length + (quiet.length ? 1 : 0);

  return (
    <>
      <section className="t-card pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Ring value={h.score} size={70} stroke={7} tone={h.score >= 80 ? 'ok' : undefined} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700 }}>{h.label}</div>
          <div style={{ marginTop: 3, fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-3)' }}>
            {alerts ? `${alerts} ${alerts === 1 ? 'أمر يحتاج' : 'أمور تحتاج'} نظرك` : 'لا شيء يحتاج انتباهك'}
            {dash.lastSyncAt ? ` · آخر تحديث ${relTime(dash.lastSyncAt)}` : ''}
          </div>
        </div>
      </section>

      <div className="t-stats two" style={{ marginTop: 12 }}>
        <div className="t-stat">
          <span>متوسط الفاتورة</span>
          <b className="num">{compact(ticket)}</b>
          <em>{prev && prev.week.receiptCount ? <Delta now={ticket} prev={prev.week.salesAmount / prev.week.receiptCount} /> : 'د.ع'}</em>
        </div>
        <div className="t-stat">
          <span>إنجاز الأهداف</span>
          <b className="num">{rules.length ? `${Math.round(goalAvg)}%` : '—'}</b>
          <em>{rules.length ? goalsWord(rules.length) : 'لا أهداف'}</em>
        </div>
      </div>

      {days.length > 1 && (
        <section className="t-card pad" style={{ marginTop: 12 }}>
          <div className="t-section-head" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15 }}>المبيعات يوماً بيوم</h2>
            {peakDay && peakDay.salesAmount > 0 && (
              <small>
                الأعلى {weekdayOf(peakDay.day)} · <span className="num">{compact(peak)}</span>
              </small>
            )}
          </div>
          <div className="t-chart" aria-hidden>
            {days.map(d => (
              <i key={d.day} className={d === peakDay ? 'peak' : ''} style={{ height: `${Math.max(d.salesAmount > 0 ? 3 : 1, (Math.max(0, d.salesAmount) / peak) * 100)}%` }} />
            ))}
          </div>
          <div className="t-chart-axis">
            <span>{dayLabel(days[0].day)}</span>
            <span>{dayLabel(days[days.length - 1].day)}</span>
          </div>
        </section>
      )}

      <section className="t-section">
        <div className="t-section-head">
          <h2>الأفضل هذا الأسبوع</h2>
        </div>
        <div className="t-list">
          {active[0] && <Leader icon={<I.user size={18} />} label="أفضل بائع" name={cleanName(active[0].name)} value={compact(active[0].salesAmount)} onClick={() => onSeller(active[0])} />}
          {topCashier && topCashier.salesAmount > 0 && <Leader icon={<I.store size={18} />} label="أعلى كاشير" name={cleanName(topCashier.name)} value={compact(topCashier.salesAmount)} onClick={() => go('cashiers')} />}
          {topProduct && <Leader icon={<I.box size={18} />} label="أعلى منتج" name={topProduct.name} value={compact(topProduct.salesAmount)} onClick={() => go('products')} />}
        </div>
      </section>

      {alerts > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>يحتاج نظرك</h2>
          </div>
          <div className="t-list">
            {stale && <Alert title="البيانات غير محدثة" sub={`آخر مزامنة من المحل ${relTime(dash.lastSyncAt!)} — تأكد أن سيرفر المحل يعمل`} />}
            {lateRules.map(r => (
              <Alert key={r.id} title={r.name} sub={`متوسط الإنجاز ${Math.round(r.avg)}% · حققه ${r.hit} من ${r.rows.length}`} onClick={() => go('goals')} />
            ))}
            {drops.map(({ s, change }) => (
              <Alert key={s.salesmanId} title={`${cleanName(s.name)} انخفض عن الأسبوع السابق`} sub={`${Math.round(change)}% · ${fmt(s.receiptCount)} فاتورة هذا الأسبوع`} onClick={() => onSeller(s)} />
            ))}
            {quiet.length > 0 && <Alert title={`${quiet.length} كاشير بلا حركة`} sub={quiet.slice(0, 3).map(c => cleanName(c.name)).join(' · ')} onClick={() => go('cashiers')} />}
          </div>
        </section>
      )}
    </>
  );
}

function Leader({ icon, label, name, value, onClick }: { icon: ReactNode; label: string; name: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="t-row press-soft" style={{ width: '100%' }} onClick={() => (haptic('tap'), onClick())}>
      <span className="t-tile accent">{icon}</span>
      <div className="body">
        <div className="sub">{label}</div>
        <div className="title">{name}</div>
      </div>
      <div className="end">
        <b className="num">{value}</b>
      </div>
    </button>
  );
}

function Alert({ title, sub, onClick }: { title: string; sub: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="t-tile bad">
        <I.info size={18} />
      </span>
      <div className="body">
        <div className="title">{title}</div>
        <div className="sub">{sub}</div>
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className="t-row press-soft" style={{ width: '100%' }} onClick={() => (haptic('tap'), onClick())}>
      {body}
    </button>
  ) : (
    <div className="t-row">{body}</div>
  );
}

/* ═════════════ البائعون ═════════════ */
function SellersTab({ dash, prev, onPick }: { dash: PerfDash; prev: PerfDash | null; onPick: (s: PerfSeller) => void }) {
  const [q, setQ] = useState('');
  const prevOf = useMemo(() => new Map((prev?.sellers ?? []).map(p => [p.salesmanId, p])), [prev]);
  const ranked = useMemo(() => dash.sellers.filter(s => s.salesAmount || s.receiptCount).sort((a, b) => b.salesAmount - a.salesAmount), [dash.sellers]);
  const shown = q.trim() ? ranked.filter(s => s.name.includes(q.trim())) : ranked;
  const top = Math.max(1, ...ranked.map(s => s.salesAmount));
  if (!ranked.length) return <Empty icon={<I.user size={30} />} title="لا مبيعات للبائعين في هذا الأسبوع" />;
  return (
    <>
      <label className="t-search" style={{ marginBottom: 10 }}>
        <I.search />
        <input placeholder={`ابحث بين ${ranked.length} بائع`} value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="t-list s-rank">
        {shown.map(s => (
          <button key={s.salesmanId} type="button" className="t-row press-soft" onClick={() => (haptic('tap'), onPick(s))}>
            <Pos i={ranked.indexOf(s)} />
            <div className="body">
              <div className="s-rank-top">
                <span className="title">{cleanName(s.name)}</span>
                <b className="num">{compact(s.salesAmount)}</b>
              </div>
              <div className="s-bar">
                <i style={{ width: `${Math.max(2, (s.salesAmount / top) * 100)}%` }} />
              </div>
              <div className="s-rank-sub">
                <span className="num">
                  {fmt(s.receiptCount)} فاتورة · {fmt(s.pieceCount)} قطعة{s.goalCount ? ` · أهداف ${s.goalsHit}/${s.goalCount}` : ''}
                </span>
                {!dash.week.isCurrent && prevOf.has(s.salesmanId) && <Delta now={s.salesAmount} prev={prevOf.get(s.salesmanId)!.salesAmount} />}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
const Pos = ({ i }: { i: number }) => <span className={`s-pos ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>;

/* ═════════════ الكاشير ═════════════ */
function CashiersTab({ dash, prev }: { dash: PerfDash; prev: PerfDash | null }) {
  const [open, setOpen] = useState<PerfCashier | null>(null);
  const rows = useMemo(() => [...dash.cashiers].sort((a, b) => b.salesAmount - a.salesAmount), [dash.cashiers]);
  const total = rows.reduce((s, c) => s + c.salesAmount, 0);
  const top = Math.max(1, ...rows.map(c => c.salesAmount));
  const lines = useMemo(() => (open ? dash.lines.filter(l => cleanName(l.cashierName) === cleanName(open.name)) : []), [open, dash.lines]);
  const sellers = useMemo(() => rollup(lines, l => cleanName(l.salesmanName)), [lines]);
  const items = useMemo(() => rollup(lines, l => l.productName), [lines]);
  if (!rows.length) return <Empty icon={<I.store size={30} />} title="لا كاشير في هذا الأسبوع" />;
  return (
    <>
      <div className="t-list s-rank">
        {rows.map((c, i) => {
          const old = prev?.cashiers.find(x => cleanName(x.name) === cleanName(c.name));
          return (
            <button key={`${c.cashierId}-${c.name}`} type="button" className="t-row press-soft" onClick={() => (haptic('tap'), setOpen(c))}>
              <Pos i={i} />
              <div className="body">
                <div className="s-rank-top">
                  <span className="title">{cleanName(c.name)}</span>
                  <b className="num">{compact(c.salesAmount)}</b>
                </div>
                <div className="s-bar">
                  <i style={{ width: `${Math.max(2, (c.salesAmount / top) * 100)}%` }} />
                </div>
                <div className="s-rank-sub">
                  <span className="num">
                    {fmt(c.receiptCount)} فاتورة · {pctOf(c.salesAmount, total).toFixed(1)}% · متوسط {compact(c.receiptCount ? c.salesAmount / c.receiptCount : 0)}
                  </span>
                  {!dash.week.isCurrent && old && old.salesAmount > 0 && <Delta now={c.salesAmount} prev={old.salesAmount} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? cleanName(open.name) : ''} subtitle="أداء هذا الأسبوع">
        {open && (
          <>
            <div className="s-detail" style={{ marginBottom: 14 }}>
              <Stat label="المبيعات" value={fmt(open.salesAmount)} unit="د.ع" />
              <Stat label="الفواتير" value={fmt(open.receiptCount)} />
              <Stat label="القطع" value={fmt(open.pieceCount)} />
              <Stat label="متوسط الفاتورة" value={fmt(open.receiptCount ? Math.round(open.salesAmount / open.receiptCount) : 0)} unit="د.ع" />
            </div>
            <Rollup title="البائعون عليه" rows={sellers} />
            <Rollup title="أكثر المنتجات" rows={items.slice(0, 15)} />
            {!lines.length && <p className="muted" style={{ fontSize: 13 }}>لا تفاصيل حركات لهذا الكاشير في هذا الأسبوع.</p>}
          </>
        )}
      </Sheet>
    </>
  );
}
const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <div className="s-stat">
    <span>{label}</span>
    <b className="num">
      {value} {unit && <small>{unit}</small>}
    </b>
  </div>
);
function Rollup({ title, rows }: { title: string; rows: ReturnType<typeof rollup> }) {
  if (!rows.length) return null;
  return (
    <>
      <p className="t-group-label">{title}</p>
      <div className="t-list flat" style={{ marginBottom: 14 }}>
        {rows.map(r => (
          <div key={r.name} className="t-row s-prod">
            <div className="body">
              <div className="title">{r.name}</div>
              <div className="sub num">
                {fmt(r.qty)} قطعة · {fmt(r.receipts.size)} فاتورة
              </div>
            </div>
            <div className="end">
              <b className="num">{compact(r.sales)}</b>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ═════════════ الفواتير ═════════════ */
function InvoicesTab({ dash }: { dash: PerfDash }) {
  const [q, setQ] = useState('');
  const [seller, setSeller] = useState('');
  const [cashier, setCashier] = useState('');
  const [limit, setLimit] = useState(30);
  const [open, setOpen] = useState<Receipt | null>(null);
  const sellers = useMemo(() => [...new Set(dash.lines.map(l => cleanName(l.salesmanName)))].filter(n => n !== '—').sort((a, b) => a.localeCompare(b, 'ar')), [dash.lines]);
  const cashiers = useMemo(() => [...new Set(dash.lines.map(l => cleanName(l.cashierName)))].filter(n => n !== '—').sort((a, b) => a.localeCompare(b, 'ar')), [dash.lines]);
  const receipts = useMemo(() => {
    const n = q.trim();
    return groupReceipts(
      dash.lines.filter(l => {
        if (seller && cleanName(l.salesmanName) !== seller) return false;
        if (cashier && cleanName(l.cashierName) !== cashier) return false;
        return !n || l.productName.includes(n) || String(l.receiptNumber ?? '').includes(n);
      }),
    );
  }, [dash.lines, q, seller, cashier]);
  useEffect(() => setLimit(30), [q, seller, cashier, dash]);
  const total = receipts.reduce((s, r) => s + r.total, 0);
  if (!dash.lines.length) return <Empty icon={<I.sheet size={30} />} title="لا فواتير مسجلة لهذا الأسبوع" />;
  return (
    <>
      <label className="t-search" style={{ marginBottom: 10 }}>
        <I.search />
        <input placeholder="رقم الفاتورة أو اسم المنتج" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="t-row-2" style={{ marginBottom: 10 }}>
        <select className="t-input sm" aria-label="البائع" value={seller} onChange={e => setSeller(e.target.value)}>
          <option value="">كل البائعين</option>
          {sellers.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select className="t-input sm" aria-label="الكاشير" value={cashier} onChange={e => setCashier(e.target.value)}>
          <option value="">كل الكاشيرية</option>
          {cashiers.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ margin: '0 2px 10px', fontSize: 12, lineHeight: 1.7 }}>
        <span className="num">{fmt(receipts.length)}</span> فاتورة · <span className="num">{compact(total)}</span> — الفواتير التي فيها حركات بائعين. كل فواتير اليوم في تبويب «المبيعات».
      </p>
      {!receipts.length ? (
        <Empty icon={<I.search size={28} />} title="لا نتائج" />
      ) : (
        <div className="t-list">
          {receipts.slice(0, limit).map(r => (
            <button key={r.key} type="button" className="t-row press-soft" style={{ width: '100%' }} onClick={() => (haptic('tap'), setOpen(r))}>
              <span className="t-tile">
                <I.sheet size={18} />
              </span>
              <div className="body">
                <div className="title num">{r.number != null ? `فاتورة ${r.number}` : r.lines[0].productName}</div>
                <div className="sub">
                  {r.seller} · {weekdayOf(r.at)} {dayLabel(r.at)}
                </div>
              </div>
              <div className="end">
                <b className="num">{compact(r.total)}</b>
                <small className="num">{fmt(r.qty)} قطعة</small>
              </div>
            </button>
          ))}
        </div>
      )}
      {receipts.length > limit && (
        <button type="button" className="t-btn plain block sm press" style={{ marginTop: 10 }} onClick={() => setLimit(l => l + 50)}>
          عرض المزيد ({fmt(receipts.length - limit)})
        </button>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.number != null ? `فاتورة ${open.number}` : 'حركة'} subtitle={open ? `${weekdayOf(open.at)} ${dayLabel(open.at)} · ${open.seller}${open.cashier !== '—' ? ` · ${open.cashier}` : ''}` : ''}>
        {open && (
          <>
            <div className="s-detail" style={{ marginBottom: 14 }}>
              <Stat label="المبلغ" value={fmt(open.total)} unit="د.ع" />
              <Stat label="العمولة" value={fmt(open.commission)} unit="د.ع" />
            </div>
            <div className="t-list flat">
              {open.lines.map(l => (
                <div key={l.id} className="t-row s-prod">
                  <div className="body">
                    <div className="title">{l.productName}</div>
                    <div className="sub num">{fmt(l.quantity)} قطعة</div>
                  </div>
                  <div className="end">
                    <b className="num">{compact(l.salesAmount)}</b>
                    <small className="num">عمولة {fmt(l.commissionAmount)}</small>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/* ═════════════ المنتجات ═════════════ */
function ProductsTab({ dash, products }: { dash: PerfDash; products: PerfProduct[] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'sales' | 'qty'>('sales');
  const [open, setOpen] = useState<PerfProduct | null>(null);
  const rows = useMemo(() => {
    const n = q.trim();
    const list = n ? products.filter(p => p.name.includes(n)) : products;
    return [...list].sort((a, b) => (sort === 'qty' ? b.quantity - a.quantity : b.salesAmount - a.salesAmount));
  }, [products, q, sort]);
  const top = Math.max(1, ...rows.map(p => (sort === 'qty' ? p.quantity : p.salesAmount)));
  const lines = useMemo(() => (open ? dash.lines.filter(l => l.productName === open.name) : []), [open, dash.lines]);
  if (!products.length) return <Empty icon={<I.box size={30} />} title="لا منتجات في هذا الأسبوع" />;
  return (
    <>
      <Segmented
        items={[
          { id: 'sales', label: 'حسب المبيعات' },
          { id: 'qty', label: 'حسب القطع' },
        ]}
        value={sort}
        onChange={setSort}
      />
      <label className="t-search" style={{ margin: '10px 0' }}>
        <I.search />
        <input placeholder="اسم المنتج" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="t-list s-rank">
        {rows.map((p, i) => (
          <button key={p.name} type="button" className="t-row press-soft" onClick={() => (haptic('tap'), setOpen(p))}>
            <Pos i={i} />
            <div className="body">
              <div className="s-rank-top">
                <span className="title">{p.name}</span>
                <b className="num">{sort === 'qty' ? fmt(p.quantity) : compact(p.salesAmount)}</b>
              </div>
              <div className="s-bar">
                <i style={{ width: `${Math.max(2, ((sort === 'qty' ? p.quantity : p.salesAmount) / top) * 100)}%` }} />
              </div>
              <div className="s-rank-sub">
                <span className="num">{sort === 'qty' ? compact(p.salesAmount) : `${fmt(p.quantity)} قطعة`}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name} subtitle="من باع هذا المنتج هذا الأسبوع">
        {open && (
          <>
            <div className="s-detail" style={{ marginBottom: 14 }}>
              <Stat label="المبيعات" value={fmt(open.salesAmount)} unit="د.ع" />
              <Stat label="القطع" value={fmt(open.quantity)} />
            </div>
            <Rollup title="البائعون" rows={rollup(lines, l => cleanName(l.salesmanName))} />
            <Rollup title="الكاشيرية" rows={rollup(lines, l => cleanName(l.cashierName))} />
            {!lines.length && <p className="muted" style={{ fontSize: 13 }}>لا تفاصيل حركات لهذا المنتج في هذا الأسبوع.</p>}
          </>
        )}
      </Sheet>
    </>
  );
}

/* ═════════════ الأهداف ═════════════ */
function goalRules(goals: PerfGoal[]) {
  const map = new Map<number, { id: number; name: string; rows: PerfGoal[] }>();
  for (const g of goals) {
    const r = map.get(g.ruleId) ?? { id: g.ruleId, name: g.ruleName, rows: [] };
    r.rows.push(g);
    map.set(g.ruleId, r);
  }
  return [...map.values()].map(r => ({
    ...r,
    rows: [...r.rows].sort((a, b) => b.percent - a.percent),
    hit: r.rows.filter(x => x.percent >= 100).length,
    avg: r.rows.reduce((s, x) => s + x.percent, 0) / Math.max(1, r.rows.length),
  }));
}
function GoalsTab({ goals }: { goals: PerfGoal[] }) {
  const rules = useMemo(() => goalRules(goals), [goals]);
  if (!rules.length) return <Empty icon={<I.target size={30} />} title="لا أهداف في هذا الأسبوع" />;
  return (
    <>
      {rules.map(r => (
        <section key={r.id} className="t-section" style={{ marginTop: 14 }}>
          <div className="t-section-head">
            <h2 style={{ fontSize: 15 }}>{r.name}</h2>
            <small className="num">
              حققه {r.hit} من {r.rows.length}
            </small>
          </div>
          <div className="t-list flat">
            {r.rows.map(g => (
              <div key={`${g.ruleId}-${g.salesmanId}`} className="t-row">
                <Ring value={g.percent} size={42} stroke={5} tone={g.percent >= 100 ? 'ok' : undefined} />
                <div className="body">
                  <div className="title">{cleanName(g.salesmanName)}</div>
                  <div className="sub num">
                    {goalValue(g, g.sold)} من {goalValue(g, g.weeklyTarget)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/* ═════════════ العمولات ═════════════ */
function CommissionTab({ dash, onPick }: { dash: PerfDash; onPick: (s: PerfSeller) => void }) {
  const rows = useMemo(() => dash.sellers.filter(s => s.commissionAmount || s.balanceDue).sort((a, b) => b.commissionAmount - a.commissionAmount), [dash.sellers]);
  const top = Math.max(1, ...rows.map(s => s.commissionAmount));
  const due = rows.reduce((a, s) => a + (s.balanceDue || 0), 0);
  if (!rows.length) return <Empty icon={<I.wallet size={30} />} title="لا عمولات في هذا الأسبوع" />;
  return (
    <>
      {due > 0 && (
        <div className="t-kpi alert" style={{ marginBottom: 12 }}>
          <span>عمولات لم تُصرف بعد</span>
          <b className="num">{fmt(due)}</b>
        </div>
      )}
      <div className="t-list s-rank">
        {rows.map((s, i) => (
          <button key={s.salesmanId} type="button" className="t-row press-soft" onClick={() => (haptic('tap'), onPick(s))}>
            <Pos i={i} />
            <div className="body">
              <div className="s-rank-top">
                <span className="title">{cleanName(s.name)}</span>
                <b className="num">{fmt(s.commissionAmount)}</b>
              </div>
              <div className="s-bar">
                <i style={{ width: `${Math.max(2, (s.commissionAmount / top) * 100)}%` }} />
              </div>
              <div className="s-rank-sub">
                <span className="num">{s.salesAmount ? ((s.commissionAmount / s.salesAmount) * 100).toFixed(1) : 0}% من المبيعات</span>
                {s.balanceDue > 0 && <span className="num">مستحق {fmt(s.balanceDue)}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/* ═════════════ تفاصيل البائع ═════════════ */
function SellerSheet({ seller, week, onClose }: { seller: PerfSeller | null; week: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<PerfSellerDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    if (!seller || !week) return;
    performanceApi
      .seller(seller.salesmanId, week)
      .then(setDetail)
      .catch(e => toast(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, [seller, week]);
  return (
    <Sheet open={!!seller} onClose={onClose} title={seller ? cleanName(seller.name) : ''} subtitle="أداء هذا الأسبوع">
      {seller && (
        <>
          <div className="s-detail" style={{ marginBottom: 14 }}>
            <Stat label="المبيعات" value={fmt(seller.salesAmount)} unit="د.ع" />
            <Stat label="العمولة" value={fmt(seller.commissionAmount)} unit="د.ع" />
            <Stat label="الفواتير" value={fmt(seller.receiptCount)} />
            <Stat label="القطع" value={fmt(seller.pieceCount)} />
          </div>
          {!detail ? (
            <Skeleton h={140} r={16} />
          ) : (
            <>
              {detail.goals.length > 0 && (
                <>
                  <p className="t-group-label">الأهداف</p>
                  <div className="t-card pad" style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
                    {detail.goals.map(g => (
                      <div key={g.ruleId}>
                        <div className="s-rank-top" style={{ fontSize: 13 }}>
                          <span>{g.ruleName}</span>
                          <b className="num" style={{ fontSize: 13 }}>
                            {Math.round(g.percent)}%
                          </b>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <Track value={g.percent} tone={g.percent >= 100 ? 'ok' : undefined} />
                        </div>
                        <small className="num" style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)' }}>
                          {goalValue(g, g.sold)} من {goalValue(g, g.weeklyTarget)}
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {detail.lines.length > 0 && (
                <>
                  <p className="t-group-label">آخر المبيعات</p>
                  <div className="t-list flat">
                    {detail.lines.slice(0, 25).map(l => (
                      <div key={l.id} className="t-row s-prod">
                        <Avatar name={l.productName} size="sm" />
                        <div className="body">
                          <div className="title">{l.productName}</div>
                          <div className="sub num">
                            {fmt(l.quantity)} قطعة · {relTime(l.occurredAt)}
                          </div>
                        </div>
                        <div className="end">
                          <b className="num">{compact(l.salesAmount)}</b>
                          <small className="num">عمولة {fmt(l.commissionAmount)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
