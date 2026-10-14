import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { daysAgoIso, formatNum } from '@/api/client';
import { IconAlert, IconCalendar, IconChart, IconDownload, IconPrinter, IconRefresh } from '@/components/icons';
import { useToast } from '@/components/Toast';
import { Alert, Btn, EmptyState, Input, Skeleton } from '@/components/ui';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange, isoDate, previousMonthIso } from '@/lib/businessPeriod';
import { printDocument } from '@/lib/print';
import { downloadReportExcel, type ReportExcelSheet } from '@/lib/reportExcel';

/* ─────────────────────────────────────────────────────────────────────────────
 * أدوات التقارير المشتركة — فترة موحدة، مؤشرات، رسوم بسيطة، تصدير وطباعة وحالات.
 * ───────────────────────────────────────────────────────────────────────────── */

/* ── الفترة ── */

export type ReportPeriodId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'lastWeek'
  | 'month'
  | 'lastMonth'
  | 'last30'
  | 'all'
  | 'custom';

export const PERIOD_LABEL: Record<ReportPeriodId, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'هذا الأسبوع',
  lastWeek: 'الأسبوع الماضي',
  month: 'هذا الشهر',
  lastMonth: 'الشهر الماضي',
  last30: '30 يوماً',
  all: 'منذ البداية',
  custom: 'مدة مخصصة',
};

export type DateRange = { from: string; to: string };

function shiftIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

type StoredPeriod = { period?: ReportPeriodId; from?: string; to?: string };

function readStored(key?: string): StoredPeriod | null {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(`fot_report_period_${key}`) || 'null') as StoredPeriod | null;
  } catch {
    return null;
  }
}

/** تاريخ مخصص مكتمل وصالح (يتجاهل السنوات الجزئية أثناء الكتابة مثل 0002-10-13). */
function isValidCustomIso(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 2000;
}

function writeStored(key: string | undefined, v: StoredPeriod) {
  if (!key) return;
  try {
    localStorage.setItem(`fot_report_period_${key}`, JSON.stringify(v));
  } catch { /* تجاهل */ }
}

export type ReportPeriodState = ReturnType<typeof useReportPeriod>;

/**
 * فترة التقرير: أزرار جاهزة + مدة مخصصة. تُستعاد الفترات الجاهزة فقط لكل تقرير على هذا الجهاز؛
 * المدة المخصصة لا تُستعاد عند إعادة الفتح (يعود التقرير لفترته الافتراضية).
 * `initial` (من الرابط مثلاً) يفرض مدة مخصصة عند الفتح.
 */
export function useReportPeriod({
  storageKey,
  presets,
  fallback,
  initial,
}: {
  storageKey?: string;
  presets: ReportPeriodId[];
  fallback: ReportPeriodId;
  initial?: DateRange | null;
}) {
  const { periods, settings } = useBusinessPeriod();
  const today = isoDate(new Date());
  const [state] = useState(() => {
    if (initial?.from && initial?.to) return { period: 'custom' as ReportPeriodId, from: initial.from, to: initial.to };
    const s = readStored(storageKey);
    const p = s?.period && s.period !== 'custom' && presets.includes(s.period) ? s.period : fallback;
    return { period: p, from: periods.currentWeek.from, to: periods.currentWeek.to };
  });
  const [period, setPeriodRaw] = useState<ReportPeriodId>(state.period);
  const [customFrom, setCustomFrom] = useState(state.from);
  const [customTo, setCustomTo] = useState(state.to);

  const lastValidRef = useRef<DateRange | null>(null);

  const resolve = (p: ReportPeriodId): DateRange | null => {
    if (p === 'today') return { from: today, to: today };
    if (p === 'yesterday') {
      const y = shiftIso(today, -1);
      return { from: y, to: y };
    }
    if (p === 'week') return periods.currentWeek;
    if (p === 'lastWeek') return periods.previousWeek;
    if (p === 'month') return periods.currentMonth;
    if (p === 'lastMonth') return previousMonthIso();
    if (p === 'last30') return { from: daysAgoIso(29), to: today };
    if (p === 'all') return { from: '2020-01-01', to: today };
    const a = customFrom || today;
    const b = customTo || today;
    if (!isValidCustomIso(a) || !isValidCustomIso(b)) return null;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  };

  const range = useMemo(
    () => {
      // مدة مخصصة غير مكتملة (أثناء الكتابة) → نبقي آخر مدة صالحة
      const r = resolve(period) ?? lastValidRef.current ?? { from: today, to: today };
      lastValidRef.current = r;
      return r;
    },
    [period, periods.currentWeek.from, periods.currentWeek.to, periods.previousWeek.from, periods.currentMonth.from, customFrom, customTo, today],
  );

  useEffect(() => {
    writeStored(storageKey, { period, from: customFrom, to: customTo });
  }, [storageKey, period, customFrom, customTo]);

  function setPeriod(p: ReportPeriodId) {
    // عند التحويل إلى مدة مخصصة نبدأ من الفترة المعروضة حالياً
    if (p === 'custom' && period !== 'custom') {
      setCustomFrom(range.from);
      setCustomTo(range.to);
    }
    setPeriodRaw(p);
  }

  function setCustom(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriodRaw('custom');
  }

  return {
    period,
    setPeriod,
    presets,
    range,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    setCustom,
    settings,
    label: period === 'custom' ? formatPeriodRange(range.from, range.to) : PERIOD_LABEL[period],
  };
}

