import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ago, shownWeekAmount, shownWeekLabel, weekIsPaid } from '../../api';
import { useBrandList } from '../../brands';
import { fillWeekDays, groupDays } from '../../insights';
import { useSeller, useWeekCompare } from '../../store';
import { KIND_LABEL, getTeamMe } from '../../team';
import { Avatar, CountUp, Delta, ErrorLine, I, Ring, Skeleton, clockLabel, fmt, greet, iraqToday, usePull, weekRange } from '../kit';
import { haptic } from '../native';

/* ─────────────────────────────────────────────────────────────────────────────
 * الرئيسية — تحية، بطاقة عمولة الأسبوع بأعمدة الأيام، الأهداف، البراندات، آخر المبيعات.
 * ───────────────────────────────────────────────────────────────────────────── */

function iraqIsoToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function Greeting({ name, sub, onRefresh, loading }: { name: string; sub: string; onRefresh?: () => void; loading?: boolean }) {
  return (
    <>
      <header className="t-greet">
        <Link to="/account" aria-label="حسابي" className="press">
          <Avatar name={name} />
        </Link>
        <div className="grow">
          <div className="hello">{greet()}</div>
          <div className="who">{name}</div>
        </div>
        {onRefresh && (
          <button type="button" className={`t-icon-btn press ${loading ? 'spin' : ''}`} aria-label="تحديث" onClick={onRefresh}>
            <I.refresh size={20} />
          </button>
        )}
      </header>
      <p className="t-date">
        {iraqToday()}
        {sub ? ` · ${sub}` : ''}
      </p>
    </>
  );
}

