import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { formatNum, todayIso } from '@/api/client';
import { EDARI_SALES_MAX_DAYS, edariSalesApi, type EdariSalesReport, type SalesItem } from '@/api/edariSales';
import { useToast } from '@/components/Toast';
import { IconChevronLeft, IconChevronRight, IconDownload, IconFilter, IconFolder, IconLayers, IconPackage, IconPrinter, IconRefresh, IconSearch, IconX } from '@/components/icons';
import { Btn, Input } from '@/components/ui';
import { isoDate } from '@/lib/businessPeriod';
import { printDocument } from '@/lib/print';
import { downloadReportExcel } from '@/lib/reportExcel';
import { ReportAppWindow } from './ReportAppWindow';
import { ColumnChart, ReportBanner, ReportError, ReportFill } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تقرير المبيعات (الإداري) — نفس حساب تقرير تطبيق الحسابات، من الإداري مباشرة:
 *  · إجمالي النظام: مبيعات / مردود / هدايا / صافٍ، مع الأيام والفروع.
 *  · أشجار المواد: ادخل الشجرة لترى مجموعاتها ثم موادها ثم حركات المادة في الفواتير.
 *  · فلتر الفروع (136، 138، الكاشيرات، الدلفري…) وبحث عن مادة لها حركة في الفترة.
 *  · طباعة A4 وتصدير Excel لما هو معروض.
 * ───────────────────────────────────────────────────────────────────────────── */

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
const dayTitle = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const dm = (iso: string) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n0 = (v: number) => formatNum(Math.round(v));
const qty = (v: number) => (Number.isInteger(v) ? formatNum(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

export function EdariSalesApp({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [branches, setBranches] = useState<string[]>([]);
  const [node, setNode] = useState<number | null>(null);
  const [nodeLeaf, setNodeLeaf] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [branchOpen, setBranchOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [printing, setPrinting] = useState(false);

  // البحث بعد توقف الكتابة
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const f = valid && from <= to ? from : to;
  const span = valid ? Math.round((Date.parse(to) - Date.parse(f)) / 86_400_000) : 0;
  const tooLong = span > EDARI_SALES_MAX_DAYS;

  const q = useQuery({
    queryKey: ['edari-sales', f, to, branches.join(','), node, nodeLeaf, search, compare],
    queryFn: () => edariSalesApi.report({ from: f, to, branches, node, q: search, lines: nodeLeaf, compare }),
    enabled: valid && !tooLong,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: to >= today ? 120_000 : false,
  });
  const r = q.data ?? null;
  const single = f === to;

  function setDay(d: string) {
    setFrom(d);
    setTo(d);
  }
  function open(item: SalesItem) {
    setSearchText('');
    setSearch('');
    setNode(item.seq);
    setNodeLeaf(item.leaf);
  }
  function goTo(seq: number | null) {
    setSearchText('');
    setSearch('');
    setNode(seq);
    setNodeLeaf(false);
  }
  function toggleBranch(code: string) {
    setBranches(prev => (prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]));
  }

  const scope = r ? (r.node ? r.nodeTotals : r.totals) : null;
  const base = r ? Math.max(1, ...r.items.filter(i => !i.excluded).map(i => Math.abs(i.net))) : 1;
  const included = useMemo(() => r?.items.filter(i => !i.excluded) ?? [], [r]);
  const excluded = useMemo(() => r?.items.filter(i => i.excluded) ?? [], [r]);
  const selectable = r?.branches.filter(b => b.code) ?? [];
  const title = r?.node ? r.node.name : 'كل أشجار المواد';

  async function print() {
    if (!r) return;
    setPrinting(true);
    try {
      await printDocument(reportHtml(r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
    }
  }

  function exportExcel() {
    if (!r) return;
    const period = r.from === r.to ? dmy(r.from) : `${dmy(r.from)} — ${dmy(r.to)}`;
    const sheets = [
      {
        name: r.lines ? 'المواد' : 'الأشجار والمواد',
        title: `مبيعات ${title} — ${period}`,
        headers: ['الرقم', 'الاسم', 'النوع', 'كمية البيع', 'المبيعات', 'كمية الهدايا', 'الهدايا', 'كمية المردود', 'المردود', 'الصافي', 'خارج الإجمالي'],
        rows: [
          ...r.items.map(i => [i.num, i.name, i.leaf ? 'مادة' : 'شجرة', i.salesQty, i.sales, i.giftsQty, i.gifts, i.returnsQty, i.returns, i.net, i.excluded ? 'نعم' : '']),
          ['', 'الإجمالي', '', scope!.salesQty, scope!.sales, scope!.giftsQty, scope!.gifts, scope!.returnsQty, scope!.returns, scope!.net, ''],
        ],
      },
      {
        name: 'الفروع',
        title: `مبيعات الفروع (كل المواد) — ${period}`,
        headers: ['الكود', 'الفرع', 'الفواتير', 'المبيعات', 'المردود', 'الهدايا', 'الصافي'],
        rows: r.branches.map(b => [b.code, b.label, b.invoices, b.sales, b.returns, b.gifts, b.net]),
      },
      {
        name: 'الأيام',
        title: `المبيعات اليومية — ${period}`,
        headers: ['التاريخ', 'الفواتير', 'المبيعات', 'المردود', 'الهدايا', 'الصافي'],
        rows: r.days.map(d => [dmy(d.date), d.invoices, d.sales, d.returns, d.gifts, d.net]),
      },
      {
        name: 'أكثر المواد',
        title: `أكثر المواد مبيعاً — ${title} — ${period}`,
        headers: ['الرقم', 'المادة', 'الشجرة', 'الكمية', 'المبيعات', 'المردود', 'الصافي'],
        rows: r.topMaterials.map(i => [i.num, i.name, i.tree ?? '', i.salesQty, i.sales, i.returns, i.net]),
      },
    ];
    if (r.lines)
      sheets.unshift({
        name: 'الحركات',
        title: `حركات ${title} — ${period}`,
        headers: ['التاريخ', 'الفاتورة', 'النوع', 'الفرع', 'البائع', 'رقم المادة', 'المادة', 'الكمية', 'البونص', 'السعر', 'المجموع'],
        rows: r.lines.map(l => [dmy(l.date), l.invNum, l.kindLabel, l.branch, l.seller ?? '', l.matNum, l.matName, l.qty, l.bonus, l.price, l.total]),
      });
    downloadReportExcel(`edari-sales-${r.from}_${r.to}`, sheets);
  }

  return (
    <ReportAppWindow
      title="تقرير المبيعات (الإداري)"
      subtitle={`${title} · ${single ? dayTitle(f) : `من ${dmy(f)} إلى ${dmy(to)}`}${branches.length ? ` · ${branches.length} فرع` : ''}`}
      icon={<IconLayers size={18} />}
      accent="linear-gradient(135deg,#3b2a7a,#6d4fd6)"
      toolbar={
        <>
          <Btn size="sm" variant="secondary" icon={<IconChevronRight size={14} />} onClick={() => setDay(shift(f, -1))} aria-label="اليوم السابق">
            السابق
          </Btn>
          <Input type="date" value={from} max={today} onChange={e => e.target.value && (setFrom(e.target.value), e.target.value > to && setTo(e.target.value))} className="!h-8 !w-40" aria-label="من" />
          <span className="text-[12px] font-semibold text-slate-500">إلى</span>
          <Input type="date" value={to} max={today} onChange={e => e.target.value && (setTo(e.target.value), e.target.value < from && setFrom(e.target.value))} className="!h-8 !w-40" aria-label="إلى" />
          <Btn size="sm" variant="secondary" icon={<IconChevronLeft size={14} />} disabled={to >= today} onClick={() => setDay(shift(to, 1))} aria-label="اليوم التالي">
            التالي
          </Btn>
          {(
            [
              ['اليوم', today, today],
              ['أمس', shift(today, -1), shift(today, -1)],
              ['7 أيام', shift(today, -6), today],
              ['هذا الشهر', `${today.slice(0, 8)}01`, today],
            ] as const
          ).map(([label, a, b]) => (
            <Btn key={label} size="sm" variant={f === a && to === b ? 'primary' : 'secondary'} onClick={() => (setFrom(a), setTo(b))}>
              {label}
            </Btn>
          ))}
          <Btn size="sm" variant={compare ? 'primary' : 'secondary'} onClick={() => setCompare(v => !v)} aria-pressed={compare}>
            مقارنة بالفترة السابقة
          </Btn>
          <div className="relative">
            <Btn size="sm" variant={branches.length ? 'primary' : 'secondary'} icon={<IconFilter size={14} />} onClick={() => setBranchOpen(v => !v)} aria-expanded={branchOpen}>
              {branches.length ? `الفروع (${branches.length})` : 'كل الفروع'}
            </Btn>
            {branchOpen && (
              <>
                <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="إغلاق" onClick={() => setBranchOpen(false)} />
                <div className="absolute start-0 top-full z-30 mt-1 max-h-[340px] w-[300px] overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl">
                  {selectable.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-slate-400">لا فروع في هذه الفترة</p>}
                  {selectable.map(b => (
                    <label key={b.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-slate-50">
                      <input type="checkbox" className="accent-brand-600" checked={branches.includes(b.code)} onChange={() => toggleBranch(b.code)} />
                      <span className="min-w-0 flex-1 truncate">{b.label}</span>
                      <span className="num text-[11px] text-slate-400">{b.invoices}</span>
                    </label>
                  ))}
                  {branches.length > 0 && (
                    <button type="button" className="mt-1 w-full rounded-lg px-2 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50" onClick={() => setBranches([])}>
                      إلغاء الفلتر — كل الفروع
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      }
      actions={
        <>
          <Btn size="sm" variant="secondary" icon={<IconRefresh size={14} />} loading={q.isFetching} onClick={() => void q.refetch()}>
            تحديث
          </Btn>
          <Btn size="sm" variant="secondary" icon={<IconDownload size={14} />} disabled={!r} onClick={exportExcel}>
            Excel
          </Btn>
          <Btn size="sm" icon={<IconPrinter size={14} />} loading={printing} disabled={!r} onClick={() => void print()}>
            طباعة A4
          </Btn>
        </>
      }
      onClose={onClose}
    >
      <ReportFill>
        {tooLong && (
          <ReportBanner>
            <p className="text-[12.5px] font-semibold text-amber-800">أقصى فترة للتقرير {EDARI_SALES_MAX_DAYS} يوماً — اختر فترة أقصر.</p>
          </ReportBanner>
        )}
        {q.error && (
          <ReportBanner>
            <ReportError error={q.error} onRetry={() => void q.refetch()} />
          </ReportBanner>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-slate-100 p-4">
          {!r && q.isLoading && (
            <>
              <div className="skeleton h-[84px] rounded-xl" />
              <div className="skeleton h-[420px] rounded-xl" />
            </>
          )}
          {r && scope && (
            <>
              {/* المؤشرات */}
              <div className={`grid grid-cols-2 gap-2 xl:grid-cols-5 ${q.isFetching ? 'opacity-70' : ''}`}>
                <Kpi
                  label="الصافي"
                  value={n0(scope.net)}
                  hint={
                    r.prevFrom && (r.node ? r.prevNodeTotals : r.prevTotals)
                      ? `${deltaText(scope.net, (r.node ? r.prevNodeTotals : r.prevTotals)!.net)} عن ${r.prevFrom === r.prevTo ? dmy(r.prevFrom) : `${dmy(r.prevFrom)} – ${dmy(r.prevTo!)}`} (${n0((r.node ? r.prevNodeTotals : r.prevTotals)!.net)})`
                      : 'المبيعات − المردود'
                  }
                  tone="text-header"
                  big
                />
                <Kpi label="المبيعات" value={n0(scope.sales)} hint={`${qty(scope.salesQty)} قطعة`} tone="text-emerald-700" />
                <Kpi label="المردود" value={n0(scope.returns)} hint={`${qty(scope.returnsQty)} قطعة`} tone="text-rose-700" />
                <Kpi label="الهدايا" value={n0(scope.gifts)} hint={`${qty(scope.giftsQty)} قطعة`} tone="text-amber-700" />
                <Kpi label={r.node ? 'حصتها من الإجمالي' : 'الفواتير'} value={r.node ? `${r.totals.net ? ((scope.net / r.totals.net) * 100).toFixed(1) : '0'}%` : formatNum(r.invoices)} hint={r.node ? `إجمالي النظام ${n0(r.totals.net)}` : single ? dayTitle(r.from) : `${r.days.length} يوماً`} />
              </div>
              {!r.node && r.excludedNet !== 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                  الإجمالي يطابق تقرير تطبيق الحسابات: يستثني الأشجار التي رقمها 1000 فأكثر (سوالب، مواد مجرودة، عمولات…) وصافيها <b className="num">{n0(r.excludedNet)}</b> — فالصافي مع كل المواد <b className="num">{n0(r.totals.net + r.excludedNet)}</b>. تجدها أسفل الجدول.
                </p>
              )}

              <div className="flex min-h-0 flex-col gap-3 xl:flex-row xl:items-start">
                {/* الأشجار / المواد / الحركات */}
                <section className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                    <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[12.5px]" aria-label="المسار">
                      <button type="button" className={`rounded-md px-1.5 py-0.5 font-bold ${r.node ? 'text-brand-700 hover:bg-brand-50' : 'text-slate-800'}`} onClick={() => goTo(null)}>
                        كل الأشجار
                      </button>
                      {r.path.map((p, i) => (
                        <span key={p.seq} className="flex min-w-0 items-center gap-1">
                          <IconChevronLeft size={12} className="shrink-0 text-slate-300" />
                          <button
                            type="button"
                            className={`max-w-[260px] truncate rounded-md px-1.5 py-0.5 font-bold ${i === r.path.length - 1 ? 'text-slate-800' : 'text-brand-700 hover:bg-brand-50'}`}
                            onClick={() => i < r.path.length - 1 && goTo(p.seq)}
                          >
                            {p.name}
                          </button>
                        </span>
                      ))}
                    </nav>
                    {!nodeLeaf && (
                      <div className="relative w-full max-w-[300px]">
                        <IconSearch size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={r.node ? `ابحث عن مادة في ${r.node.name}` : 'ابحث عن مادة بالاسم أو الباركود'} className="pe-8 ps-8" />
                        {searchText && (
                          <button type="button" className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح البحث" onClick={() => setSearchText('')}>
                            <IconX size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {r.lines ? (
                    <LinesTable r={r} />
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full min-w-[720px] text-[12.5px]">
                        <thead className="bg-slate-50 text-[11.5px] text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-start font-bold">{r.search ? 'المادة' : r.node ? 'المجموعة / المادة' : 'شجرة المواد'}</th>
                            <th className="px-2 py-2 text-end font-bold">الكمية</th>
                            <th className="px-2 py-2 text-end font-bold">المبيعات</th>
                            <th className="px-2 py-2 text-end font-bold">الهدايا</th>
                            <th className="px-2 py-2 text-end font-bold">المردود</th>
                            <th className="px-3 py-2 text-end font-bold">الصافي</th>
                            <th className="w-[120px] px-3 py-2 text-start font-bold">الحصة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.items.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-3 py-12 text-center text-slate-400">
                                {r.search ? `لا مادة تطابق «${r.search}» لها حركة في هذه الفترة` : 'لا مبيعات في هذه الفترة'}
                              </td>
                            </tr>
                          )}
                          {included.map(i => (
                            <ItemRow key={i.seq} item={i} base={base} total={scope.net} onOpen={() => open(i)} />
                          ))}
                          {excluded.length > 0 && (
                            <tr className="bg-amber-50/70">
                              <td colSpan={7} className="px-3 py-1.5 text-[11.5px] font-bold text-amber-900">
                                خارج الإجمالي (رقم الشجرة 1000 فأكثر) — <span className="num">{n0(excluded.reduce((s, i) => s + i.net, 0))}</span>
                              </td>
                            </tr>
                          )}
                          {excluded.map(i => (
                            <ItemRow key={i.seq} item={i} base={base} total={0} onOpen={() => open(i)} />
                          ))}
                        </tbody>
                        {included.length > 0 && !r.search && (
                          <tfoot>
                            <tr className="border-t-2 border-slate-200 bg-slate-50 font-extrabold">
                              <td className="px-3 py-2">الإجمالي ({included.length})</td>
                              <td className="num px-2 py-2 text-end">{qty(scope.salesQty)}</td>
                              <td className="num px-2 py-2 text-end text-emerald-700">{n0(scope.sales)}</td>
                              <td className="num px-2 py-2 text-end text-amber-700">{n0(scope.gifts)}</td>
                              <td className="num px-2 py-2 text-end text-rose-700">{n0(scope.returns)}</td>
                              <td className="num px-3 py-2 text-end">{n0(scope.net)}</td>
                              <td />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </section>

                {/* الأيام · الفروع · أكثر المواد */}
                {(!r.node || r.topMaterials.length > 0) && (
                <aside className="flex w-full shrink-0 flex-col gap-3 xl:w-[380px]">
                  {!r.node && r.days.length > 1 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <h3 className="mb-2 text-[12.5px] font-extrabold text-slate-700">الصافي اليومي</h3>
                      <ColumnChart
                        points={r.days.map(d => ({
                          id: d.date,
                          label: dm(d.date),
                          value: Math.max(0, d.net),
                          tooltip: (
                            <span>
                              {dayTitle(d.date)} — صافي <b className="num">{n0(d.net)}</b> · مردود <span className="num">{n0(d.returns)}</span> · {d.invoices} فاتورة
                            </span>
                          ),
                        }))}
                        format={n0}
                        height={130}
                        seriesLabel="الصافي"
                      />
                    </div>
                  )}
                  {!r.node && (
                    <div className="rounded-xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
                        <h3 className="text-[12.5px] font-extrabold text-slate-700">الفروع</h3>
                        <span className="text-[11px] text-slate-400">كل المواد · اضغط للفلترة</span>
                      </div>
                      <table className="w-full text-[12px]">
                        <tbody>
                          {r.branches
                            .filter(b => b.invoices > 0 || branches.includes(b.code))
                            .map(b => {
                              const on = branches.includes(b.code);
                              return (
                                <tr
                                  key={b.code || 'none'}
                                  className={`border-t border-slate-100 ${b.code ? 'cursor-pointer hover:bg-slate-50' : ''} ${on ? 'bg-brand-50/70' : ''}`}
                                  onClick={() => b.code && toggleBranch(b.code)}
                                >
                                  <td className="px-3 py-1.5">
                                    <div className={`font-semibold ${on ? 'text-brand-800' : 'text-slate-700'}`}>{b.label}</div>
                                    <div className="num text-[10.5px] text-slate-400">
                                      {b.invoices} فاتورة{b.returns ? ` · مردود ${n0(b.returns)}` : ''}
                                      {b.gifts ? ` · هدايا ${n0(b.gifts)}` : ''}
                                    </div>
                                  </td>
                                  <td className="num whitespace-nowrap px-3 py-1.5 text-end font-extrabold text-slate-800">{n0(b.net)}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {r.topMaterials.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white">
                      <h3 className="px-3 pb-1 pt-2.5 text-[12.5px] font-extrabold text-slate-700">أكثر المواد مبيعاً{r.node ? ` في ${r.node.name}` : ''}</h3>
                      <table className="w-full text-[12px]">
                        <tbody>
                          {r.topMaterials.slice(0, 15).map((m, i) => (
                            <tr key={m.seq} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => open(m)}>
                              <td className="num w-6 px-2 py-1.5 text-center text-[11px] text-slate-400">{i + 1}</td>
                              <td className="py-1.5">
                                <div className="font-semibold leading-snug text-slate-700">{m.name}</div>
                                <div className="text-[10.5px] text-slate-400">
                                  {m.tree} · <span className="num">{qty(m.salesQty)}</span> قطعة
                                </div>
                              </td>
                              <td className="num whitespace-nowrap px-3 py-1.5 text-end font-extrabold text-slate-800">{n0(m.sales)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </aside>
                )}
              </div>
            </>
          )}
        </div>
      </ReportFill>
    </ReportAppWindow>
  );
}

/** التغير عن الفترة السابقة: نسبة أو «جديد» / «توقف» */
function deltaText(net: number, prev: number) {
  if (!prev && !net) return '—';
  if (!prev) return 'جديد';
  if (!net) return 'توقف';
  const pct = ((net - prev) / Math.abs(prev)) * 100;
  return `${pct > 0 ? '+' : ''}${Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}
function deltaTone(net: number, prev: number) {
  if (!prev) return net ? 'text-emerald-700' : 'text-slate-400';
  if (!net) return 'text-rose-700';
  const pct = ((net - prev) / Math.abs(prev)) * 100;
  return Math.abs(pct) < 1 ? 'text-slate-400' : pct > 0 ? 'text-emerald-700' : 'text-rose-700';
}

function ItemRow({ item, base, total, onOpen }: { item: SalesItem; base: number; total: number; onOpen: () => void }) {
  const share = total > 0 ? (item.net / total) * 100 : 0;
  return (
    <tr className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${item.excluded ? 'text-slate-500' : ''}`} onClick={onOpen}>
      <td className="px-3 py-2">
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 shrink-0 ${item.leaf ? 'text-slate-300' : 'text-brand-500'}`}>{item.leaf ? <IconPackage size={15} /> : <IconFolder size={15} />}</span>
          <div className="min-w-0">
            <div className="font-semibold leading-snug text-slate-800">{item.name || '—'}</div>
            <div className="num text-[10.5px] text-slate-400">
              {item.barcode || item.num}
              {item.tree ? <span className="font-sans"> · {item.tree}</span> : null}
            </div>
          </div>
        </div>
      </td>
      <td className="num whitespace-nowrap px-2 py-2 text-end">{qty(item.salesQty)}</td>
      <td className="num whitespace-nowrap px-2 py-2 text-end font-semibold text-emerald-700">{item.sales ? n0(item.sales) : ''}</td>
      <td className="num whitespace-nowrap px-2 py-2 text-end text-amber-700">{item.gifts ? n0(item.gifts) : ''}</td>
      <td className="num whitespace-nowrap px-2 py-2 text-end text-rose-700">{item.returns ? n0(item.returns) : ''}</td>
      <td className="num whitespace-nowrap px-3 py-2 text-end font-extrabold text-slate-800">
        {n0(item.net)}
        {item.prevNet != null && (
          <div className={`text-[10.5px] font-bold ${deltaTone(item.net, item.prevNet)}`} title={`الفترة السابقة ${n0(item.prevNet)}`}>
            {deltaText(item.net, item.prevNet)}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {total > 0 && (
          <div className="flex items-center gap-1.5" title={`${share.toFixed(1)}% من الصافي`}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, (Math.abs(item.net) / base) * 100))}%` }} />
            </div>
            <span className="num w-9 text-end text-[10.5px] text-slate-500">{share.toFixed(share >= 10 ? 0 : 1)}%</span>
          </div>
        )}
      </td>
    </tr>
  );
}

function LinesTable({ r }: { r: EdariSalesReport }) {
  const lines = r.lines ?? [];
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead className="bg-slate-50 text-[11.5px] text-slate-500">
          <tr>
            <th className="px-3 py-2 text-start font-bold">التاريخ</th>
            <th className="px-2 py-2 text-start font-bold">الفاتورة</th>
            <th className="px-2 py-2 text-start font-bold">الفرع</th>
            <th className="px-2 py-2 text-start font-bold">البائع</th>
            <th className="px-2 py-2 text-end font-bold">الكمية</th>
            <th className="px-2 py-2 text-end font-bold">السعر</th>
            <th className="px-3 py-2 text-end font-bold">المجموع</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-12 text-center text-slate-400">
                لا حركات لهذه المادة في الفترة
              </td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="num whitespace-nowrap px-3 py-1.5 text-slate-700">{dmy(l.date)}</td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <span className="num font-semibold text-slate-700">{l.invNum}</span>
                <span className={`ms-1.5 rounded px-1 py-0.5 text-[10.5px] font-bold ${l.kind === 6 ? 'bg-amber-100 text-amber-800' : l.total < 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{l.kindLabel}</span>
              </td>
              <td className="px-2 py-1.5 text-slate-600">{l.branch}</td>
              <td className="px-2 py-1.5 text-slate-500">{l.seller ?? ''}</td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-end">
                {qty(l.qty)}
                {l.bonus > 0 && <span className="text-amber-700"> +{qty(l.bonus)}</span>}
              </td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-end text-slate-600">{n0(l.price)}</td>
              <td className={`num whitespace-nowrap px-3 py-1.5 text-end font-extrabold ${l.total < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{n0(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.linesTruncated && <p className="border-t border-slate-100 px-3 py-2 text-[12px] text-amber-700">عُرضت أحدث {lines.length} حركة — اختر فترة أقصر لرؤية البقية.</p>}
    </div>
  );
}

function Kpi({ label, value, hint, tone, big }: { label: string; value: string; hint?: string; tone?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-slate-500">{label}</div>
      <div className={`num font-extrabold ${big ? 'text-[22px]' : 'text-[18px]'} ${tone ?? 'text-slate-800'}`}>{value}</div>
      {hint && <div className="num truncate text-[10.5px] text-slate-400">{hint}</div>}
    </div>
  );
}

/** التقرير المعروض على A4 */
function reportHtml(r: EdariSalesReport) {
  const scope = r.node ? r.nodeTotals : r.totals;
  const period = r.from === r.to ? dayTitle(r.from) : `من ${dmy(r.from)} إلى ${dmy(r.to)}`;
  const title = r.node ? r.path.map(p => p.name).join(' ‹ ') : 'كل أشجار المواد';
  const filter = r.branchFilter.length ? r.branches.filter(b => r.branchFilter.includes(b.code)).map(b => b.label).join('، ') : '';
  const itemRow = (i: SalesItem) => `<tr${i.excluded ? ' class="ex"' : ''}><td class="num sub">${esc(i.barcode || i.num)}</td><td>${esc(i.name)}${i.tree ? `<div class="sub">${esc(i.tree)}</div>` : ''}</td>
    <td class="e num">${qty(i.salesQty)}</td><td class="e num in">${i.sales ? n0(i.sales) : ''}</td><td class="e num gf">${i.gifts ? n0(i.gifts) : ''}</td><td class="e num out">${i.returns ? n0(i.returns) : ''}</td><td class="e num b">${n0(i.net)}</td></tr>`;
  const inc = r.items.filter(i => !i.excluded);
  const exc = r.items.filter(i => i.excluded);
  let main: string;
  if (r.lines) {
    main = `<table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>الفرع</th><th>البائع</th><th class="e">الكمية</th><th class="e">السعر</th><th class="e">المجموع</th></tr></thead><tbody>${
      r.lines
        .map(l => `<tr><td class="num">${dmy(l.date)}</td><td><span class="num">${esc(l.invNum)}</span> <span class="sub">${esc(l.kindLabel)}</span></td><td>${esc(l.branch)}</td><td class="sub">${esc(l.seller ?? '')}</td>
        <td class="e num">${qty(l.qty)}${l.bonus > 0 ? ` +${qty(l.bonus)}` : ''}</td><td class="e num">${n0(l.price)}</td><td class="e num b ${l.total < 0 ? 'out' : ''}">${n0(l.total)}</td></tr>`)
        .join('') || '<tr><td colspan="7" class="none">لا حركات في هذه الفترة</td></tr>'
    }</tbody></table>`;
  } else {
    main = `<table><thead><tr><th style="width:92px">الرقم</th><th>${r.node ? 'المجموعة / المادة' : 'شجرة المواد'}</th><th class="e">الكمية</th><th class="e">المبيعات</th><th class="e">الهدايا</th><th class="e">المردود</th><th class="e">الصافي</th></tr></thead><tbody>
      ${inc.map(itemRow).join('') || '<tr><td colspan="7" class="none">لا مبيعات في هذه الفترة</td></tr>'}
      ${inc.length && !r.search ? `<tr class="tot"><td colspan="2">الإجمالي</td><td class="e num">${qty(scope.salesQty)}</td><td class="e num">${n0(scope.sales)}</td><td class="e num">${n0(scope.gifts)}</td><td class="e num">${n0(scope.returns)}</td><td class="e num">${n0(scope.net)}</td></tr>` : ''}
      ${exc.length ? `<tr class="day"><td colspan="7">خارج الإجمالي (رقم الشجرة 1000 فأكثر) — ${n0(r.excludedNet)}</td></tr>${exc.map(itemRow).join('')}` : ''}
    </tbody></table>`;
  }
  const branches = r.node
    ? ''
    : `<h2>الفروع <span>(كل المواد)</span></h2><table><thead><tr><th>الفرع</th><th class="e">الفواتير</th><th class="e">المبيعات</th><th class="e">المردود</th><th class="e">الهدايا</th><th class="e">الصافي</th></tr></thead><tbody>${r.branches
        .filter(b => b.invoices > 0)
        .map(b => `<tr><td>${esc(b.label)}</td><td class="e num">${b.invoices}</td><td class="e num in">${n0(b.sales)}</td><td class="e num out">${b.returns ? n0(b.returns) : ''}</td><td class="e num gf">${b.gifts ? n0(b.gifts) : ''}</td><td class="e num b">${n0(b.net)}</td></tr>`)
        .join('')}</tbody></table>`;
  const days =
    r.node || r.days.length < 2
      ? ''
      : `<h2>الأيام</h2><table><thead><tr><th>اليوم</th><th class="e">الفواتير</th><th class="e">المبيعات</th><th class="e">المردود</th><th class="e">الهدايا</th><th class="e">الصافي</th></tr></thead><tbody>${r.days
          .map(d => `<tr><td>${esc(dayTitle(d.date))}</td><td class="e num">${d.invoices}</td><td class="e num in">${n0(d.sales)}</td><td class="e num out">${d.returns ? n0(d.returns) : ''}</td><td class="e num gf">${d.gifts ? n0(d.gifts) : ''}</td><td class="e num b">${n0(d.net)}</td></tr>`)
          .join('')}</tbody></table>`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>edari-sales-${r.from}_${r.to}</title><style>
  @page { size: A4; margin: 11mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.5; }
  .num { font-variant-numeric: tabular-nums; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 2.5px solid #3b2a7a; }
  .top h1 { margin: 0; font-size: 18px; color: #3b2a7a; }
  .top p { margin: 2px 0 0; color: #475569; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .kpi { background: #f1f5f9; border-radius: 10px; padding: 8px 12px; }
  .kpi span { display: block; color: #64748b; font-size: 9.5px; }
  .kpi b { font-size: 14px; }
  .kpi.in b { color: #047857; } .kpi.out b { color: #be123c; } .kpi.gf b { color: #b45309; } .kpi.end { background: #3b2a7a; color: #fff; } .kpi.end span { color: #d6ccff; }
  h2 { font-size: 13px; margin: 16px 0 6px; color: #3b2a7a; } h2 span { font-size: 10px; font-weight: 400; color: #64748b; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #3b2a7a; color: #fff; font-size: 10px; padding: 6px 8px; text-align: right; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr { break-inside: avoid; } thead { display: table-header-group; }
  .e { text-align: left; white-space: nowrap; } .b { font-weight: 700; }
  td.in { color: #047857; } td.out { color: #be123c; } td.gf { color: #b45309; }
  .sub { color: #64748b; font-size: 9.5px; } .none { text-align: center; color: #64748b; padding: 18px; }
  tr.day td { background: #fffbeb; font-weight: 700; color: #92400e; } tr.ex td { color: #64748b; }
  tr.tot td { background: #f1f5f9; font-weight: 800; border-top: 2px solid #cbd5e1; }
  .note { margin: 0 0 10px; background: #fffbeb; border-radius: 8px; padding: 6px 10px; font-size: 10px; color: #92400e; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9.5px; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="top"><div><h1>تقرير المبيعات</h1><p>${esc(title)}${filter ? ` · ${esc(filter)}` : ''}</p></div><p>${esc(period)}</p></div>
  <div class="kpis">
    <div class="kpi in"><span>المبيعات (${qty(scope.salesQty)} قطعة)</span><b class="num">${n0(scope.sales)}</b></div>
    <div class="kpi out"><span>المردود (${qty(scope.returnsQty)} قطعة)</span><b class="num">${n0(scope.returns)}</b></div>
    <div class="kpi gf"><span>الهدايا (${qty(scope.giftsQty)} قطعة)</span><b class="num">${n0(scope.gifts)}</b></div>
    <div class="kpi end"><span>الصافي (د.ع)</span><b class="num">${n0(scope.net)}</b></div>
  </div>
  ${!r.node && r.excludedNet ? `<p class="note">الإجمالي يستثني الأشجار التي رقمها 1000 فأكثر وصافيها ${n0(r.excludedNet)} — الصافي مع كل المواد ${n0(r.totals.net + r.excludedNet)}.</p>` : ''}
  ${main}${branches}${days}
  <div class="foot"><span>البيانات من الإداري — لوحة تحكم FOT POS</span><span class="num">${new Date().toLocaleString('ar-IQ-u-nu-latn')}</span></div>
</body></html>`;
}
