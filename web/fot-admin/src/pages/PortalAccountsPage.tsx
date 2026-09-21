import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, formatDate, formatNum } from '@/api/client';
import type { PortalManagerAccountDto, PortalSellerAccountDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { Btn, Input } from '@/components/ui';
import { ClassicListShell, ClassicSummaryFooter, FilterField } from '@/components/classic/ClassicListLayout';
import { FilterChip, InfoNote } from '@/components/workspace';
import { copyText } from '@/lib/clipboard';

type SellerFilter = 'all' | 'none' | 'active' | 'stopped';

function PinCell({ value, onCopy }: { value?: string | null; onCopy: (v: string) => void }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <button
      type="button"
      className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[15px] font-extrabold tracking-widest text-amber-900 hover:bg-amber-100"
      title="نسخ"
      onClick={() => onCopy(value)}
    >
      {value}
    </button>
  );
}

export function PortalAccountsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SellerFilter>('all');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const sellersQ = useQuery({ queryKey: ['portal-sellers'], queryFn: api.portalSellers });
  const managersQ = useQuery({ queryKey: ['portal-managers'], queryFn: api.portalManagers });

  async function copySecret(value: string) {
    try {
      await copyText(value);
      toast.success('تم نسخ الرمز');
    } catch {
      toast.error('تعذر النسخ');
    }
  }

  const issue = useMutation({
    mutationFn: api.issueSellerPin,
    onSuccess: row => {
      void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
      toast.success(`رمز ${row.name}: ${row.pinDisplay}`);
      if (row.pinDisplay) void copySecret(row.pinDisplay);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setSeller = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setSellerPortalActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-sellers'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const createMgr = useMutation({
    mutationFn: () => api.createPortalManager(username, displayName),
    onSuccess: row => {
      setUsername('');
      setDisplayName('');
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
      toast.success(`حساب ${row.username} — الرمز ${row.passwordDisplay}`);
      if (row.passwordDisplay) void copySecret(row.passwordDisplay);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetMgr = useMutation({
    mutationFn: api.resetPortalManager,
    onSuccess: row => {
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
      toast.success(`رمز ${row.username}: ${row.passwordDisplay}`);
      if (row.passwordDisplay) void copySecret(row.passwordDisplay);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setMgr = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setPortalManagerActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-managers'] }),
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

  const withAccount = allSellers.filter(s => s.hasAccount).length;
  const activeCount = allSellers.filter(s => s.hasAccount && s.isActive).length;
  const managers = managersQ.data ?? [];

  function issuePin(s: PortalSellerAccountDto) {
    if (s.hasAccount && !window.confirm(`إعادة رمز ${s.name}؟ الرمز الحالي لن يعمل بعد ذلك.`)) return;
    issue.mutate(s.salesmanId);
  }

  const sellerCols: GridColumn<PortalSellerAccountDto>[] = [
    { key: 'salesmanId', header: '#', width: 70, mono: true },
    { key: 'name', header: 'البائع', width: 220, render: s => <span className="font-semibold text-header">{s.name}</span> },
    {
      key: 'pinDisplay',
      header: 'الرمز (ظاهر دائماً)',
      width: 160,
      sortable: false,
      render: s => <PinCell value={s.pinDisplay} onCopy={v => void copySecret(v)} />,
    },
    {
      key: 'hasAccount',
      header: 'الحساب',
      width: 110,
      render: s => (s.hasAccount ? (s.isActive ? 'نشط' : 'متوقف') : 'بدون حساب'),
    },
    {
      key: 'lastLoginAt',
      header: 'آخر دخول',
      width: 150,
      render: s => (s.lastLoginAt ? formatDate(s.lastLoginAt) : '—'),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 240,
      align: 'center',
      sortable: false,
      exportable: false,
      render: s => (
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="text-[12px] font-bold text-brand-700 hover:underline" onClick={() => issuePin(s)}>
            {s.hasAccount ? 'إعادة الرمز' : 'توليد حساب'}
          </button>
          {s.hasAccount && (
            <button
              type="button"
              className="text-[12px] text-slate-600 hover:underline"
              onClick={() => setSeller.mutate({ id: s.salesmanId, active: !s.isActive })}
            >
              {s.isActive ? 'إيقاف' : 'تفعيل'}
            </button>
          )}
        </div>
      ),
    },
  ];

  const managerCols: GridColumn<PortalManagerAccountDto>[] = [
    { key: 'username', header: 'اسم الدخول', width: 140, mono: true },
    { key: 'displayName', header: 'الاسم', width: 200 },
    {
      key: 'passwordDisplay',
      header: 'كلمة المرور (ظاهرة دائماً)',
      width: 180,
      sortable: false,
      render: m => <PinCell value={m.passwordDisplay} onCopy={v => void copySecret(v)} />,
    },
    { key: 'isActive', header: 'الحالة', width: 90, render: m => (m.isActive ? 'نشط' : 'متوقف') },
    {
      key: 'actions',
      header: 'إجراءات',
      width: 200,
      align: 'center',
      sortable: false,
      exportable: false,
      render: m => (
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="text-[12px] font-bold text-brand-700 hover:underline"
            onClick={() => {
              if (!window.confirm(`إعادة رمز ${m.username}؟`)) return;
              resetMgr.mutate(m.id);
            }}
          >
            إعادة الرمز
          </button>
          <button type="button" className="text-[12px] text-slate-600 hover:underline" onClick={() => setMgr.mutate({ id: m.id, active: !m.isActive })}>
            {m.isActive ? 'إيقاف' : 'تفعيل'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <ClassicListShell
      banner={
        <InfoNote strip>
          الرمز يبقى ظاهراً هنا لأن الموظفين ينسونه. لا يظهر في تطبيق البائع. الحساب يُولَّد من هذه الصفحة فقط.
        </InfoNote>
      }
      filters={
        <>
          <FilterField label="بحث بائع">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="الاسم أو الرقم أو الرمز" />
          </FilterField>
        </>
      }
      header={{
        title: 'حسابات ويب البائعين',
        hint: 'توليد الرمز · إيقاف الحساب · إنشاء مدير متابعة',
        actions: (
          <>
            <FilterChip compact active={filter === 'all'} onClick={() => setFilter('all')}>الكل</FilterChip>
            <FilterChip compact active={filter === 'none'} onClick={() => setFilter('none')}>بدون حساب</FilterChip>
            <FilterChip compact active={filter === 'active'} onClick={() => setFilter('active')}>نشط</FilterChip>
            <FilterChip compact active={filter === 'stopped'} onClick={() => setFilter('stopped')}>متوقف</FilterChip>
          </>
        ),
      }}
      onRefresh={() => { void sellersQ.refetch(); void managersQ.refetch(); }}
      refreshing={sellersQ.isFetching || managersQ.isFetching}
      footer={
        <ClassicSummaryFooter
          total={sellers.length}
          items={[
            { label: 'بائعون', value: formatNum(allSellers.length) },
            { label: 'بحساب', value: formatNum(withAccount), accent: true },
            { label: 'نشط', value: formatNum(activeCount) },
            { label: 'مدراء', value: formatNum(managers.length) },
          ]}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="min-h-[240px] px-1">
          <DataGrid rows={sellers} columns={sellerCols} loading={sellersQ.isLoading} getRowId={r => r.salesmanId} />
        </div>
        <div className="border-t border-slate-200 px-3 py-4">
          <h2 className="mb-2 text-[14px] font-bold text-header">مدراء المتابعة</h2>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <FilterField label="اسم الدخول">
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="manager1" dir="ltr" />
            </FilterField>
            <FilterField label="الاسم الظاهر">
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="مدير المتابعة" />
            </FilterField>
            <Btn onClick={() => createMgr.mutate()} disabled={createMgr.isPending || username.trim().length < 2 || displayName.trim().length < 2}>
              إنشاء حساب مدير
            </Btn>
          </div>
          <DataGrid rows={managers} columns={managerCols} loading={managersQ.isLoading} getRowId={r => r.id} />
        </div>
      </div>
    </ClassicListShell>
  );
}

export default PortalAccountsPage;
