import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { avgTicket, cashierCsv, deltaPct, downloadText, moneyIq, pieces, pct, shareOf, type CashierRow, type LineRow } from '../api';
import { groupReceipts, linesForCashier, rankProducts, sellersThroughCashier } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Delta, Empty, ErrorBox, Medal, SearchField, Sheet, Skeleton, StatGrid, useToast } from '../ui';
import { WeekBar } from '../week';

type Sort = 'sales' | 'commission' | 'pieces' | 'receipts';
type Tab = 'overview' | 'sellers' | 'products' | 'invoices';

export function Cashiers() {
  const { weekStart, setWeek, dash, prevDash, weeks, lines, cashiers, err, loading, reload } = useManager();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('sales');
  const [open, setOpen] = useState<CashierRow | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [line, setLine] = useState<LineRow | null>(null);
  const opened = useRef(false);

  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  useEffect(() => {
    const needle = params.get('q')?.trim();
    if (opened.current || !needle) return;
    const hit = cashiers.find(c => c.name === needle);
    if (hit) { opened.current = true; setOpen(hit); setTab('overview'); }
  }, [cashiers, params]);

  const total = dash?.week.salesAmount || 0;

  const rows = useMemo(() => {
    const list = cashiers.filter(c => !q.trim() || c.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'commission') return b.commissionAmount - a.commissionAmount;
      if (sort === 'pieces') return b.pieceCount - a.pieceCount;
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      return b.salesAmount - a.salesAmount;
    });
  }, [cashiers, q, sort]);

  const detailLines = open ? linesForCashier(lines, open.name) : [];
  const detailSellers = open ? sellersThroughCashier(lines, open.name) : [];
  const detailProducts = open ? rankProducts(detailLines) : [];
  const detailReceipts = open ? groupReceipts(detailLines) : [];

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">أرض المحل</p>
        <h1 className="display text-[28px] font-black">كل كاشير</h1>
        <p className="mt-2 text-sm font-bold text-muted">
          {rows.length} كاشير · إجمالي {moneyIq(rows.reduce((s, c) => s + c.salesAmount, 0))} — المبيعات والقطع والفواتير لكل واحد
        </p>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`كاشير-${weekStart || 'week'}.csv`, cashierCsv(cashiers, total));
            toast('تم تنزيل ملف الكاشير');
          }}
        >
          تصدير الكاشير
        </button>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث باسم الكاشير" />
      <div className="toolbar">
        {([['sales', 'المبيعات'], ['commission', 'العمولة'], ['pieces', 'القطع'], ['receipts', 'الفواتير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {loading && !dash && <Skeleton />}

      <div className="desk-table card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>الكاشير</th><th>المبيعات</th><th>الحصة</th><th>العمولة</th><th>القطع</th><th>فواتير</th><th>متوسط</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={`${c.cashierId}-${c.name}`} onClick={() => { setOpen(c); setTab('overview'); }}>
                <td><Medal rank={i + 1} /></td>
                <td className="font-extrabold">{c.name}</td>
                <td className="num">{moneyIq(c.salesAmount)}</td>
                <td className="num">{pct(shareOf(c.salesAmount, total))}</td>
                <td className="num text-gold">{moneyIq(c.commissionAmount)}</td>
                <td className="num">{Math.round(c.pieceCount)}</td>
                <td className="num">{c.receiptCount}</td>
                <td className="num">{moneyIq(avgTicket(c.salesAmount, c.receiptCount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stack-grid stagger people-mobile">
        {rows.map((c, i) => (
          <button key={`${c.cashierId}-${c.name}`} type="button" className="card person-card" onClick={() => { setOpen(c); setTab('overview'); }}>
            <div className="flex items-start gap-3">
              <Medal rank={i + 1} />
              <div className="min-w-0 flex-1 text-start">
                <h2 className="text-lg font-extrabold">{c.name}</h2>
                <p className="num mt-2 text-[26px] font-black text-goal">{moneyIq(c.salesAmount)}</p>
                {(() => {
                  const prev = prevDash?.cashiers.find(x => x.name === c.name)
                    || prevDash?.malls.find(x => x.sectionName === c.name);
                  const prevSales = prev && 'salesAmount' in prev ? prev.salesAmount : 0;
                  return prev && prevSales > 0 ? <div className="mt-1"><Delta value={deltaPct(c.salesAmount, prevSales)} /></div> : null;
                })()}
                <p className="mt-1 text-sm font-extrabold text-muted">
                  {pct(shareOf(c.salesAmount, total))} من مبيعات المحل · متوسط {moneyIq(avgTicket(c.salesAmount, c.receiptCount))}
                </p>
                <div className="goal-metrics">
                  <div>
                    <p className="text-[11px] font-extrabold text-muted">العمولة</p>
                    <p className="num mt-1 text-lg font-black text-gold">{moneyIq(c.commissionAmount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-extrabold text-muted">القطع / الفواتير</p>
                    <p className="num mt-1 text-lg font-black">{Math.round(c.pieceCount)} · {c.receiptCount}</p>
                  </div>
                </div>
              </div>
            </div>
          </button>
        ))}
        {!loading && !rows.length && (
          <Empty title="لا كاشير هذا الأسبوع" hint="تظهر أسماء الكاشير بعد رفع بيانات المتابعة من لوحة التحكم" />
        )}
      </div>

      <Sheet open={!!open} title={open?.name || 'الكاشير'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="toolbar">
              {([['overview', 'نظرة'], ['sellers', 'البائعون'], ['products', 'منتجات'], ['invoices', 'فواتير']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`chip ${tab === k ? 'chip-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === 'overview' && (
              <StatGrid sales={open.salesAmount} commission={open.commissionAmount} pieceCount={open.pieceCount} receipts={open.receiptCount} totalSales={total} />
            )}
            {tab === 'sellers' && (
              detailSellers.length
                ? detailSellers.map(s => (
                  <div key={s.id} className="detail-cell">
                    <p>{s.name}</p>
                    <strong className="num">{moneyIq(s.sales)} · {pct(s.share)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{pieces(s.pieces)} · {s.receipts} فاتورة · عمولة {moneyIq(s.commission)}</p>
                  </div>
                ))
                : <p className="text-sm font-bold text-muted">لا بائعون ظاهرون على حركات هذا الكاشير</p>
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
