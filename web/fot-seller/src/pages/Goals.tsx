import { useMemo, useState } from 'react';
import { goalLabel, goalTone, goalValue, pct, targetKind } from '../api';
import { useSeller } from '../store';
import { Badge, Empty, ErrorBox, Ring, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

type Filter = 'all' | 'done' | 'near' | 'late';

export function Goals() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useSeller();
  const [filter, setFilter] = useState<Filter>('all');
  const rows = dash?.goals ?? [];

  const list = useMemo(() => rows.filter(g => {
    if (filter === 'done') return g.percent >= 100;
    if (filter === 'near') return g.percent >= 80 && g.percent < 100;
    if (filter === 'late') return g.percent < 80;
    return true;
  }), [rows, filter]);

  const hit = rows.filter(g => g.percent >= 100).length;
  const avg = rows.length ? rows.reduce((s, g) => s + g.percent, 0) / rows.length : 0;
  const late = rows.filter(g => g.percent < 80).length;

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <section className="card goal-hero">
        <Ring value={avg} size={128} tone="goal" label="إنجاز" />
        <div>
          <p className="kicker">لوحة الأهداف</p>
          <h1 className="text-[26px] font-extrabold">أهدافي</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">
            {rows.length ? `${hit} من ${rows.length} تحقق · ${late} يحتاج تركيز` : 'الأهداف المربوطة باسمك تظهر هنا'}
          </p>
          <div className="goal-meta">
            <span className="chip-soft">متوسط {pct(avg)}</span>
            <span className="chip-soft">{rows.length} هدف</span>
          </div>
        </div>
      </section>

      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />

      <div className="flex flex-wrap gap-2">
        {([['all', 'الكل'], ['done', 'تحقق'], ['near', 'قريب'], ['late', 'تركيز']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {loading && !rows.length && <Skeleton />}
      <div className="stack-grid">
        {list.map(g => {
          const remain = Math.max(0, g.weeklyTarget - g.sold);
          const tone = goalTone(g.percent);
          return (
            <article key={g.ruleId} className="card goal-card">
              <Ring value={g.percent} size={104} tone={tone} />
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold leading-6">{g.ruleName}</h2>
                    <p className="mt-1 text-sm font-bold text-muted">{targetKind(g.targetType)}</p>
                  </div>
                  <Badge tone={tone === 'goal' ? 'goal' : tone}>{goalLabel(g.percent)}</Badge>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="text-sm font-bold text-muted">
                    <span className="num font-extrabold text-ink">{goalValue(g.targetType, g.sold)}</span>
                    <span> من </span>
                    <span className="num">{goalValue(g.targetType, g.weeklyTarget)}</span>
                  </p>
                </div>
                <div className="mt-2"><Track value={g.percent} tone={tone} /></div>
                {remain > 0
                  ? <p className="mt-2 text-sm font-extrabold text-goal">المتبقي {goalValue(g.targetType, remain)}</p>
                  : <p className="mt-2 text-sm font-extrabold text-ok">الهدف اكتمل</p>}
              </div>
            </article>
          );
        })}
        {!loading && !list.length && (
          <Empty
            title={rows.length ? 'لا أهداف في هذا التصنيف' : 'لا أهداف مربوطة بك'}
            hint="يظهر الهدف هنا بعد ربطه باسمك من لوحة التحكم"
          />
        )}
      </div>
    </div>
  );
}
