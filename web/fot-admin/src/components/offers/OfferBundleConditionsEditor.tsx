import type { ReactNode } from 'react';
import { formatNum } from '@/api/client';
import type { OfferBundleConditionsDto } from '@/api/types';
import { Badge } from '@/components/ui';
import { IconCheck, IconTarget, IconX } from '@/components/icons';

export const DEFAULT_BUNDLE_CONDITIONS: OfferBundleConditionsDto = {
  matchMode: 0,
  minCount: 0,
  countBasis: 0,
  minQtyEach: 1,
  minRequiredAmount: 0,
  requiredDiscount: 0,
};

export function normalizeBundleConditions(c?: Partial<OfferBundleConditionsDto> | null): OfferBundleConditionsDto {
  return {
    matchMode: c?.matchMode === 1 ? 1 : 0,
    minCount: Math.max(0, Math.floor(Number(c?.minCount) || 0)),
    countBasis: c?.countBasis === 1 ? 1 : 0,
    minQtyEach: Number(c?.minQtyEach) > 0 ? Number(c?.minQtyEach) : 1,
    minRequiredAmount: Math.max(0, Number(c?.minRequiredAmount) || 0),
    requiredDiscount: Math.max(0, Number(c?.requiredDiscount) || 0),
  };
}

export function sameBundleConditions(a: OfferBundleConditionsDto, b: OfferBundleConditionsDto) {
  const x = normalizeBundleConditions(a);
  const y = normalizeBundleConditions(b);
  return (
    x.matchMode === y.matchMode &&
    (x.matchMode === 0 || (x.minCount === y.minCount && x.countBasis === y.countBasis)) &&
    x.minQtyEach === y.minQtyEach &&
    x.minRequiredAmount === y.minRequiredAmount &&
    x.requiredDiscount === y.requiredDiscount
  );
}

/** خطأ يمنع الحفظ (أو null). */
export function bundleConditionsError(c: OfferBundleConditionsDto, requiredCount: number): string | null {
  if (c.matchMode === 1) {
    if (!(c.minCount >= 1)) return 'حدّد العدد المطلوب (1 على الأقل)';
    if (c.countBasis === 0 && requiredCount > 0 && c.minCount > requiredCount) {
      return `العدد المطلوب (${formatNum(c.minCount)}) أكبر من عدد المواد المشروطة (${formatNum(requiredCount)})`;
    }
  }
  if (!(c.minQtyEach > 0)) return 'أقل كمية لكل مادة يجب أن تكون أكبر من صفر';
  if (c.minRequiredAmount < 0) return 'أقل قيمة لا تكون سالبة';
  if (c.requiredDiscount < 0 || c.requiredDiscount > 100) return 'خصم المواد المشروطة بين 0 و 100٪';
  return null;
}

/** جملة تشرح الشرط بلغة الكاشير. */
export function describeBundleConditions(c: OfferBundleConditionsDto, requiredCount: number) {
  const parts: string[] = [];
  const each = c.minQtyEach > 1 ? ` (كل مادة بكمية ${formatNum(c.minQtyEach, 3)} على الأقل)` : '';
  if (c.matchMode === 0) {
    parts.push(requiredCount > 1
      ? `يُفعَّل العرض عندما تكون كل المواد المشروطة (${formatNum(requiredCount)}) في الفاتورة${each}`
      : `يُفعَّل العرض عندما تكون المادة المشروطة في الفاتورة${each}`);
  } else if (c.countBasis === 1) {
    parts.push(`يُفعَّل العرض عند بيع ${formatNum(c.minCount || 0)} قطع على الأقل من المواد المشروطة — حتى لو كانت كلها من نفس المادة`);
  } else {
    parts.push(`يُفعَّل العرض عند وجود ${formatNum(c.minCount || 0)} مواد مختلفة على الأقل من أصل ${formatNum(requiredCount)}${each}`);
  }
  if (c.minRequiredAmount > 0) parts.push(`وبشرط ألا تقل قيمتها عن ${formatNum(c.minRequiredAmount)} IQD`);
  return parts.join('، ');
}

