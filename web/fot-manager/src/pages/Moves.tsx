import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, downloadText, managerCsv, moneyIq, todayKey, type LineRow } from '../api';
import { groupReceipts, lineCashier, rankProducts } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager, useShopInsights } from '../store';
import {
  DayStrip, Empty, ErrorBox, Medal, MetricStrip, PageHero, RecentFeed, SearchField, Skeleton, useToast,
} from '../ui';
import { PeriodBar } from '../week';

type Mode = 'invoices' | 'lines' | 'products' | 'sellers' | 'cashiers';

export function Moves() {
  const {
    weekStart, setWeek, dash, weeks, lines, scopedLines, activityLines, scopedCashiers, period, periodKind,
    setPeriodKind, customFrom, customTo, setCustom, periodTotals,
    err, loading, reload,
  } = useManager();
  const insights = useShopInsights();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  const [mode, setMode] = useState<Mode>('invoices');
  const [seller, setSeller] = useState<string>('');
  const [cashier, setCashier] = useState<string>('');
  const [open, setOpen] = useState<LineRow | null>(null);

  const day = params.get('day') ?? '';
  function setDay(next?: string) {
    const copy = new URLSearchParams(params);
    if (next) copy.set('day', next);
    else copy.delete('day');
    setParams(copy, { replace: true });
  }

  const filtered = useMemo(() => {
    const needle = q.trim();
    return activityLines.filter(l => {
      if (day && l.occurredAt.slice(0, 10) !== day) return false;
      if (seller && l.salesmanName !== seller) return false;
      if (cashier && lineCashier(l) !== cashier) return false;
      if (!needle) return true;
      return l.productName.includes(needle)
        || l.salesmanName.includes(needle)
        || lineCashier(l).includes(needle)
        || String(l.receiptNumber ?? '').includes(needle);
    });
  }, [activityLines, q, seller, cashier, day]);

  const receipts = useMemo(() => groupReceipts(filtered), [filtered]);
  const products = useMemo(() => {
    const ranked = rankProducts(filtered);
    if (ranked.length || q.trim() || seller || cashier || day) return ranked;
    return (dash?.products ?? []).map(p => ({
      name: p.name,
      sales: Number(p.salesAmount) || 0,
      commission: Number(p.commissionAmount) || 0,
      count: Number(p.count) || 0,
      qty: Number(p.quantity) || 0,
    }));
  }, [filtered, dash?.products, q, seller, cashier, day]);
  const widened = !scopedLines.length && lines.length > 0;
  const sellerNames = useMemo(() => [...new Set(activityLines.map(l => l.salesmanName).filter(Boolean))], [activityLines]);
  const cashierNames = useMemo(() => {
    const fromLines = activityLines.map(l => lineCashier(l)).filter(Boolean);
    const fromRows = scopedCashiers.map(c => c.name);
    return [...new Set([...fromRows, ...fromLines])];
  }, [activityLines, scopedCashiers]);

  const bySeller = useMemo(() => {
    const map = new Map<string, { name: string; sales: number; qty: number; count: number }>();
    for (const l of filtered) {
      const row = map.get(l.salesmanName) ?? { name: l.salesmanName, sales: 0, qty: 0, count: 0 };
      row.sales += l.salesAmount;
      row.qty += l.quantity;
      row.count += 1;
      map.set(l.salesmanName, row);
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [filtered]);

  const byCashier = useMemo(() => {
    const map = new Map<string, { name: string; sales: number; qty: number; count: number }>();
    for (const l of filtered) {
      const name = lineCashier(l) || 'كاشير';
      const row = map.get(name) ?? { name, sales: 0, qty: 0, count: 0 };
      row.sales += l.salesAmount;
      row.qty += l.quantity;
      row.count += 1;
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [filtered]);

  const totalSales = filtered.reduce((s, l) => s + l.salesAmount, 0);

  if (err && !dash) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="page-flow fade-up">
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
      <PageHero
        kicker={day ? `فواتير ${dayLabel(day)}` : `فواتير ${period.label}`}
        title="كل التفاصيل"
        value={moneyIq(totalSales || periodTotals.sales)}
        hint={`${receipts.length} فاتورة · ${filtered.length} حركة${widened ? ' · حركات الأسبوع' : ''}`}
      >
        <MetricStrip
          items={[
            { label: 'فواتير', value: String(receipts.length), tone: 'goal' },
            { label: 'حركات', value: String(filtered.length), tone: 'ok' },
            { label: 'بائعون', value: String(sellerNames.length), tone: 'gold' },
            { label: 'كاشير', value: String(cashierNames.length), tone: 'warn' },
          ]}
        />
        <div className="hero-actions mt-3">
          <button
            type="button"
            className="pill"
            onClick={() => {
              downloadText(`فواتير-${period.from}.csv`, managerCsv(filtered));
              toast('تم تنزيل الملف');
            }}
          >
            تصدير
          </button>
          <button type="button" className="pill" onClick={() => window.print()}>طباعة</button>
        </div>
      </PageHero>
      {mode === 'invoices' && receipts.length > 0 && (
        <RecentFeed receipts={receipts} limit={5} title="آخر الفواتير المفلترة" to="/moves" />
      )}
      {insights.days.length > 0 && (
        <section className="card p-4">
          <DayStrip
            days={insights.days}
            today={todayKey()}
            active={day || (period.singleDay ? period.from : undefined)}
            onSelect={key => {
              if (day === key) {
                setDay();
                return;
              }
              setDay(key);
              setCustom(key, key);
              setPeriodKind('custom');
            }}
          />
        </section>
      )}
      <SearchField value={q} onChange={setQ} placeholder="ابحث بالمنتج أو البائع أو الكاشير أو رقم الفاتورة" />
      <div className="view-toggle">
        {([['invoices', 'الفواتير'], ['lines', 'الحركات'], ['products', 'المنتجات'], ['sellers', 'البائع'], ['cashiers', 'الكاشير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>
      {day && (
        <button type="button" className="pill mt-2" onClick={() => setDay()}>
          إلغاء فلتر {dayLabel(day)}
        </button>
      )}
      {(sellerNames.length > 1 || cashierNames.length > 1) && (
        <div className="toolbar">
          <button type="button" className={`chip ${!seller ? 'chip-on' : ''}`} onClick={() => setSeller('')}>كل البائعين</button>
          {sellerNames.map(n => (
            <button key={n} type="button" className={`chip ${seller === n ? 'chip-on' : ''}`} onClick={() => setSeller(s => s === n ? '' : n)}>{n}</button>
          ))}
        </div>
      )}
      {cashierNames.length > 0 && (
        <div className="toolbar">
          <button type="button" className={`chip ${!cashier ? 'chip-on' : ''}`} onClick={() => setCashier('')}>كل الكاشير</button>
          {cashierNames.map(n => (
            <button key={n} type="button" className={`chip ${cashier === n ? 'chip-on' : ''}`} onClick={() => setCashier(s => s === n ? '' : n)}>{n}</button>
          ))}
        </div>
      )}
      {widened && <p className="data-note">لا حركات بتاريخ هذه المدة، لذلك تُعرض فواتير الأسبوع.</p>}
      {loading && !activityLines.length && <Skeleton />}

      {mode === 'invoices' && <ReceiptList groups={receipts} onOpen={setOpen} />}
      {mode === 'lines' && <MoveList lines={filtered} onOpen={setOpen} />}
      {mode === 'products' && (
        products.length ? (
          <div className="card p-4">
            {products.map((p, i) => (
              <div key={p.name} className="rank-row">
                <Medal rank={i + 1} />
                <div className="min-w-0">
                  <p className="truncate font-extrabold">{p.name}</p>
                  <p className="text-xs font-bold text-muted">{p.count} حركة</p>
                </div>
                <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
              </div>
            ))}
          </div>
        ) : <Empty title="لا منتجات هذا الأسبوع" />
      )}
      {mode === 'sellers' && (
        bySeller.length ? (
          <div className="card p-4">
            {bySeller.map((s, i) => (
              <button key={s.name} type="button" className="rank-row stat-link" onClick={() => setSeller(s.name)}>
                <Medal rank={i + 1} />
                <div className="min-w-0 text-start">
                  <p className="truncate font-extrabold">{s.name}</p>
                  <p className="text-xs font-bold text-muted">{s.count} حركة</p>
                </div>
                <p className="num text-sm font-extrabold">{moneyIq(s.sales)}</p>
              </button>
            ))}
          </div>
        ) : <Empty title="لا حركات حسب البائع" />
      )}
      {mode === 'cashiers' && (
        byCashier.length ? (
          <div className="card p-4">
            {byCashier.map((c, i) => (
              <button key={c.name} type="button" className="rank-row stat-link" onClick={() => setCashier(c.name)}>
                <Medal rank={i + 1} />
                <div className="min-w-0 text-start">
                  <p className="truncate font-extrabold">{c.name}</p>
                  <p className="text-xs font-bold text-muted">{c.count} حركة</p>
                </div>
                <p className="num text-sm font-extrabold">{moneyIq(c.sales)}</p>
              </button>
            ))}
          </div>
        ) : <Empty title="لا حركات حسب الكاشير" />
      )}

      <LineSheet open={open} onClose={() => setOpen(null)} />
    </div>
  );
}