/** شريط اختيار الفترة: أزرار مجزأة + حقلا تاريخ للمدة المخصصة. */
export function PeriodSelector({ state, extra }: { state: ReportPeriodState; extra?: ReactNode }) {
  const { period, setPeriod, presets, customFrom, customTo, setCustomFrom, setCustomTo, range } = state;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="flex flex-wrap rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="الفترة">
        {presets.map(id => {
          const active = period === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPeriod(id)}
              className={`h-7 rounded-md px-2.5 text-[12px] font-semibold transition ${
                active
                  ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-header'
              }`}
            >
              {PERIOD_LABEL[id]}
            </button>
          );
        })}
      </div>
      {period === 'custom' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            aria-label="من تاريخ"
            value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="!h-8 !w-[140px] !py-1 text-[12.5px]"
          />
          <span className="text-[12px] text-slate-400">←</span>
          <Input
            type="date"
            aria-label="إلى تاريخ"
            value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="!h-8 !w-[140px] !py-1 text-[12.5px]"
          />
        </div>
      ) : (
        <span className="hidden items-center gap-1.5 text-[12px] text-slate-500 lg:inline-flex">
          <IconCalendar size={14} className="text-slate-400" />
          <span className="num">{formatPeriodRange(range.from, range.to)}</span>
        </span>
      )}
      {extra}
    </div>
  );
}

/* ── تخطيط ── */

/** شريط أدوات تحت رأس النافذة. */
export function ReportToolbar({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5" data-print-hide>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {end && <div className="flex shrink-0 flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/** منطقة المحتوى القابلة للتمرير. */
export function ReportBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className={`space-y-4 p-4 ${className}`}>{children}</div>
    </div>
  );
}

/** صف مؤشرات KPI. */
export function KpiRow({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const grid = {
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-4',
    5: 'sm:grid-cols-3 xl:grid-cols-5',
    6: 'sm:grid-cols-3 xl:grid-cols-6',
  }[cols];
  return <div className={`grid gap-3 ${grid}`}>{children}</div>;
}

/** مبلغ بعملة صغيرة باهتة. */
export function Money({ value, currency = 'IQD', className = '' }: { value: number; currency?: string; className?: string }) {
  return (
    <span className={`num ${className}`}>
      {formatNum(value)}
      <span className="ms-1 text-[0.62em] font-semibold text-slate-400">{currency}</span>
    </span>
  );
}

/** فرق نسبي بين قيمتين (٪) أو null. */
export function pctDelta(now: number, prev: number | null | undefined): number | null {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

/* ── حالات ── */

export function ReportLoading({ kpis = 4, rows = 8 }: { kpis?: number; rows?: number }) {
  return (
    <div className="space-y-4" aria-busy>
      {kpis > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className="card space-y-3 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
      )}
      <div className="card space-y-2.5 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton h-7 w-full" style={{ opacity: 1 - i * 0.09 }} />
        ))}
      </div>
    </div>
  );
}

export function errorText(e: unknown, fallback = 'تعذّر تحميل التقرير') {
  if (!e) return fallback;
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const j = JSON.parse(raw) as { message?: string; error?: string };
    return j.message || j.error || raw || fallback;
  } catch {
    return raw || fallback;
  }
}

