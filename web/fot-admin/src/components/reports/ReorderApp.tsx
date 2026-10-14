import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { ReorderRowDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { IconAlert, IconSearch } from '@/components/icons';
import { Input, Select } from '@/components/ui';
import { SummaryStrip } from '@/components/listWorkspace';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';
import { ExcelBtn, PrintBtn, ReportBanner, ReportError, ReportFill, ReportNote } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * مواد ستنفد قريباً — معدل البيع اليومي الصافي مقابل الرصيد = أيام التغطية.
 * يساعد على الطلب قبل النفاد. الرصيد من الإداري (قد يكون سالباً إن لم تُسجَّل المشتريات).
 * ───────────────────────────────────────────────────────────────────────────── */

const BASIS = [7, 14, 30, 60, 90];
const COVER = [3, 7, 14, 21, 30, 45, 60];
const STORE_KEY = 'fot_report_reorder';

type View = 'all' | 'out' | 'negative' | 'low';

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as { days?: number; cover?: number };
    return { days: BASIS.includes(Number(p.days)) ? Number(p.days) : 30, cover: COVER.includes(Number(p.cover)) ? Number(p.cover) : 14 };
  } catch {
    return { days: 30, cover: 14 };
  }
}

function coverBadge(r: ReorderRowDto) {
  if (r.stock < 0) return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">رصيد سالب</span>;
  if (r.stock === 0) return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">نفد</span>;
  const d = r.coverDays;
  const tone = d < 3 ? 'bg-rose-50 text-rose-700' : d < 7 ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800';
  return <span className={`num rounded-full px-2 py-0.5 text-[11.5px] font-bold ${tone}`}>{formatNum(d, 1)} يوم</span>;
}

