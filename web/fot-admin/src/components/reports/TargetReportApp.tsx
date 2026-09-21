import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import type { SalesmanDto, TargetBreakdownDto, TargetRuleDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, Input } from '@/components/ui';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { IconSliders, IconTarget } from '@/components/icons';
import { ProgressCell } from '@/components/workspace';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange } from '@/lib/businessPeriod';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';

const PIN_KEY = 'fot_report_targets_pinned';

type PeriodId = 'week' | 'lastWeek' | 'month' | 'custom';
type CompareMode = 'daily' | 'weekly' | 'monthly';

function loadPinned(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map(Number).filter(n => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function savePinned(ids: number[]) {
  localStorage.setItem(PIN_KEY, JSON.stringify(ids));
}

function modeFromPeriod(period: PeriodId, from: string, to: string): CompareMode {
  if (period === 'month') return 'monthly';
  if (period === 'week' || period === 'lastWeek') return 'weekly';
  if (from && to && from === to) return 'daily';
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  const days = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) + 1 : 7;
  return days <= 8 ? 'weekly' : 'monthly';
}

const MODE_LABEL: Record<CompareMode, string> = {
  daily: 'يومي',
  weekly: 'أسبوعي',
  monthly: 'شهري',
};

type Row = {
  id: string;
  sortIndex: number;
  salesmanId: number;
  salesmanName: string;
  ruleId: number;
  targetName: string;
  isAmount: boolean;
  sold: number;
  goal: number;
  remain: number;
  percent: number;
  hit: boolean;
};

function pickGoal(mode: CompareMode, daily: number, weekly: number, monthly: number) {
  if (mode === 'daily') return daily;
  if (mode === 'weekly') return weekly;
  return monthly;
}

function columns(mode: CompareMode): GridColumn<Row>[] {
  return [
    { key: 'sortIndex', header: '#', width: 52, align: 'center', mono: true, render: r => r.sortIndex },
    {
      key: 'salesmanName',
      header: 'البائع',
      width: 180,
      render: r => <span className="font-semibold text-header">{r.salesmanName}</span>,
    },
    {
      key: 'targetName',
      header: 'الهدف',
      width: 220,
      render: r => (
        <span className="font-semibold text-slate-800">
          {r.targetName || '—'}
        </span>
      ),
    },
    {
      key: 'sold',
      header: 'المتحقق',
      width: 130,
      mono: true,
      footer: 'sum',
      render: r => (
        <span className="font-extrabold text-brand-800">
          {formatNum(r.sold)}{r.isAmount ? ' د.ع' : ''}
        </span>
      ),
    },
    {
      key: 'goal',
      header: `المطلوب (${MODE_LABEL[mode]})`,
      width: 150,
      mono: true,
      render: r => (r.goal > 0 ? `${formatNum(r.goal)}${r.isAmount ? ' د.ع' : ''}` : '—'),
    },
    {
      key: 'remain',
      header: 'المتبقي',
      width: 130,
      mono: true,
      render: r => {
        if (r.goal <= 0) return <span className="text-slate-400">—</span>;
        if (r.hit) return <span className="font-bold text-emerald-700">تم</span>;
        return `${formatNum(r.remain)}${r.isAmount ? ' د.ع' : ''}`;
      },
    },
    {
      key: 'percent',
      header: 'التقدم',
      width: 180,
      sortable: false,
      render: r => (r.goal > 0 ? <ProgressCell percent={Math.min(100, Math.max(0, r.percent))} tone={r.hit ? 'ok' : 'brand'} /> : '—'),
    },
  ];
}

export function TargetReportApp({ onClose }: { onClose: () => void }) {
  const { periods } = useBusinessPeriod();
  const [period, setPeriod] = useState<PeriodId>('week');
  const [customFrom, setCustomFrom] = useState(periods.currentWeek.from);
  const [customTo, setCustomTo] = useState(periods.currentWeek.to);
  const [pinned, setPinned] = useState<number[]>(loadPinned);
  const [settingsOpen, setSettingsOpen] = useState(pinned.length === 0);

  const range = useMemo(() => {
    if (period === 'week') return periods.currentWeek;
    if (period === 'lastWeek') return periods.previousWeek;
    if (period === 'month') return periods.currentMonth;
    return { from: customFrom, to: customTo };
  }, [period, periods, customFrom, customTo]);

  const mode = modeFromPeriod(period, range.from, range.to);

  const salesmenQ = useQuery({
    queryKey: ['salesmen', true],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });
  const salesmen = salesmenQ.data?.items ?? [];

  const rulesQ = useQuery({ queryKey: ['target-rules'], queryFn: api.targetRules });
  const breakdownsQ = useQuery({
    queryKey: ['target-breakdowns', range.from, range.to],
    queryFn: () => api.targetBreakdowns(range.from, range.to),
    enabled: pinned.length > 0 && !!range.from && !!range.to,
  });

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of salesmen) map.set(s.id, fixEdariName(s.name) || `#${s.id}`);
    return map;
  }, [salesmen]);

  const rows = useMemo(
    () => buildRows(pinned, nameById, rulesQ.data ?? [], breakdownsQ.data ?? [], mode),
    [pinned, nameById, rulesQ.data, breakdownsQ.data, mode],
  );

  const hitCount = rows.filter(r => r.hit).length;
  const withGoal = rows.filter(r => r.goal > 0).length;

  function updatePinned(ids: number[]) {
    setPinned(ids);
    savePinned(ids);
  }

  const periodBtns: { id: PeriodId; label: string }[] = [
    { id: 'week', label: 'هذا الأسبوع' },
    { id: 'lastWeek', label: 'الأسبوع الماضي' },
    { id: 'month', label: 'هذا الشهر' },
    { id: 'custom', label: 'تاريخ' },
  ];

  return (
    <ReportAppWindow
      title="تقرير الأهداف"
      subtitle={`${formatPeriodRange(range.from, range.to)} · مقارنة ${MODE_LABEL[mode]} · ${formatNum(pinned.length)} بائع مثبت`}
      icon={<IconTarget size={20} />}
      accent="linear-gradient(135deg, #f59e0b 0%, #c2410c 100%)"
      actions={
        <button
          type="button"
          onClick={() => setSettingsOpen(v => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-bold transition ${
            settingsOpen ? 'bg-white text-orange-800' : 'bg-white/15 text-white hover:bg-white/25'
          }`}
        >
          <IconSliders size={14} />
          إعداد البائعين
        </button>
      }
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1">
        {settingsOpen && (
          <PinSettings
            salesmen={salesmen}
            pinned={pinned}
            onChange={updatePinned}
            onDone={() => setSettingsOpen(false)}
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap rounded-xl border border-slate-200 bg-slate-50 p-0.5">
              {periodBtns.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setPeriod(b.id)}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                    period === b.id ? 'bg-header text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="!py-1.5" />
                <span className="text-[12px] text-slate-400">→</span>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="!py-1.5" />
              </div>
            )}
            <div className="ms-auto text-[12.5px] font-semibold text-slate-500">
              {withGoal ? `${formatNum(hitCount)} / ${formatNum(withGoal)} محققة` : '—'}
            </div>
          </div>

          {pinned.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[16px] font-extrabold text-header">ثبّت البائعين مرة واحدة</p>
              <p className="max-w-sm text-[13.5px] leading-6 text-slate-500">
                كل بائع يظهر بصف لكل هدف مسجّل عليه. الاختيار يُحفظ على هذا الجهاز.
              </p>
              <Btn onClick={() => setSettingsOpen(true)}>اختيار البائعين</Btn>
            </div>
          ) : (
            <div className="min-h-0 flex-1 p-3">
              <DataGrid
                embedded
                fillHeight
                columns={columns(mode)}
                rows={rows}
                getRowId={r => r.id}
                loading={breakdownsQ.isLoading || rulesQ.isLoading}
                storageKey="target-report-excel"
                exportName={`اهداف-${range.from}_${range.to}`}
                counterLabel="صف"
                emptyText="لا أهداف لهؤلاء البائعين في هذه الفترة"
                rowTone={r => (r.goal > 0 && r.hit ? 'bg-emerald-50/70' : r.goal > 0 && !r.hit ? 'bg-amber-50/50' : undefined)}
              />
            </div>
          )}
        </div>
      </div>
    </ReportAppWindow>
  );
}

function buildRows(
  pinned: number[],
  nameById: Map<number, string>,
  rules: TargetRuleDto[],
  breakdowns: TargetBreakdownDto[],
  mode: CompareMode,
): Row[] {
  const breakdownByRule = new Map(breakdowns.map(b => [b.ruleId, b]));
  const out: Row[] = [];
  let n = 0;

  for (const salesmanId of pinned) {
    const salesmanName = nameById.get(salesmanId) ?? `#${salesmanId}`;
    const assigned = rules.filter(r =>
      (r.assignments ?? []).some(a => a.salesmanId === salesmanId),
    );

    if (assigned.length === 0) {
      n += 1;
      out.push({
        id: `${salesmanId}-none`,
        sortIndex: n,
        salesmanId,
        salesmanName,
        ruleId: 0,
        targetName: 'بدون هدف',
        isAmount: false,
        sold: 0,
        goal: 0,
        remain: 0,
        percent: 0,
        hit: false,
      });
      continue;
    }

    for (const rule of assigned) {
      const assignment = (rule.assignments ?? []).find(a => a.salesmanId === salesmanId);
      const br = breakdownByRule.get(rule.id);
      const brRow = br?.salesmen.find(s => s.salesmanId === salesmanId);
      const isAmount = (br?.targetType ?? rule.targetType) === 'amount';
      const sold = isAmount ? (brRow?.amount ?? 0) : (brRow?.quantity ?? 0);
      const goal = pickGoal(
        mode,
        brRow?.dailyTarget ?? assignment?.dailyTarget ?? 0,
        brRow?.weeklyTarget ?? assignment?.weeklyTarget ?? 0,
        brRow?.monthlyTarget ?? assignment?.monthlyTarget ?? 0,
      );
      const percent = goal > 0 ? (sold / goal) * 100 : 0;
      n += 1;
      out.push({
        id: `${salesmanId}-${rule.id}`,
        sortIndex: n,
        salesmanId,
        salesmanName: brRow?.salesmanName ? fixEdariName(brRow.salesmanName) : salesmanName,
        ruleId: rule.id,
        targetName: br?.ruleName || rule.name,
        isAmount,
        sold,
        goal,
        remain: Math.max(0, goal - sold),
        percent,
        hit: goal > 0 && sold >= goal,
      });
    }
  }

  return out;
}

function PinSettings({
  salesmen,
  pinned,
  onChange,
  onDone,
}: {
  salesmen: SalesmanDto[];
  pinned: number[];
  onChange: (ids: number[]) => void;
  onDone: () => void;
}) {
  return (
    <aside
      className="flex w-[min(100%,320px)] shrink-0 flex-col border-l border-slate-200 bg-white"
      data-keep-escape
    >
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-[14px] font-extrabold text-header">البائعون الظاهرون</h3>
        <p className="mt-1 text-[12px] leading-5 text-slate-500">
          يُحفظ الاختيار هنا. كل بائع يظهر بصف مستقل لكل هدف.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <SalesmanMultiSelect
          salesmen={salesmen.map(s => ({ id: s.id, name: fixEdariName(s.name) || `#${s.id}` }))}
          selectedIds={pinned}
          onChange={onChange}
          emptyLabel="لم يُختر أحد بعد"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
        <span className="text-[12px] text-slate-500">{formatNum(pinned.length)} مثبت</span>
        <Btn size="sm" onClick={onDone}>تم</Btn>
      </div>
    </aside>
  );
}
