import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatNum } from '@/api/client';
import type {
  SalesmanDto,
  WeeklySettlementReportDto,
  WeeklySettlementRowDto,
  WeeklySettlementRowSaveDto,
} from '@/api/types';
import { Alert, Btn, EmptyState, Field, Input, useConfirm } from '@/components/ui';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { useToast } from '@/components/Toast';
import {
  IconBanknote,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconPrinter,
  IconSliders,
  IconUsers,
} from '@/components/icons';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange, isoDate, shiftWeekIso } from '@/lib/businessPeriod';
import { printDocument } from '@/lib/print';
import { fixEdariName } from '@/lib/text';
import type { ReportExcelSheet } from '@/lib/reportExcel';
import { downloadCsv } from '@/utils/exportCsv';
import { ReportAppWindow, ReportAside } from './ReportAppWindow';
import { ExcelBtn, ReportBanner, ReportCenter, ReportError, ReportFill, errorText } from './ReportKit';

/* ─────────────────────────────────────────────────────────────────────────────
 * كشف التسليم الأسبوعي — جدول واضح كما كان: البائع · العمولة · الأهداف · بعد التخفيض
 * · مبلغ التسليم · تأشير. مع مجموع أسفل الجدول، تعبئة سريعة، وطباعة كشف رسمي بتواقيع.
 * ───────────────────────────────────────────────────────────────────────────── */

const DINAR = 'د.ع';

function money(n: number) {
  return `${formatNum(Math.round(n))} ${DINAR}`;
}

