import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNum } from '@/api/client';
import type {
  CashierCreditAccountDto,
  CashierDetailDto,
  CashierDto,
  SectionSummaryDto,
  UpdatePermissionsRequest,
} from '@/api/types';
import { CreditAccountMultiSelect } from '@/components/CreditAccountMultiSelect';
import { NumberDraftInput } from '@/components/NumberDraftInput';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { useToast } from '@/components/Toast';
import { IconAlert, IconKeyboard, IconLock, IconShield, IconUsers, IconWallet, IconEye } from '@/components/icons';
import { Alert, Btn, Field, Input, Kbd, Modal, Select, Skeleton, Switch, Tabs, useConfirm } from '@/components/ui';
import { CopyButton, IconDice, IconEyeOff, randomPin } from '@/components/people/PeopleKit';

/* ── تعريف الصلاحيات مع وصف قصير لكل منها ── */

type PermKey = keyof UpdatePermissionsRequest;
type BoolPermKey = Exclude<PermKey, 'itemDiscountLimit' | 'userDiscountLimit' | 'numberOfHoldReceipts'>;

export const PERM_GROUPS: { title: string; keys: { key: BoolPermKey; label: string; desc: string }[] }[] = [
  {
    title: 'البيع',
    keys: [
      { key: 'allowCreditReceipt', label: 'بيع آجل', desc: 'إصدار فاتورة على حساب آجل من حسابات الكاشير.' },
      { key: 'allowSalesReturn', label: 'مرتجع', desc: 'استلام مرتجعات من الزبائن.' },
      { key: 'invoiceBoundReturn', label: 'مرتجع مربوط بالفاتورة فقط', desc: 'لا يُقبل المرتجع إلا باختيار الفاتورة الأصلية.' },
      { key: 'allowGiftReceipt', label: 'هدية', desc: 'إصدار فاتورة هدية بقيمة صفر.' },
      {
        key: 'giftViaDiscountQr',
        label: 'الهدية عبر رمز الخصم',
        desc: 'لا تُفتح الهدية إلا بعد مسح QR الخصم غير المحدود، وتُضاف الأصناف بالباركود فقط.',
      },
      { key: 'allowSearchArticles', label: 'بحث المنتجات', desc: 'البحث عن صنف بالاسم بدل الباركود.' },
      { key: 'allowPriceChange', label: 'تغيير السعر', desc: 'تعديل سعر البند يدوياً في الفاتورة.' },
    ],
  },
  {
    title: 'الفاتورة',
    keys: [
      { key: 'makeDiscount', label: 'خصم الفاتورة', desc: 'خصم على إجمالي الفاتورة ضمن الحد المسموح.' },
      { key: 'deleteItem', label: 'حذف بند', desc: 'حذف صنف من الفاتورة قبل الدفع.' },
      { key: 'duplicateItem', label: 'تكرار بند', desc: 'تكرار آخر صنف بضغطة واحدة.' },
      { key: 'discardReceipt', label: 'إلغاء الفاتورة', desc: 'إلغاء الفاتورة الحالية بالكامل.' },
      { key: 'allowEditReceipt', label: 'تعديل فاتورة', desc: 'فتح فاتورة محفوظة وتعديلها.' },
      { key: 'viewReceipts', label: 'عرض الفواتير', desc: 'استعراض الفواتير السابقة من نقطة البيع.' },
    ],
  },
  {
    title: 'التشغيل',
    keys: [
      { key: 'cashReport', label: 'تقرير الصندوق', desc: 'طباعة تقرير الصندوق وإغلاق الوردية.' },
      { key: 'offlineLogin', label: 'دخول أوفلاين', desc: 'الدخول عند انقطاع الاتصال بالخادم.' },
      { key: 'manualTransfer', label: 'ترحيل يدوي', desc: 'ترحيل الفواتير إلى الأداري يدوياً.' },
    ],
  },
  {
    title: 'البائع',
    keys: [
      { key: 'hideSalesmanGroups', label: 'إخفاء مجاميع البائعين', desc: 'بائع واحد لكل فاتورة بدل توزيع البنود.' },
      { key: 'printSalesmanOnReceipt', label: 'اسم البائع في المطبوع', desc: 'طباعة اسم البائع على الفاتورة.' },
    ],
  },
];

