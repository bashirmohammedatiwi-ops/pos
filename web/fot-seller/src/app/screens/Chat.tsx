import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Empty, ErrorLine, I, Screen, Sheet, Skeleton, Switch, toast } from '../kit';
import { haptic, pushBack } from '../native';
import { Lightbox } from '../parts';
import { KIND_LABEL } from '../../team';
import { chatApi, compressImage, mediaUrl, onLive, useLoad, type ChatConv, type ChatMsg, type ChatPerson, type Role } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * المحادثات — «فريق ديما» لكل الفريق، محادثات خاصة، ومجموعات عمل من المدراء.
 * غرفة المحادثة بملء الشاشة: صور، رد على رسالة، حذف، «يكتب الآن»، تحميل الأقدم.
 * ───────────────────────────────────────────────────────────────────────────── */

const ROLE_LABEL: Record<string, string> = { ...KIND_LABEL, manager: 'مدير' };
const LOC = 'ar-IQ-u-nu-latn';
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(LOC, { hour: 'numeric', minute: '2-digit' });
function shortWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return timeOf(iso);
  if (Date.now() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString(LOC, { weekday: 'short' });
  return d.toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const t = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === t.toDateString()) return 'اليوم';
  if (d.toDateString() === y.toDateString()) return 'أمس';
  return d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
}

function ConvAvatar({ c }: { c: ChatConv }) {
  if (c.kind === 'group')
    return (
      <span className="t-group-ava" style={c.auto ? { background: 'var(--hero)' } : undefined}>
        {c.auto ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="9" cy="8" r="3.2" />
            <circle cx="17" cy="9.5" r="2.5" />
            <path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M14.5 15.2c2.6-.4 4.7.9 5.5 3.3" />
          </svg>
        ) : (
          <I.chat size={21} />
        )}
      </span>
    );
  return <Avatar name={c.title} />;
}

