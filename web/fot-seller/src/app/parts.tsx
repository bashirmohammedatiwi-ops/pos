import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Badge, I, toast } from './kit';
import { haptic, pushBack, statusOnHero } from './native';
import { POST_KIND, STATUS_LABEL, compressImage, dateShort, dayGroup, mediaUrl, relTime, type LeaveReq, type Notif, type Post } from './work';

/* ─────────────────────────────────────────────────────────────────────────────
 * أجزاء مشتركة لوحدات العمل: شبكة الصور، العارض بملء الشاشة، رفع الصور،
 * زر الرجوع، بطاقة الإعلان، قائمة التبليغات، شارة حالة الطلب.
 * ───────────────────────────────────────────────────────────────────────────── */

export function BackBtn({ to }: { to?: string }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      className="t-icon-btn press"
      aria-label="رجوع"
      onClick={() => {
        haptic('tap');
        if (to) nav(to);
        else if (window.history.length > 1) nav(-1);
        else nav('/');
      }}
    >
      <I.back size={20} />
    </button>
  );
}

/* ═════════════ الصور ═════════════ */
export function Gallery({ images, onOpen }: { images: string[]; onOpen: (i: number) => void }) {
  if (!images.length) return null;
  const shown = images.slice(0, 4);
  const n = shown.length;
  return (
    <div className={`t-gallery n${n}`}>
      {shown.map((u, i) => (
        <span
          key={u}
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation();
            haptic('tap');
            onOpen(i);
          }}
        >
          <img src={mediaUrl(u)} alt="" loading="lazy" decoding="async" />
          {i === 3 && images.length > 4 && <span className="more num">+{images.length - 4}</span>}
        </span>
      ))}
    </div>
  );
}

