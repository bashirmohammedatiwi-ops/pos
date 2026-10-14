import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { Alert, Badge, Btn, Field, FieldRow, Select, Skeleton } from '@/components/ui';
import { IconCalendar, IconCopy, IconEye, IconPrinter, IconWallet, IconWifi } from '@/components/icons';
import { SettingsCard, StickySaveBar, readLocal, writeLocal } from '@/components/system/systemUi';
import { copyText } from '@/lib/clipboard';
import { getApiBase } from '@/lib/apiBase';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { businessWeekLabel, dayNameAr, weekEndDay } from '@/lib/businessPeriod';

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
const CATEGORY_KEY = 'fot_admin_settings_category';

type Category = 'cash' | 'print' | 'period' | 'network';
const CATEGORIES: readonly Category[] = ['cash', 'print', 'period', 'network'];

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

function cashFormFrom(d: PosCashBoxSettingsDto): UpdatePosCashBoxSettingsRequest {
  return {
    qiMasterAccount: d.qiMasterAccount ?? null,
    qiMasterAccountBank: d.qiMasterAccountBank ?? 0,
    giftMasterAccount: d.giftMasterAccount ?? null,
    giftMasterAccountBank: d.giftMasterAccountBank ?? 0,
    edariGiftAccount: d.edariGiftAccount ?? 0,
    edariQiAccount: d.edariQiAccount ?? 0,
  };
}

