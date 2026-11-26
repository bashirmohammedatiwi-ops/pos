import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorLine, I, Skeleton, Track, greet, iraqToday, toast, usePull } from '../kit';
import { haptic } from '../native';
import { LEAVE_ICON, StatusBadge } from '../parts';
import { KIND_LABEL } from '../../team';
import { SalesHomeCard } from './ManagerSales';
import { SelfAttendCard } from './ManagerSelf';
import { LEAVE_LABEL, POST_KIND, byName, getManagerMe, leaveWhen, managerApi, managerAttendApi, relTime, supervisorMode, useLoad, usePerms, type Board, type LeaveReq } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * رئيسية المدير: بصمته، إحصاءات الحضور (كل رقم يفتح قائمته مباشرة)،
 * «يحتاج انتباهك» بأزرار موافقة فورية، وكل الأقسام بضغطة واحدة.
 * ───────────────────────────────────────────────────────────────────────────── */

const REASON_LABEL: Record<string, string> = { weekly: 'عطلة أسبوعية', swap: 'تبديل', day: 'إجازة', sick: 'مرضية', urgent: 'طارئة' };

/* ═════════════ بطاقة طلب: الموافقة بضغطة، واسم من وافق ظاهر على البطاقة ═════════════ */
export function LeaveCard({ req, onOpen, onDecided, canDecide = true }: { req: LeaveReq; onOpen: () => void; onDecided?: () => void; canDecide?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function approve() {
    if (busy) return;
    setBusy(true);
    try {
      await managerApi.decide(req.id, true);
      haptic('success');
      toast(`وافقت على طلب ${req.staffName.split(' ')[0]} — وصله التبليغ`);
      onDecided?.();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }
  const decided = req.status === 'approved' || req.status === 'rejected';
  return (
    <div className="m-req">
      <button
        type="button"
        className="head press-soft"
        onClick={() => {
          haptic('tap');
          onOpen();
        }}
      >
        <span className={`t-tile ${req.status === 'approved' ? 'ok' : req.status === 'rejected' ? 'bad' : req.status === 'pending' ? 'accent' : 'mute'}`}>{LEAVE_ICON[req.type]}</span>
        <div className="body">
          <div className="name">
            {req.staffName}
            <StatusBadge status={req.status} />
          </div>
          <div className="when">
            {LEAVE_LABEL[req.type]} · {leaveWhen(req)}
          </div>
          {req.reason && <div className="note">{req.reason}</div>}
          <div className="meta">
            {KIND_LABEL[req.staffKind ?? ''] ?? ''}
            {req.sectionName ? ` · ${req.sectionName}` : ''} · رُفع {relTime(req.createdAt)}
          </div>
        </div>
      </button>
      {decided && (
        <div className={`by ${req.status === 'approved' ? 'ok' : 'bad'}`}>
          {req.status === 'approved' ? <I.check size={16} /> : <I.close size={16} />}
          <span>
            {req.status === 'approved' ? 'وافق عليه' : 'رفضه'} <b>{byName(req.decidedBy)}</b>
            {req.decidedAt ? ` · ${relTime(req.decidedAt)}` : ''}
          </span>
        </div>
      )}
      {req.status === 'pending' && canDecide && (
        <div className="acts">
          <button type="button" className="t-btn plain press" style={{ color: 'var(--bad)' }} disabled={busy} onClick={onOpen}>
            رفض
          </button>
          <button type="button" className="t-btn ok press" disabled={busy} onClick={() => void approve()}>
            {busy ? <span className="spinner" /> : 'موافقة'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ═════════════ إحصاءات الحضور ═════════════ */
/** أربع خانات، كل خانة رابط مباشر إلى قائمتها في صفحة الحضور */
export function AttendStats({ board, active, onPick }: { board: Board; active?: string; onPick?: (f: string) => void }) {
  const c = board.counts;
  const present = c.present ?? c.in + c.break;
  const notYet = c.notYet ?? c.missing + c.soon;
  const absent = c.absent ?? 0;
  const tiles: { f: string; label: string; n: number; tone: string; hot?: boolean }[] = [
    { f: 'in', label: 'الحضور', n: present, tone: 'ok' },
    { f: 'break', label: 'استراحة', n: c.break, tone: c.over ? 'bad' : 'accent', hot: c.over > 0 },
    { f: 'missing', label: 'لم يحضر بعد', n: notYet, tone: notYet ? 'accent' : '' },
    { f: 'absent', label: 'الغياب', n: absent, tone: absent ? 'bad' : '', hot: absent > 0 },
  ];
  return (
    <div className="m-stats">
      {tiles.map(t => {
        const cls = `m-stat press ${t.tone} ${t.hot ? 'hot' : ''} ${active === t.f ? 'on' : ''}`;
        const inner = (
          <>
            <i />
            <b className="num">{t.n}</b>
            {t.label}
            {!onPick && (
              <span className="go">
                <I.chevron size={14} />
              </span>
            )}
          </>
        );
        return onPick ? (
          <button key={t.f} type="button" className={cls} aria-pressed={active === t.f} onClick={() => (haptic('select'), onPick(t.f))}>
            {inner}
          </button>
        ) : (
          <Link key={t.f} to={`/m/attend?f=${t.f}`} className={cls} onClick={() => haptic('tap')}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

function Bell({ unread }: { unread: number }) {
  return (
    <Link to="/m/alerts" className="t-icon-btn t-bell press" aria-label={unread ? `${unread} تبليغ غير مقروء` : 'التبليغات'} onClick={() => haptic('tap')}>
      <I.bell size={20} />
      {unread > 0 && (
        <span key={unread} className="dot num">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

export function MHome({ unread, pending, chatUnread }: { unread: number; pending: number; chatUnread: number }) {
  const nav = useNavigate();
  const me = getManagerMe();
  const perms = usePerms();
  const sup = supervisorMode();
  const overview = useLoad(() => managerApi.overview(), ['leave', 'post']);
  const board = useLoad(() => (perms.viewAttendance ? managerAttendApi.board() : Promise.resolve(null)), ['attend', 'leave'], [perms.viewAttendance]);
  const leave = useLoad(() => (perms.approveLeave ? managerApi.leave('pending') : Promise.resolve([] as LeaveReq[])), ['leave'], [perms.approveLeave]);
  const pull = usePull(async () => {
    await Promise.all([overview.reload(), board.reload(), leave.reload()]);
  });
  const data = overview.data;
  const b = board.data;
  const c = b?.counts;
  const requests = leave.data ?? [];
  const over = (b?.rows ?? []).filter(r => r.status === 'over');
  const offDay = (b?.rows ?? []).filter(r => r.offDay);
  const todo = requests.length + over.length + offDay.length;

  const actions: { to: string; label: string; icon: ReactNode; tone: string; badge?: number; show: boolean }[] = [
    { to: '/m/approvals', label: 'الموافقات', icon: <I.check size={20} />, tone: 'ok', badge: pending, show: !!perms.approveLeave },
    { to: '/m/attend', label: 'لوحة الحضور', icon: <I.clock size={20} />, tone: '', show: !!perms.viewAttendance },
    { to: '/m/notify', label: 'تبليغ سريع', icon: <I.bell size={20} />, tone: 'accent', show: !!perms.sendPosts },
    { to: '/m/posts?new=1', label: 'إعلان جديد', icon: <I.megaphone size={20} />, tone: '', show: !!perms.sendPosts },
    { to: '/m/team', label: 'الفريق والعطل', icon: <I.user size={20} />, tone: 'mute', show: true },
    { to: '/m/reports', label: 'تقارير الحضور', icon: <I.chart size={20} />, tone: 'accent', show: !!perms.viewAttendance },
    { to: '/m/invoices', label: 'الفواتير', icon: <I.receipt size={20} />, tone: '', show: !!perms.viewInvoices },
    { to: '/m/performance', label: 'التحليلات', icon: <I.target size={20} />, tone: 'accent', show: !!perms.viewSales && !sup },
    { to: '/m/managers', label: 'دوام المدراء', icon: <I.calendar size={20} />, tone: 'ok', show: !!perms.viewManagers && !sup },
    { to: sup ? '/chat' : '/m/chat', label: 'المحادثات', icon: <I.chat size={20} />, tone: 'mute', badge: chatUnread, show: true },
  ].filter(a => a.show);

  return (
    <>
      {pull}
      <header className="t-greet">
        <div className="grow">
          <div className="hello">{greet()}</div>
          <div className="who">{me?.displayName || 'المدير'}</div>
        </div>
        <Bell unread={unread} />
      </header>
      <p className="t-date">{iraqToday()}</p>
      <div className="t-page">
        {!sup && <SelfAttendCard />}

        {perms.viewAttendance && (
          <section className="t-section" style={{ marginTop: sup ? 0 : 18 }}>
            <div className="t-section-head">
              <h2>الحضور الآن</h2>
              <Link to="/m/attend" className="more" onClick={() => haptic('tap')}>
                اللوحة كاملة
              </Link>
            </div>
            {board.err && !b ? (
              <ErrorLine text={board.err} onRetry={() => void board.reload()} />
            ) : !b || !c ? (
              <Skeleton h={86} r={18} />
            ) : (
              <>
                <AttendStats board={b} />
                <div className="m-pills">
                  {c.late > 0 && (
                    <Link to="/m/attend?f=late" className="m-pill warn press" onClick={() => haptic('tap')}>
                      <b className="num">{c.late}</b> متأخر اليوم
                    </Link>
                  )}
                  {(c.offDay ?? 0) > 0 && (
                    <Link to="/m/attend?f=offday" className="m-pill warn press" onClick={() => haptic('tap')}>
                      <b className="num">{c.offDay}</b> حضر في عطلته
                    </Link>
                  )}
                  <Link to="/m/attend?f=out" className="m-pill press" onClick={() => haptic('tap')}>
                    <b className="num">{c.out}</b> انصرف
                  </Link>
                  <Link to="/m/attend?f=off" className="m-pill press" onClick={() => haptic('tap')}>
                    <b className="num">{c.off}</b> في عطلة
                  </Link>
                  {(c.notJoined ?? 0) > 0 && (
                    <Link to="/m/attend?f=nojoin" className="m-pill press" onClick={() => haptic('tap')}>
                      <b className="num">{c.notJoined}</b> لم يدخل التطبيق
                    </Link>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {todo > 0 && (
          <section className="t-section">
            <div className="t-section-head">
              <h2>يحتاج انتباهك</h2>
              {requests.length > 3 && (
                <Link to="/m/approvals" className="more" onClick={() => haptic('tap')}>
                  كل الطلبات ({requests.length})
                </Link>
              )}
            </div>
            <div className="m-todo">
              {over.map(r => (
                <Link key={`o${r.staffId}`} to="/m/attend?f=break" className="m-alert press" onClick={() => haptic('tap')}>
                  <span className="t-tile bad">
                    <I.coffee size={19} />
                  </span>
                  <span className="txt">
                    <b>{r.name} تجاوز الاستراحة</b>
                    <small>لم يسجّل عودته بعد — اضغط لفتح سجله</small>
                  </span>
                  <span className="chev">
                    <I.chevron size={18} />
                  </span>
                </Link>
              ))}
              {offDay.map(r => (
                <Link key={`d${r.staffId}`} to="/m/attend?f=offday" className="m-alert press" onClick={() => haptic('tap')}>
                  <span className="t-tile warn">
                    <I.calendar size={19} />
                  </span>
                  <span className="txt">
                    <b>{r.name} حضر في يوم عطلته</b>
                    <small>{REASON_LABEL[r.day?.reason ?? ''] ?? 'عطلة'} — قد يحتاج تبديلاً أو تعويضاً</small>
                  </span>
                  <span className="chev">
                    <I.chevron size={18} />
                  </span>
                </Link>
              ))}
              {requests.slice(0, 3).map(r => (
                <LeaveCard key={r.id} req={r} onOpen={() => nav(`/m/approvals?id=${r.id}`)} onDecided={() => void leave.reload()} />
              ))}
            </div>
          </section>
        )}

        {perms.viewSales && (
          <section className="t-section">
            <SalesHomeCard />
          </section>
        )}

        <section className="t-section">
          <div className="t-section-head">
            <h2>الأقسام</h2>
          </div>
          <div className="m-actions">
            {actions.map(a => (
              <Link key={a.to} to={a.to} className="press" onClick={() => haptic('tap')}>
                <span className={`t-tile ${a.tone}`}>{a.icon}</span>
                {a.label}
                {!!a.badge && <span className="badge num">{a.badge > 9 ? '9+' : a.badge}</span>}
              </Link>
            ))}
          </div>
        </section>

        {overview.err && !data && <ErrorLine text={overview.err} onRetry={() => void overview.reload()} />}
        {overview.loading && !data ? (
          <Skeleton h={120} r={20} mt={18} />
        ) : data ? (
          <>
            <section className="t-section">
              <div className="t-section-head">
                <h2>في إجازة اليوم</h2>
                <small className="num">
                  {data.staffCount - data.offToday.length} من {data.staffCount} مجدولون اليوم
                </small>
              </div>
              {data.offToday.length === 0 && data.partial.length === 0 ? (
                <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
                  الفريق كامل اليوم
                </div>
              ) : (
                <div className="m-names">
                  {data.offToday.map(p => (
                    <span key={p.staffId} className="m-name">
                      {p.name}
                      <small>{REASON_LABEL[p.reason] ?? ''}</small>
                    </span>
                  ))}
                  {data.partial.map(p => (
                    <span key={`p${p.staffId}`} className="m-name">
                      {p.name}
                      <small>
                        استئذان {p.timeFrom}–{p.timeTo}
                      </small>
                    </span>
                  ))}
                </div>
              )}
            </section>

            {data.posts.length > 0 && (
              <section className="t-section">
                <div className="t-section-head">
                  <h2>آخر الإعلانات</h2>
                  <Link to="/m/posts" className="more">
                    الكل
                  </Link>
                </div>
                <div className="t-list">
                  {data.posts.slice(0, 3).map(p => (
                    <Link key={p.id} to="/m/posts" className="t-row press-soft">
                      <span className={`t-tile ${POST_KIND[p.kind]?.tone ?? ''}`}>
                        <I.megaphone size={18} />
                      </span>
                      <div className="body">
                        <div className="title">{p.title}</div>
                        <div className="t-stat-line" style={{ marginTop: 6 }}>
                          <Track value={p.targetCount ? ((p.readCount ?? 0) / p.targetCount) * 100 : 0} tone="ok" />
                          <span className="num">
                            {p.requiresAck ? `أكّد ${p.ackCount ?? 0}` : `قرأ ${p.readCount ?? 0}`}/{p.targetCount}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
