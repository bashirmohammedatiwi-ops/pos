import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  avgTicket, cashierCsv, dayKey, deltaPct, downloadText, lastSyncMs, moneyIq, pieces, todayKey,
  type CashierRow, type LineRow,
} from '../api';
import { groupReceipts, lineCashier, linesForCashier, rankProducts, sellersThroughCashier } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager, useShopInsights } from '../store';
import {
  Delta, Empty, ErrorBox, HourBands, LeaderCard, Medal, MetricStrip, PageHero, Podium, RecentFeed,
  SearchField, SectionCard, Sheet, Skeleton, StatGrid, useToast,
} from '../ui';
import { PeriodBar } from '../week';

type Sort = 'sales' | 'receipts';
type Tab = 'overview' | 'sellers' | 'products' | 'invoices';

export function Cashiers() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, lines, scopedLines, scopedCashiers, period, periodKind,
    setPeriodKind, customFrom, customTo, setCustom, periodTotals, shareBase,
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
  const todayRow = insights.days.find(d => d.key === todayKey());
  const todayKey_ = todayKey();

  const todayCashiers = useMemo(() => {
    const map = new Map<string, { name: string; sales: number; receipts: Set<string | number> }>();
    for (const l of lines.filter(x => dayKey(x.occurredAt) === todayKey_)) {
      const name = lineCashier(l) || 'كاشير';
      const row = map.get(name) ?? { name, sales: 0, receipts: new Set() };
      row.sales += l.salesAmount;
      row.receipts.add(l.receiptNumber ?? `x-${l.id}`);
      map.set(name, row);
    }
    return [...map.values()]
      .map(r => ({ name: r.name, sales: r.sales, receipts: r.receipts.size }))
      .sort((a, b) => b.sales - a.sales);
  }, [lines, todayKey_]);
  const todayMap = useMemo(() => new Map(todayCashiers.map(c => [c.name, c])), [todayCashiers]);

  const rows = useMemo(() => {
    const list = scopedCashiers.filter(c => !q.trim() || c.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      return b.salesAmount - a.salesAmount;
    });
  }, [scopedCashiers, q, sort]);

  const detailLines = open ? linesForCashier(scopedLines, open.name) : [];
  const detailSellers = open ? sellersThroughCashier(scopedLines, open.name) : [];
  const detailProducts = open ? rankProducts(detailLines) : [];
  const detailReceipts = open ? groupReceipts(detailLines) : [];
  const openToday = open ? todayCashiers.find(c => c.name === open.name) : undefined;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="page-flow fade-up people-page">
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
        days={insights.days}
        activeDay={period.singleDay ? period.from : undefined}
        today={todayKey()}
        onDaySelect={key => { setCustom(key, key); setPeriodKind('custom'); }}
      />

      <PageHero
        kicker={`أرض المحل · ${period.label}`}
        title="الكاشير"
        value={moneyIq(salesTotal)}
        hint={`${rows.filter(c => c.salesAmount > 0).length} كاشير نشط · ${periodTotals.receipts} فاتورة`}
        stale={stale}
      >
        <MetricStrip
          items={[
            { label: 'اليوم', value: moneyIq(todayRow?.sales ?? 0), tone: 'gold' },
            { label: 'فواتير', value: String(todayRow?.receipts ?? todayCashiers.reduce((s, c) => s + c.receipts, 0)), tone: 'goal' },
            { label: 'متوسط', value: moneyIq(avgTicket(salesTotal, periodTotals.receipts)), tone: 'ok' },
            { label: 'كاشير اليوم', value: String(todayCashiers.length), tone: 'gold' },
          ]}
        />
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`كاشير-${period.from}.csv`, cashierCsv(scopedCashiers, salesTotal));
            toast('تم تنزيل ملف الكاشير');
          }}
        >
          تصدير CSV
        </button>
      </PageHero>

      {todayCashiers.length > 0 && (
        <section className="card home-section today-live">
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
            hint: `${c.receiptCount} فاتورة`,
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

      <section className="people-toolbar card">
        <SearchField value={q} onChange={setQ} placeholder="ابحث باسم الكاشير" />
        <div className="sort-bar">
          {([['sales', 'المبيعات'], ['receipts', 'الفواتير']] as const).map(([k, label]) => (
            <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
          ))}
        </div>
      </section>
      {loading && !dash && <Skeleton />}

      <SectionCard kicker={period.label} title="قائمة الكاشير" className="people-roster">
      <div className="desk-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>الكاشير</th><th>المبيعات</th><th>فواتير</th><th>متوسط</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={`${c.cashierId}-${c.name}`} onClick={() => { setOpen(c); setTab('overview'); }}>
                <td><Medal rank={i + 1} /></td>
                <td className="font-extrabold">{c.name}</td>
                <td className="num">{moneyIq(c.salesAmount)}</td>
                <td className="num">{c.receiptCount}</td>
                <td className="num">{moneyIq(avgTicket(c.salesAmount, c.receiptCount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="leader-list stagger people-mobile mt-3">
        {rows.map((c, i) => {
          const todaySales = todayMap.get(c.name)?.sales;
          return (
            <div key={`${c.cashierId}-${c.name}`}>
              <LeaderCard
                rank={i + 1}
                name={c.name}
                sales={c.salesAmount}
                meta={`${c.receiptCount} فاتورة · متوسط ${moneyIq(avgTicket(c.salesAmount, c.receiptCount))}${todaySales ? ` · اليوم ${moneyIq(todaySales)}` : ''}`}
                tone="gold"
                onClick={() => { setOpen(c); setTab('overview'); }}
              />
              {(() => {
                const prev = prevDash?.cashiers.find(x => x.name === c.name)
                  || prevDash?.malls.find(x => x.sectionName === c.name);
                const prevSales = prev && 'salesAmount' in prev ? prev.salesAmount : 0;
                return prev && prevSales > 0 ? <div className="px-4 pb-1"><Delta value={deltaPct(c.salesAmount, prevSales)} /></div> : null;
              })()}
            </div>
          );
        })}
        {!loading && !rows.length && (
          <Empty title="لا كاشير في هذه المدة" hint="جرّب «اليوم» أو «الأسبوع كامل» — أو حدّث من لوحة التحكم" />
        )}
      </div>
      </SectionCard>

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
                <StatGrid sales={open.salesAmount} receipts={open.receiptCount} />
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
                    <strong className="num">{moneyIq(s.sales)}</strong>
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
