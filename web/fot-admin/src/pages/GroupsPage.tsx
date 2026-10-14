import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { ArticleGroupDto, ArticleGroupItemDto } from '@/api/types';
import { copyText } from '@/lib/clipboard';
import { useToast } from '@/components/Toast';
import { DataGrid, type GridColumn, type GridSort } from '@/components/grid/DataGrid';
import { Alert, Badge, Btn, EmptyState, Field, IconButton, Input, Modal, Select, Skeleton, TableSkeleton, useConfirm } from '@/components/ui';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
  type SummaryCell,
} from '@/components/listWorkspace';
import { IconGrid, IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash, IconX } from '@/components/icons';
import { ScopePickerModal, type ScopePickerOps } from '@/components/scope/ScopePickerModal';

const GROUP_KEY = 'fot_admin_group';
const GROUP_COLORS = ['#0f9f76', '#0ea5e9', '#7c3aed', '#d97706', '#e11d48', '#db2777', '#475569', '#0f172a'];
const WHITE_WIN = 16777215;

/** خيارات «الترتيب» = فرز أعمدة الجدول نفسه — رأس الجدول والقائمة متزامنان. */
const SORT_PRESETS = ['seq:asc', 'name:asc', 'price:asc'];
const sortToken = (s: GridSort | null) => (s ? `${s.key}:${s.dir}` : '');

function ssGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function ssSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* تجاهل */
  }
}

function hexToWin(hex: string) {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return r + (g << 8) + (b << 16);
}

function winToHex(color: number) {
  const r = color & 255;
  const g = (color >> 8) & 255;
  const b = (color >> 16) & 255;
  if (!color || (r > 240 && g > 240 && b > 240)) return GROUP_COLORS[0]!;
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

function winCss(color: number, fallback: string) {
  if (!color) return fallback;
  const r = color & 0xff;
  const g = (color >> 8) & 0xff;
  const b = (color >> 16) & 0xff;
  if (r > 240 && g > 240 && b > 240) return fallback;
  return `rgb(${r},${g},${b})`;
}

function groupItemColumns(
  toast: ReturnType<typeof useToast>,
  onRemove: (item: ArticleGroupItemDto) => void,
): GridColumn<ArticleGroupItemDto>[] {
  return [
    { key: 'seq', header: '#', width: 60, align: 'center', mono: true },
    {
      key: 'name',
      header: 'الاسم',
      width: 300,
      render: i => (
        <span className="font-semibold text-header">
          {i.name ? (
            <Link
              to={`/products?search=${encodeURIComponent(i.barcode || i.name)}`}
              onClick={e => e.stopPropagation()}
              className="hover:text-brand-700 hover:underline"
            >
              {i.name}
            </Link>
          ) : '—'}
        </span>
      ),
    },
    {
      key: 'barcode',
      header: 'الباركود',
      width: 150,
      mono: true,
      render: i =>
        i.barcode ? (
          <button
            type="button"
            dir="ltr"
            className="font-mono text-[12px] text-slate-600 hover:text-brand-700 hover:underline"
            title="نسخ الباركود"
            onClick={e => {
              e.stopPropagation();
              copyText(i.barcode!)
                .then(() => toast.success('تم نسخ الباركود'))
                .catch(() => toast.error('تعذر النسخ'));
            }}
          >
            {i.barcode}
          </button>
        ) : <span className="text-slate-300">—</span>,
    },
    {
      key: 'price',
      header: 'السعر',
      width: 120,
      mono: true,
      footer: 'avg',
      render: i => <span className="font-bold text-header">{formatNum(i.price)}</span>,
    },
    {
      key: 'originalPrice',
      header: 'قبل الخصم',
      width: 130,
      mono: true,
      render: i =>
        i.originalPrice > 0 && i.originalPrice !== i.price ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-400 line-through">{formatNum(i.originalPrice)}</span>
            {i.price < i.originalPrice && (
              <Badge tone="ok" className="num">-{Math.round((1 - i.price / i.originalPrice) * 100)}%</Badge>
            )}
          </span>
        ) : <span className="text-slate-300">—</span>,
    },
    {
      key: 'remove',
      header: '',
      width: 52,
      align: 'center',
      sortable: false,
      exportable: false,
      render: i => (
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="إزالة من أزرار نقطة البيع"
          aria-label="إزالة من أزرار نقطة البيع"
          onClick={e => {
            e.stopPropagation();
            onRemove(i);
          }}
        >
          <IconTrash size={14} />
        </button>
      ),
    },
  ];
}

