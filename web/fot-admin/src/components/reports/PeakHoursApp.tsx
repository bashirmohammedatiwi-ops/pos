import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, formatNum, todayIso } from '@/api/client';
import type { HeatCellDto } from '@/api/types';
import { IconClock } from '@/components/icons';
import { SummaryStrip } from '@/components/listWorkspace';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { ReportAppWindow } from './ReportAppWindow';
import { ExcelBtn, Money, PeriodSelector, PrintBtn, ReportBanner, ReportError, ReportFill, ReportNote, useReportPeriod } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * أوقات الذروة — خريطة حرارية (يوم الأسبوع × الساعة) لمتوسط المبيعات أو الفواتير.
 * المتوسط = مجموع الخانة ÷ عدد مرات ذلك اليوم في المدة، فالمقارنة عادلة بين الأيام.
 * ───────────────────────────────────────────────────────────────────────────── */

/** 0 = السبت … 6 = الجمعة — نفس ترقيم الخادم. */
const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

type Metric = 'sales' | 'receipts';

/** عدد مرات كل يوم أسبوع في المدة (شاملة الطرفين). */
function weekdayOccurrences(from: string, to: string) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  let guard = 0;
  while (d <= end && guard < 4000) {
    // getDay: 0 = الأحد … 6 = السبت → ترقيمنا: السبت = 0
    counts[(d.getDay() + 1) % 7]++;
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return counts;
}

