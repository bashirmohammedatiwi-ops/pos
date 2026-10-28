import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import type { TeamCommissionProductDto } from '@/api/types';
import { FilterActions, FilterBar, FilterLabel, SegmentedFilter, SummaryStrip, WorkspaceBody, WorkspaceCard } from '@/components/listWorkspace';
import { useToast } from '@/components/Toast';
import { IconRefresh } from '@/components/icons';
import { Badge, Btn, IconButton, Modal, TableSkeleton, useConfirm } from '@/components/ui';
import { ErrorBlock, SearchBox } from '@/components/people/PeopleKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تطبيق الفريق ← منتجات العمولة والصور: صورة لكل منتج عمولة تظهر للبائعين في التطبيق.
 * رفع مفرد، أو دفعة كاملة باسم الملف = الباركود (مثال: 5201234567890.jpg).
 * ───────────────────────────────────────────────────────────────────────────── */

type Filter = 'all' | 'missing' | 'done';

async function compress(file: File, max = 1200): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error(`تعذر قراءة ${file.name}`));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const cache = new Map<string, Promise<string>>();
function HubImg({ url, className }: { url: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!cache.has(url)) cache.set(url, api.teamMediaObjectUrl(url));
    cache
      .get(url)!
      .then(u => alive && setSrc(u))
      .catch(() => cache.delete(url));
    return () => {
      alive = false;
    };
  }, [url]);
  return src ? <img src={src} alt="" className={className} /> : <div className={`${className ?? ''} animate-pulse bg-slate-100`} />;
}

const valueLabel = (p: TeamCommissionProductDto) => (/perc|pct/i.test(p.commissionType ?? '') ? `${p.commissionValue}%` : `${formatNum(p.commissionValue)} د.ع`);

