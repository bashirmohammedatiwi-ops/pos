import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatNum, todayIso } from '@/api/client';
import type { CashierCreditAccountDto, CashierDetailDto, CashierDto, SectionSummaryDto, UpdatePermissionsRequest } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { CreditAccountMultiSelect } from '@/components/CreditAccountMultiSelect';
import { SalesmanMultiSelect } from '@/components/SalesmanMultiSelect';
import { useToast } from '@/components/Toast';
import { Btn, Checkbox, Field, Input, Loading, Modal, Select, Alert } from '@/components/ui';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import {
  EmptyWorkspace,
  FilterChip,
  StatusChip,
} from '@/components/workspace';
import { downloadCsv } from '@/utils/exportCsv';

const CASHIER_FILTERS_KEY = 'fot_admin_cashiers';

function loadCashierFilters() {
  try {
    return JSON.parse(sessionStorage.getItem(CASHIER_FILTERS_KEY) || 'null') as {
      search?: string;
      status?: 'all' | 'active' | 'off';
      sectionFilter?: number;
    } | null;
  } catch {
    return null;
  }
}

const PERM_GROUPS: { title: string; keys: { key: keyof UpdatePermissionsRequest; label: string }[] }[] = [
  {
    title: 'البيع',
    keys: [
      { key: 'allowCreditReceipt', label: 'بيع آجل' },
      { key: 'allowSalesReturn', label: 'مرتجع' },
      { key: 'invoiceBoundReturn', label: 'مردود مربوط بالفاتورة فقط' },
      { key: 'allowGiftReceipt', label: 'هدية' },
      { key: 'allowSearchArticles', label: 'بحث المنتجات' },
      { key: 'allowPriceChange', label: 'تغيير السعر' },
    ],
  },
  {
    title: 'الفاتورة',
    keys: [
      { key: 'makeDiscount', label: 'خصم الفاتورة' },
      { key: 'deleteItem', label: 'حذف بند' },
      { key: 'duplicateItem', label: 'تكرار بند' },
      { key: 'discardReceipt', label: 'إلغاء الفاتورة' },
      { key: 'allowEditReceipt', label: 'تعديل فاتورة' },
      { key: 'viewReceipts', label: 'عرض الفواتير' },
    ],
  },
  {
    title: 'التشغيل',
    keys: [
      { key: 'cashReport', label: 'تقرير الصندوق' },
      { key: 'offlineLogin', label: 'دخول أوفلاين' },
      { key: 'manualTransfer', label: 'ترحيل يدوي' },
    ],
  },
  {
    title: 'البائع',
    keys: [{ key: 'hideSalesmanGroups', label: 'إخفاء مجاميع البائعين — بائع واحد للفاتورة' }],
  },
];

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
    allowPriceChange: false,
    allowSearchArticles: true,
    allowEditReceipt: false,
    manualTransfer: false,
    allowProductDiscount: false,
    hideSalesmanGroups: false,
    invoiceBoundReturn: false,
    itemDiscountLimit: 0,
    userDiscountLimit: 0,
    numberOfHoldReceipts: 3,
  };
}

function permsFromDetail(d: CashierDetailDto): UpdatePermissionsRequest {
  const p = d.permissions;
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
    allowPriceChange: p.allowPriceChange,
    allowSearchArticles: p.allowSearchArticles,
    allowEditReceipt: p.allowEditReceipt,
    manualTransfer: p.manualTransfer ?? false,
    allowProductDiscount: p.allowProductDiscount ?? false,
    hideSalesmanGroups: p.hideSalesmanGroups ?? false,
    invoiceBoundReturn: p.invoiceBoundReturn ?? false,
    itemDiscountLimit: p.itemDiscountLimit,
    userDiscountLimit: p.userDiscountLimit,
    numberOfHoldReceipts: p.numberOfHoldReceipts,
  };
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="mb-3 text-[13px] font-bold text-header">{title}</h4>
      {children}
    </section>
  );
}

