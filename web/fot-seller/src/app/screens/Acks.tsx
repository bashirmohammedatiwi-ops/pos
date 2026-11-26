import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { I, Sheet, toast } from '../kit';
import { cancelAckReminders, haptic, onResume, scheduleAckReminders } from '../native';
import { NotifList } from '../parts';
import { mediaUrl, onLive, relTime, staffApi, type Notif, type PendingAck } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * «بانتظار تأكيدك» — التبليغات والإعلانات التي طلبت الإدارة تأكيد استلامها:
 *   · تظهر أعلى الرئيسية حتى يضغط الموظف «تأكيد الاستلام».
 *   · تُفتح له عند فتح التطبيق ومع كل تذكير، ويصله إشعار متكرر من الخادم حتى يؤكد.
 * مخزن واحد تشترك فيه بطاقة الرئيسية والنافذة المنبثقة.
 * ───────────────────────────────────────────────────────────────────────────── */

type AckState = { items: PendingAck[] | null; nagMinutes: number };
let state: AckState = { items: null, nagMinutes: 10 };
const subs = new Set<() => void>();
const set = (next: AckState) => {
  state = next;
  subs.forEach(f => f());
};
let loading: Promise<void> | null = null;
function loadAcks() {
  loading ??= staffApi
    .acks()
    .then(r => {
      set({ items: r.items, nagMinutes: r.nagMinutes ?? 10 });
      // بلا إشعارات الخادم (Firebase) يذكّر الهاتف نفسه
      if (r.items.length) void scheduleAckReminders(r.items.length, r.items[0].title, r.nagMinutes ?? 10);
      else void cancelAckReminders();
    })
    // خادم أقدم لا يعرف التأكيد: لا شيء ينتظر
    .catch(() => set({ ...state, items: state.items ?? [] }))
    .finally(() => {
      loading = null;
    });
  return loading;
}
function useAckStore() {
  return useSyncExternalStore(
    f => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

async function confirmAck(item: PendingAck) {
  if (item.kind === 'post') await staffApi.readPost(item.id, true);
  else await staffApi.ackNotif(item.id);
  set({ ...state, items: (state.items ?? []).filter(x => x.key !== item.key) });
  void loadAcks();
}

function AckCard({ item, clamp }: { item: PendingAck; clamp?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function ack() {
    if (busy) return;
    setBusy(true);
    try {
      await confirmAck(item);
      haptic('success');
      toast('تم تأكيد استلامك — شكراً');
    } catch (e) {
      haptic('error');
      toast(e instanceof Error ? e.message : 'تعذر التأكيد — حاول مرة أخرى');
      setBusy(false);
    }
  }
  return (
    <article className="t-ack">
      <div className="head">
        <span className="t-tile accent">{item.kind === 'post' ? <I.megaphone size={19} /> : <I.bell size={19} />}</span>
        <div className="from">
          <b>{item.kind === 'post' ? 'إعلان يتطلب اطلاعك' : 'تبليغ يتطلب تأكيدك'}</b>
          {item.from} · {relTime(item.createdAt)}
        </div>
      </div>
      <h3>{item.title}</h3>
      {item.body && <p className={clamp ? 'clamp' : ''}>{item.body}</p>}
      {item.image && <img src={mediaUrl(item.image)} alt="" loading="lazy" />}
      {item.kind === 'post' && clamp && (
        <Link to={`/posts?id=${item.id}`} style={{ display: 'inline-block', marginTop: 8, fontSize: 13, fontWeight: 650, color: 'var(--accent-ink)' }} onClick={() => haptic('tap')}>
          فتح الإعلان كاملاً
        </Link>
      )}
      <button type="button" className="t-btn block press" disabled={busy} onClick={() => void ack()}>
        {busy ? (
          <span className="spinner" />
        ) : (
          <>
            <I.check size={18} /> {item.kind === 'post' ? 'اطّلعت — تأكيد' : 'تأكيد الاستلام'}
          </>
        )}
      </button>
    </article>
  );
}

/** قسم الرئيسية: كل ما ينتظر تأكيد الموظف */
export function AckCenter() {
  const { items } = useAckStore();
  const [all, setAll] = useState(false);
  useEffect(() => {
    void loadAcks();
  }, []);
  if (!items?.length) return null;
  // بطاقة واحدة ظاهرة كي لا تدفع بقية الرئيسية للأسفل؛ الباقي بضغطة
  const shown = all ? items : items.slice(0, 1);
  return (
    <section className="t-section" style={{ marginTop: 0, marginBottom: 16 }} id="acks">
      <div className="t-section-head">
        <h2>بانتظار تأكيدك</h2>
        <small className="num">{items.length}</small>
      </div>
      {shown.map(i => (
        <AckCard key={i.key} item={i} clamp />
      ))}
      {items.length > shown.length && (
        <button type="button" className="t-btn soft block sm press" style={{ marginTop: 10 }} onClick={() => (haptic('tap'), setAll(true))}>
          عرض الباقي ({items.length - shown.length})
        </button>
      )}
      <p className="t-ack-hint">يصلك تذكير متكرر حتى تؤكد الاستلام</p>
    </section>
  );
}

/**
 * يعمل في كل الصفحات: يحمّل ما ينتظر التأكيد ويفتحه أمام الموظف عند فتح التطبيق،
 * عند وصول تبليغ جديد يتطلب تأكيداً، ومع كل تذكير من الخادم.
 */
export function AckGate() {
  const { items, nagMinutes } = useAckStore();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const shown = useRef(new Set<string>());

  useEffect(() => {
    void loadAcks();
    const offLive = onLive(m => {
      if (m.event === 'nag') {
        haptic('warning');
        void loadAcks().then(() => state.items?.length && setOpen(true));
      } else if (m.event === 'post' || m.event === 'ack' || (m.event === 'notify' && m.data.item?.requiresAck)) void loadAcks();
    });
    let offResume: (() => void) | undefined;
    void onResume(() => {
      shown.current.clear();
      void loadAcks();
    }).then(f => (offResume = f));
    // احتياط إن انقطعت القناة الحية
    const id = window.setInterval(() => void loadAcks(), 5 * 60_000);
    return () => {
      offLive();
      offResume?.();
      window.clearInterval(id);
    };
  }, []);

  // جديد لم يُعرض في هذه الجلسة ← يُفتح مرة واحدة
  useEffect(() => {
    if (!items?.length) {
      setOpen(false);
      return;
    }
    const fresh = items.filter(i => !shown.current.has(i.key));
    if (!fresh.length) return;
    fresh.forEach(i => shown.current.add(i.key));
    setOpen(true);
  }, [items]);

  // الضغط على الإشعار يفتح «/?ack=1»
  useEffect(() => {
    if (params.get('ack') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('ack');
    setParams(next, { replace: true });
    void loadAcks().then(() => state.items?.length && setOpen(true));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = items?.[0];
  return (
    <Sheet
      open={open && !!first}
      onClose={() => setOpen(false)}
      title={items && items.length > 1 ? `${items.length} تبليغات بانتظار تأكيدك` : 'بانتظار تأكيدك'}
      subtitle={`يتكرر التذكير كل ${nagMinutes} دقائق حتى تؤكد`}
    >
      {first && <AckCard key={first.key} item={first} />}
      {items && items.length > 1 && (
        <button
          type="button"
          className="t-btn plain block sm press"
          style={{ marginTop: 10 }}
          onClick={() => {
            setOpen(false);
            nav('/');
          }}
        >
          عرض الكل في الرئيسية ({items.length})
        </button>
      )}
    </Sheet>
  );
}

/** آخر التبليغات غير المقروءة في الرئيسية */
export function HomeAlerts() {
  const nav = useNavigate();
  const pending = useAckStore().items;
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      staffApi
        .notifications()
        .then(r => {
          if (!alive) return;
          // ما يتطلب تأكيداً له بطاقته في الأعلى
          setItems(r.items.filter(n => !n.readAt && !(n.requiresAck && !n.ackAt)).slice(0, 4));
          setUnread(r.unread);
        })
        .catch(() => undefined);
    void load();
    const off = onLive(m => {
      if (m.event === 'notify' || m.event === 'unread' || m.event === 'ack') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  // إعلان ينتظر التأكيد له بطاقته في الأعلى — لا يتكرر هنا
  const waiting = new Set((pending ?? []).filter(i => i.kind === 'post').map(i => i.id));
  const list = items.filter(n => !(n.type === 'post' && waiting.has(Number(n.data?.postId))));
  if (!list.length) return null;

  function open(n: Notif) {
    haptic('tap');
    setItems(list => list.filter(x => x.id !== n.id));
    void staffApi.read({ ids: [n.id] }).catch(() => undefined);
    if (n.link) nav(n.link);
  }
  return (
    <section className="t-section" style={{ marginTop: 0, marginBottom: 16 }}>
      <div className="t-section-head">
        <h2>تبليغات جديدة</h2>
        <Link to="/alerts" className="more" onClick={() => haptic('tap')}>
          الكل{unread > list.length ? ` (${unread})` : ''}
        </Link>
      </div>
      <div className="t-home-alerts">
        <NotifList items={list} onOpen={open} />
      </div>
    </section>
  );
}
