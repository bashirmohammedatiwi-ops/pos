import { useMemo, useState, type ReactNode } from 'react';
import { DISCOUNT_QR_DAYS, describeDiscountQrRules, evaluateDiscountQr, type DiscountQrPerson } from '@fot/shared';
import { formatNum } from '@/api/client';
import type { DiscountQrPersonDto, DiscountQrRules } from '@/api/types';
import { IconQr } from '@/components/icons';
import { Badge, Btn, Field, Input, Modal, Select, Switch, Textarea } from '@/components/ui';

/* ───────────────────────────────────────
 * شروط رمز الخصم: حد الخصم، الأيام والساعات والتواريخ، حدود الاستخدام.
 * كل شرط اختياري. المنع على شاشة الكاشير (يعمل دون اتصال أيضاً)،
 * والسيرفر يسجّل أي فاتورة خالفت الشروط للمراجعة ولا يرفضها.
 * ─────────────────────────────────────── */

const ALL_DAYS = 127;
const PERCENT_PRESETS = [5, 10, 15, 20, 25, 50];
const DAY_PRESETS = [
  { label: 'كل الأيام', mask: ALL_DAYS },
  { label: 'الأحد – الخميس', mask: 1 | 2 | 4 | 8 | 16 },
  { label: 'الجمعة والسبت', mask: 32 | 64 },
];

type Form = {
  maxPercent: string;
  maxAmount: string;
  minInvoice: string;
  weekdays: number;
  timeFrom: string;
  timeTo: string;
  validFrom: string;
  validTo: string;
  maxUses: string;
  maxUsesPerDay: string;
  budgetTotal: string;
  budgetMonth: string;
  allowGift: boolean;
  note: string;
};

