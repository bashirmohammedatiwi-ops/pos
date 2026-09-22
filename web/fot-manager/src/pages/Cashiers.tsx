import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { avgTicket, cashierCsv, deltaPct, downloadText, moneyIq, pieces, pct, shareOf, type CashierRow, type LineRow } from '../api';
import { groupReceipts, linesForCashier, rankProducts, sellersThroughCashier } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Delta, Empty, ErrorBox, Medal, Podium, SearchField, Sheet, Skeleton, StatGrid, Track, useToast } from '../ui';
import { PeriodBar } from '../week';

type Sort = 'sales' | 'receipts' | 'share';
type Tab = 'overview' | 'sellers' | 'products' | 'invoices';

export function Cashiers() {
  const {
    weekStart, setWeek, dash, prevDash, weeks, scopedLines, scopedCashiers, period, periodKind,
    setPeriodKind, customFrom, customTo, setCustom, periodTotals, err, loading, reload,
  } = useManager();
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
    const hit = scopedCashiers.find(c => c.name === needle);
    if (hit) { opened.current = true; setOpen(hit); setTab('overview'); }
  }, [scopedCashiers, params]);

  const total = periodTotals.sales || scopedCashiers.reduce((s, c) => s + c.salesAmount, 0);

  const rows = useMemo(() => {
    const list = scopedCashiers.filter(c => !q.trim() || c.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      if (sort === 'share') return (total ? b.salesAmount / total : 0) - (total ? a.salesAmount / total : 0);
      return b.salesAmount - a.salesAmount;
    });
  }, [scopedCashiers, q, sort, total]);

  const detailLines = open ? linesForCashier(scopedLines, open.name) : [];
  const detailSellers = open ? sellersThroughCashier(scopedLines, open.name) : [];
  const detailProducts = open ? rankProducts(detailLines) : [];
  const detailReceipts = open ? groupReceipts(detailLines) : [];

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="dash fade-up">
      <section className="hero compact command">
        <p className="kicker">أرض المحل · {period.label}</p>
        <h1 className="display text-[24px] font-black">الكاشير</h1>
        <p className="mt-2 text-sm font-bold text-muted">
          {rows.length} كاشير · إجمالي {moneyIq(rows.reduce((s, c) => s + c.salesAmount, 0))} — المبيعات والفواتير لكل واحد
        </p>
        <div className="hero-stats kpi-mosaic mt-4">
          <div className="hero-stat">
            <p className="kicker">المبيعات</p>
            <p className="num display text-[20px] font-black">{moneyIq(total)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">فواتير</p>
            <p className="num display text-[20px] font-black">{rows.reduce((s, c) => s + c.receiptCount, 0)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">نشط</p>
            <p className="num display text-[20px] font-black">{rows.filter(c => c.salesAmount > 0 || c.receiptCount > 0).length}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">متوسط</p>
            <p className="num display text-[18px] font-black">{moneyIq(avgTicket(total, rows.reduce((s, c) => s + c.receiptCount, 0)))}</p>
          </div>
        </div>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`كاشير-${period.from}.csv`, cashierCsv(scopedCashiers, total));
            toast('تم تنزيل ملف الكاشير');
          }}
        >
          تصدير الكاشير
        </button>
      </section>
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
      <SearchField value={q} onChange={setQ} placeholder="ابحث باسم الكاشير" />
      <div className="toolbar">
        {([['sales', 'المبيعات'], ['share', 'الحصة'], ['receipts', 'الفواتير']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
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
                <td className="num">{pct(shareOf(c.salesAmount, total))}</td>
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
                  {pct(shareOf(c.salesAmount, total))} من مبيعات المحل · {c.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(c.salesAmount, c.receiptCount))}
                </p>
                <div className="mt-2"><Track value={shareOf(c.salesAmount, total)} tone="gold" /></div>
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
              <StatGrid sales={open.salesAmount} receipts={open.receiptCount} totalSales={total} />
            )}
            {tab === 'sellers' && (
              detailSellers.length
                ? detailSellers.map(s => (
                  <div key={s.id} className="detail-cell">
                    <p>{s.name}</p>
                    <strong className="num">{moneyIq(s.sales)} · {pct(s.share)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{s.receipts} فاتورة</p>
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