export function SellerHome() {
  const nav = useNavigate();
  const { dash, weeks, lines, loading, err, reload, updatedAt, weekStart } = useSeller();
  const { list: brands } = useBrandList();
  const { cur, prev } = useWeekCompare(weeks, weekStart);
  const me = getTeamMe();
  const name = me?.name || dash?.seller.name || 'أهلاً';
  const pull = usePull(reload);

  const today = iraqIsoToday();
  const days = useMemo(() => fillWeekDays(groupDays(lines), dash?.week.weekStart, dash?.week.weekEnd), [lines, dash?.week.weekStart, dash?.week.weekEnd]);
  const peak = Math.max(1, ...days.map(d => d.commission));
  const week = dash?.week;
  const amount = shownWeekAmount(week);
  const goals = dash?.goals ?? [];
  const pieces = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0), [lines]);
  const done = goals.filter(g => g.percent >= 100).length;

  return (
    <>
      {pull}
      <Greeting name={name} sub={updatedAt ? `محدّث ${ago(updatedAt)}` : ''} loading={loading} onRefresh={() => void reload()} />
      <div className="t-page">
        {err && !dash && <ErrorLine text={err} onRetry={() => void reload()} />}

        {!dash ? (
          <Skeleton h={250} r={26} />
        ) : (
          <button
            type="button"
            className="t-hero press"
            style={{ width: '100%', textAlign: 'start' }}
            onClick={() => {
              haptic('tap');
              nav('/commission');
            }}
          >
            <div className="t-hero-row">
              <div>
                <p className="kicker">{shownWeekLabel(week)}</p>
                <div className="amount">
                  <CountUp value={amount} />
                  <small>د.ع</small>
                </div>
              </div>
              {weekIsPaid(week) ? (
                <span className="t-chip-glass up">
                  <I.check size={13} /> مستلم
                </span>
              ) : (
                prev && <Delta glass now={shownWeekAmount(cur)} prev={shownWeekAmount(prev)} />
              )}
            </div>
            <div className="meta">
              <span>
                <b className="num">{fmt(week?.receiptCount ?? 0)}</b> فاتورة
              </span>
              <span>
                <b className="num">{fmt(pieces)}</b> قطعة
              </span>
              <span>{weekRange(week?.weekStart, week?.weekEnd)}</span>
            </div>
            {days.length > 0 && (
            <div className="t-week-bars" aria-hidden>
              {days.map((d, i) => (
                <div key={d.key} className={`col ${d.key === today ? 'today' : ''}`}>
                  <div className="bar" style={{ height: `${Math.max(6, (d.commission / peak) * 100)}%`, animationDelay: `${i * 40}ms` }} />
                  <span>{d.weekday}</span>
                </div>
              ))}
            </div>
            )}
          </button>
        )}

        {dash && dash.balanceDue > 0 && (
          <Link to="/commission" className="t-card pad press" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <span className="t-tile accent">
              <I.wallet size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>لم يُصرف بعد</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>
                {fmt(dash.balanceDue)} <small style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>د.ع</small>
              </div>
            </div>
            <span style={{ color: 'var(--ink-4)' }}>
              <I.chevron />
            </span>
          </Link>
        )}

        {/* الأهداف */}
        {goals.length > 0 && (
          <section className="t-section">
            <div className="t-section-head">
              <h2>أهدافي</h2>
              <Link to="/goals" className="more">
                {done}/{goals.length} مكتمل
              </Link>
            </div>
            <div className="t-scroller">
              {goals.map(g => (
                <Link key={g.ruleId} to={`/goals?g=${g.ruleId}`} className="t-goal-card press">
                  <Ring value={g.percent} tone={g.percent >= 100 ? 'ok' : g.percent >= 60 ? undefined : 'accent'} />
                  <div className="name">{g.ruleName}</div>
                  <div className="sub num">
                    {fmt(g.sold)} / {fmt(g.weeklyTarget)}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* البراندات */}
        {!!brands?.length && (
          <section className="t-section">
            <div className="t-section-head">
              <h2>براندي</h2>
              <Link to="/brands" className="more">
                الكشوفات
              </Link>
            </div>
            <div className="t-scroller">
              {brands.map(b => (
                <Link key={b.treeSeq} to={`/brands?b=${b.treeSeq}`} className="t-brand-card press">
                  <span className="t-tile" style={{ position: 'relative' }}>
                    <I.tag size={19} />
                  </span>
                  <b>{b.name}</b>
                  <small>{fmt(b.productCount)} مادة · مبيعات وكشف Excel</small>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* آخر المبيعات */}
        <section className="t-section">
          <div className="t-section-head">
            <h2>آخر مبيعاتك</h2>
            {lines.length > 0 && (
              <Link to="/commission" className="more">
                الكل ({fmt(lines.length)})
              </Link>
            )}
          </div>
          {!dash && loading ? (
            <Skeleton h={180} r={20} />
          ) : lines.length === 0 ? (
            <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
              لا مبيعات بعمولة هذا الأسبوع بعد — أول بيعة تظهر هنا فوراً.
            </div>
          ) : (
            <div className="t-list">
              {lines.slice(0, 5).map(l => (
                <div key={l.id} className="t-row">
                  <span className="t-tile mute">
                    <I.box size={18} />
                  </span>
                  <div className="body">
                    <div className="title">{l.productName}</div>
                    <div className="sub">
                      {clockLabel(l.occurredAt)} · {l.quantity} قطعة{l.mallName ? ` · ${l.mallName}` : ''}
                    </div>
                  </div>
                  <div className="end">
                    <b className="num ltr" style={{ color: 'var(--ok)' }}>+{fmt(l.commissionAmount)}</b>
                    <small>د.ع</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <ComingSoon />
      </div>
    </>
  );
}

function ComingSoon() {
  return (
    <section className="t-section">
      <div className="t-soon">
        <span className="t-tile accent lg">
          <I.sparkle size={22} />
        </span>
        <div>
          <h3>قريباً في تطبيقك</h3>
          <p>الحضور والاستراحة، الإجازات، التبليغات والمحادثات.</p>
        </div>
      </div>
    </section>
  );
}

/* ═════════════ الموظف غير البائع ═════════════ */
const MODULES = [
  { icon: <I.clock size={22} />, title: 'الحضور والاستراحة', text: 'سجّل حضورك من شبكة المحل، ومنبّه قبل نهاية استراحتك.', tone: '' },
  { icon: <I.calendar size={22} />, title: 'دوامي وإجازاتي', text: 'عطلتك الأسبوعية وطلبات التبديل والإجازة.', tone: 'accent' },
  { icon: <I.megaphone size={22} />, title: 'الإعلانات', text: 'تعليمات الإدارة والعروض الجديدة بالصور.', tone: 'ok' },
  { icon: <I.chat size={22} />, title: 'المحادثات', text: 'محادثات خاصة ومجموعات العمل.', tone: 'mute' },
];

export function StaffHome() {
  const me = getTeamMe();
  const name = me?.name || 'أهلاً';
  return (
    <>
      <Greeting name={name} sub={KIND_LABEL[me?.kind ?? ''] ?? ''} />
      <div className="t-page">
        <section className="t-hero">
          <p className="kicker">{[me?.jobTitle || KIND_LABEL[me?.kind ?? ''] || 'فريق ديما', me?.sectionName].filter(Boolean).join(' · ')}</p>
          <div className="amount" style={{ fontSize: 28 }}>
            {name}
          </div>
          <div className="meta">
            <span>
              كود الدخول <b className="num ltr">{me?.code ?? '—'}</b>
            </span>
            <span>ديما الحياة · بغداد</span>
          </div>
        </section>

        <section className="t-section">
          <div className="t-section-head">
            <h2>خدماتك</h2>
            <small>تُفعَّل تباعاً</small>
          </div>
          <div className="t-grid-2">
            {MODULES.map(m => (
              <div key={m.title} className="t-feature">
                <span className={`t-tile ${m.tone}`}>{m.icon}</span>
                <h3>{m.title}</h3>
                <p>{m.text}</p>
                <span className="t-badge mute" style={{ alignSelf: 'flex-start' }}>
                  قريباً
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
