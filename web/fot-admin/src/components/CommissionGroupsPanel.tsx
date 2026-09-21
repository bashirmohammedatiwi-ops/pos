import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { CommissionGroupDetailDto, CommissionGroupDto } from '@/api/types';
import { Btn, Field, Input, Loading, Modal, Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import {
  TreeScopeEditor,
  type ScopeStandaloneItem,
  type ScopeTreeCard,
  type ScopeTreeProduct,
} from '@/components/scope/TreeScopeEditor';
import { ScopePickerModal, type ScopePickerOps } from '@/components/scope/ScopePickerModal';
import { FullScreenEditor } from '@/components/scope/FullScreenEditor';
import { IconCoins, IconPlus, IconSearch } from '@/components/icons';
import { ProductCommissionSearch } from '@/components/commissions/ProductCommissionSearch';
import { CommissionOverlapsSection } from '@/components/commissions/CommissionOverlapsSection';
import { otherCommissionMemberships } from '@/components/commissions/CommissionGroupPills';

const GROUP_COLORS = ['#0f9f76', '#0ea5e9', '#7c3aed', '#d97706', '#e11d48', '#db2777', '#475569', '#0f172a'];

function accentOf(hex?: string | null) {
  const raw = (hex ?? '').trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(raw)) return raw.startsWith('#') ? raw : `#${raw}`;
  return '#0f9f76';
}

function commissionLabel(type: string, value: number) {
  if ((type ?? '').toLowerCase() === 'percentage') return `${formatNum(value)}٪`;
  return `${formatNum(value)} د.ع`;
}

function commissionKind(type: string) {
  return (type ?? '').toLowerCase() === 'percentage' ? 'نسبة من البيع' : 'لكل قطعة';
}

function groupSalesmenLabel(g: Pick<CommissionGroupDto, 'salesmen' | 'salesmanId' | 'salesmanName'>) {
  const names = (g.salesmen ?? []).map(s => s.salesmanName).filter(Boolean) as string[];
  if (names.length > 2) return `${names.slice(0, 2).join('، ')} +${names.length - 2}`;
  if (names.length) return names.join('، ');
  if (g.salesmanName) return g.salesmanName;
  return 'كل البائعين';
}

/**
 * مجاميع العمولة — إنشاء وإدارة فقط.
 * التعديل على نفس الصفحة، بلا تقارير أو نوافذ منفصلة.
 */
