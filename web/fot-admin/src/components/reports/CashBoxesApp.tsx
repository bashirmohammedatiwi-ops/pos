import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { todayIso } from '@/api/client';
import { cashAmount, cashReportApi, cashUnit, type CashBoxDto, type CashStatementDto } from '@/api/cash';
import { useToast } from '@/components/Toast';
import { IconChevronLeft, IconChevronRight, IconDownload, IconPrinter, IconRefresh, IconSearch, IconStar, IconWallet } from '@/components/icons';
import { Badge, Btn, Input } from '@/components/ui';
import { isoDate } from '@/lib/businessPeriod';
import { printDocument } from '@/lib/print';
import { downloadReportExcel } from '@/lib/reportExcel';
import { ReportAppWindow } from './ReportAppWindow';
import { ReportBanner, ReportError, ReportFill } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * تقرير الصناديق — من «إداري» مباشرة (قراءة فقط):
 *  · أرصدة كل الصناديق الآن (المثبّت + الحركات بعده) وحركة اليوم.
 *  · كشف أي صندوق ليوم أو فترة: رصيد أول المدة، كل حركة برصيدها، والإجماليات.
 *  · النجمة تجعل الصندوق بارزاً في تطبيق المدراء (الدولار، الخشن، الناعم، بطاقة كي).
 *  · طباعة A4 وتصدير Excel.
 * ───────────────────────────────────────────────────────────────────────────── */

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
const dayTitle = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const time12 = (hm?: string | null) => {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};

