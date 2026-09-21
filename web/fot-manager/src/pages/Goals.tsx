import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { goalLabel, goalTone, goalValue, groupGoalsBySeller, moneyIq, pct, targetKind, type GoalRow, type LineRow, type SellerGoalGroup } from '../api';
import { groupReceipts, linesForSeller } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Badge, Empty, ErrorBox, Ring, SearchField, Sheet, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

type Filter = 'all' | 'done' | 'near' | 'late';

export function Goals() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useManager();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  const [open, setOpen] = useState<GoalRow | null>(null);
  const [line, setLine] = useState<LineRow | null>(null);
  const groups = useMemo(() => groupGoalsBySeller(dash?.goals), [dash]);

  const list = useMemo(() => groups.filter(g => {
    if (q.trim() && !g.salesmanName.includes(q.trim()) && !g.goals.some(x => x.ruleName.includes(q.trim()))) return false;
    if (filter === 'done') return g.avg >= 100;
    if (filter === 'near') return g.avg >= 80 && g.avg < 100;
    if (filter === 'late') return g.avg < 80;
    return true;
  }), [groups, filter, q]);

  const hit = groups.filter(g => g.avg >= 100).length;
  const late = groups.filter(g => g.avg < 80).length;
  const near = groups.filter(g => g.avg >= 80 && g.avg < 100).length;
  const avg = groups.length ? groups.reduce((s, g) => s + g.avg, 0) / groups.length : 0;
  const seller = open ? dash?.sellers.find(s => s.salesmanId === open.salesmanId) : undefined;
  const related = open ? linesForSeller(lines, open.salesmanId) : [];

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="card goal-hero command">
        <Ring value={avg} size={132} tone="goal" label="إنجاز" />
        <div>
          <p className="kicker">التاركت الموجود</p>
          <h1 className="display text-[28px] font-black">حسب البائع</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">
            {groups.length
              ? `${groups.length} بائعاً عليهم تاركت · ${hit} تحقق · ${near} قريب · ${late} يحتاج تركيز`
              : 'لا يظهر إلا البائعون المربوط عليهم تاركت من لوحة التحكم'}
          </p>
        </div>
      </section>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      <SearchField value={q} onChange={setQ} placeholder="ابحث بالبائع أو اسم التاركت" />
      <div className="filter-stats">
        {([['all', groups.length, 'الكل'], ['done', hit, 'تحقق'], ['near', near, 'قريب'], ['late', late, 'تركيز']] as const).map(([k, n, label]) => (
          <button key={k} type="button" className={`filter-stat ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
            <strong className="num">{n}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {loading && !groups.length && <Skeleton />}
      <div className="space-y-3 stagger">
        {list.map(group => <SellerGoalBlock key={group.salesmanId} group={group} onOpen={setOpen} />)}
        {!loading && !list.length && (
          <Empty title={groups.length ? 'لا بائعون في هذا التصنيف' : 'لا تاركت مربوط'} hint="يظهر البائع هنا فقط إذا كان عليه تاركت أسبوعي" />
        )}
      </div>

      <Sheet open={!!open} title={open ? `${open.salesmanName} · ${open.ruleName}` : 'التاركت'} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-3">
            <div className="detail-hero goal">
              <p className="kicker">{targetKind(open.targetType)} · {goalLabel(open.percent)}</p>
              <p className="num mt-1 text-[28px] font-extrabold">{pct(open.percent)}</p>
              <p className="mt-2 text-sm font-extrabold">{goalValue(open.targetType, open.sold)} من {goalValue(open.targetType, open.weeklyTarget)}</p>
              <div className="mt-3"><Track value={open.percent} tone={goalTone(open.percent)} /></div>
            </div>
            {seller && (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="detail-cell"><p>مبيعات البائع</p><strong className="num">{moneyIq(seller.salesAmount)}</strong></div>
                <div className="detail-cell"><p>فواتيره</p><strong className="num">{seller.receiptCount}</strong></div>
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

function SellerGoalBlock({ group, onOpen }: { group: SellerGoalGroup; onOpen: (g: GoalRow) => void }) {
  return (
    <section className="card seller-goal-group">
      <div className="seller-goal-head">
        <Ring value={group.avg} size={72} tone={goalTone(group.avg)} />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-extrabold">{group.salesmanName}</h2>
            <Badge tone={goalTone(group.avg) === 'goal' ? 'goal' : goalTone(group.avg)}>{goalLabel(group.avg)}</Badge>
          </div>
          <p className="mt-1 text-sm font-bold text-muted">{group.goals.length} تاركت · {group.hit} تحقق</p>
        </div>
      </div>
      <div className="space-y-2">
        {group.goals.map(g => {
          const remain = Math.max(0, g.weeklyTarget - g.sold);
          return (
            <button key={`${g.ruleId}-${g.salesmanId}`} type="button" className="goal-mini" onClick={() => onOpen(g)}>
              <div className="min-w-0 text-start">
                <p className="font-extrabold">{g.ruleName}</p>
                <p className="mt-1 text-xs font-bold text-muted">{targetKind(g.targetType)}</p>
                <p className="mt-1 text-sm font-extrabold text-gold">
                  {goalValue(g.targetType, g.sold)} من {goalValue(g.targetType, g.weeklyTarget)}
                </p>
                <div className="mt-2"><Track value={g.percent} tone={goalTone(g.percent)} /></div>
                {remain > 0
                  ? <p className="mt-1 text-xs font-extrabold text-goal">المتبقي {goalValue(g.targetType, remain)}</p>
                  : <p className="mt-1 text-xs font-extrabold text-ok">الهدف اكتمل</p>}
              </div>
              <span className="num text-sm font-black">{pct(g.percent)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
