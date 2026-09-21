import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { TreeNodeDto } from '@/api/types';
import { fixEdariName } from '@/lib/text';
import { Alert, Btn, Input, Loading, Modal } from '@/components/ui';

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
  const [preview, setPreview] = useState<{ name: string; count: number | null } | null>(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParent(undefined);
    setSearch('');
    setDebounced('');
    setPath([]);
    setError('');
    setPreview(null);
  }, [open]);

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
  }

  function goUp() {
    if (path.length === 0) {
      setParent(undefined);
      return;
    }
    const next = path.slice(0, -1);
    setPath(next);
    setParent(next.length ? next[next.length - 1].seq : undefined);
    setPreview(null);
  }

  async function loadPreview(node: TreeNodeDto) {
    if (!isFolderNode(node)) {
      setPreview(null);
      return;
    }
    setPreview({ name: nodeLabel(node), count: null });
    try {
      const countFn = usingEdari ? api.edariTreeProductCount : api.treeProductCount;
      const { count } = await countFn(node.seq);
      setPreview({ name: nodeLabel(node), count });
    } catch {
      setPreview({ name: node.name ?? `#${node.seq}`, count: null });
    }
  }

  async function selectNode(node: TreeNodeDto) {
    if (folderOnly && !isFolderNode(node)) {
      setError('اختر مجلداً (📁) وليس صنفاً مفرداً');
      return;
    }
    setError('');
    setSelecting(true);
    try {
      const countFn = usingEdari ? api.edariTreeProductCount : api.treeProductCount;
      const { count } = await countFn(node.seq);
      onSelect(node, count);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل اختيار الشجرة');
    } finally {
      setSelecting(false);
    }
  }

  return (
    <Modal open={open} title="اختيار شجرة من Edari" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <strong>كيف تختار؟</strong> تصفّح المجلدات بالنقر المزدوج أو «فتح»، ثم اضغط «اختيار هذا المجلد» لتطبيق
          الخصم على جميع الأصناف تحته.
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              usingEdari ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {sourceLabel}
          </span>
          {!loading && (
            <span className="text-xs text-muted">{nodes.length} عنصر في هذا المستوى</span>
          )}
        </div>

        {(error || connectionError) && <Alert>{error || connectionError}</Alert>}

        <div className="flex gap-2">
          <Input
            placeholder="بحث بالاسم أو الرقم أو الباركود…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setDebounced(search.trim())}
          />
          <Btn onClick={() => setDebounced(search.trim())}>بحث</Btn>
          <Btn variant="secondary" onClick={goUp} disabled={!parent && path.length === 0}>
            ↑ رجوع
          </Btn>
        </div>

        <p className="text-xs text-muted">
          {path.length === 0 ? 'الجذر /' : `الجذر / ${path.map(p => p.name).join(' / ')}`}
        </p>

        {loading && (
          <div className="space-y-2">
            <Loading />
            <p className="text-center text-xs text-muted">جاري تحميل الشجرة…</p>
          </div>
        )}

        {!loading && (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {nodes.map(n => {
              const folder = isFolderNode(n);
              return (
                <li
                  key={n.seq}
                  className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                  onMouseEnter={() => folder && loadPreview(n)}
                >
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-2 text-right text-sm"
                    onDoubleClick={() => (folder ? enterFolder(n) : selectNode(n))}
                    onClick={() => folder && loadPreview(n)}
                  >
                    <span className="text-lg">{folder ? '📁' : '📦'}</span>
                    <span>
                      <span className="font-medium">{nodeLabel(n)}</span>
                      {n.num && <span className="mr-2 text-xs text-muted">{n.num}</span>}
                      <span className="mr-2 block text-[10px] text-muted">
                        {folder ? 'مجلد' : 'صنف'} · Seq {n.seq}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    {folder && (
                      <Btn size="sm" variant="secondary" onClick={() => enterFolder(n)}>
                        فتح
                      </Btn>
                    )}
                    {(folder || !folderOnly) && (
                      <Btn size="sm" disabled={selecting} onClick={() => selectNode(n)}>
                        {folder ? 'اختيار المجلد' : 'اختيار'}
                      </Btn>
                    )}
                  </div>
                </li>
              );
            })}
            {nodes.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">
                {edariQ.isError
                  ? 'لا توجد بيانات — تحقق من اتصال Edari في صفحة الإداري'
                  : 'لا عناصر في هذا المستوى'}
              </li>
            )}
          </ul>
        )}

        {preview && (
          <div className="rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm">
            <strong>{preview.name}</strong>
            {preview.count === null ? (
              <span className="mr-2 text-muted"> — جاري حساب الأصناف…</span>
            ) : (
              <span className="mr-2 text-emerald-700"> — {preview.count.toLocaleString('ar-IQ')} صنف نهائي</span>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
