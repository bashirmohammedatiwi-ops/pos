import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDetailDto, ProductOfferMembershipDto, TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { useToast } from '@/components/Toast';
import { Btn, Input, Loading } from '@/components/ui';
import { OfferMembershipPills } from '@/components/offers/OfferMembershipPills';
import {
  IconCheckCircle,
  IconChevronDown,
  IconFolderClosed,
  IconPackage,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from '@/components/icons';
import type { ScopeStandaloneItem, ScopeTreeCard, ScopeTreeProduct } from '@/components/scope/TreeScopeEditor';

/** عمليات النطاق المؤجّلة — تُطبَّق عند حفظ صفحة التعديل فقط */
export interface OfferScopeOps {
  addTrees: { seq: number; name: string }[];
  addProducts: { seq: number; name: string; barcode?: string }[];
  removeTreeSeqs: number[];
  removeRowIds: number[];
  excludeChanges: { detailId: number; excluded: boolean }[];
  treeDiscounts: { treeSeq: number; discount: number }[];
}

export function emptyOfferScopeOps(): OfferScopeOps {
  return {
    addTrees: [],
    addProducts: [],
    removeTreeSeqs: [],
    removeRowIds: [],
    excludeChanges: [],
    treeDiscounts: [],
  };
}

export function offerScopeOpsCount(ops: OfferScopeOps) {
  return (
    ops.addTrees.length +
    ops.addProducts.length +
    ops.removeTreeSeqs.length +
    ops.removeRowIds.length +
    ops.excludeChanges.length +
    ops.treeDiscounts.length
  );
}

interface InScopeIndex {
  treeSeqs: Set<number>;
  /** seq المنتج → معرّف سطر التفصيل */
  seqRowIds: Map<number, number>;
}

function buildInScopeIndex(
  trees: ScopeTreeCard[],
  allDetails: OfferDetailDto[],
  addTrees: Map<number, { seq: number; name: string }>,
  addProducts: Map<number, { seq: number; name: string; barcode?: string }>,
  removeTrees: Set<number>,
  removeRows: Map<number, number>,
): InScopeIndex {
  const treeSeqs = new Set<number>();
  for (const t of trees) {
    if (!removeTrees.has(t.treeSeq)) treeSeqs.add(t.treeSeq);
  }
  for (const t of addTrees.values()) treeSeqs.add(t.seq);

  const seqRowIds = new Map<number, number>();
  for (const d of allDetails) {
    if (d.itemId == null) continue;
    if (removeRows.has(d.itemId)) continue;
    const inTree = d.sourceTreeSeq != null && treeSeqs.has(d.sourceTreeSeq);
    const standalone = d.sourceTreeSeq == null || !treeSeqs.has(d.sourceTreeSeq);
    if (standalone || inTree) {
      if (!seqRowIds.has(d.itemId)) seqRowIds.set(d.itemId, d.id);
    }
  }
  for (const p of addProducts.values()) {
    if (!seqRowIds.has(p.seq)) seqRowIds.set(p.seq, -1);
  }
  return { treeSeqs, seqRowIds };
}

type RowState = 'normal' | 'in-scope' | 'staged-add' | 'staged-remove';

export function OfferScopeEditor({
  offerId,
  trees,
  standalone,
  allDetails,
  defaultDiscount,
  onOpsChange,
}: {
  offerId: number;
  trees: ScopeTreeCard[];
  standalone: ScopeStandaloneItem[];
  allDetails: OfferDetailDto[];
  defaultDiscount: number;
  onOpsChange: (ops: OfferScopeOps) => void;
}) {
  const [parent, setParent] = useState<number | undefined>();
  const [path, setPath] = useState<{ seq: number; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expandedTree, setExpandedTree] = useState<number | null>(null);
  const toast = useToast();

  const [addTrees, setAddTrees] = useState<Map<number, { seq: number; name: string }>>(new Map());
  const [addProducts, setAddProducts] = useState<Map<number, { seq: number; name: string; barcode?: string }>>(new Map());
  const [removeTrees, setRemoveTrees] = useState<Set<number>>(new Set());
  const [removeRows, setRemoveRows] = useState<Map<number, number>>(new Map());
  const [excludeChanges, setExcludeChanges] = useState<Map<number, boolean>>(new Map());
  const [treeDiscounts, setTreeDiscounts] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 280);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    onOpsChange({
      addTrees: [...addTrees.values()],
      addProducts: [...addProducts.values()],
      removeTreeSeqs: [...removeTrees],
      removeRowIds: [...removeRows.values()],
      excludeChanges: [...excludeChanges.entries()].map(([detailId, excluded]) => ({ detailId, excluded })),
      treeDiscounts: [...treeDiscounts.entries()].map(([treeSeq, discount]) => ({ treeSeq, discount })),
    });
  }, [addTrees, addProducts, removeTrees, removeRows, excludeChanges, treeDiscounts, onOpsChange]);

  const inScope = useMemo(
    () => buildInScopeIndex(trees, allDetails, addTrees, addProducts, removeTrees, removeRows),
    [trees, allDetails, addTrees, addProducts, removeTrees, removeRows],
  );

  function treeState(seq: number): RowState {
    if (removeTrees.has(seq)) return 'staged-remove';
    if (inScope.treeSeqs.has(seq)) return 'in-scope';
    if (addTrees.has(seq)) return 'staged-add';
    return 'normal';
  }

  function productState(seq: number): RowState {
    if (removeRows.has(seq)) return 'staged-remove';
    if (inScope.seqRowIds.has(seq)) return 'in-scope';
    if (addProducts.has(seq)) return 'staged-add';
    return 'normal';
  }

  function toggleTree(seq: number, name: string) {
    const st = treeState(seq);
    if (st === 'normal') setAddTrees(m => new Map(m).set(seq, { seq, name }));
    else if (st === 'staged-add') setAddTrees(m => { const n = new Map(m); n.delete(seq); return n; });
    else if (st === 'in-scope') setRemoveTrees(s => new Set(s).add(seq));
    else setRemoveTrees(s => { const n = new Set(s); n.delete(seq); return n; });
  }

  function toggleProduct(seq: number, name: string, barcode?: string) {
    const st = productState(seq);
    if (st === 'normal') setAddProducts(m => new Map(m).set(seq, { seq, name, barcode }));
    else if (st === 'staged-add') setAddProducts(m => { const n = new Map(m); n.delete(seq); return n; });
    else if (st === 'in-scope') {
      const rowId = inScope.seqRowIds.get(seq);
      if (rowId == null || rowId < 0) {
        toast.info('الصنف داخل شجرة مضافة — أزِل الشجرة أو استبعده من تفاصيلها');
        return;
      }
      setRemoveRows(m => new Map(m).set(seq, rowId));
    } else setRemoveRows(m => { const n = new Map(m); n.delete(seq); return n; });
  }

  function toggleStandalone(item: ScopeStandaloneItem) {
    const seq = item.seq;
    if (seq == null) return;
    toggleProduct(seq, item.name, item.barcode);
  }

  const nodesQ = useQuery({
    queryKey: ['offer-scope-browse', parent, debounced],
    queryFn: async () => {
      try {
        const edari = await api.edariTree(parent, debounced || undefined);
        if (edari.length) return { nodes: edari, source: 'edari' as const };
      } catch { /* fallback */ }
      const local = await api.articleTree(parent, debounced || undefined);
      return { nodes: local, source: 'local' as const };
    },
    staleTime: 45_000,
  });

  const { folders, products } = useMemo(() => {
    const list = nodesQ.data?.nodes ?? [];
    return {
      folders: list.filter(n => n.isFolder || n.hasChildren),
      products: list.filter(n => !n.isFolder && !n.hasChildren),
    };
  }, [nodesQ.data]);

  const productSeqs = useMemo(() => products.map(n => n.seq), [products]);
  const membershipsQ = useQuery({
    queryKey: ['offer-memberships', offerId, productSeqs.join(',')],
    queryFn: () => api.offerMemberships(productSeqs),
    enabled: productSeqs.length > 0,
    staleTime: 30_000,
  });
  const membershipsBySeq = useMemo(() => {
    const map = new Map<number, ProductOfferMembershipDto[]>();
    for (const row of membershipsQ.data ?? []) map.set(row.itemId, row.offers);
    return map;
  }, [membershipsQ.data]);

  const searchSplit = useMemo(() => {
    if (!debounced) return null;
    const added: TreeNodeDto[] = [];
    const notAdded: TreeNodeDto[] = [];
    for (const n of [...folders, ...products]) {
      const isFolder = n.isFolder || n.hasChildren;
      const st = isFolder ? treeState(n.seq) : productState(n.seq);
      const inAddedSide = st === 'in-scope' || st === 'staged-remove';
      if (inAddedSide) added.push(n);
      else notAdded.push(n);
    }
    return { added, notAdded };
  }, [debounced, folders, products, inScope, addTrees, addProducts, removeTrees, removeRows]);

  function enter(node: TreeNodeDto) {
    setPath(p => [...p, { seq: node.seq, name: fixEdariName(node.name) || `#${node.seq}` }]);
    setParent(node.seq);
    setSearch('');
    setDebounced('');
  }

  function goRoot() {
    setPath([]);
    setParent(undefined);
  }

  const effectiveTrees = useMemo(() => {
    const list = trees.filter(t => !removeTrees.has(t.treeSeq));
    for (const t of addTrees.values()) {
      list.push({
        treeSeq: t.seq,
        treeName: t.name,
        count: 0,
        excludedCount: 0,
        discount: defaultDiscount,
      });
    }
    return list;
  }, [trees, removeTrees, addTrees, defaultDiscount]);

  const stagedCount = offerScopeOpsCount({
    addTrees: [...addTrees.values()],
    addProducts: [...addProducts.values()],
    removeTreeSeqs: [...removeTrees],
    removeRowIds: [...removeRows.values()],
    excludeChanges: [...excludeChanges.entries()].map(([detailId, excluded]) => ({ detailId, excluded })),
    treeDiscounts: [...treeDiscounts.entries()].map(([treeSeq, discount]) => ({ treeSeq, discount })),
  });

  const totalInScope =
    effectiveTrees.reduce((n, t) => n + t.count, 0) +
    standalone.filter(s => s.seq == null || !removeRows.has(s.seq)).length +
    addProducts.size;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* بحث موحّد */}
      <header className="shrink-0 space-y-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-slate-400">
              <IconSearch size={14} />
            </span>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث منتج / شجرة / باركود — يقسّم النتائج تلقائياً"
              className="!py-1.5 pe-2 ps-8 text-[12px]"
            />
          </div>
          {!debounced && (
            <>
              <button
                type="button"
                onClick={goRoot}
                disabled={path.length === 0}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-600 enabled:hover:bg-white disabled:opacity-40"
              >
                ↑ الجذر
              </button>
              <span className="max-w-[240px] truncate text-[11px] text-slate-500">
                {path.length ? path.map(p => p.name).join(' / ') : 'تصفّح الكتالوج'}
              </span>
            </>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${nodesQ.data?.source === 'edari' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
            {nodesQ.data?.source === 'edari' ? 'Edari' : 'محلي'}
          </span>
          {stagedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-300">
              {formatNum(stagedCount)} تعديل — بانتظار الحفظ
            </span>
          )}
        </div>
        {debounced && (
          <p className="text-[10.5px] text-slate-500">
            نتائج «{debounced}»: يمين = مضاف للعرض · يسار = غير مضاف — اضغط الزر للإضافة أو الإزالة
          </p>
        )}
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* يسار: غير مضاف / كتالوج */}
        <section className="flex min-h-0 flex-col border-e border-slate-100">
          <div className="shrink-0 border-b border-slate-100 bg-emerald-50/50 px-3 py-1.5">
            <h3 className="text-[12px] font-bold text-emerald-800">
              {debounced ? `غير مضاف (${formatNum(searchSplit?.notAdded.length ?? 0)})` : 'إضافة من الكتالوج'}
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {nodesQ.isLoading && <Loading />}
            {debounced && searchSplit && (
              <>
                {searchSplit.notAdded.length === 0 && (
                  <p className="p-6 text-center text-[12px] text-slate-400">كل النتائج مضافة للعرض</p>
                )}
                {searchSplit.notAdded.map(n => (
                  <CatalogRow
                    key={n.seq}
                    node={n}
                    side="add"
                    state={n.isFolder || n.hasChildren ? treeState(n.seq) : productState(n.seq)}
                    offers={membershipsBySeq.get(n.seq)}
                    currentOfferId={offerId}
                    onEnter={() => enter(n)}
                    onAction={() => {
                      const name = fixEdariName(n.name) ?? n.barcode ?? `#${n.seq}`;
                      if (n.isFolder || n.hasChildren) toggleTree(n.seq, name);
                      else toggleProduct(n.seq, name, n.barcode ?? undefined);
                    }}
                  />
                ))}
              </>
            )}
            {!debounced && (
              <>
                {folders.map(n => (
                  <CatalogRow
                    key={n.seq}
                    node={n}
                    side="add"
                    state={treeState(n.seq)}
                    onEnter={() => enter(n)}
                    onAction={() => toggleTree(n.seq, fixEdariName(n.name) ?? `#${n.seq}`)}
                  />
                ))}
                {products.map(n => (
                  <CatalogRow
                    key={n.seq}
                    node={n}
                    side="add"
                    state={productState(n.seq)}
                    offers={membershipsBySeq.get(n.seq)}
                    currentOfferId={offerId}
                    onAction={() => toggleProduct(n.seq, fixEdariName(n.name) ?? `#${n.seq}`, n.barcode ?? undefined)}
                  />
                ))}
                {!nodesQ.isLoading && folders.length === 0 && products.length === 0 && (
                  <p className="p-8 text-center text-[12px] text-muted">لا عناصر — جرّب البحث أو ارجع للجذر</p>
                )}
              </>
            )}
          </div>
        </section>

        {/* يمين: مضاف للعرض */}
        <section className="flex min-h-0 flex-col bg-brand-50/20">
          <div className="shrink-0 border-b border-slate-100 bg-brand-50/60 px-3 py-1.5">
            <h3 className="text-[12px] font-bold text-brand-800">
              {debounced ? `مضاف للعرض (${formatNum(searchSplit?.added.length ?? 0)})` : `محتوى العرض (${formatNum(totalInScope)} صنف · ${formatNum(effectiveTrees.length)} شجرة)`}
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-2">
            {debounced && searchSplit && (
              <>
                {searchSplit.added.length === 0 && effectiveTrees.length === 0 && standalone.length === 0 && (
                  <p className="p-6 text-center text-[12px] text-slate-400">لا نتائج مضافة لهذا البحث</p>
                )}
                {searchSplit.added.map(n => (
                  <CatalogRow
                    key={`in-${n.seq}`}
                    node={n}
                    side="remove"
                    state={n.isFolder || n.hasChildren ? treeState(n.seq) : productState(n.seq)}
                    offers={membershipsBySeq.get(n.seq)}
                    currentOfferId={offerId}
                    onEnter={() => enter(n)}
                    onAction={() => {
                      const name = fixEdariName(n.name) ?? n.barcode ?? `#${n.seq}`;
                      if (n.isFolder || n.hasChildren) toggleTree(n.seq, name);
                      else toggleProduct(n.seq, name, n.barcode ?? undefined);
                    }}
                  />
                ))}
              </>
            )}

            {!debounced && (
              <>
                {effectiveTrees.map(tree => (
                  <ScopeTreeCardView
                    key={tree.treeSeq}
                    offerId={offerId}
                    tree={tree}
                    expanded={expandedTree === tree.treeSeq}
                    onToggle={() => setExpandedTree(e => (e === tree.treeSeq ? null : tree.treeSeq))}
                    isPendingAdd={addTrees.has(tree.treeSeq)}
                    isPendingRemove={removeTrees.has(tree.treeSeq)}
                    onRemove={() => toggleTree(tree.treeSeq, tree.treeName)}
                    onUndoRemove={() => toggleTree(tree.treeSeq, tree.treeName)}
                    discount={treeDiscounts.get(tree.treeSeq) ?? tree.discount ?? defaultDiscount}
                    onDiscountChange={d => setTreeDiscounts(m => new Map(m).set(tree.treeSeq, d))}
                    excludeChanges={excludeChanges}
                    onToggleExclude={(detailId, excluded) => setExcludeChanges(m => new Map(m).set(detailId, excluded))}
                  />
                ))}

                {standalone
                  .filter(s => s.seq == null || !removeRows.has(s.seq))
                  .map(item => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                      <IconPackage size={14} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-header">{item.name}</span>
                      {item.meta && <span className="text-[10px] text-slate-400">{item.meta}</span>}
                      <Btn size="sm" variant="ghost" className="!text-red-500" onClick={() => toggleStandalone(item)}>
                        <IconX size={12} /> إزالة
                      </Btn>
                    </div>
                  ))}

                {addProducts.size > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50/80">
                    <p className="border-b border-amber-200 px-2.5 py-1 text-[10px] font-bold text-amber-800">سيُضاف — منتجات</p>
                    {[...addProducts.values()].map(p => (
                      <div key={p.seq} className="flex items-center gap-2 px-2.5 py-1">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-amber-900">{p.name}</span>
                        <Btn size="sm" variant="ghost" onClick={() => toggleProduct(p.seq, p.name, p.barcode)}>
                          <IconX size={12} />
                        </Btn>
                      </div>
                    ))}
                  </div>
                )}

                {effectiveTrees.length === 0 && standalone.length === 0 && addProducts.size === 0 && (
                  <p className="py-10 text-center text-[12px] text-slate-400">لا محتوى — أضف من العمود الأيسر أو ابحث عن منتج</p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CatalogRow({
  node: n,
  side,
  state,
  offers,
  currentOfferId,
  onEnter,
  onAction,
}: {
  node: TreeNodeDto;
  side: 'add' | 'remove';
  state: RowState;
  offers?: ProductOfferMembershipDto[];
  currentOfferId?: number;
  onEnter?: () => void;
  onAction: () => void;
}) {
  const isFolder = n.isFolder || n.hasChildren;
  const name = fixEdariName(n.name) ?? n.barcode ?? `#${n.seq}`;
  const pendingAdd = state === 'staged-add';
  const pendingRemove = state === 'staged-remove';
  const inScope = state === 'in-scope';

  return (
    <div
      className={`flex items-start gap-2 border-b border-slate-50 px-2.5 py-1.5 transition ${
        pendingAdd ? 'bg-amber-50' : pendingRemove ? 'bg-red-50/80' : inScope ? 'bg-brand-50/40' : 'hover:bg-slate-50'
      }`}
    >
      {isFolder ? (
        <button type="button" onClick={onEnter} className="flex min-w-0 flex-1 items-center gap-2 text-right">
          <IconFolderClosed size={15} className="shrink-0 text-amber-600" />
          <span className={`truncate text-[12px] font-semibold ${pendingRemove ? 'line-through text-red-500' : 'text-header'}`}>{name}</span>
        </button>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <IconPackage size={14} className="shrink-0 text-slate-400" />
            <span className={`min-w-0 flex-1 truncate text-[12px] ${pendingRemove ? 'line-through text-red-500' : 'font-medium text-header'}`}>{name}</span>
            {(n.price ?? 0) > 0 && (
              <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-slate-700">{formatNum(n.price ?? 0)}</span>
            )}
          </div>
          {n.barcode && <p className="ps-6 font-mono text-[10px] text-slate-400">{n.barcode}</p>}
          <div className="ps-6">
            <OfferMembershipPills offers={offers} currentOfferId={currentOfferId} mode="others" />
          </div>
        </div>
      )}
      {pendingAdd && <span className="mt-0.5 text-[9px] font-bold text-amber-700">مؤقّت</span>}
      {pendingRemove && <span className="mt-0.5 text-[9px] font-bold text-red-600">سيُزال</span>}
      {inScope && side === 'add' && <IconCheckCircle size={13} className="mt-0.5 text-brand-600" />}
      <Btn
        size="sm"
        variant={side === 'add' ? 'primary' : 'ghost'}
        className={side === 'remove' ? '!text-red-600 hover:!bg-red-50' : ''}
        onClick={onAction}
      >
        {side === 'add' ? (
          pendingAdd ? <><IconX size={12} /> تراجع</> : <><IconPlus size={12} /> {isFolder ? 'الشجرة' : 'إضافة'}</>
        ) : pendingRemove ? (
          <><IconRefresh size={12} /> تراجع</>
        ) : (
          <><IconX size={12} /> {isFolder ? 'إزالة الشجرة' : 'إزالة'}</>
        )}
      </Btn>
    </div>
  );
}

function ScopeTreeCardView({
  offerId,
  tree,
  expanded,
  onToggle,
  isPendingAdd,
  isPendingRemove,
  onRemove,
  onUndoRemove,
  discount,
  onDiscountChange,
  excludeChanges,
  onToggleExclude,
}: {
  offerId: number;
  tree: ScopeTreeCard;
  expanded: boolean;
  onToggle: () => void;
  isPendingAdd: boolean;
  isPendingRemove: boolean;
  onRemove: () => void;
  onUndoRemove: () => void;
  discount: number;
  onDiscountChange: (d: number) => void;
  excludeChanges: Map<number, boolean>;
  onToggleExclude: (detailId: number, excluded: boolean) => void;
}) {
  const [products, setProducts] = useState<ScopeTreeProduct[] | null>(null);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!expanded || isPendingAdd) return;
    if (loaded.current && products) return;
    loaded.current = true;
    setLoading(true);
    void api.offerTreeProducts(offerId, tree.treeSeq)
      .then(rows =>
        setProducts(
          rows.map(r => ({
            seq: r.seq,
            name: r.name ?? `#${r.seq}`,
            barcode: r.barcode,
            price: r.price,
            inScope: r.inOffer,
            excluded: r.excluded,
            discount: r.discount,
            rowId: r.detailId,
          })),
        ),
      )
      .finally(() => setLoading(false));
  }, [expanded, offerId, tree.treeSeq, isPendingAdd, products]);

  return (
    <article className={`overflow-hidden rounded-lg border ${isPendingRemove ? 'border-red-300 bg-red-50/50' : isPendingAdd ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-right">
          <IconChevronDown size={14} className={`shrink-0 text-brand-600 transition ${expanded ? '' : '-rotate-90'}`} />
          <IconFolderClosed size={14} className="text-amber-600" />
          <span className={`truncate text-[12px] font-bold ${isPendingRemove ? 'line-through text-red-500' : 'text-header'}`}>{tree.treeName}</span>
          <span className="text-[10px] text-slate-500">{formatNum(tree.count)} صنف</span>
        </button>
        <label className="flex items-center gap-1 text-[10px] text-slate-500">
          خصم %
          <input
            type="number"
            min={0}
            max={100}
            value={discount}
            onChange={e => onDiscountChange(Number(e.target.value) || 0)}
            className="w-12 rounded border border-slate-200 px-1 py-0.5 text-center text-[11px] font-bold"
          />
        </label>
        {isPendingRemove ? (
          <Btn size="sm" variant="secondary" onClick={onUndoRemove}>تراجع</Btn>
        ) : (
          <Btn size="sm" variant="ghost" className="!text-red-500" onClick={onRemove}>
            <IconX size={12} />
          </Btn>
        )}
        {isPendingAdd && <span className="text-[10px] font-bold text-amber-700">شجرة جديدة</span>}
      </div>
      {expanded && !isPendingAdd && (
        <div className="max-h-[200px] overflow-y-auto border-t border-slate-100">
          {loading && <Loading />}
          {products?.map(p => {
            const detailId = p.rowId;
            const excluded = detailId != null && excludeChanges.has(detailId)
              ? excludeChanges.get(detailId)!
              : p.excluded;
            return (
              <div key={p.seq} className={`flex items-center gap-2 px-2.5 py-1 text-[11px] ${excluded ? 'opacity-50 line-through' : ''}`}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {detailId != null && (
                  <button
                    type="button"
                    onClick={() => onToggleExclude(detailId, !excluded)}
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold text-slate-500 hover:bg-slate-100"
                  >
                    {excluded ? 'إرجاع' : 'استبعاد'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
