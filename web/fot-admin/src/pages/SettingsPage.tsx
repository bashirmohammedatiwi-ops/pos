import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type {
  PrintSettingsDto,
  PosCashBoxSettingsDto,
  UpdatePrintSettingsRequest,
  UpdatePosCashBoxSettingsRequest,
  UpdateBusinessPeriodSettingsRequest,
} from '@/api/types';
import { normalizeReceiptTemplate, parseClassicStyle, receiptHtml, receiptPaperWidthMm } from '@fot/shared';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ReceiptPreviewPanel, SAMPLE_RECEIPT } from '@/components/ReceiptPreview';
import { ReceiptPrintSettingsPanel } from '@/components/ReceiptPrintSettings';
import { printHtmlDoc } from '@/lib/print';
import { CashBoxPicker } from '@/components/CashBoxPicker';
import { useToast } from '@/components/Toast';
import { Btn, Field, FieldRow, Loading, Select } from '@/components/ui';
import { DashCard, FilterStrip, FormSection, ListPageShell, SegmentedTabs, UnsavedBar } from '@/components/workspace';
import { copyText } from '@/lib/clipboard';
import { getApiBase } from '@/lib/apiBase';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { businessWeekLabel, dayNameAr, weekEndDay } from '@/lib/businessPeriod';

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

function toForm(s: PrintSettingsDto): UpdatePrintSettingsRequest {
  try {
    const { id: _, ...rest } = s;
    return {
      ...rest,
      receiptTemplate: normalizeReceiptTemplate(s.receiptTemplate),
      classicStyle: parseClassicStyle(s.classicStyle),
    };
  } catch {
    return {
      ...s,
      receiptTemplate: 'classic',
      classicStyle: {},
    };
  }
}

function stableJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<UpdatePrintSettingsRequest | null>(null);
  const [cashBoxForm, setCashBoxForm] = useState<UpdatePosCashBoxSettingsRequest | null>(null);
  const [periodForm, setPeriodForm] = useState<UpdateBusinessPeriodSettingsRequest | null>(null);
  const [cashBoxLabels, setCashBoxLabels] = useState<{
    qiName?: string | null;
    qiNum?: string | null;
    giftName?: string | null;
    giftNum?: string | null;
    qiEdariName?: string | null;
    qiEdariNum?: string | null;
  }>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState(0);

  const q = useQuery({ queryKey: ['print-settings'], queryFn: api.printSettings });
  const cashBoxQ = useQuery({ queryKey: ['cashbox-settings'], queryFn: api.cashBoxSettings });
  const periodQ = useQuery({ queryKey: ['business-period'], queryFn: api.businessPeriodSettings });

  useEffect(() => {
    if (q.data) {
      setForm(toForm(q.data));
      setLogoUrl(q.data.logoUrl ?? null);
    }
  }, [q.data]);

  useEffect(() => {
    if (cashBoxQ.data) {
      const d = cashBoxQ.data;
      setCashBoxForm({
        qiMasterAccount: d.qiMasterAccount ?? null,
        qiMasterAccountBank: d.qiMasterAccountBank ?? 0,
        giftMasterAccount: d.giftMasterAccount ?? null,
        giftMasterAccountBank: d.giftMasterAccountBank ?? 0,
        edariGiftAccount: d.edariGiftAccount ?? 0,
        edariQiAccount: d.edariQiAccount ?? 0,
      });
      setCashBoxLabels({
        qiName: d.qiMasterAccountName,
        qiNum: d.qiMasterAccountNum,
        giftName: d.giftMasterAccountName,
        giftNum: d.giftMasterAccountNum,
        qiEdariName: d.edariQiAccountName,
        qiEdariNum: d.edariQiAccountNum,
      });
    }
  }, [cashBoxQ.data]);

  useEffect(() => {
    if (periodQ.data) {
      setPeriodForm({
        weekStartDay: periodQ.data.weekStartDay,
        weekLengthDays: periodQ.data.weekLengthDays,
      });
    }
  }, [periodQ.data]);

  const save = useMutation({
    mutationFn: () => api.savePrintSettings(form!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['print-settings'] });
      toast.success('تم حفظ إعدادات الطباعة');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const uploadLogo = useMutation({
    mutationFn: (file: File) => api.uploadPrintLogo(file),
    onSuccess: data => {
      setLogoUrl(data.logoUrl ?? null);
      setForm(f => (f ? { ...f, showLogo: true } : f));
      qc.invalidateQueries({ queryKey: ['print-settings'] });
      toast.success('تم رفع الشعار');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل رفع الشعار'),
  });

  const deleteLogo = useMutation({
    mutationFn: () => api.deletePrintLogo(),
    onSuccess: () => {
      setLogoUrl(null);
      setForm(f => (f ? { ...f, showLogo: false } : f));
      qc.invalidateQueries({ queryKey: ['print-settings'] });
      toast.success('تم حذف الشعار');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const saveCashBoxes = useMutation({
    mutationFn: () => api.saveCashBoxSettings(cashBoxForm!),
    onSuccess: (data: PosCashBoxSettingsDto) => {
      qc.invalidateQueries({ queryKey: ['cashbox-settings'] });
      setCashBoxLabels({
        qiName: data.qiMasterAccountName,
        qiNum: data.qiMasterAccountNum,
        giftName: data.giftMasterAccountName,
        giftNum: data.giftMasterAccountNum,
        qiEdariName: data.edariQiAccountName,
        qiEdariNum: data.edariQiAccountNum,
      });
      toast.success('تم حفظ الصناديق');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const savePeriod = useMutation({
    mutationFn: () => api.saveBusinessPeriodSettings(periodForm!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-period'] });
      toast.success('تم حفظ فترة العمل');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const printDirty = !!(q.data && form && stableJson(toForm(q.data)) !== stableJson(form));
  const cashDirty = !!(
    cashBoxQ.data &&
    cashBoxForm &&
    (cashBoxQ.data.qiMasterAccount !== cashBoxForm.qiMasterAccount
      || cashBoxQ.data.giftMasterAccount !== cashBoxForm.giftMasterAccount
      || (cashBoxQ.data.edariGiftAccount ?? 0) !== cashBoxForm.edariGiftAccount
      || (cashBoxQ.data.edariQiAccount ?? 0) !== cashBoxForm.edariQiAccount)
  );
  const periodDirty = !!(
    periodQ.data &&
    periodForm &&
    (periodQ.data.weekStartDay !== periodForm.weekStartDay
      || periodQ.data.weekLengthDays !== periodForm.weekLengthDays)
  );
  const dirty = printDirty || cashDirty || periodDirty;
  useUnsavedWarning(dirty);
  useSaveShortcut(() => {
    if (printDirty) save.mutate();
    if (cashDirty) saveCashBoxes.mutate();
    if (periodDirty) savePeriod.mutate();
  }, dirty);

  if (q.isLoading || cashBoxQ.isLoading || periodQ.isLoading || !form || !cashBoxForm || !periodForm) return <Loading />;

  const set = <K extends keyof UpdatePrintSettingsRequest>(k: K, v: UpdatePrintSettingsRequest[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const previewSettings: PrintSettingsDto = { id: 0, ...form, logoUrl };
  const apiBase = getApiBase();
  const logoPreview = logoUrl
    ? logoUrl.startsWith('http')
      ? logoUrl
      : `${apiBase.replace(/\/$/, '')}${logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`}`
    : null;
  const cardsBoxMissing = !(cashBoxForm.qiMasterAccount ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListPageShell
        filter={
          <FilterStrip>
            <SegmentedTabs
              compact
              value={settingsTab}
              onChange={setSettingsTab}
              items={[
                { id: 0, label: 'الصناديق والأداري' },
                { id: 1, label: 'الفاتورة الحرارية' },
                { id: 2, label: 'متقدم' },
              ]}
            />
          </FilterStrip>
        }
      >
      <div className={`overflow-auto p-2 ${settingsTab === 1 ? 'grid gap-2 lg:grid-cols-2' : 'space-y-2'}`}>
      <div className="space-y-2">
      {settingsTab === 0 && (
      <FormSection compact title="الصناديق" hint="ترحيل البطاقات والهدايا — أهم إعداد في النظام">
        <div className="space-y-3">
          {cardsBoxMissing && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-semibold leading-relaxed text-red-800">
              صندوق البطاقات غير مضبوط — نقاط البيع سترفض أي دفع بالماستر كارد حتى تختار صندوقاً هنا.
            </div>
          )}
          <CashBoxPicker
            label="حساب البطاقات (الماستر / QI)"
            hint="حساب واحد يخدم الجهتين: تُقيَّد عليه كل فاتورة بطاقة في نقطة البيع، وبه تُرحَّل للأداري. اكتب «QiCard» أو «301» في البحث — الحسابات غير الصندوقية تظهر بالبحث فقط."
            emptyHint="لم يُحدد حساب البطاقات — نقاط البيع سترفض الدفع بالماستر وفواتير البطاقة لن تُرحَّل."
            value={cashBoxForm.qiMasterAccount}
            displayName={cashBoxLabels.qiName}
            displayNum={cashBoxLabels.qiNum}
            onChange={a => {
              const id = a?.id ?? 0;
              setCashBoxForm(f =>
                f
                  ? {
                      ...f,
                      qiMasterAccount: id > 0 ? id : null,
                      qiMasterAccountBank: id > 0 ? 0 : null,
                      edariQiAccount: id,
                    }
                  : f,
              );
              setCashBoxLabels(l => ({
                ...l,
                qiName: a?.name ?? null,
                qiNum: a?.num ?? null,
                qiEdariName: a?.name ?? null,
                qiEdariNum: a?.num ?? null,
              }));
            }}
          />

          <CashBoxPicker
            label="حساب الهدايا"
            hint="تُقيَّد عليه فواتير الهدايا وتُرحَّل للأداري كفاتورة إخراج. اكتب «هدايا» أو «3133» في البحث — الحسابات غير الصندوقية تظهر بالبحث فقط."
            emptyHint="لم يُحدد حساب هدايا — فواتير الهدايا ستفشل في الترحيل للأداري حتى تختار حساباً."
            value={cashBoxForm.edariGiftAccount ?? null}
            displayName={cashBoxLabels.giftName}
            displayNum={cashBoxLabels.giftNum}
            onChange={a => {
              const id = a?.id ?? 0;
              setCashBoxForm(f =>
                f
                  ? {
                      ...f,
                      edariGiftAccount: id,
                      giftMasterAccount: id > 0 ? id : null,
                      giftMasterAccountBank: id > 0 ? 0 : null,
                    }
                  : f,
              );
              setCashBoxLabels(l => ({ ...l, giftName: a?.name ?? null, giftNum: a?.num ?? null }));
            }}
          />

          <Btn
            onClick={() => saveCashBoxes.mutate()}
            disabled={saveCashBoxes.isPending || !cashDirty || cardsBoxMissing}
          >
            {saveCashBoxes.isPending ? 'جاري الحفظ…' : 'حفظ الصناديق'}
          </Btn>
        </div>
      </FormSection>
      )}

      {settingsTab === 1 && (
        <ErrorBoundary compact resetKey="print-settings">
        <ReceiptPrintSettingsPanel
          form={form}
          set={set}
          logoPreview={logoPreview}
          fileRef={fileRef}
          onPickFile={file => uploadLogo.mutate(file)}
          onDeleteLogo={() => deleteLogo.mutate()}
          uploading={uploadLogo.isPending}
          deleting={deleteLogo.isPending}
          onSave={() => save.mutate()}
          saving={save.isPending}
          dirty={printDirty}
          onTestPrint={async () => {
            try {
              const html = receiptHtml(SAMPLE_RECEIPT, previewSettings, apiBase);
              await printHtmlDoc(html, previewSettings.copies || 1, receiptPaperWidthMm(previewSettings));
              toast.success('أُرسلت تجربة الطباعة');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'تعذرت الطباعة');
            }
          }}
        />
        </ErrorBoundary>
      )}

      {settingsTab === 2 && (
      <>
      <LanShareSection />

      <FormSection compact title="فترة العمل — العمولات والأهداف" hint="العمولات تُحسب أسبوعياً؛ الأهداف الأسبوعية تتبع نفس الفترة">
        <div className="space-y-3">
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 px-3 py-2 text-[12px] leading-6 text-slate-700">
            الأسبوع الحالي:{' '}
            <strong>{periodQ.data?.currentWeekStart.slice(0, 10)}</strong>
            {' → '}
            <strong>{periodQ.data?.currentWeekEnd.slice(0, 10)}</strong>
            {' · '}
            {businessWeekLabel(periodQ.data)}
          </div>
          <FieldRow>
            <Field label="بداية الأسبوع">
              <Select
                value={String(periodForm.weekStartDay)}
                onChange={e => setPeriodForm(f => f ? { ...f, weekStartDay: Number(e.target.value) } : f)}
              >
                {WEEK_DAYS.map(d => (
                  <option key={d} value={d}>{dayNameAr(d)}</option>
                ))}
              </Select>
            </Field>
            <Field label="مدة الأسبوع (أيام)">
              <Select
                value={String(periodForm.weekLengthDays)}
                onChange={e => setPeriodForm(f => f ? { ...f, weekLengthDays: Number(e.target.value) } : f)}
              >
                {[5, 6, 7, 8, 10, 14].map(n => (
                  <option key={n} value={n}>{n} أيام</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <p className="text-[12px] text-slate-500">
            نهاية الأسبوع:{' '}
            <strong>{dayNameAr(weekEndDay(periodForm.weekStartDay, periodForm.weekLengthDays))}</strong>
            {' — '}
            الافتراضي: السبت → الجمعة (7 أيام)
          </p>
          <Btn onClick={() => savePeriod.mutate()} disabled={savePeriod.isPending || !periodDirty}>
            {savePeriod.isPending ? 'جاري الحفظ…' : 'حفظ فترة العمل'}
          </Btn>
        </div>
      </FormSection>
      </>
      )}
      </div>

      {settingsTab === 1 && (
        <div className="lg:sticky lg:top-2 lg:self-start">
          <DashCard compact title="معاينة مباشرة">
            <ErrorBoundary compact resetKey="print-preview">
              <ReceiptPreviewPanel settings={previewSettings} apiBase={apiBase} />
            </ErrorBoundary>
          </DashCard>
        </div>
      )}
      </div>
      </ListPageShell>

      {dirty && (
        <UnsavedBar
          text="تغييرات غير محفوظة"
          onSave={() => {
            if (printDirty) save.mutate();
            if (cashDirty) saveCashBoxes.mutate();
            if (periodDirty) savePeriod.mutate();
          }}
          pending={save.isPending || saveCashBoxes.isPending || savePeriod.isPending}
        />
      )}
    </div>
  );
}

function LanShareSection() {
  const toast = useToast();
  const apiBase = getApiBase();
  const info = useQuery({ queryKey: ['server-info'], queryFn: api.serverInfo, staleTime: 30_000 });
  const data = info.data;
  const urls = data ? data.lanAddresses.map(ip => `http://${ip}:${data.apiPort}`) : [];

  async function copy(url: string) {
    try {
      await copyText(url);
      toast.success('تم نسخ العنوان');
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  return (
    <FormSection
      compact
      title="أجهزة الشبكة"
      hint="ثبّت لوحة التحكم أو الكاشير على الأجهزة الأخرى واتصل بهذا الخادم عبر LAN"
    >
      <div className="space-y-2 text-[12px]">
        <p className="text-slate-600">
          هذا الجهاز متصل حالياً بـ{' '}
          <span className="font-mono font-semibold text-slate-800" dir="ltr">{apiBase || 'نفس الأصل'}</span>
          {info.data?.hostName ? ` · ${info.data.hostName}` : ''}
        </p>
        {urls.length === 0 && <p className="text-[12px] text-slate-500">لا توجد عناوين شبكة ظاهرة — تأكد أن الخادم يستمع على المنفذ 5000 وأن جدار الحماية يسمح به.</p>}
        {urls.map(url => (
          <div key={url} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-mono text-[12px] text-slate-800" dir="ltr">{url}</span>
            <Btn variant="secondary" onClick={() => void copy(url)}>نسخ</Btn>
          </div>
        ))}
        <p className="text-[12px] text-slate-500">
          على الجهاز الثانوي اضغط «بحث عن الخادم على الشبكة» أو الصق أحد العناوين أعلاه. يمكن أيضاً فتح لوحة التحكم من المتصفح على نفس العنوان. لا تثبّت نسخة الخادم على كل جهاز.
        </p>
      </div>
    </FormSection>
  );
}
