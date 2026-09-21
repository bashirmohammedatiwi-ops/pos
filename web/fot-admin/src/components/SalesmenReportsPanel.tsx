import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatCurrency,
  formatNum,
  monthStartIso,
  todayIso,
} from '@/api/client';
import type { SalesmanCommissionSummaryDto, SalesmanSalesRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { fixEdariName } from '@/lib/text';
import { DatePresets } from '@/components/DatePresets';
import { useClientSort } from '@/components/grid/DataGrid';
import {
  Alert,
  Btn,
  Field,
  Input,
  Loading,
  Panel,
  Select,
} from '@/components/ui';
import { DashCard, FilterChip, SegmentedTabs } from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';
import { printHtmlDoc } from '@/lib/print';

const REPORT_KEY = 'fot_salesmen_reports_sub';

type ReportTab = 0 | 1 | 2 | 3;

function loadSubTab(): ReportTab {
  try {
    const n = Number(sessionStorage.getItem(REPORT_KEY));
    if (n >= 0 && n <= 3) return n as ReportTab;
  } catch { /* ignore */ }
  return 0;
}

function vsPrev(now: number, prev: number) {
  if (!prev && !now) return 'كما الفترة السابقة';
  if (!prev) return 'بداية الفترة';
  const pct = ((now - prev) / prev) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% مقابل السابقة`;
}

function prevRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(prevStart), to: iso(prevEnd) };
}

function MiniBar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'ok' | 'amber' }) {
  const w = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  const color = tone === 'ok' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function KpiGrid({ items }: { items: { label: string; value: string; hint?: string; tone?: 'brand' | 'ok' | 'warn' }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {items.map(item => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
          <p className="text-[11px] font-medium text-slate-500">{item.label}</p>
          <p className={`mt-1 text-[18px] font-bold tabular-nums ${
            item.tone === 'brand' ? 'text-brand-700' : item.tone === 'ok' ? 'text-emerald-700' : item.tone === 'warn' ? 'text-amber-700' : 'text-header'
          }`}>
            {item.value}
          </p>
          {item.hint && <p className="mt-0.5 text-[10px] text-slate-400">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}

type TargetAgg = {
  salesmanId: number;
  name: string;
  avgPercent: number;
  rulesHit: number;
  rulesTotal: number;
};

/* أعمدة تقارير البائعين — DataGrid موحد */
function salesReportColumns(max: number, from: string, to: string): GridColumn<SalesmanSalesRowDto>[] {
  return [
    { key: 'name', header: 'المندوب', width: 180, render: s => <span className="font-semibold text-header">{fixEdariName(s.name) || `#${s.salesmanId}`}</span> },
    { key: 'total', header: 'المبلغ', width: 220, mono: true, footer: 'sum', render: s => (
      <div>
        <MiniBar value={s.total} max={max} />
        <span className="mt-1 block font-bold">{formatCurrency(s.total)}</span>
      </div>
    ) },
    { key: 'count', header: 'الفواتير', width: 100, mono: true, footer: 'sum' },
    { key: 'lineCount', header: 'الأصناف', width: 100, mono: true, footer: 'sum', render: s => formatNum(s.lineCount ?? 0) },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 150,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex justify-center gap-2">
          <Link to={`/receipts?search=${encodeURIComponent(s.name ?? '')}&from=${from}&to=${to}`} className="text-[12px] text-brand-600 hover:underline">فواتير</Link>
          <button type="button" className="text-[12px] text-brand-600 hover:underline" onClick={() => onFilterSalesmanIdChangeRef(s.salesmanId)}>تصفية</button>
        </div>
      ),
    },
  ];
}

// مرجع لمعالج التصفية — يُضبط داخل المكوّن (الأعمدة معرفة على مستوى الملف)
let onFilterSalesmanIdChangeRef: (id: number) => void = () => {};

