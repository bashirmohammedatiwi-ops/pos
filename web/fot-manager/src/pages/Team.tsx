import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api, avgTicket, deltaPct, downloadText, goalLabel, goalTone, goalValue, moneyIq, pieces, pct, shareOf, teamCsv, type LineRow, type SellerRow,
} from '../api';
import { cashiersForSeller, groupReceipts, linesForSeller, mergeLines, rankProducts } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Badge, Delta, Empty, ErrorBox, Medal, Podium, Ring, SearchField, Sheet, Skeleton, StatGrid, Track, useToast } from '../ui';
import { WeekBar } from '../week';

type Sort = 'sales' | 'receipts' | 'share' | 'goals';
type Tab = 'overview' | 'goals' | 'cashiers' | 'products' | 'invoices';

export function Team() {
  const { weekStart, setWeek, dash, prevDash, weeks, lines, err, loading, reload } = useManager();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('sales');
  const [open, setOpen] = useState<SellerRow | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [hideZero, setHideZero] = useState(true);
  const [line, setLine] = useState<LineRow | null>(null);
  const [extraLines, setExtraLines] = useState<LineRow[]>([]);
  const opened = useRef(false);

  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);

  async function openSeller(s: SellerRow) {
    setOpen(s);
    setTab('overview');
    setExtraLines([]);
    try {
      const d = await api.seller(s.salesmanId, weekStart);
      setOpen(d.seller);
      setExtraLines(d.lines);
    } catch { /* local lines */ }
  }

  useEffect(() => {
    const needle = params.get('q')?.trim();
    if (opened.current || !needle || !dash) return;
    const hit = dash.sellers.find(s => s.name === needle);
    if (hit) { opened.current = true; void openSeller(hit); }
  }, [dash, params]);

  const total = dash ? (dash.week.salesAmount || dash.sellers.reduce((s, x) => s + x.salesAmount, 0)) : 0;

  const rows = useMemo(() => {
    const list = (dash?.sellers ?? []).filter(s => {
      if (q.trim() && !s.name.includes(q.trim())) return false;
      if (hideZero && s.salesAmount <= 0 && s.receiptCount <= 0) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'receipts') return b.receiptCount - a.receiptCount;
      if (sort === 'share') return shareOf(b.salesAmount, total) - shareOf(a.salesAmount, total);
      if (sort === 'goals') return (b.goalCount ? b.goalPercent : -1) - (a.goalCount ? a.goalPercent : -1);
      return b.salesAmount - a.salesAmount;
    });
  }, [dash, q, sort, total, hideZero]);

  const detailLines = open ? mergeLines(linesForSeller(lines, open.salesmanId), extraLines.filter(l => l.salesmanId === open.salesmanId)) : [];
  const detailCashiers = open ? cashiersForSeller(lines, open.salesmanId) : [];
  const detailProducts = open ? rankProducts(detailLines) : [];
  const detailReceipts = open ? groupReceipts(detailLines) : [];
  const prevSeller = open ? prevDash?.sellers.find(s => s.salesmanId === open.salesmanId) : undefined;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact command">
        <p className="kicker">فريق المبيعات</p>
        <h1 className="display text-[28px] font-black">كل بائع بالتفصيل</h1>
        <p className="mt-2 text-sm font-bold text-muted">
          {rows.length} بائعاً · إجمالي {moneyIq(total)} — اضغط على أي اسم لترى مبيعاته وفواتيره
        </p>
        <div className="hero-stats kpi-mosaic mt-4">
          <div className="hero-stat">
            <p className="kicker">المبيعات</p>
            <p className="num display text-[20px] font-black">{moneyIq(total)}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">فواتير</p>
            <p className="num display text-[20px] font-black">{dash?.week.receiptCount ?? 0}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">عليهم تاركت</p>
            <p className="num display text-[20px] font-black">{(dash?.sellers ?? []).filter(s => s.goalCount > 0).length}</p>
          </div>
          <div className="hero-stat">
            <p className="kicker">متوسط</p>
            <p className="num display text-[18px] font-black">{moneyIq(avgTicket(total, dash?.week.receiptCount ?? 0))}</p>
          </div>
        </div>
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`بائعون-${weekStart || 'week'}.csv`, teamCsv(dash?.sellers ?? [], total));
            toast('تم تنزيل ملف البائعين');
          }}
        >
          تصدير الجدول
        </button>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      {rows.filter(s => s.salesAmount > 0).length > 0 && (
        <Podium
          items={rows.filter(s => s.salesAmount > 0).slice(0, 3).map(s => ({
            id: String(s.salesmanId),
            name: s.name,
            value: moneyIq(s.salesAmount),
            hint: `${s.receiptCount} فاتورة`,
          }))}
          onPick={item => {
            const hit = rows.find(s => s.name === item.name);
            if (hit) void openSeller(hit);
          }}
        />
      )}
      <SearchField value={q} onChange={setQ} placeholder="ابحث باسم البائع" />
      <div className="toolbar">
        {([['sales', 'المبيعات'], ['share', 'الحصة'], ['receipts', 'الفواتير'], ['goals', 'التاركت']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
        ))}
        <button type="button" className={`chip ${hideZero ? 'chip-on' : ''}`} onClick={() => setHideZero(v => !v)}>
          {hideZero ? 'إخفاء بلا حركة' : 'إظهار الكل'}
        </button>
      </div>
      {loading && !dash && <Skeleton />}

      <div className="desk-table card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>البائع</th><th>المبيعات</th><th>الحصة</th><th>فواتير</th><th>متوسط</th><th>تاركت</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.salesmanId} onClick={() => void openSeller(s)}>
                <td><Medal rank={i + 1} /></td>
                <td className="font-extrabold">{s.name}</td>
                <td className="num">{moneyIq(s.salesAmount)}</td>
                <td className="num">{pct(shareOf(s.salesAmount, total))}</td>
                <td className="num">{s.receiptCount}</td>
                <td className="num">{moneyIq(avgTicket(s.salesAmount, s.receiptCount))}</td>
                <td>{s.goalCount ? `${Math.round(s.goalPercent)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stack-grid stagger people-mobile">
        {rows.map((s, i) => {
          const share = shareOf(s.salesAmount, total);
          const prev = prevDash?.sellers.find(x => x.salesmanId === s.salesmanId);
          return (
            <button key={s.salesmanId} type="button" className="card person-card" onClick={() => void openSeller(s)}>
              <div className="flex items-start gap-3">
                <Medal rank={i + 1} />
                <div className="min-w-0 flex-1 text-start">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-extrabold">{s.name}</h2>
                    {s.goalCount > 0 && <Badge tone={goalTone(s.goalPercent) === 'goal' ? 'goal' : goalTone(s.goalPercent)}>{goalLabel(s.goalPercent)}</Badge>}
                  </div>
                  <p className="num mt-2 text-[26px] font-black text-goal">{moneyIq(s.salesAmount)}</p>
                  {prev && <div className="mt-1"><Delta value={deltaPct(s.salesAmount, prev.salesAmount)} /></div>}
                  <p className="mt-1 text-sm font-extrabold text-muted">{pct(share)} من مبيعات المحل · {s.receiptCount} فاتورة · متوسط {moneyIq(avgTicket(s.salesAmount, s.receiptCount))}</p>
                  <div className="mt-2"><Track value={share} tone="goal" /></div>
                  {s.goalCount > 0 && <div className="mt-2"><Track value={s.goalPercent} tone={goalTone(s.goalPercent)} /></div>}
                  {s.balanceDue > 0 && <p className="mt-2 text-xs font-bold text-muted">مستحق {moneyIq(s.balanceDue)}</p>}
                </div>
              </div>
            </button>
          );
        })}
        {!loading && !rows.length && <Empty title="لا بائعون في هذا الأسبوع" hint="عند وجود فواتير تظهر أسماء الفريق هنا" />}
      </div>

      <Sheet open={!!open} title={open?.name || 'البائع'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="toolbar">
              {([['overview', 'نظرة'], ['goals', 'أهداف'], ['cashiers', 'كاشير'], ['products', 'منتجات'], ['invoices', 'فواتير']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`chip ${tab === k ? 'chip-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === 'overview' && (
              <>
                <StatGrid sales={open.salesAmount} receipts={open.receiptCount} totalSales={total} />
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
              </>
            )}
            {tab === 'goals' && (
              (dash?.goals ?? []).filter(g => g.salesmanId === open.salesmanId).map(g => (
                <div key={g.ruleId} className="detail-cell">
                  <p>{g.ruleName}</p>
                  <strong>{goalValue(g.targetType, g.sold)} من {goalValue(g.targetType, g.weeklyTarget)} · {pct(g.percent)}</strong>
                  <div className="mt-2"><Track value={g.percent} tone={goalTone(g.percent)} /></div>
                </div>
              ))
            )}
            {tab === 'cashiers' && (
              detailCashiers.length
                ? detailCashiers.map(c => (
                  <div key={c.id} className="detail-cell">
                    <p>{c.name}</p>
                    <strong className="num">{moneyIq(c.sales)} · {pct(c.share)}</strong>
                    <p className="mt-1 text-xs font-bold text-muted">{pieces(c.pieces)} · {c.receipts} فاتورة</p>
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
