import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, daysAgoIso, formatCurrency, formatNum, todayIso } from '@/api/client';
import type { MovementRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { IconTrendUp } from '@/components/icons';
import { Input, Select } from '@/components/ui';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange, isoDate, previousMonthIso } from '@/lib/businessPeriod';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import { ExcelBtn, PrintBtn, ReportBanner, ReportError, ReportFill, ReportNote } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * مقارنة فترتين — المؤشرات الرئيسية مع الفرق، ثم المواد: نمت · تراجعت · جديدة · توقفت.
 * يعتمد على تقرير الصندوق وحركة المواد (صافية بعد المرتجعات) لكل فترة.
 * ───────────────────────────────────────────────────────────────────────────── */

type Range = { from: string; to: string };
type PairId = 'week' | 'month' | 'day' | 'last30' | 'last7' | 'custom';

const PAIRS: { id: PairId; label: string }[] = [
  { id: 'week', label: 'هذا الأسبوع ↔ الأسبوع الماضي' },
  { id: 'month', label: 'هذا الشهر ↔ الشهر الماضي' },
  { id: 'day', label: 'اليوم ↔ أمس' },
  { id: 'last7', label: 'آخر 7 أيام ↔ الـ7 قبلها' },
  { id: 'last30', label: 'آخر 30 يوماً ↔ الـ30 قبلها' },
  { id: 'custom', label: 'مدتان مخصصتان' },
];

type ItemFilter = 'all' | 'up' | 'down' | 'new' | 'stopped';

type CompareRow = {
  articleId: number;
  name: string;
  barcode: string;
  qtyA: number;
  qtyB: number;
  amountA: number;
  amountB: number;
  diff: number;
  pct: number | null;
};

const STORE_KEY = 'fot_report_compare_pair';

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

const ISO = /^d{4}-d{2}-d{2}$/;

/** مدة مخصصة مكتملة ومرتبة (من ≤ إلى)؛ غير المكتملة تعود للبديل. */
function normalize(r: Range, fallback: Range): Range {
  if (!ISO.test(r.from) || !ISO.test(r.to) || Number(r.from.slice(0, 4)) < 2000 || Number(r.to.slice(0, 4)) < 2000) return fallback;
  return r.from <= r.to ? r : { from: r.to, to: r.from };
}

