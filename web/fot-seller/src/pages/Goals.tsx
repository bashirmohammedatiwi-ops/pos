import { useMemo, useState } from 'react';
import { api, goalLabel, goalTone, goalValue, targetKind } from '../api';
import type { GoalDetail, GoalLine, GoalRow } from '../api';
import { GoalLineList, GoalLineSheet } from '../lines';
import { useSeller } from '../store';
import { Badge, Empty, ErrorBox, Ring, Sheet, Skeleton, Track } from '../ui';
import { WeekBar } from '../week';

type Filter = 'all' | 'done' | 'near' | 'late';

export function Goals() {
  const { weekStart, setWeek, dash, weeks, err, loading, reload } = useSeller();
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<GoalLine | null>(null);
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

  async function openGoal(g: GoalRow) {
    setBusy(true);
    try {
      setDetail(await api.goalLines(g.ruleId, weekStart));
    } catch {
      setDetail({ ...g, lines: [] });
    } finally {
      setBusy(false);
    }
  }

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
          <p className="mt-2 text-xs font-extrabold text-goal">اضغط الهدف لرؤية المنتجات والفواتير والوقت</p>
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
            <button key={g.ruleId} type="button" className="card goal-card" onClick={() => void openGoal(g)}>
              <Ring value={g.percent} size={104} tone={tone} />
              <div className="min-w-0 text-start">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold leading-6">{g.ruleName}</h2>
                    <p className="mt-1 text-sm font-bold text-muted">{targetKind(g.targetType)}</p>
                  </div>
                  <Badge tone={tone === 'goal' ? 'goal' : tone}>{goalLabel(g.percent)}</Badge>
                </div>
                <div className="mt-3">
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
            </button>
          );
        })}
        {!loading && !list.length && (
          <Empty
            title={rows.length ? 'لا أهداف في هذا التصنيف' : 'لا أهداف مربوطة بك'}
            hint="يظهر الهدف هنا بعد ربطه باسمك من لوحة التحكم"
          />
        )}
      </div>

      <Sheet open={!!detail || busy} title={detail?.ruleName || 'تفاصيل الهدف'} onClose={() => { setDetail(null); setLine(null); }}>
        {busy && <Skeleton rows={3} />}
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Ring value={detail.percent} size={88} tone={goalTone(detail.percent)} />
              <p className="text-sm font-bold text-muted">
                <span className="num font-extrabold text-ink">{goalValue(detail.targetType, detail.sold)}</span>
                {' من '}
                <span className="num">{goalValue(detail.targetType, detail.weeklyTarget)}</span>
                <br />
                {detail.lines.length} منتج/فاتورة
              </p>
            </div>
            <GoalLineList lines={detail.lines} onOpen={setLine} />
          </div>
        )}
      </Sheet>
      <GoalLineSheet line={line} onClose={() => setLine(null)} />
    </div>
  );
}
