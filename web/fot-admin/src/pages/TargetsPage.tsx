import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type { TargetRuleDto } from '@/api/types';
import { Btn } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { IconPlus, IconSearch, IconTarget } from '@/components/icons';
import { TargetEditor } from '@/pages/TargetEditor';

function salesmenLabel(rule: TargetRuleDto) {
  const names = (rule.assignments ?? []).map(a => a.salesmanName).filter(Boolean) as string[];
  if (names.length > 2) return `${names.slice(0, 2).join('، ')} +${names.length - 2}`;
  if (names.length) return names.join('، ');
  return 'بدون بائعين';
}

function assignedCount(rule: TargetRuleDto) {
  return (rule.assignments ?? []).filter(a => a.dailyTarget || a.weeklyTarget || a.monthlyTarget).length;
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

/** إدارة الأهداف فقط — بلا تقارير. التعديل على نفس الصفحة. */
export function TargetsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const rawId = params.get('id');
  const creating = rawId === 'new';
  const editingId = creating ? null : (Number(rawId) || null);
  const editorOpen = creating || editingId != null;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'on' | 'off'>('all');

  const rulesQ = useQuery({ queryKey: ['target-rules'], queryFn: api.targetRules });
  const rules = rulesQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter(r => {
      if (statusFilter === 'on' && !r.isActive) return false;
      if (statusFilter === 'off' && r.isActive) return false;
      if (!q) return true;
      const trees = (r.trees ?? []).map(t => t.treeName ?? '').join(' ');
      const men = (r.assignments ?? []).map(a => a.salesmanName ?? '').join(' ');
      return r.name.toLowerCase().includes(q) || trees.toLowerCase().includes(q) || men.toLowerCase().includes(q);
    });
  }, [rules, search, statusFilter]);

  const activeCount = rules.filter(r => r.isActive).length;

  function setEditor(id: number | 'new' | null) {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('tab');
      if (id == null) next.delete('id');
      else next.set('id', String(id));
      return next;
    }, { replace: true });
  }

  const toggle = useMutation({
    mutationFn: (r: TargetRuleDto) => api.setTargetRuleActive(r.id, !r.isActive),
    onSuccess: async (_, r) => {
      toast.success(r.isActive ? 'توقّف الهدف' : 'فُعّل الهدف');
      await qc.invalidateQueries({ queryKey: ['target-rules'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر التبديل'),
  });

  return (
    <div className="mx-auto w-full max-w-6xl pb-10" dir="rtl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] leading-6 text-slate-500">
            أنشئ هدفاً، حدّد الأصناف والبائعين والأرقام. التقارير لاحقاً في قسم مستقل.
          </p>
          {rules.length > 0 && (
            <p className="mt-1 text-[12px] text-slate-400">
              {formatNum(activeCount)} نشط من {formatNum(rules.length)}
            </p>
          )}
        </div>
        <Btn onClick={() => setEditor('new')}>
          <IconPlus size={15} />
          هدف جديد
        </Btn>
      </header>

      {rules.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <IconSearch size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث باسم الهدف أو البائع…"
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

      {rulesQ.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
          ))}
        </div>
      )}

      {!rulesQ.isLoading && filtered.length === 0 && (
        <EmptyTargets hasAny={rules.length > 0} onCreate={() => setEditor('new')} />
      )}

      {!rulesQ.isLoading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(rule => (
            <TargetCard
              key={rule.id}
              rule={rule}
              busy={toggle.isPending && toggle.variables?.id === rule.id}
              onOpen={() => setEditor(rule.id)}
              onToggle={() => toggle.mutate(rule)}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <TargetEditor
          key={creating ? 'new' : editingId}
          ruleId={editingId}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function EmptyTargets({ hasAny, onCreate }: { hasAny: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <IconTarget size={26} />
      </span>
      <h2 className="text-[18px] font-extrabold text-header">
        {hasAny ? 'لا نتائج لهذا البحث' : 'لا أهداف بعد'}
      </h2>
      <p className="mt-2 max-w-sm text-[13.5px] leading-6 text-slate-500">
        {hasAny
          ? 'جرّب اسماً آخر أو اعرض كل الأهداف.'
          : 'الهدف يربط أصنافاً ببائعين وأرقام يومية وأسبوعية وشهرية. أنشئ واحداً ثم أضف النطاق.'}
      </p>
      {!hasAny && (
        <Btn className="mt-6" onClick={onCreate}>
          <IconPlus size={15} />
          هدف جديد
        </Btn>
      )}
    </div>
  );
}

function TargetCard({
  rule,
  busy,
  onOpen,
  onToggle,
}: {
  rule: TargetRuleDto;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const qty = assignedCount(rule);
  const totals = typicalTargets(rule);
  const unit = rule.targetType === 'amount' ? 'د.ع' : 'قطعة';
  const hero = totals
    ? (totals.weekly || totals.daily || totals.monthly || 0)
    : 0;
  const heroKind = totals?.weekly ? 'أسبوعي' : totals?.daily ? 'يومي' : totals?.monthly ? 'شهري' : '';

  return (
    <article
      className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${
        rule.isActive ? 'ring-slate-200 hover:ring-brand-200' : 'ring-slate-200 opacity-80'
      }`}
    >
      <div className="h-1.5 w-full bg-brand-500" />
      <button type="button" onClick={onOpen} className="block w-full p-5 text-right">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="truncate text-[16px] font-extrabold text-header">{rule.name}</h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              rule.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {rule.isActive ? 'نشط' : 'متوقف'}
          </span>
        </div>
        <p className="text-[28px] font-extrabold leading-none tabular-nums tracking-tight text-header">
          {hero > 0 ? formatNum(hero) : '—'}
        </p>
        <p className="mt-1.5 text-[12.5px] text-slate-500">
          {rule.targetType === 'amount' ? 'مبلغ' : 'كمية'}
          {hero > 0 ? ` · ${heroKind} ${unit}` : ''}
          {totals?.mixed ? ' · أرقام مختلفة للبائعين' : ''}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-500">
          <span>{formatNum(rule.trees?.length ?? 0)} شجرة</span>
          <span className="text-slate-300">·</span>
          <span>{formatNum(qty)} بائع بأرقام</span>
          <span className="text-slate-300">·</span>
          <span className="truncate">{salesmenLabel(rule)}</span>
        </div>
        {totals && (
          <p className="mt-2 text-[11.5px] tabular-nums text-slate-400">
            يومي {formatNum(totals.daily)} · أسبوعي {formatNum(totals.weekly)} · شهري {formatNum(totals.monthly)}
          </p>
        )}
      </button>
      <footer className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <Btn size="sm" className="flex-1" onClick={onOpen}>تعديل</Btn>
        <Btn size="sm" variant="secondary" loading={busy} onClick={onToggle}>
          {rule.isActive ? 'إيقاف' : 'تفعيل'}
        </Btn>
      </footer>
    </article>
  );
}
