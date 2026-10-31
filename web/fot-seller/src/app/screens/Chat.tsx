import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Empty, ErrorLine, Fab, I, Screen, Sheet, Skeleton, Switch, toast } from '../kit';
import { haptic, openAppSettings, pushBack } from '../native';
import { Lightbox } from '../parts';
import { KIND_LABEL } from '../../team';
import { chatApi, compressChatImage, dataUrlBytes, mediaUrl, onLive, useLoad, usePerms, type ChatConv, type ChatMsg, type ChatPerson, type ChatPresence, type Role } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * المحادثات — «فريق ديما» لكل الفريق، محادثات خاصة، ومجموعات عمل من المدراء.
 * غرفة المحادثة بملء الشاشة: صور مضغوطة مع معاينة وتعليق، رسائل صوتية، رد على رسالة، حذف،
 * «يكتب الآن»، تحميل الأقدم، وإدارة المجموعة (الاسم، الأعضاء، الوسائط، المغادرة).
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

/* ═════════════ الرسائل الصوتية ═════════════ */
const VOICE_MAX_MS = 180_000;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/** تسجيل صوتي بجودة منخفضة كافية للكلام (نحو 180 كيلوبايت للدقيقة) */
function useVoiceRecorder(onDone: (blob: Blob, ms: number) => void) {
  const [recording, setRecording] = useState(false);
  const [ms, setMs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef(0);
  const started = useRef(0);
  const cancelled = useRef(false);
  const deniedOnce = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  const release = useCallback(() => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    rec.current = null;
    setRecording(false);
  }, []);

  const stop = useCallback((send: boolean) => {
    cancelled.current = !send;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    else release();
  }, [release]);

  const start = useCallback(async () => {
    if (rec.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('التسجيل الصوتي غير مدعوم على هذا الجهاز');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24000 });
      const chunks: Blob[] = [];
      r.ondataavailable = e => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const length = Date.now() - started.current;
        const type = r.mimeType;
        release();
        if (cancelled.current) return;
        if (length < 800) {
          toast('التسجيل قصير جداً');
          return;
        }
        done.current(new Blob(chunks, { type }), length);
      };
      stream.current = s;
      rec.current = r;
      cancelled.current = false;
      started.current = Date.now();
      setMs(0);
      setRecording(true);
      r.start();
      haptic('heavy');
      timer.current = window.setInterval(() => {
        const t = Date.now() - started.current;
        setMs(t);
        if (t >= VOICE_MAX_MS) stop(true);
      }, 250);
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      if (!denied) toast('تعذر تشغيل الميكروفون');
      else if (deniedOnce.current) {
        toast('فعّل إذن الميكروفون من صفحة أذونات التطبيق');
        void openAppSettings();
      } else {
        deniedOnce.current = true;
        toast('اسمح للتطبيق باستخدام الميكروفون لإرسال رسالة صوتية');
      }
    }
  }, [release, stop]);

  // الخروج من المحادثة يلغي التسجيل ويحرّر الميكروفون
  useEffect(
    () => () => {
      cancelled.current = true;
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
      release();
    },
    [release],
  );
  return { recording, ms, start, stop };
}

/** صورة في فقاعة المحادثة: فشل التحميل يظهر مع إعادة محاولة بدل فقاعة فارغة */
function ChatImage({ src, onOpen, onLoad }: { src: string; onOpen: () => void; onLoad: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed) {
    return (
      <button
        type="button"
        className="t-img-failed press"
        onClick={e => {
          e.stopPropagation();
          setFailed(false);
          setAttempt(n => n + 1);
        }}
      >
        تعذر تحميل الصورة — اضغط لإعادة المحاولة
      </button>
    );
  }
  return (
    <img
      key={attempt}
      src={mediaUrl(src)}
      alt=""
      loading="lazy"
      onClick={e => {
        e.stopPropagation();
        onOpen();
      }}
      onLoad={onLoad}
      onError={() => setFailed(true)}
    />
  );
}

/** صوت واحد يعمل في الوقت نفسه */
let nowPlaying: HTMLAudioElement | null = null;

