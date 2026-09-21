import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { useToast } from '@/components/Toast';
import { Btn, Input, Loading } from '@/components/ui';
import {
  IconCheckCircle,
  IconChevronDown,
  IconFolderClosed,
  IconPackage,
  IconRefresh,
  IconSearch,
  IconX,
} from '@/components/icons';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TreeScopeEditor — the shared two-sided scope editor for Offers, Commission
 * Groups and Targets.
 *
 *   LEFT  (in RTL): catalog browse — tree breadcrumb + folders/products +
 *                   instant search + barcode lookup + one-click «إضافة الشجرة».
 *   RIGHT: the current scope — expandable tree cards showing EVERY product
 *          currently under each tree (name/price/state), drift badge
 *          «+N جديدة في الإداري», refresh-membership button, per-item
 *          exclude toggle, and standalone product rows.
 *
 * Everything applies IMMEDIATELY (no hidden check-then-save step).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ScopeTreeCard {
  treeSeq: number;
  treeName: string;
  /** Products of this batch currently inside the scope (non-excluded). */
  count: number;
  excludedCount: number;
  lastSyncedAt?: string;
  /** Offer-specific: the batch's shared discount percent. */
  discount?: number;
}

export interface ScopeStandaloneItem {
  id: number;
  seq?: number;
  name: string;
  barcode?: string;
  meta?: string;
  price?: number;
}

export interface TreeScopeEditorProps {
  /** Cards shown on the right side, one per tree batch. */
  trees: ScopeTreeCard[];
  /** Standalone (non-tree) items. */
  standalone: ScopeStandaloneItem[];
  /** Load ALL products currently under a tree with in-scope/excluded state. */
  loadTreeProducts: (treeSeq: number) => Promise<ScopeTreeProduct[]>;
  /** Resolve drift: current tree size in Edari vs card count. */
  loadTreeSize: (treeSeq: number) => Promise<number>;
  /** Apply handlers — all immediate. */
  onAddTree: (node: { seq: number; name: string }) => Promise<void>;
  onAddProduct: (product: { seq: number; name: string; barcode?: string }) => Promise<void>;
  onRemoveTree: (treeSeq: number) => Promise<void>;
  onRemoveStandalone: (item: ScopeStandaloneItem) => Promise<void>;
  onRefreshTree: (treeSeq: number) => Promise<number>;
  /** treeSeq + product detailId (offers) or item id (groups); undefined = not supported. */
  onToggleExclude?: (treeSeq: number, product: ScopeTreeProduct) => Promise<void>;
  /** Offer mode: show discount badges and editable per-tree discount. */
  offerMode?: {
    getDiscountPreview: (price: number, discount: number) => string;
    onUpdateTreeDiscount?: (treeSeq: number, discount: number) => Promise<void>;
  };
  labels?: {
    browseTitle?: string;
    scopeTitle?: string;
    treeWord?: string;
    emptyHint?: string;
  };
  /** Additional per-tree trailing content (e.g. move-to-group select). */
  renderTreeExtra?: (tree: ScopeTreeCard) => React.ReactNode;
  /** إخفاء لوحة التصفح — الإضافة/الإزالة تتم عبر ScopePickerModal. */
  hideBrowse?: boolean;
  /** زر/أدوات تُعرض في رأس لوحة المحتوى (مثل «إضافة / إزالة أصناف»). */
  toolbar?: React.ReactNode;
  /** املأ ارتفاع الحاوية — للصفحات ذات العمودين الثابتين. */
  fill?: boolean;
}

export interface ScopeTreeProduct {
  seq: number;
  name: string;
  barcode?: string;
  price: number;
  inScope: boolean;
  excluded: boolean;
  discount?: number;
  /** detail/item row id — required for exclusion toggles. */
  rowId?: number;
}