export function Lightbox({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const off = pushBack(() => close.current());
    statusOnHero(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const el = track.current;
      if (el) el.scrollLeft = start * el.clientWidth;
    });
    return () => {
      off();
      statusOnHero(false);
      document.body.style.overflow = prev;
    };
  }, [start]);
  return createPortal(
    <div className="t-lightbox" role="dialog" aria-modal="true">
      <div className="t-lightbox-top">
        <button type="button" aria-label="إغلاق" onClick={() => close.current()}>
          <I.close size={20} />
        </button>
        <span className="num">
          {i + 1} / {images.length}
        </span>
        <span style={{ width: 42 }} />
      </div>
      <div
        ref={track}
        dir="ltr"
        className="t-lightbox-track"
        onScroll={e => {
          const el = e.currentTarget;
          setI(Math.min(images.length - 1, Math.round(Math.abs(el.scrollLeft) / el.clientWidth)));
        }}
      >
        {images.map(u => (
          <div key={u}>
            <img src={mediaUrl(u)} alt="" />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="t-lightbox-dots">
          {images.map((u, k) => (
            <i key={u} className={k === i ? 'on' : ''} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** رفع صور مع ضغطها في الهاتف أولاً (حد أقصى للعدد). */
export function ImagePicker({
  value,
  onChange,
  upload,
  max = 6,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  upload: (dataUrl: string) => Promise<{ url: string }>;
  max?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, Math.max(0, max - value.length));
    setBusy(list.length);
    const added: string[] = [];
    for (const f of list) {
      try {
        const data = await compressImage(f);
        const r = await upload(data);
        added.push(r.url);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'تعذر رفع الصورة');
      } finally {
        setBusy(b => b - 1);
      }
    }
    if (added.length) {
      haptic('success');
      onChange([...value, ...added]);
    }
    if (input.current) input.current.value = '';
  }
  return (
    <div className="t-uploads">
      {value.map(u => (
        <div key={u} className="item">
          <img src={mediaUrl(u)} alt="" />
          <button type="button" aria-label="إزالة" onClick={() => onChange(value.filter(x => x !== u))}>
            <I.close size={14} />
          </button>
        </div>
      ))}
      {Array.from({ length: busy }, (_, k) => (
        <div key={`b${k}`} className="item">
          <div className="busy">
            <span />
          </div>
        </div>
      ))}
      {value.length + busy < max && (
        <button type="button" className="add press" aria-label="إضافة صورة" onClick={() => input.current?.click()}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <rect x="3.5" y="5" width="17" height="14" rx="3" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m20.5 16-4.5-4.5L7 19.5M18 2.5v5M15.5 5h5" />
          </svg>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple={max > 1} hidden onChange={e => void pick(e.target.files)} />
    </div>
  );
}

/* ═════════════ الإعلان ═════════════ */
export function PostCard({ post, onOpen, onImage, footer }: { post: Post; onOpen?: () => void; onImage: (i: number) => void; footer?: ReactNode }) {
  const kind = POST_KIND[post.kind] ?? POST_KIND.news;
  return (
    <article
      className={`t-post ${onOpen ? 'press' : ''} ${!post.read && post.read !== undefined && !footer ? 'unread' : ''}`}
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
    >
      <div className="t-post-head">
        <span className={`t-tile ${kind.tone}`}>
          <I.megaphone size={19} />
        </span>
        <div className="meta">
          <b>{post.createdBy?.replace(/^manager:/, '') || 'الإدارة'}</b>
          {relTime(post.createdAt)}
        </div>
        {post.pinned && <Badge tone="accent">📌 مثبّت</Badge>}
        <Badge tone={kind.tone || undefined}>{kind.label}</Badge>
      </div>
      <h3>{post.title}</h3>
      {post.body && <p className={`text ${onOpen ? 'clamp' : ''}`}>{post.body}</p>}
      <Gallery images={post.images} onOpen={onImage} />
      {footer ?? (
        <div className="t-post-foot">
          <span className="grow">{post.expiresAt ? `ينتهي ${dateShort(post.expiresAt)}` : ''}</span>
          {post.requiresAck &&
            (post.acked ? (
              <Badge tone="ok">
                <I.check size={13} /> اطّلعت
              </Badge>
            ) : (
              <Badge tone="warn">بانتظار تأكيد اطلاعك</Badge>
            ))}
        </div>
      )}
    </article>
  );
}

/* ═════════════ التبليغات ═════════════ */
const NOTIF_ICON: Record<string, { icon: ReactNode; tone: string }> = {
  post: { icon: <I.megaphone size={19} />, tone: '' },
  broadcast: { icon: <I.bell size={19} />, tone: 'accent' },
  'leave.new': { icon: <I.calendar size={19} />, tone: 'accent' },
  'leave.approved': { icon: <I.check size={18} />, tone: 'ok' },
  'leave.rejected': { icon: <I.close size={18} />, tone: 'bad' },
  schedule: { icon: <I.calendar size={19} />, tone: '' },
};

export function NotifList({ items, onOpen }: { items: Notif[]; onOpen: (n: Notif) => void }) {
  const groups: [string, Notif[]][] = [];
  for (const n of items) {
    const g = dayGroup(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(n);
    else groups.push([g, [n]]);
  }
  return (
    <>
      {groups.map(([g, list]) => (
        <section key={g}>
          <p className="t-group-label">{g}</p>
          <div className="t-list">
            {list.map(n => {
              const ic = NOTIF_ICON[n.type] ?? NOTIF_ICON.broadcast;
              return (
                <button key={n.id} type="button" className={`t-notif press-soft ${n.readAt ? '' : 'unread'}`} onClick={() => onOpen(n)}>
                  {n.image ? <img className="thumb" src={mediaUrl(n.image)} alt="" loading="lazy" /> : <span className={`t-tile ${ic.tone}`}>{ic.icon}</span>}
                  <div className="body">
                    <div className="title">{n.title}</div>
                    {n.body && <div className="text">{n.body}</div>}
                    <div className="when">{relTime(n.createdAt)}</div>
                  </div>
                  {!n.readAt && <span className="t-unread-dot" aria-label="غير مقروء" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/* ═════════════ طلبات الإجازة ═════════════ */
export function StatusBadge({ status }: { status: LeaveReq['status'] }) {
  const tone = status === 'approved' ? 'ok' : status === 'rejected' ? 'bad' : status === 'pending' ? 'warn' : 'mute';
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

export const LEAVE_ICON: Record<string, ReactNode> = {
  swap: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4 3.5 7.5 7 11M3.5 7.5H17M17 13l3.5 3.5L17 20M20.5 16.5H7" />
    </svg>
  ),
  day: <I.calendar size={20} />,
  sick: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  urgent: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
  hours: <I.clock size={20} />,
};