const ALL_BOOL_KEYS = PERM_GROUPS.flatMap(g => g.keys.map(k => k.key));

function emptyPerms(): UpdatePermissionsRequest {
  return {
    makeDiscount: true,
    viewReceipts: true,
    cashReport: true,
    deleteItem: true,
    duplicateItem: false,
    offlineLogin: true,
    discardReceipt: true,
    allowCreditReceipt: false,
    allowSalesReturn: true,
    allowGiftReceipt: true,
    giftViaDiscountQr: false,
    allowPriceChange: false,
    allowSearchArticles: true,
    allowEditReceipt: false,
    manualTransfer: false,
    allowProductDiscount: false,
    hideSalesmanGroups: false,
    invoiceBoundReturn: false,
    printSalesmanOnReceipt: true,
    itemDiscountLimit: 0,
    userDiscountLimit: 0,
    numberOfHoldReceipts: 3,
  };
}

/** يحوّل أي كائن صلاحيات (تفاصيل كاشير أو قالب) إلى طلب حفظ. */
function toPerms(p: CashierDetailDto['permissions']): UpdatePermissionsRequest {
  return {
    makeDiscount: p.makeDiscount,
    viewReceipts: p.viewReceipts,
    cashReport: p.cashReport,
    deleteItem: p.deleteItem,
    duplicateItem: p.duplicateItem,
    offlineLogin: p.offlineLogin,
    discardReceipt: p.discardReceipt,
    allowCreditReceipt: p.allowCreditReceipt,
    allowSalesReturn: p.allowSalesReturn,
    allowGiftReceipt: p.allowGiftReceipt,
    giftViaDiscountQr: p.giftViaDiscountQr ?? false,
    allowPriceChange: p.allowPriceChange,
    allowSearchArticles: p.allowSearchArticles,
    allowEditReceipt: p.allowEditReceipt,
    manualTransfer: p.manualTransfer ?? false,
    allowProductDiscount: p.allowProductDiscount ?? false,
    hideSalesmanGroups: p.hideSalesmanGroups ?? false,
    invoiceBoundReturn: p.invoiceBoundReturn ?? false,
    printSalesmanOnReceipt: p.printSalesmanOnReceipt ?? true,
    itemDiscountLimit: p.itemDiscountLimit,
    userDiscountLimit: p.userDiscountLimit,
    numberOfHoldReceipts: p.numberOfHoldReceipts,
  };
}

type EditorTab = 'account' | 'perms' | 'sales';

interface FormState {
  username: string;
  password: string;
  accountName: string;
  sectionId: number;
  active: boolean;
  perms: UpdatePermissionsRequest;
  applyCommissions: boolean;
  applyTargets: boolean;
  salesmanIds: number[];
  creditAccounts: CashierCreditAccountDto[];
}

function Section({ title, hint, icon, actions, children }: { title: string; hint?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="text-slate-400">{icon}</span>}
          <div className="min-w-0">
            <h4 className="text-[13px] font-bold text-header">{title}</h4>
            {hint && <p className="text-[11.5px] text-slate-500">{hint}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-red-600">
      <IconAlert size={12} />
      {children}
    </p>
  );
}

