import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatCurrency, formatNum } from '@/api/client';
import type {
  SalesmanDto,
  WeeklySettlementReportDto,
  WeeklySettlementRowDto,
  WeeklySettlementRowSaveDto,
} from '@/api/types';
import { Btn, Input } from '@/components/ui';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { IconBanknote, IconSliders } from '@/components/icons';
import { ProgressCell } from '@/components/workspace';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { formatPeriodRange, isoDate, shiftWeekIso } from '@/lib/businessPeriod';
import { fixEdariName } from '@/lib/text';
import { downloadCsv } from '@/utils/exportCsv';
import { ReportAppWindow } from './ReportAppWindow';

function apiErrorMessage(e: unknown) {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const j = JSON.parse(raw) as { message?: string; error?: string };
    return j.message || j.error || raw;
  } catch {
    return raw;
  }
}

function formatArDay(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
}

function parseAmount(raw: string) {
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function amountDisplay(row: WeeklySettlementRowDto, draft?: string) {
  if (draft !== undefined) return draft;
  if (row.amount > 0 || row.delivered) return String(row.amount);
  return '';
}

function patchRow(
  old: WeeklySettlementReportDto | undefined,
  saved: WeeklySettlementRowSaveDto,
): WeeklySettlementReportDto | undefined {
  if (!old) return old;
  return {
    ...old,
    rows: old.rows.map(r =>
      r.salesmanId === saved.salesmanId
        ? {
            ...r,
            amount: saved.amount,
            delivered: saved.delivered,
            deliveredAt: saved.deliveredAt,
            payoutId: saved.payoutId,
          }
        : r,
    ),
  };
}

export function WeeklySettlementApp({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { periods, weekLen } = useBusinessPeriod();
  const [weekStart, setWeekStart] = useState(periods.currentWeek.from);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [percentText, setPercentText] = useState('0');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (reportQ.isSuccess && (data?.salesmanIds.length ?? 0) === 0) setSettingsOpen(true);
  }, [reportQ.isSuccess, data?.salesmanIds.length]);

  const salesmenQ = useQuery({
    queryKey: ['salesmen', true],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });
  const salesmen = salesmenQ.data?.items ?? [];

  const saveSettings = useMutation({
    mutationFn: (req: { deductionPercent: number; salesmanIds: number[] }) =>
      api.saveWeeklySettlementSettings(req),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['weekly-settlement'] });
    },
    onError: e => setError(apiErrorMessage(e)),
  });

  const saveRow = useMutation({
    mutationFn: api.saveWeeklySettlementRow,
    onSuccess: saved => {
      setError(null);
      setDrafts(d => {
        const next = { ...d };
        delete next[saved.salesmanId];
        return next;
      });
      qc.setQueryData<WeeklySettlementReportDto>(['weekly-settlement', alignedStart], old => patchRow(old, saved));
    },
    onError: e => setError(apiErrorMessage(e)),
    onSettled: () => setBusyId(null),
  });

  const pinned = data?.salesmanIds ?? [];
  const canDeliver = data?.canDeliver ?? false;
  const isCurrent = data?.isCurrentWeek ?? alignedStart === periods.currentWeek.from;

  const deduction = useMemo(() => {
    const n = Number(percentText);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : data?.deductionPercent ?? 0;
  }, [percentText, data?.deductionPercent]);

  function persistSettings(ids: number[], percent = deduction) {
    saveSettings.mutate({ salesmanIds: ids, deductionPercent: percent });
  }

  async function putRow(row: WeeklySettlementRowDto, patch: { amount?: number; delivered?: boolean }) {
    setBusyId(row.salesmanId);
    setError(null);
    await saveRow.mutateAsync({
      weekStart: alignedStart,
      salesmanId: row.salesmanId,
      amount: patch.amount,
      delivered: patch.delivered,
    });
  }

  function commitAmount(row: WeeklySettlementRowDto) {
    if (row.delivered) return;
    const raw = drafts[row.salesmanId];
    if (raw === undefined) return;
    const amount = parseAmount(raw);
    if (amount === row.amount) {
      setDrafts(d => {
        const next = { ...d };
        delete next[row.salesmanId];
        return next;
      });
      return;
    }
    void putRow(row, { amount });
  }

  function mark(row: WeeklySettlementRowDto) {
    const amount = parseAmount(amountDisplay(row, drafts[row.salesmanId]));
    if (amount <= 0 || row.delivered || !canDeliver) return;
    const name = fixEdariName(row.salesmanName) || `#${row.salesmanId}`;
    if (!window.confirm(`تأكيد تسليم ${formatNum(amount)} د.ع لـ ${name}؟`)) return;
    void putRow(row, { amount, delivered: true });
  }

  function unmark(row: WeeklySettlementRowDto) {
    if (!row.delivered) return;
    if (!window.confirm('إلغاء تأشير التسليم؟ ستُلغى الدفعة المرتبطة في العمولات.')) return;
    void putRow(row, { delivered: false });
  }

  function exportCsv() {
    if (!data) return;
    const headers = [
      'البائع',
      'العمولات',
      ...data.targetColumns.map(c => c.name),
      'بعد التخفيض',
      'مبلغ التسليم',
      'تسليم',
    ];
    const rows = data.rows.map(r => {
      const byId = new Map(r.targets.map(t => [t.targetId, t]));
      return [
        fixEdariName(r.salesmanName) || `#${r.salesmanId}`,
        r.commission,
        ...data.targetColumns.map(c => {
          const cell = byId.get(c.targetId);
          if (!cell) return '';
          return `${cell.sold} / ${cell.goal}`;
        }),
        r.afterDeduction,
        r.amount,
        r.delivered ? 'نعم' : '',
      ];
    });
    downloadCsv(`كشف-تسليم_${alignedStart}_${alignedEnd}.csv`, headers, rows);
  }

  return (
    <ReportAppWindow
      title="كشف التسليم"
      subtitle={`${formatPeriodRange(alignedStart, alignedEnd)} · نسبة التخفيض ${formatNum(data?.deductionPercent ?? 0)}٪`}
      icon={<IconBanknote size={20} />}
      accent="linear-gradient(135deg, #a78bfa 0%, #6d28d9 100%)"
      actions={
        <>
          <Btn
            size="sm"
            variant="secondary"
            className="!border-white/20 !bg-white/15 !text-white hover:!bg-white/25"
            disabled={!data?.rows.length}
            onClick={exportCsv}
          >
            CSV
          </Btn>
          <button
            type="button"
            onClick={() => setSettingsOpen(v => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-bold transition ${
              settingsOpen ? 'bg-white text-violet-800' : 'bg-white/15 text-white hover:bg-white/25'
            }`}
          >
            <IconSliders size={14} />
            إعداد الكشف
          </button>
        </>
      }
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1">
        {settingsOpen && (
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
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              onClick={() => setWeekStart(shiftWeekIso(alignedStart, -1, weekLen).from)}
            >
              الأسبوع السابق ‹
            </button>
            <div className="min-w-[220px] text-center text-[14px] font-extrabold text-header">
              من {formatArDay(alignedStart)} إلى {formatArDay(alignedEnd)}
            </div>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              disabled={isCurrent}
              title={isCurrent ? 'هذا أحدث أسبوع يمكن عرضه' : undefined}
              onClick={() => setWeekStart(shiftWeekIso(alignedStart, 1, weekLen).from)}
            >
              › الأسبوع التالي
            </button>
          </div>

          {error && (
            <div className="mx-3 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
              {error}
            </div>
          )}

          {pinned.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[16px] font-extrabold text-header">اختر البائعين الظاهرين</p>
              <p className="max-w-sm text-[13.5px] leading-6 text-slate-500">
                القائمة ونسبة التخفيض تُحفظان على السيرفر، فيظهر نفس الكشف على أي جهاز إدارة.
              </p>
              <Btn onClick={() => setSettingsOpen(true)}>إعداد الكشف</Btn>
            </div>
          ) : reportQ.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-slate-500">جاري التحميل…</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-[2]">
                  <tr className="bg-slate-50 text-[11.5px] font-bold text-slate-500">
                    <th className="sticky start-0 z-[3] bg-slate-50 px-3 py-2 text-start shadow-[inset_0_-1px_0_#e2e8f0]">البائع</th>
                    <th className="px-3 py-2 text-start shadow-[inset_0_-1px_0_#e2e8f0]">العمولات</th>
                    {(data?.targetColumns ?? []).map(col => (
                      <th key={col.targetId} className="min-w-[160px] px-3 py-2 text-start shadow-[inset_0_-1px_0_#e2e8f0]">
                        {col.name}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-start shadow-[inset_0_-1px_0_#e2e8f0]">بعد التخفيض</th>
                    <th className="min-w-[140px] px-3 py-2 text-start shadow-[inset_0_-1px_0_#e2e8f0]">مبلغ التسليم</th>
                    <th className="w-[120px] px-3 py-2 text-start shadow-[inset_0_-1px_0_#e2e8f0]">تأشير</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map(row => {
                    const byId = new Map(row.targets.map(t => [t.targetId, t]));
                    const green = row.delivered;
                    const rowBg = green ? 'bg-emerald-50' : 'bg-white';
                    const busy = busyId === row.salesmanId;
                    const draft = drafts[row.salesmanId];
                    const typed = parseAmount(amountDisplay(row, draft));
                    const showMark = !row.delivered && typed > 0;
                    return (
                      <tr key={row.salesmanId} className={`${rowBg} border-b border-slate-100`}>
                        <td className={`sticky start-0 z-[1] px-3 py-2 font-extrabold text-header ${rowBg}`}>
                          {fixEdariName(row.salesmanName) || `#${row.salesmanId}`}
                        </td>
                        <td className="px-3 py-2">
                          <span className="num font-extrabold text-brand-800">{formatCurrency(row.commission)}</span>
                        </td>
                        {(data?.targetColumns ?? []).map(col => {
                          const cell = byId.get(col.targetId);
                          const isAmount = col.targetType.toLowerCase() === 'amount';
                          return (
                            <td key={col.targetId} className="px-3 py-2 align-middle">
                              {cell ? (
                                <div className="min-w-[140px] space-y-1">
                                  <div className="num text-[12.5px] font-semibold text-slate-700">
                                    {formatNum(cell.sold)}
                                    {isAmount ? ' د.ع' : ''}
                                    <span className="mx-1 text-slate-300">/</span>
                                    {cell.goal > 0 ? `${formatNum(cell.goal)}${isAmount ? ' د.ع' : ''}` : '—'}
                                  </div>
                                  {cell.goal > 0 ? (
                                    <ProgressCell percent={cell.percent} tone={cell.percent >= 100 ? 'ok' : 'brand'} />
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          <span className="num font-bold text-slate-800">{formatCurrency(row.afterDeduction)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            className={`!py-1.5 num ${green ? '!bg-emerald-50/80 !text-emerald-900' : ''}`}
                            inputMode="decimal"
                            readOnly={green}
                            disabled={busy}
                            value={amountDisplay(row, draft)}
                            placeholder=""
                            onChange={e => setDrafts(d => ({ ...d, [row.salesmanId]: e.target.value }))}
                            onBlur={() => commitAmount(row)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {row.delivered ? (
                            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => unmark(row)}>
                              تراجع
                            </Btn>
                          ) : showMark ? (
                            <Btn
                              size="sm"
                              disabled={busy || !canDeliver}
                              title={!canDeliver ? 'لا تسليم لأسبوع لم ينته' : undefined}
                              onClick={() => mark(row)}
                            >
                              تأشير
                            </Btn>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </ReportAppWindow>
  );
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
    <aside
      className="flex w-[min(100%,320px)] shrink-0 flex-col border-l border-slate-200 bg-white"
      data-keep-escape
    >
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-[14px] font-extrabold text-header">إعداد الكشف</h3>
        <p className="mt-1 text-[12px] leading-5 text-slate-500">
          يُحفظ على السيرفر لكل أجهزة الإدارة. ترتيب التثبيت هو ترتيب الصفوف.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">نسبة التخفيض العامة (%)</label>
          <Input
            className="!py-1.5 num"
            inputMode="decimal"
            value={percentText}
            onChange={e => onPercentChange(e.target.value)}
            onBlur={onPercentCommit}
          />
        </div>
        <div>
          <p className="mb-1.5 text-[11.5px] font-semibold text-slate-500">البائعون الظاهرون</p>
          <SalesmanMultiSelect
            salesmen={salesmen.map(s => ({ id: s.id, name: fixEdariName(s.name) || `#${s.id}` }))}
            selectedIds={pinned}
            onChange={onPinnedChange}
            emptyLabel="لم يُختر أحد بعد"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
        <span className="text-[12px] text-slate-500">{formatNum(pinned.length)} مثبت</span>
        <Btn size="sm" loading={saving} onClick={onDone}>تم</Btn>
      </div>
    </aside>
  );
}