function VoiceBubble({ src, ms }: { src: string; ms?: number | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const [length, setLength] = useState(ms ?? 0);
  useEffect(
    () => () => {
      audio.current?.pause();
      if (nowPlaying === audio.current) nowPlaying = null;
    },
    [],
  );
  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    haptic('tap');
    let a = audio.current;
    if (!a) {
      a = new Audio(mediaUrl(src));
      a.preload = 'auto';
      a.onplaying = () => {
        setLoading(false);
        setPlaying(true);
      };
      a.onwaiting = () => setLoading(true);
      a.onpause = () => setPlaying(false);
      a.ontimeupdate = () => setPos((a as HTMLAudioElement).currentTime * 1000);
      a.onloadedmetadata = () => {
        const d = (a as HTMLAudioElement).duration;
        if (!ms && Number.isFinite(d)) setLength(d * 1000);
      };
      a.onended = () => {
        setPlaying(false);
        setPos(0);
      };
      a.onerror = () => {
        setLoading(false);
        setPlaying(false);
        audio.current = null; // الضغطة التالية تعيد المحاولة
        toast('تعذر تشغيل الرسالة الصوتية');
      };
      audio.current = a;
    }
    if (!a.paused) {
      a.pause();
      return;
    }
    if (nowPlaying && nowPlaying !== a) nowPlaying.pause();
    nowPlaying = a;
    a.playbackRate = rate;
    setLoading(true);
    void a.play().catch(() => setLoading(false));
  }
  function changeRate(e: React.MouseEvent) {
    e.stopPropagation();
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  }
  const progress = length ? Math.min(100, (pos / length) * 100) : 0;
  return (
    <div className="t-voice" onClick={e => e.stopPropagation()}>
      <button type="button" className="play press" aria-label={playing ? 'إيقاف' : 'تشغيل'} onClick={toggle}>
        {loading ? (
          <span className="spinner" />
        ) : playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
            <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: 'scaleX(-1)' }}>
            <path d="M7 4.6v14.8c0 .8.9 1.3 1.6.8l11-7.4c.6-.4.6-1.2 0-1.6l-11-7.4C7.9 3.3 7 3.8 7 4.6z" />
          </svg>
        )}
      </button>
      <div className="track">
        <span>
          <i style={{ width: `${progress}%` }} />
        </span>
        <small className="num ltr">{mmss(playing || pos ? pos : length)}</small>
      </div>
      <button type="button" className="rate num press" aria-label="سرعة التشغيل" onClick={changeRate}>
        {rate}x
      </button>
    </div>
  );
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
                    {c.pinned && <span style={{ marginInlineStart: 6, opacity: 0.6 }}>📌</span>}
                    {c.muted && <span style={{ marginInlineStart: 6, opacity: 0.5 }}>🔕</span>}
                  </span>
                  <span className="time">{c.last ? shortWhen(c.last.at) : ''}</span>
                </div>
                <div className="preview">
                  <span>
                    {c.last
                      ? c.last.system
                        ? c.last.body
                        : `${c.last.mine ? 'أنت: ' : c.kind === 'group' ? `${c.last.senderName.split(' ')[0]}: ` : ''}${c.last.body}`
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
      <Fab icon={<I.chat size={20} />} label="محادثة جديدة" onClick={() => setPick('direct')} />
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
  const [section, setSection] = useState('');
  useEffect(() => {
    if (!mode || people) return;
    void api.people().then(setPeople).catch(() => setPeople([]));
  }, [mode, people, api]);
  useEffect(() => {
    if (!mode) {
      setSel([]);
      setTitle('');
      setQ('');
      setSection('');
    }
  }, [mode]);
  const list = (people ?? []).filter(p => (!q.trim() || p.name.includes(q.trim())) && (!section || p.sub === section));
  const sections = [...new Set((people ?? []).map(p => p.sub).filter((x): x is string => !!x))];
  const allShown = list.length > 0 && list.every(p => sel.includes(p.key));
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
      {mode === 'group' && (
        <>
          <div className="t-scroller" style={{ gap: 8, marginBottom: 8 }}>
            <button type="button" className={`t-chip press ${!section ? 'on' : ''}`} style={{ flexShrink: 0 }} onClick={() => setSection('')}>
              الكل
            </button>
            {sections.map(x => (
              <button key={x} type="button" className={`t-chip press ${section === x ? 'on' : ''}`} style={{ flexShrink: 0 }} onClick={() => setSection(x)}>
                {x}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="t-btn soft block sm press"
            style={{ marginBottom: 6 }}
            disabled={!list.length}
            onClick={() => setSel(s => (allShown ? s.filter(k => !list.some(p => p.key === k)) : [...new Set([...s, ...list.map(p => p.key)])]))}
          >
            {allShown ? 'إلغاء تحديد الظاهرين' : `تحديد الظاهرين (${list.length})`}
          </button>
        </>
      )}
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

/** إضافة أعضاء لمجموعة موجودة */
function AddMembers({ open, api, existing, onClose, onAdd }: { open: boolean; api: ReturnType<typeof chatApi>; existing: string[]; onClose: () => void; onAdd: (keys: string[]) => void }) {
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) {
      setSel([]);
      setQ('');
      return;
    }
    void api.people().then(setPeople).catch(() => setPeople([]));
  }, [open, api]);
  const list: ReactNode = !people ? (
    <Skeleton h={200} r={16} />
  ) : (
    people
      .filter(p => !existing.includes(p.key) && (!q.trim() || p.name.includes(q.trim())))
      .map(p => (
        <button key={p.key} type="button" className={`t-check ${sel.includes(p.key) ? 'on' : ''}`} onClick={() => (haptic('select'), setSel(s => (s.includes(p.key) ? s.filter(x => x !== p.key) : [...s, p.key])))}>
          <span className="box">{sel.includes(p.key) && <I.check size={14} />}</span>
          <Avatar name={p.name} size="sm" />
          <span style={{ flex: 1 }}>
            <b style={{ display: 'block', fontWeight: 600 }}>{p.name}</b>
            <small style={{ color: 'var(--ink-3)' }}>{ROLE_LABEL[p.role] ?? p.role}</small>
          </span>
        </button>
      ))
  );
  return (
    <Sheet open={open} onClose={onClose} title="إضافة أعضاء">
      <label className="t-search" style={{ marginBottom: 8 }}>
        <I.search />
        <input placeholder="ابحث بالاسم" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {list}
      <button type="button" className="t-btn block press" style={{ marginTop: 12 }} disabled={!sel.length} onClick={() => onAdd(sel)}>
        إضافة ({sel.length})
      </button>
    </Sheet>
  );
}

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EDIT_WINDOW_MS = 24 * 3600_000;
const msgPreview = (m: ChatMsg) => m.body || (m.audio ? '🎤 رسالة صوتية' : m.image ? '📷 صورة' : '');
function lastSeenText(p: ChatPresence | null) {
  if (!p) return '';
  if (p.online) return 'متصل الآن';
  if (!p.lastSeen) return '';
  const d = new Date(p.lastSeen);
  const t = d.toLocaleTimeString(LOC, { hour: 'numeric', minute: '2-digit' });
  return `آخر ظهور ${d.toDateString() === new Date().toDateString() ? 'اليوم' : dayLabel(p.lastSeen)} ${t}`;
}
const ICON = {
  forward: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 5 3 12l7 7v-4.5c5 0 8.5 1.5 11 5-.8-6-4-10-11-10.5z" /></svg>,
  pin: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 17v5M8 3h8l-1 6 3 4v2H6v-2l3-4z" /></svg>,
  edit: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>,
  check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>,
  down: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>,
  trash: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" /></svg>,
  copy: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>,
};

/** إعادة توجيه: اختيار محادثات أو أشخاص */
function ActionRow({ icon, title, sub, danger, onClick }: { icon: ReactNode; title: string; sub?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`t-row ${danger ? 'danger' : ''} press-soft`} style={{ width: '100%' }} onClick={onClick}>
      <span className={`t-tile ${danger ? 'bad' : 'mute'}`}>{icon}</span>
      <div className="body">
        <div className="title">{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </button>
  );
}

function ForwardSheet({ role, count, open, onClose, onSend }: { role: Role; count: number; open: boolean; onClose: () => void; onSend: (convIds: number[]) => Promise<void> }) {
  const api = useMemo(() => chatApi(role), [role]);
  const [convs, setConvs] = useState<ChatConv[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSel([]);
    setQ('');
    void api.list().then(setConvs).catch(() => undefined);
    void api.people().then(setPeople).catch(() => undefined);
  }, [open, api]);
  const taken = new Set(convs.map(c => c.other?.key).filter(Boolean));
  const n = q.trim();
  const rows = [
    ...convs.filter(c => !n || c.title.includes(n)).map(c => ({ id: `c${c.id}`, title: c.title, sub: c.kind === 'group' ? `${c.memberCount} عضو` : 'محادثة', c, p: null as ChatPerson | null })),
    ...people.filter(p => !taken.has(p.key) && (!n || p.name.includes(n))).map(p => ({ id: `p${p.key}`, title: p.name, sub: p.sub || ROLE_LABEL[p.role] || '', c: null as ChatConv | null, p })),
  ];
  async function go() {
    setBusy(true);
    try {
      const ids: number[] = [];
      for (const key of sel) {
        if (key.startsWith('c')) ids.push(Number(key.slice(1)));
        else ids.push((await api.direct(key.slice(1))).id);
      }
      await onSend(ids);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر إعادة التوجيه');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="إعادة توجيه" subtitle={count > 1 ? `${count} رسائل` : 'رسالة واحدة'}>
      <label className="t-search" style={{ marginBottom: 10 }}>
        <I.search />
        <input placeholder="ابحث بالاسم" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <div className="t-list flat" style={{ maxHeight: '46vh', overflow: 'auto' }}>
        {rows.map(r => {
          const on = sel.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              className="t-row press-soft"
              style={{ width: '100%' }}
              onClick={() => {
                haptic('select');
                setSel(s => (on ? s.filter(x => x !== r.id) : s.length >= 10 ? (toast('10 محادثات كحد أقصى'), s) : [...s, r.id]));
              }}
            >
              {r.c ? <ConvAvatar c={r.c} /> : <Avatar name={r.title} />}
              <div className="body">
                <div className="title">{r.title}</div>
                <div className="sub">{r.sub}</div>
              </div>
              <span className={`t-pick ${on ? 'on' : ''}`}>{on && ICON.check}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="t-btn block press" style={{ marginTop: 12 }} disabled={!sel.length || busy} onClick={() => void go()}>
        {busy ? <span className="spinner" /> : `إرسال${sel.length ? ` إلى ${sel.length}` : ''}`}
      </button>
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
  const [shots, setShots] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; text: string; ok: string; run: () => void } | null>(null);
  const [adding, setAdding] = useState(false);
  const [mediaList, setMediaList] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const perms = usePerms();
  const leaving = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<(ChatPerson & { lastRead: number })[]>([]);
  const [editing, setEditing] = useState<ChatMsg | null>(null);
  const [pins, setPins] = useState<ChatMsg[]>([]);
  const [pinIndex, setPinIndex] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const selecting = selected.length > 0;
  const [forwarding, setForwarding] = useState<number[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchRows, setSearchRows] = useState<ChatMsg[] | null>(null);
  const [msgInfo, setMsgInfo] = useState<{ msg: ChatMsg; read: { key: string; name: string }[]; unread: { key: string; name: string }[] } | null>(null);
  const [presence, setPresence] = useState<ChatPresence | null>(null);
  const [firstUnread, setFirstUnread] = useState(0);
  const [newBelow, setNewBelow] = useState(0);
  const [showDown, setShowDown] = useState(false);
  const [flash, setFlash] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

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
        setPins(r.pinned ?? []);
        setPresence(r.presence ?? null);
        // أول رسالة لم أقرأها: يظهر فوقها فاصل «رسائل جديدة»
        const unreadMsg = r.messages.find(m => m.id > (r.lastRead ?? Infinity) && m.sender.key !== me && m.kind !== 'system');
        setFirstUnread(unreadMsg?.id ?? 0);
        if (unreadMsg) requestAnimationFrame(() => scroller.current?.querySelector('.t-msg-new')?.scrollIntoView({ block: 'center' }));
        else scrollDown();
        const last = r.messages[r.messages.length - 1];
        if (last) void api.read(id, last.id).catch(() => undefined);
      })
      .catch(e => alive && setErr(e instanceof Error ? e.message : 'تعذر فتح المحادثة'));
    return () => {
      alive = false;
    };
  }, [id, api, me]);

  // آخر ظهور الطرف الآخر يتحدث دورياً
  useEffect(() => {
    if (conv?.kind !== 'direct') return;
    const t = window.setInterval(() => void api.presence(id).then(setPresence).catch(() => undefined), 45_000);
    return () => window.clearInterval(t);
  }, [api, id, conv?.kind]);

  const reloadMembers = useCallback(() => {
    void api
      .messages(id)
      .then(r => {
        setConv(r.conversation);
        setMembers(r.members);
      })
      .catch(() => undefined);
  }, [api, id]);

  // رسائل حية
  useEffect(
    () =>
      onLive(m => {
        if (m.data.convId !== id) return;
        if (m.event === 'chat' && m.data.removed) {
          if (!leaving.current) toast(m.data.gone ? 'حُذفت هذه المجموعة' : 'أُزلت من هذه المجموعة');
          nav(base, { replace: true });
          return;
        }
        if (m.event === 'chat' && m.data.updated) reloadMembers();
        if (m.event === 'chat' && m.data.message?.kind === 'system') reloadMembers();
        if (m.event === 'chat' && m.data.message) {
          const msg = m.data.message;
          setMsgs(list => {
            if (!list) return list;
            const rest = list.filter(x => x.id !== msg.id && !(x.pending && x.sender.key === msg.sender.key && x.body === msg.body && x.image === msg.image && x.audio === msg.audio));
            return [...rest, msg];
          });
          if (msg.sender.key !== me) {
            setTyping(null);
            void api.read(id, msg.id).catch(() => undefined);
            if (atBottom.current) scrollDown(true);
            else setNewBelow(n => n + 1);
          }
        }
        if (m.event === 'chat' && m.data.edited) {
          const edited = m.data.edited;
          setMsgs(list => list?.map(x => (x.id === edited.id ? edited : x)) ?? null);
        }
        if (m.event === 'chat' && m.data.reacted) {
          const r = m.data.reacted;
          setMsgs(list => list?.map(x => (x.id === r.id ? { ...x, reactions: r.reactions } : x)) ?? null);
        }
        if (m.event === 'chat' && m.data.pins) {
          setPins(m.data.pins);
          setPinIndex(0);
        }
        if (m.event === 'chat' && m.data.deletedId) {
          setMsgs(list => list?.map(x => (x.id === m.data.deletedId ? { ...x, deleted: true, body: null, image: null, audio: null, reactions: [] } : x)) ?? null);
          setPins(list => list.filter(x => x.id !== m.data.deletedId));
        }
        if (m.event === 'typing' && m.data.name) setTyping({ name: m.data.name, until: Date.now() + 4000 });
        if (m.event === 'chat-read' && m.data.key) setMembers(ms => ms.map(x => (x.key === m.data.key ? { ...x, lastRead: m.data.lastId ?? x.lastRead } : x)));
      }),
    [id, api, me, nav, base, reloadMembers],
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

  /** الانتقال لرسالة (رد، بحث، مثبّتة): تُحمَّل إن لم تكن ظاهرة ثم تومض */
  async function jumpTo(mid: number) {
    if (!msgs?.some(m => m.id === mid)) {
      try {
        const r = await api.messages(id, undefined, mid);
        if (!r.messages.some(m => m.id === mid)) {
          toast('هذه الرسالة لم تعد متاحة');
          return;
        }
        setMsgs(r.messages);
        setHasMore(r.hasMore);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'تعذر فتح الرسالة');
        return;
      }
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        scroller.current?.querySelector(`[data-mid="${mid}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setFlash(mid);
        window.setTimeout(() => setFlash(f => (f === mid ? 0 : f)), 1600);
      }),
    );
  }
  function startEdit(m: ChatMsg) {
    setEditing(m);
    setReply(null);
    setText(m.body ?? '');
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function stopEdit() {
    setEditing(null);
    setText('');
  }
  async function saveEdit() {
    if (!editing) return;
    const body = text.trim();
    if (!body && !editing.image) return;
    const target = editing;
    stopEdit();
    try {
      const saved = await api.edit(target.id, body);
      setMsgs(list => list?.map(x => (x.id === saved.id ? saved : x)) ?? null);
      haptic('success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تعديل الرسالة');
    }
  }
  async function react(m: ChatMsg, emoji: string) {
    setAction(null);
    haptic('select');
    const mine = m.reactions?.find(r => r.key === me)?.emoji;
    try {
      const r = await api.react(m.id, mine === emoji ? null : emoji);
      setMsgs(list => list?.map(x => (x.id === r.id ? { ...x, reactions: r.reactions } : x)) ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر التفاعل');
    }
  }
  async function hideMessages(ids: number[]) {
    try {
      await Promise.all(ids.map(x => api.hide(x)));
      setMsgs(list => list?.filter(x => !ids.includes(x.id)) ?? null);
      setSelected([]);
      haptic('success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر الحذف');
    }
  }
  function toggleSelect(m: ChatMsg) {
    haptic('select');
    setSelected(s => (s.includes(m.id) ? s.filter(x => x !== m.id) : s.length >= 20 ? (toast('20 رسالة كحد أقصى'), s) : [...s, m.id]));
  }
  // البحث داخل المحادثة
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchRows(null);
      return;
    }
    const t = window.setTimeout(() => void api.search(id, q).then(setSearchRows).catch(() => setSearchRows([])), 300);
    return () => window.clearTimeout(t);
  }, [searchQ, searchOpen, api, id]);

  /** نص الحقل، أو تعليق صورة، أو رسالة صوتية */
  async function send(extra?: { image?: string; audio?: string; audioMs?: number; caption?: string }) {
    const image = extra?.image;
    const audio = extra?.audio;
    const body = (extra ? extra.caption ?? '' : text).trim();
    if (!body && !image && !audio) return;
    haptic('tap');
    const temp: ChatMsg = {
      id: -Date.now(),
      convId: id,
      sender: { key: me, name: 'أنت' },
      body: body || null,
      image: image ?? null,
      audio: audio ?? null,
      audioMs: extra?.audioMs ?? null,
      replyTo: reply ? { id: reply.id, senderName: reply.sender.name, body: reply.body || (reply.audio ? '🎤 رسالة صوتية' : reply.image ? '📷 صورة' : '') } : null,
      createdAt: new Date().toISOString(),
      deleted: false,
      pending: true,
    };
    setMsgs(list => [...(list ?? []), temp]);
    if (!extra) {
      setText('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
    }
    const replyId = reply?.id ?? null;
    setReply(null);
    scrollDown(true);
    try {
      const saved = await api.send(id, { body: body || undefined, image: image ?? null, audio: audio ?? null, audioMs: extra?.audioMs ?? null, replyTo: replyId });
      setMsgs(list => (list ?? []).filter(x => x.id !== temp.id && x.id !== saved.id).concat(saved).sort((a, b) => Number(a.id < 0) - Number(b.id < 0) || (a.id < 0 ? 0 : a.id - b.id)));
    } catch (e) {
      setMsgs(list => (list ?? []).filter(x => x.id !== temp.id));
      if (!extra) setText(body);
      toast(e instanceof Error ? e.message : 'لم تُرسل الرسالة');
    }
  }

  /** الصور تُضغط أولاً وتظهر للمعاينة مع تعليق، ثم تُرفع عند الإرسال */
  async function pickImages(files: FileList | null) {
    const list = Array.from(files ?? []).slice(0, 6);
    if (!list.length) return;
    if ((files?.length ?? 0) > 6) toast('يمكن إرسال 6 صور كحد أقصى في المرة');
    setUploading(true);
    try {
      const out: string[] = [];
      for (const f of list) out.push(await compressChatImage(f));
      setShots(out);
      setCaption(text.trim());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر قراءة الصورة');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function sendShots() {
    const list = shots;
    const note = caption.trim();
    if (!list.length) return;
    setShots([]);
    setCaption('');
    if (note && note === text.trim()) setText('');
    setUploading(true);
    try {
      for (let i = 0; i < list.length; i++) {
        const r = await api.upload(list[i]);
        await send({ image: r.url, caption: i === 0 ? note : '' });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر إرسال الصورة');
    } finally {
      setUploading(false);
    }
  }

  const voice = useVoiceRecorder((blob, ms) => {
    setUploading(true);
    void new Promise<string>((ok, fail) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => fail(new Error('تعذر قراءة التسجيل'));
      fr.readAsDataURL(blob);
    })
      .then(data => api.upload(data))
      .then(r => send({ audio: r.url, audioMs: ms }))
      .catch(e => toast(e instanceof Error ? e.message : 'تعذر إرسال الرسالة الصوتية'))
      .finally(() => setUploading(false));
  });

  const canManage = !!conv && conv.kind === 'group' && !conv.auto && conv.isAdmin && (role !== 'manager' || perms.manageChat);

  useEffect(() => {
    if (info) void api.media(id).then(setMediaList).catch(() => setMediaList([]));
  }, [info, api, id]);

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
      const cont = !!prev && prev.kind !== 'system' && m.kind !== 'system' && prev.sender.key === m.sender.key && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000;
      out.push({ msg: m, cont, showName: conv?.kind === 'group' && m.sender.key !== me && !cont });
      prev = m;
    }
    return out;
  }, [msgs, conv, me]);

  const subtitle = typing && typing.until > Date.now()
    ? `${conv?.kind === 'group' ? typing.name.split(' ')[0] + ' ' : ''}يكتب الآن…`
    : conv?.kind === 'group'
      ? `${conv.memberCount} عضو`
      : lastSeenText(presence) || (ROLE_LABEL[conv?.other?.role ?? ''] ?? '');
  const pinned = pins[Math.min(pinIndex, Math.max(0, pins.length - 1))];
  const canModerate = role === 'manager' && perms.manageChat;
  const canPin = conv?.kind === 'direct' || !!conv?.isAdmin;
  const selectedMsgs = (msgs ?? []).filter(m => selected.includes(m.id));

  return (
    <div className="t-room">
      {selecting ? (
        <header className="t-room-head t-selbar">
          <button type="button" className="t-icon-btn ghost press" aria-label="إلغاء التحديد" onClick={() => setSelected([])}>
            <I.close size={20} />
          </button>
          <b className="num" style={{ flex: 1 }}>{selected.length} محددة</b>
          {selectedMsgs.some(m => m.body) && (
            <button
              type="button"
              className="t-icon-btn ghost press"
              aria-label="نسخ"
              onClick={() => {
                void navigator.clipboard?.writeText(selectedMsgs.map(m => m.body).filter(Boolean).join('\n')).then(() => toast('نُسخ النص'));
                setSelected([]);
              }}
            >
              {ICON.copy}
            </button>
          )}
          <button type="button" className="t-icon-btn ghost press" aria-label="إعادة توجيه" onClick={() => setForwarding(selected)}>
            {ICON.forward}
          </button>
          <button
            type="button"
            className="t-icon-btn ghost press"
            aria-label="حذف لدي"
            onClick={() => setConfirm({ title: `حذف ${selected.length} لديك؟`, text: 'تختفي من هاتفك فقط وتبقى عند الآخرين.', ok: 'حذف لدي', run: () => void hideMessages(selected) })}
          >
            {ICON.trash}
          </button>
        </header>
      ) : (
        <header className="t-room-head">
          <button type="button" className="t-icon-btn ghost press" aria-label="رجوع" onClick={() => nav(base, { replace: true })}>
            <I.back size={20} />
          </button>
          {conv && <ConvAvatar c={conv} />}
          <button type="button" className="who" style={{ textAlign: 'start', flex: 1 }} onClick={() => setInfo(true)}>
            <b>{conv?.title ?? '…'}</b>
            <small className={typing ? 'typing' : presence?.online ? 'online' : ''}>{subtitle}</small>
          </button>
          <button type="button" className="t-icon-btn ghost press" aria-label="بحث في المحادثة" onClick={() => setSearchOpen(true)}>
            <I.search />
          </button>
        </header>
      )}
      {pinned && !selecting && (
        <button
          type="button"
          className="t-pinbar press-soft"
          onClick={() => {
            haptic('tap');
            void jumpTo(pinned.id);
            setPinIndex(i => (i + 1) % pins.length);
          }}
        >
          {ICON.pin}
          <span>
            <b>رسالة مثبّتة{pins.length > 1 ? ` (${Math.min(pinIndex, pins.length - 1) + 1}/${pins.length})` : ''}</b>
            {msgPreview(pinned)}
          </span>
        </button>
      )}

      <div
        ref={scroller}
        className="t-msgs"
        onScroll={e => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setShowDown(!atBottom.current);
          if (atBottom.current) setNewBelow(0);
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
          ) : r.msg.kind === 'system' ? (
            <span key={r.msg.id} className="t-msg-sys">
              {r.msg.body}
            </span>
          ) : (
            <Fragment key={r.msg.id}>
            {r.msg.id === firstUnread && <span className="t-msg-new">رسائل جديدة</span>}
            <div
              data-mid={r.msg.id}
              className={`t-msg ${r.msg.sender.key === me ? 'mine' : ''} ${r.cont ? 'cont' : ''} ${flash === r.msg.id ? 'flash' : ''} ${selected.includes(r.msg.id) ? 'picked' : ''}`}
              style={{ marginTop: r.cont ? 0 : 6 }}
              onClick={() => {
                if (selecting && !r.msg.deleted && !r.msg.pending) toggleSelect(r.msg);
              }}
              onTouchStart={e => {
                swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, id: r.msg.id };
              }}
              onTouchEnd={e => {
                // سحب أفقي على الرسالة = رد
                const s = swipe.current;
                swipe.current = null;
                if (!s || s.id !== r.msg.id || selecting || r.msg.deleted || r.msg.pending || editing) return;
                const dx = Math.abs(e.changedTouches[0].clientX - s.x);
                const dy = Math.abs(e.changedTouches[0].clientY - s.y);
                if (dx > 70 && dy < 40) {
                  haptic('tap');
                  setReply(r.msg);
                  inputRef.current?.focus();
                }
              }}
            >
              {r.showName && <span className="from">{r.msg.sender.name}</span>}
              <div
                className={`t-bubble ${r.msg.deleted ? 'deleted' : ''}`}
                onContextMenu={e => {
                  e.preventDefault();
                  if (!r.msg.deleted && !r.msg.pending) {
                    haptic('heavy');
                    if (selecting) toggleSelect(r.msg);
                    else setAction(r.msg);
                  }
                }}
                onClick={() => {
                  if (selecting) return;
                  if (!r.msg.deleted && !r.msg.pending && !r.msg.image && !r.msg.audio) setAction(r.msg);
                }}
              >
                {r.msg.deleted ? (
                  'حُذفت هذه الرسالة'
                ) : (
                  <>
                    {r.msg.forwarded && <span className="t-forwarded">{ICON.forward} أُعيد توجيهها</span>}
                    {r.msg.replyTo && (
                      <div
                        className="t-quote"
                        onClick={e => {
                          e.stopPropagation();
                          if (!selecting) void jumpTo(r.msg.replyTo!.id);
                        }}
                      >
                        <b>{r.msg.replyTo.senderName}</b>
                        {r.msg.replyTo.body}
                      </div>
                    )}
                    {r.msg.image && (
                      <ChatImage
                        src={r.msg.image}
                        onOpen={() => setViewer(r.msg.image!)}
                        onLoad={() => atBottom.current && scrollDown()}
                      />
                    )}
                    {r.msg.audio && <VoiceBubble src={r.msg.audio} ms={r.msg.audioMs} />}
                    {r.msg.body}
                  </>
                )}
                <span className="meta num">
                  {r.msg.pinned && <span aria-label="مثبّتة">📌 </span>}
                  {r.msg.edited && 'معدّلة · '}
                  {timeOf(r.msg.createdAt)}
                  {r.msg.sender.key === me && (r.msg.pending ? ' ◷' : otherRead >= r.msg.id ? ' ✓✓' : ' ✓')}
                </span>
              </div>
              {!!r.msg.reactions?.length && (
                <div className="t-reacts">
                  {REACTIONS.filter(e => r.msg.reactions!.some(x => x.emoji === e)).map(e => {
                    const list = r.msg.reactions!.filter(x => x.emoji === e);
                    return (
                      <button
                        key={e}
                        type="button"
                        className={list.some(x => x.key === me) ? 'on' : ''}
                        title={list.map(x => x.name).join('، ')}
                        onClick={ev => {
                          ev.stopPropagation();
                          void react(r.msg, e);
                        }}
                      >
                        {e}
                        {list.length > 1 && <small className="num">{list.length}</small>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            </Fragment>
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

      {showDown && (
        <button
          type="button"
          className="t-godown press"
          aria-label="إلى آخر الرسائل"
          onClick={() => {
            scrollDown(true);
            setNewBelow(0);
          }}
        >
          {ICON.down}
          {newBelow > 0 && <span className="num">{newBelow > 99 ? '99+' : newBelow}</span>}
        </button>
      )}

      <footer className="t-composer">
        {editing && (
          <div className="t-replying">
            {ICON.edit}
            <span>
              تعديل: {msgPreview(editing)}
            </span>
            <button type="button" aria-label="إلغاء التعديل" onClick={stopEdit}>
              <I.close size={16} />
            </button>
          </div>
        )}
        {reply && (
          <div className="t-replying">
            <I.back size={16} />
            <span>
              رد على <b>{reply.sender.name}</b>: {reply.body || (reply.audio ? '🎤 رسالة صوتية' : '📷 صورة')}
            </span>
            <button type="button" aria-label="إلغاء الرد" onClick={() => setReply(null)}>
              <I.close size={16} />
            </button>
          </div>
        )}
        {voice.recording ? (
        <div className="bar t-recbar">
          <button type="button" className="t-send ghost press" aria-label="إلغاء التسجيل" onClick={() => (haptic('warning'), voice.stop(false))}>
            <I.close size={20} />
          </button>
          <div className="t-rec">
            <i />
            <b className="num ltr">{mmss(voice.ms)}</b>
            <span>جارٍ التسجيل…</span>
            {voice.ms > VOICE_MAX_MS - 15_000 && <small>ينتهي قريباً</small>}
          </div>
          <button type="button" className="t-send press" aria-label="إرسال التسجيل" onClick={() => voice.stop(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: 'scaleX(-1)' }}>
              <path d="M3.4 20.4 21 12 3.4 3.6l-.02 6.53L15 12 3.38 13.87z" />
            </svg>
          </button>
        </div>
        ) : (
        <div className="bar">
          <button type="button" className="t-send ghost press" aria-label="إرسال صورة" disabled={uploading || !!editing} onClick={() => fileRef.current?.click()}>
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
            ref={inputRef}
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
          {editing ? (
            <button type="button" className="t-send press" aria-label="حفظ التعديل" disabled={!text.trim() && !editing.image} onClick={() => void saveEdit()}>
              {ICON.check}
            </button>
          ) : text.trim() ? (
            <button type="button" className="t-send press" aria-label="إرسال" onClick={() => void send()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: 'scaleX(-1)' }}>
                <path d="M3.4 20.4 21 12 3.4 3.6l-.02 6.53L15 12 3.38 13.87z" />
              </svg>
            </button>
          ) : (
            <button type="button" className="t-send press" aria-label="تسجيل رسالة صوتية" disabled={uploading} onClick={() => void voice.start()}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
              </svg>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => void pickImages(e.target.files)} />
        </div>
        )}
      </footer>

      <Sheet open={shots.length > 0} onClose={() => setShots([])} title={shots.length > 1 ? `إرسال ${shots.length} صور` : 'إرسال صورة'} subtitle={`بعد الضغط: ${Math.max(1, Math.round(shots.reduce((a, d) => a + dataUrlBytes(d), 0) / 1024))} كيلوبايت`}>
        <div className={`t-shots ${shots.length === 1 ? 'one' : ''}`}>
          {shots.map((d, i) => (
            <div key={i}>
              <img src={d} alt="" />
              <button type="button" aria-label="إزالة" onClick={() => setShots(l => l.filter((_, x) => x !== i))}>
                <I.close size={14} />
              </button>
            </div>
          ))}
        </div>
        <input className="t-input sm" style={{ marginTop: 12 }} placeholder="أضف تعليقاً (اختياري)" maxLength={2000} value={caption} onChange={e => setCaption(e.target.value)} />
        <button type="button" className="t-btn block press" style={{ marginTop: 12 }} onClick={() => void sendShots()}>
          إرسال
        </button>
      </Sheet>

      <Sheet open={!!action} onClose={() => setAction(null)}>
        {action && (
          <div className="t-list flat">
            <div className="t-react-bar">
              {REACTIONS.map(e => (
                <button key={e} type="button" className={action.reactions?.find(r => r.key === me)?.emoji === e ? 'on' : ''} aria-label={`تفاعل ${e}`} onClick={() => void react(action, e)}>
                  {e}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="t-row press-soft"
              onClick={() => {
                setReply(action);
                setAction(null);
                inputRef.current?.focus();
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
            <ActionRow
              icon={ICON.forward}
              title="إعادة توجيه"
              onClick={() => {
                setForwarding([action.id]);
                setAction(null);
              }}
            />
            {action.sender.key === me && !action.audio && !action.forwarded && Date.now() - Date.parse(action.createdAt) < EDIT_WINDOW_MS && (
              <ActionRow
                icon={ICON.edit}
                title="تعديل"
                sub="خلال 24 ساعة من الإرسال"
                onClick={() => {
                  startEdit(action);
                  setAction(null);
                }}
              />
            )}
            {canPin && (
              <ActionRow
                icon={ICON.pin}
                title={action.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
                onClick={() => {
                  const target = action;
                  setAction(null);
                  void api
                    .pin(target.id, !target.pinned)
                    .then(r => {
                      setPins(r.pinned);
                      setPinIndex(0);
                      setMsgs(list => list?.map(x => (x.id === target.id ? { ...x, pinned: !target.pinned } : x)) ?? null);
                    })
                    .catch(e => toast(e instanceof Error ? e.message : 'تعذر التثبيت'));
                }}
              />
            )}
            <ActionRow
              icon={ICON.check}
              title="تحديد"
              sub="لنسخ أو توجيه أو حذف عدة رسائل"
              onClick={() => {
                setSelected([action.id]);
                setAction(null);
              }}
            />
            {(action.sender.key === me || canModerate) && (
              <ActionRow
                icon={<I.info size={18} />}
                title="معلومات الرسالة"
                sub="من قرأها"
                onClick={() => {
                  const target = action;
                  setAction(null);
                  void api
                    .info(target.id)
                    .then(r => setMsgInfo({ msg: target, read: r.read, unread: r.unread }))
                    .catch(e => toast(e instanceof Error ? e.message : 'تعذر الفتح'));
                }}
              />
            )}
            <ActionRow
              icon={ICON.trash}
              danger
              title="حذف لدي"
              sub="تختفي من هاتفك فقط"
              onClick={() => {
                const target = action;
                setAction(null);
                void hideMessages([target.id]);
              }}
            />
            {((action.sender.key === me && Date.now() - Date.parse(action.createdAt) < 24 * 3600_000) || canModerate) && (
              <ActionRow
                icon={ICON.trash}
                danger
                title="حذف للجميع"
                sub={action.sender.key === me ? 'خلال 24 ساعة من الإرسال' : 'صلاحية المدير'}
                onClick={() => {
                  const target = action;
                  setAction(null);
                  setConfirm({
                    title: 'حذف للجميع؟',
                    text: 'تُحذف الرسالة عند كل الأعضاء ولا يمكن استرجاعها.',
                    ok: 'حذف للجميع',
                    run: () =>
                      void api
                        .remove(target.id)
                        .then(() => {
                          setMsgs(list => list?.map(x => (x.id === target.id ? { ...x, deleted: true, body: null, image: null, audio: null, reactions: [] } : x)) ?? null);
                          setPins(list => list.filter(x => x.id !== target.id));
                        })
                        .catch(e => toast(e instanceof Error ? e.message : 'تعذر الحذف')),
                  });
                }}
              />
            )}
          </div>
        )}
      </Sheet>

      <ForwardSheet
        role={role}
        count={forwarding?.length ?? 0}
        open={!!forwarding}
        onClose={() => setForwarding(null)}
        onSend={async convIds => {
          const r = await api.forward(forwarding ?? [], convIds);
          haptic('success');
          toast(r.sent === 1 ? 'أُعيد توجيه الرسالة' : `أُرسلت ${r.sent} رسالة`);
          setForwarding(null);
          setSelected([]);
        }}
      />

      <Sheet
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          setSearchQ('');
          setSearchRows(null);
        }}
        title="بحث في المحادثة"
      >
        <label className="t-search" style={{ marginBottom: 10 }}>
          <I.search />
          <input autoFocus placeholder="اكتب حرفين على الأقل" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        </label>
        {searchRows && !searchRows.length && <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>لا نتائج</p>}
        <div className="t-list flat" style={{ maxHeight: '50vh', overflow: 'auto' }}>
          {(searchRows ?? []).map(m => (
            <button
              key={m.id}
              type="button"
              className="t-row press-soft"
              style={{ width: '100%' }}
              onClick={() => {
                setSearchOpen(false);
                void jumpTo(m.id);
              }}
            >
              <div className="body">
                <div className="sub">
                  {m.sender.name} · {dayLabel(m.createdAt)} {timeOf(m.createdAt)}
                </div>
                <div className="title" style={{ whiteSpace: 'normal' }}>{m.body}</div>
              </div>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!msgInfo} onClose={() => setMsgInfo(null)} title="معلومات الرسالة" subtitle={msgInfo ? `${dayLabel(msgInfo.msg.createdAt)} ${timeOf(msgInfo.msg.createdAt)}` : ''}>
        {msgInfo && (
          <>
            <p className="t-group-label">قرأها ({msgInfo.read.length})</p>
            <div className="t-card pad" style={{ fontSize: 13.5, lineHeight: 1.9, marginBottom: 12 }}>{msgInfo.read.map(p => p.name).join('، ') || 'لا أحد بعد'}</div>
            <p className="t-group-label">لم يقرأها ({msgInfo.unread.length})</p>
            <div className="t-card pad" style={{ fontSize: 13.5, lineHeight: 1.9 }}>{msgInfo.unread.map(p => p.name).join('، ') || 'قرأها الجميع'}</div>
          </>
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
              <div className="t-check" style={{ cursor: 'default' }}>
                <span style={{ flex: 1 }}>تثبيت في أعلى القائمة</span>
                <Switch
                  label="تثبيت"
                  on={!!conv.pinned}
                  onChange={v => {
                    void api.pinConv(id, v).then(setConv).catch(() => undefined);
                  }}
                />
              </div>
              <button
                type="button"
                className="t-check"
                onClick={() => {
                  setInfo(false);
                  setConfirm({
                    title: 'مسح المحادثة؟',
                    text: 'تُمسح الرسائل الحالية من هاتفك فقط وتبقى عند الآخرين.',
                    ok: 'مسح',
                    run: () =>
                      void api
                        .clear(id)
                        .then(() => {
                          setMsgs([]);
                          setPins(list => list);
                          setHasMore(false);
                        })
                        .catch(e => toast(e instanceof Error ? e.message : 'تعذر المسح')),
                  });
                }}
              >
                <span style={{ flex: 1, color: 'var(--bad)' }}>مسح المحادثة لدي</span>
              </button>
            </div>
            {canManage && (
              <div className="t-card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                {renaming == null ? (
                  <button type="button" className="t-check" onClick={() => setRenaming(conv.title)}>
                    <span style={{ flex: 1 }}>اسم المجموعة: <b>{conv.title}</b></span>
                    <small style={{ color: 'var(--brand)', fontWeight: 650 }}>تعديل</small>
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="t-input sm" style={{ flex: 1 }} maxLength={80} autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} />
                    <button
                      type="button"
                      className="t-btn sm press"
                      disabled={!renaming.trim()}
                      onClick={() => {
                        const title = renaming.trim();
                        setRenaming(null);
                        void api.updateGroup(id, { title }).then(setConv).catch(e => toast(e instanceof Error ? e.message : 'تعذر التعديل'));
                      }}
                    >
                      حفظ
                    </button>
                  </div>
                )}
              </div>
            )}
            {mediaList.length > 0 && (
              <section style={{ marginBottom: 12 }}>
                <p className="t-group-label">الصور ({mediaList.length})</p>
                <div className="t-chat-media">
                  {mediaList.slice(0, 18).map(u => (
                    <img key={u} src={mediaUrl(u)} alt="" loading="lazy" onClick={() => setViewer(u)} />
                  ))}
                </div>
              </section>
            )}
            {members.length > 0 && conv.kind === 'group' && (
              <p className="t-group-label">الأعضاء ({members.length})</p>
            )}
            {canManage && (
              <button type="button" className="t-btn soft block sm press" style={{ marginBottom: 8 }} onClick={() => setAdding(true)}>
                إضافة أعضاء
              </button>
            )}
            {members.length > 0 && conv.kind === 'group' && (
              <div className="t-list flat">
                {members.map(p => (
                  <div key={p.key} className="t-row">
                    <Avatar name={p.name} size="sm" />
                    <div className="body">
                      <div className="title">
                        {p.name}
                        {p.key === me ? ' (أنت)' : ''}
                      </div>
                      <div className="sub">
                        {ROLE_LABEL[p.role] ?? p.role}
                        {p.admin ? ' · مشرف المجموعة' : ''}
                      </div>
                    </div>
                    {canManage && p.key !== me && (
                      <button
                        type="button"
                        className="t-icon-btn ghost press"
                        aria-label={`إزالة ${p.name}`}
                        onClick={() =>
                          setConfirm({
                            title: 'إزالة من المجموعة',
                            text: `إزالة ${p.name} من «${conv.title}»؟`,
                            ok: 'إزالة',
                            run: () => void api.updateGroup(id, { remove: [p.key] }).then(() => reloadMembers()).catch(e => toast(e instanceof Error ? e.message : 'تعذرت الإزالة')),
                          })
                        }
                      >
                        <I.close size={17} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {conv.kind === 'group' && !conv.auto && (
              <button
                type="button"
                className="t-btn plain block press"
                style={{ marginTop: 12, color: 'var(--bad)' }}
                onClick={() =>
                  setConfirm({
                    title: 'مغادرة المجموعة',
                    text: `لن تصلك رسائل «${conv.title}» بعد المغادرة.`,
                    ok: 'مغادرة',
                    run: () => {
                      leaving.current = true;
                      void api
                        .leave(id)
                        .then(() => nav(base, { replace: true }))
                        .catch(e => toast(e instanceof Error ? e.message : 'تعذرت المغادرة'));
                    },
                  })
                }
              >
                مغادرة المجموعة
              </button>
            )}
            {canManage && (
              <button
                type="button"
                className="t-btn plain block press"
                style={{ marginTop: 6, color: 'var(--bad)' }}
                onClick={() =>
                  setConfirm({
                    title: 'حذف المجموعة',
                    text: `ستُحذف «${conv.title}» وكل رسائلها وصورها للجميع، ولا يمكن التراجع.`,
                    ok: 'حذف نهائياً',
                    run: () => {
                      leaving.current = true;
                      void api
                        .updateGroup(id, { delete: true })
                        .then(() => nav(base, { replace: true }))
                        .catch(e => toast(e instanceof Error ? e.message : 'تعذر الحذف'));
                    },
                  })
                }
              >
                حذف المجموعة
              </button>
            )}
          </>
        )}
      </Sheet>
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title}>
        {confirm && (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)' }}>{confirm.text}</p>
            <div className="t-actions">
              <button type="button" className="t-btn plain press" onClick={() => setConfirm(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="t-btn danger press"
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  c.run();
                }}
              >
                {confirm.ok}
              </button>
            </div>
          </>
        )}
      </Sheet>
      <AddMembers
        open={adding}
        api={api}
        existing={members.map(m => m.key)}
        onClose={() => setAdding(false)}
        onAdd={keys => {
          setAdding(false);
          void api.updateGroup(id, { add: keys }).then(() => reloadMembers()).catch(e => toast(e instanceof Error ? e.message : 'تعذرت الإضافة'));
        }}
      />
      {viewer && <Lightbox images={[viewer]} start={0} onClose={() => setViewer(null)} />}
    </div>
  );
}
