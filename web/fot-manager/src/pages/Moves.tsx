import { useMemo, useState } from 'react';
import { downloadText, managerCsv, moneyIq, pieces, receiptLabel, stampLabel, type LineRow } from '../api';
import { useManager } from '../store';
import { Empty, ErrorBox, Medal, SearchField, Sheet, Skeleton, useToast } from '../ui';
import { WeekBar } from '../week';

type Mode = 'lines' | 'products';

export function Moves() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useManager();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('lines');
  const [open, setOpen] = useState<LineRow | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return lines;
    return lines.filter(l =>
      l.productName.includes(needle)
      || l.salesmanName.includes(needle)
      || (l.cashierName ?? '').includes(needle)
      || (l.mallName ?? '').includes(needle)
      || String(l.receiptNumber ?? '').includes(needle));
  }, [lines, q]);

  const products = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; sales: number; comm: number; count: number }>();
    for (const l of filtered) {
      const row = map.get(l.productName) ?? { name: l.productName, qty: 0, sales: 0, comm: 0, count: 0 };
      row.qty += l.quantity;
      row.sales += l.salesAmount;
      row.comm += l.commissionAmount;
      row.count += 1;
      map.set(l.productName, row);
    }
    return [...map.values()].sort((a, b) => b.comm - a.comm);
  }, [filtered]);

  const totalSales = filtered.reduce((s, l) => s + l.salesAmount, 0);
  const totalComm = filtered.reduce((s, l) => s + l.commissionAmount, 0);
  const totalQty = filtered.reduce((s, l) => s + l.quantity, 0);

  if (err && !dash) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">حركات الأسبوع</p>
        <h1 className="display text-[28px] font-black">العمولات والمبيعات</h1>
        <p className="num mt-3 text-[30px] font-black">{moneyIq(totalSales)}</p>
        <p className="num mt-1 text-lg font-extrabold text-gold">{moneyIq(totalComm)}</p>
        <p className="mt-2 text-sm font-bold text-muted">{filtered.length} حركة · {pieces(totalQty)}</p>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`متابعة-${weekStart || 'week'}.csv`, managerCsv(filtered));
            toast('تم تنزيل الملف');
          }}
        >
          تصدير الحركات
        </button>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث بالمنتج أو البائع أو الكاشير أو الفاتورة" />
      <div className="toolbar">
        <button type="button" className={`chip ${mode === 'lines' ? 'chip-on' : ''}`} onClick={() => setMode('lines')}>الحركات</button>
        <button type="button" className={`chip ${mode === 'products' ? 'chip-on' : ''}`} onClick={() => setMode('products')}>المنتجات</button>
      </div>
      {loading && !lines.length && <Skeleton />}

      {mode === 'lines' && (
        filtered.length ? (
          <div className="line-stack">
            {filtered.map(l => (
              <button key={l.id} type="button" className="line-card" onClick={() => setOpen(l)}>
                <span className="line-mark">{(l.productName || 'م').charAt(0)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-extrabold">{l.productName}</span>
                  <span className="line-meta">
                    <span className="qty-chip">{l.quantity} قطعة</span>
                    <span className="chip-soft">{l.salesmanName}</span>
                    <span className="chip-soft">{l.cashierName}</span>
                    <span className="chip-soft">{receiptLabel(l.receiptNumber)}</span>
                  </span>
                </span>
                <span className="text-end">
                  <span className="num block text-[15px] font-extrabold">{moneyIq(l.salesAmount)}</span>
                  <span className="num block text-xs font-extrabold text-gold">{moneyIq(l.commissionAmount)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : <Empty title="لا حركات هذا الأسبوع" />
      )}

      {mode === 'products' && (
        products.length ? (
          <div className="card p-4">
            {products.map((p, i) => (
              <div key={p.name} className="rank-row">
                <Medal rank={i + 1} />
                <div className="min-w-0">
                  <p className="truncate font-extrabold">{p.name}</p>
                  <p className="text-xs font-bold text-muted">{p.count} حركة · {pieces(p.qty)}</p>
                </div>
                <div className="text-end">
                  <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
                  <p className="num text-xs font-extrabold text-gold">{moneyIq(p.comm)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty title="لا منتجات هذا الأسبوع" />
      )}

      <Sheet open={!!open} title={open?.productName || 'الحركة'} onClose={() => setOpen(null)}>
        {open && (
          <div className="detail-grid">
            <div className="detail-hero">
              <p className="kicker">المبيعات / العمولة</p>
              <p className="num mt-1 text-[28px] font-extrabold">{moneyIq(open.salesAmount)}</p>
              <p className="num mt-1 text-lg font-extrabold text-gold">{moneyIq(open.commissionAmount)}</p>
            </div>
            <div className="detail-cell"><p>البائع</p><strong>{open.salesmanName}</strong></div>
            <div className="detail-cell"><p>الكاشير</p><strong>{open.cashierName || '—'}</strong></div>
            <div className="detail-cell"><p>المول</p><strong>{open.mallName || '—'}</strong></div>
            <div className="detail-cell"><p>الفاتورة</p><strong>{receiptLabel(open.receiptNumber)}</strong></div>
            <div className="detail-cell"><p>الوقت</p><strong>{stampLabel(open.occurredAt)}</strong></div>
            <div className="detail-cell"><p>القطع</p><strong>{pieces(open.quantity)}</strong></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
