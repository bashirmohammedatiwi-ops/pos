import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { OfferDetailDto, ProductOfferMembershipDto, TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
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
  addProducts: { seq: number; name: string; barcode?: string; price?: number }[];
  removeTreeSeqs: number[];
  removeRowIds: number[];
  excludeChanges: { detailId: number; excluded: boolean }[];
  excludeArticleSeqs: { seq: number; excluded: boolean }[];
  treeDiscounts: { treeSeq: number; discount: number }[];
}

export function emptyOfferScopeOps(): OfferScopeOps {
  return {
    addTrees: [],
    addProducts: [],
    removeTreeSeqs: [],
    removeRowIds: [],
    excludeChanges: [],
    excludeArticleSeqs: [],
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
    ops.excludeArticleSeqs.length +
    ops.treeDiscounts.length
  );
}

interface SavedScopeIndex {
  treeSeqs: Set<number>;
  /** seq المنتج المحفوظ → معرّف سطر التفصيل */
  seqRowIds: Map<number, number>;
}

function buildSavedScopeIndex(
  trees: ScopeTreeCard[],
  allDetails: OfferDetailDto[],
  removeTrees: Set<number>,
  removeRows: Map<number, number>,
): SavedScopeIndex {
  const treeSeqs = new Set<number>();
  for (const t of trees) {
    if (!removeTrees.has(t.treeSeq)) treeSeqs.add(t.treeSeq);
  }

  const seqRowIds = new Map<number, number>();
  for (const d of allDetails) {
    if (d.detailRole !== 0 && d.detailRole != null) continue;
    if (d.itemId == null) continue;
    if (removeRows.has(d.itemId)) continue;
    const inTree = d.sourceTreeSeq != null && treeSeqs.has(d.sourceTreeSeq);
    const standalone = d.sourceTreeSeq == null;
    if (standalone || inTree) {
      if (!seqRowIds.has(d.itemId)) seqRowIds.set(d.itemId, d.id);
    }
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
  const [scopeFilter, setScopeFilter] = useState('');
  const [expandedTree, setExpandedTree] = useState<number | null>(null);

  const [addTrees, setAddTrees] = useState<Map<number, { seq: number; name: string }>>(new Map());
  const [addTreeCounts, setAddTreeCounts] = useState<Map<number, number>>(new Map());
  const [addProducts, setAddProducts] = useState<Map<number, { seq: number; name: string; barcode?: string; price?: number }>>(new Map());
  const [removeTrees, setRemoveTrees] = useState<Set<number>>(new Set());
  const [removeRows, setRemoveRows] = useState<Map<number, number>>(new Map());
  const [excludeChanges, setExcludeChanges] = useState<Map<number, boolean>>(new Map());
  const [excludeArticleSeqs, setExcludeArticleSeqs] = useState<Map<number, boolean>>(new Map());
  const [treeDiscounts, setTreeDiscounts] = useState<Map<number, number>>(new Map());

  // عند إعادة تحميل بيانات العرض بعد الحفظ، صفّر العمليات المرحلية
  const prevDetailsStamp = useRef<string>('');
  useEffect(() => {
    const stamp = `${trees.map(t => `${t.treeSeq}:${t.count}:${t.discount ?? ''}`).join('|')}#${standalone.map(s => s.id).join(',')}`;
    if (prevDetailsStamp.current && prevDetailsStamp.current !== stamp) {
      setAddTrees(new Map());
      setAddProducts(new Map());
      setRemoveTrees(new Set());
      setRemoveRows(new Map());
      setExcludeChanges(new Map());
      setExcludeArticleSeqs(new Map());
      setTreeDiscounts(new Map());
    }
    prevDetailsStamp.current = stamp;
  }, [trees, standalone]);

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
      excludeArticleSeqs: [...excludeArticleSeqs.entries()].map(([seq, excluded]) => ({ seq, excluded })),
      treeDiscounts: [...treeDiscounts.entries()].map(([treeSeq, discount]) => ({ treeSeq, discount })),
    });
  }, [addTrees, addProducts, removeTrees, removeRows, excludeChanges, excludeArticleSeqs, treeDiscounts, onOpsChange]);

  const savedScope = useMemo(
    () => buildSavedScopeIndex(trees, allDetails, removeTrees, removeRows),
    [trees, allDetails, removeTrees, removeRows],
  );

  function treeState(seq: number): RowState {
    if (removeTrees.has(seq)) return 'staged-remove';
    if (addTrees.has(seq)) return 'staged-add';
    if (savedScope.treeSeqs.has(seq)) return 'in-scope';
    return 'normal';
  }

  function productState(seq: number): RowState {
    if (removeRows.has(seq) || excludeArticleSeqs.get(seq) === true) return 'staged-remove';
    if (addProducts.has(seq)) return 'staged-add';
    if (savedScope.seqRowIds.has(seq)) return 'in-scope';
    return 'normal';
  }

  function toggleTree(seq: number, name: string) {
    const st = treeState(seq);
    if (st === 'normal') {
      setAddTrees(m => new Map(m).set(seq, { seq, name }));
      setExpandedTree(seq);
      void api.offerTreeProducts(offerId, seq)
        .then(rows => setAddTreeCounts(m => new Map(m).set(seq, rows.length)))
        .catch(() => {});
    } else if (st === 'staged-add') {
      setAddTrees(m => {
        const n = new Map(m);
        n.delete(seq);
        return n;
      });
    } else if (st === 'in-scope') {
      setRemoveTrees(s => new Set(s).add(seq));
    } else {
      setRemoveTrees(s => {
        const n = new Set(s);
        n.delete(seq);
        return n;
      });
    }
  }

  function toggleProduct(seq: number, name: string, barcode?: string, price?: number) {
    const st = productState(seq);
    if (st === 'normal') {
      setAddProducts(m => new Map(m).set(seq, { seq, name, barcode, price }));
    } else if (st === 'staged-add') {
      setAddProducts(m => {
        const n = new Map(m);
        n.delete(seq);
        return n;
      });
    } else if (st === 'in-scope') {
      const rowId = savedScope.seqRowIds.get(seq);
      if (rowId == null || rowId < 0) {
        setExcludeArticleSeqs(m => new Map(m).set(seq, true));
        return;
      }
      setRemoveRows(m => new Map(m).set(seq, rowId));
    } else {
      setExcludeArticleSeqs(m => {
        const n = new Map(m);
        n.delete(seq);
        return n;
      });
      setRemoveRows(m => {
        const n = new Map(m);
        n.delete(seq);
        return n;
      });
    }
  }

  function toggleStandalone(item: ScopeStandaloneItem) {
    const seq = item.seq;
    if (seq == null) return;
    toggleProduct(seq, item.name, item.barcode, item.price);
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
    const stagedList: ScopeTreeCard[] = [];
    for (const t of addTrees.values()) {
      stagedList.push({
        treeSeq: t.seq,
        treeName: t.name,
        count: addTreeCounts.get(t.seq) ?? 0,
        excludedCount: 0,
        discount: defaultDiscount,
      });
    }
    const savedList = trees.filter(t => !removeTrees.has(t.treeSeq));
    return [...stagedList, ...savedList];
  }, [trees, removeTrees, addTrees, addTreeCounts, defaultDiscount]);

  const removedTreesList = useMemo(
    () => trees.filter(t => removeTrees.has(t.treeSeq)),
    [trees, removeTrees],
  );

  const visibleStandalone = useMemo(
    () => standalone.filter(s => s.seq == null || !removeRows.has(s.seq)),
    [standalone, removeRows],
  );

  const removedStandalone = useMemo(
    () => standalone.filter(s => s.seq != null && removeRows.has(s.seq)),
    [standalone, removeRows],
  );

  const filteredStandalone = useMemo(() => {
    const q = scopeFilter.trim().toLowerCase();
    if (!q) return visibleStandalone;
    return visibleStandalone.filter(
      s => s.name.toLowerCase().includes(q) || (s.barcode ?? '').toLowerCase().includes(q) || String(s.seq ?? '').includes(q),
    );
  }, [visibleStandalone, scopeFilter]);

  const stagedProductsList = useMemo(() => {
    const list = [...addProducts.values()].reverse();
    const q = scopeFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      p => p.name.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q) || String(p.seq).includes(q),
    );
  }, [addProducts, scopeFilter]);

  const stagedCount = offerScopeOpsCount({
    addTrees: [...addTrees.values()],
    addProducts: [...addProducts.values()],
    removeTreeSeqs: [...removeTrees],
    removeRowIds: [...removeRows.values()],
    excludeChanges: [...excludeChanges.entries()].map(([detailId, excluded]) => ({ detailId, excluded })),
    excludeArticleSeqs: [...excludeArticleSeqs.entries()].map(([seq, excluded]) => ({ seq, excluded })),
    treeDiscounts: [...treeDiscounts.entries()].map(([treeSeq, discount]) => ({ treeSeq, discount })),
  });

  const totalInScope =
    effectiveTrees.reduce((n, t) => n + t.count, 0) +
    visibleStandalone.length +
    addProducts.size;

  const catalogNodes = useMemo(() => [...folders, ...products], [folders, products]);

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      {/* شريط البحث والمسار */}
      <header className="shrink-0 space-y-1.5 border-b border-slate-100 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
              <IconSearch size={14} />
            </span>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث في الكتالوج بالاسم أو الباركود لإضافة منتجات أو أشجار…"
              className="!ps-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setDebounced('');
                }}
                className="absolute inset-y-0 end-2.5 flex items-center text-slate-400 hover:text-slate-700"
                title="مسح البحث"
              >
                <IconX size={13} />
              </button>
            )}
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
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${nodesQ.data?.source === 'edari' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
            {nodesQ.data?.source === 'edari' ? 'الإداري' : 'محلي'}
          </span>
          {stagedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-300">
              {formatNum(stagedCount)} تعديل جاهز — اضغط «حفظ» لتثبيته
            </span>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* اليمين في RTL (الأول في الـ DOM): الكتالوج والبحث للإضافة */}
        <section className="flex min-h-0 flex-col border-e border-slate-100">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/70 px-3 py-2">
            <h3 className="text-[12.5px] font-bold text-header">
              {debounced ? `نتائج الكتالوج (${formatNum(catalogNodes.length)})` : 'إضافة من الكتالوج'}
            </h3>
            {debounced && (
              <span className="text-[11px] text-slate-400">اضغط «+ إضافة» ليظهر الصنف فوراً في لوحة العرض</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {nodesQ.isLoading && <Loading />}
            {!nodesQ.isLoading && catalogNodes.length === 0 && (
              <p className="p-8 text-center text-[12px] text-slate-400">
                {debounced ? `لا نتائج لـ «${debounced}»` : 'لا عناصر — جرّب البحث أو ارجع للجذر'}
              </p>
            )}
            {catalogNodes.map(n => {
              const isFolder = n.isFolder || n.hasChildren;
              const st = isFolder ? treeState(n.seq) : productState(n.seq);
              const alreadyIn = st === 'in-scope' || st === 'staged-add';
              return (
                <CatalogRow
                  key={n.seq}
                  node={n}
                  side={alreadyIn ? 'remove' : 'add'}
                  state={st}
                  offers={membershipsBySeq.get(n.seq)}
                  currentOfferId={offerId}
                  onEnter={isFolder ? () => enter(n) : undefined}
                  onAction={() => {
                    const name = fixEdariName(n.name) ?? n.barcode ?? `#${n.seq}`;
                    if (isFolder) toggleTree(n.seq, name);
                    else toggleProduct(n.seq, name, n.barcode ?? undefined, n.price ?? undefined);
                  }}
                />
              );
            })}
          </div>
        </section>

        {/* اليسار في RTL (الثاني في الـ DOM): محتوى العرض — مرئي دائماً */}
        <section className="flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-1.5">
            <h3 className="text-[12.5px] font-bold text-header">
              محتوى العرض ({formatNum(totalInScope)} صنف · {formatNum(effectiveTrees.length)} شجرة)
            </h3>
            {(visibleStandalone.length + addProducts.size > 4 || scopeFilter) && (
              <input
                type="search"
                value={scopeFilter}
                onChange={e => setScopeFilter(e.target.value)}
                placeholder="تصفية داخل العرض…"
                className="h-7 w-40 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:border-brand-400"
              />
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {/* 1. المنتجات المضافة الآن — في أعلى القائمة دائماً لتظهر لحظة الإضافة */}
            {stagedProductsList.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-emerald-300 bg-emerald-50/70">
                <div className="flex items-center justify-between border-b border-emerald-200 px-2.5 py-1.5">
                  <span className="text-[11.5px] font-bold text-emerald-900">
                    أُضيف الآن للعرض ({formatNum(addProducts.size)} منتج)
                  </span>
                  <span className="text-[10.5px] font-semibold text-emerald-700">خصم {formatNum(defaultDiscount)}%</span>
                </div>
                <div className="divide-y divide-emerald-100">
                  {stagedProductsList.map(p => (
                    <div key={`staged-${p.seq}`} className="flex items-center gap-2 px-2.5 py-1.5">
                      <IconPackage size={14} className="shrink-0 text-emerald-700" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-emerald-950">{p.name}</p>
                        {p.barcode && <p className="font-mono text-[10.5px] text-emerald-700">{p.barcode}</p>}
                      </div>
                      {(p.price ?? 0) > 0 && (
                        <span className="num text-[11.5px] font-bold text-emerald-900">{formatNum(p.price ?? 0)}</span>
                      )}
                      <Btn
                        size="xs"
                        variant="ghost"
                        className="!text-red-600 hover:!bg-red-50"
                        onClick={() => toggleProduct(p.seq, p.name, p.barcode, p.price)}
                      >
                        <IconX size={12} /> إلغاء
                      </Btn>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. الأشجار (المضافة الآن تظهر أولاً ثم المحفوظة) */}
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
                excludeArticleSeqs={excludeArticleSeqs}
                onToggleExclude={(detailId, excluded) => setExcludeChanges(m => new Map(m).set(detailId, excluded))}
                onToggleExcludeSeq={(seq, excluded) => setExcludeArticleSeqs(m => new Map(m).set(seq, excluded))}
                onCountResolved={cnt => {
                  if (addTrees.has(tree.treeSeq) && addTreeCounts.get(tree.treeSeq) !== cnt) {
                    setAddTreeCounts(m => new Map(m).set(tree.treeSeq, cnt));
                  }
                }}
              />
            ))}

            {/* 3. المنتجات المنفردة المحفوظة */}
            {filteredStandalone.map(item => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                <IconPackage size={14} className="shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-header">{item.name}</p>
                  {item.barcode && <p className="font-mono text-[10.5px] text-slate-400">{item.barcode}</p>}
                </div>
                {item.meta && <span className="text-[11px] font-semibold text-brand-700 num">{item.meta}</span>}
                <Btn size="sm" variant="ghost" className="!text-red-500" onClick={() => toggleStandalone(item)}>
                  <IconX size={12} /> إزالة
                </Btn>
              </div>
            ))}

            {/* 4. العناصر التي حُددت للإزالة (مع زر تراجع) */}
            {(removedTreesList.length > 0 || removedStandalone.length > 0) && (
              <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50/60">
                <p className="border-b border-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700">
                  سيُزال عند الحفظ ({formatNum(removedTreesList.length + removedStandalone.length)})
                </p>
                {removedTreesList.map(t => (
                  <div key={`rm-tree-${t.treeSeq}`} className="flex items-center gap-2 px-2.5 py-1">
                    <IconFolderClosed size={13} className="shrink-0 text-red-400" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-red-600 line-through">{t.treeName}</span>
                    <Btn size="xs" variant="ghost" onClick={() => toggleTree(t.treeSeq, t.treeName)}>
                      <IconRefresh size={12} /> تراجع
                    </Btn>
                  </div>
                ))}
                {removedStandalone.map(item => (
                  <div key={`rm-item-${item.id}`} className="flex items-center gap-2 px-2.5 py-1">
                    <IconPackage size={13} className="shrink-0 text-red-400" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-red-600 line-through">{item.name}</span>
                    <Btn size="xs" variant="ghost" onClick={() => toggleStandalone(item)}>
                      <IconRefresh size={12} /> تراجع
                    </Btn>
                  </div>
                ))}
              </div>
            )}

            {effectiveTrees.length === 0 && visibleStandalone.length === 0 && addProducts.size === 0 && (
              <p className="py-10 text-center text-[12px] text-slate-400">
                لا محتوى في العرض بعد — ابحث أو تصفّح من القائمة المقابلة واضغط «+ إضافة»
              </p>
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
        pendingAdd ? 'bg-emerald-50/80' : pendingRemove ? 'bg-red-50/80' : inScope ? 'bg-brand-50/40' : 'hover:bg-slate-50'
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
          {n.barcode && <p className="ps-6 font-mono text-[11px] text-slate-400">{n.barcode}</p>}
          <div className="ps-6">
            <OfferMembershipPills offers={offers} currentOfferId={currentOfferId} mode="others" />
          </div>
        </div>
      )}
      {pendingAdd && <span className="mt-0.5 text-[10.5px] font-bold text-emerald-700">أُضيف الآن</span>}
      {pendingRemove && <span className="mt-0.5 text-[10.5px] font-bold text-red-600">سيُزال</span>}
      {inScope && <IconCheckCircle size={13} className="mt-1 shrink-0 text-brand-600" />}
      <Btn
        size="sm"
        variant={side === 'add' && !pendingRemove ? 'primary' : 'ghost'}
        className={side === 'remove' || pendingAdd ? '!text-red-600 hover:!bg-red-50' : ''}
        onClick={onAction}
      >
        {pendingAdd ? (
          <><IconX size={12} /> تراجع</>
        ) : pendingRemove ? (
          <><IconRefresh size={12} /> تراجع</>
        ) : inScope ? (
          <><IconX size={12} /> {isFolder ? 'إزالة الشجرة' : 'إزالة'}</>
        ) : (
          <><IconPlus size={12} /> {isFolder ? 'الشجرة' : 'إضافة'}</>
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
  excludeArticleSeqs,
  onToggleExclude,
  onToggleExcludeSeq,
  onCountResolved,
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
  excludeArticleSeqs: Map<number, boolean>;
  onToggleExclude: (detailId: number, excluded: boolean) => void;
  onToggleExcludeSeq: (seq: number, excluded: boolean) => void;
  onCountResolved?: (count: number) => void;
}) {
  const [products, setProducts] = useState<ScopeTreeProduct[] | null>(null);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!expanded) return;
    if (loaded.current && products) return;
    loaded.current = true;
    setLoading(true);
    void api.offerTreeProducts(offerId, tree.treeSeq)
      .then(rows => {
        const mapped = rows.map(r => ({
          seq: r.seq,
          name: r.name ?? `#${r.seq}`,
          barcode: r.barcode,
          price: r.price,
          inScope: isPendingAdd ? !r.excluded : r.inOffer,
          excluded: r.excluded,
          discount: r.discount,
          rowId: r.detailId,
        }));
        setProducts(mapped);
        onCountResolved?.(mapped.length);
      })
      .finally(() => setLoading(false));
  }, [expanded, offerId, tree.treeSeq, isPendingAdd, products, onCountResolved]);

  const displayCount = products ? products.length : tree.count;

  return (
    <article className={`overflow-hidden rounded-xl border ${isPendingRemove ? 'border-red-300 bg-red-50/50' : isPendingAdd ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-right">
          <IconChevronDown size={14} className={`shrink-0 text-brand-600 transition ${expanded ? '' : '-rotate-90'}`} />
          <IconFolderClosed size={14} className="text-amber-600" />
          <span className={`truncate text-[12px] font-bold ${isPendingRemove ? 'line-through text-red-500' : 'text-header'}`}>{tree.treeName}</span>
          <span className="text-[11px] text-slate-500 num">{formatNum(displayCount)} صنف</span>
        </button>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          خصم %
          <input
            type="number"
            min={0}
            max={100}
            value={discount || ''}
            placeholder="0"
            onChange={e => onDiscountChange(Number(e.target.value) || 0)}
            className="num w-14 rounded-md border border-slate-200 bg-white px-1 py-1 text-center text-[12px] font-bold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
        </label>
        {isPendingRemove ? (
          <Btn size="sm" variant="secondary" onClick={onUndoRemove}>تراجع</Btn>
        ) : (
          <Btn size="sm" variant="ghost" className="!text-red-500" onClick={onRemove}>
            <IconX size={12} />
          </Btn>
        )}
        {isPendingAdd && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800">أُضيفت الآن</span>}
      </div>
      {expanded && (
        <div className="max-h-[220px] overflow-y-auto border-t border-slate-100 bg-white/80">
          {loading && <Loading />}
          {products?.map(p => {
            const detailId = p.rowId;
            const excluded = excludeArticleSeqs.has(p.seq)
              ? excludeArticleSeqs.get(p.seq)!
              : detailId != null && excludeChanges.has(detailId)
                ? excludeChanges.get(detailId)!
                : p.excluded;
            return (
              <div key={p.seq} className={`flex items-center gap-2 border-b border-slate-50 px-2.5 py-1 text-[11.5px] ${excluded ? 'opacity-50 line-through' : ''}`}>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{p.name}</span>
                {p.barcode && <span className="font-mono text-[10.5px] text-slate-400">{p.barcode}</span>}
                {p.price > 0 && <span className="num text-[11px] font-semibold text-slate-600">{formatNum(p.price)}</span>}
                <button
                  type="button"
                  onClick={() => {
                    if (detailId != null) onToggleExclude(detailId, !excluded);
                    else onToggleExcludeSeq(p.seq, !excluded);
                  }}
                  className="rounded px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500 hover:bg-slate-100"
                >
                  {excluded ? 'إرجاع' : 'استبعاد'}
                </button>
              </div>
            );
          })}
          {!loading && products?.length === 0 && (
            <p className="p-3 text-center text-[11px] text-slate-400">لا أصناف تحت هذه الشجرة</p>
          )}
        </div>
      )}
    </article>
  );
}
