import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { moneyIq } from '../api';
import type { CommissionLine } from '../api';
import { groupDays, groupReceipts, rankProducts, uniqueMalls } from '../insights';
import { CommissionList, CommissionSheet, ReceiptList } from '../lines';
import { useSeller } from '../store';
import { DayStrip, Empty, ErrorBox, Medal, SearchField, Skeleton } from '../ui';
import { WeekBar } from '../week';

type Mode = 'lines' | 'receipts' | 'days' | 'products';
type Sort = 'new' | 'amount';

export function Products() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useSeller();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [mall, setMall] = useState('');
  const [mode, setMode] = useState<Mode>('lines');
  const [sort, setSort] = useState<Sort>('new');
  const [open, setOpen] = useState<CommissionLine | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  useEffect(() => {
    const next = params.get('q');
    if (next != null) setQ(next);
  }, [params]);

  const malls = useMemo(() => uniqueMalls(lines), [lines]);
  const filtered = useMemo(() => {
    const needle = q.trim();
    return lines.filter(l => {
      if (mall && l.mallName !== mall) return false;
      if (dayKey && l.occurredAt.slice(0, 10) !== dayKey) return false;
      if (!needle) return true;
      return l.productName.includes(needle)
        || (l.groupName ?? '').includes(needle)
        || (l.mallName ?? '').includes(needle)
        || String(l.receiptNumber ?? '').includes(needle);
    });
  }, [lines, q, mall, dayKey]);

  const sorted = useMemo(() => {
    if (sort === 'amount') return [...filtered].sort((a, b) => b.commissionAmount - a.commissionAmount);
    return [...filtered].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [filtered, sort]);

  const receipts = useMemo(() => groupReceipts(sorted), [sorted]);
  const days = useMemo(() => groupDays(filtered), [filtered]);
  const products = useMemo(() => rankProducts(sorted), [sorted]);
  const total = sorted.reduce((s, l) => s + l.commissionAmount, 0);

  if (err && !dash) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">عمولتك كاملة</p>
        <h1 className="display text-[28px] font-black">كل المنتجات</h1>
        <p className="num mt-3 text-[34px] font-black text-gold">{moneyIq(total)}</p>
        <p className="mt-1 text-sm font-bold text-muted">
          {sorted.length} حركة · {receipts.length} فاتورة — اضغط أي سطر للتفاصيل
        </p>
      </section>

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث بالمنتج أو الفاتورة أو المول" />

      <div className="toolbar">
        {([['lines', 'الحركات'], ['receipts', 'الفواتير'], ['days', 'الأيام'], ['products', 'المنتجات']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${mode === k ? 'chip-on' : ''}`} onClick={() => setMode(k)}>{label}</button>
        ))}
        <button type="button" className={`chip ${sort === 'new' ? 'chip-on' : ''}`} onClick={() => setSort('new')}>الأحدث</button>
        <button type="button" className={`chip ${sort === 'amount' ? 'chip-on' : ''}`} onClick={() => setSort('amount')}>الأعلى عمولة</button>
      </div>

      {malls.length > 1 && (
        <div className="toolbar">
          <button type="button" className={`chip ${!mall ? 'chip-on' : ''}`} onClick={() => setMall('')}>كل المولات</button>
          {malls.map(name => (
            <button key={name} type="button" className={`chip ${mall === name ? 'chip-on' : ''}`} onClick={() => setMall(name === mall ? '' : name)}>{name}</button>
          ))}
        </div>
      )}

      {loading && !lines.length && <Skeleton />}

      {mode === 'lines' && <CommissionList lines={sorted} onOpen={setOpen} />}

      {mode === 'receipts' && <ReceiptList groups={receipts} onOpen={setOpen} />}

      {mode === 'days' && (
        days.length ? (
          <section className="card p-4 space-y-4">
            <DayStrip days={days} active={dayKey ?? undefined} onSelect={key => setDayKey(dayKey === key ? null : key)} />
            <div className="toolbar">
              <button type="button" className={`chip ${!dayKey ? 'chip-on' : ''}`} onClick={() => setDayKey(null)}>كل الأيام</button>
              {days.map(d => (
                <button key={d.key} type="button" className={`chip ${dayKey === d.key ? 'chip-on' : ''}`} onClick={() => setDayKey(dayKey === d.key ? null : d.key)}>
                  {d.label} · {moneyIq(d.commission)}
                </button>
              ))}
            </div>
            <CommissionList lines={sorted} onOpen={setOpen} />
          </section>
        ) : <Empty title="لا أيام لهذا الأسبوع" />
      )}

      {mode === 'products' && (
        products.length ? (
          <div className="card p-4">
            {products.map((p, i) => (
              <button
                key={p.name}
                type="button"
                className="rank-row w-full text-start"
                onClick={() => setOpen(sorted.find(l => l.productName === p.name) ?? null)}
              >
                <Medal rank={i + 1} />
                <div className="min-w-0">
                  <p className="truncate font-extrabold">{p.name}</p>
                  <p className="text-xs font-bold text-muted">{p.count} حركة · كمية {p.qty}</p>
                </div>
                <p className="num text-sm font-extrabold text-gold">{moneyIq(p.commission)}</p>
              </button>
            ))}
          </div>
        ) : <Empty title="لا منتجات هذا الأسبوع" />
      )}

      <CommissionSheet line={open} onClose={() => setOpen(null)} />
    </div>
  );
}
