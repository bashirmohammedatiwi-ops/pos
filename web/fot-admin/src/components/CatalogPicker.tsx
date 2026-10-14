import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { api, formatNum } from '@/api/client';
import type { TreeNodeDto } from '@/api/types';
import { Badge, Btn, EmptyState, Field, Input, Skeleton } from '@/components/ui';
import { IconCheck, IconFolderClosed, IconPackage, IconPlus, IconSearch, IconX } from '@/components/icons';

function IconMinus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  );
}
import {
  collectTreeLeaves,
  fetchTreeChildren,
  folderKey,
  isLikelyBarcode,
  loadTreeFolders,
  productKey,
  rowFromProduct,
  rowFromTree,
  treeLabel,
  type CatalogRow,
} from '@/lib/catalogBrowse';

export type { CatalogRow };

export type CatalogSelectedItem = {
  key: string;
  title: string;
  subtitle?: string;
  badge?: string;
  extra?: ReactNode;
  onRemove?: () => void;
};

export type CatalogCommitChange = {
  add: CatalogRow[];
  remove: CatalogSelectedItem[];
};

export type CatalogPickerHandle = {
  peek: () => CatalogCommitChange;
  flush: () => Promise<CatalogCommitChange>;
  discard: () => void;
  hasPending: () => boolean;
};

export type CatalogPickerProps = {
  selectedKeys: Set<string>;
  selected: CatalogSelectedItem[];
  onCommit?: (change: CatalogCommitChange) => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  resetKey?: string | number | null;
  allowFolders?: boolean;
  toolbar?: ReactNode;
  rightActions?: ReactNode;
  hint?: string;
  busy?: boolean;
  leftTitle?: string;
  rightTitle?: string;
  rightEmpty?: string;
  addActionLabel?: string;
  removeActionLabel?: string;
  heightClass?: string;
  fill?: boolean;
  saveHint?: string;
};

function inSelected(row: CatalogRow, selectedKeys: Set<string>) {
  return selectedKeys.has(row.key)
    || selectedKeys.has(row.kind === 'folder' ? folderKey(row.seq) : productKey(row.seq));
}

