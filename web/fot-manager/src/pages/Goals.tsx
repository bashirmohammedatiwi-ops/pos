import { useMemo, useState } from 'react';
import { goalLabel, goalTone, goalValue, type GoalRow } from '../api';
import { useManager } from '../store';
import { Badge, Empty, ErrorBox, Ring, SearchField, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

type Filter = 'all' | 'done' | 'near' | 'late';

export function Goals() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useManager();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const rows = dash?.goals ?? [];

  const list = useMemo(() => rows.filter(g => {
    if (q.trim() && !g.salesmanName.includes(q.trim()) && !g.ruleName.includes(q.trim())) return false;
    if (filter === 'done') return g.percent >= 100;
    if (filter === 'near') return g.percent >= 80 && g.percent < 100;
    if (filter === 'late') return g.percent < 80;
    return true;
  }), [rows, filter, q]);

  const hit = rows.filter(g => g.percent >= 100).length;
  const avg = rows.length ? rows.reduce((s, g) => s + g.percent, 0) / rows.length : 0;
  const late = rows.filter(g => g.percent < 80).length;
  const near = rows.filter(g => g.percent >= 80 && g.percent < 100).length;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="card goal-hero">
        <Ring value={avg} size={132} tone="goal" label="إنجاز" />
        <div>
          <p className="kicker">أهداف الفريق</p>
          <h1 className="display text-[28px] font-black">المتابعة</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">
            {rows.length ? `${hit} تحقق · ${near} قريب · ${late} يحتاج تركيز` : 'لا أهداف مربوطة هذا الأسبوع'}
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
        {list.map(g => <GoalCard key={`${g.ruleId}-${g.salesmanId}`} g={g} />)}
        {!loading && !list.length && (
          <Empty title={rows.length ? 'لا أهداف في هذا التصنيف' : 'لا أهداف مربوطة'} hint="تظهر الأهداف بعد ربطها من لوحة التحكم" />
        )}
      </div>
    </div>
  );
}

function GoalCard({ g }: { g: GoalRow }) {
  const remain = Math.max(0, g.weeklyTarget - g.sold);
  const tone = goalTone(g.percent);
  return (
    <article className="card goal-card">
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
    </article>
  );
}
