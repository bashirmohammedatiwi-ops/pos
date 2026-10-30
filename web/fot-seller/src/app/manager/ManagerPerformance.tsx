import { useEffect, useMemo, useState } from 'react';
import { Avatar, Delta, Empty, ErrorLine, I, Ring, Screen, Segmented, Sheet, Skeleton, Track, fmt, toast, weekRange } from '../kit';
import { haptic } from '../native';
import { BackBtn } from '../parts';
import { performanceApi, relTime, type PerfGoal, type PerfSeller, type PerfSellerDetail, type PerfWeek } from '../work';
import { compact } from './ManagerSales';

/* ─────────────────────────────────────────────────────────────────────────────
 * أداء الفريق داخل التطبيق: البائعون والأهداف والعمولات أسبوعاً بأسبوع،
 * مقارنة بالأسبوع السابق، وتفصيل كل بائع (أهدافه وآخر مبيعاته).
 * ───────────────────────────────────────────────────────────────────────────── */

type Tab = 'sellers' | 'goals' | 'commission';
const cleanName = (n?: string | null) => (n || '').replace(/^\d+\s*-\s*/, '') || '—';
const goalValue = (g: PerfGoal, v: number) => (g.targetType === 'amount' ? compact(v) : `${fmt(v)} قطعة`);