export function CashBoxesApp({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const today = todayIso();
  const [seq, setSeq] = useState<number | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [printing, setPrinting] = useState(false);

  const boxesQ = useQuery({ queryKey: ['cash-boxes'], queryFn: () => cashReportApi.boxes(), refetchInterval: 30_000 });
  const boxes = boxesQ.data?.boxes ?? [];
  const box = boxes.find(b => b.seq === seq) ?? null;
  // أول فتح: أول صندوق بارز
  useEffect(() => {
    if (seq == null && boxes.length) setSeq((boxes.find(b => b.featured) ?? boxes[0]).seq);
  }, [boxes, seq]);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const f = valid && from <= to ? from : to;
  const stQ = useQuery({
    queryKey: ['cash-statement', seq, f, to],
    queryFn: () => cashReportApi.statement(seq!, f, to),
    enabled: seq != null && valid,
    refetchInterval: to >= today ? 30_000 : false,
  });
  const st = stQ.data ?? null;

  const featureM = useMutation({
    mutationFn: async (b: CashBoxDto) => {
      const cur = boxesQ.data?.featured ?? [];
      const next = b.featured ? cur.filter(n => n !== b.num) : [...cur, b.num];
      return cashReportApi.saveSettings({ rootNum: boxesQ.data?.rootNum ?? '100', featured: next });
    },
    onSuccess: (_r, b) => {
      toast.success(b.featured ? `أُزيل «${b.name}» من البارزة في التطبيق` : `«${b.name}» صار بارزاً في تطبيق المدراء`);
      void qc.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذر الحفظ'),
  });

  const featured = boxes.filter(b => b.featured);
  const rest = boxes.filter(b => !b.featured && (showEmpty || b.balance !== 0 || b.todayCount > 0 || b.seq === seq));
  const hidden = boxes.filter(b => !b.featured && b.balance === 0 && b.todayCount === 0).length;

  const lines = useMemo(() => {
    const n = search.trim();
    const all = st?.lines ?? [];
    return n ? all.filter(l => l.description.includes(n) || (l.other ?? '').includes(n) || l.num.includes(n) || String(l.in || l.out).includes(n.replace(/,/g, ''))) : all;
  }, [st, search]);
  const c = st?.box.currency ?? box?.currency ?? 'IQD';
  const single = f === to;

  function setDay(d: string) {
    setFrom(d);
    setTo(d);
  }

  async function print() {
    if (!st) return;
    setPrinting(true);
    try {
      await printDocument(statementHtml(st));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
    }
  }

  function exportExcel() {
    if (!st) return;
    downloadReportExcel(`cash-${st.box.num}-${st.from}_${st.to}`, [
      {
        name: 'كشف الصندوق',
        title: `كشف ${st.box.name} (${st.box.num}) — من ${dmy(st.from)} إلى ${dmy(st.to)}`,
        headers: ['التاريخ', 'الوقت', 'السند', 'البيان', 'الحساب المقابل', 'قبض', 'صرف', 'الرصيد'],
        rows: [
          ['', '', '', 'رصيد أول المدة', '', '', '', st.opening],
          ...st.lines.map(l => [dmy(l.date), l.time ?? '', l.num, l.description, l.other ?? '', l.in || '', l.out || '', l.balance]),
          ['', '', '', 'الإجمالي', '', st.totalIn, st.totalOut, st.closing],
        ],
      },
      {
        name: 'أرصدة الصناديق',
        title: `أرصدة الصناديق — ${dmy(boxesQ.data?.today ?? today)}`,
        headers: ['الرقم', 'الصندوق', 'العملة', 'الرصيد الآن', 'الرصيد الدفتري', 'آخر تثبيت', 'المبلغ المثبّت', 'قبض اليوم', 'صرف اليوم'],
        rows: boxes.map(b => [b.num, b.name, b.currency, b.balance, b.ledgerBalance, b.fixDate ? dmy(b.fixDate) : '', b.fixBalance ?? '', b.todayIn, b.todayOut]),
      },
    ]);
  }

  const error = boxesQ.error || stQ.error;

  return (
    <ReportAppWindow
      title="تقرير الصناديق"
      subtitle={box ? `${box.name} · ${single ? dayTitle(f) : `من ${dmy(f)} إلى ${dmy(to)}`}` : 'أرصدة الصناديق وحركاتها من الإداري'}
      icon={<IconWallet size={18} />}
      accent="linear-gradient(135deg,#065f46,#059669)"
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
        </>
      }
      actions={
        <>
          <Btn size="sm" variant="secondary" icon={<IconRefresh size={14} />} onClick={() => void Promise.all([qc.invalidateQueries({ queryKey: ['cash-boxes'] }), stQ.refetch()])}>
            تحديث
          </Btn>
          <Btn size="sm" variant="secondary" icon={<IconDownload size={14} />} disabled={!st} onClick={exportExcel}>
            Excel
          </Btn>
          <Btn size="sm" icon={<IconPrinter size={14} />} loading={printing} disabled={!st} onClick={() => void print()}>
            طباعة A4
          </Btn>
        </>
      }
      onClose={onClose}
    >
      <ReportFill>
        {error && (
          <ReportBanner>
            <ReportError error={error} onRetry={() => (void boxesQ.refetch(), void stQ.refetch())} />
          </ReportBanner>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-slate-100 p-4 lg:flex-row">
          {/* الصناديق */}
          <aside className="flex w-full shrink-0 flex-col gap-2 overflow-auto lg:w-[320px]">
            {boxesQ.isLoading && Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-[78px] rounded-xl" />)}
            {featured.length > 0 && <h3 className="px-1 text-[12px] font-extrabold text-slate-500">الصناديق البارزة</h3>}
            {featured.map(b => (
              <BoxRow key={b.seq} box={b} active={b.seq === seq} onPick={() => setSeq(b.seq)} onStar={() => featureM.mutate(b)} />
            ))}
            {rest.length > 0 && <h3 className="mt-2 px-1 text-[12px] font-extrabold text-slate-500">بقية الصناديق</h3>}
            {rest.map(b => (
              <BoxRow key={b.seq} box={b} active={b.seq === seq} onPick={() => setSeq(b.seq)} onStar={() => featureM.mutate(b)} />
            ))}
            {hidden > 0 && (
              <button type="button" className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-white" onClick={() => setShowEmpty(v => !v)}>
                {showEmpty ? 'إخفاء الصناديق الفارغة' : `إظهار ${hidden} صندوقاً فارغاً`}
              </button>
            )}
            {boxesQ.data && <p className="px-1 text-[11px] leading-relaxed text-slate-400">الرصيد = آخر مبلغ مثبّت في الإداري + الحركات بعده. النجمة تُظهر الصندوق أولاً في تطبيق المدراء.</p>}
          </aside>

          {/* الكشف */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto">
            {!st && stQ.isLoading && <div className="skeleton h-64 rounded-xl" />}
            {st && (
              <>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  <Kpi label="رصيد أول المدة" value={cashAmount(st.opening, c)} unit={cashUnit(c)} />
                  <Kpi label={`القبض (${st.lines.filter(l => l.in).length})`} value={cashAmount(st.totalIn, c)} unit={cashUnit(c)} tone="text-emerald-700" />
                  <Kpi label={`الصرف (${st.lines.filter(l => l.out).length})`} value={cashAmount(st.totalOut, c)} unit={cashUnit(c)} tone="text-rose-700" />
                  <Kpi label="رصيد آخر المدة" value={cashAmount(st.closing, c)} unit={cashUnit(c)} tone="text-header" big />
                </div>
                {box && box.ledgerBalance !== box.balance && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                    الرصيد الدفتري في الإداري <b className="num">{cashAmount(box.ledgerBalance, c)}</b> يختلف عن المثبّت + الحركات بـ <b className="num">{cashAmount(Math.abs(box.ledgerBalance - box.balance), c)}</b> — قيود أُدخلت بتاريخ سابق لآخر تثبيت ({box.fixDate ? dmy(box.fixDate) : '—'}).
                  </p>
                )}
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                    <h3 className="text-[13px] font-extrabold text-slate-700">
                      الحركات <span className="num text-slate-400">({lines.length})</span>
                    </h3>
                    <div className="relative ms-auto w-full max-w-[280px]">
                      <IconSearch size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في البيان أو الحساب أو المبلغ" className="ps-8" />
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full min-w-[640px] text-[12.5px]">
                      <thead className="sticky top-0 bg-slate-50 text-[11.5px] text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-start font-bold">التاريخ</th>
                          <th className="px-2 py-2 text-start font-bold">السند</th>
                          <th className="px-2 py-2 text-start font-bold">البيان</th>
                          <th className="px-2 py-2 text-end font-bold">قبض</th>
                          <th className="px-2 py-2 text-end font-bold">صرف</th>
                          <th className="px-3 py-2 text-end font-bold">الرصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!search && (
                          <tr className="bg-amber-50/60">
                            <td className="px-3 py-2 font-bold text-slate-700" colSpan={5}>
                              رصيد أول المدة
                            </td>
                            <td className="num px-3 py-2 text-end font-extrabold">{cashAmount(st.opening, c)}</td>
                          </tr>
                        )}
                        {lines.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                              {search ? 'لا نتائج للبحث' : 'لا حركات في هذه الفترة'}
                            </td>
                          </tr>
                        )}
                        {lines.map(l => (
                          <tr key={l.seq} className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                            <td className="whitespace-nowrap px-3 py-2">
                              <div className="num font-semibold text-slate-700">{dmy(l.date)}</div>
                              <div className="num text-[11px] text-slate-400">{time12(l.time)}</div>
                            </td>
                            <td className="num px-2 py-2 text-slate-500">{l.num}</td>
                            <td className="px-2 py-2">
                              <div className="font-semibold text-slate-800">{l.description || (l.in ? 'قبض' : 'صرف')}</div>
                              {(l.other || l.rate) && (
                                <div className="text-[11px] text-slate-400">
                                  {l.other}
                                  {l.rate ? <span className="num"> · سعر {cashAmount(l.rate, 'IQD')}</span> : null}
                                </div>
                              )}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2 text-end font-bold text-emerald-700">{l.in ? cashAmount(l.in, c) : ''}</td>
                            <td className="num whitespace-nowrap px-2 py-2 text-end font-bold text-rose-700">{l.out ? cashAmount(l.out, c) : ''}</td>
                            <td className="num whitespace-nowrap px-3 py-2 text-end font-extrabold text-slate-800">{cashAmount(l.balance, c)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {lines.length > 0 && !search && (
                        <tfoot>
                          <tr className="border-t-2 border-slate-200 bg-slate-50 font-extrabold">
                            <td className="px-3 py-2" colSpan={3}>
                              الإجمالي
                            </td>
                            <td className="num px-2 py-2 text-end text-emerald-700">{cashAmount(st.totalIn, c)}</td>
                            <td className="num px-2 py-2 text-end text-rose-700">{cashAmount(st.totalOut, c)}</td>
                            <td className="num px-3 py-2 text-end">{cashAmount(st.closing, c)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  {st.truncated && <p className="border-t border-slate-100 px-3 py-2 text-[12px] text-amber-700">الفترة فيها حركات أكثر من الحد المعروض — اختر فترة أقصر.</p>}
                </div>
              </>
            )}
          </section>
        </div>
      </ReportFill>
    </ReportAppWindow>
  );
}

function BoxRow({ box, active, onPick, onStar }: { box: CashBoxDto; active: boolean; onPick: () => void; onStar: () => void }) {
  const net = box.todayIn - box.todayOut;
  return (
    <div className={`flex items-stretch gap-1 rounded-xl border bg-white transition ${active ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'}`}>
      <button type="button" className="min-w-0 flex-1 px-3 py-2.5 text-start" onClick={onPick}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] font-bold text-slate-700">{box.name}</span>
          <span className="num shrink-0 text-[10.5px] text-slate-400">{box.num}</span>
        </div>
        <div className={`num mt-0.5 text-[19px] font-extrabold ${box.balance < 0 ? 'text-rose-700' : 'text-slate-900'}`} dir="ltr" style={{ textAlign: 'right' }}>
          {box.currency === 'USD' ? '$' : ''}
          {cashAmount(box.balance, box.currency)}
          {box.currency !== 'USD' && <span className="ms-1 text-[11px] font-semibold text-slate-400">د.ع</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
          {box.todayCount ? (
            <>
              اليوم
              <span className={`num font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`} dir="ltr">
                {net > 0 ? '+' : ''}
                {cashAmount(net, box.currency)}
              </span>
              · {box.todayCount} حركة
            </>
          ) : (
            'لا حركة اليوم'
          )}
          {box.ledgerBalance !== box.balance && <Badge tone="warn">فرق دفتري</Badge>}
        </div>
      </button>
      <button
        type="button"
        className={`grid w-9 shrink-0 place-items-center rounded-e-xl ${box.featured ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
        title={box.featured ? 'إزالة من البارزة في تطبيق المدراء' : 'إبراز في تطبيق المدراء'}
        aria-label={box.featured ? 'إزالة من البارزة' : 'إبراز في التطبيق'}
        aria-pressed={box.featured}
        onClick={onStar}
      >
        <IconStar size={16} />
      </button>
    </div>
  );
}

function Kpi({ label, value, unit, tone, big }: { label: string; value: string; unit?: string; tone?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-slate-500">{label}</div>
      <div className={`num font-extrabold ${big ? 'text-[22px]' : 'text-[17px]'} ${tone ?? 'text-slate-800'}`}>{value}</div>
      {unit && <div className="text-[10.5px] text-slate-400">{unit}</div>}
    </div>
  );
}

/** كشف الصندوق على A4 */
function statementHtml(st: CashStatementDto) {
  const c = st.box.currency;
  const period = st.from === st.to ? dayTitle(st.from) : `من ${dmy(st.from)} إلى ${dmy(st.to)}`;
  const byDay = new Map(st.days.map(d => [d.date, d]));
  let rows = `<tr class="open"><td colspan="4">رصيد أول المدة</td><td class="e num b">${cashAmount(st.opening, c)}</td></tr>`;
  let current = '';
  for (const l of st.lines) {
    if (l.date !== current) {
      current = l.date;
      const d = byDay.get(l.date);
      rows += `<tr class="day"><td colspan="5">${esc(dayTitle(l.date))}${d ? ` <span class="num">· ${d.count} حركة · قبض ${cashAmount(d.in, c)} · صرف ${cashAmount(d.out, c)}</span>` : ''}</td></tr>`;
    }
    rows += `<tr><td class="num sub">${esc(time12(l.time))}<br>${esc(l.num)}</td>
      <td>${esc(l.description || '—')}${l.other ? `<div class="sub">${esc(l.other)}${l.rate ? ` · <span class="num">سعر ${cashAmount(l.rate, 'IQD')}</span>` : ''}</div>` : ''}</td>
      <td class="e num in">${l.in ? cashAmount(l.in, c) : ''}</td><td class="e num out">${l.out ? cashAmount(l.out, c) : ''}</td><td class="e num b">${cashAmount(l.balance, c)}</td></tr>`;
  }
  if (!st.lines.length) rows += `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:18px">لا حركات في هذه الفترة</td></tr>`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>cash-${esc(st.box.num)}-${st.from}_${st.to}</title><style>
  @page { size: A4; margin: 11mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; font-size: 11.5px; line-height: 1.5; }
  .num { font-variant-numeric: tabular-nums; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 2.5px solid #065f46; }
  .top h1 { margin: 0; font-size: 18px; color: #065f46; }
  .top p { margin: 2px 0 0; color: #475569; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .kpi { background: #f1f5f9; border-radius: 10px; padding: 8px 12px; }
  .kpi span { display: block; color: #64748b; font-size: 9.5px; }
  .kpi b { font-size: 14px; }
  .kpi.in b { color: #047857; } .kpi.out b { color: #be123c; } .kpi.end { background: #065f46; color: #fff; } .kpi.end span { color: #a7f3d0; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #065f46; color: #fff; font-size: 10px; padding: 7px 8px; text-align: right; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr { break-inside: avoid; } thead { display: table-header-group; }
  .e { text-align: left; white-space: nowrap; } .b { font-weight: 700; }
  td.in { color: #047857; font-weight: 600; } td.out { color: #be123c; font-weight: 600; }
  .sub { color: #64748b; font-size: 9.5px; }
  tr.day td { background: #ecfdf5; font-weight: 700; color: #065f46; border-bottom: 0; }
  tr.day td span { font-weight: 500; color: #475569; }
  tr.open td { background: #fffbeb; font-weight: 600; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9.5px; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="top"><div><h1>كشف صندوق</h1><p>${esc(st.box.name)} · <span class="num">${esc(st.box.num)}</span></p></div><p>${esc(period)}</p></div>
  <div class="kpis">
    <div class="kpi"><span>رصيد أول المدة</span><b class="num">${cashAmount(st.opening, c)}</b></div>
    <div class="kpi in"><span>القبض</span><b class="num">${cashAmount(st.totalIn, c)}</b></div>
    <div class="kpi out"><span>الصرف</span><b class="num">${cashAmount(st.totalOut, c)}</b></div>
    <div class="kpi end"><span>رصيد آخر المدة (${cashUnit(c)})</span><b class="num">${cashAmount(st.closing, c)}</b></div>
  </div>
  <table><thead><tr><th style="width:60px">الوقت / السند</th><th>البيان</th><th class="e">قبض</th><th class="e">صرف</th><th class="e">الرصيد</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="foot"><span>البيانات من الإداري — لوحة تحكم FOT POS</span><span class="num">${new Date().toLocaleString('ar-IQ-u-nu-latn')}</span></div>
</body></html>`;
}