export function GroupsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const n = Number(ssGet(GROUP_KEY) || 0);
    return n || null;
  });
  const [query, setQuery] = useState(() => ssGet('fot_admin_groups_q') ?? '');
  const [itemQuery, setItemQuery] = useState(() => ssGet('fot_admin_groups_iq') ?? '');
  const [sort, setSort] = useState<GridSort | null>({ key: 'seq', dir: 'asc' });
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const itemSearchRef = useRef<HTMLInputElement>(null);

  const groupsQ = useQuery({ queryKey: ['groups'], queryFn: api.groups });
  const itemsQ = useQuery({
    queryKey: ['group-items', selectedId],
    queryFn: () => api.groupItems(selectedId!),
    enabled: selectedId != null,
  });

  const groups = useMemo(() => {
    const list = groupsQ.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(g => (g.name || '').toLowerCase().includes(q) || String(g.id).includes(q));
  }, [groupsQ.data, query]);

  useEffect(() => {
    ssSet('fot_admin_groups_q', query);
    ssSet('fot_admin_groups_iq', itemQuery);
  }, [query, itemQuery]);

  useEffect(() => {
    if (selectedId != null) {
      // مجموعة محذوفة أو غير موجودة — اختر الأولى
      if (groupsQ.data && !groupsQ.data.some(g => g.id === selectedId)) {
        setSelectedId(groupsQ.data[0]?.id ?? null);
        return;
      }
      ssSet(GROUP_KEY, String(selectedId));
      return;
    }
    if (groups.length) setSelectedId(groups[0].id);
  }, [groups, selectedId, groupsQ.data]);

  const items = useMemo(() => {
    const list = [...(itemsQ.data ?? [])];
    const q = itemQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter(i => (i.name || '').toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q))
      : list;
    // ترتيب المجموعة كأساس ثابت — الجدول يطبّق «الترتيب» المختار (sort) فوقه
    filtered.sort((a, b) => (a.seq - b.seq) || (a.id - b.id));
    return filtered;
  }, [itemQuery, itemsQ.data]);

  const selected = groups.find(g => g.id === selectedId) ?? groupsQ.data?.find(g => g.id === selectedId);
  const totalGroups = groupsQ.data?.length ?? 0;
  const totalItems = (groupsQ.data ?? []).reduce((n, g) => n + (g.itemCount || 0), 0);
  const discounted = (itemsQ.data ?? []).filter(i => i.originalPrice > 0 && i.price < i.originalPrice).length;

  async function refreshGroups(nextId?: number) {
    await qc.invalidateQueries({ queryKey: ['groups'] });
    if (nextId != null) {
      setSelectedId(nextId);
      await qc.invalidateQueries({ queryKey: ['group-items', nextId] });
      return;
    }
    if (selectedId != null) await qc.invalidateQueries({ queryKey: ['group-items', selectedId] });
  }

  const removeItem = useMutation({
    mutationFn: (item: ArticleGroupItemDto) => api.deleteGroupItem(selectedId!, item.id),
    onSuccess: async () => {
      toast.success('أُزيل من أزرار نقطة البيع');
      await refreshGroups();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  const deleteGroup = useMutation({
    mutationFn: () => api.deleteGroup(selectedId!),
    onSuccess: async () => {
      toast.success('حُذفت المجموعة');
      setSelectedId(null);
      await qc.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر حذف المجموعة'),
  });

  async function askRemoveItem(item: ArticleGroupItemDto) {
    const ok = await confirm({
      title: 'إزالة الصنف من المجموعة؟',
      message: `سيختفي زر «${item.name || item.barcode}» من نافذة المنتجات في نقطة البيع. الصنف نفسه لا يُحذف.`,
      confirmLabel: 'إزالة',
      danger: true,
    });
    if (ok) removeItem.mutate(item);
  }

  async function askDeleteGroup() {
    if (!selected) return;
    const ok = await confirm({
      title: `حذف مجموعة «${selected.name || `#${selected.id}`}»؟`,
      message: `ستُحذف المجموعة و${formatNum(selected.itemCount)} زر من نقطة البيع. لا يمكن التراجع.`,
      confirmLabel: 'حذف المجموعة',
      danger: true,
    });
    if (ok) deleteGroup.mutate();
  }

  const pickerScope = useMemo(() => {
    const seqRowIds = new Map<number, number>();
    for (const i of itemsQ.data ?? []) {
      if (i.seq > 0 && !seqRowIds.has(i.seq)) seqRowIds.set(i.seq, i.id);
    }
    return { treeSeqs: new Set<number>(), seqRowIds };
  }, [itemsQ.data]);

  const standalone = useMemo(() =>
    (itemsQ.data ?? []).map(i => ({
      id: i.id,
      seq: i.seq,
      name: i.name || i.barcode || `#${i.seq}`,
      barcode: i.barcode,
      price: i.price,
    })), [itemsQ.data]);

  async function commitPicker(ops: ScopePickerOps) {
    if (selectedId == null) return;
    for (const rowId of ops.removeRowIds) await api.deleteGroupItem(selectedId, rowId);
    let added = 0;
    let skipped = 0;
    if (ops.addTrees.length) {
      const r = await api.addGroupTrees(selectedId, ops.addTrees.map(t => t.seq));
      added += r.added;
      skipped += r.skipped;
    }
    if (ops.addProducts.length) {
      const r = await api.addGroupProducts(selectedId, ops.addProducts.map(p => p.seq));
      added += r.added;
      skipped += r.skipped;
    }
    if (added > 0) toast.success(`أُضيف ${formatNum(added)} صنفاً إلى أزرار نقطة البيع`);
    else if (ops.removeRowIds.length) toast.success('حُفظت التغييرات');
    else if (skipped > 0) toast.info('لم يُضف شيء — الأصناف موجودة مسبقاً أو بدون سعر بيع');
    else toast.info('لا تغييرات للحفظ');
    await refreshGroups();
  }

  const noGroupsAtAll = !groupsQ.isLoading && !groupsQ.isError && totalGroups === 0;
  const itemCount = itemsQ.data?.length ?? selected?.itemCount ?? 0;
  const avgPrice = itemsQ.data?.length
    ? itemsQ.data.reduce((n, i) => n + i.price, 0) / itemsQ.data.length
    : 0;

  const stripCells: SummaryCell[] = [
    { label: 'أصناف المجموعة', value: formatNum(itemCount), hint: itemQuery.trim() ? `المطابق ${formatNum(items.length)}` : 'أزرار للكاشير', tone: 'brand' },
    { label: 'بخصم', value: formatNum(discounted), tone: discounted > 0 ? 'ok' : undefined, hint: 'السعر أقل من الأصلي' },
    { label: 'متوسط السعر', value: itemsQ.data?.length ? formatNum(Math.round(avgPrice)) : '—' },
    { label: 'كل المجموعات', value: formatNum(totalGroups), hint: `${formatNum(totalItems)} زر إجمالاً` },
  ];

  return (
    <WorkspacePage>
      {groupsQ.isError && (
        <Alert title="تعذر تحميل المجموعات">
          <p>{groupsQ.error instanceof Error ? groupsQ.error.message : 'خطأ غير معروف'}</p>
          <Btn size="xs" variant="secondary" className="mt-2" onClick={() => groupsQ.refetch()}>إعادة المحاولة</Btn>
        </Alert>
      )}

      {noGroupsAtAll ? (
        <div className="card flex flex-1 items-center justify-center">
          <EmptyState
            icon={<IconGrid size={24} />}
            title="لا مجموعات أزرار بعد"
            description="المجموعة تظهر كتبويب في نافذة المنتجات بنقطة البيع، وأصنافها كأزرار سريعة للكاشير. أنشئ مجموعة ثم أضف منتجات."
            action={<Btn icon={<IconPlus size={14} />} onClick={() => setEditor('create')}>مجموعة جديدة</Btn>}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[250px_minmax(0,1fr)]">
          {/* قائمة المجموعات — مدمجة */}
          <aside className="card flex max-h-[34vh] min-h-0 shrink-0 flex-col overflow-hidden lg:max-h-none">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-200 bg-slate-50/70 p-2">
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
                  <IconSearch size={14} />
                </span>
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }}
                  placeholder="بحث في المجموعات…"
                  className="!h-8 !ps-8 text-[12.5px]"
                  aria-label="بحث المجموعات"
                />
              </div>
              <IconButton label="مجموعة جديدة" onClick={() => setEditor('create')} className="!h-8 !w-8 !border-brand-200 !bg-brand-50 !text-brand-700">
                <IconPlus size={15} />
              </IconButton>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto py-0.5" aria-label="مجموعات الأزرار">
              {groupsQ.isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                    <Skeleton className="h-3.5 w-3.5 rounded" />
                    <Skeleton className="h-3 flex-1" />
                  </li>
                ))
                : groups.map(g => {
                  const active = selectedId === g.id;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(g.id)}
                        aria-current={active || undefined}
                        title={g.name || `#${g.id}`}
                        className={`flex w-full items-center gap-2 border-s-2 px-2.5 py-1.5 text-right text-[12.5px] transition ${
                          active
                            ? 'border-brand-500 bg-brand-50 font-bold text-header'
                            : 'border-transparent font-medium text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]"
                          style={{ background: winCss(g.backColour, '#e2e8f0') }}
                        />
                        <span className="min-w-0 flex-1 truncate">{g.name || `#${g.id}`}</span>
                        {g.itemCount === 0 ? (
                          <span className="shrink-0 rounded bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700">فارغة</span>
                        ) : (
                          <span className={`shrink-0 text-[11px] num ${active ? 'text-brand-700' : 'text-slate-400'}`}>{formatNum(g.itemCount)}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              {!groupsQ.isLoading && !groups.length && query && (
                <li>
                  <EmptyState
                    compact
                    icon={<IconSearch size={16} />}
                    title="لا مجموعات مطابقة"
                    action={<Btn size="xs" variant="secondary" onClick={() => setQuery('')}>مسح البحث</Btn>}
                  />
                </li>
              )}
            </ul>
            <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-[11px] text-slate-500 num">
              {formatNum(totalGroups)} مجموعة · {formatNum(totalItems)} صنف
            </div>
          </aside>

          {/* أصناف المجموعة المحددة */}
          <WorkspaceCard className="min-h-[420px] min-w-0 lg:min-h-0">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<IconGrid size={24} />}
                  title={groupsQ.isLoading ? 'جاري التحميل…' : 'اختر مجموعة'}
                  description="اختر مجموعة من القائمة لعرض أزرارها، أو أنشئ مجموعة جديدة."
                />
              </div>
            ) : (
              <>
                <FilterBar>
                  <div className="min-w-0">
                    <span className="mb-1 block text-[11px] font-semibold text-slate-500">المجموعة (شكل التبويب)</span>
                    <span
                      className="flex h-9 max-w-[220px] items-center truncate rounded-lg px-3 text-[12.5px] font-bold text-white shadow-sm"
                      style={{ background: winCss(selected.backColour, '#0f9f76') }}
                      title={`${selected.name || `#${selected.id}`} — يظهر للكاشير في نافذة المنتجات`}
                    >
                      {selected.name || `#${selected.id}`}
                    </span>
                  </div>
                  <FilterLabel label="تصفية الأصناف بالاسم أو الباركود" grow>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
                        <IconSearch size={15} />
                      </span>
                      <Input
                        ref={itemSearchRef}
                        value={itemQuery}
                        onChange={e => setItemQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setItemQuery(''); }}
                        placeholder="اكتب للتصفية…"
                        className="!ps-9 !pe-8"
                        aria-label="تصفية الأصناف"
                      />
                      {itemQuery && (
                        <button
                          type="button"
                          className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700"
                          aria-label="مسح"
                          onClick={() => { setItemQuery(''); itemSearchRef.current?.focus(); }}
                        >
                          <IconX size={13} />
                        </button>
                      )}
                    </div>
                  </FilterLabel>
                  <FilterLabel label="الترتيب">
                    <Select
                      aria-label="ترتيب الأصناف"
                      value={sortToken(sort)}
                      onChange={e => {
                        const [key, dir] = e.target.value.split(':');
                        setSort(key ? { key, dir: dir as GridSort['dir'] } : null);
                      }}
                    >
                      <option value="seq:asc">ترتيب المجموعة</option>
                      <option value="name:asc">الاسم</option>
                      <option value="price:asc">السعر</option>
                      {sort && !SORT_PRESETS.includes(sortToken(sort)) && (
                        <option value={sortToken(sort)}>مخصص (من الجدول)</option>
                      )}
                      {!sort && <option value="">بلا ترتيب</option>}
                    </Select>
                  </FilterLabel>
                  <FilterActions>
                    <Btn icon={<IconPlus size={14} />} onClick={() => setPickerOpen(true)}>إضافة منتجات</Btn>
                    <Btn variant="secondary" icon={<IconPencil size={13} />} onClick={() => setEditor('edit')}>تعديل</Btn>
                    <IconButton label="تحديث" onClick={() => { void groupsQ.refetch(); void itemsQ.refetch(); }}>
                      <IconRefresh size={15} className={groupsQ.isFetching || itemsQ.isFetching ? 'animate-spin' : ''} />
                    </IconButton>
                    <IconButton
                      label="حذف المجموعة"
                      className="hover:!border-red-200 hover:!bg-red-50 hover:!text-red-600"
                      disabled={deleteGroup.isPending}
                      onClick={() => void askDeleteGroup()}
                    >
                      <IconTrash size={15} />
                    </IconButton>
                  </FilterActions>
                </FilterBar>

                <SummaryStrip cells={stripCells} loading={itemsQ.isLoading} />

                <WorkspaceBody>
                  {itemsQ.isError ? (
                    <div className="p-3">
                      <Alert title="تعذر تحميل الأصناف">
                        <Btn size="xs" variant="secondary" className="mt-1" onClick={() => itemsQ.refetch()}>إعادة المحاولة</Btn>
                      </Alert>
                    </div>
                  ) : itemsQ.isLoading ? (
                    <div className="p-3"><TableSkeleton rows={10} cols={5} /></div>
                  ) : !itemsQ.data?.length ? (
                    <div className="flex flex-1 items-center justify-center">
                      <EmptyState
                        icon={<IconGrid size={24} />}
                        title="المجموعة فارغة"
                        description="أضف منتجات ليظهر كل منها كزر سريع للكاشير في نقطة البيع."
                        action={<Btn icon={<IconPlus size={14} />} onClick={() => setPickerOpen(true)}>إضافة منتجات</Btn>}
                      />
                    </div>
                  ) : !items.length ? (
                    <EmptyState
                      compact
                      icon={<IconSearch size={16} />}
                      title="لا أصناف مطابقة"
                      action={<Btn size="xs" variant="secondary" onClick={() => setItemQuery('')}>مسح التصفية</Btn>}
                    />
                  ) : (
                    <DataGrid
                      variant="sheet"
                      embedded
                      fillHeight
                      columns={groupItemColumns(toast, item => void askRemoveItem(item))}
                      rows={items}
                      getRowId={i => i.id}
                      storageKey={`group-items-${selectedId}`}
                      sort={sort}
                      onSortChange={setSort}
                      exportName={`مجموعة-${selected?.name ?? selectedId}`}
                      counterLabel="صنف"
                      emptyText="لا أصناف — اضغط «إضافة منتجات» ليظهر الزر في نقطة البيع"
                      badge={<span className="hidden text-[11px] text-slate-400 md:inline">انقر الاسم لفتحه في المنتجات · الباركود للنسخ</span>}
                    />
                  )}
                </WorkspaceBody>
              </>
            )}
          </WorkspaceCard>
        </div>
      )}

      <GroupEditorModal
        open={editor != null}
        mode={editor ?? 'create'}
        group={editor === 'edit' ? selected ?? null : null}
        existingNames={(groupsQ.data ?? []).filter(g => editor !== 'edit' || g.id !== selectedId).map(g => (g.name || '').trim())}
        onClose={() => setEditor(null)}
        onSaved={async id => {
          const wasCreate = editor === 'create';
          setEditor(null);
          await refreshGroups(id);
          if (wasCreate) setPickerOpen(true);
        }}
      />

      {selected && (
        <ScopePickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="إضافة منتجات لأزرار نقطة البيع"
          scopeName={selected.name || 'المجموعة'}
          trees={[]}
          standalone={standalone}
          inScope={pickerScope}
          onCommit={commitPicker}
        />
      )}
    </WorkspacePage>
  );
}

function GroupEditorModal({
  open,
  mode,
  group,
  existingNames,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  group: ArticleGroupDto | null;
  existingNames: string[];
  onClose: () => void;
  onSaved: (id: number) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[0]!);

  const groupId = group?.id ?? 0;
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && group) {
      setName(group.name ?? '');
      setColor(winToHex(group.backColour));
      return;
    }
    setName('');
    setColor(GROUP_COLORS[0]!);
  }, [open, mode, groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const req = { name: name.trim(), backColour: hexToWin(color), foreColour: WHITE_WIN };
      if (mode === 'edit' && group) {
        await api.updateGroup(group.id, req);
        return group.id;
      }
      const created = await api.createGroup(req);
      return created.id;
    },
    onSuccess: async id => {
      toast.success(mode === 'edit' ? 'حُفظت المجموعة' : 'أُنشئت المجموعة — أضف منتجات لتظهر في نقطة البيع');
      await onSaved(id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const trimmed = name.trim();
  const duplicate = !!trimmed && existingNames.some(n => n.toLowerCase() === trimmed.toLowerCase());

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || save.isPending) return;
    save.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      icon={<IconGrid size={18} />}
      title={mode === 'edit' ? 'تعديل المجموعة' : 'مجموعة أزرار جديدة'}
      subtitle="الاسم يظهر كتبويب في نافذة المنتجات بنقطة البيع"
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn type="submit" form="group-editor-form" loading={save.isPending} disabled={!trimmed}>
              {mode === 'edit' ? 'حفظ' : 'إنشاء'}
            </Btn>
          </div>
        </>
      }
    >
      <form id="group-editor-form" onSubmit={submit} className="space-y-4">
        <Field
          label="اسم المجموعة"
          hint={duplicate ? <span className="font-medium text-amber-700">يوجد مجموعة بالاسم نفسه.</span> : `${trimmed.length}/50 حرفاً`}
        >
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: عطور · الأكثر مبيعاً" autoFocus maxLength={50} />
        </Field>
        <Field label="لون الزر">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="لون الزر">
            {GROUP_COLORS.map(c => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 transition ${color === c ? 'ring-2 ring-slate-800' : 'hover:scale-105'}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              >
                {color === c && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </Field>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3">
          <p className="mb-2 text-[11.5px] font-semibold text-slate-500">معاينة في نقطة البيع</p>
          <span
            className="inline-flex h-9 max-w-full items-center truncate rounded-lg px-4 text-[13px] font-bold text-white shadow-sm"
            style={{ background: color }}
          >
            {trimmed || 'اسم المجموعة'}
          </span>
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
