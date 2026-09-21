import { useMemo, useState } from 'react';
import { api, moneyIq, moneyK, pct } from '../api';
import type { CommissionLine, MallRow } from '../api';
import { CommissionList, CommissionSheet } from '../lines';
import { useSeller } from '../store';
import { Bar, Donut, Empty, ErrorBox, Legend, Sheet, Skeleton } from '../ui';
import { WeekBar } from '../week';

export function Malls() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useSeller();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MallRow | null>(null);
  const [mallLines, setMallLines] = useState<CommissionLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<CommissionLine | null>(null);
  const rows = dash?.malls ?? [];

  const list = useMemo(() => {
    const needle = q.trim();
    const filtered = needle
      ? rows.filter(r => r.sectionName.includes(needle) || (r.branchName ?? '').includes(needle))
      : rows;
    return [...filtered].sort((a, b) => b.commissionAmount - a.commissionAmount);
  }, [rows, q]);

  const totalComm = rows.reduce((s, r) => s + r.commissionAmount, 0);
  const max = Math.max(...list.map(r => r.commissionAmount), 1);
  const donutItems = list.slice(0, 6).map(r => ({ label: r.sectionName, value: r.commissionAmount }));
  const legendItems = donutItems.map(r => ({
    label: r.label,
    value: moneyIq(r.value),
    share: totalComm > 0 ? (r.value / totalComm) * 100 : 0,
  }));

  async function openMall(r: MallRow) {
    setOpen(r);
    setBusy(true);
    setLine(null);
    try {
      const bundle = await api.commissionLines(weekStart, r.sectionId);
      setMallLines(bundle.lines);
    } catch {
      setMallLines([]);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <header>
        <p className="kicker">توزيع العمولة</p>
        <h1 className="text-[26px] font-extrabold">مولاتي</h1>
        <p className="mt-1 text-sm font-bold text-muted">{rows.length} مول · عمولة {moneyIq(totalComm)}</p>
      </header>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      {rows.length > 0 && (
        <section className="card mall-overview">
          <Donut items={donutItems} size={150} center={moneyK(totalComm)} />
          <Legend items={legendItems} />
        </section>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث باسم المول" className="field" />
      {loading && !rows.length && <Skeleton />}
      <div className="stack-grid">
        {list.map((r, i) => {
          const share = totalComm > 0 ? (r.commissionAmount / totalComm) * 100 : 0;
          return (
            <button key={`${r.sectionId}-${r.sectionName}`} type="button" className="card mall-card" onClick={() => void openMall(r)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold text-gold">#{String(i + 1).padStart(2, '0')}</p>
                  <h2 className="text-lg font-extrabold">{r.sectionName}</h2>
                  {r.branchName && <p className="text-sm font-bold text-muted">{r.branchName}</p>}
                </div>
                <p className="text-sm font-extrabold text-goal">{Math.round(share)}%</p>
              </div>
              <p className="num mt-3 text-[22px] font-extrabold text-gold">{moneyIq(r.commissionAmount)}</p>
              <div className="mt-3"><Bar value={r.commissionAmount} max={max} tone="gold" /></div>
              <p className="mt-2 text-xs font-extrabold text-muted">اضغط لرؤية المنتجات والفواتير</p>
            </button>
          );
        })}
        {!loading && !list.length && <Empty title="لا عمولة هذا الأسبوع" hint="غيّر الأسبوع أو ابحث باسم مول آخر" />}
      </div>

      <Sheet open={!!open} title={open?.sectionName || 'المول'} onClose={() => { setOpen(null); setLine(null); }}>
        {open && (
          <div className="space-y-4">
            <div className="detail-hero">
              <p className="kicker">عمولة المول كاملة</p>
              <p className="num mt-1 text-[28px] font-extrabold text-gold">{moneyIq(open.commissionAmount)}</p>
              <p className="mt-1 text-sm font-bold text-muted">{pct(totalComm ? (open.commissionAmount / totalComm) * 100 : 0)} من الأسبوع</p>
            </div>
            {busy ? <Skeleton rows={3} /> : <CommissionList lines={mallLines} onOpen={setLine} empty="لا منتجات عمولة في هذا المول" />}
          </div>
        )}
      </Sheet>
      <CommissionSheet line={line} onClose={() => setLine(null)} />
    </div>
  );
}
