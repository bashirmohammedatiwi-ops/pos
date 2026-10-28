import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { PortalSellerAccountDto } from '@/api/types';
import { useToast } from '@/components/Toast';
import { IconClock } from '@/components/icons';
import { Btn, Checkbox, Input, Modal } from '@/components/ui';

/* ─────────────────────────────────────────────────────────────────────────────
 * أوقات فتح ويب البائع — نافذة بداية/نهاية (بتوقيت العراق) وأيام الأسبوع.
 * النهاية قبل البداية = نافذة تعبر منتصف الليل (مثلاً 8 م → 2 ص).
 * ───────────────────────────────────────────────────────────────────────────── */

/** بت 0 = السبت … بت 6 = الجمعة — نفس ترقيم الخادم. */
export const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const SHORT_DAYS = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
const ALL_DAYS = 127;

function two(n: number) {
  return String(n).padStart(2, '0');
}

export function minToHm(min?: number | null) {
  if (min == null) return '';
  return `${two(Math.floor(min / 60))}:${two(min % 60)}`;
}

function hmToMin(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export function minTo12(min?: number | null) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'ص' : 'م';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${two(m)} ${suffix}`;
}

export function daysLabel(mask: number) {
  const m = mask & ALL_DAYS || ALL_DAYS;
  if (m === ALL_DAYS) return 'كل الأيام';
  const on = WEEK_DAYS.filter((_, i) => (m >> i) & 1);
  const off = WEEK_DAYS.filter((_, i) => !((m >> i) & 1));
  return off.length <= 2 ? `عدا ${off.join(' و')}` : on.join('، ');
}

/** ملخص قصير لعمود الجدول. */
export function accessSummary(s: Pick<PortalSellerAccountDto, 'accessFromMin' | 'accessToMin' | 'accessDays'>) {
  const days = s.accessDays ?? ALL_DAYS;
  const timed = s.accessFromMin != null && s.accessToMin != null;
  if (!timed && (days & ALL_DAYS) === ALL_DAYS) return null;
  const time = timed ? `${minTo12(s.accessFromMin)} – ${minTo12(s.accessToMin)}` : 'طوال اليوم';
  return { time, days: daysLabel(days) };
}

export function SellerAccessModal({
  seller,
  onClose,
  onSaved,
}: {
  /** null = تطبيق على كل البائعين الذين لهم حساب. */
  seller: PortalSellerAccountDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const initialTimed = seller ? seller.accessFromMin != null && seller.accessToMin != null : true;
  const [limited, setLimited] = useState(() => (seller ? initialTimed || (seller.accessDays ?? ALL_DAYS) !== ALL_DAYS : true));
  const [from, setFrom] = useState(() => minToHm(seller?.accessFromMin ?? 9 * 60));
  const [to, setTo] = useState(() => minToHm(seller?.accessToMin ?? 22 * 60));
  const [allDay, setAllDay] = useState(() => (seller ? !initialTimed && (seller.accessDays ?? ALL_DAYS) !== ALL_DAYS : false));
  const [days, setDays] = useState(() => seller?.accessDays ?? ALL_DAYS);

  useEffect(() => {
    if (!days) setDays(ALL_DAYS);
  }, [days]);

  const fromMin = hmToMin(from);
  const toMin = hmToMin(to);
  const invalid = limited && !allDay && (fromMin == null || toMin == null || fromMin === toMin);
  const overnight = limited && !allDay && fromMin != null && toMin != null && toMin < fromMin;

  const save = useMutation({
    mutationFn: () => {
      const body = limited
        ? { fromMin: allDay ? null : fromMin, toMin: allDay ? null : toMin, days }
        : { fromMin: null, toMin: null, days: ALL_DAYS };
      return seller ? api.setSellerAccess(seller.salesmanId, body) : api.setAllSellersAccess(body).then(() => null);
    },
    onSuccess: () => {
      toast.success(seller ? `حُفظت أوقات ${seller.name} ونُشرت على الويب` : 'طُبّقت الأوقات على كل البائعين ونُشرت على الويب');
      onSaved();
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'تعذّر الحفظ'),
  });

  const preview = !limited
    ? 'الويب مفتوح طوال الوقت وكل الأيام.'
    : `يُفتح ${allDay ? 'طوال اليوم' : `من ${minTo12(fromMin)} إلى ${minTo12(toMin)}${overnight ? ' (اليوم التالي)' : ''}`} · ${daysLabel(days)}.`;

  return (
    <Modal
      open
      title={seller ? `أوقات الويب — ${seller.name}` : 'أوقات الويب لكل البائعين'}
      subtitle="بتوقيت العراق (بغداد) · خارج الوقت يرى البائع رسالة وعدّاداً حتى الفتح"
      icon={<IconClock size={18} />}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            إلغاء
          </Btn>
          <Btn loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            {seller ? 'حفظ ونشر' : 'تطبيق على الجميع'}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: false, t: 'بلا تقييد', d: 'مفتوح دائماً' },
            { v: true, t: 'أوقات محددة', d: 'ساعات وأيام' },
          ].map(o => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setLimited(o.v)}
              className={`rounded-xl border px-3 py-2.5 text-start transition ${limited === o.v ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/15' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <div className="text-[13px] font-bold text-header">{o.t}</div>
              <div className="text-[11.5px] text-slate-500">{o.d}</div>
            </button>
          ))}
        </div>

        {limited && (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-600">الساعات</span>
                <Checkbox checked={allDay} onChange={setAllDay} label="طوال اليوم (الأيام فقط)" />
              </div>
              {!allDay && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">من</span>
                    <Input type="time" value={from} onChange={e => setFrom(e.target.value)} className="num text-center" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] font-semibold text-slate-500">إلى</span>
                    <Input type="time" value={to} onChange={e => setTo(e.target.value)} className="num text-center" />
                  </label>
                </div>
              )}
              {!allDay && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    ['09:00', '17:00'],
                    ['10:00', '22:00'],
                    ['16:00', '23:59'],
                    ['20:00', '02:00'],
                  ].map(([a, b]) => (
                    <button
                      key={a + b}
                      type="button"
                      onClick={() => {
                        setFrom(a);
                        setTo(b);
                      }}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[11.5px] font-semibold text-slate-600 hover:border-brand-300 hover:bg-brand-50"
                    >
                      {minTo12(hmToMin(a))} – {minTo12(hmToMin(b))}
                    </button>
                  ))}
                </div>
              )}
              {invalid && <p className="mt-1.5 text-[11.5px] font-semibold text-rose-600">اختر وقت بداية ونهاية مختلفين.</p>}
              {overnight && <p className="mt-1.5 text-[11.5px] text-slate-500">النهاية قبل البداية: يبقى مفتوحاً بعد منتصف الليل حتى {minTo12(toMin)}.</p>}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-600">الأيام</span>
                <div className="flex gap-2 text-[11.5px] font-semibold">
                  <button type="button" className="text-brand-700 hover:underline" onClick={() => setDays(ALL_DAYS)}>
                    الكل
                  </button>
                  <button type="button" className="text-brand-700 hover:underline" onClick={() => setDays(ALL_DAYS & ~(1 << 6))}>
                    عدا الجمعة
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {SHORT_DAYS.map((d, i) => {
                  const on = ((days >> i) & 1) === 1;
                  return (
                    <button
                      key={d}
                      type="button"
                      title={WEEK_DAYS[i]}
                      onClick={() => {
                        const next = days ^ (1 << i);
                        setDays(next === 0 ? days : next);
                      }}
                      className={`rounded-lg border py-2 text-[11.5px] font-bold transition ${on ? 'border-brand-500 bg-brand-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] leading-6 text-slate-700 ring-1 ring-slate-200">
          <span className="font-bold text-header">النتيجة: </span>
          {preview}
          {!seller && <div className="mt-1 text-[11.5px] text-amber-700">سيُستبدل إعداد كل بائع لديه حساب بهذا الإعداد.</div>}
        </div>
      </div>
    </Modal>
  );
}
