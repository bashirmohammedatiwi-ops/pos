import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import type { SalesmanDto, TargetBreakdownDto, TargetRuleDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, EmptyState } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { IconSliders, IconTarget, IconUsers } from '@/components/icons';
import { ProgressCell } from '@/components/workspace';
import { fixEdariName } from '@/lib/text';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { ReportAppWindow, ReportAside } from './ReportAppWindow';
import {
  ChartBlock,
  ChartToggle,
  ExcelBtn,
  HBarChart,
  PeriodSelector,
  PrintBtn,
  ReportBanner,
  ReportCenter,
  ReportError,
  ReportFill,
  ReportSplit,
  useChartDock,
  useReportPeriod,
  type ReportPeriodId,
} from './ReportKit';

const PIN_KEY = 'fot_report_targets_pinned';

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
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(ids));
  } catch { /* تجاهل */ }
}

function modeFromPeriod(period: ReportPeriodId, from: string, to: string): CompareMode {
  if (period === 'month' || period === 'lastMonth') return 'monthly';
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
        <span className="font-bold text-brand-800">
          {formatNum(r.sold)}{r.isAmount ? ' د.ع' : ''}
        </span>
      ),
    },
    {
      key: 'goal',
      header: `المطلوب (${MODE_LABEL[mode]})`,
      width: 150,
      mono: true,
      exportValue: r => (r.goal > 0 ? r.goal : '—'),
      render: r => (r.goal > 0 ? `${formatNum(r.goal)}${r.isAmount ? ' د.ع' : ''}` : '—'),
    },
    {
      key: 'remain',
      header: 'المتبقي',
      width: 130,
      mono: true,
      exportValue: r => (r.goal <= 0 ? '—' : r.hit ? 'تم' : r.remain),
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
  const period = useReportPeriod({
    storageKey: 'targets',
    presets: ['today', 'week', 'lastWeek', 'month', 'lastMonth', 'custom'],
    fallback: 'week',
  });
  const range = period.range;
  const [pinned, setPinned] = useState<number[]>(loadPinned);
  const [settingsOpen, setSettingsOpen] = useState(pinned.length === 0);

  const mode = modeFromPeriod(period.period, range.from, range.to);

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

  const withGoalRows = rows.filter(r => r.goal > 0);
  const hitCount = withGoalRows.filter(r => r.hit).length;
  const withGoal = withGoalRows.length;
  const avgPercent = withGoal ? withGoalRows.reduce((s, r) => s + Math.min(100, r.percent), 0) / withGoal : 0;
  const behind = withGoalRows.filter(r => !r.hit && r.percent < 70).length;
  const noTarget = new Set(rows.filter(r => r.ruleId === 0).map(r => r.salesmanId)).size;

  // متوسط إنجاز كل بائع (لأهدافه ذات المطلوب)
  const perSalesman = useMemo(() => {
    const map = new Map<number, { name: string; sum: number; n: number; hit: number }>();
    for (const r of rows) {
      if (r.goal <= 0) continue;
      const ex = map.get(r.salesmanId) ?? { name: r.salesmanName, sum: 0, n: 0, hit: 0 };
      ex.sum += Math.min(100, Math.max(0, r.percent));
      ex.n += 1;
      ex.hit += r.hit ? 1 : 0;
      map.set(r.salesmanId, ex);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, label: v.name, values: [v.sum / v.n], sub: `${formatNum(v.hit)} / ${formatNum(v.n)} أهداف محققة` }))
      .sort((a, b) => b.values[0] - a.values[0]);
  }, [rows]);

  function updatePinned(ids: number[]) {
    setPinned(ids);
    savePinned(ids);
  }

  function sheets(): ReportExcelSheet[] {
    return [{
      name: 'الأهداف',
      title: 'تقرير الأهداف',
      subtitle: `${range.from} → ${range.to} · مقارنة ${MODE_LABEL[mode]}`,
      headers: ['#', 'البائع', 'الهدف', 'المتحقق', `المطلوب (${MODE_LABEL[mode]})`, 'المتبقي', 'الإنجاز %'],
      columnWidths: [36, 140, 160, 88, 96, 88, 72],
      rows: rows.map(r => [
        r.sortIndex,
        r.salesmanName,
        r.targetName,
        r.sold,
        r.goal || '',
        r.goal > 0 ? (r.hit ? 'تم' : r.remain) : '',
        r.goal > 0 ? Math.round(r.percent) : '',
      ]),
    }];
  }

  const loading = breakdownsQ.isLoading || rulesQ.isLoading;
  const queryError = breakdownsQ.error ?? rulesQ.error;
  const dock = useChartDock();

  const chart = !loading && perSalesman.length > 0 ? (
    <ChartBlock title="نسبة الإنجاز لكل بائع" subtitle="متوسط أهدافه في الفترة (حد أقصى 100%)">
      <HBarChart
        series={[{ key: 'pct', label: 'الإنجاز' }]}
        format={n => `${formatNum(Math.round(n))}%`}
        items={perSalesman.slice(0, 12)}
      />
    </ChartBlock>
  ) : null;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #818cf8 0%, #4338ca 100%)"
      title="تقرير الأهداف"
      subtitle={`${period.label} · مقارنة ${MODE_LABEL[mode]} · ${formatNum(pinned.length)} بائع مثبت`}
      icon={<IconTarget size={16} />}
      toolbar={<PeriodSelector state={period} />}
      actions={
        <>
          <Btn
            size="sm"
            variant={settingsOpen ? 'soft' : 'ghost'}
            icon={<IconSliders size={14} />}
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(v => !v)}
          >
            البائعون
          </Btn>
          <ExcelBtn fileName={`اهداف-${range.from}_${range.to}`} getSheets={sheets} disabled={!rows.length || loading} />
          <PrintBtn title={`تقرير الأهداف (${range.from} — ${range.to})`} getSheets={sheets} disabled={!rows.length || loading} />
        </>
      }
      aside={settingsOpen ? (
        <PinSettings
          salesmen={salesmen}
          pinned={pinned}
          onChange={updatePinned}
          onDone={() => setSettingsOpen(false)}
        />
      ) : undefined}
      onClose={onClose}
    >
      {pinned.length === 0 ? (
        <ReportCenter>
          <EmptyState
            icon={<IconUsers size={24} />}
            title="ثبّت البائعين مرة واحدة"
            description="كل بائع يظهر بصف لكل هدف مسجّل عليه. الاختيار يُحفظ على هذا الجهاز."
            action={<Btn icon={<IconSliders size={14} />} onClick={() => setSettingsOpen(true)}>اختيار البائعين</Btn>}
          />
        </ReportCenter>
      ) : (
        <ReportFill>
          {queryError && (
            <ReportBanner>
              <ReportError
                error={queryError}
                onRetry={() => { void rulesQ.refetch(); void breakdownsQ.refetch(); }}
              />
            </ReportBanner>
          )}

          <SummaryStrip
            loading={loading}
            cells={[
              {
                label: 'أهداف محققة',
                value: withGoal ? `${formatNum(hitCount)} / ${formatNum(withGoal)}` : '—',
                tone: 'ok',
                hint: withGoal ? `${formatNum(Math.round((hitCount / withGoal) * 100))}% من الأهداف` : 'لا أهداف بمطلوب',
              },
              { label: 'متوسط الإنجاز', value: `${formatNum(Math.round(avgPercent))}%`, tone: 'brand', hint: `مقارنة ${MODE_LABEL[mode]}` },
              { label: 'تحت 70%', value: formatNum(behind), tone: behind > 0 ? 'warn' : undefined, hint: 'أهداف تحتاج متابعة' },
              { label: 'بائعون بلا هدف', value: formatNum(noTarget), hint: `من ${formatNum(pinned.length)} مثبت` },
            ]}
          />

          <ReportSplit chart={chart} open={dock.open}>
            <DataGrid
              variant="sheet"
              embedded
              fillHeight
              columns={columns(mode)}
              rows={rows}
              getRowId={r => r.id}
              loading={loading}
              storageKey="target-report-excel"
              exportName={`اهداف-${range.from}_${range.to}`}
              counterLabel="صف"
              emptyText="لا أهداف لهؤلاء البائعين في هذه الفترة"
              rowTone={r => (r.goal > 0 && r.hit ? 'bg-emerald-50/70' : r.goal > 0 && !r.hit ? 'bg-amber-50/50' : undefined)}
              toolbar={chart ? <ChartToggle dock={dock} /> : undefined}
            />
          </ReportSplit>
        </ReportFill>
      )}
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
    <ReportAside
      title="البائعون الظاهرون"
      description="يُحفظ الاختيار على هذا الجهاز. كل بائع يظهر بصف مستقل لكل هدف."
      footer={
        <>
          <span className="text-[12px] text-slate-500"><span className="num font-semibold">{formatNum(pinned.length)}</span> مثبت</span>
          <Btn size="sm" onClick={onDone}>تم</Btn>
        </>
      }
    >
      <SalesmanMultiSelect
        salesmen={salesmen.map(s => ({ id: s.id, name: fixEdariName(s.name) || `#${s.id}` }))}
        selectedIds={pinned}
        onChange={onChange}
        emptyLabel="لم يُختر أحد بعد"
      />
    </ReportAside>
  );
}
