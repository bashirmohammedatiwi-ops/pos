import { useMemo, useState } from 'react';
import { money, pct, targetKind } from '../api';
import { useSeller } from '../store';
import { Badge, Bar, Empty, ErrorBox, Ring, Skeleton } from '../ui';
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
  const remainAll = rows.reduce((s, g) => s + Math.max(0, g.weeklyTarget - g.sold), 0);

  if (err) return <ErrorBox message={err} onRetry={() => void reload()} />;

  return (
    <div className="fade-up space-y-4">
      <header>
        <h1 className="text-[26px] font-extrabold">أهدافي</h1>
        <p className="mt-1 text-sm font-bold text-muted">
          {rows.length ? `${hit} من ${rows.length} تحقق` : 'الأهداف المربوطة باسمك'}
        </p>
      </header>
      <WeekBar weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      {rows.length > 0 && (
        <div className="card flex items-center justify-between p-4">
          <div>
            <p className="font-extrabold">إنجاز الأسبوع</p>
            <p className="mt-1 text-sm font-bold text-muted">{pct(avg)} متوسط التقدم</p>
            {remainAll > 0 && <p className="mt-1 text-sm font-extrabold text-terracotta">المتبقي {money(remainAll)}</p>}
          </div>
          <Ring value={avg} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {([['all', 'الكل'], ['done', 'تحقق'], ['near', 'قريب'], ['late', 'تركيز']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {loading && !rows.length && <Skeleton />}
      <div className="space-y-3">
        {list.map(g => {
          const remain = Math.max(0, g.weeklyTarget - g.sold);
          const tone = g.percent >= 100 ? 'ok' : g.percent >= 80 ? 'gold' : 'warn';
          const label = g.percent >= 100 ? 'تحقق' : g.percent >= 80 ? 'قريب' : 'يحتاج تركيز';
          return (
            <article key={g.ruleId} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold">{g.ruleName}</h2>
                  <p className="mt-1 text-sm font-bold text-muted">{targetKind(g.targetType)}</p>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <p className="text-sm font-bold text-muted">
                  <span className="num font-extrabold text-ink">{money(g.sold)}</span> من <span className="num">{money(g.weeklyTarget)}</span>
                </p>
                <p className="num text-xl font-extrabold">{pct(g.percent)}</p>
              </div>
              <div className="mt-2"><Bar value={g.percent} max={100} tone={g.percent >= 100 ? 'ok' : 'terracotta'} /></div>
              {remain > 0 && <p className="mt-2 text-sm font-extrabold text-muted">المتبقي {money(remain)}</p>}
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