export function TreeScopeEditor({
  trees,
  standalone,
  loadTreeProducts,
  loadTreeSize,
  onAddTree,
  onAddProduct,
  onRemoveTree,
  onRemoveStandalone,
  onRefreshTree,
  onToggleExclude,
  offerMode,
  labels,
  renderTreeExtra,
  hideBrowse,
  toolbar,
  fill,
}: TreeScopeEditorProps) {
  const scopeTitle = labels?.scopeTitle ?? 'المحتوى';
  return (
    <div className={`grid min-h-0 gap-3 ${fill ? 'h-full' : 'min-h-[420px]'} ${hideBrowse ? '' : 'lg:grid-cols-2'}`}>
      {!hideBrowse && (
        <CatalogBrowsePane
          title={labels?.browseTitle}
          onAddTree={onAddTree}
          onAddProduct={onAddProduct}
        />
      )}
      <ScopeContentPane
        trees={trees}
        standalone={standalone}
        loadTreeProducts={loadTreeProducts}
        loadTreeSize={loadTreeSize}
        onRemoveTree={onRemoveTree}
        onRemoveStandalone={onRemoveStandalone}
        onRefreshTree={onRefreshTree}
        onToggleExclude={onToggleExclude}
        offerMode={offerMode}
        scopeTitle={scopeTitle}
        emptyHint={labels?.emptyHint}
        renderTreeExtra={renderTreeExtra}
        toolbar={toolbar}
      />
    </div>
  );
}

/* ══════════════════════════ LEFT: catalog browse ═════════════════════════ */

function CatalogBrowsePane({
  title,
  onAddTree,
  onAddProduct,
}: {
  title?: string;
  onAddTree: (node: { seq: number; name: string }) => Promise<void>;
  onAddProduct: (product: { seq: number; name: string; barcode?: string }) => Promise<void>;
}) {
  const [parent, setParent] = useState<number | undefined>();
  const [path, setPath] = useState<{ seq: number; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const nodesQ = useQuery({
    queryKey: ['scope-tree-browse', parent, debounced],
    queryFn: async () => {
      try {
        const edari = await api.edariTree(parent, debounced || undefined);
        if (edari.length) return { nodes: edari, source: 'edari' as const };
      } catch { /* local fallback */ }
      const local = await api.articleTree(parent, debounced || undefined);
      return { nodes: local, source: 'local' as const };
    },
    staleTime: 60_000,
  });

  const { folders, products } = useMemo(() => {
    const list = nodesQ.data?.nodes ?? [];
    return {
      folders: list.filter(n => n.isFolder || n.hasChildren),
      products: list.filter(n => !n.isFolder && !n.hasChildren),
    };
  }, [nodesQ.data]);

  function enter(node: TreeNodeDto) {
    setPath(p => [...p, { seq: node.seq, name: fixEdariName(node.name) || `#${node.seq}` }]);
    setParent(node.seq);
    setSearch('');
    setDebounced('');
  }

  function goUp() {
    const next = path.slice(0, -1);
    setPath(next);
    setParent(next.length ? next[next.length - 1].seq : undefined);
  }

  async function addFolder(node: TreeNodeDto) {
    setBusy(`f-${node.seq}`);
    try {
      await onAddTree({ seq: node.seq, name: fixEdariName(node.name) || `#${node.seq}` });
      toast.success(`أُضيفت الشجرة «${fixEdariName(node.name) ?? node.seq}» بكامل منتجاتها`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إضافة الشجرة');
    } finally {
      setBusy(null);
    }
  }

  async function addProduct(node: TreeNodeDto) {
    setBusy(`p-${node.seq}`);
    try {
      await onAddProduct({ seq: node.seq, name: fixEdariName(node.name) ?? `#${node.seq}`, barcode: node.barcode ?? undefined });
      toast.success('أُضيف المنتج');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إضافة المنتج');
    } finally {
      setBusy(null);
    }
  }

  async function lookupBarcode() {
    const term = search.trim();
    if (term.length < 6) return;
    setBusy('barcode');
    try {
      const p = await api.productByBarcode(term);
      await onAddProduct({ seq: p.seq || p.id, name: fixEdariName(p.name) ?? p.barcode ?? `#${p.seq}`, barcode: p.barcode ?? undefined });
      toast.success(`أُضيف: ${fixEdariName(p.name) ?? p.barcode}`);
      setSearch('');
    } catch {
      toast.error('لا منتج بهذا الباركود');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="shrink-0 space-y-2 border-b border-slate-100 bg-white px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-bold text-header">{title ?? 'إضافة شجرة أو منتج'}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              nodesQ.data?.source === 'edari' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {nodesQ.data?.source === 'edari' ? 'شجرة الإداري' : 'محلي'}
          </span>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
            <IconSearch size={14} />
          </span>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && isBarcodeLike(search)) void lookupBarcode();
            }}
            placeholder="بحث بالاسم/الرقم — أو باركود ثم Enter"
            className="py-1.5 pe-3 ps-8"
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <button type="button" onClick={goUp} disabled={path.length === 0}
            className="rounded-lg px-2 py-1 font-semibold transition enabled:hover:bg-slate-100 disabled:opacity-40">
            ↑ الجذر
          </button>
          <span className="truncate">/ {path.map(p => p.name).join(' / ')}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {nodesQ.isLoading && <Loading />}
        {!nodesQ.isLoading && folders.length === 0 && products.length === 0 && (
          <p className="p-8 text-center text-[12.5px] text-muted">لا نتائج — جرّب مصطلحاً أقصر</p>
        )}
        {folders.map(n => (
          <div key={n.seq} className="group flex items-center gap-2 border-b border-slate-50 px-3.5 py-2 transition hover:bg-brand-50/30">
            <button type="button" onClick={() => enter(n)} className="flex min-w-0 flex-1 items-center gap-2.5 text-right">
              <span className="icon-tile h-8 w-8 bg-amber-50 text-amber-600"><IconFolderClosed size={15} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-header">{fixEdariName(n.name) ?? n.num ?? `#${n.seq}`}</span>
                <span className="block text-[10px] text-slate-400">شجرة — اضغط لإضافة كامل منتجاتها</span>
              </span>
            </button>
            <Btn size="sm" loading={busy === `f-${n.seq}`} onClick={() => void addFolder(n)}>
              + الشجرة
            </Btn>
          </div>
        ))}
        {products.map(n => (
          <div key={n.seq} className="group flex items-center gap-2 border-b border-slate-50 px-3.5 py-2 transition hover:bg-brand-50/30">
            <span className="icon-tile h-8 w-8 bg-slate-100 text-slate-500"><IconPackage size={14} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-header">{fixEdariName(n.name) ?? n.barcode ?? `#${n.seq}`}</span>
              {n.barcode && <span className="block font-mono text-[10px] text-slate-400">{n.barcode}</span>}
            </span>
            {(n.price ?? 0) > 0 && (
              <span className="shrink-0 text-[12px] font-bold tabular-nums text-slate-700">{formatNum(n.price ?? 0)}</span>
            )}
            <Btn size="sm" variant="secondary" loading={busy === `p-${n.seq}`} onClick={() => void addProduct(n)}>
              إضافة
            </Btn>
          </div>
        ))}
      </div>

      <footer className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 text-[11px] text-slate-500">
        الشجرة تدخل بكل منتجاتها — المنتج يُضاف منفرداً
      </footer>
    </section>
  );
}