/* أعمدة الكاشيرين — DataGrid موحد */
function cashierColumnsBuilder(
  actions: { edit: (c: CashierDto) => void; deactivate: (id: number) => void; reactivate: (id: number) => void },
): GridColumn<CashierDto>[] {
  return [
    { key: 'username', header: 'المستخدم', width: 150, render: c => <span className="font-semibold text-header">{c.username}</span> },
    { key: 'sectionName', header: 'القسم', width: 140, render: c => c.sectionName || '—' },
    { key: 'accountName', header: 'الحساب', width: 140, render: c => c.accountName || '—' },
    { key: 'permissionsName', header: 'الصلاحية', width: 150, render: c => c.permissionsName || '—' },
    { key: 'active', header: 'الحالة', width: 100, align: 'center', render: c => <StatusChip active={c.active} /> },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 280,
      align: 'center',
      sortable: false,
      exportable: false,
      render: c => (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <Link to={`/receipts?cashierId=${c.id}&from=${todayIso()}&to=${todayIso()}`} className="text-[12px] text-brand-600 hover:underline">
            فواتير
          </Link>
          <Link to={`/activity?cashierId=${c.id}`} className="text-[12px] text-brand-600 hover:underline">
            حركات
          </Link>
          <button type="button" className="text-[12px] font-semibold text-brand-600 hover:underline" onClick={() => actions.edit(c)}>تعديل</button>
          {c.active ? (
            <button type="button" className="text-[12px] font-semibold text-red-500 hover:underline" onClick={() => actions.deactivate(c.id)}>تعطيل</button>
          ) : (
            <button type="button" className="text-[12px] font-semibold text-emerald-600 hover:underline" onClick={() => actions.reactivate(c.id)}>تفعيل</button>
          )}
        </div>
      ),
    },
  ];
}

