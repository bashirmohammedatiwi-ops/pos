import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type { TargetTreeLinkDto, TreeNodeDto } from '@/api/types';
import { Alert, Badge, Btn, EmptyState, Input, Modal, Skeleton } from '@/components/ui';
import { IconCheck, IconChevronLeft, IconFolder, IconFolderClosed, IconPackage, IconPlus, IconSearch, IconX } from '@/components/icons';

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

  function goTo(depth: number) {
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

  async function previewNode(node: TreeNodeDto) {
    if (!isFolderNode(node)) return;
    if (preview?.seq === node.seq && preview.count != null) return;
    setPreview({ seq: node.seq, name: node.name ?? `#${node.seq}`, count: null });
    try {
      const { count } = await api.edariTreeProductCount(node.seq);
      setPreview(p => (p?.seq === node.seq ? { ...p, count } : p));
    } catch {
      setPreview(p => (p?.seq === node.seq ? { ...p, count: null } : p));
    }
  }

  function addTree(node: TreeNodeDto) {
    if (!isFolderNode(node)) return;
    const seq = node.seq;
    const name = node.name ?? `#${seq}`;
    setLocalSelected(prev => (prev.some(t => t.treeSeq === seq) ? prev : [...prev, { treeSeq: seq, treeName: name }]));
  }

  function removeTree(seq: number) {
    setLocalSelected(prev => prev.filter(t => t.treeSeq !== seq));
  }

  function save() {
    onChange(localSelected);
    onClose();
  }

  const changed =
    localSelected.length !== selected.length || localSelected.some(t => !selected.some(s => s.treeSeq === t.treeSeq));

  return (
    <Modal
      open={open}
      title="اختيار شجرات Edari"
      subtitle="افتح المجلدات للتنقل، ثم «إضافة» لكل شجرة تريدها. يمكنك اختيار أكثر من شجرة."
      icon={<IconFolder size={18} />}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="text-[12px] text-slate-500">
            {preview ? (
              <>
                «<span className="font-semibold text-header">{preview.name}</span>»:{' '}
                {preview.count === null ? 'جاري العد…' : <span className="font-semibold text-emerald-700 num">{formatNum(preview.count)} صنف</span>}
              </>
            ) : (
              <span className="num">{formatNum(localSelected.length)} شجرة مختارة</span>
            )}
          </span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn icon={<IconCheck size={14} />} onClick={save} disabled={localSelected.length === 0 && !changed}>
              تأكيد ({formatNum(localSelected.length)} شجرة)
            </Btn>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        {connectionError && <Alert>{connectionError}</Alert>}

        {/* الشجرات المختارة */}
        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-2.5">
          <p className="mb-1.5 text-[11.5px] font-bold text-slate-500">المختارة</p>
          {localSelected.length === 0 ? (
            <p className="text-[12px] text-slate-400">لم تُختر أي شجرة بعد.</p>
          ) : (
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              {localSelected.map(t => (
                <span
                  key={t.treeSeq}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-white py-0.5 pe-1 ps-2.5 text-[12px] font-medium text-brand-800 ring-1 ring-brand-200"
                >
                  <span className="truncate">{t.treeName ?? `#${t.treeSeq}`}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeTree(t.treeSeq)}
                    aria-label={`إزالة ${t.treeName ?? ''}`}
                  >
                    <IconX size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
            <IconSearch size={15} />
          </span>
          <Input
            autoFocus
            placeholder="بحث في الشجرة…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                // Esc الأول يمسح البحث، والثاني (حقل فارغ) يغلق النافذة — Modal يتجاهل Esc القادم من الحقول
                e.preventDefault();
                if (search) setSearch('');
                else onClose();
              }
            }}
            className="ps-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px]">
          <Badge tone={usingEdari ? 'info' : 'warn'}>{sourceLabel}</Badge>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-brand-700 hover:bg-white disabled:text-slate-400"
            onClick={goUp}
            disabled={!path.length}
          >
            ↑ رجوع
          </button>
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
                className={`max-w-[160px] truncate rounded px-1.5 py-0.5 ${
                  i === path.length - 1 ? 'font-bold text-header' : 'text-brand-700 hover:bg-white'
                }`}
                onClick={() => goTo(i)}
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>

        <div className="max-h-[52vh] min-h-[220px] overflow-y-auto rounded-xl border border-slate-200">
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState compact icon={<IconFolder size={18} />} title={debounced ? 'لا نتائج مطابقة' : 'لا توجد عناصر'} />
          ) : (
            nodes.map(node => {
              const folder = isFolderNode(node);
              const picked = localSelected.some(t => t.treeSeq === node.seq);
              return (
                <div
                  key={node.seq}
                  className={`flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 last:border-0 ${
                    folder ? (picked ? 'bg-brand-50/50' : 'hover:bg-slate-50') : 'opacity-50'
                  }`}
                  onMouseEnter={() => folder && previewNode(node)}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-right"
                    onClick={() => (folder ? enterFolder(node) : undefined)}
                    title={folder ? 'فتح المجلد' : undefined}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                        folder ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {folder ? <IconFolderClosed size={14} /> : <IconPackage size={13} />}
                    </span>
                    <span className="truncate text-[13px] font-medium text-header" title={node.name ?? undefined}>{node.name ?? `#${node.seq}`}</span>
                    <span className="shrink-0 text-[11px] text-slate-400 num">#{node.seq}</span>
                    {picked && <Badge tone="brand">مضافة</Badge>}
                  </button>
                  {folder && (
                    picked ? (
                      <Btn size="xs" variant="ghost" onClick={() => removeTree(node.seq)}>إزالة</Btn>
                    ) : (
                      <Btn size="xs" variant="outline" icon={<IconPlus size={12} />} onClick={() => addTree(node)}>
                        إضافة
                      </Btn>
                    )
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