/* ═════════════ قائمة المحادثات ═════════════ */
export function ChatList({ role, base, canGroup = role === 'manager' }: { role: Role; base: string; canGroup?: boolean }) {
  const api = useMemo(() => chatApi(role), [role]);
  const nav = useNavigate();
  const { data, err, loading, reload, setData } = useLoad(() => api.list(), []);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<'' | 'direct' | 'group'>('');

  // تحديث فوري للقائمة مع كل رسالة
  useEffect(() => {
    let t = 0;
    return onLive(m => {
      if (m.event === 'chat' || m.event === 'chat-unread') {
        window.clearTimeout(t);
        t = window.setTimeout(() => void api.list().then(setData).catch(() => undefined), 250);
      }
    });
  }, [api, setData]);

  const list = useMemo(() => {
    const n = q.trim();
    const rows = data ?? [];
    return n ? rows.filter(c => c.title.includes(n) || (c.last?.body ?? '').includes(n)) : rows;
  }, [data, q]);

  async function openDirect(p: ChatPerson) {
    try {
      const c = await api.direct(p.key);
      setPick('');
      nav(`${base}/${c.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر فتح المحادثة');
    }
  }

  return (
    <Screen title="المحادثات" subtitle="فريقك في مكان واحد" onRefresh={reload}>
      <label className="t-search" style={{ marginBottom: 12 }}>
        <I.search />
        <input placeholder="ابحث في المحادثات" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
      {loading && !data ? (
        <Skeleton h={320} r={20} />
      ) : !list.length ? (
        <Empty icon={<I.chat size={30} />} title="لا محادثات بعد" text="ابدأ محادثة مع زميل أو مديرك من الزر أدناه." />
      ) : (
        <div className="t-list">
          {list.map(c => (
            <button
              key={c.id}
              type="button"
              className={`t-conv press-soft ${c.unread ? 'unread' : ''}`}
              onClick={() => {
                haptic('tap');
                nav(`${base}/${c.id}`);
              }}
            >
              <ConvAvatar c={c} />
              <div className="body">
                <div className="top">
                  <span className="name">
                    {c.title}
                    {c.muted && <span style={{ marginInlineStart: 6, opacity: 0.5 }}>🔕</span>}
                  </span>
                  <span className="time">{c.last ? shortWhen(c.last.at) : ''}</span>
                </div>
                <div className="preview">
                  <span>
                    {c.last
                      ? `${c.last.mine ? 'أنت: ' : c.kind === 'group' ? `${c.last.senderName.split(' ')[0]}: ` : ''}${c.last.body}`
                      : c.kind === 'group'
                        ? `${c.memberCount} عضو`
                        : 'ابدأ المحادثة'}
                  </span>
                  {c.unread > 0 && <span className="count num">{c.unread > 99 ? '99+' : c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div style={{ height: 70 }} />
      <button
        type="button"
        className="t-fab press"
        onClick={() => {
          haptic('tap');
          setPick('direct');
        }}
      >
        <I.chat size={20} />
        محادثة جديدة
      </button>
      <PeopleSheet
        role={role}
        canGroup={canGroup}
        mode={pick}
        onClose={() => setPick('')}
        onPick={p => void openDirect(p)}
        onSwitch={() => setPick('group')}
        onGroup={async (title, keys) => {
          try {
            const c = await api.createGroup(title, keys);
            setPick('');
            haptic('success');
            nav(`${base}/${c.id}`);
          } catch (e) {
            toast(e instanceof Error ? e.message : 'تعذر إنشاء المجموعة');
          }
        }}
      />
    </Screen>
  );
}

function PeopleSheet({
  role,
  canGroup,
  mode,
  onClose,
  onPick,
  onSwitch,
  onGroup,
}: {
  role: Role;
  canGroup: boolean;
  mode: '' | 'direct' | 'group';
  onClose: () => void;
  onPick: (p: ChatPerson) => void;
  onSwitch: () => void;
  onGroup: (title: string, keys: string[]) => void;
}) {
  const api = useMemo(() => chatApi(role), [role]);
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (!mode || people) return;
    void api.people().then(setPeople).catch(() => setPeople([]));
  }, [mode, people, api]);
  useEffect(() => {
    if (!mode) {
      setSel([]);
      setTitle('');
      setQ('');
    }
  }, [mode]);
  const list = (people ?? []).filter(p => !q.trim() || p.name.includes(q.trim()));
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode === 'group' ? 'مجموعة جديدة' : 'محادثة جديدة'} subtitle={mode === 'group' ? 'اختر الأعضاء واسم المجموعة' : 'اختر زميلاً أو مديراً'}>
      {mode === 'group' && (
        <label className="t-field" style={{ marginBottom: 12 }}>
          <span>اسم المجموعة</span>
          <input className="t-input sm" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: قسم المكياج" />
        </label>
      )}
      {mode === 'direct' && canGroup && (
        <button type="button" className="t-row t-card press" style={{ marginBottom: 12 }} onClick={onSwitch}>
          <span className="t-group-ava">
            <I.chat size={20} />
          </span>
          <div className="body">
            <div className="title">إنشاء مجموعة عمل</div>
            <div className="sub">لقسم أو فريق محدد</div>
          </div>
        </button>
      )}
      <label className="t-search" style={{ marginBottom: 8 }}>
        <I.search />
        <input placeholder="ابحث بالاسم" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {!people ? (
        <Skeleton h={200} r={16} />
      ) : (
        list.map(p =>
          mode === 'group' ? (
            <button
              key={p.key}
              type="button"
              className={`t-check ${sel.includes(p.key) ? 'on' : ''}`}
              onClick={() => {
                haptic('select');
                setSel(s => (s.includes(p.key) ? s.filter(x => x !== p.key) : [...s, p.key]));
              }}
            >
              <span className="box">{sel.includes(p.key) && <I.check size={14} />}</span>
              <Avatar name={p.name} size="sm" />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontWeight: 600 }}>{p.name}</b>
                <small style={{ color: 'var(--ink-3)' }}>{ROLE_LABEL[p.role] ?? p.role}</small>
              </span>
            </button>
          ) : (
            <button key={p.key} type="button" className="t-check press-soft" onClick={() => onPick(p)}>
              <Avatar name={p.name} size="sm" />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontWeight: 600 }}>{p.name}</b>
                <small style={{ color: 'var(--ink-3)' }}>
                  {ROLE_LABEL[p.role] ?? p.role}
                  {p.sub && p.role !== 'manager' ? ` · ${p.sub}` : ''}
                </small>
              </span>
              <span style={{ color: 'var(--ink-4)' }}>
                <I.chevron />
              </span>
            </button>
          ),
        )
      )}
      {mode === 'group' && (
        <button type="button" className="t-btn block press" style={{ marginTop: 12 }} disabled={!title.trim() || !sel.length} onClick={() => onGroup(title.trim(), sel)}>
          إنشاء المجموعة ({sel.length})
        </button>
      )}
    </Sheet>
  );
}

/* ═════════════ غرفة المحادثة ═════════════ */
export function ChatRoom({ role, base }: { role: Role; base: string }) {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const api = useMemo(() => chatApi(role), [role]);
  const me = api.me();
  const [conv, setConv] = useState<ChatConv | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [typing, setTyping] = useState<{ name: string; until: number } | null>(null);
  const [action, setAction] = useState<ChatMsg | null>(null);
  const [info, setInfo] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<(ChatPerson & { lastRead: number })[]>([]);

  const scrollDown = (smooth = false) => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));

  // زر الرجوع في أندرويد يعود للقائمة
  useEffect(() => pushBack(() => nav(base, { replace: true })), [nav, base]);

  useEffect(() => {
    let alive = true;
    setMsgs(null);
    api
      .messages(id)
      .then(r => {
        if (!alive) return;
        setConv(r.conversation);
        setMsgs(r.messages);
        setMembers(r.members);
        setHasMore(r.hasMore);
        scrollDown();
        const last = r.messages[r.messages.length - 1];
        if (last) void api.read(id, last.id).catch(() => undefined);
      })
      .catch(e => alive && setErr(e instanceof Error ? e.message : 'تعذر فتح المحادثة'));
    return () => {
      alive = false;
    };
  }, [id, api]);

  // رسائل حية
  useEffect(
    () =>
      onLive(m => {
        if (m.data.convId !== id) return;
        if (m.event === 'chat' && m.data.message) {
          const msg = m.data.message;
          setMsgs(list => {
            if (!list) return list;
            const rest = list.filter(x => x.id !== msg.id && !(x.pending && x.sender.key === msg.sender.key && x.body === msg.body && x.image === msg.image));
            return [...rest, msg];
          });
          if (msg.sender.key !== me) {
            setTyping(null);
            void api.read(id, msg.id).catch(() => undefined);
            if (atBottom.current) scrollDown(true);
          }
        }
        if (m.event === 'chat' && m.data.deletedId) setMsgs(list => list?.map(x => (x.id === m.data.deletedId ? { ...x, deleted: true, body: null, image: null } : x)) ?? null);
        if (m.event === 'typing' && m.data.name) setTyping({ name: m.data.name, until: Date.now() + 4000 });
        if (m.event === 'chat-read' && m.data.key) setMembers(ms => ms.map(x => (x.key === m.data.key ? { ...x, lastRead: m.data.lastId ?? x.lastRead } : x)));
      }),
    [id, api, me],
  );
  useEffect(() => {
    if (!typing) return;
    const t = window.setTimeout(() => setTyping(null), Math.max(0, typing.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [typing]);

  // الحفاظ على موضع التمرير عند تحميل الأقدم
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
    }
  }, [msgs]);

  async function older() {
    if (!msgs?.length || !hasMore) return;
    prevHeight.current = scroller.current?.scrollHeight ?? 0;
    const r = await api.messages(id, msgs[0].id);
    setMsgs(list => [...r.messages, ...(list ?? [])]);
    setHasMore(r.hasMore);
  }

  async function send(image?: string) {
    const body = text.trim();
    if (!body && !image) return;
    haptic('tap');
    const temp: ChatMsg = {
      id: -Date.now(),
      convId: id,
      sender: { key: me, name: 'أنت' },
      body: body || null,
      image: image ?? null,
      replyTo: reply ? { id: reply.id, senderName: reply.sender.name, body: reply.body || (reply.image ? '📷 صورة' : '') } : null,
      createdAt: new Date().toISOString(),
      deleted: false,
      pending: true,
    };
    setMsgs(list => [...(list ?? []), temp]);
    setText('');
    const replyId = reply?.id ?? null;
    setReply(null);
    scrollDown(true);
    try {
      const saved = await api.send(id, { body: body || undefined, image: image ?? null, replyTo: replyId });
      setMsgs(list => (list ?? []).filter(x => x.id !== temp.id && x.id !== saved.id).concat(saved).sort((a, b) => Number(a.id < 0) - Number(b.id < 0) || (a.id < 0 ? 0 : a.id - b.id)));
    } catch (e) {
      setMsgs(list => (list ?? []).filter(x => x.id !== temp.id));
      setText(body);
      toast(e instanceof Error ? e.message : 'لم تُرسل الرسالة');
    }
  }

  async function pickImage(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const r = await api.upload(await compressImage(f, 1400));
      await send(r.url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر إرسال الصورة');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onType(v: string) {
    setText(v);
    if (v && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      void api.typing(id).catch(() => undefined);
    }
  }

  // آخر رسالة لي قرأها الطرف الآخر (محادثة خاصة)
  const otherRead = conv?.kind === 'direct' ? members.find(x => x.key !== me)?.lastRead ?? 0 : 0;

  const rows = useMemo(() => {
    const out: ({ day: string } | { msg: ChatMsg; cont: boolean; showName: boolean })[] = [];
    let lastDay = '';
    let prev: ChatMsg | null = null;
    for (const m of msgs ?? []) {
      const d = new Date(m.createdAt).toDateString();
      if (d !== lastDay) {
        out.push({ day: dayLabel(m.createdAt) });
        lastDay = d;
        prev = null;
      }
      const cont = !!prev && prev.sender.key === m.sender.key && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000;
      out.push({ msg: m, cont, showName: conv?.kind === 'group' && m.sender.key !== me && !cont });
      prev = m;
    }
    return out;
  }, [msgs, conv, me]);

  const subtitle = typing && typing.until > Date.now()
    ? `${conv?.kind === 'group' ? typing.name.split(' ')[0] + ' ' : ''}يكتب الآن…`
    : conv?.kind === 'group'
      ? `${conv.memberCount} عضو`
      : ROLE_LABEL[conv?.other?.role ?? ''] ?? '';

  return (
    <div className="t-room">
      <header className="t-room-head">
        <button type="button" className="t-icon-btn ghost press" aria-label="رجوع" onClick={() => nav(base, { replace: true })}>
          <I.back size={20} />
        </button>
        {conv && <ConvAvatar c={conv} />}
        <button type="button" className="who" style={{ textAlign: 'start' }} onClick={() => setInfo(true)}>
          <b>{conv?.title ?? '…'}</b>
          <small className={typing ? 'typing' : ''}>{subtitle}</small>
        </button>
      </header>

      <div
        ref={scroller}
        className="t-msgs"
        onScroll={e => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 60 && hasMore) void older();
        }}
      >
        {err && <ErrorLine text={err} />}
        {!msgs && !err && <Skeleton h={240} r={18} />}
        {msgs && !msgs.length && (
          <Empty icon={<I.chat size={28} />} title="ابدأ المحادثة" text={conv?.kind === 'group' ? 'رسائل المجموعة تصل لكل الأعضاء فوراً.' : 'اكتب رسالتك الأولى.'} />
        )}
        {rows.map((r, i) =>
          'day' in r ? (
            <span key={`d${i}`} className="t-msg-day">
              {r.day}
            </span>
          ) : (
            <div key={r.msg.id} className={`t-msg ${r.msg.sender.key === me ? 'mine' : ''} ${r.cont ? 'cont' : ''}`} style={{ marginTop: r.cont ? 0 : 6 }}>
              {r.showName && <span className="from">{r.msg.sender.name}</span>}
              <div
                className={`t-bubble ${r.msg.deleted ? 'deleted' : ''}`}
                onContextMenu={e => {
                  e.preventDefault();
                  if (!r.msg.deleted && !r.msg.pending) {
                    haptic('heavy');
                    setAction(r.msg);
                  }
                }}
                onClick={() => {
                  if (!r.msg.deleted && !r.msg.pending && !r.msg.image) setAction(r.msg);
                }}
              >
                {r.msg.deleted ? (
                  'حُذفت هذه الرسالة'
                ) : (
                  <>
                    {r.msg.replyTo && (
                      <div className="t-quote">
                        <b>{r.msg.replyTo.senderName}</b>
                        {r.msg.replyTo.body}
                      </div>
                    )}
                    {r.msg.image && (
                      <img
                        src={mediaUrl(r.msg.image)}
                        alt=""
                        loading="lazy"
                        onClick={e => {
                          e.stopPropagation();
                          setViewer(r.msg.image!);
                        }}
                        onLoad={() => atBottom.current && scrollDown()}
                      />
                    )}
                    {r.msg.body}
                  </>
                )}
                <span className="meta num">
                  {timeOf(r.msg.createdAt)}
                  {r.msg.sender.key === me && (r.msg.pending ? ' ◷' : otherRead >= r.msg.id ? ' ✓✓' : ' ✓')}
                </span>
              </div>
            </div>
          ),
        )}
        {typing && typing.until > Date.now() && (
          <span className="t-typing" aria-label="يكتب الآن">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>

      <footer className="t-composer">
        {reply && (
          <div className="t-replying">
            <I.back size={16} />
            <span>
              رد على <b>{reply.sender.name}</b>: {reply.body || '📷 صورة'}
            </span>
            <button type="button" aria-label="إلغاء الرد" onClick={() => setReply(null)}>
              <I.close size={16} />
            </button>
          </div>
        )}
        <div className="bar">
          <button type="button" className="t-send ghost press" aria-label="إرسال صورة" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? (
              <span className="spinner" style={{ borderColor: 'var(--line-2)', borderTopColor: 'var(--brand)' }} />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <rect x="3.5" y="5" width="17" height="14" rx="3" />
                <circle cx="9" cy="10" r="1.6" />
                <path d="m20.5 16-4.5-4.5L7 19.5" />
              </svg>
            )}
          </button>
          <textarea
            rows={1}
            value={text}
            placeholder="اكتب رسالة…"
            onChange={e => {
              onType(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
            }}
            onFocus={() => scrollDown(true)}
          />
          <button type="button" className="t-send press" aria-label="إرسال" disabled={!text.trim()} onClick={() => void send()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: 'scaleX(-1)' }}>
              <path d="M3.4 20.4 21 12 3.4 3.6l-.02 6.53L15 12 3.38 13.87z" />
            </svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void pickImage(e.target.files)} />
        </div>
      </footer>

      <Sheet open={!!action} onClose={() => setAction(null)}>
        {action && (
          <div className="t-list flat">
            <button
              type="button"
              className="t-row press-soft"
              onClick={() => {
                setReply(action);
                setAction(null);
              }}
            >
              <span className="t-tile">
                <I.back size={18} />
              </span>
              <div className="body">
                <div className="title">رد</div>
              </div>
            </button>
            {action.body && (
              <button
                type="button"
                className="t-row press-soft"
                onClick={() => {
                  void navigator.clipboard?.writeText(action.body ?? '').then(() => toast('نُسخ النص'));
                  setAction(null);
                }}
              >
                <span className="t-tile mute">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <rect x="8" y="8" width="12" height="12" rx="2.5" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                  </svg>
                </span>
                <div className="body">
                  <div className="title">نسخ</div>
                </div>
              </button>
            )}
            {(action.sender.key === me || role === 'manager') && (
              <button
                type="button"
                className="t-row danger press-soft"
                onClick={() => {
                  const target = action;
                  setAction(null);
                  void api
                    .remove(target.id)
                    .then(() => setMsgs(list => list?.map(x => (x.id === target.id ? { ...x, deleted: true, body: null, image: null } : x)) ?? null))
                    .catch(e => toast(e instanceof Error ? e.message : 'تعذر الحذف'));
                }}
              >
                <span className="t-tile bad">
                  <I.close size={18} />
                </span>
                <div className="body">
                  <div className="title">حذف للجميع</div>
                  <div className="sub">{action.sender.key === me ? 'خلال 15 دقيقة من الإرسال' : 'صلاحية المدير'}</div>
                </div>
              </button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={info} onClose={() => setInfo(false)} title={conv?.title} subtitle={conv?.kind === 'group' ? `${conv.memberCount} عضو` : ROLE_LABEL[conv?.other?.role ?? '']}>
        {conv && (
          <>
            <div className="t-card" style={{ padding: '4px 14px', marginBottom: 12 }}>
              <div className="t-check" style={{ cursor: 'default' }}>
                <span style={{ flex: 1 }}>كتم تنبيهات المحادثة</span>
                <Switch
                  label="كتم"
                  on={conv.muted}
                  onChange={v => {
                    void api.mute(id, v).then(setConv).catch(() => undefined);
                  }}
                />
              </div>
            </div>
            {members.length > 0 && (
              <div className="t-list flat">
                {members.map(p => (
                  <div key={p.key} className="t-row">
                    <Avatar name={p.name} size="sm" />
                    <div className="body">
                      <div className="title">{p.name}</div>
                      <div className="sub">{ROLE_LABEL[p.role] ?? p.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {conv.kind === 'group' && !conv.auto && conv.isAdmin && (
              <button
                type="button"
                className="t-btn plain block press"
                style={{ marginTop: 12, color: 'var(--bad)' }}
                onClick={() =>
                  void api
                    .updateGroup(id, { delete: true })
                    .then(() => nav(base, { replace: true }))
                    .catch(e => toast(e instanceof Error ? e.message : 'تعذر الحذف'))
                }
              >
                حذف المجموعة
              </button>
            )}
          </>
        )}
      </Sheet>
      {viewer && <Lightbox images={[viewer]} start={0} onClose={() => setViewer(null)} />}
    </div>
  );
}
