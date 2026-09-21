import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { PosCreditAccountDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { downloadCsv } from '@/utils/exportCsv';
import { Btn, Input, Loading } from '@/components/ui';
import {
  ClassicListShell,
  ClassicSummaryFooter,
  FilterField,
} from '@/components/classic/ClassicListLayout';
import { FilterChip, InfoNote, UnsavedBar } from '@/components/workspace';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';

function allAccountsColumns(
  toggle: (seq: number, on: boolean) => void,
  selected: Set<number>,
): GridColumn<PosCreditAccountDto>[] {
  return [
    {
      key: 'pos',
      header: 'POS',
      width: 70,
      align: 'center',
      sortable: false,
      exportable: false,
      render: a => (
        <span
          onClick={e => {
            e.stopPropagation();
            toggle(a.edariSeq, !selected.has(a.edariSeq));
          }}
          className={`inline-flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-md border text-[10px] font-bold transition ${
            selected.has(a.edariSeq) ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white text-transparent hover:border-brand-400'
          }`}
        >
          ✓
        </span>
      ),
    },
    { key: 'num', header: 'الرقم', width: 110, mono: true, render: a => a.num ?? '—' },
    { key: 'name', header: 'الاسم', width: 280, render: a => <span className="font-semibold text-header">{a.name ?? '—'}</span> },
    { key: 'balance', header: 'الرصيد', width: 150, mono: true, footer: 'sum', render: a => <span className={a.balance < 0 ? 'text-red-600' : ''}>{formatCurrency(a.balance)}</span> },
  ];
}

export function AccountsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { push: pushToPos, pushing } = usePushPosUpdates();
  const [search, setSearch] = useState(() => sessionStorage.getItem('fot_admin_accounts') ?? '');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [view, setView] = useState<'all' | 'on'>('all');
  const [dirty, setDirty] = useState(false);
  useUnsavedWarning(dirty);

  useEffect(() => {
    sessionStorage.setItem('fot_admin_accounts', search);
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const selectedQ = useQuery({
    queryKey: ['credit-accounts-selected'],
    queryFn: api.creditAccountsSelected,
  });

  const edariQ = useQuery({
    queryKey: ['credit-accounts-edari', debounced],
    queryFn: () => api.creditAccountsEdari(debounced || undefined),
  });

  useEffect(() => {
    if (selectedQ.data && !dirty) {
      setSelected(new Set(selectedQ.data.map(a => a.edariSeq)));
    }
  }, [selectedQ.data, dirty]);

  const save = useMutation({
    mutationFn: () => api.saveCreditAccountSelection(Array.from(selected)),
    onSuccess: data => {
      setDirty(false);
      setSelected(new Set(data.map(a => a.edariSeq)));
      qc.setQueryData(['credit-accounts-selected'], data);
      qc.invalidateQueries({ queryKey: ['credit-accounts-edari'] });
      toast.success(`تم حفظ ${data.length} حساب — سيظهر على نقاط البيع خلال ثوانٍ`);
    },
    onError: e => toast.error(e instanceof Error ? e.message : 'فشل الحفظ'),
  });

  const persist = useCallback(() => {
    if (dirty) save.mutate();
  }, [dirty, save]);

  useSaveShortcut(persist, dirty);

  const items = edariQ.data ?? [];
  const selectedPreview = useMemo(() => {
    const map = new Map<number, { edariSeq: number; num?: string; name?: string; balance: number }>();
    for (const a of selectedQ.data ?? []) {
      map.set(a.edariSeq, a);
    }
    for (const a of items) {
      if (selected.has(a.edariSeq)) map.set(a.edariSeq, a);
    }
    return Array.from(selected)
      .map(seq => map.get(seq))
      .filter((a): a is NonNullable<typeof a> => !!a);
  }, [items, selected, selectedQ.data]);

  const visibleItems = useMemo(
    () => (view === 'on' ? items.filter(a => selected.has(a.edariSeq)) : items),
    [items, selected, view],
  );
  const selectedBalance = selectedPreview.reduce((n, a) => n + a.balance, 0);

  const toggle = (seq: number, on: boolean) => {
    setDirty(true);
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(seq);
      else next.delete(seq);
      return next;
    });
  };

  const selectAllVisible = () => {
    setDirty(true);
    setSelected(prev => {
      const next = new Set(prev);
      items.forEach(a => next.add(a.edariSeq));
      return next;
    });
  };

  const clearAll = () => {
    setDirty(true);
    setSelected(new Set());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dirty && (
        <UnsavedBar
          text={`تغييرات غير محفوظة — ${selected.size} حساب محدد`}
          onSave={() => save.mutate()}
          pending={save.isPending}
        />
      )}

      <ClassicListShell
        banner={
          <InfoNote strip>
            اختر الحسابات الظاهرة في «بيع آجل» على نقطة البيع — احفظ ثم «رفع لنقاط البيع» إن لزم.
          </InfoNote>
        }
        filters={
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <FilterField label="بحث في Edari">
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="رقم أو اسم الحساب" />
            </FilterField>
            <div className="flex flex-wrap items-end gap-2">
              <FilterChip compact active={view === 'all'} onClick={() => setView('all')}>كل الحسابات</FilterChip>
              <FilterChip compact active={view === 'on'} onClick={() => setView('on')}>المفعّلة فقط</FilterChip>
            </div>
          </div>
        }
        header={{
          title: 'حسابات بيع الآجل',
          hint: 'حدّد الحسابات ثم احفظ',
          actions: (
            <>
              <Btn size="sm" variant="secondary" onClick={selectAllVisible}>تحديد المعروض</Btn>
              <Btn size="sm" variant="secondary" onClick={clearAll}>إلغاء</Btn>
              <Btn
                size="sm"
                variant="secondary"
                disabled={!selectedPreview.length}
                onClick={() =>
                  downloadCsv(
                    'credit-accounts.csv',
                    ['الرقم', 'الاسم', 'الرصيد'],
                    selectedPreview.map(a => [a.num ?? '', a.name ?? '', a.balance]),
                  )
                }
              >
                CSV
              </Btn>
              <Btn size="sm" variant="secondary" onClick={() => void pushToPos()} disabled={pushing}>
                {pushing ? '…' : 'رفع POS'}
              </Btn>
              <Btn size="sm" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                {save.isPending ? '…' : 'حفظ'}
              </Btn>
            </>
          ),
        }}
        onRefresh={() => edariQ.refetch()}
        refreshing={edariQ.isFetching}
        footer={
          <ClassicSummaryFooter
            total={visibleItems.length}
            items={[
              { label: 'Edari', value: formatNum(items.length) },
              { label: 'مفعّل', value: formatNum(selected.size), accent: true },
              { label: 'رصيد', value: formatCurrency(selectedBalance) },
              { label: 'معروض', value: formatNum(visibleItems.length) },
            ]}
          />
        }
      >
        {(edariQ.isLoading || selectedQ.isLoading) ? (
          <Loading />
        ) : (
          <DataGrid
            embedded
            fillHeight
            columns={allAccountsColumns(toggle, selected)}
            rows={visibleItems}
            getRowId={a => a.edariSeq}
            exportName="حسابات-Edari-الآجلة"
            counterLabel="حساب"
            emptyText="لا نتائج — تحقق من اتصال Edari"
            rowTone={a => (selected.has(a.edariSeq) ? 'bg-emerald-50/60' : undefined)}
            storageKey="accounts"
          />
        )}
      </ClassicListShell>
    </div>
  );
}
