import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, formatNum } from '@/api/client';
import type {
  TargetRuleDto,
  TargetSalesmanAssignmentDto,
  TargetTreeLinkDto,
} from '@/api/types';
import { useToast } from '@/components/Toast';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import {
  TreeScopeEditor,
  type ScopeStandaloneItem,
  type ScopeTreeCard,
  type ScopeTreeProduct,
} from '@/components/scope/TreeScopeEditor';
import { ScopePickerModal, type ScopePickerOps } from '@/components/scope/ScopePickerModal';
import { FullScreenEditor } from '@/components/scope/FullScreenEditor';
import { notifyOpenerRefresh } from '@/lib/editorWindow';
import { formatPeriodRange } from '@/lib/businessPeriod';
import {
  Alert,
  Badge,
  Btn,
  Field,
  IconButton,
  Input,
  Kbd,
  Loading,
  Select,
  useConfirm,
} from '@/components/ui';
import { IconCheck, IconCopy, IconPlus, IconTarget, IconTrash, IconX, IconZap } from '@/components/icons';
import { IconPause, IconPlay, progressTone } from '@/components/incentives/kit';
import { rowMetric, targetUnit } from '@/components/incentives/targetMath';

/** محرر الهدف على نفس الصفحة (أو في نافذة مستقلة). ruleId = null ⟶ هدف جديد. */

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