function commReportColumns(max: number): GridColumn<SalesmanCommissionSummaryDto>[] {
  return [
    { key: 'salesmanName', header: 'المندوب', width: 180, render: s => <span className="font-semibold text-header">{fixEdariName(s.salesmanName) || `#${s.salesmanId}`}</span> },
    { key: 'totalCommission', header: 'عمولة الفترة', width: 230, mono: true, footer: 'sum', render: s => (
      <div>
        <MiniBar value={s.totalCommission} max={max} tone={s.balanceDue > 0 ? 'amber' : 'ok'} />
        <span className="mt-1 block font-bold">{formatCurrency(s.totalCommission)}</span>
      </div>
    ) },
    { key: 'paidOutTotal', header: 'مصروف', width: 120, mono: true, footer: 'sum', render: s => formatCurrency(s.paidOutTotal) },
    { key: 'balanceDue', header: 'مستحق', width: 130, mono: true, footer: 'sum', render: s => <span className={s.balanceDue > 0 ? 'font-bold text-amber-700' : ''}>{formatCurrency(s.balanceDue)}</span> },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 140,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex justify-center gap-2">
          <Link to="/reports" className="text-[12px] text-brand-600 hover:underline">تفاصيل</Link>
          {s.balanceDue > 0 && (
            <Link to="/reports" className="text-[12px] text-brand-600 hover:underline">صرف</Link>
          )}
        </div>
      ),
    },
  ];
}

const targetsReportColumns: GridColumn<TargetAgg>[] = [
  { key: 'name', header: 'المندوب', width: 180, render: t => <span className="font-semibold text-header">{t.name}</span> },
  {
    key: 'avgPercent',
    header: 'متوسط الإنجاز',
    width: 230,
    mono: true,
    render: t => (
      <div className="flex items-center gap-2">
        <div className="min-w-[100px] flex-1">
          <MiniBar value={t.avgPercent} max={100} tone={t.avgPercent < 70 ? 'amber' : 'ok'} />
        </div>
        <span className={`text-[12px] font-bold ${t.avgPercent < 70 ? 'text-amber-700' : 'text-emerald-700'}`}>
          {formatNum(t.avgPercent, 0)}%
        </span>
      </div>
    ),
  },
  { key: 'rulesHit', header: 'أهداف محققة', width: 130, align: 'center', render: t => `${formatNum(t.rulesHit)} / ${formatNum(t.rulesTotal)}` },
  {
    key: 'actions',
    header: 'إجراءات',
    width: 100,
    align: 'center',
    sortable: false,
    exportable: false,
    render: () => <Link to="/targets" className="text-[12px] text-brand-600 hover:underline">الأهداف</Link>,
  },
];

