import { Portal } from '@/components/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { OfferDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Badge, Btn, Field, Input, Loading, Modal, Skeleton, Switch, useConfirm } from '@/components/ui';
import {
  matchesStatusFilter,
  OffersListPanel,
  type OfferStatusFilter,
} from '@/components/offers/OffersListPanel';
import type { OfferFolderFilter } from '@/components/offers/OfferFoldersSidebar';
import {
  matchesTypeFilter,
  OfferStatusPill,
  OfferTypeIcon,
  useOfferPeriods,
  type OfferTypeFilter,
} from '@/components/offers/offerVisuals';
import type { ScopeStandaloneItem, ScopeTreeCard } from '@/components/scope/TreeScopeEditor';
import {
  emptyOfferScopeOps,
  offerScopeOpsCount,
  OfferScopeEditor,
  type OfferScopeOps,
} from '@/components/offers/OfferScopeEditor';
import {
  emptyPricedGroupOps,
  OfferPricedGroupEditor,
  pricedGroupOpsCount,
  type PricedGroupOps,
} from '@/components/offers/OfferPricedGroupEditor';
import { OFFER_PRICE_STEP, OFFER_TYPE, offerTypeLabel } from '@/lib/offers';
import {
  bundleRequiredOpsCount,
  emptyBundleRequiredOps,
  OfferBundleRequiredEditor,
  type BundleRequiredOps,
} from '@/components/offers/OfferBundleRequiredEditor';
import { OfferFolderSelect } from '@/components/offers/OfferFoldersSidebar';
import {
  bundleConditionsError,
  DEFAULT_BUNDLE_CONDITIONS,
  normalizeBundleConditions,
  OfferBundleConditionsEditor,
  sameBundleConditions,
} from '@/components/offers/OfferBundleConditionsEditor';
import type { OfferBundleConditionsDto } from '@/api/types';
import { IconCheck, IconChevronRight, IconPercent, IconPlus, IconShield, IconTag, IconTrash } from '@/components/icons';
import { useScrollLock } from '@/hooks/useScrollLock';

const OFFERS_UI_KEY = 'fot_offers_ui_v3';
const STATUS_VALUES: OfferStatusFilter[] = ['all', 'active', 'expiring', 'expired', 'off'];
const TYPE_VALUES: OfferTypeFilter[] = ['all', 'percent', 'bundle', 'priced'];

function readSession(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch { /* ignore */ }
}

