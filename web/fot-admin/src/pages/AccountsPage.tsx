import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatCurrency, formatNum } from '@/api/client';
import type { PosCreditAccountDto } from '@/api/types';
import { DataGrid, type GridColumn } from '@/components/grid/DataGrid';
import { useToast } from '@/components/Toast';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning';
import { downloadCsv } from '@/utils/exportCsv';
import { Alert, Badge, Btn, EmptyState, IconButton, Input, Kbd, TableSkeleton, useConfirm } from '@/components/ui';
import {
  FilterActions,
  FilterBar,
  FilterLabel,
  SegmentedFilter,
  SummaryStrip,
  WorkspaceBody,
  WorkspaceCard,
  WorkspacePage,
  type SummaryCell,
} from '@/components/listWorkspace';
import { usePushPosUpdates } from '@/hooks/usePushPosUpdates';
import { IconCheck, IconDownload, IconMonitor, IconRefresh, IconSearch, IconSend, IconUsers, IconX } from '@/components/icons';

const SEARCH_KEY = 'fot_admin_accounts';

function allAccountsColumns(
  toggle: (seq: number, on: boolean) => void,
  selected: Set<number>,
): GridColumn<PosCreditAccountDto>[] {
  return [
    {
      key: 'pos',
      header: 'نقطة البيع',
      width: 84,
      align: 'center',
      sortable: false,
      exportable: false,
      render: a => {
        const on = selected.has(a.edariSeq);
        return (
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={on ? 'إلغاء التفعيل' : 'تفعيل على نقطة البيع'}
            onClick={e => {
              e.stopPropagation();
              toggle(a.edariSeq, !on);
            }}
            className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition ${
              on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-transparent hover:border-brand-400'
            }`}
          >
            <IconCheck size={12} />
          </button>
        );
      },
    },
    { key: 'num', header: 'الرقم', width: 110, mono: true, render: a => a.num ?? '—' },
    { key: 'name', header: 'الاسم', width: 300, render: a => <span className="font-semibold text-header">{a.name ?? '—'}</span> },
    {
      key: 'balance',
      header: 'الرصيد',
      width: 150,
      mono: true,
      footer: 'sum',
      render: a => <span className={a.balance < 0 ? 'font-semibold text-red-600' : ''}>{formatCurrency(a.balance)}</span>,
    },
  ];
}

export function AccountsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { push: pushToPos, pushing } = usePushPosUpdates();
  const [search, setSearch] = useState(() => {
    try {
      return sessionStorage.getItem(SEARCH_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [debounced, setDebounced] = useState(search.trim());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [view, setView] = useState<'all' | 'on'>('all');
  /** الصف المؤشَّر بلوحة المفاتيح (↑↓ ثم Enter للتفعيل). */
  const [cursorSeq, setCursorSeq] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useUnsavedWarning(dirty);

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_KEY, search);
    } catch {
      /* تجاهل */
    }
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
    placeholderData: prev => prev,
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
  // حسابات شوهدت في بحث سابق — حتى لا تختفي المفعّلة من القائمة/المجاميع بعد تغيير البحث
  const seenRef = useRef<Map<number, PosCreditAccountDto>>(new Map());

  // الحسابات المفعّلة — تجمع بين المحفوظ ونتائج البحث الحالية وما شوهد سابقاً
  const selectedRows = useMemo<PosCreditAccountDto[]>(() => {
    const seen = seenRef.current;
    for (const a of selectedQ.data ?? []) seen.set(a.edariSeq, a);
    for (const a of items) seen.set(a.edariSeq, a);
    return Array.from(selected)
      .map(seq => seen.get(seq))
      .filter((a): a is PosCreditAccountDto => !!a);
  }, [items, selected, selectedQ.data]);

  const visibleItems = useMemo(() => {
    if (view === 'all') return items;
    // «المفعّلة فقط» تعرض كل المفعّلة (وليس نتائج البحث فقط) مع تصفية محلية
    const q = search.trim().toLowerCase();
    if (!q) return selectedRows;
    return selectedRows.filter(a => (a.name || '').toLowerCase().includes(q) || (a.num || '').toLowerCase().includes(q));
  }, [items, selectedRows, view, search]);

  const selectedBalance = selectedRows.reduce((n, a) => n + a.balance, 0);
  const savedCount = selectedQ.data?.length ?? 0;
  const changeCount = useMemo(() => {
    const saved = new Set((selectedQ.data ?? []).map(a => a.edariSeq));
    let n = 0;
    for (const s of selected) if (!saved.has(s)) n++;
    for (const s of saved) if (!selected.has(s)) n++;
    return n;
  }, [selected, selectedQ.data]);

  const toggle = (seq: number, on: boolean) => {
    const row = items.find(a => a.edariSeq === seq);
    if (row) seenRef.current.set(seq, row);
    setDirty(true);
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(seq);
      else next.delete(seq);
      return next;
    });
  };

  const selectAllVisible = () => {
    visibleItems.forEach(a => seenRef.current.set(a.edariSeq, a));
    setDirty(true);
    setSelected(prev => {
      const next = new Set(prev);
      visibleItems.forEach(a => next.add(a.edariSeq));
      return next;
    });
  };

  async function clearAll() {
    if (!selected.size) return;
    const ok = await confirm({
      title: 'إلغاء تفعيل كل الحسابات؟',
      message: `سيُزال ${formatNum(selected.size)} حساب من «بيع آجل». لن يُطبَّق التغيير حتى تضغط حفظ.`,
      confirmLabel: 'إلغاء الكل',
      danger: true,
    });
    if (!ok) return;
    setDirty(true);
    setSelected(new Set());
  }

  async function discard() {
    const ok = await confirm({
      title: 'تجاهل التغييرات؟',
      message: 'سيعود التحديد إلى آخر نسخة محفوظة.',
      confirmLabel: 'تجاهل',
      danger: true,
    });
    if (!ok) return;
    setSelected(new Set((selectedQ.data ?? []).map(a => a.edariSeq)));
    setDirty(false);
  }

  const loading = (edariQ.isLoading && !edariQ.data) || selectedQ.isLoading;

  const stripCells: SummaryCell[] = [
    {
      label: 'مفعّلة على نقطة البيع',
      value: formatNum(selected.size),
      hint: dirty ? `المحفوظ ${formatNum(savedCount)}` : 'تظهر في «بيع آجل»',
      tone: 'brand',
      onClick: () => setView('on'),
      active: view === 'on',
    },
    {
      label: 'رصيد المفعّلة',
      value: formatCurrency(selectedBalance),
      hint: 'مجموع أرصدة Edari',
      tone: selectedBalance < 0 ? 'danger' : undefined,
    },
    {
      label: debounced ? 'نتائج البحث في Edari' : 'حسابات Edari',
      value: formatNum(items.length),
      hint: debounced ? `«${debounced}»` : 'القابلة للبيع الآجل',
      onClick: () => setView('all'),
      active: view === 'all',
    },
    {
      label: 'تغييرات غير محفوظة',
      value: formatNum(changeCount),
      hint: dirty ? 'Ctrl+S للحفظ' : 'كل شيء محفوظ',
      tone: changeCount > 0 ? 'warn' : 'ok',
    },
  ];

  return (
    <WorkspacePage>
      {dirty && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-1.5 animate-fade-in">
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-amber-900">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            تغييرات غير محفوظة — {formatNum(changeCount)} تغيير · {formatNum(selected.size)} حساب محدد
            <span className="hidden items-center gap-1 text-[11.5px] font-normal text-amber-800 sm:inline-flex">
              (<Kbd>Ctrl</Kbd>+<Kbd>S</Kbd>)
            </span>
          </span>
          <div className="flex gap-2">
            <Btn size="xs" variant="ghost" onClick={() => void discard()}>تجاهل</Btn>
            <Btn size="xs" loading={save.isPending} onClick={() => save.mutate()}>حفظ التحديد</Btn>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_250px] 2xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* حسابات Edari — الجدول */}
        <WorkspaceCard className="min-h-[420px] min-w-0 lg:min-h-0">
          <FilterBar>
            <FilterLabel label="بحث برقم أو اسم الحساب في Edari" grow>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">
                  {edariQ.isFetching && debounced ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                  ) : (
                    <IconSearch size={16} />
                  )}
                </span>
                <Input
                  ref={searchRef}
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setDebounced(search.trim());
                    if (e.key === 'Escape') setSearch('');
                  }}
                  placeholder="اكتب رقم الحساب أو جزءاً من الاسم…"
                  className="!ps-9 !pe-8 font-bold"
                  aria-label="بحث الحسابات"
                />
                {search && (
                  <button
                    type="button"
                    className="absolute inset-y-0 end-2 flex items-center text-slate-400 hover:text-slate-700"
                    aria-label="مسح البحث"
                    onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
            </FilterLabel>
            <div className="min-w-0">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">العرض</span>
              <div className="flex h-9 items-center">
                <SegmentedFilter
                  label="عرض الحسابات"
                  value={view}
                  onChange={setView}
                  items={[
                    { id: 'all', label: 'كل الحسابات' },
                    { id: 'on', label: 'المفعّلة فقط', count: selected.size },
                  ]}
                />
              </div>
            </div>
            <FilterActions>
              <Btn variant="secondary" icon={<IconCheck size={13} />} disabled={!visibleItems.length} onClick={selectAllVisible}>
                تحديد المعروض
              </Btn>
              <Btn variant="ghost" disabled={!selected.size} onClick={() => void clearAll()}>
                إلغاء الكل
              </Btn>
              <IconButton label="تحديث" onClick={() => { void edariQ.refetch(); void selectedQ.refetch(); }}>
                <IconRefresh size={15} className={edariQ.isFetching ? 'animate-spin' : ''} />
              </IconButton>
            </FilterActions>
          </FilterBar>

          <SummaryStrip cells={stripCells} loading={loading} />

          <WorkspaceBody>
            {edariQ.isError && !edariQ.data ? (
              <div className="p-3">
                <Alert title="تعذر جلب الحسابات من Edari">
                  <p>{edariQ.error instanceof Error ? edariQ.error.message : 'تحقق من اتصال Edari.'}</p>
                  <Btn size="xs" variant="secondary" className="mt-2" onClick={() => edariQ.refetch()}>إعادة المحاولة</Btn>
                </Alert>
              </div>
            ) : loading ? (
              <div className="p-3"><TableSkeleton rows={10} cols={4} /></div>
            ) : !visibleItems.length ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<IconUsers size={24} />}
                  title={view === 'on' ? 'لا حسابات مفعّلة' : search ? 'لا نتائج مطابقة' : 'لا حسابات'}
                  description={
                    view === 'on'
                      ? 'فعّل حساباً من «كل الحسابات» ليظهر للكاشير في البيع الآجل.'
                      : search
                        ? 'جرّب رقم الحساب أو جزءاً من الاسم.'
                        : 'تحقق من اتصال Edari ثم حدّث.'
                  }
                  action={
                    view === 'on' ? (
                      <Btn size="sm" variant="secondary" onClick={() => setView('all')}>عرض كل الحسابات</Btn>
                    ) : search ? (
                      <Btn size="sm" variant="secondary" onClick={() => setSearch('')}>مسح البحث</Btn>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <DataGrid
                variant="sheet"
                embedded
                fillHeight
                columns={allAccountsColumns(toggle, selected)}
                rows={visibleItems}
                getRowId={a => a.edariSeq}
                exportName="حسابات-Edari-الآجلة"
                counterLabel="حساب"
                emptyText="لا نتائج تطابق فلتر الأعمدة"
                badge={<span className="hidden text-[11px] text-slate-400 md:inline">انقر المربع أو مرتين على الصف للتفعيل · ↑↓ ثم Enter</span>}
                rowTone={a => (selected.has(a.edariSeq) ? 'bg-emerald-50/60' : undefined)}
                selectedId={cursorSeq ?? undefined}
                onSelect={a => setCursorSeq(a.edariSeq)}
                onEnter={a => toggle(a.edariSeq, !selected.has(a.edariSeq))}
                onRowDoubleClick={a => toggle(a.edariSeq, !selected.has(a.edariSeq))}
                storageKey="accounts"
              />
            )}
          </WorkspaceBody>
        </WorkspaceCard>

        {/* المفعّلة على نقطة البيع — قائمة جانبية ضيقة */}
        <aside className="card flex max-h-[40vh] min-h-0 shrink-0 flex-col overflow-hidden lg:max-h-none">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-2.5 py-2">
            <div className="min-w-0">
              <h2 className="text-[12.5px] font-bold text-header">على نقطة البيع</h2>
              <p className="text-[11px] text-slate-500 num">{formatNum(selectedRows.length)} حساب</p>
            </div>
            <IconButton
              label="تصدير CSV"
              className="!h-8 !w-8"
              disabled={!selectedRows.length}
              onClick={() =>
                downloadCsv(
                  'credit-accounts.csv',
                  ['الرقم', 'الاسم', 'الرصيد'],
                  selectedRows.map(a => [a.num ?? '', a.name ?? '', a.balance]),
                )
              }
            >
              <IconDownload size={14} />
            </IconButton>
          </header>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {selectedQ.isLoading ? (
              <li className="p-2"><TableSkeleton rows={5} cols={1} /></li>
            ) : selectedRows.length === 0 ? (
              <li>
                <EmptyState compact icon={<IconMonitor size={18} />} title="لا حسابات مفعّلة" description="حدّد حسابات من الجدول." />
              </li>
            ) : (
              selectedRows.map(a => (
                <li
                  key={a.edariSeq}
                  className="group flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-1 hover:bg-slate-50"
                  title={`${a.num ?? ''} ${a.name ?? ''}`.trim()}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-header">{a.name ?? a.num ?? '—'}</span>
                  <span className={`shrink-0 text-[11px] num ${a.balance < 0 ? 'text-red-600' : 'text-slate-500'}`}>{formatCurrency(a.balance)}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-0.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600 group-hover:text-slate-400"
                    title="إلغاء التفعيل"
                    aria-label={`إلغاء تفعيل ${a.name ?? ''}`}
                    onClick={() => toggle(a.edariSeq, false)}
                  >
                    <IconX size={13} />
                  </button>
                </li>
              ))
            )}
          </ul>
          <footer className="shrink-0 space-y-1.5 border-t border-slate-200 bg-slate-50/80 p-2.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500">مجموع الأرصدة</span>
              <span className={`font-bold num ${selectedBalance < 0 ? 'text-red-600' : 'text-header'}`}>{formatCurrency(selectedBalance)}</span>
            </div>
            <Btn className="w-full" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              {dirty ? 'حفظ التحديد' : 'محفوظ'}
            </Btn>
            <Btn
              className="w-full"
              variant="secondary"
              icon={<IconSend size={13} />}
              loading={pushing}
              disabled={pushing}
              onClick={() => void pushToPos()}
            >
              رفع التحديثات لنقاط البيع
            </Btn>
            {dirty && <Badge tone="warn" dot className="w-full justify-center">احفظ قبل الرفع</Badge>}
          </footer>
        </aside>
      </div>
    </WorkspacePage>
  );
}
