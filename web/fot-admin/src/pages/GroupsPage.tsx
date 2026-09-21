import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { ArticleGroupDto, ArticleGroupItemDto } from '@/api/types';
import { copyText } from '@/lib/clipboard';
import { useToast } from '@/components/Toast';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, Field, Input, Loading, Modal, Select } from '@/components/ui';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { EmptyWorkspace, RailCard, RailItem, SplitWorkspace } from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';
import { IconPlus, IconTrash } from '@/components/icons';
import { ScopePickerModal, type ScopePickerOps } from '@/components/scope/ScopePickerModal';

const GROUP_KEY = 'fot_admin_group';
const GROUP_COLORS = ['#0f9f76', '#0ea5e9', '#7c3aed', '#d97706', '#e11d48', '#db2777', '#475569', '#0f172a'];
const WHITE_WIN = 16777215;

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
            <Link to={`/products?search=${encodeURIComponent(i.barcode || i.name)}`} className="hover:text-brand-700 hover:underline">
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
            className="hover:text-brand-700 hover:underline"
            onClick={() => {
              copyText(i.barcode!)
                .then(() => toast.success('تم نسخ الباركود'))
                .catch(() => toast.error('تعذر النسخ'));
            }}
          >
            {i.barcode}
          </button>
        ) : '—',
    },
    { key: 'price', header: 'السعر', width: 120, mono: true, footer: 'avg', render: i => <span className="font-bold text-header">{formatNum(i.price)}</span> },
    {
      key: 'originalPrice',
      header: 'أصلي',
      width: 120,
      mono: true,
      render: i =>
        i.originalPrice !== i.price ? (
          <span className="text-slate-400 line-through">{formatNum(i.originalPrice)}</span>
        ) : '—',
    },
    {
      key: 'remove',
      header: '',
      width: 52,
      align: 'center',
      render: i => (
        <button
          type="button"
          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="إزالة من أزرار نقطة البيع"
          onClick={() => onRemove(i)}
        >
          <IconTrash size={14} />
        </button>
      ),
    },
  ];
}

