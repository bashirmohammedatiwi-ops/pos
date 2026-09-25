import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { downloadText, moneyIq, pieces, productCsv } from '../api';
import { peopleForProduct, rankProducts } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import {
  Empty, ErrorBox, Medal, MetricStrip, PageHero, SearchField, SectionCard, Sheet, Skeleton, useToast,
} from '../ui';
import { PeriodBar } from '../week';
import type { LineRow } from '../api';

type Sort = 'sales' | 'qty';
type Tab = 'sellers' | 'cashiers' | 'invoices';

export function Products() {
  const {
    weekStart, setWeek, dash, weeks, activityLines, period, periodKind, setPeriodKind,
    customFrom, customTo, setCustom, periodTotals, err, loading, reload,
  } = useManager();
  const toast = useToast();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  const [sort, setSort] = useState<Sort>('sales');
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('sellers');
  const [line, setLine] = useState<LineRow | null>(null);

  const total = periodTotals.sales;
  const rows = useMemo(() => {
    const fromLines = rankProducts(activityLines);
    const fromDash = (dash?.products ?? []).map(p => ({
      name: p.name,
      sales: Number(p.salesAmount) || 0,
      commission: Number(p.commissionAmount) || 0,
      count: Number(p.count) || 0,
      qty: Number(p.quantity) || 0,
    }));
    const list = (fromLines.length ? fromLines : fromDash).filter(p => !q.trim() || p.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'qty') return b.qty - a.qty;
      return b.sales - a.sales;
    });
  }, [activityLines, dash?.products, q, sort]);

  const detail = open ? peopleForProduct(activityLines, open) : null;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

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
        kicker={`منتجات · ${period.label}`}
        title="ماذا يُباع"
        value={moneyIq(total)}
        hint={`${rows.length} منتجاً · ${activityLines.length} حركة`}
      >
        <MetricStrip
          items={[
            { label: 'منتجات', value: String(rows.length), tone: 'goal' },
            { label: 'حركات', value: String(activityLines.length), tone: 'ok' },
            { label: 'أقوى', value: rows[0]?.name.slice(0, 12) ?? '—', tone: 'gold' },
            { label: 'مبيعاته', value: moneyIq(rows[0]?.sales ?? 0), tone: 'warn' },
          ]}
        />
        <button
          type="button"
          className="pill mt-3"
          onClick={() => {
            downloadText(`منتجات-${period.from}.csv`, productCsv(rows.map(p => ({
              name: p.name, quantity: p.qty, salesAmount: p.sales, commissionAmount: 0, count: p.count,
            }))));
            toast('تم تنزيل المنتجات');
          }}
        >
          تصدير المنتجات
        </button>
      </PageHero>
      <section className="people-toolbar card">
        <SearchField value={q} onChange={setQ} placeholder="ابحث باسم المنتج" />
        <div className="sort-bar">
          {([['sales', 'المبيعات'], ['qty', 'القطع']] as const).map(([k, label]) => (
            <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{label}</button>
          ))}
        </div>
      </section>
      {loading && !rows.length && <Skeleton />}
      <SectionCard kicker={period.label} title="ترتيب المنتجات">
        {rows.map((p, i) => (
          <button key={p.name} type="button" className="rank-row stat-link" onClick={() => { setOpen(p.name); setTab('sellers'); }}>
            <Medal rank={i + 1} />
            <div className="min-w-0 text-start">
              <p className="truncate font-extrabold">{p.name}</p>
              <p className="text-xs font-bold text-muted">{pieces(p.qty)} · {p.count} حركة</p>
            </div>
            <div className="text-end">
              <p className="num text-sm font-extrabold">{moneyIq(p.sales)}</p>
            </div>
          </button>
        ))}
        {!loading && !rows.length && <Empty title="لا منتجات في هذه المدة" />}
      </SectionCard>

      <Sheet open={!!open} title={open || 'المنتج'} onClose={() => setOpen(null)}>
        {detail && (
          <div className="space-y-3">
            <div className="view-toggle">
              {([['sellers', 'البائعون'], ['cashiers', 'الكاشير'], ['invoices', 'فواتير']] as const).map(([k, label]) => (
                <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            {tab === 'sellers' && detail.sellers.map(s => (
              <div key={s.id} className="detail-cell">
                <p>{s.name}</p>
                <strong className="num">{moneyIq(s.sales)}</strong>
                <p className="mt-1 text-xs font-bold text-muted">{pieces(s.pieces)} · {s.receipts} فاتورة</p>
              </div>
            ))}
            {tab === 'cashiers' && (
              detail.cashiers.length
                ? detail.cashiers.map(c => (
                  <div key={c.id} className="detail-cell">
                    <p>{c.name}</p>
                    <strong className="num">{moneyIq(c.sales)}</strong>
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
