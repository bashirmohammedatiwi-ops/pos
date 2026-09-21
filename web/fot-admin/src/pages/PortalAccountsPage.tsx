import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@/api/client';
import type { PortalManagerAccountDto, PortalSellerAccountDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { Btn, Input } from '@/components/ui';
import { ClassicListShell, FilterField } from '@/components/classic/ClassicListLayout';
import { InfoNote } from '@/components/workspace';

function PinCell({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[15px] font-extrabold tracking-widest text-amber-900">
      {value}
    </span>
  );
}

export function PortalAccountsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  const sellersQ = useQuery({ queryKey: ['portal-sellers'], queryFn: api.portalSellers });
  const managersQ = useQuery({ queryKey: ['portal-managers'], queryFn: api.portalManagers });

  const issue = useMutation({
    mutationFn: api.issueSellerPin,
    onSuccess: row => {
      void qc.invalidateQueries({ queryKey: ['portal-sellers'] });
      toast.success(`رمز ${row.name}: ${row.pinDisplay}`);
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
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetMgr = useMutation({
    mutationFn: api.resetPortalManager,
    onSuccess: row => {
      void qc.invalidateQueries({ queryKey: ['portal-managers'] });
      toast.success(`رمز ${row.username}: ${row.passwordDisplay}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setMgr = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setPortalManagerActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-managers'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const sellers = useMemo(() => {
    const q = search.trim();
    const rows = sellersQ.data ?? [];
    if (!q) return rows;
    return rows.filter(s => s.name.includes(q) || String(s.salesmanId).includes(q) || (s.pinDisplay ?? '').includes(q));
  }, [sellersQ.data, search]);

  const sellerCols: GridColumn<PortalSellerAccountDto>[] = [
    { key: 'salesmanId', header: '#', width: 70, mono: true },
    { key: 'name', header: 'البائع', width: 220, render: s => <span className="font-semibold text-header">{s.name}</span> },
    {
      key: 'pinDisplay',
      header: 'الرمز (ظاهر دائماً)',
      width: 160,
      sortable: false,
      render: s => <PinCell value={s.pinDisplay} />,
    },
    {
      key: 'hasAccount',
      header: 'الحساب',
      width: 110,
      render: s => (s.hasAccount ? (s.isActive ? 'نشط' : 'متوقف') : 'بدون حساب'),
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
          <button
            type="button"
            className="text-[12px] font-bold text-brand-700 hover:underline"
            onClick={() => issue.mutate(s.salesmanId)}
          >
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
      render: m => <PinCell value={m.passwordDisplay} />,
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
          <button type="button" className="text-[12px] font-bold text-brand-700 hover:underline" onClick={() => resetMgr.mutate(m.id)}>
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
      filters={
        <>
          <FilterField label="بحث بائع">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="الاسم أو الرقم أو الرمز" />
          </FilterField>
        </>
      }
    >
      <InfoNote>
        الرمز يبقى ظاهراً هنا لأن الموظفين ينسونه. لا يظهر في تطبيق البائع. الحساب يُولَّد من هذه الصفحة فقط.
      </InfoNote>

      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        <h2 className="mb-2 text-[14px] font-bold text-header">البائعون</h2>
        <DataGrid rows={sellers} columns={sellerCols} loading={sellersQ.isLoading} getRowId={r => r.salesmanId} />
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <h2 className="mb-2 text-[14px] font-bold text-header">مدراء المتابعة</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <FilterField label="اسم الدخول">
            <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="manager1" dir="ltr" />
          </FilterField>
          <FilterField label="الاسم الظاهر">
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="مدير المتابعة" />
          </FilterField>
          <Btn onClick={() => createMgr.mutate()} disabled={createMgr.isPending}>
            إنشاء حساب مدير
          </Btn>
        </div>
        <DataGrid rows={managersQ.data ?? []} columns={managerCols} loading={managersQ.isLoading} getRowId={r => r.id} />
      </div>
    </ClassicListShell>
  );
}

export default PortalAccountsPage;