function examples(c: OfferBundleConditionsDto, requiredCount: number): { ok: boolean; text: string }[] {
  const n = Math.max(1, c.minCount || 1);
  if (c.matchMode === 0) {
    const r = Math.max(1, requiredCount);
    return [
      { ok: true, text: `كل المواد الـ ${formatNum(r)} موجودة${c.minQtyEach > 1 ? ` بكمية ${formatNum(c.minQtyEach, 3)} لكل منها` : ''}` },
      ...(r > 1 ? [{ ok: false, text: `${formatNum(r - 1)} من ${formatNum(r)} فقط` }] : []),
    ];
  }
  if (c.countBasis === 1) {
    return [
      { ok: true, text: `${formatNum(n)} قطع من نفس المادة` },
      ...(n > 1 ? [{ ok: true, text: `${formatNum(n)} قطع من مواد مختلفة` }, { ok: false, text: `${formatNum(n - 1)} قطع فقط` }] : []),
    ];
  }
  return [
    { ok: true, text: `${formatNum(n)} مواد مختلفة` },
    ...(n > 1 ? [{ ok: false, text: `${formatNum(n)} قطع من نفس المادة` }, { ok: false, text: `${formatNum(n - 1)} مواد مختلفة فقط` }] : []),
  ];
}

function ModeCard({ active, title, hint, onClick, children }: { active: boolean; title: string; hint: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 flex-col items-start gap-1 rounded-xl border p-3 text-right transition ${
        active ? 'border-brand-500 bg-brand-50/70 ring-2 ring-brand-500/15' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span className="flex w-full items-center gap-2">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-brand-600' : 'border-slate-300'}`}>
          {active && <span className="h-2 w-2 rounded-full bg-brand-600" />}
        </span>
        <span className={`text-[13px] font-bold ${active ? 'text-brand-800' : 'text-slate-700'}`}>{title}</span>
      </span>
      <span className="ps-6 text-[11.5px] leading-5 text-slate-500">{hint}</span>
      {children}
    </button>
  );
}

function Stepper({ value, onChange, min = 0, step = 1, suffix, ariaLabel }: { value: number; onChange: (v: number) => void; min?: number; step?: number; suffix?: string; ariaLabel: string }) {
  return (
    <div className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-slate-200 bg-white" dir="ltr">
      <button type="button" className="h-full w-8 text-[16px] font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-40" onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))} disabled={value <= min} aria-label="إنقاص">−</button>
      <input
        type="number"
        min={min}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        aria-label={ariaLabel}
        className="h-full w-14 border-x border-slate-100 text-center text-[13px] font-bold outline-none num"
      />
      <button type="button" className="h-full w-8 text-[16px] font-bold text-slate-500 hover:bg-slate-50" onClick={() => onChange(+((Number.isFinite(value) ? value : 0) + step).toFixed(3))} aria-label="زيادة">+</button>
      {suffix && <span className="px-2 text-[11.5px] text-slate-500" dir="rtl">{suffix}</span>}
    </div>
  );
}