export function GroupsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const n = Number(sessionStorage.getItem(GROUP_KEY) || 0);
    return n || null;
  });
  const [query, setQuery] = useState(() => sessionStorage.getItem('fot_admin_groups_q') ?? '');
  const [itemQuery, setItemQuery] = useState(() => sessionStorage.getItem('fot_admin_groups_iq') ?? '');
  const [sort, setSort] = useState<'seq' | 'name' | 'price'>('seq');
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    sessionStorage.setItem('fot_admin_groups_q', query);
    sessionStorage.setItem('fot_admin_groups_iq', itemQuery);
  }, [query, itemQuery]);

  useEffect(() => {
    if (selectedId != null) {
      sessionStorage.setItem(GROUP_KEY, String(selectedId));
      return;
    }
    if (groups.length) setSelectedId(groups[0].id);
  }, [groups, selectedId]);

  const items = useMemo(() => {
    const list = [...(itemsQ.data ?? [])];
    const q = itemQuery.trim().toLowerCase();
    const filtered = q
      ? list.filter(i => (i.name || '').toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q))
      : list;
    filtered.sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '', 'ar');
      if (sort === 'price') return a.price - b.price;
      return (a.seq - b.seq) || (a.id - b.id);
    });
    return filtered;
  }, [itemQuery, itemsQ.data, sort]);

  const selected = groups.find(g => g.id === selectedId) ?? groupsQ.data?.find(g => g.id === selectedId);
  const totalItems = (groupsQ.data ?? []).reduce((n, g) => n + (g.itemCount || 0), 0);
  const discounted = items.filter(i => i.originalPrice > 0 && i.price < i.originalPrice).length;

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

  const createBtn = (
    <Btn size="sm" onClick={() => setEditor('create')}>
      <IconPlus size={14} />
      مجموعة جديدة
    </Btn>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {groupsQ.isLoading && <Loading />}

      {!groupsQ.isLoading && !groups.length && !query && (
        <EmptyWorkspace
          title="لا مجموعات أزرار"
          hint="أنشئ مجموعة ثم أضف منتجات — تظهر كأزرار في نافذة المنتجات بنقطة البيع."
          action={createBtn}
        />
      )}

      {!groupsQ.isLoading && (!!groups.length || !!query) && (
        <ClassicListShell
          filters={
            <div className="grid gap-3 lg:grid-cols-2 lg:items-end">
              <FilterField label="بحث المجموعات">
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="اسم المجموعة…" />
              </FilterField>
              <FilterField label="تصفية الأصناف">
                <Input value={itemQuery} onChange={e => setItemQuery(e.target.value)} placeholder="اسم أو باركود…" disabled={selectedId == null} />
              </FilterField>
            </div>
          }
          header={{
            title: selected?.name ?? 'مجموعات الأزرار',
            hint: 'هذه الأصناف تظهر للكاشير في نافذة المنتجات',
            actions: (
              <>
                {createBtn}
                {selected && (
                  <>
                    <Btn size="sm" variant="secondary" onClick={() => setEditor('edit')}>تعديل</Btn>
                    <Btn size="sm" onClick={() => setPickerOpen(true)}>
                      <IconPlus size={14} />
                      إضافة منتجات
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      className="!text-red-500 hover:!bg-red-50"
                      loading={deleteGroup.isPending}
                      onClick={() => {
                        if (window.confirm(`حذف مجموعة «${selected.name}» وكل أزرارها من نقطة البيع؟`)) {
                          deleteGroup.mutate();
                        }
                      }}
                    >
                      حذف
                    </Btn>
                  </>
                )}
                <Select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="!w-32 !py-1 text-[11px]">
                  <option value="seq">ترتيب المجموعة</option>
                  <option value="name">الاسم</option>
                  <option value="price">السعر</option>
                </Select>
                <Btn
                  size="sm"
                  variant="secondary"
                  disabled={!items.length}
                  onClick={() =>
                    downloadCsv(
                      `group-${selectedId}.csv`,
                      ['#', 'الاسم', 'باركود', 'السعر', 'أصلي'],
                      items.map((i, idx) => [idx + 1, i.name ?? '', i.barcode ?? '', i.price, i.originalPrice]),
                    )
                  }
                >
                  CSV
                </Btn>
              </>
            ),
          }}
          onRefresh={() => { void groupsQ.refetch(); if (selectedId != null) void itemsQ.refetch(); }}
          refreshing={groupsQ.isFetching || itemsQ.isFetching}
          footer={
            <ClassicSummaryFooter
              total={groupsQ.data?.length ?? 0}
              totalLabel="مجموعات"
              items={[
                { label: 'أصناف', value: formatNum(totalItems), accent: true },
                { label: 'الحالية', value: formatNum(items.length) },
                { label: 'بعرض', value: formatNum(discounted) },
              ]}
            />
          }
        >
        <SplitWorkspace
          fill
          compact
          rail={
            <RailCard compact title="المجاميع">
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {groups.map(g => (
                  <li key={g.id}>
                    <RailItem
                      active={selectedId === g.id}
                      title={g.name ?? `#${g.id}`}
                      meta={`${formatNum(g.itemCount)} صنف`}
                      leading={
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-200"
                          style={{ background: winCss(g.backColour, '#e2e8f0') }}
                        />
                      }
                      onClick={() => setSelectedId(g.id)}
                    />
                  </li>
                ))}
              </ul>
            </RailCard>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {selectedId == null ? (
              <EmptyWorkspace title="اختر مجموعة" hint="من القائمة اليمنى، أو أنشئ مجموعة ثم أضف منتجات." />
            ) : (
              <>
                {itemsQ.isLoading && <Loading />}
                {!itemsQ.isLoading && (
                  <DataGrid
                    embedded
                    fillHeight
                    columns={groupItemColumns(toast, item => {
                      if (window.confirm(`إزالة «${item.name || item.barcode}» من أزرار نقطة البيع؟`)) {
                        removeItem.mutate(item);
                      }
                    })}
                    rows={items}
                    getRowId={i => i.id}
                    storageKey={`group-items-${selectedId}`}
                    exportName={`مجموعة-${selected?.name ?? selectedId}`}
                    counterLabel="صنف"
                    emptyText="لا أصناف — اضغط «إضافة منتجات» ليظهر الزر في نقطة البيع"
                  />
                )}
              </>
            )}
          </div>
        </SplitWorkspace>
        </ClassicListShell>
      )}

      <GroupEditorModal
        open={editor != null}
        mode={editor ?? 'create'}
        group={editor === 'edit' ? selected ?? null : null}
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
    </div>
  );
}

function GroupEditorModal({
  open,
  mode,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  group: ArticleGroupDto | null;
  onClose: () => void;
  onSaved: (id: number) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[0]!);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && group) {
      setName(group.name ?? '');
      setColor(winToHex(group.backColour));
      return;
    }
    setName('');
    setColor(GROUP_COLORS[0]!);
  }, [group, mode, open]);

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'تعديل المجموعة' : 'مجموعة أزرار جديدة'}
      subtitle="الاسم يظهر كتبويب في نافذة المنتجات بالكاشير"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
          <Btn loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {mode === 'edit' ? 'حفظ' : 'إنشاء'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="اسم المجموعة">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: عطور · الأكثر مبيعاً" autoFocus maxLength={50} />
        </Field>
        <Field label="لون الزر">
          <div className="flex flex-wrap gap-2">
            {GROUP_COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-slate-800' : 'border-transparent'}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
