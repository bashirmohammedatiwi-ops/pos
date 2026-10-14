import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { Alert, Badge, Btn, EmptyState, Input, Modal, Skeleton } from '@/components/ui';
import { IconChevronLeft, IconFolder, IconFolderClosed, IconPackage, IconSearch, IconX } from '@/components/icons';

interface TreePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (node: TreeNodeDto, productCount: number) => void;
  /** When true, only folders can be selected (for discount-on-tree). */
  folderOnly?: boolean;
}

function isFolderNode(n: TreeNodeDto) {
  return n.isFolder || n.hasChildren;
}

function nodeLabel(n: TreeNodeDto) {
  const name = fixEdariName(n.name);
  if (name) return name;
  if (n.num) return n.num;
  return `#${n.seq}`;
}

export function TreePickerDialog({ open, onClose, onSelect, folderOnly = true }: TreePickerProps) {
  const [parent, setParent] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [path, setPath] = useState<{ seq: number; name: string }[]>([]);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ seq: number; name: string; count: number | null } | null>(null);
  const [selecting, setSelecting] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setParent(undefined);
    setSearch('');
    setDebounced('');
    setPath([]);
    setError('');
    setPreview(null);
  }, [open]);

  // بحث تلقائي بعد التوقف عن الكتابة
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const edariQ = useQuery({
    queryKey: ['edari-tree', parent, debounced],
    queryFn: () => api.edariTree(parent, debounced || undefined),
    enabled: open,
    retry: 1,
  });

  const localQ = useQuery({
    queryKey: ['article-tree', parent, debounced],
    queryFn: () => api.articleTree(parent, debounced || undefined),
    enabled: open && !edariQ.isLoading && (edariQ.isError || (edariQ.isSuccess && (edariQ.data?.length ?? 0) === 0)),
    retry: 1,
  });

  const usingEdari = edariQ.isSuccess && (edariQ.data?.length ?? 0) > 0;
  const nodes = usingEdari ? (edariQ.data ?? []) : (localQ.data ?? []);
  const loading = edariQ.isLoading || (localQ.isFetching && !usingEdari);
  const sourceLabel = usingEdari ? 'Edari NX — شجرة الإداري' : localQ.isSuccess ? 'قاعدة البيانات المحلية' : 'Edari NX';

  const connectionError =
    edariQ.isError && !localQ.data?.length
      ? edariQ.error instanceof Error
        ? edariQ.error.message
        : 'تعذّر الاتصال بشجرة Edari — تحقق من إعدادات الإداري'
      : '';

  function enterFolder(node: TreeNodeDto) {
    if (!isFolderNode(node)) return;
    setPath(p => [...p, { seq: node.seq, name: nodeLabel(node) }]);
    setParent(node.seq);
    setSearch('');
    setDebounced('');
    setPreview(null);
    setError('');
  }

  function goTo(depth: number) {
    // depth = -1 → الجذر
    const next = depth < 0 ? [] : path.slice(0, depth + 1);
    setPath(next);
    setParent(next.length ? next[next.length - 1].seq : undefined);
    setSearch('');
    setDebounced('');
    setPreview(null);
  }

  function goUp() {
    if (path.length === 0) {
      setParent(undefined);
      return;
    }
    goTo(path.length - 2);
  }

  async function loadPreview(node: TreeNodeDto) {
    if (!isFolderNode(node)) {
      setPreview(null);
      return;
    }
    if (preview?.seq === node.seq && preview.count != null) return;
    setPreview({ seq: node.seq, name: nodeLabel(node), count: null });
    try {
      const countFn = usingEdari ? api.edariTreeProductCount : api.treeProductCount;
      const { count } = await countFn(node.seq);
      setPreview(p => (p?.seq === node.seq ? { ...p, count } : p));
    } catch {
      setPreview(p => (p?.seq === node.seq ? { ...p, count: null } : p));
    }
  }

  async function selectNode(node: TreeNodeDto) {
    if (folderOnly && !isFolderNode(node)) {
      setError('اختر مجلداً وليس صنفاً مفرداً');
      return;
    }
    setError('');
    setSelecting(node.seq);
    try {
      const countFn = usingEdari ? api.edariTreeProductCount : api.treeProductCount;
      const { count } = await countFn(node.seq);
      onSelect(node, count);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل اختيار الشجرة');
    } finally {
      setSelecting(null);
    }
  }

  return (
    <Modal
      open={open}
      title="اختيار شجرة من Edari"
      subtitle="افتح المجلدات بالنقر المزدوج أو «فتح»، ثم «اختيار» لتطبيق الخصم على كل الأصناف تحته."
      icon={<IconFolder size={18} />}
      onClose={onClose}
      wide
      footer={
        <>
          <div className="min-w-0 text-[12px] text-slate-600">
            {preview ? (
              <span className="flex items-center gap-1.5">
                <IconFolderClosed size={13} className="text-amber-500" />
                <span className="max-w-[260px] truncate font-semibold text-header">{preview.name}</span>
                {preview.count === null ? (
                  <span className="text-slate-400">— جاري حساب الأصناف…</span>
                ) : (
                  <span className="font-semibold text-emerald-700 num">— {formatNum(preview.count)} صنف نهائي</span>
                )}
              </span>
            ) : (
              <span className="text-slate-400">مرّر المؤشر على مجلد لمعرفة عدد أصنافه</span>
            )}
          </div>
          <Btn variant="secondary" onClick={onClose}>إغلاق</Btn>
        </>
      }
    >
      <div className="space-y-3">
        {(error || connectionError) && <Alert>{error || connectionError}</Alert>}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
              <IconSearch size={15} />
            </span>
            <Input
              autoFocus
              placeholder="بحث بالاسم أو الرقم أو الباركود…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') setDebounced(search.trim());
                if (e.key === 'Escape') {
                  // Esc الأول يمسح البحث، والثاني (حقل فارغ) يغلق النافذة — Modal يتجاهل Esc القادم من الحقول
                  e.preventDefault();
                  if (search) setSearch('');
                  else onClose();
                }
              }}
              className="ps-9 pe-8"
            />
            {search && (
              <button
                type="button"
                aria-label="مسح البحث"
                className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700"
                onClick={() => setSearch('')}
              >
                <IconX size={13} />
              </button>
            )}
          </div>
          <Btn variant="secondary" onClick={goUp} disabled={!parent && path.length === 0}>
            ↑ رجوع
          </Btn>
        </div>

        {/* مسار التصفح — كل جزء قابل للنقر */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px]">
          <Badge tone={usingEdari ? 'info' : 'warn'}>{sourceLabel}</Badge>
          <button
            type="button"
            className={`rounded px-1.5 py-0.5 ${path.length ? 'text-brand-700 hover:bg-white' : 'font-bold text-header'}`}
            onClick={() => goTo(-1)}
          >
            الجذر
          </button>
          {path.map((p, i) => (
            <span key={p.seq} className="flex items-center gap-1">
              <IconChevronLeft size={12} className="text-slate-300" />
              <button
                type="button"
                className={`max-w-[180px] truncate rounded px-1.5 py-0.5 ${
                  i === path.length - 1 ? 'font-bold text-header' : 'text-brand-700 hover:bg-white'
                }`}
                onClick={() => goTo(i)}
              >
                {p.name}
              </button>
            </span>
          ))}
          {!loading && <span className="ms-auto text-[11px] text-slate-500 num">{formatNum(nodes.length)} عنصر</span>}
        </div>

        <ul className="max-h-[60vh] min-h-[240px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-2.5 px-3 py-2">
                <Skeleton className="h-6 w-6 rounded-md" />
                <Skeleton className="h-3 flex-1" />
              </li>
            ))
          ) : nodes.length === 0 ? (
            <li>
              <EmptyState
                compact
                icon={<IconFolder size={18} />}
                title={debounced ? 'لا نتائج مطابقة' : 'لا عناصر في هذا المستوى'}
                description={edariQ.isError ? 'لا توجد بيانات — تحقق من اتصال Edari في صفحة الإداري.' : undefined}
              />
            </li>
          ) : (
            nodes.map(n => {
              const folder = isFolderNode(n);
              const active = preview?.seq === n.seq;
              return (
                <li
                  key={n.seq}
                  className={`flex items-center justify-between gap-2 px-3 py-1.5 transition ${active ? 'bg-brand-50/50' : 'hover:bg-slate-50'}`}
                  onMouseEnter={() => folder && loadPreview(n)}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-right"
                    onDoubleClick={() => (folder ? enterFolder(n) : selectNode(n))}
                    onClick={() => folder && loadPreview(n)}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                        folder ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {folder ? <IconFolderClosed size={14} /> : <IconPackage size={13} />}
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold text-header" title={nodeLabel(n)}>{nodeLabel(n)}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {folder ? 'مجلد' : 'صنف'}
                        {n.num && <span className="font-mono"> · {n.num}</span>}
                        <span className="num"> · Seq {n.seq}</span>
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    {folder && (
                      <Btn size="xs" variant="ghost" onClick={() => enterFolder(n)}>
                        فتح
                      </Btn>
                    )}
                    {(folder || !folderOnly) && (
                      <Btn size="xs" loading={selecting === n.seq} disabled={selecting != null} onClick={() => selectNode(n)}>
                        {folder ? 'اختيار المجلد' : 'اختيار'}
                      </Btn>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </Modal>
  );
}