function hourLabel(h: number) {
  const suffix = h < 12 ? 'ص' : 'م';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

export function PeakHoursApp({ onClose }: { onClose: () => void }) {
  const period = useReportPeriod({
    storageKey: 'peak-hours',
    presets: ['week', 'lastWeek', 'month', 'lastMonth', 'last30', 'all', 'custom'],
    fallback: 'last30',
  });
  const range = period.range;
  const [metric, setMetric] = useState<Metric>('sales');

  const q = useQuery({
    queryKey: ['report-heatmap', range.from, range.to],
    queryFn: () => api.salesHeatmap(range.from, range.to),
    placeholderData: prev => prev,
  });
  const cells = q.data?.cells ?? [];
  // المتوسط على الأيام التي كان فيها بيع ممكناً: من أول فاتورة في النظام حتى اليوم
  const effFrom = q.data?.posStartDate && q.data.posStartDate.slice(0, 10) > range.from ? q.data.posStartDate.slice(0, 10) : range.from;
  const today = todayIso();
  const effTo = range.to > today ? today : range.to;

  const model = useMemo(() => {
    const occ = effFrom <= effTo ? weekdayOccurrences(effFrom, effTo) : [0, 0, 0, 0, 0, 0, 0];
    const activeDays = occ.filter(n => n > 0).length || 1;
    const map = new Map<string, HeatCellDto>();
    let minH = 24;
    let maxH = -1;
    for (const c of cells) {
      map.set(`${c.weekday}-${c.hour}`, c);
      if (c.count > 0 || c.total !== 0) {
        minH = Math.min(minH, c.hour);
        maxH = Math.max(maxH, c.hour);
      }
    }
    if (maxH < 0) {
      minH = 9;
      maxH = 23;
    }
    const hours = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);
    const value = (c?: HeatCellDto) => (c ? (metric === 'sales' ? c.total : c.count) : 0);
    const avg = (day: number, hour: number) => {
      const n = occ[day] || 1;
      return value(map.get(`${day}-${hour}`)) / n;
    };
    let max = 0;
    for (let d = 0; d < 7; d++) for (const h of hours) max = Math.max(max, avg(d, h));
    const dayTotals = DAYS.map((_, d) => hours.reduce((s, h) => s + avg(d, h), 0));
    const hourTotals = hours.map(h => DAYS.reduce((s, _, d) => s + (occ[d] ? avg(d, h) : 0), 0) / activeDays);
    const totalSales = cells.reduce((s, c) => s + c.total, 0);
    const totalCount = cells.reduce((s, c) => s + c.count, 0);
    let best = { d: 0, h: hours[0], v: -1 };
    for (let d = 0; d < 7; d++) for (const h of hours) if (avg(d, h) > best.v) best = { d, h, v: avg(d, h) };
    const bestDay = dayTotals.indexOf(Math.max(...dayTotals));
    const worstDay = dayTotals.indexOf(Math.min(...dayTotals.map((v, i) => (occ[i] ? v : Infinity))));
    const bestHourIdx = hourTotals.indexOf(Math.max(...hourTotals));
    return { occ, hours, avg, max, dayTotals, hourTotals, totalSales, totalCount, best, bestDay, worstDay, bestHour: hours[bestHourIdx] };
  }, [cells, metric, effFrom, effTo]);

  const fmt = (v: number) => (metric === 'sales' ? formatNum(Math.round(v)) : formatNum(v, 1));
  const unit = metric === 'sales' ? 'IQD' : 'فاتورة';

  function sheets(): ReportExcelSheet[] {
    if (!cells.length) return [];
    return [
      {
        name: 'أوقات الذروة',
        title: `أوقات الذروة — متوسط ${metric === 'sales' ? 'المبيعات' : 'عدد الفواتير'} لكل يوم`,
        subtitle: `${range.from} — ${range.to}`,
        headers: ['اليوم', ...model.hours.map(hourLabel), 'مجموع اليوم'],
        columnWidths: [70, ...model.hours.map(() => 56), 80],
        rows: DAYS.map((name, d) => [
          name,
          ...model.hours.map(h => Math.round(model.avg(d, h) * (metric === 'sales' ? 1 : 10)) / (metric === 'sales' ? 1 : 10)),
          Math.round(model.dayTotals[d]),
        ]),
      },
    ];
  }

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #34d399 0%, #0f766e 100%)"
      title="أوقات الذروة"
      subtitle={`متوسط ${metric === 'sales' ? 'المبيعات' : 'الفواتير'} لكل يوم وساعة · ${period.label}`}
      icon={<IconClock size={20} />}
      toolbar={
        <>
          <PeriodSelector state={period} />
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(['sales', 'receipts'] as Metric[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-md px-3 py-1 text-[12px] font-bold transition ${metric === m ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {m === 'sales' ? 'المبيعات' : 'عدد الفواتير'}
              </button>
            ))}
          </div>
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`peak-hours_${range.from}_${range.to}`} getSheets={sheets} disabled={!cells.length} />
          <PrintBtn title={`أوقات الذروة (${range.from} — ${range.to})`} getSheets={sheets} disabled={!cells.length} />
        </>
      }
      onClose={onClose}
    >
      <ReportFill>
        {q.isError && (
          <ReportBanner>
            <ReportError error={q.error} onRetry={() => void q.refetch()} />
          </ReportBanner>
        )}
        <SummaryStrip
          loading={q.isLoading}
          cells={[
            { label: 'صافي المبيعات في المدة', value: <Money value={model.totalSales} />, tone: 'brand' },
            { label: 'فواتير البيع', value: formatNum(model.totalCount) },
            {
              label: 'أقوى ساعة',
              value: model.best.v > 0 ? `${DAYS[model.best.d]} ${hourLabel(model.best.h)}` : '—',
              hint: model.best.v > 0 ? `متوسط ${fmt(model.best.v)} ${unit}` : undefined,
              tone: 'ok',
            },
            { label: 'أقوى يوم', value: model.dayTotals.some(v => v > 0) ? DAYS[model.bestDay] : '—', hint: `متوسط ${fmt(model.dayTotals[model.bestDay] ?? 0)} ${unit}` },
            { label: 'أهدأ يوم', value: model.dayTotals.some(v => v > 0) ? DAYS[model.worstDay] : '—', hint: `متوسط ${fmt(model.dayTotals[model.worstDay] ?? 0)} ${unit}` },
            { label: 'ساعة الذروة عموماً', value: model.hourTotals.some(v => v > 0) ? hourLabel(model.bestHour) : '—' },
          ]}
        />
        <ReportNote bar>
          كل خانة = متوسط {metric === 'sales' ? 'صافي المبيعات' : 'عدد فواتير البيع'} في تلك الساعة لكل يوم من نوعه خلال المدة (مثلاً: مجموع أيام السبت ÷ عددها). الأغمق = الأكثر ازدحاماً.
        </ReportNote>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <table className="w-full border-separate border-spacing-[3px] text-[11.5px]">
              <thead>
                <tr>
                  <th className="w-20" />
                  {model.hours.map(h => (
                    <th key={h} className="min-w-[52px] pb-1 text-center font-bold text-slate-500">
                      {hourLabel(h)}
                    </th>
                  ))}
                  <th className="min-w-[96px] pb-1 text-center font-bold text-slate-500">متوسط اليوم</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((name, d) => (
                  <tr key={name}>
                    <th className="whitespace-nowrap pe-2 text-start text-[12.5px] font-extrabold text-slate-700">
                      {name}
                      <span className="ms-1 text-[10.5px] font-semibold text-slate-400">×{model.occ[d]}</span>
                    </th>
                    {model.hours.map(h => {
                      const v = model.avg(d, h);
                      const t = model.max > 0 ? v / model.max : 0;
                      const bg = v <= 0 ? '#f8fafc' : `rgba(13, 148, 136, ${0.08 + t * 0.92})`;
                      const isBest = model.best.d === d && model.best.h === h && v > 0;
                      return (
                        <td
                          key={h}
                          title={`${name} ${hourLabel(h)} — متوسط ${fmt(v)} ${unit}`}
                          className={`h-11 rounded-md text-center font-bold num transition ${isBest ? 'ring-2 ring-amber-400' : ''}`}
                          style={{ background: bg, color: t > 0.55 ? '#fff' : '#334155' }}
                        >
                          {v > 0 ? (metric === 'sales' ? formatCompact(v) : formatNum(v, 1)) : ''}
                        </td>
                      );
                    })}
                    <td className="rounded-md bg-slate-100 text-center font-extrabold text-slate-800 num">
                      {model.dayTotals[d] > 0 ? (metric === 'sales' ? formatCompact(model.dayTotals[d]) : formatNum(model.dayTotals[d], 0)) : '—'}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th className="pe-2 pt-1 text-start text-[11.5px] font-bold text-slate-500">متوسط الساعة</th>
                  {model.hourTotals.map((v, i) => (
                    <td key={model.hours[i]} className="pt-1 text-center text-[11px] font-bold text-slate-500 num">
                      {v > 0 ? (metric === 'sales' ? formatCompact(v) : formatNum(v, 1)) : ''}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-slate-500">
              أقل
              <span className="h-3 w-40 rounded-full" style={{ background: 'linear-gradient(90deg, rgba(13,148,136,0.08), rgba(13,148,136,1))' }} />
              أكثر
              <span className="ms-3 inline-block h-3 w-3 rounded ring-2 ring-amber-400" /> أقوى ساعة
            </div>
          </div>
        </div>
      </ReportFill>
    </ReportAppWindow>
  );
}

/** 1250000 → 1.25M · 85000 → 85K — لتتسع الأرقام في خانات الخريطة. */
function formatCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1_000) return `${Math.round(n / 1_000)}K`;
  return formatNum(Math.round(n));
}