export function CashiersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const highlight = Number(params.get('highlight') || 0) || null;
  const savedFilters = loadCashierFilters();
  const [search, setSearch] = useState(savedFilters?.search ?? '');
  const [status, setStatus] = useState<'all' | 'active' | 'off'>(savedFilters?.status ?? 'all');
  const [sectionFilter, setSectionFilter] = useState(savedFilters?.sectionFilter ?? 0);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accountName, setAccountName] = useState('');
  const [sectionId, setSectionId] = useState(0);
  const [active, setActive] = useState(true);
  const [perms, setPerms] = useState<UpdatePermissionsRequest>(emptyPerms);
  const [applyCommissions, setApplyCommissions] = useState(true);
  const [applyTargets, setApplyTargets] = useState(true);
  const [salesmanIds, setSalesmanIds] = useState<number[]>([]);
  const [creditAccounts, setCreditAccounts] = useState<CashierCreditAccountDto[]>([]);
  const [formReady, setFormReady] = useState(false);
  const loadedFor = useRef<number | 'new' | null>(null);

  const q = useQuery({ queryKey: ['cashiers'], queryFn: () => api.cashiers() });
  const sectionsQ = useQuery({ queryKey: ['sections'], queryFn: () => api.sections(true) });
  const templatesQ = useQuery({ queryKey: ['permissions'], queryFn: api.permissions, staleTime: 120_000 });
  const salesmenQ = useQuery({ queryKey: ['salesmen'], queryFn: () => api.salesmen(true), staleTime: 120_000 });
  const [templateId, setTemplateId] = useState(0);
  const detailQ = useQuery({
    queryKey: ['cashier', editingId],
    queryFn: () => api.cashier(editingId as number),
    enabled: typeof editingId === 'number',
  });

  const items = q.data?.items ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter(c => {
      if (status === 'active' && !c.active) return false;
      if (status === 'off' && c.active) return false;
      if (sectionFilter && c.sectionId !== sectionFilter) return false;
      if (!s) return true;
      return c.username.toLowerCase().includes(s)
        || (c.accountName || '').toLowerCase().includes(s)
        || (c.sectionName || '').toLowerCase().includes(s);
    });
  }, [items, search, status, sectionFilter]);

  useEffect(() => {
    sessionStorage.setItem(CASHIER_FILTERS_KEY, JSON.stringify({ search, status, sectionFilter }));
  }, [search, status, sectionFilter]);

  useEffect(() => {
    if (!highlight) return;
    document.getElementById(`cashier-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, filtered.length]);

  const sections = (sectionsQ.data ?? []) as SectionSummaryDto[];
  const selectedSection = sections.find(s => s.id === sectionId);
  const sectionHasCashBox = (selectedSection?.cashBoxCount ?? 0) > 0;
  const activeCount = items.filter(c => c.active).length;

  function resetFormExtras() {
    setPerms(emptyPerms());
    setTemplateId(0);
    setApplyCommissions(true);
    setApplyTargets(true);
    setSalesmanIds([]);
    setCreditAccounts([]);
  }

  function openNew() {
    loadedFor.current = 'new';
    setFormReady(true);
    setEditingId('new');
    setUsername('');
    setPassword('');
    setAccountName('');
    setSectionId(sections[0]?.id ?? 0);
    setActive(true);
    resetFormExtras();
  }

  function openEdit(c: CashierDto) {
    loadedFor.current = null;
    setFormReady(false);
    setEditingId(c.id);
    setUsername(c.username);
    setPassword('');
    setAccountName(c.accountName ?? '');
    setSectionId(c.sectionId ?? 0);
    setActive(c.active);
    resetFormExtras();
  }

  useEffect(() => {
    const d = detailQ.data;
    if (!d || editingId !== d.id) return;
    if (loadedFor.current === d.id) return;
    loadedFor.current = d.id;
    setUsername(d.username);
    setAccountName(d.accountName ?? '');
    setSectionId(d.sectionId);
    setActive(d.active);
    setPerms(permsFromDetail(d));
    setApplyCommissions(d.applyCommissions !== false);
    setApplyTargets(d.applyTargets !== false);
    setSalesmanIds((d.allowedSalesmen ?? []).map(s => s.id));
    setCreditAccounts(d.creditAccounts ?? []);
    setFormReady(true);
  }, [detailQ.data, editingId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!username.trim()) throw new Error('اسم المستخدم مطلوب');
      if (editingId === 'new' && !password.trim()) throw new Error('كلمة المرور مطلوبة للكاشير الجديد');
      if (typeof editingId === 'number' && !formReady) {
        throw new Error('انتظر تحميل إعدادات الكاشير قبل الحفظ');
      }
      const creditPayload = creditAccounts.map(a => ({
        edariSeq: a.edariSeq,
        num: a.num,
        name: a.name,
        balance: a.balance ?? 0,
      }));
      if (editingId === 'new') {
        return api.createCashier({
          username: username.trim(),
          password,
          accountName: accountName || null,
          permissions: perms,
          sectionId,
          active,
          applyCommissions,
          applyTargets,
          allowedSalesmanIds: salesmanIds,
          creditAccounts: creditPayload,
        });
      }
      if (typeof editingId === 'number') {
        return api.updateCashier(editingId, {
          username: username.trim(),
          password: password.trim() || null,
          accountName: accountName || null,
          permissions: perms,
          active,
          sectionId,
          // صندوق البطاقات عام من الإعدادات — أي صندوق شخصي قديم يُمسح عند الحفظ.
          cardMasterAccount: null,
          cardMasterAccountBank: null,
          clearCardMasterAccount: true,
          applyCommissions,
          applyTargets,
          allowedSalesmanIds: salesmanIds,
          creditAccounts: creditPayload,
        });
      }
    },
    onSuccess: () => {
      // ['cashier'] prefix-matches the detail query ['cashier', id] — without it the
      // edit modal reopens with the stale cached permissions and looks unsaved.
      qc.invalidateQueries({ queryKey: ['cashiers'] });
      qc.invalidateQueries({ queryKey: ['cashier'] });
      setEditingId(null);
      toast.success('تم حفظ الكاشير');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) => api.deactivateCashier(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashiers'] });
      toast.success('تم تعطيل الكاشير');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل'),
  });

  const reactivate = useMutation({
    mutationFn: (id: number) => api.updateCashier(id, { active: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cashiers'] });
      toast.success('تم تفعيل الكاشير');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل التفعيل'),
  });

  const saveTemplate = useMutation({
    mutationFn: () => {
      if (!templateId) throw new Error('اختر قالباً أولاً');
      return api.updatePermissions(templateId, perms);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permissions'] });
      toast.success('تم تحديث قالب الصلاحيات');
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل حفظ القالب'),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ClassicListShell
        filters={
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_auto] lg:items-end">
            <FilterField label="بحث">
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="الاسم أو القسم" />
            </FilterField>
            <FilterField label="القسم">
              <Select value={String(sectionFilter)} onChange={e => setSectionFilter(Number(e.target.value))}>
                <option value="0">— الكل —</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </FilterField>
            <div className="flex flex-wrap items-end gap-2">
              <FilterChip compact active={status === 'all'} onClick={() => setStatus('all')}>الكل</FilterChip>
              <FilterChip compact active={status === 'active'} onClick={() => setStatus('active')}>نشط</FilterChip>
              <FilterChip compact active={status === 'off'} onClick={() => setStatus('off')}>معطّل</FilterChip>
            </div>
          </div>
        }
        header={{
          title: 'الكاشير',
          hint: 'حسابات الدخول إلى نقطة البيع والصلاحيات',
          actions: (
            <>
              <Btn
                size="sm"
                variant="secondary"
                disabled={!filtered.length}
                onClick={() =>
                  downloadCsv(
                    'cashiers.csv',
                    ['المستخدم', 'القسم', 'الحساب', 'الصلاحية', 'الحالة'],
                    filtered.map(c => [
                      c.username,
                      c.sectionName ?? '',
                      c.accountName ?? '',
                      c.permissionsName ?? '',
                      c.active ? 'نشط' : 'معطّل',
                    ]),
                  )
                }
              >
                CSV
              </Btn>
              <Btn size="sm" onClick={openNew}>+ كاشier</Btn>
            </>
          ),
        }}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
        footer={
          <ClassicSummaryFooter
            total={filtered.length}
            items={[
              { label: 'إجمالي', value: formatNum(items.length) },
              { label: 'نشط', value: formatNum(activeCount), accent: true },
              { label: 'معطّل', value: formatNum(items.length - activeCount) },
              { label: 'معروض', value: formatNum(filtered.length) },
            ]}
          />
        }
      >
        {q.isLoading && <Loading />}
        {q.isError && (
          <div className="p-2 text-center text-[11px] text-red-800">
            تعذّر تحميل الكاشير
            <Btn className="mr-2" size="sm" variant="secondary" onClick={() => q.refetch()}>إعادة</Btn>
          </div>
        )}
        {!q.isLoading && !q.data?.items.length && (
          <EmptyWorkspace
            title="لا يوجد كاشير"
            hint="أضف حساب كاشير ليتمكن الجهاز من الدخول إلى نقطة البيع."
            action={<Btn onClick={openNew}>+ كاشير</Btn>}
          />
        )}
        {!!q.data?.items.length && (
          <DataGrid
            embedded
            fillHeight
            columns={cashierColumnsBuilder({ edit: openEdit, deactivate: id => deactivate.mutate(id), reactivate: id => reactivate.mutate(id) })}
            rows={filtered}
            getRowId={c => c.id}
            exportName="الكاشيرين"
            counterLabel="كاشير"
            emptyText="لا نتائج لهذا الفلتر"
            rowTone={c => (highlight === c.id ? 'bg-teal-50' : undefined)}
          />
        )}
      </ClassicListShell>

      {editingId != null && (
        <Modal
          open
          size="xl"
          title={editingId === 'new' ? 'كاشير جديد' : `إعدادات ${username || 'الكاشير'}`}
          onClose={() => setEditingId(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Btn variant="secondary" onClick={() => setEditingId(null)}>إلغاء</Btn>
              <Btn
                onClick={() => save.mutate()}
                disabled={save.isPending || (typeof editingId === 'number' && !formReady)}
              >
                {save.isPending ? 'جاري الحفظ…' : 'حفظ'}
              </Btn>
            </div>
          }
        >
          {typeof editingId === 'number' && !formReady && !detailQ.isError ? (
            <Loading />
          ) : typeof editingId === 'number' && detailQ.isError ? (
            <div className="p-4 text-center text-[13px] text-red-700">
              تعذّر تحميل إعدادات الكاشير
              <Btn className="mr-2" size="sm" variant="secondary" onClick={() => detailQ.refetch()}>إعادة</Btn>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <SettingsSection title="الهوية">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="اسم المستخدم">
                    <Input value={username} onChange={e => setUsername(e.target.value)} />
                  </Field>
                  <Field label={editingId === 'new' ? 'كلمة المرور / PIN' : 'كلمة مرور جديدة (اختياري)'}>
                    <Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                  </Field>
                  <Field label="الاسم الظاهر">
                    <Input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="اختياري" />
                  </Field>
                  <Field label="القسم">
                    <Select value={sectionId} onChange={e => setSectionId(Number(e.target.value))}>
                      <option value={0}>— اختر قسماً —</option>
                      {sections.map(s => (
                        <option key={s.id} value={s.id}>
                          {(s.cashBoxCount ?? 0) > 0 ? s.name : `${s.name} — بلا صندوق`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {sectionId > 0 && !sectionHasCashBox && (
                  <div className="mt-3">
                    <Alert type="warning">
                      هذا القسم بلا صندوق. دخول نقطة البيع سيُرفض حتى تربط صندوقاً من{' '}
                      <Link to="/sections" className="font-bold underline">الأقسام</Link>.
                    </Alert>
                  </div>
                )}
                <div className="mt-3">
                  <Checkbox label="الحساب نشط ويمكنه الدخول لنقطة البيع" checked={active} onChange={setActive} />
                </div>
              </SettingsSection>

              <SettingsSection title="العمولات والأهداف">
                <div className="space-y-2">
                  <Checkbox label="تطبيق العمولات على مبيعات هذا الكاشير" checked={applyCommissions} onChange={setApplyCommissions} />
                  <Checkbox label="تطبيق الأهداف على مبيعات هذا الكاشير" checked={applyTargets} onChange={setApplyTargets} />
                </div>
              </SettingsSection>

              <SettingsSection title="البائعون الظاهرون للكاشير">
                <SalesmanMultiSelect
                  salesmen={salesmenQ.data?.items ?? []}
                  selectedIds={salesmanIds}
                  onChange={setSalesmanIds}
                  emptyLabel="كل البائعين"
                />
              </SettingsSection>

              <SettingsSection title="الحسابات">
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
                  صندوق البطاقات (الماستر) عام الآن ويُثبَّت من <b>الإعدادات ← الصناديق والأداري</b> — فواتير البطاقة تُقيَّد عليه دائماً وليس على صندوق الكاشير.
                </p>
                <div className="mb-1.5 text-[12px] font-semibold text-slate-600">حسابات الآجل لهذا الكاشير</div>
                <CreditAccountMultiSelect selected={creditAccounts} onChange={setCreditAccounts} />
              </SettingsSection>

              <div className="lg:col-span-2">
                <SettingsSection title="صلاحيات نقطة البيع">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    {(templatesQ.data?.length ?? 0) > 0 && (
                      <Select
                        value={templateId}
                        className="!w-52"
                        onChange={e => {
                          const id = Number(e.target.value);
                          setTemplateId(id);
                          const t = templatesQ.data?.find(x => x.id === id);
                          if (!t) return;
                          setPerms({
                            makeDiscount: t.makeDiscount,
                            viewReceipts: t.viewReceipts,
                            cashReport: t.cashReport,
                            deleteItem: t.deleteItem,
                            duplicateItem: t.duplicateItem,
                            offlineLogin: t.offlineLogin,
                            discardReceipt: t.discardReceipt,
                            allowCreditReceipt: t.allowCreditReceipt,
                            allowSalesReturn: t.allowSalesReturn,
                            allowGiftReceipt: t.allowGiftReceipt,
                            allowPriceChange: t.allowPriceChange,
                            allowSearchArticles: t.allowSearchArticles,
                            allowEditReceipt: t.allowEditReceipt,
                            manualTransfer: t.manualTransfer ?? false,
                            allowProductDiscount: t.allowProductDiscount ?? false,
                            hideSalesmanGroups: t.hideSalesmanGroups ?? false,
                            invoiceBoundReturn: t.invoiceBoundReturn ?? false,
                            itemDiscountLimit: t.itemDiscountLimit,
                            userDiscountLimit: t.userDiscountLimit,
                            numberOfHoldReceipts: t.numberOfHoldReceipts,
                          });
                        }}
                      >
                        <option value={0}>تطبيق قالب جاهز…</option>
                        {templatesQ.data!.map(t => (
                          <option key={t.id} value={t.id}>{t.name || `قالب #${t.id}`}</option>
                        ))}
                      </Select>
                    )}
                    {templateId > 0 && (
                      <Btn size="sm" variant="secondary" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate()}>
                        {saveTemplate.isPending ? '…' : 'حفظ على القالب'}
                      </Btn>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {PERM_GROUPS.map(g => (
                      <div key={g.title} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{g.title}</div>
                        <div className="space-y-1.5">
                          {g.keys.map(f => (
                            <Checkbox
                              key={f.key}
                              label={f.label}
                              checked={Boolean(perms[f.key])}
                              onChange={v => setPerms(p => ({ ...p, [f.key]: v }))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label="حد خصم البند">
                      <Input type="number" value={perms.itemDiscountLimit} onChange={e => setPerms(p => ({ ...p, itemDiscountLimit: Number(e.target.value) || 0 }))} />
                    </Field>
                    <Field label="حد خصم الفاتورة">
                      <Input type="number" value={perms.userDiscountLimit} onChange={e => setPerms(p => ({ ...p, userDiscountLimit: Number(e.target.value) || 0 }))} />
                    </Field>
                    <Field label="عدد الفواتير المعلّقة">
                      <Input type="number" value={perms.numberOfHoldReceipts} onChange={e => setPerms(p => ({ ...p, numberOfHoldReceipts: Number(e.target.value) || 0 }))} />
                    </Field>
                  </div>
                </SettingsSection>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