export function ReportError({ error, onRetry, title = 'تعذّر تحميل التقرير' }: { error?: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert type="error" title={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{errorText(error, 'تحقق من الاتصال بالخادم ثم أعد المحاولة.')}</span>
        {onRetry && (
          <Btn size="xs" variant="secondary" icon={<IconRefresh size={13} />} onClick={onRetry}>
            إعادة المحاولة
          </Btn>
        )}
      </div>
    </Alert>
  );
}

export function ReportEmpty({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card">
      <EmptyState title={title} description={description} action={action} icon={icon} />
    </div>
  );
}

/* ── تصدير وطباعة ── */

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** يبني صفحة A4 للطباعة من نفس أوراق الإكسل. */
export function reportSheetsHtml(title: string, sheets: ReportExcelSheet[]) {
  const body = sheets
    .map(s => {
      const head = s.headers.map(h => `<th>${esc(h)}</th>`).join('');
      const rows = s.rows
        .map(r => `<tr>${r.map(c => (typeof c === 'number' ? `<td class="n">${esc(formatNum(c, 2))}</td>` : `<td>${esc(String(c ?? ''))}</td>`)).join('')}</tr>`)
        .join('');
      return `<section><h2>${esc(s.title || s.name)}</h2>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ''}
        <table><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${s.headers.length}" class="empty">لا بيانات</td></tr>`}</tbody></table></section>`;
    })
    .join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 20px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f9f76; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 19px; margin: 0; } h2 { font-size: 14px; margin: 18px 0 4px; }
  .sub { color: #64748b; font-size: 11.5px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  thead th { background: #f1f5f9; color: #334155; padding: 6px; text-align: right; border-bottom: 1px solid #cbd5e1; }
  tbody td { border-bottom: 1px solid #e2e8f0; padding: 5px 6px; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .n { text-align: left; font-variant-numeric: tabular-nums; } .empty { text-align: center; color: #94a3b8; padding: 16px; }
  footer { margin-top: 18px; color: #94a3b8; font-size: 10.5px; text-align: center; }
  @media print { body { margin: 10mm; } thead { display: table-header-group; } section { break-inside: auto; } }
</style></head><body>
<header><h1>${esc(title)}</h1><span class="sub">${esc(new Date().toLocaleString('ar-IQ'))}</span></header>
${body}
<footer>FOT POS — تقرير مطبوع من لوحة الإدارة</footer>
</body></html>`;
}

/** زر Excel موحّد — يبني الأوراق عند الضغط فقط. */
export function ExcelBtn({
  fileName,
  getSheets,
  disabled,
  label = 'Excel',
  variant = 'secondary',
}: {
  fileName: string;
  getSheets: () => ReportExcelSheet[] | Promise<ReportExcelSheet[]>;
  disabled?: boolean;
  label?: string;
  variant?: 'secondary' | 'primary' | 'ghost';
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      size="sm"
      variant={variant}
      icon={<IconDownload size={14} />}
      disabled={disabled || busy}
      loading={busy}
      title="تصدير إلى Excel"
      onClick={async () => {
        setBusy(true);
        try {
          const sheets = (await getSheets()).filter(s => s.rows.length > 0);
          if (!sheets.length) {
            toast.info('لا توجد بيانات للتصدير');
            return;
          }
          downloadReportExcel(fileName, sheets);
          toast.success('تم تنزيل ملف Excel');
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'تعذّر التصدير');
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Btn>
  );
}

/** زر طباعة موحّد — يطبع نفس أوراق الإكسل بتنسيق A4. */
export function PrintBtn({
  title,
  getSheets,
  disabled,
}: {
  title: string;
  getSheets: () => ReportExcelSheet[];
  disabled?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      size="sm"
      variant="ghost"
      icon={<IconPrinter size={14} />}
      disabled={disabled}
      loading={busy}
      title="طباعة التقرير"
      onClick={async () => {
        const sheets = getSheets();
        if (!sheets.length) {
          toast.info('لا بيانات للطباعة');
          return;
        }
        setBusy(true);
        try {
          await printDocument(reportSheetsHtml(title, sheets));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
        } finally {
          setBusy(false);
        }
      }}
    >
      طباعة
    </Btn>
  );
}

/* ── رسوم بيانية بسيطة (CSS) — لون العلامة فقط ── */

export type BarSeries = { key: string; label: string };
export type BarItem = { id: string | number; label: string; values: number[]; sub?: string };

const SERIES_CLASS = ['bg-brand-600', 'bg-brand-300'];

/**
 * أعمدة أفقية: اسم · شريط · قيمة. تلميح عند المرور، ومفتاح ألوان عند وجود سلسلتين.
 */
export function HBarChart({
  items,
  series,
  format = n => formatNum(n),
  onSelect,
  emptyText = 'لا بيانات',
}: {
  items: BarItem[];
  series: BarSeries[];
  format?: (n: number) => string;
  onSelect?: (item: BarItem) => void;
  emptyText?: string;
}) {
  const max = Math.max(1, ...items.flatMap(i => i.values));
  const [hover, setHover] = useState<string | number | null>(null);
  if (!items.length) return <p className="py-6 text-center text-[12.5px] text-slate-400">{emptyText}</p>;
  return (
    <div>
      {series.length >= 2 && <ChartLegend series={series} />}
      <ul className="space-y-2">
        {items.map(item => {
          const Tag = onSelect ? 'button' : 'div';
          const active = hover === item.id;
          return (
            <li key={item.id} className="relative">
              <Tag
                type={onSelect ? 'button' : undefined}
                onClick={onSelect ? () => onSelect(item) : undefined}
                onMouseEnter={() => setHover(item.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(item.id)}
                onBlur={() => setHover(null)}
                className={`grid w-full grid-cols-[minmax(80px,140px)_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5 text-right ${
                  onSelect ? 'transition hover:bg-slate-50 focus-visible:bg-slate-50' : ''
                }`}
              >
                <span className="truncate text-[12px] font-medium text-slate-700" title={item.label}>{item.label}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  {item.values.map((v, si) => (
                    <span key={si} className="block h-2.5 w-full overflow-hidden rounded bg-slate-100">
                      <span
                        className={`block h-full rounded transition-[width] duration-300 ${SERIES_CLASS[si] ?? SERIES_CLASS[0]} ${active ? 'opacity-100' : 'opacity-90'}`}
                        style={{ width: `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%` }}
                      />
                    </span>
                  ))}
                </span>
                <span className="min-w-[72px] text-left text-[12px] font-semibold text-header num">{format(item.values[0] ?? 0)}</span>
              </Tag>
              {active && (
                <ChartTooltip className="bottom-full start-1/3 mb-1">
                  <p className="font-bold">{item.label}</p>
                  {series.map((s, si) => (
                    <p key={s.key} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-sm ${SERIES_CLASS[si] ?? SERIES_CLASS[0]}`} />
                      {s.label}: <span className="num font-semibold">{format(item.values[si] ?? 0)}</span>
                    </p>
                  ))}
                  {item.sub && <p className="text-slate-300">{item.sub}</p>}
                </ChartTooltip>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type ColumnPoint = { id: string; label: string; value: number; tooltip?: ReactNode };

/** أعمدة رأسية لسلسلة زمنية واحدة (يومي). */
export function ColumnChart({
  points,
  format = n => formatNum(n),
  height = 150,
  seriesLabel,
}: {
  points: ColumnPoint[];
  format?: (n: number) => string;
  height?: number;
  seriesLabel?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (!points.length) return <p className="py-6 text-center text-[12.5px] text-slate-400">لا بيانات</p>;
  const max = Math.max(1, ...points.map(p => p.value));
  const avg = points.reduce((s, p) => s + p.value, 0) / points.length;
  const step = Math.max(1, Math.ceil(points.length / 14));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          الأعلى <span className="num font-semibold text-slate-600">{format(max)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t border-dashed border-slate-400" />
          المتوسط <span className="num font-semibold text-slate-600">{format(avg)}</span>
        </span>
      </div>
      <div className="relative" style={{ height }}>
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-300"
          style={{ bottom: `${(avg / max) * 100}%` }}
        />
        <div className="absolute inset-0 flex items-end gap-[3px] border-b border-slate-200" dir="ltr">
          {points.map(p => {
            const active = hover === p.id;
            return (
              <div
                key={p.id}
                className="relative flex h-full min-w-[6px] flex-1 items-end justify-center"
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className={`w-full max-w-[36px] rounded-t transition-colors ${active ? 'bg-brand-700' : 'bg-brand-600/85'}`}
                  style={{ height: `${p.value > 0 ? Math.max(2, (p.value / max) * 100) : 0}%` }}
                  aria-label={`${p.label}: ${format(p.value)}`}
                />
                {active && (
                  <ChartTooltip className="bottom-full left-1/2 mb-1 -translate-x-1/2">
                    <p className="font-bold">{p.label}</p>
                    <p>
                      {seriesLabel ? `${seriesLabel}: ` : ''}
                      <span className="num font-semibold">{format(p.value)}</span>
                    </p>
                    {p.tooltip}
                  </ChartTooltip>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[3px]" dir="ltr">
        {points.map((p, i) => (
          <span key={p.id} className="min-w-[6px] flex-1 truncate text-center text-[10.5px] text-slate-400">
            {i % step === 0 ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChartTooltip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      dir="rtl"
      role="tooltip"
      className={`pointer-events-none absolute z-20 min-w-[140px] whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11.5px] leading-5 text-white shadow-lg ${className}`}
    >
      {children}
    </div>
  );
}

export function ChartLegend({ series }: { series: BarSeries[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-[11.5px] text-slate-600">
      {series.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${SERIES_CLASS[i] ?? SERIES_CLASS[0]}`} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** تنبيه نصي صغير داخل التقرير. `bar` = شريط رفيع بعرض النافذة فوق الجدول. */
export function ReportNote({ children, tone = 'info', bar }: { children: ReactNode; tone?: 'info' | 'warn'; bar?: boolean }) {
  if (bar) {
    return (
      <div
        className={`flex shrink-0 items-start gap-2 border-b px-3 py-1.5 text-[11.5px] leading-5 ${
          tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50/70 text-slate-600'
        }`}
      >
        <IconAlert size={13} className={`mt-1 shrink-0 ${tone === 'warn' ? 'text-amber-600' : 'text-slate-400'}`} />
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-5 ${
        tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600'
      }`}
    >
      <IconAlert size={14} className={`mt-0.5 shrink-0 ${tone === 'warn' ? 'text-amber-600' : 'text-slate-400'}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ── تخطيط ملء الشاشة: شريط مجاميع · جدول يملأ الارتفاع · مخطط مطوي/جانبي ── */

/** عمود يملأ باقي ارتفاع النافذة (ضع داخله SummaryStrip ثم ReportSplit/DataGrid fillHeight). */
export function ReportFill({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

/** شريط رفيع (خطأ/تنبيه) فوق الجدول بلا هوامش كبيرة. */
export function ReportBanner({ children }: { children: ReactNode }) {
  return <div className="shrink-0 border-b border-slate-200 px-3 py-2">{children}</div>;
}

/** حالة فارغة/تحميل تتوسط المساحة المتبقية. */
export function ReportCenter({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">{children}</div>;
}

const CHART_KEY = 'fot_report_chart_open';

/** إظهار المخطط: يُحفظ على هذا الجهاز. افتراضياً ظاهر على الشاشات العريضة فقط (عمود جانبي). */
export function useChartDock() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(CHART_KEY);
      if (v === '1' || v === '0') return v === '1';
    } catch { /* تجاهل */ }
    try {
      return window.matchMedia('(min-width: 1280px)').matches;
    } catch {
      return false;
    }
  });
  function toggle() {
    setOpen(v => {
      const next = !v;
      try {
        localStorage.setItem(CHART_KEY, next ? '1' : '0');
      } catch { /* تجاهل */ }
      return next;
    });
  }
  return { open, toggle };
}

export type ChartDock = ReturnType<typeof useChartDock>;

/** زر «مخطط» — يوضع في شريط أدوات الجدول (toolbar) فلا يأخذ صفاً إضافياً. */
export function ChartToggle({ dock }: { dock: ChartDock }) {
  return (
    <button
      type="button"
      aria-pressed={dock.open}
      onClick={dock.toggle}
      title={dock.open ? 'إخفاء المخطط' : 'إظهار المخطط'}
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11.5px] font-semibold transition ${
        dock.open ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      <IconChart size={13} />
      مخطط
    </button>
  );
}

/**
 * الجدول + مخطط اختياري: على الشاشات العريضة عمود جانبي بعرض ثابت،
 * وعلى الأضيق قسم أعلى الجدول بارتفاع محدود — لا يدفع الجدول خارج الشاشة.
 */
export function ReportSplit({ chart, open, children }: { chart?: ReactNode; open: boolean; children: ReactNode }) {
  const show = !!chart && open;
  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      {show && (
        <aside
          aria-label="مخطط"
          className="order-first max-h-[34vh] shrink-0 overflow-y-auto border-b border-slate-200 bg-white xl:order-last xl:max-h-none xl:w-[360px] xl:border-b-0 xl:border-s 2xl:w-[400px]"
        >
          {chart}
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** قسم مخطط صغير بعنوان داخل ReportSplit. */
export function ChartBlock({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12px] font-bold text-header">{title}</h3>
          {subtitle && <p className="truncate text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="px-3 pb-3 pt-2">{children}</div>
    </section>
  );
}

/** نسبة التغيّر كنص قصير للمجاميع («▲ 12% عن السابقة»). */
export function deltaText(delta: number | null, suffix = 'عن السابقة') {
  if (delta == null || !Number.isFinite(delta)) return undefined;
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '•';
  return `${arrow} ${formatNum(Math.abs(Math.round(delta)))}% ${suffix}`;
}
