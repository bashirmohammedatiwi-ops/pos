import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { SlowMoverRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { IconPackage, IconSearch } from '@/components/icons';
import { Input, Select } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import { ExcelBtn, Money, PrintBtn, ReportBanner, ReportError, ReportFill, ReportNote } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * المواد الراكدة — رصيد في المخزن بلا بيع منذ مدة. الأعلى قيمةً أولاً (مال مجمَّد).
 * ───────────────────────────────────────────────────────────────────────────── */

const DAY_OPTIONS = [7, 14, 30, 60, 90, 180, 365];
const STORE_KEY = 'fot_report_slow_movers';

function loadPrefs(): { days: number; minStock: number } {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as { days?: number; minStock?: number };
    return {
      days: DAY_OPTIONS.includes(Number(p.days)) ? Number(p.days) : 30,
      minStock: Number.isFinite(Number(p.minStock)) && Number(p.minStock) > 0 ? Number(p.minStock) : 1,
    };
  } catch {
    return { days: 30, minStock: 1 };
  }
}

function dateAr(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysSince(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export function SlowMoversApp({ onClose }: { onClose: () => void }) {
  const initial = loadPrefs();
  const [days, setDays] = useState(initial.days);
  const [minStock, setMinStock] = useState(initial.minStock);
  const [minStockText, setMinStockText] = useState(String(initial.minStock));
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [onlyNever, setOnlyNever] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ days, minStock }));
    } catch {
      /* تجاهل */
    }
  }, [days, minStock]);

  const q = useQuery({
    queryKey: ['report-slow-movers', days, minStock, debounced, onlyNever],
    queryFn: () => api.slowMovers(days, minStock, debounced || undefined, onlyNever),
    placeholderData: prev => prev,
  });
  const data = q.data;
  const allRows = data?.rows ?? [];
  const rows = onlyNever ? allRows.filter(r => !r.lastSaleDate) : allRows;
  const listedTotal = onlyNever ? data?.neverSoldCount ?? 0 : data?.totalCount ?? 0;
  const truncated = data ? listedTotal > allRows.length : false;
  const posStart = data?.posStartDate ? dateAr(data.posStartDate) : '';

  const columns: GridColumn<SlowMoverRowDto>[] = [
    {
      key: 'name',
      header: 'المادة',
      width: 300,
      exportValue: r => fixEdariName(r.name),
      render: r => (
        <Link to={`/products?search=${encodeURIComponent(r.barcode || r.name || '')}`} className="font-semibold text-brand-700 hover:underline">
          {fixEdariName(r.name) || '—'}
        </Link>
      ),
    },
    { key: 'barcode', header: 'الباركود', width: 140, mono: true },
    { key: 'stock', header: 'الرصيد', width: 90, mono: true, footer: 'sum', render: r => <span className="font-bold">{formatNum(r.stock)}</span> },
    { key: 'price', header: 'السعر', width: 110, mono: true, render: r => formatCurrency(r.price) },
    {
      key: 'stockValue',
      header: 'قيمة المخزون',
      width: 140,
      mono: true,
      footer: 'sum',
      render: r => <span className="font-extrabold text-amber-700">{formatCurrency(r.stockValue)}</span>,
    },
    {
      key: 'lastSaleDate',
      header: 'آخر بيع',
      width: 170,
      sortValue: r => (r.lastSaleDate ? new Date(r.lastSaleDate).getTime() : 0),
      exportValue: r => (r.lastSaleDate ? dateAr(r.lastSaleDate) : 'لم تُبع'),
      render: r =>
        r.lastSaleDate ? (
          <span>
            {dateAr(r.lastSaleDate)} <span className="text-[11px] text-slate-400">· منذ {formatNum(daysSince(r.lastSaleDate) ?? 0)} يوم</span>
          </span>
        ) : (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700">لم تُبع في نقاط البيع</span>
        ),
    },
    { key: 'totalSoldQty', header: 'مجموع المباع سابقاً', width: 130, mono: true, render: r => (r.totalSoldQty ? formatNum(r.totalSoldQty) : '—') },
  ];

  function sheets(): ReportExcelSheet[] {
    if (!rows.length) return [];
    return [
      {
        name: 'المواد الراكدة',
        title: `المواد الراكدة — بلا بيع منذ ${days} يوماً`,
        subtitle: `رصيد ≥ ${formatNum(minStock)} · ${formatNum(rows.length)} مادة`,
        headers: ['المادة', 'الباركود', 'الرصيد', 'السعر', 'قيمة المخزون', 'آخر بيع', 'مجموع المباع سابقاً'],
        columnWidths: [240, 120, 64, 80, 100, 100, 90],
        rows: rows.map(r => [
          fixEdariName(r.name),
          r.barcode ?? '',
          r.stock,
          r.price,
          r.stockValue,
          r.lastSaleDate ? dateAr(r.lastSaleDate) : 'لم تُبع',
          r.totalSoldQty,
        ]),
      },
    ];
  }

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #fb923c 0%, #c2410c 100%)"
      title="المواد الراكدة"
      subtitle={`مواد في المخزن بلا بيع منذ ${days} يوماً · الأعلى قيمةً أولاً`}
      icon={<IconPackage size={20} />}
      toolbar={
        <>
          <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
            بلا بيع منذ
            <Select value={days} onChange={e => setDays(Number(e.target.value))} className="!h-8 !w-28">
              {DAY_OPTIONS.map(d => (
                <option key={d} value={d}>
                  {d} يوماً
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
            رصيد لا يقل عن
            <Input
              className="num !h-8 !w-20 text-center"
              inputMode="decimal"
              value={minStockText}
              onChange={e => setMinStockText(e.target.value)}
              onBlur={() => {
                const n = Number(minStockText);
                const v = Number.isFinite(n) && n > 0 ? n : 1;
                setMinStock(v);
                setMinStockText(String(v));
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <div className="relative w-56">
            <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
              <IconSearch size={14} />
            </span>
            <Input className="!h-8 ps-8" placeholder="بحث بالاسم أو الباركود" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
            <input type="checkbox" checked={onlyNever} onChange={e => setOnlyNever(e.target.checked)} className="h-4 w-4 accent-orange-600" />
            التي لم تُبع إطلاقاً فقط
          </label>
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`مواد-راكدة-${days}-يوم`} getSheets={sheets} disabled={!rows.length} />
          <PrintBtn title={`المواد الراكدة — بلا بيع منذ ${days} يوماً`} getSheets={sheets} disabled={!rows.length} />
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
            { label: 'مواد راكدة', value: formatNum(data?.totalCount ?? 0), tone: 'warn' },
            { label: 'قيمة المخزون المجمَّد', value: <Money value={data?.totalValue ?? 0} />, tone: 'warn' },
            { label: 'لم تُبع في نقاط البيع إطلاقاً', value: formatNum(data?.neverSoldCount ?? 0) },
            { label: 'بيعت سابقاً ثم توقفت', value: formatNum((data?.totalCount ?? 0) - (data?.neverSoldCount ?? 0)), tone: 'brand' },
          ]}
        />
        <ReportNote bar>
          {posStart ? `نقاط البيع تعمل منذ ${posStart} — «لم تُبع» تعني لم تُبع منذ ذلك التاريخ. ` : ''}
          {truncated ? `يُعرض أعلى ${formatNum(allRows.length)} مادة قيمةً من ${formatNum(listedTotal)}. ` : ''}
          اضغط اسم المادة لفتحها في صفحة المنتجات.
        </ReportNote>
        <DataGrid
          variant="sheet"
          embedded
          fillHeight
          columns={columns}
          rows={rows}
          getRowId={r => r.articleId}
          loading={q.isLoading}
          storageKey="slow-movers"
          exportName={`مواد-راكدة-${days}-يوم`}
          counterLabel="مادة"
          emptyText="لا مواد راكدة بهذه الشروط"
        />
      </ReportFill>
    </ReportAppWindow>
  );
}
