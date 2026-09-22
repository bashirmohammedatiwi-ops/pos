import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, deltaPct, downloadText, goalLabel, goalTone, goalValue, moneyIq, pct, shareOf, teamCsv,
  type LineRow, type SellerRow,
} from '../api';
import { cashiersForSeller, groupReceipts, linesForSeller, mergeLines, rankProducts } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager, useShopInsights } from '../store';
import {
  Badge, Delta, Empty, ErrorBox, FilterStats, LeaderCard, Medal, MetricStrip, PageHero, Podium,
  Ring, SearchField, SectionCard, Sheet, Skeleton, StatGrid, Track, useToast,
} from '../ui';
import { avgTicket, todayKey } from '../api';
import { PeriodBar } from '../week';

type Sort = 'sales' | 'receipts' | 'share' | 'goals' | 'commission';
type Tab = 'overview' | 'goals' | 'cashiers' | 'products' | 'invoices';
type Filter = 'all' | 'active' | 'goals' | 'due';

export function Team() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, scopedLines, scopedSellers, period, periodKind,
    setPeriodKind, customFrom, customTo, setCustom, periodTotals, shareBase,
    err, loading, reload,
  } = useManager();
  const insights = useShopInsights();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('sales');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<SellerRow | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [hideZero, setHideZero] = useState(true);
  const [line, setLine] = useState<LineRow | null>(null);
  const [extraLines, setExtraLines] = useState<LineRow[]>([]);
  const opened = useRef(false);
  const stale = dash?.lastSyncAt != null && Date.now() - (Date.parse(dash.lastSyncAt) || 0) > 15 * 60 * 1000;

  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);

  async function openSeller(s: SellerRow) {
    setOpen(s);
    setTab('overview');
    setExtraLines([]);
    try {
      const d = await api.seller(s.salesmanId, weekStart);
      setExtraLines(d.lines);
    } catch { /* local lines */ }
  }

  useEffect(() => {
    const needle = params.get('q')?.trim();
    if (opened.current || !needle || !dash) return;
    const hit = scopedSellers.find(s => s.name === needle) ?? dash.sellers.find(s => s.name === needle);
    if (hit) { opened.current = true; void openSeller(hit); }
  }, [dash, scopedSellers, params]);

  const salesTotal = periodTotals.sales || shareBase;
  const shareDen = shareBase;
  const rows = useMemo(() => {
    const list = scopedSellers.filter(s => {
      if (q.trim() && !s.name.includes(q.trim())) return false;
      if (hideZero && s.salesAmount <= 0 && s.receiptCount <= 0) return false;
      if (filter === 'active' && s.salesAmount <= 0) return false;
      if (filter === 'goals' && s.goalCount <= 0) return false;
      if (filter === 'due' && s.balanceDue <= 0) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      if (sort === 'share') return shareOf(b.salesAmount, shareDen) - shareOf(a.salesAmount, shareDen);
      if (sort === 'goals') return (b.goalCount ? b.goalPercent : -1) - (a.goalCount ? a.goalPercent : -1);
      if (sort === 'commission') return b.commissionAmount - a.commissionAmount;
      return b.salesAmount - a.salesAmount;
    });
  }, [scopedSellers, q, sort, shareDen, hideZero, filter]);

  const activeCount = scopedSellers.filter(s => s.salesAmount > 0).length;
  const goalsCount = scopedSellers.filter(s => s.goalCount > 0).length;
  const dueCount = scopedSellers.filter(s => s.balanceDue > 0).length;

  const detailLines = open ? mergeLines(linesForSeller(scopedLines, open.salesmanId), extraLines.filter(l => l.salesmanId === open.salesmanId && l.occurredAt.slice(0, 10) >= period.from && l.occurredAt.slice(0, 10) <= period.to)) : [];
  const detailCashiers = open ? cashiersForSeller(scopedLines, open.salesmanId) : [];
  const detailProducts = open ? rankProducts(detailLines) : [];
  const detailReceipts = open ? groupReceipts(detailLines) : [];
  const prevSeller = open ? prevDash?.sellers.find(s => s.salesmanId === open.salesmanId) : undefined;

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
        kicker={`فريق المبيعات · ${period.label}`}
        title="البائعون"
        value={moneyIq(salesTotal)}
        hint={`${rows.length} بائعاً · ${periodTotals.receipts} فاتورة`}
        stale={stale}
      >
        <MetricStrip
          items={[
            { label: 'نشطون', value: String(activeCount), tone: 'ok' },
            { label: 'عمولات', value: moneyIq(rows.reduce((s, r) => s + r.commissionAmount, 0)), tone: 'goal' },
            { label: 'فواتير', value: String(periodTotals.receipts), tone: 'gold' },
            { label: 'متوسط', value: moneyIq(avgTicket(salesTotal, periodTotals.receipts)), tone: 'warn' },
          ]}
        />
        <div className="hero-actions mt-3">
          <button
            type="button"
            className="pill"
            onClick={() => {
              downloadText(`بائعون-${period.from}.csv`, teamCsv(scopedSellers, salesTotal));
              toast('تم تنزيل ملف البائعين');
            }}
          >
            تصدير
          </button>
          <Link to="/commissions" className="pill">العمولات</Link>
          <Link to="/goals" className="pill">الأهداف</Link>
        </div>
      </PageHero>

      {rows.filter(s => s.salesAmount > 0).length > 0 && (
        <Podium
          items={rows.filter(s => s.salesAmount > 0).slice(0, 3).map(s => ({
            id: String(s.salesmanId),
            name: s.name,
            value: moneyIq(s.salesAmount),
            hint: `${s.receiptCount} فاتورة · عمولة ${moneyIq(s.commissionAmount)}`,
          }))}
          onPick={item => {
            const hit = rows.find(s => s.name === item.name);
            if (hit) void openSeller(hit);
          }}
        />
      )}

      <section className="people-toolbar card">
        <SearchField value={q} onChange={setQ} placeholder="ابحث باسم البائع" />
        <FilterStats
          active={filter}
          onPick={k => setFilter(k as Filter)}
          items={[
            { key: 'all', count: scopedSellers.length, label: 'الكل' },
            { key: 'active', count: activeCount, label: 'نشط' },
            { key: 'goals', count: goalsCount, label: 'أهداف' },
            { key: 'due', count: dueCount, label: 'مستحق' },
          ]}
        />
        <div className="sort-bar">
          {([['sales', 'المبيعات'], ['commission', 'العمولة'], ['share', 'الحصة'], ['receipts', 'الفواتير'], ['goals', 'التاركت']] as const).map(([k, label]) => (
            <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
          ))}
          <button type="button" className={hideZero ? 'on muted' : 'muted'} onClick={() => setHideZero(v => !v)}>
            {hideZero ? 'إخفاء بلا حركة' : 'إظهار الكل'}
          </button>
        </div>
      </section>
      {loading && !dash && <Skeleton />}

      <SectionCard kicker={period.label} title="قائمة البائعين" className="people-roster">
      <div className="desk-table">
        <table>
          <thead>
            <tr>
              <th>#</th><th>البائع</th><th>المبيعات</th><th>العمولة</th><th>الحصة</th><th>فواتير</th><th>تاركت</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.salesmanId} onClick={() => void openSeller(s)}>
                <td><Medal rank={i + 1} /></td>
                <td className="font-extrabold">{s.name}</td>
                <td className="num">{moneyIq(s.salesAmount)}</td>
                <td className="num">{moneyIq(s.commissionAmount)}</td>
                <td className="num">{pct(shareOf(s.salesAmount, shareDen))}</td>
                <td className="num">{s.receiptCount}</td>
                <td>{s.goalCount ? `${Math.round(s.goalPercent)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="leader-list stagger people-mobile mt-3">
        {rows.map((s, i) => {
          const share = shareOf(s.salesAmount, shareDen);
          const prev = prevDash?.sellers.find(x => x.salesmanId === s.salesmanId);
          return (
            <div key={s.salesmanId}>
              <LeaderCard
                rank={i + 1}
                name={s.name}
                sales={s.salesAmount}
                meta={`عمولة ${moneyIq(s.commissionAmount)} · ${s.receiptCount} فاتورة · ${pct(share)}`}
                share={share}
                tone="goal"
                badge={s.goalCount > 0 ? <Badge tone={goalTone(s.goalPercent) === 'goal' ? 'goal' : goalTone(s.goalPercent)}>{goalLabel(s.goalPercent)}</Badge> : undefined}
                onClick={() => void openSeller(s)}
              />
              {prev && prev.salesAmount > 0 && (
                <div className="px-4 pb-1"><Delta value={deltaPct(s.salesAmount, prev.salesAmount)} /></div>
              )}
              {s.balanceDue > 0 && <p className="px-4 pb-2 text-xs font-bold text-warn">مستحق {moneyIq(s.balanceDue)}</p>}
            </div>
          );
        })}
        {!loading && !rows.length && <Empty title="لا بائعون في هذه المدة" hint="غيّر المدة أو الفلتر" />}
      </div>
      </SectionCard>

      <Sheet open={!!open} title={open?.name || 'البائع'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="view-toggle">
              {([['overview', 'نظرة'], ['goals', 'أهداف'], ['cashiers', 'كاشير'], ['products', 'منتجات'], ['invoices', 'فواتير']] as const).map(([k, label]) => (
                <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === 'overview' && (
              <>
                <StatGrid sales={open.salesAmount} receipts={open.receiptCount} commission={open.commissionAmount} totalSales={salesTotal} />
                {prevSeller && (
                  <div className="detail-cell">
                    <p>مقابل الأسبوع السابق</p>
                    <strong>{moneyIq(open.salesAmount)} مقابل {moneyIq(prevSeller.salesAmount)}</strong>
                  </div>
                )}
                {open.goalCount > 0 && (
                  <div className="flex items-center gap-3">
                    <Ring value={open.goalPercent} size={72} tone={goalTone(open.goalPercent)} />
                    <p className="text-sm font-bold text-muted">{open.goalsHit} من {open.goalCount} أهداف تحققت</p>
                  </div>
                )}
                {open.balanceDue > 0 && <div className="due-card"><span>المستحق</span><strong className="num">{moneyIq(open.balanceDue)}</strong></div>}
                <Link to={`/goals?q=${encodeURIComponent(open.name)}`} className="section-link">عرض أهداف {open.name}</Link>
              </>
            )}
            {tab === 'goals' && (
              (dash?.goals ?? []).filter(g => g.salesmanId === open.salesmanId).map(g => (
                <Link key={g.ruleId} to={`/goals?rule=${g.ruleId}`} className="detail-cell stat-link">
                  <p>{g.ruleName}</p>
                  <strong>{goalValue(g.targetType, g.sold)} من {goalValue(g.targetType, g.weeklyTarget)} · {pct(g.percent)}</strong>
                  <div className="mt-2"><Track value={g.percent} tone={goalTone(g.percent)} /></div>
                </Link>
              ))
            )}
            {tab === 'cashiers' && (
              detailCashiers.length
                ? detailCashiers.map(c => (
                  <div key={c.id} className="detail-cell">
                    <p>{c.name}</p>
                    <strong className="num">{moneyIq(c.sales)} · {pct(c.share)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{c.receipts} فاتورة</p>
                  </div>
                ))
                : <p className="text-sm font-bold text-muted">لا يظهر كاشير على حركات هذا البائع</p>
            )}
            {tab === 'products' && (
              detailProducts.length
                ? detailProducts.map(p => (
                  <div key={p.name} className="detail-cell">
                    <p>{p.name}</p>
                    <strong className="num">{moneyIq(p.sales)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{p.count} حركة</p>
                  </div>
                ))
                : <p className="text-sm font-bold text-muted">لا منتجات</p>
            )}
            {tab === 'invoices' && (
              <>
                <ReceiptList groups={detailReceipts} onOpen={setLine} />
                <MoveList lines={detailLines} onOpen={setLine} empty="لا حركات لهذا البائع" />
              </>
            )}
          </div>
        )}
      </Sheet>
      <LineSheet open={line} onClose={() => setLine(null)} />
    </div>
  );
}