export function CommissionGroupsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const editingId = Number(params.get('group') || 0) || null;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'on' | 'off'>('all');
  const [creating, setCreating] = useState(false);

  const groupsQ = useQuery({ queryKey: ['commission-groups'], queryFn: api.commissionGroups });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (groupsQ.data ?? [])
      .filter(g => (statusFilter === 'all' ? true : statusFilter === 'on' ? g.isActive : !g.isActive))
      .filter(g => !q || g.name.toLowerCase().includes(q) || (g.label ?? '').toLowerCase().includes(q));
  }, [groupsQ.data, search, statusFilter]);

  const allCount = groupsQ.data?.length ?? 0;
  const activeCount = (groupsQ.data ?? []).filter(g => g.isActive).length;

  function setEditing(id: number | null) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('group', String(id));
      else next.delete('group');
      next.delete('tab');
      next.delete('salesman');
      return next;
    }, { replace: true });
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['commission-groups'] });
    await qc.invalidateQueries({ queryKey: ['commission-group'] });
    await qc.invalidateQueries({ queryKey: ['commission-overlaps'] });
    await qc.invalidateQueries({ queryKey: ['commission-lookup'] });
  }

  const toggle = useMutation({
    mutationFn: (g: CommissionGroupDto) => api.setCommissionGroupActive(g.id, !g.isActive),
    onSuccess: async (_, g) => {
      toast.success(g.isActive ? 'توقّفت المجموعة' : 'فُعّلت المجموعة');
      await refresh();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  return (
    <div className="mx-auto w-full max-w-6xl pb-10" dir="rtl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] leading-6 text-slate-500">
            أنشئ مجموعة، حدّد العمولة، ثم أضف الأشجار أو المنتجات. التقارير لاحقاً في قسم مستقل.
          </p>
          {allCount > 0 && (
            <p className="mt-1 text-[12px] text-slate-400">
              {formatNum(activeCount)} نشطة من {formatNum(allCount)}
            </p>
          )}
        </div>
        <Btn onClick={() => setCreating(true)}>
          <IconPlus size={15} />
          مجموعة جديدة
        </Btn>
      </header>

      <div className="mb-5 space-y-4">
        <ProductCommissionSearch onOpenGroup={setEditing} />
        <CommissionOverlapsSection onOpenGroup={setEditing} />
      </div>

      {allCount > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <IconSearch size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث باسم المجموعة…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-[13px] outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
            />
          </label>
          <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {([
              ['all', 'الكل'],
              ['on', 'نشطة'],
              ['off', 'متوقفة'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                  statusFilter === id ? 'bg-header text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {groupsQ.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
          ))}
        </div>
      )}

      {!groupsQ.isLoading && groups.length === 0 && (
        <EmptyGroups
          hasAny={allCount > 0}
          onCreate={() => setCreating(true)}
        />
      )}

      {!groupsQ.isLoading && groups.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(g => (
            <GroupCard
              key={g.id}
              group={g}
              busy={toggle.isPending && toggle.variables?.id === g.id}
              onOpen={() => setEditing(g.id)}
              onToggle={() => toggle.mutate(g)}
            />
          ))}
        </div>
      )}

      <CreateGroupModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async id => {
          setCreating(false);
          await refresh();
          setEditing(id);
        }}
      />

      {editingId != null && (
        <GroupEditorLoader
          groupId={editingId}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function EmptyGroups({ hasAny, onCreate }: { hasAny: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <IconCoins size={26} />
      </span>
      <h2 className="text-[18px] font-extrabold text-header">
        {hasAny ? 'لا نتائج لهذا البحث' : 'لا مجاميع بعد'}
      </h2>
      <p className="mt-2 max-w-sm text-[13.5px] leading-6 text-slate-500">
        {hasAny
          ? 'جرّب اسماً آخر أو اعرض كل المجاميع.'
          : 'المجموعة تربط أصنافاً بعمولة ثابتة أو نسبة. أنشئ واحدة ثم أضف الأشجار أو المنتجات.'}
      </p>
      {!hasAny && (
        <Btn className="mt-6" onClick={onCreate}>
          <IconPlus size={15} />
          مجموعة جديدة
        </Btn>
      )}
    </div>
  );
}

function GroupCard({
  group,
  busy,
  onOpen,
  onToggle,
}: {
  group: CommissionGroupDto;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const color = accentOf(group.colorHex);
  return (
    <article
      className={`group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${
        group.isActive ? 'ring-slate-200 hover:ring-brand-200' : 'ring-slate-200 opacity-80'
      }`}
    >
      <div className="h-1.5 w-full" style={{ background: color }} />
      <button type="button" onClick={onOpen} className="block w-full p-5 text-right">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="truncate text-[16px] font-extrabold text-header">{group.name}</h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              group.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {group.isActive ? 'نشطة' : 'متوقفة'}
          </span>
        </div>
        <p className="text-[28px] font-extrabold leading-none tabular-nums tracking-tight text-header">
          {commissionLabel(group.commissionType, group.commissionValue)}
        </p>
        <p className="mt-1.5 text-[12.5px] text-slate-500">{commissionKind(group.commissionType)}</p>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-500">
          <span>{formatNum(group.treeCount ?? 0)} شجرة</span>
          <span className="text-slate-300">·</span>
          <span>{formatNum(group.productCount ?? 0)} صنف</span>
          <span className="text-slate-300">·</span>
          <span className="truncate">{groupSalesmenLabel(group)}</span>
        </div>
      </button>
      <footer className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <Btn size="sm" className="flex-1" onClick={onOpen}>تعديل</Btn>
        <Btn size="sm" variant="secondary" loading={busy} onClick={onToggle}>
          {group.isActive ? 'إيقاف' : 'تفعيل'}
        </Btn>
      </footer>
    </article>
  );
}

function GroupEditorLoader({
  groupId,
  onClose,
  onChanged,
}: {
  groupId: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const detailQ = useQuery({
    queryKey: ['commission-group', groupId],
    queryFn: () => api.commissionGroup(groupId),
  });
  const groupsQ = useQuery({ queryKey: ['commission-groups'], queryFn: api.commissionGroups });

  if (detailQ.isLoading || groupsQ.isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-slate-100/90">
        <Loading />
        <p className="text-[13px] font-semibold text-slate-500">تحميل المجموعة…</p>
      </div>
    );
  }

  if (!detailQ.data) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-100">
        <p className="text-[15px] font-bold text-header">المجموعة غير موجودة</p>
        <Btn variant="secondary" onClick={onClose}>رجوع</Btn>
      </div>
    );
  }

  return (
    <GroupEditorModal
      key={detailQ.data.id}
      detail={detailQ.data}
      open
      onClose={onClose}
      onChanged={onChanged}
      onDeleted={onClose}
      allGroups={groupsQ.data ?? []}
    />
  );
}

export function GroupEditorModal({
  detail,
  open,
  onClose,
  onChanged,
  onDeleted,
  allGroups,
  autoOpenPicker,
}: {
  detail: CommissionGroupDetailDto;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  allGroups: CommissionGroupDto[];
  autoOpenPicker?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(!!autoOpenPicker);
  const [name, setName] = useState(detail.name);
  const [value, setValue] = useState(String(detail.commissionValue));
  const [type, setType] = useState(detail.commissionType || 'fixed');
  const [color, setColor] = useState(accentOf(detail.colorHex));
  const [salesmanIds, setSalesmanIds] = useState<number[]>(
    detail.salesmen?.map(s => s.salesmanId).filter(Boolean) ?? (detail.salesmanId ? [detail.salesmanId] : []),
  );

  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen() });
  const salesmen = salesmenQ.data?.items ?? [];

  async function refreshDetail() {
    await qc.invalidateQueries({ queryKey: ['commission-group', detail.id] });
    await onChanged();
  }

  const deleteGroup = useMutation({
    mutationFn: () => api.deleteCommissionGroup(detail.id),
    onSuccess: async () => {
      toast.success('حُذفت المجموعة');
      await onChanged();
      onDeleted();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  const saveFields = useMutation({
    mutationFn: (patch?: {
      name?: string;
      type?: string;
      value?: number;
      salesmanIds?: number[];
      colorHex?: string;
    }) => {
      const nextType = patch?.type ?? type;
      const nextIds = patch?.salesmanIds ?? salesmanIds;
      return api.updateCommissionGroup(detail.id, {
        name: (patch?.name ?? name).trim() || detail.name,
        description: detail.description ?? null,
        commissionType: nextType,
        commissionValue: patch?.value ?? (Number(value) || 0),
        salesmanId: nextIds.length ? nextIds[0] : null,
        salesmanIds: nextIds,
        label: detail.label ?? null,
        sortOrder: detail.sortOrder ?? 0,
        colorHex: patch?.colorHex ?? color,
        isActive: detail.isActive,
        effectiveFrom: detail.effectiveFrom ?? null,
        effectiveTo: detail.effectiveTo ?? null,
      });
    },
    onSuccess: async () => {
      toast.success('حُفظت المجموعة');
      await onChanged();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const toggleActive = useMutation({
    mutationFn: () => api.setCommissionGroupActive(detail.id, !detail.isActive),
    onSuccess: async () => {
      toast.success(detail.isActive ? 'توقّفت المجموعة' : 'فُعّلت المجموعة');
      await refreshDetail();
    },
  });

  const trees: ScopeTreeCard[] = useMemo(
    () =>
      detail.trees.map(t => ({
        treeSeq: t.treeSeq,
        treeName: t.treeName ?? `شجرة #${t.treeSeq}`,
        count: t.productCount,
        excludedCount: t.excludedCount ?? 0,
        lastSyncedAt: t.lastSyncedAt ?? undefined,
      })),
    [detail.trees],
  );

  const treeSeqs = useMemo(() => new Set(detail.trees.map(t => t.treeSeq)), [detail.trees]);
  const standalone: ScopeStandaloneItem[] = useMemo(
    () =>
      detail.items
        .filter(i => i.sourceTreeSeq == null || !treeSeqs.has(i.sourceTreeSeq))
        .map(i => ({
          id: i.id,
          seq: i.articleId ?? undefined,
          name: i.articleName ?? i.barcode ?? `#${i.id}`,
          barcode: i.barcode ?? undefined,
          price: i.price ?? undefined,
        })),
    [detail.items, treeSeqs],
  );

  const pickerScope = useMemo(() => {
    const seqRowIds = new Map<number, number>();
    for (const i of detail.items) {
      if (i.articleId != null && !seqRowIds.has(i.articleId)) seqRowIds.set(i.articleId, i.id);
    }
    return { treeSeqs, seqRowIds };
  }, [detail.items, treeSeqs]);

  async function commitPicker(ops: ScopePickerOps) {
    for (const seq of ops.removeTreeSeqs) await api.deleteCommissionGroupTree(detail.id, seq);
    for (const rowId of ops.removeRowIds) await api.deleteCommissionGroupItem(detail.id, rowId);
    let absorbed = 0;
    for (const t of ops.addTrees) {
      const r = await api.addCommissionGroupTree(detail.id, t.seq, t.name);
      absorbed += r.updated ?? 0;
    }
    for (const p of ops.addProducts) await api.addCommissionGroupProduct(detail.id, { articleId: p.seq, barcode: p.barcode });
    if (absorbed > 0) toast.success(`دُمجت ${formatNum(absorbed)} أصناف كانت مفردة داخل الشجرة`);
    await refreshDetail();
  }

  const totalScope = trees.reduce((n, t) => n + t.count, 0) + standalone.length;

  return (
    <>
      <FullScreenEditor
        open={open}
        onClose={onClose}
        wide
        title={name.trim() || detail.name}
        subtitle={`${commissionLabel(type, Number(value) || detail.commissionValue)} · ${formatNum(totalScope)} صنف`}
        status={
          <button
            type="button"
            onClick={() => toggleActive.mutate()}
            className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[11.5px] font-bold transition ${
              detail.isActive
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${detail.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {detail.isActive ? 'نشطة' : 'متوقفة'}
          </button>
        }
        actions={
          <>
            <Btn
              variant="ghost"
              className="!text-red-500 hover:!bg-red-50"
              loading={deleteGroup.isPending}
              onClick={() => {
                if (window.confirm(`حذف مجموعة «${detail.name}» نهائياً؟`)) deleteGroup.mutate();
              }}
            >
              حذف
            </Btn>
            <Btn onClick={() => setPickerOpen(true)}>
              <IconPlus size={14} />
              إضافة أصناف
            </Btn>
          </>
        }
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <TreeScopeEditor
              trees={trees}
              standalone={standalone}
              loadTreeProducts={async (seq): Promise<ScopeTreeProduct[]> => {
                const rows = await api.commissionGroupTreeProducts(detail.id, seq);
                return rows.map(r => ({
                  seq: r.articleId,
                  name: r.name ?? `#${r.articleId}`,
                  barcode: r.barcode,
                  price: r.price ?? 0,
                  inScope: r.inGroup,
                  excluded: !!r.excluded,
                  rowId: r.itemId ?? undefined,
                }));
              }}
              loadTreeSize={async seq => (await api.commissionGroupTreeProducts(detail.id, seq)).length}
              onAddTree={async node => {
                const r = await api.addCommissionGroupTree(detail.id, node.seq, node.name);
                if ((r.updated ?? 0) > 0) toast.success(`دُمجت ${formatNum(r.updated ?? 0)} أصناف كانت مفردة داخل الشجرة`);
                await refreshDetail();
              }}
              onAddProduct={async p => {
                const mem = await api.commissionMemberships([p.seq]);
                const others = otherCommissionMemberships(mem[0]?.groups, detail.id);
                if (others.length) {
                  toast.info(`موجود مسبقاً في: ${others.map(g => g.groupName).join('، ')}`);
                }
                await api.addCommissionGroupProduct(detail.id, { articleId: p.seq, barcode: p.barcode });
                await refreshDetail();
              }}
              onRemoveTree={async seq => {
                await api.deleteCommissionGroupTree(detail.id, seq);
                await refreshDetail();
              }}
              onRemoveStandalone={async item => {
                await api.deleteCommissionGroupItem(detail.id, item.id);
                await refreshDetail();
              }}
              onRefreshTree={async seq => (await api.refreshCommissionTree(detail.id, seq)).added}
              onToggleExclude={async (_seq, product) => {
                if (product.rowId == null) return;
                await api.setCommissionItemExcluded(product.rowId, !product.excluded);
                await refreshDetail();
              }}
              labels={{
                scopeTitle: 'منتجات المجموعة',
                emptyHint: 'اضغط «إضافة أصناف» — أشجار كاملة أو منتجات مفردة',
              }}
              hideBrowse
              renderTreeExtra={tree => {
                const targets = allGroups.filter(g => g.id !== detail.id);
                if (!targets.length) return null;
                return (
                  <select
                    defaultValue=""
                    onClick={e => e.stopPropagation()}
                    onChange={async e => {
                      const to = Number(e.target.value);
                      if (!to) return;
                      if (!window.confirm(`نقل شجرة «${tree.treeName}» إلى «${targets.find(g => g.id === to)?.name}»؟`)) {
                        e.target.value = '';
                        return;
                      }
                      try {
                        await api.moveCommissionGroupTree(detail.id, tree.treeSeq, to);
                        toast.success('نُقلت الشجرة');
                        await refreshDetail();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'تعذر النقل');
                      }
                      e.target.value = '';
                    }}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-semibold text-slate-600 hover:border-brand-300"
                    title="نقل الشجرة إلى مجموعة أخرى"
                  >
                    <option value="">نقل إلى…</option>
                    {targets.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                );
              }}
            />
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-[13px] font-bold text-header">إعداد المجموعة</h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">الاسم</label>
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onBlur={() => name.trim() !== detail.name && saveFields.mutate({ name: name.trim() })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">نوع العمولة</label>
                  <Select
                    value={type}
                    onChange={e => {
                      const next = e.target.value;
                      setType(next);
                      saveFields.mutate({ type: next });
                    }}
                  >
                    <option value="fixed">مبلغ لكل قطعة</option>
                    <option value="percentage">نسبة من قيمة البيع</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">
                    {type === 'fixed' ? 'المبلغ (د.ع)' : 'النسبة %'}
                  </label>
                  <Input
                    type="number"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    onBlur={() => {
                      const n = Number(value) || 0;
                      if (n !== detail.commissionValue) saveFields.mutate({ value: n });
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">اللون</label>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        onClick={() => {
                          setColor(c);
                          saveFields.mutate({ colorHex: c });
                        }}
                        className={`h-7 w-7 rounded-full ring-offset-2 transition ${
                          color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-header' : 'hover:scale-110'
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-slate-500">البائعون</label>
                  <SalesmanMultiSelect
                    salesmen={salesmen.map(s => ({ id: s.id, name: s.name ?? `#${s.id}` }))}
                    selectedIds={salesmanIds}
                    onChange={ids => {
                      setSalesmanIds(ids);
                      saveFields.mutate({ salesmanIds: ids });
                    }}
                    emptyLabel="كل البائعين"
                  />
                </div>
              </div>
            </section>
            <p className="px-1 text-[12px] leading-5 text-slate-500">
              شجرة مضافة تدخل كل منتجاتها تلقائياً. استبعاد صنف يُخرجه من العمولة دون حذف الشجرة.
            </p>
          </aside>
        </div>
      </FullScreenEditor>

      <ScopePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="إضافة / إزالة أصناف المجموعة"
        scopeName={name.trim() || detail.name}
        trees={trees}
        standalone={standalone}
        inScope={pickerScope}
        onCommit={commitPicker}
        commissionGroupId={detail.id}
      />
    </>
  );
}

function CreateGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState('fixed');
  const [value, setValue] = useState('1000');
  const [color, setColor] = useState(GROUP_COLORS[0]!);

  useEffect(() => {
    if (open) {
      setName('');
      setType('fixed');
      setValue('1000');
      setColor(GROUP_COLORS[0]!);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.createCommissionGroup({
      name: name.trim(),
      description: null,
      commissionType: type,
      commissionValue: Number(value) || 0,
      colorHex: color,
    }),
    onSuccess: async r => {
      toast.success('أُنشئت المجموعة');
      await onCreated(r.id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الإنشاء'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="مجموعة جديدة"
      subtitle="الاسم والعمولة فقط — الأصناف تُضاف بعدها"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
          <Btn loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>إنشاء</Btn>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="اسم المجموعة">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: عمولة العطور" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="النوع">
            <Select value={type} onChange={e => setType(e.target.value)}>
              <option value="fixed">مبلغ لكل قطعة</option>
              <option value="percentage">نسبة من البيع</option>
            </Select>
          </Field>
          <Field label={type === 'fixed' ? 'المبلغ (د.ع)' : 'النسبة %'}>
            <Input type="number" value={value} onChange={e => setValue(e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[11.5px] font-semibold text-slate-500">اللون</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full ring-offset-2 transition ${
                  color === c ? 'ring-2 ring-header' : 'hover:scale-110'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
