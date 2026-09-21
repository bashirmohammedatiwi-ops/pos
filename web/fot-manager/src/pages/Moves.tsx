import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, downloadText, managerCsv, moneyIq, todayKey, type LineRow } from '../api';
import { groupReceipts, lineCashier, rankProducts } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager, useShopInsights } from '../store';
import { DayStrip, Empty, ErrorBox, Medal, SearchField, Skeleton, useToast } from '../ui';
import { WeekBar } from '../week';

type Mode = 'invoices' | 'lines' | 'products' | 'sellers' | 'cashiers';

export function Moves() {
  const { weekStart, setWeek, dash, weeks, lines, cashiers, err, loading, reload } = useManager();
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
    return lines.filter(l => {
      if (day && l.occurredAt.slice(0, 10) !== day) return false;
      if (seller && l.salesmanName !== seller) return false;
      if (cashier && lineCashier(l) !== cashier) return false;
      if (!needle) return true;
      return l.productName.includes(needle)
        || l.salesmanName.includes(needle)
        || lineCashier(l).includes(needle)
        || String(l.receiptNumber ?? '').includes(needle);
    });
  }, [lines, q, seller, cashier, day]);

  const receipts = useMemo(() => groupReceipts(filtered), [filtered]);
  const products = useMemo(() => rankProducts(filtered), [filtered]);
  const sellerNames = useMemo(() => [...new Set(lines.map(l => l.salesmanName).filter(Boolean))], [lines]);
  const cashierNames = useMemo(() => {
    const fromLines = lines.map(l => lineCashier(l)).filter(Boolean);
    const fromRows = cashiers.map(c => c.name);
    return [...new Set([...fromRows, ...fromLines])];
  }, [lines, cashiers]);

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
    <div className="fade-up space-y-4">
      <section className="hero compact command">
        <p className="kicker">{day ? `فواتير ${dayLabel(day)}` : 'فواتير الأسبوع'}</p>
        <h1 className="display text-[28px] font-black">كل التفاصيل</h1>
        <p className="num mt-3 text-[30px] font-black">{moneyIq(totalSales)}</p>
        <p className="mt-2 text-sm font-bold text-muted">
          {receipts.length} فاتورة · {filtered.length} حركة
        </p>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`فواتير-${weekStart || 'week'}.csv`, managerCsv(filtered));
            toast('تم تنزيل الملف');
          }}
        >
          تصدير الحركات
        </button>
        <button type="button" className="pill mt-3" onClick={() => window.print()}>طباعة</button>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      {insights.days.length > 0 && (
        <section className="card p-4">
          <DayStrip days={insights.days} today={todayKey()} active={day || undefined} onSelect={key => setDay(day === key ? undefined : key)} />
        </section>
      )}
      <SearchField value={q} onChange={setQ} placeholder="ابحث بالمنتج أو البائع أو الكاشير أو رقم الفاتورة" />
      <div className="toolbar">
        {([['invoices', 'الفواتير'], ['lines', 'الحركات'], ['products', 'المنتجات'], ['sellers', 'حسب البائع'], ['cashiers', 'حسب الكاشير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${mode === k ? 'chip-on' : ''}`} onClick={() => setMode(k)}>{label}</button>
        ))}
        {day && (
          <button type="button" className="chip chip-on" onClick={() => setDay()}>
            يوم {dayLabel(day)} ×
          </button>
        )}
      </div>
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
      {loading && !lines.length && <Skeleton />}

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
