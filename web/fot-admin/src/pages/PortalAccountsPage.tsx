import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, formatDate, formatDateOnly, formatNum } from '@/api/client';
import type { PortalManagerAccountDto, PortalPublishResult, PortalSellerAccountDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { Btn, Input, Modal } from '@/components/ui';
import { ClassicListShell, ClassicSummaryFooter, FilterField } from '@/components/classic/ClassicListLayout';
import { FilterChip, MetricBar, SegmentedTabs, SoftChip, StatusChip } from '@/components/workspace';
import { copyText } from '@/lib/clipboard';
import { downloadCsv } from '@/utils/exportCsv';

type Tab = 'sellers' | 'managers';
type SellerFilter = 'all' | 'none' | 'active' | 'stopped';
type Confirm = { title: string; body: string; ok: string; run: () => void } | null;

function sellerStatus(s: PortalSellerAccountDto) {
  if (!s.hasAccount) return 'بدون حساب';
  return s.isActive ? 'نشط' : 'متوقف';
}

function printAccessCard(kind: 'بائع' | 'مدير', name: string, login: string, secret: string) {
  const w = window.open('', '_blank', 'width=420,height=560');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>بطاقة الدخول</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;margin:28px;color:#0f172a}
  .card{border:1px solid #cbd5e1;border-radius:16px;padding:22px}
  .k{font-size:11px;letter-spacing:.2em;color:#0f766e;font-weight:800}
  h1{margin:8px 0 4px;font-size:22px}
  .meta{color:#64748b;font-size:13px;font-weight:700}
  .pin{margin:22px 0 8px;padding:16px;border-radius:12px;background:#fffbeb;text-align:center;font-size:32px;letter-spacing:.28em;font-weight:800;font-family:Consolas,monospace}
  .hint{font-size:12px;color:#64748b;line-height:1.7}
</style></head><body>
<div class="card">
  <div class="k">FOT ${kind}</div>
  <h1>${name}</h1>
  <div class="meta">دخول: ${login}</div>
  <div class="pin">${secret}</div>
  <p class="hint">احتفظ بالرمز. الدخول من ويب ${kind === 'بائع' ? 'البائعين' : 'المدراء'} فقط. لا يظهر هذا الرمز في التطبيق للموظف.</p>
</div>
<script>window.onload=()=>{window.print();}</script>
</body></html>`);
  w.document.close();
}

function SecretBox({ value, onCopy }: { value?: string | null; onCopy: (v: string) => void }) {
  if (!value) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-[13px] font-bold text-slate-400">
        لا يوجد رمز ظاهر — أدخل الرمز يدوياً عند الإنشاء أو التغيير
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onCopy(value)}
      className="block w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-center hover:bg-amber-100"
      title="نسخ"
    >
      <p className="text-[10px] font-extrabold tracking-[0.2em] text-amber-800">الرمز الظاهر للإدارة</p>
      <p className="mt-1 font-mono text-[28px] font-extrabold tracking-[0.22em] text-amber-950">{value}</p>
      <p className="mt-1 text-[11px] font-bold text-amber-800">انقر للنسخ</p>
    </button>
  );
}

export function PortalAccountsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('sellers');
  const [search, setSearch] = useState('');
  const [mgrSearch, setMgrSearch] = useState('');
  const [filter, setFilter] = useState<SellerFilter>('all');
  const [selectedSellerId, setSelectedSellerId] = useState<number | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [resetPin, setResetPin] = useState('');
  const [editName, setEditName] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [freshSellers, setFreshSellers] = useState<Set<number>>(new Set());
  const [freshManagers, setFreshManagers] = useState<Set<number>>(new Set());

  const sellersQ = useQuery({ queryKey: ['portal-sellers'], queryFn: api.portalSellers });
  const managersQ = useQuery({ queryKey: ['portal-managers'], queryFn: api.portalManagers });
  const webQ = useQuery({
    queryKey: ['portal-web-status'],
    queryFn: api.portalWebStatus,
    refetchInterval: 20_000,
    retry: 1,
  });

  function afterPublish(res: PortalPublishResult) {
    putSeller(res.account);
    markSeller(res.account.salesmanId);
    void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
    void qc.invalidateQueries({ queryKey: ['portal-web-status'] });
    if (res.savedOnShop && res.visibleOnWeb) {
      toast.success(`نُشر على الويب — ${res.account.name}${res.account.pinDisplay ? ` · ${res.account.pinDisplay}` : ''}`);
    } else if (res.savedOnShop) {
      toast.success(`حُفظ في نقطة البيع — ${res.account.name}`);
      toast.error(res.message);
    } else {
      toast.error(res.message);
    }
    if (res.account.pinDisplay) void copySecret(res.account.pinDisplay);
  }

  async function copySecret(value: string) {
    try {
      await copyText(value);
      toast.success('تم نسخ الرمز');
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  function markSeller(id: number) {
    setFreshSellers(prev => new Set(prev).add(id));
    setSelectedSellerId(id);
  }
  function markManager(id: number) {
    setFreshManagers(prev => new Set(prev).add(id));
    setSelectedManagerId(id);
  }

  function putSeller(row: PortalSellerAccountDto) {
    qc.setQueryData<PortalSellerAccountDto[]>(['portal-sellers'], old =>
      old ? old.map(s => (s.salesmanId === row.salesmanId ? row : s)) : [row]);
  }
  function putManager(row: PortalManagerAccountDto) {
    qc.setQueryData<PortalManagerAccountDto[]>(['portal-managers'], old =>
      old ? old.map(m => (m.id === row.id ? row : m)) : [row]);
  }

  const issue = useMutation({
    mutationFn: async (id: number) => {
      try {
        return await api.publishSellerToWeb(id);
      } catch {
        const account = await api.issueSellerPin(id);
        return {
          account,
          savedOnShop: true,
          visibleOnWeb: false,
          message: 'حُفظ في نقطة البيع — حدّث خادم نقطة البيع لفحص الويب',
          webUrl: 'http://187.124.23.65:4701',
        } satisfies PortalPublishResult;
      }
    },
    onSuccess: afterPublish,
    onError: (e: Error) => toast.error(e.message),
  });
  const issueMissing = useMutation({
    mutationFn: api.issueMissingSellerPins,
    onSuccess: res => {
      qc.setQueryData(['portal-sellers'], res.sellers);
      toast.success(res.issued > 0
        ? `وُلّد ${formatNum(res.issued)} حساباً وحُفظت على سيرفر نقطة البيع`
        : 'كل البائعين لديهم حساب على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
      void qc.invalidateQueries({ queryKey: ['portal-web-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setSeller = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setSellerPortalActive(id, active),
    onSuccess: row => {
      putSeller(row);
      toast.success(row.isActive ? 'تم تفعيل الحساب على السيرفر' : 'تم إيقاف الحساب على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
      void qc.invalidateQueries({ queryKey: ['portal-web-status'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const createMgr = useMutation({
    mutationFn: () => api.createPortalManager(username, displayName, managerPin),
    onSuccess: row => {
      setUsername('');
      setDisplayName('');
      setManagerPin('');
      qc.setQueryData<PortalManagerAccountDto[]>(['portal-managers'], old => [row, ...(old ?? [])]);
      markManager(row.id);
      setEditName(row.displayName);
      toast.success(`حُفظ ورُفع للويب — ${row.username} · ${row.passwordDisplay}`);
      if (row.passwordDisplay) void copySecret(row.passwordDisplay);
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetMgr = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => api.resetPortalManager(id, password),
    onSuccess: row => {
      putManager(row);
      markManager(row.id);
      setResetPin('');
      toast.success(`حُفظ ورُفع للويب — رمز ${row.username}: ${row.passwordDisplay}`);
      if (row.passwordDisplay) void copySecret(row.passwordDisplay);
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const renameMgr = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.updatePortalManager(id, name),
    onSuccess: row => {
      putManager(row);
      toast.success('تم تحديث الاسم على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setMgr = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setPortalManagerActive(id, active),
    onSuccess: row => {
      putManager(row);
      toast.success(row.isActive ? 'تم تفعيل المدير على السيرفر' : 'تم إيقاف المدير على السيرفر');
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allSellers = sellersQ.data ?? [];
  const sellers = useMemo(() => {
    const q = search.trim();
    return allSellers.filter(s => {
      if (filter === 'none' && s.hasAccount) return false;
      if (filter === 'active' && !(s.hasAccount && s.isActive)) return false;
      if (filter === 'stopped' && !(s.hasAccount && !s.isActive)) return false;
      if (!q) return true;
      return s.name.includes(q) || String(s.salesmanId).includes(q) || (s.pinDisplay ?? '').includes(q);
    });
  }, [allSellers, search, filter]);

  const managers = managersQ.data ?? [];
  const filteredManagers = useMemo(() => {
    const q = mgrSearch.trim();
    if (!q) return managers;
    return managers.filter(m => m.username.includes(q) || m.displayName.includes(q) || (m.passwordDisplay ?? '').includes(q));
  }, [managers, mgrSearch]);

  const withAccount = allSellers.filter(s => s.hasAccount).length;
  const activeCount = allSellers.filter(s => s.hasAccount && s.isActive).length;
  const withoutAccount = allSellers.length - withAccount;
  const selectedSeller = sellers.find(s => s.salesmanId === selectedSellerId) ?? allSellers.find(s => s.salesmanId === selectedSellerId) ?? null;
  const selectedManager = filteredManagers.find(m => m.id === selectedManagerId) ?? managers.find(m => m.id === selectedManagerId) ?? null;

  function askIssue(s: PortalSellerAccountDto) {
    if (!s.hasAccount) {
      issue.mutate(s.salesmanId);
      return;
    }
    setConfirm({
      title: `إعادة رمز ${s.name}`,
      body: 'سيُحفظ رمز جديد في نقطة البيع ويُفحص ظهوره على ويب البائعين. الرمز الحالي لن يعمل.',
      ok: 'توليد ونشر',
      run: () => issue.mutate(s.salesmanId),
    });
  }

  function askBulk() {
    setConfirm({
      title: `توليد ${formatNum(withoutAccount)} حساباً`,
      body: 'يُنشأ رمز لكل بائع بلا حساب ويُحفظ مباشرة في قاعدة السيرفر.',
      ok: 'توليد الكل',
      run: () => issueMissing.mutate(),
    });
  }

  const sellerCols: GridColumn<PortalSellerAccountDto>[] = [
    { key: 'salesmanId', header: '#', width: 64, mono: true },
    { key: 'name', header: 'البائع', width: 200, render: s => <span className="font-semibold text-header">{s.name}</span> },
    {
      key: 'pinDisplay',
      header: 'الرمز',
      width: 130,
      sortable: false,
      render: s => s.pinDisplay
        ? <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[13px] font-extrabold tracking-widest text-amber-950">{s.pinDisplay}</span>
        : <span className="text-slate-400">—</span>,
    },
    {
      key: 'hasAccount',
      header: 'الحالة',
      width: 110,
      render: s => s.hasAccount
        ? <StatusChip active={s.isActive} />
        : <SoftChip tone="warn">بدون حساب</SoftChip>,
    },
    {
      key: 'lastLoginAt',
      header: 'آخر دخول',
      width: 150,
      render: s => (s.lastLoginAt ? formatDate(s.lastLoginAt) : '—'),
    },
    {
      key: 'createdAt',
      header: 'أُنشئ',
      width: 120,
      render: s => (s.createdAt ? formatDateOnly(s.createdAt) : '—'),
    },
  ];

  const managerCols: GridColumn<PortalManagerAccountDto>[] = [
    { key: 'username', header: 'اسم الدخول', width: 140, mono: true },
    { key: 'displayName', header: 'الاسم', width: 200, render: m => <span className="font-semibold text-header">{m.displayName}</span> },
    {
      key: 'passwordDisplay',
      header: 'كلمة المرور',
      width: 150,
      sortable: false,
      render: m => m.passwordDisplay
        ? <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[13px] font-extrabold tracking-widest text-amber-950">{m.passwordDisplay}</span>
        : <span className="text-slate-400">—</span>,
    },
    { key: 'isActive', header: 'الحالة', width: 100, render: m => <StatusChip active={m.isActive} /> },
    { key: 'createdAt', header: 'أُنشئ', width: 130, render: m => formatDateOnly(m.createdAt) },
  ];

  return (
    <ClassicListShell
      banner={
        <div className={`border-b px-4 py-2.5 text-[13px] font-bold leading-6 ${
          webQ.data?.visibleOnWeb
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : webQ.data?.savedOnShop
              ? 'border-amber-200 bg-amber-50 text-amber-950'
              : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}>
          {webQ.isLoading
            ? 'جاري فحص وصول الحسابات إلى ويب البائعين…'
            : webQ.data
              ? `${webQ.data.visibleOnWeb ? 'الويب متصل' : 'الويب لا يصل للمحل'} — ${webQ.data.message} · محفوظ في نقطة البيع: ${formatNum(webQ.data.sellerAccounts)} حساباً`
              : 'توليد الرمز يحفظه في نقطة البيع ثم يتحقق من ظهوره على ويب البائعين.'}
          {webQ.data?.webUrl ? (
            <a className="ms-2 underline" href={webQ.data.webUrl} target="_blank" rel="noreferrer">فتح ويب البائعين</a>
          ) : null}
          <a className="ms-2 underline" href="http://187.124.23.65:4703" target="_blank" rel="noreferrer">فتح ويب المدراء</a>
        </div>
      }
      filters={
        <div className="space-y-3">
          <MetricBar
            items={[
              { label: 'بحساب ويب', value: formatNum(withAccount), tone: 'brand', hint: `من ${formatNum(allSellers.length)} بائعاً` },
              { label: 'نشط', value: formatNum(activeCount), tone: 'ok', hint: 'يمكنه الدخول الآن' },
              { label: 'بدون حساب', value: formatNum(withoutAccount), tone: withoutAccount ? 'warn' : 'default', hint: 'يحتاج توليد رمز' },
              { label: 'مدراء متابعة', value: formatNum(managers.length), hint: 'ويب المدراء' },
            ]}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SegmentedTabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'sellers', label: 'بائعو الويب', count: allSellers.length },
                { id: 'managers', label: 'مدراء المتابعة', count: managers.length },
              ]}
            />
            {tab === 'sellers' ? (
              <div className="flex flex-wrap items-end gap-2">
                <FilterField label="بحث بائع" className="w-[240px]">
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="الاسم أو الرقم أو الرمز" />
                </FilterField>
                <Btn variant="secondary" onClick={() => downloadCsv(
                  'portal-sellers.csv',
                  ['الرقم', 'البائع', 'الحساب', 'الرمز', 'آخر دخول', 'أنشئ'],
                  sellers.map(s => [s.salesmanId, s.name, sellerStatus(s), s.pinDisplay ?? '', s.lastLoginAt ? formatDate(s.lastLoginAt) : '', s.createdAt ? formatDateOnly(s.createdAt) : '']),
                )}>تصدير</Btn>
                <Btn onClick={askBulk} disabled={withoutAccount === 0 || issueMissing.isPending}>
                  توليد من بلا حساب ({formatNum(withoutAccount)})
                </Btn>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <FilterField label="بحث مدير" className="w-[220px]">
                  <Input value={mgrSearch} onChange={e => setMgrSearch(e.target.value)} placeholder="الاسم أو الدخول أو الرمز" />
                </FilterField>
                <Btn variant="secondary" onClick={() => downloadCsv(
                  'portal-managers.csv',
                  ['الدخول', 'الاسم', 'الحالة', 'الرمز', 'أنشئ'],
                  filteredManagers.map(m => [m.username, m.displayName, m.isActive ? 'نشط' : 'متوقف', m.passwordDisplay ?? '', formatDateOnly(m.createdAt)]),
                )}>تصدير</Btn>
              </div>
            )}
          </div>
        </div>
      }
      header={{
        title: tab === 'sellers' ? 'حسابات بائعي الويب' : 'حسابات مدراء المتابعة',
        hint: tab === 'sellers' ? 'اختر بائعاً لتوليد الرمز أو إيقاف الحساب' : 'أنشئ مديراً ثم سلّمه كلمة المرور — يدخل من http://187.124.23.65:4703',
        actions: tab === 'sellers' ? (
          <>
            <FilterChip compact active={filter === 'all'} onClick={() => setFilter('all')}>الكل</FilterChip>
            <FilterChip compact active={filter === 'none'} onClick={() => setFilter('none')}>بدون حساب</FilterChip>
            <FilterChip compact active={filter === 'active'} onClick={() => setFilter('active')}>نشط</FilterChip>
            <FilterChip compact active={filter === 'stopped'} onClick={() => setFilter('stopped')}>متوقف</FilterChip>
          </>
        ) : undefined,
      }}
      onRefresh={() => { void sellersQ.refetch(); void managersQ.refetch(); void webQ.refetch(); }}
      refreshing={sellersQ.isFetching || managersQ.isFetching || webQ.isFetching}
      footer={
        <ClassicSummaryFooter
          total={tab === 'sellers' ? sellers.length : filteredManagers.length}
          items={[
            { label: 'بائعون', value: formatNum(allSellers.length) },
            { label: 'بحساب', value: formatNum(withAccount), accent: true },
            { label: 'نشط', value: formatNum(activeCount) },
            { label: 'بدون حساب', value: formatNum(withoutAccount) },
            { label: 'مدراء', value: formatNum(managers.length) },
          ]}
        />
      }
    >
      {tab === 'sellers' ? (
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="min-h-[240px] min-w-0 flex-1">
            <DataGrid
              rows={sellers}
              columns={sellerCols}
              loading={sellersQ.isLoading}
              getRowId={r => r.salesmanId}
              selectedId={selectedSellerId ?? undefined}
              onRowClick={r => setSelectedSellerId(r.salesmanId)}
              rowTone={r => freshSellers.has(r.salesmanId) ? 'bg-amber-50/80' : !r.hasAccount ? 'bg-slate-50/80' : undefined}
            />
          </div>
          <aside className="flex w-full shrink-0 flex-col gap-3 overflow-auto border-t border-slate-200 bg-slate-50/60 p-4 xl:w-[340px] xl:border-s xl:border-t-0">
            {selectedSeller ? (
              <>
                <div>
                  <p className="text-[11px] font-extrabold tracking-[0.16em] text-brand-700">بائع #{selectedSeller.salesmanId}</p>
                  <h3 className="mt-1 text-[18px] font-extrabold text-header">{selectedSeller.name}</h3>
                  <div className="mt-2">{selectedSeller.hasAccount ? <StatusChip active={selectedSeller.isActive} /> : <SoftChip tone="warn">بدون حساب</SoftChip>}</div>
                </div>
                <SecretBox value={selectedSeller.pinDisplay} onCopy={v => void copySecret(v)} />
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-slate-500">آخر دخول</p>
                    <p className="mt-0.5 font-bold">{selectedSeller.lastLoginAt ? formatDate(selectedSeller.lastLoginAt) : 'لم يدخل'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-slate-500">على السيرفر</p>
                    <p className="mt-0.5 font-bold">{selectedSeller.createdAt ? formatDateOnly(selectedSeller.createdAt) : selectedSeller.hasAccount ? 'محفوظ' : 'غير منشأ'}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Btn onClick={() => askIssue(selectedSeller)} disabled={issue.isPending}>
                    {selectedSeller.hasAccount ? 'إعادة الرمز ونشره على الويب' : 'توليد الحساب ونشره على الويب'}
                  </Btn>
                  {selectedSeller.hasAccount && (
                    <Btn variant="secondary" onClick={() => setSeller.mutate({ id: selectedSeller.salesmanId, active: !selectedSeller.isActive })}>
                      {selectedSeller.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                    </Btn>
                  )}
                  {selectedSeller.pinDisplay && (
                    <Btn variant="ghost" onClick={() => printAccessCard('بائع', selectedSeller.name, String(selectedSeller.salesmanId), selectedSeller.pinDisplay!)}>
                      طباعة بطاقة الدخول
                    </Btn>
                  )}
                </div>
              </>
            ) : (
              <p className="py-10 text-center text-[13px] font-bold text-slate-400">اختر بائعاً من الجدول لإدارة حسابه</p>
            )}
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-3">
            <p className="mb-2 text-[12px] font-extrabold text-header">إنشاء مدير جديد — الرمز تدخله أنت ولا يُولَّد تلقائياً</p>
            <div className="flex flex-wrap items-end gap-2">
              <FilterField label="اسم الدخول" className="w-[180px]">
                <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="manager1" dir="ltr" />
              </FilterField>
              <FilterField label="الاسم الظاهر" className="w-[220px]">
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="مدير المتابعة" />
              </FilterField>
              <FilterField label="الرمز" className="w-[180px]">
                <Input value={managerPin} onChange={e => setManagerPin(e.target.value)} placeholder="رمز من اختيارك" dir="ltr" />
              </FilterField>
              <Btn
                onClick={() => createMgr.mutate()}
                disabled={createMgr.isPending || username.trim().length < 2 || displayName.trim().length < 2 || managerPin.trim().length < 4}
              >
                إنشاء وحفظ
              </Btn>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
            <div className="min-h-[200px] min-w-0 flex-1">
              <DataGrid
                rows={filteredManagers}
                columns={managerCols}
                loading={managersQ.isLoading}
                getRowId={r => r.id}
                selectedId={selectedManagerId ?? undefined}
                onRowClick={r => { setSelectedManagerId(r.id); setEditName(r.displayName); setResetPin(''); }}
                rowTone={r => freshManagers.has(r.id) ? 'bg-amber-50/80' : undefined}
              />
            </div>
            <aside className="flex w-full shrink-0 flex-col gap-3 overflow-auto border-t border-slate-200 bg-slate-50/60 p-4 xl:w-[340px] xl:border-s xl:border-t-0">
              {selectedManager ? (
                <>
                  <div>
                    <p className="text-[11px] font-extrabold tracking-[0.16em] text-brand-700">مدير متابعة</p>
                    <h3 className="mt-1 text-[18px] font-extrabold text-header">{selectedManager.displayName}</h3>
                    <p className="mt-1 font-mono text-[13px] font-bold text-slate-500" dir="ltr">{selectedManager.username}</p>
                    <div className="mt-2"><StatusChip active={selectedManager.isActive} /></div>
                  </div>
                  <SecretBox value={selectedManager.passwordDisplay} onCopy={v => void copySecret(v)} />
                  <FilterField label="تعديل الاسم الظاهر">
                    <Input value={editName} onChange={e => setEditName(e.target.value)} />
                  </FilterField>
                  <Btn
                    variant="secondary"
                    disabled={editName.trim().length < 2 || editName.trim() === selectedManager.displayName || renameMgr.isPending}
                    onClick={() => renameMgr.mutate({ id: selectedManager.id, name: editName.trim() })}
                  >
                    حفظ الاسم على السيرفر
                  </Btn>
                  <FilterField label="تعيين رمز جديد يدوياً">
                    <Input value={resetPin} onChange={e => setResetPin(e.target.value)} placeholder="الرمز الجديد" dir="ltr" />
                  </FilterField>
                  <Btn
                    disabled={resetMgr.isPending || resetPin.trim().length < 4}
                    onClick={() => setConfirm({
                      title: `حفظ رمز ${selectedManager.username}`,
                      body: 'سيُستبدل الرمز الحالي بالرمز الذي أدخلته. الرمز القديم لن يعمل.',
                      ok: 'حفظ الرمز',
                      run: () => resetMgr.mutate({ id: selectedManager.id, password: resetPin.trim() }),
                    })}
                  >
                    حفظ الرمز الجديد
                  </Btn>
                  <Btn variant="secondary" onClick={() => setMgr.mutate({ id: selectedManager.id, active: !selectedManager.isActive })}>
                    {selectedManager.isActive ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                  </Btn>
                  {selectedManager.passwordDisplay && (
                    <Btn variant="ghost" onClick={() => printAccessCard('مدير', selectedManager.displayName, selectedManager.username, selectedManager.passwordDisplay!)}>
                      طباعة بطاقة الدخول
                    </Btn>
                  )}
                </>
              ) : (
                <p className="py-10 text-center text-[13px] font-bold text-slate-400">اختر مديراً أو أنشئ حساباً جديداً</p>
              )}
            </aside>
          </div>
        </div>
      )}

      <Modal
        open={!!confirm}
        title={confirm?.title}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setConfirm(null)}>إلغاء</Btn>
            <Btn onClick={() => { const run = confirm?.run; setConfirm(null); run?.(); }}>{confirm?.ok}</Btn>
          </>
        }
      >
        <p className="text-[13px] leading-7 text-slate-600">{confirm?.body}</p>
      </Modal>
    </ClassicListShell>
  );
}

export default PortalAccountsPage;
