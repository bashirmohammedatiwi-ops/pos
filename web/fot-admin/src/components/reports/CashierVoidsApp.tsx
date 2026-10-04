import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { CashierVoidEventDto } from '@/api/types';
import { IconActivity } from '@/components/icons';
import { useBusinessPeriod } from '@/hooks/useBusinessPeriod';
import { isoDate } from '@/lib/businessPeriod';
import { fixEdariName } from '@/lib/text';
import { ReportAppWindow } from './ReportAppWindow';

type PeriodId = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'custom';

function shiftIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function pretty(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-IQ', { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(source?: string | null) {
  return source === 'deferred' ? 'فاتورة مؤجلة' : 'فاتورة جارية';
}

function nameOf(raw?: string | null) {
  const fixed = fixEdariName(raw || '');
  return fixed || raw || 'كاشير';
}

export function CashierVoidsApp({ onClose }: { onClose: () => void }) {
  const { periods } = useBusinessPeriod();
  const today = isoDate(new Date());
  const [period, setPeriod] = useState<PeriodId>('today');
  const [customFrom, setCustomFrom] = useState(periods.currentWeek.from);
  const [customTo, setCustomTo] = useState(periods.currentWeek.to);
  const [cashierId, setCashierId] = useState<number | null>(null);

  const range = useMemo(() => {
    if (period === 'today') return { from: today, to: today };
    if (period === 'yesterday') {
      const y = shiftIso(today, -1);
      return { from: y, to: y };
    }
    if (period === 'week') return periods.currentWeek;
    if (period === 'lastWeek') return periods.previousWeek;
    if (period === 'month') return periods.currentMonth;
    const from = customFrom <= customTo ? customFrom : customTo;
    const to = customFrom <= customTo ? customTo : customFrom;
    return { from, to };
  }, [period, periods, today, customFrom, customTo]);

  const summaryQ = useQuery({
    queryKey: ['cashier-voids', range.from, range.to],
    queryFn: () => api.cashierVoids(range.from, range.to),
  });

  const detailQ = useQuery({
    queryKey: ['cashier-voids', cashierId, range.from, range.to],
    queryFn: () => api.cashierVoidDetail(cashierId!, range.from, range.to),
    enabled: cashierId != null,
  });

  const cashiers = summaryQ.data?.cashiers ?? [];
  const selected = cashiers.find(c => c.cashierId === cashierId) ?? null;

  useEffect(() => {
    if (cashierId != null && summaryQ.isSuccess && !cashiers.some(c => c.cashierId === cashierId)) {
      setCashierId(null);
    }
  }, [cashierId, cashiers, summaryQ.isSuccess]);

  const chips: { id: PeriodId; label: string }[] = [
    { id: 'today', label: 'اليوم' },
    { id: 'yesterday', label: 'أمس' },
    { id: 'week', label: 'هذا الأسبوع' },
    { id: 'lastWeek', label: 'الأسبوع الماضي' },
    { id: 'month', label: 'هذا الشهر' },
    { id: 'custom', label: 'مدة' },
  ];

  const days = useMemo(() => {
    const groups = new Map<string, CashierVoidEventDto[]>();
    for (const event of detailQ.data ?? []) {
      const key = dayKey(event.createdAt);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [detailQ.data]);

  return (
    <ReportAppWindow
      title="حذف وإلغاء"
      subtitle="بنود محذوفة وفواتير ملغاة لكل كاشير"
      icon={<IconActivity size={20} />}
      accent="linear-gradient(135deg, #e11d48 0%, #9f1239 100%)"
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-[#f6f3f4] p-4 sm:p-6" dir="rtl">
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex flex-wrap gap-1.5">
            {chips.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPeriod(c.id)}
                className={`rounded-xl px-3 py-2 text-[13px] font-extrabold transition ${
                  period === c.id ? 'bg-[#9f1239] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] font-bold text-slate-500">
                من
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="rounded-xl border border-slate-200 px-2 py-2 text-[13px] font-bold text-slate-800"
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] font-bold text-slate-500">
                إلى
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="rounded-xl border border-slate-200 px-2 py-2 text-[13px] font-bold text-slate-800"
                />
              </label>
            </div>
          )}
          <p className="mt-3 text-[12px] font-bold text-slate-400">
            {pretty(range.from)}{range.from !== range.to ? ` — ${pretty(range.to)}` : ''}
            {' · '}العداد يبدأ من العمليات بعد تثبيت التحديث
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <article className="rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/80">
            <p className="text-[12px] font-extrabold text-rose-700">بنود محذوفة</p>
            <p className="mt-1 text-4xl font-black text-slate-900">
              {summaryQ.isFetching ? '…' : formatNum(summaryQ.data?.deletedLines ?? 0)}
            </p>
            <p className="mt-1 text-[13px] font-bold text-slate-500">
              {formatCurrency(summaryQ.data?.deletedAmount ?? 0)}
            </p>
          </article>
          <article className="rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/80">
            <p className="text-[12px] font-extrabold text-rose-700">فواتير ملغاة</p>
            <p className="mt-1 text-4xl font-black text-slate-900">
              {summaryQ.isFetching ? '…' : formatNum(summaryQ.data?.cancelledInvoices ?? 0)}
            </p>
            <p className="mt-1 text-[13px] font-bold text-slate-500">
              {formatCurrency(summaryQ.data?.cancelledAmount ?? 0)}
            </p>
          </article>
        </div>

        {summaryQ.isError && (
          <p className="mt-4 text-[13px] font-extrabold text-red-600">تعذر جلب التقرير. أعد المحاولة.</p>
        )}

        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
          <table className="w-full text-right text-[13px]">
            <thead className="bg-slate-50 text-[12px] font-extrabold text-slate-500">
              <tr>
                <th className="px-4 py-3 font-extrabold">الكاشير</th>
                <th className="px-4 py-3 font-extrabold">بنود محذوفة</th>
                <th className="px-4 py-3 font-extrabold">فواتير ملغاة</th>
                <th className="px-4 py-3 font-extrabold">قيمة الإلغاء</th>
              </tr>
            </thead>
            <tbody>
              {cashiers.map(row => {
                const active = row.cashierId === cashierId;
                return (
                  <tr
                    key={row.cashierId}
                    className={active ? 'bg-rose-50' : 'cursor-pointer hover:bg-slate-50'}
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setCashierId(active ? null : row.cashierId)}
                        className="font-black text-slate-900"
                      >
                        {nameOf(row.cashierName)}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-extrabold">{formatNum(row.deletedLines)}</td>
                    <td className="px-4 py-3 font-extrabold">{formatNum(row.cancelledInvoices)}</td>
                    <td className="px-4 py-3 font-bold text-slate-600">{formatCurrency(row.cancelledAmount)}</td>
                  </tr>
                );
              })}
              {!summaryQ.isFetching && cashiers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[13px] font-bold text-slate-400">
                    لا حذف ولا إلغاء في هذه المدة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[16px] font-black text-slate-900">{nameOf(selected.cashierName)}</h3>
              <p className="text-[12px] font-bold text-slate-400">
                {formatNum(selected.deletedLines)} بند · {formatNum(selected.cancelledInvoices)} فاتورة
              </p>
            </div>
            {detailQ.isFetching && <p className="mt-4 text-[13px] font-bold text-slate-400">جارٍ التحميل…</p>}
            {detailQ.isError && <p className="mt-4 text-[13px] font-extrabold text-red-600">تعذر جلب التفاصيل.</p>}
            {!detailQ.isFetching && days.length === 0 && (
              <p className="mt-4 text-[13px] font-bold text-slate-400">لا تفاصيل في هذه المدة.</p>
            )}
            <div className="mt-4 space-y-5">
              {days.map(([day, events]) => {
                const invoices = events.filter(e => e.kind === 'invoice');
                const lines = events.filter(e => e.kind === 'line');
                return (
                  <div key={day}>
                    <p className="text-[12px] font-extrabold text-rose-700">{pretty(day)}</p>
                    {invoices.map(event => (
                      <article key={event.id} className="mt-2 rounded-xl bg-rose-50/70 p-3 ring-1 ring-rose-100">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-black text-slate-900">
                            فاتورة ملغاة
                            {event.receiptNum ? ` #${event.receiptNum}` : ''}
                          </p>
                          <p className="text-[12px] font-bold text-slate-500">
                            {clock(event.createdAt)} · {sourceLabel(event.source)} · {formatNum(event.lineCount)} بند · {formatCurrency(event.amount)}
                          </p>
                        </div>
                        {event.lines.length === 0 ? (
                          <p className="mt-2 text-[12px] font-bold text-slate-400">بدون بنود</p>
                        ) : (
                          <ul className="mt-2 space-y-1">
                            {event.lines.map((line, index) => (
                              <li key={`${event.id}-${index}`} className="flex justify-between gap-3 text-[13px] text-slate-700">
                                <span className="font-bold">
                                  {line.name || line.barcode || 'بند'}
                                  <span className="mr-2 font-medium text-slate-400">× {formatNum(line.quantity)}</span>
                                </span>
                                <span className="font-bold">{formatCurrency(line.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                    {lines.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {lines.map(event => (
                          <li key={event.id} className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px]">
                            <span className="font-bold text-slate-800">
                              حذف بند: {event.productName || event.barcode || 'بند'}
                              <span className="mr-2 font-medium text-slate-400">
                                × {formatNum(event.quantity)} · {clock(event.createdAt)}
                                {event.source === 'deferred' ? ' · مؤجلة' : ''}
                              </span>
                            </span>
                            <span className="font-bold text-slate-600">{formatCurrency(event.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </ReportAppWindow>
  );
}