function formatArDay(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('ar-IQ', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatArShort(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function parseAmount(raw: string) {
  const n = Number(String(raw).replace(/[,\s٬]/g, '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim());
  return Number.isFinite(n) ? n : 0;
}

function amountDisplay(row: WeeklySettlementRowDto, draft?: string) {
  if (draft !== undefined) return draft;
  if (row.amount > 0 || row.delivered) return formatNum(row.amount);
  return '';
}

function nameOf(r: WeeklySettlementRowDto) {
  return fixEdariName(r.salesmanName) || `#${r.salesmanId}`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function patchRow(old: WeeklySettlementReportDto | undefined, saved: WeeklySettlementRowSaveDto): WeeklySettlementReportDto | undefined {
  if (!old) return old;
  return {
    ...old,
    rows: old.rows.map(r =>
      r.salesmanId === saved.salesmanId
        ? { ...r, amount: saved.amount, delivered: saved.delivered, deliveredAt: saved.deliveredAt, payoutId: saved.payoutId }
        : r,
    ),
  };
}

export function WeeklySettlementApp({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const { periods, weekLen } = useBusinessPeriod();
  const [weekStart, setWeekStart] = useState(periods.currentWeek.from);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [percentText, setPercentText] = useState('0');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const inputRefs = useRef(new Map<number, HTMLInputElement>());

  const reportQ = useQuery({
    queryKey: ['weekly-settlement', weekStart],
    queryFn: () => api.weeklySettlement(weekStart),
  });
  const data = reportQ.data;
  const alignedStart = data ? isoDate(data.weekStart) : weekStart;
  const alignedEnd = data ? isoDate(data.weekEnd) : periods.currentWeek.to;

  useEffect(() => {
    if (data) setPercentText(String(data.deductionPercent));
  }, [data?.deductionPercent]);

  useEffect(() => {
    if (!data) return;
    const next = isoDate(data.weekStart);
    if (next !== weekStart) setWeekStart(next);
  }, [data?.weekStart, weekStart]);

  useEffect(() => {
    setDrafts({});
    setError(null);
  }, [alignedStart]);

  useEffect(() => {
    if (reportQ.isSuccess && (data?.salesmanIds?.length ?? 0) === 0) setSettingsOpen(true);
  }, [reportQ.isSuccess, data?.salesmanIds?.length]);

  const salesmenQ = useQuery({
    queryKey: ['salesmen', true],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });
  const salesmen = salesmenQ.data?.items ?? [];

  const saveSettings = useMutation({
    mutationFn: (req: { deductionPercent: number; salesmanIds: number[] }) => api.saveWeeklySettlementSettings(req),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['weekly-settlement'] });
    },
    onError: e => setError(errorText(e, 'تعذّر حفظ الإعداد')),
  });

  const saveRow = useMutation({
    mutationFn: api.saveWeeklySettlementRow,
    onSuccess: (saved, vars) => {
      setError(null);
      // الأسبوع من متغيرات الطلب لا من الأسبوع المعروض — قد يتنقل المستخدم قبل وصول الرد
      if (vars.weekStart === alignedStart) {
        setDrafts(d => {
          const next = { ...d };
          delete next[saved.salesmanId];
          return next;
        });
      }
      qc.setQueryData<WeeklySettlementReportDto>(['weekly-settlement', vars.weekStart], old => patchRow(old, saved));
    },
    onError: e => setError(errorText(e, 'تعذّر الحفظ')),
    onSettled: (_d, _e, vars) =>
      setBusyIds(prev => {
        const next = new Set(prev);
        next.delete(vars.salesmanId);
        return next;
      }),
  });

  const pinned = Array.isArray(data?.salesmanIds) ? data.salesmanIds : [];
  const canDeliver = data?.canDeliver ?? false;
  const isCurrent = data?.isCurrentWeek ?? alignedStart === periods.currentWeek.from;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const targetColumns = Array.isArray(data?.targetColumns) ? data.targetColumns : [];
  const hasRows = rows.length > 0;

  const deduction = useMemo(() => {
    const n = Number(percentText);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : data?.deductionPercent ?? 0;
  }, [percentText, data?.deductionPercent]);

  const totals = useMemo(() => {
    const delivered = rows.filter(r => r.delivered);
    return {
      commission: rows.reduce((s, r) => s + r.commission, 0),
      afterDeduction: rows.reduce((s, r) => s + r.afterDeduction, 0),
      amount: rows.reduce((s, r) => s + (r.delivered || r.amount > 0 ? r.amount : 0), 0),
      delivered: delivered.reduce((s, r) => s + r.amount, 0),
      deliveredCount: delivered.length,
    };
  }, [rows]);

  /** صفوف بلا مبلغ ولم تُسلَّم — تصلح للتعبئة السريعة. */
  const fillable = rows.filter(r => !r.delivered && !(r.amount > 0) && r.afterDeduction > 0 && drafts[r.salesmanId] === undefined);
  const deliverable = rows.filter(r => !r.delivered && canDeliver && (r.amount > 0 || parseAmount(drafts[r.salesmanId] ?? '') > 0));

  function persistSettings(ids: number[], percent = deduction) {
    saveSettings.mutate({ salesmanIds: ids, deductionPercent: percent });
  }

  async function putRow(row: WeeklySettlementRowDto, patch: { amount?: number; delivered?: boolean }) {
    setBusyIds(prev => new Set(prev).add(row.salesmanId));
    setError(null);
    try {
      await saveRow.mutateAsync({ weekStart: alignedStart, salesmanId: row.salesmanId, amount: patch.amount, delivered: patch.delivered });
      return true;
    } catch {
      return false; // الخطأ يظهر في الشريط أعلاه
    }
  }

  function clearDraft(id: number) {
    setDrafts(d => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  function commitAmount(row: WeeklySettlementRowDto) {
    if (row.delivered || busyIds.has(row.salesmanId)) return;
    const raw = drafts[row.salesmanId];
    if (raw === undefined) return;
    const amount = parseAmount(raw);
    if (amount === row.amount) {
      clearDraft(row.salesmanId);
      return;
    }
    void putRow(row, { amount });
  }

  function focusNext(row: WeeklySettlementRowDto) {
    const idx = rows.findIndex(r => r.salesmanId === row.salesmanId);
    for (let i = idx + 1; i < rows.length; i++) {
      if (rows[i].delivered) continue;
      const el = inputRefs.current.get(rows[i].salesmanId);
      if (el) {
        el.focus();
        el.select();
        return;
      }
    }
    inputRefs.current.get(row.salesmanId)?.blur();
  }

  async function mark(row: WeeklySettlementRowDto) {
    const amount = parseAmount(amountDisplay(row, drafts[row.salesmanId]));
    if (amount <= 0 || row.delivered || !canDeliver) return;
    const name = nameOf(row);
    const ok = await confirm({
      title: 'تأكيد التسليم',
      message: `تسليم ${money(amount)} إلى ${name} عن أسبوع ${formatPeriodRange(alignedStart, alignedEnd)}؟ ستُسجَّل دفعة في العمولات.`,
      confirmLabel: 'تأكيد التسليم',
    });
    if (!ok) return;
    if (await putRow(row, { amount, delivered: true })) toast.success(`تم تأشير تسليم ${name}`);
  }

  async function unmark(row: WeeklySettlementRowDto) {
    if (!row.delivered) return;
    const ok = await confirm({
      title: 'إلغاء تأشير التسليم؟',
      message: `سيُلغى تسليم ${nameOf(row)} وتُلغى الدفعة المرتبطة في العمولات.`,
      confirmLabel: 'إلغاء التأشير',
      danger: true,
    });
    if (!ok) return;
    if (await putRow(row, { delivered: false })) toast.info('أُلغي تأشير التسليم');
  }

  async function fillAll() {
    if (!fillable.length) return;
    const ok = await confirm({
      title: 'تعبئة مبالغ التسليم',
      message: `كتابة مبلغ «بعد التخفيض» كمبلغ تسليم لـ ${formatNum(fillable.length)} بائع بلا مبلغ؟ يمكنك تعديل أي مبلغ بعدها، ولا يُؤشَّر أي تسليم تلقائياً.`,
      confirmLabel: 'تعبئة',
    });
    if (!ok) return;
    setFilling(true);
    let done = 0;
    for (const r of fillable) {
      if (await putRow(r, { amount: Math.round(r.afterDeduction) })) done++;
    }
    setFilling(false);
    toast.success(`عُبّئت مبالغ ${formatNum(done)} بائع`);
  }

  async function deliverAllReady() {
    if (!deliverable.length) return;
    const sum = deliverable.reduce((s, r) => s + (parseAmount(amountDisplay(r, drafts[r.salesmanId])) || r.amount), 0);
    const ok = await confirm({
      title: `تأشير تسليم ${formatNum(deliverable.length)} بائع؟`,
      message: `سيتم تأشير استلام جميع البائعين الذين لديهم مبلغ تسليم محدد بمجموع ${money(sum)}.`,
      confirmLabel: 'تأشير الكل',
    });
    if (!ok) return;
    setFilling(true);
    let done = 0;
    for (const r of deliverable) {
      const amount = parseAmount(amountDisplay(r, drafts[r.salesmanId])) || r.amount;
      if (amount > 0 && await putRow(r, { amount, delivered: true })) done++;
    }
    setFilling(false);
    toast.success(`تم تأشير تسليم ${formatNum(done)} بائع`);
  }

  function settlementTable() {
    const headers = ['البائع', 'العمولات', ...targetColumns.map(c => c.name), 'بعد التخفيض', 'مبلغ التسليم', 'الحالة'];
    const out = rows.map(r => {
      const byId = new Map(r.targets.map(t => [t.targetId, t]));
      return [
        nameOf(r),
        r.commission,
        ...targetColumns.map(c => {
          const cell = byId.get(c.targetId);
          if (!cell) return '—';
          return `${formatNum(cell.sold)} / ${cell.goal > 0 ? formatNum(cell.goal) : '—'}${cell.goal > 0 ? ` (${Math.round(cell.percent)}%)` : ''}`;
        }),
        r.afterDeduction,
        r.delivered || r.amount > 0 ? r.amount : 0,
        r.delivered ? 'مُسلَّم' : 'غير مُسلَّم',
      ];
    });
    return { headers, rows: out };
  }

  function sheets(): ReportExcelSheet[] {
    if (!hasRows || !data) return [];
    const { headers, rows: out } = settlementTable();
    out.push(['المجموع', totals.commission, ...targetColumns.map(() => ''), totals.afterDeduction, totals.amount, `${totals.deliveredCount} / ${rows.length}`]);
    return [
      {
        name: 'كشف التسليم',
        title: 'كشف التسليم الأسبوعي',
        subtitle: `${formatPeriodRange(alignedStart, alignedEnd)} · تخفيض ${formatNum(data.deductionPercent)}٪`,
        headers,
        rows: out,
        columnWidths: [150, 92, ...targetColumns.map(() => 110), 92, 92, 64],
      },
    ];
  }

  function exportCsv() {
    const { headers, rows: out } = settlementTable();
    if (!out.length) return;
    downloadCsv(`كشف-تسليم_${alignedStart}_${alignedEnd}.csv`, headers, out);
  }

  async function printStatement() {
    if (!hasRows || !data) return;
    setPrinting(true);
    try {
      await printDocument(statementHtml(data, rows, targetColumns, totals, alignedStart, alignedEnd));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
    } finally {
      setPrinting(false);
    }
  }

  const pct = rows.length ? Math.round((totals.deliveredCount / rows.length) * 100) : 0;

  return (
    <ReportAppWindow
      accent="linear-gradient(135deg, #a78bfa 0%, #6d28d9 100%)"
      title="كشف التسليم"
      subtitle={`${formatPeriodRange(alignedStart, alignedEnd)} · نسبة التخفيض ${formatNum(data?.deductionPercent ?? 0)}٪`}
      icon={<IconBanknote size={20} />}
      actions={
        <>
          <Btn
            size="sm"
            variant={settingsOpen ? 'soft' : 'secondary'}
            icon={<IconSliders size={14} />}
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(v => !v)}
          >
            إعداد الكشف
          </Btn>
          <Btn size="sm" variant="secondary" icon={<IconPrinter size={14} />} loading={printing} disabled={!hasRows} onClick={() => void printStatement()}>
            طباعة الكشف
          </Btn>
          <ExcelBtn fileName={`كشف-تسليم_${alignedStart}_${alignedEnd}`} getSheets={sheets} disabled={!hasRows} variant="ghost" />
          <Btn size="sm" variant="ghost" disabled={!hasRows} onClick={exportCsv}>
            CSV
          </Btn>
        </>
      }
      toolbar={
        <span className="text-[12px] text-slate-500">
          اكتب مبلغ التسليم ثم اضغط <b className="text-slate-700">تأشير</b> — يُحفظ على السيرفر ويظهر على كل أجهزة الإدارة.
        </span>
      }
      aside={
        settingsOpen ? (
          <SettingsPanel
            salesmen={salesmen}
            pinned={pinned}
            percentText={percentText}
            saving={saveSettings.isPending}
            onPercentChange={setPercentText}
            onPercentCommit={() => persistSettings(pinned, deduction)}
            onPinnedChange={ids => persistSettings(ids)}
            onDone={() => {
              persistSettings(pinned, deduction);
              setSettingsOpen(false);
            }}
          />
        ) : undefined
      }
      onClose={onClose}
    >
      <ReportFill>
        {/* متصفح الأسابيع — كبير وفي المنتصف كما كان */}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setWeekStart(shiftWeekIso(alignedStart, -1, weekLen).from)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-bold text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800"
          >
            <IconChevronRight size={15} />
            الأسبوع السابق
          </button>
          <div className="min-w-[260px] text-center">
            <div className="text-[16px] font-extrabold text-header">
              من {formatArDay(alignedStart)} إلى {formatArDay(alignedEnd)}
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-2 text-[11.5px] font-semibold">
              {isCurrent ? (
                <span className="inline-flex items-center gap-1 text-sky-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                  الأسبوع الحالي — لم ينتهِ بعد
                </span>
              ) : (
                <>
                  <span className="text-slate-500">أسبوع منتهٍ</span>
                  <button type="button" className="text-violet-700 underline-offset-2 hover:underline" onClick={() => setWeekStart(periods.currentWeek.from)}>
                    العودة للأسبوع الحالي
                  </button>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={isCurrent}
            title={isCurrent ? 'هذا أحدث أسبوع' : undefined}
            onClick={() => setWeekStart(shiftWeekIso(alignedStart, 1, weekLen).from)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-bold text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 disabled:pointer-events-none disabled:opacity-40"
          >
            الأسبوع التالي
            <IconChevronLeft size={15} />
          </button>
        </div>

        {error && (
          <ReportBanner>
            <Alert type="error" title="تعذّر الحفظ">{error}</Alert>
          </ReportBanner>
        )}
        {reportQ.isError && (
          <ReportBanner>
            <ReportError error={reportQ.error} onRetry={() => void reportQ.refetch()} />
          </ReportBanner>
        )}

        {reportQ.isError && !data ? null : !reportQ.isLoading && pinned.length === 0 ? (
          <ReportCenter>
            <EmptyState
              icon={<IconUsers size={24} />}
              title="اختر البائعين الظاهرين في الكشف"
              description="القائمة ونسبة التخفيض تُحفظان على السيرفر، فيظهر نفس الكشف على أي جهاز إدارة."
              action={<Btn icon={<IconSliders size={14} />} onClick={() => setSettingsOpen(true)}>إعداد الكشف</Btn>}
            />
          </ReportCenter>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
            {hasRows && (
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
                <Stat label="مجموع العمولات" value={money(totals.commission)} />
                <Stat label="بعد التخفيض" value={money(totals.afterDeduction)} />
                <Stat label="المُسلَّم" value={money(totals.delivered)} tone="ok" />
                <div className="flex min-w-[200px] flex-1 items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-[12.5px] font-bold text-slate-600">
                    <span className="num">{formatNum(totals.deliveredCount)}</span> من <span className="num">{formatNum(rows.length)}</span> سُلِّموا
                  </span>
                </div>
                {fillable.length > 0 && (
                  <Btn size="sm" variant="soft" loading={filling} onClick={() => void fillAll()} title="كتابة «بعد التخفيض» في كل مبلغ فارغ">
                    تعبئة المبالغ الفارغة ({formatNum(fillable.length)})
                  </Btn>
                )}
                {deliverable.length > 1 && (
                  <Btn size="sm" icon={<IconCheck size={14} />} loading={filling} onClick={() => void deliverAllReady()} title="تأشير استلام كل البائعين الذين حُدد مبلغهم">
                    تأشير تسليم الكل ({formatNum(deliverable.length)})
                  </Btn>
                )}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
                  <thead>
                    <tr className="whitespace-nowrap bg-violet-50 text-[12px] font-bold text-violet-900">
                      <th className="w-10 px-3 py-2.5 text-center">#</th>
                      <th className="sticky start-0 z-[3] bg-violet-50 px-3 py-2.5 text-start">البائع</th>
                      <th className="px-3 py-2.5 text-start">العمولات</th>
                      {targetColumns.map(col => (
                        <th key={col.targetId} className="min-w-[170px] px-3 py-2.5 text-start">
                          {col.name}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-start">بعد التخفيض</th>
                      <th className="min-w-[170px] px-3 py-2.5 text-start">مبلغ التسليم</th>
                      <th className="w-[150px] px-3 py-2.5 text-center">تأشير</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportQ.isLoading &&
                      Array.from({ length: 5 }, (_, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td colSpan={6 + targetColumns.length} className="px-3 py-3">
                            <div className="skeleton h-5 w-full rounded" />
                          </td>
                        </tr>
                      ))}
                    {!reportQ.isLoading && !hasRows && (
                      <tr>
                        <td colSpan={6 + targetColumns.length} className="px-3 py-10 text-center text-slate-400">
                          لا بيانات لهذا الأسبوع
                        </td>
                      </tr>
                    )}
                    {rows.map((row, idx) => {
                      const byId = new Map(row.targets.map(t => [t.targetId, t]));
                      const green = row.delivered;
                      const rowBg = green ? 'bg-emerald-50' : 'bg-white';
                      const busy = busyIds.has(row.salesmanId);
                      const draft = drafts[row.salesmanId];
                      const typed = parseAmount(amountDisplay(row, draft));
                      const differs = !green && typed > 0 && Math.round(typed) !== Math.round(row.afterDeduction);
                      const showFill = !green && row.afterDeduction > 0 && typed === 0;
                      return (
                        <tr key={row.salesmanId} className={`${rowBg} border-t border-slate-100 transition-colors ${green ? '' : 'hover:bg-slate-50/60'}`}>
                          <td className="num px-3 py-3 text-center text-[12px] text-slate-400">{idx + 1}</td>
                          <td className={`sticky start-0 z-[1] px-3 py-3 ${rowBg}`}>
                            <div className="whitespace-nowrap font-extrabold text-header">{nameOf(row)}</div>
                            {green && row.deliveredAt && (
                              <div className="mt-0.5 text-[11px] font-semibold text-emerald-700">سُلِّم {formatArShort(row.deliveredAt)}</div>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className="num whitespace-nowrap font-extrabold text-violet-800">{money(row.commission)}</span>
                          </td>
                          {targetColumns.map(col => {
                            const cell = byId.get(col.targetId);
                            const isAmount = (col.targetType ?? '').toLowerCase() === 'amount';
                            const unit = isAmount ? ` ${DINAR}` : '';
                            return (
                              <td key={col.targetId} className="px-3 py-3 align-middle">
                                {cell ? (
                                  <div className="min-w-[150px] space-y-1.5">
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className="num whitespace-nowrap text-[12.5px] font-semibold text-slate-700">
                                        {formatNum(cell.sold)}
                                        {unit}
                                        <span className="mx-1 text-slate-300">/</span>
                                        {cell.goal > 0 ? `${formatNum(cell.goal)}${unit}` : '—'}
                                      </span>
                                      {cell.goal > 0 && (
                                        <span className={`num text-[11.5px] font-extrabold ${cell.percent >= 100 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                          {Math.round(cell.percent)}%
                                        </span>
                                      )}
                                    </div>
                                    {cell.goal > 0 && <ProgressBar percent={cell.percent} />}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-3">
                            <span className="num whitespace-nowrap font-bold text-slate-800">{money(row.afterDeduction)}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="relative">
                              <Input
                                ref={el => {
                                  if (el) inputRefs.current.set(row.salesmanId, el);
                                  else inputRefs.current.delete(row.salesmanId);
                                }}
                                className={`num !h-10 !text-[14px] font-bold ${green ? '!border-emerald-200 !bg-emerald-50 !text-emerald-900' : ''} ${busy ? 'opacity-60' : ''} ${showFill ? '!pe-20' : ''}`}
                                inputMode="decimal"
                                readOnly={green || busy}
                                aria-busy={busy || undefined}
                                value={amountDisplay(row, draft)}
                                placeholder="0"
                                aria-label={`مبلغ تسليم ${nameOf(row)}`}
                                onFocus={e => e.currentTarget.select()}
                                onChange={e => setDrafts(d => ({ ...d, [row.salesmanId]: e.target.value }))}
                                onBlur={() => commitAmount(row)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    focusNext(row);
                                  }
                                  if (e.key === 'Escape') clearDraft(row.salesmanId);
                                }}
                              />
                              {showFill && (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  title="كتابة مبلغ «بعد التخفيض»"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => {
                                    setDrafts(d => ({ ...d, [row.salesmanId]: String(Math.round(row.afterDeduction)) }));
                                    void putRow(row, { amount: Math.round(row.afterDeduction) });
                                  }}
                                  className="absolute inset-y-1.5 end-1.5 rounded-md bg-violet-50 px-2 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                >
                                  = المستحق
                                </button>
                              )}
                            </div>
                            {differs && (
                              <div className="mt-1 text-[11px] font-semibold text-amber-700">
                                يختلف عن المستحق بـ <span className="num">{money(typed - row.afterDeduction)}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {green ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-extrabold text-emerald-800">
                                  <IconCheck size={13} /> تم التسليم
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void unmark(row)}
                                  className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-600 hover:underline disabled:opacity-50"
                                >
                                  تراجع
                                </button>
                              </div>
                            ) : typed > 0 ? (
                              <Btn
                                size="sm"
                                className="!bg-violet-600 hover:!bg-violet-700"
                                icon={<IconCheck size={14} />}
                                loading={busy}
                                disabled={busy || !canDeliver}
                                title={!canDeliver ? 'التأشير متاح بعد انتهاء الأسبوع' : undefined}
                                // يمنع blur الحقل (حفظ تلقائي يعطّل الزر) فلا تضيع أول نقرة
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => void mark(row)}
                              >
                                تأشير
                              </Btn>
                            ) : (
                              <span className="text-[12px] text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {hasRows && (
                    <tfoot>
                      <tr className="whitespace-nowrap border-t-2 border-violet-200 bg-violet-50/60 text-[13.5px] font-extrabold text-header">
                        <td />
                        <td className="sticky start-0 z-[1] bg-violet-50 px-3 py-3">المجموع</td>
                        <td className="num px-3 py-3 text-violet-800">{money(totals.commission)}</td>
                        {targetColumns.map(c => (
                          <td key={c.targetId} />
                        ))}
                        <td className="num px-3 py-3">{money(totals.afterDeduction)}</td>
                        <td className="num px-3 py-3">{money(totals.amount)}</td>
                        <td className="px-3 py-3 text-center text-[12.5px] text-emerald-700">
                          <span className="num">{formatNum(totals.deliveredCount)}</span> / <span className="num">{formatNum(rows.length)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
            {hasRows && !canDeliver && (
              <p className="mt-2 text-center text-[12px] text-slate-500">
                هذا الأسبوع لم ينتهِ بعد — يمكن كتابة المبالغ مسبقاً، والتأشير يصبح متاحاً بعد انتهائه.
              </p>
            )}
          </div>
        )}
      </ReportFill>
    </ReportAppWindow>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className={`num text-[15px] font-extrabold ${tone === 'ok' ? 'text-emerald-700' : 'text-header'}`}>{value}</div>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${p >= 100 ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${p}%` }} />
    </div>
  );
}

/** كشف مطبوع A4: جدول واضح، مجموع، خانة توقيع لكل بائع، وتواقيع أسفل الكشف. */
function statementHtml(
  data: WeeklySettlementReportDto,
  rows: WeeklySettlementRowDto[],
  targetColumns: WeeklySettlementReportDto['targetColumns'],
  totals: { commission: number; afterDeduction: number; amount: number; deliveredCount: number },
  from: string,
  to: string,
) {
  const head = ['#', 'البائع', 'العمولات', ...targetColumns.map(c => c.name), 'بعد التخفيض', 'مبلغ التسليم', 'توقيع المستلم']
    .map(h => `<th>${esc(h)}</th>`)
    .join('');
  const body = rows
    .map((r, i) => {
      const byId = new Map(r.targets.map(t => [t.targetId, t]));
      const targets = targetColumns
        .map(c => {
          const cell = byId.get(c.targetId);
          if (!cell) return '<td class="c">—</td>';
          const pct = cell.goal > 0 ? `<div class="pct ${cell.percent >= 100 ? 'ok' : ''}">${Math.round(cell.percent)}%</div>` : '';
          return `<td class="c"><span class="n">${esc(formatNum(cell.sold))}</span> / <span class="n">${cell.goal > 0 ? esc(formatNum(cell.goal)) : '—'}</span>${pct}</td>`;
        })
        .join('');
      const amount = r.delivered || r.amount > 0 ? money(r.amount) : '';
      return `<tr class="${r.delivered ? 'done' : ''}"><td class="c muted">${i + 1}</td><td class="name">${esc(nameOf(r))}${r.delivered ? '<span class="tick">✓ مُسلَّم</span>' : ''}</td>
<td class="n">${esc(money(r.commission))}</td>${targets}<td class="n">${esc(money(r.afterDeduction))}</td><td class="n strong">${esc(amount)}</td><td class="sign"></td></tr>`;
    })
    .join('');
  const foot = `<tr><td></td><td>المجموع</td><td class="n">${esc(money(totals.commission))}</td>${targetColumns.map(() => '<td></td>').join('')}<td class="n">${esc(money(totals.afterDeduction))}</td><td class="n">${esc(money(totals.amount))}</td><td class="c">${totals.deliveredCount} / ${rows.length}</td></tr>`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف التسليم ${esc(from)} — ${esc(to)}</title>
<style>
  @page { size: A4 ${targetColumns.length > 2 ? 'landscape' : 'portrait'}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; font-size: 12.5px; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #6d28d9; padding-bottom: 10px; margin-bottom: 12px; }
  h1 { font-size: 22px; margin: 0; color: #4c1d95; }
  .week { font-size: 14px; font-weight: 700; margin-top: 4px; }
  .meta { text-align: left; color: #64748b; font-size: 11px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #ede9fe; color: #4c1d95; font-size: 11.5px; padding: 8px 6px; text-align: right; border: 1px solid #c4b5fd; }
  td { border: 1px solid #e2e8f0; padding: 9px 6px; vertical-align: middle; }
  tr.done td { background: #f0fdf4; }
  td.n { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.c { text-align: center; }
  td.name { font-weight: 800; }
  td.strong { font-weight: 800; }
  td.sign { min-width: 34mm; }
  .muted { color: #94a3b8; }
  .tick { display: inline-block; margin-inline-start: 6px; font-size: 10px; color: #15803d; font-weight: 700; }
  .pct { font-size: 10px; color: #64748b; font-weight: 700; } .pct.ok { color: #15803d; }
  tfoot td { background: #f5f3ff; font-weight: 800; border-top: 2px solid #a78bfa; }
  .signs { display: flex; justify-content: space-between; gap: 24px; margin-top: 34px; }
  .signs div { flex: 1; text-align: center; border-top: 1px dashed #94a3b8; padding-top: 6px; color: #475569; font-size: 12px; }
  thead { display: table-header-group; } tr { break-inside: avoid; }
</style></head><body>
<div class="top">
  <div><h1>كشف التسليم الأسبوعي</h1><div class="week">من ${esc(formatArDay(from))} إلى ${esc(formatArDay(to))}</div></div>
  <div class="meta">نسبة التخفيض: <b>${esc(formatNum(data.deductionPercent))}٪</b><br/>عدد البائعين: <b>${rows.length}</b><br/>طُبع: ${esc(new Date().toLocaleString('ar-IQ'))}</div>
</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>
<div class="signs"><div>المحاسب</div><div>أمين الصندوق</div><div>المدير</div></div>
</body></html>`;
}

function SettingsPanel({
  salesmen,
  pinned,
  percentText,
  saving,
  onPercentChange,
  onPercentCommit,
  onPinnedChange,
  onDone,
}: {
  salesmen: SalesmanDto[];
  pinned: number[];
  percentText: string;
  saving: boolean;
  onPercentChange: (v: string) => void;
  onPercentCommit: () => void;
  onPinnedChange: (ids: number[]) => void;
  onDone: () => void;
}) {
  return (
    <ReportAside
      title="إعداد الكشف"
      description="يُحفظ على السيرفر لكل أجهزة الإدارة. ترتيب التثبيت هو ترتيب الصفوف."
      footer={
        <>
          <span className="text-[12px] text-slate-500">
            <span className="num font-semibold">{formatNum(pinned.length)}</span> مثبت
          </span>
          <Btn size="sm" loading={saving} onClick={onDone}>
            حفظ وإغلاق
          </Btn>
        </>
      }
    >
      <Field label="نسبة التخفيض العامة (%)" hint="تُطبَّق على عمولة كل بائع لحساب «بعد التخفيض».">
        <Input
          className="num"
          inputMode="decimal"
          value={percentText}
          onChange={e => onPercentChange(e.target.value)}
          onBlur={onPercentCommit}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </Field>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-slate-600">البائعون الظاهرون</p>
        <SalesmanMultiSelect
          salesmen={salesmen.map(s => ({ id: s.id, name: fixEdariName(s.name) || `#${s.id}` }))}
          selectedIds={pinned}
          onChange={onPinnedChange}
          emptyLabel="لم يُختر أحد بعد"
        />
      </div>
    </ReportAside>
  );
}
