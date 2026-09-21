import { useMemo, useState } from 'react';
import { goalLabel, goalTone, goalValue, moneyIq, pct, type GoalRow, type LineRow } from '../api';
import { groupReceipts, linesForSeller } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Badge, Empty, ErrorBox, Ring, SearchField, Sheet, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

type Filter = 'all' | 'done' | 'near' | 'late';

export function Goals() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useManager();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<GoalRow | null>(null);
  const [line, setLine] = useState<LineRow | null>(null);
  const rows = dash?.goals ?? [];

  const list = useMemo(() => rows.filter(g => {
    if (q.trim() && !g.salesmanName.includes(q.trim()) && !g.ruleName.includes(q.trim())) return false;
    if (filter === 'done') return g.percent >= 100;
    if (filter === 'near') return g.percent >= 80 && g.percent < 100;
    if (filter === 'late') return g.percent < 80;
    return true;
  }).sort((a, b) => a.percent - b.percent), [rows, filter, q]);

  const hit = rows.filter(g => g.percent >= 100).length;
  const avg = rows.length ? rows.reduce((s, g) => s + g.percent, 0) / rows.length : 0;
  const late = rows.filter(g => g.percent < 80).length;
  const near = rows.filter(g => g.percent >= 80 && g.percent < 100).length;
  const seller = open ? dash?.sellers.find(s => s.salesmanId === open.salesmanId) : undefined;
  const related = open ? linesForSeller(lines, open.salesmanId) : [];

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="card goal-hero">
        <Ring value={avg} size={132} tone="goal" label="إنجاز" />
        <div>
          <p className="kicker">أهداف الفريق</p>
          <h1 className="display text-[28px] font-black">المتابعة</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">
            {rows.length ? `${hit} تحقق · ${near} قريب · ${late} يحتاج تركيز — اضغط على الهدف لترى فواتير البائع` : 'لا أهداف مربوطة هذا الأسبوع'}
          </p>
        </div>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث بالبائع أو اسم الهدف" />
      <div className="flex flex-wrap gap-2">
        {([['all', `الكل ${rows.length}`], ['done', `تحقق ${hit}`], ['near', `قريب ${near}`], ['late', `تركيز ${late}`]] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {loading && !rows.length && <Skeleton />}
      <div className="stack-grid stagger">
        {list.map(g => <GoalCard key={`${g.ruleId}-${g.salesmanId}`} g={g} onOpen={() => setOpen(g)} />)}
        {!loading && !list.length && (
          <Empty title={rows.length ? 'لا أهداف في هذا التصنيف' : 'لا أهداف مربوطة'} hint="تظهر الأهداف بعد ربطها من لوحة التحكم" />
        )}
      </div>

      <Sheet open={!!open} title={open ? `${open.salesmanName} · ${open.ruleName}` : 'الهدف'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="detail-hero goal">
              <p className="kicker">{goalLabel(open.percent)}</p>
              <p className="num mt-1 text-[28px] font-extrabold">{pct(open.percent)}</p>
              <p className="mt-2 text-sm font-extrabold">{goalValue(open.targetType, open.sold)} من {goalValue(open.targetType, open.weeklyTarget)}</p>
              <div className="mt-3"><Track value={open.percent} tone={goalTone(open.percent)} /></div>
            </div>
            {seller && (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="detail-cell"><p>مبيعات البائع</p><strong className="num">{moneyIq(seller.salesAmount)}</strong></div>
                <div className="detail-cell"><p>عمولته</p><strong className="num">{moneyIq(seller.commissionAmount)}</strong></div>
              </div>
            )}
            <ReceiptList groups={groupReceipts(related)} onOpen={setLine} />
            <MoveList lines={related} onOpen={setLine} empty="لا فواتير مربوطة بهذا البائع" />
          </div>
        )}
      </Sheet>
      <LineSheet open={line} onClose={() => setLine(null)} />
    </div>
  );
}

function GoalCard({ g, onOpen }: { g: GoalRow; onOpen: () => void }) {
  const remain = Math.max(0, g.weeklyTarget - g.sold);
  const tone = goalTone(g.percent);
  return (
    <button type="button" className="card goal-card" onClick={onOpen}>
      <Ring value={g.percent} size={104} tone={tone} />
      <div className="min-w-0 text-start">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold leading-6">{g.salesmanName}</h2>
            <p className="mt-1 text-sm font-bold text-muted">{g.ruleName}</p>
          </div>
          <Badge tone={tone === 'goal' ? 'goal' : tone}>{goalLabel(g.percent)}</Badge>
        </div>
        <div className="goal-metrics">
          <div>
            <p className="text-[11px] font-extrabold text-muted">المتحقق</p>
            <p className="num mt-1 text-lg font-black text-gold">{goalValue(g.targetType, g.sold)}</p>
          </div>
          <div>
            <p className="text-[11px] font-extrabold text-muted">الهدف</p>
            <p className="num mt-1 text-lg font-black">{goalValue(g.targetType, g.weeklyTarget)}</p>
          </div>
        </div>
        <div className="mt-2"><Track value={g.percent} tone={tone} /></div>
        {remain > 0
          ? <p className="mt-2 text-sm font-extrabold text-goal">المتبقي {goalValue(g.targetType, remain)}</p>
          : <p className="mt-2 text-sm font-extrabold text-ok">الهدف اكتمل</p>}
      </div>
    </button>
  );
}
