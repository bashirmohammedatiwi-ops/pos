import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MANAGER_URL } from '../../config';
import { Avatar, Badge, Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, Switch, Track, greet, iraqToday, toast, usePull } from '../kit';
import { getThemePref, haptic, hapticsOn, setHapticsOn, setThemePref, type ThemePref } from '../native';
import { BackBtn, ImagePicker, LEAVE_ICON, Lightbox, PostCard, StatusBadge } from '../parts';
import { Alerts } from '../screens/Alerts';
import { ChatList, ChatRoom } from '../screens/Chat';
import { AttendSummary, MAttend, MNetworks } from './ManagerAttend';
import { MReports } from './ManagerReports';
import {
  LEAVE_LABEL,
  POST_KIND,
  WEEK_DAYS,
  clearManager,
  getManagerMe,
  getManagerToken,
  leaveWhen,
  managerApi,
  mediaUrl,
  onLive,
  relTime,
  shortDay,
  ALL_PERMS,
  PermsProvider,
  usePerms,
  useChatUnread,
  useLiveChannel,
  useLoad,
  useUnread,
  type Audience,
  type DirStaff,
  type LeaveReq,
  type ManagerPerms,
  type Post,
} from '../work';
import { KIND_LABEL, registerPush, unregisterPush } from '../../team';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق المدير داخل «ديما · الفريق» — بنفس الهوية:
 * لوحة اليوم، الموافقات، الإعلانات بالصور، الفريق والعطل، إرسال التبليغات.
 * التحليلات التفصيلية تبقى في «التحليلات الكاملة».
 * ───────────────────────────────────────────────────────────────────────────── */

const REASON_LABEL: Record<string, string> = { weekly: 'عطلة أسبوعية', swap: 'تبديل', day: 'إجازة', sick: 'مرضية', urgent: 'طارئة' };

function useScrollMemory() {
  const loc = useLocation();
  const saved = useRef(new Map<string, number>());
  const prev = useRef(loc.pathname);
  useLayoutEffect(() => {
    if (prev.current === loc.pathname) return;
    saved.current.set(prev.current, window.scrollY);
    prev.current = loc.pathname;
    window.scrollTo(0, saved.current.get(loc.pathname) ?? 0);
  }, [loc.pathname]);
}

