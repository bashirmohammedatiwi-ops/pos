import { useState, type DragEvent, type RefObject } from 'react';
import { RECEIPT_TEMPLATES, normalizeReceiptTemplate } from '@fot/shared';
import type { UpdatePrintSettingsRequest } from '@/api/types';
import { ClassicReceiptDesigner, ClassicTableFontControls } from '@/components/ClassicReceiptDesigner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NumberDraftInput } from '@/components/NumberDraftInput';
import { Btn, Checkbox, Field, Input, Select, Switch } from '@/components/ui';
import { IconCheck, IconEye, IconPrinter, IconReceipt, IconSliders, IconTrash, IconUpload } from '@/components/icons';
import { SettingsCard } from '@/components/system/systemUi';

export function ReceiptPrintSettingsPanel({
  form,
  set,
  logoPreview,
  fileRef,
  onPickFile,
  onDeleteLogo,
  uploading,
  deleting,
  onSave,
  saving,
  dirty,
  onTestPrint,
}: {
  form: UpdatePrintSettingsRequest;
  set: <K extends keyof UpdatePrintSettingsRequest>(k: K, v: UpdatePrintSettingsRequest[K]) => void;
  logoPreview: string | null;
  fileRef: RefObject<HTMLInputElement | null>;
  onPickFile: (file: File) => void;
  onDeleteLogo: () => void;
  uploading: boolean;
  deleting: boolean;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  onTestPrint: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const template = normalizeReceiptTemplate(form.receiptTemplate);

  function drop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) onPickFile(file);
  }

  return (
    <div className="grid items-start gap-3 min-[1800px]:grid-cols-2">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[var(--shadow-soft)] backdrop-blur-sm min-[1800px]:col-span-2">
        <p className="text-[12px] text-slate-500">المعاينة تتحدث فوراً — احفظ لتطبيق التغييرات على كل نقاط البيع.</p>
        <div className="flex gap-1.5">
          <Btn size="sm" variant="secondary" icon={<IconPrinter size={14} />} onClick={onTestPrint}>
            طباعة تجريبية
          </Btn>
          <Btn size="sm" variant={dirty ? 'soft' : 'ghost'} icon={<IconCheck size={14} />} onClick={onSave} disabled={saving || !dirty} loading={saving}>
            {dirty ? 'حفظ الفاتورة' : 'محفوظ'}
          </Btn>
        </div>
      </div>

      <SettingsCard title="النموذج والترويسة" description="شكل الفاتورة والنصوص التي تظهر أعلاها وأسفلها." icon={<IconReceipt size={16} />}>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {RECEIPT_TEMPLATES.map(t => {
            const on = template === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => set('receiptTemplate', t.id)}
                className={`relative rounded-lg border px-2 py-2.5 text-[12.5px] font-bold transition ${
                  on ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-500/15' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {on && <span className="absolute left-1.5 top-1.5 text-brand-600"><IconCheck size={12} /></span>}
                {t.title}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3">
          <Field label="اسم المتجر">
            <Input value={form.headerText ?? ''} onChange={e => set('headerText', e.target.value)} placeholder="اسم المحل" />
          </Field>
          <Field label="سطر تحت الاسم" hint="عنوان أو رقم هاتف.">
            <Input value={form.headerDescription ?? ''} onChange={e => set('headerDescription', e.target.value)} placeholder="عنوان أو هاتف" />
          </Field>
          <Field label="ذيل الفاتورة">
            <Input value={form.footerText ?? ''} onChange={e => set('footerText', e.target.value)} placeholder="شكراً لتسوقكم" />
          </Field>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f);
            e.target.value = '';
          }}
        />
        <div
          onDragOver={e => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={drop}
          className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 transition ${
            dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/70'
          }`}
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            {logoPreview ? (
              <img src={logoPreview} alt="الشعار" className={`h-10 w-10 object-contain ${form.showLogo ? '' : 'opacity-40'}`} />
            ) : (
              <span className="text-[11px] text-slate-400">شعار</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <Switch label="إظهار الشعار" description="اسحب صورة هنا أو اضغط رفع (PNG/JPG)." checked={form.showLogo} onChange={v => set('showLogo', v)} />
          </div>
          <div className="flex gap-1.5">
            <Btn variant="secondary" size="sm" icon={<IconUpload size={13} />} onClick={() => fileRef.current?.click()} loading={uploading}>
              {logoPreview ? 'تغيير' : 'رفع'}
            </Btn>
            {logoPreview && (
              <Btn variant="ghost" size="sm" icon={<IconTrash size={13} />} className="text-red-600 hover:bg-red-50" onClick={onDeleteLogo} loading={deleting}>
                حذف
              </Btn>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="الورق والطباعة" description="مقاس الورق والخط والتقريب والطباعة التلقائية." icon={<IconPrinter size={16} />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عرض الورق">
            <Select value={form.paperWidthMm} onChange={e => set('paperWidthMm', Number(e.target.value))}>
              <option value={58}>58 مم</option>
              <option value={80}>80 مم</option>
            </Select>
          </Field>
          <Field label="عدد النسخ" hint="من 1 إلى 3.">
            <NumberDraftInput min={1} max={3} integer value={form.copies} onValueChange={n => set('copies', n)} />
          </Field>
          <Field label="حجم الخط">
            <Select value={Math.max(9, Math.min(22, form.fontSize))} onChange={e => set('fontSize', Number(e.target.value))}>
              {Array.from({ length: 14 }, (_, i) => i + 9).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Field label="سماكة الخط">
            <Select value={form.fontWeight ?? 400} onChange={e => set('fontWeight', Number(e.target.value))}>
              <option value={300}>خفيف</option>
              <option value={400}>عادي</option>
              <option value={500}>متوسط</option>
              <option value={600}>شبه عريض</option>
              <option value={700}>عريض</option>
            </Select>
          </Field>
          <Field label="تقريب الإجمالي">
            <Select value={form.roundTotalTo ?? 250} onChange={e => set('roundTotalTo', Number(e.target.value))}>
              <option value={0}>بدون تقريب</option>
              <option value={250}>250 دينار</option>
              <option value={500}>500 دينار</option>
              <option value={1000}>1000 دينار</option>
            </Select>
          </Field>
          <div className="self-end pb-1">
            <Switch label="طباعة تلقائية بعد الحفظ" checked={form.autoPrint} onChange={v => set('autoPrint', v)} />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="ما يظهر على الفاتورة" description="اختر الحقول المطبوعة." icon={<IconEye size={16} />}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Checkbox label="جدول الأصناف" checked={form.showItemTable !== false} onChange={v => set('showItemTable', v)} />
          <Checkbox label="الدفعة والمبلغ المرتجع" checked={form.showPaymentLines !== false} onChange={v => set('showPaymentLines', v)} />
          <Checkbox label="اسم الكاشير" checked={form.showCashier !== false} onChange={v => set('showCashier', v)} />
          <Checkbox label="اسم البائع" checked={form.showSalesman !== false} onChange={v => set('showSalesman', v)} />
          <Checkbox label="اسم الصندوق" checked={form.showCashBox !== false} onChange={v => set('showCashBox', v)} />
          <Checkbox label="باركود الصنف" checked={form.showBarcode === true} onChange={v => set('showBarcode', v)} />
          <Checkbox label="رقم المادة" checked={form.showArticleNumber === true} onChange={v => set('showArticleNumber', v)} />
          <Checkbox label="رمز QR" checked={form.showQrCode} onChange={v => set('showQrCode', v)} />
        </div>
        {form.showQrCode && (
          <div className="mt-3">
            <Field label="نص رمز QR" hint="رابط أو نص يُشفَّر في الرمز أسفل الفاتورة.">
              <Input dir="auto" value={form.qrCodeText ?? ''} onChange={e => set('qrCodeText', e.target.value)} />
            </Field>
          </div>
        )}
      </SettingsCard>

      {template === 'classic' && (
        <SettingsCard title="خطوط جدول الفاتورة" description="تحكم مستقل بالجدول فقط — صغّره حتى 5 إذا بدا كبيراً." icon={<IconSliders size={16} />}>
          <ErrorBoundary compact resetKey="table-fonts">
            <ClassicTableFontControls
              settings={form}
              onChange={next => set('classicStyle', next)}
            />
          </ErrorBoundary>
        </SettingsCard>
      )}

      {template === 'classic' && (
        <section className="card overflow-hidden min-[1800px]:col-span-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen(o => !o)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right transition hover:bg-slate-50"
          >
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-header">خيارات متقدمة للنموذج الجدولي</span>
              <span className="block text-[12px] text-slate-500">ترتيب الأجزاء، حجم كل جزء، عرض الأعمدة، صيغة التاريخ.</span>
            </span>
            <span className={`text-slate-400 transition ${advancedOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {advancedOpen && (
            <div className="border-t border-slate-100 bg-slate-50/40 p-3">
              <ErrorBoundary compact resetKey={normalizeReceiptTemplate(form.receiptTemplate)}>
                <ClassicReceiptDesigner
                  settings={form}
                  onChange={next => set('classicStyle', next)}
                />
              </ErrorBoundary>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
