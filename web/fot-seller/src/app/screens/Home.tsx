import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ago, shownWeekAmount, shownWeekLabel, weekIsPaid } from '../../api';
import { useBrandList } from '../../brands';
import { fillWeekDays, groupDays } from '../../insights';
import { useSeller, useWeekCompare } from '../../store';
import { KIND_LABEL, getTeamMe } from '../../team';
import { useAccessLocked, useLockInfo, to12 } from '../../access';
import { cleanName } from '../../names';
import { Avatar, CountUp, Delta, ErrorLine, I, Ring, Skeleton, clockLabel, fmt, greet, iraqToday, usePull, weekRange } from '../kit';
import { haptic } from '../native';
import { mediaUrl, shortDay, staffApi, useLoad, useUnread } from '../work';
import { AttendCard, HoursCard } from './Attend';
import { getTeamToken } from '../../team';

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

function Greeting({ name, sub, unread }: { name: string; sub: string; unread?: number }) {
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
        {unread !== undefined && (
          <Link to="/alerts" className="t-icon-btn t-bell press" aria-label={unread ? `${unread} تبليغ غير مقروء` : 'التبليغات'} onClick={() => haptic('tap')}>
            <I.bell size={20} />
            {unread > 0 && (
              <span key={unread} className="dot num">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
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
  const name = cleanName(me?.name || dash?.seller.name) || 'أهلاً';
  const pull = usePull(reload);
  const team = !!getTeamToken();
  const unread = useUnread(team ? 'staff' : null);

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
      <Greeting name={name} sub={updatedAt ? `محدّث ${ago(updatedAt)}` : ''} unread={team ? unread : undefined} />
      <div className="t-page">
        {err && !dash && <ErrorLine text={err} onRetry={() => void reload()} />}

        {team && (
          <div style={{ marginBottom: 14 }}>
            <AttendCard compact />
          </div>
        )}

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

        {team && <TeamWidgets />}

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

      </div>
    </>
  );
}

/* ═════════════ أجزاء الفريق (تحتاج دخول الفريق) ═════════════ */

/** أسبوعي في الدوام + الإعلانات المثبتة والجديدة */
function TeamWidgets() {
  const leave = useLoad(() => staffApi.leave(), ['leave']);
  const posts = useLoad(() => staffApi.posts(), ['post']);
  const today = leave.data?.today ?? '';
  const week = (leave.data?.days ?? []).filter(d => d.date >= today).slice(0, 7);
  const featured = (posts.data ?? []).filter(p => p.pinned || !p.read || (p.requiresAck && !p.acked)).slice(0, 5);
  const pending = leave.data?.requests.filter(r => r.status === 'pending').length ?? 0;
  const hourly = leave.data?.plan === 'hourly';

  return (
    <>
      {getTeamMe()?.supervisor && (
        <section className="t-section">
          <Link to="/m" className="t-row t-card press" onClick={() => haptic('tap')}>
            <span className="t-tile ok">
              <I.user size={20} />
            </span>
            <div className="body">
              <div className="title">إدارة الفريق</div>
              <div className="sub">طلبات فريقك وحضوره وما فعّلته لك الإدارة</div>
            </div>
            <I.chevron size={18} />
          </Link>
        </section>
      )}
      {hourly && <HoursCard />}
      {!hourly && week.length > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>دوامي القادم</h2>
            <Link to="/shift" className="more">
              {pending ? `${pending} طلب معلّق` : 'التقويم والطلبات'}
            </Link>
          </div>
          <Link to="/shift" className="t-card pad press" style={{ display: 'block' }}>
            <div className="t-cal">
              {week.map(d => (
                <div key={d.date} className={`t-day ${d.date === today ? 'today' : ''} ${d.off ? (d.reason === 'sick' ? 'sick' : d.reason === 'day' || d.reason === 'urgent' ? 'leave' : 'off') : ''} ${d.reason === 'hours' ? 'hours' : ''}`}>
                  <small>{shortDay(d.weekday)}</small>
                  <span className="num">{Number(d.date.slice(8))}</span>
                </div>
              ))}
            </div>
          </Link>
        </section>
      )}

      {featured.length > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>من الإدارة</h2>
            <Link to="/posts" className="more">
              كل الإعلانات
            </Link>
          </div>
          <div className="t-scroller" style={{ alignItems: 'stretch' }}>
            {featured.map(p => (
              <Link key={p.id} to={`/posts?id=${p.id}`} className="t-post press" style={{ width: 280, marginTop: 0 }}>
                {p.images[0] ? (
                  <div className="t-gallery n1" style={{ marginTop: 0 }}>
                    <span>
                      <img src={mediaUrl(p.images[0])} alt="" loading="lazy" />
                    </span>
                  </div>
                ) : null}
                <div style={{ padding: '12px 14px 14px' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    {p.pinned && <span className="t-badge accent">مثبّت</span>}
                    {!p.read && <span className="t-badge">جديد</span>}
                    {p.requiresAck && !p.acked && <span className="t-badge warn">يتطلب اطلاعك</span>}
                  </div>
                  <b style={{ display: 'block', fontSize: 15, lineHeight: 1.4 }}>{p.title}</b>
                  {p.body && (
                    <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--ink-3)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {p.body}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ═════════════ الموظف غير البائع ═════════════ */
export function StaffHome() {
  const me = getTeamMe();
  const name = cleanName(me?.name) || 'أهلاً';
  const unread = useUnread('staff');
  const locked = useAccessLocked();
  const lockInfo = useLockInfo();
  return (
    <>
      <Greeting name={name} sub={KIND_LABEL[me?.kind ?? ''] ?? ''} unread={unread} />
      <div className="t-page">
        <AttendCard compact />
        {locked && (
          <section className="t-section">
            <Link to="/commission" className="t-row t-card press" onClick={() => haptic('tap')}>
              <span className="t-tile mute">
                <I.lock size={20} />
              </span>
              <div className="body">
                <div className="title">العمولات والأهداف مقفلة الآن</div>
                <div className="sub">{lockInfo?.schedule.fromMin != null ? `تُفتح من ${to12(lockInfo.schedule.fromMin)} إلى ${to12(lockInfo.schedule.toMin)}` : 'متاحة في الأيام المحددة فقط'}</div>
              </div>
              <I.chevron size={18} />
            </Link>
          </section>
        )}

        <section className="t-section">
          <div className="t-quick">
            <Link to="/shift" className="press">
              <span className="t-tile accent">
                <I.calendar size={20} />
              </span>
              دوامي
            </Link>
            {me?.plan !== 'hourly' && (
              <Link to="/shift?new=1" className="press">
                <span className="t-tile">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                طلب إجازة
              </Link>
            )}
            <Link to="/posts" className="press">
              <span className="t-tile ok">
                <I.megaphone size={20} />
              </span>
              الإعلانات
            </Link>
            <Link to="/alerts" className="press">
              <span className="t-tile mute">
                <I.bell size={20} />
              </span>
              التبليغات
            </Link>
          </div>
        </section>

        <TeamWidgets />
      </div>
    </>
  );
}