export const CatalogPicker = forwardRef<CatalogPickerHandle, CatalogPickerProps>(function CatalogPicker({
  selectedKeys,
  selected,
  onCommit,
  onPendingChange,
  resetKey,
  allowFolders = true,
  toolbar,
  rightActions,
  hint,
  busy,
  leftTitle = 'الكتالوج',
  rightTitle = 'المحتوى',
  rightEmpty = 'لا عناصر بعد — أشّر من اليسار ثم زر أيمن لإضافتها هنا',
  addActionLabel = 'إضافة المحددة',
  removeActionLabel = 'إزالة المحددة',
  heightClass = 'h-[560px]',
  fill,
  saveHint,
}, ref) {
  const [productTerm, setProductTerm] = useState('');
  const [debouncedProduct, setDebouncedProduct] = useState('');
  const [page, setPage] = useState(1);
  const [rightFilter, setRightFilter] = useState('');
  const [activeTree, setActiveTree] = useState<TreeNodeDto | null>(null);
  const [treeTrail, setTreeTrail] = useState<TreeNodeDto[]>([]);
  const [leftFilter, setLeftFilter] = useState('');
  const [leftMarks, setLeftMarks] = useState<Map<string, CatalogRow>>(new Map());
  const [pendingAdd, setPendingAdd] = useState<Map<string, CatalogRow>>(new Map());
  const [rightMarks, setRightMarks] = useState<Set<string>>(new Set());
  const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; side: 'left' | 'right'; ensureKey?: string } | null>(null);
  const lastBarcodeMark = useRef('');

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  function selectTree(node: TreeNodeDto | null) {
    setActiveTree(node);
    setTreeTrail([]);
    setLeftFilter('');
  }

  function openChildTree(node: TreeNodeDto) {
    setActiveTree(prev => {
      if (prev) setTreeTrail(t => [...t, prev]);
      return node;
    });
    setLeftFilter('');
  }

  function goBackTree() {
    setTreeTrail(t => {
      const next = [...t];
      setActiveTree(next.pop() ?? null);
      return next;
    });
    setLeftFilter('');
  }

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedProduct(productTerm.trim()), 220);
    return () => window.clearTimeout(id);
  }, [productTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedProduct, activeTree?.seq]);

  useEffect(() => {
    setLeftMarks(new Map());
    setPendingAdd(new Map());
    setRightMarks(new Set());
    setPendingRemove(new Set());
    setCtxMenu(null);
    lastBarcodeMark.current = '';
  }, [resetKey]);

  const barcodeSearch = isLikelyBarcode(debouncedProduct);

  const productsQ = useQuery({
    queryKey: ['catalog-picker-products', debouncedProduct, page],
    queryFn: () => api.products(page, debouncedProduct || undefined, 80),
    placeholderData: keepPreviousData,
    enabled: !activeTree,
  });

  const barcodeQ = useQuery({
    queryKey: ['catalog-picker-barcode', debouncedProduct],
    queryFn: () => api.productByBarcode(debouncedProduct),
    enabled: barcodeSearch,
    retry: false,
  });

  const treeCountQ = useQuery({
    queryKey: ['catalog-picker-tree-count', activeTree?.seq],
    queryFn: async () => {
      try {
        const edari = await api.edariTreeProductCount(activeTree!.seq);
        if (edari.count > 0) return edari;
      } catch {
        /* local */
      }
      return api.treeProductCount(activeTree!.seq);
    },
    enabled: allowFolders && !!activeTree,
    retry: false,
  });

  const childrenQ = useQuery({
    queryKey: ['catalog-picker-children', activeTree?.seq],
    queryFn: () => fetchTreeChildren(activeTree!.seq),
    enabled: allowFolders && !!activeTree,
  });

  const leavesQ = useQuery({
    queryKey: ['catalog-picker-leaves', activeTree?.seq],
    queryFn: () => collectTreeLeaves(activeTree!.seq),
    enabled: allowFolders && !!activeTree,
  });

  const folderRow = useMemo(() => {
    if (!activeTree) return undefined;
    return rowFromTree(activeTree, treeCountQ.data?.count);
  }, [activeTree, treeCountQ.data?.count]);

  const barcodeHit = barcodeQ.isSuccess ? barcodeQ.data : undefined;
  const childFolders = useMemo(
    () => (childrenQ.data ?? []).filter(n => n.isFolder || n.hasChildren),
    [childrenQ.data],
  );
  const childProducts = useMemo(
    () => (childrenQ.data ?? []).filter(n => !n.isFolder && !n.hasChildren).map(n => ({
      key: productKey(n.seq),
      seq: n.seq,
      name: n.name || n.barcode || n.num || `#${n.seq}`,
      barcode: n.barcode,
      num: n.num,
      kind: 'product' as const,
    })),
    [childrenQ.data],
  );

  const treeLeaves = useMemo(() => {
    const items = leavesQ.data?.items?.length ? leavesQ.data.items : childProducts;
    const q = (leftFilter || debouncedProduct).trim().toLowerCase();
    if (!q || barcodeSearch) return items;
    return items.filter(
      r =>
        r.name.toLowerCase().includes(q)
        || (r.barcode ?? '').toLowerCase().includes(q)
        || (r.num ?? '').includes(q)
        || String(r.seq).includes(q),
    );
  }, [leavesQ.data, childProducts, leftFilter, debouncedProduct, barcodeSearch]);

  const rows = useMemo(() => {
    const out: CatalogRow[] = [];
    const seen = new Set<string>();
    const push = (row: CatalogRow) => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      out.push(row);
    };
    if (folderRow) push(folderRow);
    if (barcodeHit) push(rowFromProduct(barcodeHit));
    if (activeTree) {
      const fq = leftFilter.trim().toLowerCase();
      for (const n of childFolders) {
        const row = rowFromTree(n);
        if (fq && !row.name.toLowerCase().includes(fq) && !String(n.seq).includes(fq) && !(n.num ?? '').includes(fq)) {
          continue;
        }
        push(row);
      }
      for (const leaf of treeLeaves) push(leaf);
    } else {
      for (const p of productsQ.data?.items ?? []) push(rowFromProduct(p));
    }
    return out;
  }, [folderRow, barcodeHit, activeTree, childFolders, treeLeaves, productsQ.data, leftFilter]);

  useEffect(() => {
    if (!barcodeSearch || !barcodeQ.isSuccess || !barcodeQ.data) return;
    if (lastBarcodeMark.current === debouncedProduct) return;
    lastBarcodeMark.current = debouncedProduct;
    const row = rowFromProduct(barcodeQ.data);
    if (inSelected(row, selectedKeys) || pendingAdd.has(row.key)) return;
    setLeftMarks(prev => {
      if (prev.has(row.key)) return prev;
      const next = new Map(prev);
      next.set(row.key, row);
      return next;
    });
  }, [barcodeSearch, barcodeQ.isSuccess, barcodeQ.data, debouncedProduct, selectedKeys, pendingAdd]);

  const rightLines = useMemo(() => {
    const lines: Array<{
      key: string;
      title: string;
      subtitle?: string;
      badge?: string;
      extra?: ReactNode;
      kind: 'pending' | 'existing';
      item?: CatalogSelectedItem;
    }> = [];
    const seen = new Set<string>();
    for (const row of pendingAdd.values()) {
      seen.add(row.key);
      lines.push({
        key: row.key,
        title: row.name,
        subtitle: row.kind === 'folder'
          ? `#${row.seq}${row.productCount != null ? ` · ${formatNum(row.productCount)} صنف` : ''}`
          : [row.barcode || row.num, `#${row.seq}`].filter(Boolean).join(' · '),
        badge: 'جديد',
        kind: 'pending',
      });
    }
    for (const item of selected) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      lines.push({
        key: item.key,
        title: item.title,
        subtitle: item.subtitle,
        badge: item.badge,
        extra: item.extra,
        kind: 'existing',
        item,
      });
    }
    return lines;
  }, [pendingAdd, selected]);

  const visibleRight = useMemo(() => {
    const q = rightFilter.trim().toLowerCase();
    if (!q) return rightLines;
    return rightLines.filter(
      s => s.title.toLowerCase().includes(q) || (s.subtitle ?? '').toLowerCase().includes(q) || s.key.includes(q),
    );
  }, [rightLines, rightFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil((productsQ.data?.total ?? 0) / Math.max(1, productsQ.data?.pageSize ?? 80)),
  );
  const catalogLoading =
    (!activeTree && productsQ.isFetching && rows.length === 0)
    || (activeTree && childrenQ.isFetching && leavesQ.isFetching && rows.length <= (folderRow ? 1 : 0));

  const availableLeft = rows.filter(r => !inSelected(r, selectedKeys) && !pendingAdd.has(r.key));
  const markedLeftCount = [...leftMarks.values()].filter(r => !inSelected(r, selectedKeys) && !pendingAdd.has(r.key)).length;
  const hasWork = leftMarks.size > 0 || pendingAdd.size > 0 || rightMarks.size > 0 || pendingRemove.size > 0;

  const snapshotRef = useRef({
    leftMarks,
    pendingAdd,
    rightMarks,
    pendingRemove,
    selected,
    selectedKeys,
  });
  snapshotRef.current = { leftMarks, pendingAdd, rightMarks, pendingRemove, selected, selectedKeys };

  function collectChange(): CatalogCommitChange {
    const s = snapshotRef.current;
    const skipAdd = new Set<string>([...s.rightMarks, ...s.pendingRemove]);
    const addMap = new Map<string, CatalogRow>();
    for (const [k, row] of s.pendingAdd) {
      if (!skipAdd.has(k) && !inSelected(row, s.selectedKeys)) addMap.set(k, row);
    }
    for (const [k, row] of s.leftMarks) {
      if (!skipAdd.has(k) && !inSelected(row, s.selectedKeys) && !addMap.has(k)) addMap.set(k, row);
    }
    const removeMap = new Map<string, CatalogSelectedItem>();
    for (const item of s.selected) {
      if (s.pendingRemove.has(item.key) || s.rightMarks.has(item.key)) removeMap.set(item.key, item);
    }
    return { add: [...addMap.values()], remove: [...removeMap.values()] };
  }

  function clearStaging() {
    setLeftMarks(new Map());
    setPendingAdd(new Map());
    setRightMarks(new Set());
    setPendingRemove(new Set());
    setCtxMenu(null);
  }

  useImperativeHandle(ref, () => ({
    peek: collectChange,
    hasPending: () => {
      const change = collectChange();
      return change.add.length > 0 || change.remove.length > 0 || snapshotRef.current.leftMarks.size > 0
        || snapshotRef.current.rightMarks.size > 0
        || snapshotRef.current.pendingAdd.size > 0
        || snapshotRef.current.pendingRemove.size > 0;
    },
    discard: clearStaging,
    flush: async () => {
      const change = collectChange();
      if (change.add.length || change.remove.length) {
        await onCommitRef.current?.(change);
      }
      clearStaging();
      return change;
    },
  }));

  useEffect(() => {
    onPendingChange?.(hasWork);
  }, [hasWork, onPendingChange]);

  function toggleLeft(row: CatalogRow, checked: boolean) {
    if (inSelected(row, selectedKeys) || pendingAdd.has(row.key)) return;
    setLeftMarks(prev => {
      const next = new Map(prev);
      if (checked) next.set(row.key, row);
      else next.delete(row.key);
      return next;
    });
  }

  function toggleRight(key: string, checked: boolean) {
    setRightMarks(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function rowForKey(key?: string) {
    if (!key) return undefined;
    return leftMarks.get(key) ?? rows.find(r => r.key === key);
  }

  function stageAdd() {
    const addable = [...leftMarks.values()].filter(r => !inSelected(r, selectedKeys) && !pendingAdd.has(r.key));
    const extra = rowForKey(ctxMenu?.side === 'left' ? ctxMenu.ensureKey : undefined);
    if (extra && !inSelected(extra, selectedKeys) && !pendingAdd.has(extra.key) && !addable.some(r => r.key === extra.key)) {
      addable.push(extra);
    }
    if (!addable.length) return;
    setPendingAdd(prev => {
      const next = new Map(prev);
      for (const row of addable) next.set(row.key, row);
      return next;
    });
    setLeftMarks(new Map());
    setCtxMenu(null);
  }

  function stageRemove() {
    const keys = new Set(rightMarks);
    if (ctxMenu?.side === 'right' && ctxMenu.ensureKey) keys.add(ctxMenu.ensureKey);
    if (!keys.size) return;
    setPendingAdd(prev => {
      const next = new Map(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
    setPendingRemove(prev => {
      const next = new Set(prev);
      for (const key of keys) {
        if (selected.some(s => s.key === key)) next.add(key);
      }
      return next;
    });
    setRightMarks(new Set());
    setCtxMenu(null);
  }

  function markVisibleLeft() {
    setLeftMarks(prev => {
      const next = new Map(prev);
      for (const row of availableLeft) next.set(row.key, row);
      return next;
    });
  }

  function onProductKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      setProductTerm('');
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = availableLeft.find(r => r.kind === 'product') ?? rows.find(r => r.kind === 'product' && !inSelected(r, selectedKeys));
    if (first) toggleLeft(first, true);
  }

  function openMenu(e: MouseEvent, side: 'left' | 'right', row?: CatalogRow, rightKey?: string) {
    e.preventDefault();
    e.stopPropagation();
    if (side === 'left' && row && !inSelected(row, selectedKeys) && !pendingAdd.has(row.key) && !leftMarks.has(row.key)) {
      toggleLeft(row, true);
    }
    if (side === 'right' && rightKey && !rightMarks.has(rightKey)) {
      toggleRight(rightKey, true);
    }
    const w = 240;
    const h = 150;
    setCtxMenu({
      x: Math.min(Math.max(8, e.clientX), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, e.clientY), window.innerHeight - h - 8),
      side,
      ensureKey: side === 'left' ? row?.key : rightKey,
    });
  }

  useEffect(() => {
    if (!ctxMenu) return;
    function close() {
      setCtxMenu(null);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setCtxMenu(null);
    }
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const menuLeftRow = ctxMenu?.side === 'left' ? rowForKey(ctxMenu.ensureKey) : undefined;
  const menuLeftAdds = menuLeftRow
    && !inSelected(menuLeftRow, selectedKeys)
    && !pendingAdd.has(menuLeftRow.key)
    && !leftMarks.has(menuLeftRow.key)
    ? 1
    : 0;
  const addReady = markedLeftCount + menuLeftAdds > 0;
  const addReadyCount = markedLeftCount + menuLeftAdds;
  const menuRightAdds = ctxMenu?.side === 'right' && ctxMenu.ensureKey && !rightMarks.has(ctxMenu.ensureKey) ? 1 : 0;
  const removeReady = rightMarks.size + menuRightAdds > 0;
  const removeReadyCount = rightMarks.size + menuRightAdds;

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-1 flex-col gap-2' : 'space-y-3'}>
      <div className={`card shrink-0 ${fill ? 'p-3' : 'p-3.5'}`}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="بحث المنتج / الباركود">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
                {barcodeSearch && barcodeQ.isFetching ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                ) : (
                  <IconSearch size={15} />
                )}
              </span>
              <Input
                autoFocus
                data-keep-escape
                value={productTerm}
                onChange={e => setProductTerm(e.target.value)}
                onKeyDown={onProductKey}
                placeholder="امسح الباركود أو اكتب الاسم — Enter يؤشّر أول نتيجة"
                className="h-10 ps-9 pe-9"
              />
              {productTerm && (
                <button
                  type="button"
                  aria-label="مسح البحث"
                  className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700"
                  onClick={() => setProductTerm('')}
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          </Field>
          {allowFolders ? (
            <Field label="شجرة المواد">
              <TreeSelectField value={activeTree} onChange={selectTree} />
            </Field>
          ) : (
            <div />
          )}
        </div>
        {barcodeSearch && barcodeQ.isError && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-red-600">
            <IconX size={13} /> لا منتج بهذا الباركود
          </p>
        )}
        {barcodeHit && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-brand-700">
            <IconCheck size={13} /> وُجد «{barcodeHit.name || barcodeHit.barcode}» في الكتالوج وتم تأشيره — أضفه ثم احفظ.
          </p>
        )}
        <p className="mt-2 text-[11.5px] leading-5 text-slate-500">
          {hint ?? 'التأشير لا يحفظ. الكتالوج: أشّر ثم «إضافة». المحتوى: أشّر ثم «إزالة». الزر الأيمن يفتح نفس الأوامر. احفظ من أسفل النافذة.'}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {toolbar}
          {availableLeft.length > 0 && (
            <Btn size="sm" variant="secondary" icon={<IconCheck size={13} />} disabled={busy} onClick={markVisibleLeft}>
              تأشير المعروض ({formatNum(availableLeft.length)})
            </Btn>
          )}
          <Btn size="sm" icon={<IconPlus size={13} />} disabled={busy || !addReady} onClick={stageAdd}>
            {addActionLabel}{addReady ? ` (${formatNum(addReadyCount)})` : ''}
          </Btn>
          <Btn size="sm" variant="danger" icon={<IconMinus size={13} />} disabled={busy || !removeReady} onClick={stageRemove}>
            {removeActionLabel}{removeReady ? ` (${formatNum(removeReadyCount)})` : ''}
          </Btn>
        </div>
      </div>

      <div dir="ltr" className={`grid gap-3 lg:grid-cols-2 ${fill ? 'min-h-0 flex-1' : heightClass}`}>
        <section dir="rtl" className="card flex min-h-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="icon-tile h-7 w-7 rounded-lg bg-slate-100 text-slate-600"><IconPackage size={14} /></span>
              <div className="min-w-0">
                <h3 className="truncate text-[13px] font-bold text-header">{leftTitle}</h3>
                <p className="text-[11px] text-slate-500">أشّر الأصناف ثم «{addActionLabel}»</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge className="num">{formatNum(rows.length)}</Badge>
              {markedLeftCount > 0 && <Badge tone="brand" className="num">{formatNum(markedLeftCount)} مؤشّر</Badge>}
            </div>
          </header>

          {activeTree && (
            <div className="space-y-2 border-b border-brand-100 bg-brand-50/50 px-3 py-2 text-[12px] text-brand-950">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {treeTrail.length > 0 && (
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
                      onClick={goBackTree}
                    >
                      ↑ رجوع
                    </button>
                  )}
                  <IconFolderClosed size={13} className="shrink-0 text-amber-500" />
                  <span className="truncate font-semibold">{treeLabel(activeTree)}</span>
                  {treeCountQ.data?.count != null && <span className="shrink-0 num">· {formatNum(treeCountQ.data.count)} صنف</span>}
                  {leavesQ.data?.truncated && <span className="shrink-0">· أول {formatNum(treeLeaves.length)}</span>}
                </span>
                <button type="button" className="shrink-0 text-[11.5px] font-semibold text-brand-700 hover:underline" onClick={() => selectTree(null)}>
                  كل المنتجات
                </button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
                  <IconSearch size={13} />
                </span>
                <Input
                  data-keep-escape
                  value={leftFilter}
                  onChange={e => setLeftFilter(e.target.value)}
                  placeholder="تصفية منتجات هذه الشجرة…"
                  className="h-8 bg-white ps-8 text-[12.5px]"
                />
              </div>
              {leavesQ.isFetching && (
                <p className="flex items-center gap-1.5 text-[11.5px] text-brand-800">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                  جاري تحميل كل منتجات الشجرة…
                </p>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" onContextMenu={e => openMenu(e, 'left')}>
            {catalogLoading && rows.length === 0 && (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
              </div>
            )}
            {rows.map(row => {
              const added = inSelected(row, selectedKeys) || pendingAdd.has(row.key);
              const marked = !added && leftMarks.has(row.key);
              return (
                <CatalogRowLine
                  key={row.key}
                  row={row}
                  checked={added || marked}
                  added={added}
                  disabled={busy || (row.kind === 'folder' && !allowFolders)}
                  onToggle={checked => toggleLeft(row, checked)}
                  onContextMenu={e => openMenu(e, 'left', row)}
                  onOpen={
                    row.kind === 'folder' && activeTree && row.seq !== activeTree.seq
                      ? () => {
                          const node = childFolders.find(n => n.seq === row.seq);
                          if (node) openChildTree(node);
                        }
                      : undefined
                  }
                />
              );
            })}
            {!catalogLoading && rows.length === 0 && (
              <EmptyState
                compact
                icon={activeTree ? <IconFolderClosed size={18} /> : <IconSearch size={18} />}
                title={activeTree ? 'لا أصناف في هذه الشجرة' : 'ابدأ بالبحث'}
                description={activeTree ? 'جرّب شجرة أدنى أو تأكد من المزامنة.' : 'امسح باركوداً أو ابحث عن منتج أو اختر شجرة مواد.'}
              />
            )}
          </div>

          {!activeTree && (
            <footer className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11.5px] text-slate-500">
              <span>
                صفحة <span className="font-semibold text-slate-700 num">{formatNum(page)}</span> / <span className="num">{formatNum(totalPages)}</span>
                {productsQ.data?.total != null && <span className="num"> · {formatNum(productsQ.data.total)} منتج</span>}
              </span>
              <div className="flex gap-1">
                <Btn size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  السابق
                </Btn>
                <Btn size="xs" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  التالي
                </Btn>
              </div>
            </footer>
          )}
        </section>

        <section dir="rtl" className="card flex min-h-0 flex-col overflow-hidden ring-1 ring-inset ring-brand-100">
          <header className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-50/40 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="icon-tile h-7 w-7 rounded-lg bg-brand-100 text-brand-700"><IconCheck size={14} /></span>
              <div className="min-w-0">
                <h3 className="truncate text-[13px] font-bold text-header">{rightTitle}</h3>
                <p className="text-[11px] text-slate-500">أشّر الأصناف ثم «{removeActionLabel}»</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {rightActions}
              <Badge className="num">{formatNum(rightLines.length)}</Badge>
              {pendingAdd.size > 0 && <Badge tone="ok" className="num">+{formatNum(pendingAdd.size)}</Badge>}
              {pendingRemove.size > 0 && <Badge tone="danger" className="num">−{formatNum(pendingRemove.size)}</Badge>}
            </div>
          </header>
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
                <IconSearch size={13} />
              </span>
              <Input
                data-keep-escape
                value={rightFilter}
                onChange={e => setRightFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape' && rightFilter) {
                    e.preventDefault();
                    e.stopPropagation();
                    setRightFilter('');
                  }
                }}
                placeholder="بحث في المحتوى…"
                className="h-8 ps-8 text-[12.5px]"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" onContextMenu={e => openMenu(e, 'right')}>
            {visibleRight.map(item => {
              const marked = rightMarks.has(item.key);
              const dropping = pendingRemove.has(item.key);
              return (
                <div
                  key={item.key}
                  onContextMenu={e => openMenu(e, 'right', undefined, item.key)}
                  onClick={e => {
                    if (busy || dropping) return;
                    if ((e.target as HTMLElement).closest('input, button, a, select, textarea')) return;
                    toggleRight(item.key, !marked);
                  }}
                  className={`flex cursor-pointer items-start gap-2 border-b px-3 py-1.5 transition-colors ${
                    dropping
                      ? 'border-red-100 bg-red-50/80'
                      : marked
                        ? 'border-red-50 bg-red-50/60'
                        : item.kind === 'pending'
                          ? 'border-emerald-50 bg-emerald-50/60'
                          : 'border-slate-100 hover:bg-slate-50/80'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-red-300 accent-red-600"
                    checked={marked || dropping}
                    disabled={busy}
                    onChange={e => toggleRight(item.key, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {item.badge && (
                        <Badge tone={item.kind === 'pending' ? 'ok' : dropping ? 'danger' : 'default'}>
                          {dropping ? 'سيُحذف' : item.badge}
                        </Badge>
                      )}
                      {!item.badge && dropping && <Badge tone="danger">سيُحذف</Badge>}
                      <span
                        className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${dropping ? 'text-red-800 line-through' : 'text-header'}`}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-slate-400" dir="ltr">{item.subtitle}</span>
                      )}
                    </div>
                    {!dropping && item.extra}
                  </div>
                </div>
              );
            })}
            {rightLines.length === 0 && (
              <EmptyState compact icon={<IconPlus size={18} />} title="لا عناصر بعد" description={rightEmpty} />
            )}
            {rightLines.length > 0 && visibleRight.length === 0 && (
              <EmptyState
                compact
                icon={<IconSearch size={18} />}
                title="لا نتائج للتصفية"
                action={<Btn size="xs" variant="secondary" onClick={() => setRightFilter('')}>مسح التصفية</Btn>}
              />
            )}
          </div>
        </section>
      </div>

      <div className="card flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
        <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
          <Badge tone={markedLeftCount ? 'brand' : 'default'} className="num">{formatNum(markedLeftCount)} مؤشّر للإضافة</Badge>
          <Badge tone={pendingAdd.size ? 'ok' : 'default'} className="num">{formatNum(pendingAdd.size)} سيُضاف</Badge>
          <Badge tone={rightMarks.size || pendingRemove.size ? 'danger' : 'default'} className="num">
            {formatNum(pendingRemove.size || rightMarks.size)} سيُحذف
          </Badge>
          <span className="text-[11.5px] text-slate-500">{saveHint ?? 'التأشير لا يحفظ — اضغط حفظ بعد إضافة أو إزالة الأصناف.'}</span>
        </div>
        {hasWork && (
          <Btn size="sm" variant="ghost" icon={<IconX size={13} />} onClick={clearStaging}>إلغاء التحديد</Btn>
        )}
      </div>

      {ctxMenu && createPortal(
        <div
          dir="rtl"
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 90 }}
          className="min-w-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {ctxMenu.side === 'left' ? (
            <>
              <button
                type="button"
                disabled={!addReady}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-right text-[13px] font-medium text-brand-800 hover:bg-brand-50 disabled:text-slate-300"
                onClick={stageAdd}
              >
                <span>{addActionLabel}</span>
                {addReady && <span className="text-[11px] text-brand-600">{formatNum(addReadyCount)}</span>}
              </button>
              <p className="border-t border-slate-100 px-3 py-2 text-[11px] leading-5 text-slate-400">
                تُعرض على اليمين كـ «جديد» ولا تُحفظ حتى تضغط حفظ.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!removeReady}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-right text-[13px] font-medium text-red-700 hover:bg-red-50 disabled:text-slate-300"
                onClick={stageRemove}
              >
                <span>{removeActionLabel}</span>
                {removeReady && <span className="text-[11px] text-red-500">{formatNum(removeReadyCount)}</span>}
              </button>
              <p className="border-t border-slate-100 px-3 py-2 text-[11px] leading-5 text-slate-400">
                تظهر بخط أحمر مشطوب. الإزالة النهائية بعد حفظ النافذة.
              </p>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
});

function TreeSelectField({
  value,
  onChange,
}: {
  value: TreeNodeDto | null;
  onChange: (node: TreeNodeDto | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  function updateBox() {
    const el = boxRef.current;
    if (el) setBox(el.getBoundingClientRect());
  }

  useEffect(() => {
    if (!open) return;
    updateBox();
    const on = () => updateBox();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: globalThis.MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const treesQ = useQuery({
    queryKey: ['catalog-tree-options', debounced],
    queryFn: () => loadTreeFolders(debounced || undefined),
    enabled: true,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const folders = treesQ.data ?? [];

  useEffect(() => {
    if (!debounced) return;
    const exact = folders.find(
      n => String(n.seq) === debounced || (n.num ?? '').trim() === debounced,
    );
    if (exact && value?.seq !== exact.seq) onChange(exact);
  }, [debounced, folders, onChange, value?.seq]);

  const spaceBelow = box ? window.innerHeight - box.bottom : 320;
  const spaceAbove = box?.top ?? 0;
  const flip = spaceBelow < 180 && spaceAbove > spaceBelow;
  const maxH = Math.min(320, Math.max(140, flip ? spaceAbove - 12 : spaceBelow - 12));
  const listStyle = box
    ? {
        position: 'fixed' as const,
        top: flip ? undefined : box.bottom + 4,
        bottom: flip ? window.innerHeight - box.top + 4 : undefined,
        left: box.left,
        width: box.width,
        maxHeight: maxH,
        zIndex: 80,
      }
    : undefined;

  return (
    <div ref={boxRef} className="relative">
      <Input
        data-keep-escape
        value={open ? query : value ? treeLabel(value) : query}
        onChange={e => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          if (value) setQuery('');
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            if (open) {
              setOpen(false);
              return;
            }
            if (query) {
              setQuery('');
              return;
            }
            if (value) onChange(null);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const first = folders[0];
            if (first) {
              onChange(first);
              setQuery('');
              setOpen(false);
            }
          }
        }}
        placeholder="ابحث واختر من كل الأشجار…"
        className="h-10 ps-9 pe-9"
      />
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-amber-500">
        <IconFolderClosed size={15} />
      </span>
      {value && (
        <button
          type="button"
          aria-label="إلغاء اختيار الشجرة"
          title="إلغاء اختيار الشجرة"
          className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700"
          onClick={() => {
            onChange(null);
            setQuery('');
            setOpen(false);
          }}
        >
          <IconX size={14} />
        </button>
      )}
      {open && box && createPortal(
        <ul
          ref={listRef}
          dir="rtl"
          data-keep-escape
          style={listStyle}
          className="overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
        >
          {treesQ.isFetching && folders.length === 0 && (
            <li className="px-3 py-3 text-[12px] text-slate-400">جاري التحميل…</li>
          )}
          {folders.map(n => (
            <li key={n.seq}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-[13px] hover:bg-slate-50 ${
                  value?.seq === n.seq ? 'bg-brand-50' : ''
                }`}
                onClick={() => {
                  onChange(n);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <IconFolderClosed size={14} className="shrink-0 text-amber-500" />
                  <span className="truncate font-medium text-slate-800">{treeLabel(n)}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">#{n.seq}{n.num ? ` · ${n.num}` : ''}</span>
              </button>
            </li>
          ))}
          {!treesQ.isFetching && folders.length === 0 && (
            <li className="px-3 py-4 text-center text-[12px] text-slate-400">لا أشجار مطابقة — غيّر البحث</li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}

function CatalogRowLine({
  row,
  checked,
  added,
  disabled,
  onToggle,
  onOpen,
  onContextMenu,
}: {
  row: CatalogRow;
  checked: boolean;
  added?: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
  onOpen?: () => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  const folder = row.kind === 'folder';
  return (
    <div
      onContextMenu={onContextMenu}
      onClick={e => {
        // النقر على الصف كله يؤشّر/يلغي التأشير
        if (added || disabled) return;
        if ((e.target as HTMLElement).closest('input, button, a')) return;
        onToggle(!checked);
      }}
      className={`flex items-center gap-2 border-b px-3 py-1.5 text-right transition-colors ${
        added
          ? 'border-slate-100 bg-slate-50/80'
          : checked
            ? 'cursor-pointer border-brand-100 bg-brand-50/70'
            : 'cursor-pointer border-slate-100 hover:bg-slate-50'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      {added ? (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-slate-100 text-slate-400">
          <IconCheck size={11} />
        </span>
      ) : (
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
          checked={checked}
          disabled={disabled}
          onChange={e => onToggle(e.target.checked)}
        />
      )}
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
          folder ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
        }`}
        title={folder ? 'شجرة' : 'منتج'}
      >
        {folder ? <IconFolderClosed size={12} /> : <IconPackage size={11} />}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${added ? 'text-slate-500' : 'text-header'}`} title={row.name}>
        {row.name}
      </span>
      {folder && <Badge tone="warn">شجرة</Badge>}
      {added && <Badge>مضاف</Badge>}
      <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-slate-400" dir="ltr">
        {folder
          ? `#${row.seq}${row.num ? ` · ${row.num}` : ''}${row.productCount != null ? ` · ${formatNum(row.productCount)} صنف` : ''}`
          : [row.barcode || row.num, `#${row.seq}`].filter(Boolean).join(' · ')}
      </span>
      {onOpen && (
        <Btn size="xs" variant="outline" className="shrink-0" onClick={onOpen}>
          فتح
        </Btn>
      )}
    </div>
  );
}