const SECTION_IDS = { basics: 'tg-basics', people: 'tg-people', scope: 'tg-scope' } as const;

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function TargetEditor({ ruleId, onClose, autoOpenPicker }: { ruleId: number | null; onClose: () => void; autoOpenPicker?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const bp = useBusinessPeriod();
  const week = bp.periods.currentWeek;

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
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(!!autoOpenPicker);
  const [excludedSeqs, setExcludedSeqs] = useState<Set<number>>(new Set());
  const [previewSalesmanId, setPreviewSalesmanId] = useState<number | null>(null);
  const hydratedFor = useRef<number | null | undefined>(undefined);
  const dirtyRef = useRef(false);
  const draftRef = useRef({
    name: '',
    trees: [] as TargetTreeLinkDto[],
    assignments: [] as TargetSalesmanAssignmentDto[],
    targetType: 'quantity' as 'quantity' | 'amount',
    excludedSeqs: new Set<number>(),
    editRule: null as TargetRuleDto | null,
  });
  draftRef.current = { name, trees, assignments, targetType, excludedSeqs, editRule };
  useUnsavedWarning(dirty);

  function applyServerRule(rule: TargetRuleDto, salesmanList: { id: number; name: string }[]) {
    hydratedFor.current = rule.id;
    setLoadedFor(rule.id);
    setEditRule(rule);
    setName(rule.name);
    setTrees(rule.trees ?? []);
    setTargetType(rule.targetType === 'amount' ? 'amount' : 'quantity');
    setAssignments(assignmentsForIds((rule.assignments ?? []).map(a => a.salesmanId), salesmanList, rule.assignments));
    setExcludedSeqs(new Set(rule.excludedArticleIds ?? []));
    setErr('');
    setAttempted(false);
    dirtyRef.current = false;
    setDirty(false);
    qc.setQueryData(['target-rule', rule.id], rule);
  }

  // حمّل القاعدة مرة واحدة لكل معرّف، ولا تمسح تعديلات المستخدم إذا تحدّث الاستعلام.
  useEffect(() => {
    if (ruleId == null) {
      hydratedFor.current = null;
      if (loadedFor !== null) setLoadedFor(null);
      return;
    }
    if (!ruleQ.data || dirtyRef.current || hydratedFor.current === ruleId) return;
    applyServerRule(ruleQ.data, salesmen);
  }, [ruleId, ruleQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

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
    dirtyRef.current = true;
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

  /** اشتقاق الأسبوعي والشهري من اليومي (طول أسبوع العمل × اليومي، ٣٠ يوماً للشهر). */
  function deriveFromDaily() {
    const d = Number(fillDaily);
    if (!fillDaily || !Number.isFinite(d) || d <= 0) return;
    setFillWeekly(String(d * bp.weekLen));
    setFillMonthly(String(d * 30));
  }

  // ── التحقق ──
  const nameError = name.trim() ? null : 'اكتب اسماً للهدف';
  const scopeError = trees.length ? null : 'أضف نطاقاً واحداً على الأقل (شجرة أو منتج)';
  const withNumbers = assignments.filter(a => a.dailyTarget || a.weeklyTarget || a.monthlyTarget).length;
  const missingNumbers = assignments.length - withNumbers;
  const canSave = !nameError && !scopeError;

  async function persistTarget(snapshot?: {
    name?: string;
    trees?: TargetTreeLinkDto[];
    assignments?: TargetSalesmanAssignmentDto[];
    targetType?: 'quantity' | 'amount';
    excludedSeqs?: Set<number>;
  }) {
    const draft = { ...draftRef.current, ...snapshot };
    setAttempted(true);
    if (!draft.name.trim() || draft.trees.length === 0) {
      setErr('أكمل الحقول المطلوبة: الاسم ونطاق واحد على الأقل');
      if (!draft.name.trim()) scrollToSection(SECTION_IDS.basics);
      else scrollToSection(SECTION_IDS.scope);
      return;
    }
    setErr('');
    draftRef.current = {
      ...draftRef.current,
      name: draft.name,
      trees: draft.trees,
      assignments: draft.assignments,
      targetType: draft.targetType,
      excludedSeqs: draft.excludedSeqs,
    };
    await save.mutateAsync({
      name: draft.name.trim(),
      targetType: draft.targetType,
      trees: draft.trees,
      assignments: draft.assignments.filter(a => a.salesmanId > 0),
      excludedArticleIds: [...draft.excludedSeqs],
      existingId: draft.editRule?.id ?? null,
    });
  }

  const save = useMutation({
    mutationFn: async (payload: {
      name: string;
      targetType: 'quantity' | 'amount';
      trees: TargetTreeLinkDto[];
      assignments: TargetSalesmanAssignmentDto[];
      excludedArticleIds: number[];
      existingId: number | null;
    }) => {
      if (payload.existingId) {
        await api.updateTargetRule(payload.existingId, payload);
        return payload.existingId;
      }
      const created = await api.createTargetRule(payload);
      return created.id;
    },
    onSuccess: async id => {
      notifyOpenerRefresh();
      const wasNew = draftRef.current.editRule == null;
      try {
        const rule = await api.targetRule(id);
        applyServerRule(rule, salesmen);
        qc.setQueryData<TargetRuleDto[]>(['target-rules'], prev => {
          const list = prev ?? [];
          const idx = list.findIndex(r => r.id === rule.id);
          if (idx < 0) return [rule, ...list];
          const next = list.slice();
          next[idx] = rule;
          return next;
        });
      } catch { /* القائمة تُحدَّث بالأسفل */ }
      await qc.invalidateQueries({ queryKey: ['target-rules'] });
      await qc.invalidateQueries({ queryKey: ['target-breakdown'] });
      await qc.invalidateQueries({ queryKey: ['target-breakdowns'] });
      await qc.invalidateQueries({ queryKey: ['target-progress'] });
      toast.success(wasNew ? 'تم إنشاء الهدف' : 'تم حفظ الهدف');
    },
    onError: e => {
      const msg = e instanceof Error ? e.message : 'فشل الحفظ';
      setErr(msg);
      toast.error(msg);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setTargetRuleActive(id, active),
    onSuccess: (_, v) => {
      setEditRule(prev => (prev ? { ...prev, isActive: v.active } : prev));
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      qc.invalidateQueries({ queryKey: ['target-breakdowns'] });
      notifyOpenerRefresh();
      toast.success(v.active ? 'فُعّل الهدف' : 'توقّف الهدف');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteTargetRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      qc.invalidateQueries({ queryKey: ['target-breakdowns'] });
      notifyOpenerRefresh();
      toast.success('تم حذف الهدف');
      dirtyRef.current = false;
      setDirty(false);
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
        excludedArticleIds: [...excludedSeqs],
      });
      return created.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['target-rules'] });
      notifyOpenerRefresh();
      toast.success('تم تكرار الهدف — النسخة في القائمة');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل التكرار'),
  });

  async function requestClose() {
    if (dirty) {
      const ok = await confirm({
        title: 'تغييرات غير محفوظة',
        message: 'ستفقد التعديلات التي لم تُحفظ. المتابعة بدون حفظ؟',
        confirmLabel: 'خروج بدون حفظ',
        danger: true,
      });
      if (!ok) return;
    }
    dirtyRef.current = false;
    setDirty(false);
    onClose();
  }

  async function askToggle() {
    if (!editRule) return;
    if (editRule.isActive) {
      const ok = await confirm({
        title: 'إيقاف الهدف؟',
        message: 'يختفي من شاشة البائعين ولا يُتابع تقدّمه حتى تُفعّله.',
        confirmLabel: 'إيقاف',
        danger: true,
      });
      if (!ok) return;
    }
    toggleActive.mutate({ id: editRule.id, active: !editRule.isActive });
  }

  async function askDelete() {
    if (!editRule) return;
    const ok = await confirm({
      title: `حذف «${editRule.name}» نهائياً؟`,
      message: 'يُحذف الهدف مع أرقام البائعين. لا يمكن التراجع.',
      confirmLabel: 'حذف نهائي',
      danger: true,
    });
    if (ok) remove.mutate(editRule.id);
  }

  async function discardChanges() {
    if (!editRule) return;
    const ok = await confirm({ title: 'تجاهل التغييرات؟', message: 'يعود الهدف إلى آخر نسخة محفوظة.', confirmLabel: 'تجاهل', danger: true });
    if (!ok) return;
    // نقرأ النسخة الحالية من الخادم — بعض التعديلات (كاستثناء صنف) تُحفظ فوراً
    try {
      applyServerRule(await api.targetRule(editRule.id), salesmen);
    } catch {
      applyServerRule(editRule, salesmen);
    }
  }

  // Ctrl+S للحفظ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'س' || e.code === 'KeyS')) {
        if (document.querySelector('[role="alertdialog"]')) return;
        e.preventDefault();
        if (!save.isPending) void persistTarget().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  async function commitTargetPicker(ops: ScopePickerOps) {
    const removed = new Set(ops.removeTreeSeqs);
    const nextTrees = draftRef.current.trees.filter(t => !removed.has(t.treeSeq));
    for (const t of ops.addTrees) {
      if (!nextTrees.some(x => x.treeSeq === t.seq)) nextTrees.push({ treeSeq: t.seq, treeName: t.name });
    }
    for (const p of ops.addProducts) {
      if (!nextTrees.some(x => x.treeSeq === p.seq)) nextTrees.push({ treeSeq: p.seq, treeName: p.name });
    }
    const nextExcluded = new Set(draftRef.current.excludedSeqs);
    for (const seq of ops.excludeProductSeqs) nextExcluded.add(seq);
    setTrees(nextTrees);
    setExcludedSeqs(nextExcluded);
    dirtyRef.current = true;
    setDirty(true);
    await persistTarget({ trees: nextTrees, excludedSeqs: nextExcluded });
  }

  // ── المعاينة: تقدّم الأسبوع الحالي لهدف محفوظ ونشط ──
  const breakdownQ = useQuery({
    queryKey: ['target-breakdown', editRule?.id, week.from, week.to],
    queryFn: () => api.targetBreakdown(editRule!.id, week.from, week.to),
    enabled: !!editRule?.id && editRule.isActive && !bp.isLoading,
  });

  const previewAssignment = assignments.find(a => a.salesmanId === previewSalesmanId) ?? assignments[0] ?? null;
  const previewSold = useMemo(() => {
    if (!previewAssignment || !breakdownQ.data) return 0;
    const row = breakdownQ.data.salesmen.find(s => s.salesmanId === previewAssignment.salesmanId);
    return row ? rowMetric(row, targetType) : 0;
  }, [previewAssignment, breakdownQ.data, targetType]);

  const totals = useMemo(() => assignments.reduce(
    (acc, a) => ({
      daily: acc.daily + (a.dailyTarget || 0),
      weekly: acc.weekly + (a.weeklyTarget || 0),
      monthly: acc.monthly + (a.monthlyTarget || 0),
    }),
    { daily: 0, weekly: 0, monthly: 0 },
  ), [assignments]);

  const loadingRule = ruleId != null && ruleQ.isLoading;
  const unit = targetUnit(targetType);
  const scopeProducts = scopeTrees.reduce((n, t) => n + t.count, 0);

  return (
    <FullScreenEditor
      open
      onClose={() => void requestClose()}
      wide
      title={name.trim() || (editRule ? 'تعديل الهدف' : 'هدف جديد')}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{targetType === 'amount' ? 'هدف بمبلغ IQD' : 'هدف بكمية قطع'}</span>
          <span className="text-slate-300">·</span>
          <span>{formatNum(trees.length)} نطاق</span>
          <span className="text-slate-300">·</span>
          <span>{formatNum(assignments.length)} بائع</span>
          {excludedSeqs.size > 0 && <><span className="text-slate-300">·</span><span>{formatNum(excludedSeqs.size)} مستبعد</span></>}
        </span>
      }
      status={editRule ? (
        <button
          type="button"
          onClick={() => void askToggle()}
          disabled={toggleActive.isPending}
          title={editRule.isActive ? 'اضغط للإيقاف' : 'اضغط للتفعيل'}
          className="shrink-0 transition hover:opacity-80 disabled:opacity-50"
        >
          <Badge tone={editRule.isActive ? 'ok' : 'default'} dot>{editRule.isActive ? 'نشط' : 'متوقف'}</Badge>
        </button>
      ) : <Badge tone="brand">جديد</Badge>}
      actions={
        <>
          {editRule && (
            <>
              <IconButton label="تكرار الهدف" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
                <IconCopy size={15} />
              </IconButton>
              <IconButton label={editRule.isActive ? 'إيقاف' : 'تفعيل'} disabled={toggleActive.isPending} onClick={() => void askToggle()}>
                {editRule.isActive ? <IconPause size={14} /> : <IconPlay size={14} />}
              </IconButton>
              <IconButton
                label="حذف الهدف"
                className="hover:!border-red-200 hover:!bg-red-50 hover:!text-red-600"
                disabled={remove.isPending}
                onClick={() => void askDelete()}
              >
                <IconTrash size={15} />
              </IconButton>
            </>
          )}
          <Btn variant="secondary" icon={<IconPlus size={14} />} onClick={() => setPickerOpen(true)}>
            إضافة أصناف
          </Btn>
        </>
      }
    >
      {loadingRule ? (
        <div className="card p-8"><Loading label="تحميل الهدف…" /></div>
      ) : ruleId != null && ruleQ.isError ? (
        <Alert title="تعذر تحميل الهدف">
          <Btn size="xs" variant="secondary" className="mt-1" onClick={() => ruleQ.refetch()}>إعادة المحاولة</Btn>
        </Alert>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── الأقسام ── */}
          <div className="min-w-0 space-y-4">
            {err && <Alert>{err}</Alert>}

            <Section id={SECTION_IDS.basics} step={1} title="الأساسيات" subtitle="اسم واضح يراه البائع، وطريقة قياس الهدف" done={!nameError}>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <Field label="اسم الهدف">
                    <Input
                      value={name}
                      onChange={e => mark(() => setName(e.target.value))}
                      placeholder="مثال: هدف أجهزة LG"
                      aria-invalid={attempted && !!nameError}
                      className={attempted && nameError ? '!border-red-300' : ''}
                      autoFocus={ruleId == null}
                    />
                  </Field>
                  {attempted && nameError && <p className="mt-1 text-[11.5px] text-red-600">{nameError}</p>}
                </div>
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold text-slate-600">يُقاس الهدف بـ</p>
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="نوع الهدف">
                    {([
                      ['quantity', 'الكمية', 'عدد القطع المباعة'],
                      ['amount', 'المبلغ', 'قيمة المبيع بالدينار'],
                    ] as const).map(([v, label, hint]) => {
                      const active = targetType === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => mark(() => setTargetType(v))}
                          className={`rounded-lg border px-3 py-2 text-right transition ${
                            active
                              ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500/25'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`block text-[12.5px] font-bold ${active ? 'text-brand-800' : 'text-slate-700'}`}>{label}</span>
                          <span className="block text-[11px] text-slate-500">{hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Section>

            <Section
              id={SECTION_IDS.people}
              step={2}
              title="البائعون والأرقام"
              subtitle="من يُحاسب على الهدف، وكم المطلوب يومياً وأسبوعياً وشهرياً"
              done={assignments.length > 0 && missingNumbers === 0}
              aside={assignments.length > 0 && (
                <Badge tone={missingNumbers ? 'warn' : 'ok'}>
                  {formatNum(withNumbers)} / {formatNum(assignments.length)} بأرقام
                </Badge>
              )}
            >
              <div className="space-y-4">
                <SalesmanMultiSelect
                  salesmen={salesmen.map(s => ({ id: s.id, name: s.name ?? `#${s.id}` }))}
                  selectedIds={assignments.map(a => a.salesmanId)}
                  onChange={setSalesmanSelection}
                  emptyLabel="لم يُختر بائع — أشّر واحداً أو أكثر"
                />

                {assignments.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                      <IconZap size={13} className="text-brand-600" />
                      تعبئة سريعة لكل البائعين
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
                      <Field label={`يومي (${unit})`}>
                        <Input type="number" min={0} value={fillDaily} onChange={e => setFillDaily(e.target.value)} className="num" />
                      </Field>
                      <Field label={`أسبوعي (${unit})`}>
                        <Input type="number" min={0} value={fillWeekly} onChange={e => setFillWeekly(e.target.value)} className="num" />
                      </Field>
                      <Field label={`شهري (${unit})`}>
                        <Input type="number" min={0} value={fillMonthly} onChange={e => setFillMonthly(e.target.value)} className="num" />
                      </Field>
                      <div className="flex flex-wrap gap-1">
                        <Btn size="sm" onClick={() => applyFill(false)} disabled={!fillDaily && !fillWeekly && !fillMonthly}>على الكل</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => applyFill(true)} disabled={!fillDaily && !fillWeekly && !fillMonthly}>الفارغ فقط</Btn>
                      </div>
                    </div>
                    {Number(fillDaily) > 0 && (
                      <button type="button" onClick={deriveFromDaily} className="mt-2 text-[11.5px] font-semibold text-brand-700 hover:underline">
                        اشتقاق الأسبوعي (× {formatNum(bp.weekLen)}) والشهري (× 30) من اليومي
                      </button>
                    )}
                  </div>
                )}

                {assignments.length > 0 && (
                  <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full min-w-[560px] text-[13px]">
                      <thead>
                        <tr className="text-right text-[11.5px] font-semibold text-slate-500">
                          <th className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2">البائع</th>
                          <th className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-2 py-2">يومي</th>
                          <th className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-2 py-2">أسبوعي</th>
                          <th className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-2 py-2">شهري</th>
                          <th className="sticky top-0 z-[1] w-10 border-b border-slate-200 bg-slate-50" />
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map(a => {
                          const empty = !a.dailyTarget && !a.weeklyTarget && !a.monthlyTarget;
                          const odd = (a.weeklyTarget > 0 && a.dailyTarget > a.weeklyTarget)
                            || (a.monthlyTarget > 0 && a.weeklyTarget > a.monthlyTarget);
                          return (
                            <tr key={a.salesmanId} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-1.5">
                                <p className="font-semibold text-header">{a.salesmanName ?? `#${a.salesmanId}`}</p>
                                {empty && <p className="text-[11px] text-amber-700">بلا أرقام — لن يظهر له تقدّم</p>}
                                {!empty && odd && <p className="text-[11px] text-amber-700">تحقق: رقم الفترة الأقصر أكبر من الأطول</p>}
                              </td>
                              {(['dailyTarget', 'weeklyTarget', 'monthlyTarget'] as const).map(f => (
                                <td key={f} className="px-2 py-1.5">
                                  <Input
                                    type="number"
                                    min={0}
                                    className="num !h-8"
                                    value={a[f] || ''}
                                    placeholder="0"
                                    onChange={e => setAssignmentField(a.salesmanId, f, Math.max(0, Number(e.target.value) || 0))}
                                  />
                                </td>
                              ))}
                              <td className="px-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => setSalesmanSelection(assignments.filter(x => x.salesmanId !== a.salesmanId).map(x => x.salesmanId))}
                                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                                  aria-label={`إزالة ${a.salesmanName ?? ''}`}
                                  title="إزالة من الهدف"
                                >
                                  <IconX size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 text-[12px] font-semibold text-slate-600">
                          <td className="px-3 py-2">المجموع ({unit})</td>
                          <td className="num px-3 py-2">{formatNum(totals.daily)}</td>
                          <td className="num px-3 py-2">{formatNum(totals.weekly)}</td>
                          <td className="num px-3 py-2">{formatNum(totals.monthly)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </Section>

            <Section
              id={SECTION_IDS.scope}
              step={3}
              title="نطاق الأصناف"
              subtitle="المبيعات التي تُحسب للهدف — أشجار كاملة أو منتجات، مع استبعاد ما لا يدخل"
              done={!scopeError}
              aside={<Btn size="sm" variant="soft" icon={<IconPlus size={14} />} onClick={() => setPickerOpen(true)}>إضافة أصناف</Btn>}
            >
              {attempted && scopeError && <p className="mb-2 text-[11.5px] text-red-600">{scopeError}</p>}
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
                    inScope: !excludedSeqs.has(r.seq),
                    excluded: excludedSeqs.has(r.seq),
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
                onToggleExclude={async (_treeSeq, product) => {
                  const nextExcluded = !excludedSeqs.has(product.seq);
                  if (editRule) {
                    await api.setTargetArticleExcluded(editRule.id, product.seq, nextExcluded);
                  }
                  mark(() => setExcludedSeqs(prev => {
                    const next = new Set(prev);
                    if (nextExcluded) next.add(product.seq);
                    else next.delete(product.seq);
                    return next;
                  }));
                }}
                labels={{
                  scopeTitle: 'نطاق الهدف',
                  emptyHint: 'اضغط «إضافة أصناف» — أشجار كاملة أو منتجات',
                }}
                hideBrowse
              />
            </Section>

            {/* شريط الحفظ الثابت */}
            <div className="sticky bottom-0 z-10 -mx-1 pb-1">
              <div className="card flex flex-wrap items-center gap-3 px-4 py-3 shadow-[var(--shadow-lift)]">
                <div className="min-w-0 flex-1 text-[12px]">
                  {dirty ? (
                    <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      تغييرات غير محفوظة
                    </p>
                  ) : editRule ? (
                    <p className="flex items-center gap-1.5 text-emerald-700"><IconCheck size={13} /> كل التغييرات محفوظة</p>
                  ) : (
                    <p className="text-slate-500">هدف جديد — يُحفظ بعد إدخال الاسم والنطاق</p>
                  )}
                  {!canSave && (
                    <p className="mt-0.5 text-[11.5px] text-slate-500">
                      ناقص: {[nameError && 'الاسم', scopeError && 'النطاق'].filter(Boolean).join('، ')}
                    </p>
                  )}
                </div>
                <span className="hidden text-[11.5px] text-slate-400 sm:inline"><Kbd>Ctrl</Kbd> + <Kbd>S</Kbd></span>
                {editRule && dirty && (
                  <Btn variant="ghost" onClick={() => void discardChanges()}>تجاهل</Btn>
                )}
                <Btn
                  icon={<IconCheck size={15} />}
                  loading={save.isPending}
                  disabled={!dirty && !!editRule}
                  onClick={() => void persistTarget().catch(() => undefined)}
                >
                  {editRule ? 'حفظ التغييرات' : 'إنشاء الهدف'}
                </Btn>
              </div>
            </div>
          </div>

          {/* ── الجانب: الجاهزية والمعاينة ── */}
          <aside className="space-y-3 lg:sticky lg:top-0">
            <section className="card p-4">
              <h3 className="mb-2.5 text-[13px] font-bold text-header">جاهزية الهدف</h3>
              <ul className="space-y-1">
                <CheckItem ok={!nameError} label="اسم الهدف" onClick={() => scrollToSection(SECTION_IDS.basics)} />
                <CheckItem ok={assignments.length > 0} label={assignments.length ? `${formatNum(assignments.length)} بائع` : 'اختيار البائعين'} onClick={() => scrollToSection(SECTION_IDS.people)} optional />
                <CheckItem
                  ok={assignments.length > 0 && missingNumbers === 0}
                  label={missingNumbers > 0 ? `${formatNum(missingNumbers)} بائع بلا أرقام` : 'أرقام البائعين'}
                  onClick={() => scrollToSection(SECTION_IDS.people)}
                  optional
                />
                <CheckItem
                  ok={!scopeError}
                  label={trees.length ? `${formatNum(trees.length)} نطاق${scopeProducts ? ` · ${formatNum(scopeProducts)} صنف` : ''}` : 'نطاق الأصناف'}
                  onClick={() => scrollToSection(SECTION_IDS.scope)}
                />
              </ul>
            </section>

            <section className="card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-bold text-header">ما يراه البائع</h3>
                {assignments.length > 1 && (
                  <div className="w-40">
                    <Select
                      value={previewAssignment?.salesmanId ?? ''}
                      onChange={e => setPreviewSalesmanId(Number(e.target.value) || null)}
                      aria-label="معاينة لبائع"
                      className="!h-8 text-[12px]"
                    >
                      {assignments.map(a => (
                        <option key={a.salesmanId} value={a.salesmanId}>{a.salesmanName ?? `#${a.salesmanId}`}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
              <SalesmanPreview
                ruleName={name.trim() || 'هدف جديد'}
                targetType={targetType}
                assignment={previewAssignment}
                sold={previewSold}
                live={!!editRule?.isActive && !!breakdownQ.data}
                loading={breakdownQ.isLoading}
                periodLabel={formatPeriodRange(week.from, week.to)}
                saved={!!editRule}
              />
            </section>
          </aside>
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

function Section({
  id,
  step,
  title,
  subtitle,
  done,
  aside,
  children,
}: {
  id: string;
  step: number;
  title: string;
  subtitle?: string;
  done?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-4 p-4">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <span
          className={`num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
            done ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {done ? <IconCheck size={14} /> : step}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-bold text-header">{title}</h3>
          {subtitle && <p className="text-[12px] text-slate-500">{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function CheckItem({ ok, label, onClick, optional }: { ok: boolean; label: string; onClick: () => void; optional?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-right text-[12.5px] transition hover:bg-slate-50">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
            ok ? 'bg-emerald-500 text-white' : optional ? 'bg-amber-100 ring-1 ring-amber-300' : 'bg-slate-100 ring-1 ring-slate-300'
          }`}
        >
          {ok && <IconCheck size={10} strokeWidth={3} />}
        </span>
        <span className={ok ? 'text-slate-700' : optional ? 'text-amber-800' : 'text-slate-500'}>{label}</span>
        {!ok && !optional && <span className="ms-auto text-[11px] text-red-600">مطلوب</span>}
      </button>
    </li>
  );
}

/** نسخة مبسطة من بطاقة الهدف في تطبيق البائع/المدير: الأسبوعي هو المحور. */
function SalesmanPreview({
  ruleName,
  targetType,
  assignment,
  sold,
  live,
  loading,
  periodLabel,
  saved,
}: {
  ruleName: string;
  targetType: 'quantity' | 'amount';
  assignment: TargetSalesmanAssignmentDto | null;
  sold: number;
  live: boolean;
  loading: boolean;
  periodLabel: string;
  saved: boolean;
}) {
  const unit = targetUnit(targetType);
  if (!assignment) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center">
        <IconTarget size={20} className="text-slate-300" />
        <p className="text-[12px] text-slate-500">اختر بائعاً لترى كيف يظهر له الهدف.</p>
      </div>
    );
  }
  const weekly = assignment.weeklyTarget || 0;
  const pct = weekly > 0 ? (sold / weekly) * 100 : 0;
  const tone = progressTone(pct);
  const remain = Math.max(0, weekly - sold);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-900 p-4 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-400">{targetType === 'amount' ? 'هدف مبيعات' : 'هدف قطع'} · {assignment.salesmanName ?? `#${assignment.salesmanId}`}</p>
            <p className="truncate text-[14px] font-bold">{ruleName}</p>
          </div>
          {weekly > 0 && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${pct >= 100 ? 'bg-emerald-500/20 text-emerald-300' : pct >= 80 ? 'bg-brand-500/20 text-brand-200' : 'bg-white/10 text-slate-200'}`}>
              {tone.label}
            </span>
          )}
        </div>
        {weekly > 0 ? (
          <>
            <p className="mt-3 flex items-baseline gap-1.5">
              <span className="num text-[24px] font-bold leading-none">{loading ? '…' : `${Math.round(pct)}٪`}</span>
              <span className="text-[11.5px] text-slate-400">هذا الأسبوع</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-slate-300">
              <span className="num font-semibold text-white">{formatNum(sold)}</span> من <span className="num">{formatNum(weekly)}</span> {unit}
              {remain > 0 && <> · باقي <span className="num font-semibold text-white">{formatNum(remain)}</span></>}
            </p>
          </>
        ) : (
          <p className="mt-3 text-[12px] text-amber-300">لا رقم أسبوعي — لن يظهر شريط تقدّم.</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {([
          ['يومي', assignment.dailyTarget],
          ['أسبوعي', assignment.weeklyTarget],
          ['شهري', assignment.monthlyTarget],
        ] as const).map(([label, v]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-2 py-2 ring-1 ring-slate-100">
            <p className="num text-[14px] font-bold text-header">{v ? formatNum(v) : '—'}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>


      <p className="text-[11.5px] leading-5 text-slate-500">
        {!saved
          ? 'معاينة — يبدأ احتساب المبيعات بعد إنشاء الهدف.'
          : live
            ? `أرقام حقيقية للأسبوع الحالي (${periodLabel}).`
            : 'الهدف متوقف أو لا بيانات بعد — المعاينة بأرقام صفرية.'}
      </p>
    </div>
  );
}
