import { useMemo, useState } from 'react';
import { receiptLabel, shownWeekAmount, shownWeekLabel, weekIsPaid, type CommissionLine } from '../../api';
import { groupReceipts, rankProducts, type ReceiptGroup } from '../../insights';
import { useSeller } from '../../store';
import { Badge, CountUp, Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, clockLabel, dayLabel, fmt, weekRange, weekdayLong } from '../kit';
import { haptic } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * عمولتي — اختيار الأسبوع، ملخص، ثم المبيعات حسب اليوم / الفواتير / أكثر المنتجات.
 * ───────────────────────────────────────────────────────────────────────────── */

type Tab = 'sales' | 'receipts' | 'products';

function shortRange(start: string, end: string) {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime())) return start.slice(0, 10);
  const day = (d: Date) => d.toLocaleDateString('ar-IQ-u-nu-latn', { day: 'numeric' });
  const month = (d: Date) => d.toLocaleDateString('ar-IQ-u-nu-latn', { month: 'short' });
  return a.getMonth() === b.getMonth() ? `${day(a)}–${day(b)} ${month(b)}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

export function Commission() {
  const { dash, weeks, lines, loading, err, reload, weekStart, setWeek } = useSeller();
  const [tab, setTab] = useState<Tab>('sales');
  const [q, setQ] = useState('');
  const [receipt, setReceipt] = useState<ReceiptGroup | null>(null);

  const week = dash?.week;
  const selected = weekStart?.slice(0, 10) ?? weeks.find(w => w.isCurrent)?.weekStart.slice(0, 10);
  const qty = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0), [lines]);

  const filtered = useMemo(() => {
    const n = q.trim();
    if (!n) return lines;
    return lines.filter(l => l.productName.includes(n) || String(l.receiptNumber ?? '').includes(n) || (l.mallName ?? '').includes(n));
  }, [lines, q]);

  const byDay = useMemo(() => {
    const map = new Map<string, CommissionLine[]>();
    for (const l of [...filtered].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
      const k = l.occurredAt.slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), l]);
    }
    return [...map.entries()];
  }, [filtered]);
  const receipts = useMemo(() => groupReceipts(filtered), [filtered]);
  const products = useMemo(() => rankProducts(filtered), [filtered]);
  const topProduct = Math.max(1, ...products.map(p => p.commission));

  return (
    <Screen
      title="عمولتي"
      subtitle={week ? weekRange(week.weekStart, week.weekEnd) : 'الأسبوع'}
      onRefresh={reload}
      end={
        <button type="button" className={`t-icon-btn press ${loading ? 'spin' : ''}`} aria-label="تحديث" onClick={() => void reload()}>
          <I.refresh size={20} />
        </button>
      }
    >
      {weeks.length > 0 && (
        <div className="t-scroller" style={{ marginBottom: 14 }}>
          {weeks.map(w => {
            const key = w.weekStart.slice(0, 10);
            const on = key === selected;
            return (
              <button
                key={key}
                type="button"
                className={`t-pill press ${on ? 'on' : ''}`}
                onClick={() => {
                  if (on) return;
                  haptic('select');
                  setWeek(w.isCurrent ? undefined : key);
                }}
              >
                {w.isCurrent ? 'هذا الأسبوع' : shortRange(w.weekStart, w.weekEnd)}
                <small className="num">{fmt(shownWeekAmount(w))} د.ع</small>
              </button>
            );
          })}
        </div>
      )}

      {err && !dash && <ErrorLine text={err} onRetry={() => void reload()} />}

      {!dash ? (
        <Skeleton h={150} r={20} />
      ) : (
        <section className="t-card pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{shownWeekLabel(week)}</div>
              <div style={{ fontSize: 30, fontWeight: 750, letterSpacing: '-0.02em', marginTop: 2 }}>
                <CountUp value={shownWeekAmount(week)} /> <small style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-3)' }}>د.ع</small>
              </div>
            </div>
            {weekIsPaid(week) ? <Badge tone="ok">مستلم</Badge> : week?.isCurrent ? <Badge tone="accent">جارٍ</Badge> : <Badge tone="mute">لم يُصرف</Badge>}
          </div>
          <div className="t-stats" style={{ marginTop: 14 }}>
            <div className="t-stat">
              <span>الفواتير</span>
              <b className="num">{fmt(week?.receiptCount ?? 0)}</b>
            </div>
            <div className="t-stat">
              <span>القطع</span>
              <b className="num">{fmt(qty)}</b>
            </div>
            <div className="t-stat">
              <span>عمولة الفاتورة</span>
              <b className="num">{fmt(week?.receiptCount ? shownWeekAmount(week) / week.receiptCount : 0)}</b>
            </div>
          </div>
        </section>
      )}

      <div style={{ marginTop: 18 }}>
        <Segmented
          items={[
            { id: 'sales', label: 'المبيعات' },
            { id: 'receipts', label: 'الفواتير' },
            { id: 'products', label: 'المنتجات' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {lines.length > 6 && (
        <label className="t-search" style={{ marginTop: 12 }}>
          <I.search />
          <input placeholder="ابحث بالمنتج أو رقم الفاتورة" value={q} onChange={e => setQ(e.target.value)} />
          {q && (
            <button type="button" aria-label="مسح" onClick={() => setQ('')}>
              <I.close size={16} />
            </button>
          )}
        </label>
      )}

      <div key={tab} style={{ animation: 'page-in .3s var(--ease) both' }}>
        {loading && !lines.length ? (
          <Skeleton h={220} r={20} mt={14} />
        ) : filtered.length === 0 ? (
          <Empty icon={<I.wallet size={30} />} title={q ? 'لا نتيجة' : 'لا مبيعات بعمولة'} text={q ? 'جرّب كلمة أخرى.' : 'عند بيعك منتجاً عليه عمولة يظهر هنا مع الفاتورة والوقت.'} />
        ) : tab === 'sales' ? (
          byDay.map(([day, rows]) => (
            <div key={day}>
              <div className="t-day-head">
                <span>
                  {weekdayLong(day)} <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{dayLabel(day)}</span>
                </span>
                <b className="num">{fmt(rows.reduce((s, r) => s + r.commissionAmount, 0))} د.ع</b>
              </div>
              <div className="t-list">
                {rows.map(l => (
                  <div key={l.id} className="t-row">
                    <span className="t-tile mute">
                      <I.box size={18} />
                    </span>
                    <div className="body">
                      <div className="title">{l.productName}</div>
                      <div className="sub">
                        {clockLabel(l.occurredAt)} · {receiptLabel(l.receiptNumber)}
                        {l.mallName ? ` · ${l.mallName}` : ''}
                      </div>
                    </div>
                    <div className="end">
                      <b className="num ltr" style={{ color: 'var(--ok)' }}>+{fmt(l.commissionAmount)}</b>
                      <small className="num">× {l.quantity}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : tab === 'receipts' ? (
          <div className="t-list" style={{ marginTop: 14 }}>
            {receipts.map(r => (
              <button
                key={r.id}
                type="button"
                className="t-row press-soft"
                onClick={() => {
                  haptic('tap');
                  setReceipt(r);
                }}
              >
                <span className="t-tile">
                  <I.receipt size={19} />
                </span>
                <div className="body">
                  <div className="title num">{receiptLabel(r.receiptNumber)}</div>
                  <div className="sub">
                    {dayLabel(r.at)} · {clockLabel(r.at)} · {r.count} {r.count === 1 ? 'منتج' : 'منتجات'}
                  </div>
                </div>
                <div className="end">
                  <b className="num">{fmt(r.commission)}</b>
                  <small>د.ع</small>
                </div>
                <span className="chev">
                  <I.chevron />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="t-list" style={{ marginTop: 14 }}>
            {products.map((p, i) => (
              <div key={p.name} className="t-row">
                <span className={`t-tile ${i < 3 ? 'accent' : 'mute'} num`}>{i + 1}</span>
                <div className="body">
                  <div className="title">{p.name}</div>
                  <div className="t-share">
                    <i style={{ width: `${(p.commission / topProduct) * 100}%` }} />
                  </div>
                </div>
                <div className="end">
                  <b className="num">{fmt(p.commission)}</b>
                  <small className="num">{fmt(p.qty)} قطعة</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title={receipt ? `فاتورة ${receiptLabel(receipt.receiptNumber)}` : ''}
        subtitle={receipt ? `${weekdayLong(receipt.at)} ${dayLabel(receipt.at)} · ${clockLabel(receipt.at)}${receipt.mallName ? ` · ${receipt.mallName}` : ''}` : ''}
      >
        {receipt && (
          <>
            <div className="t-list flat">
              {receipt.lines.map(l => (
                <div key={l.id} className="t-row">
                  <div className="body">
                    <div className="title">{l.productName}</div>
                    <div className="sub num">{l.quantity} قطعة{l.groupName ? ` · ${l.groupName}` : ''}</div>
                  </div>
                  <div className="end">
                    <b className="num ltr" style={{ color: 'var(--ok)' }}>+{fmt(l.commissionAmount)}</b>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 4px 4px', fontWeight: 700 }}>
              <span>عمولة الفاتورة</span>
              <span className="num">{fmt(receipt.commission)} د.ع</span>
            </div>
          </>
        )}
      </Sheet>
    </Screen>
  );
}
