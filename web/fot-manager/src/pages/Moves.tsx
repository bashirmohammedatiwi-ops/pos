import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayLabel, moneyIq, type LineRow } from '../api';
import { groupReceipts, lineCashier, rankProducts } from '../insights';
import { LineSheet, MoveList, PhoneTable, ReceiptList } from '../lines';
import { ExportMenu } from '../ExportMenu';
import { useManager } from '../store';
import { Empty, ErrorBox, PageHero, SearchField, Skeleton } from '../ui';
import { PeriodBar } from '../picker';

type Mode = 'invoices' | 'lines' | 'products' | 'sellers' | 'cashiers';

export function Moves() {
  const {
    dash, lines, scopedLines, activityLines, scopedCashiers, period, periodTotals,
    err, loading, reload,
  } = useManager();
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
      <PeriodBar />
      <PageHero
        kicker={day ? `فواتير ${dayLabel(day)}` : `فواتير ${period.label}`}
        title="الفواتير"
        value={moneyIq(totalSales || periodTotals.sales)}
        hint={`${receipts.length} فاتورة${seller || cashier || q.trim() ? ' بعد التصفية' : ''}${widened ? ' · حركات الأسبوع' : ''}`}
      >
        <div className="hero-actions mt-3">
          <ExportMenu title="تقرير الفواتير" />
        </div>
      </PageHero>
      <section className="s-card s-filter">
        <SearchField value={q} onChange={setQ} placeholder="رقم الفاتورة أو اسم منتج" />
        <div className="s-filter-row">
          <label>
            <span>البائع</span>
            <select value={seller} onChange={e => setSeller(e.target.value)}>
              <option value="">الكل</option>
              {sellerNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            <span>الكاشير</span>
            <select value={cashier} onChange={e => setCashier(e.target.value)}>
              <option value="">الكل</option>
              {cashierNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {(seller || cashier || q.trim() || day) && (
          <button type="button" className="s-back" onClick={() => { setSeller(''); setCashier(''); setQ(''); if (day) setDay(); }}>
            مسح التصفية
          </button>
        )}
      </section>
      <div className="view-toggle">
        {([['invoices', 'الفواتير'], ['products', 'المنتجات'], ['lines', 'كل الحركات']] as const).map(([k, label]) => (
          <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{label}</button>
        ))}
      </div>
      {widened && <p className="data-note">لا حركات بتاريخ هذه المدة، لذلك تُعرض فواتير الأسبوع.</p>}
      {loading && !activityLines.length && <Skeleton />}

      {mode === 'invoices' && <ReceiptList groups={receipts} onOpen={setOpen} />}
      {mode === 'lines' && <MoveList lines={filtered} onOpen={setOpen} />}
      {mode === 'products' && (
        products.length ? (
          <PhoneTable
            columns={['#', 'المنتج', 'المبلغ']}
            rows={products.map((p, i) => ({
              key: p.name,
              cells: [
                { text: String(i + 1), num: true },
                { text: p.name, sub: `${p.count} حركة · ${p.qty} قطعة` },
                { text: moneyIq(p.sales), num: true },
              ],
            }))}
          />
        ) : <Empty title="لا منتجات هذا الأسبوع" />
      )}
      {mode === 'sellers' && (
        bySeller.length ? (
          <PhoneTable
            columns={['#', 'البائع', 'المبلغ']}
            rows={bySeller.map((s, i) => ({
              key: s.name,
              onClick: () => setSeller(s.name),
              cells: [
                { text: String(i + 1), num: true },
                { text: s.name, sub: `${s.count} حركة` },
                { text: moneyIq(s.sales), num: true },
              ],
            }))}
          />
        ) : <Empty title="لا حركات حسب البائع" />
      )}
      {mode === 'cashiers' && (
        byCashier.length ? (
          <PhoneTable
            columns={['#', 'الكاشير', 'المبلغ']}
            rows={byCashier.map((c, i) => ({
              key: c.name,
              onClick: () => setCashier(c.name),
              cells: [
                { text: String(i + 1), num: true },
                { text: c.name, sub: `${c.count} حركة` },
                { text: moneyIq(c.sales), num: true },
              ],
            }))}
          />
        ) : <Empty title="لا حركات حسب الكاشير" />
      )}

      <LineSheet open={open} onClose={() => setOpen(null)} />
    </div>
  );
}