function Bell({ unread }: { unread: number }) {
  return (
    <Link to="/m/alerts" className="t-icon-btn t-bell press" aria-label="التبليغات" onClick={() => haptic('tap')}>
      <I.bell size={20} />
      {unread > 0 && (
        <span key={unread} className="dot num">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

/* ═════════════ الهيكل ═════════════ */
export function ManagerApp() {
  const nav = useNavigate();
  useLiveChannel('manager');
  useScrollMemory();
  const unread = useUnread('manager');
  const [pending, setPending] = useState(0);
  // صلاحيات المدير من الخادم (تتحدث فوراً عند تعديلها من لوحة التحكم)
  const meQ = useLoad(() => managerApi.me(), ['perms']);
  const perms: ManagerPerms = meQ.data?.perms ?? ALL_PERMS;

  useEffect(() => {
    const load = () =>
      managerApi
        .leave('pending')
        .then(r => setPending(r.length))
        .catch(e => {
          const st = (e as { status?: number }).status;
          if (st === 401) logout();
          if (st === 403) setPending(0);
        });
    void load();
    // إشعارات الهاتف للمدير؛ الضغط على الإشعار يفتح صفحته داخل نافذة المدير
    void registerPush('manager', getManagerToken(), link => nav(link.startsWith('/m') ? link : `/m${link === '/' ? '' : link}`));
    return onLive(m => {
      if (m.event === 'leave') void load();
      if (m.event === 'notify' && m.data.item) {
        haptic('warning');
        toast(m.data.item.title);
      }
      // رسالة جديدة خارج غرفتها
      if (m.event === 'chat' && m.data.message && m.data.message.sender.key !== `manager:${getManagerMe()?.id}` && locRef.current !== `/m/chat/${m.data.convId}`) {
        haptic('tap');
        toast(`💬 ${m.data.message.sender.name}: ${m.data.message.body || 'صورة'}`);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function logout() {
    void unregisterPush('manager', getManagerToken());
    clearManager();
    nav('/login?as=manager', { replace: true });
  }

  const chatUnread = useChatUnread('manager');
  const tabs: { to: string; label: string; icon: (p: { filled?: boolean }) => ReactNode; badge?: number }[] = [
    { to: '/m', label: 'الرئيسية', icon: p => <I.home {...p} /> },
    ...(perms.viewAttendance ? [{ to: '/m/attend', label: 'الحضور', icon: (p: { filled?: boolean }) => <I.clock {...p} /> }] : []),
    ...(perms.approveLeave ? [{ to: '/m/approvals', label: 'الموافقات', icon: (p: { filled?: boolean }) => <I.calendar {...p} />, badge: pending }] : []),
    { to: '/m/chat', label: 'المحادثات', icon: p => <I.chat {...p} />, badge: chatUnread },
    { to: '/m/more', label: 'المزيد', icon: () => <MoreIcon />, badge: unread },
  ];
  const loc = useLocation();
  const locRef = useRef(loc.pathname);
  locRef.current = loc.pathname;
  const MORE_PAGES = ['/m/alerts', '/m/notify', '/m/posts', '/m/team', '/m/networks', '/m/reports'];

  return (
    <PermsProvider value={perms}>
    <div className="t-app">
      <Routes>
        <Route index element={<MHome unread={unread} pending={pending} />} />
        <Route path="attend" element={<MAttend />} />
        <Route path="approvals" element={<MApprovals />} />
        <Route path="posts" element={<MPosts />} />
        <Route path="team" element={<MTeam />} />
        <Route path="networks" element={<MNetworks />} />
        <Route path="reports" element={<MReports />} />
        <Route path="chat" element={<ChatList role="manager" base="/m/chat" canGroup={perms.manageChat} />} />
        <Route path="chat/:id" element={<ChatRoom role="manager" base="/m/chat" />} />
        <Route path="more" element={<MMore unread={unread} onLogout={logout} />} />
        <Route path="alerts" element={<Alerts role="manager" back="/m/more" />} />
        <Route path="notify" element={<MNotify />} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Routes>
      <nav className="t-tabs" aria-label="التنقل">
        {tabs.map(t => {
          const on = t.to === '/m' ? loc.pathname === '/m' || loc.pathname === '/m/' : loc.pathname.startsWith(t.to) || (t.to === '/m/more' && MORE_PAGES.some(x => loc.pathname.startsWith(x)));
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/m'}
              className={`t-tab ${on ? 'on' : ''}`}
              onClick={() => {
                if (on) window.scrollTo({ top: 0, behavior: 'smooth' });
                else haptic('select');
              }}
            >
              <span className="ico">
                {t.icon({ filled: on })}
                {!!t.badge && <span className="dot num">{t.badge > 9 ? '9+' : t.badge}</span>}
              </span>
              {t.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
    </PermsProvider>
  );
}

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
    </svg>
  );
}

/* ═════════════ الرئيسية ═════════════ */
function MHome({ unread, pending }: { unread: number; pending: number }) {
  const me = getManagerMe();
  const { data, err, loading, reload } = useLoad(() => managerApi.overview(), ['leave', 'post']);
  const pull = usePull(reload);
  const perms = usePerms();
  const working = data ? data.staffCount - data.offToday.length : 0;

  return (
    <>
      {pull}
      <header className="t-greet">
        <Avatar name={me?.displayName} />
        <div className="grow">
          <div className="hello">{greet()}</div>
          <div className="who">{me?.displayName || 'المدير'}</div>
        </div>
        <Bell unread={unread} />
      </header>
      <p className="t-date">{iraqToday()} · لوحة الفريق</p>
      <div className="t-page">
        {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
        {loading && !data ? (
          <Skeleton h={160} r={26} />
        ) : data ? (
          <>
            <section className="t-hero">
              <p className="kicker">الفريق اليوم · {data.weekday}</p>
              <div className="amount">
                <span className="num">{working}</span>
                <small>في الدوام من {data.staffCount}</small>
              </div>
              <div className="meta">
                <span>
                  <b className="num">{data.offToday.length}</b> في عطلة أو إجازة
                </span>
                {data.partial.length > 0 && (
                  <span>
                    <b className="num">{data.partial.length}</b> استئذان
                  </span>
                )}
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="t-track" style={{ background: 'rgba(255,255,255,.18)' }}>
                  <i style={{ width: `${data.staffCount ? (working / data.staffCount) * 100 : 0}%`, background: '#F0B04F' }} />
                </div>
              </div>
            </section>

            {perms.viewAttendance && <AttendSummary />}

            <div className="t-kpis" style={{ marginTop: 14 }}>
              {perms.approveLeave && (
                <Link to="/m/approvals" className={`t-kpi press ${pending ? 'alert' : ''}`}>
                  <span>طلبات بانتظارك</span>
                  <b className="num">{pending}</b>
                </Link>
              )}
              <Link to="/m/team" className="t-kpi press">
                <span>هواتف مربوطة</span>
                <b className="num">
                  {data.devices}
                  <small style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}> / {data.staffCount}</small>
                </b>
              </Link>
            </div>

            <section className="t-section">
              <div className="t-section-head">
                <h2>غائبون اليوم</h2>
                <small>{data.offToday.length ? `${data.offToday.length} موظف` : ''}</small>
              </div>
              {data.offToday.length === 0 && data.partial.length === 0 ? (
                <div className="t-card pad" style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
                  الفريق كامل اليوم 👌
                </div>
              ) : (
                <div className="t-people">
                  {data.offToday.map(p => (
                    <span key={p.staffId} className="t-person">
                      <Avatar name={p.name} size="sm" />
                      {p.name.split(' ')[0]}
                      <small>{REASON_LABEL[p.reason] ?? ''}</small>
                    </span>
                  ))}
                  {data.partial.map(p => (
                    <span key={`p${p.staffId}`} className="t-person">
                      <Avatar name={p.name} size="sm" />
                      {p.name.split(' ')[0]}
                      <small>
                        استئذان {p.timeFrom}–{p.timeTo}
                      </small>
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="t-section">
              <div className="t-section-head">
                <h2>إجراءات سريعة</h2>
              </div>
              <div className="t-quick">
                {perms.sendPosts && (
                  <Link to="/m/posts?new=1" className="press">
                    <span className="t-tile">
                      <I.megaphone size={20} />
                    </span>
                    إعلان جديد
                  </Link>
                )}
                {perms.sendPosts && (
                  <Link to="/m/notify" className="press">
                    <span className="t-tile accent">
                      <I.bell size={20} />
                    </span>
                    تبليغ سريع
                  </Link>
                )}
                {perms.approveLeave && (
                  <Link to="/m/approvals" className="press">
                    <span className="t-tile ok">
                      <I.check size={20} />
                    </span>
                    الموافقات
                  </Link>
                )}
                <Link to="/m/team" className="press">
                  <span className="t-tile mute">
                    <I.user size={20} />
                  </span>
                  الفريق
                </Link>
                <a href={MANAGER_URL} className="press">
                  <span className="t-tile mute">
                    <I.sparkle size={20} />
                  </span>
                  التحليلات
                </a>
              </div>
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
                  {data.posts.slice(0, 4).map(p => (
                    <Link key={p.id} to="/m/posts" className="t-row press-soft">
                      <span className={`t-tile ${POST_KIND[p.kind]?.tone ?? ''}`}>
                        <I.megaphone size={18} />
                      </span>
                      <div className="body">
                        <div className="title">{p.title}</div>
                        <div className="t-stat-line" style={{ marginTop: 6 }}>
                          <Track value={p.targetCount ? ((p.readCount ?? 0) / p.targetCount) * 100 : 0} tone="ok" />
                          <span className="num">
                            {p.readCount}/{p.targetCount}
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

/* ═════════════ الموافقات ═════════════ */
type LeaveFilter = 'pending' | 'approved' | 'rejected' | 'all';

function MApprovals() {
  const [filter, setFilter] = useState<LeaveFilter>('pending');
  const { data, err, loading, reload } = useLoad(() => managerApi.leave(filter), ['leave'], [filter]);
  const [open, setOpen] = useState<LeaveReq | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'reject'>('');
  const [viewer, setViewer] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const deep = Number(params.get('id') || 0);
  useEffect(() => {
    if (!deep || !data) return;
    const r = data.find(x => x.id === deep);
    if (r) {
      setOpen(r);
      setNote('');
    } else if (filter !== 'all') setFilter('all');
    const next = new URLSearchParams(params);
    if (r) {
      next.delete('id');
      setParams(next, { replace: true });
    }
  }, [deep, data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(approve: boolean) {
    if (!open) return;
    setBusy(approve ? 'approve' : 'reject');
    try {
      await managerApi.decide(open.id, approve, note.trim() || undefined);
      haptic('success');
      toast(approve ? `وافقت على طلب ${open.staffName.split(' ')[0]}` : 'رُفض الطلب — وصل الرد للموظف');
      setOpen(null);
      void reload();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen title="الموافقات" subtitle="طلبات الإجازة والتبديل والاستئذان" onRefresh={reload}>
      <Segmented
        items={[
          { id: 'pending', label: 'معلّقة' },
          { id: 'approved', label: 'مقبولة' },
          { id: 'rejected', label: 'مرفوضة' },
          { id: 'all', label: 'الكل' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <div style={{ marginTop: 14 }}>
        {err && <ErrorLine text={err} onRetry={() => void reload()} />}
        {loading && !data ? (
          <Skeleton h={260} r={20} />
        ) : !data?.length ? (
          <Empty icon={<I.check size={30} />} title={filter === 'pending' ? 'لا طلبات بانتظارك' : 'لا طلبات هنا'} text={filter === 'pending' ? 'عندما يرفع موظف طلباً يصلك تبليغ فوراً.' : undefined} />
        ) : (
          <div className="t-list">
            {data.map(r => (
              <button
                key={r.id}
                type="button"
                className="t-req press-soft"
                onClick={() => {
                  haptic('tap');
                  setNote('');
                  setOpen(r);
                }}
              >
                <Avatar name={r.staffName} />
                <div className="body">
                  <div className="title">
                    {r.staffName}
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="when">
                    {LEAVE_LABEL[r.type]} · {leaveWhen(r)}
                  </div>
                  {r.reason && <div className="note">{r.reason}</div>}
                  <div className="who">
                    {KIND_LABEL[r.staffKind ?? ''] ?? ''}
                    {r.sectionName ? ` · ${r.sectionName}` : ''} · {relTime(r.createdAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${LEAVE_LABEL[open.type]} — ${open.staffName}` : ''} subtitle={open ? leaveWhen(open) : ''}>
        {open && (
          <div className="t-form">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="t-tile accent">{LEAVE_ICON[open.type]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 650 }}>{KIND_LABEL[open.staffKind ?? ''] ?? 'موظف'}{open.sectionName ? ` · ${open.sectionName}` : ''}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>رُفع {relTime(open.createdAt)}</div>
              </div>
              <StatusBadge status={open.status} />
            </div>
            {open.reason && (
              <div className="t-card pad" style={{ lineHeight: 1.7 }}>
                {open.reason}
              </div>
            )}
            {open.attachment && (
              <button type="button" className="t-card press" style={{ overflow: 'hidden', padding: 0 }} onClick={() => setViewer(open.attachment!)}>
                <img src={mediaUrl(open.attachment)} alt="التقرير المرفق" style={{ width: '100%', maxHeight: 220, objectFit: 'cover' }} />
              </button>
            )}
            {open.status === 'pending' ? (
              <>
                <label className="t-field">
                  <span>ملاحظة للموظف (اختياري)</span>
                  <textarea className="t-textarea" style={{ minHeight: 70 }} maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
                </label>
                <div className="t-row-2">
                  <button type="button" className="t-btn plain press" style={{ color: 'var(--bad)' }} disabled={!!busy} onClick={() => void decide(false)}>
                    {busy === 'reject' ? <span className="spinner" style={{ borderTopColor: 'var(--bad)' }} /> : 'رفض'}
                  </button>
                  <button type="button" className="t-btn ok press" disabled={!!busy} onClick={() => void decide(true)}>
                    {busy === 'approve' ? <span className="spinner" /> : 'موافقة'}
                  </button>
                </div>
              </>
            ) : (
              open.decidedAt && (
                <div className="t-card pad">
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {open.status === 'approved' ? 'وافق' : open.status === 'rejected' ? 'رفض' : 'أُلغي'} {open.decidedBy?.replace(/^manager:/, '') ?? ''} · {relTime(open.decidedAt)}
                  </div>
                  {open.decidedNote && <div style={{ marginTop: 4 }}>{open.decidedNote}</div>}
                </div>
              )
            )}
          </div>
        )}
      </Sheet>
      {viewer && <Lightbox images={[viewer]} start={0} onClose={() => setViewer(null)} />}
    </Screen>
  );
}

/* ═════════════ اختيار الجمهور ═════════════ */
function AudiencePicker({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  const dir = useLoad(() => managerApi.directory());
  const [pick, setPick] = useState(false);
  const kinds = value.kinds ?? [];
  const staff = value.staff ?? [];
  const all = !!value.all || (!kinds.length && !staff.length);
  const toggleKind = (k: string) => {
    haptic('select');
    const next = kinds.includes(k) ? kinds.filter(x => x !== k) : [...kinds, k];
    onChange(next.length || staff.length ? { kinds: next, staff } : { all: true });
  };
  const counts = useMemo(() => {
    const rows = (dir.data ?? []).filter(s => s.isActive);
    const n = all ? rows.length : rows.filter(s => kinds.includes(s.kind) || staff.includes(s.id)).length;
    return { n, total: rows.length };
  }, [dir.data, all, kinds, staff]);

  return (
    <div className="t-field">
      <span>
        الجمهور · <b className="num">{counts.n}</b> موظف
      </span>
      <div className="t-chips">
        <button type="button" className={`t-chip press ${all ? 'on' : ''}`} onClick={() => onChange({ all: true })}>
          الكل
        </button>
        {(
          [
            ['seller', 'البائعون'],
            ['cashier', 'الكاشيرية'],
            ['supervisor', 'المشرفون'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={`t-chip press ${!all && kinds.includes(k) ? 'on' : ''}`} onClick={() => toggleKind(k)}>
            {label}
          </button>
        ))}
        <button type="button" className={`t-chip press ${staff.length ? 'on' : ''}`} onClick={() => setPick(true)}>
          <I.user size={16} /> {staff.length ? `${staff.length} محدد` : 'موظفون محددون'}
        </button>
      </div>
      <Sheet open={pick} onClose={() => setPick(false)} title="اختر الموظفين" subtitle="يضافون إلى الفئات المختارة">
        {dir.data?.filter(s => s.isActive).map(s => {
          const on = staff.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`t-check ${on ? 'on' : ''}`}
              onClick={() => {
                haptic('select');
                const next = on ? staff.filter(x => x !== s.id) : [...staff, s.id];
                onChange(next.length || kinds.length ? { kinds, staff: next } : { all: true });
              }}
            >
              <span className="box">{on && <I.check size={14} />}</span>
              <Avatar name={s.name} size="sm" />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontWeight: 600 }}>{s.name}</b>
                <small style={{ color: 'var(--ink-3)' }}>
                  {KIND_LABEL[s.kind] ?? s.kind}
                  {s.sectionName ? ` · ${s.sectionName}` : ''}
                </small>
              </span>
            </button>
          );
        })}
        <button type="button" className="t-btn block press" style={{ marginTop: 12 }} onClick={() => setPick(false)}>
          تم
        </button>
      </Sheet>
    </div>
  );
}

/* ═════════════ الإعلانات ═════════════ */
function MPosts() {
  const perms = usePerms();
  const { data, err, loading, reload } = useLoad(() => managerApi.posts(), ['post']);
  const [compose, setCompose] = useState<Post | 'new' | null>(null);
  const [stats, setStats] = useState<Post | null>(null);
  const [viewer, setViewer] = useState<{ images: string[]; i: number } | null>(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get('new') !== '1') return;
    setCompose('new');
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title="الإعلانات" subtitle="أخبار وعروض وتعليمات للفريق — بالصور" onRefresh={reload}>
      {err && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={300} r={26} />
      ) : !data?.length ? (
        <Empty
          icon={<I.megaphone size={30} />}
          title="لا إعلانات بعد"
          text="انشر عرضاً جديداً أو تعليمات للفريق، مع الصور وتأكيد الاطلاع."
          action={
            <button type="button" className="t-btn sm press" style={{ marginTop: 8 }} onClick={() => setCompose('new')}>
              إعلان جديد
            </button>
          }
        />
      ) : (
        data.map(p => (
          <PostCard
            key={p.id}
            post={p}
            onOpen={() => {
              haptic('tap');
              setStats(p);
            }}
            onImage={i => setViewer({ images: p.images, i })}
            footer={
              <div className="t-post-foot" style={{ display: 'block' }}>
                <div className="t-stat-line" style={{ marginTop: 0 }}>
                  <span>قرأه</span>
                  <Track value={p.targetCount ? ((p.readCount ?? 0) / p.targetCount) * 100 : 0} tone="ok" />
                  <span className="num">
                    {p.readCount}/{p.targetCount}
                  </span>
                </div>
                {p.requiresAck && (
                  <div className="t-stat-line">
                    <span>أكّد</span>
                    <Track value={p.targetCount ? ((p.ackCount ?? 0) / p.targetCount) * 100 : 0} tone="accent" />
                    <span className="num">
                      {p.ackCount}/{p.targetCount}
                    </span>
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {p.audienceLabel}
                  {p.expired ? ' · منتهي' : ''}
                </div>
              </div>
            }
          />
        ))
      )}
      <div style={{ height: 70 }} />
      {perms.sendPosts && (
      <button
        type="button"
        className="t-fab press"
        onClick={() => {
          haptic('tap');
          setCompose('new');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        إعلان جديد
      </button>
      )}

      <PostComposer
        open={!!compose}
        post={compose === 'new' ? null : compose}
        onClose={() => setCompose(null)}
        onSaved={() => {
          setCompose(null);
          void reload();
        }}
      />
      <PostStats
        post={stats}
        onClose={() => setStats(null)}
        onEdit={p => {
          setStats(null);
          setCompose(p);
        }}
        onDeleted={() => {
          setStats(null);
          void reload();
        }}
      />
      {viewer && <Lightbox images={viewer.images} start={viewer.i} onClose={() => setViewer(null)} />}
    </Screen>
  );
}

function PostComposer({ open, post, onClose, onSaved }: { open: boolean; post: Post | null; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState('news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>({ all: true });
  const [pinned, setPinned] = useState(false);
  const [ack, setAck] = useState(false);
  const [notify, setNotify] = useState(true);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setKind(post?.kind ?? 'news');
    setTitle(post?.title ?? '');
    setBody(post?.body ?? '');
    setImages(post?.images ?? []);
    setAudience((post as unknown as { audience?: Audience })?.audience ?? { all: true });
    setPinned(post?.pinned ?? false);
    setAck(post?.requiresAck ?? false);
    setNotify(true);
    setExpires(post?.expiresAt ? post.expiresAt.slice(0, 10) : '');
    setErr('');
  }, [open, post]);

  async function save() {
    if (!title.trim()) return setErr('اكتب عنوان الإعلان');
    setBusy(true);
    setErr('');
    try {
      await managerApi.savePost(
        { kind, title: title.trim(), body: body.trim(), images, audience, pinned, requiresAck: ack, notify, expiresAt: expires ? `${expires}T23:59:00+03:00` : null },
        post?.id,
      );
      haptic('success');
      toast(post ? 'حُفظ الإعلان' : 'نُشر الإعلان ووصل للفريق');
      onSaved();
    } catch (e) {
      haptic('error');
      setErr(e instanceof Error ? e.message : 'تعذر النشر');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={post ? 'تعديل الإعلان' : 'إعلان جديد'} subtitle="يظهر في تطبيق الموظفين مع تبليغ فوري">
      <div className="t-form">
        <div className="t-chips">
          {Object.entries(POST_KIND).map(([k, v]) => (
            <button
              key={k}
              type="button"
              className={`t-chip press ${kind === k ? 'on' : ''}`}
              onClick={() => {
                haptic('select');
                setKind(k);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="t-field">
          <span>العنوان</span>
          <input className="t-input sm" maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: عرض نهاية الأسبوع على GR/GI" />
        </label>
        <label className="t-field">
          <span>التفاصيل</span>
          <textarea className="t-textarea" maxLength={6000} value={body} onChange={e => setBody(e.target.value)} />
        </label>
        <div className="t-field">
          <span>الصور (حتى 6)</span>
          <ImagePicker value={images} onChange={setImages} upload={managerApi.upload} max={6} />
        </div>
        <AudiencePicker value={audience} onChange={setAudience} />
        <div className="t-card" style={{ padding: '4px 14px' }}>
          <div className="t-check" style={{ cursor: 'default' }}>
            <span style={{ flex: 1 }}>تثبيت أعلى القائمة</span>
            <Switch label="تثبيت" on={pinned} onChange={setPinned} />
          </div>
          <div className="t-check" style={{ cursor: 'default' }}>
            <span style={{ flex: 1 }}>يتطلب تأكيد «اطّلعت»</span>
            <Switch label="تأكيد الاطلاع" on={ack} onChange={setAck} />
          </div>
          {!post && (
            <div className="t-check" style={{ cursor: 'default' }}>
              <span style={{ flex: 1 }}>إرسال تبليغ للجمهور</span>
              <Switch label="تبليغ" on={notify} onChange={setNotify} />
            </div>
          )}
        </div>
        <label className="t-field">
          <span>ينتهي العرض في (اختياري)</span>
          <input className="t-input sm" type="date" value={expires} onChange={e => setExpires(e.target.value)} />
        </label>
        {err && (
          <p className="t-hint bad" role="alert" style={{ marginTop: -6 }}>
            {err}
          </p>
        )}
        <button type="button" className="t-btn block press" disabled={busy} onClick={() => void save()}>
          {busy ? <span className="spinner" /> : post ? 'حفظ التعديل' : 'نشر الإعلان'}
        </button>
      </div>
    </Sheet>
  );
}

function PostStats({ post, onClose, onEdit, onDeleted }: { post: Post | null; onClose: () => void; onEdit: (p: Post) => void; onDeleted: () => void }) {
  const [rows, setRows] = useState<{ staffId: number; name: string; kind: string; readAt?: string | null; ackAt?: string | null }[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setRows(null);
    setConfirm(false);
    if (post) void managerApi.readers(post.id).then(setRows).catch(() => setRows([]));
  }, [post]);

  async function remove() {
    if (!post) return;
    try {
      await managerApi.deletePost(post.id);
      haptic('success');
      toast('حُذف الإعلان');
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }

  const read = rows?.filter(r => r.readAt).length ?? 0;
  return (
    <Sheet open={!!post} onClose={onClose} title={post?.title} subtitle={post ? `${post.audienceLabel ?? ''} · قرأه ${read}/${rows?.length ?? '…'}` : ''}>
      {post && (
        <>
          <div className="t-row-2" style={{ marginBottom: 14 }}>
            <button type="button" className="t-btn soft sm press" onClick={() => onEdit(post)}>
              تعديل
            </button>
            {confirm ? (
              <button type="button" className="t-btn danger sm press" onClick={() => void remove()}>
                تأكيد الحذف
              </button>
            ) : (
              <button type="button" className="t-btn plain sm press" style={{ color: 'var(--bad)' }} onClick={() => setConfirm(true)}>
                حذف
              </button>
            )}
          </div>
          {!rows ? (
            <Skeleton h={200} r={18} />
          ) : (
            <div className="t-list flat">
              {rows.map(r => (
                <div key={r.staffId} className="t-row">
                  <Avatar name={r.name} size="sm" />
                  <div className="body">
                    <div className="title">{r.name}</div>
                    <div className="sub">{KIND_LABEL[r.kind] ?? r.kind}</div>
                  </div>
                  {r.ackAt ? <Badge tone="ok">أكّد ✓</Badge> : r.readAt ? <Badge>قرأ {relTime(r.readAt)}</Badge> : <Badge tone="mute">لم يقرأ</Badge>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ═════════════ الفريق والعطل ═════════════ */
function MTeam() {
  const { data, err, loading, reload } = useLoad(() => managerApi.directory(), ['leave']);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<DirStaff | null>(null);
  const list = useMemo(() => {
    const n = q.trim();
    const rows = (data ?? []).filter(s => s.isActive);
    return n ? rows.filter(s => s.name.includes(n) || s.code.includes(n) || (s.sectionName ?? '').includes(n)) : rows;
  }, [data, q]);
  const noOff = (data ?? []).filter(s => s.isActive && !s.weeklyOff).length;

  return (
    <Screen title="الفريق" subtitle={data ? `${list.length} موظف${noOff ? ` · ${noOff} بلا عطلة محددة` : ''}` : 'الموظفون وعطلهم'} onRefresh={reload}>
      <label className="t-search" style={{ marginBottom: 12 }}>
        <I.search />
        <input placeholder="ابحث بالاسم أو الكود أو القسم" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {err && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={300} r={20} />
      ) : (
        <div className="t-list">
          {list.map(s => (
            <button
              key={s.id}
              type="button"
              className="t-row press-soft"
              onClick={() => {
                haptic('tap');
                setOpen(s);
              }}
            >
              <Avatar name={s.name} size="sm" />
              <div className="body">
                <div className="title">{s.name}</div>
                <div className="sub">
                  {KIND_LABEL[s.kind] ?? s.kind}
                  {s.sectionName ? ` · ${s.sectionName}` : ''} · {s.lastSeen ? `نشط ${relTime(s.lastSeen)}` : 'لم يدخل التطبيق'}
                </div>
              </div>
              <div className="t-mini-off" aria-label="العطلة الأسبوعية">
                {WEEK_DAYS.map((d, i) => (
                  <i key={d} className={(s.weeklyOff >> i) & 1 ? 'on' : ''} title={d} />
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
      <StaffSheet
        staff={open}
        onClose={() => setOpen(null)}
        onSaved={mask => {
          setOpen(o => (o ? { ...o, weeklyOff: mask } : o));
          void reload();
        }}
      />
    </Screen>
  );
}

function StaffSheet({ staff, onClose, onSaved }: { staff: DirStaff | null; onClose: () => void; onSaved: (mask: number) => void }) {
  const perms = usePerms();
  const [mask, setMask] = useState(0);
  const [busy, setBusy] = useState(false);
  const sched = useLoad(() => (staff ? managerApi.schedule(staff.id) : Promise.resolve(null)), ['leave'], [staff?.id]);
  useEffect(() => setMask(staff?.weeklyOff ?? 0), [staff]);

  async function save() {
    if (!staff) return;
    setBusy(true);
    try {
      await managerApi.setWeeklyOff(staff.id, mask);
      haptic('success');
      toast('حُفظت العطلة — وصل التبليغ للموظف');
      onSaved(mask);
      void sched.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  return (
    <Sheet
      open={!!staff}
      onClose={onClose}
      title={staff?.name}
      subtitle={staff ? `${KIND_LABEL[staff.kind] ?? staff.kind}${staff.sectionName ? ` · ${staff.sectionName}` : ''} · كود ${staff.code}` : ''}
    >
      {staff && (
        <div className="t-form">
          <div className="t-field">
            <span>العطلة الأسبوعية</span>
            <div className="t-days-pick">
              {WEEK_DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className={(mask >> i) & 1 ? 'on' : ''}
                  onClick={() => {
                    haptic('select');
                    setMask(m => m ^ (1 << i));
                  }}
                >
                  <b>{shortDay(d)}</b>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="t-btn block press" disabled={busy || mask === staff.weeklyOff || !perms.approveLeave} onClick={() => void save()}>
            {busy ? <span className="spinner" /> : 'حفظ العطلة'}
          </button>

          <div className="t-field">
            <span>الأسابيع الأربعة القادمة</span>
            {!sched.data ? (
              <Skeleton h={200} r={16} />
            ) : (
              <div className="t-cal">
                {sched.data.days.map(d => (
                  <div
                    key={d.date}
                    className={`t-day ${d.date === today ? 'today' : ''} ${d.off ? (d.reason === 'sick' ? 'sick' : d.reason === 'day' || d.reason === 'urgent' ? 'leave' : 'off') : ''} ${d.reason === 'hours' ? 'hours' : ''}`}
                  >
                    <small>{shortDay(d.weekday)}</small>
                    <span className="num">{Number(d.date.slice(8))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="t-list flat">
            <div className="t-row">
              <span className="t-tile mute">
                <I.phone size={18} />
              </span>
              <div className="body">
                <div className="title">{staff.device || 'لم يربط هاتفاً بعد'}</div>
                <div className="sub">{staff.lastSeen ? `آخر نشاط ${relTime(staff.lastSeen)}` : 'يُربط الحساب بأول هاتف يدخل منه'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ═════════════ إرسال تبليغ ═════════════ */
function MNotify() {
  const log = useLoad(() => managerApi.notifyLog());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>({ all: true });
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!title.trim()) return toast('اكتب عنوان التبليغ');
    setBusy(true);
    try {
      const r = await managerApi.notify({ title: title.trim(), body: body.trim() || undefined, image: image[0] ?? null, audience });
      haptic('success');
      toast(`وصل التبليغ إلى ${r.count} موظف`);
      setTitle('');
      setBody('');
      setImage([]);
      void log.reload();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر الإرسال');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="تبليغ سريع" subtitle="رسالة فورية تصل لهواتف الفريق" start={<BackBtn to="/m/more" />}>
      <section className="t-card pad">
        <div className="t-form">
          <label className="t-field">
            <span>العنوان</span>
            <input className="t-input sm" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: اجتماع الساعة 9 صباحاً" />
          </label>
          <label className="t-field">
            <span>النص (اختياري)</span>
            <textarea className="t-textarea" style={{ minHeight: 80 }} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} />
          </label>
          <div className="t-field">
            <span>صورة (اختياري)</span>
            <ImagePicker value={image} onChange={setImage} upload={managerApi.upload} max={1} />
          </div>
          <AudiencePicker value={audience} onChange={setAudience} />
          <button type="button" className="t-btn block press" disabled={busy} onClick={() => void send()}>
            {busy ? <span className="spinner" /> : 'إرسال الآن'}
          </button>
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>المُرسَل سابقاً</h2>
        </div>
        {!log.data ? (
          <Skeleton h={160} r={20} />
        ) : !log.data.length ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13.5 }}>لم تُرسل تبليغات بعد.</p>
        ) : (
          <div className="t-list">
            {log.data.map(b => (
              <div key={b.id} className="t-row">
                <span className="t-tile accent">
                  <I.bell size={18} />
                </span>
                <div className="body">
                  <div className="title">{b.title}</div>
                  <div className="sub">
                    {b.audienceLabel} · {relTime(b.createdAt)} · {b.createdBy?.replace(/^manager:/, '')}
                  </div>
                  <div className="t-stat-line">
                    <Track value={b.targetCount ? (b.readCount / b.targetCount) * 100 : 0} tone="ok" />
                    <span className="num">
                      {b.readCount}/{b.targetCount}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </Screen>
  );
}

/* ═════════════ المزيد ═════════════ */
function MMore({ unread, onLogout }: { unread: number; onLogout: () => void }) {
  const perms = usePerms();
  const me = getManagerMe();
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [vib, setVib] = useState(hapticsOn);
  const [askOut, setAskOut] = useState(false);
  return (
    <Screen title="المزيد">
      <section className="t-card pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={me?.displayName} />
        <div>
          <div style={{ fontSize: 16.5, fontWeight: 700 }}>{me?.displayName || 'المدير'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }} className="ltr">
            @{me?.username}
          </div>
        </div>
      </section>

      <section className="t-section">
        <div className="t-menu">
          <Link to="/m/alerts" className="press" onClick={() => haptic('tap')}>
            <span className="t-tile lg">
              <I.bell size={22} />
            </span>
            التبليغات
            {unread > 0 && <span className="badge num">{unread > 9 ? '9+' : unread}</span>}
          </Link>
          {perms.sendPosts && (
          <Link to="/m/notify" className="press" onClick={() => haptic('tap')}>
            <span className="t-tile lg accent">
              <I.megaphone size={22} />
            </span>
            تبليغ سريع
          </Link>
          )}
          <Link to="/m/posts" className="press" onClick={() => haptic('tap')}>
            <span className="t-tile lg ok">
              <I.megaphone size={22} />
            </span>
            الإعلانات
          </Link>
          <Link to="/m/team" className="press" onClick={() => haptic('tap')}>
            <span className="t-tile lg">
              <I.user size={22} />
            </span>
            الفريق والعطل
          </Link>
          {perms.viewAttendance && (
          <Link to="/m/reports" className="press" onClick={() => haptic('tap')}>
            <span className="t-tile lg accent">
              <I.chart size={22} />
            </span>
            تقارير الحضور والأوفر تايم
          </Link>
          )}
          {perms.viewAttendance && (
          <Link to="/m/networks" className="press" onClick={() => haptic('tap')}>
            <span className="t-tile lg mute">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0" />
                <circle cx="12" cy="19.3" r="1.2" fill="currentColor" />
              </svg>
            </span>
            شبكات المحل
          </Link>
          )}
          <a href={MANAGER_URL} className="press">
            <span className="t-tile lg ok">
              <I.sparkle size={22} />
            </span>
            التحليلات
          </a>
        </div>
      </section>

      <section className="t-section">
        <div className="t-section-head">
          <h2>المظهر</h2>
        </div>
        <div className="t-card pad" style={{ display: 'grid', gap: 14 }}>
          <Segmented
            items={[
              { id: 'system', label: 'تلقائي' },
              { id: 'light', label: 'فاتح' },
              { id: 'dark', label: 'داكن' },
            ]}
            value={theme}
            onChange={v => {
              setTheme(v);
              setThemePref(v);
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1, fontWeight: 560 }}>الاهتزاز عند اللمس</span>
            <Switch
              label="الاهتزاز"
              on={vib}
              onChange={v => {
                setVib(v);
                setHapticsOn(v);
              }}
            />
          </div>
        </div>
      </section>

      <section className="t-section">
        <div className="t-list">
          <button type="button" className="t-row danger press-soft" onClick={() => setAskOut(true)}>
            <span className="t-tile bad">
              <I.out size={19} />
            </span>
            <div className="body">
              <div className="title">تسجيل الخروج</div>
            </div>
          </button>
        </div>
      </section>
      <p className="t-foot">
        ديما · الفريق — واجهة المدير
      </p>

      <Sheet open={askOut} onClose={() => setAskOut(false)} title="تسجيل الخروج؟" subtitle="ستحتاج اسم المستخدم وكلمة المرور للدخول مرة أخرى.">
        <div className="t-row-2">
          <button type="button" className="t-btn plain press" onClick={() => setAskOut(false)}>
            بقاء
          </button>
          <button type="button" className="t-btn danger press" onClick={onLogout}>
            خروج
          </button>
        </div>
      </Sheet>
    </Screen>
  );
}