export function CashierEditor({
  editingId,
  copyFromId,
  cashiers,
  sections,
  onClose,
}: {
  editingId: number | 'new';
  /** عند "نسخ الإعدادات": كاشير تُنسخ صلاحياته وقسمه وبائعوه إلى كاشير جديد. */
  copyFromId?: number | null;
  cashiers: CashierDto[];
  sections: SectionSummaryDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = editingId === 'new';
  const listRow = typeof editingId === 'number' ? cashiers.find(c => c.id === editingId) : undefined;
  const sourceId = typeof editingId === 'number' ? editingId : copyFromId ?? null;

  const [tab, setTab] = useState<EditorTab>('account');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [permQuery, setPermQuery] = useState('');
  const [form, setForm] = useState<FormState>(() => ({
    username: listRow?.username ?? '',
    password: '',
    accountName: listRow?.accountName ?? '',
    sectionId: listRow?.sectionId ?? (isNew ? sections.find(s => (s.cashBoxCount ?? 0) > 0)?.id ?? sections[0]?.id ?? 0 : 0),
    active: listRow?.active ?? true,
    perms: emptyPerms(),
    applyCommissions: true,
    applyTargets: true,
    salesmanIds: [],
    creditAccounts: [],
  }));
  const [formReady, setFormReady] = useState(sourceId == null);
  const [templateId, setTemplateId] = useState(0);
  const snapshot = useRef<string | null>(null);
  const loadedFor = useRef<number | null>(null);

  const templatesQ = useQuery({ queryKey: ['permissions'], queryFn: api.permissions, staleTime: 120_000 });
  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen(true), staleTime: 120_000 });
  const detailQ = useQuery({
    queryKey: ['cashier', sourceId],
    queryFn: () => api.cashier(sourceId as number),
    enabled: sourceId != null,
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
  const setPerm = (k: PermKey, v: boolean | number) => setForm(f => ({ ...f, perms: { ...f.perms, [k]: v } }));

  // تحميل التفاصيل مرة واحدة لكل كاشير
  useEffect(() => {
    const d = detailQ.data;
    if (!d || sourceId == null || d.id !== sourceId) return;
    if (loadedFor.current === d.id) return;
    loadedFor.current = d.id;
    setForm(f => ({
      ...f,
      ...(isNew
        ? {}
        : {
            username: d.username,
            accountName: d.accountName ?? '',
            active: d.active,
          }),
      sectionId: d.sectionId,
      perms: toPerms(d.permissions),
      applyCommissions: d.applyCommissions !== false,
      applyTargets: d.applyTargets !== false,
      salesmanIds: (d.allowedSalesmen ?? []).map(s => s.id),
      creditAccounts: d.creditAccounts ?? [],
    }));
    setFormReady(true);
  }, [detailQ.data, sourceId, isNew]);

  // لقطة أولية لاكتشاف التعديلات غير المحفوظة
  useEffect(() => {
    if (formReady && snapshot.current == null) snapshot.current = JSON.stringify(form);
  }, [formReady, form]);
  const dirty = formReady && snapshot.current != null && snapshot.current !== JSON.stringify(form);

  const selectedSection = sections.find(s => s.id === form.sectionId);
  const sectionHasCashBox = (selectedSection?.cashBoxCount ?? 0) > 0;
  const enabledCount = ALL_BOOL_KEYS.filter(k => form.perms[k]).length;

  const errors = useMemo(() => {
    const e: Partial<Record<'username' | 'password' | 'sectionId' | 'limits', string>> = {};
    const u = form.username.trim();
    if (!u) e.username = 'اسم المستخدم مطلوب';
    else if (isNew && u.length < 2) e.username = 'حرفان على الأقل';
    else if (cashiers.some(c => c.id !== editingId && c.username.trim().toLowerCase() === u.toLowerCase())) {
      e.username = 'اسم المستخدم مستخدم لكاشير آخر';
    }
    if (isNew && !form.password.trim()) e.password = 'كلمة المرور مطلوبة للكاشير الجديد';
    else if (form.password.trim() && form.password.trim().length < 4) e.password = '4 خانات على الأقل';
    if (isNew && !form.sectionId) e.sectionId = 'اختر قسماً للكاشير';
    const { itemDiscountLimit, userDiscountLimit, numberOfHoldReceipts } = form.perms;
    if (itemDiscountLimit < 0 || userDiscountLimit < 0 || numberOfHoldReceipts < 0) e.limits = 'القيم لا تقبل السالب';
    return e;
  }, [form, cashiers, editingId, isNew]);
  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.username.trim()) throw new Error('اسم المستخدم مطلوب');
      if (isNew && !form.password.trim()) throw new Error('كلمة المرور مطلوبة للكاشير الجديد');
      if (!formReady) throw new Error('انتظر تحميل إعدادات الكاشير قبل الحفظ');
      const creditPayload = form.creditAccounts.map(a => ({
        edariSeq: a.edariSeq,
        num: a.num,
        name: a.name,
        balance: a.balance ?? 0,
      }));
      if (isNew) {
        return api.createCashier({
          username: form.username.trim(),
          password: form.password,
          accountName: form.accountName || null,
          permissions: form.perms,
          sectionId: form.sectionId,
          active: form.active,
          applyCommissions: form.applyCommissions,
          applyTargets: form.applyTargets,
          allowedSalesmanIds: form.salesmanIds,
          creditAccounts: creditPayload,
        });
      }
      return api.updateCashier(editingId, {
        username: form.username.trim(),
        password: form.password.trim() || null,
        accountName: form.accountName || null,
        permissions: form.perms,
        active: form.active,
        sectionId: form.sectionId,
        // صندوق البطاقات عام من الإعدادات — أي صندوق شخصي قديم يُمسح عند الحفظ.
        cardMasterAccount: null,
        cardMasterAccountBank: null,
        clearCardMasterAccount: true,
        applyCommissions: form.applyCommissions,
        applyTargets: form.applyTargets,
        allowedSalesmanIds: form.salesmanIds,
        creditAccounts: creditPayload,
      });
    },
    onSuccess: () => {
      // ['cashier'] يطابق استعلام التفاصيل ['cashier', id] — بدونه تُفتح النافذة بصلاحيات قديمة.
      qc.invalidateQueries({ queryKey: ['cashiers'] });
      qc.invalidateQueries({ queryKey: ['cashier'] });
      toast.success(isNew ? `تمت إضافة الكاشير ${form.username.trim()}` : 'تم حفظ إعدادات الكاشير');
      onClose();
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const saveTemplate = useMutation({
    mutationFn: () => {
      if (!templateId) throw new Error('اختر قالباً أولاً');
      return api.updatePermissions(templateId, form.perms);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permissions'] });
      toast.success('تم تحديث قالب الصلاحيات');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل حفظ القالب'),
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setSubmitted(true);
    if (hasErrors) {
      if (errors.username || errors.password || errors.sectionId) setTab('account');
      else if (errors.limits) setTab('perms');
      toast.error('راجع الحقول المظللة بالأحمر');
      return;
    }
    if (!save.isPending) save.mutate();
  }

  async function requestClose() {
    // لا إغلاق أثناء الحفظ — نجاح الحفظ يغلق النافذة بنفسه
    if (save.isPending) return;
    if (dirty) {
      const ok = await confirm({
        title: 'تجاهل التعديلات؟',
        message: 'لديك تعديلات غير محفوظة على هذا الكاشير.',
        confirmLabel: 'تجاهل وإغلاق',
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  async function applyTemplate(id: number) {
    setTemplateId(id);
    const t = templatesQ.data?.find(x => x.id === id);
    if (!t) return;
    setForm(f => ({ ...f, perms: toPerms(t as unknown as CashierDetailDto['permissions']) }));
    toast.info(`طُبّق القالب «${t.name || `#${t.id}`}» — احفظ لتثبيته`);
  }

  function setGroup(keys: BoolPermKey[], v: boolean) {
    setForm(f => {
      const next = { ...f.perms };
      for (const k of keys) (next as Record<string, unknown>)[k] = v;
      return { ...f, perms: next };
    });
  }

  function applyRolePreset(preset: 'full' | 'standard' | 'strict') {
    if (preset === 'full') {
      const next = { ...emptyPerms() };
      for (const k of ALL_BOOL_KEYS) next[k] = true;
      setForm(f => ({ ...f, perms: next }));
      toast.info('طُبّق نمط «كاشير كامل الصلاحيات»');
    } else if (preset === 'standard') {
      setForm(f => ({
        ...f,
        perms: {
          ...emptyPerms(),
          makeDiscount: true,
          viewReceipts: true,
          cashReport: true,
          deleteItem: true,
          discardReceipt: true,
          allowSalesReturn: true,
          allowSearchArticles: true,
          printSalesmanOnReceipt: true,
        },
      }));
      toast.info('طُبّق نمط «كاشير قياسي»');
    } else {
      setForm(f => ({
        ...f,
        perms: {
          ...emptyPerms(),
          makeDiscount: false,
          deleteItem: false,
          discardReceipt: false,
          allowEditReceipt: false,
          allowPriceChange: false,
          allowGiftReceipt: false,
          invoiceBoundReturn: true,
          allowSalesReturn: true,
          allowSearchArticles: true,
          viewReceipts: true,
          cashReport: true,
        },
      }));
      toast.info('طُبّق نمط «بيع رقابي مشدّد (بلا حذف/إلغاء/خصم)»');
    }
  }

  const loading = sourceId != null && !formReady && !detailQ.isError;
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);
  const accountErrCount = submitted ? [errors.username, errors.password, errors.sectionId].filter(Boolean).length : 0;

  // يمنع Enter داخل أدوات الاختيار من إرسال النموذج
  const stopEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  return (
    <Modal
      open
      size="xl"
      icon={<IconKeyboard size={18} />}
      title={isNew ? (copyFromId ? 'كاشير جديد بنسخ الإعدادات' : 'كاشير جديد') : `تعديل ${listRow?.accountName || form.username || 'الكاشير'}`}
      subtitle={
        isNew
          ? copyFromId
            ? `الصلاحيات والقسم والبائعون منسوخة من ${cashiers.find(c => c.id === copyFromId)?.username ?? 'كاشير آخر'}`
            : 'حساب دخول جديد إلى نقطة البيع'
          : <span dir="ltr" className="font-mono">@{form.username}</span>
      }
      onClose={() => void requestClose()}
      footer={
        <>
          <span className="hidden items-center gap-1.5 text-[11.5px] text-slate-500 sm:flex">
            <Kbd>Enter</Kbd> حفظ <span className="text-slate-300">·</span> <Kbd>Esc</Kbd> إغلاق
            {dirty && <span className="ms-2 inline-flex items-center gap-1 font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />تعديلات غير محفوظة</span>}
          </span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={() => void requestClose()}>إلغاء</Btn>
            <Btn type="submit" form="cashier-editor-form" loading={save.isPending} disabled={!formReady}>
              {isNew ? 'إضافة الكاشير' : 'حفظ التعديلات'}
            </Btn>
          </div>
        </>
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-72" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        </div>
      ) : detailQ.isError && sourceId != null ? (
        <Alert type="error" title="تعذّر تحميل إعدادات الكاشير">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{detailQ.error instanceof Error ? detailQ.error.message : 'خطأ غير متوقع'}</span>
            <Btn size="xs" variant="secondary" onClick={() => detailQ.refetch()}>إعادة المحاولة</Btn>
          </div>
        </Alert>
      ) : (
        <form id="cashier-editor-form" onSubmit={submit} noValidate className="space-y-4">
          <Tabs<EditorTab>
            value={tab}
            onChange={setTab}
            items={[
              {
                id: 'account',
                label: accountErrCount ? <span className="text-red-600">الحساب والقسم</span> : 'الحساب والقسم',
                icon: <IconLock size={14} />,
              },
              { id: 'perms', label: 'صلاحيات نقطة البيع', icon: <IconShield size={14} />, count: enabledCount },
              { id: 'sales', label: 'البائعون والآجل', icon: <IconUsers size={14} />, count: form.salesmanIds.length + form.creditAccounts.length || undefined },
            ]}
          />

          {tab === 'account' && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Section title="بيانات الدخول" icon={<IconLock size={15} />}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Field label="اسم المستخدم *" hint={err('username') ? undefined : 'يُكتب في شاشة الدخول لنقطة البيع'}>
                      <Input
                        value={form.username}
                        onChange={e => set('username', e.target.value)}
                        dir="ltr"
                        autoComplete="off"
                        className={err('username') ? '!border-red-400 focus:!ring-red-500/15' : ''}
                        autoFocus
                      />
                    </Field>
                    <ErrorText>{err('username')}</ErrorText>
                  </div>
                  <div>
                    <Field
                      label={isNew ? 'كلمة المرور / PIN *' : 'كلمة مرور جديدة'}
                      hint={err('password') ? undefined : isNew ? '4 خانات على الأقل' : 'اتركها فارغة للإبقاء على الحالية'}
                    >
                      <div className="flex gap-1.5">
                        <div className="relative min-w-0 flex-1">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            value={form.password}
                            onChange={e => set('password', e.target.value)}
                            autoComplete="new-password"
                            dir="ltr"
                            className={`pe-9 font-mono ${err('password') ? '!border-red-400 focus:!ring-red-500/15' : ''}`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(v => !v)}
                            className="absolute inset-y-0 end-1 my-auto flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title={showPassword ? 'إخفاء' : 'إظهار'}
                            aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                          >
                            {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                          </button>
                        </div>
                        <Btn
                          variant="secondary"
                          className="!h-9 !w-9 !px-0"
                          title="توليد رمز عشوائي من 6 أرقام"
                          aria-label="توليد كلمة مرور"
                          onClick={() => {
                            set('password', randomPin(6));
                            setShowPassword(true);
                          }}
                        >
                          <IconDice size={15} />
                        </Btn>
                        {form.password && <CopyButton value={form.password} what="كلمة المرور" size="sm" />}
                      </div>
                    </Field>
                    <ErrorText>{err('password')}</ErrorText>
                  </div>
                  <Field label="الاسم الظاهر" hint="يظهر في التقارير بدل اسم المستخدم">
                    <Input value={form.accountName} onChange={e => set('accountName', e.target.value)} placeholder="اختياري" />
                  </Field>
                  <div>
                    <Field label={isNew ? 'القسم *' : 'القسم'}>
                      <Select
                        value={form.sectionId}
                        onChange={e => set('sectionId', Number(e.target.value))}
                        className={err('sectionId') ? '!border-red-400' : ''}
                      >
                        <option value={0}>— اختر قسماً —</option>
                        {sections.map(s => (
                          <option key={s.id} value={s.id}>
                            {(s.cashBoxCount ?? 0) > 0 ? s.name : `${s.name} — بلا صندوق`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <ErrorText>{err('sectionId')}</ErrorText>
                  </div>
                </div>
                {form.sectionId > 0 && !sectionHasCashBox && (
                  <div className="mt-4">
                    <Alert type="warning" title="القسم بلا صندوق">
                      سيُرفض دخول نقطة البيع حتى تربط صندوقاً بهذا القسم من{' '}
                      <Link to="/sections" className="font-bold underline">الأقسام</Link>.
                    </Alert>
                  </div>
                )}
              </Section>

              <div className="space-y-4">
                <Section title="الحالة">
                  <Switch
                    checked={form.active}
                    onChange={v => set('active', v)}
                    label={form.active ? 'الحساب نشط' : 'الحساب معطّل'}
                    description="الحساب المعطّل لا يستطيع الدخول إلى نقطة البيع."
                  />
                </Section>
                <Section title="العمولات والأهداف">
                  <div className="space-y-3">
                    <Switch
                      checked={form.applyCommissions}
                      onChange={v => set('applyCommissions', v)}
                      label="تطبيق العمولات"
                      description="تُحسب عمولات البائعين على مبيعات هذا الكاشير."
                    />
                    <Switch
                      checked={form.applyTargets}
                      onChange={v => set('applyTargets', v)}
                      label="تطبيق الأهداف"
                      description="تدخل مبيعات هذا الكاشير في أهداف البائعين."
                    />
                  </div>
                </Section>
              </div>
            </div>
          )}

          {tab === 'perms' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="text-[12.5px] text-slate-600">
                  مفعّل <b className="num text-header">{formatNum(enabledCount)}</b> من <span className="num">{formatNum(ALL_BOOL_KEYS.length)}</span> صلاحية
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(templatesQ.data?.length ?? 0) > 0 && (
                    <Select value={templateId} className="!w-56" onChange={e => void applyTemplate(Number(e.target.value))}>
                      <option value={0}>تطبيق قالب جاهز…</option>
                      {templatesQ.data!.map(t => (
                        <option key={t.id} value={t.id}>{t.name || `قالب #${t.id}`}</option>
                      ))}
                    </Select>
                  )}
                  {templateId > 0 && (
                    <Btn
                      size="sm"
                      variant="secondary"
                      loading={saveTemplate.isPending}
                      title="يحدّث القالب لكل من يستخدمه"
                      onClick={async () => {
                        const name = templatesQ.data?.find(t => t.id === templateId)?.name || `#${templateId}`;
                        const ok = await confirm({
                          title: `تحديث القالب «${name}»؟`,
                          message: 'ستُحفظ الصلاحيات الحالية على القالب نفسه.',
                          confirmLabel: 'حفظ على القالب',
                        });
                        if (ok) saveTemplate.mutate();
                      }}
                    >
                      حفظ على القالب
                    </Btn>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => setGroup(ALL_BOOL_KEYS, true)}>تفعيل الكل</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setGroup(ALL_BOOL_KEYS, false)}>إيقاف الكل</Btn>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="font-bold text-slate-500">أنماط سريعة:</span>
                  <Btn size="xs" variant="secondary" onClick={() => applyRolePreset('standard')}>كاشير قياسي</Btn>
                  <Btn size="xs" variant="secondary" onClick={() => applyRolePreset('strict')}>بيع رقابي مشدّد</Btn>
                  <Btn size="xs" variant="secondary" onClick={() => applyRolePreset('full')}>كامل الصلاحيات</Btn>
                </div>
                <div className="w-56 max-w-full">
                  <Input
                    value={permQuery}
                    onChange={e => setPermQuery(e.target.value)}
                    placeholder="بحث في الصلاحيات…"
                    className="!h-8 text-[12px]"
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {PERM_GROUPS.map(g => {
                  const q = permQuery.trim().toLowerCase();
                  const visibleKeys = q
                    ? g.keys.filter(k => k.label.toLowerCase().includes(q) || k.desc.toLowerCase().includes(q))
                    : g.keys;
                  if (!visibleKeys.length) return null;
                  const keys = g.keys.map(k => k.key);
                  const on = keys.filter(k => form.perms[k]).length;
                  const all = on === keys.length;
                  return (
                    <Section
                      key={g.title}
                      title={g.title}
                      hint={<span className="num">{formatNum(on)} / {formatNum(keys.length)} مفعّل</span>}
                      actions={
                        <Btn size="xs" variant={all ? 'ghost' : 'soft'} onClick={() => setGroup(keys, !all)}>
                          {all ? 'إلغاء الكل' : 'تحديد الكل'}
                        </Btn>
                      }
                    >
                      <div className="-my-1 divide-y divide-slate-100">
                        {visibleKeys.map(f => (
                          <div key={f.key} className="py-2">
                            <Switch
                              checked={Boolean(form.perms[f.key])}
                              onChange={v => setPerm(f.key, v)}
                              label={f.label}
                              description={f.desc}
                            />
                          </div>
                        ))}
                      </div>
                    </Section>
                  );
                })}
              </div>

              <Section title="الحدود" hint="0 يعني بلا خصم مسموح" icon={<IconWallet size={15} />}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="حد خصم البند" hint="أقصى خصم على صنف واحد">
                    <NumberDraftInput min={0} emptyValue={0} className="num" value={form.perms.itemDiscountLimit} onValueChange={n => setPerm('itemDiscountLimit', n)} />
                  </Field>
                  <Field label="حد خصم الفاتورة" hint="أقصى خصم على إجمالي الفاتورة">
                    <NumberDraftInput min={0} emptyValue={0} className="num" value={form.perms.userDiscountLimit} onValueChange={n => setPerm('userDiscountLimit', n)} />
                  </Field>
                  <Field label="عدد الفواتير المعلّقة" hint="فواتير يمكن تعليقها في الوقت نفسه">
                    <NumberDraftInput min={0} integer emptyValue={0} className="num" value={form.perms.numberOfHoldReceipts} onValueChange={n => setPerm('numberOfHoldReceipts', n)} />
                  </Field>
                </div>
                <ErrorText>{err('limits')}</ErrorText>
              </Section>
            </div>
          )}

          {tab === 'sales' && (
            <div className="grid gap-4 lg:grid-cols-2" onKeyDown={stopEnter}>
              <Section
                title="البائعون الظاهرون للكاشير"
                hint={form.salesmanIds.length ? `${formatNum(form.salesmanIds.length)} بائع محدد` : 'بلا تحديد = كل البائعين'}
                icon={<IconUsers size={15} />}
              >
                <SalesmanMultiSelect
                  salesmen={salesmenQ.data?.items ?? []}
                  selectedIds={form.salesmanIds}
                  onChange={ids => set('salesmanIds', ids)}
                  emptyLabel="كل البائعين"
                />
              </Section>
              <Section title="حسابات الآجل" hint="الحسابات التي يبيع عليها الكاشير بالآجل" icon={<IconWallet size={15} />}>
                <div className="mb-3">
                  <Alert type="info">
                    صندوق البطاقات (الماستر) عام ويُضبط من <b>الإعدادات ← الصناديق والأداري</b> — فواتير البطاقة تُقيَّد عليه دائماً.
                  </Alert>
                </div>
                <CreditAccountMultiSelect selected={form.creditAccounts} onChange={v => set('creditAccounts', v)} />
              </Section>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
