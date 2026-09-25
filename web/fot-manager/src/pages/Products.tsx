import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { moneyIq, pieces } from '../api';
import { peopleForProduct, rankProducts } from '../insights';
import { LineSheet, MoveList, PhoneTable, ReceiptList } from '../lines';
import { ExportMenu } from '../ExportMenu';
import { useManager } from '../store';
import {
  Empty, ErrorBox, MetricStrip, PageHero, SearchField, SectionCard, Sheet, Skeleton,
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
        <div className="mt-3"><ExportMenu title="تقرير المنتجات" /></div>
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
        {rows.length > 0 && (
          <PhoneTable
            columns={['#', 'المنتج', 'المبلغ']}
            rows={rows.map((p, i) => ({
              key: p.name,
              onClick: () => { setOpen(p.name); setTab('sellers'); },
              cells: [
                { text: String(i + 1), num: true },
                { text: p.name, sub: `${pieces(p.qty)} · ${p.count} حركة` },
                { text: moneyIq(p.sales), num: true },
              ],
            }))}
          />
        )}
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
