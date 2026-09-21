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
import { Btn, Field, Input, Loading } from '@/components/ui';
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
      <div className={`shrink-0 rounded-lg border border-slate-200 bg-white ${fill ? 'p-2.5' : 'p-3'}`}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="بحث المنتج / الباركود">
            <div className="relative">
              <Input
                autoFocus
                data-keep-escape
                value={productTerm}
                onChange={e => setProductTerm(e.target.value)}
                onKeyDown={onProductKey}
                placeholder="امسح الباركود أو اكتب الاسم — لن يُضاف تلقائياً"
                className="h-10 pe-14"
              />
              {productTerm && (
                <button
                  type="button"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-0.5 text-[11px] text-slate-500 hover:bg-white"
                  onClick={() => setProductTerm('')}
                >
                  مسح
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
        {barcodeSearch && barcodeQ.isFetching && (
          <p className="mt-2 text-[12px] text-slate-500">جاري البحث بالباركود…</p>
        )}
        {barcodeSearch && barcodeQ.isError && (
          <p className="mt-2 text-[12px] text-red-600">لا منتج بهذا الباركود</p>
        )}
        {barcodeHit && (
          <p className="mt-2 text-[12px] text-teal-700">
            وُجد «{barcodeHit.name || barcodeHit.barcode}» يساراً — أشّره ثم أضفه. لن يُحفظ إلا من زر الحفظ.
          </p>
        )}
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          {hint ?? 'التأشير لا يحفظ. يسار: أشّر ثم زر أيمن → إضافة. يمين: أشّر بالأحمر ثم زر أيمن → إزالة. احفظ من أسفل النافذة.'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {toolbar}
          {availableLeft.length > 0 && (
            <Btn size="sm" variant="secondary" disabled={busy} onClick={markVisibleLeft}>
              تأشير المعروض ({formatNum(availableLeft.length)})
            </Btn>
          )}
          <Btn size="sm" disabled={busy || !addReady} onClick={stageAdd}>
            {addActionLabel}{addReady ? ` (${formatNum(addReadyCount)})` : ''}
          </Btn>
          <Btn size="sm" variant="danger" disabled={busy || !removeReady} onClick={stageRemove}>
            {removeActionLabel}{removeReady ? ` (${formatNum(removeReadyCount)})` : ''}
          </Btn>
        </div>
      </div>

      <div dir="ltr" className={`grid gap-3 lg:grid-cols-2 ${fill ? 'min-h-0 flex-1' : heightClass}`}>
        <section dir="rtl" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between gap-2 border-b border-slate-800/10 bg-slate-800 px-3 py-2.5 text-white">
            <div>
              <h3 className="text-[13px] font-semibold">{leftTitle}</h3>
              <p className="text-[10px] text-white/70">تأشير ثم زر أيمن للإضافة</p>
            </div>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
              {formatNum(rows.length)}
              {markedLeftCount > 0 && <span className="ms-1 text-teal-200">· {formatNum(markedLeftCount)} محدد</span>}
            </span>
          </header>

          {activeTree && (
            <div className="space-y-2 border-b border-teal-100 bg-teal-50/80 px-3 py-2 text-[12px] text-teal-950">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {treeTrail.length > 0 && (
                    <button type="button" className="me-2 font-medium text-teal-800 hover:underline" onClick={goBackTree}>
                      رجوع
                    </button>
                  )}
                  شجرة {treeLabel(activeTree)}
                  {treeCountQ.data?.count != null && <> · {formatNum(treeCountQ.data.count)} صنف</>}
                  {leavesQ.data?.truncated && ` · أول ${formatNum(treeLeaves.length)}`}
                </span>
                <button type="button" className="shrink-0 text-[11px] font-medium text-teal-800 hover:underline" onClick={() => selectTree(null)}>
                  كل المنتجات
                </button>
              </div>
              <Input
                data-keep-escape
                value={leftFilter}
                onChange={e => setLeftFilter(e.target.value)}
                placeholder="تصفية منتجات هذه الشجرة…"
                className="h-8 bg-white"
              />
              {leavesQ.isFetching && (
                <p className="text-[11px] text-teal-800">جاري تحميل كل منتجات الشجرة…</p>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" onContextMenu={e => openMenu(e, 'left')}>
            {catalogLoading && rows.length === 0 && <Loading />}
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
              <p className="px-4 py-10 text-center text-sm text-muted">
                {activeTree ? 'لا أصناف في هذه الشجرة — جرّب شجرة أدنى أو تأكد من المزامنة' : 'امسح باركوداً أو ابحث عن منتج أو اختر شجرة مواد'}
              </p>
            )}
          </div>

          {!activeTree && (
            <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-500">
              <span>صفحة {formatNum(page)} / {formatNum(totalPages)}</span>
              <div className="flex gap-1">
                <Btn size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  السابق
                </Btn>
                <Btn size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  التالي
                </Btn>
              </div>
            </footer>
          )}
        </section>

        <section dir="rtl" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-teal-200 bg-white shadow-sm">
          <header className="flex items-center justify-between gap-2 border-b border-teal-700/20 bg-teal-700 px-3 py-2.5 text-white">
            <div>
              <h3 className="text-[13px] font-semibold">{rightTitle}</h3>
              <p className="text-[10px] text-white/75">تأشير أحمر ثم زر أيمن للإزالة</p>
            </div>
            <div className="flex items-center gap-2 [&_button]:!border-white/25 [&_button]:!bg-white/15 [&_button]:!text-white hover:[&_button]:!bg-white/25">
              {rightActions}
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
                {formatNum(rightLines.length)}
                {pendingAdd.size > 0 && <span className="ms-1 text-emerald-200">+{formatNum(pendingAdd.size)}</span>}
                {pendingRemove.size > 0 && <span className="ms-1 text-rose-200">−{formatNum(pendingRemove.size)}</span>}
              </span>
            </div>
          </header>
          <div className="border-b border-slate-100 px-3 py-2">
            <Input
              value={rightFilter}
              onChange={e => setRightFilter(e.target.value)}
              placeholder="بحث في المحتوى…"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" onContextMenu={e => openMenu(e, 'right')}>
            {visibleRight.map(item => {
              const marked = rightMarks.has(item.key);
              const dropping = pendingRemove.has(item.key);
              return (
                <div
                  key={item.key}
                  onContextMenu={e => openMenu(e, 'right', undefined, item.key)}
                  className={`flex items-start gap-2.5 border-b px-3 py-2.5 ${
                    dropping
                      ? 'border-rose-100 bg-rose-50/90'
                      : marked
                        ? 'border-rose-50 bg-rose-50/70'
                        : item.kind === 'pending'
                          ? 'border-emerald-50 bg-emerald-50/70'
                          : 'border-slate-50 hover:bg-slate-50/80'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-rose-300 text-rose-600 accent-rose-600 focus:ring-rose-500"
                    checked={marked || dropping}
                    disabled={busy}
                    onChange={e => toggleRight(item.key, e.target.checked)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.badge && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          item.kind === 'pending'
                            ? 'bg-emerald-600 text-white'
                            : dropping
                              ? 'bg-rose-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                        }`}>
                          {dropping ? 'سيُحذف' : item.badge}
                        </span>
                      )}
                      <span className={`truncate text-[13px] font-medium ${dropping ? 'text-rose-800 line-through' : 'text-slate-900'}`}>
                        {item.title}
                      </span>
                    </div>
                    {item.subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{item.subtitle}</p>}
                    {!dropping && item.extra}
                  </div>
                </div>
              );
            })}
            {rightLines.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted">{rightEmpty}</p>
            )}
            {rightLines.length > 0 && visibleRight.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted">لا نتائج للتصفية</p>
            )}
          </div>
        </section>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]">
        <div className="flex flex-wrap items-center gap-2 text-slate-600">
          <span className={`rounded-full px-2 py-0.5 ${markedLeftCount ? 'bg-teal-100 text-teal-800' : 'bg-white text-slate-400'}`}>
            {formatNum(markedLeftCount)} مؤشّر للإضافة
          </span>
          <span className={`rounded-full px-2 py-0.5 ${pendingAdd.size ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400'}`}>
            {formatNum(pendingAdd.size)} سيُضاف
          </span>
          <span className={`rounded-full px-2 py-0.5 ${rightMarks.size || pendingRemove.size ? 'bg-rose-100 text-rose-800' : 'bg-white text-slate-400'}`}>
            {formatNum(pendingRemove.size || rightMarks.size)} سيُحذف
          </span>
          <span className="text-slate-400">{saveHint ?? 'التأشير لا يحفظ — اضغط حفظ بعد إضافة أو إزالة الأصناف.'}</span>
        </div>
        {hasWork && (
          <Btn size="sm" variant="secondary" onClick={clearStaging}>إلغاء التحديد</Btn>
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
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-right text-[13px] font-medium text-teal-800 hover:bg-teal-50 disabled:text-slate-300"
                onClick={stageAdd}
              >
                <span>{addActionLabel}</span>
                {addReady && <span className="text-[11px] text-teal-600">{formatNum(addReadyCount)}</span>}
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
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-right text-[13px] font-medium text-rose-700 hover:bg-rose-50 disabled:text-slate-300"
                onClick={stageRemove}
              >
                <span>{removeActionLabel}</span>
                {removeReady && <span className="text-[11px] text-rose-500">{formatNum(removeReadyCount)}</span>}
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
        className="h-10 pe-14"
      />
      {value && (
        <button
          type="button"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-0.5 text-[11px] text-slate-500 hover:bg-white"
          onClick={() => {
            onChange(null);
            setQuery('');
            setOpen(false);
          }}
        >
          مسح
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
                <span className="min-w-0 truncate font-medium text-slate-800">{treeLabel(n)}</span>
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
  return (
    <div
      onContextMenu={onContextMenu}
      className={`flex items-start gap-2.5 border-b px-3 py-2.5 text-right ${
        added
          ? 'border-slate-50 bg-slate-50/80'
          : checked
            ? 'border-teal-100 bg-teal-50'
            : 'border-slate-50 hover:bg-slate-50'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      {added ? (
        <span className="mt-1 inline-flex h-[15px] w-[15px] items-center justify-center rounded border border-slate-300 bg-slate-100 text-[9px] text-slate-400">✓</span>
      ) : (
        <input
          type="checkbox"
          className="mt-1 rounded border-slate-300 text-teal-600 accent-teal-600"
          checked={checked}
          disabled={disabled}
          onChange={e => onToggle(e.target.checked)}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              row.kind === 'folder' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {row.kind === 'folder' ? 'شجرة' : 'منتج'}
          </span>
          {added && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">مضاف</span>
          )}
          <span className="truncate text-[13px] font-medium text-slate-900">{row.name}</span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
          {row.kind === 'folder'
            ? `#${row.seq}${row.num ? ` · ${row.num}` : ''}${row.productCount != null ? ` · ${formatNum(row.productCount)} صنف` : ''}`
            : [row.barcode || row.num, `#${row.seq}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      {onOpen && (
        <button
          type="button"
          className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50"
          onClick={onOpen}
        >
          فتح
        </button>
      )}
    </div>
  );
}
