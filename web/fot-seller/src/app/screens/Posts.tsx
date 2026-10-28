import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Empty, ErrorLine, I, Screen, Segmented, Sheet, Skeleton, toast } from '../kit';
import { haptic } from '../native';
import { BackBtn, Lightbox, PostCard } from '../parts';
import { staffApi, useLoad, type Post } from '../work';

/* ─────────────────────────────────────────────────────────────────────────────
 * الإعلانات والعروض — المثبّت أولاً، تصفية حسب النوع، فتح الإعلان كاملاً
 * مع الصور بملء الشاشة، وتأكيد الاطلاع عند طلب الإدارة.
 * ───────────────────────────────────────────────────────────────────────────── */

type Filter = 'all' | 'unread' | 'offer';

export function Posts({ back }: { back?: string }) {
  const { data, err, loading, reload, setData } = useLoad(() => staffApi.posts(), ['post']);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Post | null>(null);
  const [viewer, setViewer] = useState<{ images: string[]; i: number } | null>(null);
  const [acking, setAcking] = useState(false);

  const list = useMemo(() => {
    const rows = data ?? [];
    if (filter === 'unread') return rows.filter(p => !p.read || (p.requiresAck && !p.acked));
    if (filter === 'offer') return rows.filter(p => p.kind === 'offer');
    return rows;
  }, [data, filter]);
  const unread = (data ?? []).filter(p => !p.read || (p.requiresAck && !p.acked)).length;

  function patch(p: Post) {
    setData(rows => rows?.map(x => (x.id === p.id ? p : x)) ?? null);
    setOpen(o => (o?.id === p.id ? p : o));
  }

  function show(p: Post) {
    haptic('tap');
    setOpen(p);
    if (!p.read) void staffApi.readPost(p.id).then(patch).catch(() => undefined);
  }

  // فتح إعلان من تبليغ (?id=)
  const deep = Number(params.get('id') || 0);
  useEffect(() => {
    if (!deep || !data) return;
    const p = data.find(x => x.id === deep);
    if (p) show(p);
    const next = new URLSearchParams(params);
    next.delete('id');
    setParams(next, { replace: true });
  }, [deep, data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ack() {
    if (!open) return;
    setAcking(true);
    try {
      patch(await staffApi.readPost(open.id, true));
      haptic('success');
      toast('شكراً — تم تأكيد اطلاعك');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر التأكيد');
    } finally {
      setAcking(false);
    }
  }

  return (
    <Screen title="الإعلانات" subtitle={unread ? `${unread} بحاجة لاطلاعك` : 'آخر أخبار وعروض المحل'} onRefresh={reload} start={back ? <BackBtn to={back} /> : undefined}>
      <Segmented
        items={[
          { id: 'all', label: 'الكل' },
          { id: 'unread', label: `جديدة${unread ? ` ${unread}` : ''}` },
          { id: 'offer', label: 'العروض' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <div style={{ marginTop: 14 }}>
        {err && !data && <ErrorLine text={err} onRetry={() => void reload()} />}
        {loading && !data ? (
          <Skeleton h={320} r={26} />
        ) : list.length === 0 ? (
          <Empty icon={<I.megaphone size={30} />} title={filter === 'all' ? 'لا إعلانات بعد' : 'لا شيء هنا'} text="تعليمات الإدارة والعروض الجديدة تظهر هنا مع صورها." />
        ) : (
          list.map(p => <PostCard key={p.id} post={p} onOpen={() => show(p)} onImage={i => setViewer({ images: p.images, i })} />)
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <>
            <PostCard post={open} onImage={i => setViewer({ images: open.images, i })} footer={<div style={{ height: 14 }} />} />
            {open.requiresAck && (
              <div style={{ marginTop: 14 }}>
                {open.acked ? (
                  <div className="t-btn ok block" style={{ pointerEvents: 'none' }}>
                    <I.check /> تم تأكيد اطلاعك
                  </div>
                ) : (
                  <button type="button" className="t-btn block press" disabled={acking} onClick={() => void ack()}>
                    {acking ? <span className="spinner" /> : 'اطّلعت على الإعلان'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </Sheet>
      {viewer && <Lightbox images={viewer.images} start={viewer.i} onClose={() => setViewer(null)} />}
    </Screen>
  );
}
