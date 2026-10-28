import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { TargetBreakdownDto, TargetRuleDto } from '@/api/types';
import { Alert, Badge, Btn, EmptyState, IconButton, Input, Kbd, Select, Skeleton, TableSkeleton, useConfirm } from '@/components/ui';
import { useToast } from '@/components/Toast';
import {
  IconCalendar,
  IconChart,
  IconCopy,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTarget,
  IconTrash,
  IconX,
} from '@/components/icons';
import { DataGrid, type GridColumn, type GridSort } from '@/components/grid/DataGrid';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
} from '@/components/listWorkspace';
import { TargetEditor } from '@/pages/TargetEditor';
import {
  IconPause,
  IconPlay,
  ProgressBar,
  isTypingTarget,
  progressTone,
  readPref,
  writePref,
} from '@/components/incentives/kit';
import { ruleWeekProgress, targetUnit, type RuleProgress } from '@/components/incentives/targetMath';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange } from '@/lib/businessPeriod';

function assignedNames(rule: TargetRuleDto) {
  return (rule.assignments ?? []).map(a => a.salesmanName ?? `#${a.salesmanId}`);
}

function typicalTargets(rule: TargetRuleDto) {
  const rows = (rule.assignments ?? []).filter(a => a.dailyTarget || a.weeklyTarget || a.monthlyTarget);
  if (!rows.length) return null;
  const first = rows[0]!;
  return {
    daily: first.dailyTarget,
    weekly: first.weeklyTarget,
    monthly: first.monthlyTarget,
    mixed: rows.some(r =>
      r.dailyTarget !== first.dailyTarget
      || r.weeklyTarget !== first.weeklyTarget
      || r.monthlyTarget !== first.monthlyTarget),
  };
}

function ruleKind(r: TargetRuleDto): 'quantity' | 'amount' {
  return r.targetType === 'amount' ? 'amount' : 'quantity';
}

type StatusFilter = 'all' | 'on' | 'off';
type TypeFilter = 'all' | 'quantity' | 'amount';
type SortKey = 'progress' | 'name' | 'newest';
const SORT_KEY = 'fot.targets.sort';