function isBarcodeLike(term: string) {
  const t = term.trim();
  return t.length >= 6 && /^\d+$/.test(t);
}

/* ═════════════════════════ RIGHT: scope content ═════════════════════════ */

function ScopeContentPane(props: {
  trees: ScopeTreeCard[];
  standalone: ScopeStandaloneItem[];
  loadTreeProducts: (treeSeq: number) => Promise<ScopeTreeProduct[]>;
  loadTreeSize: (treeSeq: number) => Promise<number>;
  onRemoveTree: (treeSeq: number) => Promise<void>;
  onRemoveStandalone: (item: ScopeStandaloneItem) => Promise<void>;
  onRefreshTree: (treeSeq: number) => Promise<number>;
  onToggleExclude?: (treeSeq: number, product: ScopeTreeProduct) => Promise<void>;
  offerMode?: TreeScopeEditorProps['offerMode'];
  scopeTitle: string;
  emptyHint?: string;
  renderTreeExtra?: (tree: ScopeTreeCard) => React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  const { trees, standalone, loadTreeProducts, loadTreeSize, onRemoveTree, onRemoveStandalone, onRefreshTree, onToggleExclude, offerMode, scopeTitle, emptyHint, renderTreeExtra, toolbar } = props;
  const [expanded, setExpanded] = useState<number | null>(null);
  const toast = useToast();

  const totalItems = trees.reduce((n, t) => n + t.count, 0) + standalone.length;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-brand-200/70 bg-white">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-2.5">
        <h3 className="text-[13px] font-bold text-header">
          {scopeTitle}
          <span className="ms-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">
            {formatNum(totalItems)} صنف · {formatNum(trees.length)} شجرة
          </span>
        </h3>
        {toolbar}
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {trees.length === 0 && standalone.length === 0 && (
          <div className="flex min-h-[160px] flex-col items-center justify-center px-4 py-10 text-center">
            <p className="text-[13px] font-semibold text-header">لا شيء في النطاق بعد</p>
            <p className="mt-1 max-w-xs text-[12px] leading-5 text-slate-500">
              {emptyHint ?? 'أضف شجرة كاملة أو منتجاً مفرداً من العمود المقابل'}
            </p>
          </div>
        )}

        {trees.map(tree => (
          <TreeCard
            key={tree.treeSeq}
            tree={tree}
            expanded={expanded === tree.treeSeq}
            onToggleExpand={() => setExpanded(e => (e === tree.treeSeq ? null : tree.treeSeq))}
            loadTreeProducts={loadTreeProducts}
            loadTreeSize={loadTreeSize}
            onRemoveTree={onRemoveTree}
            onRefreshTree={onRefreshTree}
            onToggleExclude={onToggleExclude}
            offerMode={offerMode}
            toast={toast}
            renderExtra={renderTreeExtra}
          />
        ))}

        {standalone.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <p className="border-b border-slate-100 bg-slate-50/70 px-3 py-1.5 text-[11px] font-bold text-slate-500">
              منتجات مفردة ({formatNum(standalone.length)})
            </p>
            {standalone.slice(0, 60).map(item => (
              <div key={item.id} className="group flex items-center gap-2 border-b border-slate-50 px-3 py-1.5 last:border-b-0 hover:bg-slate-50/60">
                <span className="icon-tile h-7 w-7 bg-slate-100 text-slate-500"><IconPackage size={13} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-header">{item.name}</span>
                  {(item.barcode || item.meta) && (
                    <span className="block truncate font-mono text-[10px] text-slate-400">{item.barcode ?? item.meta}</span>
                  )}
                </span>
                {(item.price ?? 0) > 0 && (
                  <span className="shrink-0 text-[12px] font-bold tabular-nums text-slate-700">{formatNum(item.price ?? 0)}</span>
                )}
                <button
                  type="button"
                  onClick={() => void onRemoveStandalone(item).catch(() => toast.error('تعذرت الإزالة'))}
                  className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                  title="إزالة"
                >
                  <IconX size={14} />
                </button>
              </div>
            ))}
            {standalone.length > 60 && (
              <p className="px-3 py-1.5 text-center text-[10.5px] text-slate-400">
                + {formatNum(standalone.length - 60)} أخرى
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TreeCard(props: {
  tree: ScopeTreeCard;
  expanded: boolean;
  onToggleExpand: () => void;
  loadTreeProducts: (treeSeq: number) => Promise<ScopeTreeProduct[]>;
  loadTreeSize: (treeSeq: number) => Promise<number>;
  onRemoveTree: (treeSeq: number) => Promise<void>;
  onRefreshTree: (treeSeq: number) => Promise<number>;
  onToggleExclude?: (treeSeq: number, product: ScopeTreeProduct) => Promise<void>;
  offerMode?: TreeScopeEditorProps['offerMode'];
  toast: ReturnType<typeof useToast>;
  renderExtra?: (tree: ScopeTreeCard) => React.ReactNode;
}) {
  const { tree, expanded, onToggleExpand, loadTreeProducts, loadTreeSize, onRemoveTree, onRefreshTree, onToggleExclude, offerMode, toast, renderExtra } = props;
  const qc = useQueryClient();
  const [products, setProducts] = useState<ScopeTreeProduct[] | null>(null);
  const [treeSize, setTreeSize] = useState<number | null>(null);
  const [busy, setBusy] = useState<'expand' | 'refresh' | 'remove' | 'discount' | null>(null);
  const [discountDraft, setDiscountDraft] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState('');
  const loadedOnce = useRef(false);

  // Drift: current Edari size vs what's in scope (only when expanded).
  useEffect(() => {
    if (!expanded || treeSize != null) return;
    void loadTreeSize(tree.treeSeq).then(setTreeSize).catch(() => setTreeSize(null));
  }, [expanded, treeSize, loadTreeSize, tree.treeSeq]);

  useEffect(() => {
    if (expanded && !loadedOnce.current) {
      loadedOnce.current = true;
      setBusy('expand');
      void loadTreeProducts(tree.treeSeq)
        .then(setProducts)
        .catch(() => toast.error('تعذر تحميل منتجات الشجرة'))
        .finally(() => setBusy(null));
    }
  }, [expanded, loadTreeProducts, tree.treeSeq, toast]);

  async function refresh() {
    setBusy('refresh');
    try {
      const added = await onRefreshTree(tree.treeSeq);
      toast.success(added > 0 ? `انضم ${formatNum(added)} صنف جديد من الشجرة` : 'عضوية الشجرة محدّثة — لا جديد');
      setProducts(await loadTreeProducts(tree.treeSeq));
      setTreeSize(await loadTreeSize(tree.treeSeq).catch(() => null));
      qc.invalidateQueries({ queryKey: ['offer-scope'] });
      qc.invalidateQueries({ queryKey: ['offers'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت المزامنة');
    } finally {
      setBusy(null);
    }
  }

  async function removeTree() {
    if (!window.confirm(`إزالة شجرة «${tree.treeName}» وكل منتجاتها من هنا؟`)) return;
    setBusy('remove');
    try {
      await onRemoveTree(tree.treeSeq);
      toast.success('أُزيلت الشجرة');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الإزالة');
    } finally {
      setBusy(null);
    }
  }

  async function saveDiscount() {
    if (!offerMode?.onUpdateTreeDiscount || discountDraft == null) return;
    const value = Number(discountDraft);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error('الخصم نسبة بين 0 و 100');
      return;
    }
    setBusy('discount');
    try {
      await offerMode.onUpdateTreeDiscount(tree.treeSeq, value);
      toast.success(`حُدّث خصم الشجرة إلى ${formatNum(value)}%`);
      setDiscountDraft(null);
      setProducts(await loadTreeProducts(tree.treeSeq).catch(() => products));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحديث الخصم');
    } finally {
      setBusy(null);
    }
  }

  const drift = treeSize != null ? Math.max(0, treeSize - tree.count - tree.excludedCount) : null;
  const visibleProducts = useMemo(() => {
    const list = products ?? [];
    const s = productFilter.trim().toLowerCase();
    const filtered = s
      ? list.filter(p => p.name.toLowerCase().includes(s) || (p.barcode ?? '').toLowerCase().includes(s) || String(p.seq).includes(s))
      : list;
    const cap = 80;
    return { rows: filtered.slice(0, cap), shown: Math.min(filtered.length, cap), total: filtered.length, all: list.length };
  }, [products, productFilter]);

  async function toggleExclude(p: ScopeTreeProduct) {
    if (!onToggleExclude || p.rowId == null) return;
    setProducts(prev => prev?.map(x => x.seq === p.seq ? { ...x, excluded: !p.excluded, inScope: p.excluded ? true : x.inScope } : x) ?? null);
    try {
      await onToggleExclude(tree.treeSeq, p);
    } catch (e) {
      setProducts(prev => prev?.map(x => x.seq === p.seq ? { ...x, excluded: p.excluded } : x) ?? null);
      toast.error(e instanceof Error ? e.message : 'تعذّر التبديل');
    }
  }

  return (
    <article className={`overflow-hidden rounded-xl border ${expanded ? 'border-brand-300 shadow-card' : 'border-slate-200'}`}>
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-2.5">
        <button type="button" onClick={onToggleExpand} className="flex min-w-0 flex-1 items-center gap-2.5 text-right">
          <IconChevronDown size={15} className={`shrink-0 text-brand-600 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          <span className="icon-tile h-8 w-8 bg-amber-100 text-amber-700"><IconFolderClosed size={15} /></span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-header">{tree.treeName}</span>
            <span className="block text-[10.5px] text-slate-500">
              {formatNum(tree.count)} صنف داخل النطاق
              {tree.excludedCount > 0 && ` · ${formatNum(tree.excludedCount)} مستبعد`}
              {offerMode && tree.discount != null && tree.discount > 0 && ` · خصم ${formatNum(tree.discount)}%`}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {drift != null && drift > 0 && (
            <button
              type="button"
              onClick={() => void refresh()}
              title="منتجات جديدة في الإداري تحت هذه الشجرة — اضغط للمزامنة"
              className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200"
            >
              +{formatNum(drift)} جديدة في الإداري ⟳
            </button>
          )}
          {renderExtra?.(tree)}
          <Btn size="sm" variant="secondary" loading={busy === 'refresh'} onClick={() => void refresh()} title="مزامنة عضوية الشجرة مع الإداري">
            <IconRefresh size={12} />
          </Btn>
          <Btn size="sm" variant="ghost" loading={busy === 'remove'} onClick={() => void removeTree()} title="إزالة الشجرة" className="!text-red-500 hover:!bg-red-50">
            <IconX size={12} />
          </Btn>
        </div>
      </div>

      {/* Offer per-tree discount editor */}
      {offerMode?.onUpdateTreeDiscount && expanded && (
        <div className="flex items-center gap-2 border-y border-slate-100 bg-slate-50/60 px-3.5 py-2">
          <span className="text-[11.5px] font-semibold text-slate-600">خصم الشجرة %</span>
          <input
            value={discountDraft ?? (tree.discount != null ? String(tree.discount) : '')}
            onChange={e => setDiscountDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void saveDiscount()}
            className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-[13px] font-bold tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            placeholder={tree.discount != null ? String(tree.discount) : '—'}
          />
          {discountDraft != null && (
            <>
              <Btn size="sm" loading={busy === 'discount'} onClick={() => void saveDiscount()}>حفظ</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setDiscountDraft(null)}>إلغاء</Btn>
            </>
          )}
          <span className="text-[10.5px] text-slate-400">يُطبَّق على كل منتجات الشجرة بما فيها المستقبلية</span>
        </div>
      )}

      {/* Expanded product list */}
      {expanded && (
        <div className="max-h-[380px] overflow-y-auto contain-paint">
          {busy === 'expand' && <Loading />}
          {(products?.length ?? 0) > 12 && (
            <div className="sticky top-0 z-[1] border-b border-slate-100 bg-white/95 px-3 py-1.5">
              <Input
                value={productFilter}
                onChange={e => setProductFilter(e.target.value)}
                placeholder="بحث داخل الشجرة…"
                className="!py-1 text-[12px]"
                data-keep-escape
              />
            </div>
          )}
          {products?.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-muted">لا منتجات حالياً تحت هذه الشجرة</p>
          )}
          {visibleProducts.rows.map(p => (
            <div
              key={p.seq}
              className={`flex items-center gap-2 border-b border-slate-50 px-3.5 py-1.5 last:border-b-0 ${
                p.excluded ? 'bg-slate-50/80 opacity-60' : 'hover:bg-brand-50/25'
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.excluded ? 'bg-red-400' : 'bg-emerald-500'}`} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12.5px] ${p.excluded ? 'line-through text-slate-400' : 'font-medium text-header'}`}>
                  {p.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-slate-400">
                  {p.barcode ?? `Seq ${p.seq}`}
                </span>
              </span>
              <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-slate-600">{formatCurrency(p.price)}</span>
              {offerMode && p.discount != null && p.discount > 0 && !p.excluded && (
                <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  {offerMode.getDiscountPreview(p.price, p.discount)}
                </span>
              )}
              {p.inScope && !p.excluded && (
                <span className="shrink-0 text-emerald-500" title="داخل النطاق"><IconCheckCircle size={13} /></span>
              )}
              {onToggleExclude && p.rowId != null && (
                <button
                  type="button"
                  onClick={() => void toggleExclude(p)}
                  className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${
                    p.excluded
                      ? 'bg-slate-200 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700'
                      : 'bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600'
                  }`}
                >
                  {p.excluded ? 'إرجاع' : 'استبعاد'}
                </button>
              )}
            </div>
          ))}
          {visibleProducts.total > visibleProducts.shown && (
            <p className="px-3 py-1.5 text-center text-[10.5px] text-slate-400">
              يُعرض {formatNum(visibleProducts.shown)} من {formatNum(visibleProducts.total)} — استخدم البحث للوصول للبقية
            </p>
          )}
        </div>
      )}
    </article>
  );
}