const text = (v?: number | null) => (v == null ? '' : String(v));
const toClock = (m?: number | null) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const fromClock = (v: string) => {
  const m = v.match(/^(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const numOrNull = (v: string) => {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) ? n : null;
};

function formOf(p?: DiscountQrRules | null): Form {
  return {
    maxPercent: text(p?.maxPercent),
    maxAmount: text(p?.maxAmount),
    minInvoice: text(p?.minInvoice),
    weekdays: p?.weekdays ?? ALL_DAYS,
    timeFrom: toClock(p?.timeFrom),
    timeTo: toClock(p?.timeTo),
    validFrom: p?.validFrom?.slice(0, 10) ?? '',
    validTo: p?.validTo?.slice(0, 10) ?? '',
    maxUses: text(p?.maxUses),
    maxUsesPerDay: text(p?.maxUsesPerDay),
    budgetTotal: text(p?.budgetTotal),
    budgetMonth: text(p?.budgetMonth),
    // رمز جديد لا يفتح الهدايا إلا بقرار صريح؛ الهدية تتجاوز أي حد على الخصم
    allowGift: p?.allowGift ?? false,
    note: p?.note ?? '',
  };
}

function rulesOf(f: Form): DiscountQrRules {
  return {
    maxPercent: numOrNull(f.maxPercent),
    maxAmount: numOrNull(f.maxAmount),
    minInvoice: numOrNull(f.minInvoice),
    weekdays: f.weekdays === ALL_DAYS ? null : f.weekdays,
    timeFrom: fromClock(f.timeFrom),
    timeTo: fromClock(f.timeTo),
    validFrom: f.validFrom || null,
    validTo: f.validTo || null,
    maxUses: numOrNull(f.maxUses),
    maxUsesPerDay: numOrNull(f.maxUsesPerDay),
    budgetTotal: numOrNull(f.budgetTotal),
    budgetMonth: numOrNull(f.budgetMonth),
    allowGift: f.allowGift,
    note: f.note.trim() || null,
  };
}

function problemOf(f: Form): string | null {
  const r = rulesOf(f);
  if (r.maxPercent != null && (r.maxPercent <= 0 || r.maxPercent > 100)) return 'نسبة الخصم بين 0 و 100';
  if (f.weekdays === 0) return 'اختر يوماً واحداً على الأقل';
  if (!!f.timeFrom !== !!f.timeTo) return 'حدد وقت البداية والنهاية معاً';
  if (f.timeFrom && f.timeFrom === f.timeTo) return 'وقت البداية والنهاية متطابقان';
  if (f.validFrom && f.validTo && f.validFrom > f.validTo) return 'تاريخ البداية بعد تاريخ النهاية';
  for (const v of [r.maxAmount, r.maxUses, r.maxUsesPerDay, r.budgetTotal, r.budgetMonth]) {
    if (v != null && v <= 0) return 'الحدود يجب أن تكون أكبر من صفر — اتركها فارغة إن لم تردها';
  }
  return null;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-3">
      <h4 className="text-[13px] font-bold text-header">{title}</h4>
      {hint && <p className="mb-2 mt-0.5 text-[11.5px] leading-5 text-slate-500">{hint}</p>}
      <div className="mt-2 grid gap-3">{children}</div>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
    >
      {children}
    </button>
  );
}

const digits = (v: string) => v.replace(/[^\d]/g, '');

/** حالة الرمز الآن بجملة قصيرة، للجدول والبطاقات */
export function DiscountQrNowBadge({ person }: { person: DiscountQrPersonDto }) {
  if (!person.active) return <Badge dot>متوقف</Badge>;
  const verdict = evaluateDiscountQr(person as DiscountQrPerson);
  if (verdict.ok) return <Badge tone="ok" dot>يعمل الآن</Badge>;
  return <span title={verdict.reason}><Badge tone="warn" dot>لا يعمل الآن</Badge></span>;
}

export function discountQrRuleLines(person: DiscountQrRules) {
  return describeDiscountQrRules(person as unknown as DiscountQrPerson);
}

export function DiscountQrRulesModal({
  mode,
  name,
  person,
  others,
  saving,
  onNameChange,
  onSave,
  onResetUsage,
  onClose,
}: {
  mode: 'create' | 'edit';
  name: string;
  person?: DiscountQrPersonDto | null;
  others: DiscountQrPersonDto[];
  saving: boolean;
  onNameChange?: (v: string) => void;
  onSave: (rules: DiscountQrRules) => void;
  onResetUsage?: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Form>(() => formOf(person));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(old => ({ ...old, [k]: v }));
  const problem = problemOf(f);
  const preview = useMemo(() => discountQrRuleLines(rulesOf(f)), [f]);
  const withRules = others.filter(o => o.id !== person?.id && discountQrRuleLines(o).length > 0);
  const hasCounters = !!(f.maxUses || f.maxUsesPerDay || f.budgetTotal || f.budgetMonth);
  // بلا حد على النسبة والمبلغ، الهدية لا تتجاوز شيئاً
  const capped = !!(f.maxPercent || f.maxAmount || f.budgetMonth || f.budgetTotal);

  return (
    <Modal
      open
      size="lg"
      icon={<IconQr size={18} />}
      title={mode === 'create' ? 'رمز خصم جديد' : `شروط رمز ${name}`}
      subtitle="كل شرط اختياري. الحقل الفارغ يعني بلا حد. يمكن تعديل الشروط لاحقاً دون طباعة الرمز من جديد."
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className={`text-[12px] font-semibold ${problem ? 'text-rose-600' : 'text-slate-400'}`}>{problem ?? ''}</span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onClose}>إلغاء</Btn>
            <Btn loading={saving} disabled={!!problem || (mode === 'create' && !name.trim())} onClick={() => onSave(rulesOf(f))}>
              {mode === 'create' ? 'توليد الرمز' : 'حفظ الشروط'}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="grid gap-3">
        {mode === 'create' && (
          <Field label="اسم صاحب الرمز">
            <Input autoFocus value={name} maxLength={80} placeholder="مثال: أحمد — المدير" onChange={e => onNameChange?.(e.target.value)} />
          </Field>
        )}

        {withRules.length > 0 && (
          <Field label="نسخ الشروط من رمز آخر">
            <Select
              value=""
              onChange={e => {
                const from = withRules.find(o => o.id === Number(e.target.value));
                if (from) setF(formOf(from));
              }}
            >
              <option value="">اختر رمزاً…</option>
              {withRules.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        )}

        <Section title="حد الخصم" hint="تُحسب النسبة من مجموع الفاتورة بعد خصومات العروض، ولا يقبل الكاشير أكثر من الحد.">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-slate-600">أقصى نسبة خصم</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip on={!f.maxPercent} onClick={() => set('maxPercent', '')}>بلا حد</Chip>
              {PERCENT_PRESETS.map(n => (
                <Chip key={n} on={f.maxPercent === String(n)} onClick={() => set('maxPercent', String(n))}>{n}%</Chip>
              ))}
              <Input
                className="!h-8 !w-20 num"
                dir="ltr"
                inputMode="decimal"
                placeholder="نسبة"
                aria-label="نسبة أخرى"
                value={f.maxPercent}
                onChange={e => set('maxPercent', e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="أقصى خصم للفاتورة (د.ع)" hint="يفيد مع النسبة: 10% بحد 50,000">
              <Input className="num" dir="ltr" inputMode="numeric" placeholder="بلا حد" value={f.maxAmount} onChange={e => set('maxAmount', digits(e.target.value))} />
            </Field>
            <Field label="أقل مبلغ للفاتورة (د.ع)" hint="أقل من هذا لا يُقبل خصم">
              <Input className="num" dir="ltr" inputMode="numeric" placeholder="بلا حد" value={f.minInvoice} onChange={e => set('minInvoice', digits(e.target.value))} />
            </Field>
          </div>
        </Section>

        <Section title="متى يعمل الرمز" hint="خارج هذه المواعيد يرفض الكاشير الرمز ويعرض السبب، حتى دون اتصال.">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-slate-600">الأيام</p>
            <div className="flex flex-wrap gap-1.5">
              {DISCOUNT_QR_DAYS.map(d => (
                <Chip key={d.value} on={(f.weekdays & d.value) !== 0} onClick={() => set('weekdays', f.weekdays ^ d.value)}>{d.label}</Chip>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAY_PRESETS.map(p => (
                <button key={p.mask} type="button" className="text-[11.5px] font-semibold text-brand-700 hover:underline" onClick={() => set('weekdays', p.mask)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="من الساعة" hint="اتركهما فارغين لكل اليوم">
              <Input type="time" className="num" dir="ltr" value={f.timeFrom} onChange={e => set('timeFrom', e.target.value)} />
            </Field>
            <Field label="إلى الساعة" hint="يمكن أن يعبر منتصف الليل">
              <Input type="time" className="num" dir="ltr" value={f.timeTo} onChange={e => set('timeTo', e.target.value)} />
            </Field>
            <Field label="يبدأ من تاريخ">
              <Input type="date" className="num" dir="ltr" value={f.validFrom} onChange={e => set('validFrom', e.target.value)} />
            </Field>
            <Field label="ينتهي بتاريخ">
              <Input type="date" className="num" dir="ltr" value={f.validTo} onChange={e => set('validTo', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="حدود الاستخدام" hint="تُعدّ فواتير البيع التي فيها خصم بهذا الرمز، ابتداءً من وقت وضع الحد لا من فواتيره القديمة.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="فواتير في اليوم">
              <Input className="num" dir="ltr" inputMode="numeric" placeholder="بلا حد" value={f.maxUsesPerDay} onChange={e => set('maxUsesPerDay', digits(e.target.value))} />
            </Field>
            <Field label="فواتير إجمالاً">
              <Input className="num" dir="ltr" inputMode="numeric" placeholder="بلا حد" value={f.maxUses} onChange={e => set('maxUses', digits(e.target.value))} />
            </Field>
            <Field label="ميزانية الخصم في الشهر (د.ع)">
              <Input className="num" dir="ltr" inputMode="numeric" placeholder="بلا حد" value={f.budgetMonth} onChange={e => set('budgetMonth', digits(e.target.value))} />
            </Field>
            <Field label="الميزانية الكلية (د.ع)">
              <Input className="num" dir="ltr" inputMode="numeric" placeholder="بلا حد" value={f.budgetTotal} onChange={e => set('budgetTotal', digits(e.target.value))} />
            </Field>
          </div>
          {mode === 'edit' && person && hasCounters && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              <span>
                اليوم <b className="num">{formatNum(person.usesToday ?? 0)}</b> فاتورة ·
                الشهر <b className="num">{formatNum(person.spentMonth ?? 0)}</b> د.ع ·
                منذ بدء العدّ <b className="num">{formatNum(person.usesSince ?? 0)}</b> فاتورة و<b className="num">{formatNum(person.spentSince ?? 0)}</b> د.ع
              </span>
              {onResetUsage && <Btn size="xs" variant="secondary" onClick={onResetUsage}>تصفير العدّاد</Btn>}
            </div>
          )}
        </Section>

        <Section title="خيارات أخرى">
          <Switch
            checked={f.allowGift}
            onChange={v => set('allowGift', v)}
            label="يفتح فواتير الهدايا"
            description={f.allowGift && capped ? 'تنبيه: فاتورة الهدية مجانية بالكامل، فلا ينطبق عليها حد الخصم ولا تُعدّ في الاستخدام والميزانية.' : 'للكاشير الذي تتطلب هداياه مسح رمز.'}
          />
          <Field label="ملاحظة داخلية" hint="لا تظهر للكاشير">
            <Textarea rows={2} maxLength={300} value={f.note} onChange={e => set('note', e.target.value)} placeholder="مثال: عرض موظفي الشركة" />
          </Field>
        </Section>

        <div className="rounded-xl bg-brand-50/60 px-3 py-2 text-[12.5px] text-slate-700">
          <b>الخلاصة: </b>
          {preview.length ? preview.join(' · ') : 'خصم غير محدود في كل وقت'}
        </div>
      </div>
    </Modal>
  );
}
