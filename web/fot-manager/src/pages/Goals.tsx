import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  goalLabel, goalTone, goalValue, groupGoalsByRule, groupGoalsBySeller,
  moneyIq, pct, targetKind, type GoalRow, type LineRow,
} from '../api';
import { groupReceipts, linesForSeller } from '../insights';
import { LineSheet, MoveList, ReceiptList } from '../lines';
import { useManager } from '../store';
import { Badge, Empty, ErrorBox, Ring, SearchField, SectionCard, Sheet, Skeleton, Track } from '../ui';
import { WeekStepper, WeekTimeline } from '../week';

type Filter = 'all' | 'done' | 'near' | 'late';
type View = 'by-goal' | 'by-seller';

export function Goals() {
  const { weekStart, setWeek, dash, weeks, lines, err, loading, reload } = useManager();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('by-goal');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [ruleId, setRuleId] = useState<number | null>(() => {
    const raw = params.get('rule');
    return raw ? Number(raw) || null : null;
  });
  const [open, setOpen] = useState<GoalRow | null>(null);
  const [line, setLine] = useState<LineRow | null>(null);

  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  useEffect(() => {
    const raw = params.get('rule');
    if (raw) setRuleId(Number(raw) || null);
  }, [params]);

  const rules = useMemo(() => groupGoalsByRule(dash?.goals), [dash]);
  const groups = useMemo(() => groupGoalsBySeller(dash?.goals), [dash]);

  const activeRule = useMemo(
    () => rules.find(r => r.ruleId === ruleId) ?? rules[0] ?? null,
    [rules, ruleId],
  );

  useEffect(() => {
    if (!rules.length) return;
    if (ruleId == null || !rules.some(r => r.ruleId === ruleId)) {
      setRuleId(rules[0].ruleId);
    }
  }, [rules, ruleId]);

  function pickRule(id: number) {
    setRuleId(id);
    const next = new URLSearchParams(params);
    next.set('rule', String(id));
    setParams(next, { replace: true });
  }

  const ruleMembers = useMemo(() => {
    if (!activeRule) return [];
    return activeRule.members.filter(m => {
      if (q.trim() && !m.salesmanName.includes(q.trim()) && !m.ruleName.includes(q.trim())) return false;
      if (filter === 'done') return m.percent >= 100;
      if (filter === 'near') return m.percent >= 80 && m.percent < 100;
      if (filter === 'late') return m.percent < 80;
      return true;
    });
  }, [activeRule, filter, q]);

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
    <div className="page-flow fade-up">
      <WeekStepper weeks={weeks} weekStart={weekStart} setWeek={setWeek} kicker="أهداف الأسبوع" />

      <SectionCard kicker="تصفح" title="الأسابيع" className="week-timeline-wrap">
        <WeekTimeline weeks={weeks} weekStart={weekStart} setWeek={setWeek} />
      </SectionCard>

      <section className="card section-card">
        <div className="flex flex-wrap items-center gap-4">
          <Ring value={view === 'by-goal' ? (activeRule?.avg ?? avg) : avg} size={100} tone="goal" label="إنجاز" />
          <div className="min-w-0 flex-1">
            <p className="kicker">التاركت الأسبوعي</p>
            <h1 className="display text-2xl font-black">الأهداف</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-muted">
              {rules.length
                ? `${rules.length} هدف · ${groups.length} بائع`
                : 'اربط التاركت من لوحة التحكم'}
            </p>
          </div>
        </div>
        {rules.length > 0 && (
          <div className="goals-summary-grid">
            <div className="goals-summary-cell ok"><strong className="num">{hit}</strong><span>تحقق</span></div>
            <div className="goals-summary-cell"><strong className="num">{near}</strong><span>قريب</span></div>
            <div className="goals-summary-cell warn"><strong className="num">{late}</strong><span>تركيز</span></div>
          </div>
        )}
      </section>

      <div className="view-toggle">
        <button type="button" className={view === 'by-goal' ? 'on' : ''} onClick={() => setView('by-goal')}>حسب الهدف</button>
        <button type="button" className={view === 'by-seller' ? 'on' : ''} onClick={() => setView('by-seller')}>حسب البائع</button>
      </div>

      {view === 'by-goal' && rules.length > 0 && (
        <>
          <div className="goal-rule-picker">
            {rules.map(r => (
              <button
                key={r.ruleId}
                type="button"
                className={`goal-rule-chip ${activeRule?.ruleId === r.ruleId ? 'on' : ''}`}
                onClick={() => pickRule(r.ruleId)}
              >
                <span className="goal-rule-name">{r.ruleName}</span>
                <span className="goal-rule-meta num">{pct(r.avg)} · {r.hit}/{r.total}</span>
              </button>
            ))}
          </div>

          {activeRule && (
            <section className="card home-section goal-focus">
              <div className="goal-focus-head">
                <div>
                  <p className="kicker">{targetKind(activeRule.targetType)}</p>
                  <h2 className="text-xl font-black">{activeRule.ruleName}</h2>
                  <p className="mt-1 text-sm font-bold text-muted">
                    الهدف {goalValue(activeRule.targetType, activeRule.weeklyTarget)} · {activeRule.hit} من {activeRule.total} حققوا
                  </p>
                </div>
                <Ring value={activeRule.avg} size={80} tone={goalTone(activeRule.avg)} label="متوسط" />
              </div>
            </section>
          )}

          <SearchField value={q} onChange={setQ} placeholder="ابحث بالبائع" />
          <div className="filter-stats">
            {([['all', activeRule?.total ?? 0, 'الكل'], ['done', activeRule?.hit ?? 0, 'تحقق'], ['near', ruleMembers.filter(m => m.percent >= 80 && m.percent < 100).length, 'قريب'], ['late', ruleMembers.filter(m => m.percent < 80).length, 'تركيز']] as const).map(([k, n, label]) => (
              <button key={k} type="button" className={`filter-stat ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                <strong className="num">{n}</strong>
                <span>{label}</span>
              </button>
            ))}
          </div>

          {loading && !ruleMembers.length && <Skeleton />}
          <div className="goal-member-list stagger">
            {ruleMembers.map((m, i) => {
              const remain = Math.max(0, m.weeklyTarget - m.sold);
              return (
                <button key={`${m.ruleId}-${m.salesmanId}`} type="button" className="goal-member-row card" onClick={() => setOpen(m)}>
                  <span className="goal-member-rank num">{i + 1}</span>
                  <Ring value={m.percent} size={52} tone={goalTone(m.percent)} />
                  <div className="min-w-0 flex-1 text-start">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-extrabold">{m.salesmanName}</p>
                      <Badge tone={goalTone(m.percent) === 'goal' ? 'goal' : goalTone(m.percent)}>{goalLabel(m.percent)}</Badge>
                    </div>
                    <p className="mt-1 text-sm font-extrabold text-gold">
                      {goalValue(m.targetType, m.sold)} من {goalValue(m.targetType, m.weeklyTarget)}
                    </p>
                    <div className="mt-2"><Track value={m.percent} tone={goalTone(m.percent)} /></div>
                    {remain > 0
                      ? <p className="mt-1 text-xs font-extrabold text-muted">المتبقي {goalValue(m.targetType, remain)}</p>
                      : <p className="mt-1 text-xs font-extrabold text-ok">اكتمل الهدف</p>}
                  </div>
                  <span className="num text-lg font-black">{pct(m.percent)}</span>
                </button>
              );
            })}
            {!loading && !ruleMembers.length && (
              <Empty title="لا بائعين في هذا التصنيف" hint="غيّر الفلتر أو اختر هدفاً آخر" />
            )}
          </div>
        </>
      )}

      {view === 'by-seller' && (
        <>
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
        </>
      )}

      {!rules.length && !loading && (
        <Empty title="لا أهداف هذا الأسبوع" hint="اربط التاركت من لوحة التحكم ثم حدّث الصفحة" />
      )}

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
                <div className="detail-cell"><p>عمولته</p><strong className="num">{moneyIq(seller.commissionAmount)}</strong></div>
                <div className="detail-cell"><p>قطع</p><strong className="num">{seller.pieceCount}</strong></div>
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

function SellerGoalBlock({ group, onOpen }: { group: ReturnType<typeof groupGoalsBySeller>[number]; onOpen: (g: GoalRow) => void }) {
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
