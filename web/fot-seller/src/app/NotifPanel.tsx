import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { I, Skeleton, useWide } from './kit';
import { haptic } from './native';
import { NotifList } from './parts';
import { managerApi, onLive, staffApi, type Notif, type Role } from './work';

/* ─────────────────────────────────────────────────────────────────────────────
 * جرس التبليغات: على الهاتف يفتح صفحة التبليغات، وعلى الحاسبة لوحة منسدلة بآخر التبليغات
 * (قراءة الكل، فتح التبليغ في مكانه، والجديد يصل لحظياً) دون مغادرة الصفحة.
 * ───────────────────────────────────────────────────────────────────────────── */

export function BellButton({ unread, role, to }: { unread: number; role: Role; to: string }) {
  const desktop = useWide(1024);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const label = unread ? `${unread} تبليغ غير مقروء` : 'التبليغات';
  const dot = unread > 0 && (
    <span key={unread} className="dot num">
      {unread > 9 ? '9+' : unread}
    </span>
  );

  // إغلاق بالنقر خارج اللوحة أو Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!desktop)
    return (
      <Link to={to} className="t-icon-btn t-bell press" aria-label={label} onClick={() => haptic('tap')}>
        <I.bell size={20} />
        {dot}
      </Link>
    );
  return (
    <div className="np-wrap" ref={wrap}>
      <button
        type="button"
        className={`t-icon-btn t-bell press ${open ? 'on' : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="التبليغات"
        onClick={() => (haptic('tap'), setOpen(v => !v))}
      >
        <I.bell size={20} />
        {dot}
      </button>
      {open && <NotifPanel role={role} to={to} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NotifPanel({ role, to, onClose }: { role: Role; to: string; onClose: () => void }) {
  const nav = useNavigate();
  const api = role === 'manager' ? managerApi : staffApi;
  const [items, setItems] = useState<Notif[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [err, setErr] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .notifications()
      .then(r => {
        if (!alive) return;
        setItems(r.items.slice(0, 20));
        setUnread(r.unread);
      })
      .catch(e => alive && setErr(e instanceof Error ? e.message : 'تعذر التحميل'));
    const off = onLive(m => {
      if (m.event === 'notify' && m.data.item) setItems(list => [m.data.item!, ...(list ?? []).filter(x => x.id !== m.data.item!.id)].slice(0, 20));
      if (typeof m.data.unread === 'number') setUnread(m.data.unread);
    });
    return () => {
      alive = false;
      off();
    };
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(n: Notif) {
    haptic('tap');
    if (!n.readAt) {
      setItems(list => list?.map(x => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      void api.read({ ids: [n.id] }).then(r => setUnread(r.unread)).catch(() => undefined);
    }
    onClose();
    if (n.link) nav(role === 'manager' && !n.link.startsWith('/m/') ? `/m${n.link}` : n.link);
    else nav(to);
  }
  async function readAll() {
    haptic('success');
    setItems(list => list?.map(x => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })) ?? null);
    const r = await api.read({ all: true }).catch(() => null);
    if (r) setUnread(r.unread);
  }

  const shown = (items ?? []).filter(n => !onlyUnread || !n.readAt);
  return (
    <div className="np" role="dialog" aria-label="التبليغات">
      <div className="np-head">
        <b>التبليغات</b>
        {unread > 0 && <span className="np-count num">{unread} جديد</span>}
        <span className="grow" />
        {unread > 0 && (
          <button type="button" className="np-link" onClick={() => void readAll()}>
            <I.check size={14} /> قراءة الكل
          </button>
        )}
      </div>
      <div className="np-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!onlyUnread} className={!onlyUnread ? 'on' : ''} onClick={() => setOnlyUnread(false)}>
          الكل
        </button>
        <button type="button" role="tab" aria-selected={onlyUnread} className={onlyUnread ? 'on' : ''} onClick={() => setOnlyUnread(true)}>
          غير مقروء{unread ? ` (${unread})` : ''}
        </button>
      </div>
      <div className="np-body">
        {err && !items ? (
          <p className="np-empty">{err}</p>
        ) : !items ? (
          <div style={{ padding: 12 }}>
            <Skeleton h={64} r={14} />
            <Skeleton h={64} r={14} mt={8} />
            <Skeleton h={64} r={14} mt={8} />
          </div>
        ) : shown.length === 0 ? (
          <p className="np-empty">
            <I.bell size={22} />
            {onlyUnread ? 'قرأت كل التبليغات' : 'لا تبليغات بعد'}
          </p>
        ) : (
          <NotifList items={shown} onOpen={open} />
        )}
      </div>
      <Link to={to} className="np-foot" onClick={onClose}>
        عرض كل التبليغات
        <I.chevron size={15} />
      </Link>
    </div>
  );
}