export function TeamProductsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['team-commission-products'], queryFn: api.teamCommissionProducts, retry: 0 });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState<{ total: number; done: number; linked: string[]; unmatched: string[]; failed: string[] } | null>(null);
  const single = useRef<HTMLInputElement>(null);
  const many = useRef<HTMLInputElement>(null);
  const target = useRef<string>('');

  const all = q.data ?? [];
  const rows = useMemo(() => {
    const n = search.trim();
    return all.filter(p => (filter === 'missing' ? !p.image : filter === 'done' ? !!p.image : true) && (!n || p.name.includes(n) || p.barcode.includes(n) || p.groups.some(g => g.includes(n))));
  }, [all, search, filter]);
  const withImg = all.filter(p => p.image).length;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['team-commission-products'] });

  async function uploadOne(barcode: string, file: File) {
    setBusy(b => ({ ...b, [barcode]: true }));
    try {
      const { url } = await api.uploadTeamMedia(await compress(file));
      await api.setTeamProductImage(barcode, url);
      toast.success('حُفظت الصورة — تظهر للبائعين فوراً');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر رفع الصورة');
    } finally {
      setBusy(b => ({ ...b, [barcode]: false }));
    }
  }

  async function uploadMany(files: FileList | null) {
    if (!files?.length) return;
    const known = new Set(all.map(p => p.barcode));
    const list = [...files];
    const state = { total: list.length, done: 0, linked: [] as string[], unmatched: [] as string[], failed: [] as string[] };
    setBulk({ ...state });
    for (const f of list) {
      const bc = f.name.replace(/\.[^.]+$/, '').trim();
      if (!known.has(bc)) {
        state.unmatched.push(f.name);
      } else {
        try {
          const { url } = await api.uploadTeamMedia(await compress(f));
          await api.setTeamProductImage(bc, url);
          state.linked.push(bc);
        } catch {
          state.failed.push(f.name);
        }
      }
      state.done++;
      setBulk({ ...state });
    }
    refresh();
  }

  return (
    <WorkspaceCard>
      <FilterBar>
        <FilterLabel label="العرض">
          <SegmentedFilter
            label="العرض"
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: 'الكل', count: all.length },
              { id: 'missing', label: 'بلا صورة', count: all.length - withImg, tone: all.length - withImg ? 'warn' : undefined },
              { id: 'done', label: 'بصورة', count: withImg },
            ]}
          />
        </FilterLabel>
        <FilterLabel label="بحث">
          <SearchBox value={search} onChange={setSearch} placeholder="اسم، باركود، مجموعة…" />
        </FilterLabel>
        <FilterActions>
          <IconButton label="تحديث" onClick={refresh}>
            <IconRefresh size={15} className={q.isFetching ? 'animate-spin' : ''} />
          </IconButton>
          <Btn variant="secondary" onClick={() => many.current?.click()}>
            رفع دفعة (اسم الملف = الباركود)
          </Btn>
        </FilterActions>
      </FilterBar>
      <SummaryStrip
        loading={q.isLoading}
        cells={[
          { label: 'منتجات العمولة', value: formatNum(all.length), tone: 'brand' },
          { label: 'بصورة', value: formatNum(withImg), tone: 'ok' },
          { label: 'بلا صورة', value: formatNum(all.length - withImg), tone: all.length - withImg ? 'warn' : undefined, onClick: () => setFilter('missing') },
          { label: 'الإنجاز', value: all.length ? `${Math.round((withImg / all.length) * 100)}%` : '—' },
        ]}
      />
      <WorkspaceBody>
        {q.isError ? (
          <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <TableSkeleton rows={8} />
        ) : !rows.length ? (
          <div className="p-10 text-center text-[13px] text-slate-500">{all.length ? 'لا منتجات بهذا الفلتر' : 'لا منتجات عمولة بعد — أضفها من «العمولات» ثم انتظر المزامنة.'}</div>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-auto p-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {rows.map(p => (
              <div key={p.barcode} className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${p.image ? 'border-slate-200' : 'border-dashed border-amber-300'}`}>
                <button
                  type="button"
                  className="relative aspect-square w-full bg-slate-50"
                  onClick={() => {
                    target.current = p.barcode;
                    single.current?.click();
                  }}
                  title="رفع/تغيير الصورة"
                >
                  {p.image ? (
                    <HubImg url={p.image} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[12px] font-semibold text-amber-700">
                      <span className="text-[26px]">＋</span>
                      أضف صورة
                    </span>
                  )}
                  {busy[p.barcode] && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-[12px] font-bold text-brand-700">جارٍ الرفع…</span>}
                </button>
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <div className="line-clamp-2 text-[12.5px] font-semibold leading-5 text-slate-800">{p.name || '—'}</div>
                  <div className="num text-[11px] text-slate-400" dir="ltr" style={{ textAlign: 'right' }}>
                    {p.barcode}
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-1">
                    {p.orphan ? <Badge>خارج العمولة</Badge> : <Badge tone="ok">{valueLabel(p)}</Badge>}
                    {p.groups.slice(0, 1).map(g => (
                      <span key={g} className="truncate text-[10.5px] text-slate-400">
                        {g}
                      </span>
                    ))}
                  </div>
                  {p.image && (
                    <button
                      type="button"
                      className="self-start text-[11px] font-semibold text-red-600 hover:underline"
                      onClick={async () => {
                        if (await confirm({ title: 'إزالة الصورة؟', message: p.name, confirmLabel: 'إزالة' })) {
                          await api.setTeamProductImage(p.barcode, null);
                          refresh();
                        }
                      }}
                    >
                      إزالة الصورة
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </WorkspaceBody>
      <input
        ref={single}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          const f = e.target.files?.[0];
          if (f && target.current) void uploadOne(target.current, f);
          e.target.value = '';
        }}
      />
      <input
        ref={many}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          void uploadMany(e.target.files);
          e.target.value = '';
        }}
      />
      <Modal
        open={!!bulk}
        onClose={() => bulk && bulk.done >= bulk.total && setBulk(null)}
        title="رفع دفعة صور"
        subtitle={bulk ? `${bulk.done} / ${bulk.total}` : ''}
        footer={
          <Btn disabled={!!bulk && bulk.done < bulk.total} onClick={() => setBulk(null)}>
            تم
          </Btn>
        }
      >
        {bulk && (
          <div className="space-y-3 text-[13px]">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(bulk.done / bulk.total) * 100}%` }} />
            </div>
            <p>
              ✓ رُبطت <b>{bulk.linked.length}</b> صورة بمنتجاتها.
            </p>
            {bulk.unmatched.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-2 text-amber-800">
                لا منتج عمولة بهذا الباركود ({bulk.unmatched.length}): <span className="num text-[12px]">{bulk.unmatched.slice(0, 20).join('، ')}</span>
              </div>
            )}
            {bulk.failed.length > 0 && <div className="rounded-lg bg-red-50 p-2 text-red-700">فشل رفع: {bulk.failed.join('، ')}</div>}
            <p className="text-[12px] text-slate-500">سمِّ كل صورة بباركود المنتج، مثل 5201234567890.jpg — وتُضغط تلقائياً قبل الرفع.</p>
          </div>
        )}
      </Modal>
    </WorkspaceCard>
  );
}
