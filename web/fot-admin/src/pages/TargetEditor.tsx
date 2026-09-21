import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatNum } from '@/api/client';
import type {
  TargetRuleDto,
  TargetSalesmanAssignmentDto,
  TargetTreeLinkDto,
} from '@/api/types';
import { useToast } from '@/components/Toast';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import {
  TreeScopeEditor,
  type ScopeStandaloneItem,
  type ScopeTreeCard,
  type ScopeTreeProduct,
} from '@/components/scope/TreeScopeEditor';
import { ScopePickerModal, type ScopePickerOps } from '@/components/scope/ScopePickerModal';
import { FullScreenEditor } from '@/components/scope/FullScreenEditor';
import { notifyOpenerRefresh } from '@/lib/editorWindow';
import {
  Alert,
  Btn,
  Field,
  Input,
  Loading,

  Switch,
  Td,
  Th,
} from '@/components/ui';
import { SettingsStrip, SoftChip } from '@/components/workspace';

/** محرر الهدف على نفس الصفحة. ruleId = null ⟶ هدف جديد. */

function assignmentsForIds(
  ids: number[],
  salesmen: { id: number; name: string }[],
  existing?: TargetSalesmanAssignmentDto[],
) {
  const byId = new Map((existing ?? []).map(a => [a.salesmanId, a]));
  return ids.map(id => {
    const ex = byId.get(id);
    const s = salesmen.find(x => x.id === id);
    return {
      salesmanId: id,
      salesmanName: s?.name ?? ex?.salesmanName,
      dailyTarget: ex?.dailyTarget ?? 0,
      weeklyTarget: ex?.weeklyTarget ?? 0,
      monthlyTarget: ex?.monthlyTarget ?? 0,
    };
  });
}