function cashLabelsFrom(d: PosCashBoxSettingsDto) {
  return {
    qiName: d.qiMasterAccountName,
    qiNum: d.qiMasterAccountNum,
    giftName: d.giftMasterAccountName,
    giftNum: d.giftMasterAccountNum,
    qiEdariName: d.edariQiAccountName,
    qiEdariNum: d.edariQiAccountNum,
  };
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
  const [category, setCategoryState] = useState<Category>(() => {
    // قيمة محفوظة قديمة/تالفة لا تطابق أي قسم → صفحة فارغة؛ نعود للافتراضي
    const saved = readLocal<Category>(CATEGORY_KEY);
    return saved && CATEGORIES.includes(saved) ? saved : 'cash';
  });

  function setCategory(c: Category) {
    setCategoryState(c);
    writeLocal(CATEGORY_KEY, c);
  }

  const q = useQuery({ queryKey: ['print-settings'], queryFn: api.printSettings });
  const cashBoxQ = useQuery({ queryKey: ['cashbox-settings'], queryFn: api.cashBoxSettings });
  const periodQ = useQuery({ queryKey: ['business-period'], queryFn: api.businessPeriodSettings });

  const skipPrintHydrate = useRef(false);
  const skipCashHydrate = useRef(false);
  const skipPeriodHydrate = useRef(false);
  const formRef = useRef(form);
  const cashRef = useRef(cashBoxForm);
  const periodRef = useRef(periodForm);
  formRef.current = form;
  cashRef.current = cashBoxForm;
  periodRef.current = periodForm;

  useEffect(() => {
    if (!q.data || skipPrintHydrate.current) return;
    setForm(toForm(q.data));
    setLogoUrl(q.data.logoUrl ?? null);
  }, [q.data]);

  useEffect(() => {
    if (!cashBoxQ.data || skipCashHydrate.current) return;
    setCashBoxForm(cashFormFrom(cashBoxQ.data));
    setCashBoxLabels(cashLabelsFrom(cashBoxQ.data));
  }, [cashBoxQ.data]);

  useEffect(() => {
    if (!periodQ.data || skipPeriodHydrate.current) return;
    setPeriodForm({
      weekStartDay: periodQ.data.weekStartDay,
      weekLengthDays: periodQ.data.weekLengthDays,
    });
  }, [periodQ.data]);

  const save = useMutation({
    mutationFn: () => api.savePrintSettings(formRef.current!),
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
    mutationFn: () => api.saveCashBoxSettings(cashRef.current!),
    onSuccess: (data: PosCashBoxSettingsDto) => {
      qc.invalidateQueries({ queryKey: ['cashbox-settings'] });
      setCashBoxLabels(cashLabelsFrom(data));
      toast.success('تم حفظ الصناديق');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const savePeriod = useMutation({
    mutationFn: () => api.saveBusinessPeriodSettings(periodRef.current!),
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
  const cardsBoxMissing = !!cashBoxForm && !(cashBoxForm.qiMasterAccount ?? 0);
  skipPrintHydrate.current = printDirty || save.isPending;
  skipCashHydrate.current = cashDirty || saveCashBoxes.isPending;
  skipPeriodHydrate.current = periodDirty || savePeriod.isPending;
  useUnsavedWarning(dirty);

  function saveAll() {
    if (printDirty) save.mutate();
    if (cashDirty) {
      if (cardsBoxMissing) toast.error('اختر حساب البطاقات قبل حفظ الصناديق');
      else saveCashBoxes.mutate();
    }
    if (periodDirty) savePeriod.mutate();
  }

  function discardAll() {
    if (q.data) {
      setForm(toForm(q.data));
      setLogoUrl(q.data.logoUrl ?? null);
    }
    if (cashBoxQ.data) {
      setCashBoxForm(cashFormFrom(cashBoxQ.data));
      setCashBoxLabels(cashLabelsFrom(cashBoxQ.data));
    }
    if (periodQ.data) setPeriodForm({ weekStartDay: periodQ.data.weekStartDay, weekLengthDays: periodQ.data.weekLengthDays });
    toast.info('تم تجاهل التغييرات');
  }

  useSaveShortcut(saveAll, dirty);

  const loadError = q.error ?? cashBoxQ.error ?? periodQ.error;
  if (loadError && (!form || !cashBoxForm || !periodForm)) {
    return (
      <Alert title="تعذر تحميل الإعدادات">
        <div className="flex flex-wrap items-center gap-2">
          <span>{loadError instanceof Error ? loadError.message : 'خطأ غير معروف'}</span>
          <Btn
            size="xs"
            variant="secondary"
            onClick={() => {
              void q.refetch();
              void cashBoxQ.refetch();
              void periodQ.refetch();
            }}
          >
            إعادة المحاولة
          </Btn>
        </div>
      </Alert>
    );
  }

  if (q.isLoading || cashBoxQ.isLoading || periodQ.isLoading || !form || !cashBoxForm || !periodForm) {
    return (
      <div className="flex gap-3">
        <div className="hidden w-56 shrink-0 space-y-2 lg:block">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
        <div className="flex-1 space-y-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  const set = <K extends keyof UpdatePrintSettingsRequest>(k: K, v: UpdatePrintSettingsRequest[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const previewSettings: PrintSettingsDto = { id: 0, ...form, logoUrl };
  const apiBase = getApiBase();
  const logoPreview = logoUrl
    ? logoUrl.startsWith('http')
      ? logoUrl
      : `${apiBase.replace(/\/$/, '')}${logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`}`
    : null;

  const categories: { id: Category; label: string; description: string; icon: ReactNode; dirty?: boolean; warn?: boolean }[] = [
    { id: 'cash', label: 'الصناديق والأداري', description: 'حساب البطاقات والهدايا', icon: <IconWallet size={16} />, dirty: cashDirty, warn: cardsBoxMissing },
    { id: 'print', label: 'الفاتورة الحرارية', description: 'النموذج والطباعة', icon: <IconPrinter size={16} />, dirty: printDirty },
    { id: 'period', label: 'فترة العمل', description: 'أسبوع العمولات والأهداف', icon: <IconCalendar size={16} />, dirty: periodDirty },
    { id: 'network', label: 'أجهزة الشبكة', description: 'عناوين الاتصال بالخادم', icon: <IconWifi size={16} /> },
  ];

  const dirtyLabels = [
    cashDirty && 'الصناديق',
    printDirty && 'الفاتورة',
    periodDirty && 'فترة العمل',
  ].filter(Boolean) as string[];

  const current = categories.find(c => c.id === category) ?? categories[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        {/* ── قائمة الأقسام ── */}
        <nav className="card flex shrink-0 flex-col overflow-hidden lg:w-56" aria-label="أقسام الإعدادات">
          <p className="hidden border-b border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] font-bold text-slate-500 lg:block">أقسام الإعدادات</p>
          <ul className="flex gap-1 overflow-x-auto p-1.5 lg:flex-1 lg:flex-col lg:overflow-y-auto">
            {categories.map(c => {
              const active = c.id === category;
              return (
                <li key={c.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setCategory(c.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-right transition ${
                      active ? 'bg-brand-50 text-brand-800 shadow-[inset_-3px_0_0_var(--color-brand-500)]' : 'text-slate-600 hover:bg-slate-50 hover:text-header'
                    }`}
                  >
                    <span className={`icon-tile h-7 w-7 shrink-0 rounded-lg ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {c.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${active ? 'font-bold' : 'font-semibold'}`}>{c.label}</span>
                      <span className="hidden truncate text-[11px] text-slate-500 lg:block">{c.description}</span>
                    </span>
                    {c.warn && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="يحتاج ضبطاً" />}
                    {c.dirty && !c.warn && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="تغييرات غير محفوظة" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hidden border-t border-slate-100 px-3 py-2 text-[11px] leading-5 text-slate-400 lg:block">
            التغييرات تُحفظ معاً من الشريط السفلي — أو Ctrl+S.
          </p>
        </nav>

        {/* ── المحتوى ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="card mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="text-brand-700">{current.icon}</span>
            <h2 className="text-[14px] font-bold text-header">{current.label}</h2>
            <span className="min-w-0 truncate text-[12px] text-slate-500">{current.description}</span>
            <span className="ms-auto flex items-center gap-1.5">
              {current.warn && <Badge tone="danger" dot>يحتاج ضبطاً</Badge>}
              {current.dirty && <Badge tone="warn" dot>تغييرات غير محفوظة</Badge>}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto pb-2">
          {category === 'cash' && (
            <div className="space-y-3">
              {cardsBoxMissing && (
                <Alert type="error" title="صندوق البطاقات غير مضبوط">
                  نقاط البيع سترفض أي دفع بالماستر كارد حتى تختار حساب البطاقات هنا.
                </Alert>
              )}
              <div className="grid items-start gap-3 xl:grid-cols-2">
              <SettingsCard
                title="حساب البطاقات (الماستر / QI)"
                description="أهم إعداد في النظام: تُقيَّد عليه كل فاتورة بطاقة في نقطة البيع، وبه تُرحَّل إلى الأداري."
                icon={<IconWallet size={16} />}
                tone={cardsBoxMissing ? 'danger' : undefined}
              >
                <CashBoxPicker
                  label="الحساب المختار"
                  hint="اكتب «QiCard» أو «301» في البحث — الحسابات غير الصندوقية تظهر بالبحث فقط."
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
              </SettingsCard>

              <SettingsCard
                title="حساب الهدايا"
                description="تُقيَّد عليه فواتير الهدايا وتُرحَّل إلى الأداري كفاتورة إخراج."
                icon={<IconWallet size={16} />}
              >
                <CashBoxPicker
                  label="الحساب المختار"
                  hint="اكتب «هدايا» أو «3133» في البحث — الحسابات غير الصندوقية تظهر بالبحث فقط."
                  emptyHint="لم يُحدد حساب هدايا — فواتير الهدايا ستفشل في الترحيل إلى الأداري حتى تختار حساباً."
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
              </SettingsCard>
              </div>
              <p className="text-[11.5px] text-slate-500">صناديق الكاشير النقدية تُربط من صفحة الأقسام لكل قسم على حدة.</p>
            </div>
          )}

          {category === 'print' && (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
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
              <div className="xl:sticky xl:top-0 xl:self-start">
                <SettingsCard title="معاينة مباشرة" description="فاتورة نموذجية بالإعدادات الحالية." icon={<IconEye size={16} />}>
                  <ErrorBoundary compact resetKey="print-preview">
                    <ReceiptPreviewPanel settings={previewSettings} apiBase={apiBase} />
                  </ErrorBoundary>
                </SettingsCard>
              </div>
            </div>
          )}

          {category === 'period' && (
            <div className="max-w-4xl space-y-3">
              <SettingsCard
                title="فترة العمل — العمولات والأهداف"
                description="العمولات تُحسب أسبوعياً، والأهداف الأسبوعية تتبع نفس الفترة."
                icon={<IconCalendar size={16} />}
              >
                <div className="space-y-4">
                  <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-3 py-2.5 text-[12.5px] leading-6 text-slate-700">
                    الأسبوع الحالي:{' '}
                    <strong className="num">{periodQ.data?.currentWeekStart.slice(0, 10)}</strong>
                    {' ← '}
                    <strong className="num">{periodQ.data?.currentWeekEnd.slice(0, 10)}</strong>
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
                    <Field label="مدة الأسبوع" hint="الافتراضي: السبت ← الجمعة (7 أيام).">
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
                  <p className="text-[12.5px] text-slate-600">
                    نهاية الأسبوع بعد الحفظ:{' '}
                    <strong className="text-header">{dayNameAr(weekEndDay(periodForm.weekStartDay, periodForm.weekLengthDays))}</strong>
                  </p>
                  {periodDirty && (
                    <Alert type="warning">تغيير الفترة يغيّر حساب الأسبوع الحالي للعمولات والأهداف لكل البائعين.</Alert>
                  )}
                </div>
              </SettingsCard>
            </div>
          )}

          {category === 'network' && (
            <div className="max-w-4xl space-y-3">
              <LanShareSection />
            </div>
          )}
          </div>
        </div>
      </div>

      <StickySaveBar
        count={dirtyLabels.length}
        labels={dirtyLabels}
        onSave={saveAll}
        onDiscard={discardAll}
        saving={save.isPending || saveCashBoxes.isPending || savePeriod.isPending}
        disabled={cashDirty && cardsBoxMissing && !printDirty && !periodDirty}
        disabledReason={cashDirty && cardsBoxMissing ? 'اختر حساب البطاقات أولاً' : undefined}
      />
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
    <SettingsCard
      title="أجهزة الشبكة"
      description="ثبّت لوحة التحكم أو الكاشير على الأجهزة الأخرى واتصل بهذا الخادم عبر الشبكة المحلية."
      icon={<IconWifi size={16} />}
    >
      <div className="space-y-3 text-[12.5px]">
        <p className="text-slate-600">
          هذا الجهاز متصل حالياً بـ{' '}
          <span className="font-mono font-semibold text-slate-800" dir="ltr">{apiBase || 'نفس الأصل'}</span>
          {info.data?.hostName ? ` · ${info.data.hostName}` : ''}
        </p>
        {info.isLoading && <Skeleton className="h-10 rounded-lg" />}
        {info.isError && <Alert>تعذر جلب عناوين الشبكة من الخادم.</Alert>}
        {!info.isLoading && !info.isError && urls.length === 0 && (
          <Alert type="warning">لا توجد عناوين شبكة ظاهرة — تأكد أن الخادم يستمع على المنفذ 5000 وأن جدار الحماية يسمح به.</Alert>
        )}
        {urls.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {urls.map(url => (
              <div key={url} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="min-w-0 truncate font-mono text-[13px] text-slate-800" dir="ltr" title={url}>{url}</span>
                <Btn size="xs" variant="secondary" icon={<IconCopy size={12} />} onClick={() => void copy(url)}>نسخ</Btn>
              </div>
            ))}
          </div>
        )}
        <p className="leading-6 text-slate-500">
          على الجهاز الثانوي اضغط «بحث عن الخادم على الشبكة» أو الصق أحد العناوين أعلاه. يمكن أيضاً فتح لوحة التحكم من المتصفح على نفس العنوان.
          لا تثبّت نسخة الخادم على كل جهاز.
        </p>
      </div>
    </SettingsCard>
  );
}
