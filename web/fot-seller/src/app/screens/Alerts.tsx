import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, ErrorLine, I, Screen, Skeleton } from '../kit';

/** تصنيف التبليغات للتصفية */
const FILTERS: { id: string; label: string; test: (n: Notif) => boolean }[] = [
  { id: 'all', label: 'الكل', test: () => true },
  { id: 'unread', label: 'غير مقروء', test: n => !n.readAt },
  { id: 'leave', label: 'الطلبات', test: n => n.type.startsWith('leave') || n.type === 'schedule' },
  { id: 'posts', label: 'الإعلانات', test: n => n.type === 'post' || n.type === 'broadcast' },
  { id: 'attend', label: 'الدوام', test: n => n.type.startsWith('break') || n.type.startsWith('attend') || n.type.startsWith('shift') },
  { id: 'chat', label: 'المحادثات', test: n => n.type.startsWith('chat') },
  { id: 'sales', label: 'المبيعات', test: n => n.type.startsWith('sales') },
];
import { haptic } from '../native';
import { BackBtn, NotifList } from '../parts';
import { managerApi, onLive, staffApi, type Notif, type Role } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * التبليغات — مجمّعة حسب اليوم، غير المقروء مميّز، «قراءة الكل»، تحميل الأقدم،
 * وتصل الجديدة لحظياً من القناة الحية.
 * ───────────────────────────────────────────────────────────────────────────── */

export function Alerts({ role, back }: { role: Role; back?: string }) {
  const nav = useNavigate();
  const api = role === 'manager' ? managerApi : staffApi;
  const [items, setItems] = useState<Notif[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState('all');

  async function load() {
    try {
      const r = await api.notifications();
      setItems(r.items);
      setUnread(r.unread);
      setMore(r.items.length >= 40);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر التحميل');
    }
  }

  useEffect(() => {
    void load();
    return onLive(m => {
      if (m.event === 'notify' && m.data.item) {
        setItems(list => [m.data.item!, ...(list ?? []).filter(x => x.id !== m.data.item!.id)]);
      }
      if (typeof m.data.unread === 'number') setUnread(m.data.unread);
    });
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(n: Notif) {
    haptic('tap');
    if (!n.readAt) {
      setItems(list => list?.map(x => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      void api.read({ ids: [n.id] }).then(r => setUnread(r.unread)).catch(() => undefined);
    }
    if (n.link) nav(role === 'manager' && !n.link.startsWith('/m/') ? `/m${n.link}` : n.link);
  }

  async function readAll() {
    haptic('success');
    setItems(list => list?.map(x => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })) ?? null);
    const r = await api.read({ all: true }).catch(() => null);
    if (r) setUnread(r.unread);
  }

  async function older() {
    if (!items?.length) return;
    setLoadingMore(true);
    try {
      const r = await api.notifications(items[items.length - 1].id);
      // تحديث وظيفي: لا تضيع التبليغات التي وصلت أثناء التحميل
      setItems(list => [...(list ?? []), ...r.items.filter(x => !(list ?? []).some(y => y.id === x.id))]);
      setMore(r.items.length >= 40);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Screen
      title="التبليغات"
      subtitle={unread ? `${unread} غير مقروء` : 'كل شيء مقروء'}
      onRefresh={load}
      start={back ? <BackBtn to={back} /> : undefined}
      end={
        unread > 0 ? (
          <button type="button" className="t-btn soft sm press" onClick={() => void readAll()}>
            <I.check size={16} /> قراءة الكل
          </button>
        ) : undefined
      }
    >
      {err && !items && <ErrorLine text={err} onRetry={() => void load()} />}
      {!items && !err ? (
        <Skeleton h={300} r={20} />
      ) : items && items.length === 0 ? (
        <Empty icon={<I.bell size={30} />} title="لا تبليغات بعد" text="هنا تصلك إعلانات الإدارة، ردود طلباتك، وتعديلات دوامك — فور حدوثها." />
      ) : items ? (
        <>
          <div className="t-scroller" style={{ marginBottom: 10, gap: 8 }}>
            {FILTERS.filter(f => f.id !== 'sales' || role === 'manager').map(f => (
              <button key={f.id} type="button" className={`t-chip press ${filter === f.id ? 'on' : ''}`} style={{ flexShrink: 0 }} onClick={() => (haptic('select'), setFilter(f.id))}>
                {f.label}
              </button>
            ))}
          </div>
          {items.some(FILTERS.find(f => f.id === filter)!.test) ? (
            <NotifList items={items.filter(FILTERS.find(f => f.id === filter)!.test)} onOpen={n => void open(n)} />
          ) : (
            <Empty icon={<I.bell size={28} />} title="لا تبليغات في هذا التصنيف" />
          )}
          {more && (
            <button type="button" className="t-btn plain block sm press" style={{ marginTop: 14 }} disabled={loadingMore} onClick={() => void older()}>
              {loadingMore ? 'جارٍ التحميل…' : 'تبليغات أقدم'}
            </button>
          )}
        </>
      ) : null}
    </Screen>
  );
}
