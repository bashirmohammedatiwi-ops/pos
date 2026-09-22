import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  avgTicket, cashierCsv, deltaPct, downloadText, lastSyncMs, moneyIq, pieces, pct, resolveWeekSales, shareOf, todayKey,
  type CashierRow, type LineRow,
} from '../api';
import { groupReceipts, lineCashier, linesForCashier, rankProducts, sellersThroughCashier } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager, useShopInsights } from '../store';
import {
  Delta, Empty, ErrorBox, HourBands, LiveDot, Medal, PeriodCompareStrip, Podium, QuickNav, RecentFeed, SearchField, Sheet, Skeleton, StatGrid, Track, useToast,
} from '../ui';
import { PeriodBar } from '../week';

type Sort = 'sales' | 'receipts' | 'share';
type Tab = 'overview' | 'sellers' | 'products' | 'invoices';

export function Cashiers() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, scopedLines, scopedCashiers, period, periodKind,
    setPeriodKind, customFrom, customTo, setCustom,     periodTotals, payTotals, payPeriod, shareBase,
    err, loading, reload,
  } = useManager();
  const insights = useShopInsights();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('sales');
  const [open, setOpen] = useState<CashierRow | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [line, setLine] = useState<LineRow | null>(null);
  const opened = useRef(false);
  const syncMs = lastSyncMs(dash?.lastSyncAt);
  const stale = syncMs != null && Date.now() - syncMs > 15 * 60 * 1000;

  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  useEffect(() => {
    const needle = params.get('q')?.trim();
    if (opened.current || !needle) return;
    const hit = scopedCashiers.find(c => c.name === needle);
    if (hit) { opened.current = true; setOpen(hit); setTab('overview'); }
  }, [scopedCashiers, params]);

  const salesTotal = periodTotals.sales || shareBase;
  const shareDen = shareBase;
  const weekSales = resolveWeekSales(dash);
  const todayRow = insights.days.find(d => d.key === todayKey());
  const todayKey_ = todayKey();

  const todayCashiers = useMemo(() => {
    const map = new Map<string, { name: string; sales: number; receipts: Set<string | number> }>();
    for (const l of scopedLines.filter(x => x.occurredAt.slice(0, 10) === todayKey_)) {
      const name = lineCashier(l) || 'كاشير';
      const row = map.get(name) ?? { name, sales: 0, receipts: new Set() };
      row.sales += l.salesAmount;
      row.receipts.add(l.receiptNumber ?? `x-${l.id}`);
      map.set(name, row);
    }
    return [...map.values()]
      .map(r => ({ name: r.name, sales: r.sales, receipts: r.receipts.size }))
      .sort((a, b) => b.sales - a.sales);
  }, [scopedLines, todayKey_]);
  const todayMap = useMemo(() => new Map(todayCashiers.map(c => [c.name, c])), [todayCashiers]);

  const rows = useMemo(() => {
    const list = scopedCashiers.filter(c => !q.trim() || c.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      if (sort === 'share') return shareOf(b.salesAmount, shareDen) - shareOf(a.salesAmount, shareDen);
      return b.salesAmount - a.salesAmount;
    });
  }, [scopedCashiers, q, sort, shareDen]);

  const detailLines = open ? linesForCashier(scopedLines, open.name) : [];
  const detailSellers = open ? sellersThroughCashier(scopedLines, open.name) : [];
  const detailProducts = open ? rankProducts(detailLines) : [];
  const detailReceipts = open ? groupReceipts(detailLines) : [];
  const openToday = open ? todayCashiers.find(c => c.name === open.name) : undefined;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="dash mobile-layout fade-up">
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
      <PeriodCompareStrip
        todaySales={todayRow?.sales ?? 0}
        todayReceipts={todayRow?.receipts ?? 0}
        period={period}
        periodTotals={periodTotals}
        periodKind={periodKind}
        setPeriodKind={setPeriodKind}
        weekSales={weekSales}
        weekReceipts={dash?.week.receiptCount ?? 0}
        payCommission={payTotals.commission}
        payLabel={payPeriod.label}
      />
      <QuickNav />

      <section className="hero compact command">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">أرض المحل · {period.label}</p>
            <h1 className="display text-[24px] font-black">الكاشير</h1>
            <p className="mt-2 text-sm font-bold text-muted">
              {rows.length} كاشير · مبيعات {moneyIq(salesTotal)}
            </p>
          </div>
          <LiveDot stale={stale} />
        </div>
        <div className="dash-kpis mt-4">
          <div className="dash-kpi"><p>المبيعات</p><strong className="num">{moneyIq(salesTotal)}</strong></div>
          <div className="dash-kpi"><p>فواتير</p><strong className="num">{periodTotals.receipts}</strong></div>
          <div className="dash-kpi"><p>نشط</p><strong className="num">{rows.filter(c => c.salesAmount > 0).length}</strong></div>
          <div className="dash-kpi"><p>اليوم</p><strong className="num">{moneyIq(todayRow?.sales ?? 0)}</strong></div>
        </div>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`كاشير-${period.from}.csv`, cashierCsv(scopedCashiers, salesTotal));
            toast('تم تنزيل ملف الكاشير');
          }}
        >
          تصدير الكاشير
        </button>
      </section>

      {todayCashiers.length > 0 && (
        <section className="panel today-live">
          <p className="kicker mb-2">مبيعات اليوم · مباشر</p>
          <div className="today-live-grid">
            {todayCashiers.slice(0, 4).map((c, i) => (
              <button
                key={c.name}
                type="button"
                className="today-live-cell"
                onClick={() => {
                  const hit = rows.find(r => r.name === c.name);
                  if (hit) { setOpen(hit); setTab('overview'); }
                }}
              >
                <Medal rank={i + 1} />
                <p className="truncate font-extrabold">{c.name}</p>
                <p className="num text-base font-black">{moneyIq(c.sales)}</p>
                <p className="text-xs font-bold text-muted">{c.receipts} فاتورة</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <RecentFeed receipts={insights.receipts} limit={5} title="آخر الفواتير على الكاشير" />

      {rows.filter(c => c.salesAmount > 0).length > 0 && (
        <Podium
          items={rows.filter(c => c.salesAmount > 0).slice(0, 3).map(c => ({
            id: `${c.cashierId}-${c.name}`,
            name: c.name,
            value: moneyIq(c.salesAmount),
            hint: `${c.receiptCount} فاتورة · ${pct(shareOf(c.salesAmount, shareDen))}`,
          }))}
          onPick={item => {
            const hit = rows.find(c => c.name === item.name);
            if (hit) { setOpen(hit); setTab('overview'); }
          }}
        />
      )}

      {insights.hours.some(h => h.sales) && (
        <section className="panel">
          <p className="kicker mb-3">أوقات الذروة · {period.label}</p>
          <HourBands rows={insights.hours} />
        </section>
      )}

      <SearchField value={q} onChange={setQ} placeholder="ابحث باسم الكاشير" />
      <div className="sort-bar">
        {([['sales', 'المبيعات'], ['share', 'الحصة'], ['receipts', 'الفواتير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {loading && !dash && <Skeleton />}

      <div className="desk-table card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>الكاشير</th><th>المبيعات</th><th>الحصة</th><th>فواتير</th><th>متوسط</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={`${c.cashierId}-${c.name}`} onClick={() => { setOpen(c); setTab('overview'); }}>
                <td><Medal rank={i + 1} /></td>
                <td className="font-extrabold">{c.name}</td>
                <td className="num">{moneyIq(c.salesAmount)}</td>
                <td className="num">{pct(shareOf(c.salesAmount, shareDen))}</td>
                <td className="num">{c.receiptCount}</td>
                <td className="num">{moneyIq(avgTicket(c.salesAmount, c.receiptCount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stack-grid stagger people-mobile">
        {rows.map((c, i) => (
          <button key={`${c.cashierId}-${c.name}`} type="button" className="card person-card cashier-card" onClick={() => { setOpen(c); setTab('overview'); }}>
            <div className="flex items-start gap-3">
              <Medal rank={i + 1} />
              <div className="min-w-0 flex-1 text-start">
                <h2 className="text-lg font-extrabold">{c.name}</h2>
                <p className="num mt-2 text-[26px] font-black text-gold">{moneyIq(c.salesAmount)}</p>
                {(() => {
                  const prev = prevDash?.cashiers.find(x => x.name === c.name)
                    || prevDash?.malls.find(x => x.sectionName === c.name);
                  const prevSales = prev && 'salesAmount' in prev ? prev.salesAmount : 0;
                  return prev && prevSales > 0 ? <div className="mt-1"><Delta value={deltaPct(c.salesAmount, prevSales)} /></div> : null;
                })()}
                <p className="mt-1 text-sm font-extrabold text-muted">
                  {pct(shareOf(c.salesAmount, shareDen))} · {c.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(c.salesAmount, c.receiptCount))}
                </p>
                <div className="mt-2"><Track value={shareOf(c.salesAmount, shareDen)} tone="gold" /></div>
                {todayMap.get(c.name) && (
                  <p className="mt-2 text-xs font-extrabold text-ok">اليوم {moneyIq(todayMap.get(c.name)!.sales)}</p>
                )}
              </div>
            </div>
          </button>
        ))}
        {!loading && !rows.length && (
          <Empty title="لا كاشير في هذه المدة" hint="تظهر الأسماء بعد مزامنة لوحة التحكم" />
        )}
      </div>

      <Sheet open={!!open} title={open?.name || 'الكاشير'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="view-toggle">
              {([['overview', 'نظرة'], ['sellers', 'البائعون'], ['products', 'منتجات'], ['invoices', 'فواتير']] as const).map(([k, label]) => (
                <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === 'overview' && (
              <>
                <StatGrid sales={open.salesAmount} receipts={open.receiptCount} totalSales={salesTotal} />
                {openToday && (
                  <div className="detail-cell highlight">
                    <p>مبيعات اليوم</p>
                    <strong className="num">{moneyIq(openToday.sales)} · {openToday.receipts} فاتورة</strong>
                  </div>
                )}
              </>
            )}
            {tab === 'sellers' && (
              detailSellers.length
                ? detailSellers.map(s => (
                  <Link key={s.id} to={`/team?q=${encodeURIComponent(s.name)}`} className="detail-cell stat-link">
                    <p>{s.name}</p>
                    <strong className="num">{moneyIq(s.sales)} · {pct(s.share)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{s.receipts} فاتورة</p>
                  </Link>
                ))
                : <p className="text-sm font-bold text-muted">لا بائعون على حركات هذا الكاشير</p>
            )}
            {tab === 'products' && (
              detailProducts.length
                ? detailProducts.map(p => (
                  <div key={p.name} className="detail-cell">
                    <p>{p.name}</p>
                    <strong className="num">{moneyIq(p.sales)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{pieces(p.qty)} · {p.count} حركة</p>
                  </div>
                ))
                : <p className="text-sm font-bold text-muted">لا منتجات</p>
            )}
            {tab === 'invoices' && (
              <>
                <ReceiptList groups={detailReceipts} onOpen={setLine} />
                <MoveList lines={detailLines} onOpen={setLine} empty="لا حركات لهذا الكاشير" />
              </>
            )}
          </div>
        )}
      </Sheet>
      <LineSheet open={line} onClose={() => setLine(null)} />
    </div>
  );
}
