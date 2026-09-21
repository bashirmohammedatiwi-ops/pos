import { useState, type DragEvent, type RefObject } from 'react';
import { RECEIPT_TEMPLATES, normalizeReceiptTemplate } from '@fot/shared';
import type { UpdatePrintSettingsRequest } from '@/api/types';
import { ClassicReceiptDesigner, ClassicTableFontControls } from '@/components/ClassicReceiptDesigner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Btn, Checkbox, Field, Input, Select } from '@/components/ui';
import { FormSection, SettingsDrawer } from '@/components/workspace';

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
  const template = normalizeReceiptTemplate(form.receiptTemplate);

  function drop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) onPickFile(file);
  }

  return (
    <div className="space-y-3">
      <FormSection compact title="النموذج والنصوص">
        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {RECEIPT_TEMPLATES.map(t => {
            const on = template === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => set('receiptTemplate', t.id)}
                className={`rounded-lg border px-2 py-2 text-[12.5px] font-bold ${
                  on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {t.title}
              </button>
            );
          })}
        </div>
        <div className="space-y-2">
          <Field label="اسم المتجر">
            <Input value={form.headerText ?? ''} onChange={e => set('headerText', e.target.value)} placeholder="اسم المحل" />
          </Field>
          <Field label="سطر تحت الاسم">
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
          className={`mt-3 flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 ${
            dragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/70'
          }`}
        >
          {logoPreview && form.showLogo ? (
            <img src={logoPreview} alt="" className="h-10 w-10 object-contain" />
          ) : (
            <div className="text-[12px] text-slate-500">شعار</div>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Checkbox label="إظهار الشعار" checked={form.showLogo} onChange={v => set('showLogo', v)} />
            <Btn variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'جاري الرفع…' : logoPreview ? 'تغيير' : 'رفع'}
            </Btn>
            {logoPreview && (
              <Btn variant="ghost" size="sm" onClick={onDeleteLogo} disabled={deleting}>حذف</Btn>
            )}
          </div>
        </div>
      </FormSection>

      <FormSection compact title="الورق والطباعة">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="عرض الورق">
            <Select value={form.paperWidthMm} onChange={e => set('paperWidthMm', Number(e.target.value))}>
              <option value={58}>58 مم</option>
              <option value={80}>80 مم</option>
            </Select>
          </Field>
          <Field label="عدد النسخ">
            <Input type="number" min={1} max={3} value={form.copies} onChange={e => set('copies', Number(e.target.value))} />
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
          <div className="self-end pb-1.5">
            <Checkbox label="طباعة تلقائية بعد الحفظ" checked={form.autoPrint} onChange={v => set('autoPrint', v)} />
          </div>
        </div>
      </FormSection>

      <FormSection compact title="ما يظهر على الفاتورة">
        <div className="grid gap-2 sm:grid-cols-2">
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
            <Field label="نص QR">
              <Input value={form.qrCodeText ?? ''} onChange={e => set('qrCodeText', e.target.value)} />
            </Field>
          </div>
        )}
      </FormSection>

      {template === 'classic' && (
        <FormSection compact title="خطوط جدول الفاتورة" hint="تحكم مستقل بالجدول فقط — صغّره حتى 5 إذا بدا كبيراً">
          <ErrorBoundary compact resetKey="table-fonts">
            <ClassicTableFontControls
              settings={form}
              onChange={next => set('classicStyle', next)}
            />
          </ErrorBoundary>
        </FormSection>
      )}

      {template === 'classic' && (
        <SettingsDrawer summary="خيارات متقدمة للنموذج الجدولي — ترتيب الأجزاء وعرض الأعمدة">
          <ErrorBoundary compact resetKey={normalizeReceiptTemplate(form.receiptTemplate)}>
            <ClassicReceiptDesigner
              settings={form}
              onChange={next => set('classicStyle', next)}
            />
          </ErrorBoundary>
        </SettingsDrawer>
      )}

      <div className="flex flex-wrap gap-2">
        <Btn onClick={onSave} disabled={saving || !dirty} loading={saving}>
          حفظ إعدادات الفاتورة
        </Btn>
        <Btn variant="secondary" onClick={onTestPrint}>
          طباعة تجريبية
        </Btn>
      </div>
    </div>
  );
}
