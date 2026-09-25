import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import { IconReceipt } from '@/components/icons';
import { Select } from '@/components/ui';
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
  return d.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
}

export function SellerReceiptsApp({ onClose }: { onClose: () => void }) {
  const { periods } = useBusinessPeriod();
  const today = isoDate(new Date());
  const [period, setPeriod] = useState<PeriodId>('today');
  const [customFrom, setCustomFrom] = useState(periods.currentWeek.from);
  const [customTo, setCustomTo] = useState(periods.currentWeek.to);
  const [salesmanId, setSalesmanId] = useState('');

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

  const salesmenQ = useQuery({
    queryKey: ['salesmen', 'receipt-app'],
    queryFn: () => api.salesmen(true),
    staleTime: 10 * 60_000,
  });

  const salesQ = useQuery({
    queryKey: ['seller-receipts', range.from, range.to],
    queryFn: () => api.salesBySalesman(range.from, range.to),
    enabled: salesmanId !== '',
  });

  const seller = (salesmenQ.data?.items ?? []).find(s => String(s.id) === salesmanId);
  const sellerName = seller ? (fixEdariName(seller.name) || seller.name || `#${seller.id}`) : '';
  const matched = (salesQ.data ?? []).filter(r => String(r.salesmanId) === salesmanId);
  const count = matched.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  const total = matched.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const ready = salesmanId !== '' && salesQ.isSuccess;

  const chips: { id: PeriodId; label: string }[] = [
    { id: 'today', label: 'اليوم' },
    { id: 'yesterday', label: 'أمس' },
    { id: 'week', label: 'هذا الأسبوع' },
    { id: 'lastWeek', label: 'الأسبوع الماضي' },
    { id: 'month', label: 'هذا الشهر' },
    { id: 'custom', label: 'مدة' },
  ];

  return (
    <ReportAppWindow
      title="فواتير البائع"
      subtitle="اختر المدة والبائع لترى عدد فواتيره"
      icon={<IconReceipt size={20} />}
      accent="linear-gradient(135deg, #1a2236 0%, #101628 70%)"
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-[#e7ebf0] p-4 sm:p-6" dir="rtl">
        <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex flex-wrap gap-1.5">
            {chips.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPeriod(c.id)}
                className={`rounded-xl px-3 py-2 text-[13px] font-extrabold transition ${
                  period === c.id ? 'bg-[#101628] text-[#f6e7b8]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              value={salesmanId}
              onChange={e => setSalesmanId(e.target.value)}
              className="min-w-[220px] flex-1 !py-2"
            >
              <option value="">اختر البائع</option>
              {(salesmenQ.data?.items ?? []).map(s => (
                <option key={s.id} value={s.id}>{fixEdariName(s.name) || s.name || `#${s.id}`}</option>
              ))}
            </Select>
            {period === 'custom' && (
              <>
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
              </>
            )}
          </div>
        </div>

        <article className="mx-auto mt-8 w-full max-w-[420px] overflow-hidden rounded-[28px] bg-[#fbf7ee] shadow-[0_24px_50px_rgba(16,22,40,0.16)]">
          <div className="bg-[#101628] px-7 pb-6 pt-7 text-[#fbf7ee]">
            <p className="text-[12px] font-extrabold text-[#e4c56a]">عدد الفواتير</p>
            <p className="mt-2 font-black leading-none tracking-tight" style={{ fontSize: 'clamp(4.2rem, 12vw, 5.6rem)' }}>
              {salesmanId === '' ? '—' : salesQ.isFetching ? '…' : formatNum(count)}
            </p>
            <span className="mt-3 block h-[3px] w-11 rounded-full bg-[#e4c56a]" />
          </div>
          <div className="flex justify-between bg-[#101628] px-2" aria-hidden>
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} className="-mb-2 h-4 w-4 rounded-full bg-[#e7ebf0]" />
            ))}
          </div>
          <div className="px-7 pb-7 pt-6 text-center">
            <p className="text-[22px] font-black text-[#101628]">{sellerName || 'لم يُختر بائع'}</p>
            <p className="mt-2 text-[13px] font-bold text-slate-500">
              {pretty(range.from)}{range.from !== range.to ? ` — ${pretty(range.to)}` : ''}
            </p>
            {ready && (
              <p className="mt-5 rounded-2xl bg-white px-4 py-3 text-[13px] font-extrabold text-slate-600 ring-1 ring-[#eadfc8]">
                قيمة المبيعات
                <span className="mt-1 block text-[18px] font-black text-[#101628]">{formatCurrency(total)}</span>
              </p>
            )}
            {salesQ.isError && (
              <p className="mt-4 text-[13px] font-extrabold text-red-600">تعذر جلب الفواتير. أعد المحاولة.</p>
            )}
            {ready && count === 0 && (
              <p className="mt-4 text-[13px] font-bold text-slate-500">لا فواتير لهذا البائع في هذه المدة.</p>
            )}
          </div>
        </article>
      </div>
    </ReportAppWindow>
  );
}