/** إدارة الأهداف — جدول بعرض الشاشة مع تقدّم الأسبوع الحالي. التعديل في محرر كامل (?id=). */
export function TargetsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const rawId = params.get('id');
  const creating = rawId === 'new';
  const editingId = creating ? null : (Number(rawId) || null);
  const editorOpen = creating || editingId != null;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortKey>(() => readPref(SORT_KEY, ['progress', 'name', 'newest'] as const, 'progress'));
  // فرز رأس الجدول محكوم من الصفحة — تغيير قائمة «الترتيب» يلغيه حتى لا يطغى عليها فرز محفوظ
  const [gridSort, setGridSort] = useState<GridSort | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => writePref(SORT_KEY, sort), [sort]);

  const rulesQ = useQuery({ queryKey: ['target-rules'], queryFn: api.targetRules });
  // تقدّم الأسبوع الحالي لكل الأهداف النشطة (الفترة الافتراضية في الخادم)
  const bp = useBusinessPeriod();
  const week = bp.periods.currentWeek;
  const weekQ = useQuery({
    queryKey: ['target-breakdowns', week.from, week.to],
    queryFn: () => api.targetBreakdowns(week.from, week.to),
    enabled: !bp.isLoading,
    staleTime: 60_000,
  });
  const rules = useMemo(() => rulesQ.data ?? [], [rulesQ.data]);

  const breakdownById = useMemo(() => {
    const m = new Map<number, TargetBreakdownDto>();
    const list = Array.isArray(weekQ.data) ? weekQ.data : [];
    for (const b of list) m.set(b.ruleId, b);
    return m;
  }, [weekQ.data]);

  const progressById = useMemo(() => {
    const m = new Map<number, RuleProgress | null>();
    for (const r of rules) m.set(r.id, ruleWeekProgress(r, breakdownById.get(r.id)));
    return m;
  }, [rules, breakdownById]);

  const period = formatPeriodRange(week.from, week.to);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editorOpen || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ى') {
        e.preventDefault();
        setEditor('new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // عدّادات الحالة تتبع فلتر النوع، وعدّادات النوع تتبع فلتر الحالة
  const counts = useMemo(() => {
    const base = rules.filter(r => typeFilter === 'all' || ruleKind(r) === typeFilter);
    return {
      all: base.length,
      on: base.filter(r => r.isActive).length,
      off: base.filter(r => !r.isActive).length,
    };
  }, [rules, typeFilter]);

  const typeCounts = useMemo(() => {
    const base = rules.filter(r => (statusFilter === 'all' ? true : statusFilter === 'on' ? r.isActive : !r.isActive));
    return {
      all: base.length,
      quantity: base.filter(r => ruleKind(r) === 'quantity').length,
      amount: base.filter(r => ruleKind(r) === 'amount').length,
    };
  }, [rules, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rules.filter(r => {
      if (statusFilter === 'on' && !r.isActive) return false;
      if (statusFilter === 'off' && r.isActive) return false;
      if (typeFilter !== 'all' && ruleKind(r) !== typeFilter) return false;
      if (!q) return true;
      const trees = (r.trees ?? []).map(t => t.treeName ?? '').join(' ');
      const men = (r.assignments ?? []).map(a => a.salesmanName ?? '').join(' ');
      return r.name.toLowerCase().includes(q) || trees.toLowerCase().includes(q) || men.toLowerCase().includes(q);
    });
    const sorted = list.slice();
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    else if (sort === 'newest') sorted.sort((a, b) => b.id - a.id);
    else {
      sorted.sort((a, b) =>
        Number(b.isActive) - Number(a.isActive)
        || (progressById.get(b.id)?.pct ?? -1) - (progressById.get(a.id)?.pct ?? -1));
    }
    return sorted;
  }, [rules, search, statusFilter, typeFilter, sort, progressById]);

  const kpi = useMemo(() => {
    const salesmen = new Set<number>();
    let assigned = 0;
    let reached = 0;
    let pctSum = 0;
    let pctN = 0;
    let noNumbers = 0;
    for (const r of rules) {
      if (!r.isActive) continue;
      if (!typicalTargets(r)) noNumbers++;
      for (const a of r.assignments ?? []) if (a.dailyTarget || a.weeklyTarget || a.monthlyTarget) salesmen.add(a.salesmanId);
      const p = progressById.get(r.id);
      if (p && p.target > 0) {
        assigned += p.assigned;
        reached += p.reached;
        pctSum += p.pct;
        pctN++;
      }
    }
    return { salesmen: salesmen.size, assigned, reached, avg: pctN ? pctSum / pctN : 0, hasAvg: pctN > 0, noNumbers };
  }, [rules, progressById]);

  const filtersActive = !!search.trim() || statusFilter !== 'all' || typeFilter !== 'all';

  function resetFilters() {
    setSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
  }

  function setEditor(id: number | 'new' | null) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('tab');
      if (id == null) next.delete('id');
      else next.set('id', String(id));
      return next;
    }, { replace: true });
  }

  async function invalidateAll() {
    await qc.invalidateQueries({ queryKey: ['target-rules'] });
    await qc.invalidateQueries({ queryKey: ['target-breakdowns'] });
  }

  const toggle = useMutation({
    mutationFn: (r: TargetRuleDto) => api.setTargetRuleActive(r.id, !r.isActive),
    onSuccess: async (_, r) => {
      toast.success(r.isActive ? `توقّف «${r.name}»` : `فُعّل «${r.name}»`);
      await invalidateAll();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  const remove = useMutation({
    mutationFn: (r: TargetRuleDto) => api.deleteTargetRule(r.id),
    onSuccess: async (_, r) => {
      toast.success(`حُذف «${r.name}»`);
      await invalidateAll();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحذف'),
  });

  const duplicate = useMutation({
    mutationFn: async (r: TargetRuleDto) => {
      const created = await api.createTargetRule({
        name: `${r.name} نسخة`,
        targetType: r.targetType,
        trees: r.trees ?? [],
        assignments: r.assignments ?? [],
        excludedArticleIds: r.excludedArticleIds ?? [],
      });
      // النسخة تُنشأ نشطة في الخادم — توقف فوراً حتى تُراجع
      let stopped = true;
      try {
        await api.setTargetRuleActive(created.id, false);
      } catch {
        stopped = false;
      }
      return { id: created.id, stopped };
    },
    onSuccess: async ({ id, stopped }) => {
      if (stopped) toast.success('أُنشئت نسخة من الهدف — متوقفة حتى تراجعها وتفعّلها');
      else toast.error('أُنشئت النسخة لكن تعذر إيقافها — راجعها أو أوقفها يدوياً');
      await invalidateAll();
      setEditor(id);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التكرار'),
  });

  async function askDuplicate(r: TargetRuleDto) {
    const ok = await confirm({
      title: `تكرار «${r.name}»؟`,
      message: 'تُنشأ نسخة بنفس النطاق والبائعين والأرقام، وتبقى متوقفة حتى تراجعها وتفعّلها.',
      confirmLabel: 'تكرار',
    });
    if (ok) duplicate.mutate(r);
  }

  async function askToggle(r: TargetRuleDto) {
    if (r.isActive) {
      const ok = await confirm({
        title: `إيقاف «${r.name}»؟`,
        message: 'يختفي الهدف من شاشة البائعين ولا يُتابع تقدّمه حتى تُفعّله مرة أخرى.',
        confirmLabel: 'إيقاف',
        danger: true,
      });
      if (!ok) return;
    }
    toggle.mutate(r);
  }

  async function askDelete(r: TargetRuleDto) {
    const ok = await confirm({
      title: `حذف «${r.name}» نهائياً؟`,
      message: 'يُحذف الهدف مع أرقام البائعين. لإخفائه مؤقتاً استخدم «إيقاف».',
      confirmLabel: 'حذف نهائي',
      danger: true,
    });
    if (ok) remove.mutate(r);
  }

  const busyId = [toggle, remove, duplicate].find(m => m.isPending)?.variables?.id;
  const progressLoading = weekQ.isPending;

  // بلا useMemo: الأعمدة تستدعي setParams ويجب أن تبقى حديثة
  const columns: GridColumn<TargetRuleDto>[] = [
    {
      key: 'name',
      header: 'الهدف',
      width: 230,
      sortValue: r => r.name,
      filterValue: r => r.name,
      render: r => (
        <span className="block truncate font-semibold text-header" title={r.name}>{r.name}</span>
      ),
    },
    {
      key: 'isActive',
      header: 'الحالة',
      width: 90,
      sortValue: r => (r.isActive ? 1 : 0),
      filterValue: r => (r.isActive ? 'نشط' : 'متوقف'),
      exportValue: r => (r.isActive ? 'نشط' : 'متوقف'),
      render: r => <Badge tone={r.isActive ? 'ok' : 'default'} dot>{r.isActive ? 'نشط' : 'متوقف'}</Badge>,
    },
    {
      key: 'targetType',
      header: 'النوع',
      width: 80,
      sortValue: r => ruleKind(r),
      filterValue: r => (ruleKind(r) === 'amount' ? 'مبلغ' : 'كمية'),
      render: r => <Badge tone={ruleKind(r) === 'amount' ? 'violet' : 'info'}>{ruleKind(r) === 'amount' ? 'مبلغ' : 'كمية'}</Badge>,
    },
    {
      key: 'progress',
      header: 'تقدّم الأسبوع',
      width: 260,
      sortValue: r => (r.isActive ? progressById.get(r.id)?.pct ?? -1 : -2),
      filterValue: r => {
        const p = progressById.get(r.id);
        return p && p.target > 0 ? `${Math.round(p.pct)}` : '';
      },
      exportValue: r => {
        if (!r.isActive) return 'متوقف — لا متابعة';
        const p = progressById.get(r.id);
        if (!p) return 'لا بيانات بعد';
        const unit = targetUnit(r.targetType);
        if (p.target <= 0) return `بلا رقم أسبوعي · مبيع ${formatNum(p.totalSold)} ${unit}`;
        return `${Math.round(p.pct)}٪ — ${formatNum(p.achieved)}/${formatNum(p.target)} ${unit}`;
      },
      render: r => <WeekProgressCell rule={r} progress={progressById.get(r.id) ?? null} loading={progressLoading} />,
    },
    {
      key: 'reached',
      header: 'حققوا',
      width: 90,
      align: 'center',
      sortValue: r => progressById.get(r.id)?.reached ?? -1,
      filterValue: r => {
        const p = progressById.get(r.id);
        return p ? `${p.reached}/${p.assigned}` : '';
      },
      exportValue: r => {
        const p = progressById.get(r.id);
        return !r.isActive || !p || p.target <= 0 ? '—' : `${formatNum(p.reached)} / ${formatNum(p.assigned)}`;
      },
      render: r => {
        const p = progressById.get(r.id);
        if (!r.isActive || !p || p.target <= 0) return <span className="text-slate-300">—</span>;
        return (
          <span className="num text-[12px]">
            <span className={`font-bold ${p.reached > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{formatNum(p.reached)}</span>
            <span className="text-slate-400"> / {formatNum(p.assigned)}</span>
          </span>
        );
      },
    },
    {
      key: 'top',
      header: 'الأعلى هذا الأسبوع',
      width: 170,
      sortValue: r => progressById.get(r.id)?.top?.pct ?? -1,
      filterValue: r => progressById.get(r.id)?.top?.name ?? '',
      exportValue: r => {
        const top = r.isActive ? progressById.get(r.id)?.top : null;
        return top ? `${top.name} (${Math.round(top.pct)}٪)` : '—';
      },
      render: r => {
        const top = r.isActive ? progressById.get(r.id)?.top : null;
        if (!top) return <span className="text-slate-300">—</span>;
        return (
          <span className="block truncate text-[12px] text-slate-600" title={`${top.name} — ${Math.round(top.pct)}٪`}>
            {top.name} <span className="num text-slate-400">({Math.round(top.pct)}٪)</span>
          </span>
        );
      },
    },
    {
      key: 'targets',
      header: 'الأرقام (يومي · أسبوعي · شهري)',
      width: 230,
      sortValue: r => typicalTargets(r)?.weekly ?? -1,
      filterValue: r => {
        const t = typicalTargets(r);
        return t ? `${t.daily} ${t.weekly} ${t.monthly}` : 'بلا أرقام';
      },
      exportValue: r => {
        const t = typicalTargets(r);
        if (!t) return 'بلا أرقام';
        return `${formatNum(t.daily)} · ${formatNum(t.weekly)} · ${formatNum(t.monthly)} ${targetUnit(r.targetType)}${t.mixed ? ' · مختلفة' : ''}`;
      },
      render: r => {
        const t = typicalTargets(r);
        if (!t) return <Badge tone="warn">بلا أرقام</Badge>;
        return (
          <span className="num text-[12px] text-slate-600">
            {formatNum(t.daily)} · {formatNum(t.weekly)} · {formatNum(t.monthly)}
            <span className="ms-1 text-slate-400">{targetUnit(r.targetType)}</span>
            {t.mixed && <span className="ms-1 text-amber-700" title="أرقام البائعين ليست متساوية — المعروض أرقام أول بائع">· مختلفة</span>}
          </span>
        );
      },
    },
    {
      key: 'salesmen',
      header: 'البائعون',
      width: 200,
      sortValue: r => (r.assignments ?? []).length,
      filterValue: r => assignedNames(r).join(' '),
      exportValue: r => {
        const names = assignedNames(r);
        return names.length ? names.join('، ') : 'لم يُحدد بائعون';
      },
      render: r => {
        const names = assignedNames(r);
        if (!names.length) return <span className="text-[12px] text-amber-700">لم يُحدد بائعون</span>;
        return (
          <span className="block truncate text-[12px] text-slate-600" title={names.join('، ')}>
            <span className="num me-1 font-semibold text-header">{formatNum(names.length)}</span>
            {names.length > 2 ? `${names.slice(0, 2).join('، ')} +${formatNum(names.length - 2)}` : names.join('، ')}
          </span>
        );
      },
    },
    {
      key: 'scope',
      header: 'النطاق',
      width: 120,
      sortValue: r => r.trees?.length ?? 0,
      filterValue: r => (r.trees ?? []).map(t => t.treeName ?? '').join(' '),
      exportValue: r => {
        const excluded = r.excludedArticleIds?.length ?? 0;
        return `${formatNum(r.trees?.length ?? 0)} نطاق${excluded > 0 ? ` (−${formatNum(excluded)})` : ''}`;
      },
      render: r => {
        const treeCount = r.trees?.length ?? 0;
        const excluded = r.excludedArticleIds?.length ?? 0;
        const treeNames = (r.trees ?? []).map(t => t.treeName ?? '').filter(Boolean).join('، ');
        return (
          <span className="text-[12px] text-slate-600" title={treeNames || undefined}>
            <span className="num">{formatNum(treeCount)}</span> نطاق
            {excluded > 0 && <span className="text-slate-400"> (−<span className="num">{formatNum(excluded)}</span>)</span>}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 140,
      align: 'center',
      pinned: 'end',
      sortable: false,
      exportable: false,
      render: r => {
        const busy = busyId === r.id;
        const small = '!h-7 !w-7';
        return (
          <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
            <IconButton label="تعديل" className={small} onClick={() => setEditor(r.id)}><IconPencil size={14} /></IconButton>
            <IconButton label="تكرار" className={small} disabled={busy} onClick={() => void askDuplicate(r)}><IconCopy size={14} /></IconButton>
            <IconButton label={r.isActive ? 'إيقاف' : 'تفعيل'} className={small} disabled={busy} onClick={() => void askToggle(r)}>
              {r.isActive ? <IconPause size={13} /> : <IconPlay size={13} />}
            </IconButton>
            <IconButton
              label="حذف"
              className={`${small} hover:!border-red-200 hover:!bg-red-50 hover:!text-red-600`}
              disabled={busy}
              onClick={() => void askDelete(r)}
            >
              <IconTrash size={14} />
            </IconButton>
          </div>
        );
      },
    },
  ];

  return (
    <WorkspacePage>
      <WorkspaceCard>
        {/* ── الفلاتر ── */}
        <FilterBar
          footer={
            <>
              <SegmentedFilter<StatusFilter>
                label="الحالة"
                value={statusFilter}
                onChange={setStatusFilter}
                items={[
                  { id: 'all', label: 'كل الحالات', count: counts.all },
                  { id: 'on', label: 'نشطة', count: counts.on },
                  { id: 'off', label: 'متوقفة', count: counts.off },
                ]}
              />
              <SegmentedFilter<TypeFilter>
                label="نوع الهدف"
                value={typeFilter}
                onChange={setTypeFilter}
                items={[
                  { id: 'all', label: 'كل الأنواع', count: typeCounts.all },
                  { id: 'quantity', label: 'كمية (قطع)', count: typeCounts.quantity },
                  { id: 'amount', label: 'مبلغ (IQD)', count: typeCounts.amount },
                ]}
              />
              {filtersActive && (
                <button type="button" onClick={resetFilters} className="text-[12px] font-semibold text-brand-700 hover:underline">
                  مسح التصفية
                </button>
              )}
              <span className="ms-auto inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
                <IconCalendar size={13} className="text-slate-400" />
                التقدّم عن الأسبوع الحالي{period ? `: ${period}` : ''}
              </span>
            </>
          }
        >
          <FilterLabel label="بحث" grow>
            <div className="relative">
              <IconSearch size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape' && search) {
                    e.stopPropagation();
                    setSearch('');
                  }
                }}
                placeholder="اسم الهدف أو البائع أو الشجرة…"
                className="!ps-9 !pe-9"
                aria-label="بحث في الأهداف"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="مسح البحث"
                >
                  <IconX size={14} />
                </button>
              ) : (
                <span className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>/</Kbd></span>
              )}
            </div>
          </FilterLabel>
          <FilterLabel label="الترتيب">
            <Select
              value={gridSort ? '__grid' : sort}
              onChange={e => {
                if (e.target.value === '__grid') return;
                setSort(e.target.value as SortKey);
                setGridSort(null);
              }}
              aria-label="الترتيب"
            >
              {gridSort && <option value="__grid" disabled>حسب عمود الجدول</option>}
              <option value="progress">الإنجاز (الأعلى أولاً)</option>
              <option value="name">الاسم</option>
              <option value="newest">الأحدث</option>
            </Select>
          </FilterLabel>
          <FilterActions>
            <Link to="/reports?app=targets">
              <Btn variant="secondary" icon={<IconChart size={15} />} title="تقرير الأهداف المفصل لكل بائع">
                تقرير الأهداف
              </Btn>
            </Link>
            <IconButton label="تحديث" onClick={() => void invalidateAll()}>
              <IconRefresh size={15} className={rulesQ.isFetching || weekQ.isFetching ? 'animate-spin' : ''} />
            </IconButton>
            <Btn icon={<IconPlus size={15} />} onClick={() => setEditor('new')} title="هدف جديد (N)">
              هدف جديد
            </Btn>
          </FilterActions>
        </FilterBar>

        {/* ── شريط المجاميع ── */}
        <SummaryStrip
          loading={rulesQ.isLoading}
          cells={[
            {
              label: 'الأهداف النشطة',
              value: formatNum(rules.filter(r => r.isActive).length),
              hint: `من ${formatNum(rules.length)} هدف`,
              tone: 'brand',
              onClick: () => setStatusFilter(statusFilter === 'on' ? 'all' : 'on'),
              active: statusFilter === 'on',
            },
            {
              label: 'متوقفة',
              value: formatNum(rules.filter(r => !r.isActive).length),
              hint: 'لا يُتابع تقدّمها',
              onClick: () => setStatusFilter(statusFilter === 'off' ? 'all' : 'off'),
              active: statusFilter === 'off',
            },
            {
              label: 'بائعون لهم أرقام',
              value: formatNum(kpi.salesmen),
              hint: 'في الأهداف النشطة',
            },
            {
              label: 'متوسط الإنجاز الأسبوعي',
              value: progressLoading ? '…' : kpi.hasAvg ? `${Math.round(kpi.avg)}٪` : '—',
              hint: period ? `أسبوع ${period}` : 'الأسبوع الحالي',
              tone: kpi.hasAvg ? (kpi.avg >= 100 ? 'ok' : kpi.avg >= 40 ? 'brand' : 'warn') : undefined,
            },
            {
              label: 'حققوا هدف الأسبوع',
              value: progressLoading ? '…' : kpi.assigned ? `${formatNum(kpi.reached)} / ${formatNum(kpi.assigned)}` : '—',
              hint: 'بائع × هدف',
              tone: kpi.reached > 0 ? 'ok' : undefined,
            },
            {
              label: 'نشطة بلا أرقام',
              value: formatNum(kpi.noNumbers),
              hint: kpi.noNumbers ? 'أضف أرقام البائعين' : 'كل الأهداف لها أرقام',
              tone: kpi.noNumbers ? 'warn' : undefined,
            },
          ]}
        />

        {rulesQ.isError && (
          <div className="shrink-0 p-2">
            <Alert title="تعذر تحميل الأهداف">
              <div className="flex flex-wrap items-center gap-2">
                {rulesQ.error instanceof Error ? rulesQ.error.message : 'خطأ غير معروف'}
                <Btn size="xs" variant="secondary" icon={<IconRefresh size={13} />} onClick={() => rulesQ.refetch()}>إعادة المحاولة</Btn>
              </div>
            </Alert>
          </div>
        )}
        {weekQ.isError && !rulesQ.isError && (
          <div className="shrink-0 p-2">
            <Alert type="warning" title="تعذر تحميل تقدّم الأسبوع">
              القائمة تعمل، لكن أشرطة التقدّم غير متاحة الآن.
              <Btn size="xs" variant="secondary" className="ms-2" onClick={() => weekQ.refetch()}>إعادة المحاولة</Btn>
            </Alert>
          </div>
        )}

        {/* ── الجدول ── */}
        <WorkspaceBody>
          {rulesQ.isLoading ? (
            <TableSkeleton rows={10} cols={8} />
          ) : rulesQ.isError && rules.length === 0 ? null : filtered.length === 0 ? (
            rules.length > 0 ? (
              <EmptyState
                compact
                icon={<IconSearch size={18} />}
                title="لا أهداف تطابق التصفية"
                description="جرّب كلمة أخرى أو اعرض كل الأهداف."
                action={<Btn size="sm" variant="secondary" onClick={resetFilters}>مسح التصفية</Btn>}
              />
            ) : (
              <EmptyState
                icon={<IconTarget size={24} />}
                title="لا أهداف بعد"
                description="الهدف يربط أصنافاً ببائعين وأرقام يومية وأسبوعية وشهرية، ويظهر تقدّمه للبائع أثناء الأسبوع."
                action={<Btn icon={<IconPlus size={15} />} onClick={() => setEditor('new')}>هدف جديد</Btn>}
              />
            )
          ) : (
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              dense
              columns={columns}
              rows={filtered}
              getRowId={r => r.id}
              exportName="الأهداف"
              counterLabel="هدف"
              badge={filtersActive ? (
                <span className="text-[11px] text-slate-400">من أصل <span className="num">{formatNum(rules.length)}</span></span>
              ) : (
                <span className="hidden text-[11px] text-slate-400 md:inline">نقرة مزدوجة أو Enter لفتح الهدف · ↑↓ للتنقل · N هدف جديد</span>
              )}
              emptyText="لا أهداف تطابق فلتر الأعمدة"
              storageKey="targets-list"
              sort={gridSort}
              onSortChange={setGridSort}
              rowTone={r => (busyId === r.id ? 'opacity-60' : r.isActive ? undefined : 'bg-slate-50/90 text-slate-500')}
              selectedId={selectedId ?? undefined}
              onSelect={r => setSelectedId(r.id)}
              onRowDoubleClick={r => setEditor(r.id)}
              onEnter={r => setEditor(r.id)}
            />
          )}
        </WorkspaceBody>
      </WorkspaceCard>

      {editorOpen && (
        <TargetEditor
          key={creating ? 'new' : editingId}
          ruleId={editingId}
          onClose={() => setEditor(null)}
        />
      )}
    </WorkspacePage>
  );
}

/** خلية تقدّم الأسبوع — سطر واحد: شريط + نسبة + المحقق من الهدف. */
function WeekProgressCell({ rule, progress, loading }: { rule: TargetRuleDto; progress: RuleProgress | null; loading: boolean }) {
  if (!rule.isActive) return <span className="text-[12px] text-slate-400">متوقف — لا متابعة</span>;
  if (loading) return <Skeleton className="h-2 w-full" />;
  if (!progress) return <span className="text-[12px] text-slate-400">لا بيانات بعد</span>;
  const unit = targetUnit(rule.targetType);
  if (progress.target <= 0) {
    return (
      <span className="text-[12px] text-slate-500" title="لا رقم أسبوعي محدد">
        بلا رقم أسبوعي · مبيع <span className="num font-semibold text-header">{formatNum(progress.totalSold)}</span> {unit}
      </span>
    );
  }
  const tone = progressTone(progress.pct);
  return (
    <div
      className="flex min-w-0 items-center gap-2"
      title={`${formatNum(progress.achieved)} من ${formatNum(progress.target)} ${unit} — ${tone.label}`}
    >
      <ProgressBar value={progress.pct} thin className="min-w-[60px] flex-1" />
      <span className={`num w-10 shrink-0 text-end text-[12px] font-bold ${tone.text}`}>{Math.round(progress.pct)}٪</span>
      <span className="num shrink-0 text-[11px] text-slate-500">
        {formatNum(progress.achieved)}<span className="text-slate-400">/{formatNum(progress.target)}</span>
      </span>
    </div>
  );
}
