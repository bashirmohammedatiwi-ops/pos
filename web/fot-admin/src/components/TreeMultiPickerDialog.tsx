import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { TargetTreeLinkDto, TreeNodeDto } from '@/api/types';
import { Alert, Btn, Input, Loading, Modal } from '@/components/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  selected: TargetTreeLinkDto[];
  onChange: (trees: TargetTreeLinkDto[]) => void;
}

function isFolderNode(n: TreeNodeDto) {
  return n.isFolder || n.hasChildren;
}

export function TreeMultiPickerDialog({ open, onClose, selected, onChange }: Props) {
  const [parent, setParent] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [path, setPath] = useState<{ seq: number; name: string }[]>([]);
  const [localSelected, setLocalSelected] = useState<TargetTreeLinkDto[]>([]);
  const [preview, setPreview] = useState<{ seq: number; name: string; count: number | null } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParent(undefined);
    setSearch('');
    setDebounced('');
    setPath([]);
    setLocalSelected([...selected]);
    setPreview(null);
  }, [open, selected]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
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
  const sourceLabel = usingEdari ? 'Edari NX' : 'قاعدة محلية';

  const connectionError =
    edariQ.isError && !localQ.data?.length
      ? edariQ.error instanceof Error
        ? edariQ.error.message
        : 'تعذّر الاتصال بشجرة Edari'
      : '';

  function enterFolder(node: TreeNodeDto) {
    if (!isFolderNode(node)) return;
    setPath(p => [...p, { seq: node.seq, name: node.name ?? `#${node.seq}` }]);
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

  async function previewNode(node: TreeNodeDto) {
    if (!isFolderNode(node)) return;
    setPreview({ seq: node.seq, name: node.name ?? `#${node.seq}`, count: null });
    try {
      const { count } = await api.edariTreeProductCount(node.seq);
      setPreview(p => (p?.seq === node.seq ? { ...p, count } : p));
    } catch {
      setPreview(p => (p?.seq === node.seq ? { ...p, count: null } : p));
    }
  }

  async function addTree(node: TreeNodeDto) {
    if (!isFolderNode(node)) return;
    const seq = node.seq;
    const name = node.name ?? `#${seq}`;
    if (localSelected.some(t => t.treeSeq === seq)) return;
    setAdding(true);
    try {
      setLocalSelected(prev => [...prev, { treeSeq: seq, treeName: name }]);
    } finally {
      setAdding(false);
    }
  }

  function removeTree(seq: number) {
    setLocalSelected(prev => prev.filter(t => t.treeSeq !== seq));
  }

  function save() {
    onChange(localSelected);
    onClose();
  }

  return (
    <Modal open={open} title="اختيار شجرات Edari" onClose={onClose} wide>
      <div className="space-y-4">
        {connectionError && <Alert>{connectionError}</Alert>}

        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-muted">
          <span className="font-medium text-slate-700">{sourceLabel}</span>
          <span>·</span>
          <button type="button" className="text-brand-600 hover:underline" onClick={goUp}>
            ↑ رجوع
          </button>
          {path.map(p => (
            <span key={p.seq} className="text-slate-500">
              / {p.name}
            </span>
          ))}
        </div>

        <Input
          placeholder="بحث في الشجرة..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {localSelected.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
            {localSelected.map(t => (
              <span
                key={t.treeSeq}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-brand-200"
              >
                {t.treeName ?? `#${t.treeSeq}`}
                <button
                  type="button"
                  className="text-red-500 hover:text-red-700"
                  onClick={() => removeTree(t.treeSeq)}
                  aria-label="إزالة"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
          {loading && <Loading />}
          {!loading && nodes.length === 0 && (
            <p className="p-4 text-center text-sm text-muted">لا توجد عناصر</p>
          )}
          {nodes.map(node => {
            const folder = isFolderNode(node);
            const picked = localSelected.some(t => t.treeSeq === node.seq);
            return (
              <div
                key={node.seq}
                className={`flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 last:border-0 ${
                  folder ? 'hover:bg-slate-50' : 'opacity-50'
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-right text-sm"
                  onClick={() => (folder ? enterFolder(node) : undefined)}
                  onMouseEnter={() => folder && previewNode(node)}
                >
                  <span>{folder ? '📁' : '📦'}</span>
                  <span className="truncate font-medium">{node.name ?? `#${node.seq}`}</span>
                  {picked && <span className="text-xs text-brand-600">✓ مضافة</span>}
                </button>
                {folder && (
                  <Btn size="sm" variant="secondary" disabled={picked || adding} onClick={() => addTree(node)}>
                    {picked ? 'مضافة' : '+ إضافة'}
                  </Btn>
                )}
              </div>
            );
          })}
        </div>

        {preview && (
          <p className="text-xs text-muted">
            معاينة «{preview.name}»:{' '}
            {preview.count === null ? 'جاري العد...' : `${preview.count.toLocaleString('en-US')} صنف`}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            إلغاء
          </Btn>
          <Btn onClick={save} disabled={localSelected.length === 0}>
            تأكيد ({localSelected.length} شجرة)
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