export function TargetEditor({ ruleId, onClose, autoOpenPicker }: { ruleId: number | null; onClose: () => void; autoOpenPicker?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();

  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen() });
  const salesmen = salesmenQ.data?.items ?? [];

  const ruleQ = useQuery({
    queryKey: ['target-rule', ruleId],
    queryFn: () => api.targetRule(ruleId as number),
    enabled: ruleId != null,
  });

  const [editRule, setEditRule] = useState<TargetRuleDto | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [trees, setTrees] = useState<TargetTreeLinkDto[]>([]);
  const [assignments, setAssignments] = useState<TargetSalesmanAssignmentDto[]>([]);
  const [targetType, setTargetType] = useState<'quantity' | 'amount'>('quantity');
  const [fillDaily, setFillDaily] = useState('');
  const [fillWeekly, setFillWeekly] = useState('');
  const [fillMonthly, setFillMonthly] = useState('');
  const [treeCounts, setTreeCounts] = useState<Record<number, number>>({});
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(!!autoOpenPicker);
  useUnsavedWarning(dirty);

  // حمّل القاعدة عند جهوزها (مرة واحدة لكل معرّف)
  useEffect(() => {
    if (ruleId == null) {
      if (loadedFor !== null) { setLoadedFor(null); }
      return;
    }
    if (ruleQ.data && loadedFor !== ruleId) {
      setLoadedFor(ruleId);
      const rule = ruleQ.data;
      setEditRule(rule);
      setName(rule.name);
      setTrees(rule.trees ?? []);
      setTargetType(rule.targetType === 'amount' ? 'amount' : 'quantity');
      setAssignments(assignmentsForIds((rule.assignments ?? []).map(a => a.salesmanId), salesmen, rule.assignments));
      setErr('');
      setDirty(false);
    }
  }, [ruleId, ruleQ.data, loadedFor, salesmen]);

  useEffect(() => {
    if (trees.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const t of trees.slice(0, 8)) {
        if (treeCounts[t.treeSeq] != null) continue;
        try {
          const { count } = await api.treeProductCount(t.treeSeq);
          if (!cancelled) setTreeCounts(prev => ({ ...prev, [t.treeSeq]: count }));
        } catch { /* تجاهل */ }
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [trees, treeCounts]);

  function mark(next: () => void) {
    next();
    setDirty(true);
  }

  function setAssignmentField(salesmanId: number, field: keyof TargetSalesmanAssignmentDto, value: number) {
    mark(() => setAssignments(prev => prev.map(a => (a.salesmanId === salesmanId ? { ...a, [field]: value } : a))));
  }

  function setSalesmanSelection(ids: number[]) {
    mark(() => setAssignments(assignmentsForIds(ids, salesmen, assignments)));
  }

  function applyFill(onlyEmpty: boolean) {
    const d = Number(fillDaily);
    const w = Number(fillWeekly);
    const m = Number(fillMonthly);
    mark(() =>
      setAssignments(prev =>
        prev.map(a => ({
          ...a,
          dailyTarget: Number.isFinite(d) && fillDaily !== '' && (!onlyEmpty || !a.dailyTarget) ? d : a.dailyTarget,
          weeklyTarget: Number.isFinite(w) && fillWeekly !== '' && (!onlyEmpty || !a.weeklyTarget) ? w : a.weeklyTarget,
          monthlyTarget: Number.isFinite(m) && fillMonthly !== '' && (!onlyEmpty || !a.monthlyTarget) ? m : a.monthlyTarget,
        })),
      ),
    );
  }

  async function persistTarget() {
    if (!name.trim() || trees.length === 0) {
      setErr('أدخل اسماً ونطاقاً واحداً على الأقل');
      return;
    }
    setErr('');
    save.mutate(trees);
  }

  const save = useMutation({
    mutationFn: async (nextTrees: TargetTreeLinkDto[]) => {
      const payload = {
        name: name.trim(),
        targetType,
        trees: nextTrees,
        assignments: assignments.filter(a => a.salesmanId > 0),
      };
      if (editRule) {
        await api.updateTargetRule(editRule.id, payload);
        return editRule.id;
      }
      const created = await api.createTargetRule(payload);
      return created.id;
    },
    onSuccess: async id => {
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      qc.invalidateQueries({ queryKey: ['target-breakdown'] });
      qc.invalidateQueries({ queryKey: ['target-progress'] });
      notifyOpenerRefresh();
      setDirty(false);
      toast.success(editRule ? 'تم تحديث الهدف' : 'تم إنشاء الهدف');
      try {
        const rule = await api.targetRule(id);
        setEditRule(rule);
        setName(rule.name);
        setTrees(rule.trees ?? []);
        setAssignments(assignmentsForIds((rule.assignments ?? []).map(a => a.salesmanId), salesmen, rule.assignments));
      } catch { /* القائمة محدّثة */ }
    },
    onError: e => setErr(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setTargetRuleActive(id, active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      notifyOpenerRefresh();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTargetRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      notifyOpenerRefresh();
      toast.success('تم حذف الهدف');
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحذف'),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!editRule) throw new Error('لا توجد قاعدة');
      const created = await api.createTargetRule({
        name: `${editRule.name} نسخة`,
        targetType: editRule.targetType,
        trees: editRule.trees ?? [],
        assignments: editRule.assignments ?? [],
      });
      return created.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      notifyOpenerRefresh();
      toast.success('تم تكرار الهدف');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل التكرار'),
  });

  function confirmLeave() {
    if (!dirty) return true;
    return window.confirm('هناك تغييرات غير محفوظة. المتابعة بدون حفظ؟');
  }

  const scopeTrees: ScopeTreeCard[] = trees.map(t => ({
    treeSeq: t.treeSeq,
    treeName: t.treeName ?? `شجرة #${t.treeSeq}`,
    count: treeCounts[t.treeSeq] ?? 0,
    excludedCount: 0,
  }));

  const targetStandalone: ScopeStandaloneItem[] = [];

  const targetPickerScope = useMemo(
    () => ({ treeSeqs: new Set(trees.map(t => t.treeSeq)), seqRowIds: new Map<number, number>() }),
    [trees],
  );

  function commitTargetPicker(ops: ScopePickerOps) {
    return Promise.resolve(mark(() => setTrees(prev => {
      const removed = new Set(ops.removeTreeSeqs);
      const next2 = prev.filter(t => !removed.has(t.treeSeq));
      for (const t of ops.addTrees) {
        if (!next2.some(x => x.treeSeq === t.seq)) next2.push({ treeSeq: t.seq, treeName: t.name });
      }
      for (const p of ops.addProducts) {
        if (!next2.some(x => x.treeSeq === p.seq)) next2.push({ treeSeq: p.seq, treeName: p.name });
      }
      return next2;
    })));
  }

  const assignedCount = assignments.filter(a => a.dailyTarget || a.weeklyTarget || a.monthlyTarget).length;
  const loadingRule = ruleId != null && ruleQ.isLoading;

  return (
    <FullScreenEditor
      open
      onClose={() => { if (confirmLeave()) onClose(); }}
      wide
      title={name.trim() || (editRule ? 'تعديل الهدف' : 'هدف جديد')}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{targetType === 'amount' ? 'هدف بمبلغ د.ع' : 'هدف بكمية قطع'}</span>
          <span>·</span>
          <span>{formatNum(trees.length)} نطاق</span>
          <span>·</span>
          <span>{formatNum(assignments.length)} مندوب</span>
          {dirty && <SoftChip tone="brand">غير محفوظ</SoftChip>}
        </span>
      }
      status={editRule ? (
        <button
          type="button"
          onClick={() => toggleActive.mutate({ id: editRule.id, active: !editRule.isActive })}
          className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[11.5px] font-bold transition ${
            editRule.isActive
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
              : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-200'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${editRule.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {editRule.isActive ? 'نشط' : 'متوقف'}
        </button>
      ) : undefined}
      actions={
        <>
          {editRule && (
            <>
              <Btn size="sm" variant="secondary" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>تكرار</Btn>
              <Btn size="sm" variant="danger" onClick={() => window.confirm('حذف هذا الهدف؟') && remove.mutate(editRule.id)}>حذف</Btn>
            </>
          )}
          <Btn size="sm" onClick={() => setPickerOpen(true)}>
            إضافة أصناف
          </Btn>
          <Btn size="sm" onClick={() => void persistTarget()} disabled={save.isPending || !name.trim() || trees.length === 0}>
            {save.isPending ? 'جاري الحفظ…' : 'حفظ'}
          </Btn>
        </>
      }
    >
      {loadingRule ? (
        <div className="rounded-lg border border-border bg-white p-8"><Loading /></div>
      ) : (
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <SettingsStrip>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
              <Field label="اسم الهدف">
                <Input value={name} onChange={e => mark(() => setName(e.target.value))} placeholder="مثال: هدف أجهزة LG" />
              </Field>
              <div className="min-w-[180px]">
                <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">نوع الهدف</label>
                <div className="flex gap-1">
                  {([['quantity', 'كمية (قطع)'], ['amount', 'مبلغ (د.ع)']] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => mark(() => setTargetType(v))}
                      className={`flex-1 rounded-xl border px-3 py-2 text-[12px] font-bold transition ${
                        targetType === v
                          ? 'border-brand-500 bg-brand-50/70 text-brand-700 ring-1 ring-brand-500/25'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {editRule && (
                <div className="pb-1">
                  <Switch label={editRule.isActive ? 'نشط' : 'متوقف'} checked={editRule.isActive} onChange={v => toggleActive.mutate({ id: editRule.id, active: v })} />
                </div>
              )}
            </div>
            <Field label="المندوبون">
              <SalesmanMultiSelect
                salesmen={salesmen.map(s => ({ id: s.id, name: s.name ?? `#${s.id}` }))}
                selectedIds={assignments.map(a => a.salesmanId)}
                onChange={setSalesmanSelection}
                emptyLabel="لم يُختر مندوب — أشّر واحداً أو أكثر"
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label={`يومي (${formatNum(assignedCount)})${targetType === 'amount' ? ' د.ع' : ''}`}>
                <Input type="number" min={0} value={fillDaily} onChange={e => setFillDaily(e.target.value)} />
              </Field>
              <Field label={`أسبوعي${targetType === 'amount' ? ' د.ع' : ''}`}>
                <Input type="number" min={0} value={fillWeekly} onChange={e => setFillWeekly(e.target.value)} />
              </Field>
              <Field label={`شهري${targetType === 'amount' ? ' د.ع' : ''}`}>
                <Input type="number" min={0} value={fillMonthly} onChange={e => setFillMonthly(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-end gap-1">
                <Btn size="sm" variant="secondary" onClick={() => applyFill(false)}>على الكل</Btn>
                <Btn size="sm" variant="secondary" onClick={() => applyFill(true)}>الفارغ فقط</Btn>
              </div>
            </div>
            {assignments.length > 0 && (
              <div className="max-h-40 overflow-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <Th>البائع</Th>
                      <Th>يومي{targetType === 'amount' ? ' (د.ع)' : ''}</Th>
                      <Th>أسبوعي{targetType === 'amount' ? ' (د.ع)' : ''}</Th>
                      <Th>شهري{targetType === 'amount' ? ' (د.ع)' : ''}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map(a => (
                      <tr key={a.salesmanId} className="border-b border-slate-50">
                        <Td className="font-medium">{a.salesmanName ?? a.salesmanId}</Td>
                        <Td><Input type="number" className="!py-1.5" value={a.dailyTarget || ''} onChange={e => setAssignmentField(a.salesmanId, 'dailyTarget', Number(e.target.value) || 0)} /></Td>
                        <Td><Input type="number" className="!py-1.5" value={a.weeklyTarget || ''} onChange={e => setAssignmentField(a.salesmanId, 'weeklyTarget', Number(e.target.value) || 0)} /></Td>
                        <Td><Input type="number" className="!py-1.5" value={a.monthlyTarget || ''} onChange={e => setAssignmentField(a.salesmanId, 'monthlyTarget', Number(e.target.value) || 0)} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SettingsStrip>

          <TreeScopeEditor
            trees={scopeTrees}
            standalone={targetStandalone}
            loadTreeProducts={async (seq): Promise<ScopeTreeProduct[]> => {
              const rows = await api.treeProducts(seq);
              return rows.map(r => ({
                seq: r.seq,
                name: r.name ?? `#${r.seq}`,
                barcode: r.barcode,
                price: r.price,
                inScope: true,
                excluded: false,
              }));
            }}
            loadTreeSize={async seq => (await api.treeProductCount(seq)).count}
            onAddTree={async node => {
              mark(() => setTrees(prev => prev.some(t => t.treeSeq === node.seq) ? prev : [...prev, { treeSeq: node.seq, treeName: node.name }]));
            }}
            onAddProduct={async p => {
              mark(() => setTrees(prev => prev.some(t => t.treeSeq === p.seq) ? prev : [...prev, { treeSeq: p.seq, treeName: p.name }]));
            }}
            onRemoveTree={async seq => {
              mark(() => setTrees(prev => prev.filter(t => t.treeSeq !== seq)));
            }}
            onRemoveStandalone={async () => {}}
            onRefreshTree={async seq => {
              const { count } = await api.treeProductCount(seq);
              setTreeCounts(prev => ({ ...prev, [seq]: count }));
              return 0;
            }}
            labels={{
              scopeTitle: 'نطاق الهدف',
              emptyHint: 'اضغط «إضافة أصناف» — أشجار كاملة أو منتجات',
            }}
            hideBrowse
          />
        </div>
      )}

      <ScopePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="إضافة / إزالة نطاق الهدف"
        scopeName={name.trim() || 'هدف جديد'}
        trees={scopeTrees}
        standalone={targetStandalone}
        inScope={targetPickerScope}
        onCommit={commitTargetPicker}
      />
    </FullScreenEditor>
  );
}

