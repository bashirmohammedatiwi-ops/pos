import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, goalValue, receiptLabel, targetKind, type GoalDetail, type GoalRow } from '../../api';
import { useSeller } from '../../store';
import { Badge, Empty, ErrorLine, I, Ring, Screen, Segmented, Sheet, Skeleton, Track, clockLabel, dayLabel, fmt, weekRange } from '../kit';
import { haptic } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * أهدافي — ملخص الإنجاز، تصفية، بطاقة لكل هدف، وتفاصيل الحركات في ورقة سفلية.
 * ───────────────────────────────────────────────────────────────────────────── */

type Filter = 'all' | 'done' | 'open';

function tone(p: number): 'ok' | 'accent' | undefined {
  if (p >= 100) return 'ok';
  if (p < 60) return 'accent';
  return undefined;
}

function status(p: number) {
  if (p >= 100) return <Badge tone="ok">تحقق ✓</Badge>;
  if (p >= 80) return <Badge>قريب جداً</Badge>;
  if (p >= 40) return <Badge tone="accent">في الطريق</Badge>;
  return <Badge tone="mute">ابدأ الآن</Badge>;
}

export function Goals() {
  const { dash, loading, err, reload, weekStart } = useSeller();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [opening, setOpening] = useState<GoalRow | null>(null);
  const [detailErr, setDetailErr] = useState('');
  const rows = dash?.goals ?? [];

  const list = useMemo(
    () => [...rows].filter(g => (filter === 'done' ? g.percent >= 100 : filter === 'open' ? g.percent < 100 : true)).sort((a, b) => a.percent - b.percent),
    [rows, filter],
  );
  const done = rows.filter(g => g.percent >= 100).length;
  const avg = rows.length ? rows.reduce((s, g) => s + Math.min(100, g.percent), 0) / rows.length : 0;

  async function open(g: GoalRow) {
    haptic('tap');
    setOpening(g);
    setDetail(null);
    setDetailErr('');
    try {
      setDetail(await api.goalLines(g.ruleId, weekStart));
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : 'تعذر التحميل');
    }
  }

  // فتح هدف محدد من الرئيسية (?g=)
  const deep = Number(params.get('g') || 0);
  useEffect(() => {
    if (!deep || !rows.length) return;
    const g = rows.find(r => r.ruleId === deep);
    if (g) void open(g);
    const next = new URLSearchParams(params);
    next.delete('g');
    setParams(next, { replace: true });
  }, [deep, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = detail ?? opening;

  return (
    <Screen title="أهدافي" subtitle={dash?.week ? weekRange(dash.week.weekStart, dash.week.weekEnd) : 'هذا الأسبوع'} onRefresh={reload}>
      {err && !dash && <ErrorLine text={err} onRetry={() => void reload()} />}

      {!dash && loading ? (
        <Skeleton h={130} r={26} />
      ) : rows.length === 0 ? (
        <Empty icon={<I.target size={30} />} title="لا أهداف هذا الأسبوع" text="عندما تحدد الإدارة أهدافاً أسبوعية لك تظهر هنا مع تقدّمك لحظة بلحظة." />
      ) : (
        <>
          <section className="t-hero">
            <div className="t-hero-row" style={{ alignItems: 'center' }}>
              <div>
                <p className="kicker">الإنجاز هذا الأسبوع</p>
                <div className="amount">
                  <span className="num">{done}</span>
                  <small>من {rows.length} أهداف مكتملة</small>
                </div>
                <div className="meta">
                  <span>
                    متوسط التقدّم <b className="num">{Math.round(avg)}%</b>
                  </span>
                </div>
              </div>
              <div style={{ color: '#fff' }}>
                <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
                  <circle cx="38" cy="38" r="32" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="8" />
                  <circle
                    cx="38"
                    cy="38"
                    r="32"
                    fill="none"
                    stroke="#F0B04F"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 32}
                    strokeDashoffset={2 * Math.PI * 32 * (1 - avg / 100)}
                    style={{ transition: 'stroke-dashoffset 1s var(--ease)' }}
                  />
                </svg>
              </div>
            </div>
          </section>

          <div style={{ marginTop: 16 }}>
            <Segmented
              items={[
                { id: 'all', label: `الكل ${rows.length}` },
                { id: 'open', label: `جارية ${rows.length - done}` },
                { id: 'done', label: `مكتملة ${done}` },
              ]}
              value={filter}
              onChange={setFilter}
            />
          </div>

          <div key={filter} style={{ display: 'grid', gap: 10, marginTop: 14, animation: 'page-in .3s var(--ease) both' }}>
            {list.length === 0 && <Empty icon={<I.check size={28} />} title="لا شيء هنا" text="غيّر التصفية لرؤية بقية الأهداف." />}
            {list.map(g => {
              const remain = Math.max(0, g.weeklyTarget - g.sold);
              return (
                <button key={g.ruleId} type="button" className="t-card pad press" style={{ textAlign: 'start' }} onClick={() => void open(g)}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <Ring value={g.percent} size={58} tone={tone(g.percent)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <b style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.35 }}>{g.ruleName}</b>
                        {status(g.percent)}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--ink-3)' }}>
                        {targetKind(g.targetType)} · <span className="num">{goalValue(g.targetType, g.sold)}</span> من{' '}
                        <span className="num">{goalValue(g.targetType, g.weeklyTarget)}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Track value={g.percent} tone={tone(g.percent)} />
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: remain ? 'var(--ink-2)' : 'var(--ok)' }}>
                    {remain ? `باقي ${goalValue(g.targetType, remain)} للوصول` : 'أحسنت — تجاوزت الهدف'}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <Sheet
        open={!!opening}
        onClose={() => {
          setOpening(null);
          setDetail(null);
        }}
        title={shown?.ruleName}
        subtitle={shown ? `${targetKind(shown.targetType)} · ${Math.round(shown.percent)}% منجز` : ''}
      >
        {shown && (
          <>
            <div className="t-stats two" style={{ marginBottom: 14 }}>
              <div className="t-stat">
                <span>المحقق</span>
                <b className="num">{goalValue(shown.targetType, shown.sold)}</b>
              </div>
              <div className="t-stat">
                <span>الهدف</span>
                <b className="num">{goalValue(shown.targetType, shown.weeklyTarget)}</b>
              </div>
            </div>
            {detailErr ? (
              <ErrorLine text={detailErr} />
            ) : !detail ? (
              <Skeleton h={160} r={18} />
            ) : detail.lines.length === 0 ? (
              <Empty title="لا حركات بعد" text="كل قطعة تبيعها من منتجات الهدف تظهر هنا." />
            ) : (
              <div className="t-list flat">
                {detail.lines.map((l, i) => (
                  <div key={i} className="t-row">
                    <div className="body">
                      <div className="title">{l.productName}</div>
                      <div className="sub">
                        {dayLabel(l.occurredAt)} · {clockLabel(l.occurredAt)} · {receiptLabel(l.receiptNumber)}
                      </div>
                    </div>
                    <div className="end">
                      <b className="num">{fmt(l.quantity)}</b>
                      <small>قطعة</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