export function OffersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OfferStatusFilter>(() => {
    const v = readSession(`${OFFERS_UI_KEY}:status`) as OfferStatusFilter | null;
    return v && STATUS_VALUES.includes(v) ? v : 'all';
  });
  const [typeFilter, setTypeFilter] = useState<OfferTypeFilter>(() => {
    const v = readSession(`${OFFERS_UI_KEY}:type`) as OfferTypeFilter | null;
    return v && TYPE_VALUES.includes(v) ? v : 'all';
  });
  const [folderFilter, setFolderFilter] = useState<OfferFolderFilter>(() => {
    const raw = readSession(`${OFFERS_UI_KEY}:folder`);
    if (raw === 'ungrouped') return 'ungrouped';
    if (raw === 'all' || !raw) return 'all';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 'all';
  });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [seedDiscount, setSeedDiscount] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => writeSession(`${OFFERS_UI_KEY}:status`, statusFilter), [statusFilter]);
  useEffect(() => writeSession(`${OFFERS_UI_KEY}:type`, typeFilter), [typeFilter]);
  useEffect(() => writeSession(`${OFFERS_UI_KEY}:folder`, String(folderFilter)), [folderFilter]);

  useEffect(() => {
    const stored = readSession('fot_admin_offer');
    const id = Number(params.get('id') || stored || 0);
    if (id > 0) {
      setEditingId(id);
      try { sessionStorage.removeItem('fot_admin_offer'); } catch { /* ignore */ }
    }
    const q = params.get('q');
    if (q) setSearch(q);
    if (params.get('new') === '1') setCreating(true);
  }, [params]);

  const offersQ = useQuery({
    queryKey: ['offers'],
    queryFn: () => api.offers(),
    staleTime: 60_000,
  });

  const items = useMemo(() => offersQ.data?.items ?? [], [offersQ.data]);
  const { periods, loading: periodsLoading } = useOfferPeriods(items);

  useEffect(() => {
    if (editingId == null || offersQ.isLoading || !offersQ.data) return;
    if (!items.some(o => o.id === editingId)) setEditingId(null);
  }, [editingId, items, offersQ.isLoading, offersQ.data]);

  useEffect(() => {
    if (editingId != null && offersQ.isError) setEditingId(null);
  }, [editingId, offersQ.isError]);

  const offers = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items
      .filter(o => matchesStatusFilter(o, statusFilter, periods.get(o.id)))
      .filter(o => matchesTypeFilter(o, typeFilter))
      .filter(o => !s
        || o.name.toLowerCase().includes(s)
        || String(o.id).includes(s)
        || (o.folderName ?? '').toLowerCase().includes(s))
      .filter(o => {
        if (folderFilter === 'all') return true;
        if (folderFilter === 'ungrouped') return !o.folderId;
        return o.folderId === folderFilter;
      });
  }, [items, search, statusFilter, typeFilter, folderFilter, periods]);

  const editing = items.find(o => o.id === editingId) ?? null;

  async function invalidateOffers() {
    await qc.invalidateQueries({ queryKey: ['offers'] });
    await qc.invalidateQueries({ queryKey: ['offer-scope'] });
    await qc.invalidateQueries({ queryKey: ['offer-details'] });
    await qc.invalidateQueries({ queryKey: ['offers-stats'] });
    await qc.invalidateQueries({ queryKey: ['offer-folders'] });
  }

  const toggle = useMutation({
    mutationFn: (o: OfferDto) => api.setOfferEnabled(o.id, !o.enabled),
    onSuccess: async (_, o) => {
      toast.success(o.enabled ? `أُوقف «${o.name}»` : `فُعّل «${o.name}» على نقاط البيع`);
      await invalidateOffers();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  async function requestToggle(o: OfferDto) {
    const ok = await confirm(o.enabled
      ? {
          title: 'إيقاف العرض؟',
          message: `سيتوقف تطبيق «${o.name}» على نقاط البيع بعد المزامنة التالية.`,
          confirmLabel: 'إيقاف',
          danger: true,
        }
      : {
          title: 'تفعيل العرض؟',
          message: `سيُطبَّق «${o.name}» على نقاط البيع بعد المزامنة التالية.`,
          confirmLabel: 'تفعيل',
        });
    if (ok) toggle.mutate(o);
  }

  const remove = useMutation({
    mutationFn: (o: OfferDto) => api.deleteOffer(o.id),
    onMutate: o => setBusyIds(prev => new Set(prev).add(o.id)),
    onSettled: (_, __, o) => setBusyIds(prev => { const next = new Set(prev); next.delete(o.id); return next; }),
    onSuccess: async (_, o) => {
      toast.success(`حُذف «${o.name}»`);
      await invalidateOffers();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  async function requestDelete(o: OfferDto) {
    const ok = await confirm({
      title: 'حذف العرض نهائياً؟',
      message: `سيُحذف «${o.name}» وكل أصنافه وأشجاره. لا يمكن التراجع.`,
      confirmLabel: 'حذف العرض',
      danger: true,
    });
    if (ok) remove.mutate(o);
  }

  // نسخ عرض: ينشئ عرضاً متوقفاً بنفس النوع والمحتوى والفترة ثم يفتحه للتعديل
  const duplicate = useMutation({
    mutationFn: async (o: OfferDto) => {
      const [scope, details] = await Promise.all([api.offerScope(o.id), api.offerDetails(o.id)]);
      let createdId: number | null = null;
      let skipped = 0;
      try {
        const created = await api.createOffer({
          name: `نسخة من ${o.name}`,
          priority: o.priority,
          type: o.type,
          enabled: false,
          folderId: o.folderId ?? undefined,
        });
        createdId = created.id;
        if (o.type === OFFER_TYPE.bundle) {
          // نسخ شرط التفعيل (كل المواد / عدد منها …) — خادم أقدم بلا الخدمة يُتجاهل
          const cond = await api.offerBundleConditions(o.id).catch(() => null);
          if (cond) await api.saveOfferBundleConditions(created.id, normalizeBundleConditions(cond)).catch(() => undefined);
        }
        const dates = scope.unlimited !== false
          ? { fromDate: null, toDate: null, unlimited: true }
          : { fromDate: scope.fromDate ?? null, toDate: scope.toDate ?? null, unlimited: false };
        const treeSeqs = new Set(scope.trees.map(t => t.treeSeq));
        for (const t of scope.trees) {
          await api.addOfferTree(created.id, { treeSeq: t.treeSeq, discountPercent: t.discount, ...dates });
        }
        for (const d of details) {
          if (d.itemId == null) continue;
          const fromTree = d.sourceTreeSeq != null && treeSeqs.has(d.sourceTreeSeq);
          try {
            if (fromTree) {
              if (d.excluded) await api.setOfferArticleExcluded(created.id, d.itemId, true);
              continue;
            }
            if (d.excluded) continue;
            await api.addOfferDetail(created.id, {
              itemId: d.itemId,
              discount: d.discount,
              discountType: d.discountType,
              detailRole: d.detailRole,
              ...dates,
            });
          } catch {
            // صنف لم يعد موجوداً مثلاً — نتخطاه ونكمل النسخ
            skipped++;
          }
        }
        return { id: created.id, skipped };
      } catch (e) {
        // فشل جوهري: نحذف النسخة الجزئية حتى لا تتراكم نسخ ناقصة
        if (createdId != null) {
          try { await api.deleteOffer(createdId); } catch { /* ignore */ }
        }
        throw e;
      }
    },
    onMutate: o => setBusyIds(prev => new Set(prev).add(o.id)),
    onSettled: async (_, err, o) => {
      setBusyIds(prev => { const next = new Set(prev); next.delete(o.id); return next; });
      // عند النجاح يُحدَّث في onSuccess قبل فتح النسخة
      if (err) await invalidateOffers();
    },
    onSuccess: async ({ id, skipped }) => {
      if (skipped > 0) toast.success(`تم النسخ مع تخطي ${skipped} صنف — راجع النسخة المتوقفة ثم فعّلها`);
      else toast.success('أُنشئت نسخة متوقفة — راجعها ثم فعّلها');
      await invalidateOffers();
      setSeedDiscount(null);
      setEditingId(id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر نسخ العرض'),
  });

  async function requestDuplicate(o: OfferDto) {
    const ok = await confirm({
      title: 'نسخ العرض؟',
      message: `ستُنشأ نسخة متوقفة من «${o.name}» بنفس الأصناف والأشجار والفترة، وتُفتح للتعديل.`,
      confirmLabel: 'إنشاء نسخة',
    });
    if (ok) duplicate.mutate(o);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OffersListPanel
        items={items}
        offers={offers}
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        loading={offersQ.isLoading}
        fetching={offersQ.isFetching}
        error={offersQ.isError}
        onRefresh={() => {
          void offersQ.refetch();
          void qc.invalidateQueries({ queryKey: ['offer-period'] });
          void qc.invalidateQueries({ queryKey: ['offers-stats'] });
        }}
        onCreate={() => setCreating(true)}
        onEdit={id => { setSeedDiscount(null); setEditingId(id); }}
        onToggle={o => void requestToggle(o)}
        toggling={toggle.isPending}
        folderFilter={folderFilter}
        onFolderFilterChange={setFolderFilter}
        periods={periods}
        periodsLoading={periodsLoading}
        onDuplicate={o => void requestDuplicate(o)}
        onDelete={o => void requestDelete(o)}
        busyIds={busyIds}
      />

      <NewOfferModal
        open={creating}
        onClose={() => setCreating(false)}
        defaultFolderId={typeof folderFilter === 'number' ? folderFilter : null}
        onCreated={(id, discount) => {
          setSeedDiscount(discount ?? null);
          setCreating(false);
          setEditingId(id);
          void invalidateOffers();
        }}
      />

      {editingId != null && !editing && offersQ.isLoading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-50">
          <Loading />
        </div>
      )}
      {editing && (
        <OfferEditorModal
          key={editing.id}
          offer={editing}
          open
          initialDiscount={seedDiscount}
          onClose={() => { setEditingId(null); setSeedDiscount(null); }}
          onChanged={invalidateOffers}
        />
      )}
    </div>
  );
}

/* ═════════════════════════ إنشاء عرض جديد ═════════════════════════ */

const TYPE_CHOICES = [
  {
    type: OFFER_TYPE.percent,
    title: 'خصم نسبة %',
    desc: 'خصم موحّد على أشجار أو منتجات مختارة.',
    Icon: IconPercent,
    tile: 'bg-brand-50 text-brand-700',
  },
  {
    type: OFFER_TYPE.bundle,
    title: 'عرض مشروط',
    desc: 'خصم على أصناف عند وجود أصناف أخرى في الفاتورة.',
    Icon: IconShield,
    tile: 'bg-sky-50 text-sky-700',
  },
  {
    type: OFFER_TYPE.pricedGroup,
    title: 'أسعار فردية',
    desc: 'لكل منتج سعر بيع أو نسبة خصم مستقلة.',
    Icon: IconTag,
    tile: 'bg-violet-50 text-violet-700',
  },
] as const;

function NewOfferModal({
  open,
  onClose,
  onCreated,
  defaultFolderId = null,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number, discount?: string) => void;
  defaultFolderId?: number | null;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState('10');
  const [type, setType] = useState<number>(OFFER_TYPE.percent);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDiscount('10');
    setType(OFFER_TYPE.percent);
  }, [open]);

  const pct = Number(discount);
  const discountValid = type !== OFFER_TYPE.percent || (Number.isFinite(pct) && pct > 0 && pct <= 100);

  const create = useMutation({
    mutationFn: () => api.createOffer({
      name: name.trim() || (type === OFFER_TYPE.percent ? `خصم ${discount}%` : offerTypeLabel(type)),
      priority: 100,
      type,
      enabled: true,
      folderId: defaultFolderId ?? undefined,
    }),
    onSuccess: r => {
      toast.success('أُنشئ العرض — أضف الأشجار والمنتجات ثم احفظ');
      onCreated(r.id, type === OFFER_TYPE.percent ? discount : undefined);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإنشاء'),
  });

  function submit() {
    if (!discountValid || create.isPending) return;
    create.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={<IconPlus size={18} />}
      title="عرض جديد"
      subtitle="اختر النوع والاسم — ثم تضيف الأشجار والمنتجات في المحرر"
      footer={
        <>
          <span className="text-[11.5px] text-slate-500">Enter للإنشاء · Esc للإلغاء</span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn loading={create.isPending} disabled={!discountValid} onClick={submit}>إنشاء ومتابعة التعديل</Btn>
          </div>
        </>
      }
    >
      <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-5">
        <section>
          <p className="mb-2 text-[12px] font-bold text-slate-500">١. نوع العرض</p>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="نوع العرض">
            {TYPE_CHOICES.map(c => {
              const active = type === c.type;
              return (
                <button
                  key={c.type}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(c.type)}
                  className={`relative rounded-xl border p-3 text-right transition ${
                    active ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {active && (
                    <span className="absolute end-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                      <IconCheck size={12} />
                    </span>
                  )}
                  <span className={`icon-tile mb-2 h-9 w-9 rounded-xl ${c.tile}`}><c.Icon size={16} /></span>
                  <span className="block text-[13.5px] font-bold text-header">{c.title}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-5 text-slate-500">{c.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <p className="mb-2 text-[12px] font-bold text-slate-500">٢. التفاصيل</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم العرض" hint="اختياري — يُقترح اسم تلقائياً إن تُرك فارغاً">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={type === OFFER_TYPE.percent ? `خصم ${discount}%` : offerTypeLabel(type)}
                autoFocus
              />
            </Field>
            {type === OFFER_TYPE.percent && (
              <Field
                label="نسبة الخصم الافتراضية"
                hint={discountValid
                  ? `يُقرَّب سعر البيع بعد الخصم لأقرب ${formatNum(OFFER_PRICE_STEP)} دينار.`
                  : <span className="text-red-600">أدخل نسبة بين 1 و 100</span>}
              >
                <div className="flex gap-1.5">
                  <div className="relative w-24 shrink-0">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={discount}
                      onChange={e => setDiscount(e.target.value)}
                      className="num !pe-7 text-center font-bold"
                      aria-invalid={!discountValid}
                    />
                    <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">%</span>
                  </div>
                  {[10, 15, 20, 25].map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDiscount(String(p))}
                      className={`num h-9 flex-1 rounded-lg border text-[12px] font-bold transition ${
                        pct === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </section>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/* ═════════════════════════ محرر العرض ═════════════════════════ */

function SegButtons<T extends string | number>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={label}>
      {items.map(i => (
        <button
          key={String(i.id)}
          type="button"
          aria-pressed={value === i.id}
          onClick={() => onChange(i.id)}
          className={`h-full rounded-md px-3 text-[12px] font-semibold transition ${
            value === i.id ? 'bg-white text-header shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-header'
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function SettingsGroup({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 ${className}`}>
      <h3 className="mb-2 text-[11.5px] font-bold text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function MiniLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">{children}</span>;
}

export function OfferEditorModal({
  offer,
  open,
  onClose,
  onChanged,
  initialDiscount = null,
}: {
  offer: { id: number; name: string; priority: number; type: number; enabled: boolean; folderId?: number | null };
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  initialDiscount?: string | null;
  autoOpenPicker?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(offer.name);
  const [priority, setPriority] = useState(String(offer.priority));
  const [enabled, setEnabled] = useState(offer.enabled);
  const [editType, setEditType] = useState(offer.type);
  const [addDiscount, setAddDiscount] = useState('10');
  const [scopeOps, setScopeOps] = useState<OfferScopeOps>(emptyOfferScopeOps);
  const scopeOpsRef = useRef(scopeOps);
  scopeOpsRef.current = scopeOps;
  const [pricedOps, setPricedOps] = useState<PricedGroupOps>(emptyPricedGroupOps);
  const pricedOpsRef = useRef(pricedOps);
  pricedOpsRef.current = pricedOps;
  const isPricedGroup = editType === OFFER_TYPE.pricedGroup;
  const isBundle = editType === OFFER_TYPE.bundle;
  const canConvertType = offer.type === OFFER_TYPE.percent || offer.type === OFFER_TYPE.bundle;
  const [bundleRequiredOps, setBundleRequiredOps] = useState<BundleRequiredOps>(emptyBundleRequiredOps);
  const bundleRequiredOpsRef = useRef(bundleRequiredOps);
  bundleRequiredOpsRef.current = bundleRequiredOps;
  // شرط تفعيل العرض المشروط (كل المواد / عدد منها …)
  const [bundleCond, setBundleCond] = useState<OfferBundleConditionsDto>(DEFAULT_BUNDLE_CONDITIONS);
  const [bundleCondBase, setBundleCondBase] = useState<OfferBundleConditionsDto>(DEFAULT_BUNDLE_CONDITIONS);
  const bundleCondRef = useRef(bundleCond);
  bundleCondRef.current = bundleCond;
  const confirmingRef = useRef(false);
  /** يُضبط قبل الإغلاق المقصود (حفظ/مغادرة مؤكدة) لتجاوز تحذير المتصفح. */
  const leavingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const detailsQ = useQuery({
    queryKey: ['offer-scope', offer.id],
    queryFn: () => api.offerScope(offer.id),
    enabled: open,
  });

  const allDetailsQ = useQuery({
    queryKey: ['offer-details-all', offer.id],
    queryFn: () => api.offerDetails(offer.id),
    enabled: open && !isPricedGroup,
  });

  const bundleCondQ = useQuery({
    queryKey: ['offer-bundle-conditions', offer.id],
    // خادم أقدم بلا هذه الخدمة → الشرط الافتراضي (كل المواد)
    queryFn: () => api.offerBundleConditions(offer.id).catch(() => DEFAULT_BUNDLE_CONDITIONS),
    enabled: open && isBundle,
  });

  const hydratedCond = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedCond.current = null;
      return;
    }
    if (!bundleCondQ.data || hydratedCond.current === offer.id) return;
    hydratedCond.current = offer.id;
    const c = normalizeBundleConditions(bundleCondQ.data);
    setBundleCond(c);
    setBundleCondBase(c);
  }, [open, offer.id, bundleCondQ.data]);

  const baseline = useRef<{
    name: string;
    priority: string;
    enabled: boolean;
    addDiscount: string;
    dateMode: 'unlimited' | 'range';
    dateFrom: string;
    dateTo: string;
  } | null>(null);

  const [dateMode, setDateMode] = useState<'unlimited' | 'range'>('unlimited');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hydratedOffer = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedOffer.current = null;
      return;
    }
    if (!detailsQ.data || hydratedOffer.current === offer.id) return;
    hydratedOffer.current = offer.id;
    leavingRef.current = false;
    const scope = detailsQ.data;
    const nextDateMode = scope.unlimited !== false ? 'unlimited' : 'range';
    const nextDateFrom = scope.fromDate ? scope.fromDate.slice(0, 10) : '';
    const nextDateTo = scope.toDate ? scope.toDate.slice(0, 10) : '';
    const emptyOffer = (scope.trees?.length ?? 0) + (scope.standalone?.length ?? 0) === 0;
    const discount = emptyOffer && initialDiscount
      ? initialDiscount
      : (scope.defaultDiscount != null ? String(scope.defaultDiscount) : '10');
    setName(offer.name);
    setPriority(String(offer.priority));
    setEnabled(offer.enabled);
    setEditType(offer.type);
    setAddDiscount(discount);
    setDateMode(nextDateMode);
    setDateFrom(nextDateFrom);
    setDateTo(nextDateTo);
    setScopeOps(emptyOfferScopeOps());
    setPricedOps(emptyPricedGroupOps());
    setBundleRequiredOps(emptyBundleRequiredOps());
    baseline.current = {
      name: offer.name,
      priority: String(offer.priority),
      enabled: offer.enabled,
      addDiscount: discount,
      dateMode: nextDateMode,
      dateFrom: nextDateFrom,
      dateTo: nextDateTo,
    };
  }, [open, offer.id, detailsQ.data, initialDiscount, offer.name, offer.priority, offer.enabled, offer.type]);

  const scope = detailsQ.data;
  const trees: ScopeTreeCard[] = useMemo(
    () =>
      (scope?.trees ?? []).map(t => ({
        treeSeq: t.treeSeq,
        treeName: t.treeName ?? `شجرة #${t.treeSeq}`,
        count: t.count,
        excludedCount: t.excludedCount,
        discount: t.discount,
        lastSyncedAt: t.lastSyncedAt ?? undefined,
      })),
    [scope],
  );

  const treeSeqs = useMemo(() => new Set(trees.map(t => t.treeSeq)), [trees]);
  const standalone: ScopeStandaloneItem[] = useMemo(
    () =>
      (scope?.standalone ?? [])
        .filter(d => d.sourceTreeSeq == null || !treeSeqs.has(d.sourceTreeSeq))
        .map(d => ({
          id: d.id,
          seq: d.itemId ?? undefined,
          name: d.itemName ?? `#${d.itemId ?? d.id}`,
          barcode: d.barcode,
          meta: d.discount > 0 ? `${formatNum(d.discount)}%` : undefined,
        })),
    [scope?.standalone, treeSeqs],
  );

  const applyDiscount = Number(addDiscount) || 10;
  const discountNum = Number(addDiscount);
  const discountValid = isPricedGroup || (Number.isFinite(discountNum) && discountNum >= 0 && discountNum <= 100);
  const datesValid = dateMode === 'unlimited' || !dateFrom || !dateTo || dateFrom <= dateTo;
  const formValid = discountValid && datesValid;

  function datePayloadFor(mode: 'unlimited' | 'range', from: string, to: string) {
    return mode === 'unlimited'
      ? { fromDate: null as string | null, toDate: null as string | null, unlimited: true }
      : { fromDate: from || null, toDate: to || null, unlimited: false };
  }

  const hasHeaderChanges = useMemo(() => {
    const b = baseline.current;
    if (!b) return false;
    return (
      name.trim() !== b.name ||
      priority !== b.priority ||
      enabled !== b.enabled ||
      addDiscount !== b.addDiscount ||
      dateMode !== b.dateMode ||
      dateFrom !== b.dateFrom ||
      dateTo !== b.dateTo
    );
  }, [name, priority, enabled, addDiscount, dateMode, dateFrom, dateTo, detailsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const requiredCount = useMemo(() => {
    const existing = (allDetailsQ.data ?? []).filter(d => d.detailRole === 1).length;
    return Math.max(0, existing - bundleRequiredOps.removeRowIds.length) + bundleRequiredOps.add.length;
  }, [allDetailsQ.data, bundleRequiredOps]);
  // أصناف مخفّضة موجودة أيضاً ضمن المواد المشروطة (مثل هدية من نفس الشجرة)
  const overlapCount = useMemo(() => {
    const rows = (allDetailsQ.data ?? []).filter(d => !d.excluded && d.itemId != null);
    const required = new Set(rows.filter(d => d.detailRole === 1).map(d => d.itemId));
    return new Set(rows.filter(d => d.detailRole === 0 && required.has(d.itemId)).map(d => d.itemId)).size;
  }, [allDetailsQ.data]);
  const bundleCondChanged = isBundle && !sameBundleConditions(bundleCond, bundleCondBase);
  const bundleCondErr = isBundle ? bundleConditionsError(bundleCond, requiredCount) : null;
  const contentChanges = offerScopeOpsCount(scopeOps) + pricedGroupOpsCount(pricedOps) + bundleRequiredOpsCount(bundleRequiredOps) + (bundleCondChanged ? 1 : 0);
  const hasUnsaved = hasHeaderChanges || editType !== offer.type || contentChanges > 0;

  async function ask(opts: Parameters<typeof confirm>[0]) {
    if (confirmingRef.current) return false;
    confirmingRef.current = true;
    try {
      return await confirm(opts);
    } finally {
      confirmingRef.current = false;
    }
  }

  async function trySetEditType(next: number) {
    if (next === editType) return;
    if (next === OFFER_TYPE.percent && editType === OFFER_TYPE.bundle) {
      const ok = await ask({
        title: 'تحويل إلى «خصم نسبة»؟',
        message: 'ستُحذف أصناف تفعيل العرض (المطلوبة في الفاتورة) عند الحفظ.',
        confirmLabel: 'تحويل',
        danger: true,
      });
      if (!ok) return;
    }
    if (next === OFFER_TYPE.bundle && editType === OFFER_TYPE.percent) {
      const ok = await ask({
        title: 'تحويل إلى «عرض مشروط»؟',
        message: 'حدّد أصناف التفعيل المطلوبة في الفاتورة، ثم الأصناف المخفّضة، ثم احفظ.',
        confirmLabel: 'تحويل',
      });
      if (!ok) return;
    }
    // ترك نوع «مشروط» يُسقط تعديلات أصناف التفعيل المرحلية
    if (editType === OFFER_TYPE.bundle && next !== OFFER_TYPE.bundle) setBundleRequiredOps(emptyBundleRequiredOps());
    setEditType(next);
  }

  async function tryClose() {
    if (hasUnsaved) {
      const ok = await ask({
        title: 'مغادرة دون حفظ؟',
        message: 'توجد تعديلات غير محفوظة على هذا العرض وستضيع.',
        confirmLabel: 'مغادرة دون حفظ',
        danger: true,
      });
      if (!ok) return;
    }
    leavingRef.current = true;
    onClose();
  }

  const deleteOffer = useMutation({
    mutationFn: () => api.deleteOffer(offer.id),
    onSuccess: async () => {
      toast.success('حُذف العرض');
      await onChanged();
      leavingRef.current = true;
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  async function requestDelete() {
    const ok = await ask({
      title: 'حذف العرض نهائياً؟',
      message: `سيُحذف «${offer.name}» وكل أصنافه وأشجاره. لا يمكن التراجع.`,
      confirmLabel: 'حذف العرض',
      danger: true,
    });
    if (ok) deleteOffer.mutate();
  }

  const saveAll = useMutation({
    mutationFn: async (closeAfter: boolean) => {
      const dates = datePayloadFor(dateMode, dateFrom, dateTo);
      const targetType = editType;
      const savingBundle = targetType === OFFER_TYPE.bundle;
      const savingPriced = targetType === OFFER_TYPE.pricedGroup;

      // تحديث الرأس أولاً: إن رفضه الخادم (أولوية مكررة مثلاً) لا نكون قد حذفنا أصناف التفعيل
      await api.updateOffer(offer.id, {
        name: name.trim() || offer.name,
        priority: Number(priority) || 0,
        type: targetType,
        enabled,
      });

      if (offer.type === OFFER_TYPE.bundle && targetType === OFFER_TYPE.percent) {
        const details = allDetailsQ.data ?? [];
        for (const d of details) {
          if (d.detailRole === 1) await api.deleteOfferDetail(d.id);
        }
      }

      if (savingPriced) {
        const ops = pricedOpsRef.current;
        for (const rowId of ops.removeRowIds) await api.deleteOfferDetail(rowId);
        for (const p of ops.addProducts) {
          await api.addOfferDetail(offer.id, {
            itemId: p.seq,
            discount: p.discount,
            discountType: p.discountType,
            detailRole: 0,
            ...dates,
          });
        }
        const pricingById = new Map(ops.detailPricings.map(x => [x.detailId, x]));
        for (const item of scope?.standalone ?? []) {
          if (ops.removeRowIds.includes(item.id)) continue;
          const priced = pricingById.get(item.id);
          await api.updateOfferDetail(item.id, {
            discount: priced?.discount ?? item.discount,
            discountType: priced?.discountType ?? item.discountType,
            ...dates,
          });
        }
        return closeAfter;
      }

      if (savingBundle) {
        const bundleOps = bundleRequiredOpsRef.current;
        for (const rowId of bundleOps.removeRowIds) await api.deleteOfferDetail(rowId);
        // دفعة واحدة — إضافة شجرة كاملة قد تعني مئات الأصناف
        if (bundleOps.add.length > 0) {
          await api.addOfferBulk(offer.id, {
            itemIds: bundleOps.add.map(p => p.seq),
            discountPercent: 0,
            detailRole: 1,
            ...dates,
          });
        }
        if (!sameBundleConditions(bundleCondRef.current, bundleCondBase)) {
          await api.saveOfferBundleConditions(offer.id, normalizeBundleConditions(bundleCondRef.current));
        }
      }

      const ops = scopeOpsRef.current;
      for (const seq of ops.removeTreeSeqs) await api.deleteOfferTree(offer.id, seq);
      for (const rowId of ops.removeRowIds) await api.deleteOfferDetail(rowId);

      for (const t of ops.addTrees) {
        await api.addOfferTree(offer.id, {
          treeSeq: t.seq,
          discountPercent: applyDiscount,
          ...dates,
        });
      }
      for (const p of ops.addProducts) {
        await api.addOfferDetail(offer.id, {
          itemId: p.seq,
          discount: applyDiscount,
          discountType: 0,
          detailRole: 0,
          ...dates,
        });
      }

      for (const { detailId, excluded } of ops.excludeChanges) {
        await api.setOfferDetailExcluded(detailId, excluded);
      }
      for (const { seq, excluded } of ops.excludeArticleSeqs) {
        await api.setOfferArticleExcluded(offer.id, seq, excluded);
      }

      const headerDiscountChanged = baseline.current != null && addDiscount !== baseline.current.addDiscount;
      const remainingTrees = trees.filter(t => !ops.removeTreeSeqs.includes(t.treeSeq));
      for (const t of remainingTrees) {
        const explicit = ops.treeDiscounts.find(x => x.treeSeq === t.treeSeq)?.discount;
        const disc = explicit ?? (headerDiscountChanged ? applyDiscount : (t.discount ?? applyDiscount));
        await api.updateOfferTreeDiscount(offer.id, t.treeSeq, {
          discountPercent: disc,
          ...dates,
        });
      }
      for (const t of ops.addTrees) {
        const disc = ops.treeDiscounts.find(x => x.treeSeq === t.seq)?.discount ?? applyDiscount;
        await api.updateOfferTreeDiscount(offer.id, t.seq, {
          discountPercent: disc,
          ...dates,
        });
      }

      for (const item of standalone) {
        if (ops.removeRowIds.includes(item.id)) continue;
        const raw = scope?.standalone.find(d => d.id === item.id);
        await api.updateOfferDetail(item.id, {
          discount: headerDiscountChanged ? applyDiscount : (raw?.discount ?? applyDiscount),
          discountType: headerDiscountChanged ? 0 : raw?.discountType,
          ...dates,
        });
      }
      return closeAfter;
    },
    onSuccess: async closeAfter => {
      toast.success('حُفظ العرض بالكامل');
      setScopeOps(emptyOfferScopeOps());
      setPricedOps(emptyPricedGroupOps());
      setBundleRequiredOps(emptyBundleRequiredOps());
      setBundleCondBase(normalizeBundleConditions(bundleCondRef.current));
      baseline.current = {
        name: name.trim() || offer.name,
        priority,
        enabled,
        addDiscount,
        dateMode,
        dateFrom,
        dateTo,
      };
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['offer-scope', offer.id] }),
        qc.invalidateQueries({ queryKey: ['offer-details-all', offer.id] }),
        qc.invalidateQueries({ queryKey: ['offer-period', offer.id] }),
        qc.invalidateQueries({ queryKey: ['offer-bundle-conditions', offer.id] }),
        detailsQ.refetch(),
        allDetailsQ.refetch(),
        onChanged(),
      ]);
      if (closeAfter) {
        leavingRef.current = true;
        onClose();
      }
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const handleScopeOpsChange = useCallback((ops: OfferScopeOps) => {
    setScopeOps(ops);
  }, []);

  const handlePricedOpsChange = useCallback((ops: PricedGroupOps) => {
    setPricedOps(ops);
  }, []);

  useScrollLock(open);

  const loading = detailsQ.isLoading || (!isPricedGroup && allDetailsQ.isLoading);
  const canSave = hasUnsaved && formValid && !bundleCondErr && !loading && !saveAll.isPending;

  function save(closeAfter = false) {
    if (bundleCondErr) {
      toast.error(bundleCondErr);
      return;
    }
    if (!formValid) {
      toast.error(datesValid ? 'نسبة الخصم يجب أن تكون بين 0 و 100' : 'تاريخ البداية بعد تاريخ النهاية');
      return;
    }
    if (canSave) saveAll.mutate(closeAfter);
  }

  // Escape يغلق (مع التأكيد) — Ctrl+S يحفظ ويبقى في النافذة
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        if (document.querySelector('[role="alertdialog"]')) return;
        save(false);
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      // منتقي النطاق أو نافذة أخرى فوق المحرر تتولى Escape بنفسها
      const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== rootRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      void tryClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // تحذير المتصفح عند الإغلاق/التحديث مع تعديلات غير محفوظة
  useEffect(() => {
    if (!open || !hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [open, hasUnsaved]);

  if (!open) return null;

  const livePeriod = { unlimited: dateMode === 'unlimited', fromDate: dateFrom || null, toDate: dateTo || null };

  return (
    <Portal>
    <div ref={rootRef} dir="rtl" className="fixed inset-0 z-[60] flex flex-col bg-slate-50" role="dialog" aria-modal="true" aria-label={`تعديل العرض ${offer.name}`}>
      {/* الشريط العلوي */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Btn variant="ghost" size="sm" icon={<IconChevronRight size={16} />} onClick={() => void tryClose()} title="رجوع (Esc)">
          رجوع
        </Btn>
        <div className="h-7 w-px bg-slate-200" />
        <OfferTypeIcon type={editType} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-bold text-header">{name.trim() || offer.name}</h2>
            <span className="num text-[11.5px] text-slate-400">#{offer.id}</span>
            <OfferStatusPill enabled={enabled} period={livePeriod} />
            {hasUnsaved && <Badge tone="warn" dot>تعديلات غير محفوظة</Badge>}
          </div>
        </div>
        <Btn
          variant="ghost"
          size="sm"
          icon={<IconTrash size={14} />}
          className="text-red-600 hover:bg-red-50"
          loading={deleteOffer.isPending}
          onClick={() => void requestDelete()}
        >
          حذف العرض
        </Btn>
      </header>

      {/* إعدادات العرض — مجمّعة */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
            <SettingsGroup title="الأساسيات">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[180px] flex-1">
                  <MiniLabel>اسم العرض</MiniLabel>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder={offer.name} className="font-semibold" />
                </label>
                <div>
                  <MiniLabel>النوع</MiniLabel>
                  {canConvertType ? (
                    <SegButtons
                      label="نوع العرض"
                      value={editType}
                      onChange={v => void trySetEditType(v)}
                      items={[
                        { id: OFFER_TYPE.percent as number, label: 'خصم نسبة' },
                        { id: OFFER_TYPE.bundle as number, label: 'مشروط' },
                      ]}
                    />
                  ) : (
                    <div className="flex h-9 items-center"><Badge tone="violet">{offerTypeLabel(offer.type)}</Badge></div>
                  )}
                </div>
                <label className="w-20">
                  <MiniLabel>الأولوية</MiniLabel>
                  <Input
                    type="number"
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="num text-center"
                    title="الأعلى يُطبَّق أولاً عند تعارض العروض"
                  />
                </label>
                <div className="w-40">
                  <MiniLabel>المجلد</MiniLabel>
                  <OfferFolderSelect compact offerId={offer.id} folderId={offer.folderId} onChanged={onChanged} />
                </div>
              </div>
            </SettingsGroup>

            <SettingsGroup title="التفعيل والفترة">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex h-9 items-center">
                  <Switch label="نشط" checked={enabled} onChange={setEnabled} />
                </div>
                <div>
                  <MiniLabel>المدة</MiniLabel>
                  <SegButtons
                    label="مدة العرض"
                    value={dateMode}
                    onChange={setDateMode}
                    items={[
                      { id: 'unlimited', label: 'دائم' },
                      { id: 'range', label: 'فترة محددة' },
                    ]}
                  />
                </div>
                {dateMode === 'range' && (
                  <>
                    <label>
                      <MiniLabel>من</MiniLabel>
                      <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px]" />
                    </label>
                    <label>
                      <MiniLabel>إلى</MiniLabel>
                      <Input
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={e => setDateTo(e.target.value)}
                        className={`w-[140px] ${datesValid ? '' : '!border-red-400'}`}
                        aria-invalid={!datesValid}
                      />
                    </label>
                  </>
                )}
              </div>
              {!datesValid && <p className="mt-1 text-[11.5px] text-red-600">تاريخ النهاية قبل تاريخ البداية.</p>}
            </SettingsGroup>

            {!isPricedGroup ? (
              <SettingsGroup title="الخصم">
                <div className="flex flex-wrap items-end gap-1.5">
                  <label className="w-20">
                    <MiniLabel>النسبة %</MiniLabel>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={addDiscount}
                      onChange={e => setAddDiscount(e.target.value)}
                      className={`num text-center font-bold ${discountValid ? '' : '!border-red-400'}`}
                      aria-invalid={!discountValid}
                    />
                  </label>
                  {[10, 15, 20, 25].map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAddDiscount(String(p))}
                      className={`num h-9 rounded-lg border px-2.5 text-[12px] font-bold transition ${
                        Number(addDiscount) === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11.5px] text-slate-500">
                  {discountValid
                    ? `للأصناف الجديدة والأشجار بلا خصم خاص · يُقرَّب السعر لأقرب ${formatNum(OFFER_PRICE_STEP)} د.ع`
                    : <span className="text-red-600">النسبة بين 0 و 100</span>}
                </p>
              </SettingsGroup>
            ) : (
              <SettingsGroup title="التسعير">
                <p className="text-[12px] leading-6 text-slate-600">
                  لكل منتج سعر بيع أو نسبة مستقلة — حدّدها في القائمة أدناه.
                  يُقرَّب السعر لأقرب {formatNum(OFFER_PRICE_STEP)} د.ع.
                </p>
              </SettingsGroup>
            )}
          </div>
        )}
      </div>

      {/* المحتوى */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {loading ? (
          <div className="card flex flex-1 items-center justify-center">
            <Loading />
          </div>
        ) : isPricedGroup ? (
          <div className="min-h-0 flex-1">
            <OfferPricedGroupEditor
              offerId={offer.id}
              standalone={scope?.standalone ?? []}
              onOpsChange={handlePricedOpsChange}
            />
          </div>
        ) : (
          <>
            {isBundle && (
              <div className="shrink-0">
                <OfferBundleRequiredEditor
                  existing={allDetailsQ.data ?? []}
                  onOpsChange={setBundleRequiredOps}
                />
              </div>
            )}
            {isBundle && (
              <div className="shrink-0">
                <OfferBundleConditionsEditor
                  value={bundleCond}
                  onChange={setBundleCond}
                  requiredCount={requiredCount}
                  overlapCount={overlapCount}
                  hasDiscountedItems={trees.length + standalone.length + scopeOps.addTrees.length + scopeOps.addProducts.length > 0}
                />
              </div>
            )}
            <div className="min-h-[320px] flex-1">
              <OfferScopeEditor
                offerId={offer.id}
                trees={trees}
                standalone={standalone}
                allDetails={allDetailsQ.data ?? []}
                defaultDiscount={applyDiscount}
                onOpsChange={handleScopeOpsChange}
              />
            </div>
          </>
        )}
      </main>

      {/* شريط الحفظ الثابت */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5">
        <p className="text-[12px] text-slate-500">
          {hasUnsaved
            ? <>لديك <span className="num font-semibold text-amber-700">{formatNum(contentChanges + (hasHeaderChanges || editType !== offer.type ? 1 : 0))}</span> تعديل بانتظار الحفظ — لا شيء يُرسل للكاشير قبل «حفظ».</>
            : 'لا تعديلات — كل التغييرات تُحفظ دفعة واحدة بزر «حفظ».'}
          <span className="ms-2 hidden text-slate-400 md:inline">Ctrl+S للحفظ · Esc للرجوع</span>
        </p>
        <div className="flex items-center gap-2">
          <Btn variant="secondary" onClick={() => void tryClose()} disabled={saveAll.isPending}>
            {hasUnsaved ? 'إلغاء' : 'إغلاق'}
          </Btn>
          <Btn variant="outline" loading={saveAll.isPending} disabled={!canSave} onClick={() => save(false)} icon={<IconCheck size={15} />}>
            حفظ التغييرات
          </Btn>
          <Btn loading={saveAll.isPending} disabled={!canSave} onClick={() => save(true)} icon={<IconCheck size={15} />}>
            حفظ وإغلاق
          </Btn>
        </div>
      </footer>
    </div>
    </Portal>
  );
}
