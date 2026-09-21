import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { downloadText, moneyIq, pieces, pct, productCsv, shareOf } from '../api';
import { peopleForProduct, rankProducts } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Empty, ErrorBox, Medal, SearchField, Sheet, Skeleton, Track, useToast } from '../ui';
import { WeekBar } from '../week';
import type { LineRow } from '../api';

type Sort = 'sales' | 'qty';
type Tab = 'sellers' | 'cashiers' | 'invoices';

export function Products() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useManager();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  const [sort, setSort] = useState<Sort>('sales');
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('sellers');
  const [line, setLine] = useState<LineRow | null>(null);

  const total = dash?.week.salesAmount || 0;
  const rows = useMemo(() => {
    const list = rankProducts(lines).filter(p => !q.trim() || p.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'qty') return b.qty - a.qty;
      return b.sales - a.sales;
    });
  }, [lines, q, sort]);

  const detail = open ? peopleForProduct(lines, open) : null;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact command">
        <p className="kicker">منتجات الأسبوع</p>
        <h1 className="display text-[28px] font-black">ماذا يُباع</h1>
        <p className="mt-2 text-sm font-bold text-muted">{rows.length} منتجاً — اضغط لترى البائع والكاشير والفواتير</p>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`منتجات-${weekStart || 'week'}.csv`, productCsv(rows.map(p => ({
              name: p.name, quantity: p.qty, salesAmount: p.sales, commissionAmount: 0, count: p.count,
            }))));
            toast('تم تنزيل المنتجات');
          }}
        >
          تصدير المنتجات
        </button>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث باسم المنتج" />
      <div className="toolbar">
        {([['sales', 'المبيعات'], ['qty', 'القطع']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {loading && !rows.length && <Skeleton />}
      <div className="card p-4">
        {rows.map((p, i) => (
          <button key={p.name} type="button" className="rank-row stat-link" onClick={() => { setOpen(p.name); setTab('sellers'); }}>
            <Medal rank={i + 1} />
            <div className="min-w-0 text-start">
              <p className="truncate font-extrabold">{p.name}</p>
              <p className="text-xs font-bold text-muted">{pieces(p.qty)} · {p.count} حركة · {pct(shareOf(p.sales, total))}</p>
              <div className="mt-2"><Track value={shareOf(p.sales, total)} tone="gold" /></div>
            </div>
            <div className="text-end">
              <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
            </div>
          </button>
        ))}
        {!loading && !rows.length && <Empty title="لا منتجات هذا الأسبوع" />}
      </div>

      <Sheet open={!!open} title={open || 'المنتج'} onClose={() => setOpen(null)}>
        {detail && (
          <div className="space-y-3">
            <div className="toolbar">
              {([['sellers', 'البائعون'], ['cashiers', 'الكاشير'], ['invoices', 'فواتير']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`chip ${tab === k ? 'chip-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === 'sellers' && detail.sellers.map(s => (
              <div key={s.id} className="detail-cell">
                <p>{s.name}</p>
                <strong className="num">{moneyIq(s.sales)} · {pct(s.share)}</strong>
                <p className="mt-1 text-xs font-bold text-muted">{pieces(s.pieces)} · {s.receipts} فاتورة</p>
              </div>
            ))}
            {tab === 'cashiers' && (
              detail.cashiers.length
                ? detail.cashiers.map(c => (
                  <div key={c.id} className="detail-cell">
                    <p>{c.name}</p>
                    <strong className="num">{moneyIq(c.sales)} · {pct(c.share)}</strong>
                  </div>
                ))
                : <p className="text-sm font-bold text-muted">لا كاشير ظاهر على هذا المنتج</p>
            )}
            {tab === 'invoices' && (
              <>
                <ReceiptList groups={detail.receipts} onOpen={setLine} />
                <MoveList lines={detail.lines} onOpen={setLine} />
              </>
            )}
          </div>
        )}
      </Sheet>
      <LineSheet open={line} onClose={() => setLine(null)} />
    </div>
  );
}