export function ReorderApp({ onClose }: { onClose: () => void }) {
  const init = loadPrefs();
  const [days, setDays] = useState(init.days);
  const [cover, setCover] = useState(init.cover);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [view, setView] = useState<View>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ days, cover }));
    } catch {
      /* تجاهل */
    }
  }, [days, cover]);

  const q = useQuery({
    queryKey: ['report-reorder', days, cover, debounced],
    queryFn: () => api.reorder(days, cover, debounced || undefined),
    placeholderData: prev => prev,
  });
  const data = q.data;
  const all = data?.rows ?? [];
  const rows =
    view === 'out' ? all.filter(r => r.stock === 0) : view === 'negative' ? all.filter(r => r.stock < 0) : view === 'low' ? all.filter(r => r.stock > 0) : all;
  const negatives = all.filter(r => r.stock < 0).length;
  const suggested = (r: ReorderRowDto) => Math.max(0, Math.ceil(r.dailyRate * cover - Math.max(0, r.stock)));

  const columns: GridColumn<ReorderRowDto>[] = [
    {
      key: 'name',
      header: 'المادة',
      width: 280,
      exportValue: r => fixEdariName(r.name),
      render: r => (
        <Link to={`/products?search=${encodeURIComponent(r.barcode || r.name || '')}`} className="font-semibold text-brand-700 hover:underline">
          {fixEdariName(r.name) || '—'}
        </Link>
      ),
    },
    { key: 'barcode', header: 'الباركود', width: 140, mono: true },
    { key: 'coverDays', header: 'تكفي', width: 110, sortValue: r => (r.stock <= 0 ? -1 : r.coverDays), exportValue: r => (r.stock < 0 ? 'رصيد سالب' : r.stock === 0 ? 'نفد' : r.coverDays), render: coverBadge },
    { key: 'stock', header: 'الرصيد', width: 90, mono: true, render: r => <span className={`font-bold ${r.stock < 0 ? 'text-violet-700' : r.stock === 0 ? 'text-rose-600' : ''}`}>{formatNum(r.stock)}</span> },
    { key: 'dailyRate', header: 'بيع يومي', width: 100, mono: true, render: r => formatNum(r.dailyRate, 1) },
    { key: 'soldQty', header: `مباع (${data?.effectiveDays ?? days} يوم)`, width: 120, mono: true, footer: 'sum' },
    {
      key: 'suggested',
      header: `اقتراح طلب (${cover} يوم)`,
      width: 140,
      mono: true,
      sortValue: suggested,
      exportValue: suggested,
      render: r => <span className="font-extrabold text-emerald-700">{formatNum(suggested(r))}</span>,
    },
    { key: 'price', header: 'السعر', width: 110, mono: true, render: r => formatCurrency(r.price) },
  ];

  function sheets(): ReportExcelSheet[] {
    if (!rows.length) return [];
    return [
      {
        name: 'مواد ستنفد',
        title: `مواد ستنفد خلال ${cover} يوماً`,
        subtitle: `معدل البيع من آخر ${data?.effectiveDays ?? days} يوماً`,
        headers: ['المادة', 'الباركود', 'تكفي (يوم)', 'الرصيد', 'بيع يومي', 'المباع', 'اقتراح الطلب', 'السعر'],
        columnWidths: [240, 120, 70, 60, 64, 64, 80, 80],
        rows: rows.map(r => [
          fixEdariName(r.name),
          r.barcode ?? '',
          r.stock < 0 ? 'رصيد سالب' : r.stock === 0 ? 'نفد' : r.coverDays,
          r.stock,
          Math.round(r.dailyRate * 10) / 10,
          r.soldQty,
          suggested(r),
          r.price,
        ]),
      },
    ];
  }

  const VIEWS: { id: View; label: string; count: number }[] = [
    { id: 'all', label: 'الكل', count: all.length },
    { id: 'low', label: 'رصيد قليل', count: all.filter(r => r.stock > 0).length },
    { id: 'out', label: 'نفد (صفر)', count: all.filter(r => r.stock === 0).length },
    { id: 'negative', label: 'رصيد سالب', count: negatives },
  ];

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #f87171 0%, #b91c1c 100%)"
      title="مواد ستنفد قريباً"
      subtitle={`الرصيد يكفي أقل من ${cover} يوماً حسب البيع في آخر ${data?.effectiveDays ?? days} يوماً`}
      icon={<IconAlert size={20} />}
      toolbar={
        <>
          <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
            تكفي أقل من
            <Select value={cover} onChange={e => setCover(Number(e.target.value))} className="!h-8 !w-24">
              {COVER.map(c => (
                <option key={c} value={c}>
                  {c} يوم
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
            معدل البيع من آخر
            <Select value={days} onChange={e => setDays(Number(e.target.value))} className="!h-8 !w-24">
              {BASIS.map(d => (
                <option key={d} value={d}>
                  {d} يوم
                </option>
              ))}
            </Select>
          </label>
          <div className="relative w-56">
            <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-slate-400">
              <IconSearch size={14} />
            </span>
            <Input className="!h-8 ps-8" placeholder="بحث بالاسم أو الباركود" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {VIEWS.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-bold transition ${view === v.id ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {v.label} <span className="num opacity-75">{formatNum(v.count)}</span>
              </button>
            ))}
          </div>
        </>
      }
      actions={
        <>
          <ExcelBtn fileName={`reorder_${cover}d`} getSheets={sheets} disabled={!rows.length} />
          <PrintBtn title={`مواد ستنفد خلال ${cover} يوماً`} getSheets={sheets} disabled={!rows.length} />
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
            { label: `تكفي أقل من ${cover} يوماً`, value: formatNum(data?.total ?? 0), tone: 'warn' },
            { label: 'تكفي أقل من أسبوع', value: formatNum(data?.underWeek ?? 0), tone: 'danger' },
            { label: 'نفدت أو رصيدها سالب', value: formatNum(data?.outOfStock ?? 0), tone: 'danger' },
            { label: 'رصيد سالب (يحتاج تصحيح)', value: formatNum(negatives), hint: 'بيع أكثر من المسجّل في الإداري' },
          ]}
        />
        <ReportNote bar>
          الرصيد من الإداري. «رصيد سالب» يعني أن المبيع أكثر من المسجّل — غالباً مشتريات أو جرد لم يُدخل في الإداري. «اقتراح الطلب» = ما يكفي {cover} يوماً بمعدل البيع الحالي ناقص الرصيد الموجب.
        </ReportNote>
        <DataGrid
          variant="sheet"
          embedded
          fillHeight
          columns={columns}
          rows={rows}
          getRowId={r => r.articleId}
          loading={q.isLoading}
          storageKey="reorder"
          exportName={`reorder_${cover}d`}
          counterLabel="مادة"
          emptyText="لا مواد تنفد بهذه الشروط"
          rowTone={r => (r.stock < 0 ? 'bg-violet-50/50' : r.stock === 0 ? 'bg-rose-50/50' : undefined)}
        />
      </ReportFill>
    </ReportAppWindow>
  );
}
