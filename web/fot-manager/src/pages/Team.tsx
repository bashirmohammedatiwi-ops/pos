import { useMemo, useState } from 'react';
import { api, goalLabel, goalTone, goalValue, moneyIq, pieces, type LineRow, type SellerRow } from '../api';
import { useManager } from '../store';
import { Badge, Empty, ErrorBox, Medal, Ring, SearchField, Sheet, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

type Sort = 'commission' | 'sales' | 'pieces';

export function Team() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useManager();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('commission');
  const [open, setOpen] = useState<SellerRow | null>(null);
  const [detailLines, setDetailLines] = useState<LineRow[]>([]);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const list = (dash?.sellers ?? []).filter(s => !q.trim() || s.name.includes(q.trim()));
    return [...list].sort((a, b) => {
      if (sort === 'sales') return b.salesAmount - a.salesAmount;
      if (sort === 'pieces') return b.pieceCount - a.pieceCount;
      return b.commissionAmount - a.commissionAmount;
    });
  }, [dash, q, sort]);

  async function openSeller(s: SellerRow) {
    setOpen(s);
    setBusy(true);
    try {
      const d = await api.seller(s.salesmanId, weekStart);
      setOpen(d.seller);
      setDetailLines(d.lines);
    } catch {
      setDetailLines([]);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="hero compact">
        <p className="kicker">فريق المبيعات</p>
        <h1 className="display text-[28px] font-black">البائعون</h1>
        <p className="mt-2 text-sm font-bold text-muted">{rows.length} بائعاً هذا الأسبوع — اضغط للاطلاع على حركته</p>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث باسم البائع" />
      <div className="toolbar">
        {([['commission', 'العمولة'], ['sales', 'المبيعات'], ['pieces', 'القطع']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>
      {loading && !dash && <Skeleton />}
      <div className="stack-grid stagger">
        {rows.map((s, i) => (
          <button key={s.salesmanId} type="button" className="card goal-card" onClick={() => void openSeller(s)}>
            <Medal rank={i + 1} />
            <div className="min-w-0 text-start">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-extrabold">{s.name}</h2>
                {s.goalCount > 0 && <Badge tone={goalTone(s.goalPercent) === 'goal' ? 'goal' : goalTone(s.goalPercent)}>{goalLabel(s.goalPercent)}</Badge>}
              </div>
              <div className="goal-metrics">
                <div>
                  <p className="text-[11px] font-extrabold text-muted">المبيعات</p>
                  <p className="num mt-1 text-lg font-black">{moneyIq(s.salesAmount)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-extrabold text-muted">العمولة</p>
                  <p className="num mt-1 text-lg font-black text-gold">{moneyIq(s.commissionAmount)}</p>
                </div>
              </div>
              <p className="mt-2 text-sm font-extrabold text-goal">{pieces(s.pieceCount)} · {s.receiptCount} فاتورة</p>
              {s.goalCount > 0 && <div className="mt-2"><Track value={s.goalPercent} tone={goalTone(s.goalPercent)} /></div>}
              {s.balanceDue > 0 && <p className="mt-2 text-xs font-bold text-muted">مستحق {moneyIq(s.balanceDue)}</p>}
            </div>
          </button>
        ))}
        {!loading && !rows.length && <Empty title="لا بائعون في هذا الأسبوع" hint="عند حساب عمولة تظهر أسماء الفريق هنا" />}
      </div>

      <Sheet open={!!open} title={open?.name || 'البائع'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="detail-cell"><p>المبيعات</p><strong className="num">{moneyIq(open.salesAmount)}</strong></div>
              <div className="detail-cell"><p>العمولة</p><strong className="num">{moneyIq(open.commissionAmount)}</strong></div>
              <div className="detail-cell"><p>القطع</p><strong className="num">{pieces(open.pieceCount)}</strong></div>
              <div className="detail-cell"><p>الفواتير</p><strong className="num">{open.receiptCount}</strong></div>
            </div>
            {open.goalCount > 0 && (
              <div className="flex items-center gap-3">
                <Ring value={open.goalPercent} size={72} tone={goalTone(open.goalPercent)} />
                <p className="text-sm font-bold text-muted">{open.goalsHit} من {open.goalCount} أهداف تحققت</p>
              </div>
            )}
            {(dash?.goals ?? []).filter(g => g.salesmanId === open.salesmanId).map(g => (
              <div key={g.ruleId} className="detail-cell">
                <p>{g.ruleName}</p>
                <strong>{goalValue(g.targetType, g.sold)} من {goalValue(g.targetType, g.weeklyTarget)}</strong>
              </div>
            ))}
            {busy && <Skeleton rows={2} />}
            {detailLines.slice(0, 8).map(l => (
              <div key={l.id} className="line-card">
                <span className="line-mark">{l.productName.charAt(0)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-extrabold">{l.productName}</span>
                  <span className="line-meta">
                    <span className="qty-chip">{l.quantity} قطعة</span>
                    <span className="chip-soft">{l.cashierName}</span>
                  </span>
                </span>
                <span className="num text-[15px] font-extrabold text-gold">{moneyIq(l.commissionAmount)}</span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