/** محرر «شرط التفعيل» للعرض المشروط. */
export function OfferBundleConditionsEditor({
  value,
  onChange,
  requiredCount,
  hasDiscountedItems,
}: {
  value: OfferBundleConditionsDto;
  onChange: (v: OfferBundleConditionsDto) => void;
  requiredCount: number;
  hasDiscountedItems: boolean;
}) {
  const c = value;
  const set = (patch: Partial<OfferBundleConditionsDto>) => onChange({ ...c, ...patch });
  const error = bundleConditionsError(c, requiredCount);
  const ex = examples(c, requiredCount);
  const noReward = !hasDiscountedItems && !(c.requiredDiscount > 0);

  return (
    <section className="card p-3" dir="rtl">
      <div className="flex flex-wrap items-start gap-3">
        <span className="icon-tile h-9 w-9 shrink-0 rounded-xl bg-violet-50 text-violet-700"><IconTarget size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-bold text-header">شرط التفعيل</h3>
            <Badge tone={c.matchMode === 0 ? 'default' : 'violet'}>
              {c.matchMode === 0 ? 'كل المواد' : c.countBasis === 1 ? `${formatNum(c.minCount || 0)} قطع` : `${formatNum(c.minCount || 0)} من ${formatNum(requiredCount)}`}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11.5px] text-slate-500">متى يُطبَّق خصم العرض في نقطة البيع.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <ModeCard
          active={c.matchMode === 0}
          title="كل المواد المشروطة"
          hint="يجب أن تكون جميع المواد المشروطة في الفاتورة."
          onClick={() => set({ matchMode: 0 })}
        />
        <ModeCard
          active={c.matchMode === 1}
          title="عدد منها"
          hint="يكفي عدد محدد — مثل 3 من أصل 5 مواد، أو 3 قطع."
          onClick={() => set({ matchMode: 1, minCount: c.minCount >= 1 ? c.minCount : Math.min(Math.max(1, requiredCount - 1), Math.max(1, requiredCount)) })}
        />
      </div>

      {c.matchMode === 0 && requiredCount > 10 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] font-semibold leading-5 text-amber-800 ring-1 ring-inset ring-amber-200">
          لديك {formatNum(requiredCount)} صنف تفعيل (مثلاً من شجرة كاملة) — «كل المواد» تعني وجودها كلها في الفاتورة.
          غالباً المقصود «عدد منها»، مثل أي قطعتين من الشجرة.
          <button type="button" className="ms-1 font-bold text-violet-700 underline" onClick={() => set({ matchMode: 1, countBasis: 1, minCount: c.minCount >= 1 ? c.minCount : 1 })}>
            حوّل إلى «عدد قطع»
          </button>
        </p>
      )}

      {c.matchMode === 1 && (
        <div className="mt-3 space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-700">
            <span className="font-semibold">العدد المطلوب</span>
            <Stepper value={c.minCount} min={1} onChange={v => set({ minCount: v })} ariaLabel="العدد المطلوب" suffix={c.countBasis === 1 ? 'قطعة' : `من ${formatNum(requiredCount)} مادة`} />
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-slate-600">طريقة العدّ</p>
            <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
              {([
                [0, 'مواد مختلفة', 'كل مادة تُحسب مرة واحدة'],
                [1, 'عدد قطع (التكرار مسموح)', 'نفس المادة 3 مرات = 3'],
              ] as const).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set({ countBasis: id })}
                  title={hint}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${c.countBasis === id ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {!(c.matchMode === 1 && c.countBasis === 1) && (
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-slate-600">أقل كمية لكل مادة</span>
            <Stepper value={c.minQtyEach} min={1} onChange={v => set({ minQtyEach: v })} ariaLabel="أقل كمية لكل مادة" suffix="قطعة" />
            <span className="mt-1 block text-[11px] text-slate-500">لا تُحسب المادة قبل هذه الكمية.</span>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-slate-600">أقل قيمة للمواد المشروطة</span>
          <div className="relative">
            <input
              type="number"
              min={0}
              step={250}
              value={c.minRequiredAmount || ''}
              placeholder="بلا حد"
              onChange={e => set({ minRequiredAmount: Math.max(0, Number(e.target.value) || 0) })}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pe-12 ps-3 text-[13px] outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 num"
            />
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[11px] text-slate-400">IQD</span>
          </div>
          <span className="mt-1 block text-[11px] text-slate-500">مجموع قيمتها في الفاتورة (اختياري).</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-slate-600">خصم على المواد المشروطة نفسها</span>
          <div className="relative">
            <input
              type="number"
              min={0}
              max={100}
              value={c.requiredDiscount || ''}
              placeholder="بلا خصم"
              onChange={e => set({ requiredDiscount: Math.max(0, Number(e.target.value) || 0) })}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pe-8 ps-3 text-[13px] outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 num"
            />
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-slate-400">%</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {[0, 5, 10, 15, 20].map(p => (
              <button
                key={p}
                type="button"
                onClick={() => set({ requiredDiscount: p })}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition ${c.requiredDiscount === p ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
              >
                {p === 0 ? 'بلا' : `${p}%`}
              </button>
            ))}
          </div>
        </label>
      </div>

      {/* ملخص حي + أمثلة */}
      <div className={`mt-3 rounded-xl border p-3 ${error ? 'border-red-200 bg-red-50/60' : 'border-brand-100 bg-brand-50/50'}`}>
        {error ? (
          <p className="text-[12.5px] font-semibold text-red-700">{error}</p>
        ) : (
          <>
            <p className="text-[12.5px] font-semibold leading-6 text-brand-900">{describeBundleConditions(c, requiredCount)}.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ex.map(e => (
                <span
                  key={e.text}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${
                    e.ok ? 'bg-white text-emerald-700 ring-emerald-200' : 'bg-white text-slate-500 ring-slate-200'
                  }`}
                >
                  {e.ok ? <IconCheck size={12} /> : <IconX size={12} />}
                  {e.text}
                </span>
              ))}
            </div>
          </>
        )}
        {noReward && !error && (
          <p className="mt-2 text-[11.5px] font-semibold text-amber-700">
            لا يوجد ما يُخصم بعد: أضف أصنافاً مخفّضة في النطاق أدناه، أو حدّد خصماً على المواد المشروطة نفسها.
          </p>
        )}
      </div>
    </section>
  );
}
