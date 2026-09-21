import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { SalesmanCommissionSummaryDto, SalesmanDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { Btn, Input } from '@/components/ui';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { IconCoins, IconSliders } from '@/components/icons';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange } from '@/lib/businessPeriod';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';

const PIN_KEY = 'fot_report_commissions_pinned';

type PeriodId = 'week' | 'lastWeek' | 'month' | 'custom';

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

type Row = SalesmanCommissionSummaryDto & { sortIndex: number };

function columns(): GridColumn<Row>[] {
  return [
    {
      key: 'sortIndex',
      header: '#',
      width: 56,
      align: 'center',
      mono: true,
      render: r => r.sortIndex,
    },
    {
      key: 'salesmanName',
      header: 'البائع',
      width: 240,
      render: r => <span className="font-semibold text-header">{fixEdariName(r.salesmanName) || `#${r.salesmanId}`}</span>,
    },
    {
      key: 'totalCommission',
      header: 'عمولة الفترة',
      width: 160,
      mono: true,
      footer: 'sum',
      render: r => <span className="font-extrabold text-brand-800">{formatCurrency(r.totalCommission)}</span>,
    },
    {
      key: 'transactionCount',
      header: 'الحركات',
      width: 110,
      mono: true,
      footer: 'sum',
      align: 'center',
    },
    {
      key: 'paidOutTotal',
      header: 'مدفوع',
      width: 140,
      mono: true,
      footer: 'sum',
      render: r => formatCurrency(r.paidOutTotal),
    },
    {
      key: 'balanceDue',
      header: 'المستحق',
      width: 140,
      mono: true,
      footer: 'sum',
      render: r => (
        <span className={r.balanceDue > 0 ? 'font-bold text-amber-700' : 'text-slate-500'}>
          {formatCurrency(r.balanceDue)}
        </span>
      ),
    },
  ];
}

export function CommissionReportApp({ onClose }: { onClose: () => void }) {
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

  const salesmenQ = useQuery({
    queryKey: ['salesmen', true],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });
  const salesmen = salesmenQ.data?.items ?? [];

  const summaryQ = useQuery({
    queryKey: ['commission-summary', range.from, range.to],
    queryFn: () => api.commissionSummary(range.from, range.to),
    enabled: pinned.length > 0 && !!range.from && !!range.to,
  });

  const byId = useMemo(() => {
    const map = new Map<number, SalesmanCommissionSummaryDto>();
    for (const s of summaryQ.data ?? []) map.set(s.salesmanId, s);
    return map;
  }, [summaryQ.data]);

  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of salesmen) map.set(s.id, fixEdariName(s.name) || `#${s.id}`);
    return map;
  }, [salesmen]);

  const rows: Row[] = useMemo(() => {
    return pinned.map((id, i) => {
      const hit = byId.get(id);
      return {
        salesmanId: id,
        salesmanName: hit?.salesmanName ? fixEdariName(hit.salesmanName) : (nameById.get(id) ?? `#${id}`),
        currencyCode: hit?.currencyCode ?? 'IQD',
        openingBalance: hit?.openingBalance ?? 0,
        paidOutTotal: hit?.paidOutTotal ?? 0,
        totalCommission: hit?.totalCommission ?? 0,
        transactionCount: hit?.transactionCount ?? 0,
        balanceDue: hit?.balanceDue ?? 0,
        notes: hit?.notes,
        sortIndex: i + 1,
      };
    });
  }, [pinned, byId, nameById]);

  const totalEarned = rows.reduce((s, r) => s + r.totalCommission, 0);

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
      title="تقرير العمولات"
      subtitle={`${formatPeriodRange(range.from, range.to)} · ${formatNum(pinned.length)} بائع مثبت`}
      icon={<IconCoins size={20} />}
      actions={
        <button
          type="button"
          onClick={() => setSettingsOpen(v => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-bold transition ${
            settingsOpen ? 'bg-white text-brand-800' : 'bg-white/15 text-white hover:bg-white/25'
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
              الإجمالي {formatCurrency(totalEarned)}
            </div>
          </div>

          {pinned.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[16px] font-extrabold text-header">ثبّت البائعين مرة واحدة</p>
              <p className="max-w-sm text-[13.5px] leading-6 text-slate-500">
                اختر من يظهر في هذا الإكسل. الاختيار يُحفظ على هذا الجهاز ويبقى عند كل فتح، ويمكن تعديله من الإعداد.
              </p>
              <Btn onClick={() => setSettingsOpen(true)}>اختيار البائعين</Btn>
            </div>
          ) : (
            <div className="min-h-0 flex-1 p-3">
              <DataGrid
                embedded
                fillHeight
                columns={columns()}
                rows={rows}
                getRowId={r => r.salesmanId}
                loading={summaryQ.isLoading}
                storageKey="commission-report-excel"
                exportName={`عمولات-${range.from}_${range.to}`}
                counterLabel="بائع"
                emptyText="لا عمولات في هذه الفترة — البائعون المثبتون يظهرون بصفر"
                rowTone={r => (r.balanceDue > 0 ? 'bg-amber-50/60' : undefined)}
              />
            </div>
          )}
        </div>
      </div>
    </ReportAppWindow>
  );
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
          يُحفظ الاختيار هنا. ليس في كل فتح — عدّله متى شئت.
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