export function SalesmenReportsPanel({
  from,
  to,
  onFromChange,
  onToChange,
  filterSalesmanId,
  onFilterSalesmanIdChange,
}: {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  filterSalesmanId: number | '';
  onFilterSalesmanIdChange: (v: number | '') => void;
}) {
  const [subTab, setSubTab] = useState<ReportTab>(loadSubTab);
  const [search, setSearch] = useState('');

  useEffect(() => {
    sessionStorage.setItem(REPORT_KEY, String(subTab));
  }, [subTab]);

  const prev = useMemo(() => prevRange(from, to), [from, to]);

  const salesQ = useQuery({
    queryKey: ['report-salesman', from, to],
    queryFn: () => api.salesBySalesman(from, to),
    placeholderData: p => p,
  });
  const prevSalesQ = useQuery({
    queryKey: ['report-salesman-prev', prev.from, prev.to],
    queryFn: () => api.salesBySalesman(prev.from, prev.to),
    placeholderData: p => p,
  });
  const commQ = useQuery({
    queryKey: ['commission-summary', from, to],
    queryFn: () => api.commissionSummary(from, to),
    placeholderData: p => p,
  });
  const targetsQ = useQuery({
    queryKey: ['target-breakdowns', from, to],
    queryFn: () => api.targetBreakdowns(from, to),
    staleTime: 90_000,
  });
  const salesmenQ = useQuery({
    queryKey: ['salesmen'],
    queryFn: () => api.salesmen(),
    staleTime: 60_000,
  });

  const sales = salesQ.data ?? [];
  const prevSales = prevSalesQ.data ?? [];
  const comm = commQ.data ?? [];

  const totalSales = sales.reduce((s, x) => s + x.total, 0);
  const prevTotalSales = prevSales.reduce((s, x) => s + x.total, 0);
  const totalReceipts = sales.reduce((s, x) => s + x.count, 0);
  const totalCommission = comm.reduce((s, x) => s + x.totalCommission, 0);
  const totalDue = comm.reduce((s, x) => s + Math.max(0, x.balanceDue), 0);
  const activeCount = sales.filter(s => s.total > 0).length;

  const salesAccessors = useMemo(() => ({
    name: (s: SalesmanSalesRowDto) => s.name ?? '',
    total: (s: SalesmanSalesRowDto) => s.total,
    count: (s: SalesmanSalesRowDto) => s.count,
    lines: (s: SalesmanSalesRowDto) => s.lineCount ?? 0,
  }), []);
  const salesSort = useClientSort(sales, salesAccessors, 'total', 'desc');

  const commAccessors = useMemo(() => ({
    name: (s: SalesmanCommissionSummaryDto) => s.salesmanName ?? '',
    earned: (s: SalesmanCommissionSummaryDto) => s.totalCommission,
    due: (s: SalesmanCommissionSummaryDto) => s.balanceDue,
    paid: (s: SalesmanCommissionSummaryDto) => s.paidOutTotal,
  }), []);
  const commSort = useClientSort(comm, commAccessors, 'earned', 'desc');

  const targetAgg = useMemo(() => {
    const map = new Map<number, TargetAgg>();
    for (const b of targetsQ.data ?? []) {
      for (const m of b.salesmen) {
        const ex = map.get(m.salesmanId);
        const pct = m.dailyPercent;
        const hit = m.dailyTarget > 0 && pct >= 100 ? 1 : 0;
        const hasTarget = m.dailyTarget > 0 ? 1 : 0;
        if (ex) {
          ex.rulesTotal += hasTarget;
          ex.rulesHit += hit;
          ex.avgPercent = (ex.avgPercent + pct) / 2;
        } else {
          map.set(m.salesmanId, {
            salesmanId: m.salesmanId,
            name: fixEdariName(m.salesmanName) || `#${m.salesmanId}`,
            avgPercent: pct,
            rulesHit: hit,
            rulesTotal: hasTarget,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.avgPercent - b.avgPercent);
  }, [targetsQ.data]);

  const q = search.trim().toLowerCase();
  const filteredSales = useMemo(() => {
    let list = salesSort.sorted;
    if (filterSalesmanId !== '') list = list.filter(s => s.salesmanId === filterSalesmanId);
    if (!q) return list;
    return list.filter(s =>
      (s.name ?? '').toLowerCase().includes(q) || String(s.salesmanId).includes(q),
    );
  }, [salesSort.sorted, filterSalesmanId, q]);

  const filteredComm = useMemo(() => {
    let list = commSort.sorted;
    if (filterSalesmanId !== '') list = list.filter(s => s.salesmanId === filterSalesmanId);
    if (!q) return list;
    return list.filter(s =>
      (s.salesmanName ?? '').toLowerCase().includes(q) || String(s.salesmanId).includes(q),
    );
  }, [commSort.sorted, filterSalesmanId, q]);

  const filteredTargets = useMemo(() => {
    let list = targetAgg;
    if (filterSalesmanId !== '') list = list.filter(s => s.salesmanId === filterSalesmanId);
    if (!q) return list;
    return list.filter(s => s.name.toLowerCase().includes(q) || String(s.salesmanId).includes(q));
  }, [targetAgg, filterSalesmanId, q]);

  const maxSales = Math.max(...filteredSales.map(s => s.total), 1);
  const maxComm = Math.max(...filteredComm.map(s => s.totalCommission), 1);
  onFilterSalesmanIdChangeRef = onFilterSalesmanIdChange;

  const topSales = [...sales].sort((a, b) => b.total - a.total).slice(0, 5);
  const topComm = [...comm].sort((a, b) => b.totalCommission - a.totalCommission).slice(0, 5);
  const atRisk = targetAgg.filter(t => t.rulesTotal > 0 && t.avgPercent < 70).slice(0, 5);

  const alerts = useMemo(() => {
    const list: { tone: 'warn' | 'info'; text: string }[] = [];
    if (totalDue > 0) {
      const dueCount = comm.filter(c => c.balanceDue > 0).length;
      list.push({ tone: 'warn', text: `${formatNum(dueCount)} بائع لديهم مستحق صرف بقيمة ${formatCurrency(totalDue)}` });
    }
    if (atRisk.length) {
      list.push({ tone: 'warn', text: `${formatNum(atRisk.length)} بائع تحت 70% من أهدافهم` });
    }
    if (!activeCount && !salesQ.isLoading) {
      list.push({ tone: 'info', text: 'لا مبيعات للبائعين في الفترة المحددة' });
    }
    return list;
  }, [activeCount, atRisk.length, comm, salesQ.isLoading, totalDue]);

  const loading = (salesQ.isLoading && !salesQ.data) || (commQ.isLoading && !commQ.data);

  function exportCsv() {
    const suffix = `${from}_${to}`;
    if (subTab === 0) {
      downloadCsv(`salesmen-overview_${suffix}.csv`, ['البائع', 'مبيعات', 'عمولة', 'مستحق'],
        comm.map(c => {
          const sale = sales.find(s => s.salesmanId === c.salesmanId);
          return [c.salesmanName ?? c.salesmanId, sale?.total ?? 0, c.totalCommission, c.balanceDue];
        }));
    } else if (subTab === 1) {
      downloadCsv(`salesmen-sales_${suffix}.csv`, ['المندوب', 'المبلغ', 'فواتير', 'أصناف'],
        filteredSales.map(s => [s.name ?? s.salesmanId, s.total, s.count, s.lineCount ?? '']));
    } else if (subTab === 2) {
      downloadCsv(`salesmen-commissions_${suffix}.csv`, ['المندوب', 'عمولة', 'مصروف', 'مستحق'],
        filteredComm.map(s => [s.salesmanName ?? s.salesmanId, s.totalCommission, s.paidOutTotal, s.balanceDue]));
    } else if (subTab === 3) {
      downloadCsv(`salesmen-targets_${suffix}.csv`, ['المندوب', 'متوسط%', 'أهداف محققة', 'أهداف'],
        filteredTargets.map(t => [t.name, t.avgPercent.toFixed(1), t.rulesHit, t.rulesTotal]));
    }
  }

  function printReport() {
    const titles = ['نظرة عامة — البائعون', 'مبيعات البائعين', 'عمولات البائعين', 'أهداف البائعين'];
    const rows = document.querySelector('.salesmen-report-print')?.innerHTML ?? '';
    void printHtmlDoc(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${titles[subTab]}</title>
      <style>body{font-family:Tahoma,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px;text-align:right}</style>
      </head><body><h2>${titles[subTab]} ${from} — ${to}</h2>${rows}</body></html>`);
  }

  return (
    <div className="space-y-4 p-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3 p-3">
          <Field label="من">
            <Input type="date" value={from} onChange={e => onFromChange(e.target.value)} />
          </Field>
          <Field label="إلى">
            <Input type="date" value={to} onChange={e => onToChange(e.target.value)} />
          </Field>
          <Field label="بحث">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="اسم أو رقم…"
              className="min-w-[180px]"
            />
          </Field>
          <Field label="المندوب">
            <div className="flex gap-2">
              <Select
                value={filterSalesmanId === '' ? '' : String(filterSalesmanId)}
                onChange={e => onFilterSalesmanIdChange(e.target.value ? Number(e.target.value) : '')}
                className="min-w-[160px]"
              >
                <option value="">كل المندوبين</option>
                {(salesmenQ.data?.items ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              {filterSalesmanId !== '' && (
                <Btn size="sm" variant="ghost" onClick={() => onFilterSalesmanIdChange('')}>مسح</Btn>
              )}
            </div>
          </Field>
          <DatePresets onPick={(f, t) => { onFromChange(f); onToChange(t); }} />
          <div className="flex flex-wrap gap-1 mr-auto">
            <Btn size="sm" variant="ghost" onClick={() => { onFromChange(monthStartIso()); onToChange(todayIso()); }}>هذا الشهر</Btn>
            <Btn size="sm" variant="secondary" onClick={exportCsv}>CSV</Btn>
            <Btn size="sm" variant="secondary" onClick={printReport}>طباعة</Btn>
            <Link to="/reports" className="self-center text-[12px] font-semibold text-brand-700 hover:underline">حسابات الصرف</Link>
          </div>
        </div>
        {filterSalesmanId !== '' && (
          <div className="border-t border-slate-100 px-3 py-2">
            <FilterChip active onClick={() => onFilterSalesmanIdChange('')}>
              مندوب #{filterSalesmanId} — إلغاء
            </FilterChip>
          </div>
        )}
      </Panel>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(a => (
            <Alert key={a.text} type={a.tone === 'warn' ? 'warning' : 'info'}>{a.text}</Alert>
          ))}
        </div>
      )}

      <div className="px-1">
        <SegmentedTabs
          items={[
            { id: 0, label: 'نظرة عامة' },
            { id: 1, label: 'المبيعات', count: sales.length },
            { id: 2, label: 'العمولات', count: comm.length },
            { id: 3, label: 'الأهداف', count: targetAgg.length },
          ]}
          value={subTab}
          onChange={setSubTab}
        />
      </div>

      {loading && <Loading />}

      {subTab === 0 && !loading && (
        <div className="space-y-4">
          <KpiGrid
            items={[
              { label: 'بائعون نشطون', value: formatNum(activeCount), hint: `من ${formatNum(salesmenQ.data?.total ?? sales.length)}`, tone: 'brand' },
              { label: 'مبيعات الفترة', value: formatCurrency(totalSales), hint: vsPrev(totalSales, prevTotalSales), tone: 'ok' },
              { label: 'فواتير', value: formatNum(totalReceipts) },
              { label: 'عمولات', value: formatCurrency(totalCommission), tone: 'brand' },
              { label: 'مستحق صرف', value: formatCurrency(totalDue), tone: totalDue ? 'warn' : undefined },
              { label: 'متوسط/بائع', value: formatCurrency(activeCount ? totalSales / activeCount : 0) },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <DashCard title="أعلى مبيعات">
              <ul className="divide-y divide-slate-100">
                {topSales.map((s, i) => (
                  <li key={s.salesmanId} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="w-4 text-[11px] font-bold text-slate-400">{i + 1}</span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-header hover:text-brand-700"
                      onClick={() => onFilterSalesmanIdChange(s.salesmanId)}
                    >
                      {fixEdariName(s.name) || `#${s.salesmanId}`}
                    </button>
                    <span className="text-[12px] font-bold tabular-nums">{formatCurrency(s.total)}</span>
                  </li>
                ))}
                {!topSales.length && <li className="px-4 py-8 text-center text-[13px] text-slate-400">لا مبيعات</li>}
              </ul>
            </DashCard>

            <DashCard title="أعلى عمولات">
              <ul className="divide-y divide-slate-100">
                {topComm.map((s, i) => (
                  <li key={s.salesmanId} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="w-4 text-[11px] font-bold text-slate-400">{i + 1}</span>
                    <Link to="/reports" className="min-w-0 flex-1 truncate text-[13px] font-medium text-header hover:text-brand-700">
                      {fixEdariName(s.salesmanName) || `#${s.salesmanId}`}
                    </Link>
                    <span className="text-[12px] font-bold tabular-nums">{formatCurrency(s.totalCommission)}</span>
                  </li>
                ))}
                {!topComm.length && <li className="px-4 py-8 text-center text-[13px] text-slate-400">لا عمولات</li>}
              </ul>
            </DashCard>

            <DashCard title="أهداف تحتاج متابعة" action={<Link to="/targets" className="text-[12px] font-semibold text-brand-700 hover:underline">الكل</Link>}>
              <ul className="divide-y divide-slate-100">
                {atRisk.map(t => (
                  <li key={t.salesmanId} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-header">{t.name}</span>
                      <span className="text-[12px] font-bold tabular-nums text-amber-700">{formatNum(t.avgPercent, 0)}%</span>
                    </div>
                    <MiniBar value={t.avgPercent} max={100} tone="amber" />
                  </li>
                ))}
                {!atRisk.length && <li className="px-4 py-8 text-center text-[13px] text-slate-400">الجميع على المسار</li>}
              </ul>
            </DashCard>
          </div>
        </div>
      )}

      {subTab === 1 && !loading && (
        <DataGrid
          columns={salesReportColumns(maxSales, from, to)}
          rows={filteredSales}
          getRowId={s => s.salesmanId}
          exportName={`مبيعات-البائعين-${from}_${to}`}
          counterLabel="بائع"
          emptyText="لا مبيعات في هذه الفترة"
        />
      )}

      {subTab === 2 && !loading && (
        <DataGrid
          columns={commReportColumns(maxComm)}
          rows={filteredComm}
          getRowId={s => s.salesmanId}
          exportName={`عمولات-البائعين-${from}_${to}`}
          counterLabel="بائع"
          emptyText="لا عمولات في هذه الفترة"
        />
      )}

      {subTab === 3 && !loading && (
        <DataGrid
          columns={targetsReportColumns}
          rows={filteredTargets}
          getRowId={t => t.salesmanId}
          exportName="أهداف-البائعين"
          counterLabel="بائع"
          emptyText="لا أهداف نشطة"
        />
      )}
    </div>
  );
}

export function defaultSalesmenRange() {
  return { from: monthStartIso(), to: todayIso() };
}
