import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { OfferDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { Btn, Checkbox, Input, Loading, Modal, Switch } from '@/components/ui';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { EmptyWorkspace, FilterChip, StatusChip } from '@/components/workspace';
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
import { OFFER_TYPE, offerTypeLabel } from '@/lib/offers';
import { IconPercent, IconShield, IconTag } from '@/components/icons';

const OFFERS_UI_KEY = 'fot_offers_ui_v3';

export function OffersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'off'>(() =>
    (sessionStorage.getItem(`${OFFERS_UI_KEY}:status`) as 'all' | 'active' | 'off') || 'all');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    sessionStorage.setItem(`${OFFERS_UI_KEY}:status`, statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    const stored = sessionStorage.getItem('fot_admin_offer');
    const id = Number(params.get('id') || stored || 0);
    if (id > 0) {
      setEditingId(id);
      sessionStorage.removeItem('fot_admin_offer');
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

  const items = offersQ.data?.items ?? [];

  useEffect(() => {
    if (editingId == null || offersQ.isLoading || !offersQ.data) return;
    if (!items.some(o => o.id === editingId)) setEditingId(null);
  }, [editingId, items, offersQ.isLoading, offersQ.data]);

  const offers = useMemo(() => {
    const s = search.trim();
    return items
      .filter(o => (statusFilter === 'all' ? true : statusFilter === 'active' ? o.enabled : !o.enabled))
      .filter(o => !s || o.name.includes(s) || String(o.id).includes(s));
  }, [items, search, statusFilter]);

  const activeCount = items.filter(o => o.enabled).length;
  const editing = items.find(o => o.id === editingId) ?? null;

  async function invalidateOffers() {
    await qc.invalidateQueries({ queryKey: ['offers'] });
    await qc.invalidateQueries({ queryKey: ['offer-scope'] });
    await qc.invalidateQueries({ queryKey: ['offer-details'] });
    await qc.invalidateQueries({ queryKey: ['offers-stats'] });
  }

  const toggle = useMutation({
    mutationFn: (o: OfferDto) => api.setOfferEnabled(o.id, !o.enabled),
    onSuccess: async (_, o) => {
      toast.success(o.enabled ? 'توقّف العرض' : 'فُعّل العرض على نقاط البيع');
      await invalidateOffers();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  const columns: GridColumn<OfferDto>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'العرض',
        width: 260,
        render: o => <span className="font-semibold text-header">{o.name}</span>,
      },
      {
        key: 'type',
        header: 'النوع',
        width: 140,
        render: o => offerTypeLabel(o.type),
      },
      {
        key: 'activeProductCount',
        header: 'الأصناف',
        width: 110,
        align: 'center',
        mono: true,
        sortValue: o => o.activeProductCount,
        render: o => formatNum(o.activeProductCount),
      },
      {
        key: 'priority',
        header: 'الأولوية',
        width: 100,
        align: 'center',
        mono: true,
        sortValue: o => o.priority,
        render: o => formatNum(o.priority),
      },
      {
        key: 'enabled',
        header: 'الحالة',
        width: 110,
        align: 'center',
        render: o => <StatusChip active={o.enabled} />,
      },
      {
        key: 'actions',
        header: 'إجراءات',
        width: 180,
        align: 'center',
        sortable: false,
        exportable: false,
        render: o => (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <button
              type="button"
              className="text-[12px] font-semibold text-brand-600 hover:underline"
              onClick={e => {
                e.stopPropagation();
                setEditingId(o.id);
              }}
            >
              تعديل
            </button>
            <button
              type="button"
              className={`text-[12px] font-semibold hover:underline ${o.enabled ? 'text-red-500' : 'text-emerald-600'}`}
              onClick={e => {
                e.stopPropagation();
                toggle.mutate(o);
              }}
            >
              {o.enabled ? 'إيقاف' : 'تفعيل'}
            </button>
          </div>
        ),
      },
    ],
    [toggle],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        filters={
          <FilterField label="بحث">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="اسم العرض…" />
          </FilterField>
        }
        header={{
          title: 'العروض',
          hint: 'قائمة العروض — انقر «تعديل» لإدارة الأصناف',
          actions: (
            <>
              <FilterChip compact active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>الكل</FilterChip>
              <FilterChip compact active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>نشطة</FilterChip>
              <FilterChip compact active={statusFilter === 'off'} onClick={() => setStatusFilter('off')}>متوقفة</FilterChip>
              <Btn size="sm" onClick={() => setCreating(true)}>+ عرض جديد</Btn>
            </>
          ),
        }}
        onRefresh={() => offersQ.refetch()}
        refreshing={offersQ.isFetching}
        footer={
          <ClassicSummaryFooter
            total={offersQ.data?.total ?? items.length}
            totalLabel="عروض"
            items={[
              { label: 'نشطة', value: formatNum(activeCount), accent: true },
              { label: 'متوقفة', value: formatNum(items.length - activeCount) },
              { label: 'معروض', value: formatNum(offers.length) },
            ]}
          />
        }
      >
        {offersQ.isLoading && <Loading />}
        {offersQ.isError && (
          <div className="p-2 text-center text-[11px] text-red-800">
            تعذّر تحميل العروض
            <Btn className="mr-2" size="sm" variant="secondary" onClick={() => offersQ.refetch()}>إعادة</Btn>
          </div>
        )}
        {!offersQ.isLoading && items.length === 0 && (
          <EmptyWorkspace
            title="لا عروض بعد"
            hint="أنشئ عرضاً ثم أضف الأشجار أو المنتجات من صفحة التعديل."
            action={<Btn onClick={() => setCreating(true)}>+ عرض جديد</Btn>}
          />
        )}
        {items.length > 0 && (
          <DataGrid
            embedded
            fillHeight
            columns={columns}
            rows={offers}
            getRowId={o => o.id}
            exportName="العروض"
            counterLabel="عرض"
            emptyText="لا نتائج لهذا الفلتر"
            onRowDoubleClick={o => setEditingId(o.id)}
            onEnter={o => setEditingId(o.id)}
          />
        )}
      </ClassicListShell>

      <NewOfferModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={id => {
          setCreating(false);
          setEditingId(id);
          void invalidateOffers();
        }}
      />

      {editingId != null && !editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-100">
          <Loading />
        </div>
      )}
      {editing && (
        <OfferEditorModal
          key={editing.id}
          offer={editing}
          open
          onClose={() => setEditingId(null)}
          onChanged={invalidateOffers}
        />
      )}
    </div>
  );
}

function NewOfferModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState('10');
  const [type, setType] = useState(0);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDiscount('10');
    setType(0);
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.createOffer({
      name: name.trim() || (type === OFFER_TYPE.percent ? `خصم ${discount}%` : offerTypeLabel(type)),
      priority: 100,
      type,
      enabled: true,
    }),
    onSuccess: r => {
      toast.success('أُنشئ العرض — أضف الأشجار والمنتجات');
      onCreated(r.id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإنشاء'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="عرض جديد"
      subtitle="خطوة واحدة — ثم أضف الأشجار والمنتجات"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
          <Btn loading={create.isPending} onClick={() => create.mutate()}>إنشاء والتعديل</Btn>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setType(OFFER_TYPE.percent)}
          className={`rounded-xl border p-3 text-right ${type === OFFER_TYPE.percent ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <span className="icon-tile mb-2 h-9 w-9 bg-emerald-50 text-emerald-600"><IconPercent size={16} /></span>
          <span className="block text-[13.5px] font-bold text-header">خصم نسبة %</span>
          <span className="text-[11px] text-slate-500">خصم موحّد على أشجار أو منتجات</span>
        </button>
        <button
          type="button"
          onClick={() => setType(OFFER_TYPE.bundle)}
          className={`rounded-xl border p-3 text-right ${type === OFFER_TYPE.bundle ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <span className="icon-tile mb-2 h-9 w-9 bg-sky-50 text-sky-600"><IconShield size={16} /></span>
          <span className="block text-[13.5px] font-bold text-header">مجموعة مطلوبة</span>
          <span className="text-[11px] text-slate-500">أصناف مطلوبة + أصناف مخفّضة</span>
        </button>
        <button
          type="button"
          onClick={() => setType(OFFER_TYPE.pricedGroup)}
          className={`rounded-xl border p-3 text-right ${type === OFFER_TYPE.pricedGroup ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'}`}
        >
          <span className="icon-tile mb-2 h-9 w-9 bg-violet-50 text-violet-600"><IconTag size={16} /></span>
          <span className="block text-[13.5px] font-bold text-header">أسعار فردية</span>
          <span className="text-[11px] text-slate-500">لكل منتج سعر بيع أو نسبة مستقلة</span>
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">اسم العرض (اختياري)</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={type === OFFER_TYPE.percent ? `خصم ${discount}%` : offerTypeLabel(type)} />
        </div>
        {type === OFFER_TYPE.percent && (
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">نسبة الخصم الافتراضية %</label>
            <div className="flex gap-1.5">
              <Input type="number" min={0} max={100} value={discount} onChange={e => setDiscount(e.target.value)} className="w-20 text-center font-bold" />
              {[10, 15, 20, 25].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDiscount(String(p))}
                  className={`flex-1 rounded-lg border text-[12px] font-bold ${Number(discount) === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function OfferEditorModal({
  offer,
  open,
  onClose,
  onChanged,
}: {
  offer: { id: number; name: string; priority: number; type: number; enabled: boolean };
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  autoOpenPicker?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(offer.name);
  const [priority, setPriority] = useState(String(offer.priority));
  const [enabled, setEnabled] = useState(offer.enabled);
  const [addDiscount, setAddDiscount] = useState('10');
  const [scopeOps, setScopeOps] = useState<OfferScopeOps>(emptyOfferScopeOps);
  const scopeOpsRef = useRef(scopeOps);
  scopeOpsRef.current = scopeOps;
  const [pricedOps, setPricedOps] = useState<PricedGroupOps>(emptyPricedGroupOps);
  const pricedOpsRef = useRef(pricedOps);
  pricedOpsRef.current = pricedOps;
  const isPricedGroup = offer.type === OFFER_TYPE.pricedGroup;

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

  const baseline = useRef<{
    name: string;
    priority: string;
    enabled: boolean;
    addDiscount: string;
    dateMode: 'unlimited' | 'range';
    dateFrom: string;
    dateTo: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !detailsQ.data) return;
    const scope = detailsQ.data;
    const dateMode = scope.unlimited !== false ? 'unlimited' : 'range';
    const dateFrom = scope.fromDate ? scope.fromDate.slice(0, 10) : '';
    const dateTo = scope.toDate ? scope.toDate.slice(0, 10) : '';
    const discount = scope.defaultDiscount != null ? String(scope.defaultDiscount) : '10';
    setName(offer.name);
    setPriority(String(offer.priority));
    setEnabled(offer.enabled);
    setAddDiscount(discount);
    setDateMode(dateMode);
    setDateFrom(dateFrom);
    setDateTo(dateTo);
    setScopeOps(emptyOfferScopeOps());
    setPricedOps(emptyPricedGroupOps());
    baseline.current = {
      name: offer.name,
      priority: String(offer.priority),
      enabled: offer.enabled,
      addDiscount: discount,
      dateMode,
      dateFrom,
      dateTo,
    };
  }, [open, offer.id, offer.name, offer.priority, offer.enabled, detailsQ.data]);

  const [dateMode, setDateMode] = useState<'unlimited' | 'range'>('unlimited');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
  }, [name, priority, enabled, addDiscount, dateMode, dateFrom, dateTo, detailsQ.data]);

  const hasUnsaved = hasHeaderChanges || offerScopeOpsCount(scopeOps) > 0 || pricedGroupOpsCount(pricedOps) > 0;

  function tryClose() {
    if (hasUnsaved && !window.confirm('توجد تعديلات غير محفوظة — مغادرة دون حفظ؟')) return;
    onClose();
  }

  const deleteOffer = useMutation({
    mutationFn: () => api.deleteOffer(offer.id),
    onSuccess: async () => {
      toast.success('حُذف العرض');
      await onChanged();
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  const saveAll = useMutation({
    mutationFn: async () => {
      const dates = datePayloadFor(dateMode, dateFrom, dateTo);

      await api.updateOffer(offer.id, {
        name: name.trim() || offer.name,
        priority: Number(priority) || 0,
        type: offer.type,
        enabled,
      });

      if (isPricedGroup) {
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
        return;
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

      const remainingTrees = trees.filter(t => !ops.removeTreeSeqs.includes(t.treeSeq));
      for (const t of remainingTrees) {
        const disc = ops.treeDiscounts.find(x => x.treeSeq === t.treeSeq)?.discount ?? t.discount ?? applyDiscount;
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
          discount: raw?.discount ?? applyDiscount,
          ...dates,
        });
      }
    },
    onSuccess: async () => {
      toast.success('حُفظ العرض بالكامل');
      await qc.invalidateQueries({ queryKey: ['offer-scope', offer.id] });
      await qc.invalidateQueries({ queryKey: ['offer-details-all', offer.id] });
      await onChanged();
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const handleScopeOpsChange = useCallback((ops: OfferScopeOps) => {
    setScopeOps(ops);
  }, []);

  const handlePricedOpsChange = useCallback((ops: PricedGroupOps) => {
    setPricedOps(ops);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [data-keep-escape]')) return;
      tryClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hasUnsaved]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const loading = detailsQ.isLoading || (!isPricedGroup && allDetailsQ.isLoading);

  return (
    <div dir="rtl" className="fixed inset-0 z-[60] flex flex-col bg-slate-100">
      <header className="shrink-0 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={tryClose}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            رجوع
          </button>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            className="max-w-xs font-bold"
            placeholder="اسم العرض"
          />
          <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {offerTypeLabel(offer.type)}
          </span>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
            أولوية
            <Input type="number" value={priority} onChange={e => setPriority(e.target.value)} className="w-16 text-center" />
          </label>
          <div className="flex-1" />
          {hasUnsaved && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
              تعديلات غير محفوظة
            </span>
          )}
          <Btn loading={saveAll.isPending} disabled={!hasUnsaved && !loading} onClick={() => saveAll.mutate()}>
            حفظ
          </Btn>
          <Btn
            variant="ghost"
            className="!text-red-500 hover:!bg-red-50"
            loading={deleteOffer.isPending}
            onClick={() => {
              if (window.confirm(`حذف عرض «${offer.name}» نهائياً؟`)) deleteOffer.mutate();
            }}
          >
            حذف
          </Btn>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/80 px-3 py-2">
          <Switch label="العرض نشط" checked={enabled} onChange={setEnabled} />
          <Checkbox
            label="بدون تاريخ محدد"
            checked={dateMode === 'unlimited'}
            onChange={v => setDateMode(v ? 'unlimited' : 'range')}
          />
          {dateMode === 'range' && (
            <>
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                من
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px] !py-1" />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                إلى
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px] !py-1" />
              </label>
            </>
          )}
          {!isPricedGroup && (
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
              خصم الإضافة %
              <Input type="number" min={0} max={100} value={addDiscount} onChange={e => setAddDiscount(e.target.value)} className="w-14 text-center font-bold" />
            </label>
          )}
          <span className="text-[10.5px] text-slate-400">كل التعديلات تُحفظ بزر «حفظ» فقط</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-white">
            <Loading />
          </div>
        ) : isPricedGroup ? (
          <OfferPricedGroupEditor
            offerId={offer.id}
            standalone={scope?.standalone ?? []}
            onOpsChange={handlePricedOpsChange}
          />
        ) : (
          <OfferScopeEditor
            offerId={offer.id}
            trees={trees}
            standalone={standalone}
            allDetails={allDetailsQ.data ?? []}
            defaultDiscount={applyDiscount}
            onOpsChange={handleScopeOpsChange}
          />
        )}
      </div>
    </div>
  );
}