export function MPerformance() {
  const [weeks, setWeeks] = useState<PerfWeek[] | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [sellers, setSellers] = useState<PerfSeller[] | null>(null);
  const [prev, setPrev] = useState<PerfSeller[]>([]);
  const [goals, setGoals] = useState<PerfGoal[]>([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('sellers');
  const [pick, setPick] = useState<PerfSeller | null>(null);

  useEffect(() => {
    performanceApi
      .weeks()
      .then(w => {
        setWeeks(w);
        setWeek((w.find(x => x.isCurrent) ?? w[0])?.weekStart ?? null);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, []);

  const prevWeek = useMemo(() => {
    if (!weeks || !week) return null;
    const sorted = [...weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    const i = sorted.findIndex(x => x.weekStart === week);
    return i > 0 ? sorted[i - 1] : null;
  }, [weeks, week]);
  const cur = weeks?.find(x => x.weekStart === week) ?? null;

  async function load() {
    if (!week) return;
    try {
      const [s, g, p] = await Promise.all([performanceApi.sellers(week), performanceApi.goals(week), prevWeek ? performanceApi.sellers(prevWeek.weekStart) : Promise.resolve([])]);
      setSellers(s);
      setGoals(g);
      setPrev(p);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    }
  }
  useEffect(() => {
    setSellers(null);
    void load();
  }, [week]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevOf = useMemo(() => new Map(prev.map(p => [p.salesmanId, p])), [prev]);
  const ranked = useMemo(() => [...(sellers ?? [])].sort((a, b) => b.salesAmount - a.salesAmount), [sellers]);
  const byCommission = useMemo(() => [...(sellers ?? [])].sort((a, b) => b.commissionAmount - a.commissionAmount), [sellers]);
  const topSales = Math.max(1, ...ranked.map(s => s.salesAmount));
  const topComm = Math.max(1, ...byCommission.map(s => s.commissionAmount));
  const dueTotal = (sellers ?? []).reduce((a, s) => a + (s.balanceDue || 0), 0);

  // الأهداف مجمّعة حسب القاعدة
  const rules = useMemo(() => {
    const map = new Map<number, { id: number; name: string; rows: PerfGoal[] }>();
    for (const g of goals) {
      const r = map.get(g.ruleId) ?? { id: g.ruleId, name: g.ruleName, rows: [] };
      r.rows.push(g);
      map.set(g.ruleId, r);
    }
    return [...map.values()].map(r => ({ ...r, rows: r.rows.sort((a, b) => b.percent - a.percent), hit: r.rows.filter(x => x.percent >= 100).length }));
  }, [goals]);

  return (
    <Screen title="أداء الفريق" subtitle={cur ? weekRange(cur.weekStart, cur.weekEnd) : 'البائعون والأهداف والعمولات'} start={<BackBtn to="/m/more" />} onRefresh={load}>
      {err && !weeks && <ErrorLine text={err} />}
      {weeks && (
        <div className="t-scroller" style={{ marginBottom: 12 }}>
          {[...weeks]
            .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
            .map(w => (
              <button
                key={w.weekStart}
                type="button"
                className={`t-pill press ${w.weekStart === week ? 'on' : ''}`}
                onClick={() => {
                  haptic('select');
                  setWeek(w.weekStart);
                }}
              >
                {w.isCurrent ? 'هذا الأسبوع' : weekRange(w.weekStart, w.weekEnd)}
                <small className="num">{compact(w.salesAmount)}</small>
              </button>
            ))}
        </div>
      )}

      {cur && (
        <section className="t-hero s-hero">
          <div className="t-hero-row">
            <p className="kicker">مبيعات الأسبوع</p>
            {prevWeek && <Delta glass now={cur.salesAmount} prev={prevWeek.salesAmount} />}
          </div>
          <div className="amount">
            <span className="num">{fmt(cur.salesAmount)}</span>
            <small>د.ع</small>
          </div>
          <div className="meta">
            <span>
              العمولات <b className="num">{compact(cur.commissionAmount)}</b>
            </span>
            <span>
              <b className="num">{fmt(cur.receiptCount)}</b> فاتورة
            </span>
            <span>
              <b className="num">{fmt(cur.pieceCount)}</b> قطعة
            </span>
          </div>
        </section>
      )}

      <div style={{ margin: '14px 0 12px' }}>
        <Segmented
          items={[
            { id: 'sellers', label: 'البائعون' },
            { id: 'goals', label: 'الأهداف' },
            { id: 'commission', label: 'العمولات' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {err && weeks && <ErrorLine text={err} onRetry={() => void load()} />}
      {!sellers && !err ? (
        <Skeleton h={320} r={20} />
      ) : !ranked.length ? (
        <Empty icon={<I.user size={30} />} title="لا بيانات لهذا الأسبوع" />
      ) : tab === 'sellers' ? (
        <div className="t-list s-rank">
          {ranked.map((s, i) => (
            <button key={s.salesmanId} type="button" className="t-row press-soft" onClick={() => (haptic('tap'), setPick(s))}>
              <span className={`s-pos ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
              <div className="body">
                <div className="s-rank-top">
                  <span className="title">{cleanName(s.name)}</span>
                  <b className="num">{compact(s.salesAmount)}</b>
                </div>
                <div className="s-bar">
                  <i style={{ width: `${Math.max(2, (s.salesAmount / topSales) * 100)}%` }} />
                </div>
                <div className="s-rank-sub">
                  <span className="num">
                    {fmt(s.receiptCount)} فاتورة · {fmt(s.pieceCount)} قطعة{s.goalCount ? ` · أهداف ${s.goalsHit}/${s.goalCount}` : ''}
                  </span>
                  {prevOf.has(s.salesmanId) && <Delta now={s.salesAmount} prev={prevOf.get(s.salesmanId)!.salesAmount} />}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : tab === 'goals' ? (
        !rules.length ? (
          <Empty icon={<I.target size={30} />} title="لا أهداف في هذا الأسبوع" />
        ) : (
          rules.map(r => (
            <section key={r.id} className="t-section" style={{ marginTop: 14 }}>
              <div className="t-section-head">
                <h2 style={{ fontSize: 15 }}>{r.name}</h2>
                <small className="num">
                  حققه {r.hit} من {r.rows.length}
                </small>
              </div>
              <div className="t-list flat">
                {r.rows.map(g => (
                  <div key={`${g.ruleId}-${g.salesmanId}`} className="t-row">
                    <Ring value={g.percent} size={42} stroke={5} tone={g.percent >= 100 ? 'ok' : undefined} />
                    <div className="body">
                      <div className="title">{cleanName(g.salesmanName)}</div>
                      <div className="sub num">
                        {goalValue(g, g.sold)} من {goalValue(g, g.weeklyTarget)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )
      ) : (
        <>
          {dueTotal > 0 && (
            <div className="t-kpi alert" style={{ marginBottom: 12 }}>
              <span>عمولات لم تُصرف بعد</span>
              <b className="num">{fmt(dueTotal)}</b>
            </div>
          )}
          <div className="t-list s-rank">
            {byCommission.map((s, i) => (
              <button key={s.salesmanId} type="button" className="t-row press-soft" onClick={() => (haptic('tap'), setPick(s))}>
                <span className={`s-pos ${i < 3 ? `top${i + 1}` : ''}`}>{i + 1}</span>
                <div className="body">
                  <div className="s-rank-top">
                    <span className="title">{cleanName(s.name)}</span>
                    <b className="num">{fmt(s.commissionAmount)}</b>
                  </div>
                  <div className="s-bar">
                    <i style={{ width: `${Math.max(2, (s.commissionAmount / topComm) * 100)}%` }} />
                  </div>
                  <div className="s-rank-sub">
                    <span className="num">{s.salesAmount ? ((s.commissionAmount / s.salesAmount) * 100).toFixed(1) : 0}% من المبيعات</span>
                    {s.balanceDue > 0 && <span className="num">مستحق {fmt(s.balanceDue)}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <SellerSheet seller={pick} week={week} onClose={() => setPick(null)} />
    </Screen>
  );
}

function SellerSheet({ seller, week, onClose }: { seller: PerfSeller | null; week: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<PerfSellerDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    if (!seller || !week) return;
    performanceApi
      .seller(seller.salesmanId, week)
      .then(setDetail)
      .catch(e => toast(e instanceof Error ? e.message : 'تعذر التحميل'));
  }, [seller, week]);
  return (
    <Sheet open={!!seller} onClose={onClose} title={seller ? cleanName(seller.name) : ''} subtitle="أداء هذا الأسبوع">
      {seller && (
        <>
          <div className="s-detail" style={{ marginBottom: 14 }}>
            <div className="s-stat">
              <span>المبيعات</span>
              <b className="num">
                {fmt(seller.salesAmount)} <small>د.ع</small>
              </b>
            </div>
            <div className="s-stat">
              <span>العمولة</span>
              <b className="num">
                {fmt(seller.commissionAmount)} <small>د.ع</small>
              </b>
            </div>
            <div className="s-stat">
              <span>الفواتير</span>
              <b className="num">{fmt(seller.receiptCount)}</b>
            </div>
            <div className="s-stat">
              <span>القطع</span>
              <b className="num">{fmt(seller.pieceCount)}</b>
            </div>
          </div>
          {!detail ? (
            <Skeleton h={140} r={16} />
          ) : (
            <>
              {detail.goals.length > 0 && (
                <>
                  <p className="t-group-label">الأهداف</p>
                  <div className="t-card pad" style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
                    {detail.goals.map(g => (
                      <div key={g.ruleId}>
                        <div className="s-rank-top" style={{ fontSize: 13 }}>
                          <span>{g.ruleName}</span>
                          <b className="num" style={{ fontSize: 13 }}>
                            {Math.round(g.percent)}%
                          </b>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <Track value={g.percent} tone={g.percent >= 100 ? 'ok' : undefined} />
                        </div>
                        <small className="num" style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)' }}>
                          {goalValue(g, g.sold)} من {goalValue(g, g.weeklyTarget)}
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {detail.lines.length > 0 && (
                <>
                  <p className="t-group-label">آخر المبيعات</p>
                  <div className="t-list flat">
                    {detail.lines.slice(0, 25).map(l => (
                      <div key={l.id} className="t-row s-prod">
                        <Avatar name={l.productName} size="sm" />
                        <div className="body">
                          <div className="title">{l.productName}</div>
                          <div className="sub num">
                            {fmt(l.quantity)} قطعة · {relTime(l.occurredAt)}
                          </div>
                        </div>
                        <div className="end">
                          <b className="num">{compact(l.salesAmount)}</b>
                          <small className="num">عمولة {fmt(l.commissionAmount)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