function pctOf(a: number, b: number): number | null {
  if (!b) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-[11.5px] text-slate-400">—</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  return (
    <span className={`num inline-flex items-center gap-0.5 text-[12px] font-extrabold ${flat ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-rose-600'}`}>
      {flat ? '•' : value > 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export function ComparePeriodsApp({ onClose }: { onClose: () => void }) {
  const { periods } = useBusinessPeriod();
  const [pair, setPair] = useState<PairId>(() => {
    try {
      const v = localStorage.getItem(STORE_KEY) as PairId | null;
      return v && PAIRS.some(p => p.id === v) && v !== 'custom' ? v : 'week';
    } catch {
      return 'week';
    }
  });
  const today = todayIso();
  const [custom, setCustom] = useState<{ a: Range; b: Range }>(() => ({
    a: { from: daysAgoIso(6), to: today },
    b: { from: daysAgoIso(13), to: daysAgoIso(7) },
  }));
  const [filter, setFilter] = useState<ItemFilter>('all');

  function choose(p: PairId) {
    setPair(p);
    try {
      if (p !== 'custom') localStorage.setItem(STORE_KEY, p);
    } catch {
      /* تجاهل */
    }
  }

  const { a, b } = useMemo((): { a: Range; b: Range } => {
    switch (pair) {
      case 'week': {
        // الأسبوع الجاري حتى اليوم ↔ نفس عدد الأيام من الأسبوع الماضي
        const cw = periods.currentWeek;
        const pw = periods.previousWeek;
        const aTo = today < cw.to ? today : cw.to;
        const elapsed = Math.max(0, Math.round((new Date(`${aTo}T12:00:00`).getTime() - new Date(`${cw.from}T12:00:00`).getTime()) / 86_400_000));
        const bTo = shift(pw.from, elapsed);
        return { a: { from: cw.from, to: aTo }, b: { from: pw.from, to: bTo < pw.to ? bTo : pw.to } };
      }
      case 'month': {
        // نفس عدد الأيام من الشهر الماضي حتى تكون المقارنة عادلة في منتصف الشهر
        const cur = periods.currentMonth;
        const prev = previousMonthIso();
        const elapsed = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${cur.from}T12:00:00`).getTime()) / 86_400_000);
        const prevTo = shift(prev.from, elapsed);
        return { a: { from: cur.from, to: today }, b: { from: prev.from, to: prevTo < prev.to ? prevTo : prev.to } };
      }
      case 'day':
        return { a: { from: today, to: today }, b: { from: shift(today, -1), to: shift(today, -1) } };
      case 'last7':
        return { a: { from: daysAgoIso(6), to: today }, b: { from: daysAgoIso(13), to: daysAgoIso(7) } };
      case 'last30':
        return { a: { from: daysAgoIso(29), to: today }, b: { from: daysAgoIso(59), to: daysAgoIso(30) } };
      default:
        return { a: normalize(custom.a, { from: daysAgoIso(6), to: today }), b: normalize(custom.b, { from: daysAgoIso(13), to: daysAgoIso(7) }) };
    }
  }, [pair, periods.currentWeek, periods.previousWeek, periods.currentMonth, custom, today]);

  const cashA = useQuery({ queryKey: ['report-cash', a.from, a.to], queryFn: () => api.cashReport(a.from, a.to), placeholderData: p => p });
  const cashB = useQuery({ queryKey: ['report-cash', b.from, b.to], queryFn: () => api.cashReport(b.from, b.to), placeholderData: p => p });
  const movA = useQuery({ queryKey: ['report-movement', a.from, a.to, ''], queryFn: () => api.movement(a.from, a.to), placeholderData: p => p });
  const movB = useQuery({ queryKey: ['report-movement', b.from, b.to, ''], queryFn: () => api.movement(b.from, b.to), placeholderData: p => p });
  const loading = cashA.isLoading || cashB.isLoading || movA.isLoading || movB.isLoading;
  const error = cashA.error || cashB.error || movA.error || movB.error;

  const rows = useMemo(() => {
    const map = new Map<number, CompareRow>();
    const add = (list: MovementRowDto[] | undefined, side: 'A' | 'B') => {
      for (const m of list ?? []) {
        let r = map.get(m.articleId);
        if (!r) {
          r = { articleId: m.articleId, name: fixEdariName(m.name) || '—', barcode: m.barcode ?? '', qtyA: 0, qtyB: 0, amountA: 0, amountB: 0, diff: 0, pct: null };
          map.set(m.articleId, r);
        }
        if (side === 'A') {
          r.qtyA += m.soldQty;
          r.amountA += m.soldAmount;
        } else {
          r.qtyB += m.soldQty;
          r.amountB += m.soldAmount;
        }
      }
    };
    add(movA.data, 'A');
    add(movB.data, 'B');
    const out = [...map.values()];
    for (const r of out) {
      r.diff = r.amountA - r.amountB;
      r.pct = pctOf(r.amountA, r.amountB);
    }
    return out.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  }, [movA.data, movB.data]);

  const counts = useMemo(
    () => ({
      up: rows.filter(r => r.amountB > 0 && r.diff > 0).length,
      down: rows.filter(r => r.amountA > 0 && r.diff < 0).length,
      new: rows.filter(r => r.amountB <= 0 && r.amountA > 0).length,
      stopped: rows.filter(r => r.amountA <= 0 && r.amountB > 0).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    switch (filter) {
      case 'up':
        return rows.filter(r => r.amountB > 0 && r.diff > 0).sort((x, y) => y.diff - x.diff);
      case 'down':
        return rows.filter(r => r.amountA > 0 && r.diff < 0).sort((x, y) => x.diff - y.diff);
      case 'new':
        return rows.filter(r => r.amountB <= 0 && r.amountA > 0).sort((x, y) => y.amountA - x.amountA);
      case 'stopped':
        return rows.filter(r => r.amountA <= 0 && r.amountB > 0).sort((x, y) => y.amountB - x.amountB);
      default:
        return rows;
    }
  }, [rows, filter]);

  const A = cashA.data;
  const B = cashB.data;
  const piecesA = (movA.data ?? []).reduce((s, m) => s + m.soldQty, 0);
  const piecesB = (movB.data ?? []).reduce((s, m) => s + m.soldQty, 0);
  const itemsA = (movA.data ?? []).filter(m => m.soldQty > 0).length;
  const itemsB = (movB.data ?? []).filter(m => m.soldQty > 0).length;

  const kpis: { label: string; a: number; b: number; money?: boolean; invert?: boolean }[] = [
    { label: 'صافي المبيعات', a: A?.totalSales ?? 0, b: B?.totalSales ?? 0, money: true },
    { label: 'فواتير البيع', a: A?.receiptCount ?? 0, b: B?.receiptCount ?? 0 },
    { label: 'متوسط الفاتورة', a: A?.averageTicket ?? 0, b: B?.averageTicket ?? 0, money: true },
    { label: 'القطع المباعة', a: piecesA, b: piecesB },
    { label: 'مواد مختلفة بيعت', a: itemsA, b: itemsB },
    { label: 'المرتجعات', a: A?.returnsTotal ?? 0, b: B?.returnsTotal ?? 0, money: true, invert: true },
  ];

  const labelA = formatPeriodRange(a.from, a.to);
  const labelB = formatPeriodRange(b.from, b.to);

  const columns: GridColumn<CompareRow>[] = [
    {
      key: 'name',
      header: 'المادة',
      width: 260,
      render: r => (
        <Link to={`/products?search=${encodeURIComponent(r.barcode || r.name)}`} className="font-semibold text-brand-700 hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: 'barcode', header: 'الباركود', width: 130, mono: true },
    { key: 'qtyA', header: 'كمية (الحالية)', width: 110, mono: true, footer: 'sum', render: r => <span className="font-bold">{formatNum(r.qtyA)}</span> },
    { key: 'qtyB', header: 'كمية (المقارَنة)', width: 110, mono: true, footer: 'sum', render: r => <span className="text-slate-500">{formatNum(r.qtyB)}</span> },
    { key: 'amountA', header: 'مبلغ (الحالية)', width: 130, mono: true, footer: 'sum', render: r => <span className="font-bold text-header">{formatCurrency(r.amountA)}</span> },
    { key: 'amountB', header: 'مبلغ (المقارَنة)', width: 130, mono: true, footer: 'sum', render: r => <span className="text-slate-500">{formatCurrency(r.amountB)}</span> },
    {
      key: 'diff',
      header: 'الفرق',
      width: 130,
      mono: true,
      footer: 'sum',
      render: r => (
        <span className={`font-extrabold ${r.diff > 0 ? 'text-emerald-700' : r.diff < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
          {r.diff > 0 ? '+' : ''}
          {formatNum(r.diff)}
        </span>
      ),
    },
    {
      key: 'pct',
      header: 'التغيّر',
      width: 100,
      sortValue: r => r.pct ?? (r.amountA > 0 ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER),
      exportValue: r => (r.amountA <= 0 && r.amountB > 0 ? 'توقفت' : r.pct == null ? (r.amountA > 0 ? 'جديدة' : '') : `${r.pct.toFixed(1)}%`),
      render: r =>
        r.pct == null ? (
          r.amountA > 0 ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">جديدة</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">—</span>
          )
        ) : r.amountA <= 0 ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">توقفت</span>
        ) : (
          <Delta value={r.pct} />
        ),
    },
  ];

  function sheets(): ReportExcelSheet[] {
    if (!rows.length) return [];
    return [
      {
        name: 'المؤشرات',
        title: 'مقارنة فترتين — المؤشرات',
        subtitle: `الحالية: ${labelA} · المقارَنة: ${labelB}`,
        headers: ['المؤشر', 'الفترة الحالية', 'فترة المقارنة', 'الفرق', 'التغيّر %'],
        columnWidths: [130, 100, 100, 100, 70],
        rows: kpis.map(k => [k.label, k.a, k.b, k.a - k.b, pctOf(k.a, k.b) == null ? '' : Math.round(pctOf(k.a, k.b)! * 10) / 10]),
      },
      {
        name: 'المواد',
        title: 'مقارنة فترتين — المواد',
        subtitle: `الحالية: ${labelA} · المقارَنة: ${labelB}`,
        headers: ['المادة', 'الباركود', 'كمية الحالية', 'كمية المقارنة', 'مبلغ الحالية', 'مبلغ المقارنة', 'الفرق', 'التغيّر %'],
        columnWidths: [220, 120, 70, 70, 90, 90, 90, 64],
        rows: shown.map(r => [r.name, r.barcode, r.qtyA, r.qtyB, r.amountA, r.amountB, r.diff, r.amountA <= 0 && r.amountB > 0 ? 'توقفت' : r.pct == null ? (r.amountA > 0 ? 'جديدة' : '') : Math.round(r.pct * 10) / 10]),
      },
    ];
  }

  const FILTERS: { id: ItemFilter; label: string; count?: number; tone: string }[] = [
    { id: 'all', label: 'كل المواد', count: rows.length, tone: 'bg-slate-700' },
    { id: 'up', label: 'نمت', count: counts.up, tone: 'bg-emerald-600' },
    { id: 'down', label: 'تراجعت', count: counts.down, tone: 'bg-rose-600' },
    { id: 'new', label: 'جديدة (لم تُبع في المقارنة)', count: counts.new, tone: 'bg-sky-600' },
    { id: 'stopped', label: 'توقفت (لم تُبع الآن)', count: counts.stopped, tone: 'bg-amber-600' },
  ];

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #818cf8 0%, #7c3aed 100%)"
      title="مقارنة فترتين"
      subtitle={`الحالية: ${labelA}  ↔  المقارَنة: ${labelB}`}
      icon={<IconTrendUp size={20} />}
      toolbar={
        <>
          <Select value={pair} onChange={e => choose(e.target.value as PairId)} className="!h-8 !w-64">
            {PAIRS.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          {pair === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-slate-600">
              <span className="text-indigo-700">الحالية</span>
              <Input type="date" className="!h-8 !w-36" value={custom.a.from} onChange={e => setCustom(c => ({ ...c, a: { ...c.a, from: e.target.value } }))} />
              <Input type="date" className="!h-8 !w-36" value={custom.a.to} onChange={e => setCustom(c => ({ ...c, a: { ...c.a, to: e.target.value } }))} />
              <span className="ms-2 text-slate-500">المقارَنة</span>
              <Input type="date" className="!h-8 !w-36" value={custom.b.from} onChange={e => setCustom(c => ({ ...c, b: { ...c.b, from: e.target.value } }))} />
              <Input type="date" className="!h-8 !w-36" value={custom.b.to} onChange={e => setCustom(c => ({ ...c, b: { ...c.b, to: e.target.value } }))} />
            </div>
          )}
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`compare_${a.from}_${b.from}`} getSheets={sheets} disabled={!rows.length} />
          <PrintBtn title={`مقارنة فترتين (${labelA} ↔ ${labelB})`} getSheets={sheets} disabled={!rows.length} />
        </>
      }
      onClose={onClose}
    >
      <ReportFill>
        {error && (
          <ReportBanner>
            <ReportError
              error={error}
              onRetry={() => {
                void cashA.refetch();
                void cashB.refetch();
                void movA.refetch();
                void movB.refetch();
              }}
            />
          </ReportBanner>
        )}

        {/* بطاقات المقارنة */}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-3 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map(k => (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold text-slate-500">{k.label}</span>
                {loading ? null : <Delta value={pctOf(k.a, k.b)} invert={k.invert} />}
              </div>
              {loading ? (
                <div className="skeleton mt-1.5 h-5 w-24" />
              ) : (
                <>
                  <div className="num mt-0.5 text-[17px] font-extrabold text-header">
                    {formatNum(Math.round(k.a))}
                    {k.money && <span className="ms-1 text-[10.5px] font-semibold text-slate-400">IQD</span>}
                  </div>
                  <div className="num text-[11px] text-slate-400">
                    كان {formatNum(Math.round(k.b))} · {k.a - k.b >= 0 ? '+' : ''}
                    {formatNum(Math.round(k.a - k.b))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold transition ${
                filter === f.id ? 'border-transparent bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${f.tone}`} />
              {f.label}
              <span className={`num rounded-full px-1.5 text-[10.5px] ${filter === f.id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{formatNum(f.count ?? 0)}</span>
            </button>
          ))}
        </div>
        <ReportNote bar>
          المبالغ صافية بعد المرتجعات. «الشهر» يقارن نفس عدد الأيام من الشهر الماضي. الترتيب حسب حجم الفرق — اضغط عنوان أي عمود لتغييره.
        </ReportNote>
        <DataGrid
          variant="sheet"
          embedded
          fillHeight
          columns={columns}
          rows={shown}
          getRowId={r => r.articleId}
          loading={movA.isLoading || movB.isLoading}
          storageKey="compare-periods"
          exportName={`compare_${a.from}_${b.from}`}
          counterLabel="مادة"
          emptyText="لا مواد في هذا التصنيف"
          rowTone={r => (r.amountB <= 0 && r.amountA > 0 ? 'bg-sky-50/50' : r.amountA <= 0 && r.amountB > 0 ? 'bg-amber-50/50' : undefined)}
        />
      </ReportFill>
    </ReportAppWindow>
  );
}
